"""Real sealed reference queries: exact published values, conditions and gaps."""
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app


@pytest.fixture(scope='module')
def client(tmp_path_factory):
    with TestClient(create_app(tmp_path_factory.mktemp('resources') / 'library.sqlite')) as client:
        yield client


def table(client, category, identifier):
    response = client.get('/api/library/resources/table', params={'category': category, 'table_id': identifier})
    assert response.status_code == 200, response.text
    return response.json()


def selection(table, row):
    return {'release_digest': table['release_digest'], 'data_sha256': table['data_sha256'],
            'standard': row['standard'], 'edition': row['edition'],
            'locator': row['table'] or row['clause'], 'quantity': row['quantity']['key'],
            'record_id': row['id'], 'conditions': row['conditions']}


def test_xlpe_value_cites_exact_real_source_and_sealed_method(client):
    result = table(client, 'materials', 'iec60287-2-1-table1')
    row = next(row for row in result['rows'] if row['id'] == 'iec60287-2-1-table1/r7/c1')
    # IEC 60287-2-1:2023 Table 1, original printed p.33 / CMV PDF p.89.
    assert (row['value'], row['quantity']['unit']) == (3.5, 'K·m/W')
    assert (row['printed_page'], row['pdf_page']) == (33, 89)
    assert row['source_sha256'] == 'a273d784ccf13b73915557c22ce3642c6c1bef94be6034ebd8237e8a7d997f52'
    assert row['verification']['status'] == 'verified'
    assert row['method_version'] == result['method']['method_version'] == '0.7.0'
    assert row['trust']['grade'] == 'reference' and row['selectable']
    assert len(row['record_sha256']) == len(result['artifact_sha256']) == 64
    selected = client.post('/api/library/resources/select', json=selection(result, row))
    assert selected.status_code == 200, selected.text
    receipt = selected.json()
    assert receipt['record']['record_sha256'] == row['record_sha256']
    assert receipt['record']['value'] == 3.5
    assert receipt['method']['plugin_id'] == 'cablesim.standards-basis'
    assert receipt['approval'] == 'not_granted' and receipt['applied_to_workspace'] is False


def test_environment_uses_all_original_conditions_and_never_infers_site_state(client):
    result = table(client, 'environment', 'iec60287-3-1-table2')
    assert [row['value'] for row in result['rows']] == [0.7, 1.0, 2.0, 3.0]
    row = result['rows'][0]
    assert row['conditions'] == {'national_reference': 'unavailable', 'soil_moisture': 'very_moist',
                                 'weather_pattern': 'continuous_moisture'}
    assert row['citation'] == 'IEC 60287-3-1—2017 Table 2，第 7 页（PDF 第 39 页）'
    request = selection(result, row)
    assert client.post('/api/library/resources/select', json=request).status_code == 200
    missing = deepcopy(request)
    missing['conditions'].pop('national_reference')
    assert client.post('/api/library/resources/select', json=missing).status_code == 422
    wrong = deepcopy(request)
    wrong['conditions']['soil_moisture'] = 'dry'
    assert client.post('/api/library/resources/select', json=wrong).status_code == 422
    assert client.get('/api/workspaces').json() == []


def test_literature_dash_and_stale_reference_are_rejected(client):
    result = table(client, 'materials', 'nielsen-Table1')
    row = next(row for row in result['rows'] if row['id'] == 'nielsen-Table1/r1/thermal')
    assert row['value'] is None and row['trust']['grade'] == 'unavailable'
    assert row['selectable'] is False
    assert client.post('/api/library/resources/select', json=selection(result, row)).status_code == 422
    usable = next(row for row in result['rows'] if row['id'] == 'nielsen-Table1/r1/capacity')
    assert usable['value'] == 3_460_000
    stale = {**selection(result, usable), 'release_digest': '0' * 64}
    assert client.post('/api/library/resources/select', json=stale).status_code == 409
    stale = {**selection(result, usable), 'data_sha256': '0' * 64}
    assert client.post('/api/library/resources/select', json=stale).status_code == 422


def test_catalogue_preserves_coverage_gaps_and_category_boundaries(client):
    response = client.get('/api/library/resources/catalogue', params={'category': 'manufacturing'})
    assert response.status_code == 200, response.text
    result = response.json()
    assert any(table['standard'].startswith('GB/T 12706') for table in result['tables'])
    assert not any(table['standard'].startswith('GB/T 18890') for table in result['tables'])
    assert result['not_covered'] and result['approval'] == 'not_granted'
    assert client.get('/api/library/resources/table', params={
        'category': 'materials', 'table_id': 'iec60287-3-1-table2'}).status_code == 404
    assert client.get('/api/library/resources/catalogue', params={'category': 'guessed'}).status_code == 422
