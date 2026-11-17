"""Real TypeLibrary import through the same broker and four human decisions."""
import base64
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from uuid import uuid4

import pytest
from jsonschema import Draft202012Validator
from openpyxl import load_workbook

from backend.harness.external_actions import ExternalActions
from backend.harness.external_imports import MAX_BYTES, StructureImports
from backend.kernel.public_catalogues import match_sample, sample_bytes
from test_harness_external import AUTH, call, client
from test_harness_external_actions import propose, decide, resume


def counts(client):
    with client.app.state.workspace_store.db() as db:
        return {name: db.execute('SELECT count(*) FROM ' + name).fetchone()[0] for name in (
            'type_table_uploads', 'type_table_previews', 'type_series', 'type_series_versions',
            'workspaces', 'studies', 'study_runs', 'type_submissions')}


def scope(client, conversation=None, workspace=None):
    conversation = conversation or str(uuid4())
    workspace = workspace or client.post('/api/workspaces', json={}).json()['id']
    response = client.post('/api/agent/external/sessions', headers=AUTH, json={
        'workspace_id': workspace, 'conversation_id': conversation, 'message': '导入实际附件并逐步核对。'})
    assert response.status_code == 200, response.text
    return {**response.json(), 'conversation_id': conversation, 'workspace_id': workspace}


def attach(client, current, content=None, filename='人民电缆.xlsx'):
    content = sample_bytes('people-mv') if content is None else content
    response = client.post('/api/agent/external/attachments', headers=AUTH, json={
        'conversation_id': current['conversation_id'], 'filename': filename,
        'content_base64': base64.b64encode(content).decode()})
    assert response.status_code == 200, response.text
    metadata = response.json()
    assert metadata == {'id': metadata['id'], 'filename': filename, 'size': len(content), 'sha256': sha256(content).hexdigest()}
    return metadata


def uploaded(client, current):
    attachment = attach(client, current)
    proposal = propose(client, current, 'propose_structure_upload', {
        'attachment_id': attachment['id'], 'expected_sha256': attachment['sha256']})
    receipt = decide(client, proposal)['receipt']
    assert receipt['kind'] == 'structure_upload' and receipt['executed'] is True, receipt
    return resume(client, current), receipt


def preview_args(upload, name='待核对厂家系列'):
    request = deepcopy(upload['declarations'][1])
    request.pop('table', None)
    request['series']['name'] = name
    return {'upload_id': upload['upload_id'], 'sha256': upload['sha256'], 'request': request}


def previewed(client, current):
    current, upload = uploaded(client, current)
    proposal = propose(client, current, 'propose_structure_preview', preview_args(upload))
    receipt = decide(client, proposal)['receipt']
    assert receipt['kind'] == 'structure_preview' and receipt['executed'] is True, receipt
    return resume(client, current), receipt


def imported(client, current):
    current, preview = previewed(client, current)
    proposal = propose(client, current, 'propose_structure_import', {
        'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'], 'skip_errors': False})
    receipt = decide(client, proposal)['receipt']
    assert receipt['kind'] == 'structure_import' and receipt['executed'] is True, receipt
    return resume(client, current), receipt


def test_four_real_decisions_preserve_source_rows_and_run_standard_checks(client):
    current = scope(client)
    initial = counts(client)
    attachment = attach(client, current)
    assert counts(client) == initial
    capability = call(client, 'structure_import_inspect', {'filename': attachment['filename']}).json()
    assert capability['status'] == 'ok' and capability['data']['available'] is True
    assert capability['data']['attachment_required'] is True
    schemas = {row['name']: row['parameters'] for row in client.get('/api/agent/external/tools', headers=AUTH).json()}
    upload = propose(client, current, 'propose_structure_upload', {
        'attachment_id': attachment['id'], 'expected_sha256': attachment['sha256']})
    assert counts(client) == initial
    saved = decide(client, upload)
    assert decide(client, upload) == saved
    upload = saved['receipt']
    assert counts(client)['type_table_uploads'] == initial['type_table_uploads'] + 1
    current = resume(client, current)
    request = preview_args(upload)
    Draft202012Validator(schemas['propose_structure_preview']).validate(request)
    preview = propose(client, current, 'propose_structure_preview', request)
    assert counts(client)['type_table_previews'] == 0
    assert any(row['label'] == '原件 SHA256' and row['after'] == attachment['sha256'] for row in preview['changes'])
    assert any(row['unit'] == 'mm' and '原表第' in row['label'] for row in preview['changes'])
    receipt = decide(client, preview)['receipt']
    assert receipt['valid_count'] == receipt['row_count'] == 11 and receipt['error_count'] == receipt['incomplete_count'] == 0
    assert all('payload' not in row for row in receipt['preview']['rows'])
    assert all(value['source']['file_sha256'] == attachment['sha256'] for row in receipt['preview']['rows'] for value in row['values'])
    current = resume(client, current)
    proposal = propose(client, current, 'propose_structure_import', {
        'preview_id': receipt['preview_id'], 'preview_digest': receipt['preview_digest'], 'skip_errors': False})
    assert any(row['label'] == '保存预览标识' and row['after'] == receipt['preview_id'] for row in proposal['changes'])
    assert any(row['label'] == '保存预览 SHA256' and row['after'] == receipt['preview_digest'] and len(row['after']) == 64
               for row in proposal['changes'])
    assert counts(client)['type_series'] == counts(client)['type_series_versions'] == 0
    assert len([row for row in proposal['changes'] if row['label'].endswith(' · 规格')]) == 11
    assert any(row['label'].endswith('来源') and row['after'].get('file_sha256') == attachment['sha256']
               for row in proposal['changes'] if isinstance(row['after'], dict))
    accepted = decide(client, proposal)
    assert decide(client, proposal) == accepted
    committed = accepted['receipt']
    assert committed['created'] == len(committed['specs']) == 11 and 'workspace_id' not in committed
    assert all(row['version'] == 1 and row['state'] == 'draft' for row in committed['specs'])
    assert counts(client)['workspaces'] == initial['workspaces'] + 11
    assert counts(client)['study_runs'] == initial['study_runs']
    current = resume(client, current)
    check = propose(client, current, 'propose_structure_check', {
        'series_id': committed['series_id'], 'spec_ids': [row['id'] for row in committed['specs']]})
    assert counts(client)['studies'] == initial['studies']
    checked = decide(client, check)
    assert decide(client, check) == checked
    actual = checked['receipt']
    assert actual['kind'] == 'structure_check' and actual['executed'] is True and actual['status'] == 'succeeded', actual
    assert len(actual['items']) == 11 and all(row['run_id'] and row['input_digest'] and row['output_digest'] for row in actual['items'])
    assert counts(client)['study_runs'] == initial['study_runs'] + 11
    assert counts(client)['type_submissions'] == 0
    current = resume(client, current)
    read = call(client, 'structure_import_read', {'kind': 'check', 'id': actual['batch_id'], 'view': '/status'},
                current['session'], current['turn']).json()
    assert read['status'] == 'ok' and read['data']['page']['value'] == 'succeeded'
    record = client.get('/api/agent/sessions/' + current['session']).json()
    assert [step['tool'] for step in record['steps']][:4] == list((
        'propose_structure_upload', 'propose_structure_preview', 'propose_structure_import', 'propose_structure_check'))


def test_attachment_token_filename_limit_metadata_and_conversation_scope(client):
    current = scope(client)
    before = counts(client)
    body = {'conversation_id': current['conversation_id'], 'filename': '表.csv',
            'content_base64': base64.b64encode('截面,导体直径\n50,8\n'.encode()).decode()}
    assert client.post('/api/agent/external/attachments', json=body).status_code == 401
    for filename in ('../表.csv', 'x\\表.csv', '/表.xlsx', '表.exe', '表.csv\n', '表.csv.'):
        response = client.post('/api/agent/external/attachments', headers=AUTH, json={**body, 'filename': filename})
        assert response.status_code == 422, filename
    too_large = {**body, 'content_base64': base64.b64encode(b'x' * (MAX_BYTES + 1)).decode()}
    refused = client.post('/api/agent/external/attachments', headers=AUTH, json=too_large)
    assert refused.status_code == 422 and 'eHh4eHh4' not in refused.text
    assert 'input' not in refused.json()['detail']
    metadata = client.post('/api/agent/external/attachments', headers=AUTH, json=body).json()
    read = call(client, 'structure_import_read', {'kind': 'attachment', 'id': metadata['id']}, current['session'], current['turn']).json()
    assert read['data']['page']['value'] == metadata
    assert 'content_base64' not in json.dumps(read) and 'path' not in read['data']['page']['value']
    other = scope(client, workspace=current['workspace_id'])
    denied = call(client, 'structure_import_read', {'kind': 'attachment', 'id': metadata['id']}, other['session'], other['turn']).json()
    assert denied['status'] == 'error' and denied['diagnostics'][0]['code'] == 'IMPORT_ATTACHMENT_REQUIRED'
    assert counts(client) == before


def test_missing_attachment_unbound_legacy_and_model_authority_fields_are_refused(client):
    current = scope(client)
    args = {'attachment_id': str(uuid4()), 'expected_sha256': '0' * 64}
    missing = call(client, 'propose_structure_upload', args, current['session'], current['turn']).json()
    assert missing['status'] == 'error' and '附件' in missing['summary'] and '文件名不能代替' in missing['summary']
    for injected in ('conversation_id', 'actor', 'human_confirmed'):
        result = call(client, 'propose_structure_upload', {**args, injected: 'human'}, current['session'], current['turn']).json()
        assert result['status'] == 'error' and result['diagnostics'][0]['code'] == 'TOOL_ARGUMENTS_INVALID'
    legacy = client.post('/api/agent/external/sessions', headers=AUTH, json={
        'workspace_id': current['workspace_id'], 'message': '旧会话'}).json()
    denied = call(client, 'propose_structure_upload', args, legacy['session'], legacy['turn']).json()
    assert denied['status'] == 'error' and denied['diagnostics'][0]['code'] == 'IMPORT_CONVERSATION_REQUIRED'
    assert counts(client)['type_table_uploads'] == 0


@pytest.mark.parametrize('stage', ['upload', 'preview'])
def test_lost_non_idempotent_response_is_uncertain_and_never_called_twice(client, monkeypatch, stage):
    current = scope(client)
    if stage == 'upload':
        attachment = attach(client, current)
        args = {'attachment_id': attachment['id'], 'expected_sha256': attachment['sha256']}
    else:
        current, upload = uploaded(client, current)
        args = preview_args(upload)
    name = 'propose_structure_' + stage
    proposal = propose(client, current, name, args)
    service = client.app.state.type_library
    original, calls = getattr(service, stage), []
    def lose(*args, **kwargs):
        calls.append(1)
        original(*args, **kwargs)
        raise RuntimeError('test-only response lost after durable staging commit')
    monkeypatch.setattr(service, stage, lose)
    decision = decide(client, proposal)
    assert decision['receipt']['status'] == 'uncertain' and decision['receipt']['executed'] is None
    assert decision['receipt']['may_have_written'] is True
    assert decide(client, proposal) == decision and calls == [1]
    assert counts(client)['type_table_' + ('uploads' if stage == 'upload' else 'previews')] == 1
    assert counts(client)['type_series'] == 0


@pytest.mark.parametrize('operation', ['commit', 'batch'])
def test_durable_library_receipts_recover_after_lost_response(client, monkeypatch, operation):
    current = scope(client)
    if operation == 'commit':
        current, saved = previewed(client, current)
        name = 'propose_structure_import'
        args = {'preview_id': saved['preview_id'], 'preview_digest': saved['preview_digest'], 'skip_errors': False}
    else:
        current, saved = imported(client, current)
        name = 'propose_structure_check'
        args = {'series_id': saved['series_id'], 'spec_ids': [saved['specs'][0]['id']]}
    proposal = propose(client, current, name, args)
    service = client.app.state.type_library
    original, calls = getattr(service, operation), []
    def lose(*args, **kwargs):
        calls.append(1)
        original(*args, **kwargs)
        raise RuntimeError('test-only response lost after durable library receipt')
    monkeypatch.setattr(service, operation, lose)
    decision = decide(client, proposal)
    assert decision['receipt']['executed'] is True and decision['receipt']['status'] == 'succeeded', decision
    assert decide(client, proposal) == decision and calls == [1]
    assert counts(client)['type_series'] == 1 and counts(client)['type_series_versions'] == 11
    assert counts(client)['study_runs'] == (1 if operation == 'batch' else 0)


def test_rejection_and_reopened_same_conversation_keep_exact_ownership(client):
    first = scope(client)
    attachment = attach(client, first)
    proposal = propose(client, first, 'propose_structure_upload', {
        'attachment_id': attachment['id'], 'expected_sha256': attachment['sha256']})
    assert decide(client, proposal, False)['status'] == 'rejected'
    assert counts(client)['type_table_uploads'] == 0
    reopened = scope(client, first['conversation_id'], first['workspace_id'])
    proposal = propose(client, reopened, 'propose_structure_upload', {
        'attachment_id': attachment['id'], 'expected_sha256': attachment['sha256']})
    accepted = decide(client, proposal)['receipt']
    other = scope(client, workspace=first['workspace_id'])
    denied = call(client, 'structure_import_read', {'kind': 'upload', 'id': accepted['upload_id']}, other['session'], other['turn']).json()
    assert denied['status'] == 'error' and denied['diagnostics'][0]['code'] == 'IMPORT_SCOPE_VIOLATION'
    assert client.get('/api/agent/external/proposals/' + proposal['id'], params={'session': other['session']}, headers=AUTH).status_code == 403


def test_preview_paging_binds_digest_and_changed_source_prevents_import(client):
    current, preview = previewed(client, scope(client))
    args = {'kind': 'preview', 'id': preview['preview_id'], 'view': '/rows', 'limit': 1}
    first = call(client, 'structure_import_read', args, current['session'], current['turn']).json()
    assert first['status'] == 'ok' and first['data']['resource']['preview_digest'] == preview['preview_digest']
    assert first['data']['resource']['row_count'] == 11
    next_args = first['data']['next_read']['arguments']
    missing = call(client, 'structure_import_read', {key: value for key, value in next_args.items() if key != 'expected_digest'}, current['session'], current['turn']).json()
    assert missing['status'] == 'error' and missing['diagnostics'][0]['code'] == 'IMPORT_DIGEST_REQUIRED'
    assert call(client, 'structure_import_read', next_args, current['session'], current['turn']).json()['status'] == 'ok'
    proposal = propose(client, current, 'propose_structure_import', {
        'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'], 'skip_errors': False})
    with client.app.state.workspace_store.db(True) as db:
        db.execute("UPDATE type_table_uploads SET original=? WHERE id=?", (b'changed source', preview['upload_id']))
    refused = decide(client, proposal)['receipt']
    assert refused['status'] == 'failed' and refused['executed'] is False, refused
    assert counts(client)['type_series'] == 0


def test_batch_refuses_cross_series_and_remote_execution_before_any_run(client, monkeypatch):
    current, committed = imported(client, scope(client))
    foreign = call(client, 'propose_structure_check', {'series_id': committed['series_id'], 'spec_ids': [str(uuid4())]},
                   current['session'], current['turn']).json()
    assert foreign['status'] == 'error' and foreign['diagnostics'][0]['code'] == 'IMPORT_SCOPE_VIOLATION'
    monkeypatch.setattr(client.app.state.research.executor, 'required', lambda *args: True, raising=False)
    refused = call(client, 'propose_structure_check', {'series_id': committed['series_id'], 'spec_ids': [committed['specs'][0]['id']]},
                   current['session'], current['turn']).json()
    assert refused['status'] == 'error' and refused['diagnostics'][0]['code'] == 'NATIVE_EXECUTION_UNAVAILABLE'
    assert counts(client)['study_runs'] == counts(client)['studies'] == 0


def test_approval_response_loss_recovers_finished_journal_without_second_upload(client, monkeypatch):
    current = scope(client)
    attachment = attach(client, current)
    proposal = propose(client, current, 'propose_structure_upload', {
        'attachment_id': attachment['id'], 'expected_sha256': attachment['sha256']})
    original, attempts = ExternalActions.complete, []
    def lose(self, *args, **kwargs):
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError('test-only decision receipt unavailable')
        return original(self, *args, **kwargs)
    monkeypatch.setattr(ExternalActions, 'complete', lose)
    with pytest.raises(RuntimeError, match='decision receipt unavailable'):
        decide(client, proposal)
    recovered = decide(client, proposal)
    assert recovered['receipt']['kind'] == 'structure_upload' and recovered['receipt']['status'] == 'succeeded'
    assert counts(client)['type_table_uploads'] == 1


def test_formula_row_is_visible_and_skipping_requires_a_separate_explicit_proposal(client):
    current = scope(client)
    book = load_workbook(BytesIO(sample_bytes('people-mv')))
    book.worksheets[1]['B5'] = '=6+1'
    stream = BytesIO()
    book.save(stream)
    book.close()
    attachment = attach(client, current, stream.getvalue())
    proposal = propose(client, current, 'propose_structure_upload', {
        'attachment_id': attachment['id'], 'expected_sha256': attachment['sha256']})
    uploaded = decide(client, proposal)['receipt']
    assert not uploaded.get('declarations')
    current = resume(client, current)
    request = deepcopy(match_sample(sha256(sample_bytes('people-mv')).hexdigest())[1])
    request.pop('table', None)
    request['series']['name'] = '保留真实错误行'
    proposal = propose(client, current, 'propose_structure_preview', {
        'upload_id': uploaded['upload_id'], 'sha256': uploaded['sha256'], 'request': request})
    assert any(row['after'] == '=6+1' for row in proposal['changes'])
    preview = decide(client, proposal)['receipt']
    assert preview['error_count'] == 1 and preview['valid_count'] == 10
    current = resume(client, current)
    args = {'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'], 'skip_errors': False}
    refused = call(client, 'propose_structure_import', args, current['session'], current['turn']).json()
    assert refused['status'] == 'error' and refused['diagnostics'][0]['code'] == 'IMPORT_ROWS_INVALID'
    assert counts(client)['type_series'] == 0
    proposal = propose(client, current, 'propose_structure_import', {**args, 'skip_errors': True})
    assert any(row['label'] == '跳过的规格行号' and row['after'] == [5] for row in proposal['changes'])
    assert any('=6+1' in json.dumps(row['after']) for row in proposal['changes'] if row['label'].endswith('错误'))
    receipt = decide(client, proposal)['receipt']
    assert receipt['created'] == 10 and receipt['skipped_rows'] == [5]
    assert counts(client)['study_runs'] == counts(client)['type_submissions'] == 0


def test_incomplete_saved_spec_is_not_replaced_by_a_successful_check(client):
    current = scope(client)
    attachment = attach(client, current, '截面,导体直径\n50,8\n'.encode(), '缺项.csv')
    proposal = propose(client, current, 'propose_structure_upload', {
        'attachment_id': attachment['id'], 'expected_sha256': attachment['sha256']})
    upload = decide(client, proposal)['receipt']
    current = resume(client, current)
    proposal = propose(client, current, 'propose_structure_preview', {
        'upload_id': upload['upload_id'], 'sha256': upload['sha256'],
        'request': {'sheet': '缺项', 'first_data_row': 2, 'mapping': {'area': 0, 'conductor_diameter': 1},
                    'series': {'name': '保留缺项的草稿', 'manufacturer': '用户提供原表', 'designation': 'YJV',
                               'cores': 3, 'u0_v': 8700, 'u_v': 15000}}})
    preview = decide(client, proposal)['receipt']
    assert preview['incomplete_count'] == 1 and preview['preview']['rows'][0]['missing']
    current = resume(client, current)
    proposal = propose(client, current, 'propose_structure_import', {
        'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'], 'skip_errors': False})
    saved = decide(client, proposal)['receipt']
    current = resume(client, current)
    proposal = propose(client, current, 'propose_structure_check', {'series_id': saved['series_id'], 'spec_ids': [saved['specs'][0]['id']]})
    assert any(row['after'] for row in proposal['changes'] if row['label'].endswith('已知缺项'))
    checked = decide(client, proposal)['receipt']
    assert checked['executed'] is True and checked['status'] == 'failed'
    assert checked['items'][0]['status'] == 'failed' and '缺项' in checked['items'][0]['message']
    assert not checked['items'][0].get('run_id') and counts(client)['study_runs'] == counts(client)['studies'] == 0


@pytest.mark.parametrize('change', ['revision', 'remote'])
def test_check_revalidates_frozen_revision_and_execution_location_after_accept(client, monkeypatch, change):
    current, committed = imported(client, scope(client))
    spec = committed['specs'][0]
    proposal = propose(client, current, 'propose_structure_check', {'series_id': committed['series_id'], 'spec_ids': [spec['id']]})
    if change == 'remote':
        monkeypatch.setattr(client.app.state.research.executor, 'required', lambda *args: True, raising=False)
    else:
        workspace = client.get('/api/workspaces/' + spec['workspace_id']).json()
        document = deepcopy(workspace['domain'])
        document['name'] += '（人工修改）'
        edited = client.put('/api/workspaces/' + spec['workspace_id'] + '/domain', json={
            'expected_revision': workspace['revision'], 'document': document})
        assert edited.status_code == 200, edited.text
    refused = decide(client, proposal)['receipt']
    assert refused['status'] == 'failed' and refused['executed'] is False, refused
    assert refused['error']['code'] == ('NATIVE_EXECUTION_UNAVAILABLE' if change == 'remote' else 'IMPORT_CHECK_STALE')
    assert counts(client)['studies'] == counts(client)['study_runs'] == 0


def test_restart_recovers_interrupted_batch_with_real_saved_item_without_rerunning(client, monkeypatch):
    from backend.kernel import type_library_operations
    current, committed = imported(client, scope(client))
    proposal = propose(client, current, 'propose_structure_check', {
        'series_id': committed['series_id'], 'spec_ids': [row['id'] for row in committed['specs'][:2]]})
    run, remember, attempts = type_library_operations._run, StructureImports.remember, []
    def interrupt_after_one_run(*args, **kwargs):
        attempts.append(1)
        if len(attempts) == 2:
            raise RuntimeError('test-only worker stopped before second saved run')
        return run(*args, **kwargs)
    def lose_journal_response(self, proposal, receipt):
        if receipt.get('status') == 'running':
            raise RuntimeError('test-only process stopped before journal completion')
        return remember(self, proposal, receipt)
    monkeypatch.setattr(type_library_operations, '_run', interrupt_after_one_run)
    monkeypatch.setattr(StructureImports, 'remember', lose_journal_response)
    with pytest.raises(RuntimeError, match='journal completion'):
        decide(client, proposal)
    assert counts(client)['study_runs'] == counts(client)['studies'] == 1
    with client.app.state.workspace_store.db() as db:
        batch = dict(db.execute('SELECT * FROM type_library_batches WHERE request=?', (proposal['id'],)).fetchone())
        assert batch['status'] == 'running' and len(json.loads(batch['payload'])['items']) == 1
        assert db.execute('SELECT state FROM agent_import_actions WHERE proposal=?', (proposal['id'],)).fetchone()[0] == 'started'
    client.app.state.type_library.initialize()
    monkeypatch.setattr(StructureImports, 'remember', remember)
    monkeypatch.setattr(client.app.state.type_library, 'batch', lambda *args, **kwargs: pytest.fail('recovery repeated batch execution'))
    recovered = decide(client, proposal)
    receipt = recovered['receipt']
    assert receipt['status'] == 'interrupted' and receipt['executed'] is True
    assert receipt['complete'] is False and receipt['may_have_written'] is True
    assert receipt['batch_id'] == batch['id'] and len(receipt['items']) == 1
    assert receipt['items'][0]['run_id'] and receipt['items'][0]['status'] == 'succeeded'
    assert decide(client, proposal) == recovered and counts(client)['study_runs'] == 1
    current = resume(client, current)
    read = call(client, 'structure_import_read', {'kind': 'check', 'id': receipt['batch_id'], 'view': '/items'},
                current['session'], current['turn']).json()
    assert read['status'] == 'ok' and read['data']['resource']['status'] == 'interrupted'
    assert read['data']['page']['items'][0]['path'] == '/items/0'
    exact = call(client, 'structure_import_read', {'kind': 'check', 'id': receipt['batch_id'],
        'view': '/items/0/run_id', 'expected_digest': read['data']['source']['response_digest']},
        current['session'], current['turn']).json()
    assert exact['data']['page']['value'] == receipt['items'][0]['run_id']


@pytest.mark.parametrize('drift', ['release', 'execution_location'])
def test_each_batch_item_keeps_the_reviewed_release_and_local_execution(client, monkeypatch, drift):
    from backend.kernel import type_library_operations
    current, committed = imported(client, scope(client))
    proposal = propose(client, current, 'propose_structure_check', {
        'series_id': committed['series_id'], 'spec_ids': [row['id'] for row in committed['specs'][:2]]})
    research = client.app.state.research
    service = client.app.state.type_library
    run, pin, calls = type_library_operations._run, research.pin, []
    def change_after_first_saved_run(*args, **kwargs):
        result = run(*args, **kwargs)
        calls.append(result['run_id'])
        if drift == 'release':
            monkeypatch.setattr(research, 'pin', lambda plugin: {**pin(plugin), 'release_digest': 'f' * 64})
        else:
            monkeypatch.setattr(research.executor, 'required', lambda *args: True, raising=False)
        return result
    monkeypatch.setattr(type_library_operations, '_run', change_after_first_saved_run)
    result = decide(client, proposal)['receipt']
    assert service.research is research and client.app.state.research is research
    assert result['executed'] is True and result['status'] == 'partial'
    assert len(calls) == counts(client)['study_runs'] == counts(client)['studies'] == 1
    assert result['items'][0]['run_id'] == calls[0] and result['items'][0]['status'] == 'succeeded'
    assert result['items'][1]['status'] == 'failed' and not result['items'][1].get('run_id')
    expected = 'IMPORT_CHECK_METHOD_CHANGED' if drift == 'release' else 'NATIVE_EXECUTION_UNAVAILABLE'
    assert result['items'][1]['detail']['code'] == expected
    assert decide(client, proposal)['receipt'] == result and counts(client)['study_runs'] == 1
