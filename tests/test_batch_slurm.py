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
