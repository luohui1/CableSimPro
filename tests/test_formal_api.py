"""Actual saved IEC records exercise preview and export concurrency boundaries."""
from copy import deepcopy
from hashlib import sha256
from io import BytesIO

from fastapi.testclient import TestClient
from openpyxl import load_workbook
import pytest

from backend.main import create_app
from backend.kernel.formal_deliveries import FormalDeliveries
from backend.kernel.workspace import Edit
from test_research import study, request as execution_request


@pytest.fixture(scope='module')
def saved_api(tmp_path_factory):
    with TestClient(create_app(tmp_path_factory.mktemp('formal-api') / 'engineering.sqlite')) as client:
        workspace, definition = study(client)
        prefix, body = execution_request(client, workspace, definition)
        response = client.post(prefix + '/runs', json=body)
        assert response.status_code == 200, response.text
        run = response.json()
        assert run['status'] == 'succeeded' and run['integrity'] == 'verified'
        selection = {'kind': 'calculation', 'source': {'workspace_id': workspace['id'],
            'expected_revision': workspace['revision'], 'runs': [
                {'run_id': run['id'], 'input_digest': run['input_digest'], 'output_digest': run['output_digest']}]},
            'document': {'organization': '正式接口回归测试单位', 'number': '计算-001', 'revision': 'A',
                         'header': '保存的工程记录', 'footer': '完整来源见追溯'}}
        yield client, workspace, selection


def test_preview_pins_metadata_and_export_headers_match_actual_bytes(saved_api, monkeypatch):
    client, workspace, request = saved_api
    def no_solver(*args, **kwargs):
        pytest.fail('formal export unexpectedly ran a calculation')
    monkeypatch.setattr(client.app.state.research.executor, 'run', no_solver)
    preview = client.post('/api/formal-deliveries/preview', json=request)
    assert preview.status_code == 200, preview.text
    assert preview.headers['cache-control'] == 'no-store'
    model = preview.json()
    assert all('payload' not in source for source in model['sources'].values())
    assert all(signature['name'] is None and signature['date'] is None for signature in model['signatures'])
    selection = {**request, 'format': 'xlsx', 'expected_model_digest': model['model_digest']}
    changed = deepcopy(selection)
    changed['document']['number'] = '计算-002'
    response = client.post('/api/formal-deliveries/export', json=changed)
    assert response.status_code == 409
    assert response.json()['detail']['code'] == 'FORMAL_MODEL_CHANGED'
    response = client.post('/api/formal-deliveries/export', json=selection)
    assert response.status_code == 200, response.text
    assert response.headers['x-artifact-sha256'] == sha256(response.content).hexdigest()
    assert response.headers['x-delivery-model-sha256'] == model['model_digest']
    assert response.headers['x-delivery-source-sha256'] == model['source_digest']
    assert response.headers['cache-control'] == 'no-store'
    assert 'filename*=UTF-8' in response.headers['content-disposition']
    with BytesIO(response.content) as content:
        workbook = load_workbook(content)
        assert workbook['文件信息']['B4'].value == '计算-001'
        assert len(workbook['追溯数值']['A']) > 1
        workbook.close()
    assert client.get('/api/workspaces/' + workspace['id']).json()['revision'] == workspace['revision']
    invalid = deepcopy(request)
    invalid['document']['signatures'] = {'approve': '未记录的批准人'}
    assert client.post('/api/formal-deliveries/preview', json=invalid).status_code == 422


def test_actual_revision_committed_during_render_prevents_file_return(saved_api, monkeypatch):
    client, workspace, request = saved_api
    preview = client.post('/api/formal-deliveries/preview', json=request)
    assert preview.status_code == 200, preview.text
    original = FormalDeliveries.render
    def render_then_edit(self, model, format):
        content = original(self, model, format)
        # A real normal workspace operation after the renderer has produced its
        # bytes simulates an edit committed while an export is in progress.
        self.research.store.edit(workspace['id'], Edit(expected_revision=workspace['revision'],
            changes=[{'path': 'installation.depth_m', 'value': 1.1}]))
        return content
    monkeypatch.setattr(FormalDeliveries, 'render', render_then_edit)
    response = client.post('/api/formal-deliveries/export', json={**request, 'format': 'xlsx',
        'expected_model_digest': preview.json()['model_digest']})
    assert response.status_code == 409, response.text
    assert response.headers['content-type'].startswith('application/json')
    assert client.get('/api/workspaces/' + workspace['id']).json()['revision'] == workspace['revision'] + 1
