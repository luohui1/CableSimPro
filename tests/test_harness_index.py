"""Agent object tools share API cards and retain evidence/security boundaries."""
from backend.harness.context_builder import encoded, RESULT_BYTES
from backend.harness.evidence import grounded_text
from fastapi import HTTPException
import pytest
from test_harness import fake_model,session,send,call,answer
from test_harness_recipes import final_text,metrics
from test_research import client,study
from time import perf_counter
import json


def test_object_tools_share_cards_paginate_and_are_audited(client,fake_model,monkeypatch):
    w,s=study(client)
    created=client.post(f'/api/workspaces/{w["id"]}/studies',json={**s['definition'],
        'title':'城北变电站 · 10 kV 三回排管询价','expected_revision':w['revision']})
    assert created.status_code==201,created.text
    s=created.json();tid=session(client,w,s);h=client.app.state.harness
    api=client.get('/api/index/objects',params={'kind':'study','q':s['id']}).json()
    links=client.get(f'/api/index/objects/study/{s["id"]}/relations').json()
    script,requests=fake_model
    dispatch=h.broker.dispatch;observed={}
    def capture(task,args,tool,identity):
        value=dispatch(task,args,tool,identity)
        if tool.name=='object_relations':
            observed['relations']=client.get(f'/api/index/objects/{args["kind"]}/{args["id"]}/relations').json()
        return value
    monkeypatch.setattr(h.broker,'dispatch',capture)
    text='“城北变电站 · 10 kV 三回排管询价”尚未运行；方法引用来自保存配置。独立输入未绑定型号版本，不能推定关联。'
    script.extend([call('object_find',{'kind':'study','q':s['id']}),call('object_relations',{'kind':'study','id':s['id']}),answer(text)])
    started=perf_counter();events=send(client,tid,'查找这个研究及其关联。');elapsed=perf_counter()-started
    record=h.tasks.record(tid)
    assert final_text(events)==text and record['state']=='completed'
    assert record['results'][0]['data']['items']==api['items']
    assert record['results'][1]['data']['uses']==links['uses']
    assert {key:record['results'][1]['data'][key] for key in links}==observed['relations']
    assert record['budget']['tool_calls']==2 and record['budget']['model_requests']==3
    assert all(len(encoded(r))<=RESULT_BYTES for r in record['results'])
    assert all(e['type'] not in ('answer.rejected','answer.fallback') for e in record['events'])
    proof=[];assert grounded_text(text,record['results'],proof=proof)==text
    assert any(match['rule']=='quoted_object_name' for match in proof)
    with pytest.raises(HTTPException):grounded_text(text+'允许电流999 A。',record['results'])
    with pytest.raises(HTTPException):grounded_text('电压10 kV。',record['results'])
    assert len(record['plans'])==2 and len(record['steps'])==2
    assert all(step['tool'] in ('object_find','object_relations') for step in record['steps'])
    # Full catalog spans pages; individual cards are never partially truncated.
    from backend.harness.object_index import read
    expected=h.research.object_index.objects(kind='validation',limit=100)['items'];found=[];offset=0
    for _ in range(100):
        result=read(h.research,'object_find',{'kind':'validation','limit':20,'offset':offset})
        assert result.status=='ok' and len(encoded(result.model_dump(mode='json')))<=RESULT_BYTES
        found+=result.data['items']
        if result.data['next_offset'] is None:break
        assert result.data['next_offset']>offset;offset=result.data['next_offset']
    else:raise AssertionError('pagination did not advance')
    assert found==expected
    print('\n统一索引假模型 '+json.dumps({**metrics(record,elapsed),'answer':text},ensure_ascii=False))
