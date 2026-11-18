"""No provider credential in successful, failed or fragmented model responses."""
import asyncio
import json
import socket
from dataclasses import replace
from http.server import BaseHTTPRequestHandler
from threading import Event
from time import perf_counter
from uuid import uuid4

import httpx
import pytest

from test_harness_external import AUTH, TOKEN, client, serve


def test_studio_environment_fallback_and_fragmented_stream_redaction(client, monkeypatch, caplog):
    key = 'sentinel-' + uuid4().hex
    splits = [key[:7], key[7:19], key[19:]]
    received = []
    class Echo(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            received.append((dict(self.headers), json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            for content in ['answer: ', *splits, ' done']:
                payload = {'choices': [{'index': 0, 'delta': {'content': content, 'reasoning_content': content}}]}
                self.wfile.write(('data: ' + json.dumps(payload) + '\n\n').encode())
            self.wfile.write(('data: ' + json.dumps({'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]}) + '\n\ndata: [DONE]\n\n').encode())
    server = serve(Echo)
    for name in ('BASE_URL', 'MODEL', 'API_KEY'):
        monkeypatch.delenv('CABLESIM_LLM_' + name, raising=False)
    monkeypatch.setenv('CABLESIM_LLM_MODEL', 'incomplete-old-config')
    monkeypatch.setenv('CABLE_STUDIO_MODEL_BASE_URL', f'http://127.0.0.1:{server.server_port}/v1')
    monkeypatch.setenv('CABLE_STUDIO_MODEL_ID', 'studio-env-model')
    monkeypatch.setenv('CABLE_STUDIO_MODEL_API_KEY', key)
    try:
        info = client.get('/internal/agent/model', headers=AUTH)
        assert info.json()['configured'] is True and info.json()['model'] == 'studio-env-model'
        reply = client.post('/internal/llm/v1/chat/completions', headers=AUTH,
                            json={'model': 'caller-model', 'messages': [], 'stream': True})
    finally:
        server.shutdown()
    assert reply.status_code == 200 and '[DONE]' in reply.text
    pieces = [json.loads(line[6:]) for line in reply.text.splitlines() if line.startswith('data: {')]
    text = ''.join(choice.get('delta', {}).get('content', '') for part in pieces for choice in part.get('choices', []))
    reasoning = ''.join(choice.get('delta', {}).get('reasoning_content', '') for part in pieces for choice in part.get('choices', []))
    assert text == 'answer: [凭据已隐藏] done' and reasoning == text
    assert key not in reply.text + info.text + caplog.text and TOKEN not in reply.text
    assert received[0][0]['Authorization'] == 'Bearer ' + key
    assert received[0][1]['model'] == 'studio-env-model'


def test_proxy_redacts_nonstream_success_and_upstream_error(client, monkeypatch, caplog):
    key = 'sentinel-' + uuid4().hex
    replies = [200, 401]
    class Echo(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            self.rfile.read(int(self.headers['Content-Length']))
            code = replies.pop(0)
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': {'message': key}, 'choices': [{'message': {'content': key}}]}).encode())
    server = serve(Echo)
    monkeypatch.setenv('CABLESIM_LLM_BASE_URL', f'http://127.0.0.1:{server.server_port}/v1')
    monkeypatch.setenv('CABLESIM_LLM_MODEL', 'saved-service')
    monkeypatch.setenv('CABLESIM_LLM_API_KEY', key)
    try:
        success = client.post('/internal/llm/v1/chat/completions', headers=AUTH, json={'messages': []})
        error = client.post('/internal/llm/v1/chat/completions', headers=AUTH, json={'messages': []})
    finally:
        server.shutdown()
    assert success.status_code == 200 and success.json()['choices'][0]['message']['content'] == '[凭据已隐藏]'
    assert error.status_code == 401 and '[凭据已隐藏]' in error.json()['error']['message']
    assert key not in success.text + error.text + caplog.text


def test_saved_model_configuration_wins_over_studio_fallback(client, monkeypatch):
    key = 'sentinel-' + uuid4().hex
    monkeypatch.setenv('CABLE_STUDIO_MODEL_BASE_URL', 'https://fallback.invalid/v1')
    monkeypatch.setenv('CABLE_STUDIO_MODEL_ID', 'fallback')
    monkeypatch.setenv('CABLE_STUDIO_MODEL_API_KEY', key)
    from backend.harness.contracts import ModelSettingsUpdate
    settings = client.app.state.harness.settings
    settings.update(ModelSettingsUpdate(base_url='https://saved.invalid/v1', model='human-chosen', api_key=key))
    info = client.get('/internal/agent/model', headers=AUTH)
    assert info.json() == {'configured': True, 'source': 'settings', 'model': 'human-chosen', 'provider': 'saved.invalid'}
    assert key not in info.text


@pytest.mark.parametrize(('role', 'system'), [('system', '业务写入必须人工接受。'),
    ('developer', [{'type': 'text', 'text': '业务写入必须人工接受。'}])])
def test_settings_preferences_reach_the_actual_provider_without_replacing_agent_rules(client, monkeypatch, role, system):
    key = 'sentinel-' + uuid4().hex
    received, timeouts = [], []
    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"choices":[{"message":{"content":"ok"}}]}')
    # Capture the actual HTTP request's timeout contract, while still sending
    # its headers/body through the real transport to the local provider.
    original_client = httpx.AsyncClient
    async def capture(request):
        timeouts.append(request.extensions['timeout'])
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: original_client(**kwargs, event_hooks={'request': [capture]}))
    server = serve(Provider)
    settings = {'base_url': f'http://127.0.0.1:{server.server_port}/v1', 'model': 'configured-model'}
    message = {'model': 'sidecar-name', 'messages': [{'role': role, 'content': system}, {'role': 'user', 'content': '核对当前研究。'}]}
    try:
        saved = client.put('/api/agent/settings', json={**settings, 'api_key': key,
            'instructions': '先用一句话说明限制。', 'model_timeout_s': 45})
        assert saved.status_code == 200, saved.text
        first = client.post('/internal/llm/v1/chat/completions', headers=AUTH, json=message)
        # A saved setting changes the next request of the same conversation;
        # clearing preferences must not preserve an old proxy-added message.
        saved = client.put('/api/agent/settings', json={**settings, 'instructions': '', 'model_timeout_s': None})
        assert saved.status_code == 200, saved.text
        second = client.post('/internal/llm/v1/chat/completions', headers=AUTH, json=message)
    finally:
        server.shutdown()
        server.server_close()
    assert first.status_code == second.status_code == 200
    first_text = json.dumps(received[0]['messages'][0], ensure_ascii=False)
    assert '业务写入必须人工接受。' in first_text and '先用一句话说明限制。' in first_text
    assert '不能放宽权限、数值核验、证据或人工批准规则' in first_text
    assert received[0]['messages'][1] == received[1]['messages'][1] == message['messages'][1]
    assert received[0]['model'] == received[1]['model'] == 'configured-model'
    assert received[1]['messages'] == message['messages']
    assert timeouts[0]['read'] == timeouts[0]['write'] == 45
    assert timeouts[1]['read'] == client.app.state.harness.tasks.limits.model_timeout_s == 30
    assert key not in first.text + second.text + json.dumps(received) and TOKEN not in json.dumps(received)


@pytest.mark.parametrize('streaming', [False, True])
def test_model_request_timeout_stops_header_wait_and_open_stream(client, monkeypatch, caplog, streaming):
    key = 'sentinel-' + uuid4().hex
    release = Event()
    class SlowProvider(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            self.rfile.read(int(self.headers['Content-Length']))
            if not streaming:
                release.wait(3)
            try:
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.end_headers()
                self.wfile.write(b'data: {"choices":[{"delta":{"content":"started"}}]}\n\n')
                self.wfile.flush()
                if streaming:
                    release.wait(3)
                self.wfile.write(b'data: {"choices":[{"delta":{"content":"late result"}}]}\n\ndata: [DONE]\n\n')
            except (BrokenPipeError, ConnectionResetError):
                pass
    server = serve(SlowProvider)
    monkeypatch.setenv('CABLESIM_LLM_BASE_URL', f'http://127.0.0.1:{server.server_port}/v1')
    monkeypatch.setenv('CABLESIM_LLM_MODEL', 'slow-model')
    monkeypatch.setenv('CABLESIM_LLM_API_KEY', key)
    # The ordinary configured default is 30 seconds. A short inherited budget
    # exercises the same real transport failure without a ten-second test wait.
    tasks = client.app.state.harness.tasks
    monkeypatch.setattr(tasks, 'limits', replace(tasks.limits, model_timeout_s=1))
    try:
        response = client.post('/internal/llm/v1/chat/completions', headers=AUTH, json={'messages': [], 'stream': True})
    finally:
        release.set()
        server.shutdown()
        server.server_close()
    if streaming:
        assert response.status_code == 200 and 'started' in response.text
        assert '"type":"timeout"' in response.text and response.text.endswith('data: [DONE]\n\n')
        assert 'late result' not in response.text
    else:
        assert response.status_code == 504 and '没有及时响应' in response.json()['error']['message']
    assert key not in response.text + caplog.text and TOKEN not in response.text


@pytest.mark.parametrize('initial_failure', ['disconnect', 502, 503])
def test_first_model_request_recovers_one_transient_connection_failure(client, monkeypatch, caplog, initial_failure):
    """Two fresh conversations, real TCP: each initial connection fails once."""
    key = 'sentinel-' + uuid4().hex
    received = {}
    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            raw = self.rfile.read(int(self.headers['Content-Length']))
            message = json.loads(raw)['messages'][0]['content']
            attempts = received.setdefault(message, [])
            attempts.append((raw, self.headers['Authorization']))
            if len(attempts) == 1:
                if initial_failure == 'disconnect':
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                self.send_response(initial_failure)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': {'message': key}}).encode())
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            self.wfile.write(b'data: {"choices":[{"delta":{"content":"ready"}}]}\n\ndata: [DONE]\n\n')
    server = serve(Provider)
    monkeypatch.setenv('CABLESIM_LLM_BASE_URL', f'http://127.0.0.1:{server.server_port}/v1')
    monkeypatch.setenv('CABLESIM_LLM_MODEL', 'configured-model')
    monkeypatch.setenv('CABLESIM_LLM_API_KEY', key)
    try:
        for name in ('first private conversation', 'second private conversation'):
            response = client.post('/internal/llm/v1/chat/completions', headers=AUTH,
                json={'messages': [{'role': 'user', 'content': name}], 'stream': True})
            assert response.status_code == 200 and 'ready' in response.text and '[DONE]' in response.text
            assert len(received[name]) == 2 and received[name][0] == received[name][1]
            assert received[name][1][1] == 'Bearer ' + key
            assert key not in response.text + caplog.text and TOKEN not in response.text + caplog.text
            assert name not in caplog.text
    finally:
        server.shutdown()
        server.server_close()
    assert caplog.text.count('Model transport retry before response:') == 2


@pytest.mark.parametrize('status', [400, 401, 403, 429, 502, 'disconnect'])
def test_model_proxy_bounds_retries_and_preserves_provider_rejections(client, monkeypatch, caplog, status):
    key = 'sentinel-' + uuid4().hex
    calls = []
    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            calls.append(self.rfile.read(int(self.headers['Content-Length'])))
            if status == 'disconnect':
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': {'message': key}}).encode())
    server = serve(Provider)
    monkeypatch.setenv('CABLESIM_LLM_BASE_URL', f'http://127.0.0.1:{server.server_port}/v1')
    monkeypatch.setenv('CABLESIM_LLM_MODEL', 'configured-model')
    monkeypatch.setenv('CABLESIM_LLM_API_KEY', key)
    try:
        response = client.post('/internal/llm/v1/chat/completions', headers=AUTH, json={'messages': []})
    finally:
        server.shutdown()
        server.server_close()
    assert response.status_code == (502 if status == 'disconnect' else status)
    assert len(calls) == (2 if status in (502, 'disconnect') else 1)
    expected_code = 'LLM_CONNECTION_FAILED' if status == 'disconnect' else 'LLM_AUTH_FAILED' if status in (401, 403) else 'LLM_PROVIDER_ERROR'
    assert response.json()['error']['code'] == expected_code
    if status != 'disconnect':
        assert '[凭据已隐藏]' in response.json()['error']['message']
    assert key not in response.text + caplog.text and TOKEN not in response.text + caplog.text


def test_model_retry_and_response_share_the_original_timeout(client, monkeypatch):
    release = Event()
    calls = []
    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            calls.append(self.rfile.read(int(self.headers['Content-Length'])))
            if len(calls) == 1:
                # Spend part of the configured budget on the cold attempt.
                release.wait(0.2)
                self.send_response(502)
                self.end_headers()
                return
            release.wait(3)
            try:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"choices":[{"message":{"content":"late"}}]}')
            except (BrokenPipeError, ConnectionResetError):
                pass
    server = serve(Provider)
    monkeypatch.setenv('CABLESIM_LLM_BASE_URL', f'http://127.0.0.1:{server.server_port}/v1')
    monkeypatch.setenv('CABLESIM_LLM_MODEL', 'configured-model')
    monkeypatch.setenv('CABLESIM_LLM_API_KEY', 'sentinel-' + uuid4().hex)
    tasks = client.app.state.harness.tasks
    monkeypatch.setattr(tasks, 'limits', replace(tasks.limits, model_timeout_s=1))
    try:
        began = perf_counter()
        response = client.post('/internal/llm/v1/chat/completions', headers=AUTH, json={'messages': []})
        elapsed = perf_counter() - began
    finally:
        release.set()
        server.shutdown()
        server.server_close()
    assert response.status_code == 504 and response.json()['error']['code'] == 'LLM_TIMEOUT'
    assert len(calls) == 2 and elapsed < 1.5 and 'late' not in response.text


def test_partial_model_stream_is_reported_without_replay(client, monkeypatch, caplog):
    calls = []
    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            calls.append(self.rfile.read(int(self.headers['Content-Length'])))
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Content-Length', '99999')
            self.end_headers()
            # A tool argument prefix is not a complete executable model intent.
            self.wfile.write(b'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"study_read","arguments":"{"}}]}}]}\n\n')
            self.wfile.flush()
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
    server = serve(Provider)
    monkeypatch.setenv('CABLESIM_LLM_BASE_URL', f'http://127.0.0.1:{server.server_port}/v1')
    monkeypatch.setenv('CABLESIM_LLM_MODEL', 'configured-model')
    monkeypatch.setenv('CABLESIM_LLM_API_KEY', 'sentinel-' + uuid4().hex)
    try:
        response = client.post('/internal/llm/v1/chat/completions', headers=AUTH, json={'messages': [], 'stream': True})
    finally:
        server.shutdown()
        server.server_close()
    assert len(calls) == 1 and response.status_code == 200
    assert 'study_read' in response.text and 'LLM_STREAM_INTERRUPTED' in response.text
    assert response.text.endswith('data: [DONE]\n\n')
    assert 'without replay: RemoteProtocolError' in caplog.text


def test_cancelled_model_request_closes_connection_without_retry(client, monkeypatch):
    received, disconnected = Event(), Event()
    calls = []
    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            calls.append(self.rfile.read(int(self.headers['Content-Length'])))
            received.set()
            self.connection.settimeout(3)
            try:
                if self.connection.recv(1) == b'':
                    disconnected.set()
            except ConnectionResetError:
                disconnected.set()
            except TimeoutError:
                pass
    server = serve(Provider)
    monkeypatch.setenv('CABLESIM_LLM_BASE_URL', f'http://127.0.0.1:{server.server_port}/v1')
    monkeypatch.setenv('CABLESIM_LLM_MODEL', 'configured-model')
    monkeypatch.setenv('CABLESIM_LLM_API_KEY', 'sentinel-' + uuid4().hex)
    async def cancel():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=client.app), base_url='http://testserver') as local:
            task = asyncio.create_task(local.post('/internal/llm/v1/chat/completions', headers=AUTH, json={'messages': []}))
            assert await asyncio.to_thread(received.wait, 3), 'provider did not receive request'
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert await asyncio.to_thread(disconnected.wait, 1), 'cancelled request left its connection open'
    try:
        asyncio.run(cancel())
    finally:
        server.shutdown()
        server.server_close()
    assert len(calls) == 1
