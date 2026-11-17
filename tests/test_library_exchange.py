"""Production HTTP routes and two fresh databases, preserving original data.

The material property is a real IEC reference. The project is explicitly an
existing structural demonstration; this suite tests transport, not its physics.
"""
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from backend.kernel.resource_exchange import TRANSFER_SHEET, encoded, parse_file
from backend.kernel.workspace import fingerprint
from backend.main import create_app


@pytest.fixture
def clients(tmp_path):
    with TestClient(create_app(tmp_path / 'source.sqlite')) as source:
        with TestClient(create_app(tmp_path / 'target.sqlite')) as target:
            yield source, target


def source_material(client, *, asset_id='reference.xlpe', name='XLPE 标准热阻率'):
    response = client.get('/api/library/resources/table', params={
        'category': 'materials', 'table_id': 'iec60287-2-1-table1'})
    assert response.status_code == 200, response.text
    table = response.json()
    row = next(row for row in table['rows'] if row['id'] == 'iec60287-2-1-table1/r7/c1')
    reference = (row['citation'] + '; source_sha256:' + row['source_sha256']
                 + '; record_sha256:' + row['record_sha256'] + '; method:'
                 + table['method']['plugin_id'] + ':lookup@' + table['method']['method_version'])
    release = {'asset_id': asset_id, 'version': '1.0.0', 'kind': 'material', 'name': name,
               'parameters': [{'name': 'thermal_resistivity', 'quantity': {
                   'dimension': 'thermal_resistivity', 'value': row['value'], 'unit': 'K.m/W'}}],
               'sources': [{'kind': 'standard', 'reference': reference, 'reviewed': False}]}
    response = client.post('/api/foundation/assets/import', json={'schema_version': 'csp-asset/0.1', 'release': release})
    assert response.status_code == 201, response.text
    return response.json()


def published(client, asset):
    for action in ('review', 'publish'):
        response = client.post(f'/api/foundation/assets/{asset["id"]}/transition', json={
            'expected_revision': asset['revision'], 'content_sha256': asset['content_sha256'],
            'action': action, 'note': '逐项核对 IEC 原始引文与单位；仍为标准参考值。', 'acknowledge_sources': True})
        assert response.status_code == 200, response.text
        asset = response.json()
    return asset


def study(client):
    models = client.get('/api/design/cable-models').json()
    model = next(model for model in models if model['id'] == 'system.cu-xlpe-al-240')
    response = client.post('/api/design/study-workspaces', json={
        'model_id': model['id'], 'content_sha256': model['content_sha256'], 'project_name': '传输测试 · 原有结构演示'})
    assert response.status_code == 201, response.text
    return response.json()


def export(client, *, asset=None, project=None, format='json'):
    response = client.post('/api/library/exchange/export', json={
        'asset_ids': [asset['id']] if asset else [], 'workspace_ids': [project['id']] if project else [], 'format': format})
    assert response.status_code == 200, response.text
    assert response.headers['x-content-sha256'] == sha256(response.content).hexdigest()
    bundle = parse_file('data.' + format, response.content)
    assert response.headers['x-bundle-sha256'] == bundle['sha256']
    return response.content, bundle


def upload(client, filename, data, *, request_id=None, reviewed=None, actor='human', confirmed='true'):
    preview = client.post('/api/library/exchange/preview', files={'file': (filename, data)})
    assert preview.status_code == 200, preview.text
    response = client.post('/api/library/exchange/import', files={'file': (filename, data)},
        data={'request_id': request_id or str(uuid4()), 'reviewed_sha256': reviewed or preview.json()['sha256'],
              'confirmed': confirmed}, headers={'X-CableSim-Actor': actor} if actor else {})
    return preview.json(), response


@pytest.mark.parametrize('format', ['json', 'xlsx'])
def test_real_material_and_project_roundtrip_do_not_copy_approval(clients, format):
    source, target = clients
    material, project = published(source, source_material(source)), study(source)
    data, original = export(source, asset=material, project=project, format=format)
    before = target.get('/api/workspaces').json()
    preview = target.post('/api/library/exchange/preview', files={'file': ('data.' + format, data)})
    assert preview.status_code == 200, preview.text
    assert target.get('/api/workspaces').json() == before
    assert preview.json()['assets'][0]['action'] == 'create_draft'
    assert preview.json()['approval_inherited'] is False
    request_id = str(uuid4())
    _, imported = upload(target, 'data.' + format, data, request_id=request_id)
    assert imported.status_code == 201, imported.text
    receipt = imported.json()
    transferred = target.get('/api/foundation/assets/' + receipt['assets'][0]['id']).json()
    assert transferred['release'] == material['release']
    assert transferred['content_sha256'] == material['content_sha256']
    assert transferred['status'] == 'draft' and transferred['reviewed_sha256'] is None
    copied = target.get('/api/workspaces/' + receipt['projects'][0]['id']).json()
    for key, value in original['projects'][0]['inputs'].items():
        assert copied[key] == value, key
    assert copied['id'] != project['id'] and copied['revision'] == 1
    assert copied['exchange_origin']['approval_inherited'] is False
    assert not copied['runs']
    assert target.get('/api/types/library').json()['items'] == []
    _, repeated = upload(target, 'data.' + format, data, request_id=request_id)
    assert repeated.json() == receipt
    assert len(target.get('/api/workspaces').json()) == len(before) + 1
    # Re-export is lossless for the data itself despite new local identities.
    _, restored = export(target, asset=transferred, project=copied, format=format)
    assert restored['assets'][0]['release'] == original['assets'][0]['release']
    assert restored['projects'][0]['inputs'] == original['projects'][0]['inputs']
    assert source.get('/api/foundation/assets/' + material['id']).json()['status'] == 'published'


def test_missing_preview_acknowledgement_and_payload_tampering_cannot_write(clients):
    source, target = clients
    data, bundle = export(source, asset=source_material(source))
    for actor, confirmed, status in [(None, 'true', 403), ('agent', 'true', 403), ('human', 'false', 403)]:
        _, result = upload(target, 'data.json', data, actor=actor, confirmed=confirmed)
        assert result.status_code == status, result.text
    _, result = upload(target, 'data.json', data, reviewed='0' * 64)
    assert result.status_code == 409
    modified = deepcopy(bundle)
    modified['assets'][0]['release']['parameters'][0]['quantity']['value'] = 99
    response = target.post('/api/library/exchange/preview', files={'file': ('data.json', encoded(modified))})
    assert response.status_code == 409
    modified['sha256'] = fingerprint({key: value for key, value in modified.items() if key != 'sha256'})
    response = target.post('/api/library/exchange/preview', files={'file': ('data.json', encoded(modified))})
    assert response.status_code == 409  # inner asset digest is also checked
    assert target.get('/api/foundation/assets').json()['total'] == 0


def test_dependency_closure_and_conflict_are_atomic(clients):
    source, target = clients
    material = source_material(source)
    release = {'asset_id': 'reference.layer', 'version': '1.0.0', 'kind': 'component', 'name': 'XLPE 材料引用',
               'dependencies': [{'asset_id': material['asset_id'], 'version': material['version'],
                                 'content_sha256': material['content_sha256']}],
               'sources': material['release']['sources']}
    response = source.post('/api/foundation/assets/import', json={'schema_version': 'csp-asset/0.1', 'release': release})
    assert response.status_code == 201, response.text
    component = response.json()
    data, bundle = export(source, asset=component)
    assert [item['release']['asset_id'] for item in bundle['assets']] == ['reference.xlpe', 'reference.layer']
    conflict = source_material(target, name='本机明确不同的材料版本名称')
    response = target.post('/api/library/exchange/preview', files={'file': ('data.json', data)})
    assert response.status_code == 409
    response = target.post('/api/library/exchange/import', files={'file': ('data.json', data)},
        data={'request_id': str(uuid4()), 'reviewed_sha256': bundle['sha256'], 'confirmed': 'true'},
        headers={'X-CableSim-Actor': 'human'})
    assert response.status_code == 409
    assert target.get('/api/foundation/assets').json()['total'] == 1
    assert target.get('/api/foundation/assets/' + conflict['id']).json() == conflict


def test_workbook_literals_and_modified_transfer_cells(clients):
    source, target = clients
    data, _ = export(source, asset=source_material(source, name='=XLPE_REFERENCE'), format='xlsx')
    workbook = load_workbook(BytesIO(data), data_only=False)
    assert workbook['资源索引（只读）']['A2'].value == '=XLPE_REFERENCE'
    assert workbook['资源索引（只读）']['A2'].data_type == 's'
    workbook[TRANSFER_SHEET]['B2'] = '=1+1'
    changed = BytesIO()
    workbook.save(changed)
    response = target.post('/api/library/exchange/preview', files={'file': ('data.xlsx', changed.getvalue())})
    assert response.status_code == 422
    assert target.get('/api/foundation/assets').json()['total'] == 0


def test_incomplete_project_is_rejected_instead_of_using_demo_defaults(clients):
    source, target = clients
    _, bundle = export(source, project=study(source))
    bundle['projects'][0]['inputs']['scenario']['cable'].pop('insulation_mm')
    bundle['projects'][0]['input_sha256'] = fingerprint(bundle['projects'][0]['inputs'])
    bundle['sha256'] = fingerprint({key: value for key, value in bundle.items() if key != 'sha256'})
    response = target.post('/api/library/exchange/preview', files={'file': ('data.json', encoded(bundle))})
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'EXCHANGE_INCOMPLETE_INPUT'
    assert target.get('/api/workspaces').json() == []


@pytest.mark.parametrize('filename,data', [('data.csv', b'a,b\n1,2'), ('data.xlsx', b'not a zip'), ('data.json', b'{}')])
def test_invalid_file_is_explained_without_creating_data(clients, filename, data):
    _, target = clients
    response = target.post('/api/library/exchange/preview', files={'file': (filename, data)})
    assert response.status_code == 422
    assert target.get('/api/foundation/assets').json()['total'] == 0
    assert target.get('/api/workspaces').json() == []
