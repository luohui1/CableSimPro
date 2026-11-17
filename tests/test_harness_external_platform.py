"""Existing local methods, rating-table approval and bounded resource reads."""
from copy import deepcopy
import os

import pytest

from backend.domain.migration import convert
from backend.foundation.contracts import AssetParameter, AssetRelease, Quantity, SourceReference
from backend.schemas import Scenario
from test_gb50217_correction import example as correction_example
from test_harness_external import AUTH, client, call, open_session
from test_harness_external_actions import counts, decide, propose, resume
from test_type_rating import PARAMETERS, type_workspace


def method(client, plugin, capability):
    entry = next(row for row in client.get('/api/methods').json() if row['method']['plugin_id'] == plugin)
    return {**entry['method'], 'capability': capability}


def saved_study(client, plugin, capability, document, parameters):
    workspace = client.post('/api/workspaces', json={}).json()
    response = client.post('/api/workspaces/' + workspace['id'] + '/studies', json={
        'expected_revision': workspace['revision'], 'title': '明确标记的接口验收研究',
        'method': method(client, plugin, capability), 'input_source': 'study',
        'method_input': document, 'parameters': parameters,
    })
    assert response.status_code == 201, response.text
    return workspace, response.json()


def execute(client, workspace, study):
    scope = open_session(client, workspace)
    before = counts(client)
    proposal = propose(client, scope, 'propose_study_run', {'study_id': study['id']})
    assert counts(client) == before, 'a run proposal cannot create a saved run'
    decision = decide(client, proposal)
    assert decide(client, proposal) == decision
    return decision, scope


def test_gb50217_local_formal_method_runs_only_after_acceptance(client):
    document, parameters = correction_example(count=3, ambient=303.15)
    workspace, study = saved_study(client, 'cablesim.gb50217-correction', 'steady-rating', document, parameters)
    _, capability = client.app.state.research.resolve(study['definition']['method'])
    assert capability.solver == 'local' and not capability.preview
    decision, scope = execute(client, workspace, study)
    assert decision['receipt']['status'] == 'succeeded', decision
    run = client.app.state.research.get_run(workspace['id'], decision['receipt']['run_id'])
    trace = run['output']['cases'][0]['artifacts']['x-cablesim.gb50217-correction']
    assert trace['corrected_current_a'] == pytest.approx(326.4)
    assert run['integrity'] == 'verified'
    scope = resume(client, scope)
    export = propose(client, scope, 'propose_delivery', {'run_ids': [run['id']]})
    delivery = decide(client, export)['receipt']
    html = client.get(delivery['download_url']).text
    assert '326.4' in html and 'GB 50217' in html


def test_gb50217_unconfirmed_baseline_refuses_without_a_run(client):
    document, parameters = correction_example()
    parameters['baseline_reviewed'] = False
    workspace, study = saved_study(client, 'cablesim.gb50217-correction', 'steady-rating', document, parameters)
    before = counts(client)
    decision, _ = execute(client, workspace, study)
    assert decision['receipt']['status'] == 'failed' and decision['receipt']['executed'] is False
    assert counts(client) == before
    assert '基准' in decision['receipt']['error']['message']


def test_study_proposal_discloses_confirmation_source_and_unitless_parameters_before_acceptance(client):
    document, parameters = correction_example()
    workspace, original = saved_study(client, 'cablesim.gb50217-correction', 'steady-rating', document, parameters)
    scope = open_session(client, workspace)
    before = counts(client)
    pending = propose(client, scope, 'propose_study', {'title': '审阅真实基准和确认', 'source_study_id': original['id']})
    assert counts(client) == before
    points = {point['path']: point for point in pending['changes']}
    _, capability = client.app.state.research.resolve(original['definition']['method'])
    fields = capability.parameter_schema.model_dump(mode='json', by_alias=True, exclude_none=True)['properties']
    for key in ('baseline_reviewed', 'baseline_source', 'baseline_sha256', 'baseline_page', 'basis_release_digest'):
        point = points['/parameters/' + key]
        assert point['after'] == parameters[key] and type(point['after']) is type(parameters[key])
        assert point['label'] == fields[key]['title'] and point['unit'] is None
    kind = points['/parameters/baseline_kind']
    assert kind['after'] == fields['baseline_kind']['x-enum-labels'][parameters['baseline_kind']]
    assert kind['label'] == fields['baseline_kind']['title'] and kind['unit'] is None
    assert points['/parameters/baseline_current_a']['after'] == parameters['baseline_current_a']
    assert points['/parameters/baseline_current_a']['unit'] == 'A'
    assert points['/parameters/baseline_ambient_k']['after'] == 25
    assert points['/parameters/baseline_ambient_k']['unit'] == '°C'
    saved = decide(client, pending)['receipt']
    definition = client.get('/api/workspaces/' + workspace['id'] + '/studies/' + saved['study_id']).json()['definition']
    assert definition['parameters'] == original['definition']['parameters']
    assert definition['parameters']['baseline_kind'] == parameters['baseline_kind'] == 'manufacturer'
    scope = resume(client, scope)
    changed_source = '工程师撤回基准确认，补充资料后再核对'
    edit = propose(client, scope, 'propose_method_parameters', {'study_id': saved['study_id'], 'changes': [
        {'path': '/parameters/baseline_reviewed', 'value': False},
        {'path': '/parameters/baseline_source', 'value': changed_source},
    ]})
    edits = {point['path']: point for point in edit['changes']}
    assert edits['/parameters/baseline_reviewed']['before'] is True
    assert edits['/parameters/baseline_reviewed']['after'] is False
    assert edits['/parameters/baseline_source']['before'] == parameters['baseline_source']
    assert edits['/parameters/baseline_source']['after'] == changed_source
    assert all(point['unit'] is None for point in edits.values())
    assert client.get('/api/workspaces/' + workspace['id'] + '/studies/' + saved['study_id']).json()['definition'] == definition
    decide(client, edit)
    stored = client.get('/api/workspaces/' + workspace['id'] + '/studies/' + saved['study_id']).json()['definition']['parameters']
    assert stored['baseline_reviewed'] is False and stored['baseline_source'] == changed_source


def test_native_local_manifest_is_not_mistaken_for_an_approved_local_method(client, monkeypatch):
    document = convert(Scenario().model_dump())['document']
    workspace, study = saved_study(client, 'cablesim.native-reference', 'fixed-power', document,
        {'conductor_powers_w_m': [10, 10, 10], 'conductor_k_w_m_k': 400, 'metal_screen_k_w_m_k': 200})
    _, capability = client.app.state.research.resolve(study['definition']['method'])
    assert capability.solver == 'local'
    monkeypatch.setattr(client.app.state.research.executor, 'check', lambda *a, **k: pytest.fail('native preflight executed'))
    monkeypatch.setattr(client.app.state.research.executor, 'run', lambda *a, **k: pytest.fail('native solver executed'))
    scope = open_session(client, workspace)
    before = counts(client)
    rejected = call(client, 'propose_study_run', {'study_id': study['id']}, scope['session'], scope['turn']).json()
    assert rejected['status'] == 'error' and rejected['diagnostics'][0]['code'] == 'NATIVE_EXECUTION_UNAVAILABLE'
    assert counts(client) == before


def test_remote_route_is_rechecked_after_acceptance_before_any_preflight(client, monkeypatch):
    document, parameters = correction_example()
    workspace, study = saved_study(client, 'cablesim.gb50217-correction', 'steady-rating', document, parameters)
    scope = open_session(client, workspace)
    pending = propose(client, scope, 'propose_study_run', {'study_id': study['id']})
    monkeypatch.setattr(client.app.state.research.executor, 'required', lambda *a: True, raising=False)
    monkeypatch.setattr(client.app.state.research.executor, 'check', lambda *a, **k: pytest.fail('remote preflight submitted'))
    before = counts(client)
    refused = decide(client, pending)['receipt']
    assert refused['status'] == 'failed' and refused['error']['code'] == 'NATIVE_EXECUTION_UNAVAILABLE'
    assert counts(client) == before


def test_approved_local_cad_produces_the_real_saved_geometry_artifact(client):
    from backend.plugin_host import PluginHostError, Registry
    from backend.plugin_host.runtime import resolve_python
    try:
        resolve_python(Registry(plugin_id='cablesim.cable-geometry').get('cablesim.cable-geometry'))
    except PluginHostError as error:
        if error.code != 'PLUGIN_ENVIRONMENT_MISSING' or os.environ.get('CI') or os.environ.get('GITHUB_ACTIONS'):
            raise
        pytest.skip('单次 CAD 验收需要插件声明的环境：' + error.message)
    document = convert(Scenario().model_dump())['document']
    workspace, study = saved_study(client, 'cablesim.cable-geometry', 'concentric-model', document,
                                  {'cable_type_id': document['cable_types'][0]['id'], 'length_m': .1})
    decision, _ = execute(client, workspace, study)
    assert decision['receipt']['status'] == 'succeeded', decision
    run = client.app.state.research.get_run(workspace['id'], decision['receipt']['run_id'])
    model = run['output']['cases'][0]['artifacts']['x-cablesim.cad-model']
    assert run['integrity'] == 'verified' and model['outer_diameter_m'] > 0
    assert model['step_text'].startswith('ISO-10303-21;')
    assert model['layers'] and all(layer['volume_m3'] > 0 for layer in model['layers'])


def test_missing_cad_environment_is_an_explicit_refusal_without_a_run(client, monkeypatch, tmp_path):
    document = convert(Scenario().model_dump())['document']
    workspace, study = saved_study(client, 'cablesim.cable-geometry', 'concentric-model', document,
                                  {'cable_type_id': document['cable_types'][0]['id'], 'length_m': .1})
    monkeypatch.setenv('CABLESIM_PLUGIN_PYTHON', str(tmp_path / 'missing-environment' / 'python'))
    before = counts(client)
    decision, _ = execute(client, workspace, study)
    receipt = decision['receipt']
    assert receipt['status'] == 'failed' and receipt['executed'] is False
    assert receipt['error']['code'] == 'PLUGIN_ENVIRONMENT_MISSING'
    assert '运行环境缺失' in receipt['error']['message']
    assert counts(client) == before


def rating_arguments():
    return {'title': '人工给定两工况载流量表', 'parameters': deepcopy(PARAMETERS), 'rows': [
        {'case_id': name, 'name': label, 'layout': layout, 'depth_m': .8, 'soil_rho_k_m_w': 1,
         'ambient_temperature_c': temperature, 'frequency_hz': 50, 'bonding': 'both_ends',
         'rating_basis': 'simultaneous', 'source': '接口验收人工明确条件；非现场测量', **extra}
        for name, label, layout, temperature, extra in (
            ('base', '品字形20度', 'trefoil', 20, {}),
            ('flat', '水平25度', 'flat', 25, {'spacing_m': .2}),
        )]}


def test_rating_table_reuses_the_old_compiler_and_each_write_waits(client):
    workspace = type_workspace(client)
    scope = open_session(client, workspace)
    before = counts(client)
    arguments = rating_arguments()
    expected = client.post('/api/design/workspaces/' + workspace['id'] + '/rating-table-definition',
                           json={**{key: value for key, value in arguments.items() if key != 'title'},
                                 'expected_revision': workspace['revision']}).json()
    pending = propose(client, scope, 'propose_rating_table', arguments)
    assert counts(client) == before
    assert len([row for row in pending['changes'] if row['path'].endswith('/ambient_temperature_c')]) == 2
    source = next(row for row in pending['changes'] if row['path'] == '/parameters/source')
    assert source['after'] == arguments['parameters']['source'] and source['unit'] is None
    method_change = next(row for row in pending['changes'] if row['path'] == '/method')
    plugin, capability = client.app.state.research.resolve(expected['method'])
    assert all(value in method_change['after'] for value in (plugin.manifest.name, expected['method']['version'], capability.title, capability.method_version))
    created = decide(client, pending)['receipt']
    assert created['kind'] == 'study'
    assert counts(client)['studies'] == before['studies'] + 1 and counts(client)['study_runs'] == before['study_runs']
    saved = client.get('/api/workspaces/' + workspace['id'] + '/studies/' + created['study_id']).json()
    assert {key: saved['definition']['driver'][key] for key in expected['driver']} == expected['driver']
    assert saved['definition']['method_input'] == expected['method_input']
    scope = resume(client, scope)
    pending_run = propose(client, scope, 'propose_study_run', {'study_id': created['study_id']})
    assert counts(client)['study_runs'] == before['study_runs']
    executed = decide(client, pending_run)['receipt']
    assert executed['status'] == 'succeeded', executed
    scope = resume(client, scope)
    selected = {'kind': 'rating_table', 'workspace_id': workspace['id'], 'run_id': executed['run_id'], 'view': '/rows'}
    result = call(client, 'resource_read', selected, scope['session'], scope['turn']).json()
    assert result['status'] == 'ok', result
    plain = client.get(f'/api/design/workspaces/{workspace["id"]}/rating-table-runs/{executed["run_id"]}?view=rows').json()
    assert result['data']['page']['value'] == plain['rows']
    identity = result['data']['resource']
    assert identity['method'] == saved['definition']['method'] and identity['title'] == arguments['title']
    assert identity['study_id'] == saved['id'] and identity['run_id'] == executed['run_id']
    assert identity['input_digest'] == plain['run']['input_digest'] and identity['output_digest'] == plain['run']['output_digest']
    foreign = client.post('/api/workspaces', json={}).json()
    rejected = call(client, 'resource_read', {**selected, 'workspace_id': foreign['id']}, scope['session'], scope['turn']).json()
    assert rejected['diagnostics'][0]['code'] == 'SCOPE_VIOLATION'
    other = client.post('/api/workspaces/' + workspace['id'] + '/studies', json={
        **saved['definition'], 'title': '同型号另一项研究', 'expected_revision': workspace['revision']}).json()
    bound = client.post('/api/agent/external/sessions', headers=AUTH, json={
        'workspace_id': workspace['id'], 'study_id': other['id'], 'message': '仅检查绑定研究'}).json()
    rejected = call(client, 'resource_read', selected, bound['session'], bound['turn']).json()
    assert rejected['diagnostics'][0]['code'] == 'SCOPE_VIOLATION'
    changed = client.put('/api/workspaces/' + workspace['id'] + '/studies/' + saved['id'], json={
        **saved['definition'], 'title': '当前研究的新标题', 'expected_revision': workspace['revision'],
        'expected_study_revision': saved['revision']})
    assert changed.status_code == 200, changed.text
    historical = call(client, 'resource_read', selected, scope['session'], scope['turn']).json()
    assert historical['data']['resource']['title'] == arguments['title']
    assert historical['data']['resource']['freshness'] == 'historical'


@pytest.mark.parametrize('problem', ['missing_condition', 'missing_spacing', 'foreign_project'])
def test_rating_table_missing_data_or_wrong_scope_creates_no_study(client, problem):
    workspace = type_workspace(client) if problem != 'foreign_project' else client.post('/api/workspaces', json={}).json()
    arguments = rating_arguments()
    if problem == 'missing_condition': del arguments['rows'][0]['soil_rho_k_m_w']
    if problem == 'missing_spacing': del arguments['rows'][1]['spacing_m']
    scope = open_session(client, workspace)
    before = counts(client)
    result = call(client, 'propose_rating_table', arguments, scope['session'], scope['turn']).json()
    assert result['status'] == 'error', result
    assert counts(client) == before


def test_resource_reader_uses_original_json_pages_and_refuses_unscoped_or_unlisted_access(client):
    workspace = client.post('/api/workspaces', json={}).json()
    release = AssetRelease(asset_id='test.external-material', version='1.0.0', kind='material', name='资源正文验收材料',
        parameters=tuple(AssetParameter(name='field_'+str(i), quantity=Quantity(value=i+.1, unit='Hz', dimension='frequency')) for i in range(60)),
        sources=(SourceReference(kind='project_input', reference='人工给定接口验收，非材料试验', reviewed=False),))
    response = client.post('/api/foundation/assets/import', json={'release': release.model_dump(mode='json')})
    assert response.status_code == 201, response.text
    asset = response.json()
    scope = open_session(client, workspace)
    arguments = {'kind': 'asset', 'id': asset['id'], 'workspace_id': workspace['id'], 'view': '/release/parameters', 'limit': 3}
    assert call(client, 'resource_read', arguments).status_code == 422
    result = call(client, 'resource_read', arguments, scope['session'], scope['turn']).json()
    assert result['status'] == 'ok', result
    assert [item['value'] for item in result['data']['page']['items']] == asset['release']['parameters'][:3]
    assert result['data']['page']['next_offset'] == 3
    assert result['data']['source']['read_only'] is True
    continuation = result['data']['next_read']['arguments']
    second = call(client, 'resource_read', continuation, scope['session'], scope['turn']).json()
    assert [item['value'] for item in second['data']['page']['items']] == asset['release']['parameters'][3:6]
    assert client.get('/api/foundation/assets/' + asset['id']).json() == asset
    for changed in ({'kind': 'settings'}, {'operation': 'approve'}, {'id': '../agent/settings'}, {'run_id': workspace['id']},
                    {'workspace_id': '00000000-0000-0000-0000-000000000000'}, {'limit': 21}):
        rejected = call(client, 'resource_read', {**arguments, **changed}, scope['session'], scope['turn']).json()
        assert rejected['status'] == 'error', rejected
    edited = {**asset['release'], 'name': '人工修订后的资源'}
    assert client.put('/api/foundation/assets/' + asset['id'], json={'expected_revision': asset['revision'], 'release': edited}).status_code == 200
    stale = call(client, 'resource_read', continuation, scope['session'], scope['turn']).json()
    assert stale['diagnostics'][0]['code'] == 'RESOURCE_CHANGED'
    assert call(client, 'platform_read', {}, scope['session'], scope['turn']).status_code == 403
