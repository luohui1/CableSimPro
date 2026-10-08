"""Saved-study dataset orchestration; workers consume frozen inputs, never live projects."""
from copy import deepcopy
import json
import os
from pathlib import Path
import threading
import sys
from uuid import UUID,uuid4
import zipfile

from fastapi import APIRouter,HTTPException,Query
from fastapi.responses import FileResponse
from pydantic import Field

from ..schemas import StrictModel
from .contracts import RunStudy
from .batch_budget import BudgetLedger,BudgetExceeded,utc_now
from .batch_files import atomic,digest,read
from .batch_inputs import ParameterSpace,materialize
from .batch_runtime import Execution,create_plan,local_run,local_allowed,rows,export_dataset
from .batch_slurm import SlurmBackend,RemoteDisconnected
from ..plugin_host.process import run_process


class BatchConfiguration(StrictModel):
    source_module: str | None=Field(default=None,pattern=r'^[a-z][a-z0-9-]{0,63}$')
    parameter_space: ParameterSpace
    execution: Execution=Field(default_factory=Execution)


class SaveConfiguration(BatchConfiguration):
    expected_revision: int=Field(ge=1)
    expected_study_revision: int=Field(ge=1)
    expected_configuration_revision: int=Field(ge=0)


class SubmitDataset(RunStudy):
    configuration_revision: int=Field(ge=1)


class ResumeDataset(StrictModel):
    request_id: UUID
    retry_failed: bool=Field(default=False,strict=True)


def numeric_fields(case):
    result=[]
    labels={'current_a':'负荷电流','z_m':'高度坐标','x_m':'水平坐标','depth_m':'埋深',
            'temperature_k':'环境温度','k_w_m_k':'热导率','rho_k_m_w':'热阻率',
            'mesh_size_m':'局部网格尺寸','far_mesh_size_m':'远场网格尺寸'}
    def walk(value,pointer):
        if len(result)>=2000 or '/provenance/' in pointer or '/source/' in pointer:return
        if isinstance(value,(int,float)) and not isinstance(value,bool):
            name=pointer.rsplit('/',1)[-1]
            # Only metadata with unambiguous SI names is offered automatically.
            # A legacy mm/degC/kV value must never be labelled dimensionless.
            if name.isdigit() or name=='schema_version':return
            unit=('K*m/W' if 'rho_k_m_w' in name else 'W/(m*K)' if name.endswith('k_w_m_k') else
                  'K' if name.endswith('_k') else 'm' if name.endswith('_m') else
                  'A' if name.endswith('_a') else 'Hz' if name.endswith('_hz') else
                  's' if name.endswith('_s') else 'm^2' if name.endswith('_m2') else
                  '1' if name in ('ac_extra_factor','fill_factor','relative_permittivity','relative_permeability','screen_loss_factor','sheath_loss_factor','tan_delta','relaxation','maximum_iterations','max_iterations','max_nodes') else None)
            if unit is None:return
            result.append({'pointer':pointer,'value':value,'unit':unit,'label':labels.get(name,name)})
        elif isinstance(value,dict):
            for key,item in value.items():walk(item,pointer+'/'+key.replace('~','~0').replace('/','~1'))
        elif isinstance(value,list) and len(value)<=128:
            for index,item in enumerate(value):walk(item,pointer+'/'+str(index))
    walk(case['input'],'/input');walk(case.get('parameters',{}),'/parameters')
    return result


class Batches:
    def __init__(self,research,root=None,profile=None,ledger=None):
        self.research=research;self.store=research.store
        self.root=Path(root or Path(self.store.path).parent/'datasets').resolve()
        repository=Path(__file__).resolve().parents[2]
        self.profile=Path(profile or repository/'.data/hpc/config.json')
        self.ledger_path=Path(ledger or repository/'.data/hpc/budget.sqlite')
        self.threads={};self.guard=threading.Lock();self.shutdown_event=threading.Event();self.row_cache={}
        self.owner=research.owner_epoch

    def initialize(self):
        self.root.mkdir(parents=True,exist_ok=True)
        with self.store.db(True) as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS batch_configurations(
                    workspace TEXT NOT NULL,study TEXT NOT NULL,revision INTEGER NOT NULL,
                    definition TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(workspace,study,revision));
                CREATE TABLE IF NOT EXISTS dataset_runs(
                    id TEXT PRIMARY KEY,workspace TEXT NOT NULL,study TEXT NOT NULL,
                    request_id TEXT NOT NULL,request_sha256 TEXT NOT NULL,snapshot TEXT NOT NULL,
                    configuration_revision INTEGER NOT NULL,status TEXT NOT NULL,owner TEXT NOT NULL,
                    created TEXT NOT NULL,updated TEXT NOT NULL,error TEXT,
                    UNIQUE(workspace,request_id));
            ''')
            db.execute("UPDATE dataset_runs SET status='interrupted',updated=?,error=? WHERE owner<>? AND status IN ('preparing','running','queued')",
                (utc_now(),json.dumps({'code':'HOST_RESTART','message':'执行所有者已变化；保存的样本不重算，请恢复执行或查询远端作业。'},ensure_ascii=False),self.owner))

    def close(self):self.shutdown_event.set()

    def _configuration(self,db,wid,sid,revision=None):
        self.research.definition(db,wid,sid)
        query='SELECT * FROM batch_configurations WHERE workspace=? AND study=?'
        args=[wid,sid]
        if revision is not None:query+=' AND revision=?';args.append(revision)
        row=db.execute(query+' ORDER BY revision DESC LIMIT 1',args).fetchone()
        return {**dict(row),'definition':json.loads(row['definition'])} if row else None

    def configuration(self,wid,sid,module=None):
        with self.store.db() as db:
            item=self._configuration(db,wid,sid)
            study=self.research.definition(db,wid,sid)
            workspace,state=self.store.load(db,wid,allow_domain=True)
            module=(module or None) if module is not None else (item or {}).get('definition',{}).get('source_module')
            snapshot=self.research.prepare(db,wid,sid,workspace['revision'],study['revision'],module)
        if len(snapshot['cases'])!=1:
            raise HTTPException(422,'基准研究须是单个保存工况；请先选择一个工况，不嵌套已有扫描或批量列表。')
        return {'configuration':item,'fields':numeric_fields(snapshot['cases'][0]),
            'base_case':snapshot['cases'][0],'method':snapshot['definition']['method'],
            'lock_digest':snapshot['lock']['digest'],'local_fallback_available':local_allowed(),
            'workspace_revision':workspace['revision'],'study_revision':study['revision'],
            'source_modules':[{'id':None,'title':study['definition']['title']},
                *[{'id':key,'title':value['title']} for key,value in study['definition'].get('modules',{}).items()]],
            'limits':{'local_workers':min(32,os.cpu_count() or 1),'single_core_hours':2000,'total_core_hours':20000},
            'budget':BudgetLedger(self.ledger_path).summary() if self.ledger_path.is_file() else None,
            'remote_available':self.profile.is_file()}

    def save(self,wid,sid,body):
        definition=BatchConfiguration.model_validate(body.model_dump(exclude={
            'expected_revision','expected_study_revision','expected_configuration_revision'})).model_dump(mode='json')
        with self.store.db() as db:
            snapshot=self.research.prepare(db,wid,sid,body.expected_revision,body.expected_study_revision,body.source_module)
        if len(snapshot['cases'])!=1:raise HTTPException(422,'请选择一个保存的基准工况。')
        # Validate every target/binding now. Physical admissibility stays in the plugin
        # and every generated sample retains its own rejection when it is executed.
        try:samples=materialize(snapshot['cases'][0],definition['parameter_space'])
        except (KeyError,IndexError,TypeError,ValueError) as exc:raise HTTPException(422,'parameter_space: '+str(exc)) from None
        self._locks(snapshot,samples)
        with self.store.db(True) as db:
            self.store.load(db,wid,body.expected_revision,allow_domain=True)
            self.research.definition(db,wid,sid,body.expected_study_revision)
            current=self._configuration(db,wid,sid)
            revision=current['revision'] if current else 0
            if revision!=body.expected_configuration_revision:raise HTTPException(409,'批量配置已被修改，请读取最新版本后合并。')
            if current and current['definition']==definition:return current
            revision+=1;created=utc_now()
            db.execute('INSERT INTO batch_configurations VALUES(?,?,?,?,?)',
                (wid,sid,revision,json.dumps(definition,ensure_ascii=False,allow_nan=False),created))
        return {'workspace':wid,'study':sid,'revision':revision,'definition':definition,'created':created}

    @staticmethod
    def _locks(snapshot,samples):
        source=snapshot['definition']['input_source'];state=snapshot['workspace_state']
        if source=='domain':
            from ..domain.guards import check_locks
            for sample in samples:check_locks(state,sample['case']['input'],sample['case']['parameters'])
        elif source=='scenario':
            from .batch_inputs import pointer_value
            base=snapshot['cases'][0]
            for path in state.get('locks',[]):
                pointer='/input/'+path.replace('.','/')
                try:old=pointer_value(base,pointer)
                except (ValueError,KeyError,TypeError):continue
                if any(pointer_value(s['case'],pointer)!=old for s in samples):
                    raise HTTPException(422,'parameter_space: 不能改变已锁定的工程参数 '+path)

    def preflight(self,wid,sid,body):
        with self.store.db() as db:
            config=self._configuration(db,wid,sid,body.configuration_revision)
            if not config:raise HTTPException(404,'批量配置版本不存在。')
            definition=config['definition']
            if body.module!=definition['source_module']:raise HTTPException(422,'module: 必须匹配保存的基准模块。')
            snapshot=self.research.prepare(db,wid,sid,body.expected_revision,body.expected_study_revision,body.module)
        if snapshot['lock']['digest']!=body.lock_digest:raise HTTPException(409,'插件锁已变化，请重新预检。')
        if len(snapshot['cases'])!=1:raise HTTPException(422,'基准研究须为单个工况。')
        plugin,capability=self.research.resolve(snapshot['definition']['method'])
        execution=definition['execution']
        if execution['backend']=='local' and not local_allowed():
            raise HTTPException(422,'execution.backend: 本机计算已禁用，请选择 Slurm。')
        # Remote runs validate native inputs in their compute-node worker. A
        # workstation preflight must not launch a mesher, solver or license probe.
        if execution['backend']=='local':
            checks=self.research.check_cases(plugin,capability,snapshot['cases'])
            if any(c.status!='succeeded' for c in checks):
                raise HTTPException(422,{'code':'BASE_PREFLIGHT_FAILED','message':checks[0].error['message']})
        samples=materialize(snapshot['cases'][0],definition['parameter_space']);self._locks(snapshot,samples)
        execution=definition['execution'];count=len(samples)
        estimate=None
        if execution['backend']=='slurm':
            if not self.profile.is_file():raise HTTPException(503,'超算环境缺失：请由本机维护者配置 SSH 运行环境。')
            profile=read(self.profile);tasks=min(count,profile.get('maximum_pending_tasks',8),execution['slurm_parallelism'])
            cpus=max(profile.get('accounting_cpus_per_task',1),-(-execution['slurm_memory_mb']//profile.get('max_memory_per_cpu_mb',6500)))
            estimate=tasks*((count+tasks-1)//tasks)*execution['slurm_wall_seconds']*cpus/3600
            budget=BudgetLedger(self.ledger_path).summary()
            if estimate>2000 or budget['charged_with_reservations']+estimate>20000:
                raise HTTPException(409,{'code':'BUDGET_EXCEEDED','message':'预计核时超过2000单次或20000累计上限，请减少样本/时限，超额需用户另行决定。'})
        return {'ready':True,'sample_count':count,'estimated_upper_core_hours':estimate,
            'base_input_sha256':digest(snapshot['cases'][0]),'snapshot_sha256':digest(snapshot),
            'configuration_sha256':digest(definition),'method':snapshot['definition']['method'],
            'limitations':capability.limitations,'snapshot':snapshot,'configuration':config}

    def submit(self,wid,sid,body):
        request=body.model_dump(mode='json');request_sha=digest(request)
        with self.store.db() as db:
            existing=db.execute('SELECT * FROM dataset_runs WHERE workspace=? AND request_id=?',(wid,str(body.request_id))).fetchone()
        if existing:
            if existing['request_sha256']!=request_sha or existing['study']!=sid:raise HTTPException(409,'同一请求标识对应不同的批量参数。')
            return self.get(wid,sid,existing['id'])
        checked=self.preflight(wid,sid,body);snapshot=checked['snapshot'];config=checked['configuration']
        batch_id=str(uuid4());created=utc_now()
        created_new=False
        with self.store.db(True) as db:
            current=self.research.prepare(db,wid,sid,body.expected_revision,body.expected_study_revision,body.module)
            if digest(current)!=checked['snapshot_sha256']:raise HTTPException(409,'预检期间基准输入发生变化，请重新提交。')
            existing=db.execute('SELECT * FROM dataset_runs WHERE workspace=? AND request_id=?',(wid,str(body.request_id))).fetchone()
            if existing:
                if existing['request_sha256']!=request_sha:raise HTTPException(409,'请求标识冲突。')
                batch_id=existing['id']
            else:
                db.execute('INSERT INTO dataset_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                    (batch_id,wid,sid,str(body.request_id),request_sha,json.dumps(snapshot,ensure_ascii=False),
                     body.configuration_revision,'preparing',self.owner,created,created,None))
                created_new=True
        if not created_new:return self.get(wid,sid,batch_id)
        directory=self.root/batch_id
        if not (directory/'plan.json').exists():
            try:
                create_plan(directory,batch_id=batch_id,base_case=snapshot['cases'][0],method=snapshot['definition']['method'],
                    source={'workspace_id':wid,'workspace_revision':body.expected_revision,'study_id':sid,
                        'study_revision':body.expected_study_revision,'module':body.module,
                        'study_snapshot_sha256':digest(snapshot),'configuration_revision':body.configuration_revision},
                    space=config['definition']['parameter_space'],execution=config['definition']['execution'])
            except Exception as exc:
                self._state(batch_id,'failed',str(exc));raise
        self.start(batch_id)
        return self.get(wid,sid,batch_id)

    def _state(self,batch_id,status,error=None):
        with self.store.db(True) as db:
            db.execute('UPDATE dataset_runs SET status=?,updated=?,error=? WHERE id=? AND owner=?',
                (status,utc_now(),json.dumps({'message':error},ensure_ascii=False) if error else None,batch_id,self.owner))

    def start(self,batch_id,retry=False,retry_id=None):
        with self.guard:
            if self.threads.get(batch_id) and self.threads[batch_id].is_alive():return
            thread=threading.Thread(target=self._execute,args=(batch_id,retry,retry_id),daemon=True)
            self.threads[batch_id]=thread;thread.start()

    def _execute(self,batch_id,retry,retry_id):
        directory=self.root/batch_id
        try:
            plan=read(directory/'plan.json');self._state(batch_id,'running')
            indices=list(range(len(plan['samples'])))
            if retry:indices=[r['index'] for r in rows(directory) if not r['valid']]
            if not indices:self._state(batch_id,'completed');return
            if plan['execution']['backend']=='local':
                selection=directory/'local-selection.json';atomic(selection,indices)
                repository=Path(__file__).resolve().parents[2]
                command=[sys.executable,'-I',str(repository/'backend/kernel/batch_cli.py'),'local',str(directory),'--indices-file',str(selection)]
                if retry:command.append('--retry')
                work=directory/'supervisor';work.mkdir(exist_ok=True)
                result=run_process(command,cwd=work,env=os.environ.copy(),
                    timeout=min(7*86400,len(indices)*(plan['execution']['sample_timeout_s']+90)+120),
                    stderr_limit=8000,stop_event=self.shutdown_event)
                if result.returncode:raise RuntimeError(result.stderr.decode('utf-8','replace')[-4000:])
                result=read(directory/'execution.json')
                self._state(batch_id,result['state'])
            else:
                remote=SlurmBackend(self.profile,self.ledger_path)
                submission=remote.submit(directory,indices,retry,retry_id)
                if not submission.get('job_id'):
                    self._state(batch_id,submission['state'],submission.get('message'));return
                self._state(batch_id,'queued')
                while not self.shutdown_event.is_set():
                    status=remote.poll(directory,submission['token'])
                    if status.get('terminal'):
                        remote.collect(directory,submission['token']);self._state(batch_id,'completed');break
                    self.shutdown_event.wait(15)
                else:return
            export_dataset(directory)
        except RemoteDisconnected as exc:self._state(batch_id,'disconnected',str(exc))
        except Exception as exc:self._state(batch_id,'failed',str(exc))

    def get(self,wid,sid,batch_id,offset=0,limit=50,status=None):
        try:UUID(batch_id)
        except ValueError:raise HTTPException(404,'数据集不存在。') from None
        with self.store.db() as db:
            row=db.execute('SELECT * FROM dataset_runs WHERE id=? AND workspace=? AND study=?',(batch_id,wid,sid)).fetchone()
            if not row:raise HTTPException(404,'数据集不属于此研究。')
            study=self.research.definition(db,wid,sid);workspace,_=self.store.load(db,wid,allow_domain=True)
        result=dict(row);snapshot=json.loads(result.pop('snapshot'));result['error']=json.loads(result['error']) if result['error'] else None
        result['source']={k:snapshot[k] for k in ('workspace_id','workspace_revision','study_id','study_revision')}
        result['historical']=workspace['revision']!=snapshot['workspace_revision'] or study['revision']!=snapshot['study_revision']
        directory=self.root/batch_id
        if not (directory/'plan.json').is_file():return {**result,'samples':[],'sample_count':0,'counts':{}}
        plan=read(directory/'plan.json')
        if digest(plan)!=read(directory/'integrity.json')['plan_sha256']:raise HTTPException(409,'数据集输入完整性检查失败。')
        # Revalidate changed files; polling a completed 2000-sample dataset must
        # not repeatedly hash every multi-megabyte native artifact.
        signature=(digest(plan),tuple((p.relative_to(directory).as_posix(),p.stat().st_size,p.stat().st_mtime_ns)
            for folder in ('samples','raw') for p in sorted((directory/folder).glob('*')) if p.is_file()))
        with self.guard:cached=self.row_cache.get(batch_id)
        if cached and cached[0]==signature:values=cached[1]
        else:
            values=rows(directory)
            with self.guard:
                if len(self.row_cache)>=8:self.row_cache.pop(next(iter(self.row_cache)))
                self.row_cache[batch_id]=(signature,values)
        counts={s:sum(r['status']==s for r in values) for s in {r['status'] for r in values}}
        selected=values if status in (None,'all') else [r for r in values if
            (r['status'] not in ('succeeded','pending','running','nonconverged') if status=='failed' else r['status']==status)]
        result.update(sample_count=len(values),valid_count=sum(r['valid'] for r in values),counts=counts,
            samples=selected[offset:offset+limit],filtered_count=len(selected),offset=offset,next_offset=offset+limit if offset+limit<len(selected) else None,
            parameter_space=plan['parameter_space'],method=plan['method'],plan_sha256=digest(plan),
            execution={**plan['execution'],**(read(directory/'execution.json') if (directory/'execution.json').exists() else {})},
            export=read(directory/'latest-export.json') if (directory/'latest-export.json').exists() else None)
        return result

    def list(self,wid,sid):
        with self.store.db() as db:
            self.research.definition(db,wid,sid)
            values=db.execute('SELECT id,created,status,configuration_revision,error FROM dataset_runs WHERE workspace=? AND study=? ORDER BY created DESC',(wid,sid)).fetchall()
        return [dict(r) for r in values]

    def resume(self,wid,sid,batch_id,body):
        value=self.get(wid,sid,batch_id,limit=1)
        if value['status']=='completed' and not body.retry_failed:return value
        with self.store.db(True) as db:db.execute('UPDATE dataset_runs SET owner=? WHERE id=?',(self.owner,batch_id))
        self.start(batch_id,body.retry_failed,str(body.request_id))
        return value

    def export(self,wid,sid,batch_id):
        self.get(wid,sid,batch_id,limit=1)
        directory=export_dataset(self.root/batch_id)
        destination=directory/'dataset.zip'
        if not destination.exists():
            with zipfile.ZipFile(destination,'w',compression=zipfile.ZIP_DEFLATED) as archive:
                for name in ('metadata.json','samples.csv','valid.csv','samples.jsonl'):archive.write(directory/name,arcname=name)
        return destination


def make_router(service):
    router=APIRouter(prefix='/api/workspaces/{wid}/studies/{sid}')
    @router.get('/batch-configuration')
    def configuration(wid:str,sid:str,module:str|None=None):return service.configuration(wid,sid,module)
    @router.put('/batch-configuration')
    def save(wid:str,sid:str,body:SaveConfiguration):return service.save(wid,sid,body)
    @router.post('/batch-preflight')
    def preflight(wid:str,sid:str,body:SubmitDataset):
        value=service.preflight(wid,sid,body);return {k:v for k,v in value.items() if k not in ('snapshot','configuration')}
    @router.post('/datasets',status_code=202)
    def submit(wid:str,sid:str,body:SubmitDataset):return service.submit(wid,sid,body)
    @router.get('/datasets')
    def listing(wid:str,sid:str):return service.list(wid,sid)
    @router.get('/datasets/{batch_id}')
    def get(wid:str,sid:str,batch_id:str,offset:int=Query(0,ge=0),limit:int=Query(50,ge=1,le=100),status:str|None=Query(None,pattern='^(all|succeeded|failed|nonconverged|pending|running)$')):
        return service.get(wid,sid,batch_id,offset,limit,status)
    @router.post('/datasets/{batch_id}/resume',status_code=202)
    def resume(wid:str,sid:str,batch_id:str,body:ResumeDataset):return service.resume(wid,sid,batch_id,body)
    @router.post('/datasets/{batch_id}/export')
    def export(wid:str,sid:str,batch_id:str):
        return FileResponse(service.export(wid,sid,batch_id),media_type='application/zip',filename='CableSimPro-dataset.zip')
    # Both dataset and saved-study allocations use the same HPC control plane.
    from .hpc_executor import make_router as hpc_router
    combined=APIRouter()
    combined.include_router(router)
    combined.include_router(hpc_router(service.research))
    return combined
