"""Compose saved type studies; equations and applicability remain in plugins."""
from uuid import uuid5

from fastapi import HTTPException
from ..plugin_host.registry import PluginHostError

from .contracts import CreateStudy, UpdateStudy, RunStudy
from .rating_conditions import RatingRow, RatingTableDefinition, table_definition
from .type_specification import CHANNELS, CHANNEL_NAMES
from .workspace import fingerprint


ORDER = ('geometry', 'electrical', 'rating', 'short_circuit', 'standards')


def rating_definition(definition):
    driver = definition.get('driver', {})
    return driver.get('kind') == 'batch' and bool(driver.get('cases')) and all(
        case.get('metadata', {}).get('kind') == 'type-rating-table' for case in driver['cases'])


def generation_gap(channel, item, release_exclusions=()):
    """A chapter needs actual declarations; uncovered rows still block publication."""
    if not item or item['run']['freshness'] != 'current' or item['run']['status'] != 'succeeded':
        return '尚无当前修订的完整运行。'
    artifact = item.get('artifact', {})
    if channel == 'geometry':
        mass_excluded = any(row.get('check_id') == 'geometry/mass' for row in release_exclusions)
        return None if artifact.get('outer_diameter_m') is not None and (artifact.get('mass_kg_per_km') is not None or mass_excluded) else '结构外径或用料缺少完整输入。'
    if channel == 'rating':
        rows = item.get('rows', [])
        failed = next((row for row in rows if row.get('value_a') is None), None)
        return failed.get('reason') or failed.get('status') if failed else None if rows else '没有已保存的载流量工况。'
    rows = artifact.get('rows', [])
    if channel == 'standards':
        return None if any(row.get('verdict') == 'passed' for row in rows) else '没有可声明满足的标准条款，请核对结构与标准输入。'
    missing = next((row for row in rows if row.get('status') == 'missing' and row.get('input_category')!='system'), None)
    if missing:
        return missing.get('title', '参数')+'：'+(missing.get('reason') or '缺少必需计算输入。')
    return None if any(row.get('status') == 'available' and row.get('value') is not None for row in rows) else '当前方法未提供可声明的计算值。'


def _supports(definition, channel, methods):
    if channel == 'rating':
        return rating_definition(definition)
    pin = definition['method']
    entry = next((entry for entry in methods if entry['method']['plugin_id'] == pin['plugin_id']), None)
    return bool(entry and any(cap['id'] == pin['capability'] and
        any(artifact['type'] == CHANNELS[channel] for artifact in cap.get('artifacts', []))
        for cap in entry['capabilities']))


def _study(service, wid, revision, channel, methods):
    studies = service.research.list_studies(wid)
    study = next((study for study in reversed(studies) if _supports(study['definition'], channel, methods)), None)
    if study:
        if channel == 'rating':
            definition = study['definition']
            state = service.store.snapshot(wid)
            if any(case['metadata'].get('type_revision') != revision or
                   case['metadata'].get('type_sha256') != fingerprint(state['domain']) for case in definition['driver']['cases']):
                body = RatingTableDefinition(expected_revision=revision,
                    rows=[RatingRow.model_validate({'rating_basis':definition['driver'].get('rating_basis','individual'),
                        **case['metadata']['condition']}) for case in definition['driver']['cases']],
                    parameters=definition['parameters'], selected_case_ids=definition['driver'].get('selected_case_ids'))
                updated = table_definition(state, body, definition['method'])
                study = service.research.save(wid, UpdateStudy(**updated, expected_revision=revision,
                    expected_study_revision=study['revision']), study['id'])
        return study
    state = service.store.snapshot(wid)
    declared = state.get('type_specification_conditions', {}).get(channel)
    if declared and channel in ('electrical', 'short_circuit', 'rating'):
        for entry in methods:
            for capability in entry['capabilities']:
                matches = capability.get('input_schema') == 'cablesim.domain/1' and any(
                    artifact['type'] == 'x-cablesim.iec60287-trace' for artifact in capability.get('artifacts', [])) if channel == 'rating' else any(
                    artifact['type'] == CHANNELS[channel] for artifact in capability.get('artifacts', []))
                if not matches or not entry['platform_supported'] or entry['execution_policy']['backend'] != 'local':
                    continue
                method = {**entry['method'], 'capability':capability['id']}
                if channel == 'rating':
                    definition = table_definition(state, RatingTableDefinition(expected_revision=revision, **declared), method)
                else:
                    parameters = {**declared, 'cable_type_id':state['domain']['cable_types'][0]['id']}
                    definition = {'title':CHANNEL_NAMES[channel], 'input_source':'domain', 'method':method, 'parameters':parameters,
                        'input_sources':{'/parameters':{'kind':'demo','reference':'型号版本中显式保存的规格书教学条件。','reviewed':False}}}
                return service.research.save(wid, CreateStudy(expected_revision=revision, **definition))
    if channel not in ('geometry', 'standards'):
        raise HTTPException(422, '请先保存'+CHANNEL_NAMES[channel]+'的方法条件；生成时会自动预检并计算。')
    with service.store.db() as db:
        _, state = service._type(db, wid, revision)
    for method in methods:
        if not method['platform_supported'] or method['execution_policy']['backend'] != 'local':
            continue
        for capability in method['capabilities']:
            if capability.get('input_schema') == 'cablesim.domain/1' and any(
                    artifact['type'] == CHANNELS[channel] for artifact in capability.get('artifacts', [])):
                return service.research.save(wid, CreateStudy(expected_revision=revision,
                    title=CHANNEL_NAMES[channel], input_source='domain',
                    method={**method['method'], 'capability':capability['id']},
                    parameters={'cable_type_id':state['domain']['cable_types'][0]['id']}))
    raise HTTPException(422, '没有可用于'+CHANNEL_NAMES[channel]+'的已安装本机方法。')


def generate(service, wid, body):
    from .verified_executor import verification_scope
    with verification_scope():
        return _generate(service,wid,body)


def _generate(service, wid, body):
    # Short, synchronous algebra calls retain each Run's existing idempotency.
    # A disconnected caller retries the same request; accepted runs are not repeated.
    if not service.generation_lock.acquire(blocking=False):
        raise HTTPException(409, '已有规格书正在生成，请稍后查询同一请求。')
    try:
        with service.store.db() as db:
            previous = service._replay(db, wid, body)
            if previous:
                return previous
            _, state = service._type(db, wid, body.expected_revision)
            service.store.assert_mutable(db, wid)
        methods = service.research.methods()
        steps = []
        for channel in ORDER:
            try:
                with service.store.db() as db:
                    service._type(db, wid, body.expected_revision)
                study = _study(service, wid, body.expected_revision, channel, methods)
                service.research.resolve(study['definition']['method'])
                _, _, channels, _ = service.evidence(wid)
                current = channels.get(channel)
                # Only declarations that match this revision and evidence are
                # projected by specification(); stale scope cannot waive inputs.
                exclusions = service.specification(wid)['payload']['release_exclusions'] if channel == 'geometry' else ()
                if current and current['run']['study'] == study['id'] and generation_gap(channel, current, exclusions) is None:
                    steps.append({'channel':channel, 'status':'reused', 'run_id':current['run']['id']})
                    continue
                method = study['definition']['method']
                if channel=='short_circuit' and not study['definition'].get('parameters',{}).get('basis_references'):
                    from .requirements import resolve_short_circuit_basis
                    resolved=resolve_short_circuit_basis(service.research,method,service.store.snapshot(wid)['domain'],study['definition']['parameters'])
                    definition={**study['definition'],'parameters':resolved['parameters']}
                    study=service.research.save(wid,UpdateStudy(**definition,expected_revision=body.expected_revision,expected_study_revision=study['revision']),study['id'])
                entry = next((entry for entry in methods if entry['method']['plugin_id'] == method['plugin_id']), None)
                if not entry or entry['execution_policy']['backend'] != 'local':
                    raise HTTPException(422, '此方法需要超算执行，请先在研究模块完成并保存结果。')
                checked = service.research.preflight(wid, study['id'], body.expected_revision, study['revision'])
                failed = next((case for case in checked['cases'] if case['status'] != 'succeeded'), None)
                if not checked['ready'] or checked['partial'] or failed:
                    raise HTTPException(422, (failed.get('error') or {}).get('message') if failed else '没有通过预检的工况。')
                run = service.research.execute(wid, study['id'], RunStudy(request_id=uuid5(body.request_id, channel),
                    expected_revision=body.expected_revision, expected_study_revision=study['revision'],
                    lock_digest=checked['lock_digest'], scope_acknowledged=body.scope_acknowledged),checked_preflight=checked)
                if run['status'] != 'succeeded' or run.get('integrity') != 'verified':
                    raise HTTPException(422, (run.get('error') or {}).get('message') or '运行没有完整成功，已保存诊断结果。')
                _, _, channels, _ = service.evidence(wid)
                exclusions = service.specification(wid)['payload']['release_exclusions'] if channel == 'geometry' else ()
                gap = generation_gap(channel, channels.get(channel), exclusions)
                if gap:
                    raise HTTPException(422, gap)
                steps.append({'channel':channel, 'status':'calculated', 'run_id':run['id']})
            except (HTTPException, PluginHostError, ValueError, OSError) as failure:
                detail = failure.detail if isinstance(failure, HTTPException) else str(failure)
                message = detail if isinstance(detail, str) else detail.get('message', '输入校验未通过。') if isinstance(detail, dict) else '输入校验未通过。'
                return {'status':'blocked', 'channel':channel, 'message':CHANNEL_NAMES[channel]+'：'+message,
                        'details':detail, 'steps':steps, 'revision':body.expected_revision}
        with service.store.db() as db:
            service._type(db, wid, body.expected_revision)
        spec = service.specification(wid, body.audience)
        result = {'status':'generated', 'revision':body.expected_revision, 'steps':steps,
                  'digest':spec['digest'], 'publication_ready':spec['ready']}
        with service.store.db(True) as db:
            service._type(db, wid, body.expected_revision)
            service._remember(db, wid, body, result)
        return result
    finally:
        service.generation_lock.release()
