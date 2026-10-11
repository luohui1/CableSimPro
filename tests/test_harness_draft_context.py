"""Recover and compare candidates without replaying edits or loading private inputs."""
from copy import deepcopy
import json
from time import time
from uuid import uuid4

import pytest
from fastapi import HTTPException

from backend.harness.context_builder import encoded, summary
from backend.harness.drafts import Drafts
from backend.harness.evidence import grounded_text
from test_harness import fake_model, send, call, answer
from test_harness_drafts import setup
from test_research import client


PATH='/sections/section~1s1/placements/cable~1c1-A/z'


def test_long_dialogue_keeps_candidates_and_fake_model_compares_without_reediting(client,fake_model,monkeypatch):
    h,w,task,turn=setup(client);drafts=Drafts(h.broker)
    a=drafts.update(task,{'changes':[{'path':PATH,'value':-.9,'unit':'m'}]}).data['draft_id']
    b=drafts.update(task,{'draft_id':a,'changes':[{'path':PATH,'value':-1.1,'unit':'m'}]}).data['draft_id']
    h.tasks.finish_turn(task['id'],turn,'completed',None)
    # The original IDs need not be in the retained dialogue window.
    h.tasks.emit(task['id'],'chat.message',{'role':'user','content':'早先草稿 '+a,'turn_id':'history'})
    for _ in range(3):h.tasks.emit(task['id'],'chat.message',{'role':'user','content':'历史讨论'*6000,'turn_id':'history'})
    monkeypatch.setattr(h.research.executor,'run',lambda *a,**k:pytest.fail('read/compare started a solver'))
    script,requests=fake_model
    script.extend([call('draft_read',{'view':'catalog'}),
        call('draft_read',{'view':'changes','draft_id':b,'compare_to':a}),
        answer('两个候选的竖向坐标分别为-0.9 m和-1.1 m；这是输入差异，尚未保存或计算。')])
    events=send(client,task['id'],'比较刚才两个候选。')
    record=h.tasks.record(task['id'])
    assert record['budget']['model_requests']==3 and record['budget']['tool_calls']==2
    assert not any(e['type'] in ('answer.rejected','answer.fallback') for e in record['events'])
    assert all(s['result']['status']=='ok' for s in record['steps'])
    context=requests[0]['messages'][0]['content']
    assert a in context and b in context and 'checked_on_use' in context
    observation=next(s['result']['data'] for s in record['steps'] if s['arguments'].get('view')=='changes')
    assert observation['changes']==[{'path':PATH,'label':'竖向坐标','before':-.9,'after':-1.1,'unit':'m'}]
    assert observation['reference']['draft_id']==a and observation['comparison']=='input_only'
    assert client.get('/api/workspaces/'+w['id']+'/domain').json()['revision']==w['revision']
    assert not record['proposals'] and client.get('/api/workspaces/'+w['id']+'/studies').json()==[]


def test_catalog_pages_whole_cards_keeps_invalid_candidates_and_detects_changes(client):
    h,w,task,turn=setup(client);drafts=Drafts(h.broker)
    a=drafts.update(task,{'changes':[{'path':PATH,'value':-.9,'unit':'m'}]}).data['draft_id']
    template=drafts.load(task,a)
    for i in range(20):
        body={**template,'id':str(uuid4()),'expires':time()-1 if i==0 else time()+3600}
        h.tasks.add_plan(task['id'],body)
    first=drafts.read(task,{'view':'catalog','limit':20})
    assert len(encoded(first.model_dump(mode='json')))<=6*1024
    assert len(first.data['items'])<20 and first.data['next_page']
    rows=first.data['items'][:];page=first.data['next_page']
    while page:
        result=drafts.read(task,page);rows+=result.data['items'];page=result.data['next_page']
        assert len(encoded(result.model_dump(mode='json')))<=6*1024
    assert len(rows)==first.data['total']==21
    assert len({r['id'] for r in rows})==21
    assert any(r['status']['code']=='expired' and r['status']['reason'] for r in rows)
    h.tasks.add_plan(task['id'],{**template,'id':str(uuid4())})
    with pytest.raises(HTTPException) as error:drafts.read(task,first.data['next_page'])
    assert error.value.detail['code']=='DRAFT_CATALOG_CHANGED'
    document=client.get('/api/workspaces/'+w['id']+'/domain').json()['document']
    assert drafts.read(task,{}).data['persisted'] is True
    assert drafts.read(task,{'draft_id':a}).data['persisted'] is False
    assert client.put('/api/workspaces/'+w['id']+'/domain',json={'expected_revision':w['revision'],'document':document}).status_code==200
    stale=drafts.read(task,{'view':'catalog'})
    assert all(r['status']['code']=='outdated' and '修订' in r['status']['reason'] for r in stale.data['items'])
    with pytest.raises(HTTPException) as error:drafts.read(task,{'view':'changes','draft_id':a})
    assert error.value.detail['code']=='DRAFT_BASE_CHANGED'
    with pytest.raises(HTTPException) as error:drafts.read(task,{'view':'catalog','draft_id':a})
    assert error.value.detail['path']=='/draft_id'


def test_internal_context_does_not_parse_private_documents_and_history_retains_originals(client,monkeypatch):
    h,w,task,turn=setup(client);drafts=Drafts(h.broker)
    a=drafts.update(task,{'changes':[{'path':PATH,'value':-.9,'unit':'m'}]}).data['draft_id']
    template=drafts.load(task,a);marker='私有输入原件不应进入内部上下文'*15000
    big=deepcopy(template);big['id']=str(uuid4())
    big['document']['provenance']['/name']={'kind':'user','reviewed':False,'reference':marker}
    from backend.kernel.workspace import fingerprint
    big['input_digest']=fingerprint(big['document']);h.tasks.add_plan(task['id'],big)
    h.tasks.add_plan(task['id'],{'kind':'simulation','id':str(uuid4()),'draft_id':a,
        'workspace_revision':w['revision'],'input_digest':template['input_digest'],'expires':time()+3600,
        'definition':{'title':'只读配置名片','method':{},'parameters':{'private_payload':marker}}})
    proposal_id=str(uuid4())
    h.proposals.persist(task,{'id':proposal_id,'kind':'draft_workflow','workspace_revision':w['revision'],
        'document':big['document'],'public':{'id':proposal_id,'title':'保留公开审核差异','changes':[],
        'checks':['等待人审']}})
    loads=json.loads
    def guarded(value,*args,**kwargs):
        assert marker not in value,'internal context parsed a private original'
        return loads(value,*args,**kwargs)
    with monkeypatch.context() as patch:
        patch.setattr('backend.harness.task_store.json.loads',guarded)
        record=h.tasks.record(task['id'],model_context=True)
        assert record['proposals'][0]['title']=='保留公开审核差异'
        assert all(p['body_projected'] for p in record['plans'])
        assert marker not in encoded(summary(record)).decode()
        assert len(summary(record)['drafts']['items'])==3
        catalog=drafts.read(task,{'view':'catalog'})
        assert marker not in encoded(catalog.model_dump(mode='json')).decode()
    original=h.tasks.record(task['id'])
    stored=next(p for p in original['plans'] if p['body'].get('id')==big['id'])
    assert stored['body']['document']['provenance']['/name']['reference']==marker
    assert stored['digest']==fingerprint(stored['body'])
    assert json.loads(''.join(h.tasks.stream_record(task['id'])))==original
    with pytest.raises(HTTPException):grounded_text('最高温度999 K。',[{'data':{'projection':'draft_catalog',
        'items':[{'value':999,'unit':'K'}]}}])
