"""Manufacturer guidance stays source-only, even in self-consistent edited packages."""
from copy import deepcopy
from hashlib import sha256
import json
import sqlite3
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.kernel import published_guidance
from backend.kernel.type_library_exchange import workbook_bytes
from backend.kernel.workspace import fingerprint


HUMAN = {'X-CableSim-Actor': 'human'}


def guidance_digest(value):
    content = {key: item for key, item in value.items() if key != 'content_sha256'}
    return sha256(json.dumps(content, ensure_ascii=False, sort_keys=True,
                             separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def exchange_file(bundle, format):
    bundle['sha256'] = fingerprint({key: value for key, value in bundle.items() if key != 'sha256'})
    return workbook_bytes(bundle) if format == 'xlsx' else json.dumps(bundle, ensure_ascii=False).encode()


def assert_no_import(client):
    assert client.get('/api/type-library/series').json() == {'items': []}
    assert client.get('/api/domain-cable-models').json() == []
    assert client.get('/api/workspaces').json() == []


def preview_upload(client, original, declaration):
    uploaded = client.post('/api/type-library/imports/upload', files={'file': ('bahra-mv.xlsx', original)})
    assert uploaded.status_code == 201, uploaded.text
    return client.post('/api/type-library/imports/preview', json={
        'upload_id': uploaded.json()['upload_id'], **declaration})


def confirm_preview(client, preview):
    return client.post('/api/type-library/imports/commit', headers=HUMAN, json={
        'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'],
        'request_id': str(uuid4()), 'human_confirmed': True})


@pytest.fixture(scope='module')
def bahra_source(tmp_path_factory):
    """Actual built-in workbook -> preview -> existing model store -> export."""
    database = tmp_path_factory.mktemp('guidance-source') / 'source.sqlite'
    with TestClient(create_app(database)) as client:
        original = client.get('/api/type-library/samples/bahra-mv.xlsx')
        assert original.status_code == 200, original.text
        uploaded = client.post('/api/type-library/imports/upload', files={'file': ('bahra-mv.xlsx', original.content)})
        assert uploaded.status_code == 201, uploaded.text
        declaration = uploaded.json()['declarations'][0]
        declaration.pop('table')
        guide = declaration['series']['reference']['published_guidance']
        canonical = json.loads(published_guidance.CATALOGUE.read_text('utf-8'))['published_guidance']
        assert guide == canonical
        assert len(guide['material_facts']) == 4
        assert [len(table['factors']) for table in guide['correction_tables']] == [9, 27, 48]
        preview = client.post('/api/type-library/imports/preview', json={
            'upload_id': uploaded.json()['upload_id'], **declaration})
        assert preview.status_code == 200, preview.text
        assert preview.json()['error_count'] == 0
        assert preview.json()['valid_count'] == preview.json()['incomplete_count'] == 13
        imported = confirm_preview(client, preview.json())
        assert imported.status_code == 201, imported.text
        exported = client.post('/api/type-library/exchange/export', json={
            'series_ids': [imported.json()['series_id']], 'format': 'json'})
        assert exported.status_code == 200, exported.text
        return {'bundle': exported.json(), 'original': original.content, 'declaration': declaration,
                'database': database}


def normalise_json_numbers(value):
    """JSON.stringify does not retain a Python float's trailing .0."""
    if type(value) is float and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {key: normalise_json_numbers(item) for key, item in value.items()}
    if isinstance(value, list):
        return [normalise_json_numbers(item) for item in value]
    return value


@pytest.mark.parametrize('format', ['json', 'xlsx'])
@pytest.mark.parametrize('variant', ['canonical', 'browser_numbers', 'legacy', 'user_reference'])
def test_real_guidance_and_legacy_user_references_roundtrip_without_granting_approval(tmp_path, bahra_source, format, variant):
    bundle = deepcopy(bahra_source['bundle'])
    declaration = bundle['series'][0]['declaration']
    if variant in ('legacy', 'user_reference'):
        del declaration['reference']['published_guidance']
    if variant == 'user_reference':
        declaration['reference']['user_reference'] = {
            'title': '企业自行提供的材料资料，待核验', 'reviewed': False,
            'notes': '不声明为内置 Bahra 指南，不继承工程批准。'}
    if variant == 'browser_numbers':
        declaration['reference']['published_guidance'] = normalise_json_numbers(declaration['reference']['published_guidance'])
    content = exchange_file(bundle, format)
    with TestClient(create_app(tmp_path / 'target.sqlite')) as client:
        transfer = {'file': ('types.' + format, content)}
        checked = client.post('/api/type-library/exchange/preview', files=transfer)
        assert checked.status_code == 200, checked.text
        assert checked.json()['series'][0]['spec_count'] == 13
        response = client.post('/api/type-library/exchange/import', files=transfer, headers=HUMAN,
            data={'reviewed_sha256': checked.json()['file_sha256'], 'confirmed': 'true', 'request_id': str(uuid4())})
        assert response.status_code == 201, response.text
        result = response.json()
        assert result['created'] == 13 and result['state'] == 'draft'
        identifier = result['series'][0]['series_id']
        stored = client.get('/api/type-library/series/' + identifier).json()
        assert stored['declaration']['reference'] == declaration['reference']
        assert [spec['values'] for spec in stored['specs']] == [spec['metadata']['values'] for spec in bundle['series'][0]['specs']]
        assert all(spec['state'] == 'draft' and spec['missing'] and spec['results'] == [] for spec in stored['specs'])
        assert all(model['payload']['cable_type'] is None and not model['payload']['confirmed']
                   for model in client.get('/api/domain-cable-models').json())
        exported = client.post('/api/type-library/exchange/export', json={'series_ids': [identifier], 'format': 'json'})
        assert exported.status_code == 200, exported.text
        assert exported.json()['series'][0]['declaration']['reference'] == declaration['reference']
        assert exported.json()['files'] == bundle['files']


def corrupt_guidance(reference, kind):
    guide = reference['published_guidance']
    fact = guide['material_facts'][0]
    table = guide['correction_tables'][0]
    if kind == 'material_value':
        fact['value'] *= 2
    elif kind == 'factor_value':
        table['factors'][0]['value'] *= 2
    elif kind == 'condition':
        table['factors'][0]['conditions']['installation'] = 'in_ducts'
    elif kind == 'source_page':
        fact['source']['pdf_page'] += 1
    elif kind == 'source_identity':
        guide['source']['sha256'] = '0' * 64
    elif kind == 'method_version':
        guide['method']['version'] = '999.0.0'
        for item in [*guide['material_facts'], *(factor for table in guide['correction_tables'] for factor in table['factors'])]:
            item['method']['version'] = '999.0.0'
    elif kind == 'verified':
        guide['confidence'] = 'verified'
    elif kind == 'reviewed':
        guide['reviewed'] = True
    elif kind == 'wrong_id':
        guide['id'] += '.modified'
    elif kind == 'wrong_schema':
        guide['schema'] = 'cablesim.catalogue-published-guidance/99'
    elif kind == 'missing_fact':
        guide['material_facts'].pop()
    elif kind == 'missing_table':
        guide['correction_tables'].pop()
    elif kind == 'numeric_boolean':
        factor = next(item for item in table['factors'] if item['value'] == 1)
        factor['value'] = True
    elif kind == 'boolean_number':
        guide['reviewed'] = 0
    elif kind == 'null':
        reference['published_guidance'] = None
    elif kind == 'empty':
        reference['published_guidance'] = {}
    else:
        raise AssertionError(kind)
    # A transfer checksum can always be recomputed. Neither that checksum nor
    # the guidance's self-reported digest authenticates a changed manufacturer.
    if reference['published_guidance']:
        guide['content_sha256'] = guidance_digest(guide)


@pytest.mark.parametrize('format', ['json', 'xlsx'])
def test_recomputed_digests_cannot_forge_builtin_guidance_at_preview_or_import(tmp_path, bahra_source, format):
    kinds = ('material_value', 'factor_value', 'condition', 'source_page', 'source_identity', 'method_version',
             'verified', 'reviewed', 'wrong_id', 'wrong_schema', 'missing_fact', 'missing_table',
             'numeric_boolean', 'boolean_number', 'null', 'empty')
    canonical_bytes = published_guidance.CATALOGUE.read_bytes()
    with TestClient(create_app(tmp_path / 'target.sqlite')) as client:
        for kind in kinds:
            bundle = deepcopy(bahra_source['bundle'])
            corrupt_guidance(bundle['series'][0]['declaration']['reference'], kind)
            content = exchange_file(bundle, format)
            for endpoint in ('preview', 'import'):
                response = client.post('/api/type-library/exchange/' + endpoint,
                    files={'file': ('types.' + format, content)}, headers=HUMAN,
                    data={'reviewed_sha256': sha256(content).hexdigest(), 'confirmed': 'true', 'request_id': str(uuid4())})
                assert response.status_code == 422, (kind, endpoint, response.text)
                assert response.json()['detail']['code'] == 'PUBLISHED_GUIDANCE_INVALID', (kind, response.text)
            assert_no_import(client)
    assert published_guidance.CATALOGUE.read_bytes() == canonical_bytes


def test_uploaded_declaration_rejects_forged_guidance_before_saving_preview(tmp_path, bahra_source):
    declaration = deepcopy(bahra_source['declaration'])
    corrupt_guidance(declaration['series']['reference'], 'material_value')
    with TestClient(create_app(tmp_path / 'target.sqlite')) as client:
        response = preview_upload(client, bahra_source['original'], declaration)
        assert response.status_code == 422, response.text
        assert response.json()['detail']['code'] == 'PUBLISHED_GUIDANCE_INVALID'
        assert_no_import(client)


@pytest.mark.parametrize('change', ['missing', 'changed', 'self_consistent_new_content'])
def test_saved_preview_must_revalidate_current_builtin_guidance_before_commit(tmp_path, bahra_source, monkeypatch, change):
    with TestClient(create_app(tmp_path / 'target.sqlite')) as client:
        response = preview_upload(client, bahra_source['original'], deepcopy(bahra_source['declaration']))
        assert response.status_code == 200, response.text
        installed = tmp_path / 'installed-catalogue.json'
        if change != 'missing':
            catalogue = json.loads(published_guidance.CATALOGUE.read_text('utf-8'))
            catalogue['published_guidance']['material_facts'][0]['value'] *= 2
            if change == 'self_consistent_new_content':
                catalogue['published_guidance']['content_sha256'] = guidance_digest(catalogue['published_guidance'])
            installed.write_text(json.dumps(catalogue, ensure_ascii=False), encoding='utf-8')
        monkeypatch.setattr(published_guidance, 'CATALOGUE', installed)
        refused = confirm_preview(client, response.json())
        expected_status = 422 if change == 'self_consistent_new_content' else 409
        expected_code = 'PUBLISHED_GUIDANCE_INVALID' if change == 'self_consistent_new_content' else 'PUBLISHED_GUIDANCE_UNAVAILABLE'
        assert refused.status_code == expected_status, refused.text
        assert refused.json()['detail']['code'] == expected_code
        assert_no_import(client)


@pytest.mark.parametrize('kind', ['null', 'empty', 'material_value', 'unavailable', 'legacy_reference'])
def test_existing_database_read_revalidates_only_reserved_guidance_without_rewriting_evidence(tmp_path, bahra_source, monkeypatch, kind):
    """Older releases accepted any dictionary under reference, including this new key."""
    target = tmp_path / 'previous-release.sqlite'
    with sqlite3.connect('file:' + bahra_source['database'].as_posix() + '?mode=ro', uri=True) as source, sqlite3.connect(target) as db:
        source.backup(db)
        identifier, original = db.execute('SELECT id,declaration FROM type_series').fetchone()
        declaration = json.loads(original)
        if kind == 'legacy_reference':
            declaration['reference'] = {'notes': {'text': '企业原有参考声明，不冒充内置指南', 'reviewed': False}}
        elif kind != 'unavailable':
            corrupt_guidance(declaration['reference'], kind)
        stored = json.dumps(declaration, ensure_ascii=False, sort_keys=True)
        db.execute('UPDATE type_series SET declaration=? WHERE id=?', (stored, identifier))
        db.commit()
    if kind == 'unavailable':
        monkeypatch.setattr(published_guidance, 'CATALOGUE', tmp_path / 'missing-catalogue.json')
    # Restart over the actual persisted database. No writer/API is replaced,
    # and neither a read nor a refusal may silently upgrade the old evidence.
    with TestClient(create_app(target)) as client:
        for endpoint in ('/api/type-library/series', '/api/type-library/series/' + identifier):
            response = client.get(endpoint)
            if kind == 'legacy_reference':
                assert response.status_code == 200, response.text
                actual = response.json()['items'][0] if endpoint.endswith('/series') else response.json()['declaration']
                assert actual['reference'] == declaration['reference']
            else:
                assert response.status_code == (409 if kind == 'unavailable' else 422), response.text
                code = 'PUBLISHED_GUIDANCE_UNAVAILABLE' if kind == 'unavailable' else 'PUBLISHED_GUIDANCE_INVALID'
                assert response.json()['detail']['code'] == code
    with sqlite3.connect(target) as db:
        assert db.execute('SELECT declaration FROM type_series WHERE id=?', (identifier,)).fetchone()[0] == stored
        assert db.execute('SELECT COUNT(*) FROM type_series_specs').fetchone()[0] == 13
        assert db.execute('SELECT COUNT(*) FROM domain_cable_models').fetchone()[0] == 13
