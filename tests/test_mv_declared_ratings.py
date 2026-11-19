"""Real MV imports retain explicit limits, without inventing study conditions."""
from copy import deepcopy
from hashlib import sha256
import json
import sqlite3
from uuid import uuid4

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from backend.domain.guards import pointer
from backend.kernel.factory_tables import mapped_rows, read
from backend.kernel.public_catalogues import sample_bytes, sample_manifest
from backend.kernel.type_import_models import SeriesDeclaration, build_rows
from backend.main import create_app


HUMAN = {'X-CableSim-Actor': 'human'}
RATING_FIELDS = ('normal_temperature_k', 'short_circuit_temperature_k', 'conductor_class')
CLASS = {'value': 2, 'unit': '1', 'reference':
         '明确采用 GB/T 3956—2008 表 2 第 2 类导体，保持本次标准上限查询的类别；非厂家工艺认证。'}


def request_for(client):
    response = client.post('/api/type-library/imports/upload', files={
        'file': ('people.xlsx', sample_bytes('people-mv'))})
    assert response.status_code == 201, response.text
    uploaded = response.json()
    declaration = deepcopy(next(row for row in uploaded['declarations'] if row['table'] == 'three-core'))
    declaration.pop('table')
    return {'upload_id': uploaded['upload_id'], **declaration}


def preview(client, request):
    response = client.post('/api/type-library/imports/preview', json=request)
    assert response.status_code == 200, response.text
    return response.json()


def commit_body(value):
    return {'preview_id': value['preview_id'], 'preview_digest': value['preview_digest'],
            'request_id': str(uuid4()), 'human_confirmed': True}


def mapped_paths(cable):
    yield 'normal_temperature_k', pointer('cable_type', 'rating', 'max_conductor_temperature', 'normal')
    yield 'short_circuit_temperature_k', pointer('cable_type', 'rating', 'max_conductor_temperature', 'short_circuit')
    for core in cable['cores']:
        yield 'conductor_class', pointer('cable_type', 'cores', core['id'], 'conductor', 'conductor_class')


def assert_source(source, key, declared):
    assert source['kind'] == 'user' and source['reviewed'] is False
    record = json.loads(source['reference'])
    assert record['method'] == {'name': '明示额定条件映射', 'version': '1.0.0'}
    assert record['field'] == key and record['evidence'] == declared
    assert record['confidence'] == 'reference' and record['reviewed'] is False
    assert record['usage'] == ('declared_conductor_class' if key == 'conductor_class' else 'permitted_temperature_limit')


def without_request_receipt(value):
    copied = deepcopy(value)
    request = copied.pop('request_sha256')
    assert isinstance(request, str) and len(request) == 64 and set(request) <= set('0123456789abcdef')
    return copied


def test_real_eleven_specifications_keep_limits_and_exact_sources_after_source_closes(tmp_path):
    exports = {}
    source_database = tmp_path / 'source.sqlite'
    with TestClient(create_app(source_database)) as client:
        request = request_for(client)
        declaration = request['series']
        stated = declaration['reference']['published_operating_limits']
        assert stated['semantic'] == 'manufacturer_limit'
        assert stated['method'] == {'id': 'cablesim.catalogue-operating-limits-transcription',
                                    'name': '人民电器公开使用特性转录', 'version': '1.0.0'}
        assert stated['source']['pdf_page'] == 1 and stated['source']['printed_page'] == 43
        assert stated['source']['sha256'] == 'c60b53c188478b55f424f49ca31506c5f7c100d2c876f91aab65622e86ddba4a'
        assert stated['limits'] == {
            'normal_temperature': {'value': 90, 'unit': 'degC', 'criterion': 'maximum'},
            'short_circuit_temperature': {'value': 250, 'unit': 'degC', 'criterion': 'maximum'},
            'short_circuit_duration': {'value': 5, 'unit': 's', 'criterion': 'maximum'}}
        assert not any('duration' in key for key in declaration['modelling'])
        assert declaration['modelling']['normal_temperature_k']['value'] == 363.15
        assert declaration['modelling']['short_circuit_temperature_k']['value'] == 523.15
        original = deepcopy(request)
        for key in RATING_FIELDS:
            original['series']['modelling'].pop(key, None)
        baseline = preview(client, original)
        request['series']['modelling']['conductor_class'] = CLASS
        actual = preview(client, request)
        assert baseline['valid_count'] == actual['valid_count'] == 11
        assert actual['error_count'] == actual['incomplete_count'] == 0
        assert actual['sha256'] == baseline['sha256'] == sha256(sample_bytes('people-mv')).hexdigest()
        for before, after in zip(baseline['rows'], actual['rows']):
            assert before['payload']['cable_type']['rating']['max_conductor_temperature'] == {'normal': 363.15}
            assert 'rating_mapping' not in before['derivation']
            expected = deepcopy(before['payload']['cable_type'])
            expected['rating']['max_conductor_temperature']['short_circuit'] = 523.15
            assert after['payload']['cable_type'] == expected
            assert after['payload']['materials'] == before['payload']['materials']
            assert after['closure'] == before['closure']
            # Real independent method invocations have different request
            # receipts. Every value, unit, query, record and fixed method pin
            # must still agree; the complete new receipts survive exchange.
            left, right = deepcopy(before['values']), deepcopy(after['values'])
            for facts in (left, right):
                for fact in facts:
                    if fact['source']['origin'] == 'standard':
                        fact['source']['reference'] = without_request_receipt(fact['source']['reference'])
            assert left == right
            derived = {key: value for key, value in after['derivation'].items() if key != 'rating_mapping'}
            assert without_request_receipt(derived) == without_request_receipt(before['derivation'])
            for key, path in mapped_paths(expected):
                assert_source(after['payload']['sources'][path], key, actual['series']['modelling'][key])
        short_reference = json.loads(actual['series']['modelling']['short_circuit_temperature_k']['reference'])
        assert short_reference['conditions']['short_circuit_duration'] == stated['limits']['short_circuit_duration']
        assert short_reference['conversion']['version'] == '1.0.0'
        assert short_reference['method'] == stated['method']
        body = commit_body(actual)
        assert client.post('/api/type-library/imports/commit', json=body,
                           headers={'X-CableSim-Actor': 'agent'}).status_code in (403, 409)
        response = client.post('/api/type-library/imports/commit', json=body, headers=HUMAN)
        assert response.status_code == 201, response.text
        saved = response.json()
        assert saved['created'] == 11 and saved['state'] == 'draft'
        for item, row in zip(saved['specs'], actual['rows']):
            domain = client.get('/api/workspaces/' + item['workspace_id']).json()['domain']
            assert domain['cable_types'] == [row['payload']['cable_type']]
            for key, path in mapped_paths(domain['cable_types'][0]):
                bound = pointer('cable_types', domain['cable_types'][0]['id']) + path.removeprefix('/cable_type')
                assert domain['provenance'][bound] == row['payload']['sources'][path]
            assert client.get('/api/workspaces/' + item['workspace_id'] + '/studies').json() == []
        for format in ('json', 'xlsx'):
            response = client.post('/api/type-library/exchange/export', json={
                'series_ids': [saved['series_id']], 'format': format})
            assert response.status_code == 200, response.text
            assert sha256(response.content).hexdigest() == response.headers['x-content-sha256']
            exports[format] = response.content
    # Both targets are empty, and the source service is already closed.
    for format, content in exports.items():
        target = tmp_path / ('target-' + format + '.sqlite')
        with TestClient(create_app(target)) as client:
            file = {'file': ('types.' + format, content)}
            checked = client.post('/api/type-library/exchange/preview', files=file)
            assert checked.status_code == 200, checked.text
            response = client.post('/api/type-library/exchange/import', headers=HUMAN, files=file, data={
                'reviewed_sha256': checked.json()['file_sha256'], 'confirmed': 'true', 'request_id': str(uuid4())})
            assert response.status_code == 201, response.text
            saved = response.json()
            assert saved['created'] == 11 and saved['state'] == 'draft'
            specs = client.get('/api/type-library/series/' + saved['series'][0]['series_id']).json()['specs']
            models = {model['id']: model for model in client.get('/api/domain-cable-models').json()}
            for item, row in zip(specs, actual['rows']):
                payload = models[item['model_id']]['payload']
                assert payload['cable_type'] == row['payload']['cable_type']
                assert payload['materials'] == row['payload']['materials']
                for key, path in mapped_paths(payload['cable_type']):
                    assert payload['sources'][path] == row['payload']['sources'][path]
                assert item['state'] == 'draft' and item['submission'] is None and item['results'] == []
        with sqlite3.connect(target) as db:
            assert db.execute('SELECT count(*) FROM study_runs').fetchone()[0] == 0
            assert db.execute('SELECT count(*) FROM type_submissions').fetchone()[0] == 0
    with sqlite3.connect(source_database) as db:
        assert db.execute('SELECT count(*) FROM study_runs').fetchone()[0] == 0
        assert db.execute('SELECT count(*) FROM type_submissions').fetchone()[0] == 0


@pytest.mark.parametrize(('key', 'value', 'unit', 'code'), [
    ('normal_temperature_k', 353.15, 'K', 'TABLE_RATING_CONFLICT'),
    ('short_circuit_temperature_k', 523.15, 'degC', 'TABLE_RATING_INVALID'),
    ('conductor_class', 1, '1', 'TABLE_RATING_CONFLICT'),
])
def test_conflicting_or_wrong_unit_declaration_cannot_partially_save(tmp_path, key, value, unit, code):
    with TestClient(create_app(tmp_path / 'rejected.sqlite')) as client:
        request = request_for(client)
        request['series']['modelling'][key] = {'value': value, 'unit': unit,
            'reference': '显式冲突或错误单位的回归输入，不作为工程事实。'}
        checked = preview(client, request)
        assert checked['valid_count'] == 0 and checked['error_count'] == 11
        for row in checked['rows']:
            assert row['payload'] is None and row['status'] == 'error'
            assert any(issue['code'] == code and issue['field'] == 'modelling.' + key for issue in row['issues'])
        for skip in (False, True):
            result = client.post('/api/type-library/imports/commit', headers=HUMAN,
                                 json={**commit_body(checked), 'skip_errors': skip})
            assert result.status_code == 422, result.text
        assert client.get('/api/type-library/series').json() == {'items': []}
        assert client.get('/api/domain-cable-models').json() == []
        assert client.get('/api/workspaces').json() == []


@pytest.fixture(scope='module')
def public_input():
    sample = next(item for item in sample_manifest() if item['id'] == 'people-mv')
    declaration = deepcopy(next(item for item in sample['declarations'] if item['table'] == 'three-core'))
    upload = read('people.xlsx', sample_bytes('people-mv'))
    rows, _ = mapped_rows(upload, declaration['sheet'], declaration['first_data_row'], declaration['mapping'])
    return upload, rows, declaration


@pytest.mark.parametrize(('key', 'value', 'unit'), [
    ('short_circuit_temperature_k', 523.15, None),
    ('short_circuit_temperature_k', 0, 'K'),
    ('short_circuit_temperature_k', -1, 'K'),
    ('short_circuit_temperature_k', 300, 'K'),
    ('conductor_class', 3, '1'),
    ('conductor_class', 2.5, '1'),
])
def test_invalid_rating_is_a_located_row_error(public_input, key, value, unit):
    upload, rows, declaration = public_input
    series = deepcopy(declaration['series'])
    series['modelling'][key] = {'value': value, 'unit': unit, 'reference': '明确无效的回归输入。'}
    series = SeriesDeclaration.model_validate(series).model_dump(mode='json')
    result = build_rows(upload, declaration['sheet'], rows[:1], series, declaration['mapping'])[0]
    assert result['payload'] is None and result['status'] == 'error'
    assert any(issue['code'] == 'TABLE_RATING_INVALID' and issue['field'] == 'modelling.' + key for issue in result['issues'])


@pytest.mark.parametrize('key', RATING_FIELDS)
@pytest.mark.parametrize('number', [True, '523.15', float('inf'), float('nan'), 10**400])
def test_rating_numbers_are_not_coerced(public_input, key, number):
    series = deepcopy(public_input[2]['series'])
    series['modelling'][key] = {'value': number, 'unit': '1' if key == 'conductor_class' else 'K',
                              'reference': '明确无效的回归输入。'}
    with pytest.raises(ValidationError):
        SeriesDeclaration.model_validate(series)


def test_rating_without_source_is_rejected(public_input):
    series = deepcopy(public_input[2]['series'])
    series['modelling']['short_circuit_temperature_k']['reference'] = ' '
    with pytest.raises(ValidationError):
        SeriesDeclaration.model_validate(series)


def test_huge_json_integer_is_a_validation_error_and_cannot_write(tmp_path):
    with TestClient(create_app(tmp_path / 'huge.sqlite')) as client:
        request = request_for(client)
        request['series']['modelling']['short_circuit_temperature_k']['value'] = 10**400
        response = client.post('/api/type-library/imports/preview', json=request)
        assert response.status_code == 422, response.text
        assert 'short_circuit_temperature_k' in response.text
        assert client.get('/api/type-library/series').json() == {'items': []}
        assert client.get('/api/domain-cable-models').json() == []
        assert client.get('/api/workspaces').json() == []
