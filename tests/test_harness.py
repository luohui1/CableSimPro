"""Native harness behavior through a local OpenAI-compatible fake HTTP service."""
from collections import deque
from copy import deepcopy
from dataclasses import replace
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import os
from threading import Thread

import pytest

from backend.harness.contracts import Limits
from backend.harness.providers import OpenAICompatibleProvider
from test_research import client,study

FAKE_KEY='test-only-model-credential'


def call(name,arguments=None):
    return {'choices':[{'message':{'role':'assistant','content':None,'tool_calls':[{
        'id':'provider-call','type':'function','function':{'name':name,'arguments':json.dumps(arguments or {})}}]},
        'finish_reason':'tool_calls'}],'usage':{'prompt_tokens':10,'completion_tokens':5}}


def answer(text):
    return {'choices':[{'message':{'role':'assistant','content':text},'finish_reason':'stop'}],
            'usage':{'prompt_tokens':10,'completion_tokens':5}}


@pytest.fixture
def fake_model(monkeypatch):
    script=deque();requests=[]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            requests.append(body)
            if not script:
                self.send_response(500);self.end_headers();return
            response=script.popleft()
            if response.get('http_status'):
                self.send_response(response['http_status']);self.send_header('Content-Type','application/json');self.end_headers()
                self.wfile.write(json.dumps({'error':{'message':FAKE_KEY}}).encode());return
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
            choice=response['choices'][0];message=choice['message']
            deltas=[]
            if message.get('tool_calls'):
                tool=message['tool_calls'][0];arguments=tool['function']['arguments'];middle=len(arguments)//2
                deltas=[{'tool_calls':[{'index':0,'id':tool['id'],'type':'function','function':{
                    'name':tool['function']['name'],'arguments':arguments[:middle]}}]},
                    {'tool_calls':[{'index':0,'function':{'arguments':arguments[middle:]}}]}]
            else:
                text=message['content'];middle=len(text)//2
                deltas=[{'content':text[:middle]},{'content':text[middle:]}]
            for delta in deltas:
                self.wfile.write(('data: '+json.dumps({'choices':[{'delta':delta,'finish_reason':None}]})+'\n\n').encode())
            self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{},'finish_reason':choice['finish_reason']}],
                'usage':response['usage']})+'\n\ndata: [DONE]\n\n').encode());self.wfile.flush()
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    monkeypatch.setenv('CABLESIM_LLM_BASE_URL',f'http://127.0.0.1:{server.server_port}/v1')
    monkeypatch.setenv('CABLESIM_LLM_MODEL','deepseek-flash');monkeypatch.setenv('CABLESIM_LLM_API_KEY',FAKE_KEY)
    yield script,requests
    server.shutdown();server.server_close();thread.join(timeout=5)
    assert not thread.is_alive()


def session(client,w,s=None):
    response=client.post('/api/agent/sessions',json={'workspace_id':w['id'],'study_id':s['id'] if s else None})
    assert response.status_code==200,response.text
    return response.json()['id']


def send(client,sid,content='核对当前工程并说明下一步。'):
    response=client.post(f'/api/agent/sessions/{sid}/messages',json={'content':content})
    assert response.status_code==200,response.text
    assert response.headers['content-type'].startswith('text/event-stream')
    events=[]
    for block in response.text.strip().split('\n\n'):
        lines=block.splitlines();assert len(lines)==2,block
        events.append((lines[0][7:],json.loads(lines[1][6:])))
    assert events[-1][0]=='done',events
    return events


def test_local_model_runs_the_same_preflight_and_preview_with_durable_intent(client,fake_model,monkeypatch):
    script,requests=fake_model;w,s=study(client);tid=session(client,w,s)
    registry=client.get('/api/agent/tools').json()
    generated=next(row['name'] for row in registry if row.get('plugin_id')=='cablesim.iec60287' and row['name'].endswith('__steady_rating'))
    script.extend([call('study_read',{'input_paths':['/sections/section~1s1/placements/cable~1c1-A/z']}),
        call('study_preflight'),call(generated),answer('预检与快速预览已完成；正式交付仍需保存运行并人工复核。')])
    executor=client.app.state.research.executor;original=executor.run
    def verified_intent(*args,**kwargs):
        with client.app.state.workspace_store.db() as db:
            assert db.execute("SELECT 1 FROM agent_steps WHERE task_id=? AND state='running'",(tid,)).fetchone()
        if kwargs.get('phase')!='check':assert 0<kwargs['timeout_s']<=8
        return original(*args,**kwargs)
    monkeypatch.setattr(executor,'run',verified_intent)
    events=send(client,tid)
    assert [data['status'] for kind,data in events if kind=='tool.result']==['ok','ok','ok'],events
    assert len({data['id'] for kind,data in events if kind=='tool.call'})==3
    assert {data['id'] for kind,data in events if kind=='tool.call'}=={data['id'] for kind,data in events if kind=='tool.result'}
    record=client.get('/api/agent/sessions/'+tid).json()
    assert record['state']=='completed' and record['waiting_reason'] is None
    assert record['budget']['tool_calls']==3 and record['budget']['prompt_tokens']==40
    assert record['results'][0]['data']['input_fields'][0]['unit']=='m'
    assert record['results'][0]['data']['input_fields'][0]['value']==-.8
    assert len(record['plans'])==3 and all(step['state']=='succeeded' for step in record['steps'])
    assert record['results'][-1]['execution_ref']['persisted'] is False
    assert client.get(f'/api/workspaces/{w["id"]}/studies/{s["id"]}/runs').json()['items']==[]
    assert set(row['function']['name'] for row in requests[0]['tools'])==set(row['name'] for row in registry)
    assert FAKE_KEY not in json.dumps(record,ensure_ascii=False)
    assert any(event['type']=='model.result' and event['data']['elapsed_ms']>0 for event in record['events'])


def test_tool_error_is_corrected_and_parameter_approval_uses_normal_save(client,fake_model):
    script,_=fake_model;w,s=study(client);tid=session(client,w,s)
    script.extend([call('propose_method_parameters',{'changes':[{'path':'/parameters/ks','value':-1,'unit':'1'}]}),
        call('plugin_inspect',{'plugin_id':'cablesim.iec60287','capability':'steady-rating','schema_path':'/parameter_schema/properties/ks'}),
        call('propose_method_parameters',{'changes':[{'path':'/parameters/ks','value':.8,'unit':'1'}]}),
        answer('修正方案已生成，等待人工批准。')])
    events=send(client,tid,'把集肤效应系数调整为0.8，先给方案。')
    assert [data['status'] for kind,data in events if kind=='tool.result']==['error','ok','ok'],events
    proposal=next(data for kind,data in events if kind=='proposal.created')
    root=f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    assert client.get(root).json()['definition']['parameters']==s['definition']['parameters']
    assert client.get('/api/agent/sessions/'+tid).json()['state']=='reviewing'
    url='/api/agent/proposals/'+proposal['id']+'/approve'
    assert client.post(url).json()=={'status':'approved'}
    saved=client.get(root).json();assert saved['revision']==s['revision']+1 and saved['definition']['parameters']['ks']==.8
    assert client.post(url).json()=={'status':'approved'}
    assert client.get(root).json()['revision']==saved['revision']
    assert client.post(url.replace('approve','reject')).status_code==409
    audit=client.get('/api/agent/sessions/'+tid).json()
    assert any(event['type']=='proposal.decision' and event['data']['engineering_approval'] is False for event in audit['events'])


def test_domain_proposals_show_display_units_and_reject_without_writing(client,fake_model):
    script,_=fake_model;w=client.post('/api/workspaces',json={}).json()
    converted=client.post(f'/api/workspaces/{w["id"]}/domain/conversion',json={'expected_revision':w['revision']}).json()
    w=client.get('/api/workspaces/'+w['id']).json()
    path='/sections/section~1s1/medium/surface_temperature'
    def propose(value):
        tid=session(client,w)
        script.extend([call('propose_domain_changes',{'changes':[{'path':path,'value':value,'unit':'°C'}]}),answer('输入方案已生成，等待人工确认。')])
        events=send(client,tid,f'把地表温度调整为{value}°C，先给方案。')
        return tid,next(data for kind,data in events if kind=='proposal.created')
    _,proposal=propose(30)
    change=proposal['changes'][0]
    assert change['unit']=='°C' and change['before']==25 and change['after']==30
    assert client.post('/api/agent/proposals/'+proposal['id']+'/reject').json()=={'status':'rejected'}
    assert client.get('/api/workspaces/'+w['id']).json()['revision']==w['revision']
    _,proposal=propose(30)
    assert client.post('/api/agent/proposals/'+proposal['id']+'/approve').json()=={'status':'approved'}
    saved=client.get(f'/api/workspaces/{w["id"]}/domain').json()
    assert saved['document']['sections'][0]['medium']['surface_temperature']==303.15
    assert saved['revision']==converted['revision']+1
    assert saved['document']['provenance'][path]['reviewed'] is False


def test_proposal_approval_refuses_a_changed_revision(client,fake_model):
    script,_=fake_model;w,s=study(client);tid=session(client,w,s)
    script.extend([call('propose_method_parameters',{'changes':[{'path':'/parameters/ks','value':.8,'unit':'1'}]}),answer('方案等待人工确认。')])
    proposal=next(data for kind,data in send(client,tid) if kind=='proposal.created')
    root=f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    changed=client.put(root,json={**s['definition'],'parameters':{**s['definition']['parameters'],'ks':.9},
        'expected_revision':w['revision'],'expected_study_revision':s['revision']})
    assert changed.status_code==200,changed.text
    response=client.post('/api/agent/proposals/'+proposal['id']+'/approve')
    assert response.status_code==409 and '研究版本已变化' in response.text
    assert client.get(root).json()['definition']['parameters']['ks']==.9


def test_manifest_tool_proposes_a_new_study_and_only_human_approval_saves_it(client,fake_model):
    from backend.kernel.scenarios import METHOD_DEFAULTS
    script,_=fake_model
    w=client.post('/api/workspaces',json={}).json()
    response=client.post(f'/api/workspaces/{w["id"]}/domain/conversion',json={'expected_revision':w['revision']})
    assert response.status_code==200,response.text
    w=client.get('/api/workspaces/'+w['id']).json();tid=session(client,w)
    generated=next(row['name'] for row in client.get('/api/agent/tools').json()
        if row.get('plugin_id')=='cablesim.iec60287' and row['name'].endswith('__steady_rating'))
    from cablesim_sdk.parameter_units import translate
    contract=next(row for row in client.get('/api/input-contracts').json() if row['method']['plugin_id']=='cablesim.iec60287' and row['method']['capability']=='steady-rating')
    parameters=translate(contract['parameter_schema'],deepcopy(METHOD_DEFAULTS['cablesim.iec60287']))
    script.extend([call(generated,{'title':'直埋稳态研究','parameters':parameters}),
        answer('新建研究方案已生成，等待人工批准。')])
    events=send(client,tid)
    assert any(kind=='proposal.created' for kind,_ in events),events
    proposal=next(data for kind,data in events if kind=='proposal.created')
    root=f'/api/workspaces/{w["id"]}/studies'
    assert client.get(root).json()==[]
    assert client.post('/api/agent/proposals/'+proposal['id']+'/approve').json()=={'status':'approved'}
    saved=client.get(root).json();assert len(saved)==1 and saved[0]['definition']['title']=='直埋稳态研究'
    assert client.get(root+'/'+saved[0]['id']+'/runs').json()['items']==[]
    record=client.get('/api/agent/sessions/'+tid).json()
    assert record['study_id']==saved[0]['id'] and record['study_revision']==1


def test_session_budget_stops_before_an_extra_tool_or_model_request(client,fake_model):
    script,requests=fake_model;w,s=study(client)
    client.app.state.harness.tasks.limits=replace(Limits(),max_tool_calls=1)
    tid=session(client,w,s)
    script.extend([call('workspace_list'),call('study_list')])
    events=send(client,tid)
    assert next(data['code'] for kind,data in events if kind=='error')=='BUDGET_EXCEEDED'
    record=client.get('/api/agent/sessions/'+tid).json()
    assert record['budget']['tool_calls']==1 and len(record['steps'])==1
    assert record['state']=='blocked' and record['waiting_reason']=='budget'
    assert len(requests)==2
    client.app.state.harness.tasks.limits=replace(Limits(),max_active_ms=0)
    other=session(client,w,s)
    events=send(client,other)
    assert next(data['code'] for kind,data in events if kind=='error')=='BUDGET_EXCEEDED'
    assert len(requests)==2


def test_missing_model_configuration_keeps_status_tools_and_sse_available(client,monkeypatch):
    for name in ('CABLESIM_LLM_BASE_URL','CABLESIM_LLM_MODEL','CABLESIM_LLM_API_KEY'):monkeypatch.delenv(name,raising=False)
    status=client.get('/api/agent/status').json()
    assert status=={'configured':False,'model':'deepseek-flash','tools':63}
    tools=client.get('/api/agent/tools').json();assert len(tools)==63
    assert len([tool for tool in tools if tool.get('plugin_id')])==51
    assert all(tool['kind'] in ('read','propose','run') and tool['title'] for tool in tools)
    w=client.post('/api/workspaces',json={}).json();tid=session(client,w)
    events=send(client,tid)
    assert events[0][0]=='error' and events[0][1]['code']=='LLM_NOT_CONFIGURED'
    assert client.get('/api/agent/sessions/'+tid).json()['budget']['model_requests']==0
    schema=client.get('/openapi.json').json()
    assert '/api/agent/proposals/{id}/approve' in schema['paths']
    assert 'x-sse-events' in schema['paths']['/api/agent/sessions/{id}/messages']['post']
    contract=client.get('/api/agent/contract').json()
    assert 'unknown' in contract['plan_node']['properties']['state']['enum']


def test_model_has_no_self_approval_or_unapproved_execution_tool(client,fake_model,monkeypatch):
    script,_=fake_model;w,s=study(client)
    executor=client.app.state.research.executor
    monkeypatch.setattr(executor,'required',lambda *args:True,raising=False)
    monkeypatch.setattr(executor,'run',lambda *args,**kwargs:pytest.fail('unapproved execution reached the executor'))
    tid=session(client,w,s)
    script.extend([call('approve',{'id':'invented'}),call('study_preview')])
    events=send(client,tid)
    record=client.get('/api/agent/sessions/'+tid).json()
    assert record['results'][0]['diagnostics'][0]['code']=='TOOL_NOT_ALLOWED'
    assert record['results'][1]['diagnostics'][0]['code']=='HUMAN_EXECUTION_REQUIRED'
    assert record['state']=='waiting' and record['waiting_reason']=='scope_confirmation'
    assert not any(kind=='proposal.created' for kind,_ in events)
    assert all(tool['name'] not in ('approve','reject','publish','http','shell','ssh') for tool in client.get('/api/agent/tools').json())


def test_unseen_quantities_and_provider_credentials_never_become_messages(client,fake_model):
    script,_=fake_model;w,s=study(client);tid=session(client,w,s)
    script.append(answer('允许电流为9999 A。'))
    events=send(client,tid)
    assert not any(kind=='message.delta' for kind,_ in events)
    assert next(data['code'] for kind,data in events if kind=='error')=='UNGROUNDED_QUANTITY'
    record=client.get('/api/agent/sessions/'+tid).json()
    assert '9999 A' not in json.dumps(record,ensure_ascii=False)
    other=session(client,w,s);script.append({'http_status':401})
    events=send(client,other)
    assert next(data['code'] for kind,data in events if kind=='error')=='LLM_AUTH_FAILED'
    assert FAKE_KEY not in json.dumps(events,ensure_ascii=False)
    assert FAKE_KEY not in client.get('/api/agent/sessions/'+other).text


def test_restart_marks_inflight_intents_unknown_and_does_not_reissue(client,fake_model,monkeypatch):
    from backend.harness.task_store import TaskStore
    from backend.harness.recipe_compiler import compile_calls
    from backend.harness.evidence import reconcile
    script,requests=fake_model;w,s=study(client);tid=session(client,w,s)
    harness=client.app.state.harness
    turn=harness.begin(tid,'读取原步骤状态。')
    plan=compile_calls([{'id':'lost-call','name':'study_preview','arguments':{}}],harness.registry.tools(),w['id'],w['revision'])
    revision=harness.tasks.add_plan(tid,plan);operation=harness.tasks.issue(tid,turn,revision,plan['nodes'][0])
    harness.tasks.running(tid,operation)
    recovered=TaskStore(client.app.state.workspace_store,'replacement-owner');recovered.initialize()
    record=recovered.record(tid)
    assert record['steps'][0]['state']=='unknown' and record['waiting_reason']=='capability'
    monkeypatch.setattr(client.app.state.research.executor,'run',lambda *a,**k:pytest.fail('unknown operation was reissued'))
    result=reconcile(client.app.state.research,recovered,tid)
    assert result['reissued'] is False and result['unknown'][0]['operation_id']==operation
    assert requests==[] and script==deque()


def test_recovery_reads_the_original_saved_run_and_same_identity_cannot_change_input(client,fake_model,monkeypatch):
    from backend.harness.task_store import TaskStore
    from backend.harness.recipe_compiler import compile_calls
    from backend.harness.evidence import reconcile
    from test_research import request
    from fastapi import HTTPException
    w,s=study(client);root,body=request(client,w,s)
    run=client.post(root+'/runs',json=body).json();tid=session(client,w,s)
    harness=client.app.state.harness;turn=harness.begin(tid,'读取已保存运行。')
    plan=compile_calls([{'id':'read-call','name':'run_read','arguments':{'run_id':run['id']}}],harness.registry.tools(),w['id'],w['revision'])
    node=plan['nodes'][0];node['input_identity'].update(study_id=s['id'],run_id=run['id'])
    revision=harness.tasks.add_plan(tid,plan);operation=harness.tasks.issue(tid,turn,revision,node)
    assert harness.tasks.issue(tid,turn,revision,node)==operation
    changed=deepcopy(node);changed['arguments']['case_id']='case-1'
    with pytest.raises(HTTPException) as conflict:harness.tasks.issue(tid,turn,revision,changed)
    assert conflict.value.status_code==409
    harness.tasks.running(tid,operation)
    recovered=TaskStore(client.app.state.workspace_store,'recovery-owner');recovered.initialize()
    monkeypatch.setattr(client.app.state.research.executor,'run',lambda *a,**k:pytest.fail('recovery executed an algorithm'))
    first=reconcile(client.app.state.research,recovered,tid,persist=True)
    second=reconcile(client.app.state.research,recovered,tid,persist=True)
    assert len(first['resolved'])==1 and first['unknown']==[] and first['reissued'] is False
    assert second=={'resolved':[],'unknown':[],'reissued':False}
    record=recovered.record(tid)
    assert record['steps'][0]['state']=='succeeded' and record['results'][0]['data']['run_id']==run['id']


@pytest.mark.skipif(not os.environ.get('CABLESIM_LLM_API_KEY'),reason='Real model smoke requires explicitly configured host environment; default tests use the local fake')
def test_real_model_provider_smoke():
    provider=OpenAICompatibleProvider()
    reply=provider.reply([{'role':'user','content':'请调用ping工具，不要计算工程数值。'}],[{
        'type':'function','function':{'name':'ping','description':'返回本次连接状态。','parameters':{'type':'object','properties':{},'additionalProperties':False}}}],15)
    assert reply.tool_calls and reply.tool_calls[0]['name']=='ping'
