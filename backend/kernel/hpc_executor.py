"""Route administrator-selected methods through frozen Slurm jobs, without physics."""
from copy import deepcopy
from contextlib import contextmanager
from contextvars import ContextVar
import gzip
from hashlib import sha256
import json
import os
from pathlib import Path
import time
from tempfile import TemporaryDirectory
from uuid import UUID,uuid4,uuid5,NAMESPACE_URL

from ..plugin_host import Executor,PluginHostError
from ..plugin_host.executor import CaseResult,RunResult,PROTOCOL
from ..plugin_host.registry import Registry
from .batch_files import atomic,digest,locked,read
from .batch_runtime import freeze_runtime
from .batch_slurm import SlurmBackend,RemoteDisconnected,allocation_estimate

ROOT=Path(__file__).resolve().parents[2]
_CHECK_CONTEXT=ContextVar('hpc_check_operation',default=None)


class HpcExecutor:
    @contextmanager
    def check_operation(self,identifier,cancelled=None):
        token=_CHECK_CONTEXT.set({'id':str(UUID(identifier)),'cancelled':cancelled})
        try:yield
        finally:_CHECK_CONTEXT.reset(token)

    def __init__(self, local=None, *, profile=None, root=None, ledger=None, operation=None):
        self.local=local or Executor()
        self.registry=self.local.registry
        self.profile=Path(profile or ROOT/'.data/hpc/config.json')
        self.root=Path(root or ROOT/'.data/hpc/research-runs')
        self.ledger=Path(ledger or ROOT/'.data/hpc/budget.sqlite')
        self.operation=operation

    def for_operation(self,identifier):
        return HpcExecutor(self.local,profile=self.profile,root=self.root,ledger=self.ledger,operation=str(UUID(identifier)))

    def verify_release(self,plugin):
        verifier=getattr(self.local,'verify_release',None)
        return verifier(plugin) if verifier else plugin.verify()

    def required(self,plugin_id,capability=None):
        if os.environ.get('SLURM_JOB_ID') or not self.profile.is_file():return False
        profile=read(self.profile)
        return (plugin_id in profile.get('remote_plugins',[]) or
                capability in profile.get('remote_capabilities',{}).get(plugin_id,[]))

    def check(self,plugin_id,capability,cases,*,expected_manifest=None):
        result=self.run(plugin_id,capability,cases,phase='check',expected_manifest=expected_manifest)
        if self.required(plugin_id,capability) and isinstance(result,RunResult):
            manifest=expected_manifest or self.registry.get(plugin_id).manifest
            accepted=[case for case in result.cases if case.status=='succeeded']
            if accepted:
                estimate=allocation_estimate(self.resources(manifest,len(accepted)),len(accepted),read(self.profile))
                for case in accepted:
                    case.evidence={**(case.evidence or {}),'execution_budget':estimate}
            for case in result.cases:
                case.evidence={**(case.evidence or {}),'preflight_execution':result.environment.get('remote_execution')}
        return result

    @staticmethod
    def resources(manifest,count,timeout_s=None):
        limit=min(timeout_s or manifest.resources.timeout_s,manifest.resources.timeout_s)
        return {'backend':'slurm','slurm_parallelism':count,'slurm_wall_seconds':limit+120,
                'sample_timeout_s':limit+30,'slurm_memory_mb':min(65536,max(512,manifest.resources.memory_mb))}

    def run(self,plugin_id,capability,cases,timeout_s=None,*,phase='run',expected_manifest=None,reuse_artifacts=None):
        remote=self.required(plugin_id,capability) and (phase=='run' or self.required(plugin_id))
        if not remote:
            return self.local.run(plugin_id,capability,cases,timeout_s,phase=phase,
                                  expected_manifest=expected_manifest,reuse_artifacts=reuse_artifacts)
        plugin=Registry(self.registry.root,plugin_id=plugin_id).get(plugin_id)
        manifest=expected_manifest or plugin.manifest
        identity=digest({'plugin':plugin_id,'capability':capability,'phase':phase,
                         'manifest':manifest.model_dump(mode='json',by_alias=True),'cases':cases,
                         'reuse_artifacts':reuse_artifacts,'timeout_s':timeout_s})
        # Validation can reuse the exact frozen check. A new engineering operation
        # gets a new run identity; reconnection uses that same identity and never sbatch twice.
        context=_CHECK_CONTEXT.get() if phase=='check' else None
        operation=self.operation or (context['id'] if context else None)
        identifier=str(uuid5(UUID(operation),plugin_id+'/'+capability+'/'+phase)) if operation else str(uuid5(NAMESPACE_URL,'cablesim-check/'+identity)) if phase=='check' else str(uuid4())
        directory=self.root/identifier
        # A confirmed failed check may be explicitly retried after environment
        # repair. Retain every failed plan; uncertain/disconnected jobs keep their
        # original identity until accounting establishes a terminal outcome.
        if phase=='check' and not operation:
            while self.failed_check(directory):
                identifier=str(uuid5(UUID(identifier),'retry-confirmed-check'))
                directory=self.root/identifier
        with locked(self.root/'locks'/(identifier+'.lock'),blocking=True):
            plan_path=directory/'plan.json'
            if plan_path.is_file():
                plan=read(plan_path)
                if plan['request_identity']!=identity:
                    raise PluginHostError('REMOTE_REQUEST_CONFLICT','相同研究执行标识对应不同输入；保存原作业并拒绝重复提交。',409)
            else:
                if plugin.manifest!=manifest:
                    raise PluginHostError('RELEASE_CHANGED','方法发行已变化；不能用新代码重建旧运行。',409)
                limit=min(timeout_s or manifest.resources.timeout_s,manifest.resources.timeout_s)
                with TemporaryDirectory(prefix='prepare-',dir=self.root) as scratch:
                    candidate=Path(scratch)
                    runtime_sha,frozen_manifest=freeze_runtime(candidate,plugin_id,self.registry.root.parent)
                    plan={'schema_version':'cablesim.remote-run-plan/1','id':identifier,
                          'request_identity':identity,'operation_id':operation,
                          'plugin_id':plugin_id,'capability':capability,'phase':phase,
                          'plugin_manifest':frozen_manifest,'runtime_sha256':runtime_sha,
                          'cases':deepcopy(cases),'reuse_artifacts':deepcopy(reuse_artifacts),
                          'timeout_s':limit,'samples':[{'case_id':case['case_id']} for case in cases] if phase=='run' and len(cases)>1 else [{'case_id':'research-run'}],
                          'case_array':phase=='run' and len(cases)>1,
                          'execution':self.resources(manifest,len(cases) if phase=='run' else 1,limit)}
                    atomic(candidate/'plan.json',plan);atomic(candidate/'integrity.json',{'plan_sha256':digest(plan)})
                    if directory.exists():
                        raise PluginHostError('REMOTE_PREPARATION_INCOMPLETE','存在尚未封存的旧准备目录，已保留；未提交计算。',409)
                    # Windows scanners can briefly hold freshly frozen files.
                    # Retry only staging rename, before any remote submission.
                    for attempt in range(6):
                        try:
                            candidate.rename(directory)
                            break
                        except PermissionError:
                            if os.name!='nt' or attempt==5 or directory.exists():raise
                            time.sleep(.2)
            if digest(plan)!=read(directory/'integrity.json')['plan_sha256']:
                raise PluginHostError('REMOTE_PLAN_CORRUPT','远端研究计划完整性不符；保留输入并拒绝运行。',409)
        try:
            result=self.collect(directory)
        except PluginHostError as exc:
            if phase=='check' and exc.code not in ('REMOTE_DISCONNECTED','REMOTE_SUBMITTING','REMOTE_SUBMITTED'):
                progress=read(directory/'execution.json') if (directory/'execution.json').is_file() else {}
                if progress.get('state')=='collecting':atomic(directory/'check-outcome.json',{'failed':True,'code':exc.code})
            raise
        if phase=='check' and isinstance(result,RunResult):atomic(directory/'check-outcome.json',{'failed':any(case.status!='succeeded' for case in result.cases)})
        return result

    @staticmethod
    def failed_check(directory):
        outcome=directory/'check-outcome.json'
        if outcome.is_file():return read(outcome).get('failed',False)
        progress=directory/'execution.json'
        if not progress.is_file():return False
        value=read(progress)
        return value.get('state')=='collecting' and any(state in ('FAILED','CANCELLED','TIMEOUT','OUT_OF_MEMORY','NODE_FAIL') for state in value.get('slurm_states',[]))

    def collect(self,directory):
        directory=Path(directory);plan=read(directory/'plan.json')
        if digest(plan)!=read(directory/'integrity.json')['plan_sha256']:
            raise PluginHostError('REMOTE_PLAN_CORRUPT','原超算计划完整性不符，未恢复或另行提交。',409)
        remote=SlurmBackend(self.profile,self.ledger)
        try:
            submission=remote.submit(directory,list(range(len(plan.get('samples',[{}])))))
            if not submission.get('job_id'):
                raise PluginHostError('REMOTE_'+submission['state'].upper(),submission.get('message','远端提交尚未确认，输入与预留保留。'),503)
            while True:
                context=_CHECK_CONTEXT.get()
                if context and context['cancelled'] and context['cancelled']():
                    atomic(directory/'cancel-request.json',{'operation_id':plan.get('operation_id'),'plan_id':plan['id']})
                if (directory/'cancel-request.json').is_file():
                    remote.cancel(directory,submission['token'])
                accounting=remote.poll(directory,submission['token'])
                states=sorted({r['State'].split()[0].rstrip('+') for r in accounting.get('accounting',[])
                               if r.get('State') and '.' not in r.get('JobID','')})
                state='collecting' if accounting.get('terminal') else 'running' if any(s in ('RUNNING','COMPLETING') for s in states) else 'queued' if states and all(s in ('PENDING','REQUEUED','REQUEUE_HOLD') for s in states) else 'submitted'
                atomic(directory/'execution.json',{'state':state,'backend':'slurm','job_id':submission['job_id'],
                    'plan_id':plan['id'],'slurm_states':states,'actual_cpu_seconds':accounting.get('actual_cpu_seconds',0),
                    'cancel_requested':(directory/'cancel-request.json').is_file(),
                    'started':accounting.get('started'),'finished':accounting.get('finished'),
                    'queue_position':accounting.get('queue_position'),'queue_position_basis':accounting.get('queue_position_basis'),
                    'budget_core_hours':accounting.get('budget_core_hours'),
                    'updated':accounting.get('updated')})
                if accounting.get('terminal'):break
                time.sleep(5)
            if any(s in ('CANCELLED','TIMEOUT','OUT_OF_MEMORY','NODE_FAIL','PREEMPTED','BOOT_FAIL','DEADLINE') for s in states):
                reason=next(s for s in states if s!='COMPLETED')
                raise PluginHostError('REMOTE_'+reason,'Slurm 作业 '+submission['job_id']+'：'+reason+'；输入、已用核时和日志保留。',502)
            collected=remote.collect(directory,submission['token'])
        except RemoteDisconnected as exc:
            raise PluginHostError('REMOTE_DISCONNECTED','超算连接中断；原作业与输入保留，请恢复当前运行。执行目录：'+plan['id']+'；'+str(exc),503) from exc
        evidence=Path(collected['evidence'])
        if plan.get('case_array'):
            return self.collect_array(plan,evidence,submission,accounting)
        result_file=evidence/'run-result.json.gz'
        if collected['status'].get('state')!='completed' or not result_file.is_file():
            message=collected['status'].get('error') or '计算节点未封存完整运行；原始日志保留。'
            if isinstance(message,dict):
                raise PluginHostError(message.get('code','REMOTE_WORKER_FAILED'),message.get('message',str(message)),502)
            raise PluginHostError('REMOTE_WORKER_FAILED',str(message),502)
        if collected['status'].get('plan_sha256')!=digest(plan) or collected['status'].get('runtime_sha256')!=plan['runtime_sha256']:
            raise PluginHostError('REMOTE_OUTPUT_BINDING_INVALID','超算工件未绑定原冻结计划及运行源码。',502)
        if sha256(result_file.read_bytes()).hexdigest()!=collected['status'].get('result_sha256'):
            raise PluginHostError('REMOTE_RESULT_CORRUPT','超算运行字节摘要与封存记录不一致。',502)
        result=read_gzip(result_file)
        manifest=plan['plugin_manifest']
        capability=next(value for value in manifest['capabilities'] if value['id']==plan['capability'])
        ids=[case['case_id'] for case in plan['cases']]
        if (result['plugin_id']!=plan['plugin_id'] or result['plugin_version']!=manifest['version'] or
            result['capability']!=plan['capability'] or result['method_version']!=capability['method_version'] or
            result['request_sha256']!=request_digest(plan,result['run_id']) or
            [case['case_id'] for case in result['cases']]!=ids):
            raise PluginHostError('REMOTE_OUTPUT_BINDING_INVALID','超算返回身份与冻结输入不一致。',502)
        result['cases']=[CaseResult(**case) for case in result['cases']]
        result['environment']['remote_execution']={
            'backend':'slurm','plan_id':plan['id'],'plan_sha256':digest(plan),
            'runtime_sha256':plan['runtime_sha256'],'job_id':submission['job_id'],
            'actual_cpu_seconds':accounting['actual_cpu_seconds'],
            'started':accounting.get('started'),'finished':accounting.get('finished'),
            'accounting':accounting['accounting'],'result_sha256':collected['status']['result_sha256']}
        return RunResult(**result)

    def collect_array(self,plan,evidence,submission,accounting):
        """Validate each frozen shard; failed shards retain diagnostics, no numbers."""
        cases=[];environments={};requests=[];digests={}
        manifest=plan['plugin_manifest'];capability=next(c for c in manifest['capabilities'] if c['id']==plan['capability'])
        for index,original in enumerate(plan['cases']):
            folder=evidence/original['case_id'];status=read(folder/'status.json') if (folder/'status.json').is_file() else {}
            result_file=folder/'run-result.json.gz'
            if status.get('state')!='completed' or not result_file.is_file():
                cases.append(CaseResult(case_id=original['case_id'],status='failed',error=status.get('error') or {'code':'REMOTE_SHARD_FAILED','message':'网格作业未封存结果；原输入和日志保留。'}));continue
            shard={**plan,'cases':[original]};result=read_gzip(result_file);digest_bytes=sha256(result_file.read_bytes()).hexdigest()
            if (status.get('plan_sha256')!=digest(plan) or status.get('runtime_sha256')!=plan['runtime_sha256'] or status.get('result_sha256')!=digest_bytes or
                result['request_sha256']!=request_digest(shard,result['run_id']) or result['plugin_id']!=plan['plugin_id'] or result['plugin_version']!=manifest['version'] or result['capability']!=plan['capability'] or result['method_version']!=capability['method_version'] or [c['case_id'] for c in result['cases']]!=[original['case_id']]):
                raise PluginHostError('REMOTE_OUTPUT_BINDING_INVALID','数组结果与原冻结网格／方法不符。',502)
            cases.append(CaseResult(**result['cases'][0]));environments[original['case_id']]=result['environment'];requests.append(result['request_sha256']);digests[original['case_id']]=digest_bytes
        environment={'array_cases':environments,'remote_execution':{'backend':'slurm','plan_id':plan['id'],'plan_sha256':digest(plan),'runtime_sha256':plan['runtime_sha256'],'job_id':submission['job_id'],'actual_cpu_seconds':accounting['actual_cpu_seconds'],'accounting':accounting['accounting'],'result_sha256_by_case':digests,'array_tasks':len(plan['samples'])}}
        return RunResult(plan['id'],plan['plugin_id'],manifest['version'],plan['capability'],capability['method_version'],digest({'plan_sha256':digest(plan),'requests':requests}),environment,cases)

    def saved(self,operation,plugin_id,capability,phase='run'):
        identifier=str(uuid5(UUID(operation),plugin_id+'/'+capability+'/'+phase))
        directory=self.root/identifier
        if not (directory/'plan.json').is_file():
            raise PluginHostError('REMOTE_JOB_MISSING','此运行没有已冻结的超算作业；不会自动创建替代计算。',409)
        return directory,read(directory/'plan.json')

    def execution_status(self,operation,plugin_id,capability,phase='run'):
        """Read cached scheduler evidence; page polling never contacts SSH."""
        identifier=str(uuid5(UUID(operation),plugin_id+'/'+capability+'/'+phase))
        directory=self.root/identifier
        if not (directory/'plan.json').is_file():return None
        plan=read(directory/'plan.json')
        if plan.get('operation_id')!=operation or plan.get('plugin_id')!=plugin_id or plan.get('capability')!=capability:
            return {'backend':'slurm','state':'unavailable','error':'REMOTE_PROGRESS_BINDING_INVALID'}
        value=read(directory/'execution.json') if (directory/'execution.json').is_file() else {'backend':'slurm','state':'preparing'}
        value.setdefault('plan_id',identifier)
        value['cancel_requested']=(directory/'cancel-request.json').is_file()
        if not value.get('job_id') and value.get('token'):
            submission=directory/'submissions'/str(UUID(value['token']))/'submission.json'
            if submission.is_file():value['job_id']=read(submission).get('job_id')
        return value

    def request_cancel(self,operation,plugin_id,capability,phase='run'):
        directory,_=self.saved(operation,plugin_id,capability,phase)
        return self.cancel_plan(directory)

    def cancel_plan(self,directory):
        plan=read(directory/'plan.json')
        if digest(plan)!=read(directory/'integrity.json')['plan_sha256']:
            raise PluginHostError('REMOTE_PLAN_CORRUPT','计划校验失败，未发送取消。',409)
        atomic(directory/'cancel-request.json',{'operation_id':plan.get('operation_id'),'plan_id':plan['id']})
        submissions=list((directory/'submissions').glob('*/submission.json'))
        if not submissions:return {'state':'cancel_requested','message':'取消请求已保存，等待提交身份确认。'}
        remote=SlurmBackend(self.profile,self.ledger)
        for path in submissions:
            submission=read(path)
            if submission.get('job_id'):remote.cancel(directory,submission['token'])
        return {'state':'cancel_requested','message':'已请求取消，等待 Slurm 终态与核时结算。'}

    def refresh_status(self,operation,plugin_id,capability,phase='run'):
        """Reconcile an existing allocation only; never prepare or submit a job."""
        directory,_=self.saved(operation,plugin_id,capability,phase)
        return self.refresh_plan(directory)

    def refresh_plan(self,directory):
        plan=read(directory/'plan.json')
        if digest(plan)!=read(directory/'integrity.json')['plan_sha256']:
            raise PluginHostError('REMOTE_PLAN_CORRUPT','计划校验失败，未查询作业。',409)
        remote=SlurmBackend(self.profile,self.ledger);latest=None
        remote.install_agent()
        for path in (directory/'submissions').glob('*/submission.json'):
            submission=read(path)
            if not submission.get('job_id'):continue
            accounting=remote.poll(directory,submission['token'])
            states=sorted({r['State'].split()[0].rstrip('+') for r in accounting.get('accounting',[]) if '.' not in r.get('JobID','')})
            latest={'backend':'slurm','job_id':submission['job_id'],'plan_id':plan['id'],'slurm_states':states,
                    'state':'collecting' if accounting.get('terminal') else 'running' if 'RUNNING' in states else 'queued',
                    'actual_cpu_seconds':accounting.get('actual_cpu_seconds',0),'started':accounting.get('started'),
                    'finished':accounting.get('finished'),'cancel_requested':(directory/'cancel-request.json').is_file(),
                    'queue_position':accounting.get('queue_position'),'queue_position_basis':accounting.get('queue_position_basis'),
                    'budget_core_hours':accounting.get('budget_core_hours')}
            atomic(directory/'execution.json',latest)
        return latest


def read_gzip(path):
    with gzip.open(path,'rt',encoding='utf-8') as stream:
        return json.load(stream)


def request_digest(plan,run_id):
    """Reconstruct the host protocol bytes to bind remote output to frozen cases."""
    manifest=plan['plugin_manifest']
    capability=next(value for value in manifest['capabilities'] if value['id']==plan['capability'])
    cases=deepcopy(plan['cases'])
    if plan.get('reuse_artifacts') is not None:
        reused=json.dumps(plan['reuse_artifacts'],ensure_ascii=False,allow_nan=False,sort_keys=True).encode('utf-8')
        cases=[{**case,'parameters':{**case.get('parameters',{}),'_artifact_reuse_sha256':sha256(reused).hexdigest()}} for case in cases]
    request={'protocol':PROTOCOL,'phase':plan['phase'],'run_id':run_id,'capability':plan['capability'],
             'input_schema':capability['input_schema'],'cases':cases,
             'limits':{key:manifest['resources'][key] for key in ('timeout_s','memory_mb')}}
    return sha256(json.dumps(request,ensure_ascii=False,allow_nan=False,sort_keys=True).encode('utf-8')).hexdigest()


def default_executor():
    return HpcExecutor()


def make_router(research):
    """Mount with app.include_router(make_router(research)); no parallel run store."""
    from fastapi import APIRouter,HTTPException
    router=APIRouter(prefix='/api')
    @router.get('/workspaces/{wid}/studies/{sid}/runs/{rid}/progress')
    def progress(wid:str,sid:str,rid:str):
        # Scheduler evidence changes outside SQLite; bypass the immutable run
        # response cache so a queued job remains live without mutating its input.
        with research.store.db() as db:
            row=db.execute('SELECT id,status,error,snapshot FROM study_runs WHERE workspace=? AND study=? AND id=?',(wid,sid,rid)).fetchone()
        if row is None:raise HTTPException(404,'运行不属于此研究。')
        method=json.loads(row['snapshot'])['definition']['method']
        execution=research.executor.execution_status(rid,method['plugin_id'],method['capability'])
        if execution and row['status'] in ('validating','succeeded','partial','failed','interrupted'):
            execution={**execution,'state':row['status']}
        return {'id':row['id'],'status':row['status'],'execution':execution,'error':json.loads(row['error']) if row['error'] else None}
    @router.post('/workspaces/{wid}/studies/{sid}/runs/{rid}/cancel')
    def cancel(wid:str,sid:str,rid:str):
        run=research.get_run(wid,rid)
        if run['study']!=sid:raise HTTPException(404,'运行不属于此研究。')
        if run['status'] in ('succeeded','partial'):return run
        method=run['snapshot']['definition']['method']
        try:return research.executor.request_cancel(rid,method['plugin_id'],method['capability'])
        except RemoteDisconnected as exc:raise HTTPException(503,'连接中断；取消意图已保存，尚未确认作业停止。') from exc
        except PluginHostError as exc:raise HTTPException(exc.status,exc.message) from exc
    return router
