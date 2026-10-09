"""One command: python -m pytest -q -s tests/test_harness_scenarios.py.

Real ASGI workflows and saved algebraic plugin evidence; scripted local model,
no real credential, browser, native FEM, engineering approval or HPC submission.
"""
import json
from test_index_reproductions import library
from time import perf_counter

from backend.harness.evidence import quantity_facts,run_points
from backend.domain.guards import value_at
from test_research import client
from test_harness import fake_model,session,send,call,answer
from test_harness_recipes import final_text,metrics
from test_harness_resilience import saved_run
from test_harness_types import design
from test_index import object_card


def test_agent_common_scenarios_are_bounded_grounded_and_human_reviewed(client,fake_model,monkeypatch):
    script,requests=fake_model;h=client.app.state.harness;results=[]
    def turn(name,tid,content,recipe=None,limit=8):
        before=len(requests);started=perf_counter();dispatched=[];dispatch=h.broker.dispatch
        def track(*args):
            dispatched.append(args[2].name)
            return dispatch(*args)
        with monkeypatch.context() as patch:
            patch.setattr(h.broker,'dispatch',track)
            events=send(client,tid,content,recipe)
        record=h.tasks.record(tid)
        measured=metrics(record,perf_counter()-started)
        measured['executed_tool_calls']=len(dispatched)
        assert measured['model_requests']==len(requests)-before and measured['model_requests']<=limit
        assert not measured['fallback'] and not measured['repairs']
        assert not any(e['type']=='answer.rejected' for e in record['events'])
        results.append({'scenario':name,**measured})
        return events,record
    w,s,run=saved_run(client);tid=session(client,w)
    current=next(f for f in quantity_facts([{'data':run_points(h.research,run)}]) if f['key']=='ampacity' and f['headline'])
    card=object_card(client,'study',s['id'])
    text=f'“{card["name"]}”的保存允许电流为 {current["value"]:.4g} A；限制对象与最热导体按保存工况解释，结果可追溯到对应运行。'
    reply=answer(text);reply['choices'][0]['message']['reasoning_content']='保留原始思考，只解释宿主提供的保存结论。';script.append(reply)
    events,record=turn('conclusion_summary',tid,'汇总各研究的载流量结论和限制因素',
        {'id':'conclusion_summary','parameters':{}},limit=2)
    assert final_text(events)==text and record['budget']['tool_calls']<=4
    assert results[-1]['elapsed_s']<=40 and not requests[-1].get('tools')
    assert record['messages'][-1]['reasoning_content']==reply['choices'][0]['message']['reasoning_content']
    refs=next(d['object_refs'] for k,d in events if k=='message.delta' and 'object_refs' in d)
    assert card in refs
    # An ordinary parameter save makes the original run historical immediately.
    root=f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    saved=client.put(root,json={**s['definition'],'parameters':{**s['definition']['parameters'],'ks':.9},
        'expected_revision':w['revision'],'expected_study_revision':s['revision']})
    assert saved.status_code==200,saved.text
    s=saved.json();tid=session(client,w,s)
    text='保存基准已过期，研究参数修订发生变化。请在工作台核对工况并人工重算，保存正常运行后再请求方案试算对比。本次未执行方案与试算。'
    script.append(answer(text))
    events,record=turn('outdated_baseline',tid,'给方案并试算',{'id':'proposal_comparison','parameters':{
        'scope':'parameters','changes':[{'path':'/soil_thermal_resistivity','value':1.2,'unit':'K·m/W'}]}})
    assert final_text(events)==text and not record['proposals']
    result=record['results'][0];assert result['diagnostics'][0]['code']=='BASELINE_INVALID'
    assert result['diagnostics'][0]['details']['actions'][0]['requires_human']
    assert results[-1]['executed_tool_calls']==1
    assert not requests[-1].get('tools')
    # Native solvers remain forbidden during type editing. The conversion is hand-checkable.
    monkeypatch.setattr(h.research.executor,'run',lambda *a,**k:(_ for _ in ()).throw(AssertionError('Type edit invoked solver')))
    model,path=design(client);tid=session(client,model);card=object_card(client,'type',model['id'])
    text=f'“{card["name"]}”的方案将绝缘厚度由 16.2 mm 调为 15.8 mm；外径、电气与载流量影响须在保存后重新计算核验。'
    script.extend([call('type_read',{'type_id':model['id'],'view':'structure'}),
        call('propose_type_changes',{'type_id':model['id'],'changes':[{'path':path,'value':15.8,'unit':'mm'}],'reason':'场景回归核对厚度'}),answer(text)])
    events,record=turn('type_proposal',tid,'把绝缘厚度改成 15.8 mm 并说明影响')
    assert final_text(events)==text and record['budget']['tool_calls']==3
    assert record['steps'][0]['tool']=='type_read' and record['steps'][0]['result']['data']['view']=='summary'
    proposal=record['proposals'][0];assert proposal['kind']=='type' and proposal['base_revision']==model['revision']
    assert client.get('/api/workspaces/'+model['id']).json()['revision']==model['revision']
    inbox=client.get('/api/index/inbox').json()
    assert any(i['category']=='review' and i['object']['id']==proposal['id'] for i in inbox['items'])
    started=perf_counter();response=client.post('/api/agent/proposals/'+proposal['id']+'/approve')
    assert response.status_code==200,response.text
    current=client.get('/api/workspaces/'+model['id']).json()
    assert current['revision']==model['revision']+1 and abs(value_at(current['domain'],path)-15.8/1000)<1e-12
    assert client.post('/api/agent/proposals/'+proposal['id']+'/approve').status_code==200
    assert client.get('/api/workspaces/'+model['id']).json()['revision']==current['revision']
    results.append({'scenario':'type_human_approval','model_requests':0,'tool_calls':0,'elapsed_s':round(perf_counter()-started,3),'revision_delta':1})
    started=perf_counter()
    deltas=[d for k,d in events if k=='message.delta']
    refs=deltas[0]['object_refs']
    assert refs==[card] and len({(ref['kind'],ref['id']) for ref in refs})==len(refs)
    assert all('object_refs' not in d for d in deltas[1:])
    history=client.get('/api/agent/sessions/'+tid).json()
    assert history['messages'][-1]['object_refs']==refs
    results.append({'scenario':'answer_object_refs','model_requests':0,'tool_calls':0,'elapsed_s':round(perf_counter()-started,3),'refs':len(refs)})
    print('\nAgent 场景回归 '+json.dumps(results,ensure_ascii=False))
