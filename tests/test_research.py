"""Real plugin execution and transaction/provenance regression for saved studies."""
from copy import deepcopy
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.kernel.workspace import Edit
from test_plugin_host import SYNTHETIC_IEC


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / 'workspace.sqlite')) as c:
        from backend.plugin_host import Executor
        c.app.state.research.executor=Executor()
        yield c


def study(client, plugin='cablesim.iec60287', driver=None):
    from backend.domain.migration import convert
    from backend.schemas import Scenario
    from backend.kernel.scenarios import METHOD_DEFAULTS, system_models
    from backend.kernel.candidates import apply
    raw=Scenario().model_dump(mode='json');raw['cable']['r20_ohm_km']=.0754
    converted=convert(raw)
    model=system_models()[0]
    payload={**model['payload'],'name':model['name'],'version':model['version'],
             'sources':{'/cable_type':{'kind':'demo','reference':model['source'],'reviewed':False}}}
    document=apply(converted['document'],{'id':model['id'],'state':'demo','digest':model['content_sha256'],'payload':payload})
    document['circuits'][0]['bonding']['kind']='both_ends'
    w = client.post('/api/workspaces', json={}).json()
    item = next(m for m in client.get('/api/methods').json() if m['method']['plugin_id'] == plugin)
    payload = {'expected_revision': w['revision'], 'title': '合成研究',
               'method': {**item['method'], 'capability': 'steady-rating'},
               'input_source':'study', 'method_input':document,
               'parameters':deepcopy(METHOD_DEFAULTS[plugin])}
    if driver:
        driver=deepcopy(driver)
        for sample in driver.get('samples',[]):
            if '/input/installation/depth_m' in sample.get('changes',{}):
                value=sample['changes'].pop('/input/installation/depth_m')
                sample['changes'].update({f'/input/sections/0/placements/{i}/z':-value for i in range(3)})
            if '/input/operating_current_a' in sample.get('changes',{}):
                sample['changes']['/input/load_cases/0/currents/circuit~1c1']=sample['changes'].pop('/input/operating_current_a')
        payload['driver'] = driver
    response = client.post(f'/api/workspaces/{w["id"]}/studies', json=payload)
    assert response.status_code == 201, response.text
    return w, response.json()


def request(client, w, s):
    root = f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    pre = client.get(root + '/preflight', params={'expected_revision': w['revision'], 'expected_study_revision': s['revision']})
    assert pre.status_code == 200, pre.text
    return root, {'request_id': str(uuid4()), 'expected_revision': w['revision'],
                  'expected_study_revision': s['revision'], 'scope_acknowledged': True,
                  'lock_digest': pre.json()['lock_digest']}


def test_saved_study_lock_can_submit_without_get_preflight_and_still_checks_revision(client):
    w, s = study(client)
    root = f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    body = {'request_id': str(uuid4()), 'expected_revision': w['revision'],
            'expected_study_revision': s['revision'], 'scope_acknowledged': True,
            'lock_digest': s['lock']['digest']}
    run = client.post(root + '/runs', json=body)
    assert run.status_code == 200, run.text
    assert run.json()['integrity'] == 'verified'
    assert run.json()['output']['preflight']['ready'] is True
    edited = client.post(f'/api/workspaces/{w["id"]}/edit', json={
        'expected_revision': w['revision'], 'changes': [{'path': 'installation.depth_m', 'value': 1.1}]})
    assert edited.status_code == 200
    body.update(request_id=str(uuid4()), expected_revision=edited.json()['revision'])
    rejected = client.post(root + '/runs', json=body)
    assert rejected.status_code == 409
    assert len(client.get(root + '/runs').json()['items']) == 1


@pytest.mark.parametrize('plugin', ['cablesim.thermal-network', 'cablesim.iec60287'])
def test_saved_execution_replay_and_report(client, plugin, monkeypatch):
    w, s = study(client, plugin)
    root, body = request(client, w, s)
    run = client.post(root + '/runs', json=body)
    assert run.status_code == 200, run.text
    run = run.json()
    assert run['status'] == 'succeeded', run
    assert run['integrity'] == 'verified'
    assert run['output']['cases'][0]['results'][0]['key'] == 'ampacity'
    def forbidden(*a, **kw):
        raise AssertionError('replay/report must never solve')
    monkeypatch.setattr(client.app.state.research.executor, 'run', forbidden)
    assert client.post(root + '/runs', json=body).json()['id'] == run['id']
    client.post(f'/api/workspaces/{w["id"]}/edit', json={'expected_revision': 1, 'changes': [{'path': 'installation.depth_m', 'value': 1.0}]})
    assert client.post(root + '/runs', json=body).json()['freshness'] == 'historical'
    report = client.post(f'/api/workspaces/{w["id"]}/deliveries', json={'run_ids': [run['id']]})
    assert report.status_code == 201, report.text
    assert run['id'] in report.json()['html']
    from backend.kernel.report import RENDERER
    assert report.json()['renderer'] == RENDERER
    assert '>case-0 · rating</td>' in report.json()['html']
    if plugin == 'cablesim.thermal-network':
        assert '>case-0 · operating</td>' in report.json()['html']
    saved = client.get(f'/api/workspaces/{w["id"]}/deliveries/{report.json()["id"]}')
    assert saved.status_code == 200 and saved.json()['digest'] == report.json()['digest']
    research = client.app.state.research
    delivery_id = uuid4()
    assert research.deliver(w['id'], [run['id']], delivery_id) == research.deliver(w['id'], [run['id']], delivery_id)
    assert client.post(root + '/runs', json={**body, 'expected_revision': 2}).status_code == 409


def test_edits_during_execution_do_not_rebind_input(client, monkeypatch):
    w, s = study(client)
    root, body = request(client, w, s)
    executor = client.app.state.research.executor
    original = executor.run
    def changing(*args, **kwargs):
        if kwargs.get('phase') != 'check':
            client.app.state.workspace_store.edit(w['id'], Edit(expected_revision=1, changes=[{'path': 'installation.depth_m', 'value': 1.1}]))
        return original(*args, **kwargs)
    monkeypatch.setattr(executor, 'run', changing)
    run = client.post(root + '/runs', json=body).json()
    assert run['status'] == 'succeeded', run
    assert run['freshness'] == 'historical'
    assert run['snapshot']['cases'][0]['input']['sections'][0]['placements'][0]['z'] == -.8


def test_input_sources_are_pinned_with_the_run_and_report(client):
    w, s = study(client, 'cablesim.iec60287')
    root, _ = request(client, w, s)
    original = {'/method_input': {'kind': 'demo', 'reference': 'public synthetic input sha256:example', 'reviewed': False}}
    payload = {**s['definition'], 'task': 'rating', 'input_sources': original, 'expected_revision': w['revision'], 'expected_study_revision': s['revision']}
    response = client.put(root, json=payload)
    assert response.status_code == 200, response.text
    s = response.json()
    root, body = request(client, w, s)
    run = client.post(root + '/runs', json=body).json()
    assert run['status'] == 'succeeded'
    assert run['snapshot']['definition']['input_sources'] == original
    assert run['snapshot']['definition']['task'] == 'rating'
    payload.update(expected_study_revision=s['revision'], task='operating', input_sources={'/method_input': {'kind': 'user', 'reference': 'later input', 'reviewed': False}})
    assert client.put(root, json=payload).status_code == 200
    historic = client.get(root + '/runs/' + run['id']).json()
    assert historic['freshness'] == 'historical'
    assert historic['snapshot']['definition']['input_sources'] == original
    assert historic['snapshot']['definition']['task'] == 'rating'
    report = client.post(f'/api/workspaces/{w["id"]}/deliveries', json={'run_ids': [run['id']]}).json()
    assert 'public synthetic input sha256:example' in report['html']
    assert 'later input' not in report['html']
    assert 'ac_resistance' in report['html']
    assert 'losses.sheath' in report['html']


@pytest.mark.parametrize('basis,condition', [('individual','rating'), ('simultaneous','rating-simultaneous')])
def test_sweep_rating_basis_is_executed_and_reported(client, basis, condition):
    w, s = study(client, driver={'kind':'sweep', 'rating_basis':basis,
                                'samples':[{'label':'saved input','changes':{}}]})
    root, body = request(client, w, s)
    response = client.post(root+'/runs', json=body)
    assert response.status_code == 200, response.text
    run = response.json()
    assert run['status'] == 'succeeded', run
    if basis == 'simultaneous':
        assert run['snapshot']['cases'][0]['parameters']['rating_mode'] == 'both'
    quantity = next(q for q in run['output']['cases'][0]['results'] if q['key']=='ampacity' and q['case']==condition)
    assert quantity['rating_basis']['kind']=='single_circuit'
    assert quantity['rating_basis']['fixed_currents_a']=={}
    assert run['output']['default_result']['case']==condition
    from backend.kernel.report import task_answer, formatted
    answer = task_answer(run)
    assert 'data-section="sweep-basis"' in answer
    assert formatted(quantity['value'], 3) in answer
    assert condition in answer


def test_new_sweep_defaults_to_common_capacity_but_retains_explicit_choice():
    from backend.kernel.contracts import Driver
    args={'kind':'sweep','samples':[{'label':'one','changes':{}}]}
    assert Driver(**args).rating_basis=='simultaneous'
    assert Driver(**args,rating_basis='individual').rating_basis=='individual'


def test_typed_run_response_preserves_saved_result_bytes():
    from backend.kernel.responses import RunOutput
    from backend.kernel.batch_files import digest
    saved={'cases':[{'case_id':'case-0','status':'succeeded','results':[
        {'key':'ampacity','type':'quantity','entity':'circuit/c1','unit':'A','status':'unavailable','reason':{'code':'test','message':'test'}}],
        'artifacts':{}}]}
    assert digest(RunOutput.model_validate(saved).model_dump(mode='json',exclude_unset=True))==digest(saved)


def test_sweep_retains_failed_samples(client, monkeypatch):
    driver = {'kind': 'sweep', 'samples': [{'label': 'good', 'changes': {'/input/installation/depth_m': 1}},
                                          {'label': 'bad', 'changes': {'/input/installation/depth_m': -1}}]}
    w, s = study(client, driver=driver)
    root, body = request(client, w, s)
    executor = client.app.state.research.executor
    original = executor.run
    solved = []
    def recorded(plugin, capability, cases, **kwargs):
        if kwargs.get('phase') != 'check':
            solved.extend(c['case_id'] for c in cases)
        return original(plugin, capability, cases, **kwargs)
    monkeypatch.setattr(executor, 'run', recorded)
    run = client.post(root + '/runs', json=body).json()
    assert run['status'] == 'partial', run
    assert [c['status'] for c in run['output']['cases']] == ['succeeded', 'failed']
    assert solved == ['case-0']
    assert run['output']['cases'][1]['evidence']['stage'] == 'preflight'


@pytest.mark.parametrize('kind', ['sweep', 'selection'])
def test_all_failed_batch_preflight_never_starts_run(client, kind):
    w, s = study(client, driver={'kind': kind, 'minimum': 500, 'samples': [{'label': 'bad', 'changes': {'/input/installation/depth_m': -1}}]})
    root, body = request(client, w, s)
    pre = client.get(root + '/preflight', params={'expected_revision': 1, 'expected_study_revision': 1}).json()
    assert pre['ready'] is False and pre['runnable_case_ids'] == []
    assert client.post(root + '/runs', json=body).status_code == 422
    assert client.get(root + '/runs').json()['items'] == []


def test_failed_crosscheck_blocks_preflight(client):
    w, s = study(client)
    root = f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    iec = next(m for m in client.get('/api/methods').json() if m['method']['plugin_id'] == 'cablesim.iec60287')
    definition = {**s['definition'], 'expected_revision': 1, 'expected_study_revision': 1,
                  'driver': {'kind': 'crosscheck'},
                  'crosschecks': [{'method': {**iec['method'], 'capability': 'steady-rating'}, 'parameters': {}}]}
    response = client.put(root, json=definition)
    assert response.status_code == 200, response.text
    root, body = request(client, w, response.json())
    rejected = client.post(root + '/runs', json=body)
    assert rejected.status_code == 422, rejected.text
    assert rejected.json()['detail']['crosschecks'][0]['case_id'] == 'crosscheck-1-case-0'


def test_crosscheck_cannot_override_locked_domain_parameters(client, monkeypatch):
    from backend.schemas import Scenario
    scenario = Scenario().model_dump(mode='json')
    scenario['cable']['r20_ohm_km'] = .0754
    w = client.post('/api/workspaces', json={'scenario': scenario}).json()
    workspace = f'/api/workspaces/{w["id"]}'
    converted = client.post(workspace + '/domain/conversion', json={'expected_revision': 1}).json()
    locked = client.post(workspace + '/lock', json={'expected_revision': 2,
                         'path': 'cable.screen_loss_factor', 'locked': True})
    assert locked.status_code == 200, locked.text
    method = next(m['method'] for m in client.get('/api/methods').json()
                  if m['method']['plugin_id'] == 'cablesim.thermal-network')
    method = {**method, 'capability': 'steady-rating'}
    parameters = converted['conversion']['method_parameters']
    saved = client.post(workspace + '/studies', json={'expected_revision': 3, 'title': '锁定参数交叉校核',
                        'input_source': 'domain', 'method': method, 'parameters': parameters,
                        'driver': {'kind': 'crosscheck'},
                        'crosschecks': [{'method': method, 'parameters': {**parameters, 'screen_loss_factor': .15}}]})
    assert saved.status_code == 201, saved.text
    root = workspace + '/studies/' + saved.json()['id']
    executor = client.app.state.research.executor
    original, calls = executor.check, []
    def checked(*args, **kwargs):
        calls.append(args[0])
        return original(*args, **kwargs)
    monkeypatch.setattr(executor, 'check', checked)
    pre = client.get(root + '/preflight', params={'expected_revision': 3, 'expected_study_revision': 1})
    assert pre.status_code == 422 and 'cable.screen_loss_factor' in pre.text, pre.text
    run = client.post(root + '/runs', json={'request_id': str(uuid4()), 'expected_revision': 3,
                      'expected_study_revision': 1, 'scope_acknowledged': True, 'lock_digest': '0' * 64})
    assert run.status_code == 422 and calls == [], run.text
    assert client.get(root + '/runs').json()['items'] == []
    unlocked = client.post(workspace + '/lock', json={'expected_revision': 3,
                           'path': 'cable.screen_loss_factor', 'locked': False})
    assert unlocked.status_code == 200, unlocked.text
    pre = client.get(root + '/preflight', params={'expected_revision': 4, 'expected_study_revision': 1})
    assert pre.status_code == 200 and pre.json()['ready'], pre.text


def test_read_page_verifies_each_plugin_once_but_next_request_rechecks(client, monkeypatch):
    from backend.plugin_host.registry import Plugin
    w, s = study(client)
    root, body = request(client, w, s)
    for _ in range(3):
        body['request_id'] = str(uuid4())
        assert client.post(root + '/runs', json=body).json()['status'] == 'succeeded'
    original = Plugin.verify
    calls = []
    def counted(plugin):
        calls.append(plugin.manifest.id)
        return original(plugin)
    monkeypatch.setattr(Plugin, 'verify', counted)
    assert len(client.get(root + '/runs').json()['items']) == 3
    assert calls == ['cablesim.iec60287']
    client.get(root + '/runs')
    assert len(calls) == 2


def test_converted_project_sweeps_unlocked_facts_and_rejects_locked_temperature(client):
    from backend.schemas import Scenario
    scenario = Scenario().model_dump(mode='json')
    scenario['cable']['r20_ohm_km'] = .0754
    w = client.post('/api/workspaces', json={'scenario': scenario}).json()
    workspace_root = f'/api/workspaces/{w["id"]}'
    domain = client.post(workspace_root + '/domain/conversion', json={'expected_revision': 1}).json()
    method = next(m['method'] for m in client.get('/api/methods').json() if m['method']['plugin_id'] == 'cablesim.thermal-network')
    soil_index = next(i for i, m in enumerate(domain['document']['materials']) if m['id'] == 'material/soil')
    definition = {'expected_revision': 2, 'title': '领域土壤扫描', 'input_source': 'domain',
                  'method': {**method, 'capability': 'steady-rating'}, 'parameters': domain['conversion']['method_parameters'],
                  'driver': {'kind': 'sweep', 'samples': [{'label': 'soil', 'changes': {f'/input/materials/{soil_index}/thermal_resistivity': 1.5}}]}}
    saved = client.post(workspace_root + '/studies', json=definition)
    assert saved.status_code == 201, saved.text
    root, body = request(client, {**w, 'revision': 2}, saved.json())
    response=client.post(root+'/runs',json=body)
    assert response.status_code==200,response.text
    run=response.json()
    assert run['status'] == 'succeeded', run
    assert client.get(workspace_root + '/domain').json()['document'] == domain['document']
    definition['driver']['samples'][0]['changes'] = {'/input/criteria/max_conductor_temperature': 370}
    updated = client.put(root, json={**definition, 'expected_study_revision': 1})
    assert updated.status_code == 200, updated.text
    assert client.get(root + '/preflight', params={'expected_revision': 2, 'expected_study_revision': 2}).status_code == 422


def test_invalid_domain_sample_is_retained_and_never_sent_to_the_plugin(client, monkeypatch):
    from backend.domain.migration import convert
    from backend.schemas import Scenario
    s = Scenario().model_dump(mode='json')
    s['cable']['r20_ohm_km'] = .0754
    conversion = convert(s)
    w, saved = study(client,'cablesim.thermal-network')
    root = f'/api/workspaces/{w["id"]}/studies/{saved["id"]}'
    definition = {**saved['definition'], 'expected_revision': 1, 'expected_study_revision': 1,
                  'input_source': 'study', 'method_input': conversion['document'], 'parameters': conversion['method_parameters'],
                  'driver': {'kind': 'sweep', 'samples': [
                      {'label': 'valid', 'changes': {}},
                      {'label': 'invalid enclosure', 'changes': {'/input/sections/0/length': -1}}]}}
    saved = client.put(root, json=definition).json()
    executor = client.app.state.research.executor
    original = executor.run
    def only_valid(plugin, capability, cases, **kw):
        assert [c['case_id'] for c in cases] == ['case-0']
        return original(plugin, capability, cases, **kw)
    monkeypatch.setattr(executor, 'run', only_valid)
    root, body = request(client, w, saved)
    response=client.post(root+'/runs',json=body)
    assert response.status_code==200,response.text
    run=response.json()
    assert run['status'] == 'partial', run
    bad = run['output']['cases'][1]
    assert bad['error']['code'] == 'DOMAIN_INVALID' and not bad['results']


def test_revision_archive_survives_undo_branch(client):
    w = client.post('/api/workspaces', json={}).json()
    root = f'/api/workspaces/{w["id"]}'
    assert client.post(root + '/edit', json={'expected_revision': 1, 'changes': [{'path': 'installation.depth_m', 'value': 1}]}).status_code == 200
    assert client.post(root + '/history/undo', json={'expected_revision': 2}).status_code == 200
    assert client.post(root + '/edit', json={'expected_revision': 3, 'changes': [{'path': 'installation.depth_m', 'value': 1.2}]}).status_code == 200
    assert client.get(root + '/revisions/2').json()['state']['scenario']['installation']['depth_m'] == 1
    assert [r['revision'] for r in client.get(root + '/revisions').json()] == [1, 2, 3, 4]


def test_corrupt_result_blocks_delivery_and_cross_project_access(client):
    w, s = study(client)
    root, body = request(client, w, s)
    run = client.post(root + '/runs', json=body).json()
    with client.app.state.workspace_store.db(True) as db:
        db.execute('UPDATE study_runs SET output_digest=? WHERE id=?', ('0' * 64, run['id']))
    assert client.get(root + '/runs/' + run['id']).json()['integrity'] == 'corrupt'
    assert client.post(f'/api/workspaces/{w["id"]}/deliveries', json={'run_ids': [run['id']]}).status_code == 409
    other = client.post('/api/workspaces', json={}).json()
    assert client.get(f'/api/workspaces/{other["id"]}/studies/{s["id"]}/runs/{run["id"]}').status_code == 404


def test_saved_selection_respects_requested_temperature_condition(client):
    driver = {'kind': 'selection', 'samples': [{'label': 'current', 'changes': {}}], 'minimum': 330,
              'target_key': 'conductor_temperature', 'target_entity': 'cable/c1-A',
              'target_unit': 'K', 'target_condition': 'operating'}
    w, s = study(client, driver=driver)
    root, body = request(client, w, s)
    run = client.post(root + '/runs', json=body).json()
    assert run['status'] == 'succeeded', run
    temperatures = [r for r in run['output']['cases'][0]['results']
                    if r['key'] == 'conductor_temperature' and r['entity'] == 'cable/c1-A']
    assert {r['case'] for r in temperatures} == {'operating'}
    expected = next(r['value'] for r in temperatures if r['case'] == 'operating')
    assert run['output']['assessment'] == [{'case_id': 'case-0', 'value': expected,
                                          'meets_target': expected >= 330, 'reason': None}]
    assert run['snapshot']['definition']['driver']['target_condition'] == 'operating'
    changed = client.put(root, json={**s['definition'], 'expected_revision': 1, 'expected_study_revision': 1,
                                    'driver': {**driver, 'target_condition': 'rating'}})
    assert changed.status_code == 200, changed.text
    root, body = request(client, w, changed.json())
    rating = client.post(root + '/runs', json=body).json()['output']['assessment'][0]
    assert rating['value'] is None and rating['meets_target'] is None
    assert rating['reason']['code'] == 'TARGET_MISSING'


def test_selection_preserves_the_unstable_operating_point_reason(client):
    driver = {'kind': 'selection', 'samples': [{'label': 'hot', 'changes': {'/input/operating_current_a': 3000}}],
              'minimum': 330, 'target_key': 'conductor_temperature', 'target_entity': 'cable/c1-A',
              'target_unit': 'K', 'target_condition': 'operating'}
    w, s = study(client, driver=driver)
    root, body = request(client, w, s)
    run = client.post(root + '/runs', json=body).json()
    assert run['status'] == 'failed', run
    assessed = run['output']['assessment'][0]
    assert assessed['value'] is None and assessed['meets_target'] is None
    assert assessed['reason'] == run['output']['cases'][0]['error']


@pytest.mark.parametrize('condition,unavailable,failed,code', [
    (None, False, False, 'TARGET_AMBIGUOUS'), (None, True, False, 'TARGET_AMBIGUOUS'),
    ('emergency', False, False, 'TARGET_MISSING'), ('rating', True, False, 'MODEL_LIMIT'),
    ('rating', False, True, 'SOLVER_FAILED')])
def test_selection_unknown_is_explained_and_never_treated_as_a_value(condition, unavailable, failed, code):
    from backend.kernel.contracts import Driver
    from backend.kernel.drivers import assess
    driver = Driver(kind='selection', samples=[{'label': 'a'}], minimum=350,
                    target_key='conductor_temperature', target_entity='cable/c1-A',
                    target_unit='K', target_condition=condition).model_dump(mode='json')
    results = [{'key': 'conductor_temperature', 'type': 'quantity', 'entity': 'cable/c1-A',
                'case': c, 'unit': 'K', 'status': 'available', 'value': v}
               for c, v in [('operating', 300), ('rating', 363.15)]]
    if unavailable:
        results[1].pop('value')
        results[1].update(status='unavailable', reason={'code': 'MODEL_LIMIT', 'message': 'outside scope'})
    case = {'case_id': 'case-0', 'status': 'failed' if failed else 'succeeded', 'results': results,
            'error': {'code': 'SOLVER_FAILED', 'message': 'did not converge'} if failed else None}
    assessed = assess({'driver': driver}, [case])[0]
    assert assessed['value'] is None and assessed['meets_target'] is None
    assert assessed['reason']['code'] == code


def test_version_conflict_and_numeric_only_sweep(client):
    w, s = study(client)
    root, body = request(client, w, s)
    update = {**s['definition'], 'expected_revision': 1, 'expected_study_revision': 1, 'title': 'changed'}
    assert client.put(root, json=update).status_code == 200
    assert client.put(root, json=update).status_code == 409
    assert client.post(root + '/runs', json=body).status_code == 409


@pytest.mark.parametrize('status', ['accepted', 'running', 'validating'])
def test_restart_marks_incomplete_run_interrupted_without_reexecution(client, monkeypatch, status):
    from backend.kernel.research import Research
    w, s = study(client)
    root, body = request(client, w, s)
    run = client.post(root + '/runs', json=body).json()
    with client.app.state.workspace_store.db(True) as db:
        db.execute('UPDATE study_runs SET status=?,output=NULL,output_digest=NULL WHERE id=?', (status, run['id']))
    previous = client.app.state.research
    restarted = Research(previous.store, previous.executor)
    restarted.initialize()
    first = restarted.get_run(w['id'], run['id'])
    restarted.initialize()
    assert restarted.get_run(w['id'], run['id']) == first
    monkeypatch.setattr(previous.executor, 'run', lambda *a, **kw: pytest.fail('restart must not recompute'))
    replay = client.post(root + '/runs', json=body).json()
    assert replay['id'] == run['id'] and replay['status'] == 'interrupted'


def test_reinitialization_does_not_interrupt_the_current_owner(client):
    w, s = study(client)
    root, body = request(client, w, s)
    run = client.post(root + '/runs', json=body).json()
    research = client.app.state.research
    with research.store.db(True) as db:
        db.execute("UPDATE study_runs SET status='running',output=NULL,output_digest=NULL WHERE id=?", (run['id'],))
    research.initialize()
    assert research.get_run(w['id'], run['id'])['status'] == 'running'


@pytest.mark.parametrize('fails', [False, True])
def test_late_completion_cannot_overwrite_an_interrupted_run(client, monkeypatch, fails):
    from backend.plugin_host import PluginHostError
    w, s = study(client)
    root, body = request(client, w, s)
    research = client.app.state.research
    original = research.executor.run
    def interrupted(*args, **kw):
        result = original(*args, **kw)
        if kw.get('phase') != 'check':
            with research.store.db(True) as db:
                db.execute("UPDATE study_runs SET status='interrupted',error=? WHERE request_id=?",
                           ('{"code":"HOST_RESTART","message":"old execution"}', body['request_id']))
            if fails:
                raise PluginHostError('PLUGIN_CRASHED', 'late failure')
        return result
    monkeypatch.setattr(research.executor, 'run', interrupted)
    run = client.post(root + '/runs', json=body).json()
    assert run['status'] == 'interrupted' and run['error']['code'] == 'HOST_RESTART'
    assert run['output'] is None


@pytest.mark.parametrize('fault', ['missing', 'invalid', 'tampered'])
def test_history_and_delivery_survive_an_unavailable_method(client, tmp_path, monkeypatch, fault):
    import shutil
    from backend.plugin_host.registry import Registry
    w, s = study(client)
    root, body = request(client, w, s)
    run = client.post(root + '/runs', json=body).json()
    plugins = tmp_path / 'unavailable-plugins'
    plugins.mkdir()
    if fault != 'missing':
        source = Registry().get('cablesim.thermal-network').directory
        target = plugins / source.name
        shutil.copytree(source, target)
        if fault == 'invalid':
            (target / 'plugin.json').write_text('{', 'utf-8')
        else:
            (target / 'src/cablesim_thermal_network/main.py').write_text('raise RuntimeError()', 'utf-8')
    research = client.app.state.research
    research.executor.registry.root = plugins
    monkeypatch.setattr(research.executor, 'run', lambda *a, **kw: pytest.fail('history must not recompute'))
    history = client.get(root + '/runs/' + run['id'], params={'view': 'full'})
    assert history.status_code == 200, history.text
    history = history.json()
    assert history['integrity'] == 'verified' and history['output'] == run['output']
    assert history['method_availability']['status'] == 'unavailable'
    assert history['method_availability']['error']['code']
    assert client.post(root + '/runs', json=body).json()['id'] == run['id']
    assert client.get(root + '/runs').json()['items'][0]['id'] == run['id']
    report = client.post(f'/api/workspaces/{w["id"]}/deliveries', json={'run_ids': [run['id']]})
    assert report.status_code == 201 and run['id'] in report.json()['html']


def test_restart_can_read_saved_results_with_a_broken_method_directory(tmp_path, monkeypatch):
    import backend.plugin_host.executor as executor_module
    from backend.plugin_host.registry import Registry
    from backend.plugin_host.manifest import Manifest
    database = tmp_path / 'workspace.sqlite'
    with TestClient(create_app(database)) as original:
        w, s = study(original)
        root, body = request(original, w, s)
        run = original.post(root + '/runs', json=body).json()
    plugins = tmp_path / 'broken-plugins'
    package = plugins / 'cablesim.thermal-network'
    package.mkdir(parents=True)
    (package / 'plugin.json').write_text('{', 'utf-8')
    monkeypatch.setattr(executor_module, 'Registry', lambda root=plugins, **kw: Registry(root, **kw))
    def invalid_manifest(*a, **kw):
        raise ValueError('broken method manifest')
    monkeypatch.setattr(Manifest, 'model_validate', invalid_manifest)
    with TestClient(create_app(database)) as restarted:
        history = restarted.get(root + '/runs/' + run['id'], params={'view': 'full'})
        assert history.status_code == 200, history.text
        assert history.json()['output'] == run['output']
        assert history.json()['method_availability']['status'] == 'unavailable'
        delivery = restarted.post(f'/api/workspaces/{w["id"]}/deliveries', json={'run_ids': [run['id']]})
        assert delivery.status_code == 201, delivery.text


def test_owner_lock_rejects_second_host(tmp_path):
    from backend.kernel.ownership import OwnerLock
    first, second = OwnerLock(tmp_path / 'db'), OwnerLock(tmp_path / 'db')
    first.acquire()
    try:
        with pytest.raises(RuntimeError):
            second.acquire()
    finally:
        first.close()
    second.acquire()
    second.close()


def test_bad_pointer_is_a_client_error_and_acknowledgement_is_explicit(client):
    w, s = study(client, driver={'kind': 'sweep', 'samples': [{'label': 'bad', 'changes': {'/input/missing': 1}}]})
    root = f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    assert client.get(root + '/preflight', params={'expected_revision': 1, 'expected_study_revision': 1}).status_code == 422
    from backend.kernel.contracts import RunStudy
    with pytest.raises(ValueError):
        RunStudy(request_id=uuid4(), expected_revision=1, expected_study_revision=1,
                 lock_digest='0'*64, scope_acknowledged=1)


@pytest.mark.parametrize('path', ['/input/values/-1', '/input/values/01', '/input/values/+1',
                                 '/input/values/ 1', '/input/bad~2/amount'])
def test_sweep_pointer_rejects_nonstandard_array_indices_and_escapes(path):
    from backend.kernel.drivers import replace_number
    case = {'input': {'values': [10, 20], 'bad~2': {'amount': 1}}}
    original = deepcopy(case)
    with pytest.raises(ValueError):
        replace_number(case, path, 99)
    assert case == original


def test_sweep_pointer_handles_standard_indices_and_escaped_keys():
    from backend.kernel.drivers import replace_number
    case = {'input': {'a/b~c': [10, 20]}}
    replace_number(case, '/input/a~1b~0c/0', 15)
    assert case == {'input': {'a/b~c': [15, 20]}}


def test_comparison_does_not_mix_rating_and_operating_temperatures():
    from backend.kernel.drivers import crosscheck_differences
    def result(condition):
        return {'key': 'conductor_temperature', 'type': 'quantity', 'case': condition,
                'entity': 'cable/c1-A', 'unit': 'K', 'value': 363.15, 'status': 'available'}
    cases = [{'case_id': 'case-0', 'status': 'succeeded', 'results': [result('operating')]},
             {'case_id': 'crosscheck-1-case-0', 'method': {}, 'status': 'succeeded', 'results': [result('rating')]}]
    assert crosscheck_differences(cases)['quantities'] == []
    cases[1]['results'][0]['case'] = 'operating'
    assert crosscheck_differences(cases)['quantities'][0]['difference'] == 0


def test_comparison_input_equality_excludes_run_and_study_identity():
    from backend.kernel.drivers import compare
    first = {'id': 'a', 'snapshot': {'cases': [{'input': {'x': 1}, 'parameters': {}}],
                                    'definition': {'method': 'method-a'}}, 'output': {'cases': []}}
    second = deepcopy(first)
    second['id'] = 'b'
    second['snapshot']['definition']['method'] = 'method-b'
    result = compare([first, second])['differences'][0]
    assert result['same_input'] and not result['same_method']


def test_comparison_includes_crosscheck_methods_and_parameters():
    from backend.kernel.drivers import compare
    first = {'id': 'a', 'snapshot': {'cases': [{'input': {'x': 1}, 'parameters': {}}],
             'definition': {'method': 'main', 'crosschecks': [{'method': 'reference-a', 'parameters': {'resolution': 16}}]}},
             'output': {'cases': []}}
    second = deepcopy(first)
    second['id'] = 'b'
    second['snapshot']['definition']['crosschecks'][0]['method'] = 'reference-b'
    result = compare([first, second])['differences'][0]
    assert result['same_input'] and result['same_parameters'] and not result['same_method']
    second['snapshot']['definition']['crosschecks'][0].update(method='reference-a', parameters={'resolution': 32})
    result = compare([first, second])['differences'][0]
    assert result['same_method'] and not result['same_parameters']
