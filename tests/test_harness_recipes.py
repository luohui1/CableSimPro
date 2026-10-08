"""Bounded saved evidence, deterministic recipe steps and convergent diagnostics."""
from copy import deepcopy
import json
from time import perf_counter

import pytest

from backend.harness.context_builder import encoded, RESULT_BYTES
from backend.harness.evidence import converted, quantity_facts
from backend.harness.project_digest import project_digest
from test_harness import fake_model, session, send, call, answer
from test_research import client, study, request


def final_text(events):
    return ''.join(data['text'] for kind,data in events if kind=='message.delta')


def metrics(record, elapsed):
    return {'model_requests':record['budget']['model_requests'],'tool_calls':record['budget']['tool_calls'],
        'elapsed_s':round(elapsed,3),'prompt_tokens':record['budget']['prompt_tokens'],
        'completion_tokens':record['budget']['completion_tokens'],
        'repairs':sum(event['type']=='answer.repair' for event in record['events']),
        'fallback':any(event['type']=='answer.fallback' for event in record['events'])}


def test_digest_pages_saved_quantities_and_cold_catalog_avoids_input_contracts(client,fake_model,monkeypatch):
    script,requests=fake_model;harness=client.app.state.harness
    # Cold status cannot build any tool schema or wait for full input contracts.
    original=harness.registry.tools
    monkeypatch.setattr(harness.registry,'tools',lambda:pytest.fail('status built tool specs'))
    started=perf_counter();status=client.get('/api/agent/status');status_ms=(perf_counter()-started)*1000
    assert status.status_code==200 and status.json()['tools']==69
    import backend.kernel.input_contracts as contracts
    monkeypatch.setattr(contracts,'contracts',lambda *a,**k:pytest.fail('catalog built input contracts'))
    # A held contract lock must not delay /tools, even its first request.
    research=harness.research
    research.contract_read_lock.acquire()
    try:
        started=perf_counter();tools=client.get('/api/agent/tools');cold_ms=(perf_counter()-started)*1000
    finally:research.contract_read_lock.release()
    assert tools.status_code==200 and len(tools.json())==69
    registry=research.registry
    monkeypatch.setattr(research,'registry',lambda *a,**k:pytest.fail('warm directory rediscovered plugins'))
    started=perf_counter();assert client.get('/api/agent/tools').json()==tools.json();warm_ms=(perf_counter()-started)*1000
    monkeypatch.setattr(research,'registry',registry)
    monkeypatch.setattr(harness.registry,'tools',original)
    # A real lightweight IEC saved run is the oracle; the projection must retain
    # its producer value, condition, entity, unit and artifact identity exactly.
    w,s=study(client);root,body=request(client,w,s);run=client.post(root+'/runs',json=body).json()
    for index in range(2):
        created=client.post(f'/api/workspaces/{w["id"]}/studies',json={**s['definition'],
            'title':'未运行研究'+str(index),'expected_revision':w['revision']})
        assert created.status_code==201,created.text
    tid=session(client,w);task=harness.tasks.record(tid)
    pages=[];cursor=0
    while True:
        result=project_digest(research,task,{'after':cursor})
        assert len(encoded(result.model_dump(mode='json'))) <= RESULT_BYTES
        pages.append(result.data)
        if result.data['next_cursor'] is None:break
        assert result.data['next_cursor']>cursor
        cursor=result.data['next_cursor']
    rows=[row for page in pages for row in page['studies']]
    assert len(rows)==3 and len({row['study_id'] for row in rows})==3 and len(pages)==1
    assert pages[0]['total_studies']==3 and pages[0]['next_cursor'] is None
    assert rows[0]['run_state']=='normal' and all(row['run_state']=='not_run' for row in rows[1:])
    from backend.kernel.headlines import project
    expected=project(run['snapshot'],run['output'],run['artifact_status'])
    assert [{k:v for k,v in row.items() if k!='display_rounded'} for row in rows[0]['latest_run']['headlines']]==expected
    facts=quantity_facts([{'data':pages[0]}]);ampacity=next(f for f in facts if f['key']=='ampacity' and f['headline'] and f['unit']=='A')
    limiter=next(f['entity'] for case in rows[0]['latest_run']['cases'] for f in case['factors'] if f['key']=='limiting_cable')
    # The common summary request takes one observation then a verified explanation.
    text=f'合成研究的保存允许电流{ampacity["value"]:.4g} A，限制对象{limiter}。其余研究尚未运行。'
    thinking=call('recipe_execute',{'recipe':'conclusion_summary','parameters':{}})
    thinking['choices'][0]['message']['reasoning_content']='一次读取保存结论，再说明覆盖范围。'
    script.extend([thinking,answer(text)])
    started=perf_counter();events=send(client,tid,'汇总各研究的载流量结论和限制因素');elapsed=perf_counter()-started
    record=harness.tasks.record(tid)
    assert final_text(events)==text and record['budget']['model_requests']==2 and record['budget']['tool_calls']==1
    assert not any(event['type'] in ('answer.rejected','answer.fallback') for event in record['events'])
    assert requests[-1]['messages'][2]['reasoning_content']=='一次读取保存结论，再说明覆盖范围。'
    print('\n汇总（本地假模型） '+json.dumps({**metrics(record,elapsed),'answer':text,
        'status_ms':round(status_ms,2),'tools_cold_ms':round(cold_ms,2),'tools_warm_ms':round(warm_ms,2)},ensure_ascii=False))
    for index in range(22):
        created=client.post(f'/api/workspaces/{w["id"]}/studies',json={**s['definition'],
            'title':'分页研究'+str(index),'expected_revision':w['revision']})
        assert created.status_code==201,created.text
    pages=[];cursor=0
    while True:
        result=project_digest(research,task,{'after':cursor})
        assert len(encoded(result.model_dump(mode='json'))) <= RESULT_BYTES
        pages.append(result.data)
        if result.data['next_cursor'] is None:break
        assert result.data['next_cursor']>cursor
        cursor=result.data['next_cursor']
    rows=[row for page in pages for row in page['studies']]
    assert len(rows)==25 and len({row['study_id'] for row in rows})==25 and len(pages)>1
    assert all(page['total_studies']==25 for page in pages)
    # Corrupt saved bytes must never turn into evidence quantities.
    with research.store.db(True) as db:
        db.execute('UPDATE study_runs SET output_digest=? WHERE id=?',('invalid-digest',run['id']))
    invalid=project_digest(research,task,{}).data['studies'][0]
    assert invalid['run_state']=='failed' and invalid['latest_run']['integrity']=='corrupt'
    assert quantity_facts([{'data':invalid}])==[]
    with research.store.db(True) as db:
        db.execute('UPDATE study_runs SET output_digest=? WHERE id=?',(run['output_digest'],run['id']))
    edited=client.post(f'/api/workspaces/{w["id"]}/edit',json={'expected_revision':w['revision'],
        'changes':[{'path':'installation.depth_m','value':1.1}]})
    assert edited.status_code==200,edited.text
    assert project_digest(research,task,{}).data['studies'][0]['run_state']=='stale'


def test_recipe_binds_proposal_and_saved_case_with_audit_and_no_engineering_write(client,fake_model,monkeypatch):
    script,requests=fake_model;w,s=study(client);document=deepcopy(s['definition']['method_input'])
    soil=next(row for row in document['materials'] if row['category']=='soil');soil['thermal_resistivity']=1.
    client.post(f'/api/workspaces/{w["id"]}/domain/conversion',json={'expected_revision':w['revision']})
    w=client.get('/api/workspaces/'+w['id']).json()
    saved=client.put(f'/api/workspaces/{w["id"]}/domain',json={'expected_revision':w['revision'],'document':document})
    assert saved.status_code==200,saved.text
    w=client.get('/api/workspaces/'+w['id']).json()
    updated=client.put(f'/api/workspaces/{w["id"]}/studies/{s["id"]}',json={**s['definition'],
        'input_source':'domain','method_input':None,'expected_revision':w['revision'],'expected_study_revision':s['revision']})
    assert updated.status_code==200,updated.text
    s=updated.json();root,body=request(client,w,s);run=client.post(root+'/runs',json=body).json()
    assert run['status']=='succeeded',run
    path='/materials/'+soil['id'].replace('/','~1')+'/thermal_resistivity';tid=session(client,w,s)
    catalog=client.get('/api/agent/recipes').json()
    assert {row['id'] for row in catalog}=={'conclusion_summary','missing_inputs','proposal_comparison','sensitivity_advice'}
    script.append(call('recipe_execute',{'recipe':'proposal_comparison','parameters':{
        'scope':'domain','changes':[{'path':path,'value':1.2,'unit':'K·m/W'}]}}))
    harness=client.app.state.harness;original=harness.model.reply;texts=[]
    def reply(*args):
        if len(requests)==1:
            record=harness.tasks.record(tid);before=record['results'][0]['data'];after=record['results'][2]['data']
            def key(data,name):
                rows=[f for f in quantity_facts([{'data':data}]) if f['key']==name]
                return next(f for f in rows if f['headline']) if name=='ampacity' else max(
                    (f for f in rows if f.get('condition')=='operating'),key=lambda f:converted(f,'°C'))
            a,b=key(before,'ampacity'),key(after,'ampacity');ta,tb=key(before,'conductor_temperature'),key(after,'conductor_temperature')
            texts.append(f'方案中拟把土壤热阻率从1.0 K·m/W改为1.2 K·m/W。'
                f'保存允许电流{a["value"]:.4g} A，试算允许电流{b["value"]:.4g} A。'
                f'最高导体温度从{converted(ta,"°C"):.4g} °C变为{converted(tb,"°C"):.4g} °C；试算未保存，方案等待人工决定。')
            script.append(answer(texts[-1]))
        return original(*args)
    harness.model.reply=reply
    started=perf_counter();events=send(client,tid,'把土壤热阻率改成1.2 K·m/W，给出修改方案，并试算看看最高导体温度怎么变');elapsed=perf_counter()-started
    record=harness.tasks.record(tid)
    assert final_text(events)==texts[-1] and record['budget']['model_requests']==2 and record['budget']['tool_calls']==3
    assert [step['tool'] for step in record['steps']]==['study_baseline','propose_domain_changes','study_preview']
    trial=record['steps'][-1]
    assert trial['arguments']['proposal_id']==record['proposals'][0]['id'] and trial['arguments']['run_id']==run['id']
    assert trial['input_identity']['run_id']==run['id'] and all(step['state']=='succeeded' for step in record['steps'])
    assert [event['type'] for event in record['events']].count('recipe.compiled')==1
    assert [event['type'] for event in record['events']].count('recipe.bound')==1
    assert [event['type'] for event in record['events']].count('tool.intent')==3
    assert record['proposals'][0]['status']=='pending' and record['state']=='reviewing'
    assert client.get(root+'/runs').json()['items'][0]['id']==run['id'] and len(client.get(root+'/runs').json()['items'])==1
    assert client.get(f'/api/workspaces/{w["id"]}/domain').json()['revision']==w['revision']
    assert not any(event['type'] in ('answer.rejected','answer.fallback') for event in record['events'])
    print('\n方案试算（本地假模型） '+json.dumps({**metrics(record,elapsed),'answer':texts[-1]},ensure_ascii=False))
    # The other recipes remain finite and respect the same host preflight boundary.
    harness.model.reply=original
    for recipe in ('missing_inputs','sensitivity_advice'):
        other=session(client,w,s);script.extend([call('recipe_execute',{'recipe':recipe,'parameters':{}}),answer('已读取输入与方法约束，工程决定仍需人工。')])
        send(client,other)
        audit=harness.tasks.record(other)
        assert len(audit['steps'])==(3 if recipe=='sensitivity_advice' else 2)
        assert all(step['state']=='succeeded' for step in audit['steps'])
    # A failed baseline must never create a proposal or execute its preview.
    other=session(client,w,s)
    script.extend([call('recipe_execute',{'recipe':'proposal_comparison','parameters':{
        'scope':'domain','run_id':'nonexistent','changes':[{'path':path,'value':1.2,'unit':'K·m/W'}]}}),answer('原保存运行不可用，方案试算尚未执行。')])
    send(client,other);audit=harness.tasks.record(other)
    assert audit['proposals']==[] and [r['diagnostics'][0]['code'] for r in audit['results'][1:]]==['RECIPE_DEPENDENCY_FAILED']*2
    # A recipe has no additional authority to run a remote/native capability.
    monkeypatch.setattr(harness.research.executor,'required',lambda *args:True,raising=False)
    monkeypatch.setattr(harness.research.executor,'run',lambda *a,**k:pytest.fail('recipe executed without human authority'))
    other=session(client,w,s)
    script.extend([call('recipe_execute',{'recipe':'proposal_comparison','parameters':{
        'scope':'domain','changes':[{'path':path,'value':1.2,'unit':'K·m/W'}]}}),answer('此能力需人工正式运行，尚未提交作业。')])
    send(client,other);audit=harness.tasks.record(other)
    assert audit['state']=='waiting' and audit['waiting_reason']=='scope_confirmation'
    assert audit['results'][-1]['diagnostics'][0]['code']=='HUMAN_EXECUTION_REQUIRED'


def test_run_list_without_study_and_repeated_diagnostic_do_not_retry_host(client,fake_model,monkeypatch):
    script,requests=fake_model;w=client.post('/api/workspaces',json={}).json();tid=session(client,w)
    script.extend([call('run_list'),answer('本工程暂无保存研究结论。')]);send(client,tid)
    harness=client.app.state.harness;audit=harness.tasks.record(tid)
    assert audit['results'][0]['status']=='ok' and audit['results'][0]['data']['studies']==[]
    assert audit['results'][0]['diagnostics']==[] and len(requests)==2
    other=session(client,w);calls=[];original=harness.broker.execute
    def execute(*args):calls.append(args[1]['tool']);return original(*args)
    monkeypatch.setattr(harness.broker,'execute',execute)
    script.extend([call('workspace_read'),call('workspace_read'),answer('工程尚无领域输入，请先在工作台转换。')])
    send(client,other);audit=harness.tasks.record(other)
    assert calls==['workspace_read']
    assert [r['diagnostics'][0]['code'] for r in audit['results']]==['DOMAIN_INPUT_REQUIRED','DIAGNOSTIC_ALREADY_REPORTED']
    assert any(event['type']=='tool.diagnostic_reused' for event in audit['events'])
    assert len([event for event in audit['events'] if event['type']=='model.request' and event['data']['phase']=='closing'])==1
