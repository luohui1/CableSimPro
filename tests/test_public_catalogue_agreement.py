"""All public sizes, real sealed methods, and the canonical upload workflow."""
from hashlib import sha256
from io import BytesIO
import json
from uuid import uuid4

from fastapi.testclient import TestClient
from openpyxl import load_workbook
import pytest

from backend.kernel.catalogue_agreement import reference_report
from backend.kernel.public_catalogues import (_data, catalogue_reference,
                                               match_sample, sample_bytes, sample_manifest)
from backend.kernel import factory_tables


def test_original_public_cells_and_units_survive_the_workbook():
    """Compare every original cell, including the manufacturer's printed anomaly."""
    samples = {item['id']: item for item in sample_manifest()}
    for name, count in (('people-mv', 46), ('bahra-mv', 13)):
        data = _data(name)
        raw = sample_bytes(name)
        book = load_workbook(BytesIO(raw), read_only=True, data_only=True)
        try:
            original_tables = data.get('tables') or [{'id': 'single-core', 'rows': data['rows']}]
            assert len(book.worksheets) == len(original_tables)
            total = 0
            for sheet, table, declaration in zip(book.worksheets, original_tables, samples[name]['declarations']):
                assert sheet.title == declaration['sheet']
                actual = list(sheet.iter_rows(min_row=5, max_row=4 + len(table['rows']), values_only=True))
                assert actual == [tuple(row) for row in table['rows']]
                total += len(actual)
            assert total == count
        finally:
            book.close()
        assert sha256(raw).hexdigest() == samples[name]['sha256']
        assert match_sample(samples[name]['sha256']) == samples[name]['declarations']
        assert match_sample(sha256(raw + b'changed').hexdigest()) == []
    # The unusual 17935 kg/km value really is printed in the YJY23 column.
    # It must not be shifted or replaced with a neighbouring size's weight.
    data = _data('people-mv')
    table = next(t for t in data['tables'] if t['id'] == 'three-core-steel-tape')
    assert table['rows'][0][8] == 17935
    assert data['source']['sha256'] == 'c60b53c188478b55f424f49ca31506c5f7c100d2c876f91aab65622e86ddba4a'


def test_sample_identity_is_reproducible_without_a_timestamp():
    first = {name: sample_bytes(name) for name in ('people-mv', 'bahra-mv')}
    sample_bytes.cache_clear()
    assert first == {name: sample_bytes(name) for name in first}


def test_csv_keeps_the_original_rows_and_locates_a_bad_cell():
    csv = sample_bytes('people-mv', 'csv', table='three-core-steel-tape')
    uploaded = factory_tables.read('人民结构表.csv', csv)
    rows, skipped = factory_tables.mapped_rows(uploaded, '人民结构表', 2,
                                              {'area': 0, 'conductor_diameter': 1, 'weight': 7})
    assert len(rows) == 11 and not skipped
    assert rows[0]['values'] == {'area': 25, 'conductor_diameter': 6, 'weight': 3164}
    changed = csv.decode('utf-8-sig').replace('25,6.0,', '25,错误值,', 1).encode('utf-8-sig')
    parsed = factory_tables.read('人民结构表.csv', changed)
    rows, _ = factory_tables.mapped_rows(parsed, '人民结构表', 2,
                                         {'area': 0, 'conductor_diameter': 1, 'weight': 7})
    assert rows[0]['issues'][0]['column'] == 'B2'
    assert rows[0]['issues'][0]['field'] == 'conductor_diameter'
    assert all(not row['issues'] for row in rows[1:])


@pytest.fixture(scope='module')
def agreement():
    return {name: reference_report(name) for name in ('people-mv', 'bahra-mv')}


def test_bahra_all_thirteen_sizes_use_real_methods_and_preserve_deviations(agreement):
    report = agreement['bahra-mv']
    assert len(report['rows']) == 13
    assert report['summary']['ampacity_compared'] == 13
    assert report['summary']['ampacity_refused'] == 0
    for row in report['rows']:
        metrics = row['metrics']
        assert metrics['outer_diameter']['difference'] == pytest.approx(0, abs=1e-10)
        assert metrics['r20']['difference'] == pytest.approx(0, abs=1e-10)
        assert metrics['outer_diameter']['status'] == metrics['r20']['status'] == 'declared_input'
        assert metrics['weight']['value'] is None and metrics['weight']['relative_difference'] is None
        assert metrics['weight']['published_status'] == 'published' and metrics['weight']['published'] > 0
        assert metrics['weight']['status'] == 'refused'
        rating = metrics['ampacity']
        assert rating['status'] == 'compared' and rating['method']['plugin_id'] == 'cablesim.iec60287'
        assert rating['method']['method_version'] and rating['method']['request_sha256']
        assert rating['tier']['tier'] == 'deliverable'
        # Existing Studio measured bounds, now applied to every listed size.
        assert abs(rating['relative_difference']) < (.04 if row['area_mm2'] >= 95 else .10)
        assert rating['reason'] and row['source']['sha256']
    smallest = report['rows'][0]['metrics']['ampacity']
    assert [row['metrics']['weight']['published'] for row in report['rows']] == [
        1300, 1450, 1730, 2020, 2470, 2800, 3270, 3720, 4570, 5390, 6660, 8070, 10070]
    assert smallest['published'] == 153
    assert smallest['value'] == pytest.approx(137.9927, abs=.001)
    assert report['human_reviewed'] is False


def test_people_every_size_keeps_real_refusals_and_missing_reference_values(agreement):
    report = agreement['people-mv']
    assert len(report['rows']) == 46
    assert report['summary']['ampacity_compared'] == 21
    assert report['summary']['ampacity_refused'] == 25
    for row in report['rows']:
        metrics = row['metrics']
        assert metrics['weight']['value'] is None
        assert metrics['r20']['published'] is None
        assert metrics['r20']['relative_difference'] is None
        assert metrics['r20']['reason']
        rating = metrics['ampacity']
        if rating['status'] == 'refused':
            assert rating['value'] is None and rating['relative_difference'] is None
            assert rating['reason'] and rating['tier'] is None
        else:
            assert abs(rating['relative_difference']) < .11
            assert rating['method']['manifest_sha256']
    known = next(row for row in report['rows'] if row['key'] == 'three-core-steel-tape-50')
    assert known['rating_error']['code'] == 'SL_FILLER_GEOMETRY_RANGE'
    assert known['metrics']['ampacity']['published'] == 217
    assert known['metrics']['ampacity']['value'] is None


def test_public_samples_import_into_canonical_models_without_synthetic_facts(tmp_path, monkeypatch, agreement):
    from backend.main import create_app
    from backend.kernel.type_versions import declared_execution_standards
    from frontend.scripts.catalogue_seed import import_public_catalogues, calculate_factory_series
    monkeypatch.setenv('CABLESIM_DATASETS_DIR', str(tmp_path / 'datasets'))
    monkeypatch.setenv('CABLESIM_REPRODUCTION_LIBRARY', str(tmp_path / 'library'))
    with TestClient(create_app(tmp_path / 'engineering.sqlite')) as client:
        receipts = import_public_catalogues(client)
        assert len(receipts) == 5
        assert sum(len(item['specs']) for item in receipts) == 59
        canonical = client.get('/api/domain-cable-models').json()
        for receipt in receipts:
            for saved in receipt['specs']:
                detail = client.get('/api/type-library/specs/' + saved['id']).json()
                spec = detail['spec']
                area = next(value['display_value'] for value in detail['values'] if value['key'] == 'area')
                published = catalogue_reference(receipt['sample_id'], receipt['sheet'], area)
                values = {value['key']: value for value in detail['values']}
                for key in ('outer_diameter', 'weight', 'r20', 'ampacity'):
                    if key in values and published[key] is not None:
                        assert values[key]['display_value'] == pytest.approx(published[key])
                        source = values[key]['source']
                        assert source['file_sha256'] == receipt['workbook_sha256']
                        assert source['sheet'] == receipt['sheet'] and source['row'] >= 5
                        assert source['catalogue']['sha256'] == published['source']['sha256']
                        assert values[key]['method']['version'] and values[key]['confidence'] == 'reference'
                assert spec['state'] == 'draft'
                model = next(item for item in canonical if item['id'] == saved['model_id'])
                assert model['payload']['confirmed'] is False
                if receipt['sample_id'] == 'bahra-mv':
                    assert model['payload']['specification']
                    assert detail['missing']
                    assert 'insulation_screen_thickness' not in values
                    assert not detail['results']
                else:
                    workspace = client.get('/api/workspaces/' + saved['workspace_id']).json()
                    declarations = declared_execution_standards(workspace['domain'])
                    assert {item['standard'] for item in declarations} == {'GB/T 12706.2—2020', 'GB/T 3956—2008'}
                    assert all(len(item['source_digest']) == 64 for item in declarations)
                    assert all(not source['reviewed'] for path, source in model['payload']['sources'].items()
                               if path != '/execution_standards')
                    assert values['r20']['source']['origin'] == 'standard'
                    assert values['r20']['source']['kind'] == 'standard'
                    reference = values['r20']['source']['reference']
                    assert reference['standard'] == 'GB/T 3956' and reference['edition'] == '2008'
                    assert reference['record']['value'] == values['r20']['display_value']
                    assert reference['data_sha256'] and reference['artifact_digest']
        calculated = calculate_factory_series(client, receipts)
        assert calculated['specifications'] == 11
        assert len(calculated['specification_drafts']) == 11
        for draft in calculated['specification_drafts']:
            assert draft['snapshot']['payload']['workspace_id'] == draft['workspace_id']
            assert draft['ready'] is False and draft['blockers']
            assert draft['snapshot']['lifecycle']['approval'] is None
            assert draft['generation']['status'] == 'blocked' and draft['generation']['channel'] == 'geometry'
            assert any(check['id'] == 'geometry/mass' for check in draft['blockers'])
            current = client.get(draft['endpoint']).json()
            assert current['digest'] == draft['digest']
            assert set(current['payload']['results']) >= {'standards', 'rating', 'geometry'}
            assert all(source['freshness'] == 'current' for source in current['payload']['sources'])
        assert len(calculated['generation_runs']) == 11
        expected = {row['area_mm2']: row['metrics']['ampacity']['value'] for row in agreement['people-mv']['rows']
                    if row['table'] == 'three-core'}
        assert len(calculated['check']['items']) == len(calculated['calculate']['items']) == 11
        for result in calculated['calculate']['items']:
            detail = client.get('/api/type-library/specs/' + result['spec_id']).json()
            area = next(item['display_value'] for item in detail['values'] if item['key'] == 'area')
            assert result['rows'][0]['value_a'] == pytest.approx(expected[area], abs=1e-5)
            assert any(run['id'] == result['run_id'] for run in detail['results'])
        # The display declaration must not alter the original PDF identity.
        assert receipts[0]['source']['dataset_manufacturer_label'] == '人民电缆集团'
        assert receipts[0]['source']['url'].startswith('https://www.chinapeople.com/')


def test_import_standard_selection_requires_an_exact_edition_and_human_confirmation(tmp_path, monkeypatch):
    from backend.main import create_app
    from backend.kernel.type_versions import declared_execution_standards
    monkeypatch.setenv('CABLESIM_DATASETS_DIR', str(tmp_path / 'datasets'))
    monkeypatch.setenv('CABLESIM_REPRODUCTION_LIBRARY', str(tmp_path / 'library'))
    with TestClient(create_app(tmp_path / 'selection.sqlite')) as client:
        uploaded = client.post('/api/type-library/imports/upload', files={
            'file': ('people-mv.xlsx', sample_bytes('people-mv'))}).json()
        declaration = next(item for item in uploaded['declarations'] if item['table'] == 'three-core')
        declaration['series']['standards'] += ['GB/T 3956', 'GB/T 3956—2099']
        response = client.post('/api/type-library/imports/preview', json={
            'upload_id': uploaded['upload_id'], **{key: declaration[key] for key in
                ('sheet', 'first_data_row', 'mapping', 'series')}})
        assert response.status_code == 200, response.text
        preview = response.json()
        selection = preview['execution_standards']
        assert {item['declared'] for item in selection['missing']} == {'GB/T 3956', 'GB/T 3956—2099'}
        assert {item['standard']: item['source_digest'] for item in selection['items']} == {
            'GB/T 12706.2—2020': '3b5fa321c213d4aaac7e04a293b9026626f43cc5b15209b26b713172e56f748d',
            'GB/T 3956—2008': 'b9a118e1282b4eeee6ec6ae4653e8c80e0a42beee0df5bf84360c4876a856939'}
        assert all(item['evidence']['artifact_digest'] and item['method']['release_digest'] for item in selection['items'])
        assert all('/execution_standards' not in row['payload']['sources'] for row in preview['rows'])
        body = {'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'],
                'request_id': str(uuid4()), 'human_confirmed': True, 'skip_errors': False}
        assert client.post('/api/type-library/imports/commit', json=body,
                           headers={'X-CableSim-Actor': 'agent'}).status_code == 403
        response = client.post('/api/type-library/imports/commit', json=body,
                               headers={'X-CableSim-Actor': 'human'})
        assert response.status_code == 201, response.text
        spec = response.json()['specs'][0]
        workspace = client.get('/api/workspaces/' + spec['workspace_id']).json()
        source = workspace['domain']['provenance']['/execution_standards']
        assert json.loads(source['reference'])['selection'] == selection
        assert len(declared_execution_standards(workspace['domain'])) == 2
        snapshot = client.get('/api/types/' + spec['workspace_id'] + '/specification').json()
        assert snapshot['lifecycle']['approval'] is None and snapshot['ready'] is False
