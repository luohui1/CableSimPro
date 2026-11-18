"""Real source receipts cannot bypass human confirmation through generic assets.

These requests use the installed resolver and the actual application store. A
denied write must leave the complete asset, audit events and catalogue unchanged.
"""
from copy import deepcopy
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app


ROOT = '/api/foundation/assets'
HUMAN = {'X-CableSim-Actor': 'human'}
AGENT = {'X-CableSim-Actor': 'agent'}


@pytest.fixture(scope='module')
def client(tmp_path_factory):
    with TestClient(create_app(tmp_path_factory.mktemp('reference-asset-confirmation')/'assets.sqlite')) as client:
        yield client


def value(response, status=200):
    assert response.status_code == status, response.text
    return response.json()


def catalogue(client):
    return value(client.get(ROOT, params={'limit': 100}))


@pytest.fixture(scope='module', params=['materials', 'environment'])
def release(client, request):
    category = request.param
    if category == 'materials':
        table_id, record_id = 'huang-TableA1', 'huang-TableA1/r1/density'
        conditions, expected = {'material': 'copper', 'material_role': 'conductor'}, 8889
    else:
        table_id, record_id = 'iec60287-3-1-table2', 'iec60287-3-1-table2/r2/thermal_resistivity'
        conditions = {'national_reference': 'unavailable', 'soil_moisture': 'moist', 'weather_pattern': 'regular_rain'}
        expected = 1
    table = value(client.get('/api/library/resources/table', params={'category': category, 'table_id': table_id}))
    record = next(row for row in table['rows'] if row['id'] == record_id)
    assert record['value'] == expected and record['selectable']
    selection = {'release_digest': table['release_digest'], 'data_sha256': table['data_sha256'],
                 'standard': record['standard'], 'edition': record['edition'],
                 'locator': record['table'] or record['clause'], 'quantity': record['quantity']['key'],
                 'record_id': record_id, 'conditions': conditions}
    selections = [{'parameter': 'density', 'selection': selection}] if category == 'materials' else [selection]
    before = catalogue(client)
    preview = value(client.post('/api/library/resources/' + category + '/draft-preview', headers=AGENT,
        json={'asset_id': 'reference.guard.' + uuid4().hex, 'version': '1.0.0',
              'name': '真实原表的固定参考，不是工程批准', 'selections': selections}))
    assert catalogue(client) == before
    evidence = preview['release']['reference_evidence'][0]
    assert evidence['selection'] == selection
    assert evidence['quantity']['value'] == expected
    assert evidence['receipt']['trust']['grade'] == 'reference'
    return preview['release']


def fresh(release):
    result = deepcopy(release)
    result['asset_id'] += '.' + uuid4().hex
    return result


def import_reference(client, release):
    return value(client.post(ROOT + '/import', headers=HUMAN,
        json={'release': fresh(release), 'human_confirmed': True}), 201)


def deny_without_confirmation(client, method, path, body, asset=None):
    before_catalogue = catalogue(client)
    before_asset = value(client.get(ROOT + '/' + asset['id'])) if asset else None
    attempts = [
        ({}, {}, 403),
        ({}, {'human_confirmed': True}, 403),
        (AGENT, {'human_confirmed': True}, 403),
        ({'X-CableSim-Actor': 'plugin'}, {'human_confirmed': True}, 403),
        (HUMAN, {}, 403),
        (HUMAN, {'human_confirmed': False}, 403),
        (HUMAN, {'human_confirmed': 1}, 422),
        (HUMAN, {'human_confirmed': 'true'}, 422),
        (HUMAN, {'human_confirmed': None}, 422),
    ]
    for headers, confirmation, status in attempts:
        response = client.request(method, path, headers=headers, json={**body, **confirmation})
        result = value(response, status)
        if status == 403:
            assert result['detail']['code'] == 'HUMAN_REFERENCE_ASSET_REQUIRED'
        assert catalogue(client) == before_catalogue
        if asset:
            # Includes status, revision, content, reviewed digest and all events.
            assert value(client.get(ROOT + '/' + asset['id'])) == before_asset


def transition_body(asset, action):
    return {'expected_revision': asset['revision'], 'content_sha256': asset['content_sha256'],
            'action': action, 'note': '明确核对固定资料及来源，仍为参考，不是工程批准。',
            'acknowledge_sources': True}


def test_reference_import_requires_both_human_actor_and_literal_confirmation(client, release):
    definition = fresh(release)
    deny_without_confirmation(client, 'POST', ROOT + '/import', {'release': definition})
    saved = value(client.post(ROOT + '/import', headers=HUMAN,
        json={'release': definition, 'human_confirmed': True}), 201)
    assert saved['status'] == 'draft' and saved['revision'] == 1
    assert saved['release'] == definition and not saved['applied_to_workspace']


def test_reference_edit_checks_stored_and_requested_receipts(client, release):
    asset = import_reference(client, release)
    changed = {**asset['release'], 'name': '人工确认后的资料名称'}
    endpoint = ROOT + '/' + asset['id']
    deny_without_confirmation(client, 'PUT', endpoint,
        {'expected_revision': asset['revision'], 'release': changed}, asset)
    for explicit_empty in (False, True):
        stripped = deepcopy(changed)
        stripped.pop('reference_evidence')
        if explicit_empty:
            stripped['reference_evidence'] = []
        deny_without_confirmation(client, 'PUT', endpoint,
            {'expected_revision': asset['revision'], 'release': stripped}, asset)
    edited = value(client.put(endpoint, headers=HUMAN, json={
        'expected_revision': asset['revision'], 'release': changed, 'human_confirmed': True}))
    assert edited['revision'] == asset['revision'] + 1
    assert edited['release']['reference_evidence'] == asset['release']['reference_evidence']

    legacy_release = fresh(release)
    evidence = legacy_release.pop('reference_evidence')
    legacy = value(client.post(ROOT + '/import', json={'release': legacy_release}), 201)
    inserted = {**legacy['release'], 'reference_evidence': evidence}
    endpoint = ROOT + '/' + legacy['id']
    deny_without_confirmation(client, 'PUT', endpoint,
        {'expected_revision': legacy['revision'], 'release': inserted}, legacy)
    edited = value(client.put(endpoint, headers=HUMAN, json={
        'expected_revision': legacy['revision'], 'release': inserted, 'human_confirmed': True}))
    assert edited['revision'] == legacy['revision'] + 1 and edited['release'] == inserted


def test_every_reference_state_change_and_derivation_requires_confirmation(client, release):
    asset = import_reference(client, release)
    fixed = deepcopy(asset['release'])
    for action in ('review', 'return_to_draft', 'review', 'publish'):
        endpoint, body = ROOT + '/' + asset['id'] + '/transition', transition_body(asset, action)
        deny_without_confirmation(client, 'POST', endpoint, body, asset)
        changed = value(client.post(endpoint, headers=HUMAN, json={**body, 'human_confirmed': True}))
        assert changed['revision'] == asset['revision'] + 1
        assert changed['release'] == fixed and changed['events'][0]['action'] == action
        asset = changed
    assert asset['status'] == 'published'
    for version in ('1.0.1', '1.0.2'):
        endpoint = ROOT + '/' + asset['id'] + '/derive'
        body = {'expected_revision': asset['revision'], 'content_sha256': asset['content_sha256'],
                'new_version': version}
        deny_without_confirmation(client, 'POST', endpoint, body, asset)
        derived = value(client.post(endpoint, headers=HUMAN, json={**body, 'human_confirmed': True}), 201)
        assert derived['status'] == 'draft' and derived['release'] == {**fixed, 'version': version}
        assert value(client.get(ROOT + '/' + asset['id'])) == asset
        if version == '1.0.1':
            endpoint, body = ROOT + '/' + asset['id'] + '/transition', transition_body(asset, 'deprecate')
            deny_without_confirmation(client, 'POST', endpoint, body, asset)
            changed = value(client.post(endpoint, headers=HUMAN, json={**body, 'human_confirmed': True}))
            assert changed['status'] == 'deprecated' and changed['revision'] == asset['revision'] + 1
            assert changed['release'] == fixed
            asset = changed


def test_assets_without_reference_receipts_keep_existing_lifecycle(client, release):
    definition = fresh(release)
    definition.pop('reference_evidence')
    asset = value(client.post(ROOT + '/import', json={'release': definition}), 201)
    assert asset['release'] == definition and 'reference_evidence' not in asset['release']
    definition['name'] = '沿用原有资产工作流'
    asset = value(client.put(ROOT + '/' + asset['id'], json={
        'expected_revision': asset['revision'], 'release': definition}))
    for action in ('review', 'return_to_draft', 'review', 'publish'):
        asset = value(client.post(ROOT + '/' + asset['id'] + '/transition', json=transition_body(asset, action)))
    derived = value(client.post(ROOT + '/' + asset['id'] + '/derive', json={
        'expected_revision': asset['revision'], 'content_sha256': asset['content_sha256'], 'new_version': '1.0.1'}), 201)
    assert derived['release'] == {**definition, 'version': '1.0.1'}
    assert 'reference_evidence' not in derived['release']
    retired = value(client.post(ROOT + '/' + asset['id'] + '/transition', json=transition_body(asset, 'deprecate')))
    assert retired['status'] == 'deprecated' and retired['release'] == definition
