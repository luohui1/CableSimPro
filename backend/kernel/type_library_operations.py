"""Library batches orchestrate the ordinary Research and Types services.

No calculation results are kept in a parallel product database. Each receipt
links the exact saved type, ordinary study/run, and existing approval gate.
"""
from copy import deepcopy
import json
from uuid import uuid4, uuid5, NAMESPACE_URL

from fastapi import HTTPException
from pydantic import ValidationError

from .contracts import CreateStudy, RunStudy
from .workspace import fingerprint, stamp
from . import factory_tables as tables
from .type_versions import Adopt, Submit, Approval, Publish
from .rating_conditions import RatingTableDefinition, table_definition
from .rating_table import rating_rows
from .environment_references import adopt_for_batch
from .resource_data import ResourceData
from .catalogue_core import CoreError, library as studio_library, product


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def child_request(request, spec, operation):
    return uuid5(NAMESPACE_URL, f'cablesim-library/{request}/{spec}/{operation}')


def failure(error):
    detail = error.detail if isinstance(error, HTTPException) else error.as_dict() if isinstance(error, CoreError) else str(error)
    return {'status': 'failed', 'message': detail.get('message', str(detail)) if isinstance(detail, dict) else str(detail), 'detail': detail}


def _entries(service, specs):
    entries = {}
    for spec in specs:
        workspace = service.store.snapshot(spec['workspace_id'])
        document = workspace['domain']
        try:
            if document.get('schema_version') != 'cablesim.domain/1':
                continue
            payload = {'cable_type': document['cable_types'][0], 'materials': document['materials']}
            entries[spec['id']] = studio_library._entry(spec['model_id'], str(spec['version']), spec['name'],
                spec['series_id'], 'public', '已保存型号草稿；逐字段来源见原始导入记录。', payload)
        except (KeyError, ValueError, TypeError):
            continue
    return entries


def _run(service, spec, definition, request):
    research = service.research
    wid, revision = spec['workspace_id'], spec['workspace_revision']
    study = research.save(wid, CreateStudy(expected_revision=revision, **definition))
    check = research.preflight(wid, study['id'], revision, study['revision'])
    run = research.execute(wid, study['id'], RunStudy(request_id=request, expected_revision=revision,
        expected_study_revision=study['revision'], lock_digest=check['lock_digest'], scope_acknowledged=True), checked_preflight=check)
    method = definition['method']
    plugin = research.registry(method['plugin_id']).get(method['plugin_id'])
    result = {'status': run['status'], 'workspace_id': wid, 'study_id': study['id'], 'run_id': run['id'],
              'method_name': plugin.manifest.name, 'method_version': method['version'], 'confidence': 'reference',
              'input_digest': run['input_digest'], 'output_digest': run['output_digest'],
              'message': '运行记录已保存；计算状态、标准核对结论与人工批准状态分别判断。'}
    if definition['driver']['kind'] == 'batch':
        result['rows'] = rating_rows(run)
    else:
        cases = (run.get('output') or {}).get('cases', [])
        result['checks'] = [row for case in cases for row in case.get('artifacts', {}).get('x-cablesim.standard-check', {}).get('rows', [])]
        result['errors'] = [case.get('error') for case in cases if case.get('error')]
    return result


def _review(service, series_id, specs, body, actor):
    """All selected versions pass the existing gate or the transaction rolls back."""
    prepared = {}
    if body.action == 'submit':
        for spec in specs:
            prepared[spec['id']] = service.types.specification(spec['workspace_id'])
    with service.store.db(True) as db:
        for spec in specs:
            current = service._spec(db, spec['id'])
            if (current['version'], current['workspace_revision']) != (spec['version'], spec['workspace_revision']):
                tables.fail('TYPE_REVIEW_STALE', '审核期间型号版本已变化，整批未修改。', 409)
        items = []
        for spec in specs:
            wid, revision = spec['workspace_id'], spec['workspace_revision']
            request = child_request(body.request_id, spec['id'], body.action)
            if body.action == 'submit':
                plan = db.execute('SELECT status FROM type_plans WHERE workspace=?', (wid,)).fetchone()
                if plan and plan['status'] == 'draft':
                    service.types.adopt(wid, Adopt(expected_revision=revision,
                        request_id=child_request(body.request_id, spec['id'], 'adopt')), connection=db)
                result = service.types.submit(wid, Submit(expected_revision=revision, request_id=request,
                    specification_digest=prepared[spec['id']]['digest'], acknowledge_checks=True,
                    change_summary=body.note), connection=db)
            else:
                submission = db.execute('SELECT id,digest FROM type_submissions WHERE workspace=? ORDER BY rowid DESC LIMIT 1', (wid,)).fetchone()
                if not submission:
                    tables.fail('TYPE_REVIEW_NOT_SUBMITTED', f'{spec["name"]}尚未提交审核；整批未修改。')
                args = {'request_id': request, 'submission_id': submission['id'], 'specification_digest': submission['digest']}
                result = (service.types.approve(wid, Approval(**args, human_confirmed=True), actor, connection=db)
                          if body.action == 'approve' else service.types.publish(wid, Publish(**args), actor, connection=db))
            service._event(db, series_id, spec['id'], body.action, actor, {'note': body.note, 'version': spec['version'], 'receipt': result})
            items.append({'spec_id': spec['id'], 'name': spec['name'], 'workspace_id': wid,
                          'status': 'succeeded', 'message': '已通过原有型号审核门禁保存。', 'receipt': result})
        return items


def run_batch(service, series_id, body, actor):
    service.types._human(actor)
    request = body.model_dump(mode='json')
    if not body.environment_references:
        # Preserve the request identity of batches saved before this optional
        # reference lane existed, including idempotent replays after upgrading.
        request.pop('environment_references', None)
    request['series_id'] = series_id
    with service.lock, service.store.db(True) as db:
        replay = service._replay(db, body.request_id, request)
        if replay:
            return replay
        prior = db.execute('SELECT * FROM type_library_batches WHERE request=?', (str(body.request_id),)).fetchone()
        if prior:
            if prior['digest'] != fingerprint(request):
                tables.fail('LIBRARY_REQUEST_CONFLICT', '批量请求标识已经用于其他输入。', 409)
            return {**json.loads(prior['payload']), 'status': prior['status']}
        _, declaration = service._series(db, series_id)
        specs = [service._spec(db, identifier) for identifier in body.spec_ids]
        if any(str(item.workspace_id) not in {spec['workspace_id'] for spec in specs}
               for item in body.environment_references):
            tables.fail('ENVIRONMENT_TARGET_MISSING', '环境预览须对应本批所选型号，不能附带其他工程的引用。')
        if any(spec['series_id'] != series_id or spec['version'] != body.expected_versions[spec['id']]
               or spec['id'] in body.expected_revisions and spec['workspace_revision'] != body.expected_revisions[spec['id']]
               for spec in specs):
            tables.fail('TYPE_BATCH_STALE', '所选规格或保存版本已变化，整批未开始；请刷新后重选。', 409)
        batch_id = str(uuid4())
        result = {'id': batch_id, 'series_id': series_id, 'operation': body.operation, 'status': 'running', 'items': []}
        db.execute('INSERT INTO type_library_batches VALUES(?,?,?,?,?,?,?)',
                   (batch_id, series_id, str(body.request_id), fingerprint(request), 'running', encode(result), stamp()))
    if body.operation == 'review':
        try:
            result['items'] = _review(service, series_id, specs, body, actor)
        except HTTPException as error:
            result['items'] = [{'spec_id': spec['id'], 'name': spec['name'], **failure(error)} for spec in specs]
    else:
        entries = _entries(service, specs)
        preparations = {}
        if body.operation == 'check' and entries:
            try:
                documents = {spec['id']: service.store.snapshot(spec['workspace_id'])['domain']
                             for spec in specs if spec['id'] in entries}
                preparations = product.standard_check_batch(
                    {key: (entry, declaration['standards']) for key, entry in entries.items()},
                    prepare_only=True, documents=documents)
            except (CoreError, ValueError, HTTPException) as error:
                preparations = {key: {'error': failure(error)} for key in entries}
        for spec in specs:
            item = {'spec_id': spec['id'], 'name': spec['name'], 'workspace_id': spec['workspace_id']}
            try:
                if spec['id'] not in entries:
                    tables.fail('TYPE_DATA_INCOMPLETE', '结构或材料数据缺项，拒绝计算：' + '；'.join(spec['missing']))
                workspace = service.store.snapshot(spec['workspace_id'])
                if workspace['revision'] != spec['workspace_revision']:
                    tables.fail('TYPE_BATCH_STALE', '型号在批量处理期间已变化，该规格未运行。', 409)
                if body.operation == 'check':
                    prepared = preparations[spec['id']]
                    if prepared.get('error'):
                        tables.fail('TYPE_CHECK_REFUSED', prepared['error'].get('message', str(prepared['error'])))
                    plugin = service.research.registry('cablesim.standard-check').get('cablesim.standard-check')
                    definition = {'title': spec['name'][:90] + ' · 标准核对',
                        'method': {**service.research.pin(plugin), 'capability': 'dimensions'}, 'input_source': 'domain',
                        'parameters': prepared['parameters'], 'driver': {'kind': 'single'},
                        'input_sources': {'/parameters/basis_references': {'kind': 'standard', 'reviewed': False,
                            'reference': encode({'standards': declaration['standards'], 'basis_missing': prepared.get('basis_missing', []),
                                                 'undeclared_standards': prepared.get('undeclared_standards', [])})}}}
                else:
                    if not body.rows:
                        tables.fail('TYPE_RATING_CONDITIONS_MISSING', '请明确填写载流量工况；不自动补土壤、埋深或温度。')
                    required = {'depth_m', 'soil_rho_k_m_w', 'ambient_temperature_c', 'frequency_hz', 'bonding', 'source', 'layout', 'case_id', 'name'}
                    if any(not required <= set(row) or not str(row.get('source') or '').strip() for row in body.rows):
                        tables.fail('TYPE_RATING_CONDITIONS_MISSING', '每条工况须填写埋深、土壤热阻率、温度、频率、接地方式及出处。')
                    if not {'ks', 'kp', 'eddy', 'source'} <= set(body.parameters) or not str(body.parameters.get('source') or '').strip():
                        tables.fail('TYPE_RATING_PARAMETERS_MISSING', '须明确给出集肤/邻近系数、涡流损耗选择与依据。')
                    plugin = service.research.registry('cablesim.iec60287').get('cablesim.iec60287')
                    definition = table_definition(workspace, RatingTableDefinition(expected_revision=workspace['revision'],
                        rows=body.rows, parameters=body.parameters), {**service.research.pin(plugin), 'capability': 'steady-rating'})
                    if body.environment_references:
                        adopt_for_batch(ResourceData(service.research.executor), service.types.assets,
                            service.research, workspace, definition, body.environment_references)
                item.update(_run(service, spec, definition, child_request(body.request_id, spec['id'], body.operation)))
            except (HTTPException, ValidationError, CoreError, ValueError) as error:
                item.update(failure(error))
            result['items'].append(item)
            with service.store.db(True) as db:
                db.execute('UPDATE type_library_batches SET payload=? WHERE id=?', (encode(result), batch_id))
    good = sum(item['status'] in ('succeeded', 'completed') for item in result['items'])
    result['status'] = 'succeeded' if good == len(specs) else 'partial' if good else 'failed'
    with service.store.db(True) as db:
        db.execute('UPDATE type_library_batches SET status=?,payload=? WHERE id=?', (result['status'], encode(result), batch_id))
        service._remember(db, body.request_id, request, result)
        service._event(db, series_id, None, 'batch_' + body.operation, actor, {'id': batch_id, 'status': result['status'], 'request_id': str(body.request_id)})
    return result
