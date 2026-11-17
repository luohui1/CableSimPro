"""All public sizes, real sealed methods, and the canonical upload workflow."""
from hashlib import sha256
from io import BytesIO
import json
from uuid import uuid4

from fastapi.testclient import TestClient
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
import pytest

from backend.kernel.catalogue_agreement import reference_report
from backend.kernel.public_catalogues import (_data, catalogue_reference,
                                               match_sample, sample_bytes, sample_manifest)
from backend.kernel import factory_tables


# In the published PDF / workbook order, with independently stated SI factors.
BAHRA_FACT_COLUMNS = [
    ('area', 'mm²', 'm2', 1e-6), ('conductor_diameter', 'mm', 'm', 1e-3),
    ('insulation_thickness', 'mm', 'm', 1e-3), ('metallic_sheath_thickness', 'mm', 'm', 1e-3),
    ('oversheath_thickness', 'mm', 'm', 1e-3), ('outer_diameter', 'mm', 'm', 1e-3),
    ('weight', 'kg/km', 'kg/m', 1e-3), ('r20', 'Ω/km', 'ohm/m', 1e-3),
    ('r_ac_90', 'Ω/km', 'ohm/m', 1e-3), ('inductance', 'mH/km', 'H/m', 1e-6),
    ('capacitance', 'uF/km', 'F/m', 1e-9), ('short_circuit_conductor', 'kA', 'A', 1e3),
    ('short_circuit_sheath', 'kA', 'A', 1e3), ('ampacity', 'A', 'A', 1),
    ('rating_ground_flat', 'A', 'A', 1), ('rating_air_trefoil', 'A', 'A', 1),
    ('rating_air_flat', 'A', 'A', 1), ('voltage_drop', 'V/(A km)', 'V/(A m)', 1e-3),
    ('minimum_bending_radius', 'mm', 'm', 1e-3),
]
BAHRA_STRUCTURE_KEYS = {'conductor_diameter', 'insulation_thickness', 'metallic_sheath_thickness',
                        'oversheath_thickness', 'outer_diameter', 'weight', 'r20'}


def assert_bahra_facts(values, row, row_number, workbook_digest, data):
    facts = {fact['key']: fact for fact in values}
    assert len(values) == len(facts) == len(row) == 19
    assert set(facts) == {key for key, *_ in BAHRA_FACT_COLUMNS}
    for index, ((key, display_unit, unit, factor), original) in enumerate(zip(BAHRA_FACT_COLUMNS, row), 1):
        fact = facts[key]
        assert fact['display_value'] == original
        assert fact['display_unit'] == display_unit and fact['unit'] == unit
        assert fact['value'] == pytest.approx(original * factor, rel=1e-14, abs=0)
        assert fact['method'] == {'name': '厂家结构表导入', 'version': '1.1.0'}
        assert fact['confidence'] == 'reference'
        source = fact['source']
        assert source['file_sha256'] == workbook_digest
        assert source['sheet'] == 'Bahra CU XLPE LC PVC'
        assert source['row'] == row_number and source['column'] == get_column_letter(index)
        assert source['field'] == key and source['origin'] == 'table'
        assert source['kind'] == 'manufacturer' and source['reviewed'] is False
        assert source['method'] == fact['method'] and source['confidence'] == 'reference'
        assert source['catalogue'] == data['source']
        if key not in {'area', *BAHRA_STRUCTURE_KEYS}:
            assert fact['usage'] == source['usage'] == 'catalogue_result'
            assert source['conditions'] == data['conditions']
        else:
            assert 'usage' not in fact and 'usage' not in source


@pytest.mark.parametrize('exchange_format', ['json', 'xlsx'])
def test_bahra_all_published_columns_survive_import_and_two_database_exchange(tmp_path, monkeypatch, exchange_format):
    """The original 13 rows are evidence, including unsupported performance outputs."""
    from backend.main import create_app
    from backend.kernel.type_library_exchange import parse_file, validate_bundle
    monkeypatch.setenv('CABLESIM_DATASETS_DIR', str(tmp_path / 'datasets'))
    monkeypatch.setenv('CABLESIM_REPRODUCTION_LIBRARY', str(tmp_path / 'library'))
    data = _data('bahra-mv')
    assert data['source']['sha256'] == '6c0d7cf7e92a7292d3b1c3a0ed07a956ac17005c2918c1debd6234c7c155243a'
    with TestClient(create_app(tmp_path / 'first.sqlite')) as first, TestClient(create_app(tmp_path / 'second.sqlite')) as second:
        original = first.get('/api/type-library/samples/bahra-mv.xlsx')
        assert original.status_code == 200
        workbook_digest = sha256(original.content).hexdigest()
        # ZIP bytes may differ across compression runtimes. Bind this exact
        # downloaded original, whose immutable PDF source is checked above.
        manifest = first.get('/api/type-library/samples').json()
        assert workbook_digest == next(sample['sha256'] for sample in manifest if sample['id'] == 'bahra-mv')
        assert original.content == sample_bytes('bahra-mv')
        uploaded = first.post('/api/type-library/imports/upload', files={'file': ('bahra-mv.xlsx', original.content)})
        assert uploaded.status_code == 201, uploaded.text
        upload = uploaded.json()
        declaration = upload['declarations'][0]
        assert declaration['mapping'] == {key: index for index, (key, *_) in enumerate(BAHRA_FACT_COLUMNS)}
        assert {column['suggested'] for column in upload['sheets'][0]['columns']} >= {key for key, *_ in BAHRA_FACT_COLUMNS}
        response = first.post('/api/type-library/imports/preview', json={'upload_id': upload['upload_id'],
            **{key: declaration[key] for key in ('sheet', 'first_data_row', 'mapping', 'series')}})
        assert response.status_code == 200, response.text
        preview = response.json()
        assert preview['error_count'] == 0 and preview['valid_count'] == preview['incomplete_count'] == 13
        for row_number, (item, row) in enumerate(zip(preview['rows'], data['rows']), 5):
            assert_bahra_facts(item['values'], row, row_number, workbook_digest, data)
            assert set(item['payload']['specification']['values']) == BAHRA_STRUCTURE_KEYS
            assert item['status'] == 'incomplete' and item['missing']
            assert not any(key in missing for missing in item['missing'] for key in
                           {key for key, *_ in BAHRA_FACT_COLUMNS} - {'area', *BAHRA_STRUCTURE_KEYS})
            for fact in item['values']:
                assert json.loads(item['payload']['sources'][fact['key']]['reference']) == fact['source']
        saved = first.post('/api/type-library/imports/commit', headers={'X-CableSim-Actor': 'human'}, json={
            'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'],
            'request_id': str(uuid4()), 'human_confirmed': True, 'skip_errors': False})
        assert saved.status_code == 201, saved.text
        committed = saved.json()
        assert len(committed['specs']) == 13
        for row_number, (spec, row) in enumerate(zip(committed['specs'], data['rows']), 5):
            detail = first.get('/api/type-library/specs/' + spec['id']).json()
            assert_bahra_facts(detail['values'], row, row_number, workbook_digest, data)
            assert detail['spec']['state'] == 'draft' and detail['missing'] and detail['results'] == []
        models = {model['id']: model['payload'] for model in first.get('/api/domain-cable-models').json()}
        for spec in committed['specs']:
            assert set(models[spec['model_id']]['specification']['values']) == BAHRA_STRUCTURE_KEYS
            assert models[spec['model_id']]['cable_type'] is None
        exported = first.post('/api/type-library/exchange/export', json={
            'series_ids': [committed['series_id']], 'format': exchange_format})
        assert exported.status_code == 200, exported.text[:1000]
        bundle = parse_file('types.' + exchange_format, exported.content, validator=validate_bundle)
        from base64 import b64decode
        assert b64decode(bundle['files'][0]['content_base64']) == original.content
        assert bundle['series'][0]['declaration']['reference']['conditions'] == data['conditions']
        transfer = {'file': ('types.' + exchange_format, exported.content)}
        checked = second.post('/api/type-library/exchange/preview', files=transfer)
        assert checked.status_code == 200, checked.text
        assert checked.json()['original_file_count'] == 1 and checked.json()['series'][0]['spec_count'] == 13
        imported = second.post('/api/type-library/exchange/import', files=transfer,
            headers={'X-CableSim-Actor': 'human'}, data={'reviewed_sha256': checked.json()['file_sha256'],
                'confirmed': 'true', 'request_id': str(uuid4())})
        assert imported.status_code == 201, imported.text
        assert imported.json()['created'] == 13 and imported.json()['state'] == 'draft'
        series = second.get('/api/type-library/series/' + imported.json()['series'][0]['series_id']).json()
        assert series['declaration']['reference'] == declaration['series']['reference']
        models = {model['id']: model['payload'] for model in second.get('/api/domain-cable-models').json()}
        for row_number, (spec, row) in enumerate(zip(series['specs'], data['rows']), 5):
            detail = second.get('/api/type-library/specs/' + spec['id']).json()
            assert_bahra_facts(detail['values'], row, row_number, workbook_digest, data)
            assert detail['values'] == preview['rows'][row_number - 5]['values']
            assert set(models[spec['model_id']]['specification']['values']) == BAHRA_STRUCTURE_KEYS
            assert detail['spec']['state'] == 'draft' and detail['results'] == []
        report = second.post('/api/type-library/catalogue-comparison/bahra-mv', json={}).json()
        assert len(report['rows']) == 13 and all(len(row['metrics']) == 4 for row in report['rows'])
        assert report['summary']['ampacity_refused'] == 13
        assert report['summary']['ampacity_compared'] == report['summary']['four_metric_passed'] == 0
        assert report['reference_calculation'] is None


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
    return {name: reference_report(name, reference_scenario_confirmed=True)
            for name in ('people-mv', 'bahra-mv')}


@pytest.mark.parametrize(('name', 'count'), [('people-mv', 46), ('bahra-mv', 13)])
def test_default_manufacturer_comparison_preserves_all_originals_without_running_assumptions(monkeypatch, name, count):
    from backend.kernel import catalogue_agreement

    def must_not_run(*_args, **_kwargs):
        pytest.fail('The default manufacturer comparison must not construct or run an assumed scenario.')
    monkeypatch.setattr(catalogue_agreement.structure, 'build', must_not_run)
    monkeypatch.setattr(catalogue_agreement.catalogue, 'single_core_entry', must_not_run)
    monkeypatch.setattr(catalogue_agreement.product, 'rating_table_batch', must_not_run)
    report = reference_report(name)
    assert len(report['rows']) == count
    assert report['reference_scenario']['confirmed'] is False
    assert report['reference_scenario']['executed'] is False
    assert report['reference_calculation'] is None
    assert report['summary']['ampacity_compared'] == report['summary']['four_metric_passed'] == 0
    assert report['summary']['ampacity_refused'] == count
    for row in report['rows']:
        original = catalogue_reference(name, row['sheet'], row['area_mm2'])
        for key in ('outer_diameter', 'weight', 'r20', 'ampacity'):
            metric = row['metrics'][key]
            assert metric['published'] == original[key]
            assert metric['difference'] is metric['relative_difference'] is None
        rating = row['metrics']['ampacity']
        assert rating['value'] is None and rating['status'] == 'refused'
        assert rating['method'] is rating['tier'] is None
        missing = {item['field'] for item in rating['missing_fields']}
        assert {'installation.bonding', 'structure.conductor_screen_thickness',
                'structure.insulation_screen_thickness'} <= missing
        assert ('installation.depth_m' in missing) is (name == 'people-mv')
        assert all(item['label'] and item['reason'] for item in rating['missing_fields'])
    assumptions = {item['key']: item for item in report['reference_scenario']['assumptions']}
    for item in assumptions.values():
        assert item['manufacturer_data'] is False and item['confidence'] == 'reference'
        assert item['source']['reference'] and item['source']['version']
        assert len(item['source']['file_sha256']) == 64
    assert assumptions['installation.bonding']['value'] == 'both_ends'
    if name == 'people-mv':
        assert assumptions['installation.depth_m']['value'] == .7
        assert assumptions['modelling.core_lay_length']['value'] == 2.152
    else:
        assert assumptions['conductor_screen_thickness_mm']['value'] == .6


def test_reference_calculations_never_count_as_manufacturer_acceptance(agreement):
    for name, confirmed in agreement.items():
        ordinary = reference_report(name)
        assert confirmed['rows'] == ordinary['rows']
        assert confirmed['summary'] == ordinary['summary']
        assert confirmed['reference_scenario']['confirmed'] is True
        assert confirmed['reference_scenario']['executed'] is True
        assert confirmed['reference_calculation']['manufacturer_comparison'] is False
        assert confirmed['reference_calculation']['human_reviewed'] is False
        assert len(confirmed['reference_calculation']['rows']) == len(ordinary['rows'])


def test_comparison_api_requires_explicit_boolean_confirmation(tmp_path, monkeypatch, agreement):
    from backend.main import create_app
    from backend.kernel import catalogue_agreement
    calls = []

    def already_verified_scenario(name):
        calls.append(name)
        return agreement[name]['reference_calculation']
    monkeypatch.setattr(catalogue_agreement, '_reference_calculation', already_verified_scenario)
    with TestClient(create_app(tmp_path / 'comparison.sqlite')) as client:
        path = '/api/type-library/catalogue-comparison/bahra-mv'
        for body in ({}, {'reference_scenario_confirmed': False}):
            response = client.post(path, json=body)
            assert response.status_code == 200, response.text
            assert response.json()['reference_calculation'] is None
        assert client.post(path).status_code == 200
        for invalid in ('true', 1, None):
            assert client.post(path, json={'reference_scenario_confirmed': invalid}).status_code == 422
        assert calls == []
        response = client.post(path, json={'reference_scenario_confirmed': True})
        assert response.status_code == 200, response.text
        result = response.json()
        assert calls == ['bahra-mv']
        assert result['summary']['ampacity_compared'] == 0
        assert result['reference_calculation']['summary']['ampacity_compared'] == 13
        assert all(row['metrics']['ampacity']['value'] is None for row in result['rows'])


def test_bahra_all_thirteen_sizes_use_real_methods_and_preserve_deviations(agreement):
    report = agreement['bahra-mv']['reference_calculation']
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
    report = agreement['people-mv']['reference_calculation']
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
    from backend.kernel.catalogue_seed import import_public_catalogues, calculate_factory_series
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
        # This batch explicitly selects the same research conditions. Its
        # reference must remain outside the refused manufacturer comparison.
        expected = {row['area_mm2']: row['metrics']['ampacity']['value']
                    for row in agreement['people-mv']['reference_calculation']['rows']
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
