"""Only the new context, draft-preview and startup behavior introduced this round."""
from copy import deepcopy
from collections import OrderedDict
import json
from threading import Event
from time import perf_counter

from fastapi.testclient import TestClient
import pytest

from test_harness import fake_model,session,send,call,answer
from test_research import client,study,request


def test_model_result_is_bounded_explicit_and_full_step_is_durable(client,fake_model):
    from backend.harness.context_builder import compress_result,encoded
    script,requests=fake_model
    w=client.post('/api/workspaces',json={}).json();tid=session(client,w)
    harness=client.app.state.harness
    original=harness.broker.dispatch
    def large(*args):
        result=original(*args)
        result.data['large_source']=[{'label':'完整来源中文说明','value':i,'unit':'1'} for i in range(500)]
        return result
    harness.broker.dispatch=large
    script.extend([call('workspace_list'),answer('已读取工程身份。')])
    send(client,tid)
    record=client.get('/api/agent/sessions/'+tid).json()
    full=record['steps'][0]['result'];assert len(full['data']['large_source'])==500
    observation=json.loads(next(row['content'] for row in requests[-1]['messages'] if row['role']=='tool'))
    assert len(encoded(observation))<=6*1024 and observation['truncated'] is True
    assert observation['reason']=='已截断，可按 paths / key 继续读取'
    assert compress_result(full)==observation
    # SQLite canonical encoding sorts keys: headlines must survive large cases.
    source={'status':'ok','summary':'合成压缩样例','data':{'cases':[{'payload':'x'*1000} for _ in range(50)],
        'headlines':[{'key':'ampacity','value':123,'unit':'A'}]}}
    projected=compress_result(json.loads(json.dumps(source,sort_keys=True)))
    assert projected['data']['headlines']==source['data']['headlines'] and len(encoded(projected))<=6*1024


def test_domain_proposal_preview_uses_changed_rho_and_keeps_saved_input(client,fake_model,monkeypatch):
    from backend.kernel.workspace import fingerprint
    script,requests=fake_model;w,s=study(client)
    document=deepcopy(s['definition']['method_input'])
    next(value for value in document['materials'] if value['category']=='soil')['thermal_resistivity']=1.0
    # Save this real teaching input as the engineering domain through the ordinary editor.
    conversion=client.post(f'/api/workspaces/{w["id"]}/domain/conversion',json={'expected_revision':w['revision']})
    assert conversion.status_code==200,conversion.text
    w=client.get('/api/workspaces/'+w['id']).json()
    saved=client.put(f'/api/workspaces/{w["id"]}/domain',json={'expected_revision':w['revision'],'document':document})
    assert saved.status_code==200,saved.text
    w=client.get('/api/workspaces/'+w['id']).json()
    definition={**s['definition'],'input_source':'domain','method_input':None}
    updated=client.put(f'/api/workspaces/{w["id"]}/studies/{s["id"]}',json={**definition,'expected_revision':w['revision'],'expected_study_revision':s['revision']})
    assert updated.status_code==200,updated.text
    s=updated.json();tid=session(client,w,s);harness=client.app.state.harness
    soil=next(value for value in document['materials'] if value['category']=='soil')
    path='/materials/'+soil['id'].replace('/','~1')+'/thermal_resistivity'
    original=harness.model.reply
    preview_inputs=[];executor=client.app.state.research.executor;run=executor.run
    def observed_run(*args,**kwargs):
        preview_inputs.append(deepcopy(args[2][0]))
        return run(*args,**kwargs)
    monkeypatch.setattr(executor,'run',observed_run)
    def next_reply(*args):
        if len(requests)==2:
            proposals=harness.tasks.record(tid)['proposals']
            script.append(call('study_preview',{'proposal_id':proposals[0]['id']}) if proposals else answer('方案未生成，请查看诊断。'))
        if len(requests)==3:script.append(answer('方案已生成并完成快速预览；尚未保存或批准。'))
        return original(*args)
    monkeypatch.setattr(harness.model,'reply',next_reply)
    script.extend([call('workspace_read'),call('propose_domain_changes',{'changes':[{'path':path,'value':1.2,'unit':'K·m/W'}]})])
    events=send(client,tid,'解释研究结论，把土壤热阻率改为1.2 K·m/W，给出方案并试算。')
    assert [value['status'] for kind,value in events if kind=='tool.result']==['ok','ok','ok'],json.dumps(harness.tasks.record(tid)['results'],ensure_ascii=True)
    record=harness.tasks.record(tid);change=next(row for row in record['proposals'][0]['changes'] if row['path']==path)
    assert change['before']==1.0 and change['after']==1.2 and change['unit']=='K·m/W'
    preview_case=preview_inputs[-1]
    assert next(value for value in preview_case['input']['materials'] if value['id']==soil['id'])['thermal_resistivity']==1.2
    result=record['steps'][-1]['result']
    assert result['data']['input_digest']==fingerprint({'input':preview_case['input'],'parameters':preview_case['parameters']})
    assert result['data']['persisted'] is False and result['data']['headlines']
    after=client.get(f'/api/workspaces/{w["id"]}/domain').json()
    assert after['revision']==w['revision']
    assert next(value for value in after['document']['materials'] if value['id']==soil['id'])['thermal_resistivity']==1.0
    # A verified run from another module must still be refused before replay.
    from fastapi import HTTPException
    with harness.research.store.db() as db:task=harness.tasks.load(db,tid)
    with monkeypatch.context() as patch:
        patch.setattr(harness.research,'get_run',lambda *args:{'study':s['id'],'integrity':'verified',
            'freshness':'current','snapshot':{'module':'other'}})
        with pytest.raises(HTTPException,match='409') as refused:
            harness.proposals.preview_inputs(task,s['id'],None,None,'metadata-only-run','case')
        assert '研究模块' in str(refused.value.detail)


def test_manifest_byte_cache_reuses_validation_isolates_mutation_and_checks_files(monkeypatch):
    import backend.plugin_host.registry as registry
    monkeypatch.setattr(registry,'_MANIFESTS',OrderedDict())
    raw=(registry.PLUGINS/'cablesim.iec60287/plugin.json').read_bytes()
    original=registry.Manifest.model_validate;calls=[]
    def validate(value):calls.append(value);return original(value)
    monkeypatch.setattr(registry.Manifest,'model_validate',validate)
    first=registry.validated_manifest(raw)
    first.files.clear()
    second=registry.validated_manifest(raw)
    assert second.files and len(calls)==1
    changed=json.loads(raw);changed['description']+='缓存失效验证'
    assert registry.validated_manifest(json.dumps(changed).encode()).description.endswith('缓存失效验证')
    assert len(calls)==2
    with pytest.raises(Exception):registry.validated_manifest(b'{}')
    assert len(registry._MANIFESTS)==2
    registry.Registry(plugin_id='cablesim.iec60287').get('cablesim.iec60287').verify()


def test_health_is_ready_while_warmup_is_blocked_and_shutdown_joins(tmp_path,monkeypatch):
    from backend.main import create_app
    from backend.kernel.research import Research
    entered=Event();exited=Event()
    def warm(self,stop):
        entered.set();stop.wait(10);exited.set()
    monkeypatch.setattr(Research,'warm_reads',warm)
    started=perf_counter()
    with TestClient(create_app(tmp_path/'warm.sqlite')) as current:
        assert entered.wait(2)
        assert current.get('/api/health').status_code==200
        assert not exited.is_set() and perf_counter()-started<5
    assert exited.is_set()
