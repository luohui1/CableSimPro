"""Declared voltage identity survives all importer construction paths."""
from copy import deepcopy
import json
import sqlite3
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.kernel import candidates
from backend.kernel.public_catalogues import sample_bytes
from backend.kernel.type_library_exchange import workbook_bytes
from backend.kernel.workspace import fingerprint
from backend.main import create_app
from test_tai_i_220kv_import import CSV_BYTES, DATA, HUMAN


def exchange_bytes(bundle, format):
    for series in bundle['series']:
        for spec in series['specs']:
            spec['content_sha256'] = fingerprint(spec['payload'])
            spec['metadata']['source_model_digest'] = spec['content_sha256']
    bundle['sha256'] = fingerprint({key: value for key, value in bundle.items() if key != 'sha256'})
    return workbook_bytes(bundle) if format == 'xlsx' else json.dumps(bundle, ensure_ascii=False).encode()


@pytest.fixture(scope='module')
def tai_i_exchange(tmp_path_factory):
    """An actual source-backed API export; legacy variants change only Um."""
    with TestClient(create_app(tmp_path_factory.mktemp('voltage-exchange') / 'source.sqlite')) as client:
        uploaded = client.post('/api/type-library/imports/upload', files={'file': ('tai-i-220kv.csv', CSV_BYTES)})
        assert uploaded.status_code == 201, uploaded.text
        upload = uploaded.json()
        response = client.post('/api/type-library/imports/preview', json={
            'upload_id': upload['upload_id'], 'sheet': upload['sheets'][0]['name'], 'first_data_row': 2,
            'mapping': DATA['mapping'], 'series': {**deepcopy(DATA['declaration']), 'source': deepcopy(DATA['source'])}})
        assert response.status_code == 200, response.text
        preview = response.json()
        saved = client.post('/api/type-library/imports/commit', headers=HUMAN, json={
            'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'],
            'request_id': str(uuid4()), 'human_confirmed': True})
        assert saved.status_code == 201, saved.text
        exported = client.post('/api/type-library/exchange/export', json={
            'series_ids': [saved.json()['series_id']], 'format': 'json'})
        assert exported.status_code == 200, exported.text
        return exported.json()


@pytest.mark.parametrize('declared_um', [17500, None])
def test_completed_people_models_keep_the_declared_um_without_inference(tmp_path, declared_um):
    """Withdraw Um in one case; no other published cell is changed or guessed."""
    with TestClient(create_app(tmp_path / 'types.sqlite')) as client:
        uploaded = client.post('/api/type-library/imports/upload', files={
            'file': ('people.xlsx', sample_bytes('people-mv'))})
        assert uploaded.status_code == 201, uploaded.text
        upload = uploaded.json()
        declaration = deepcopy(upload['declarations'][1])
        declaration.pop('table')
        assert declaration['series']['um_v'] == 17500
        declaration['series']['um_v'] = declared_um
        checked = client.post('/api/type-library/imports/preview', json={
            'upload_id': upload['upload_id'], **declaration})
        assert checked.status_code == 200, checked.text
        preview = checked.json()
        assert (preview['valid_count'], preview['error_count'], preview['incomplete_count']) == (11, 0, 0)
        assert all(row['derivation']['kind'] == 'plugin' for row in preview['rows'])
        for row in preview['rows']:
            assert row['payload']['cable_type']['rating']['um'] == declared_um
        saved = client.post('/api/type-library/imports/commit', headers={'X-CableSim-Actor': 'human'}, json={
            'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'],
            'request_id': str(uuid4()), 'human_confirmed': True})
        assert saved.status_code == 201, saved.text
        models = {item['id']: item for item in client.get('/api/domain-cable-models').json()}
        for spec in saved.json()['specs']:
            assert models[spec['model_id']]['payload']['cable_type']['rating']['um'] == declared_um
            workspace = client.get('/api/workspaces/' + spec['workspace_id']).json()
            assert workspace['domain']['cable_types'][0]['rating']['um'] == declared_um
        exported = client.post('/api/type-library/exchange/export', json={
            'series_ids': [saved.json()['series_id']], 'format': 'json'})
        assert exported.status_code == 200, exported.text
        changed = exported.json()
        changed['series'][0]['specs'][0]['payload']['cable_type']['rating']['um'] = 18000
        response = client.post('/api/type-library/exchange/preview', files={
            'file': ('conflicting-voltage.json', exchange_bytes(changed, 'json'))})
        assert response.status_code == 422 and response.json()['detail']['code'] == 'TYPE_EXCHANGE_SERIES'


@pytest.mark.parametrize('format', ['json', 'xlsx'])
def test_explicit_um_conflicts_are_rejected_even_with_recomputed_digests(tmp_path, tai_i_exchange, format):
    with TestClient(create_app(tmp_path / 'rejected.sqlite')) as client:
        for candidate_um, series_um in [(253000, 252000), (252000, 253000), (252000, None)]:
            changed = deepcopy(tai_i_exchange)
            changed['series'][0]['declaration']['um_v'] = series_um
            changed['series'][0]['specs'][0]['payload']['specification']['um_v'] = candidate_um
            content = exchange_bytes(changed, format)
            file = {'file': ('conflicting-voltage.' + format, content)}
            response = client.post('/api/type-library/exchange/preview', files=file)
            assert response.status_code == 422 and response.json()['detail']['code'] == 'TYPE_EXCHANGE_SERIES'
            from hashlib import sha256
            response = client.post('/api/type-library/exchange/import', files=file, headers=HUMAN, data={
                'reviewed_sha256': sha256(content).hexdigest(), 'confirmed': 'true', 'request_id': str(uuid4())})
            assert response.status_code == 422 and response.json()['detail']['code'] == 'TYPE_EXCHANGE_SERIES'
        assert client.get('/api/type-library/series').json() == {'items': []}
        assert client.get('/api/domain-cable-models').json() == []


@pytest.mark.parametrize('format', ['json', 'xlsx'])
@pytest.mark.parametrize('historical_field', ['absent', 'null'])
def test_real_pre_um_exchange_preserves_unknown_value_and_original_digest(tmp_path, tai_i_exchange, format, historical_field):
    historical = deepcopy(tai_i_exchange)
    assert historical['series'][0]['declaration']['um_v'] == 252000
    for spec in historical['series'][0]['specs']:
        if historical_field == 'absent':
            spec['payload']['specification'].pop('um_v')
        else:
            spec['payload']['specification']['um_v'] = None
    content = exchange_bytes(historical, format)
    with TestClient(create_app(tmp_path / 'historical.sqlite')) as client:
        file = {'file': ('historical-types.' + format, content)}
        preview = client.post('/api/type-library/exchange/preview', files=file)
        assert preview.status_code == 200, preview.text
        imported = client.post('/api/type-library/exchange/import', files=file, headers=HUMAN, data={
            'reviewed_sha256': preview.json()['file_sha256'], 'confirmed': 'true', 'request_id': str(uuid4())})
        assert imported.status_code == 201, imported.text
        models = {item['id']: item for item in client.get('/api/domain-cable-models').json()}
        saved = imported.json()['series'][0]
        assert len(saved['specs']) == 12
        for spec, old in zip(saved['specs'], historical['series'][0]['specs'], strict=True):
            model = models[spec['model_id']]
            assert model['payload'] == old['payload'] and model['digest'] == old['content_sha256']
            assert model['state'] == 'incomplete'
            workspace = client.get('/api/workspaces/' + spec['workspace_id']).json()
            assert workspace['type_origin_reference']['declared_specification'] == old['payload']['specification']
            assert workspace['domain']['cable_types'][0]['rating']['um'] is None
        exported = client.post('/api/type-library/exchange/export', json={
            'series_ids': [saved['series_id']], 'format': 'json'})
        assert exported.status_code == 200, exported.text
        for returned, old in zip(exported.json()['series'][0]['specs'], historical['series'][0]['specs'], strict=True):
            assert returned['payload'] == old['payload'] and returned['content_sha256'] == old['content_sha256']


def test_pre_um_candidate_payload_remains_readable_without_rewriting_its_digest():
    """A new optional field must not mutate old immutable candidate bytes."""
    payload = {'name': '历史缺项候选兼容接口夹具', 'version': '1', 'confirmed': False,
        'materials': [], 'specification': {'manufacturer': '接口夹具（非厂家）',
            'designation': 'YJV22', 'u0_v': 26000, 'voltage_v': 35000, 'cores': 3,
            'area_m2': .00024, 'conductor': 'copper_bare',
            'values': {'insulation_thickness': {'value': .0105, 'unit': 'm',
                'basis': 'engineer_given', 'source': 'fixture'}},
            'missing': ['用于验证历史字段缺失的兼容性，不是厂家资料。']},
        'sources': {'fixture': {'kind': 'demo', 'reviewed': False,
            'reference': '历史候选读取接口夹具；不作工程计算或厂家数据证明。'}}}
    digest = fingerprint(payload)
    with sqlite3.connect(':memory:') as db:
        db.row_factory = sqlite3.Row
        candidates.initialize(db)
        db.execute('INSERT INTO domain_cable_models VALUES(?,?,?,?,?)',
                   ('pre-um', json.dumps(payload, ensure_ascii=False), digest, 'incomplete', 'fixture'))
        stored = candidates.read(db, 'pre-um')
    assert stored['payload'] == payload and stored['digest'] == digest
    assert 'um_v' not in stored['payload']['specification']
    assert candidates.CableModelVersion.model_validate(payload).specification.um_v is None
