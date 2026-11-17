"""Actual sealed source values through drafts, publication, CAS adoption and undo.

The workspace's explicit composition and purpose are test inputs. The numeric
material values are the real Huang, Nielsen and IEC records, never fixtures in a
replacement provider. An adopted literature reference remains a reference.
"""
from copy import deepcopy
import json
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.domain.guards import pointer
from backend.foundation.contracts import AssetRelease, content_hash
from backend.kernel.scenarios import system_models
from backend.kernel.model_series import hv_payload
from backend.main import create_app


SOURCES = [
    ('density', 'huang-TableA1', 'huang-TableA1/r1/density', 8889, 'literature', 'kg/m3'),
    ('volumetric_heat_capacity', 'nielsen-Table1', 'nielsen-Table1/r1/capacity', 3460000, 'literature', 'J/(m3.K)'),
    ('electrical_resistivity_20', 'iec60287-1-1-table1', 'iec60287-1-1-table1/r1/c1', 1.7241e-8, 'standard', 'ohm.m'),
]


@pytest.fixture(scope='module')
def client(tmp_path_factory):
    with TestClient(create_app(tmp_path_factory.mktemp('material-references')/'library.sqlite')) as client:
        yield client


def api(client, method, path, body=None, **kwargs):
    response = client.request(method, path, json=body, **kwargs)
    assert response.status_code < 400, response.text
    return response.json()


def selected(client, table_id, record_id, conditions=None):
    table = api(client, 'GET', '/api/library/resources/table', params={'category': 'materials', 'table_id': table_id})
    row = next(row for row in table['rows'] if row['id'] == record_id)
    return {'release_digest': table['release_digest'], 'data_sha256': table['data_sha256'],
            'standard': row['standard'], 'edition': row['edition'], 'locator': row['table'] or row['clause'],
            'quantity': row['quantity']['key'], 'record_id': record_id,
            'conditions': row['conditions'] if conditions is None else conditions}


def draft(client, selections):
    body = {
        'asset_id': 'material.reference.'+uuid4().hex, 'version': '1.0.0',
        'name': '明确来源的资料参考，不是厂家实测', 'selections': selections}
    preview = api(client, 'POST', '/api/library/resources/materials/draft-preview', body)
    return api(client, 'POST', '/api/library/resources/materials/draft', {
        **body, 'preview_digest': preview['preview_digest'], 'human_confirmed': True},
        headers={'X-CableSim-Actor': 'human'})


def transition(client, asset, action):
    return api(client, 'POST', '/api/foundation/assets/'+asset['id']+'/transition', {
        'expected_revision': asset['revision'], 'content_sha256': asset['content_sha256'],
        'action': action, 'note': '逐项核对原文、条件、版本和参考性质；不作工程批准。',
        'acknowledge_sources': True, 'human_confirmed': True},
        headers={'X-CableSim-Actor': 'human'})


def published(client, selections):
    asset = draft(client, selections)
    return transition(client, transition(client, asset, 'review'), 'publish')


def workspace(client, *, split_copper=True):
    model = next(m for m in system_models() if m['id'] == 'system.specification-yjv22-300')
    saved = api(client, 'POST', '/api/design/type-workspaces', {
        'model_id': model['id'], 'content_sha256': model['content_sha256']})
    doc = deepcopy(saved['domain'])
    copper = next(m for m in doc['materials'] if m['id'] == 'material/cu')
    copper['standard_kind'] = 'copper_bare'
    copper['density'] = copper['volumetric_heat_capacity'] = copper['electrical_resistivity_20'] = None
    doc['provenance'][pointer('materials', copper['id'], 'standard_kind')] = {
        'kind': 'user', 'reviewed': False,
        'reference': '本验收明确输入铜导体组成；不是厂家证书，物性将逐项引用真实资料。'}
    if split_copper:
        screen = {**deepcopy(copper), 'id': 'material/cu-screen', 'label': '独立屏蔽铜', 'category': 'metal'}
        doc['materials'].append(screen)
        for cable in doc['cable_types']:
            for layer in [*cable['common_layers'], *(layer for core in cable['cores'] for layer in core['layers'])]:
                if layer['material'] == copper['id']:
                    layer['material'] = screen['id']
    api(client, 'PUT', '/api/workspaces/'+saved['id']+'/domain', {
        'expected_revision': saved['revision'], 'document': doc})
    return api(client, 'GET', '/api/workspaces/'+saved['id'])


def qifan_workspace(client):
    """Use the unchanged bundled public structure and its explicitly missing facts."""
    model = api(client, 'POST', '/api/domain-cable-models', hv_payload())
    saved = api(client, 'POST', '/api/design/type-workspaces', {
        'model_id': 'candidate:'+model['id'], 'content_sha256': model['digest']})
    material = next(m for m in saved['domain']['materials'] if m['id'] == 'material/cu')
    assert material['category'] == 'conductor' and material['standard_kind'] == 'copper_bare'
    assert all(material[prop] is None for prop, *_ in SOURCES)
    return saved


def bind(client, saved, asset, material_id='material/cu'):
    root = '/api/types/'+saved['id']+'/resources'
    fields = {'expected_revision': saved['revision'], 'items': [{'target_id': material_id, 'resource_id': asset['id']}]}
    preview = api(client, 'POST', root+'/material-preview', fields)
    api(client, 'POST', root+'/material-confirm', {**fields, 'request_id': str(uuid4()),
        'preview_digest': preview['digest'], 'reviewed_targets': [material_id], 'human_confirmed': True},
        headers={'X-CableSim-Actor': 'human'})
    result = api(client, 'GET', '/api/workspaces/'+saved['id'])
    assert result['domain'] == saved['domain']  # Binding is not adopting.
    return result


def preview_body(saved, asset, property, material_id='material/cu'):
    return {'workspace_id': saved['id'], 'expected_revision': saved['revision'],
        'material_id': material_id, 'property': property, 'resource_id': asset['id'],
        'content_sha256': asset['content_sha256']}


def adopt_body(body, preview):
    return {**body, 'request_id': str(uuid4()), 'preview_digest': preview['preview_digest'],
            'human_confirmed': True, 'acknowledge_reference_limits': True}


def test_real_copper_references_publish_adopt_and_preserve_history(client):
    choices = [{'parameter': prop, 'selection': selected(client, table, record)}
               for prop, table, record, *_ in SOURCES]
    asset = draft(client, choices)
    assert asset['status'] == 'draft' and asset['reviewed_sha256'] is None
    for evidence, (_, _, record_id, value, kind, unit), source in zip(
            asset['release']['reference_evidence'], SOURCES, asset['release']['sources']):
        assert evidence['receipt']['record']['id'] == record_id
        assert evidence['quantity']['value'] == value and evidence['quantity']['unit'] == unit
        assert evidence['receipt']['quantity'] == evidence['quantity']
        assert source['kind'] == kind and source['reviewed'] is False
        assert evidence['receipt']['record']['limitations']
        assert evidence['receipt']['method']['method_version'] == '0.9.0'
        assert evidence['receipt']['trust']['grade'] == 'reference'
        assert evidence['receipt']['approval'] == 'not_granted'
    asset = transition(client, transition(client, asset, 'review'), 'publish')
    saved = bind(client, qifan_workspace(client), asset)
    for prop, _, _, expected, _, _ in SOURCES:
        before = saved
        body = preview_body(saved, asset, prop)
        preview = api(client, 'POST', '/api/library/resources/materials/preview', body)
        assert preview['adoptable'] and preview['comparison']['status'] == 'design_missing', preview
        assert all(check['status'] == 'matched' for check in preview['comparison']['condition_checks'])
        confirmation = adopt_body(body, preview)
        denied = client.post('/api/library/resources/materials/adopt', json=confirmation,
                             headers={'X-CableSim-Actor': 'agent'})
        assert denied.status_code == 403
        assert api(client, 'GET', '/api/workspaces/'+saved['id'])['revision'] == saved['revision']
        bypass = client.post('/api/types/'+saved['id']+'/material-comparison/adopt', json={
            k: v for k, v in confirmation.items() if k not in {
                'workspace_id', 'preview_digest', 'human_confirmed', 'acknowledge_reference_limits'}})
        assert bypass.status_code == 422 and bypass.json()['detail']['code'] == 'MATERIAL_REFERENCE_PREVIEW_REQUIRED'
        stale = client.post('/api/library/resources/materials/adopt', json={**confirmation, 'preview_digest': '0'*64},
                            headers={'X-CableSim-Actor': 'human'})
        assert stale.status_code == 409
        saved = api(client, 'POST', '/api/library/resources/materials/adopt', confirmation,
                    headers={'X-CableSim-Actor': 'human'})
        assert saved['revision'] == before['revision']+1
        assert next(m for m in saved['domain']['materials'] if m['id'] == 'material/cu')[prop] == expected
        source = saved['domain']['provenance'][pointer('materials', 'material/cu', prop)]
        assert source['reviewed'] is False and source['kind'] == 'asset'
        receipt = json.loads(source['reference'])
        assert receipt['content_sha256'] == asset['content_sha256']
        assert receipt['reference_value']['resource_reference'] == preview['evidence']
        assert api(client, 'POST', '/api/library/resources/materials/adopt', confirmation,
                   headers={'X-CableSim-Actor': 'human'}) == saved
        stale_revision = client.post('/api/library/resources/materials/adopt', json={
            **confirmation, 'request_id': str(uuid4())}, headers={'X-CableSim-Actor': 'human'})
        assert stale_revision.status_code == 409
        assert api(client, 'GET', '/api/workspaces/'+saved['id']+'/revisions/'+str(before['revision']))['state']['domain'] == before['domain']
    adopted = saved
    undone = api(client, 'POST', '/api/workspaces/'+saved['id']+'/history/undo', {'expected_revision': saved['revision']})
    assert undone['domain'] == before['domain']
    assert undone['type_resource_bindings'] == before['type_resource_bindings']
    assert api(client, 'GET', '/api/workspaces/'+saved['id']+'/revisions/'+str(adopted['revision']))['state']['domain'] == adopted['domain']
    # A subsequent release does not move the historical pin or its source values.
    derived = api(client, 'POST', '/api/foundation/assets/'+asset['id']+'/derive', {
        'expected_revision': asset['revision'], 'content_sha256': asset['content_sha256'],
        'new_version': '1.0.1', 'human_confirmed': True}, headers={'X-CableSim-Actor': 'human'})
    assert derived['content_sha256'] != asset['content_sha256']
    assert derived['release']['reference_evidence'] == asset['release']['reference_evidence']
    asset = transition(client, asset, 'deprecate')
    history = api(client, 'GET', '/api/types/'+saved['id']+'/material-comparison', params={'revision': adopted['revision']})
    material = next(m for m in history['materials'] if m['id'] == 'material/cu')
    assert history['historical'] and material['resource']['version'] == '1.0.0'
    assert not any(row['adoptable'] for row in material['rows'])
    assert next(r for r in material['rows'] if r['id'] == 'density')['reference']['value'] == 8889


def test_shared_copper_cannot_silently_apply_conductor_reference(client):
    asset = published(client, [{'parameter': 'density', 'selection': selected(client, SOURCES[0][1], SOURCES[0][2])}])
    saved = bind(client, workspace(client, split_copper=False), asset)
    body = preview_body(saved, asset, 'density')
    preview = api(client, 'POST', '/api/library/resources/materials/preview', body)
    assert not preview['adoptable'] and '同时用于' in preview['reason']
    denied = client.post('/api/library/resources/materials/adopt', json=adopt_body(body, preview), headers={'X-CableSim-Actor': 'human'})
    assert denied.status_code == 422
    assert api(client, 'GET', '/api/workspaces/'+saved['id'])['domain'] == saved['domain']


def test_reference_preview_rechecks_provider_and_expires_after_eviction_or_restart(client, tmp_path, monkeypatch):
    from fastapi import HTTPException
    from backend.foundation.assets import AssetRepository
    from backend.kernel import resource_data
    from backend.kernel.material_references import (
        CreateMaterialReferenceDraft, MaterialReferenceDraft, create_material_draft, preview_material_draft,
    )
    assets = AssetRepository(tmp_path/'drafts.sqlite')
    assets.initialize()
    # Exercise bounded eviction with actual sealed records; only capacity is
    # reduced here. No source value, provider result or condition is replaced.
    monkeypatch.setattr(resource_data, 'MAX_RESOLVED_RECEIPTS', 2)
    selections = [selected(client, table, record) for _, table, record, *_ in SOURCES]
    calls = []
    executor = client.app.state.research.executor
    original = executor.run

    def executed(*args, **kwargs):
        calls.append(args[2][0]['input'])
        return original(*args, **kwargs)

    monkeypatch.setattr(executor, 'run', executed)
    service = resource_data.ResourceData(executor)
    request = MaterialReferenceDraft(asset_id='material.cache.reference', version='1.0.0', name='固定来源草稿',
        selections=[{'parameter': 'density', 'selection': selections[0]}])
    before = preview_material_draft(service, request)
    repeated = preview_material_draft(service, request)
    assert repeated == before and len(calls) == 2  # Actual requery, stable original receipt.
    wrong = deepcopy(selections[0])
    wrong['conditions']['material'] = 'aluminium'
    with pytest.raises(HTTPException) as rejected:
        service.select(resource_data.Selection.model_validate(wrong))
    assert rejected.value.status_code == 422
    service.select(resource_data.Selection.model_validate(selections[1]))
    service.select(resource_data.Selection.model_validate(selections[2]))
    assert len(service._resolved_receipts) == 2
    confirmation = CreateMaterialReferenceDraft(**request.model_dump(),
        preview_digest=before['preview_digest'], human_confirmed=True)
    with pytest.raises(HTTPException) as evicted:
        create_material_draft(service, assets, confirmation, actor='human')
    assert evicted.value.status_code == 409 and assets.list()['total'] == 0
    refreshed = preview_material_draft(service, request)
    confirmation.preview_digest = refreshed['preview_digest']
    restarted = resource_data.ResourceData(executor)
    with pytest.raises(HTTPException) as lost:
        create_material_draft(restarted, assets, confirmation, actor='human')
    assert lost.value.status_code == 409 and assets.list()['total'] == 0
    ready = preview_material_draft(restarted, request)
    confirmation.preview_digest = ready['preview_digest']
    result = create_material_draft(restarted, assets, confirmation, actor='human')
    assert result['content_sha256'] == ready['content_sha256'] and assets.list()['total'] == 1


@pytest.mark.parametrize('record_id,conditions,expected_reason', [
    ('iec60287-1-1-table3/r1/relative_permittivity',
     {'current_system': 'AC', 'temperature_basis': 'maximum_permissible',
      'insulation': 'impregnated_paper', 'cable_construction': 'solid_non_draining'}, 'insulation'),
    ('iec60287-1-1-table3/r15/relative_permittivity',
     {'current_system': 'AC', 'temperature_basis': 'maximum_permissible', 'insulation': 'XLPE',
      'filler': 'unfilled', 'u0_v': 8700, 'u_v': 15000}, 'temperature_basis'),
])
def test_dielectric_reference_requires_actual_formulation_and_temperature(client, record_id, conditions, expected_reason):
    asset = published(client, [{'parameter': 'relative_permittivity',
        'selection': selected(client, 'iec60287-1-1-table3', record_id, conditions)}])
    saved = workspace(client)
    doc = deepcopy(saved['domain'])
    insulation = next(m for m in doc['materials'] if m['id'] == 'material/xlpe')
    insulation['standard_kind'] = 'XLPE'
    api(client, 'PUT', '/api/workspaces/'+saved['id']+'/domain', {'expected_revision': saved['revision'], 'document': doc})
    saved = api(client, 'GET', '/api/workspaces/'+saved['id'])
    saved = bind(client, saved, asset, 'material/xlpe')
    body = preview_body(saved, asset, 'relative_permittivity', 'material/xlpe')
    preview = api(client, 'POST', '/api/library/resources/materials/preview', body)
    assert not preview['adoptable']
    assert any(c['condition'] == expected_reason and c['status'] == 'unconfirmed'
               for c in preview['comparison']['condition_checks'])
    denied = client.post('/api/library/resources/materials/adopt', json=adopt_body(body, preview), headers={'X-CableSim-Actor': 'human'})
    assert denied.status_code == 422


def test_draft_requeries_identity_rejects_forged_values_and_preserves_old_asset_hash(client):
    selection = selected(client, SOURCES[0][1], SOURCES[0][2])
    body = {'asset_id': 'material.reference.'+uuid4().hex, 'version': '1.0.0', 'name': '来源身份核验',
            'selections': [{'parameter': 'density', 'selection': selection}]}
    injected = deepcopy(body)
    injected['selections'][0]['value'] = 1
    assert client.post('/api/library/resources/materials/draft-preview', json=injected).status_code == 422
    mismatched = deepcopy(body)
    mismatched['selections'][0]['parameter'] = 'relative_permittivity'
    assert client.post('/api/library/resources/materials/draft-preview', json=mismatched).status_code == 422
    stale = deepcopy(body)
    stale['selections'][0]['selection']['release_digest'] = '0'*64
    assert client.post('/api/library/resources/materials/draft-preview', json=stale).status_code == 409
    before = api(client, 'GET', '/api/foundation/assets')['total']
    preview = api(client, 'POST', '/api/library/resources/materials/draft-preview', body,
                  headers={'X-CableSim-Actor': 'agent'})
    assert preview['persisted'] is False
    assert api(client, 'GET', '/api/foundation/assets')['total'] == before
    confirmation = {**body, 'preview_digest': preview['preview_digest'], 'human_confirmed': True}
    for value in (False, 1, 'true'):
        assert client.post('/api/library/resources/materials/draft', json={**confirmation, 'human_confirmed': value},
                           headers={'X-CableSim-Actor': 'human'}).status_code == 422
    assert client.post('/api/library/resources/materials/draft', json=confirmation,
                       headers={'X-CableSim-Actor': 'agent'}).status_code == 403
    assert client.post('/api/library/resources/materials/draft', json={**confirmation, 'preview_digest': '0'*64},
                       headers={'X-CableSim-Actor': 'human'}).status_code == 409
    assert api(client, 'GET', '/api/foundation/assets')['total'] == before
    asset = api(client, 'POST', '/api/library/resources/materials/draft', confirmation,
                headers={'X-CableSim-Actor': 'human'})
    corrupt = deepcopy(asset['release'])
    corrupt['reference_evidence'][0]['receipt']['record']['value'] = 1
    assert client.post('/api/foundation/assets/import', json={'release': corrupt, 'human_confirmed': True},
                       headers={'X-CableSim-Actor': 'human'}).status_code == 422
    duplicate = deepcopy(asset['release'])
    duplicate['reference_evidence'].append(duplicate['reference_evidence'][0])
    assert client.post('/api/foundation/assets/import', json={'release': duplicate, 'human_confirmed': True},
                       headers={'X-CableSim-Actor': 'human'}).status_code == 422
    oversized = deepcopy(asset['release'])
    oversized['reference_evidence'][0]['receipt']['untrusted_extra'] = 'x' * (32*1024)
    assert client.post('/api/foundation/assets/import', json={'release': oversized, 'human_confirmed': True},
                       headers={'X-CableSim-Actor': 'human'}).status_code == 422
    legacy = {'asset_id': 'material.legacy', 'version': '1.0.0', 'kind': 'material', 'name': '历史资产',
              'parameters': [], 'dependencies': [], 'files': [],
              'sources': [{'kind': 'project_input', 'reference': '历史字段保留，不加入空回执', 'reviewed': False}],
              'geometry_recipe': None}
    restored = AssetRelease.model_validate(legacy)
    assert restored.model_dump(mode='json') == legacy
    assert content_hash(restored) == content_hash(legacy)


@pytest.mark.parametrize('changed', ['record_value', 'quantity', 'receipt_quantity', 'trust_label',
                                     'method_version', 'citation', 'artifact_sha256'])
def test_self_consistent_forged_asset_cannot_bypass_sealed_source_at_adoption(client, changed):
    real = draft(client, [{'parameter': 'density', 'selection': selected(client, SOURCES[0][1], SOURCES[0][2])}])
    release = deepcopy(real['release'])
    release['asset_id'] += '.forged'
    evidence = release['reference_evidence'][0]
    record = evidence['receipt']['record']
    if changed == 'record_value':
        record['value'] = 1  # Deliberate tampering, never an engineering expected value.
        record['record_sha256'] = content_hash({k: v for k, v in record.items() if k not in ('record_sha256', 'citation')})
        evidence['record_sha256'] = record['record_sha256']
    if changed in ('record_value', 'quantity'):
        evidence['quantity']['value'] = 1.0
        release['parameters'][0]['quantity']['value'] = 1.0
    if changed in ('record_value', 'quantity', 'receipt_quantity'):
        evidence['receipt']['quantity']['value'] = 1.0
    if changed == 'trust_label':
        evidence['receipt']['trust']['label'] = '伪造厂家实测标签'
    if changed == 'method_version':
        evidence['receipt']['method']['method_version'] = '999.0.0'
    if changed == 'citation':
        record['citation'] = '伪造出处'
    if changed == 'artifact_sha256':
        evidence['receipt']['artifact_sha256'] = '0'*64
    # Even explicit human import establishes only internal consistency.
    # Engineering use re-resolves the provider and refuses the forged value.
    imported = client.post('/api/foundation/assets/import', json={'release': release, 'human_confirmed': True},
                           headers={'X-CableSim-Actor': 'human'})
    if changed == 'receipt_quantity':
        assert imported.status_code == 422
        assert any('RESOURCE_REFERENCE_QUANTITY_MISMATCH' in error['msg'] for error in imported.json()['detail'])
        return
    assert imported.status_code == 201, imported.text
    forged = imported.json()
    forged = transition(client, transition(client, forged, 'review'), 'publish')
    saved = bind(client, qifan_workspace(client), forged)
    response = client.post('/api/library/resources/materials/preview', json=preview_body(saved, forged, 'density'))
    assert response.status_code == 409 and response.json()['detail']['code'] == 'RESOURCE_REFERENCE_CHANGED'
    bypass = client.post('/api/types/'+saved['id']+'/material-comparison/adopt', json={
        **{k: v for k, v in preview_body(saved, forged, 'density').items() if k != 'workspace_id'},
        'request_id': str(uuid4())})
    assert bypass.status_code == 422 and bypass.json()['detail']['code'] == 'MATERIAL_REFERENCE_PREVIEW_REQUIRED'
    direct = client.post('/api/library/resources/materials/adopt', json={
        **preview_body(saved, forged, 'density'), 'preview_digest': '0'*64,
        'request_id': str(uuid4()), 'human_confirmed': True, 'acknowledge_reference_limits': True},
        headers={'X-CableSim-Actor': 'human'})
    assert direct.status_code == 409 and direct.json()['detail']['code'] == 'RESOURCE_REFERENCE_CHANGED'
    assert api(client, 'GET', '/api/workspaces/'+saved['id'])['domain'] == saved['domain']
