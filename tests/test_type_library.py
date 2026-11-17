"""Real import, revision and two-machine transfer through the canonical API."""
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
import sqlite3
from uuid import uuid4

from fastapi.testclient import TestClient
from openpyxl import load_workbook
import pytest

from backend.main import create_app
from backend.kernel.public_catalogues import sample_bytes


HUMAN = {'X-CableSim-Actor': 'human'}


def import_series(client, name='真实人民电缆三芯系列'):
    upload = client.post('/api/type-library/imports/upload', files={'file': ('people.xlsx', sample_bytes('people-mv'))})
    assert upload.status_code == 201, upload.text
    uploaded = upload.json()
    declaration = deepcopy(uploaded['declarations'][1])
    declaration.pop('table', None)
    declaration['series']['name'] = name
    preview = client.post('/api/type-library/imports/preview', json={'upload_id': uploaded['upload_id'], **declaration})
    assert preview.status_code == 200, preview.text
    value = preview.json()
    assert value['valid_count'] == 11 and value['error_count'] == value['incomplete_count'] == 0
    body = {'preview_id': value['preview_id'], 'preview_digest': value['preview_digest'],
            'request_id': str(uuid4()), 'human_confirmed': True}
    forbidden = client.post('/api/type-library/imports/commit', json=body, headers={'X-CableSim-Actor': 'agent'})
    assert forbidden.status_code in (403, 409)
    committed = client.post('/api/type-library/imports/commit', json=body, headers=HUMAN)
    assert committed.status_code == 201, committed.text
    assert client.post('/api/type-library/imports/commit', json=body, headers=HUMAN).json() == committed.json()
    assert len(client.get('/api/type-library/series').json()['items']) == 1
    return committed.json(), value


def test_import_rejects_formula_and_stale_preview_without_partial_writes(tmp_path):
    with TestClient(create_app(tmp_path / 'first' / 'db.sqlite')) as client:
        book = load_workbook(BytesIO(sample_bytes('people-mv')))
        book.worksheets[1]['B5'] = '=6+1'
        stream = BytesIO()
        book.save(stream)
        book.close()
        raw = client.post('/api/type-library/imports/upload', files={'file': ('changed.xlsx', stream.getvalue())}).json()
        original = client.post('/api/type-library/imports/upload', files={'file': ('people.xlsx', sample_bytes('people-mv'))}).json()
        declaration = original['declarations'][1]
        declaration.pop('table', None)
        response = client.post('/api/type-library/imports/preview', json={'upload_id': raw['upload_id'], **declaration})
        assert response.status_code == 200, response.text
        preview = response.json()
        assert preview['error_count'] == 1
        assert preview['rows'][0]['issues'][0]['column'] == 'B5'
        body = {'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'],
                'request_id': str(uuid4()), 'human_confirmed': True}
        assert client.post('/api/type-library/imports/commit', json=body, headers=HUMAN).status_code == 422
        assert client.get('/api/type-library/series').json() == {'items': []}
        body['preview_digest'] = '0' * 64
        assert client.post('/api/type-library/imports/commit', json=body, headers=HUMAN).status_code == 409
        assert client.get('/api/type-library/series').json() == {'items': []}


def test_revision_uses_existing_type_family_and_keeps_original_sources(tmp_path):
    path = tmp_path / 'types.sqlite'
    with TestClient(create_app(path)) as client:
        imported, preview = import_series(client)
        identifier = imported['specs'][0]['id']
        original = client.get('/api/type-library/specs/' + identifier).json()['spec']
        body = {'request_id': str(uuid4()), 'expected_version': 1, 'expected_revision': original['workspace_revision'],
                'note': '保留原始结构表并建立新的工程核对版本。', 'human_confirmed': True}
        response = client.post(f'/api/type-library/specs/{identifier}/revisions', json=body, headers=HUMAN)
        assert response.status_code == 201, response.text
        revision = response.json()
        assert revision['version'] == 2 and revision['state'] == 'draft'
        assert revision['workspace_id'] != original['workspace_id']
        assert client.post(f'/api/type-library/specs/{identifier}/revisions', json=body, headers=HUMAN).json() == revision
        detail = client.get('/api/type-library/specs/' + identifier).json()
        assert [version['version'] for version in detail['versions']] == [2, 1]
        assert detail['values'] == preview['rows'][0]['values']
        assert not detail['spec']['has_design_changes']
        assert client.get(f'/api/type-library/specs/{identifier}?version=1').json()['spec']['model_id'] == original['model_id']
        stale = {**body, 'request_id': str(uuid4())}
        assert client.post(f'/api/type-library/specs/{identifier}/revisions', json=stale, headers=HUMAN).status_code == 409
    with sqlite3.connect(path) as db:
        families = db.execute('SELECT family FROM type_plans WHERE workspace IN (?,?)',
                              (original['workspace_id'], revision['workspace_id'])).fetchall()
        assert len(families) == 2 and families[0] == families[1]
        assert db.execute('SELECT count(*) FROM type_submissions').fetchone()[0] == 0


@pytest.mark.parametrize('format', ['json', 'xlsx'])
def test_two_machine_series_exchange_preserves_cells_and_originals(tmp_path, format):
    target = tmp_path / 'second.sqlite'
    with TestClient(create_app(tmp_path / 'first.sqlite')) as first, TestClient(create_app(target)) as second:
        imported, preview = import_series(first)
        response = first.post('/api/type-library/exchange/export', json={'series_ids': [imported['series_id']], 'format': format})
        assert response.status_code == 200, response.text[:1000]
        content = response.content
        assert response.headers['x-content-sha256'] == sha256(content).hexdigest()
        upload = {'file': ('types.' + format, content)}
        checked = second.post('/api/type-library/exchange/preview', files=upload)
        assert checked.status_code == 200, checked.text
        assert checked.json()['series'][0]['spec_count'] == 11
        assert checked.json()['original_file_count'] == 1
        form = {'reviewed_sha256': checked.json()['file_sha256'], 'confirmed': 'true', 'request_id': str(uuid4())}
        refusal = second.post('/api/type-library/exchange/import', files=upload, data=form)
        assert refusal.status_code in (403, 409)
        saved = second.post('/api/type-library/exchange/import', files=upload, data=form, headers=HUMAN)
        assert saved.status_code == 201, saved.text
        assert saved.json()['created'] == 11 and saved.json()['state'] == 'draft'
        assert second.post('/api/type-library/exchange/import', files=upload, data=form, headers=HUMAN).json() == saved.json()
        new_id = saved.json()['series'][0]['series_id']
        assert new_id != imported['series_id']
        actual = second.get('/api/type-library/series/' + new_id).json()['specs']
        assert [spec['values'] for spec in actual] == [row['values'] for row in preview['rows']]
        assert all(spec['state'] == 'draft' and not spec['results'] for spec in actual)
        conflict = {**form, 'request_id': str(uuid4())}
        assert second.post('/api/type-library/exchange/import', files=upload, data=conflict, headers=HUMAN).status_code == 409
        assert len(second.get('/api/type-library/series').json()['items']) == 1
        invalid = second.post('/api/type-library/exchange/import', files=upload,
                             data={**conflict, 'reviewed_sha256': '0' * 64}, headers=HUMAN)
        assert invalid.status_code == 409
    with sqlite3.connect(target) as db:
        original = db.execute('SELECT original FROM type_table_uploads').fetchone()[0]
        assert original == sample_bytes('people-mv')
        assert db.execute('SELECT count(*) FROM type_submissions').fetchone()[0] == 0


def test_missing_sample_and_table_are_explicit_not_internal_errors(tmp_path):
    with TestClient(create_app(tmp_path / 'samples.sqlite')) as client:
        assert client.get('/api/type-library/samples/absent.xlsx').status_code == 404
        assert client.post('/api/type-library/catalogue-comparison/absent').status_code == 404
        assert client.get('/api/type-library/samples/people-mv.csv?table=absent').status_code == 404
