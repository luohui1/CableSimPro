"""Two-machine exchange must preserve evidence, even in self-consistent edited files."""
from copy import deepcopy
import csv
from hashlib import sha256
from io import StringIO
import json
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.kernel.type_library_exchange import workbook_bytes
from backend.kernel.workspace import fingerprint
from test_type_library import HUMAN, import_series


def reseal(bundle):
    for series in bundle['series']:
        for spec in series['specs']:
            spec['content_sha256'] = fingerprint(spec['payload'])
            spec['metadata']['source_model_digest'] = spec['content_sha256']
    bundle['sha256'] = fingerprint({key: value for key, value in bundle.items() if key != 'sha256'})
    return bundle


def wire(bundle, format):
    return workbook_bytes(bundle) if format == 'xlsx' else json.dumps(bundle, ensure_ascii=False).encode()


@pytest.fixture(scope='module')
def exported(tmp_path_factory):
    with TestClient(create_app(tmp_path_factory.mktemp('exchange-evidence') / 'source.sqlite')) as client:
        imported, _ = import_series(client)
        selection = {'series_ids': [imported['series_id']], 'format': 'json'}
        response = client.post('/api/type-library/exchange/export', json=selection)
        assert response.status_code == 200, response.text
        original = response.json()
        # A real saved design revision changes geometry, while its original
        # manufacturer's cells remain unchanged historical evidence.
        spec = imported['specs'][0]
        workspace = client.get('/api/workspaces/' + spec['workspace_id']).json()
        document = deepcopy(workspace['domain'])
        sheath = next(layer for layer in document['cable_types'][0]['common_layers'] if layer['role'] == 'oversheath')
        sheath['thickness'] += .0001
        saved = client.put('/api/types/' + spec['workspace_id'] + '/document', json={
            'request_id': str(uuid4()), 'expected_revision': workspace['revision'], 'document': document})
        assert saved.status_code == 200, saved.text
        revised = client.post('/api/type-library/specs/' + spec['id'] + '/revisions', headers=HUMAN, json={
            'request_id': str(uuid4()), 'expected_version': 1, 'expected_revision': saved.json()['revision'],
            'note': '增加护套设计厚度，保留原表为历史来源；改版不等于厂家新数据。', 'human_confirmed': True})
        assert revised.status_code == 201, revised.text
        response = client.post('/api/type-library/exchange/export', json=selection)
        assert response.status_code == 200, response.text
        return {'original': original, 'revised': response.json()}


def change_fact_source(spec, fact):
    spec['payload']['sources'][fact['key']]['reference'] = json.dumps(fact['source'], ensure_ascii=False)


def corrupt(bundle, kind):
    spec = bundle['series'][0]['specs'][0]
    facts = spec['metadata']['values']
    outer = next(fact for fact in facts if fact['key'] == 'outer_diameter')
    if kind == 'empty_values':
        for row in bundle['series'][0]['specs']:
            row['metadata']['values'] = []
        bundle['files'] = []
    elif kind == 'blank_evidence':
        for row in bundle['series'][0]['specs']:
            for fact in row['metadata']['values']:
                fact.update(source={}, method={}, confidence='verified')
        bundle['files'] = []
    elif kind == 'si_mismatch':
        outer['value'] = 999.0
    elif kind == 'missing_fact':
        facts.remove(next(fact for fact in facts if fact['key'] == 'weight'))
    elif kind == 'duplicate_fact':
        facts.append(deepcopy(outer))
    elif kind == 'empty_method':
        outer['method'] = {}
    elif kind == 'wrong_unit':
        outer['unit'] = 'mm'
    elif kind == 'wrong_weight_label':
        next(fact for fact in facts if fact['key'] == 'weight')['label'] = '厂家已验收实测重量'
    elif kind == 'formula_value':
        outer['value'] = '=1+1'
    elif kind == 'boolean_value':
        outer['value'] = True
    elif kind == 'trust_upgrade':
        outer['confidence'] = 'verified'
    elif kind == 'changed_cell':
        outer['display_value'] += 1
        outer['value'] = outer['display_value'] * .001
    elif kind in ('missing_sheet', 'missing_row', 'source_trust_upgrade'):
        if kind == 'missing_sheet':
            outer['source']['sheet'] = '不存在的工作表'
        elif kind == 'missing_row':
            outer['source']['row'] = 1999
            spec['metadata']['row_number'] = 1999
        else:
            outer['source']['confidence'] = 'verified'
        change_fact_source(spec, outer)
    elif kind == 'common_declaration_changed':
        bundle['series'][0]['declaration']['common']['conductor_screen_thickness'] *= 2
    elif kind in ('standard_value_changed', 'standard_condition_changed', 'standard_release_changed',
                  'standard_version_older', 'standard_version_future'):
        fact = next(fact for fact in facts if fact['source']['origin'] == 'standard')
        reference = fact['source']['reference']
        if kind == 'standard_value_changed':
            reference['record']['value'] *= 2
            reference['record_sha256'] = fingerprint({key: value for key, value in reference['record'].items()
                                                     if key not in ('record_sha256', 'citation')})
            reference['record']['record_sha256'] = reference['record_sha256']
            fact.update(display_value=reference['record']['value'], value=reference['record']['value'] * .001)
        elif kind == 'standard_condition_changed':
            reference['query']['conditions']['area_m2'] *= 2
            reference['query_sha256'] = fingerprint(reference['query'])
        elif kind == 'standard_release_changed':
            reference['release_digest'] = '0' * 64
            fact['method']['release_digest'] = reference['release_digest']
        else:
            # Keep the real record and all data/release digests. Only the
            # claimed method identity changes, consistently in both locations.
            version = '0.8.0' if kind == 'standard_version_older' else '999.0.0'
            reference['plugin_version'] = version
            fact['method']['version'] = version
        change_fact_source(spec, fact)
    else:
        raise AssertionError(kind)
    return reseal(bundle)


@pytest.mark.parametrize('format', ['json', 'xlsx'])
def test_self_consistent_files_cannot_delete_or_change_catalogue_evidence(tmp_path, exported, format):
    corruptions = ('empty_values', 'blank_evidence', 'si_mismatch', 'missing_fact', 'duplicate_fact',
                   'empty_method', 'wrong_unit', 'wrong_weight_label', 'formula_value', 'boolean_value', 'trust_upgrade',
                   'changed_cell', 'missing_sheet', 'missing_row', 'source_trust_upgrade',
                   'common_declaration_changed', 'standard_value_changed', 'standard_condition_changed',
                   'standard_release_changed', 'standard_version_older', 'standard_version_future')
    with TestClient(create_app(tmp_path / 'target.sqlite')) as client:
        for kind in corruptions:
            bundle = corrupt(deepcopy(exported['original']), kind)
            content = wire(bundle, format)
            upload = {'file': ('types.' + format, content)}
            for endpoint in ('preview', 'import'):
                response = client.post('/api/type-library/exchange/' + endpoint, files=upload,
                    headers=HUMAN, data={'reviewed_sha256': sha256(content).hexdigest(),
                                        'confirmed': 'true', 'request_id': str(uuid4())})
                assert response.status_code == 422, (kind, endpoint, response.status_code, response.text)
                assert response.json()['detail']['code'] == 'TYPE_EXCHANGE_EVIDENCE', (kind, response.text)
                if kind == 'standard_value_changed':
                    assert '封签' in response.text
                if kind in ('standard_version_older', 'standard_version_future'):
                    assert '标准方法版本' in response.text and '封签发行' in response.text
            assert client.get('/api/type-library/series').json() == {'items': []}
            assert client.get('/api/domain-cable-models').json() == []
            assert client.get('/api/workspaces').json() == []


def legacy_bundle(bundle):
    """The 1.0.0 wire format predates performance usage/condition fields.

    Preserve all historical values and standard receipts. This is the serialized
    format produced before the 1.1.0 Bahra expansion, not a new import version.
    """
    def migrate(value):
        if isinstance(value, dict):
            if value == {'name': '厂家结构表导入', 'version': '1.1.0'}:
                return {'name': '厂家结构表导入', 'version': '1.0.0'}
            result = {key: migrate(item) for key, item in value.items()}
            if 'display_value' in result or 'file_sha256' in result and 'field' in result:
                result.pop('usage', None)
                result.pop('conditions', None)
            if result.get('key') == 'weight' and 'display_value' in result:
                result['label'] = '电缆近似重量'
            return result
        if isinstance(value, list):
            return [migrate(item) for item in value]
        if isinstance(value, str) and value.startswith('{'):
            return json.dumps(migrate(json.loads(value)), ensure_ascii=False, sort_keys=True)
        return value
    return reseal(migrate(deepcopy(bundle)))


@pytest.mark.parametrize('format', ['json', 'xlsx'])
@pytest.mark.parametrize('version', ['1.0.0', '1.1.0'])
@pytest.mark.parametrize('state', ['original', 'revised'])
def test_original_and_revised_facts_round_trip_without_rewriting_history(tmp_path, exported, format, version, state):
    bundle = legacy_bundle(exported[state]) if version == '1.0.0' else deepcopy(exported[state])
    if version == '1.1.0' and state == 'revised':
        # 1.1.0 also shipped the historical label. Verify both supported
        # method versions without rewriting facts during transfer.
        for spec in bundle['series'][0]['specs']:
            next(fact for fact in spec['metadata']['values'] if fact['key'] == 'weight')['label'] = '电缆近似重量'
        reseal(bundle)
    content = wire(bundle, format)
    with TestClient(create_app(tmp_path / 'target.sqlite')) as client:
        upload = {'file': ('types.' + format, content)}
        preview = client.post('/api/type-library/exchange/preview', files=upload)
        assert preview.status_code == 200, preview.text
        saved = client.post('/api/type-library/exchange/import', files=upload, headers=HUMAN,
            data={'reviewed_sha256': preview.json()['file_sha256'], 'confirmed': 'true', 'request_id': str(uuid4())})
        assert saved.status_code == 201, saved.text
        series_id = saved.json()['series'][0]['series_id']
        detail = client.get('/api/type-library/series/' + series_id).json()
        assert all(spec['state'] == 'draft' and not spec['results'] for spec in detail['specs'])
        response = client.post('/api/type-library/exchange/export', json={'series_ids': [series_id], 'format': 'json'})
        assert response.status_code == 200, response.text
        returned = response.json()
        assert returned['files'] == bundle['files']
        for actual, expected in zip(returned['series'][0]['specs'], bundle['series'][0]['specs']):
            assert actual['metadata']['values'] == expected['metadata']['values']
            assert actual['payload']['cable_type'] == expected['payload']['cable_type']
            assert actual['payload']['materials'] == expected['payload']['materials']
            assert actual['payload']['confirmed'] is False
            assert all(source['reviewed'] is False for source in actual['payload']['sources'].values())
        if state == 'revised':
            first = returned['series'][0]['specs'][0]
            old_thickness = next(fact['value'] for fact in first['metadata']['values'] if fact['key'] == 'oversheath_thickness')
            new_thickness = next(layer['thickness'] for layer in first['payload']['cable_type']['common_layers'] if layer['role'] == 'oversheath')
            assert new_thickness == pytest.approx(old_thickness + .0001)


def test_stated_single_core_sources_and_identical_csv_filename_aliases_survive_exchange(tmp_path):
    from test_stated_single_core import qifan_table_declaration
    _, declaration, row = qifan_table_declaration()
    stream = StringIO()
    writer = csv.writer(stream)
    writer.writerow(row)
    writer.writerow(row.values())
    content = stream.getvalue().encode('utf-8-sig')
    with TestClient(create_app(tmp_path / 'source.sqlite')) as first, TestClient(create_app(tmp_path / 'target.sqlite')) as second:
        series_ids, expected = [], []
        for name in ('original.csv', 'renamed.csv'):
            uploaded = first.post('/api/type-library/imports/upload', files={'file': (name, content)})
            assert uploaded.status_code == 201, uploaded.text
            upload = uploaded.json()
            series = {**declaration, 'name': declaration['name'] + ' · ' + name}
            response = first.post('/api/type-library/imports/preview', json={'upload_id': upload['upload_id'],
                'sheet': upload['sheets'][0]['name'], 'first_data_row': 2,
                'mapping': {key: index for index, key in enumerate(row)}, 'series': series})
            assert response.status_code == 200, response.text
            preview = response.json()
            assert preview['valid_count'] == 1 and preview['incomplete_count'] == preview['error_count'] == 0
            saved = first.post('/api/type-library/imports/commit', headers=HUMAN, json={
                'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'],
                'request_id': str(uuid4()), 'human_confirmed': True})
            assert saved.status_code == 201, saved.text
            series_ids.append(saved.json()['series_id'])
            expected.append(preview['rows'][0]['values'])
        response = first.post('/api/type-library/exchange/export', json={'series_ids': series_ids, 'format': 'json'})
        assert response.status_code == 200, response.text
        bundle = response.json()
        assert len(bundle['files']) == 1  # Byte identity, while original names differ.
        for series in bundle['series']:
            reference = json.loads(series['specs'][0]['payload']['sources']['area']['reference'])
            assert reference['method']['name'] == '单芯明示结构映射' and 'evidence' in reference
        upload = {'file': ('types.json', response.content)}
        preview = second.post('/api/type-library/exchange/preview', files=upload)
        assert preview.status_code == 200, preview.text
        saved = second.post('/api/type-library/exchange/import', files=upload, headers=HUMAN, data={
            'reviewed_sha256': preview.json()['file_sha256'], 'confirmed': 'true', 'request_id': str(uuid4())})
        assert saved.status_code == 201, saved.text
        assert saved.json()['created'] == 2
        for actual, values in zip(saved.json()['series'], expected):
            detail = second.get('/api/type-library/series/' + actual['series_id']).json()
            assert detail['specs'][0]['values'] == values


def test_area_only_table_needs_one_explicit_structural_fact_then_exchanges(tmp_path):
    from backend.kernel.public_catalogues import _data
    sample = _data('people-mv')
    table = next(table for table in sample['tables'] if table['id'] == 'three-core')
    row = dict(zip((column[0] for column in table['columns']), table['rows'][0]))
    # Keep one genuine published area in the CSV. The manufacturer's sheath
    # thickness is added explicitly as a series declaration for this one size.
    content = ('标称截面\n' + str(row['area']) + '\n').encode('utf-8-sig')
    declaration = {'name': '人民电缆单规格缺项资料', 'manufacturer': '人民电缆（公开样本）',
                   'designation': 'YJV', 'cores': 3, 'u0_v': 8700, 'u_v': 15000,
                   'origin': 'public', 'source': sample['source'], 'common': {}, 'common_basis': {}}
    with TestClient(create_app(tmp_path / 'source.sqlite')) as first:
        uploaded = first.post('/api/type-library/imports/upload', files={'file': ('area-only.csv', content)})
        assert uploaded.status_code == 201, uploaded.text
        body = {'upload_id': uploaded.json()['upload_id'], 'sheet': 'area-only',
                'first_data_row': 2, 'mapping': {'area': 0}, 'series': declaration}
        preview = first.post('/api/type-library/imports/preview', json=body)
        assert preview.status_code == 200, preview.text
        refused = preview.json()
        assert refused['error_count'] == 1 and refused['valid_count'] == 0
        assert '只有截面' in refused['rows'][0]['issues'][0]['message']
        response = first.post('/api/type-library/imports/commit', headers=HUMAN, json={
            'preview_id': refused['preview_id'], 'preview_digest': refused['preview_digest'],
            'request_id': str(uuid4()), 'human_confirmed': True})
        assert response.status_code == 422, response.text
        assert first.get('/api/type-library/series').json() == {'items': []}
        declaration['common'] = {'oversheath_thickness': row['oversheath_thickness']}
        declaration['common_basis'] = {'oversheath_thickness': '人民电缆公开手册表2，YJV 3×25 mm²行护套标称厚度；本系列仅此一个规格。'}
        preview = first.post('/api/type-library/imports/preview', json=body)
        assert preview.status_code == 200, preview.text
        accepted = preview.json()
        assert accepted['error_count'] == 0 and accepted['valid_count'] == accepted['incomplete_count'] == 1
        values = accepted['rows'][0]['values']
        assert {fact['key'] for fact in values} == {'area', 'oversheath_thickness'}
        saved = first.post('/api/type-library/imports/commit', headers=HUMAN, json={
            'preview_id': accepted['preview_id'], 'preview_digest': accepted['preview_digest'],
            'request_id': str(uuid4()), 'human_confirmed': True})
        assert saved.status_code == 201, saved.text
        for format in ('json', 'xlsx'):
            exported = first.post('/api/type-library/exchange/export', json={
                'series_ids': [saved.json()['series_id']], 'format': format})
            assert exported.status_code == 200, exported.text
            with TestClient(create_app(tmp_path / (format + '.sqlite'))) as second:
                file = {'file': ('types.' + format, exported.content)}
                preview = second.post('/api/type-library/exchange/preview', files=file)
                assert preview.status_code == 200, preview.text
                imported = second.post('/api/type-library/exchange/import', files=file, headers=HUMAN, data={
                    'reviewed_sha256': preview.json()['file_sha256'], 'confirmed': 'true', 'request_id': str(uuid4())})
                assert imported.status_code == 201, imported.text
                spec = second.get('/api/type-library/specs/' + imported.json()['series'][0]['specs'][0]['id']).json()['spec']
                assert spec['values'] == values and spec['missing'] and spec['state'] == 'draft'
