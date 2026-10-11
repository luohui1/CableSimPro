"""Real LangMem with offline ModelPort/HTTP replies; no live model or solver."""
import json
from threading import Event
from types import SimpleNamespace
from time import monotonic, sleep

import pytest

# LangMem is declared in backend/requirements.txt; an environment installed before
# it was added skips these real-SDK tests instead of failing the host suite.
pytest.importorskip('langmem', reason='LangMem 未安装：pip install -r backend/requirements.txt')

from backend.harness.context_builder import encoded, summary
from backend.harness.memory import Memories
from backend.harness.memory_contracts import MemoryFact
from backend.harness.memory_extract import extract
from backend.harness.model_port import ModelReply, ModelError
from test_harness import fake_model, session, send, call, answer, FAKE_KEY
from test_research import client


def enable(client, monkeypatch):
    memory = client.app.state.harness.memories
    # Production owns a single background thread. Tests drain exactly the same
    # persisted queue synchronously so fake foreground/extraction replies cannot race.
    monkeypatch.setattr(memory, 'start', lambda: None)
    response = client.put('/api/agent/memory/settings', json={'enabled': True})
    assert response.status_code == 200, response.text
    assert response.json()['engine'] == 'langmem' and response.json()['available']
    return memory


def sequence(h, tid):
    return next(e['sequence'] for e in reversed(h.tasks.record(tid)['events'])
                if e['type']=='chat.message' and e['data']['role']=='user')


def test_real_langmem_persists_across_sessions_and_human_can_correct_delete(client, fake_model, monkeypatch):
    monkeypatch.setenv('LANGSMITH_TRACING','true')
    monkeypatch.setenv('LANGSMITH_ENDPOINT','http://127.0.0.1:1')
    monkeypatch.setenv('LANGSMITH_API_KEY','test-only-trace-key')
    script, requests = fake_model; h = client.app.state.harness
    w = client.post('/api/workspaces', json={}).json(); tid = session(client, w)
    assert not client.get('/api/agent/memory/settings').json()['enabled']
    script.append(answer('我会先写结论。')); send(client, tid, '请用中文先写结论。')
    assert h.memories.jobs(tid)==[] and len(requests)==1
    memory = enable(client, monkeypatch)
    job = client.post(f'/api/agent/sessions/{tid}/memory').json()['job_id']
    assert client.post(f'/api/agent/sessions/{tid}/memory').json()['job_id']==job
    script.append(call('MemoryFact', {'kind':'preference','topic':'回答方式',
        'content':'用户希望用中文先写结论。','source_sequences':[sequence(h, tid)]}))
    assert memory.process_one()
    jobs = memory.jobs(tid)
    assert jobs[0]['status']=='completed' and jobs[0]['usage']['model_requests']==1
    assert jobs[0]['usage']['prompt_tokens']==10 and len(requests)==2
    card = client.get('/api/agent/memories', params={'workspace_id':w['id']}).json()['items'][0]
    assert card['sources']==[{'task_id':tid,'sequence':sequence(h,tid)}]
    assert card['revision']==1 and card['authority'] is False and card['engineering_evidence'] is False
    # A fresh service instance reads SQLite; no process-only dictionary is involved.
    reopened = Memories(h); reopened.initialize(); h.memories = reopened
    newer = session(client,w)
    script.append(answer('我会先写结论，再核对输入。')); send(client,newer,'接着讨论敷设目标。')
    assert '用户希望用中文先写结论。' in requests[-1]['messages'][0]['content']
    assert h.tasks.record(newer)['budget']['model_requests']==1
    assert len(encoded(summary(h.model_record(newer))['memory']))<=6*1024
    # Exercise LangMem's real update path with existing persisted identities.
    script.append(call('PatchDoc', {'json_doc_id':card['id'],'planned_edits':'明确中文表达偏好。',
        'patches':[{'op':'replace','path':'/content','value':'用户偏好中文说明输入与结论。'},
                   {'op':'replace','path':'/source_sequences','value':[sequence(h,newer)]}]}))
    assert reopened.process_one() and reopened.listing(w['id'])['items'][0]['revision']==2
    other = client.post('/api/workspaces',json={}).json(); foreign = session(client,other)
    assert h.model_record(foreign)['memory']['items']==[]
    url = '/api/agent/memories/'+card['id']
    corrected = client.put(url,json={'expected_revision':2,'content':'回答先写来源，再写结论。'})
    assert corrected.status_code==200 and corrected.json()['revision']==3
    assert client.put(url,json={'expected_revision':2,'content':'不应覆盖人工纠正。'}).status_code==409
    assert client.delete(url,params={'expected_revision':3}).json()['status']=='deleted'
    assert client.get('/api/agent/memories',params={'workspace_id':w['id']}).json()['items']==[]
    with h.tasks.db() as db:
        row=db.execute('SELECT topic,content,sources FROM agent_memories WHERE id=?',(card['id'],)).fetchone()
        assert tuple(row)==('','','[]')
    assert not client.get('/api/workspaces/'+w['id']+'/studies').json()
    assert client.get('/api/workspaces/'+w['id']).json()['revision']==w['revision']


def test_real_langmem_repairs_with_reasoning_and_memory_numbers_are_not_evidence(client,fake_model,monkeypatch):
    memory=enable(client,monkeypatch); h=client.app.state.harness; script,requests=fake_model
    captured=[]
    class Port:
        def reply(self,messages,tools,timeout):
            captured.append((messages,tools,timeout))
            if len(captured)==1:
                return ModelReply('',[{'id':'fact','name':'MemoryFact','arguments':{
                    'kind':'decision','topic':'历史输入意图','content':'','source_sequences':[1]}}],
                    {'prompt_tokens':20,'completion_tokens':8},'tool_calls','保留的私有思考')
            return ModelReply('',[{'id':'patch','name':'PatchFunctionErrors','arguments':{
                'json_doc_id':'fact','planned_edits':'补齐非空content。','patches':[
                    {'op':'replace','path':'/content','value':'历史讨论过999 A，仍须读取真实工具核对。'}]}}],
                {'prompt_tokens':30,'completion_tokens':9},'tool_calls','纠正后的私有思考')
    result,usage=extract(Port(),[{'role':'user','content':'source_sequence=1: 比较敷设。'}],[],Event())
    assert len(result)==1 and result[0].content.kind=='decision' and usage['model_requests']==2
    assert captured[1][0][1]['role']=='user'
    assert next(m for m in captured[1][0] if m['role']=='assistant')['reasoning_content']=='保留的私有思考'
    assert all(0<timeout<=15 for _,_,timeout in captured)
    w=client.post('/api/workspaces',json={}).json(); tid=session(client,w)
    script.append(answer('需要核对输入。'));send(client,tid,'比较敷设目标。')
    seq=sequence(h,tid)
    memory.extractor=lambda *args:([SimpleNamespace(id='suggestion',content=MemoryFact(
        kind='decision',topic='历史输入意图',content='历史讨论过999 A，仍须读取真实工具核对。',source_sequences=[seq]))],usage)
    assert memory.process_one()
    new=session(client,w);script.extend([answer('允许电流999 A。'),answer('需要读取保存运行才能给出允许电流。')])
    send(client,new,'这个工程的允许电流是多少？')
    record=h.tasks.record(new)
    assert record['budget']['model_requests']==2 and record['budget']['tool_calls']==0
    assert any(e['type']=='answer.rejected' and e['data']['issues'][0]['code'].startswith('UNGROUNDED') for e in record['events'])
    assert '历史讨论过999 A' in requests[-1]['messages'][0]['content']
    assert '允许电流999 A。' not in [m['content'] for m in record['messages'] if m['role']=='assistant']
    assert client.post('/api/workspaces/'+w['id']+'/edit',json={'expected_revision':w['revision'],
        'changes':[{'path':'installation.depth_m','value':1.1}]}).status_code==200
    assert memory.listing(w['id'])['items'][0]['status']=='outdated'
    assert memory.recall(h.tasks.record(new,model_context=True))['items']==[]
    assert '私有思考' not in json.dumps(memory.listing(w['id']),ensure_ascii=False)


def test_invalid_batch_and_inflight_job_cannot_undo_human_deletion(client,fake_model,monkeypatch):
    memory=enable(client,monkeypatch);h=client.app.state.harness;script,_=fake_model
    w=client.post('/api/workspaces',json={}).json();tid=session(client,w)
    script.append(answer('先核对输入。'));send(client,tid,'请记住先核对来源。')
    seq=sequence(h,tid)
    fact=lambda refs: MemoryFact(kind='preference',topic='表达',content='先核对来源。',source_sequences=refs)
    def invalid(*args):
        return [SimpleNamespace(id='a',content=fact([seq])),SimpleNamespace(id='b',content=fact([9999999]))],{}
    memory.extractor=invalid;assert memory.process_one()
    assert memory.jobs(tid)[0]['code']=='MEMORY_SOURCE_INVALID' and memory.listing(w['id'])['total']==0
    script.append(answer('先核对来源。'));send(client,tid,'请先核对来源。')
    seq=sequence(h,tid)
    memory.extractor=lambda *args:([SimpleNamespace(id='a',content=fact([seq]))],{})
    assert memory.process_one();card=memory.listing(w['id'])['items'][0]
    script.append(answer('继续核对。'));send(client,tid,'继续，偏好不变。')
    # LangMem carries unchanged memories through. That is not a new revision.
    memory.extractor=lambda port,msgs,old,stop:([SimpleNamespace(id=r['id'],content=MemoryFact.model_validate(r['fact'])) for r in old],{})
    assert memory.process_one() and memory.listing(w['id'])['items'][0]['revision']==1
    script.append(answer('继续核对。'));send(client,tid,'改成先写结论。')
    def racing(port,msgs,old,stop):
        memory.edit(card['id'],expected_revision=1)
        value={**old[0]['fact'],'content':'后台不应恢复的文本。','source_sequences':[sequence(h,tid)]}
        return [SimpleNamespace(id=card['id'],content=MemoryFact.model_validate(value))],{}
    memory.extractor=racing;assert memory.process_one()
    assert memory.jobs(tid)[-1]['code']=='MEMORY_REVISION_CONFLICT' and memory.listing(w['id'])['total']==0
    script.append(answer('输入尚待核对。'));send(client,tid,'继续核对。')
    def failed(*args):raise ModelError('LLM_HTTP_ERROR',FAKE_KEY)
    memory.extractor=failed;assert memory.process_one()
    assert memory.jobs(tid)[-1]['code']=='LLM_HTTP_ERROR'
    assert h.tasks.record(tid)['state']=='completed'
    assert FAKE_KEY not in client.get('/api/agent/sessions/'+tid).text
    assert all(e['type'] not in ('proposal.decision','platform.action.prepared') for e in h.tasks.record(tid)['events'])
    # The owned production worker drains asynchronously and shuts down cleanly.
    script.append(answer('继续核对。'));send(client,tid,'请改成先说明缺项。')
    memory.extractor=lambda *args:([],{})
    monkeypatch.setattr(memory,'start',Memories.start.__get__(memory,Memories))
    memory.start();deadline=monotonic()+5
    while memory.jobs(tid)[-1]['status'] not in ('completed','failed') and monotonic()<deadline:sleep(.05)
    assert memory.jobs(tid)[-1]['status']=='completed'
    memory.close();assert not memory.worker.is_alive()
    # Optional memory failures do not abort a verified foreground answer.
    def corrupt(*args):raise ValueError('不应出现在回答或审计里的私有记忆')
    monkeypatch.setattr(memory,'recall',corrupt)
    monkeypatch.setattr(memory,'enqueue',corrupt)
    script.append(answer('需要核对保存输入。'));send(client,tid,'再核对输入。')
    record=h.tasks.record(tid)
    assert record['state']=='completed' and any(e['type']=='memory.unavailable' for e in record['events'])
    assert '不应出现在回答或审计里的私有记忆' not in client.get('/api/agent/sessions/'+tid).text
    class UnavailablePort:
        def reply(self,*args):raise ModelError('LLM_CONNECTION_FAILED',FAKE_KEY)
    with pytest.raises(ModelError) as failure:extract(UnavailablePort(),[{'role':'user','content':'核对来源。'}],[],Event())
    assert failure.value.memory_usage['model_requests']==1 and not failure.value.memory_usage['usage_complete']
