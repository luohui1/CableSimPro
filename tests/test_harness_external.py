"""The reviewed tool host an external agent kernel uses: what it offers, what it refuses, how a call is scoped and audited,
and that the model key stays in this process."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from backend.harness.external import READ_TOOLS, TOOL_SCOPES
from backend.main import create_app
from test_research import study

TOKEN = 'test-sidecar-token-0123456789'
KEY = 'sk-test-upstream-key-0123456789'
AUTH = {'Authorization': 'Bearer ' + TOKEN}


def app_client(directory):
    from backend.plugin_host import Executor
    directory.mkdir(parents=True, exist_ok=True)
    app = create_app(directory / 'workspace.sqlite')
    app.state.research.executor = Executor(process_runner=app.state.research.resident_runner)
    return TestClient(app)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('CABLESIM_AGENT_SIDECAR_TOKEN', TOKEN)
    monkeypatch.setenv('NO_PROXY', '127.0.0.1,localhost,::1')
    for name in ('ALL_PROXY', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'):
        monkeypatch.delenv(name, raising=False)
    with app_client(tmp_path) as c:
        yield c


def serve(handler):
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def call(client, tool, arguments=None, session=None, turn=None):
    return client.post('/api/agent/external/calls', headers=AUTH, json={'tool': tool, 'arguments': arguments or {},
                                                                         **({'session': session, 'turn': turn} if session else {})})


def open_session(client, workspace, message='这项研究的结论是什么？'):
    response = client.post('/api/agent/external/sessions', headers=AUTH, json={'workspace_id': workspace['id'], 'message': message})
    assert response.status_code == 200, response.text
    return response.json()


def test_nothing_is_open_without_the_token(client, tmp_path, monkeypatch):
    assert client.get('/api/agent/external/tools').status_code == 401
    assert client.get('/api/agent/external/tools', headers={'Authorization': 'Bearer wrong'}).status_code == 401
    assert client.post('/internal/llm/v1/chat/completions', json={}).status_code == 401
    monkeypatch.delenv('CABLESIM_AGENT_SIDECAR_TOKEN')
    with app_client(tmp_path / 'off') as off:
        refused = off.get('/api/agent/external/tools', headers=AUTH)
        assert refused.status_code == 503 and refused.json()['detail']['code'] == 'AGENT_SIDECAR_DISABLED'
        page = off.get('/agent-sidecar/api/status')
        assert page.status_code == 503 and page.json()['error']['code'] == 'AGENT_SIDECAR_DISABLED'


def test_the_catalogue_offers_only_reads_and_reviewed_proposals(client):
    rows = client.get('/api/agent/external/tools', headers=AUTH).json()
    assert {row['name'] for row in rows} == set(TOOL_SCOPES)
    assert all(row['kind'] in ('read', 'propose') for row in rows)
    assert all(row['parameters']['type'] == 'object' and row['parameters']['additionalProperties'] is False for row in rows)
    registry = client.app.state.harness.registry.hosts
    assert {tool.name for tool in registry if tool.kind != 'read'}.isdisjoint(READ_TOOLS)
    assert {row['name']: row['scope'] for row in rows}['run_read'] == 'workspace'


@pytest.mark.parametrize('tool', ['approve', 'study_preflight', 'study_preview', 'draft_update', 'platform_prepare',
                                  'recipe_execute', 'platform_read', 'publish', 'no_such_tool'])
def test_an_unreviewed_write_or_arbitrary_tool_is_refused(client, tool):
    response = call(client, tool)
    assert response.status_code == 403 and response.json()['detail']['code'] == 'TOOL_NOT_ALLOWED'


def test_a_call_runs_through_the_broker_in_a_scoped_session_and_is_audited(client):
    w, s = study(client)
    opened = open_session(client, w)
    assert opened['context']['kind'] == 'project'
    session, turn = opened['session'], opened['turn']
    listed = call(client, 'study_list', session=session, turn=turn).json()
    assert listed['status'] == 'ok' and [row['id'] for row in listed['data']['studies']] == [s['id']]
    runs = call(client, 'run_list', {'study_id': s['id']}, session, turn).json()
    assert runs['status'] == 'ok'
    # The broker's own argument contract still applies: an argument the tool does not declare is refused, not passed on.
    bad = call(client, 'study_read', {'study_id': s['id'], 'bogus': 1}, session, turn).json()
    assert bad['status'] == 'error' and bad['diagnostics'][0]['code'] == 'TOOL_ARGUMENTS_INVALID'
    # A study of another workspace is outside the session's scope.
    other, other_study = study(client)
    foreign = call(client, 'study_read', {'study_id': other_study['id']}, session, turn).json()
    assert foreign['status'] == 'error'
    record = client.get('/api/agent/sessions/' + session).json()
    assert [step['tool'] for step in record['steps']] == ['study_list', 'run_list', 'study_read', 'study_read']
    assert [step['state'] for step in record['steps']] == ['succeeded', 'succeeded', 'failed', 'failed']
    assert record['messages'][0]['content'] == '这项研究的结论是什么？'
    assert any(event['type'] == 'tool.intent' for event in record['events'])
    assert client.post(f'/api/agent/external/sessions/{session}/turns/{turn}/finish', headers=AUTH).status_code == 200
    assert client.get('/api/agent/sessions/' + session).json()['state'] == 'completed'
    ended = call(client, 'study_list', session=session, turn=turn)
    assert ended.status_code == 409 and ended.json()['detail']['code'] == 'TURN_NOT_ACTIVE'


def test_a_call_outside_a_session_is_only_for_tools_that_need_no_project(client):
    w, s = study(client)
    found = call(client, 'object_find', {'kind': 'study', 'q': s['id']}).json()
    assert found['status'] == 'ok' and [card['id'] for card in found['data']['items']] == [s['id']]
    refused = call(client, 'workspace_read')
    assert refused.status_code == 422 and refused.json()['detail']['code'] == 'SESSION_REQUIRED'


class Upstream(BaseHTTPRequestHandler):
    seen = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        Upstream.seen.append((dict(self.headers), json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        self.wfile.write(b'data: {"choices":[{"delta":{"content":"\xe5\xa5\xbd"}}]}\n\ndata: [DONE]\n\n')


def test_the_model_proxy_adds_the_key_and_the_caller_never_sees_it(client, monkeypatch):
    server = serve(Upstream)
    Upstream.seen.clear()
    monkeypatch.setenv('CABLESIM_LLM_BASE_URL', f'http://127.0.0.1:{server.server_port}/v1')
    monkeypatch.setenv('CABLESIM_LLM_MODEL', 'real-model')
    monkeypatch.setenv('CABLESIM_LLM_API_KEY', KEY)
    try:
        info = client.get('/internal/agent/model', headers=AUTH)
        assert info.json()['configured'] is True and info.json()['model'] == 'real-model' and KEY not in info.text
        reply = client.post('/internal/llm/v1/chat/completions', headers=AUTH,
                            json={'model': 'asked-for', 'messages': [{'role': 'user', 'content': '你好'}], 'stream': True})
    finally:
        server.shutdown()
    assert reply.status_code == 200 and '好' in reply.text and KEY not in reply.text and TOKEN not in reply.text
    headers, body = Upstream.seen[0]
    assert headers['Authorization'] == 'Bearer ' + KEY and TOKEN not in json.dumps(headers)
    assert body['model'] == 'real-model' and body['messages'][0]['content'] == '你好'


def test_the_model_proxy_says_so_when_no_model_is_configured(client, monkeypatch):
    for name in ('BASE_URL', 'MODEL', 'API_KEY'):
        monkeypatch.delenv('CABLESIM_LLM_' + name, raising=False)
    for name in ('BASE_URL', 'ID', 'API_KEY'):
        monkeypatch.delenv('CABLE_STUDIO_MODEL_' + name, raising=False)
    assert client.get('/internal/agent/model', headers=AUTH).json()['configured'] is False
    reply = client.post('/internal/llm/v1/chat/completions', headers=AUTH, json={'messages': []})
    assert reply.status_code == 409 and '模型未配置' in reply.json()['error']['message']


def test_the_page_route_passes_through_and_says_why_when_nothing_answers(client, tmp_path, monkeypatch):
    class Sidecar(BaseHTTPRequestHandler):
        got = []

        def log_message(self, *args):
            pass

        def do_POST(self):
            Sidecar.got.append((dict(self.headers), self.rfile.read(int(self.headers['Content-Length']))))
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"session":"s1"}')
    server = serve(Sidecar)
    try:
        monkeypatch.setenv('CABLESIM_AGENT_SIDECAR_URL', f'http://127.0.0.1:{server.server_port}')
        # The route reads its address when the app is built, so a second app picks up the live fake.
        with app_client(tmp_path / 'second') as live:
            reply = live.post('/agent-sidecar/api/chat/messages', json={'text': '你好'}, headers={'Authorization': 'Bearer browser-never-sends-this'})
            assert live.get('/agent-sidecar/api/arbitrary').status_code == 404
        assert reply.status_code == 200 and reply.json() == {'session': 's1'}
        headers, body = Sidecar.got[0]
        assert json.loads(body) == {'text': '你好'} and {key.lower(): value for key, value in headers.items()}['authorization'] == 'Bearer ' + TOKEN
    finally:
        server.shutdown()
    monkeypatch.setenv('CABLESIM_AGENT_SIDECAR_URL', 'http://127.0.0.1:9')
    with app_client(tmp_path / 'third') as down:
        gone = down.get('/agent-sidecar/api/status')
    assert gone.status_code == 502 and gone.json()['error']['code'] == 'SIDECAR_UNREACHABLE' and '没有运行' in gone.json()['error']['message']
