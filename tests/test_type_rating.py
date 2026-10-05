"""Saved condition batches: actual IEC results, explicit refusals and immutable exports."""
from copy import deepcopy
from decimal import Decimal, localcontext
import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.main import create_app
from backend.kernel.contracts import Driver, StudyDefinition
from backend.kernel.drivers import cases_for
from backend.kernel.report import render
from backend.kernel.scenarios import make_router as scenarios_router, system_models
from backend.kernel.rating_conditions import make_router, RatingRow, RatingTableDefinition, table_definition, rating_rows, condition_input

ROOT = Path(__file__).resolve().parents[1]
PARAMETERS = {'ks': 1, 'kp': 1, 'eddy': 'ignored', 't4_form': 'exact', 'reference_basis': 'iec2023',
              'source': '合成验收数据；明示参数，不是实际产品默认值',
              'duct': {'u': 1.87, 'v': .312, 'y_per_k': .0037, 'initial_mean_air_temperature_c': 40},
              'solver': {'initial_sheath_temperature_c': 70, 'current_tolerance_a': 1e-8, 'max_iterations': 100}}


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path/'rating.sqlite')
    app.include_router(scenarios_router(app.state.workspace_store))
    app.include_router(make_router(app.state.research))
    fallback = next(r for r in app.router.routes if getattr(r, 'path', None) == '/api/{path:path}')
    app.router.routes.remove(fallback)
    app.router.routes.append(fallback)
    with TestClient(app) as c:
        yield c


def type_workspace(c):
    model = next(m for m in system_models() if m['id'] == 'system.cu-xlpe-al-240')
    response = c.post('/api/design/type-workspaces', json={'model_id': model['id'], 'content_sha256': model['content_sha256']})
    assert response.status_code == 201, response.text
    return response.json()


def save_table(c, w, rows=None, parameters=None, selected=None):
    body = {'expected_revision': w['revision'], 'rows': rows or [RatingRow(case_id=k, name=k, layout=k).model_dump() for k in ('trefoil', 'flat', 'ducts', 'air')], 'parameters': parameters or PARAMETERS, 'selected_case_ids': selected}
    r = c.post(f"/api/design/workspaces/{w['id']}/rating-table-definition", json=body)
    assert r.status_code == 200, r.text
    response = c.post(f"/api/workspaces/{w['id']}/studies", json={**r.json(), 'expected_revision': w['revision']})
    assert response.status_code == 201, response.text
    return response.json()


def execute(c, w, study):
    root = f"/api/workspaces/{w['id']}/studies/{study['id']}"
    response = c.get(root+'/preflight', params={'expected_revision': w['revision'], 'expected_study_revision': study['revision']})
    assert response.status_code == 200, response.text
    p = response.json()
    body = {'request_id': str(uuid4()), 'expected_revision': w['revision'], 'expected_study_revision': study['revision'], 'lock_digest': p['lock_digest'], 'scope_acknowledged': True}
    r = c.post(root+'/runs', json=body)
    assert r.status_code == 200, r.text
    return r.json(), root, body


def test_condition_batch_reuses_real_iec_and_archives_air_refusal(client):
    w = type_workspace(client)
    original = deepcopy(w['domain'])
    study = save_table(client, w)
    assert study['definition']['input_sources']['/parameters/ks']['reference'] == PARAMETERS['source']
    assert study['definition']['input_sources']['/parameters/solver']['kind'] == 'user'
    run, root, body = execute(client, w, study)
    assert run['status'] == 'partial'
    assert run['integrity'] == 'verified'
    rows = rating_rows(run)
    assert all(r['value_a'] is not None and r['value_a'] > 0 for r in rows[:3]), [(r['case_id'], r['status'], r['reason']) for r in rows]
    assert rows[-1]['value_a'] is None and rows[-1]['status'] == '超出范围'
    assert '地下稳态' in rows[-1]['reason']
    assert client.get(f"/api/workspaces/{w['id']}").json()['domain'] == original
    assert client.post(root+'/runs', json=body).json()['id'] == run['id']
    assert len(client.get(root+'/runs').json()['items']) == 1
    # Independently recompute a thermal balance from the frozen converged components.
    case = run['output']['cases'][0]
    trace = case['artifacts']['x-cablesim.iec60287-trace']
    component = trace['rating_components']
    with localcontext() as ctx:
        ctx.prec = 45
        d = lambda key: Decimal(str(component[key]))
        denominator = d('ac_resistance_ohm_m')*(d('t1_k_m_w')+(1+d('lambda1'))*(d('t3_k_m_w')+d('t4_k_m_w')))
        dielectric_rise = d('dielectric_loss_w_m')*(d('t1_k_m_w')/2+d('t3_k_m_w')+d('t4_k_m_w'))
        hand = ((d('temperature_headroom_k')-dielectric_rise)/denominator).sqrt()
    assert rows[0]['value_a'] == pytest.approx(float(hand), rel=1e-7)
    html = render([run])
    assert 'data-specification-section="rating"' in html
    # Customer documents round display values; saved results retain full precision.
    displayed_current = format(Decimal(str(rows[0]['value_a'])).quantize(Decimal('0.001')), 'f').rstrip('0').rstrip('.')
    assert f'<td>{displayed_current}</td>' in html
    assert str(rows[0]['value_a']) not in html
    assert run['input_digest'] in html and run['output_digest'] in html


def test_batch_inputs_are_saved_not_runtime_overrides_and_deep_copied():
    pin = {'plugin_id': 'test.method', 'capability': 'rating', 'version': '1', 'release_digest': 'a'*64}
    d = StudyDefinition(title='conditions', input_source='study', method_input={'base': 1}, method=pin,
                        parameters={'common': 2}, driver={'kind': 'batch', 'cases': [
                            {'case_id': 'buried', 'label': 'buried', 'input': {'environment': 'ground'}, 'parameters': {'common': 3}},
                            {'case_id': 'air', 'label': 'air', 'input': {'environment': 'air'}}]}).model_dump()
    cases = cases_for(d, {'ignored': True})
    assert cases[0]['parameters']['common'] == 3
    assert cases[1]['input'] == {'environment': 'air'}
    cases[0]['input']['environment'] = 'changed'
    assert d['driver']['cases'][0]['input']['environment'] == 'ground'
    with pytest.raises(ValidationError):
        Driver(kind='batch', cases=[d['driver']['cases'][0]]*2)
    with pytest.raises(ValidationError):
        Driver(kind='single', cases=d['driver']['cases'])
    with pytest.raises(ValidationError):
        Driver(kind='batch', cases=d['driver']['cases'], selected_case_ids=['unknown'])


def test_selected_condition_only_runs_selected_and_keeps_scope_checks(client):
    w = type_workspace(client)
    study = save_table(client, w, selected=['trefoil'])
    run, _, _ = execute(client, w, study)
    cases = {c['case_id']: c for c in run['output']['cases']}
    assert cases['trefoil']['status'] == 'succeeded'
    assert cases['flat']['status'] == cases['ducts']['status'] == 'not_run'
    assert cases['air']['evidence']['stage'] == 'preflight'
    rows = {r['case_id']: r for r in rating_rows(run)}
    assert rows['flat']['status'] == '未运行' and rows['flat']['value_a'] is None
    assert rows['air']['status'] == '超出范围' and '地下稳态' in rows['air']['reason']
    assert run['output']['executions'][0]['executed'] is True
    assert run['snapshot']['definition']['driver']['selected_case_ids'] == ['trefoil']
    rejected = save_table(client, w, selected=['air'])
    refused, _, _ = execute(client, w, rejected)
    assert refused['output']['executions'][0]['executed'] is False
    assert all(r['value_a'] is None for r in rating_rows(refused))


@pytest.mark.parametrize('index', [0, 2])
def test_two_real_types_keep_unsupported_or_missing_rows_without_fabrication(client, index):
    fixture = json.loads((ROOT/'tests/fixtures/standard_check_cases.json').read_text('utf-8'))[index]
    w = type_workspace(client)
    r = client.put(f"/api/workspaces/{w['id']}/domain", json={'expected_revision': w['revision'], 'document': fixture['input']})
    assert r.status_code == 200, r.text
    w = client.get(f"/api/workspaces/{w['id']}").json()
    study = save_table(client, w)
    run, _, _ = execute(client, w, study)
    rows = rating_rows(run)
    assert all(r['value_a'] is None for r in rows)
    assert all(r['reason'] for r in rows)
    assert all(r['status'] in ('超出范围', '待补数据') for r in rows)
    assert run['status'] == 'failed' and run['output']['cases']
    assert '载流量表' in client.app.state.research.deliver(w['id'], [run['id']], current_only=True)['html']


def test_invalid_units_and_stale_type_are_rejected_at_fields(client):
    w = type_workspace(client)
    root = f"/api/design/workspaces/{w['id']}/rating-table-definition"
    body = {'expected_revision': w['revision'], 'rows': [{'case_id': 'bad', 'name': 'bad', 'layout': 'trefoil', 'depth_m': -1}], 'parameters': PARAMETERS}
    r = client.post(root, json=body)
    assert r.status_code == 422 and r.json()['detail'][0]['loc'][-1] == 'depth_m'
    body['rows'][0]['depth_m'] = .8
    body['expected_revision'] += 1
    assert client.post(root, json=body).status_code == 409
    body['expected_revision'] -= 1
    body['rows'][0].update(layout='ducts', duct_inner_m=.16, duct_outer_m=.14)
    response = client.post(root, json=body)
    assert response.status_code == 422 and response.json()['detail'][0]['loc'][-1] == 'duct_outer_m'
    body['rows'][0].update(duct_inner_m=.14, duct_outer_m=.16)
    body['parameters'] = {**PARAMETERS, 'source': ''}
    response = client.post(root, json=body)
    assert response.status_code == 422 and response.json()['detail']['field'] == 'parameters.source'
    body['parameters'] = {'t4_form': 'exact'}
    response = client.post(root, json=body)
    assert response.status_code == 200
    assert '/parameters/t4_form' not in response.json()['input_sources']


def test_edited_conditions_preserve_history_and_block_current_export(client):
    w = type_workspace(client)
    study = save_table(client, w)
    run, root, _ = execute(client, w, study)
    before = deepcopy(run['snapshot'])
    changed = deepcopy(study['definition'])
    changed['driver']['cases'][0]['metadata']['condition']['depth_m'] = 1.5
    response = client.put(root, json={**changed, 'expected_revision': w['revision'], 'expected_study_revision': study['revision']})
    assert response.status_code == 200, response.text
    reread = client.get(root+'/runs/'+run['id']).json()
    assert reread['freshness'] == 'historical'
    assert reread['snapshot'] == before
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as error:
        client.app.state.research.deliver(w['id'], [run['id']], current_only=True)
    assert error.value.status_code == 409


def test_controlled_tb880_condition_uses_same_iec_plugin(client):
    filename = ROOT/'.data/tb880/fixtures/tb880-case-0-1.json'
    if not filename.exists():
        pytest.skip('受控 TB 880 摘录不随仓库分发')
    fixture = json.loads(filename.read_text('utf-8'))
    si = fixture['inputSi']
    w = type_workspace(client)
    d = deepcopy(w['domain'])
    cable = d['cable_types'][0]
    cable['label'] = 'TB 880 · 合成验收数据（验证复现）'
    cable['rating'].update(u0=si['phaseToGroundVoltageV'], u=si['lineToLineVoltageV'], um=145000)
    cable['rating']['max_conductor_temperature']['normal'] = si['maxConductorTemperatureC']+273.15
    cable['cores'][0]['conductor'].update(diameter=si['conductorDiameterM'], nominal_area=.000630, r20=si['conductorResistance20OhmPerM'])
    for layer, thickness in zip(cable['common_layers'], [.0015, .0155, .0013, .0008, .0035]):
        layer['thickness'] = thickness
    for material in d['materials']:
        if material['category'] == 'conductor':
            material['temperature_coefficient_20'] = .00393
        elif material['category'] == 'semiconductor':
            material['thermal_resistivity'] = 2.5
        elif material['category'] == 'insulation':
            material.update(thermal_resistivity=3.5, relative_permittivity=2.5, loss_tangent=.001)
        elif material['category'] == 'metal':
            material.update(electrical_resistivity_20=2.84e-8, temperature_coefficient_20=.00403)
        elif material['category'] == 'polymer':
            material['thermal_resistivity'] = 3.5
    r = client.put(f"/api/workspaces/{w['id']}/domain", json={'expected_revision': w['revision'], 'document': d})
    assert r.status_code == 200, r.text
    w = client.get(f"/api/workspaces/{w['id']}").json()
    row = RatingRow(case_id='tb880', name='TB 880 案例 0-1（验证）', layout='trefoil', depth_m=1, soil_rho_k_m_w=1, ambient_temperature_c=20,
                    source='CIGRE TB 880 case 0-1 pp.62–75；验证复现，非厂家或实际项目数据').model_dump()
    p = {**PARAMETERS, 'reference_basis': 'tb880_reference', 't4_form': 'simplified',
         'solver': {'initial_sheath_temperature_c': 80, 'current_tolerance_a': .001, 'max_iterations': 100}}
    study = save_table(client, w, [row], p)
    run, _, _ = execute(client, w, study)
    assert run['status'] == 'succeeded', [(r['status'], r['reason']) for r in rating_rows(run)]
    assert rating_rows(run)[0]['value_a'] == pytest.approx(821.7763334392, rel=.001)
