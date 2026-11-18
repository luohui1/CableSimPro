"""Bounded saved-input reads of the release seed's real three-core manufacturer model."""
from copy import deepcopy
import json
from uuid import uuid4

import pytest

from backend.domain.guards import pointer, value_at
from backend.kernel.model_series import bundled_series, payloads
from backend.kernel.type_versions import Types
from backend.kernel.workspace import fingerprint
from test_harness_external import AUTH, client, call, open_session


def manufacturer_type(client):
    """Use the release seed's source data and declared model preparation, with no native solve."""
    payload = next(item for item in payloads() if round(item['specification']['area_m2'] * 1e6) == 300)
    original = client.post('/api/domain-cable-models', json=payload)
    assert original.status_code == 201, original.text
    method = next(item['method'] for item in client.get('/api/methods').json() if item['method']['plugin_id'] == 'cablesim.iec60287')
    bundle, _ = bundled_series()
    prepared, error = client.app.state.research.complete_candidate(original.json(), {
        'method': {**method, 'capability': 'model-completion'},
        'parameters': deepcopy(bundle['engineering_scenario']['parameters'])})
    assert error is None, error
    source = client.post('/api/domain-cable-models', json=prepared['payload'])
    assert source.status_code == 201, source.text
    created = client.post('/api/design/type-workspaces', json={
        'model_id': 'candidate:' + source.json()['id'], 'content_sha256': source.json()['digest']})
    assert created.status_code == 201, created.text
    return created.json()


def page(client, scope, args):
    response = call(client, 'type_read', args, scope['session'], scope['turn'])
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['status'] == 'ok', result
    assert len(json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode()) <= 6 * 1024
    return result


def test_manufacturer_input_pages_finish_and_allow_a_reviewed_edit_within_existing_budget(client, monkeypatch):
    workspace = manufacturer_type(client)
    document = workspace['domain']
    cable = document['cable_types'][0]
    assert len(cable['cores']) == 3
    scope = open_session(client, workspace, '完整读取型号输入，再提出绝缘厚度修改。')
    catalog = client.get('/api/agent/external/tools', headers=AUTH, params={'session': scope['session']}).json()
    assert 'input' in next(row for row in catalog if row['name'] == 'type_read')['parameters']['properties']['view']['enum']
    # Saved input is independent of computed/report evidence and never starts a solver.
    def forbidden(*args, **kwargs):
        raise AssertionError('input view must not read computed evidence or run a method')
    monkeypatch.setattr(Types, 'evidence', forbidden)
    monkeypatch.setattr(client.app.state.research.executor, 'run', forbidden)
    args = {'type_id': workspace['id'], 'view': 'input', 'limit': 20}
    items, cursors, pages, total = [], set(), 0, None
    while args:
        result = page(client, scope, args)
        data = result['data']
        assert '未读取已有运行或标准核对' in result['summary']
        assert data['type_revision'] == workspace['revision'] and data['view'] == 'input'
        total = data['total'] if total is None else total
        assert data['total'] == total
        items.extend(data['items']); pages += 1
        args = data['next_page']
        if args:
            assert args['view'] == 'input' and args['expected_revision'] == workspace['revision']
            assert args['after'] == len(items) and args['after'] not in cursors
            cursors.add(args['after'])
    assert len(items) == total and total > 50 and pages > 1
    assert {item['section'] for item in items} == {'overview', 'structure'}
    overview = next(item for item in items if item['section'] == 'overview')
    assert overview['object']['id'] == workspace['id'] and 'locks' in overview
    assert overview['base_reference']['content_sha256'] == workspace['type_origin_reference']['content_sha256']
    fields = {item['path']: item for item in items if item['section'] == 'structure'}
    assert len(fields) == sum(item['section'] == 'structure' for item in items)
    changes = []
    for core in cable['cores']:
        path = pointer('cable_types', cable['id'], 'cores', core['id'], 'layers', 'insulation', 'thickness')
        field = fields[path]
        assert field['unit'] == 'mm'
        assert field['value'] == pytest.approx(value_at(document, path) * 1000, rel=0, abs=1e-12)
        assert field['source'] == {'kind': 'saved_type_input', 'type_id': workspace['id'], 'revision': workspace['revision'],
            'digest': fingerprint(document), 'path': path, 'provenance': document.get('provenance', {}).get(path)}
        changes.append({'path': path, 'value': 4.7, 'unit': 'mm'})
    planned = call(client, 'propose_type_changes', {'type_id': workspace['id'], 'changes': changes, 'reason': '审阅三芯绝缘厚度'}, scope['session'], scope['turn'])
    assert planned.status_code == 200 and planned.json()['status'] == 'ok', planned.text
    differences = {item['path']: item for item in planned.json()['data']['proposal']['changes']}
    # The ordinary editor can also move core positions to preserve the layout.
    # Every requested insulation change must be represented in that full proposal.
    assert {path for path in differences if path.endswith('/layers/insulation/thickness')} == {change['path'] for change in changes}
    assert all((differences[change['path']]['after'], differences[change['path']]['unit']) == (4.7, 'mm') for change in changes)
    assert client.get('/api/workspaces/' + workspace['id']).json()['revision'] == workspace['revision']
    record = client.get('/api/agent/sessions/' + scope['session']).json()
    assert record['budget']['tool_calls'] == pages + 1 < record['budget']['limits']['max_tool_calls']
    assert record['budget']['limits']['max_tool_calls'] == 24
    print('\n型号输入分页 ' + json.dumps({'pages': pages, 'entries': total, 'fields': len(fields),
        'tool_calls_including_proposal': record['budget']['tool_calls'], 'max_tool_calls': 24}, ensure_ascii=False))


def test_input_cursor_refuses_a_changed_saved_revision(client):
    workspace = manufacturer_type(client)
    scope = open_session(client, workspace)
    cursor = page(client, scope, {'type_id': workspace['id'], 'view': 'input', 'limit': 2})['data']['next_page']
    assert cursor
    changed = deepcopy(workspace['domain'])
    changed['name'] = '输入分页期间人工修订'
    saved = client.put('/api/workspaces/' + workspace['id'] + '/domain', json={'expected_revision': workspace['revision'], 'document': changed})
    assert saved.status_code == 200, saved.text
    stale = call(client, 'type_read', cursor, scope['session'], scope['turn']).json()
    assert stale['status'] == 'error' and stale['diagnostics'][0]['code'] == 'TYPE_REVISION_CONFLICT', stale


def test_blank_input_keeps_missing_fields_without_implying_a_passed_check(client, monkeypatch):
    created = client.post('/api/types', json={'request_id': str(uuid4()), 'origin': 'blank', 'construction': 'three_core', 'name': '待补录三芯输入'})
    assert created.status_code == 201, created.text
    workspace = created.json()
    scope = open_session(client, workspace)
    monkeypatch.setattr(Types, 'evidence', lambda *args: (_ for _ in ()).throw(AssertionError('input must not read evidence')))
    args = {'type_id': workspace['id'], 'view': 'input', 'limit': 20}; items = []
    while args:
        data = page(client, scope, args)['data']
        items.extend(data['items']); args = data['next_page']
    missing = [item for item in items if item['section'] == 'checks']
    assert missing and all(item.get('path') and item['blocking'] for item in missing)
    assert all(item['source']['kind'] == 'saved_type_input' for item in missing)
    assert not any(item['section'] in ('runs', 'requirements', 'diameter_chain') for item in items)
