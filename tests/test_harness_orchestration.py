"""Human recipes, per-turn reading limits and actionable old-baseline refusal."""
from copy import deepcopy
from dataclasses import replace
import json
from time import perf_counter

from backend.harness.contracts import Limits
from backend.harness.evidence import quantity_facts
from backend.harness.project_digest import study_baseline
from test_harness import fake_model,session,send,call,answer
from test_harness_recipes import final_text,metrics
from test_harness_resilience import saved_run
from test_research import client


def test_host_recipe_pages_before_one_answer_validates_and_preserves_thinking(client,fake_model):
    w,s,run=saved_run(client);h=client.app.state.harness;tid=session(client,w)
    created=client.post(f'/api/workspaces/{w["id"]}/studies',json={**s['definition'],
        'title':'尚未运行的研究','expected_revision':w['revision']})
    assert created.status_code==201,created.text
    from backend.harness.evidence import run_points
    facts=quantity_facts([{'data':run_points(h.research,run)}])
    value=next(f['value'] for f in facts if f['key']=='ampacity' and f['headline'])
    text=f'保存允许电流{value:.4g} A，限制对象以保存导体为准；另一研究尚未运行。'
    script,requests=fake_model;reply=answer(text);reply['choices'][0]['message']['reasoning_content']='保留这段原始思考。'
    script.append(reply);started=perf_counter()
    events=send(client,tid,'汇总各研究的载流量结论和限制因素',{'id':'conclusion_summary','parameters':{'limit':1}})
    audit=h.tasks.record(tid)
    assert final_text(events)==text and audit['budget']['model_requests']==1 and audit['budget']['tool_calls']==2
    assert not requests[0].get('tools')
    observed=[e['sequence'] for e in audit['events'] if e['type']=='tool.observation']
    assert max(observed)<next(e['sequence'] for e in audit['events'] if e['type']=='model.request')
    assert all(e['data']['source']=='host' for e in audit['events'] if e['type']=='recipe.compiled')
    assert not any(e['type'] in ('answer.fallback','answer.rejected') for e in audit['events'])
    print('\n宿主汇总 '+json.dumps({**metrics(audit,perf_counter()-started),'answer':text},ensure_ascii=False))
    # Invalid recipe parameters stop before acquiring a turn or running tools.
    before=len(audit['events'])
    invalid=client.post(f'/api/agent/sessions/{tid}/messages',json={'content':'对比',
        'recipe':{'id':'proposal_comparison','parameters':{'changes':[{'path':'/soil','value':1.2}]}}})
    assert invalid.status_code==422 and invalid.json()['detail']['path']=='/recipe/parameters/scope'
    assert len(h.tasks.record(tid)['events'])==before
    # A fabricated quantity is still rejected and repaired without business tools.
    script.extend([answer('保存允许电流9999 A。'),answer(text)])
    events=send(client,tid,'继续汇总',{'id':'conclusion_summary','parameters':{}});audit=h.tasks.record(tid)
    assert final_text(events)==text and audit['budget']['model_requests']==2
    assert requests[-2]['messages'][0]['role']=='system' and not requests[-2].get('tools') and not requests[-1].get('tools')
    assert any(m.get('reasoning_content')=='保留这段原始思考。' for m in requests[-1]['messages'])
    assert any(e['type']=='answer.rejected' and '9999' in e['data']['draft'] for e in audit['events'])
    assert not any(e['type']=='answer.fallback' for e in audit['events'])


def test_free_read_limit_and_complete_digest_disable_next_tools_per_turn(client,fake_model,monkeypatch):
    monkeypatch.setenv('CABLESIM_AGENT_MAX_READ_TOOL_CALLS','2')
    assert Limits.configured().max_read_tool_calls==2
    w,s,run=saved_run(client);h=client.app.state.harness;h.tasks.limits=replace(h.tasks.limits,max_read_tool_calls=2)
    tid=session(client,w,s);script,requests=fake_model
    text='已按保存证据说明工况；具体输入细节尚未展开，可继续追问。'
    script.extend([call('study_read',{'run_id':run['id']}),call('run_read',{'run_id':run['id']}),answer(text)])
    started=perf_counter();events=send(client,tid);audit=h.tasks.record(tid)
    assert final_text(events)==text and audit['budget']['tool_calls']==2 and audit['budget']['model_requests']==3
    assert requests[0].get('tools') and requests[1].get('tools') and not requests[2].get('tools')
    policy=next(e['data'] for e in audit['events'] if e['type']=='turn.answer_only')
    assert policy['reason']=='read_limit' and policy['read_tool_calls']==2 and policy['max_read_tool_calls']==2
    assert not any(e['type']=='answer.fallback' for e in audit['events'])
    print('\n自由读取 '+json.dumps(metrics(audit,perf_counter()-started),ensure_ascii=False))
    script.extend([call('project_digest'),answer('摘要已覆盖保存研究，详细输入尚未展开。')])
    send(client,tid,'汇总各研究的载流量结论和限制因素');audit=h.tasks.record(tid)
    assert audit['budget']['model_requests']==2 and audit['budget']['tool_calls']==1 and not requests[-1].get('tools')
    assert [e['data']['reason'] for e in audit['events'] if e['type']=='turn.answer_only'][-1]=='summary_covered'
    # An empty tail page does not prove that earlier studies were read.
    script.extend([call('project_digest',{'after':1000000}),call('project_digest'),answer('摘要已覆盖保存研究。')])
    send(client,tid,'汇总各研究的载流量结论和限制因素');audit=h.tasks.record(tid)
    assert audit['budget']['model_requests']==3 and audit['budget']['tool_calls']==2
    assert requests[-2].get('tools') and not requests[-1].get('tools')
    assert [e['data']['reason'] for e in audit['events'] if e['type']=='turn.answer_only'][-1]=='summary_covered'


def test_stale_baseline_has_reasons_workbench_actions_and_no_proposal_or_preview(client,fake_model,monkeypatch):
    w,s,run=saved_run(client);h=client.app.state.harness
    changed=client.post(f'/api/workspaces/{w["id"]}/edit',json={'expected_revision':w['revision'],
        'changes':[{'path':'installation.depth_m','value':1.1}]})
    assert changed.status_code==200,changed.text
    tid=session(client,w,s);get=h.research.get_run
    def old_method(*args,**kwargs):
        value=get(*args,**kwargs)
        value['version_status']={'status':'stale','reasons':[{'code':'METHOD_VERSION_CHANGED','kind':'method',
            'id':run['snapshot']['definition']['method']['plugin_id'],'from_version':'1.0.0','to_version':'1.0.1',
            'message':'保存结果所用插件方法版本已变化'}]}
        return value
    monkeypatch.setattr(h.research,'get_run',old_method)
    execute=h.broker.dispatch;executed=[]
    def track(*args):executed.append(args[2].name);return execute(*args)
    monkeypatch.setattr(h.broker,'dispatch',track)
    script,requests=fake_model
    text='保存基准因插件方法版本和工程输入修订变化而过期。请在工作台核对方法与工况，人工重算并保存正常运行；随后新建当前研究会话，再请求方案试算对比。本次方案与试算尚未执行。'
    recipe={'id':'proposal_comparison','parameters':{'scope':'parameters',
        'changes':[{'path':'/soil_thermal_resistivity','value':1.2,'unit':'K·m/W'}]}}
    script.append(answer(text));started=perf_counter();events=send(client,tid,'把土壤热阻率改成 1.2 K·m/W，给方案并试算',recipe)
    audit=h.tasks.record(tid);first=audit['results'][0];details=first['diagnostics'][0]['details']
    assert {r['code'] for r in details['reasons']} >= {'METHOD_VERSION_CHANGED','INPUT_REVISION_CHANGED'}
    assert details['latest_run']['id']==run['id'] and details['available_runs'][0]['freshness']=='historical'
    assert details['actions'][0]['id']=='rerun_study' and details['actions'][0]['requires_human']
    assert not details['stale_reference_allowed'] and not details['preview_executed']
    assert executed==['study_baseline'] and len(audit['steps'])==3 and not audit['proposals']
    assert audit['state']=='waiting' and audit['waiting_reason']=='missing_input'
    assert final_text(events)==text and audit['budget']['model_requests']==1 and not requests[0].get('tools')
    assert next(data for kind,data in events if kind=='tool.result')['diagnostics'][0]['details']==details
    assert not any(e['type']=='answer.fallback' for e in audit['events'])
    print('\n过期基准 '+json.dumps({**metrics(audit,perf_counter()-started),'answer':text},ensure_ascii=False))
    partial=deepcopy(run);partial['status']='partial';partial['freshness']='historical'
    monkeypatch.setattr(h.research,'get_run',lambda *a,**k:partial)
    diagnostic=study_baseline(h.research,audit,{}).diagnostics[0]
    assert any(r['code']=='PARTIAL_SUCCESS' for r in diagnostic.details['reasons'])
    # Even an exhausted explanation repair returns the actionable host diagnosis,
    # not a generic evidence-failure phrase or a fabricated engineering value.
    monkeypatch.setattr(h.research,'get_run',old_method)
    script.extend(answer('试算允许电流9999 A。') for _ in range(4))
    events=send(client,tid,'继续方案试算',recipe);audit=h.tasks.record(tid)
    assert '工作台重算' in final_text(events) and '9999' not in final_text(events) and '以下为工具证据摘要' not in final_text(events)
    assert any(e['type']=='answer.diagnostic' for e in audit['events'])
    assert not audit['proposals'] and executed==['study_baseline','study_baseline']
    def pressure(*args,**kwargs):raise MemoryError()
    monkeypatch.setattr(h.model,'reply',pressure)
    events=send(client,tid,'继续方案试算',recipe)
    assert '工作台重算' in final_text(events) and '以下为工具证据摘要' not in final_text(events)
    assert not h.tasks.record(tid)['proposals'] and executed[-1]=='study_baseline'
