"""Shared inbox evidence, deterministic triage and authority through fake SSE."""
from contextlib import contextmanager
from copy import deepcopy
import json
import sqlite3
from time import perf_counter
from uuid import uuid4

import pytest
from backend.harness.context_builder import encoded,RESULT_BYTES
from backend.harness.inbox import read,MAX_TRIAGE_PAGES
from backend.harness.recipe_compiler import compile_calls
from backend.kernel.workspace import fingerprint,stamp
from test_research import client,study
from test_harness import fake_model,session,send,call,answer
from test_harness_recipes import final_text,metrics


def seed(client):
    w,s=study(client);h=client.app.state.harness;tid=session(client,w,s)
    h.proposals.parameters(h.tasks.record(tid),s['id'],None,[{'path':'/parameters/ks','value':.8,'unit':'1'}],'待核对参数方案')
    did,cid,pid,aid,submission,run,active=(str(uuid4()) for _ in range(7))
    draft={'name':'三芯型号资料','version':'1.0.0','specification':{'missing':['三芯成缆位置与节距']}}
    now=stamp()
    with h.research.store.db(True) as db:
        db.execute('INSERT INTO source_documents VALUES(?,?,?,?,?,?)',(did,'厂家结构原件','a'*64,b'not read','{}',now))
        db.execute('INSERT INTO domain_cable_models VALUES(?,?,?,?,?)',(cid,json.dumps(draft),fingerprint(draft),'incomplete',now))
        db.execute('INSERT INTO document_proposals VALUES(?,?,?,?,?,?,?)',
            (pid,did,json.dumps({'draft':draft}),'b'*64,'proposed',None,None))
        db.execute('INSERT INTO engineering_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            (aid,'test.triage-material','1.0.0','material','待审核材料','draft',1,'{}','c'*64,None,now,now))
        payload={'name':'型号规格书','revision':w['revision'],'sources':[]}
        db.execute('INSERT INTO type_submissions(id,workspace,payload,digest,status,created) VALUES(?,?,?,?,?,?)',
            (submission,w['id'],json.dumps(payload),fingerprint(payload),'submitted',now))
        snapshot={'workspace_revision':w['revision'],'study_revision':s['revision'],
            'definition':deepcopy(s['definition']),'cases':[],'workspace_state':{}}
        # Saved identity fixtures exercise the host's method-currentness rule;
        # they contain no engineering quantities or computed results.
        snapshot['definition']['method']['version']='0.0.0'
        columns='id,workspace,study,sequence,status,created,finished,input_digest,output_digest,snapshot,output,error,request_id,request_digest,owner_epoch,execution_nonce'
        db.execute('INSERT INTO study_runs('+columns+') VALUES('+','.join('?' for _ in range(16))+')',
            (run,w['id'],s['id'],1,'succeeded',now,now,fingerprint(snapshot),fingerprint({}),json.dumps(snapshot),'{}',None,str(uuid4()),'fixture',h.research.owner_epoch,str(uuid4())))
        second=str(uuid4());definition=deepcopy(s['definition']);definition['title']='进行中的研究'
        db.execute('INSERT INTO studies VALUES(?,?,?)',(second,w['id'],1))
        db.execute('INSERT INTO study_versions(study,revision,definition,created) VALUES(?,?,?,?)',(second,1,json.dumps(definition),now))
        snapshot['definition']=definition
        db.execute('INSERT INTO study_runs('+columns+') VALUES('+','.join('?' for _ in range(16))+')',
            (active,w['id'],second,2,'accepted',now,None,fingerprint(snapshot),None,json.dumps(snapshot),None,None,str(uuid4()),'fixture',h.research.owner_epoch,str(uuid4())))
    return w,s


def business_state(store):
    with store.db() as db:
        tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            if not r[0].startswith(('agent_','sqlite_'))]
        return {table:[tuple(row) for row in db.execute('SELECT * FROM "'+table.replace('"','""')+'"')] for table in tables}


def forbid_writes(client,monkeypatch):
    store=client.app.state.workspace_store;original=store.db
    @contextmanager
    def guarded(*args,**kwargs):
        with original(*args,**kwargs) as db:
            def authorize(action,table,*unused):
                if action in (sqlite3.SQLITE_INSERT,sqlite3.SQLITE_UPDATE,sqlite3.SQLITE_DELETE) and not (table or '').startswith('agent_'):
                    pytest.fail('triage wrote business table '+str(table))
                return sqlite3.SQLITE_OK
            db.set_authorizer(authorize)
            yield db
    monkeypatch.setattr(store,'db',guarded)
    monkeypatch.setattr(client.app.state.research.executor,'run',lambda *a,**k:pytest.fail('triage invoked solver'))


def test_inbox_triage_has_exact_reasons_actions_cards_and_no_business_writes(client,fake_model,monkeypatch):
    w,s=seed(client);h=client.app.state.harness
    anchor=client.post('/api/workspaces',json={}).json();tid=session(client,anchor)
    assert 'inbox_triage' in {row['id'] for row in client.get('/api/agent/recipes',params={'session_id':tid}).json()}
    expected=client.get('/api/index/inbox').json()
    assert expected['counts']=={'review':4,'stale':1,'missing':1,'running':1}
    before=business_state(h.research.store);forbid_writes(client,monkeypatch)
    script,requests=fake_model
    response=answer('先由人核对待审核项，再处理过期研究和资料缺项；正在进行的任务只查看原记录，避免重复提交。')
    response['choices'][0]['message']['reasoning_content']='按人工审核、缺项、运行进度安排。'
    script.append(response)
    started=perf_counter();events=send(client,tid,'帮我理一下待办',{'id':'inbox_triage','parameters':{'limit':2}})
    elapsed=perf_counter()-started;record=h.tasks.record(tid);text=final_text(events)
    assert 1==len(requests)==record['budget']['model_requests']<=2
    assert all(not request.get('tools') for request in requests)
    assert all(step['tool']=='inbox_read' and step['state']=='succeeded' for step in record['steps'])
    assert record['budget']['tool_calls']<=MAX_TRIAGE_PAGES and len(record['steps'])==4
    assert business_state(h.research.store)==before and not record['proposals']
    for item in expected['items']:
        assert '“'+item['object']['name']+'”' in text and '原因：'+item['reason'] in text
    assert text.count('下一步：')==7 and text.count('处理人：')==7
    assert '三芯成缆位置与节距' in text and '需人批准' in text and '当前安装方法' in text
    data=[item for step in record['steps'] for item in step['result']['data']['items']]
    assert len(data)==7 and all(item['home']['id'] and item['next_step'] and item['handled_by'] for item in data)
    assert {item['object']['id'] for item in data}=={item['object']['id'] for item in expected['items']}
    assert all(len(encoded(step['result']))<=RESULT_BYTES for step in record['steps'])
    refs=record['messages'][-1]['object_refs'];keys=[(r['kind'],r['id']) for r in refs]
    assert len(keys)==len(set(keys)) and {('proposal',i['object']['id']) for i in expected['items'] if i['object']['kind']=='proposal'}<=set(keys)
    assert [text.index('“'+r['name']+'”') for r in refs]==sorted(text.index('“'+r['name']+'”') for r in refs)
    assert any(e['type']=='inbox.triaged' and e['data']['complete'] and e['data']['category'] is None for e in record['events'])
    assert not any(e['type'] in ('answer.rejected','answer.fallback') for e in record['events'])
    assert record['messages'][-1]['reasoning_content']==response['choices'][0]['message']['reasoning_content']
    print('\n待办整理 '+json.dumps(metrics(record,elapsed),ensure_ascii=False))


def test_inbox_pages_share_the_api_and_change_or_oversize_never_claim_complete(client,monkeypatch):
    w,s=seed(client);research=client.app.state.research;h=client.app.state.harness
    page=read(research,{'category':'review','limit':1});data=page.data
    assert data['total']==4 and data['counts']==client.get('/api/index/inbox').json()['counts']
    api=client.get('/api/index/inbox').json()
    observed=data['items'][0]
    assert {key:observed[key] for key in api['items'][0]}==next(item for item in api['items'] if item['object']['id']==observed['object']['id'])
    cursor=data['next_page'];assert cursor['offset']==1 and cursor['category']=='review'
    proposal=next(i for i in api['items'] if i['origin']=='agent')['object']['id']
    assert client.post('/api/agent/proposals/'+proposal+'/reject').status_code==200
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as error:read(research,cursor)
    assert error.value.detail['code']=='INBOX_CHANGED' and error.value.detail['path']=='/expected_digest'
    assert read(research,{'category':'review'}).data['total']==3
    with research.store.db(True) as db:
        db.execute("UPDATE type_submissions SET status='approved' WHERE workspace=?",(w['id'],))
        db.execute("UPDATE engineering_assets SET status='reviewed' WHERE asset_id='test.triage-material'")
    approved=read(research,{'category':'review'}).data['items']
    for item in approved:
        if item['origin'] in ('type','asset'):
            assert not item['requires_human_approval'] and item['handled_by']=='人工发布人'
            assert '发布' in item['next_step']
    with research.store.db(True) as db:
        missing=next(i['object']['id'] for i in api['items'] if i['category']=='missing')
        payload={'name':'原因超限的型号','version':'1.0.0','specification':{'missing':['待核对来源'*4000]}}
        db.execute('UPDATE domain_cable_models SET payload=?,digest=? WHERE id=?',(json.dumps(payload),fingerprint(payload),missing))
    large=read(research,{'category':'missing'})
    assert large.status=='error' and large.diagnostics[0].code=='INBOX_ITEM_TOO_LARGE'
    assert not large.data['items'] and len(encoded(large.model_dump(mode='json')))<=RESULT_BYTES
    tid=session(client,w);record=h.tasks.record(tid)
    with h.tasks.db() as db:task=h.tasks.load(db,tid)
    tool=h.registry.visible(record)['inbox_read']
    for arguments in ({'limit':0},{'offset':-1},{'category':'approve'}):
        node=compile_calls([{'id':'bad','name':'inbox_read','arguments':arguments}],{tool.name:tool},w['id'],w['revision'])['nodes'][0]
        assert h.broker.execute(task,node,tool).diagnostics[0].code=='TOOL_ARGUMENTS_INVALID'


def test_free_triage_auto_recipe_stops_write_intents_and_exposes_remaining_page(client,fake_model,monkeypatch):
    w,s=seed(client);h=client.app.state.harness;tid=session(client,w)
    before=business_state(h.research.store);forbid_writes(client,monkeypatch)
    script,requests=fake_model
    script.extend([call('study_preview'),answer('待办整理只提供人工下一步；运行与审核尚未执行。')])
    started=perf_counter();events=send(client,tid,'帮我理一下待办');elapsed=perf_counter()-started;record=h.tasks.record(tid)
    assert record['budget']['model_requests']==2 and not any(request.get('tools') for request in requests)
    assert all(step['tool']=='inbox_read' for step in record['steps']) and not record['proposals']
    assert business_state(h.research.store)==before
    assert any(k=='error' and d['code']=='TOOLS_NOT_ALLOWED' for k,d in events)
    assert any(e['type']=='recipe.requested' and e['data']['source']=='host.intent' for e in record['events'])
    first_metrics=metrics(record,elapsed)
    # A caller can explicitly continue at a bounded offset; do not describe
    # unobserved earlier items as checked or processed.
    tid=session(client,w);script.append(answer('这次只说明选定范围内的待办，其他条目尚未展开。'))
    events=send(client,tid,recipe={'id':'inbox_triage','parameters':{'offset':2,'limit':1}})
    record=h.tasks.record(tid)
    assert any(e['type']=='recipe.pagination_stopped' and e['data']['reason']=='page_limit' for e in record['events'])
    assert '其余待办尚未展开' in final_text(events)
    assert any(e['type']=='inbox.triaged' and not e['data']['complete'] for e in record['events'])
    script.append(answer('可以继续核对当前工程；本条请求未执行运行或批准。'))
    events=send(client,tid,'说明当前工程')
    assert '统一待办处理清单' not in final_text(events)
    assert '请简短解释处理顺序及尚未展开的范围' not in requests[-1]['messages'][0]['content']
    assert business_state(h.research.store)==before
    script.extend([call('recipe_execute',{'recipe':'inbox_triage','parameters':{'category':'review','limit':1}}),
        answer('先由人工核对待审核项，本次其余条目尚未展开。')])
    events=send(client,tid,'先看审核队列')
    record=h.tasks.record(tid)
    assert record['budget']['model_requests']==2 and not requests[-1].get('tools')
    assert record['budget']['tool_calls']==1 and '其余待办尚未展开' in final_text(events)
    assert business_state(h.research.store)==before
    script.append({'http_status':500})
    events=send(client,tid,'帮我理一下待办',{'id':'inbox_triage','parameters':{'category':'review'}})
    record=h.tasks.record(tid)
    assert '模型解释暂不可用' in final_text(events) and '原因：' in final_text(events) and '下一步：' in final_text(events)
    assert record['budget']['model_requests']==1 and record['messages'][-1]['object_refs']
    assert business_state(h.research.store)==before
    print('\n待办写意图被拒绝 '+json.dumps(first_metrics,ensure_ascii=False))
