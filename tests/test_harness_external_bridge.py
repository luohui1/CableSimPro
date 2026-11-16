"""External pi bridge stays inside the legacy Agent session and ToolBroker."""
def test_external_tool_catalog_is_parameterized_and_scoped(client):
    workspace = client.post('/api/workspaces', json={}).json()
    sid = client.post('/api/agent/sessions', json={'workspace_id': workspace['id']}).json()['id']
    response = client.get('/api/agent/external/tools', params={'session_id': sid})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['read_only'] is True
    assert body['tools']
    row = next(item for item in body['tools'] if item['name'] == 'workspace_read')
    assert row['parameters']['type'] == 'object'
    assert row['scope']['workspace_id'] == workspace['id']
    assert 'paths' in row['parameters']['properties']


def test_external_bridge_rejects_non_allowlisted_and_write_tools(client):
    workspace = client.post('/api/workspaces', json={}).json()
    sid = session(client, workspace)
    for name in ('made_up_tool', 'propose_domain_changes'):
        response = client.post('/api/agent/external/calls', json={
            'session_id': sid, 'tool': name, 'arguments': {},
        })
        assert response.status_code == 403, response.text
        assert response.json()['detail']['code'] == 'EXTERNAL_TOOL_FORBIDDEN'


def test_external_read_call_uses_tool_broker_and_keeps_session_scope(client, monkeypatch):
    workspace = client.post('/api/workspaces', json={}).json()
    sid = session(client, workspace)
    harness = client.app.state.harness
    called = []
    original = harness.broker.execute

    def observe(task, node, tool):
        called.append((task['workspace_id'], node['tool'], tool.kind))
        return original(task, node, tool)

    monkeypatch.setattr(harness.broker, 'execute', observe)
    response = client.post('/api/agent/external/calls', json={
        'session_id': sid, 'tool': 'workspace_read', 'arguments': {},
    })
    assert response.status_code == 200, response.text
    assert response.json()['status'] == 'ok'
    assert called == [(workspace['id'], 'workspace_read', 'read')]


def test_external_bridge_rejects_a_study_from_another_workspace(client):
    from test_research import study

    workspace, own_study = study(client)
    other_workspace, other_study = study(client)
    sid = client.post('/api/agent/sessions', json={
        'workspace_id': workspace['id'], 'study_id': own_study['id'],
    }).json()['id']
    response = client.post('/api/agent/external/calls', json={
        'session_id': sid,
        'tool': 'study_read',
        'arguments': {'study_id': other_study['id']},
    })
    assert response.status_code in (404, 422), response.text
    assert response.json()['detail']
    assert other_workspace['id'] != workspace['id']
