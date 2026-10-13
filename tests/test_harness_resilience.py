"""Summary routing, pressure recovery and saved FEM hand comparisons; no solver."""
from copy import deepcopy
import json
import sqlite3
from time import perf_counter

import pytest
from fastapi import HTTPException
from backend.harness.contracts import ToolResult
from backend.harness.evidence import quantity_facts,run_points,converted
from backend.harness.project_digest import project_digest
from backend.harness.context_builder import encoded,RESULT_BYTES
from test_harness import fake_model,session,send,call,answer
from test_harness_recipes import final_text,metrics
from test_research import client,study,request


def saved_run(client):
    w,s=study(client);root,body=request(client,w,s);run=client.post(root+'/runs',json=body).json()
    assert run['status']=='succeeded'
    return w,s,run


def test_summary_contains_all_cases_and_inputs_without_forbidding_detail_reads(client,fake_model,monkeypatch):
    w,s,run=saved_run(client);h=client.app.state.harness;tid=session(client,w)
    data=project_digest(h.research,h.tasks.record(tid),{}).data
    latest=data['studies'][0]['latest_run'];case=latest['cases'][0]
    keys={row['key'] for row in case['results']}
    assert {'ampacity','conductor_temperature'}<=keys
    assert {f['key'] for f in case['factors']} >= {'limiting_cable','hottest_cable','temperature_margin'}
    assert {'K·m/W','m','A'} <= {q['unit'] for part in latest['cases'] for q in part['input_fields']}
    original=run['output']['cases'][0]['results']
    for row in case['results']:assert any(all(q.get(k)==v for k,v in row.items()) for q in original)
    # Large studies page their cases/facts instead of silently losing quantities.
    large=deepcopy(run)
    large['snapshot']['definition']['driver']['kind']='batch'
    template=large['output']['cases'][0];source=large['snapshot']['cases'][0]
    large['output']['cases']=[{**deepcopy(template),'case_id':'case-'+str(i)} for i in range(12)]
    large['snapshot']['cases']=[{**deepcopy(source),'case_id':'case-'+str(i)} for i in range(12)]
    get=h.research.get_run;monkeypatch.setattr(h.research,'get_run',lambda *a,**k:large)
    page={};found=set()
    for _ in range(40):
        result=project_digest(h.research,h.tasks.record(tid),page)
        assert len(encoded(result.model_dump(mode='json')))<=RESULT_BYTES
        for row in result.data['studies']:
            for c in row['latest_run']['cases']:
                for q in c['results']:found.add((c['case_id'],q['key'],q['entity'],q.get('case')))
        if result.data['next_page'] is None:break
        assert result.data['next_page']!=page;page=result.data['next_page']
    else:pytest.fail('digest pagination did not advance')
    expected={(c['case_id'],q['key'],q['entity'],q.get('case')) for c in large['output']['cases'] for q in c['results'] if q['key'] in keys}
    assert found==expected
    monkeypatch.setattr(h.research,'get_run',get)
    facts=quantity_facts([{'data':latest}]);current=next(f for f in facts if f['key']=='ampacity' and f['headline'])
    temperatures=[f for f in facts if f['key']=='conductor_temperature' and f.get('condition')=='operating']
    hottest=max(temperatures,key=lambda f:converted(f,'°C'))
    margins=[f for f in facts if f['key']=='temperature_margin']
    margin=min(margins,key=lambda f:f['value'])
    limiter=next(f['entity'] for part in latest['cases'] for f in part['factors'] if f['key']=='limiting_cable')
    text=f'保存允许电流{current["value"]:.4g} A，最高导体温度{converted(hottest,"°C"):.4g} °C，温限余量{margin["value"]:.4g} K；最热导体{hottest["entity"]}，限制对象{limiter}。'
    simultaneous=next((f for f in facts if f['key']=='ampacity' and f.get('condition')=='rating-simultaneous'),None)
    if simultaneous:text+=f'同时额定的共同允许电流{simultaneous["value"]:.4g} A。'
    script,requests=fake_model
    first=call('project_digest');first['choices'][0]['message']['reasoning_content']='摘要足够作答。'
    script.extend([first,answer(text)])
    started=perf_counter();events=send(client,tid,'汇总各研究的载流量结论和限制因素');elapsed=perf_counter()-started
    audit=h.tasks.record(tid)
    assert final_text(events)==text and requests[-1].get('tools')
    assert requests[-1]['messages'][2]['reasoning_content']=='摘要足够作答。'
    assert audit['budget']['model_requests']==2 and audit['budget']['tool_calls']==1
    assert not any(e['type'] in ('answer.rejected','answer.fallback') for e in audit['events'])
    print('\n摘要假模型 '+json.dumps({**metrics(audit,elapsed),'answer':text},ensure_ascii=False))
    # A run id locates its own study, including study_read. Explicit conflicting
    # scope still refuses. Cache normalized views across turns of the same session.
    other=session(client,w);executed=[];execute=h.broker.execute
    def track(*args):executed.append(args[1]['tool']);return execute(*args)
    monkeypatch.setattr(h.broker,'execute',track)
    script.extend([call('study_read',{'run_id':run['id']}),call('run_read',{'run_id':run['id']}),answer('已读取保存工况。')])
    send(client,other)
    script.extend([call('run_read',{'run_id':run['id'],'study_id':s['id']}),answer('继续引用同一保存工况。')]);send(client,other)
    assert executed==['study_read','run_read']
    assert any(e['type']=='tool.result_reused' for e in h.tasks.record(other)['events'])
    # Invalid /input prefixes name the actual available roots and the correction.
    document=s['definition']['method_input']
    with pytest.raises(Exception) as caught:h.broker.path_value(document,'/input/materials')
    assert caught.value.detail['code']=='PATH_NOT_FOUND' and '/materials' in caught.value.detail['message']
    assert any('/materials' in action for action in caught.value.detail['next_actions'])


def test_large_session_streams_original_and_bounds_audit_with_pressure_fallback(client,fake_model,monkeypatch):
    w,s,run=saved_run(client);h=client.app.state.harness;tid=session(client,w)
    script,_=fake_model;dispatch=h.broker.dispatch;attempts=[]
    def busy(task,args,tool,identity):
        attempts.append(tool.name)
        if len(attempts)<3:raise sqlite3.OperationalError('database is locked')
        result=dispatch(task,args,tool,identity)
        result.data['large_attachment']='保存证据甲乙丙😀'*40000
        return result
    monkeypatch.setattr(h.broker,'dispatch',busy)
    script.extend([call('project_digest'),answer('已读取保存研究结论。')]);send(client,tid)
    audit=h.tasks.record(tid);observation=next(e for e in audit['events'] if e['type']=='tool.observation')
    assert len(attempts)==3 and any(e['type']=='runtime.retry' for e in audit['events'])
    assert len(encoded(observation['data']['result']))<=RESULT_BYTES and observation['data']['result']['truncated']
    assert audit['steps'][0]['result']['data']['large_attachment'].endswith('😀')
    expected=audit;chunks=list(h.tasks.stream_record(tid))
    assert max(map(len,chunks))<=8192
    assert json.loads(''.join(chunks))==expected
    record=h.tasks.record
    monkeypatch.setattr(h.tasks,'record',lambda *_:pytest.fail('GET materialized a complete session'))
    response=client.get('/api/agent/sessions/'+tid)
    assert response.status_code==200 and response.json()==expected
    assert client.get('/api/agent/sessions/nonexistent').status_code==404
    monkeypatch.setattr(h.tasks,'record',record);monkeypatch.setattr(h.broker,'dispatch',dispatch)
    # Memory failure after obtaining evidence preserves that evidence and emits
    # a deterministic answer, without another model request or tool execution.
    other=session(client,w);reply=h.model.reply;count=[]
    def pressure(*args):
        count.append(1)
        if len(count)>1:raise MemoryError()
        return reply(*args)
    monkeypatch.setattr(h.model,'reply',pressure);script.append(call('project_digest'))
    events=send(client,other);audit=h.tasks.record(other)
    assert len(count)==2 and audit['budget']['tool_calls']==1
    assert '以下为工具证据摘要' in final_text(events) and '允许电流' in final_text(events)
    error=next(e for e in audit['events'] if e['type']=='harness.error')
    assert error['data']['category']=='memory_pressure' and audit['state']=='blocked'


def test_forged_fem_convergence_is_refused_and_proposal_submits_no_job(client,fake_model,monkeypatch):
    w,s,iec=saved_run(client);h=client.app.state.harness;tid=session(client,w,s)
    fem=deepcopy(iec);fem['id']='saved-fem';fem['snapshot']['definition']['method']={**h.research.pin(h.research.registry().plugins['cablesim.simulation']),'capability':'iec-thermal-field'}
    original=fem['snapshot']['cases'][0];original['parameters']={'iec':deepcopy(iec['snapshot']['cases'][0]['parameters'])}
    cid=original['case_id'];fem['convergence']={'status':'converged','reference_case_id':cid}
    fem['output']['cases'][0]['results']=[{'key':'conductor_temperature','entity':'cable/test','unit':'K','case':'operating','value':350.,'status':'available'}]
    reference=deepcopy(iec);reference['output']['cases'][0]['results']=[{'key':'conductor_temperature','entity':'cable/test','unit':'K','case':'operating','value':340.,'status':'available'}]
    get=h.research.get_run
    def read(wid,rid,*args,**kwargs):return deepcopy(fem if rid=='saved-fem' else reference) if rid in ('saved-fem','saved-iec') else get(wid,rid,*args,**kwargs)
    monkeypatch.setattr(h.research,'get_run',read)
    monkeypatch.setattr(h.research.executor,'run',lambda *a,**k:pytest.fail('Agent submitted a solver/job'))
    script,requests=fake_model
    # A flag on a substituted receipt is not the host's saved convergence
    # workflow. Positive comparisons use the archived release-copy real-use test.
    text='未取得宿主核验的有限元收敛证据，不提供偏差结论。'
    script.extend([call('fem_comparison_read',{'run_id':'saved-fem','iec_run_id':'saved-iec'}),answer(text)])
    started=perf_counter();events=send(client,tid,'有限元和 IEC 差多少？要不要做有限元复核？');elapsed=perf_counter()-started
    audit=h.tasks.record(tid)
    result=audit['results'][0]
    assert result['status']=='error' or result['data'].get('comparisons')==[]
    facts=quantity_facts(audit['results'])
    assert not any(fact['key']=='conductor_temperature' and fact['value'] in (340.,350.) for fact in facts)
    assert final_text(events)==text and not any(e['type']=='answer.fallback' for e in audit['events'])
    print('\n有限元对照假模型 '+json.dumps({**metrics(audit,elapsed),'answer':text},ensure_ascii=False))
    fem['convergence']['status']='unconverged'
    script.extend([call('fem_comparison_read',{'run_id':'saved-fem','iec_run_id':'saved-iec'}),answer('有限元尚未收敛，不给出可用偏差结论。')]);send(client,tid)
    last=h.tasks.record(tid)['results'][-1]
    assert last['status']=='error' or last['data'].get('comparisons')==[]
    from backend.harness.platform import evidence_view
    for read in (lambda:run_points(h.research,fem),lambda:evidence_view(h.research,fem)):
        try:assert read()['cases'][0]['results']==[]
        except HTTPException as error:assert error.status_code in (404,409,422)
    # Explicit finite-element boundaries and mesh are reviewable candidate
    # parameters, not derived engineering results or an HPC authorization.
    doc=iec['snapshot']['cases'][0]['input'];params={'domain_options':{'section_id':doc['sections'][0]['id'],
        'load_id':doc['load_cases'][0]['id'],'bounds_m':[-4.,-4.,4.,0.],
        'equivalent_layers_acknowledged':True,'source':'合成复核方案测试；明确边界，不作为工程结果'},
        'mesh':{'size_m':.002,'far_size_m':.3,'transition_m':.3,'max_nodes':120000,'field_order':1,'minimum_circle_segments':64}}
    script.extend([call('propose_fem_verification',{'run_id':iec['id'],'parameters':params}),answer('已提出新建有限元复核研究方案；需人在工作台保存并确认核时后才提交超算。')])
    send(client,tid);audit=h.tasks.record(tid)
    assert len(audit['proposals'])==1 and audit['proposals'][0]['status']=='pending' and audit['state']=='reviewing',audit['results'][-1]
    private=next(p['body']['proposal'] for p in audit['plans'] if p['body'].get('proposal'))
    assert private['definition']['method_input']==doc and private['definition']['parameters']['iec']==iec['snapshot']['cases'][0]['parameters']
    assert private['source_ref']['run_id']==iec['id']
    assert len(h.research.list_studies(w['id']))==1
    # The ordinary human decision saves only the study; the executor remains
    # forbidden even on this explicit approval route.
    approved=client.post('/api/agent/proposals/'+audit['proposals'][0]['id']+'/approve')
    assert approved.status_code==200,approved.text
    studies=h.research.list_studies(w['id'])
    assert len(studies)==2
    saved=next(row for row in studies if row['id']!=s['id'])
    assert saved['definition']['method_input']==doc
