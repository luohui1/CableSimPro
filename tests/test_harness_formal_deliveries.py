"""Agent human decisions produce T4's exact formal PDFs and recover once."""
import pytest

from backend.harness.external_actions import ExternalActions
from backend.kernel.formal_contracts import public_model
from backend.kernel.formal_deliveries import FormalDeliveries
from backend.kernel.workspace import Edit
from test_harness_external import client, call, open_session
from test_harness_external_actions import DOCUMENT, counts, decide, formal_pdf, propose
from test_research import study, request as execution_request
from test_type_specification_generation import create_example, request as generation_request


def saved_calculation(client):
    workspace, definition = study(client)
    root, body = execution_request(client, workspace, definition)
    executed = client.post(root + '/runs', json=body)
    assert executed.status_code == 200, executed.text
    run = client.app.state.research.get_run(workspace['id'], executed.json()['id'])
    assert run['status'] == 'succeeded' and run['integrity'] == 'verified'
    return workspace, definition, run


def frozen_request(client, proposal):
    tasks = client.app.state.harness.tasks
    with tasks.db() as db:
        _, saved, _ = tasks.proposal(db, proposal['id'])
    return saved['arguments']['formal_request']


def test_formal_calculation_needs_user_metadata_and_uses_the_exact_t4_preview(client, monkeypatch):
    workspace, _, run = saved_calculation(client)
    scope = open_session(client, workspace,
        '导出正式计算书，单位 Agent 正式文件回归单位，文件编号 AGENT-验收-001，版次 A。')
    before = counts(client)
    for document in (None, {'organization': '', 'number': '编号', 'revision': 'A'},
                     {**DOCUMENT, 'signatures': {'approve': '模型编造的人'}}):
        args = {'run_ids': [run['id']], **({'document': document} if document is not None else {})}
        refused = call(client, 'propose_delivery', args, scope['session'], scope['turn']).json()
        assert refused['status'] == 'error' and 'proposal' not in refused['data'], refused
        assert counts(client) == before
    def no_solver(*args, **kwargs):
        pytest.fail('preview/export must never calculate')
    monkeypatch.setattr(client.app.state.research.executor, 'run', no_solver)
    proposal = propose(client, scope, 'propose_delivery', {'run_ids': [run['id']], 'document': DOCUMENT})
    changes = {item['label']: item['after'] for item in proposal['changes']}
    assert all(changes[label] == DOCUMENT[field] for label, field in (
        ('单位名称', 'organization'), ('文件编号', 'number'), ('文件版次', 'revision')))
    assert counts(client) == before
    assert client.get('/api/agent/files/' + proposal['id']).status_code == 404
    request = frozen_request(client, proposal)
    preview = client.post('/api/formal-deliveries/preview', json=request)
    assert preview.status_code == 200, preview.text
    decision = decide(client, proposal)
    receipt = decision['receipt']
    model, _ = formal_pdf(client, receipt)
    assert public_model(model) == preview.json()
    assert model['sources']['run:' + run['id']]['payload']['snapshot'] == run['snapshot']
    assert model['sources']['run:' + run['id']]['payload']['output'] == run['output']
    assert all(signature['name'] is None and signature['evidence_ref'] is None for signature in model['signatures'])
    assert decide(client, proposal) == decision
    assert counts(client) == {**before, 'agent_files': before['agent_files'] + 1}


def test_formal_pdf_lost_decision_recovers_saved_bytes_without_exporting_again(client, monkeypatch):
    workspace, _, run = saved_calculation(client)
    scope = open_session(client, workspace)
    proposal = propose(client, scope, 'propose_delivery', {'run_ids': [run['id']], 'document': DOCUMENT})
    before = counts(client)
    completed = ExternalActions.complete
    rendered = FormalDeliveries.render
    calls = []
    attempts = []
    def render_once(self, *args):
        calls.append(1)
        return rendered(self, *args)
    def lose_first_decision(self, *args):
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError('lost formal PDF decision response')
        return completed(self, *args)
    monkeypatch.setattr(FormalDeliveries, 'render', render_once)
    monkeypatch.setattr(ExternalActions, 'complete', lose_first_decision)
    with pytest.raises(RuntimeError, match='lost formal PDF'):
        client.post('/api/agent/proposals/' + proposal['id'] + '/approve')
    assert counts(client) == {**before, 'agent_files': before['agent_files'] + 1}
    assert len(calls) == 1
    assert client.get('/api/agent/files/' + proposal['id']).status_code == 403
    client.app.state.workspace_store.edit(workspace['id'], Edit(expected_revision=workspace['revision'],
        changes=[{'path': 'installation.depth_m', 'value': 1.1}]))
    recovered = decide(client, proposal, False)
    assert recovered['status'] == 'approved'
    model, _ = formal_pdf(client, recovered['receipt'])
    assert model['source_identity']['revision'] == workspace['revision']
    assert decide(client, proposal) == recovered
    assert len(calls) == 1
    assert counts(client) == {**before, 'agent_files': before['agent_files'] + 1}


def test_formal_source_change_during_render_does_not_save_an_agent_file(client, monkeypatch):
    workspace, _, run = saved_calculation(client)
    scope = open_session(client, workspace)
    proposal = propose(client, scope, 'propose_delivery', {'run_ids': [run['id']], 'document': DOCUMENT})
    before = counts(client)
    rendered = FormalDeliveries.render
    def render_then_edit(self, *args):
        content = rendered(self, *args)
        self.research.store.edit(workspace['id'], Edit(expected_revision=workspace['revision'],
            changes=[{'path': 'installation.depth_m', 'value': 1.1}]))
        return content
    monkeypatch.setattr(FormalDeliveries, 'render', render_then_edit)
    decision = decide(client, proposal)
    assert decision['receipt']['status'] == 'failed' and decision['receipt']['executed'] is False, decision
    assert decision['receipt']['error']['code'] == 'FORMAL_REVISION_CHANGED'
    assert counts(client) == before
    assert client.get('/api/agent/files/' + proposal['id']).status_code == 404
    assert decide(client, proposal) == decision


def test_formal_specification_uses_all_real_saved_channels_and_keeps_draft_signatures_empty(client, monkeypatch):
    workspace = create_example(client)
    response = client.post('/api/types/' + workspace['id'] + '/specification/generate', json=generation_request(workspace))
    assert response.status_code == 200 and response.json()['status'] == 'generated', response.text
    specification = client.app.state.types.specification(workspace['id'], 'internal')
    assert {item['channel'] for item in specification['payload']['sources']} == {
        'geometry', 'electrical', 'rating', 'short_circuit', 'standards'}
    before = counts(client)
    def no_solver(*args, **kwargs):
        pytest.fail('exporting the saved specification must not create runs')
    monkeypatch.setattr(client.app.state.research.executor, 'run', no_solver)
    scope = open_session(client, workspace,
        '导出正式规格书，单位 Agent 正式文件回归单位，文件编号 AGENT-规格-001，版次 A；保留真实草稿和签核状态。')
    document = {**DOCUMENT, 'number': 'AGENT-规格-001'}
    proposal = propose(client, scope, 'propose_type_specification', {'audience': 'internal', 'document': document})
    assert counts(client) == before
    request = frozen_request(client, proposal)
    preview = client.post('/api/formal-deliveries/preview', json=request)
    assert preview.status_code == 200, preview.text
    decision = decide(client, proposal)
    assert decision['receipt']['kind'] == 'specification', decision
    model, _ = formal_pdf(client, decision['receipt'])
    assert public_model(model) == preview.json()
    assert model['kind'] == 'specification' and model['state']['status'] == 'draft'
    assert model['sources']['specification:' + workspace['id']]['payload']['payload'] == specification['payload']
    assert all(signature['name'] is None and signature['evidence_ref'] is None for signature in model['signatures'])
    assert decision['receipt']['source']['type_id'] == workspace['id']
    assert counts(client) == {**before, 'agent_files': before['agent_files'] + 1}
    assert decide(client, proposal) == decision
