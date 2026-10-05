"""Task admission, asynchronous polling and repeat-click behavior without a solver."""
from threading import Event
import time
from uuid import uuid4
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.plugin_host import Executor, PluginHostError
from backend.plugin_host.executor import CaseResult, RunResult
from simulation_fixtures import domain, transient_parameters


def test_simulation_task_polling_duplicate_click_and_timeout_keep_input(tmp_path):
    app=create_app(tmp_path/'tasks.sqlite');executor=Executor();app.state.research.executor=executor
    entered,release=Event(),Event();calls=[]
    def check(plugin,capability,cases,**kwargs):
        return RunResult('check',plugin,'test',capability,'test','0'*64,{},[CaseResult(c['case_id'],'succeeded',[],{}, {}, []) for c in cases])
    def run(plugin,capability,cases,**kwargs):
        calls.append(capability);entered.set();release.wait(10)
        raise PluginHostError('WORKER_TIMEOUT','求解超时；输入与作业标识已保留。',503)
    executor.check=check;executor.run=run
    with TestClient(app) as client:
        w=client.post('/api/workspaces',json={}).json();root='/api/workspaces/'+w['id']
        tasks=client.get('/api/study-tasks').json()
        assert {t['task'] for t in tasks}=={'transient-temperature','sheath-losses','electrothermal-steady'}
        selected=next(t for t in tasks if t['task']=='transient-temperature')
        value=domain();config={'title':'Transient objective','task':selected['task'],'method':selected['method'],
            'input_source':'study','method_input':value,'parameters':transient_parameters(value)}
        bad={**config,'task':'sheath-losses','expected_revision':1}
        # Give the alternate task a complete parameter shape to reach the capability check.
        from simulation_fixtures import electromagnetic_parameters
        bad['parameters']=electromagnetic_parameters(domain(True))
        assert client.post(root+'/studies',json=bad).json()['detail']['code']=='TASK_CAPABILITY_MISMATCH'
        from copy import deepcopy
        malformed=deepcopy(config);malformed['parameters']['time']['step_s']='0.1'
        rejected=client.post(root+'/studies',json={**malformed,'expected_revision':1})
        assert rejected.status_code==422 and 'parameters.time.step_s' in rejected.text
        s=client.post(root+'/studies',json={**config,'expected_revision':1,'modules':{'transient-temperature':config}}).json()
        sroot=root+'/studies/'+s['id'];query={'expected_revision':1,'expected_study_revision':1,'module':'transient-temperature'}
        pre=client.get(sroot+'/preflight',params=query).json()
        body={**query,'request_id':str(uuid4()),'lock_digest':pre['lock_digest'],'scope_acknowledged':True}
        first=client.post(sroot+'/runs',json=body)
        assert first.status_code==202 and first.headers['retry-after']=='2',first.text
        rid=first.json()['id'];assert entered.wait(5)
        assert client.get(first.headers['location']).json()['status']=='running'
        assert client.post(sroot+'/runs',json=body).json()['id']==rid
        assert len(calls)==1
        release.set()
        for _ in range(100):
            result=client.get(first.headers['location']).json()
            if result['status']=='failed':break
            time.sleep(.02)
        assert result['status']=='failed' and result['error']['code']=='WORKER_TIMEOUT'
        assert result['snapshot']['module']=='transient-temperature'
        assert result['snapshot']['cases'][0]['input']==value
        saved=client.get(root).json()
        assert saved['revision']==w['revision'] and saved['scenario']==w['scenario']
        changed=client.put(sroot,json={**config,'expected_revision':1,'expected_study_revision':1,'modules':{}})
        assert changed.status_code==200,changed.text
        replay=client.post(sroot+'/runs',json=body)
        assert replay.status_code==200 and replay.json()['id']==rid and replay.json()['freshness']=='historical'
        assert len(calls)==1
