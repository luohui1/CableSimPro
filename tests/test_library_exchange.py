"""Production HTTP routes and two fresh databases, preserving original data.

The material property is a real IEC reference. The project is explicitly an
existing structural demonstration; this suite tests transport, not its physics.
"""
from copy import deepcopy
from hashlib import sha256
import importlib.util
from io import BytesIO
import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from backend.kernel.resource_exchange import PROJECT_KEYS, PROJECT_LIMIT, PROJECT_MAX_LOCKS, TRANSFER_SHEET, encoded, parse_file, workbook_bytes
from backend.kernel.project_exchange import LEGACY_SOURCE_SCHEMA, SOURCE_SCHEMA
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


def candidate_study(client, references=None):
    """Use actual model APIs and existing explicit teaching inputs, not a solver fixture."""
    model = next(item for item in client.get('/api/design/cable-models').json()
                 if item['id'] == 'system.cu-xlpe-al-240')
    payload = deepcopy(model['payload'])
    # An unused material proves that a study projection is not the full version.
    payload['materials'].append({**deepcopy(payload['materials'][0]),
                                 'id': 'material/unbound', 'label': '未引用的演示材料'})
    # Deliberately retain an order different from canonical exchange JSON.
    references = references or {'/materials/material~1cu': model['source'],
        '/': f"系统演示 {model['id']} @{model['version']} sha256:{model['content_sha256']}；仅验证输入搬运。"}
    response = client.post('/api/domain-cable-models', json={
        'name': '传输演示', 'version': '1.0.0', **payload,
        'sources': {key: {'kind': 'demo', 'reviewed': False, 'reference': value}
                    for key, value in references.items()},
        'confirmed': False})
    assert response.status_code == 201, response.text
    candidate = response.json()
    response = client.post('/api/design/study-workspaces', json={
        'model_id': 'candidate:' + candidate['id'], 'content_sha256': candidate['digest'],
        'project_name': '候选型号研究输入搬运'})
    assert response.status_code == 201, response.text
    project = response.json()
    assert project['study_cable_reference']['content_sha256'] != fingerprint(
        project['study_cable_reference']['payload'])
    return candidate, project


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


def project_wire(bundle, format, *, legacy=False):
    """Encode the real inputs, optionally as the previously emitted /1 proof."""
    bundle = deepcopy(bundle)
    for project in bundle['projects']:
        proof = project['inputs']['study_cable_reference']['source_snapshot']
        if legacy:
            proof['schema'] = LEGACY_SOURCE_SCHEMA
            proof.pop('source_reference_order', None)
        project['input_sha256'] = fingerprint(project['inputs'])
    bundle['sha256'] = fingerprint({key: value for key, value in bundle.items() if key != 'sha256'})
    return (workbook_bytes(bundle) if format == 'xlsx' else encoded(bundle)), bundle


def refuse_project(target, data, bundle, format, code):
    before = target.get('/api/workspaces').json()
    for route in ('preview', 'import'):
        response = target.post('/api/library/exchange/' + route,
            files={'file': ('data.' + format, data)},
            data={'request_id': str(uuid4()), 'reviewed_sha256': bundle['sha256'], 'confirmed': 'true'},
            headers={'X-CableSim-Actor': 'human'})
        assert response.status_code == 422, (route, response.text)
        assert response.json()['detail']['code'] == code, (route, response.text)
        assert target.get('/api/workspaces').json() == before
        assert target.get('/api/domain-cable-models').json() == []
        assert target.get('/api/types/library').json()['items'] == []


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


@pytest.mark.parametrize('format', ['json', 'xlsx'])
def test_current_system_snapshots_roundtrip_without_rewriting_fixed_versions(clients, format):
    source, target = clients
    models = source.get('/api/design/cable-models').json()
    transferred = set()
    for model in models:
        assert model['id'].startswith('system.')
        response = source.post('/api/design/study-workspaces', json={
            'model_id': model['id'], 'content_sha256': model['content_sha256'],
            'project_name': '固定系统输入搬运 · ' + model['name']})
        assert response.status_code == 201, response.text
        project = response.json()
        inputs = {key: value for key, value in project.items() if key in PROJECT_KEYS}
        assert len(encoded(inputs)) <= PROJECT_LIMIT, model['id']
        data, original = export(source, project=project, format=format)
        _, imported = upload(target, 'data.' + format, data)
        assert imported.status_code == 201, (model['id'], imported.text)
        copied = target.get('/api/workspaces/' + imported.json()['projects'][0]['id']).json()
        assert copied['study_cable_reference'] == project['study_cable_reference']
        assert copied['study_cable_reference']['payload'] == model['payload']
        assert copied['study_cable_reference']['state'] == 'demo'
        assert copied['exchange_origin']['approval_inherited'] is False
        _, restored = export(target, project=copied, format=format)
        assert restored['projects'][0]['inputs'] == original['projects'][0]['inputs']
        # Imported binding metadata remains usable by the actual model API.
        rebound = target.post('/api/design/workspaces/' + copied['id'] + '/cable-reference', json={
            'model_id': model['id'], 'content_sha256': model['content_sha256'],
            'expected_revision': copied['revision']})
        assert rebound.status_code == 200, (model['id'], rebound.text)
        transferred.add(model['id'])
    assert transferred == {model['id'] for model in models}


@pytest.mark.parametrize('format', ['json', 'xlsx'])
@pytest.mark.parametrize('kind', ['system', 'candidate'])
def test_empty_or_malformed_source_snapshot_preserves_original_contract(clients, kind, format):
    source, target = clients
    project = study(source) if kind == 'system' else candidate_study(source)[1]
    _, original = export(source, project=project, format=format)
    for value in ('missing', None, [], False, {}):
        bundle = deepcopy(original)
        item = bundle['projects'][0]
        binding = item['inputs']['study_cable_reference']
        if value == 'missing':
            binding.pop('source_snapshot', None)
        else:
            binding['source_snapshot'] = value
        item['input_sha256'] = fingerprint(item['inputs'])
        bundle['sha256'] = fingerprint({key: part for key, part in bundle.items() if key != 'sha256'})
        wire = workbook_bytes(bundle) if format == 'xlsx' else encoded(bundle)
        if kind == 'system' and (value == 'missing' or value is None):
            preview, imported = upload(target, 'data.' + format, wire)
            assert imported.status_code == 201, imported.text
            assert 'published_model' not in preview['projects'][0]
            copied = target.get('/api/workspaces/' + imported.json()['projects'][0]['id']).json()
            assert copied['study_cable_reference'] == binding
            # Export the saved explicit null too: a default only handles an
            # absent key, and must not produce a server error here.
            _, exported_again = export(target, project=copied, format=format)
            assert exported_again['projects'][0]['inputs'] == item['inputs']
        else:
            refuse_project(target, wire, bundle, format, 'EXCHANGE_CABLE_SOURCE')


@pytest.mark.parametrize('format', ['json', 'xlsx'])
def test_release_projects_keep_complete_provenance_across_databases(tmp_path, release_seed_copy, format):
    path = Path(__file__).resolve().parents[1] / 'frontend/scripts/seed-engineering-demo.py'
    spec = importlib.util.spec_from_file_location('exchange_release_seed', path)
    seed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(seed)
    source_path = release_seed_copy(seed, tmp_path / 'source' / 'engineering.sqlite')
    with TestClient(create_app(source_path)) as source, TestClient(create_app(tmp_path / 'target.sqlite')) as target:
        index = source.get('/api/index/objects', params={'kind': 'project', 'limit': 100})
        assert index.status_code == 200, index.text
        projects = {item['name']: item for item in index.json()['items']}
        names = ('城北变电站 · 10 kV 三回排管', '城南线路 · 110 kV 直埋单回')
        originals = {name: source.get('/api/workspaces/' + projects[name]['id']).json() for name in names}
        response = source.post('/api/library/exchange/export', json={
            'workspace_ids': [project['id'] for project in originals.values()], 'format': format})
        assert response.status_code == 200, response.text
        data = response.content
        original = parse_file('data.' + format, data)
        assert len(original['projects']) == 2
        before = target.get('/api/workspaces').json()
        preview, imported = upload(target, 'data.' + format, data)
        assert imported.status_code == 201, imported.text
        assert len(preview['projects']) == 2
        assert {item['action'] for item in preview['projects']} == {'create_independent_input_copy'}
        receipts = {item['origin_id']: item for item in imported.json()['projects']}
        assert set(receipts) == {project['id'] for project in originals.values()}
        assert len({item['id'] for item in receipts.values()}) == 2
        for name, project in originals.items():
            inputs = next(item['inputs'] for item in original['projects'] if item['origin_id'] == project['id'])
            assert len(encoded(inputs)) <= PROJECT_LIMIT, name
            if name == '城北变电站 · 10 kV 三回排管':
                assert len(encoded(inputs)) > 120 * 1024
                assert 500 < len(inputs['locks']) <= PROJECT_MAX_LOCKS
            assert inputs['domain']['provenance'] == project['domain']['provenance']
            assert inputs['locks'] == project['locks']
            assert inputs['study_cable_reference']['source_snapshot']['payload']
            identifier = receipts[project['id']]['id']
            copied = target.get('/api/workspaces/' + identifier).json()
            assert encoded({key: copied[key] for key in inputs}) == encoded(inputs)
            assert copied['id'] != project['id'] and copied['revision'] == 1
            assert copied['exchange_origin']['approval_inherited'] is False
            assert copied['runs'] == []
            assert target.get('/api/workspaces/' + identifier + '/studies').json() == []
            target_index = target.get('/api/index/objects', params={'kind': 'project', 'limit': 100}).json()
            assert any(item['id'] == identifier for item in target_index['items'])
            _, restored = export(target, project=copied, format=format)
            assert encoded(restored['projects'][0]['inputs']) == encoded(inputs)
            assert source.get('/api/workspaces/' + project['id']).json() == project
        assert len(target.get('/api/workspaces').json()) == len(before) + 2


def test_system_identity_approval_and_binding_metadata_cannot_be_self_certified(clients):
    source, target = clients
    _, original = export(source, project=study(source))
    for change in ('unknown_id', 'old_version', 'name', 'source', 'approval', 'payload', 'defaults', 'defaults_bool', 'locks'):
        bundle = deepcopy(original)
        item = bundle['projects'][0]
        binding = item['inputs']['study_cable_reference']
        if change == 'unknown_id':
            binding['id'] = 'system.unregistered-model'
        elif change == 'old_version':
            binding['version'] = '1.0.0'
        elif change == 'name':
            binding['name'] += ' 外部改版'
        elif change == 'source':
            binding['source'] = '已核对的厂家产品数据'
        elif change == 'approval':
            binding['state'] = 'reviewed'
        elif change == 'payload':
            binding['payload']['cable_type']['label'] += ' 外部改版'
            item['inputs']['domain']['cable_types'][0]['label'] = binding['payload']['cable_type']['label']
        elif change == 'defaults':
            binding['method_defaults']['cablesim.iec60287']['ks'] = 2
        elif change == 'defaults_bool':
            binding['method_defaults']['cablesim.iec60287']['ks'] = True
        else:
            binding['locks'] = None
        # All attacker-controlled digests are recomputed; catalogue identity is
        # checked independently of these internally consistent transport hashes.
        binding['content_sha256'] = fingerprint(binding['payload'])
        item['input_sha256'] = fingerprint(item['inputs'])
        bundle['sha256'] = fingerprint({key: value for key, value in bundle.items() if key != 'sha256'})
        code = 'EXCHANGE_CABLE_REFERENCE' if change == 'locks' else 'EXCHANGE_SYSTEM_MODEL_PROOF'
        for route in ('preview', 'import'):
            response = target.post('/api/library/exchange/' + route,
                files={'file': ('data.json', encoded(bundle))},
                data={'request_id': str(uuid4()), 'reviewed_sha256': bundle['sha256'], 'confirmed': 'true'},
                headers={'X-CableSim-Actor': 'human'})
            assert response.status_code == 422, (change, route, response.text)
            assert response.json()['detail']['code'] == code, (change, route, response.text)
        assert target.get('/api/workspaces').json() == []


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


@pytest.mark.parametrize('format', ['json', 'xlsx'])
@pytest.mark.parametrize('legacy', [False, True])
def test_candidate_study_source_proof_roundtrip_after_both_machines_restart(tmp_path, format, legacy):
    source_path, target_path = tmp_path / 'source.sqlite', tmp_path / 'target.sqlite'
    with TestClient(create_app(source_path)) as source:
        candidate, project = candidate_study(source)
        data, bundle = export(source, project=project, format=format)
        assert bundle['projects'][0]['inputs']['study_cable_reference']['source_snapshot']['source_reference_order'] == list(candidate['payload']['sources'])
        data, bundle = project_wire(bundle, format, legacy=legacy)
        inputs = bundle['projects'][0]['inputs']
        binding = inputs['study_cable_reference']
        assert len(encoded(inputs)) <= PROJECT_LIMIT
        assert binding['content_sha256'] == candidate['digest']
        assert binding['payload'] == project['study_cable_reference']['payload']
        assert binding['source_snapshot']['payload'] == candidate['payload']
        assert list(binding['source_snapshot']['payload']['sources']) != list(candidate['payload']['sources'])
        assert binding['source'] == project['study_cable_reference']['source']
        assert binding['source'] != '；'.join(item['reference'] for item in binding['source_snapshot']['payload']['sources'].values())
        assert binding['source_snapshot']['origin_id'] == 'candidate:' + candidate['id']
        assert binding['source_snapshot']['origin_state'] == candidate['state']
        assert binding['id'].startswith('exchange-model:') and binding['state'] == 'draft'
        assert inputs['domain'] == project['domain']
        assert source.get('/api/workspaces/' + project['id']).json() == project
        assert source.get('/api/domain-cable-models').json() == [candidate]
    # The source app is stopped. No source lookup is available during import.
    with TestClient(create_app(target_path)) as target:
        preview, imported = upload(target, 'data.' + format, data)
        assert imported.status_code == 201, imported.text
        assert preview['approval_inherited'] is False
        target_id = imported.json()['projects'][0]['id']
        assert target_id != project['id']
        assert target.get('/api/domain-cable-models').json() == []
        assert target.get('/api/types/library').json()['items'] == []
    with TestClient(create_app(target_path)) as target:
        restored = target.get('/api/workspaces/' + target_id).json()
        assert restored['study_cable_reference'] == binding
        assert restored['domain'] == project['domain'] and not restored['runs']
        assert restored['exchange_origin']['approval_inherited'] is False
        assert target.get('/api/domain-cable-models').json() == []
        _, exported_again = export(target, project=restored, format=format)
        expected = deepcopy(inputs)
        expected['study_cable_reference']['source_snapshot'].update(
            schema=SOURCE_SCHEMA, source_reference_order=list(candidate['payload']['sources']))
        assert exported_again['projects'][0]['inputs'] == expected
        assert target.get('/api/workspaces/' + target_id).json() == restored
        # Portability does not weaken the existing immutable-model guards.
        changed = deepcopy(restored['domain'])
        changed['cable_types'][0]['cores'][0]['conductor']['r20'] *= 2
        response = target.put('/api/workspaces/' + target_id + '/domain', json={
            'expected_revision': restored['revision'], 'document': changed})
        assert response.status_code == 422
        assert target.get('/api/workspaces/' + target_id).json()['domain'] == restored['domain']


@pytest.mark.parametrize('format', ['json', 'xlsx'])
@pytest.mark.parametrize('legacy', [False, True])
def test_candidate_source_clauses_cannot_be_reassigned_between_whole_references(clients, format, legacy):
    source, target = clients
    candidate, project = candidate_study(source, {
        '/materials/material~1cu': '原件A；已核验', '/': '原件B；未核验'})
    _, original = export(source, project=project, format=format)
    data, original = project_wire(original, format, legacy=legacy)
    response = target.post('/api/library/exchange/preview', files={'file': ('data.' + format, data)})
    assert response.status_code == 200, response.text
    assert target.get('/api/workspaces').json() == []
    forged = deepcopy(original)
    binding = forged['projects'][0]['inputs']['study_cable_reference']
    assert binding['source'] == '原件A；已核验；原件B；未核验'
    binding['source'] = '原件A；未核验；原件B；已核验'
    assert binding['source_snapshot']['payload'] == candidate['payload']
    assert binding['content_sha256'] == candidate['digest']
    data, forged = project_wire(forged, format)
    refuse_project(target, data, forged, format, 'EXCHANGE_CABLE_SOURCE')
    assert source.get('/api/workspaces/' + project['id']).json() == project


@pytest.mark.parametrize('format', ['json', 'xlsx'])
def test_legacy_whole_reference_matching_preserves_duplicates_and_bounds_search(clients, monkeypatch, format):
    source, target = clients
    # The first complete reference is a prefix of another; choosing that longer
    # reference first cannot complete the string. Two distinct keys share text.
    references = {'/cable_type': '原件A', '/materials/material~1xlpe': '原件B；附录C',
                  '/materials/material~1cu': '原件A；原件B', '/materials/material~1al': '原件A'}
    candidate, project = candidate_study(source, references)
    current_data, current = export(source, project=project, format=format)
    data, legacy = project_wire(current, format, legacy=True)
    source_text = project['study_cable_reference']['source']
    assert source_text != '；'.join(item['reference'] for item in
        legacy['projects'][0]['inputs']['study_cable_reference']['source_snapshot']['payload']['sources'].values())
    with monkeypatch.context() as limited:
        limited.setattr('backend.kernel.project_exchange.MAX_LEGACY_SOURCE_STATES', 1)
        refuse_project(target, data, legacy, format, 'EXCHANGE_CABLE_SOURCE_ORDER_LIMIT')
        # An explicit order never needs ambiguous legacy matching.
        response = target.post('/api/library/exchange/preview', files={'file': ('data.' + format, current_data)})
        assert response.status_code == 200, response.text
    _, imported = upload(target, 'data.' + format, data)
    assert imported.status_code == 201, imported.text
    copied = target.get('/api/workspaces/' + imported.json()['projects'][0]['id']).json()
    assert copied['study_cable_reference']['source'] == source_text
    assert copied['study_cable_reference']['source_snapshot']['payload'] == candidate['payload']
    _, exported_again = export(target, project=copied, format=format)
    proof = exported_again['projects'][0]['inputs']['study_cable_reference']['source_snapshot']
    assert proof['schema'] == SOURCE_SCHEMA
    assert proof['source_reference_order'] == list(references)
    assert copied == target.get('/api/workspaces/' + copied['id']).json()
    shortened = deepcopy(legacy)
    shortened['projects'][0]['inputs']['study_cable_reference']['source'] = source_text.removesuffix('；原件A')
    data, shortened = project_wire(shortened, format)
    refuse_project(target, data, shortened, format, 'EXCHANGE_CABLE_SOURCE')


def test_candidate_proof_refuses_rehashed_source_projection_and_local_identity_changes(clients):
    source, target = clients
    candidate, project = candidate_study(source)
    _, original = export(source, project=project)
    cases = [
        ('source', 'EXCHANGE_CABLE_SOURCE_DIGEST'),
        ('missing_projection_field', 'EXCHANGE_CABLE_SOURCE'),
        ('digest', 'EXCHANGE_CABLE_SOURCE_DIGEST'),
        ('projection', 'EXCHANGE_CABLE_PROJECTION'),
        ('projection_bool', 'EXCHANGE_CABLE_PROJECTION'),
        ('origin_id', 'EXCHANGE_CABLE_IDENTITY'),
        ('local_id', 'EXCHANGE_CABLE_IDENTITY'),
        ('approval', 'EXCHANGE_CABLE_IDENTITY'),
        ('missing', 'EXCHANGE_CABLE_SOURCE'),
        ('published_without_proof', 'EXCHANGE_PUBLISHED_MODEL_PROOF'),
        ('system_without_proof', 'EXCHANGE_SYSTEM_MODEL_PROOF'),
        ('system_published_without_proof', 'EXCHANGE_PUBLISHED_MODEL_PROOF'),
        ('system_source_with_proof', 'EXCHANGE_CABLE_SOURCE'),
        ('published_with_proof', 'EXCHANGE_PUBLISHED_MODEL_PROOF'),
        ('source_clauses_reordered', 'EXCHANGE_CABLE_SOURCE'),
        ('source_clauses_reordered_legacy', 'EXCHANGE_CABLE_SOURCE'),
        ('reference_order_missing', 'EXCHANGE_CABLE_SOURCE'),
        ('reference_order_duplicate', 'EXCHANGE_CABLE_SOURCE'),
        ('reference_order_unknown', 'EXCHANGE_CABLE_SOURCE'),
        ('reference_order_wrong', 'EXCHANGE_CABLE_SOURCE'),
        ('reference_order_type', 'EXCHANGE_CABLE_SOURCE'),
    ]
    for change, code in cases:
        bundle = deepcopy(original)
        item = bundle['projects'][0]
        binding = item['inputs']['study_cable_reference']
        if change == 'source':
            binding['source_snapshot']['payload']['materials'][0]['density'] = 8800
        elif change == 'missing_projection_field':
            binding['source_snapshot']['payload']['cable_type'].pop('common_layers')
        elif change == 'digest':
            binding['content_sha256'] = fingerprint(binding['payload'])
        elif change == 'projection':
            binding['payload']['cable_type']['cores'][0]['conductor']['r20'] *= 2
        elif change == 'projection_bool':
            assert binding['payload']['cable_type']['cores'][0]['x'] == 0.0
            binding['payload']['cable_type']['cores'][0]['x'] = False
        elif change == 'origin_id':
            binding['source_snapshot']['origin_id'] = 'candidate:' + str(uuid4())
        elif change == 'local_id':
            binding['id'] = 'candidate:' + candidate['id']
        elif change == 'approval':
            binding['state'] = 'reviewed'
        elif change == 'published_without_proof':
            binding.pop('source_snapshot')
            binding.update(id='type/unproven-local-family', source='published_type',
                           content_sha256=fingerprint(binding['payload']))
        elif change in ('system_without_proof', 'system_published_without_proof'):
            binding.pop('source_snapshot')
            binding.update(id='system.cu-xlpe-al-240', name='冒用系统身份的外部型号', version='999.0.0',
                           state='reviewed', content_sha256=fingerprint(binding['payload']))
            if change == 'system_published_without_proof':
                binding['source'] = 'published_type'
        elif change == 'system_source_with_proof':
            binding['source'] = next(model['source'] for model in source.get('/api/design/cable-models').json()
                                     if model['id'] == 'system.cu-xlpe-al-240')
        elif change == 'published_with_proof':
            binding['source'] = 'published_type'
        elif change.startswith('source_clauses_reordered'):
            binding['source'] = '；'.join(reversed(binding['source'].split('；')))
            if change.endswith('_legacy'):
                binding['source_snapshot']['schema'] = LEGACY_SOURCE_SCHEMA
                binding['source_snapshot'].pop('source_reference_order')
        elif change.startswith('reference_order_'):
            proof = binding['source_snapshot']
            order = proof['source_reference_order']
            if change == 'reference_order_missing':
                proof.pop('source_reference_order')
            elif change == 'reference_order_duplicate':
                order[1] = order[0]
            elif change == 'reference_order_unknown':
                order[0] = '/unknown-source'
            elif change == 'reference_order_wrong':
                order.reverse()
            else:
                proof['source_reference_order'] = '；'.join(order)
        else:
            binding.pop('source_snapshot')
        item['input_sha256'] = fingerprint(item['inputs'])
        bundle['sha256'] = fingerprint({key: value for key, value in bundle.items() if key != 'sha256'})
        response = target.post('/api/library/exchange/preview', files={'file': ('data.json', encoded(bundle))})
        assert response.status_code == 422, (change, response.text)
        assert response.json()['detail']['code'] == code, (change, response.text)
        response = target.post('/api/library/exchange/import', files={'file': ('data.json', encoded(bundle))},
            data={'request_id': str(uuid4()), 'reviewed_sha256': bundle['sha256'], 'confirmed': 'true'},
            headers={'X-CableSim-Actor': 'human'})
        assert response.status_code == 422, (change, response.text)
        assert target.get('/api/workspaces').json() == []
        assert target.get('/api/domain-cable-models').json() == []


def test_candidate_export_validates_source_shape_before_deriving_order(clients):
    source, _ = clients
    candidate, project = candidate_study(source)
    store = source.app.state.workspace_store
    with store.db() as db:
        original = json.loads(db.execute('SELECT state FROM workspaces WHERE id=?', (project['id'],)).fetchone()['state'])
    # A completed model carries the full schema and the same actual materials
    # as its study. No additional physical inputs or replacement values are used.
    complete = deepcopy(candidate['payload'])
    complete['materials'] = deepcopy(original['study_cable_reference']['payload']['materials'])
    cases = [('valid_projection', None), ('valid_complete', None),
             ('missing_source', 'EXCHANGE_CABLE_REFERENCE'), ('null_source', 'EXCHANGE_CABLE_REFERENCE'),
             ('null_sources', 'EXCHANGE_CABLE_SOURCE'), ('list_sources', 'EXCHANGE_CABLE_SOURCE'),
             ('missing_reference', 'EXCHANGE_CABLE_SOURCE')]
    for change, code in cases:
        state = deepcopy(original)
        binding = state['study_cable_reference']
        if change == 'missing_source':
            binding.pop('source')
        elif change == 'null_source':
            binding['source'] = None
        elif change != 'valid_projection':
            binding['payload'] = deepcopy(complete)
            if change == 'null_sources':
                binding['payload']['sources'] = None
            elif change == 'list_sources':
                binding['payload']['sources'] = []
            elif change == 'missing_reference':
                next(iter(binding['payload']['sources'].values())).pop('reference')
            binding['content_sha256'] = fingerprint(binding['payload'])
        stored = json.dumps(state, ensure_ascii=False)
        with store.db() as db:
            db.execute('UPDATE workspaces SET state=? WHERE id=?', (stored, project['id']))
        before = source.get('/api/workspaces/' + project['id']).json()
        response = source.post('/api/library/exchange/export', json={'workspace_ids': [project['id']]})
        assert response.status_code == (422 if code else 200), (change, response.text)
        if code:
            assert response.json()['detail']['code'] == code, (change, response.text)
        else:
            proof = response.json()['projects'][0]['inputs']['study_cable_reference']['source_snapshot']
            assert proof['schema'] == SOURCE_SCHEMA
            assert proof['payload'] == (candidate['payload'] if change == 'valid_projection' else complete)
        assert source.get('/api/workspaces/' + project['id']).json() == before
        assert source.get('/api/domain-cable-models').json() == [candidate]
        with store.db() as db:
            assert db.execute('SELECT state FROM workspaces WHERE id=?', (project['id'],)).fetchone()['state'] == stored


def test_candidate_source_must_match_pinned_version_and_project_limit_stays_in_force(clients):
    source, target = clients
    candidate, project = candidate_study(source)
    _, bundle = export(source, project=project)
    over_locked = deepcopy(bundle)
    locked_item = over_locked['projects'][0]
    locked_item['inputs']['locks'] = ['/excess/' + str(index) for index in range(PROJECT_MAX_LOCKS + 1)]
    locked_item['input_sha256'] = fingerprint(locked_item['inputs'])
    over_locked['sha256'] = fingerprint({key: value for key, value in over_locked.items() if key != 'sha256'})
    response = target.post('/api/library/exchange/preview', files={'file': ('data.json', encoded(over_locked))})
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'EXCHANGE_PROJECT_LOCKS'
    assert target.get('/api/workspaces').json() == []
    item = bundle['projects'][0]
    item['inputs']['sources'].append({'reference': '输入交换大小边界：' + 'x' * PROJECT_LIMIT})
    item['input_sha256'] = fingerprint(item['inputs'])
    bundle['sha256'] = fingerprint({key: value for key, value in bundle.items() if key != 'sha256'})
    response = target.post('/api/library/exchange/preview', files={'file': ('data.json', encoded(bundle))})
    assert response.status_code == 413
    assert response.json()['detail']['code'] == 'EXCHANGE_PROJECT_TOO_LARGE'
    store = source.app.state.workspace_store
    with store.db(True) as db:
        # An inconsistent original database must not silently supply another version.
        changed = deepcopy(candidate['payload'])
        changed['version'] = '1.0.1'
        db.execute('UPDATE domain_cable_models SET payload=?,digest=? WHERE id=?',
                   (json.dumps(changed), fingerprint(changed), candidate['id']))
    response = source.post('/api/library/exchange/export', json={'workspace_ids': [project['id']]})
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'EXCHANGE_CABLE_SOURCE_DIGEST'
    assert source.get('/api/workspaces/' + project['id']).json() == project
    with store.db(True) as db:
        changed = deepcopy(candidate['payload'])
        changed['cable_type'].pop('common_layers')
        db.execute('UPDATE domain_cable_models SET payload=?,digest=? WHERE id=?',
                   (json.dumps(changed), fingerprint(changed), candidate['id']))
    response = source.post('/api/library/exchange/export', json={'workspace_ids': [project['id']]})
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'EXCHANGE_CABLE_SOURCE'
    assert source.get('/api/workspaces/' + project['id']).json() == project
    with store.db(True) as db:
        db.execute('DELETE FROM domain_cable_models WHERE id=?', (candidate['id'],))
    response = source.post('/api/library/exchange/export', json={'workspace_ids': [project['id']]})
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'EXCHANGE_CABLE_SOURCE'
    assert target.get('/api/workspaces').json() == []
