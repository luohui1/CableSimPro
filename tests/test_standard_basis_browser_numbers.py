"""Actual JavaScript JSON transport of sealed product-standard basis references.

The type page posts the basis returned by /requirements/basis back through
JSON.parse/JSON.stringify, which writes the rated voltage 8700.0 as 8700. The
standard check must treat that exactly equal value as the same query, and still
refuse a changed number, a boolean or a string in its place.
"""
import json
from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.plugin_host.executor import Executor
import test_standard_check  # noqa: F401  Loads the sealed plugin entry, which puts its package on the import path.
from test_standards_basis import library_module
from tests.test_short_basis_browser_numbers import browser_json
from cablesim_standard_check.basis import BasisIntegrityError, digest, same_query, validate, validate_list

REQUEST = {'schema_version': 'cablesim.cable-design-request/2', 'voltage': '8700/15000', 'area_m2': 240e-6,
           'construction': 'three_core', 'conductor': 'copper_bare', 'form': 'solid_round', 'generation_mode': 'complete',
           'screened': 'yes', 'armour': 'steel_tape', 'gap_m': 0, 'conductor_screen_thickness_m': .0007,
           'insulation_screen_thickness_m': .0007, 'screen_tape_thickness_m': .0001, 'screen_tape_width_m': .1}


@pytest.fixture(scope='module', params=['8700/15000', '26000/35000'])
def scenario(tmp_path_factory, request):
    # 26/35 kV with lapped copper tape also reaches the GB/T 12706.3 表 A.2 list, whose
    # sealed records carry integral floats themselves.
    with TestClient(create_app(tmp_path_factory.mktemp('standard-basis-browser') / 'source.sqlite')) as client:
        proposal = client.post('/api/types/creation-proposals', json={'request_id': str(uuid4()),
                                                                      'input': {**REQUEST, 'voltage': request.param}})
        assert proposal.status_code == 200, proposal.text
        proposal = proposal.json()
        saved = client.post('/api/types', json={'request_id': str(uuid4()), 'origin': 'standard', 'name': '浏览器传输标准核对',
                                               'proposal_id': proposal['id'], 'content_sha256': proposal['content_sha256'],
                                               'human_confirmed': True}, headers={'X-CableSim-Actor': 'human'})
        assert saved.status_code == 201, saved.text
        saved = saved.json()
        basis = client.post(f"/api/design/type-workspaces/{saved['id']}/requirements/basis",
                            json={'request_id': str(uuid4()), 'expected_revision': saved['revision']})
        assert basis.status_code == 200, basis.text
        yield client, saved, basis.json()['parameters']


def run(document, parameters):
    return Executor().run('cablesim.standard-check', 'dimensions', [{'case_id': 'browser', 'input': document,
        'parameters': {'cable_type_id': document['cable_types'][0]['id'], **parameters}}]).cases[0]


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


def rewritten(parameters, transported):
    return [key for key, ref in parameters['basis_references'].items() if isinstance(ref, dict) and 'query' in ref
            and canonical(ref['query']) != canonical(transported['basis_references'][key]['query'])]


def method(client):
    catalog = client.get('/api/methods?view=summary')
    assert catalog.status_code == 200, catalog.text
    for item in catalog.json():
        for capability in item.get('capabilities', []):
            if capability.get('input_schema') == 'cablesim.domain/1' and any(
                    artifact.get('type') == 'x-cablesim.standard-check' for artifact in capability.get('artifacts', [])):
                return {**item['method'], 'capability': capability['id']}
    raise AssertionError('standard check method is not installed')


def test_browser_transported_basis_gives_the_same_standard_check(scenario):
    client, saved, parameters = scenario
    transported = browser_json(parameters)
    changed = rewritten(parameters, transported)
    # The rated voltages of the insulation queries (8700.0 V) are among the values a browser rewrites.
    assert any(key.endswith(':insulation-nominal') for key in changed), changed
    before, after = run(saved['domain'], parameters), run(saved['domain'], transported)
    assert before.status == 'succeeded', before.error
    assert after.status == 'succeeded', after.error
    assert after.artifacts['x-cablesim.standard-check']['rows'] == before.artifacts['x-cablesim.standard-check']['rows']

    # The same body through the host, as the type page sends it: study, preflight, confirmed run.
    wid, revision = saved['id'], saved['revision']
    study = client.post(f'/api/workspaces/{wid}/studies', json={
        'title': '浏览器传输标准核对', 'input_source': 'domain', 'method': method(client), 'input_sources': {},
        'parameters': {'cable_type_id': saved['domain']['cable_types'][0]['id'], **transported},
        'expected_revision': revision})
    assert study.status_code in (200, 201), study.text
    study = study.json()
    preflight = client.get(f"/api/workspaces/{wid}/studies/{study['id']}/preflight",
                           params={'expected_revision': revision, 'expected_study_revision': study['revision']})
    assert preflight.status_code == 200 and preflight.json()['ready'], preflight.text
    response = client.post(f"/api/workspaces/{wid}/studies/{study['id']}/runs", json={
        'request_id': str(uuid4()), 'expected_revision': revision, 'expected_study_revision': study['revision'],
        'lock_digest': preflight.json()['lock_digest'], 'scope_acknowledged': True})
    assert response.status_code in (200, 201, 202), response.text
    saved_run = response.json()
    if saved_run['status'] not in ('succeeded', 'partial', 'failed'):
        saved_run = client.get(f"/api/workspaces/{wid}/studies/{study['id']}/runs/{saved_run['id']}").json()
    assert saved_run['status'] == 'succeeded' and saved_run['integrity'] == 'verified', saved_run.get('error')


def test_query_identity_equates_only_exactly_integral_floats():
    def same(saved, own):
        return same_query({'query': saved, 'query_sha256': digest(own)}, own)
    assert same({'x': 1}, {'x': 1.0}) and same({'x': 1.0}, {'x': 1}) and same({'x': [2]}, {'x': [2.0]})
    assert not same({'x': True}, {'x': 1}) and not same({'x': 1}, {'x': True})
    assert not same({'x': 1.5}, {'x': 1}) and not same({'x': '1'}, {'x': 1}) and not same({'x': 2}, {'x': 1.0})


Q = lambda **kw: {'schema_version': 'cablesim.standards-query/1', **kw}
# Sealed records that themselves carry integral floats, reached by real method queries:
# class 5 conductor resistance (GB/T 3956 表 3), the 26/35 kV lapped-screen annex list
# (GB/T 12706.3 表 A.2) and a 220 kV oversheath with a declared ST2 compound.
RECORD_CASES = {
    'r20-class-5': (Q(standard='GB/T 3956', edition='2008', locator='表 3', quantity='resistance_20_max',
                      conditions={'area_m2': 240e-6, 'conductor_class': 5, 'conductor_material': 'copper', 'coating': 'plain'}), False),
    'annex-a2-26-35kv': (Q(standard='GB/T 12706.3', edition='2020', locator='表 A.2', operation='list'), True),
    'ehv-oversheath-st2': (Q(standard='GB/T 18890.2', edition='2015', locator='6.7.2', quantity='oversheath_nominal',
                             conditions={'area_m2': 0.0008, 'u0_v': 127000.0, 'u_v': 220000.0, 'conductor_material': 'copper',
                                         'insulation': 'XLPE', 'sheath_compound': 'ST2'}), False),
}


@pytest.fixture(scope='module')
def library():
    return library_module.BasisLibrary()


def issued(library, query):
    """The reference fields the host copies from the data release (backend/kernel/requirements.py)."""
    answer = library.query(query)
    assert answer['status'] in ('resolved', 'listed'), answer
    if answer['status'] == 'listed':
        return {'schema': 'cablesim.standard-basis-list-ref/1', 'query': query, 'plugin_version': answer['plugin_version'],
                'data_sha256': answer['data_sha256'], 'query_sha256': answer['query_sha256'], 'records': answer['records']}
    record = answer['records'][0]
    return {'schema': 'cablesim.standard-basis-ref/1', 'plugin_id': answer['plugin_id'], 'plugin_version': answer['plugin_version'],
            'data_sha256': answer['data_sha256'], 'query_sha256': answer['query_sha256'], 'query': query, 'record_id': record['id'],
            'record_sha256': record['record_sha256'], 'standard': record['standard'], 'edition': record['edition'],
            'locator': record['table'] or record['clause'], 'printed_page': record['printed_page'], 'pdf_page': record['pdf_page'],
            'source_sha256': record['source_sha256'], 'record': record}


def integral_float_paths(value, path=''):
    if isinstance(value, dict):
        return [found for key, item in value.items() for found in integral_float_paths(item, f'{path}/{key}')]
    if isinstance(value, list):
        return [found for index, item in enumerate(value) for found in integral_float_paths(item, f'{path}/{index}')]
    return [path] if type(value) is float and value.is_integer() else []


@pytest.mark.parametrize('name', RECORD_CASES)
def test_sealed_records_with_integral_numbers_survive_browser_transport(library, name):
    query, listed = RECORD_CASES[name]
    gate = validate_list if listed else validate
    reference = issued(library, query)
    records = reference['records'] if listed else [reference['record']]
    floats = [path for record in records for path in integral_float_paths(record)]
    assert floats, 'this case must exercise record content that a browser rewrites'
    moved = browser_json(reference)
    assert canonical(moved) != canonical(reference)
    gate(reference, query)
    gate(moved, query)
    # The same transported record with one of those numbers changed is still refused.
    tampered = deepcopy(moved)
    index, path = next((index, path) for index, record in enumerate(records) for path in integral_float_paths(record))
    holder = tampered['records'][index] if listed else tampered['record']
    *parents, last = [part for part in path.split('/') if part]
    for part in parents:
        holder = holder[int(part)] if isinstance(holder, list) else holder[part]
    holder[int(last) if isinstance(holder, list) else last] += 1
    with pytest.raises(BasisIntegrityError):
        gate(tampered, query)


@pytest.mark.parametrize('change', ['value', 'boolean', 'string'])
def test_equal_numbers_never_admit_a_different_query(scenario, change):
    client, saved, parameters = scenario
    transported = browser_json(parameters)
    key = next(key for key in rewritten(parameters, transported))
    conditions = transported['basis_references'][key]['query']['conditions']
    voltage = conditions['u0_v']
    conditions['u0_v'] = {'value': voltage + 1, 'boolean': True, 'string': str(voltage)}[change]
    case = run(saved['domain'], transported)
    message = case.error.get('message', '') if isinstance(case.error, dict) else str(case.error)
    assert case.status != 'succeeded' and '查询身份' in message, (case.status, message)
