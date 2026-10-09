"""Conditional SI reference comparisons and explicit immutable adoption."""
from copy import deepcopy
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.kernel.scenarios import system_models
from backend.kernel.type_versions import compare_material
from backend.domain.guards import pointer
from frontend.scripts.engineering_resources import definitions, publish_resources, bind_demo_resources


def test_material_comparison_keeps_units_conditions_missing_and_arithmetic(tmp_path):
    library = {r.asset_id: {'release': r.model_dump(mode='json')} for r in definitions()}
    with TestClient(create_app(tmp_path/'comparison.sqlite')) as client:
        model = next(m for m in system_models() if m['id'] == 'system.yjq02-110kv-800')
        response = client.post('/api/design/type-workspaces', json={'model_id': model['id'], 'content_sha256': model['content_sha256']})
        assert response.status_code == 201, response.text
        document = response.json()['domain']
    copper = next(m for m in document['materials'] if m['id'] == 'material/cu')
    document['provenance']['/materials/'+str(document['materials'].index(copper))] = {'kind': 'asset', 'reviewed': True, 'reference': json.dumps({'asset_id': 'material/copper-conductor'})}
    copper['electrical_resistivity_20'] = 2e-8
    copper['temperature_coefficient_20'] = .00393
    rows = {r['id']: r for r in compare_material(document, copper, library['material/copper-conductor'])}
    # IEC 60287-1-1:2023 table 1, printed p35 / PDF p83; arithmetic only.
    assert rows['temperature_coefficient_20']['status'] == 'same', rows['temperature_coefficient_20']
    rho = rows['electrical_resistivity_20']
    assert rho['status'] == 'different' and rho['unit'] == 'ohm.m'
    assert rho['delta'] == pytest.approx(2e-8 - 1.7241e-8)
    assert rho['percent'] == pytest.approx((2e-8 / 1.7241e-8 - 1)*100)
    assert rho['reference']['table'] == '1' and rho['reference']['printed_page'] == 35
    assert rows['density']['status'] == 'resource_missing' and rows['density']['reason']
    copper['electrical_resistivity_20'] = None
    assert compare_material(document, copper, library['material/copper-conductor'])[1]['status'] == 'design_missing'
    insulation = next(m for m in document['materials'] if m['id'] == 'material/xlpe')
    index = document['materials'].index(insulation)
    document['provenance']['/materials/'+str(index)] = {'kind': 'asset', 'reviewed': True, 'reference': json.dumps({'asset_id': 'material/epr-lv'})}
    low_voltage = compare_material(document, insulation, library['material/epr-lv'])[0]
    assert low_voltage['status'] == 'condition_mismatch'
    assert '电压' in low_voltage['reason'] and low_voltage['delta'] is None and not low_voltage['adoptable']
    # An unsupported unit cannot be borrowed from an asset parameter's quantity.
    wrong_units = deepcopy(library['material/copper-conductor'])
    for source in wrong_units['release']['sources']:
        record = json.loads(source['reference'])
        if record.get('property') == 'electrical_resistivity_20':
            record['unit'] = 'ohm/km'
            source['reference'] = json.dumps(record)
    assert compare_material(document, copper, wrong_units)[1]['status'] == 'condition_mismatch'
    # PVC reference has four conditional values: choose by actual layer purpose
    # and voltage, not by asset parameter order or by the material's name.
    jacket = next(m for m in document['materials'] if m['id'] == 'material/pvc')
    document['provenance']['/materials/'+str(document['materials'].index(jacket))] = {
        'kind': 'asset', 'reviewed': True, 'reference': json.dumps({'asset_id': 'material/pvc-reference'})}
    pvc = compare_material(document, jacket, library['material/pvc-reference'])[0]
    assert pvc['reference']['value'] == 6 and '>35 kV' in pvc['reference']['condition']
    copper['standard_kind'] = 'aluminium'
    assert compare_material(document, copper, library['material/copper-conductor'])[1]['status'] == 'condition_mismatch'
    copper['standard_kind'] = None
    copper['electrical_resistivity_20'] = 1e308
    extreme = compare_material(document, copper, library['material/copper-conductor'])[1]
    assert extreme['percent'] is None and '数值范围' in extreme['reason']
    invalid = deepcopy(library['material/copper-conductor'])
    for source in invalid['release']['sources']:
        record = json.loads(source['reference'])
        if record.get('property') == 'electrical_resistivity_20':
            record['value'] = float('nan')
            source['reference'] = json.dumps(record)
    rejected = compare_material(document, copper, invalid)
    assert rejected[1]['status'] == 'condition_mismatch' and not rejected[1]['adoptable']
    json.dumps(rejected, allow_nan=False)  # unavailable values must not make the API fail to serialize


def test_adopt_material_value_creates_revision_pins_source_replays_and_undoes(tmp_path, monkeypatch):
    monkeypatch.setenv('CABLESIM_DATASETS_DIR', str(tmp_path/'datasets'))
    with TestClient(create_app(tmp_path/'adoption.sqlite')) as client:
        def api(path, method='GET', body=None):
            response = client.request(method, path, json=body)
            assert response.status_code < 400, response.text
            return response.json()
        publish_resources(api)
        model = next(m for m in system_models() if m['id'] == 'system.specification-yjv22-300')
        workspace = api('/api/design/type-workspaces', 'POST', {'model_id': model['id'], 'content_sha256': model['content_sha256']})
        wid = workspace['id']; root = '/api/workspaces/'+wid
        bind_demo_resources(api, wid, 'mv')
        workspace = api(root)
        document = deepcopy(workspace['domain'])
        insulation = next(m for m in document['materials'] if m['id'] == 'material/xlpe')
        insulation['thermal_resistivity'] = 4.
        field = pointer('materials', insulation['id'], 'thermal_resistivity')
        document['provenance'][field] = {'kind': 'user', 'reference': '隔离试验：型号保存值 4 K·m/W', 'reviewed': False}
        api(root+'/domain', 'PUT', {'expected_revision': workspace['revision'], 'document': document})
        before = api(root)
        comparison = api('/api/types/'+wid+'/material-comparison')
        material = next(m for m in comparison['materials'] if m['id'] == insulation['id'])
        row = next(r for r in material['rows'] if r['id'] == 'thermal_resistivity')
        assert row['status'] == 'different' and row['delta'] == .5
        body = {'expected_revision': before['revision'], 'request_id': str(uuid4()), 'material_id': insulation['id'],
                'property': row['id'], 'resource_id': material['resource']['resource_id'], 'content_sha256': material['resource']['content_sha256']}
        adopted = api('/api/types/'+wid+'/material-comparison/adopt', 'POST', body)
        assert adopted['revision'] == before['revision']+1
        assert next(m for m in adopted['domain']['materials'] if m['id'] == insulation['id'])['thermal_resistivity'] == 3.5
        source = adopted['domain']['provenance'][field]
        assert source['kind'] == 'asset' and source['reviewed'] is False
        identity = json.loads(source['reference'])
        assert identity['asset_id'] == 'material/xlpe-mv' and identity['version'] == material['resource']['version']
        assert identity['content_sha256'] == body['content_sha256'] and identity['previous_value'] == 4
        assert identity['reference_value']['standard'] == 'IEC 60287-2-1:2023'
        assert api('/api/types/'+wid+'/material-comparison/adopt', 'POST', body) == adopted  # retry once, same receipt
        archived = api(root+'/revisions/'+str(before['revision']))['state']
        assert archived['domain'] == before['domain']
        history = api('/api/types/'+wid+'/material-comparison?revision='+str(before['revision']))
        assert history['historical'] and not any(r['adoptable'] for m in history['materials'] for r in m['rows'])
        denied = client.post('/api/types/'+wid+'/material-comparison/adopt', json={**body, 'request_id': str(uuid4()),
            'expected_revision': adopted['revision'], 'property': 'density'})
        assert denied.status_code == 422 and denied.json()['detail']['field'] == pointer('materials', insulation['id'], 'density')
        assert '未提供' in denied.json()['detail']['message']
        assert api(root)['revision'] == adopted['revision']
        undone = api(root+'/history/undo', 'POST', {'expected_revision': adopted['revision']})
        assert undone['domain'] == before['domain']
        assert undone['type_resource_bindings'] == before['type_resource_bindings']
        assert api(root+'/revisions/'+str(adopted['revision']))['state']['domain'] == adopted['domain']
