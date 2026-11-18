"""Actual JavaScript JSON transport of sealed IEC 60949 references and studies."""
import json
import shutil
import subprocess
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.kernel.requirements import lookup_references
from backend.kernel.scenarios import system_models
from tests.test_type_electrical import plugin, PUBLIC
from cablesim_type_electrical.short_basis import queries, record


def browser_json_text(value):
    node = shutil.which('node')
    if node is None:
        pytest.skip('This transport regression requires actual JavaScript; the browser CI also exercises it.')
    program = "let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>raw+=s);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(raw))));"
    result = subprocess.run([node, '-e', program], input=json.dumps(value, ensure_ascii=False),
                            text=True, capture_output=True, check=True, timeout=20)
    return result.stdout


def browser_json(value):
    return json.loads(browser_json_text(value))


@pytest.fixture(scope='module')
def references(tmp_path_factory):
    with TestClient(create_app(tmp_path_factory.mktemp('short-basis')/'source.sqlite')) as client:
        values, missing = lookup_references(client.app.state.research, queries())
        assert not missing
        assert len(values) == 30
        return values


def test_real_issued_references_survive_javascript_without_resigning(references):
    transported = browser_json(references)
    changed = [key for key in references if type(references[key]['record']['value']) is float
               and type(transported[key]['record']['value']) is int]
    assert changed == [f'sc-material-constants/r{i}/sigma_c' for i in range(1, 7)]
    for key, original in references.items():
        validated = record({'basis_references': transported}, key)
        assert validated['record_sha256'] == original['record_sha256']
        assert validated['record']['record_sha256'] == original['record']['record_sha256']
        assert validated['record'] == original['record']
    parameters = {'cable_type_id': 'cable_type/public', 'duration_s': 1,
                  'initial_temperature_k': 363.15, 'final_temperature_k': 523.15,
                  'sources': {key: 'Explicit regression scenario, not a factory measurement'
                              for key in ('duration_s', 'initial_temperature_k', 'final_temperature_k')}}
    before = plugin.calculate(PUBLIC[0]['input'], {**parameters, 'basis_references': references}, 'short-circuit')
    after = plugin.calculate(PUBLIC[0]['input'], {**parameters, 'basis_references': transported}, 'short-circuit')
    assert after['rows'] == before['rows']
    assert after['curve'] == before['curve']


@pytest.mark.parametrize('change', ['value', 'boolean', 'string', 'unit', 'source', 'version', 'digest', 'wrapper_source', 'wrapper_page'])
def test_transport_identity_rejects_changed_values_and_provenance(references, change):
    values = browser_json(references)
    key = 'sc-material-constants/r1/sigma_c'
    ref = values[key]
    if change == 'value': ref['record']['value'] += 1
    elif change == 'boolean': ref['record']['value'] = True
    elif change == 'string': ref['record']['value'] = str(ref['record']['value'])
    elif change == 'unit': ref['record']['quantity']['unit'] = 'J/(kg·K)'
    elif change == 'source': ref['record']['source_sha256'] = '0'*64
    elif change == 'version': ref['plugin_version'] = '0.9.1'
    elif change == 'digest': ref['record_sha256'] = '0'*64
    elif change == 'wrapper_source': ref['source_sha256'] = '0'*64
    elif change == 'wrapper_page': ref['pdf_page'] += 1
    with pytest.raises(ValueError, match='已封签'):
        record({'basis_references': values}, key)


def test_real_api_query_save_read_resave_preflight_and_run_after_javascript(tmp_path):
    with TestClient(create_app(tmp_path/'workspace.sqlite')) as client:
        # This teaching model explicitly declares copper_bare. A material's
        # display label alone must never supply the missing standard category.
        model = next(item for item in system_models() if item['id'] == 'system.specification-cu-xlpe-al-400')
        response = client.post('/api/design/type-workspaces', json={
            'model_id': model['id'], 'content_sha256': model['content_sha256']})
        assert response.status_code == 201, response.text[:800]
        workspace = response.json()
        conditions = {'duration_s': 1, 'initial_temperature_k': 363.15, 'final_temperature_k': 523.15}
        response = client.post('/api/types/'+workspace['id']+'/short-circuit-basis', json={
            'request_id': str(uuid4()), 'expected_revision': workspace['revision'],
            'parameters': {**conditions, 'cable_type_id': workspace['domain']['cable_types'][0]['id'],
                           'sources': {key: '明确的往返回归工况，非厂家试验结果' for key in conditions}}})
        assert response.status_code == 200, response.text
        basis = response.json()
        assert not basis['missing']
        parameters = browser_json(basis['parameters'])
        assert type(parameters['basis_references']['sc-material-constants/r1/sigma_c']['record']['value']) is int
        method = next(item['method'] for item in client.get('/api/methods').json()
                      if item['method']['plugin_id'] == 'cablesim.type-electrical')
        method = {**method, 'capability': 'short-circuit'}
        root = '/api/workspaces/'+workspace['id']
        definition = {'title': '浏览器短路依据往返', 'input_source': 'domain', 'method': method, 'parameters': parameters}
        # Send the literal bytes produced by JavaScript JSON.stringify, as the
        # real page does, instead of letting TestClient reserialize Python JSON.
        actual_post = browser_json_text({**definition, 'expected_revision': workspace['revision']})
        assert actual_post.count('"record_sha256"') >= 30
        assert '"value":3450000.0' not in actual_post
        assert '"value":3450000' in actual_post
        saved = client.post(root+'/studies', content=actual_post.encode('utf-8'),
                            headers={'content-type': 'application/json'})
        assert saved.status_code == 201, saved.text[:800]
        study = saved.json()
        route = root+'/studies/'+study['id']
        loaded = client.get(route)
        assert loaded.status_code == 200, loaded.text
        loaded = browser_json(loaded.json())
        assert loaded['definition']['parameters']['basis_references'] == parameters['basis_references']
        actual_resave = browser_json_text({**loaded['definition'], 'expected_revision': workspace['revision'],
                                           'expected_study_revision': loaded['revision']})
        response = client.put(route, content=actual_resave.encode('utf-8'),
                              headers={'content-type': 'application/json'})
        assert response.status_code == 200, response.text
        study = response.json()
        preflight = client.get(route+'/preflight', params={
            'expected_revision': workspace['revision'], 'expected_study_revision': study['revision']})
        assert preflight.status_code == 200, preflight.text
        assert preflight.json()['ready'], preflight.text
        request = {'request_id': str(uuid4()), 'expected_revision': workspace['revision'],
                   'expected_study_revision': study['revision'], 'lock_digest': preflight.json()['lock_digest'],
                   'scope_acknowledged': True}
        run = client.post(route+'/runs', json=request)
        assert run.status_code == 200, run.text
        run = run.json()
        assert run['status'] == 'succeeded', run
        artifact = run['output']['cases'][0]['artifacts']['x-cablesim.type-short-circuit']
        conductor = next(row for row in artifact['rows'] if row['id'].endswith(':conductor-adiabatic'))
        assert conductor['value'] == pytest.approx(57233.40266460442, abs=1e-6), conductor
        assert run['snapshot']['definition']['parameters']['basis_references'] == parameters['basis_references']
