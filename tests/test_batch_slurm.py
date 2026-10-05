"""Submission accounting and replay without connecting to a scheduler."""
from uuid import uuid4
from backend.kernel.batch_files import atomic,read
from backend.kernel.batch_slurm import SlurmBackend


def test_memory_derived_cpu_reservation_and_historical_replay(tmp_path,monkeypatch):
    directory=tmp_path/'dataset';identifier=str(uuid4())
    atomic(directory/'plan.json',{'id':identifier,'samples':[{'case_id':'sample'}],
        'execution':{'slurm_parallelism':1,'slurm_wall_seconds':60,'slurm_memory_mb':8192}})
    profile={'ssh_alias':'fixture','remote_root':'/home/fixture/cablesim/jobs','python':'/python',
             'partition':'dg83','max_memory_per_cpu_mb':6500}
    remote=SlurmBackend(profile,tmp_path/'ledger.sqlite')
    monkeypatch.setattr(remote,'stage',lambda _: '/home/fixture/cablesim/jobs/'+identifier)
    monkeypatch.setattr(remote,'ssh',lambda *_args,**_kwargs: '')
    monkeypatch.setattr(remote,'upload',lambda *_args,**_kwargs: '')
    def call(_action,_root,request):
        token=request.split('/')[-2]
        return {'token':token,'job_id':'123','state':'submitted'}
    monkeypatch.setattr(remote,'call',call)
    first=remote.submit(directory,[0])
    reservation=remote.ledger.summary()['reservations'][0]
    assert reservation['estimate_seconds']==120
    remote.ledger.record(first['token'],jobs=['123'],actual_seconds=8,terminal=True)
    remote.configuration['max_memory_per_cpu_mb']=2048
    monkeypatch.setattr(remote,'stage',lambda _: (_ for _ in ()).throw(AssertionError('Must not resubmit')))
    assert remote.submit(directory,[0])==first
    assert len(remote.ledger.summary()['reservations'])==1


def test_zero_allocation_parent_uses_one_step_maximum_and_preserves_raw_rows(tmp_path,monkeypatch):
    import sys
    from types import SimpleNamespace
    # The remote transport lock is Linux-only; this test exercises its portable
    # accounting parser and atomic JSON output without acquiring that lock.
    if sys.platform=='win32':monkeypatch.setitem(sys.modules,'fcntl',SimpleNamespace())
    from backend.kernel import batch_remote_agent as agent
    token=str(uuid4())
    atomic(tmp_path/'submissions'/token/'submission.json',{'job_id':'123','task_count':1,'request':{'indices':[0]}})
    raw='123_0|COMPLETED|1|0|0||None assigned|0:0\n123_0.batch|COMPLETED|1|43|43|1K|node|0:0\n123_0.extern|COMPLETED|1|43|43|1K|node|0:0\n'
    monkeypatch.setattr(agent,'command',lambda _:raw)
    result=agent.accounting(tmp_path,token)
    assert result['terminal'] and result['actual_cpu_seconds']==43
    assert len(result['accounting'])==3 and len(result['accounting_reconciliations'])==1


def test_explicit_parallel_workers_reserve_allocated_cpus_and_rounded_rounds(tmp_path,monkeypatch):
    directory=tmp_path/'dataset';identifier=str(uuid4())
    atomic(directory/'plan.json',{'id':identifier,'samples':[{'case_id':str(i)} for i in range(21)],
        'execution':{'slurm_parallelism':3,'slurm_wall_seconds':60,'slurm_memory_mb':8192,'slurm_cpus_per_task':4}})
    profile={'ssh_alias':'fixture','remote_root':'/home/fixture/cablesim/jobs','python':'/python',
             'partition':'dg83','max_memory_per_cpu_mb':6500}
    remote=SlurmBackend(profile,tmp_path/'ledger.sqlite')
    monkeypatch.setattr(remote,'stage',lambda _: '/home/fixture/cablesim/jobs/'+identifier)
    monkeypatch.setattr(remote,'ssh',lambda *_args,**_kwargs: '')
    monkeypatch.setattr(remote,'upload',lambda *_args,**_kwargs: '')
    monkeypatch.setattr(remote,'call',lambda _a,_r,request:{'token':request.split('/')[-2],'job_id':'123','state':'submitted'})
    saved=remote.submit(directory,list(range(21)))
    assert remote.ledger.summary()['reservations'][0]['estimate_seconds']==3*4*2*60
    assert len(read(directory/'submissions'/saved['token']/'request.json')['task_groups'])==3


def test_group_workers_are_independent_and_bounded_by_allocated_cpus(tmp_path,monkeypatch):
    import os,sys,threading
    from types import SimpleNamespace
    if sys.platform=='win32':monkeypatch.setitem(sys.modules,'fcntl',SimpleNamespace())
    from backend.kernel import batch_remote_agent as agent
    token=str(uuid4());folder=tmp_path/'submissions'/token
    atomic(folder/'submission.json',{'request':{'profile':{'python':'python'}}})
    atomic(folder/'groups.json',[[0,1]])
    atomic(tmp_path/'plan.json',{'execution':{'sample_timeout_s':1,'slurm_cpus_per_task':2}})
    monkeypatch.setenv('SLURM_ARRAY_TASK_ID','0');monkeypatch.setenv('SLURM_CPUS_PER_TASK','2')
    barrier=threading.Barrier(2);calls=[]
    class Process:
        returncode=0
        def __init__(self,args,**kwargs):calls.append((args,kwargs))
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def communicate(self,**kwargs):barrier.wait(timeout=3);return b'',b''
    monkeypatch.setattr(agent.subprocess,'Popen',Process)
    result=agent.run_group(tmp_path,token)
    assert result['failures']==[] and len(calls)==2
    assert {args[-1] for args,_ in calls}=={'0','1'}
    assert all(kwargs['start_new_session'] for _,kwargs in calls)
    monkeypatch.setenv('SLURM_CPUS_PER_TASK','1')
    import pytest
    with pytest.raises(ValueError,match='actual Slurm CPU'):agent.run_group(tmp_path,token)
