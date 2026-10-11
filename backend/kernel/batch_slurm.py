"""SSH/SCP transport and Slurm orchestration; no solver algorithm or credentials."""
from hashlib import sha256
from math import ceil
import json
import gzip
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tarfile
from uuid import UUID,uuid5

from .batch_budget import BudgetLedger,utc_now
from .batch_files import atomic,digest,locked,read
from .batch_runtime import transport_archive
from .batch_worker import verify_row,failed_sample


class RemoteDisconnected(RuntimeError):
    pass


def allocation_estimate(resources, count, configuration):
    """The same conservative allocation used by submit; never a solver timing claim."""
    maximum=min(configuration.get('maximum_array_tasks',1000),configuration.get('maximum_pending_tasks',8),resources['slurm_parallelism'])
    if count < 1 or maximum < 1:raise ValueError('No runnable allocation')
    group_size=ceil(count/maximum)
    tasks=ceil(count/group_size)
    workers=resources.get('slurm_cpus_per_task',1)
    cpus=max(workers,configuration.get('accounting_cpus_per_task',1),ceil(resources['slurm_memory_mb']/configuration.get('max_memory_per_cpu_mb',6500)))
    wall=ceil(group_size/workers)*resources['slurm_wall_seconds']
    return {'tasks':tasks,'cpus_per_task':cpus,'wall_seconds':wall,
            'upper_core_hours':tasks*cpus*wall/3600,'case_count':count,
            'partition':configuration.get('partition','dg83'),'basis':'allocation upper bound, not predicted solver time'}


class SlurmBackend:
    def __init__(self, configuration, ledger):
        self.profile_path=Path(configuration) if isinstance(configuration,(str,Path)) else None
        self.configuration=read(self.profile_path) if self.profile_path else configuration
        self.ledger=ledger if isinstance(ledger,BudgetLedger) else BudgetLedger(ledger)
        self.alias=self.configuration['ssh_alias']
        if not re.fullmatch(r'[A-Za-z0-9_.-]+',self.alias):raise ValueError('Invalid administrator SSH alias')
        self.options=['-o','BatchMode=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2']
        if self.configuration.get('ssh_config'):self.options=['-F',self.configuration['ssh_config'],*self.options]
        self.root=self.configuration['remote_root'].rstrip('/')
        self.python=self.configuration['python']
        self.control_python=self.configuration.get('control_python',self.python)
        for value in (self.root,self.python,self.control_python):
            if not re.fullmatch(r'/[A-Za-z0-9_./-]+',value) or '..' in value.split('/'):raise ValueError('Invalid remote profile path')
        self.agent=self.root.rsplit('/',1)[0]+'/bin/cablesim-remote.py'

    def _run(self,arguments,timeout=90):
        try:result=subprocess.run(arguments,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=timeout)
        except (OSError,subprocess.TimeoutExpired) as exc:raise RemoteDisconnected(str(exc)) from exc
        if result.returncode:raise RemoteDisconnected(result.stderr[-3000:] or result.stdout[-3000:])
        return result.stdout

    def ssh(self,arguments,timeout=90):
        return self._run(['ssh',*self.options,self.alias,' '.join(shlex.quote(str(a)) for a in arguments)],timeout)

    def remote_json(self,code,*arguments):
        return json.loads(self.ssh([self.control_python,'-c',code,*arguments]))

    def install_agent(self):
        with locked(self.ledger.path.parent/'agent-install.lock',blocking=True):
            return self._install_agent()

    def _install_agent(self):
        self.ssh(['mkdir','-p',self.agent.rsplit('/',1)[0],self.root])
        source=Path(__file__).with_name('batch_remote_agent.py')
        self._run(['scp',*self.options,str(source),self.alias+':'+self.agent+'.part'])
        expected=sha256(source.read_bytes()).hexdigest()
        self.remote_json('import pathlib,sys,hashlib,json,os; p=pathlib.Path(sys.argv[1]); assert hashlib.sha256(p.read_bytes()).hexdigest()==sys.argv[2]; os.replace(p,sys.argv[3]); print(json.dumps({"installed":True}))',self.agent+'.part',expected,self.agent)

    def call(self,action,root,value,*extra):
        # Result archives may contain thousands of small provenance files on
        # the shared filesystem. Keep ordinary control requests short while
        # allowing a bounded collection operation to finish without resubmission.
        try:raw=self.ssh([self.control_python,self.agent,action,root,value,*extra],timeout=600 if action=='collect' else 120)
        except RemoteDisconnected as exc:
            try:response=json.loads(str(exc))
            except ValueError:raise exc
            if isinstance(response,dict) and response.get('ok') is False:
                raise RuntimeError(response.get('code','REMOTE_ERROR')+': '+response.get('message','')) from exc
            raise exc
        response=json.loads(raw)
        if not response.get('ok'):raise RuntimeError(response.get('code','REMOTE_ERROR')+': '+response.get('message',''))
        return response['result']

    def upload(self,source,destination):
        """Content-addressed chunks are resumed; an incomplete chunk is never reused."""
        source=Path(source);expected=sha256(source.read_bytes()).hexdigest()
        exists=self.remote_json('import pathlib,sys,hashlib,json; p=pathlib.Path(sys.argv[1]); print(json.dumps(p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()==sys.argv[2]))',destination,expected)
        if exists:return expected
        remote_parts=destination+'.chunks';self.ssh(['mkdir','-p',remote_parts])
        parts=[]
        with source.open('rb') as stream:
            index=0
            while chunk:=stream.read(8*1024*1024):
                name=f'{index:06d}';hashed=sha256(chunk).hexdigest();remote=remote_parts+'/'+name
                present=self.remote_json('import pathlib,sys,hashlib,json; p=pathlib.Path(sys.argv[1]); print(json.dumps(p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()==sys.argv[2]))',remote,hashed)
                if not present:
                    local=source.with_name(source.name+'.chunk-'+name);local.write_bytes(chunk)
                    try:self._run(['scp',*self.options,str(local),self.alias+':'+remote+'.part'],timeout=600)
                    finally:local.unlink(missing_ok=True)
                    self.remote_json('import pathlib,sys,hashlib,json,os; p=pathlib.Path(sys.argv[1]); assert hashlib.sha256(p.read_bytes()).hexdigest()==sys.argv[2]; os.replace(p,sys.argv[3]); print(json.dumps(True))',remote+'.part',hashed,remote)
                parts.append(name);index+=1
        self.remote_json('import pathlib,sys,hashlib,json,os; p=pathlib.Path(sys.argv[1]); parts=json.loads(sys.argv[2]); out=p.with_name(p.name+".part"); f=out.open("wb"); [f.write((pathlib.Path(str(p)+".chunks")/n).read_bytes()) for n in parts]; f.close(); assert hashlib.sha256(out.read_bytes()).hexdigest()==sys.argv[3]; os.replace(out,p); print(json.dumps(True))',destination,json.dumps(parts),expected)
        return expected

    def download(self,source,destination,expected):
        destination=Path(destination)
        if destination.is_file() and sha256(destination.read_bytes()).hexdigest()==expected:return
        code='''import pathlib,sys,hashlib,json
source=pathlib.Path(sys.argv[1]); expected=sys.argv[2]
assert hashlib.sha256(source.read_bytes()).hexdigest()==expected
root=pathlib.Path(str(source)+".download"); root.mkdir(exist_ok=True)
parts=[]
with source.open("rb") as stream:
    index=0
    while chunk:=stream.read(8*1024*1024):
        path=root/("%06d"%index); path.write_bytes(chunk)
        parts.append({"path":str(path),"sha256":hashlib.sha256(chunk).hexdigest()});index+=1
print(json.dumps(parts))'''
        parts=self.remote_json(code,source,expected)
        cache=destination.with_name(destination.name+'.chunks');cache.mkdir(parents=True,exist_ok=True)
        for index,part in enumerate(parts):
            path=cache/f'{index:06d}'
            if not path.is_file() or sha256(path.read_bytes()).hexdigest()!=part['sha256']:
                self._run(['scp',*self.options,self.alias+':'+part['path'],str(path)+'.part'],timeout=600)
                partial=Path(str(path)+'.part')
                if sha256(partial.read_bytes()).hexdigest()!=part['sha256']:raise ValueError('RESULT_CHUNK_DIGEST_MISMATCH')
                partial.replace(path)
        partial=destination.with_name(destination.name+'.part')
        with partial.open('wb') as output:
            for index in range(len(parts)):
                with (cache/f'{index:06d}').open('rb') as source_file:shutil.copyfileobj(source_file,output)
        if sha256(partial.read_bytes()).hexdigest()!=expected:raise ValueError('RESULT_TRANSFER_DIGEST_MISMATCH')
        partial.replace(destination)
        if cache.resolve().parent!=destination.resolve().parent:raise ValueError('Unsafe transfer cleanup')
        shutil.rmtree(cache)

    def stage(self,directory):
        with locked(Path(directory)/'locks/transport.lock',blocking=True):
            return self._stage(directory)

    def _stage(self,directory):
        directory=Path(directory);plan=read(directory/'plan.json');remote=self.root+'/'+str(UUID(plan['id']))
        self.install_agent();self.ssh(['mkdir','-p',remote])
        transport=directory/'transport';transport.mkdir(exist_ok=True)
        archive=transport/'input.tar.gz'
        if archive.exists():
            try:
                with gzip.open(archive,'rb') as stream:
                    while stream.read(1024*1024):pass
            except (EOFError,gzip.BadGzipFile):
                archive.replace(archive.with_name('input.incomplete.gz'))
        if not archive.exists():transport_archive(directory,archive)
        hashed=self.upload(archive,remote+'/input.tar.gz')
        result=self.call('stage',remote,remote+'/input.tar.gz','--sha256',hashed)
        atomic(directory/'remote-stage.json',{'root':remote,**result,'updated':utc_now()})
        return remote

    def submit(self,directory,indices,retry=False,retry_id=None):
        directory=Path(directory);plan=read(directory/'plan.json');indices=list(indices)
        resources=plan['execution']
        if not indices or len(indices)!=len(set(indices)) or any(type(i)is not int or not 0<=i<len(plan['samples']) for i in indices):raise ValueError('Invalid sample indices')
        maximum=min(self.configuration.get('maximum_array_tasks',1000),self.configuration.get('maximum_pending_tasks',8),resources['slurm_parallelism'])
        group_size=(len(indices)+maximum-1)//maximum
        groups=[indices[i:i+group_size] for i in range(0,len(indices),group_size)]
        if retry and retry_id is None:raise ValueError('明确重试须携带新的 retry_id；重复点击复用同一标识。')
        # Existing attempt identities make repeated Resume clicks idempotent.
        generation=[]
        if retry:
            for index in indices:
                path=directory/'samples'/(plan['samples'][index]['case_id']+'.json')
                generation.append(read(path).get('attempt',0) if path.is_file() else 0)
        token=str(uuid5(UUID(plan['id']),digest({'indices':indices,'task_groups':groups,'retry':retry,'retry_id':str(UUID(retry_id)) if retry else None})))
        folder=directory/'submissions'/token;folder.mkdir(parents=True,exist_ok=True)
        with locked(folder/'client.lock'):
            saved=folder/'submission.json'
            if saved.is_file() and read(saved).get('job_id'):
                return read(saved)  # historical accounting policy must not create a new allocation
            estimate=allocation_estimate(resources,len(indices),self.configuration)
            def reserve():
                return self.ledger.reserve(token,tasks=estimate['tasks'],cpus_per_task=estimate['cpus_per_task'],wall_seconds=estimate['wall_seconds'],
                    single_limit_core_hours=self.configuration.get('budget_core_hours',2000),
                    total_limit_core_hours=self.configuration.get('total_budget_core_hours',20000))
            if self.profile_path:
                # Serialize only the local reservation with settings writes, not
                # network staging. The reservation then protects live bindings.
                with locked(self.profile_path.with_suffix('.lock'),blocking=True):
                    if read(self.profile_path)!=self.configuration:raise ValueError('超算配置已变化，请重新预检；尚未提交作业。')
                    reservation=reserve()
            else:reservation=reserve()
            if reservation['state']=='accounted':
                saved=folder/'submission.json'
                if saved.is_file():return read(saved)
                raise ValueError('该提交已结算且未产生作业；重新运行须使用明确的新重试标识。')
            request={'token':token,'indices':indices,'task_groups':groups,'retry':retry,'profile':{k:v for k,v in self.configuration.items()
                if k in ('python','control_python','getdp','elmer','elmer_build','comsol','library_paths','partition','modules')}}
            atomic(folder/'request.json',request)
            try:
                remote=self.stage(directory)
                remote_folder=remote+'/submissions/'+token;self.ssh(['mkdir','-p',remote_folder])
                self.upload(folder/'request.json',remote_folder+'/request.json')
                result=self.call('submit',remote,remote_folder+'/request.json')
                atomic(folder/'submission.json',result)
                if result.get('job_id'):self.ledger.record(token,jobs=[result['job_id']])
                elif result['state']=='rejected':self.ledger.record(token,jobs=[],actual_seconds=0,terminal=True)
                atomic(directory/'execution.json',{'state':result['state'],'backend':'slurm','token':token,
                    'job_id':result.get('job_id'),'updated':utc_now(),'error':result.get('message')})
                return result
            except RemoteDisconnected as exc:
                atomic(directory/'execution.json',{'state':'disconnected','backend':'slurm','token':token,
                    'updated':utc_now(),'error':str(exc),'message':'连接中断；预留与输入保留，恢复时按原提交标识查询，不重复提交。'})
                raise

    def poll(self,directory,token):
        directory=Path(directory);plan=read(directory/'plan.json');remote=self.root+'/'+plan['id']
        folder=directory/'submissions'/str(UUID(token))
        try:
            result=self.call('accounting',remote,token)
            atomic(folder/'accounting.json',result)
            if result.get('job_id') and 'actual_cpu_seconds' in result:
                self.ledger.record(token,jobs=[result['job_id']],actual_seconds=result['actual_cpu_seconds'],terminal=result['terminal'])
            return result
        except RemoteDisconnected as exc:
            previous=read(directory/'execution.json') if (directory/'execution.json').is_file() else {}
            atomic(directory/'execution.json',{**previous,'state':'disconnected','backend':'slurm','token':token,
                'updated':utc_now(),'error':str(exc)})
            raise

    def cancel(self,directory,token):
        """Cancel only the allocation bound to this frozen submission, then reconcile."""
        directory=Path(directory);plan=read(directory/'plan.json');token=str(UUID(token))
        result=self.call('cancel',self.root+'/'+str(UUID(plan['id'])),token)
        atomic(directory/'submissions'/token/'cancellation.json',result)
        return self.poll(directory,token)

    def collect(self,directory,token):
        directory=Path(directory);plan=read(directory/'plan.json');token=str(UUID(token))
        remote=self.root+'/'+plan['id'];folder=directory/'submissions'/token
        accounting=self.poll(directory,token)
        if not accounting.get('terminal'):raise ValueError('作业尚未获得完整终态记账；保留远端结果并继续查询。')
        details=self.call('collect',remote,remote+'/results-'+token+'.tar.gz')
        archive=folder/'results.tar.gz'
        self.download(details['path'],archive,details['sha256'])
        replica=directory/'replicas'/token;replica.mkdir(parents=True,exist_ok=True)
        # Full-grid compressed fields can exceed 100 MiB at the validated
        # four-million-node capacity. Extract sequentially with a fixed buffer;
        # retain path/type checks and explicit per-file/total disk bounds.
        total_size=0;entries=0
        with tarfile.open(archive,'r|gz') as bundle:
            for entry in bundle:
                total_size+=entry.size;entries+=1
                path=(replica/entry.name).resolve()
                if not entry.isfile() or not path.is_relative_to(replica.resolve()):
                    raise ValueError('远端结果含非法路径或非普通文件；原作业与结果保留，尚未导入。')
                if entry.size>512*1024*1024 or total_size>2*1024*1024*1024 or entries>4096:
                    raise ValueError('远端结果超过回收容量（单文件 512 MiB、总计 2 GiB、4096 项）；原作业与结果保留，尚未导入。')
                path.parent.mkdir(parents=True,exist_ok=True)
                with bundle.extractfile(entry) as source,path.open('wb') as target:shutil.copyfileobj(source,target,length=1024*1024)
        imported=0;replicated=0
        if plan.get('schema_version') in ('cablesim.native-test-plan/1','cablesim.remote-run-plan/1'):
            if plan.get('case_array'):
                result={'accounting':accounting,'evidence':str(replica/'raw'),'array':True}
                atomic(folder/'collection.json',result)
                return result
            status=replica/'raw/status.json'
            result={'status':read(status) if status.is_file() else {'state':'missing_test_result'},
                    'accounting':accounting,'evidence':str(replica/'raw')}
            atomic(folder/'collection.json',result)
            return result
        for index in accounting['request']['indices']:
            descriptor=plan['samples'][index];sample_id=descriptor['case_id'];path=replica/'samples'/(sample_id+'.json')
            row=read(path) if path.is_file() else None
            if row is None or row['status'] in ('pending','running','interrupted'):
                group=next(i for i,g in enumerate(accounting['request']['task_groups']) if index in g)
                allocation=next((r for r in accounting['accounting'] if r['JobID']==accounting['job_id']+'_'+str(group)),{})
                state=allocation.get('State','UNKNOWN')
                failed_sample(directory,index,'slurm','SLURM_'+state.split()[0],
                    '远端作业已结束但样本没有完整结果；输入及已有证据保留，请明确重试。',allocation)
                continue
            row=verify_row(row,replica)
            sample=read(directory/'inputs'/(sample_id+'.json'))
            if row['dataset_id']!=plan['id'] or row['case_sha256']!=digest(sample['case']) or row['method']!=plan['method']:
                raise ValueError('REMOTE_INPUT_BINDING_MISMATCH')
            target=directory/'samples'/(sample_id+'.json')
            with locked(directory/'locks'/(sample_id+'.lock')):
                existing=read(target) if target.is_file() else None
                if existing and existing['status'] not in ('running','interrupted','pending') and not accounting['request'].get('retry'):
                    replicated+=1;continue
                if existing and existing['status']=='succeeded':replicated+=1;continue
                if existing and existing['status']=='running':replicated+=1;continue
                original=row['row_sha256'];row.pop('row_sha256')
                if row.get('raw_result'):
                    source=replica/row['raw_result'];destination=directory/'raw'/(token+'-'+source.name)
                    destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,destination)
                    row['raw_result']=destination.relative_to(directory).as_posix()
                row['imported_from']={'submission_token':token,'original_row_sha256':original}
                row['row_sha256']=digest(row);atomic(target,row);imported+=1
        atomic(folder/'collection.json',{'imported':imported,'replicas':replicated,'archive':details,'updated':utc_now()})
        atomic(directory/'execution.json',{'state':'completed','backend':'slurm','token':token,'updated':utc_now(),
            'job_id':accounting['job_id'],'imported':imported,'replicas':replicated,'actual_cpu_seconds':accounting['actual_cpu_seconds']})
        return {'imported':imported,'replicas':replicated,'accounting':accounting}
