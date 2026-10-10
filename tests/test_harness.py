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
    # The loopback fake must never depend on the developer's proxy or send its
    # test credential through an external transport during the full suite.
    monkeypatch.setenv('NO_PROXY','127.0.0.1,localhost,::1')
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
                for index,tool in enumerate(message['tool_calls']):
                    arguments=tool['function']['arguments'];middle=len(arguments)//2
                    deltas.extend([{'tool_calls':[{'index':index,'id':tool['id']+'-'+str(index),'type':'function','function':{
                        'name':tool['function']['name'],'arguments':arguments[:middle]}}]},
                        {'tool_calls':[{'index':index,'function':{'arguments':arguments[middle:]}}]}])
            else:
                text=message['content'];middle=len(text)//2
                deltas=[{'content':text[:middle]},{'content':text[middle:]}]
            if message.get('reasoning_content'):deltas.insert(0,{'reasoning_content':message['reasoning_content']})
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


def send(client,sid,content='核对当前工程并说明下一步。',recipe=None):
    response=client.post(f'/api/agent/sessions/{sid}/messages',json={'content':content,**({'recipe':recipe} if recipe else {})})
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
        call('study_preflight'),call('plugin_inspect',{'tool':generated}),call(generated),answer('预检与快速预览已完成；正式交付仍需保存运行并人工复核。')])
    executor=client.app.state.research.executor;original=executor.run
    def verified_intent(*args,**kwargs):
        with client.app.state.workspace_store.db() as db:
            assert db.execute("SELECT 1 FROM agent_steps WHERE task_id=? AND state='running'",(tid,)).fetchone()
        if kwargs.get('phase')!='check':assert 0<kwargs['timeout_s']<=8
        return original(*args,**kwargs)
    monkeypatch.setattr(executor,'run',verified_intent)
    events=send(client,tid)
    assert [data['status'] for kind,data in events if kind=='tool.result']==['ok','ok','ok','ok'],events
    assert len({data['id'] for kind,data in events if kind=='tool.call'})==4
    assert {data['id'] for kind,data in events if kind=='tool.call'}=={data['id'] for kind,data in events if kind=='tool.result'}
    record=client.get('/api/agent/sessions/'+tid).json()
    assert record['state']=='completed' and record['waiting_reason'] is None
    assert record['budget']['tool_calls']==4 and record['budget']['prompt_tokens']==50
    assert record['results'][0]['data']['input_fields'][0]['unit']=='m'
    assert record['results'][0]['data']['input_fields'][0]['value']==-.8
    assert len(record['plans'])==4 and all(step['state']=='succeeded' for step in record['steps'])
    assert record['results'][-1]['execution_ref']['persisted'] is False
    assert client.get(f'/api/workspaces/{w["id"]}/studies/{s["id"]}/runs').json()['items']==[]
    assert set(row['function']['name'] for row in requests[0]['tools'])==set(row['name'] for row in registry if not row.get('plugin_id'))
    assert generated not in {row['function']['name'] for row in requests[2]['tools']}
    assert generated in {row['function']['name'] for row in requests[3]['tools']}
    assert record['enabled_tools']==[generated]
    assert all(len(json.dumps(request['tools'],ensure_ascii=False,separators=(',',':')).encode())<=16*1024 for request in requests)
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


def test_settings_page_connection_is_used_and_its_key_never_returned(client,fake_model):
    script,requests=fake_model;w=client.post('/api/workspaces',json={}).json()
    base=os.environ['CABLESIM_LLM_BASE_URL'];key='sk-settings-only-key-7781'
    saved=client.put('/api/agent/settings',json={'base_url':base,'model':'custom-model','api_key':key,
        'instructions':'结论先写一句话。','model_timeout_s':40})
    assert saved.status_code==200,saved.text
    body=saved.json()
    assert (body['source'],body['model'],body['key_hint'],body['key_source'])==('settings','custom-model','…7781','memory')
    assert key not in saved.text and key not in client.get('/api/agent/settings').text
    assert client.get('/api/agent/status').json()['model']=='custom-model'
    tid=session(client,w)
    assert client.get(f'/api/agent/sessions/{tid}').json()['budget']['limits']['model_timeout_s']==40
    script.append(answer('已读取。'));send(client,tid,'说明下一步。')
    assert requests[-1]['model']=='custom-model' and '结论先写一句话。' in requests[-1]['messages'][0]['content']
    assert key not in json.dumps(client.get(f'/api/agent/sessions/{tid}').json(),ensure_ascii=False)
    bad=client.put('/api/agent/settings',json={'base_url':'ftp://example.com','model':'m'})
    assert bad.status_code==422 and bad.json()['detail']['code']=='LLM_BASE_INVALID'
    assert client.delete('/api/agent/settings').json()['source']=='environment'
    assert client.get('/api/agent/status').json()['model']=='deepseek-flash'


def test_a_made_up_study_id_is_a_tool_diagnostic_not_a_harness_failure(client,fake_model):
    script,_=fake_model;w=client.post('/api/workspaces',json={}).json();tid=session(client,w)
    script.extend([call('study_preflight',{'study_id':'f2c0f6f2-0ccb-4b3e-b3bb-be79ae4b6a52'}),answer('该研究不存在。')])
    events=send(client,tid,'预检那个研究。')
    assert [data['status'] for kind,data in events if kind=='tool.result']==['error']
    assert not any(kind=='error' and data['code']=='HARNESS_FAILED' for kind,data in events)


def test_thinking_mode_reasoning_is_passed_back_on_every_later_request(client,fake_model):
    script,requests=fake_model;w=client.post('/api/workspaces',json={}).json();tid=session(client,w)
    thought=call('workspace_list');thought['choices'][0]['message']['reasoning_content']='先读工程再回答。'
    script.extend([thought,answer('已读取工程。')]);send(client,tid,'这个工程有哪些输入？')
    replayed=[message for message in requests[-1]['messages'] if message['role']=='assistant']
    assert replayed and replayed[0]['reasoning_content']=='先读工程再回答。'
    script.append(answer('仍是同一个工程。'));send(client,tid,'再确认一次。')
    assert all('reasoning_content' in message for message in requests[-1]['messages'] if message['role']=='assistant')
    # 被核验退回重写时，宿主构造的草稿消息同样带上该字段
    script.extend([answer('工程里共有 987654 个输入。'),answer('已读取工程。')]);send(client,tid,'输入有多少？')
    visible=client.app.state.harness.registry.visible(client.app.state.harness.tasks.record(tid))
    assert all(visible[row['function']['name']].kind=='read' for row in requests[-1]['tools'])
    assert all('reasoning_content' in message for message in requests[-1]['messages'] if message['role']=='assistant')


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
    tid,proposal=propose(30)
    change=proposal['changes'][0]
    assert change['unit']=='°C' and change['before']==25 and change['after']==30
    listed=client.get('/api/agent/sessions',params={'workspace_id':w['id']}).json()
    assert [(row['id'],row['title'],row['pending_proposals']) for row in listed]==[(tid,'把地表温度调整为30°C，先给方案。',1)]
    assert client.post('/api/agent/proposals/'+proposal['id']+'/reject').json()=={'status':'rejected'}
    assert client.get('/api/agent/sessions').json()[0]['pending_proposals']==0
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
    script.extend([call('plugin_inspect',{'tool':generated}),call(generated,{'title':'直埋稳态研究','parameters':parameters}),
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


@pytest.mark.parametrize('token_stop',[False,True])
def test_message_budget_reserves_tool_free_answer_and_resets_next_message(client,fake_model,token_stop):
    script,requests=fake_model;w,s=study(client)
    client.app.state.harness.tasks.limits=replace(Limits(),max_tool_calls=12 if token_stop else 1,max_tokens=100000 if token_stop else 262144)
    tid=session(client,w,s)
    first=call('workspace_list')
    if token_stop:first['usage']['prompt_tokens']=80000
    script.extend([first,answer('已读取工程身份，研究结论尚未读取。')])
    events=send(client,tid)
    assert any(kind=='message.delta' for kind,_ in events)
    record=client.get('/api/agent/sessions/'+tid).json()
    assert record['budget']['tool_calls']==1 and len(record['steps'])==1
    assert record['state']=='blocked' and record['waiting_reason']=='budget'
    assert len(requests)==2
    assert 'tools' not in requests[-1] and 'tool_choice' not in requests[-1] and 'parallel_tool_calls' not in requests[-1]
    assert '尚未完成' in ''.join(data['text'] for kind,data in events if kind=='message.delta')
    second=call('study_list')
    if token_stop:second['usage']['prompt_tokens']=80000
    script.extend([second,answer('已读取研究身份，结果仍需读取。')])
    send(client,tid,'继续读取研究。')
    record=client.get('/api/agent/sessions/'+tid).json()
    assert record['budget']['scope']=='message' and record['budget']['tool_calls']==1
    prompt_tokens=80010 if token_stop else 20
    assert record['budget']['prompt_tokens']==prompt_tokens and record['budget']['session_totals']['prompt_tokens']==2*prompt_tokens
    assert len(record['steps'])==2 and len(requests)==4


def test_missing_model_configuration_keeps_status_tools_and_sse_available(client,monkeypatch):
    for name in ('CABLESIM_LLM_BASE_URL','CABLESIM_LLM_MODEL','CABLESIM_LLM_API_KEY'):monkeypatch.delenv(name,raising=False)
    status=client.get('/api/agent/status').json()
    tools=client.get('/api/agent/tools').json()
    assert status=={'configured':False,'model':'deepseek-flash','tools':len(tools)}
    from backend.harness.tool_registry import capability_name
    registry=client.app.state.harness.registry
    expected={capability_name(plugin.manifest.id,cap.id)
        for plugin in client.app.state.research.registry().plugins.values()
        for cap in plugin.manifest.capabilities if cap.input_contract is not None}
    assert {tool['name'] for tool in tools if tool.get('plugin_id')}==expected
    assert {tool['name'] for tool in tools if not tool.get('plugin_id')}=={tool.name for tool in registry.hosts}
    assert len(tools)==len({tool['name'] for tool in tools})
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
    script.extend([call('approve',{'id':'invented'}),call('study_preview'),answer('该能力需要人工确认，尚未执行。')])
    events=send(client,tid)
    record=client.get('/api/agent/sessions/'+tid).json()
    assert record['results'][0]['diagnostics'][0]['code']=='TOOL_NOT_ALLOWED'
    assert record['results'][1]['diagnostics'][0]['code']=='HUMAN_EXECUTION_REQUIRED'
    assert record['state']=='waiting' and record['waiting_reason']=='scope_confirmation'
    assert not any(kind=='proposal.created' for kind,_ in events)
    assert all(tool['name'] not in ('approve','reject','publish','http','shell','ssh') for tool in client.get('/api/agent/tools').json())


def test_unseen_quantities_and_provider_credentials_never_become_messages(client,fake_model):
    script,_=fake_model;w,s=study(client);tid=session(client,w,s)
    script.extend([answer('允许电流为9999 A。'),answer('尚未读取运行结果，没有可引用的允许电流证据。')])
    events=send(client,tid)
    assert any(kind=='message.delta' for kind,_ in events)
    assert next(data['code'] for kind,data in events if kind=='error')=='UNGROUNDED_QUANTITY'
    record=client.get('/api/agent/sessions/'+tid).json()
    assert '9999 A' not in json.dumps(record['messages'],ensure_ascii=False)
    rejection=next(event['data'] for event in record['events'] if event['type']=='answer.rejected')
    assert rejection['draft']=='允许电流为9999 A。' and rejection['issues'][0]['value']==9999
    assert rejection['issues'][0]['unit']=='A' and rejection['issues'][0]['fragment']=='9999 A'
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
