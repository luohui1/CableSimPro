"""Real service receipts, human gates and scope boundaries for the pi bridge."""
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import json
from uuid import uuid4

import pytest

from backend.domain.guards import value_at
from backend.harness.external_actions import ExternalActions
from test_harness_external import AUTH, client, call, open_session
from test_harness_types import design
from test_research import study


def counts(client):
    with client.app.state.workspace_store.db() as db:
        return {name: db.execute('SELECT COUNT(*) FROM ' + name).fetchone()[0]
                for name in ('workspaces', 'studies', 'study_runs', 'deliveries', 'type_creation_proposals', 'requirement_basis_queries')}


def propose(client, scope, tool, arguments):
    response = call(client, tool, arguments, scope['session'], scope['turn'])
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['status'] == 'ok', result
    return result['data']['proposal']


def decide(client, proposal, accepted=True):
    response = client.post('/api/agent/proposals/' + proposal['id'] + ('/approve' if accepted else '/reject'))
    assert response.status_code == 200, response.text
    return response.json()


def resume(client, scope):
    response = client.post('/api/agent/external/sessions/' + scope['session'] + '/resume', headers=AUTH,
                           json={'message': '已经完成人工决定，请根据真实回执继续。'})
    assert response.status_code == 200, response.text
    return response.json()


def test_create_run_export_requires_each_human_decision_and_resumes(client):
    w, source = study(client)
    scope = open_session(client, w, '复制当前研究、运行并导出计算书。')
    before = counts(client)
    create = propose(client, scope, 'propose_study', {'title': '真实多步研究', 'source_study_id': source['id']})
    assert counts(client) == before
    assert client.post('/api/agent/external/sessions/' + scope['session'] + '/resume', headers=AUTH,
                       json={'message': '尝试绕过人工决定'}).status_code == 409
    approved = decide(client, create)
    saved = approved['receipt']
    assert approved['status'] == 'approved' and saved['kind'] == 'study'
    assert counts(client)['studies'] == before['studies'] + 1
    assert decide(client, create) == approved
    scope = resume(client, scope)
    record = client.get('/api/agent/sessions/' + scope['session']).json()
    assert record['budget']['tool_calls'] == 1
    run_plan = propose(client, scope, 'propose_study_run', {'study_id': saved['study_id']})
    assert counts(client)['study_runs'] == before['study_runs']
    result = decide(client, run_plan)
    assert result['receipt']['status'] == 'succeeded', result
    rid = result['receipt']['run_id']
    assert decide(client, run_plan) == result
    assert counts(client)['study_runs'] == before['study_runs'] + 1
    scope = resume(client, scope)
    exact = call(client, 'run_read', {'run_id': rid}, scope['session'], scope['turn']).json()
    assert exact['status'] == 'ok', exact
    parameters = propose(client, scope, 'propose_method_parameters', {'study_id': saved['study_id'],
        'changes': [{'path': '/parameters/ks', 'value': .8, 'unit': '1'}], 'title': '调整参数后重算并比较'})
    assert counts(client)['study_runs'] == before['study_runs'] + 1
    changed = decide(client, parameters)
    assert changed['receipt']['study_revision'] == 2
    scope = resume(client, scope)
    rerun = propose(client, scope, 'propose_study_run', {'study_id': saved['study_id']})
    recalculated = decide(client, rerun)
    assert recalculated['receipt']['status'] == 'succeeded', recalculated
    latest = recalculated['receipt']['run_id']
    assert latest != rid and counts(client)['study_runs'] == before['study_runs'] + 2
    scope = resume(client, scope)
    comparison = call(client, 'study_compare', {'run_ids': [rid, latest]}, scope['session'], scope['turn']).json()
    assert comparison['status'] == 'ok' and comparison['data']['run_ids'] == [rid, latest], comparison
    rid = latest
    delivery = propose(client, scope, 'propose_delivery', {'run_ids': [rid]})
    assert counts(client)['deliveries'] == before['deliveries']
    exported = decide(client, delivery)
    assert exported['receipt']['kind'] == 'delivery', exported
    assert counts(client)['deliveries'] == before['deliveries'] + 1
    assert decide(client, delivery) == exported
    download = client.get(exported['receipt']['download_url'])
    assert download.status_code == 200 and rid in download.text
    assert client.get('/api/agent/external/proposals/' + delivery['id'], headers=AUTH,
        params={'session': scope['session']}).json()['receipt'] == exported['receipt']


def test_rejection_and_stale_revision_never_write_and_cross_session_cannot_read_receipt(client):
    w, s = study(client)
    scope = open_session(client, w)
    proposal = propose(client, scope, 'propose_study', {'title': '不会写入', 'source_study_id': s['id']})
    before = counts(client)
    other = open_session(client, w)
    foreign = client.get('/api/agent/external/proposals/' + proposal['id'], headers=AUTH, params={'session': other['session']})
    assert foreign.status_code == 403 and foreign.json()['detail']['code'] == 'SCOPE_VIOLATION'
    denied = decide(client, proposal, False)
    assert denied['status'] == 'rejected' and counts(client) == before
    assert client.post('/api/agent/proposals/' + proposal['id'] + '/approve').status_code == 409
    scope = resume(client, scope)
    proposal = propose(client, scope, 'propose_study_run', {'study_id': s['id']})
    edit = client.post(f'/api/workspaces/{w["id"]}/edit', json={'expected_revision': w['revision'],
                      'changes': [{'path': 'installation.depth_m', 'value': 1.1}]})
    assert edit.status_code == 200
    rejected = decide(client, proposal)
    assert rejected['receipt']['status'] == 'failed' and rejected['receipt']['executed'] is False
    assert counts(client) == before
    assert decide(client, proposal) == rejected


def test_missing_real_input_refuses_execution_without_inventing_results(client):
    w, s = study(client)
    definition = deepcopy(s['definition'])
    for cable in definition['method_input']['cable_types']:
        for core in cable['cores']:
            core['conductor']['r20'] = None
            core['conductor']['r20_basis'] = None
    saved = client.put(f'/api/workspaces/{w["id"]}/studies/{s["id"]}', json={**definition,
        'expected_revision': w['revision'], 'expected_study_revision': s['revision']})
    assert saved.status_code == 200, saved.text
    scope = open_session(client, w)
    proposal = propose(client, scope, 'propose_study_run', {'study_id': s['id']})
    before = counts(client)
    failed = decide(client, proposal)
    assert failed['receipt']['status'] == 'failed' and failed['receipt']['executed'] is False, failed
    assert failed['receipt']['error']['code'] == 'MISSING_INPUT', failed
    assert 'result' not in failed['receipt'] and 'run_id' not in failed['receipt']
    assert counts(client) == before
    continued = resume(client, scope)
    response = call(client, 'study_read', {'study_id': s['id']}, continued['session'], continued['turn'])
    assert response.status_code == 200 and response.json()['status'] == 'ok'


def test_type_edit_and_internal_specification_are_reviewed_and_exact(client):
    w, path = design(client)
    scope = open_session(client, w)
    assert scope['context']['kind'] == 'type'
    proposal = propose(client, scope, 'propose_type_changes', {'changes': [{'path': path, 'value': 15.8, 'unit': 'mm'}], 'reason': '核对结构修改'})
    assert value_at(client.app.state.workspace_store.snapshot(w['id'])['domain'], path) == .0162
    receipt = decide(client, proposal)
    assert receipt['receipt']['workspace_revision'] == w['revision'] + 1
    scope = resume(client, scope)
    current = client.app.state.workspace_store.snapshot(w['id'])
    assert value_at(current['domain'], path) == pytest.approx(.0158)
    studies = call(client, 'study_list', {}, scope['session'], scope['turn']).json()
    assert studies['status'] == 'ok', studies
    proposal = propose(client, scope, 'propose_type_specification', {'audience': 'internal'})
    before = counts(client)
    assert client.get('/api/agent/files/' + proposal['id']).status_code == 404
    exported = decide(client, proposal)
    assert exported['receipt']['kind'] == 'specification', exported
    assert counts(client) == before  # no hidden studies/runs/publication
    file = client.get(exported['receipt']['download_url'])
    assert file.status_code == 200 and file.headers['content-type'] == 'application/pdf'
    assert file.content.startswith(b'%PDF-')
    assert file.headers['x-artifact-sha256'] == exported['receipt']['digest']
    assert decide(client, proposal) == exported
    scope = resume(client, scope)
    customer = call(client, 'propose_type_specification', {'audience': 'customer'}, scope['session'], scope['turn']).json()
    assert customer['status'] == 'error' and customer['diagnostics'][0]['code'] == 'SPECIFICATION_EVIDENCE_REQUIRED'


def test_created_type_is_idempotent_after_lost_receipt_without_silent_scope_change(client, monkeypatch):
    w, _ = study(client)
    scope = open_session(client, w)
    before = counts(client)
    proposal = propose(client, scope, 'propose_type_create', {'name': '待补参数型号', 'origin': 'blank', 'construction': 'single_core'})
    assert counts(client) == before
    real = ExternalActions.complete
    attempts = []
    def interrupted(self, *args):
        attempts.append(1)
        if len(attempts) == 1: raise RuntimeError('simulated lost decision response')
        return real(self, *args)
    monkeypatch.setattr(ExternalActions, 'complete', interrupted)
    with pytest.raises(RuntimeError, match='simulated lost'):
        client.post('/api/agent/proposals/' + proposal['id'] + '/approve')
    assert counts(client)['workspaces'] == before['workspaces'] + 1
    edit = client.post(f'/api/workspaces/{w["id"]}/edit', json={'expected_revision': w['revision'],
                      'changes': [{'path': 'installation.depth_m', 'value': 1.1}]})
    assert edit.status_code == 200
    saved = decide(client, proposal)
    assert saved['receipt']['type_id'] != w['id']
    assert counts(client)['workspaces'] == before['workspaces'] + 1
    assert decide(client, proposal) == saved
    record = client.get('/api/agent/sessions/' + scope['session']).json()
    assert record['workspace_id'] == w['id']
    created = client.get('/api/workspaces/' + saved['receipt']['type_id']).json()
    assert created['domain']['cable_types'][0]['cores'][0]['conductor']['diameter'] is None


def test_scope_and_discovery_budget_and_missing_import_contract(client):
    w, s = study(client)
    other, foreign_study = study(client)
    scope = open_session(client, w)
    before = counts(client)
    result = call(client, 'propose_study_run', {'study_id': foreign_study['id']}, scope['session'], scope['turn']).json()
    assert result['status'] == 'error' and 'proposal' not in result['data']
    result = call(client, 'propose_type_changes', {'type_id': other['id'], 'changes': [], 'reason': '越界'}, scope['session'], scope['turn']).json()
    assert result['status'] == 'error'
    result = call(client, 'propose_study', {'title': '缺少必要输入'}, scope['session'], scope['turn']).json()
    assert result['status'] == 'error' and result['diagnostics'][0]['code'] == 'STUDY_INPUT_REQUIRED'
    assert counts(client) == before
    importer = call(client, 'structure_import_inspect', {'filename': 'manufacturer.csv'}).json()
    assert importer['status'] == 'error' and importer['data']['available'] is False
    assert importer['diagnostics'][0]['code'] == 'STRUCTURE_IMPORT_UNAVAILABLE'
    discovery = str(uuid4())
    client.app.state.harness.tasks.limits = replace(client.app.state.harness.tasks.limits, max_tool_calls=1)
    body = {'tool': 'workspace_list', 'arguments': {}, 'discovery': discovery}
    first = client.post('/api/agent/external/calls', headers=AUTH, json=body)
    assert first.status_code == 200 and first.json()['status'] == 'ok'
    second = client.post('/api/agent/external/calls', headers=AUTH, json=body)
    assert second.status_code == 429 and second.json()['detail']['code'] == 'BUDGET_EXCEEDED'
    with client.app.state.workspace_store.db() as db:
        row = db.execute('SELECT * FROM agent_external_reads WHERE discovery=?', (discovery,)).fetchone()
    assert row['state'] == 'succeeded' and json.loads(row['result']) == first.json()


def test_standard_structure_type_basis_check_and_specification_use_old_services(client):
    w, _ = study(client)
    scope = open_session(client, w)
    initial = counts(client)
    structure = propose(client, scope, 'propose_standard_structure', {'input': {
        'schema_version': 'cablesim.cable-design-request/1', 'construction': 'single_core',
        'voltage': '600/1000', 'conductor': 'copper_bare', 'area_m2': 70e-6, 'form': 'solid_round'}})
    assert counts(client) == initial
    calculated = decide(client, structure)['receipt']
    assert calculated['kind'] == 'structure', calculated
    assert calculated['rows'][0]['value'] == pytest.approx(.0011)
    scope = resume(client, scope)
    creation = propose(client, scope, 'propose_type_create', {'name': '标准结构多步草稿', 'origin': 'standard',
        'proposal_id': calculated['proposal_id'], 'content_sha256': calculated['content_sha256']})
    assert counts(client)['workspaces'] == initial['workspaces']
    created = decide(client, creation)['receipt']
    assert created['kind'] == 'type', created
    target = client.get('/api/workspaces/' + created['type_id']).json()
    scope = open_session(client, target)
    basis = propose(client, scope, 'propose_type_basis', {})
    assert counts(client)['requirement_basis_queries'] == initial['requirement_basis_queries']
    resolved = decide(client, basis)['receipt']
    assert resolved['kind'] == 'basis', resolved
    assert counts(client)['requirement_basis_queries'] == initial['requirement_basis_queries'] + 1
    scope = resume(client, scope)
    methods = call(client, 'method_list').json()['data']['methods']
    method = next(row['method'] for row in methods if row['method']['plugin_id'] == 'cablesim.standard-check')
    check = propose(client, scope, 'propose_study', {'title': '保存标准核对', 'method': {**method, 'capability': 'dimensions'},
        'parameters': {'cable_type_id': target['domain']['cable_types'][0]['id']}, 'basis_request_id': resolved['basis_request_id']})
    saved = decide(client, check)['receipt']
    assert saved['kind'] == 'study', saved
    scope = resume(client, scope)
    execution = propose(client, scope, 'propose_study_run', {'study_id': saved['study_id']})
    checked = decide(client, execution)['receipt']
    assert checked['kind'] == 'run' and checked['status'] == 'succeeded', checked
    scope = resume(client, scope)
    exported = propose(client, scope, 'propose_type_specification', {'audience': 'internal'})
    receipt = decide(client, exported)['receipt']
    assert receipt['kind'] == 'specification', receipt
    assert client.get(receipt['download_url']).content.startswith(b'%PDF-')
    assert client.get('/api/workspaces/' + target['id']).json()['type_lifecycle']['status'] == 'draft'


def test_parallel_proposals_suspend_once_and_never_bypass_review(client):
    w, s = study(client)
    scope = open_session(client, w)
    before = counts(client)
    with ThreadPoolExecutor(max_workers=2) as workers:
        responses = list(workers.map(lambda index: call(client, 'propose_study',
            {'title': '并发请求 ' + str(index), 'source_study_id': s['id']}, scope['session'], scope['turn']), (1, 2)))
    assert sorted(reply.status_code for reply in responses) == [200, 409]
    success = next(reply.json() for reply in responses if reply.status_code == 200)
    assert success['status'] == 'ok'
    assert counts(client) == before
    record = client.get('/api/agent/sessions/' + scope['session']).json()
    assert len(record['proposals']) == 1 and record['proposals'][0]['status'] == 'pending'
