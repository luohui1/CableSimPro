"""Published reference quantities through the existing local asset HTTP API.

These are source-preserving resource drafts, not approved material properties or
an assertion that selecting a reference changes an engineering workspace.
"""
import json

from fastapi.testclient import TestClient
import pytest

from backend.foundation.contracts import Quantity
from backend.main import create_app


CASES = [
    ('huang-TableA1', 'huang-TableA1/r1/density', 'mass_density', 'kg/m³', 8889, 'kg/m3'),
    ('iec60287-1-1-table1', 'iec60287-1-1-table1/r1/c1', 'resistivity', 'Ω·m', 1.7241e-8, 'ohm.m'),
    ('nielsen-Table1', 'nielsen-Table1/r1/capacity', 'volumetric_heat_capacity', 'J/(m³·K)', 3460000, 'J/(m3.K)'),
    ('iec60287-1-1-table3', 'iec60287-1-1-table3/r1/relative_permittivity', 'dimensionless', '1', 4, '1'),
]


@pytest.fixture(scope='module')
def client(tmp_path_factory):
    with TestClient(create_app(tmp_path_factory.mktemp('resource-quantities')/'assets.sqlite')) as client:
        yield client


@pytest.mark.parametrize('table_id,record_id,dimension,unit,expected,si_unit', CASES)
def test_real_reference_quantity_import_and_read_preserve_source(
        client, table_id, record_id, dimension, unit, expected, si_unit):
    response = client.get('/api/library/resources/table', params={'category': 'materials', 'table_id': table_id})
    assert response.status_code == 200, response.text
    table = response.json()
    row = next(row for row in table['rows'] if row['id'] == record_id)
    assert (row['quantity']['dimension'], row['quantity']['unit'], row['value']) == (dimension, unit, expected)
    response = client.post('/api/library/resources/select', json={
        'release_digest': table['release_digest'], 'data_sha256': table['data_sha256'],
        'standard': row['standard'], 'edition': row['edition'], 'locator': row['table'] or row['clause'],
        'quantity': row['quantity']['key'], 'record_id': record_id, 'conditions': row['conditions']})
    assert response.status_code == 200, response.text
    selected = response.json()
    assert selected['record']['record_sha256'] == row['record_sha256']
    assert selected['approval'] == 'not_granted' and selected['applied_to_workspace'] is False
    source = (row['citation'] + '; source_sha256:' + row['source_sha256']
              + '; record_sha256:' + row['record_sha256'] + '; method:'
              + selected['method']['plugin_id'] + '@' + selected['method']['method_version']
              + '; release_digest:' + selected['release_digest'])
    quantity = {'value': row['value'], 'unit': unit, 'dimension': dimension}
    release = {'asset_id': 'reference.quantity.'+dimension, 'version': '1.0.0', 'kind': 'material',
               'name': row['quantity']['name']+' · 明确选择的资料参考',
               'parameters': [{'name': row['quantity']['key'], 'quantity': quantity}],
               'sources': [{'kind': 'project_input', 'reference': source, 'reviewed': False},
                           {'kind': 'project_input', 'reviewed': False, 'reference': json.dumps({
                               'record_id': record_id, 'conditions': row['conditions'],
                               'usage': 'reference_only'}, ensure_ascii=False)}]}
    response = client.post('/api/foundation/assets/import', json={'schema_version': 'csp-asset/0.1', 'release': release})
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved['status'] == 'draft' and saved['applied_to_workspace'] is False
    response = client.get('/api/foundation/assets/'+saved['id'])
    assert response.status_code == 200, response.text
    loaded = response.json()
    assert loaded['content_sha256'] == saved['content_sha256']
    assert loaded['release']['parameters'][0]['quantity'] == quantity
    assert loaded['release']['sources'] == release['sources']
    assert loaded['reviewed_sha256'] is None and loaded['status'] == 'draft'
    si = Quantity.model_validate(loaded['release']['parameters'][0]['quantity']).si()
    assert (si.value, si.unit, si.dimension) == (expected, si_unit, dimension)
    assert si.si() == si
    assert client.get('/api/workspaces').json() == []


def draft_quantity(dimension, unit, value):
    return {'schema_version': 'csp-asset/0.1', 'release': {
        'asset_id': 'contract.rejected.'+dimension, 'version': '1.0.0', 'kind': 'material',
        'name': 'Quantity contract rejection only; not engineering data',
        'parameters': [{'name': 'quantity_probe', 'quantity': {'dimension': dimension, 'unit': unit, 'value': value}}],
        'sources': [{'kind': 'project_input', 'reference': 'Negative contract test; never adopted', 'reviewed': False}]}}


@pytest.mark.parametrize('dimension,unit', [
    ('mass_density', 'Ω·m'), ('resistivity', 'ohm/m'),
    ('volumetric_heat_capacity', 'J/(kg.K)'), ('dimensionless', 'K'),
])
def test_different_physical_quantities_cannot_share_units(client, dimension, unit):
    response = client.post('/api/foundation/assets/import', json=draft_quantity(dimension, unit, 1.0))
    assert response.status_code == 422
    assert any(error['loc'] == ['body', 'release', 'parameters', 0, 'quantity']
               and 'UNIT_DIMENSION_MISMATCH' in error['msg'] for error in response.json()['detail'])


@pytest.mark.parametrize('value', [True, '1'])
@pytest.mark.parametrize('dimension,unit', [(item[2], item[3]) for item in CASES])
def test_new_quantity_dimensions_keep_strict_numeric_inputs(client, dimension, unit, value):
    response = client.post('/api/foundation/assets/import', json=draft_quantity(dimension, unit, value))
    assert response.status_code == 422
    assert any(error['loc'] == ['body', 'release', 'parameters', 0, 'quantity', 'value']
               and error['type'] == 'float_type' for error in response.json()['detail'])
