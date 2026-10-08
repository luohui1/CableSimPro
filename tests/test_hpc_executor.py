"""Frozen research transport failure/reconnection/binding, without remote solvers."""
from copy import deepcopy
import gzip
from hashlib import sha256
from uuid import uuid4
from pathlib import Path
import pytest
from backend.kernel.batch_files import atomic,digest,encoded,read
from backend.kernel.hpc_executor import HpcExecutor,request_digest
from backend.kernel.batch_slurm import RemoteDisconnected
from backend.plugin_host import PluginHostError


def fixture(tmp_path,monkeypatch):
    manifest={'id':'fixture','version':'1.2.3','resources':{'timeout_s':30,'memory_mb':512},
              'capabilities':[{'id':'field','method_version':'method/7','input_schema':'cablesim.domain/1'}]}
    plan={'id':str(uuid4()),'plugin_id':'fixture','capability':'field','phase':'run',
          'plugin_manifest':manifest,'cases':[{'case_id':'one','input':{'saved':True},'parameters':{}}],
          'runtime_sha256':'a'*64}
    directory=tmp_path/'frozen';atomic(directory/'plan.json',plan)
    atomic(directory/'integrity.json',{'plan_sha256':digest(plan)})
    result={'run_id':str(uuid4()),'plugin_id':'fixture','plugin_version':'1.2.3',
            'capability':'field','method_version':'method/7','environment':{},
            'cases':[{'case_id':'one','status':'succeeded'}]}
    result['request_sha256']=request_digest(plan,result['run_id'])
    record={'state':'completed','plan_sha256':digest(plan),'runtime_sha256':plan['runtime_sha256']}
    def seal(value):
        packed=gzip.compress(encoded(value),mtime=0)
        path=directory/'raw/run-result.json.gz';path.parent.mkdir(exist_ok=True);path.write_bytes(packed)
        record['result_sha256']=sha256(packed).hexdigest()
    seal(result)
    class Remote:
        allocated=False
        submissions=0
        disconnected=False
        def __init__(self,*args):pass
        def submit(self,*args):
            if not self.allocated:
                type(self).submissions+=1;type(self).allocated=True
            return {'job_id':'999','token':'same-token'}
        def poll(self,*args):
            if self.disconnected:raise RemoteDisconnected('network fixture')
            return {'terminal':True,'actual_cpu_seconds':2,'accounting':[]}
        def collect(self,*args):return {'status':record,'evidence':str(directory/'raw')}
    monkeypatch.setattr('backend.kernel.hpc_executor.SlurmBackend',Remote)
    return HpcExecutor(root=tmp_path),directory,plan,result,record,seal,Remote


def test_disconnect_then_collect_preserves_allocation_and_result(tmp_path,monkeypatch):
    executor,directory,plan,result,record,seal,remote=fixture(tmp_path,monkeypatch)
    remote.disconnected=True
    with pytest.raises(PluginHostError) as failure:executor.collect(directory)
    assert failure.value.code=='REMOTE_DISCONNECTED' and read(directory/'plan.json')==plan
    remote.disconnected=False
    value=executor.collect(directory)
    assert executor.collect(directory).request_sha256==value.request_sha256
    assert remote.submissions==1 and value.environment['remote_execution']['job_id']=='999'


def test_refresh_only_polls_existing_allocation(tmp_path,monkeypatch):
    executor,directory,plan,_,_,_,remote=fixture(tmp_path,monkeypatch)
    token=str(uuid4());atomic(directory/'submissions'/token/'submission.json',{'job_id':'999','token':token})
    monkeypatch.setattr(remote,'install_agent',lambda *a:None,raising=False)
    monkeypatch.setattr(remote,'poll',lambda *a:{'terminal':True,'actual_cpu_seconds':60,'started':'2026-10-08T12:00:00Z',
        'finished':'2026-10-08T12:01:00Z','accounting':[{'JobID':'999_0','State':'CANCELLED'}]})
    result=executor.refresh_plan(directory)
    assert remote.submissions==0 and result['actual_cpu_seconds']==60 and result['slurm_states']==['CANCELLED']
    assert read(directory/'execution.json')['started']=='2026-10-08T12:00:00Z'


def test_progress_comes_from_scheduler_before_collection(tmp_path,monkeypatch):
    executor,directory,_,_,_,_,remote=fixture(tmp_path,monkeypatch)
    states=iter(['PENDING','RUNNING','COMPLETED']);observed=[]
    def poll(self,*args):
        state=next(states)
        return {'terminal':state=='COMPLETED','actual_cpu_seconds':2,
                'accounting':[{'JobID':'999_0','State':state}]}
    monkeypatch.setattr(remote,'poll',poll)
    monkeypatch.setattr('backend.kernel.hpc_executor.time.sleep',lambda seconds:observed.append(read(directory/'execution.json')['state']))
    executor.collect(directory)
    assert observed==['queued','running']
    assert read(directory/'execution.json')['state']=='collecting'


@pytest.mark.skipif(__import__('os').name!='nt',reason='Windows staging rename race')
def test_transient_staging_rename_permission_error_does_not_repeat_freeze(tmp_path,monkeypatch):
    from types import SimpleNamespace
    from backend.plugin_host.registry import Registry
    repository=Path(__file__).resolve().parents[1]
    plugin=Registry(repository/'plugins',plugin_id='cablesim.simulation').get('cablesim.simulation')
    profile=tmp_path/'profile.json';atomic(profile,{'remote_plugins':['cablesim.simulation']})
    executor=HpcExecutor(SimpleNamespace(registry=SimpleNamespace(root=repository/'plugins')),profile=profile,root=tmp_path/'research')
    freezes=[];attempts=[];rename=Path.rename
    def freeze(directory,*args):
        freezes.append(directory);(directory/'runtime').mkdir()
        return 'a'*64,plugin.manifest.model_dump(mode='json',by_alias=True)
    def transient(path,target):
        if path.name.startswith('prepare-'):
            attempts.append(path)
            if len(attempts)==1:raise PermissionError('brief scanner lock')
        return rename(path,target)
    monkeypatch.setattr('backend.kernel.hpc_executor.freeze_runtime',freeze)
    monkeypatch.setattr(Path,'rename',transient)
    monkeypatch.setattr('backend.kernel.hpc_executor.time.sleep',lambda seconds:None)
    monkeypatch.setattr(executor,'collect',lambda directory:read(directory/'plan.json'))
    result=executor.check('cablesim.simulation','iec-fem-comparison',[{'case_id':'one','input':{},'parameters':{}}])
    assert result['phase']=='check' and len(freezes)==1 and len(attempts)==2


@pytest.mark.parametrize('change',['bytes','request','method','case','plan','runtime'])
def test_remote_tampering_is_rejected(tmp_path,monkeypatch,change):
    executor,directory,plan,result,record,seal,remote=fixture(tmp_path,monkeypatch)
    if change=='bytes':(directory/'raw/run-result.json.gz').write_bytes(b'corrupt')
    elif change=='request':result['request_sha256']='0'*64;seal(result)
    elif change=='method':result['method_version']='other';seal(result)
    elif change=='case':result['cases'][0]['case_id']='other';seal(result)
    elif change=='runtime':record['runtime_sha256']='0'*64
    else:plan['cases'][0]['input']['saved']=False;atomic(directory/'plan.json',plan)
    with pytest.raises(PluginHostError) as failure:executor.collect(directory)
    assert failure.value.code in ('REMOTE_RESULT_CORRUPT','REMOTE_OUTPUT_BINDING_INVALID','REMOTE_PLAN_CORRUPT')
    if change=='plan':assert remote.submissions==0


@pytest.mark.parametrize('code',['TIMEOUT','PLUGIN_CRASHED','ENVIRONMENT_MISSING'])
def test_native_worker_error_keeps_specific_code(tmp_path,monkeypatch,code):
    executor,directory,plan,result,record,seal,remote=fixture(tmp_path,monkeypatch)
    record.update(state='failed',error={'code':code,'message':'specific fixture'})
    with pytest.raises(PluginHostError) as failure:executor.collect(directory)
    assert failure.value.code==code and failure.value.message=='specific fixture'


def test_failed_freeze_can_be_retried_without_partial_runtime(tmp_path,monkeypatch):
    from types import SimpleNamespace
    from backend.plugin_host.registry import Registry
    repository=Path(__file__).resolve().parents[1]
    plugin=Registry(repository/'plugins',plugin_id='cablesim.simulation').get('cablesim.simulation')
    profile=tmp_path/'profile.json';atomic(profile,{'remote_plugins':['cablesim.simulation']})
    executor=HpcExecutor(SimpleNamespace(registry=SimpleNamespace(root=repository/'plugins')),
                         profile=profile,root=tmp_path/'research')
    attempts=[]
    def freeze(directory,*args):
        attempts.append(directory);(directory/'runtime').mkdir()
        if len(attempts)==1:raise ValueError('source changed fixture')
        return 'a'*64,plugin.manifest.model_dump(mode='json',by_alias=True)
    monkeypatch.setattr('backend.kernel.hpc_executor.freeze_runtime',freeze)
    monkeypatch.setattr(executor,'collect',lambda directory:read(directory/'plan.json'))
    cases=[{'case_id':'one','input':{'saved':True},'parameters':{}}]
    with pytest.raises(ValueError,match='source changed'):executor.check('cablesim.simulation','sheath-losses',cases)
    assert not list(executor.root.glob('*/runtime'))
    first=executor.check('cablesim.simulation','sheath-losses',cases)
    assert executor.check('cablesim.simulation','sheath-losses',cases)==first
    assert len(attempts)==2 and len(list(executor.root.glob('*/plan.json')))==1

def test_case_array_returns_exact_shards_and_missing_grid_fails_closed(tmp_path):
    manifest={'id':'fixture','version':'1.2.3','resources':{'timeout_s':30,'memory_mb':512},'capabilities':[{'id':'field','method_version':'method/7','input_schema':'cablesim.domain/1'}]}
    originals=[{'case_id':'mesh-'+str(i),'input':{'same':True},'parameters':{'mesh':i}} for i in range(3)]
    plan={'id':str(uuid4()),'plugin_id':'fixture','capability':'field','phase':'run','plugin_manifest':manifest,'cases':originals,'runtime_sha256':'a'*64,'samples':[{'case_id':c['case_id']} for c in originals],'case_array':True}
    for original in originals[:2]:
        result={'run_id':str(uuid4()),'plugin_id':'fixture','plugin_version':'1.2.3','capability':'field','method_version':'method/7','environment':{'mesh':original['parameters']['mesh']},'cases':[{'case_id':original['case_id'],'status':'succeeded'}]}
        result['request_sha256']=request_digest({**plan,'cases':[original]},result['run_id'])
        packed=gzip.compress(encoded(result),mtime=0);folder=tmp_path/original['case_id'];folder.mkdir();(folder/'run-result.json.gz').write_bytes(packed)
        atomic(folder/'status.json',{'state':'completed','plan_sha256':digest(plan),'runtime_sha256':plan['runtime_sha256'],'result_sha256':sha256(packed).hexdigest()})
    executor=HpcExecutor(root=tmp_path)
    value=executor.collect_array(plan,tmp_path,{'job_id':'array-999'},{'actual_cpu_seconds':123,'accounting':[]})
    assert [c.case_id for c in value.cases]==['mesh-0','mesh-1','mesh-2']
    assert value.cases[-1].status=='failed' and value.cases[-1].results==[]
    assert value.environment['remote_execution']['actual_cpu_seconds']==123
    status=read(tmp_path/'mesh-0/status.json');status['plan_sha256']='0'*64;atomic(tmp_path/'mesh-0/status.json',status)
    with pytest.raises(PluginHostError) as caught:executor.collect_array(plan,tmp_path,{'job_id':'array-999'},{'actual_cpu_seconds':123,'accounting':[]})
    assert caught.value.code=='REMOTE_OUTPUT_BINDING_INVALID'
