"""Type-bound default context, host review recipe and tool authority regression."""
import json
from test_index_reproductions import library
from time import perf_counter
from uuid import uuid4

import pytest
from fastapi import HTTPException
from backend.domain.guards import pointer
from backend.harness.session_scope import TYPE_TOOLS
from backend.harness.recipe_compiler import compile_calls
from test_type_versions import client,workspace
from test_harness_types import design
from test_harness import fake_model,session,send,call,answer
from test_harness_recipes import metrics,final_text


def test_type_session_catalog_context_host_review_and_default_type_proposal(client,fake_model,monkeypatch):
    script,requests=fake_model;w,path=design(client);h=client.app.state.harness;tid=session(client,w)
    monkeypatch.setattr(h.research.executor,'run',lambda *a,**k:pytest.fail('type session invoked solver'))
    record=client.get('/api/agent/sessions/'+tid).json()
    assert record['context']=={'kind':'type','id':w['id'],'default_proposal_kind':'type','default_recipe':'type_review'}
    for params in ({'session_id':tid},{'workspace_id':w['id']}):
        rows=client.get('/api/agent/recipes',params=params).json()
        assert [r['id'] for r in rows]==['type_review','inbox_triage']
        assert rows[0]['parameters']['required']==[] and rows[0]['parameters']['properties']['type_id']['const']==w['id']
        assert {t['name'] for t in client.get('/api/agent/tools',params=params).json()}==TYPE_TOOLS
    rejected=client.post('/api/agent/sessions/'+tid+'/messages',json={'content':'检查',
        'recipe':{'id':'missing_inputs','parameters':{}}})
    assert rejected.status_code==422 and rejected.json()['detail']['code']=='RECIPE_NOT_APPLICABLE'
    text=f'“{w["domain"]["name"]}”的标准核对尚无保存运行，不能判断符合性；请在型号工作台补齐标准与来源，再人工运行核对。'
    response=answer(text);response['choices'][0]['message']['reasoning_content']='只解释宿主型号检查。';script.append(response)
    start=perf_counter();events=send(client,tid,'检查这个型号的问题');elapsed=perf_counter()-start
    record=h.tasks.record(tid)
    assert len(requests)==1 and not requests[0].get('tools') and final_text(events)==text
    assert record['messages'][-1]['object_refs'][0]['id']==w['id']
    assert record['messages'][-1]['reasoning_content']=='只解释宿主型号检查。'
    assert all(step['tool']=='type_read' and step['state']=='succeeded' for step in record['steps'])
    assert any(e['type']=='recipe.compiled' and e['data']['recipes']==['type_review'] for e in record['events'])
    print('\n型号绑定检查 '+json.dumps(metrics(record,elapsed),ensure_ascii=False))
    tid=session(client,w)
    script.extend([call('propose_type_changes',{'changes':[{'path':path,'value':15.8,'unit':'mm'}],'reason':'明确型号字段修改'}),
        answer(f'“{w["domain"]["name"]}”的方案中拟将绝缘厚度从 16.2 mm 改为 15.8 mm；定量影响需人工保存后重新核验。')])
    start=perf_counter();send(client,tid,'把绝缘厚度改成 15.8 mm');elapsed=perf_counter()-start;record=h.tasks.record(tid)
    assert record['steps'][0]['tool']=='type_read' and record['steps'][0]['result']['data']['view']=='summary'
    assert record['proposals'][0]['kind']=='type' and record['proposals'][0]['type_id']==w['id']
    assert record['budget']['model_requests']==2 and record['budget']['tool_calls']==2
    assert all({t['function']['name'] for t in request.get('tools',[])}<=TYPE_TOOLS for request in requests)
    assert any(m['role']=='tool' and json.loads(m['content']).get('data',{}).get('type_id')==w['id'] for m in requests[-2]['messages'])
    assert not any(e['type'] in ('answer.rejected','answer.fallback') for e in record['events'])
    print('\n型号默认方案 '+json.dumps(metrics(record,elapsed),ensure_ascii=False))
    # Hidden research calls are also rejected at the durable broker boundary.
    with h.tasks.db() as db:task=h.tasks.load(db,tid)
    other=workspace(client);visible=h.registry.visible(record)
    node=compile_calls([{'id':'other-type-read','name':'type_read','arguments':{'type_id':other['id']}}],
        visible,w['id'],w['revision'])['nodes'][0]
    assert h.broker.execute(task,node,visible['type_read']).status=='ok'
    assert visible['propose_type_changes'].parameters['properties']['type_id']['const']==w['id']
    tool=h.registry.tools()['run_read'];node=compile_calls([{'id':'forbidden','name':'run_read','arguments':{'run_id':str(uuid4())}}],
        {tool.name:tool},w['id'],w['revision'])['nodes'][0]
    result=h.broker.execute(task,node,tool)
    assert result.diagnostics[0].code=='TYPE_TOOL_NOT_APPLICABLE'
    # New blank origins have no type_origin_reference; missing values stay missing.
    blank=client.post('/api/types',json={'origin':'blank','name':'空白型号会话','construction':'single_core','request_id':str(uuid4())})
    assert blank.status_code==201,blank.text
    bid=session(client,blank.json());script.append(answer('“空白型号会话”存在输入缺项，应在型号工作台补齐；尚无标准核对证据。'))
    send(client,bid,'检查这个型号的问题');record=h.tasks.record(bid)
    assert record['context']['kind']=='type' and record['budget']['model_requests']==1
    assert any(i['section']=='checks' and i.get('path') for step in record['steps'] for i in step['result']['data']['items'])
    assert record['messages'][-1]['object_refs'][0]['id']==blank.json()['id']
    cable=blank.json()['domain']['cable_types'][0]
    incomplete_path=pointer('cable_types',cable['id'],'cores',cable['cores'][0]['id'],'conductor','diameter')
    with pytest.raises(HTTPException) as error:
        h.proposals.type_changes(record,blank.json()['id'],[{'path':incomplete_path,'value':20,'unit':'mm'}],'填写草稿尺寸')
    assert error.value.detail['code']=='TYPE_DRAFT_INCOMPLETE' and error.value.detail['path']==incomplete_path
