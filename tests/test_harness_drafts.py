"""Draft -> geometry -> analysis configuration -> human save, with no solver jobs."""
from copy import deepcopy
from hashlib import sha256
import json
from time import perf_counter

import pytest
from fastapi import HTTPException

from backend.harness.context_builder import compress_result, encoded
from backend.harness.drafts import Drafts
from backend.harness.evidence import grounded_text
from backend.plugin_host import PluginHostError
from test_harness import fake_model, session, send, call, answer
from test_research import client


def setup(client):
    workspace = client.post('/api/workspaces', json={}).json()
    converted = client.post('/api/workspaces/'+workspace['id']+'/domain/conversion',
        json={'expected_revision': workspace['revision']})
    assert converted.status_code == 200, converted.text
    workspace['revision'] = converted.json()['revision']
    h = client.app.state.harness
    tid = session(client, workspace)
    turn = h.begin(tid, '检查草稿操作。')
    with h.tasks.db() as db:
        task = h.tasks.load(db, tid)
    return h, workspace, task, turn


def method(h, plugin_id, capability):
    return next(tool.method for tool in h.registry.tools().values()
        if tool.method and tool.method['plugin_id'] == plugin_id and tool.method['capability'] == capability)


def test_layout_drafts_use_ordinary_template_hand_positions_and_revision_guards(client):
    h, w, task, turn = setup(client); drafts = Drafts(h.broker)
    before = client.get('/api/workspaces/'+w['id']+'/domain').json()
    template = {'kind': 'flat', 'depth': .9, 'spacing': .1, 'unit': 'm'}
    updated = drafts.update(task, {'template': template})
    identifier = updated.data['draft_id']
    document = drafts.load(task, identifier)['document']
    # Hand layout: three cable centres at -s,0,+s, all at the stated depth.
    assert [(p['x'], p['z']) for p in document['sections'][0]['placements']] == [(-.1, -.9), (0., -.9), (.1, -.9)]
    assert not updated.data['persisted'] and not client.get('/api/index/inbox').json()['counts']['review']
    assert client.get('/api/workspaces/'+w['id']+'/domain').json() == before
    with pytest.raises(HTTPException) as error:
        drafts.update(task, {'template': {**template, 'unit': 'mm'}})
    assert error.value.detail['path'] == '/template/unit'
    public = drafts.propose(task, {'draft_id': identifier, 'title': '平排敷设草稿'}).data['proposal']
    assert public['changes'] and client.get('/api/index/inbox').json()['counts']['review'] == 1
    # An external save invalidates both further use and approval of this draft.
    saved = client.put('/api/workspaces/'+w['id']+'/domain', json={
        'expected_revision': w['revision'], 'document': before['document']})
    assert saved.status_code == 200
    with pytest.raises(HTTPException) as error:
        drafts.read(task, {'draft_id': identifier})
    assert error.value.detail['code'] == 'DRAFT_BASE_CHANGED'
    h.tasks.finish_turn(task['id'], turn, 'reviewing', 'human_review')
    assert client.post('/api/agent/proposals/'+public['id']+'/approve').status_code == 409


def test_fake_model_connects_draft_geometry_and_study_then_human_saves_atomically(client, fake_model, monkeypatch):
    h, w, task, turn = setup(client)
    h.tasks.finish_turn(task['id'], turn, 'completed', None)
    draft_id, plan_id, proposal_id = ('00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003')
    identifiers = iter([draft_id, plan_id, proposal_id])
    monkeypatch.setattr('backend.harness.drafts.uuid4', lambda: next(identifiers))
    geometry = method(h, 'cablesim.cable-geometry', 'concentric-model')
    analysis = method(h, 'cablesim.iec60287', 'steady-rating')
    document = client.get('/api/workspaces/'+w['id']+'/domain').json()['document']
    cable_type = document['cable_types'][0]['id']
    path = '/sections/section~1s1/placements/cable~1c1-A/z'
    observed = []
    # This fixture tests wiring/identity, never pretends to test native CAD accuracy.
    def preview(wid, body):
        value = body.document.model_dump(mode='json')
        digest = sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()
        plugin, capability = h.research.resolve(body.method.model_dump(mode='json'))
        wire = {'protocol':'cablesim.run/2','phase':'run','run_id':'fixture-geometry-run',
            'capability':capability.id,'input_schema':capability.input_schema,
            'cases':[{'case_id':'preview','input':value,'parameters':body.parameters}],
            'limits':{'timeout_s':plugin.manifest.resources.timeout_s,'memory_mb':plugin.manifest.resources.memory_mb}}
        request_sha = sha256(json.dumps(wire,sort_keys=True,ensure_ascii=False,allow_nan=False).encode()).hexdigest()
        observed.append(value)
        return {'effect': 'preview', 'base_revision': body.expected_revision,
            'method': {k: v for k, v in geometry.items() if k != 'capability'},
            'input_sha256': digest, 'request_sha256': request_sha,
            'artifacts': {'x-cablesim.cad-model': {'input_sha256': digest,
                'outer_diameter_m': .05, 'display_mesh': {'positions': [0.]*30000}}}, 'warnings': []}
    monkeypatch.setattr(client.app.state.previews, 'preview', preview)
    def forbidden(*args, **kwargs):
        raise AssertionError('draft workflow cannot run plugins or submit a job')
    monkeypatch.setattr(h.research.executor, 'run', forbidden)
    from backend.kernel.scenarios import METHOD_DEFAULTS
    parameters = deepcopy(METHOD_DEFAULTS['cablesim.iec60287'])
    parameters['solver'].pop('initial_sheath_temperature_c')
    parameters['solver']['initial_sheath_temperature_k'] = 343.15
    parameters['duct'] = {'u': 1.87, 'v_per_m': 31.2, 'y_per_m_k': .37, 'initial_mean_air_temperature_k': 313.15}
    script, requests = fake_model
    script.extend([
        call('draft_update', {'changes': [{'path': path, 'value': -.9, 'unit': 'm'}]}),
        call('draft_geometry', {'draft_id': draft_id, 'method': geometry, 'parameters': {'cable_type_id': cable_type}}),
        call('simulation_prepare', {'draft_id': draft_id, 'method': analysis, 'parameters': parameters, 'title': '草稿分析'}),
        call('draft_propose', {'draft_id': draft_id, 'simulation_plan_id': plan_id, 'title': '敷设与分析配置'}),
        answer('草稿已完成几何检查并生成审核方案。尚未保存工程或提交仿真；请审阅输入差异，批准后在研究工作台预检并核对预算。')])
    started = perf_counter(); send(client, task['id'], '修改埋深，检查几何并准备分析研究。')
    record = h.tasks.record(task['id'])
    assert record['budget']['model_requests'] == 5 and record['budget']['tool_calls'] == 4, json.dumps({
        'state': record['state'], 'events': [e for e in record['events'] if e['type'] in ('error', 'harness.error', 'turn.answer_only', 'model.request', 'answer.rejected')],
        'steps': [(s['tool'], s['result']['status'], s['result']['diagnostics']) for s in record['steps']]}, ensure_ascii=False)
    assert not any(e['type'] in ('answer.rejected', 'answer.fallback') for e in record['events'])
    assert len(observed) == 1 and observed[0]['sections'][0]['placements'][0]['z'] == -.9
    assert client.get('/api/workspaces/'+w['id']+'/studies').json() == []
    assert client.get('/api/workspaces/'+w['id']+'/domain').json()['revision'] == w['revision']
    result = next(s['result'] for s in record['steps'] if s['tool'] == 'draft_geometry')
    assert len(encoded(compress_result(result))) <= 6*1024
    assert 'display_mesh' not in encoded(compress_result(result)).decode()
    assert 'display_mesh' not in encoded(result).decode()
    source=result['data']['evidence']['source']
    assert source['request_sha256'] != source['host_request_digest']
    assert not record['proposals'][0]['status'] == 'approved'
    save = h.research.save
    def reject_save(*args, **kwargs):
        raise HTTPException(409, 'study save conflict')
    monkeypatch.setattr(h.research, 'save', reject_save)
    assert client.post('/api/agent/proposals/'+proposal_id+'/approve').status_code == 409
    assert client.get('/api/workspaces/'+w['id']+'/domain').json()['revision'] == w['revision']
    assert client.get('/api/agent/sessions/'+task['id']).json()['proposals'][0]['status'] == 'pending'
    monkeypatch.setattr(h.research, 'save', save)
    approved = client.post('/api/agent/proposals/'+proposal_id+'/approve')
    assert approved.status_code == 200, approved.text
    saved = client.get('/api/workspaces/'+w['id']+'/domain').json()
    assert saved['revision'] == w['revision']+1 and saved['document']['sections'][0]['placements'][0]['z'] == -.9
    studies = client.get('/api/workspaces/'+w['id']+'/studies').json()
    assert len(studies) == 1 and studies[0]['definition']['input_source'] == 'domain'
    assert studies[0]['definition']['parameters'] == parameters
    assert client.post('/api/agent/proposals/'+proposal_id+'/approve').status_code == 200
    assert len(client.get('/api/workspaces/'+w['id']+'/studies').json()) == 1
    with h.tasks.db() as db:
        assert db.execute('SELECT COUNT(*) FROM study_runs').fetchone()[0] == 0
    print({'model_requests': len(requests), 'tool_calls': record['budget']['tool_calls'], 'elapsed_s': perf_counter()-started})


def test_drafts_reject_cross_session_stale_analysis_locked_inputs_and_false_geometry(client, monkeypatch):
    h, w, task, turn = setup(client); drafts = Drafts(h.broker)
    path = '/sections/section~1s1/placements/cable~1c1-A/z'
    updated = drafts.update(task, {'changes': [{'path': path, 'value': -.9, 'unit': 'm'}]})
    identifier = updated.data['draft_id']
    other = session(client, w)
    with h.tasks.db() as db: other_task = h.tasks.load(db, other)
    with pytest.raises(HTTPException) as error: drafts.read(other_task, {'draft_id': identifier})
    assert error.value.detail['code'] == 'DRAFT_NOT_FOUND'
    baseline = drafts.base(task)
    monkeypatch.setattr(drafts, 'base', lambda t: {**baseline, 'locks': ['installation.depth_m']})
    with pytest.raises(HTTPException): drafts.update(task, {'changes': [{'path': path, 'value': -1., 'unit': 'm'}]})
    monkeypatch.setattr(drafts, 'base', lambda t: baseline)
    geometry = method(h, 'cablesim.cable-geometry', 'concentric-model')
    with pytest.raises(PluginHostError) as error: drafts.geometry(task, {'draft_id': identifier,
        'method': geometry, 'parameters': {'cable_type_id': baseline['domain']['cable_types'][0]['id'], 'include_exact': 'invalid'}})
    assert error.value.path == '/parameters/include_exact'
    monkeypatch.setattr(client.app.state.previews, 'preview', lambda *a: {
        'effect': 'preview', 'base_revision': w['revision'], 'input_sha256': '0'*64})
    with pytest.raises(HTTPException) as error: drafts.geometry(task, {'draft_id': identifier,
        'method': geometry, 'parameters': {'cable_type_id': baseline['domain']['cable_types'][0]['id']}})
    assert error.value.detail['code'] == 'GEOMETRY_IDENTITY_CHANGED'
    def wrong_method(wid,body):
        value=body.document.model_dump(mode='json')
        return {'effect':'preview','base_revision':w['revision'],
            'input_sha256':sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,allow_nan=False).encode()).hexdigest(),
            'method':{**{k:v for k,v in geometry.items() if k!='capability'},'version':'wrong-version'}}
    monkeypatch.setattr(client.app.state.previews,'preview',wrong_method)
    with pytest.raises(HTTPException) as error:drafts.geometry(task,{'draft_id':identifier,
        'method':geometry,'parameters':{'cable_type_id':baseline['domain']['cable_types'][0]['id']}})
    assert error.value.detail['code']=='GEOMETRY_IDENTITY_CHANGED' and '方法版本' in error.value.detail['message']
    monkeypatch.setattr(h.research.executor, 'required', lambda *a: True, raising=False)
    with pytest.raises(HTTPException) as error: drafts.geometry(task, {'draft_id': identifier,
        'method': geometry, 'parameters': {'cable_type_id': baseline['domain']['cable_types'][0]['id']}})
    assert error.value.detail['code'] == 'HUMAN_EXECUTION_REQUIRED'
    with pytest.raises(HTTPException): grounded_text('最高温度999 K。', [{'data': {
        'projection': 'capability_request', 'parameters': {'value': 999, 'unit': 'K'}}}])
    with pytest.raises(HTTPException): grounded_text('最高温度999 K。', [{'data': {
        'projection': 'draft_geometry', 'response': {'value': 999, 'unit': 'K'}, 'evidence': {}}}])
    # New input invalidates an earlier prepared configuration without making a study.
    from backend.kernel.scenarios import METHOD_DEFAULTS
    analysis = method(h, 'cablesim.iec60287', 'steady-rating')
    plan = drafts.simulation(task, {'draft_id': identifier, 'method': analysis,
        'parameters': deepcopy(METHOD_DEFAULTS['cablesim.iec60287']), 'title': '待核对分析'}).data
    next_draft = drafts.update(task, {'draft_id': identifier, 'changes': [{'path': path, 'value': -1., 'unit': 'm'}]}).data
    with pytest.raises(HTTPException) as error: drafts.propose(task, {'draft_id': next_draft['draft_id'],
        'simulation_plan_id': plan['simulation_plan_id'], 'title': '错误绑定'})
    assert error.value.detail['code'] == 'SIMULATION_DRAFT_MISMATCH'
    h.tasks.finish_turn(task['id'], turn, 'completed', None)
