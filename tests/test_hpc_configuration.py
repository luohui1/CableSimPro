"""Configuration lifecycle and read-only SSH probes; no network or solver."""
from contextlib import nullcontext
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
from uuid import uuid4

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from backend.kernel.batch_budget import BudgetExceeded, BudgetLedger
from backend.kernel.batch_files import atomic, read
from backend.kernel.hpc_executor import HpcExecutor
from backend.kernel.hpc_jobs import make_router
from backend.kernel.hpc_profile import HpcProfile, revision, ssh_aliases


@pytest.fixture
def configuration_api(tmp_path, monkeypatch):
    home=tmp_path/'user';config=home/'.ssh/config';config.parent.mkdir(parents=True)
    config.write_text('Host cluster\n HostName never-connect.example\n IdentityFile private-secret\nInclude aliases/*\n',encoding='utf-8')
    included=config.parent/'aliases/hosts';included.parent.mkdir()
    included.write_text('Host=other\nHost * wildcard?\n',encoding='utf-8')
    monkeypatch.setattr(Path,'home',classmethod(lambda cls:home))
    monkeypatch.setattr('backend.kernel.hpc_jobs.ROOT',tmp_path)
    def forbidden(*args,**kwargs):raise AssertionError('No SSH, DB preparation or solver')
    monkeypatch.setattr('backend.kernel.hpc_profile.subprocess.run',forbidden)
    registry=SimpleNamespace(plugins={'example.method':SimpleNamespace(manifest=SimpleNamespace(capabilities=[
        SimpleNamespace(id='native',solver='slurm'),SimpleNamespace(id='algebra',solver='local')]))})
    executor=HpcExecutor(SimpleNamespace(registry=registry),profile=tmp_path/'.data/hpc/config.json',
                         root=tmp_path/'jobs',ledger=tmp_path/'budget.sqlite')
    research=SimpleNamespace(executor=executor,store=SimpleNamespace(db=forbidden),prepare=forbidden)
    app=FastAPI();app.include_router(make_router(research))
    with TestClient(app) as client:yield client,executor,config
    assert not executor.root.exists() and not executor.ledger.exists()


def request(revision='missing',**changes):
    return {'ssh_alias':'cluster','partition':'dg83','remote_workdir':'/home/engineer/cablesim',
            'environment':{'kind':'conda','path':'/home/engineer/env'},'budget_core_hours':20.,
            'total_budget_core_hours':200.,'expected_revision':revision,**changes}


def test_existing_aliases_and_save_backup_undo_exact_bytes(configuration_api):
    client,executor,config=configuration_api
    initial=client.get('/api/hpc/profile/configuration').json()
    assert not initial['configured'] and initial['revision']=='missing'
    assert initial['ssh_aliases']==['cluster','other']
    assert 'private-secret' not in json.dumps(initial)
    first=client.put('/api/hpc/profile',json=request());assert first.status_code==200
    assert first.json()['configured'] and not first.json()['connection_checked']
    value=read(executor.profile)
    assert value['remote_root']=='/home/engineer/cablesim/jobs'
    assert value['python']=='/home/engineer/env/bin/python'
    assert value['remote_capabilities']=={'example.method':['native']}
    before=executor.profile.read_bytes()
    saved=client.put('/api/hpc/profile',json=request(first.json()['revision'],partition='other-partition')).json()
    reloaded=client.get('/api/hpc/profile/configuration').json()
    assert reloaded['undo_token']==saved['undo_token'] and reloaded['revision']==saved['revision']
    assert reloaded['configuration']['partition']=='other-partition'
    folder=executor.profile.parent/'backups'/saved['undo_token']
    assert (folder/'config.json').read_bytes()==before
    assert client.put('/api/hpc/profile',json=request(first.json()['revision'])).status_code==409
    undone=client.post('/api/hpc/profile/undo',json={'undo_token':saved['undo_token'],'expected_revision':saved['revision']})
    assert undone.status_code==200 and executor.profile.read_bytes()==before
    assert client.post('/api/hpc/profile/undo',json={'undo_token':saved['undo_token'],'expected_revision':saved['revision']}).status_code==409
    assert (folder/'replaced.json').is_file()
    assert client.post('/api/hpc/profile/undo',json={'undo_token':first.json()['undo_token'],'expected_revision':first.json()['revision']}).status_code==200
    assert not executor.profile.exists()


@pytest.mark.parametrize('changes',[
    {'ssh_alias':'not-registered'},{'ssh_alias':'-oProxyCommand=x'},
    {'remote_workdir':'/home/a/../b'},{'remote_workdir':'~/cablesim'},
    {'partition':'dg83;sbatch'},{'password':'secret'}, {'private_key_path':'/secret'},
    {'environment':{'kind':'conda','path':'/env','PASSWORD':'secret'}},
    {'environment':{'kind':'singularity','path':'/image.sif'}},
    {'budget_core_hours':2001.},{'budget_core_hours':True},{'total_budget_core_hours':20001.},
    {'budget_core_hours':100.,'total_budget_core_hours':20.},
])
def test_invalid_or_secret_configuration_is_rejected_without_write(configuration_api,changes):
    client,executor,_=configuration_api
    response=client.put('/api/hpc/profile',json=request(**changes))
    assert response.status_code==422 and not executor.profile.exists()
    assert 'secret' not in response.text


def test_undo_refuses_changed_or_corrupt_backup(configuration_api):
    client,executor,_=configuration_api
    atomic(executor.profile,{'invalid':'opaque-old-file'})
    saved=client.put('/api/hpc/profile',json=request(revision(executor.profile))).json()
    folder=executor.profile.parent/'backups'/saved['undo_token'];(folder/'config.json').write_text('{}')
    assert client.post('/api/hpc/profile/undo',json={'undo_token':saved['undo_token'],'expected_revision':saved['revision']}).status_code==409
    atomic(executor.profile,{'changed':True})
    assert client.post('/api/hpc/profile/undo',json={'undo_token':saved['undo_token'],'expected_revision':saved['revision']}).status_code==409
    assert read(executor.profile)=={'changed':True}


def test_external_profile_is_read_only(configuration_api):
    client,executor,_=configuration_api;executor.profile=executor.profile.parent/'administrator.json'
    assert not client.get('/api/hpc/profile/configuration').json()['editable']
    assert client.put('/api/hpc/profile',json=request()).status_code==409


def test_python_environment_prefix_is_explicit_not_guessed(configuration_api):
    client,executor,_=configuration_api
    response=client.put('/api/hpc/profile',json=request(environment={'kind':'python','path':'/home/engineer/venv'}))
    assert response.status_code==200
    assert read(executor.profile)['python']=='/home/engineer/venv/bin/python'
    assert read(executor.profile)['environment']['kind']=='python'


@pytest.mark.parametrize('output,code,expected',[
    ('partition=yes\ndirectory=yes\nenvironment=yes\n',0,'ready'),
    ('partition=no\ndirectory=no\nenvironment=yes\n',0,'unavailable'),
    ('scheduler=unavailable\ndirectory=yes\nenvironment=no\n',0,'unavailable'),
    ('permission denied secret-host',255,'unreachable'),
    ('remote shell failed secret-host',2,'check_failed'),
])
def test_only_explicit_check_opens_one_readonly_connection(configuration_api,monkeypatch,output,code,expected):
    client,executor,_=configuration_api
    client.put('/api/hpc/profile',json=request());calls=[]
    def fake(args,**kwargs):
        calls.append((args,kwargs));return SimpleNamespace(returncode=code,stdout=output,stderr=output)
    monkeypatch.setattr('backend.kernel.hpc_profile.subprocess.run',fake)
    for path in ('/api/hpc/profile','/api/hpc/profile/configuration'):assert client.get(path).status_code==200
    assert not calls
    response=client.post('/api/hpc/profile/check');assert response.status_code==200
    assert response.json()['status']==expected and 'secret-host' not in response.text
    assert len(calls)==1
    args,options=calls[0];assert args[0]=='ssh' and 'BatchMode=yes' in args and 'StrictHostKeyChecking=yes' in args
    assert options['timeout']==20
    command=args[-1]
    assert 'sinfo -p dg83' in command and 'test -w' in command
    assert all(token not in command for token in ('sbatch','mkdir','touch','chmod'))


def test_timeout_and_not_configured_are_explicit(configuration_api,monkeypatch):
    client,executor,_=configuration_api
    assert client.post('/api/hpc/profile/check').json()['status']=='not_configured'
    client.put('/api/hpc/profile',json=request())
    def timeout(*args,**kwargs):raise subprocess.TimeoutExpired('ssh',20)
    monkeypatch.setattr('backend.kernel.hpc_profile.subprocess.run',timeout)
    assert client.post('/api/hpc/profile/check').json()['status']=='timeout'
    assert executor.profile.exists()


def test_configured_limits_are_atomic_and_replay_remains_possible(tmp_path):
    ledger=BudgetLedger(tmp_path/'ledger.sqlite')
    with pytest.raises(BudgetExceeded):ledger.reserve('too-large',tasks=1,cpus_per_task=1,wall_seconds=3600,single_limit_core_hours=.5)
    ledger.reserve('one',tasks=1,cpus_per_task=1,wall_seconds=1800,total_limit_core_hours=.5)
    with pytest.raises(BudgetExceeded):ledger.reserve('two',tasks=1,cpus_per_task=1,wall_seconds=1,total_limit_core_hours=.5)
    assert ledger.reserve('one',tasks=1,cpus_per_task=1,wall_seconds=1800,single_limit_core_hours=.1)['token']=='one'


def test_connection_change_does_not_strand_unsettled_jobs(tmp_path):
    config=tmp_path/'ssh-config';config.write_text('Host cluster\n')
    executor=HpcExecutor(SimpleNamespace(registry=None),profile=tmp_path/'config.json',ledger=tmp_path/'ledger.sqlite')
    editor=HpcProfile(executor,ssh_config=config)
    first=editor.save(request())
    ledger=BudgetLedger(executor.ledger);ledger.reserve('live',tasks=1,cpus_per_task=1,wall_seconds=10)
    before=executor.profile.read_bytes()
    with pytest.raises(HTTPException) as error:editor.undo({'undo_token':first['undo_token'],'expected_revision':revision(executor.profile)})
    assert error.value.status_code==409 and executor.profile.read_bytes()==before
    with pytest.raises(HTTPException) as error:editor.save(request(revision(executor.profile),partition='other'))
    assert error.value.status_code==409 and executor.profile.read_bytes()==before
    editor.save(request(revision(executor.profile),budget_core_hours=15.))
    ledger.record('live',jobs=[],actual_seconds=0,terminal=True)
    editor.save(request(revision(executor.profile),partition='other'))
    assert read(executor.profile)['partition']=='other'


def test_profile_changed_after_transport_creation_cannot_submit(tmp_path,monkeypatch):
    from backend.kernel.batch_slurm import SlurmBackend
    profile=tmp_path/'config.json'
    value={'ssh_alias':'cluster','remote_root':'/workspace/jobs','python':'/env/bin/python','partition':'dg83'}
    atomic(profile,value)
    remote=SlurmBackend(profile,tmp_path/'ledger.sqlite')
    directory=tmp_path/'run'
    atomic(directory/'plan.json',{'id':str(uuid4()),'samples':[{'case_id':'one'}],
           'execution':{'slurm_parallelism':1,'slurm_wall_seconds':60,'slurm_memory_mb':512}})
    atomic(profile,{**value,'partition':'changed'})
    monkeypatch.setattr(remote,'stage',lambda *_:pytest.fail('Changed configuration must not stage or submit'))
    with pytest.raises(ValueError,match='配置已变化'):remote.submit(directory,[0])
    assert remote.ledger.summary()['reservations']==[]


@pytest.mark.parametrize('solver,selected,configured,location',[
    ('local',False,False,'local'),('slurm',False,False,'slurm'),
    ('slurm',True,True,'slurm'),('either',False,True,'local'),('either',True,True,'slurm')])
def test_study_availability_uses_capability_not_plugin_process(solver,selected,configured,location):
    executor=SimpleNamespace(profile_status=lambda:{'configured':configured,'remote_plugins':['method'] if selected else [],'remote_capabilities':{}},
        registry=SimpleNamespace(get=lambda _:SimpleNamespace(manifest=SimpleNamespace(capability=lambda _:SimpleNamespace(solver=solver)))))
    research=SimpleNamespace(executor=executor,registry=lambda _:executor.registry,store=SimpleNamespace(db=lambda:nullcontext(None)),
                             definition=lambda *_:{'definition':{'method':{'plugin_id':'method','capability':'solve'}}})
    app=FastAPI();app.include_router(make_router(research))
    with TestClient(app) as client:response=client.get(f'/api/hpc/workspaces/{uuid4()}/studies/{uuid4()}/availability')
    assert response.status_code==200 and response.json()['location']==location
    assert response.json()['local_solver_allowed']==(solver!='slurm')


def test_remote_agent_workspace_guard_follows_installed_and_frozen_location(tmp_path,monkeypatch):
    import sys
    if sys.platform=='win32':monkeypatch.setitem(sys.modules,'fcntl',SimpleNamespace())
    from backend.kernel import batch_remote_agent as agent
    workdir=tmp_path/'deployment';root=workdir/'jobs'/str(uuid4())
    for source in (workdir/'bin/cablesim-remote.py',root/'submissions'/str(uuid4())/'agent.py'):
        monkeypatch.setattr(agent,'__file__',str(source));assert agent.validate_root(str(root))==root
        with pytest.raises(ValueError):agent.validate_root(str(tmp_path/'other'/str(uuid4())))


def test_unreadable_capability_is_actionable_and_keeps_saved_results():
    def missing(_):raise KeyError('internal-capability-identifier')
    registry=SimpleNamespace(get=lambda _:SimpleNamespace(manifest=SimpleNamespace(capability=missing)))
    executor=SimpleNamespace(profile_status=lambda:{'configured':False,'remote_plugins':[],'remote_capabilities':{}})
    research=SimpleNamespace(executor=executor,registry=lambda _:registry,store=SimpleNamespace(db=lambda:nullcontext(None)),
        definition=lambda *_:{'definition':{'method':{'plugin_id':'internal-method','capability':'missing'}}})
    app=FastAPI();app.include_router(make_router(research))
    with TestClient(app) as client:response=client.get(f'/api/hpc/workspaces/{uuid4()}/studies/{uuid4()}/availability')
    assert response.status_code==409 and '保存结果保留' in response.json()['detail']
    assert 'internal-' not in response.text
