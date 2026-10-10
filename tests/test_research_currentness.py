"""History revisions retain identical saved input and report concurrency guards."""
from test_research import client, study, request


def test_history_names_and_identical_restored_input_remain_current(client):
    w, s = study(client)
    root, body = request(client, w, s)
    run = client.post(root + '/runs', json=body).json()
    wid = w['id']
    changed = client.post(f'/api/workspaces/{wid}/edit', json={
        'expected_revision': w['revision'],
        'changes': [{'path': 'installation.depth_m', 'value': 1.1}],
    })
    assert changed.status_code == 200, changed.text
    history = client.get(f'/api/workspaces/{wid}').json()
    assert history['can_undo'] and history['undo_label']
    assert client.get(root + '/runs/' + run['id']).json()['freshness'] == 'historical'
    restored = client.post(f'/api/workspaces/{wid}/history/undo', json={
        'expected_revision': history['revision'],
    })
    assert restored.status_code == 200, restored.text
    assert restored.json()['revision'] > w['revision']
    assert restored.json()['redo_label']
    assert client.get(root + '/runs/' + run['id']).json()['freshness'] == 'current'
    assert client.get(root).json()['latest_run']['freshness'] == 'current'
    response = client.post(f'/api/workspaces/{wid}/deliveries/current',json={'run_ids':[run['id']]})
    assert response.status_code == 201, response.text
    book = response.json()
    assert book['sources'][0]['run_id'] == run['id']


def test_preview_snapshot_matches_preview_digest_without_persistence(client):
    from copy import deepcopy
    from backend.kernel.workspace import fingerprint
    w, s = study(client)
    root, body = request(client, w, s)
    document = deepcopy(s['definition']['method_input'])
    document['name'] = '试算草稿名称'
    response = client.post(root + '/preview', json={
        'expected_revision': w['revision'], 'expected_study_revision': s['revision'],
        'method_input': document,
    })
    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview['persisted'] is False
    case = preview['snapshot']['cases'][0]
    assert preview['snapshot']['definition']['method_input'] == case['input'] == document
    assert fingerprint({'input': case['input'], 'parameters': case['parameters']}) == preview['input_digest']
    assert client.get(root + '/runs').json()['items'] == []
