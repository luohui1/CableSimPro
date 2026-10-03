"""Scenario input binding and real goal evidence for the design workbench."""
from copy import deepcopy
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from design.workbench.scenarios import make_router, system_models


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path / 'studies.sqlite')
    app.include_router(make_router(app.state.workspace_store))
    fallback = next(r for r in app.router.routes if getattr(r, 'path', None) == '/api/{path:path}')
    app.router.routes.remove(fallback)
    app.router.routes.append(fallback)
    with TestClient(app) as c:
        yield c


def workspace(client):
    model = next(m for m in system_models() if m['id'] == 'system.cu-xlpe-al-400')
    r = client.post('/api/design/study-workspaces', json={'model_id': model['id'], 'content_sha256': model['content_sha256']})
    assert r.status_code == 201, r.text
    return r.json()


def saved_study(client, w, plugin='cablesim.thermal-network', **changes):
    item = next(m for m in client.get('/api/methods').json() if m['method']['plugin_id'] == plugin)
    definition = {'title': '350 A 时是否满足温限', 'task': 'operating' if plugin == 'cablesim.thermal-network' else 'rating',
                  'method': {**item['method'], 'capability': 'steady-rating'}, 'input_source': 'domain',
                  'parameters': deepcopy(w['study_cable_reference']['method_defaults'][plugin]), **changes}
    r = client.post(f"/api/workspaces/{w['id']}/studies", json={**definition, 'expected_revision': w['revision']})
    assert r.status_code == 201, r.text
    return r.json()


def execute(client, w, s):
    root = f"/api/workspaces/{w['id']}/studies/{s['id']}"
    p = client.get(root+'/preflight', params={'expected_revision': w['revision'], 'expected_study_revision': s['revision']})
    assert p.status_code == 200 and p.json()['ready'], p.text
    r = client.post(root+'/runs', json={'request_id': str(uuid4()), 'expected_revision': w['revision'],
                    'expected_study_revision': s['revision'], 'lock_digest': p.json()['lock_digest'], 'scope_acknowledged': True})
    assert r.status_code == 200, r.text
    return r.json()


def test_demo_pin_preserves_library_facts_but_allows_research_goals(client):
    w = workspace(client)
    document = deepcopy(w['domain'])
    document['criteria']['max_conductor_temperature'] = 358.15
    root = f"/api/workspaces/{w['id']}/domain"
    edited = client.put(root, json={'expected_revision': w['revision'], 'document': document})
    assert edited.status_code == 200, edited.text
    revision = edited.json()['revision']
    assert edited.json()['document']['cable_types'][0]['rating']['max_conductor_temperature']['normal'] == 363.15
    attack = deepcopy(edited.json()['document'])
    attack['cable_types'][0]['cores'][0]['layers'].append({'role': 'conductor_screen', 'material': 'material/semi', 'thickness': .0001})
    rejected = client.put(root, json={'expected_revision': revision, 'document': attack})
    assert rejected.status_code == 422, rejected.text
    assert client.get(root).json()['revision'] == revision
    m = system_models()[0]
    bind = f"/api/design/workspaces/{w['id']}/cable-reference"
    assert client.post(bind, json={'expected_revision': w['revision'], 'model_id': m['id'], 'content_sha256': m['content_sha256']}).status_code == 409
    chosen = client.post(bind, json={'expected_revision': revision, 'model_id': m['id'], 'content_sha256': m['content_sha256']})
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()['study_cable_reference']['content_sha256'] == m['content_sha256']
    assert chosen.json()['domain']['cable_types'][0]['cores'][0]['conductor']['nominal_area'] == pytest.approx(.00024)
    assert chosen.json()['domain']['criteria']['max_conductor_temperature'] == 358.15


@pytest.mark.parametrize('kind', ['trefoil', 'flat', 'ducts'])
def test_templates_are_validated_previews_and_leave_store_unchanged(client, kind):
    w = workspace(client)
    response = client.post(f"/api/design/workspaces/{w['id']}/section-template", json={
        'expected_revision': w['revision'], 'document': w['domain'], 'kind': kind, 'depth': .9})
    assert response.status_code == 200, response.text
    section = response.json()['sections'][0]
    assert -sum(p['z'] for p in section['placements'])/3 == pytest.approx(.9)
    assert len(section['enclosures']) == (3 if kind == 'ducts' else 0)
    assert response.json()['cable_types'] == w['domain']['cable_types']
    assert client.get(f"/api/workspaces/{w['id']}").json()['revision'] == w['revision']


@pytest.mark.parametrize('kind,ground,circuits', [('double_trefoil', 'ground', 2), ('tunnel', 'tunnel', 1), ('tray', 'air', 1)])
def test_extended_templates_keep_all_circuits_and_are_not_fake_solver_results(client, kind, ground, circuits):
    w = workspace(client)
    response = client.post(f"/api/design/workspaces/{w['id']}/section-template", json={
        'expected_revision': w['revision'], 'document': w['domain'], 'kind': kind, 'depth': .8})
    assert response.status_code == 200, response.text
    document = response.json()
    assert len(document['circuits']) == circuits
    assert len(document['sections'][0]['placements']) == circuits*3
    assert document['sections'][0]['kind'] == ground
    saved = client.put(f"/api/workspaces/{w['id']}/domain", json={'expected_revision': w['revision'], 'document': document})
    assert saved.status_code == 200, saved.text
    w = client.get(f"/api/workspaces/{w['id']}").json()
    s = saved_study(client, w)
    preflight = client.get(f"/api/workspaces/{w['id']}/studies/{s['id']}/preflight",
                           params={'expected_revision': w['revision'], 'expected_study_revision': s['revision']})
    assert preflight.status_code == 200
    assert not preflight.json()['ready']
    assert preflight.json()['cases'][0]['error']['message']


def test_type_copy_is_independent_and_thickness_edit_has_no_old_arrangement_collision(client):
    model = next(m for m in system_models() if m['id'] == 'system.yjq02-110kv-800')
    snapshot = client.post('/api/design/type-workspaces', json={'model_id': model['id'], 'content_sha256': model['content_sha256']})
    assert snapshot.status_code == 201, snapshot.text
    w = snapshot.json()
    assert 'study_cable_reference' not in w
    assert w['type_origin_reference']['version'] == model['version']
    assert not w['locks']
    before = deepcopy(model['payload'])
    document = deepcopy(w['domain'])
    document['cable_types'][0]['common_layers'][1]['thickness'] += .005
    edited = client.put(f"/api/workspaces/{w['id']}/domain", json={'expected_revision': w['revision'], 'document': document})
    assert edited.status_code == 200, edited.text
    assert edited.json()['document']['cable_types'][0]['common_layers'][1]['thickness'] == pytest.approx(.021)
    assert next(m for m in system_models() if m['id'] == model['id'])['payload'] == before


@pytest.mark.parametrize('region', ['backfill', 'layers'])
def test_ground_regions_validate_facts_and_do_not_silently_use_uniform_soil(client, region):
    w = workspace(client)
    document = deepcopy(w['domain'])
    sec = document['sections'][0]
    if region == 'backfill':
        sec['backfill'] = {'id': 'region/fill', 'material': sec['medium']['material'], 'x': 0, 'z': -.8, 'width': .5, 'height': .4}
    else:
        sec['soil_layers'] = [{'id': 'region/top', 'label': '上层', 'material': sec['medium']['material'], 'top_z': 0, 'bottom_z': -.4},
                             {'id': 'region/bottom', 'label': '下层', 'material': sec['medium']['material'], 'top_z': -.4, 'bottom_z': -2}]
    saved = client.put(f"/api/workspaces/{w['id']}/domain", json={'expected_revision': w['revision'], 'document': document})
    assert saved.status_code == 200, saved.text
    w = client.get(f"/api/workspaces/{w['id']}").json()
    for plugin in ('cablesim.thermal-network', 'cablesim.iec60287'):
        s = saved_study(client, w, plugin=plugin)
        p = client.get(f"/api/workspaces/{w['id']}/studies/{s['id']}/preflight", params={'expected_revision': w['revision'], 'expected_study_revision': s['revision']})
        assert p.status_code == 200 and not p.json()['ready'], p.text
        assert '均匀土壤' in p.json()['cases'][0]['error']['message']
    invalid = deepcopy(document)
    if region == 'backfill':
        invalid['sections'][0]['backfill']['z'] = 0
    else:
        invalid['sections'][0]['soil_layers'][1]['top_z'] = -.5
    rejected = client.put(f"/api/workspaces/{w['id']}/domain", json={'expected_revision': w['revision'], 'document': invalid})
    assert rejected.status_code == 422
    assert client.get(f"/api/workspaces/{w['id']}").json()['revision'] == w['revision']


def test_real_operating_goals_and_current_only_delivery(client, monkeypatch):
    w = workspace(client)
    s = saved_study(client, w)
    run = execute(client, w, s)
    assert run['status'] == 'succeeded', run
    checks = run['output']['cases'][0]['artifacts']['x-cablesim.thermal-network-rating']['goal_checks']
    temperature = next(g for g in checks if g['key'] == 'conductor_temperature')
    assert temperature['current_a'] == 350
    assert temperature['actual'] < temperature['target']
    assert temperature['margin'] == pytest.approx(temperature['target']-temperature['actual'])
    assert temperature['verdict'] == 'satisfied'
    current = next(g for g in checks if g['key'] == 'ampacity')
    assert current['margin_percent'] == pytest.approx(current['margin']/current['target']*100)
    report = client.app.state.research.deliver(w['id'], [run['id']], current_only=True)
    assert '350.0 A 时最高导体温度' in report['html']
    assert '原始输入快照与完整精度结果' in report['html']
    d = deepcopy(w['domain'])
    d['load_cases'][0]['currents'][d['circuits'][0]['id']] = 360
    from backend.kernel import report as renderer
    original = renderer.render
    def edit_during_render(runs):
        assert client.put(f"/api/workspaces/{w['id']}/domain", json={'expected_revision': w['revision'], 'document': d}).status_code == 200
        return original(runs)
    monkeypatch.setattr(renderer, 'render', edit_during_render)
    with pytest.raises(HTTPException) as error:
        client.app.state.research.deliver(w['id'], [run['id']], current_only=True)
    assert error.value.status_code == 409
    with client.app.state.workspace_store.db() as db:
        assert db.execute('SELECT count(*) FROM deliveries').fetchone()[0] == 1
    with pytest.raises(HTTPException) as error:
        client.app.state.research.deliver(w['id'], [run['id']], current_only=True)
    assert error.value.status_code == 409


def test_real_scan_keeps_failures_and_plugin_target_verdicts(client):
    w = workspace(client)
    soil = next(i for i, m in enumerate(w['domain']['materials']) if m['id'] == w['domain']['sections'][0]['medium']['material'])
    path = f'/input/materials/{soil}/thermal_resistivity'
    params = {**w['study_cable_reference']['method_defaults']['cablesim.thermal-network'], 'target_current_a': 600}
    s = saved_study(client, w, task='target', parameters=params, driver={'kind': 'sweep', 'samples': [
        {'label': '1.0 K·m/W', 'changes': {path: 1.0}}, {'label': '2.2 K·m/W', 'changes': {path: 2.2}},
        {'label': 'invalid', 'changes': {path: -1}}]})
    run = execute(client, w, s)
    assert run['status'] == 'partial', run
    cases = run['output']['cases']
    assert cases[2]['status'] == 'failed' and cases[2]['error']['message']
    checks = [next(g for g in c['artifacts']['x-cablesim.thermal-network-rating']['goal_checks'] if g['key'] == 'ampacity') for c in cases[:2]]
    assert [g['verdict'] for g in checks] == ['satisfied', 'not_satisfied']
    assert all(g['target'] == 600 and g['rule_version'] for g in checks)
    source = run['snapshot']['cases'][0]['input']['provenance']['/materials/material~1soil/thermal_resistivity']
    assert source['kind'] == 'user' and '1.0 K·m/W' in source['reference']
    assert w['domain']['provenance']['/materials/material~1soil/thermal_resistivity']['kind'] == 'demo'


def test_same_input_crosscheck_preserves_method_validation(client):
    w = workspace(client)
    other = next(m for m in client.get('/api/methods').json() if m['method']['plugin_id'] == 'cablesim.iec60287')
    s = saved_study(client, w, task='rating', driver={'kind': 'crosscheck'}, crosschecks=[{
        'method': {**other['method'], 'capability': 'steady-rating'},
        'parameters': w['study_cable_reference']['method_defaults']['cablesim.iec60287']}])
    run = execute(client, w, s)
    assert run['status'] == 'succeeded', run
    assert len(run['snapshot']['cases']) == 1
    assert len(run['output']['executions']) == 2
    assert all('validation' in e and 'limitations' in e for e in run['output']['executions'])
    assert any(q['key'] == 'ampacity' for q in run['output']['crosscheck']['quantities'])
    iec = run['output']['cases'][1]['artifacts']['x-cablesim.iec60287-trace']['goal_checks']
    assert next(g for g in iec if g['key'] == 'conductor_temperature')['verdict'] == 'unavailable'
    trace = run['output']['cases'][1]['artifacts']['x-cablesim.iec60287-trace']
    attribution = trace['rating_attribution']
    assert attribution['schema'] == 'cablesim.rating-attribution/1'
    assert abs(attribution['closure_error_a']) < 1e-5
    assert sum(r['contribution_a'] for r in attribution['rows']) == pytest.approx(attribution['difference_a'], abs=1e-5)
    assert {r['key'] for r in attribution['rows']} == {'ac_resistance_ohm_m', 'lambda1', 'lambda2',
          't1_k_m_w', 't2_k_m_w', 't3_k_m_w', 't4_k_m_w', 'metal_k_m_w', 'dielectric_rise_k'}
    contributions = [abs(r['contribution_a']) for r in attribution['rows']]
    assert contributions == sorted(contributions, reverse=True)
    assert attribution['source']['artifact_digests'] == run['output']['cases'][0]['artifact_digests']
    assert attribution['source']['method'] == run['snapshot']['definition']['method']
