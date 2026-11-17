"""No provider credential in successful, failed or fragmented model responses."""
import json
from http.server import BaseHTTPRequestHandler
from uuid import uuid4

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
