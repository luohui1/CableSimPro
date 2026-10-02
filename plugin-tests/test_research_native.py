"""v2 transport and saved crosschecks execute the actual native solver."""
import base64
from hashlib import sha256
from uuid import uuid4
import pytest

from fastapi.testclient import TestClient

from backend.main import create_app
from backend.plugin_host import Executor
from backend.schemas import Scenario
from backend.domain.migration import convert


ARGS = {'conductor_powers_w_m': [20, 20, 20], 'conductor_k_w_m_k': 380,
        'metal_screen_k_w_m_k': 380, 'domain_scale': 4, 'resolution': 16}


def test_v2_native_bundle_and_line_source():
    host = Executor()
    inputs = Scenario().model_dump(mode='json')
    cases = [{'case_id': 'base', 'input': inputs, 'parameters': ARGS}]
    for capability in ('fixed-power', 'line-source'):
        run = host.run('cablesim.native-reference', capability, cases)
        case = run.cases[0]
        assert case.status == 'succeeded', case.error
        assert len(case.results) == 3 and all(r['unit'] == 'K' for r in case.results)
        bundle = case.artifacts['x-cablesim.native-bundle']
        for file in bundle['files']:
            assert sha256(base64.b64decode(file['bytes_base64'])).hexdigest() == file['sha256']
        if capability == 'fixed-power':
            assert {'buried.msh', 'field.json', 'temperature.vtu'} <= {f['name'] for f in bundle['files']}


def test_saved_crosscheck_records_both_methods(tmp_path):
    with TestClient(create_app(tmp_path / 'crosscheck.sqlite')) as client:
        w = client.post('/api/workspaces', json={}).json()
        method = next(p['method'] for p in client.get('/api/methods').json() if p['method']['plugin_id'] == 'cablesim.native-reference')
        definition = {'expected_revision': 1, 'title': '合成 FEM / 线源对照', 'method': {**method, 'capability': 'fixed-power'},
                      'parameters': ARGS, 'driver': {'kind': 'crosscheck'},
                      'crosschecks': [{'method': {**method, 'capability': 'line-source'}, 'parameters': ARGS}]}
        s = client.post(f'/api/workspaces/{w["id"]}/studies', json=definition)
        assert s.status_code == 201, s.text
        root = f'/api/workspaces/{w["id"]}/studies/{s.json()["id"]}'
        preflight = client.get(root + '/preflight', params={'expected_revision': 1, 'expected_study_revision': 1})
        assert preflight.status_code == 200, preflight.text
        r = client.post(root + '/runs', json={'request_id': str(uuid4()), 'expected_revision': 1, 'expected_study_revision': 1,
                       'scope_acknowledged': True, 'lock_digest': preflight.json()['lock_digest']})
        assert r.status_code == 200, r.text
        run = r.json()
        assert run['status'] == 'succeeded', run.get('error')
        assert len(run['output']['executions']) == 2 and len(run['output']['cases']) == 2
        assert run['integrity'] == 'verified'


@pytest.mark.parametrize('capability,mode', [('fixed-power', None), ('electrothermal', 'operating-point'), ('electrothermal', 'ampacity')])
def test_real_native_domain_transport_and_typed_ampacity(capability, mode):
    s = Scenario().model_dump(mode='json')
    s['cable']['r20_ohm_km'] = .0754
    converted = convert(s)
    arguments = ARGS if mode is None else {
        'mode': mode, 'alpha20_per_k': .00393, 'conductor_k_w_m_k': 380., 'metal_screen_k_w_m_k': 380.,
        'coefficient_basis': 'Synthetic reference fixture; no manufacturer data',
        'acknowledged_coefficient_model': True, 'domain_scale': 4, 'resolution': 16}
    cases = [{'case_id': 'v0', 'input': s, 'parameters': arguments},
             {'case_id': 'domain', 'input': converted['document'], 'parameters': {**converted['method_parameters'], **arguments}}]
    result = Executor().run('cablesim.native-reference', capability, cases)
    original, domain = result.cases
    assert original.status == domain.status == 'succeeded', (original.error, domain.error)
    for a, b in zip(original.results, domain.results):
        assert (a['key'], a['entity'], a['case'], a['status']) == (b['key'], b['entity'], b['case'], b['status'])
        if a['status'] == 'available':
            assert a['value'] == pytest.approx(b['value'], rel=1e-7, abs=1e-6)
    if mode:
        rating = next(r for r in domain.results if r['key'] == 'ampacity')
        summary = domain.artifacts['x-cablesim.native-bundle']['summary']
        if mode == 'ampacity':
            assert rating['value'] == summary['ampacity_a'] and rating['case'] == 'rating'
        else:
            assert rating['status'] == 'unavailable' and 'value' not in rating
            assert all(r['case'] == 'operating' for r in domain.results if r['key'] != 'ampacity')
        assert len([r for r in domain.results if r['key'].startswith('losses.')]) == 9


def test_converted_workspace_native_rating_replays_and_exports_saved_values(tmp_path, monkeypatch):
    with TestClient(create_app(tmp_path / 'domain.sqlite')) as client:
        w = client.post('/api/workspaces', json={}).json()
        workspace = f'/api/workspaces/{w["id"]}'
        edit = client.post(workspace + '/edit', json={'expected_revision': 1,
                           'changes': [{'path': 'cable.r20_ohm_km', 'value': .0754}]})
        assert edit.status_code == 200, edit.text
        conversion = client.post(workspace + '/domain/conversion', json={'expected_revision': 2})
        assert conversion.status_code == 200, conversion.text
        revision = conversion.json()['revision']
        method = next(p['method'] for p in client.get('/api/methods').json()
                      if p['method']['plugin_id'] == 'cablesim.native-reference')
        parameters = {**conversion.json()['conversion']['method_parameters'],
                      'mode': 'ampacity', 'alpha20_per_k': .00393,
                      'conductor_k_w_m_k': 380., 'metal_screen_k_w_m_k': 380.,
                      'coefficient_basis': 'Synthetic fixture for saved domain transport',
                      'acknowledged_coefficient_model': True, 'domain_scale': 4, 'resolution': 16}
        study = client.post(workspace + '/studies', json={'expected_revision': revision,
                            'title': '领域文档电热参考', 'input_source': 'domain',
                            'method': {**method, 'capability': 'electrothermal'}, 'parameters': parameters})
        assert study.status_code == 201, study.text
        root = workspace + '/studies/' + study.json()['id']
        pre = client.get(root + '/preflight', params={'expected_revision': revision, 'expected_study_revision': 1})
        assert pre.status_code == 200 and pre.json()['ready'], pre.text
        body = {'request_id': str(uuid4()), 'expected_revision': revision, 'expected_study_revision': 1,
                'scope_acknowledged': True, 'lock_digest': pre.json()['lock_digest']}
        response = client.post(root + '/runs', json=body)
        assert response.status_code == 200, response.text
        run = response.json()
        assert run['status'] == 'succeeded' and run['integrity'] == 'verified', run.get('error')
        assert run['snapshot']['cases'][0]['input'] == conversion.json()['document']
        rating = next(r for r in run['output']['cases'][0]['results'] if r['key'] == 'ampacity')
        assert rating['status'] == 'available' and rating['entity'] == 'circuit/c1'
        assert client.get(root + '/runs/' + run['id']).json()['output_digest'] == run['output_digest']

        def forbidden(*args, **kwargs):
            raise AssertionError('saved replay and delivery must not solve again')

        monkeypatch.setattr(client.app.state.research.executor, 'run', forbidden)
        assert client.post(root + '/runs', json=body).json()['id'] == run['id']
        delivery = client.post(workspace + '/deliveries', json={'run_ids': [run['id']]})
        assert delivery.status_code == 201, delivery.text
        assert str(rating['value']) in delivery.json()['html']
