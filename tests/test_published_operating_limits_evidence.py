"""Published People limits cannot be changed by self-consistent user packages."""
from copy import deepcopy
from hashlib import sha256
import json
import sqlite3
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.kernel.catalogue_core import catalogue
from backend.kernel.resource_exchange import parse_file
from backend.kernel.type_library_exchange import validate_bundle, workbook_bytes
from backend.kernel.workspace import fingerprint


HUMAN = {'X-CableSim-Actor': 'human'}
INVALID = 'PUBLISHED_OPERATING_LIMITS_INVALID'
UNAVAILABLE = 'PUBLISHED_OPERATING_LIMITS_UNAVAILABLE'
TABLES = ('type_table_uploads', 'type_table_previews', 'type_series', 'type_series_specs',
          'type_series_versions', 'domain_cable_models', 'workspaces', 'studies', 'study_runs',
          'type_submissions', 'type_library_requests', 'type_library_events')
TAMPERED = ('duration', 'normal_temperature', 'short_circuit_temperature', 'duration_unit',
            'temperature_unit', 'criterion', 'source_hash', 'source_url', 'source_page',
            'source_location', 'method_id', 'method_name', 'method_version', 'schema',
            'semantic', 'usage', 'confidence', 'reviewed', 'numeric_boolean', 'boolean_number',
            'huge_number', 'missing_condition', 'extra_condition', 'limitations', 'null', 'empty')


def counts(database):
    with sqlite3.connect(database) as db:
        return {table: db.execute('SELECT count(*) FROM ' + table).fetchone()[0] for table in TABLES}


def commit(client, preview):
    return client.post('/api/type-library/imports/commit', headers=HUMAN, json={
        'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'],
        'request_id': str(uuid4()), 'human_confirmed': True})


def uploaded_request(client, original, declaration):
    uploaded = client.post('/api/type-library/imports/upload', files={'file': ('people-mv.xlsx', original)})
    assert uploaded.status_code == 201, uploaded.text
    return {'upload_id': uploaded.json()['upload_id'], **deepcopy(declaration)}


def transfer_bytes(bundle, format):
    bundle['sha256'] = fingerprint({key: value for key, value in bundle.items() if key != 'sha256'})
    return workbook_bytes(bundle) if format == 'xlsx' else json.dumps(bundle, ensure_ascii=False).encode()


def tamper(reference, kind):
    value = reference['published_operating_limits']
    limits = value['limits']
    if kind == 'duration':
        limits['short_circuit_duration']['value'] = 60
    elif kind == 'normal_temperature':
        limits['normal_temperature']['value'] = 100
    elif kind == 'short_circuit_temperature':
        limits['short_circuit_temperature']['value'] = 300
    elif kind == 'duration_unit':
        limits['short_circuit_duration']['unit'] = 'min'
    elif kind == 'temperature_unit':
        limits['normal_temperature']['unit'] = 'K'
    elif kind == 'criterion':
        limits['short_circuit_duration']['criterion'] = 'actual'
    elif kind == 'source_hash':
        value['source']['sha256'] = '0' * 64
    elif kind == 'source_url':
        value['source']['url'] = 'https://example.invalid/forged.pdf'
    elif kind == 'source_page':
        value['source']['pdf_page'] = 2
    elif kind == 'source_location':
        value['source']['location'] = '不属于原页的使用条件'
    elif kind in ('method_id', 'method_name', 'method_version'):
        value['method'][kind.removeprefix('method_')] = 'unrecognised'
    elif kind == 'schema':
        value['schema'] = 'cablesim.published-operating-limits/999'
    elif kind == 'semantic':
        value['semantic'] = 'measured'
    elif kind == 'usage':
        value['usage'] = 'actual_fault_input'
    elif kind == 'confidence':
        value['confidence'] = 'verified'
    elif kind == 'reviewed':
        value['reviewed'] = True
    elif kind == 'numeric_boolean':
        value['source']['pdf_page'] = True
    elif kind == 'boolean_number':
        value['reviewed'] = 0
    elif kind == 'huge_number':
        limits['short_circuit_duration']['value'] = 10 ** 400
    elif kind == 'missing_condition':
        del limits['short_circuit_duration']
    elif kind == 'extra_condition':
        limits['short_circuit_temperature']['conditions'] = {'duration_s': 60}
    elif kind == 'limitations':
        value['limitations'] = []
    elif kind == 'null':
        reference['published_operating_limits'] = None
    elif kind == 'empty':
        reference['published_operating_limits'] = {}
    else:
        raise AssertionError(kind)


@pytest.fixture(scope='module')
def people_source(tmp_path_factory):
    """Build real specifications with the public workbook, then stop the source."""
    database = tmp_path_factory.mktemp('operating-limits-source') / 'source.sqlite'
    with TestClient(create_app(database)) as client:
        original = client.get('/api/type-library/samples/people-mv.xlsx')
        assert original.status_code == 200, original.text
        uploaded = client.post('/api/type-library/imports/upload', files={'file': ('people-mv.xlsx', original.content)})
        assert uploaded.status_code == 201, uploaded.text
        declaration = deepcopy(next(item for item in uploaded.json()['declarations'] if item['table'] == 'three-core'))
        declaration.pop('table')
        stated = declaration['series']['reference']['published_operating_limits']
        assert stated['source']['sha256'] == 'c60b53c188478b55f424f49ca31506c5f7c100d2c876f91aab65622e86ddba4a'
        assert stated['source']['pdf_page'] == 1 and stated['source']['printed_page'] == 43
        assert stated['method'] == {'id': 'cablesim.catalogue-operating-limits-transcription',
                                    'name': '人民电器公开使用特性转录', 'version': '1.0.0'}
        assert stated['limits'] == {
            'normal_temperature': {'value': 90, 'unit': 'degC', 'criterion': 'maximum'},
            'short_circuit_temperature': {'value': 250, 'unit': 'degC', 'criterion': 'maximum'},
            'short_circuit_duration': {'value': 5, 'unit': 's', 'criterion': 'maximum'}}
        assert stated['semantic'] == 'manufacturer_limit' and stated['usage'] == 'permitted_limits_only'
        assert stated['confidence'] == 'reference' and stated['reviewed'] is False
        assert not any('duration' in key for key in declaration['series']['modelling'])
        short_source = json.loads(declaration['series']['modelling']['short_circuit_temperature_k']['reference'])
        assert short_source['conditions']['short_circuit_duration'] == stated['limits']['short_circuit_duration']
        checked = client.post('/api/type-library/imports/preview', json={
            'upload_id': uploaded.json()['upload_id'], **declaration})
        assert checked.status_code == 200, checked.text
        assert checked.json()['valid_count'] == 11
        assert checked.json()['error_count'] == checked.json()['incomplete_count'] == 0
        saved = commit(client, checked.json())
        assert saved.status_code == 201, saved.text
        assert saved.json()['created'] == 11 and saved.json()['state'] == 'draft'
        exported = client.post('/api/type-library/exchange/export', json={
            'series_ids': [saved.json()['series_id']], 'format': 'json'})
        assert exported.status_code == 200, exported.text
        assert sha256(exported.content).hexdigest() == exported.headers['x-content-sha256']
        bundle = exported.json()
        assert bundle['series'][0]['declaration']['reference'] == declaration['series']['reference']
        for spec in saved.json()['specs']:
            assert client.get('/api/workspaces/' + spec['workspace_id'] + '/studies').json() == []
    assert counts(database)['study_runs'] == counts(database)['type_submissions'] == 0
    return {'database': database, 'original': original.content, 'declaration': declaration, 'bundle': bundle}


def assert_readback(client, identifier, bundle):
    response = client.get('/api/type-library/series/' + identifier)
    assert response.status_code == 200, response.text
    actual = response.json()
    expected = bundle['series'][0]
    assert actual['declaration']['reference'] == expected['declaration']['reference']
    assert len(actual['specs']) == 11
    models = {item['id']: item['payload'] for item in client.get('/api/domain-cable-models').json()}
    assert len(models) == 11
    for spec, original in zip(actual['specs'], expected['specs']):
        assert spec['state'] == 'draft' and spec['submission'] is None and spec['results'] == []
        assert spec['values'] == original['metadata']['values']
        payload = deepcopy(original['payload'])
        payload.update(confirmed=False, version='1')
        for source in payload['sources'].values():
            source['reviewed'] = False
        assert models[spec['model_id']] == payload
        assert client.get('/api/workspaces/' + spec['workspace_id'] + '/studies').json() == []


@pytest.mark.parametrize('format', ['json', 'xlsx'])
@pytest.mark.parametrize('variant', ['canonical', 'integral_floats', 'legacy', 'user_reference'])
def test_real_limits_and_unreserved_references_survive_import_restart_and_export(tmp_path, people_source, format, variant):
    bundle = deepcopy(people_source['bundle'])
    reference = bundle['series'][0]['declaration']['reference']
    if variant == 'integral_floats':
        for value in reference['published_operating_limits']['limits'].values():
            value['value'] = float(value['value'])
        reference['published_operating_limits']['source']['pdf_page'] = 1.0
    elif variant in ('legacy', 'user_reference'):
        del reference['published_operating_limits']
        if variant == 'user_reference':
            reference['user_reference'] = {'title': '企业另行提供的未核实声明', 'reviewed': False,
                                           'notes': '不冒充人民电器公开许可条件；不授予工程批准。'}
    content = transfer_bytes(bundle, format)
    database = tmp_path / 'target.sqlite'
    with TestClient(create_app(database)) as client:
        assert client.get('/api/type-library/series').json() == {'items': []}
        file = {'file': ('types.' + format, content)}
        checked = client.post('/api/type-library/exchange/preview', files=file)
        assert checked.status_code == 200, checked.text
        assert checked.json()['series'][0]['spec_count'] == 11
        imported = client.post('/api/type-library/exchange/import', files=file, headers=HUMAN, data={
            'reviewed_sha256': checked.json()['file_sha256'], 'confirmed': 'true', 'request_id': str(uuid4())})
        assert imported.status_code == 201, imported.text
        assert imported.json()['created'] == 11 and imported.json()['state'] == 'draft'
        identifier = imported.json()['series'][0]['series_id']
        assert_readback(client, identifier, bundle)
    with TestClient(create_app(database)) as restarted:
        assert_readback(restarted, identifier, bundle)
        for export_format in ('json', 'xlsx'):
            exported = restarted.post('/api/type-library/exchange/export', json={
                'series_ids': [identifier], 'format': export_format})
            assert exported.status_code == 200, exported.text
            assert sha256(exported.content).hexdigest() == exported.headers['x-content-sha256']
            saved = parse_file('types.' + export_format, exported.content, validator=validate_bundle)
            assert saved['series'][0]['declaration']['reference'] == reference
            assert saved['files'] == bundle['files']
    assert counts(database)['studies'] == counts(database)['study_runs'] == counts(database)['type_submissions'] == 0


def test_reserved_limits_are_checked_before_any_preview_is_saved(tmp_path, people_source):
    database = tmp_path / 'preview.sqlite'
    with TestClient(create_app(database)) as client:
        request = uploaded_request(client, people_source['original'], people_source['declaration'])
        unchanged = counts(database)
        for kind in TAMPERED:
            forged = deepcopy(request)
            tamper(forged['series']['reference'], kind)
            response = client.post('/api/type-library/imports/preview', json=forged)
            assert response.status_code == 422, (kind, response.text)
            assert response.json()['detail']['code'] == INVALID, (kind, response.text)
            assert counts(database) == unchanged, kind


@pytest.mark.parametrize('format', ['json', 'xlsx'])
def test_recomputed_package_digests_cannot_forge_limits_at_preview_or_import(tmp_path, people_source, format):
    database = tmp_path / 'exchange.sqlite'
    with TestClient(create_app(database)) as client:
        unchanged = counts(database)
        for kind in TAMPERED:
            bundle = deepcopy(people_source['bundle'])
            tamper(bundle['series'][0]['declaration']['reference'], kind)
            content = transfer_bytes(bundle, format)
            for endpoint in ('preview', 'import'):
                response = client.post('/api/type-library/exchange/' + endpoint,
                    files={'file': ('types.' + format, content)}, headers=HUMAN,
                    data={'reviewed_sha256': sha256(content).hexdigest(), 'confirmed': 'true', 'request_id': str(uuid4())})
                assert response.status_code == 422, (kind, endpoint, response.text)
                assert response.json()['detail']['code'] == INVALID, (kind, endpoint, response.text)
                assert counts(database) == unchanged, (kind, endpoint)
        assert client.get('/api/type-library/series').json() == {'items': []}
        assert client.get('/api/domain-cable-models').json() == []
        assert client.get('/api/workspaces').json() == []


@pytest.mark.parametrize('change', ['saved_preview', 'missing_original', 'bad_original_identity'])
def test_commit_rechecks_reserved_limits_after_preview(tmp_path, people_source, monkeypatch, change):
    database = tmp_path / 'commit.sqlite'
    with TestClient(create_app(database)) as client:
        request = uploaded_request(client, people_source['original'], people_source['declaration'])
        response = client.post('/api/type-library/imports/preview', json=request)
        assert response.status_code == 200, response.text
        checked = response.json()
        if change == 'saved_preview':
            # An old version could persist this forged block. Even recomputing
            # its preview checksum cannot authenticate manufacturer evidence.
            with sqlite3.connect(database) as db:
                raw = db.execute('SELECT payload FROM type_table_previews WHERE id=?', (checked['preview_id'],)).fetchone()[0]
                saved = json.loads(raw)
                tamper(saved['series']['reference'], 'duration')
                checked['preview_digest'] = fingerprint(saved)
                db.execute('UPDATE type_table_previews SET payload=?,digest=? WHERE id=?',
                           (json.dumps(saved, ensure_ascii=False), checked['preview_digest'], checked['preview_id']))
        else:
            installed = tmp_path / 'catalogues'
            installed.mkdir()
            if change == 'bad_original_identity':
                content = json.loads((catalogue.CATALOGUES / 'people_mv_xlpe.json').read_text('utf-8'))
                content['source']['sha256'] = '0' * 64
                (installed / 'people_mv_xlpe.json').write_text(json.dumps(content), encoding='utf-8')
            monkeypatch.setattr(catalogue, 'CATALOGUES', installed)
        unchanged = counts(database)
        refused = commit(client, checked)
        expected_status, expected_code = (422, INVALID) if change == 'saved_preview' else (409, UNAVAILABLE)
        assert refused.status_code == expected_status, refused.text
        assert refused.json()['detail']['code'] == expected_code
        assert counts(database) == unchanged
        assert client.get('/api/type-library/series').json() == {'items': []}
        assert client.get('/api/domain-cable-models').json() == []
        assert client.get('/api/workspaces').json() == []


@pytest.mark.parametrize('kind', ['duration', 'null', 'schema', 'unavailable', 'legacy'])
def test_previous_database_reads_do_not_silently_accept_or_repair_reserved_limits(tmp_path, people_source, monkeypatch, kind):
    database = tmp_path / 'previous-release.sqlite'
    with sqlite3.connect('file:' + people_source['database'].as_posix() + '?mode=ro', uri=True) as source, sqlite3.connect(database) as db:
        source.backup(db)
        identifier, raw = db.execute('SELECT id,declaration FROM type_series').fetchone()
        declaration = json.loads(raw)
        if kind == 'legacy':
            declaration['reference'] = {'notes': '企业原有未核实参考，未声明为内置厂家使用条件。'}
        elif kind != 'unavailable':
            tamper(declaration['reference'], kind)
        persisted = json.dumps(declaration, ensure_ascii=False, sort_keys=True)
        db.execute('UPDATE type_series SET declaration=? WHERE id=?', (persisted, identifier))
    if kind == 'unavailable':
        monkeypatch.setattr(catalogue, 'CATALOGUES', tmp_path / 'missing-catalogues')
    unchanged = counts(database)
    with TestClient(create_app(database)) as client:
        for endpoint in ('/api/type-library/series', '/api/type-library/series/' + identifier):
            response = client.get(endpoint)
            if kind == 'legacy':
                assert response.status_code == 200, response.text
                actual = response.json()['items'][0] if endpoint.endswith('/series') else response.json()['declaration']
                assert actual['reference'] == declaration['reference']
            else:
                assert response.status_code == (409 if kind == 'unavailable' else 422), response.text
                assert response.json()['detail']['code'] == (UNAVAILABLE if kind == 'unavailable' else INVALID)
        exported = client.post('/api/type-library/exchange/export', json={'series_ids': [identifier], 'format': 'json'})
        assert exported.status_code == (200 if kind == 'legacy' else 409 if kind == 'unavailable' else 422), exported.text
    assert counts(database) == unchanged
    with sqlite3.connect(database) as db:
        assert db.execute('SELECT declaration FROM type_series WHERE id=?', (identifier,)).fetchone()[0] == persisted
