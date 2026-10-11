"""Read-only admission checks. Never invoke a plugin process or a solver."""
from jsonschema import Draft202012Validator
from pydantic import ValidationError
from fastapi import HTTPException
from ..domain.models import DomainDocument
from ..plugin_host.parameter_contracts import schemas, normalize, HOST_PARAMETERS
from cablesim_sdk.validation import validation_error


def pointer(prefix, parts):
    return '/' + prefix + ''.join('/' + str(p).replace('~', '~0').replace('/', '~1') for p in parts)


def input_issues(capability, case):
    """Return all actionable schema defects rather than the first missing key."""
    if case.get('preflight_error'):
        error = case['preflight_error']
        return error.get('issues') or [error]
    try:
        parameters, document = normalize(capability, case.get('parameters', {}), case['input'])
    except (ValueError, KeyError, TypeError) as error:
        return [{'path': '/parameters', 'message': str(error)}]
    parameters = {k: v for k, v in parameters.items() if k not in HOST_PARAMETERS}
    parameter_schema, input_schema = schemas(capability, case['input'])
    issues = []
    for schema, value, prefix in [(parameter_schema, parameters, 'parameters'), (input_schema, document, 'method_input')]:
        if schema is None:
            continue
        for error in sorted(Draft202012Validator(schema).iter_errors(value), key=lambda e: str(list(e.path))):
            parts = list(error.absolute_path)
            if error.validator == 'required':
                for key in error.validator_value:
                    if key not in error.instance:
                        issues.append({'path': pointer(prefix, parts + [key]), 'message': '必填项未填写，请补齐。'})
            else:
                issues.append({'path': pointer(prefix, parts), 'message': '取值不符合范围、单位或选项要求，请核对输入。'})
    # Domain/Problem invariants are algebraic validation, not native preflight.
    try:
        if document.get('schema_version') == 'cablesim.domain/1':
            DomainDocument.model_validate(document)
        elif document.get('schema_version') == 'cablesim.simulation-problem/1':
            from .simulation_contract import validate_input
            validate_input(document, capability.id)
    except ValidationError as error:
        issues.extend(validation_error(error, 'INPUT_INVALID').get('issues', []))
    except HTTPException as error:
        detail = error.detail
        issues.extend(detail.get('issues') or [detail] if isinstance(detail, dict) else [{'path': '/method_input', 'message': str(detail)}])
    return list({(item.get('path'), item.get('message')): item for item in issues}.values())


def local_preflight(research, wid, sid, revision, study_revision, module=None):
    with research.store.db() as db:
        db.execute('BEGIN')
        definition = research.module_definition(research.definition(db, wid, sid, study_revision)['definition'], module)
        # prepare() can compute incomplete candidate models. Do not enter that path
        # from read-only admission; model preparation remains an explicit action.
        if definition['driver'].get('candidate_ids'):
            return {'ready': False, 'input_ready': False, 'local_only': True, 'cases': [
                {'case_id': 'case-0', 'status': 'failed', 'error': {'issues': [
                    {'path': '/driver/candidate_ids', 'message': '请先完成并保存候选型号的工程参数，再进行方法预检。'}]}}]}
        try:
            snapshot = research.prepare(db, wid, sid, revision, study_revision, module)
        except HTTPException as error:
            if error.status_code != 422:
                raise
            detail = error.detail if isinstance(error.detail, dict) else {'path': '/method_input', 'message': str(error.detail)}
            return {'ready': False, 'input_ready': False, 'local_only': True, 'cases': [
                {'case_id': 'case-0', 'status': 'failed', 'error': {'issues': detail.get('issues') or [detail]}}]}
    checks, comparisons, scopes = [], [], []
    methods = [(snapshot['definition']['method'], None)] + [
        (item['method'], item['parameters']) for item in snapshot['definition']['crosschecks']]
    for index, (method, parameters) in enumerate(methods):
        _, capability = research.resolve(method)
        scopes.append({'method': method, 'limitations': capability.limitations,
                       'validation': capability.validation.model_dump(mode='json')})
        for case in snapshot['cases']:
            issues = input_issues(capability, {**case, **({'parameters': parameters} if parameters is not None else {})})
            row = {'case_id': ('crosscheck-' + str(index) + '-' if index else '') + case['case_id'],
                   'status': 'failed' if issues else 'succeeded'}
            if issues:
                row['error'] = {'code': 'INPUT_INVALID', 'issues': issues}
            (comparisons if index else checks).append(row)
    ready = bool(checks) and all(row['status'] == 'succeeded' for row in checks + comparisons)
    return {'ready': False, 'input_ready': ready, 'local_only': True, 'cases': checks,
            'crosschecks': comparisons, 'method_scopes': scopes,
            'lock_digest': snapshot['lock']['digest']}
