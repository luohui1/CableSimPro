"""Batch APIs package real saved IEC results; no fabricated successful output.

Two temporary engineering projects are executed through public APIs once. Each
test receives a SQLite backup of those records and forbids any new execution.
Failure injections only exercise rejection/atomicity, never produce a positive
engineering result. No FEM or native solver is used.
"""
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from pathlib import PurePosixPath
import sqlite3
from zipfile import ZipFile

from fastapi import HTTPException
from fastapi.testclient import TestClient
import fitz
from openpyxl import load_workbook
from pydantic import ValidationError
import pytest

from backend.main import create_app
from backend.kernel import formal_batches as batch_module
from backend.kernel.formal_batches import BatchPreviewRequest
from backend.kernel.formal_contracts import PreviewRequest, canonical_bytes, jsonsha, resolve_pointer
from backend.kernel.formal_deliveries import FormalDeliveries
from backend.kernel.workspace import Edit
from test_research import study, request as execution_request


PREVIEW = '/api/formal-deliveries/batch/preview'
EXPORT = '/api/formal-deliveries/batch/export'


@pytest.fixture(scope='module')
def saved_records(tmp_path_factory):
    database = tmp_path_factory.mktemp('formal-batch-records') / 'engineering.sqlite'
    selections = []
    with TestClient(create_app(database)) as client:
        for index in range(2):
            driver = None if index == 0 else {'kind': 'sweep', 'samples': [
                {'label': '另一工程保存的埋深', 'changes': {'/input/installation/depth_m': 1.1}}]}
            workspace, definition = study(client, driver=driver)
            prefix, body = execution_request(client, workspace, definition)
            response = client.post(prefix + '/runs', json=body)
            assert response.status_code == 200, response.text
            run = response.json()
            assert run['status'] == 'succeeded' and run['integrity'] == 'verified'
            selections.append({'kind': 'calculation', 'source': {
                'workspace_id': workspace['id'], 'expected_revision': workspace['revision'],
                'runs': [{'run_id': run['id'], 'input_digest': run['input_digest'],
                          'output_digest': run['output_digest']}]},
                'document': {'organization': '批量文件真实记录测试单位',
                             'number': '重复文号/工程:001', 'revision': 'A',
                             'header': '保存运行 · 批量验收', 'footer': '来源见完整追溯'}})
    return {'database': database, 'selections': selections}


@pytest.fixture
def batch_api(saved_records, tmp_path, monkeypatch):
    database = tmp_path / 'engineering.sqlite'
    with sqlite3.connect(saved_records['database']) as source, sqlite3.connect(database) as destination:
        source.backup(destination)
    with TestClient(create_app(database)) as client:
        def forbidden(*args, **kwargs):
            pytest.fail('A formal batch must not execute a calculation or approval.')
        monkeypatch.setattr(client.app.state.research.executor, 'run', forbidden)
        yield client


def selected(saved_records, kind='series'):
    first, second = deepcopy(saved_records['selections'])
    if kind == 'project':
        second = deepcopy(first)
        scope = {'kind': 'project', 'workspace_id': first['source']['workspace_id']}
    else:
        scope = {'kind': 'series', 'series_name': '用户明确选择的验收系列',
                 'workspace_ids': [first['source']['workspace_id'], second['source']['workspace_id']]}
    second['kind'] = 'research_report'
    return {'scope': scope, 'items': [
        {**first, 'key': 'calculation', 'formats': ['pdf', 'xlsx']},
        {**second, 'key': 'report', 'formats': ['xlsx', 'pdf']}]}


def _records(client):
    with client.app.state.workspace_store.db() as database:
        return [tuple(row) for row in database.execute(
            'SELECT id,workspace,input_digest,output_digest,status FROM study_runs ORDER BY id')]


def _full_model(content, format):
    if format == 'pdf':
        with fitz.open(stream=content, filetype='pdf') as document:
            assert document.page_count > 1
            return json.loads(document.embfile_get('formal-model.json'))
    with BytesIO(content) as source:
        workbook = load_workbook(source)
        try:
            assert workbook['文件信息']['B4'].value == '重复文号/工程:001'
            assert all(workbook['文件信息'].cell(row, column).value is None
                       for row in range(14, 18) for column in (2, 3))
            assert workbook['追溯原文'].sheet_state == 'hidden'
            model = json.loads(''.join(row[1] for row in workbook['追溯原文'].iter_rows(
                min_row=2, values_only=True)))
            for row in workbook['追溯数值'].iter_rows(min_row=2, values_only=True):
                table_id, row_id, column_key, sheet, cell, text = row[:6]
                quantity = next(item for item in model['tables'][table_id]['rows'] if item['id'] == row_id)['cells'][column_key]
                assert text == quantity['raw_text'] == workbook[sheet][cell].value
            return model
        finally:
            workbook.close()


def _compare_full_api(client, model):
    for source in model['sources'].values():
        response = client.get(source['api_url'])
        assert response.status_code == 200, response.text
        actual = response.json()
        if source['kind'] == 'workspace':
            expected = {key: actual[key] for key in ('id', 'revision')}
        else:
            assert source['kind'] == 'run'
            assert source['api_url'].endswith('?view=full')
            expected = {'record': {key: actual[key] for key in source['payload']['record']},
                        'snapshot': actual['snapshot'], 'output': actual['output']}
            assert jsonsha(expected['snapshot']) == actual['input_digest']
            assert jsonsha(expected['output']) == actual['output_digest']
        assert canonical_bytes(expected) == canonical_bytes(source['payload'])
        assert source['payload_digest'] == jsonsha(expected)
    for table in model['tables'].values():
        for row in table['rows']:
            for cell in row['cells'].values():
                reference = cell.get('value_ref')
                if reference:
                    value = resolve_pointer(model['sources'][reference['source_id']]['payload'], reference['pointer'])
                    assert canonical_bytes(value) == canonical_bytes(cell['value'])
    assert all(signature['name'] is None and signature['date'] is None
               and signature['evidence_ref'] is None for signature in model['signatures'])


@pytest.mark.parametrize('scope', ['project', 'series'])
def test_actual_api_zip_preserves_sources_and_duplicate_document_numbers(batch_api, saved_records, scope):
    client, request = batch_api, selected(saved_records, scope)
    before = _records(client)
    response = client.post(PREVIEW, json=request)
    assert response.status_code == 200, response.text
    assert response.headers['cache-control'] == 'no-store'
    preview = response.json()
    assert preview['file_count'] == 4
    assert preview['batch_digest'] == jsonsha({key: value for key, value in preview.items() if key != 'batch_digest'})
    if scope == 'series':
        assert preview['scope']['membership_source'] == 'explicit_workspace_ids'
    else:
        assert preview['scope'] == request['scope']
    for item, summary in zip(request['items'], preview['items']):
        single = client.post('/api/formal-deliveries/preview', json={
            key: item[key] for key in ('kind', 'source', 'document')})
        assert single.status_code == 200, single.text
        assert single.headers['cache-control'] == 'no-store'
        assert summary['model_digest'] == single.json()['model_digest']
        assert summary['source_identity'] == single.json()['source_identity']
        assert summary['sources'] == single.json()['sources']
        assert all('payload' not in source for source in summary['sources'].values())
    exported = client.post(EXPORT, json={**request, 'expected_batch_digest': preview['batch_digest']})
    assert exported.status_code == 200, exported.text[:1000]
    assert exported.headers['content-type'] == 'application/zip'
    assert exported.headers['cache-control'] == 'no-store'
    assert exported.headers['x-artifact-sha256'] == sha256(exported.content).hexdigest()
    assert exported.headers['x-delivery-batch-sha256'] == preview['batch_digest']
    assert 'attachment;' in exported.headers['content-disposition']
    assert 'filename*=UTF-8' in exported.headers['content-disposition']
    models = {}
    with ZipFile(BytesIO(exported.content)) as archive:
        expected_paths = [file['path'] for item in preview['items'] for file in item['files']]
        assert archive.namelist() == ['manifest.json', *expected_paths]
        assert len({path.casefold() for path in archive.namelist()}) == 5
        assert archive.testzip() is None
        assert all(not PurePosixPath(path).is_absolute() and '..' not in PurePosixPath(path).parts
                   and '\\' not in path for path in archive.namelist())
        manifest = json.loads(archive.read('manifest.json'))
        assert {key: value for key, value in manifest.items() if key != 'files'} == preview
        assert archive.read('manifest.json') == canonical_bytes(manifest)
        assert sum(info.file_size for info in archive.infolist()) <= batch_module.MAX_ARCHIVE_BYTES
        for item in manifest['files']:
            content = archive.read(item['path'])
            assert item['bytes'] == len(content) <= batch_module.MAX_FILE_BYTES
            assert item['sha256'] == sha256(content).hexdigest()
            summary = preview['items'][item['item_index'] - 1]
            assert summary['key'] == item['item_key']
            assert item['source'] == summary['source']
            assert item['source_identity'] == summary['source_identity']
            assert item['sources'] == summary['sources']
            model = _full_model(content, item['format'])
            assert model['model_digest'] == item['model_digest'] == summary['model_digest']
            assert model['source_digest'] == item['source_digest'] == summary['source_digest']
            assert model['metadata'] == summary['document']
            if item['item_key'] in models:
                assert canonical_bytes(models[item['item_key']]) == canonical_bytes(model)
            else:
                _compare_full_api(client, model)
                models[item['item_key']] = model
        assert preview['source_bytes'] == sum(len(canonical_bytes(model['sources'])) for model in models.values())
    assert _records(client) == before
    for item in request['items']:
        workspace = client.get('/api/workspaces/' + item['source']['workspace_id']).json()
        assert workspace['revision'] == item['source']['expected_revision']


@pytest.mark.parametrize('key', ['', '../outside', 'a/b', 'a\\b', 'C:drive', '含中文', 'x' * 41, 'last\n'])
def test_key_contract_rejects_unsafe_names(saved_records, key):
    request = selected(saved_records)
    request['items'][0]['key'] = key
    with pytest.raises(ValidationError):
        BatchPreviewRequest.model_validate(request)


@pytest.mark.parametrize('problem', [
    'duplicate-key-casefold', 'duplicate-format', 'empty-formats', 'unsupported-format',
    'empty-items', 'too-many-items', 'project-cross-scope', 'series-missing-member',
    'series-extra-member', 'series-duplicate-member', 'mixed-revisions', 'scope-extra',
    'injected-membership', 'injected-signatures', 'empty-series-name', 'series-control',
])
def test_strict_scope_and_item_contract(saved_records, problem):
    request = selected(saved_records)
    if problem == 'duplicate-key-casefold':
        request['items'][1]['key'] = request['items'][0]['key'].upper()
    elif problem == 'duplicate-format':
        request['items'][0]['formats'] = ['pdf', 'pdf']
    elif problem == 'empty-formats':
        request['items'][0]['formats'] = []
    elif problem == 'unsupported-format':
        request['items'][0]['formats'] = ['csv']
    elif problem == 'empty-items':
        request['items'] = []
    elif problem == 'too-many-items':
        request['items'] = [{**request['items'][0], 'key': f'entry-{index}'} for index in range(17)]
    elif problem == 'project-cross-scope':
        request['scope'] = {'kind': 'project', 'workspace_id': request['items'][0]['source']['workspace_id']}
    elif problem == 'series-missing-member':
        request['scope']['workspace_ids'].pop()
    elif problem == 'series-extra-member':
        request['scope']['workspace_ids'].append('not-selected')
    elif problem == 'series-duplicate-member':
        request['scope']['workspace_ids'].append(request['scope']['workspace_ids'][0])
    elif problem == 'mixed-revisions':
        request = selected(saved_records, 'project')
        request['items'][1]['source']['expected_revision'] += 1
    elif problem == 'scope-extra':
        request['scope']['workspace_id'] = 'unexpected-project-field'
    elif problem == 'injected-membership':
        request['scope']['membership_source'] = 'verified_family'
    elif problem == 'injected-signatures':
        request['items'][0]['document']['signatures'] = {'approve': 'not-recorded'}
    elif problem == 'empty-series-name':
        request['scope']['series_name'] = '  '
    elif problem == 'series-control':
        request['scope']['series_name'] = 'series\nname'
    with pytest.raises(ValidationError):
        BatchPreviewRequest.model_validate(request)


def test_contract_accepts_maximum_16_items_and_32_files(saved_records):
    request = selected(saved_records, 'project')
    request['items'] = [{**request['items'][0], 'key': f'entry-{index}'} for index in range(16)]
    model = BatchPreviewRequest.model_validate(request)
    assert len(model.items) == 16 and sum(len(item.formats) for item in model.items) == 32


@pytest.mark.parametrize('change', ['order', 'document', 'format', 'key', 'series-name'])
def test_changed_preview_is_rejected_before_any_render(batch_api, saved_records, monkeypatch, change):
    client, request = batch_api, selected(saved_records)
    preview = client.post(PREVIEW, json=request)
    assert preview.status_code == 200, preview.text
    if change == 'order':
        request['items'].reverse()
    elif change == 'document':
        request['items'][0]['document']['number'] = '另一编号'
    elif change == 'format':
        request['items'][0]['formats'] = ['xlsx']
    elif change == 'key':
        request['items'][0]['key'] = 'renamed'
    elif change == 'series-name':
        request['scope']['series_name'] = '另一显式选择集'
    monkeypatch.setattr(FormalDeliveries, 'render', lambda *_: pytest.fail('Stale preview must not render.'))
    response = client.post(EXPORT, json={**request, 'expected_batch_digest': preview.json()['batch_digest']})
    assert response.status_code == 409, response.text
    assert response.json()['detail']['code'] == 'FORMAL_BATCH_CHANGED'
    assert 'x-artifact-sha256' not in response.headers


def test_first_project_changed_during_later_render_rejects_the_whole_zip(batch_api, saved_records, monkeypatch):
    client, request = batch_api, selected(saved_records)
    for item in request['items']:
        item['formats'] = ['xlsx']
    preview = client.post(PREVIEW, json=request)
    assert preview.status_code == 200, preview.text
    first, second = request['items']
    original, rendered = FormalDeliveries.render, []
    def render_and_edit(self, model, format):
        content = original(self, model, format)
        workspace_id = model['source_identity']['workspace_id']
        rendered.append(workspace_id)
        if workspace_id == second['source']['workspace_id']:
            self.research.store.edit(first['source']['workspace_id'], Edit(
                expected_revision=first['source']['expected_revision'],
                changes=[{'path': 'installation.depth_m', 'value': 1.2}]))
        return content
    monkeypatch.setattr(FormalDeliveries, 'render', render_and_edit)
    response = client.post(EXPORT, json={**request, 'expected_batch_digest': preview.json()['batch_digest']})
    assert rendered == [first['source']['workspace_id'], second['source']['workspace_id']]
    assert response.status_code == 409, response.text
    detail = response.json()['detail']
    assert detail['code'] == 'FORMAL_BATCH_ITEM_FAILED'
    assert detail['item'] == {'index': 1, 'key': first['key'], 'kind': first['kind'],
                              'workspace_id': first['source']['workspace_id']}
    assert detail['stage'] == 'revalidate' and detail['cause_status'] == 409
    assert detail['cause']['code']
    assert response.headers['content-type'].startswith('application/json')
    assert 'x-artifact-sha256' not in response.headers


def test_late_item_failure_preserves_item_and_cause_without_a_partial_zip(batch_api, saved_records, monkeypatch):
    client, request = batch_api, selected(saved_records)
    for item in request['items']:
        item['formats'] = ['xlsx']
    preview = client.post(PREVIEW, json=request)
    assert preview.status_code == 200, preview.text
    original, rendered = FormalDeliveries.render, []
    def fail_later(self, model, format):
        rendered.append(model['kind'])
        if model['kind'] == 'research_report':
            raise HTTPException(status_code=422, detail={'code': 'SAVED_RECORD_UNAVAILABLE', 'message': '原始失败原因'})
        return original(self, model, format)
    monkeypatch.setattr(FormalDeliveries, 'render', fail_later)
    response = client.post(EXPORT, json={**request, 'expected_batch_digest': preview.json()['batch_digest']})
    assert rendered == ['calculation', 'research_report']
    assert response.status_code == 422, response.text
    detail = response.json()['detail']
    assert detail['item']['key'] == 'report' and detail['item']['index'] == 2
    assert detail['stage'] == 'render'
    assert detail['cause'] == {'code': 'SAVED_RECORD_UNAVAILABLE', 'message': '原始失败原因'}
    assert 'x-artifact-sha256' not in response.headers


@pytest.mark.parametrize('source_status,response_status', [(404, 409), (422, 409), (503, 503)])
def test_final_source_recheck_distinguishes_conflict_from_service_failure(
        batch_api, saved_records, monkeypatch, source_status, response_status):
    client, request = batch_api, selected(saved_records, 'project')
    request['items'] = [request['items'][0]]
    request['items'][0]['formats'] = ['xlsx']
    preview = client.post(PREVIEW, json=request)
    assert preview.status_code == 200, preview.text
    original, builds = FormalDeliveries.build, []
    def unavailable_after_render(self, item):
        builds.append(item.key)
        if len(builds) == 2:
            raise HTTPException(status_code=source_status,
                                detail={'code': 'RECHECK_UNAVAILABLE', 'message': '保存记录重查失败'})
        return original(self, item)
    monkeypatch.setattr(FormalDeliveries, 'build', unavailable_after_render)
    response = client.post(EXPORT, json={**request, 'expected_batch_digest': preview.json()['batch_digest']})
    assert builds == ['calculation', 'calculation']
    assert response.status_code == response_status, response.text
    detail = response.json()['detail']
    assert detail['stage'] == 'revalidate' and detail['item']['key'] == 'calculation'
    assert detail['cause_status'] == source_status
    assert detail['cause'] == {'code': 'RECHECK_UNAVAILABLE', 'message': '保存记录重查失败'}
    assert 'x-artifact-sha256' not in response.headers


def test_full_source_budget_counts_each_item_once_and_stops_before_render(batch_api, saved_records, monkeypatch):
    client, request = batch_api, selected(saved_records, 'project')
    service = FormalDeliveries(client.app.state.research, client.app.state.types)
    first = PreviewRequest.model_validate({key: request['items'][0][key] for key in ('kind', 'source', 'document')})
    one_source_bytes = len(canonical_bytes(service.build(first)['sources']))
    preview = client.post(PREVIEW, json=request)
    assert preview.status_code == 200, preview.text
    # Both formats share the same item sources, but two documents each retain
    # their complete source archive, even when they select the same saved run.
    assert preview.json()['source_bytes'] == one_source_bytes * 2
    monkeypatch.setattr(batch_module, 'MAX_SOURCE_BYTES', one_source_bytes)
    monkeypatch.setattr(FormalDeliveries, 'render', lambda *_: pytest.fail('An oversized plan must not render.'))
    response = client.post(EXPORT, json={**request, 'expected_batch_digest': preview.json()['batch_digest']})
    assert response.status_code == 422, response.text
    detail = response.json()['detail']
    assert detail['stage'] == 'build' and detail['item']['index'] == 2
    assert detail['cause']['code'] == 'FORMAL_BATCH_SOURCE_LIMIT'
    assert 'x-artifact-sha256' not in response.headers


@pytest.mark.parametrize('limit', ['single-file', 'archive-files', 'archive-manifest'])
def test_actual_file_capacity_limits_reject_before_zip_creation(batch_api, saved_records, monkeypatch, limit):
    client, request = batch_api, selected(saved_records, 'project')
    request['items'] = [request['items'][0]]
    request['items'][0]['formats'] = ['xlsx']
    preview = client.post(PREVIEW, json=request)
    assert preview.status_code == 200, preview.text
    # Cache bytes genuinely rendered from this saved run; lowering the test
    # budget exercises exact boundaries without allocating a fake 128 MiB file.
    single = FormalDeliveries(client.app.state.research, client.app.state.types)
    selection = PreviewRequest.model_validate({key: request['items'][0][key] for key in ('kind', 'source', 'document')})
    actual = single.render(single.build(selection), 'xlsx')
    monkeypatch.setattr(FormalDeliveries, 'render', lambda *_: actual)
    monkeypatch.setattr(batch_module, '_archive', lambda *_: pytest.fail('Capacity rejection must precede ZIP creation.'))
    if limit == 'single-file':
        monkeypatch.setattr(batch_module, 'MAX_FILE_BYTES', len(actual) - 1)
    elif limit == 'archive-files':
        monkeypatch.setattr(batch_module, 'MAX_ARCHIVE_BYTES', len(actual) - 1)
    else:
        # Files alone fit exactly. The canonical UTF-8 manifest must still count.
        monkeypatch.setattr(batch_module, 'MAX_ARCHIVE_BYTES', len(actual))
    response = client.post(EXPORT, json={**request, 'expected_batch_digest': preview.json()['batch_digest']})
    assert response.status_code == 422, response.text
    detail = response.json()['detail']
    if limit == 'single-file':
        assert detail['code'] == 'FORMAL_BATCH_ITEM_FAILED' and detail['stage'] == 'render'
        assert detail['item']['key'] == 'calculation' and detail['item']['index'] == 1
    else:
        assert detail['code'] == 'FORMAL_BATCH_ARCHIVE_FAILED' and detail['stage'] == 'archive'
        assert 'item' not in detail
    assert detail['cause_status'] == 422
    cause = detail['cause']
    assert cause['code'] == ('FORMAL_FILE_LIMIT' if limit == 'single-file' else 'FORMAL_BATCH_ARCHIVE_LIMIT')
    assert response.headers['content-type'].startswith('application/json')
    assert 'x-artifact-sha256' not in response.headers


def test_zip_failure_identifies_the_batch_not_the_last_item(batch_api, saved_records, monkeypatch):
    client, request = batch_api, selected(saved_records)
    for item in request['items']:
        item['formats'] = ['xlsx']
    preview = client.post(PREVIEW, json=request)
    assert preview.status_code == 200, preview.text
    def failed_archive(entries):
        assert len(entries) == 3  # Manifest and both real rendered files are ready.
        raise OSError('ZIP 归档失败的原始原因')
    monkeypatch.setattr(batch_module, '_archive', failed_archive)
    response = client.post(EXPORT, json={**request, 'expected_batch_digest': preview.json()['batch_digest']})
    assert response.status_code == 500, response.text
    detail = response.json()['detail']
    assert detail['code'] == 'FORMAL_BATCH_ARCHIVE_FAILED' and detail['stage'] == 'archive'
    assert detail['cause_status'] == 500 and 'item' not in detail
    assert detail['cause'] == {'code': 'OSError', 'message': 'ZIP 归档失败的原始原因'}
    assert 'x-artifact-sha256' not in response.headers


def test_zip_container_is_deterministic_for_the_same_real_file_bytes(batch_api, saved_records):
    client, request = batch_api, selected(saved_records, 'project')
    single = FormalDeliveries(client.app.state.research, client.app.state.types)
    item = request['items'][0]
    model = single.build(PreviewRequest.model_validate({key: item[key] for key in ('kind', 'source', 'document')}))
    actual = single.render(model, 'xlsx')
    entries = [('manifest.json', canonical_bytes({'model_digest': model['model_digest']})),
               ('001-calculation/calculation.xlsx', actual)]
    first = batch_module._archive(entries)
    assert first == batch_module._archive(entries)
    with ZipFile(BytesIO(first)) as archive:
        assert all(info.date_time == (1980, 1, 1, 0, 0, 0) for info in archive.infolist())
        assert all((info.external_attr >> 16) == 0o100600 for info in archive.infolist())

