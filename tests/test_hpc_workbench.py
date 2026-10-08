"""Workbench transport regressions; no local solver or SSH execution."""
from uuid import uuid4
import pytest
from backend.kernel.batch_files import atomic,read
from backend.kernel.batch_slurm import SlurmBackend,RemoteDisconnected,allocation_estimate
from backend.plugin_host import PluginHostError
from test_hpc_executor import fixture
from backend.kernel.hpc_executor import HpcExecutor


def test_budget_matches_grouped_allocation_hand_calculation():
    # 10 cases / 3 task slots -> groups 4,4,2; two workers, 3 accounting CPUs.
    result=allocation_estimate({'slurm_parallelism':3,'slurm_cpus_per_task':2,
        'slurm_memory_mb':15000,'slurm_wall_seconds':600},10,{'max_memory_per_cpu_mb':6500})
    assert result['tasks']==3 and result['cpus_per_task']==3
    assert result['wall_seconds']==1200 and result['upper_core_hours']==3


@pytest.mark.parametrize('state',['CANCELLED','TIMEOUT','OUT_OF_MEMORY','NODE_FAIL'])
def test_scheduler_failure_preserves_accounting_without_import(tmp_path,monkeypatch,state):
    executor,directory,plan,_,_,_,remote=fixture(tmp_path,monkeypatch)
    monkeypatch.setattr(remote,'poll',lambda *a:{'terminal':True,'actual_cpu_seconds':123,
        'accounting':[{'JobID':'999_0','State':state}]})
    monkeypatch.setattr(remote,'collect',lambda *a:pytest.fail('Must not import failed allocation'))
    with pytest.raises(PluginHostError) as caught:executor.collect(directory)
    assert caught.value.code=='REMOTE_'+state
    assert read(directory/'execution.json')['actual_cpu_seconds']==123
    assert read(directory/'plan.json')==plan


def test_saved_cancel_intent_is_sent_before_polling(tmp_path,monkeypatch):
    executor,directory,_,_,_,_,remote=fixture(tmp_path,monkeypatch)
    atomic(directory/'cancel-request.json',{'requested':True})
    calls=[]
    monkeypatch.setattr(remote,'cancel',lambda *a:calls.append('cancel'),raising=False)
    executor.collect(directory)
    assert calls==['cancel'] and read(directory/'execution.json')['cancel_requested']


def test_network_loss_keeps_last_job_and_cpu_evidence(tmp_path,monkeypatch):
    atomic(tmp_path/'plan.json',{'id':str(uuid4())})
    atomic(tmp_path/'execution.json',{'job_id':'999','actual_cpu_seconds':42,'slurm_states':['RUNNING']})
    remote=object.__new__(SlurmBackend);remote.root='/cablesim'
    def disconnect(*args):raise RemoteDisconnected('offline')
    monkeypatch.setattr(remote,'call',disconnect)
    with pytest.raises(RemoteDisconnected):remote.poll(tmp_path,str(uuid4()))
    status=read(tmp_path/'execution.json')
    assert status['state']=='disconnected' and status['job_id']=='999' and status['actual_cpu_seconds']==42


@pytest.mark.parametrize('state,expected',[('disconnected',False),('running',False),('collecting',True)])
def test_preflight_retry_requires_confirmed_terminal_failure(tmp_path,state,expected):
    atomic(tmp_path/'execution.json',{'state':state,'slurm_states':['FAILED']})
    assert HpcExecutor.failed_check(tmp_path) is expected


def test_progress_reads_live_scheduler_without_loading_field_archive():
    from contextlib import contextmanager
    from types import SimpleNamespace
    import json
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.kernel.hpc_executor import make_router
    statuses=iter(['running','running','validating'])
    class Database:
        def execute(self,query,parameters):
            assert 'output' not in query
            self.match=parameters==('workspace','study','run')
            return self
        def fetchone(self):
            return {'id':'run','status':next(statuses),'error':None,'snapshot':json.dumps({'definition':{'method':{'plugin_id':'plugin','capability':'field'}}})} if self.match else None
    @contextmanager
    def database():yield Database()
    states=iter(['queued','running','collecting'])
    executor=SimpleNamespace(execution_status=lambda *args:{'backend':'slurm','job_id':'123','state':next(states),'actual_cpu_seconds':3})
    research=SimpleNamespace(store=SimpleNamespace(db=database),executor=executor)
    app=FastAPI();app.include_router(make_router(research))
    with TestClient(app) as client:
        path='/api/workspaces/workspace/studies/study/runs/run/progress'
        assert client.get(path).json()['execution']['state']=='queued'
        assert client.get(path).json()['execution']['state']=='running'
        assert client.get(path).json()['execution']['state']=='validating'
        assert client.get(path.replace('/study/','/other/')).status_code==404


def test_remote_cancellation_replays_receipt_and_waits_for_accounting(tmp_path,monkeypatch):
    import sys
    from contextlib import nullcontext
    from types import SimpleNamespace
    if sys.platform=='win32':monkeypatch.setitem(sys.modules,'fcntl',SimpleNamespace())
    from backend.kernel import batch_remote_agent as agent
    token=str(uuid4());folder=tmp_path/'submissions'/token
    atomic(folder/'submission.json',{'token':token,'job_id':'123'})
    monkeypatch.setattr(agent,'lock',lambda _:nullcontext())
    observed={'terminal':False,'actual_cpu_seconds':12}
    monkeypatch.setattr(agent,'accounting',lambda *_:observed)
    commands=[];monkeypatch.setattr(agent,'command',lambda arguments:commands.append(arguments))
    first=agent.cancel(tmp_path,token)
    assert first['state']=='cancel_requested' and not observed['terminal']
    assert agent.cancel(tmp_path,token)==first and commands==[['scancel','123']]
    observed.update(terminal=True,actual_cpu_seconds=15)
    assert agent.cancel(tmp_path,token)==observed and len(commands)==1
    atomic(folder/'submission.json',{'token':str(uuid4()),'job_id':'123'})
    with pytest.raises(ValueError,match='CANCEL_IDENTITY_MISMATCH'):agent.cancel(tmp_path,token)
    assert len(commands)==1
