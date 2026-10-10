"""Durable orchestration for derived, saved FEM response studies; no solver."""
from copy import deepcopy
import json
import sys
import time
from threading import Lock
from uuid import UUID
from fastapi import HTTPException
from pydantic import Field
from ..schemas import StrictModel
from ..plugin_host.registry import Registry
from .contracts import CreateStudy, RunStudy
from .workspace import fingerprint
from .batch_files import digest, read
from .batch_slurm import allocation_estimate
from .batch_budget import utc_now


class StepRequest(StrictModel):
    request_id: UUID
    source_run_id: UUID
    capacities: dict | None = None
    controls: dict = Field(default_factory=dict)
    max_core_hours: float = Field(default=16,gt=0,le=2000)
    budget_confirmed: bool = False


class StepResponses:
    def __init__(self,research):
        self.research=research;self.store=research.store;self.guard=Lock();self.active=set()

    def initialize(self):
        with self.store.db(True) as db:
            db.execute('CREATE TABLE IF NOT EXISTS hpc_step_responses(id TEXT PRIMARY KEY,request_digest TEXT NOT NULL,state TEXT NOT NULL)')

    def load(self,identifier):
        self.initialize()
        with self.store.db() as db:row=db.execute('SELECT state FROM hpc_step_responses WHERE id=?',(str(identifier),)).fetchone()
        if row is None:raise HTTPException(404,'阶跃响应记录不存在。')
        value=json.loads(row['state']);method=value['definition']['method']
        if value['status'] in ('queued','running') and value['owner']!=self.research.owner_epoch:
            value.update(status='interrupted',reason='宿主已重启；恢复时回收原作业，不重复提交。')
        phase='run' if value.get('run_id') else 'check'
        execution=self.research.executor.execution_status(value.get('run_id') or value['id'],method['plugin_id'],method['capability'],phase=phase)
        value['execution']=execution
        if value.get('run_id'):
            with self.store.db() as db:run=db.execute('SELECT sequence FROM study_runs WHERE id=?',(value['run_id'],)).fetchone()
            if run:value['sequence']=run['sequence']
        actual=(execution or {}).get('actual_cpu_seconds',0)/3600
        value['used_core_hours']=value.get('preflight_core_hours',0)+actual if phase=='run' else actual
        return value

    def save(self,value):
        value=deepcopy(value);value.pop('execution',None);value.pop('used_core_hours',None);value.pop('sequence',None);value['updated']=utc_now()
        with self.store.db(True) as db:
            previous=json.loads(db.execute('SELECT state FROM hpc_step_responses WHERE id=?',(value['id'],)).fetchone()['state'])
            value['cancel_requested']=value['cancel_requested'] or previous['cancel_requested']
            db.execute('UPDATE hpc_step_responses SET state=? WHERE id=?',(json.dumps(value,ensure_ascii=False,allow_nan=False),value['id']))

    def list(self,wid,sid):
        self.initialize()
        with self.store.db() as db:ids=[r['id'] for r in db.execute('SELECT id FROM hpc_step_responses ORDER BY rowid DESC')]
        return [v for identifier in ids if (v:=self.load(identifier))['workspace']==wid and sid in (v['source_study'],v['study'])]

    def prepared(self,wid,sid,body):
        run=self.research.get_run(wid,str(body.source_run_id))
        if run['study']!=sid:raise HTTPException(422,'来源运行不属于当前研究。')
        plugin=Registry(self.research.executor.registry.root,plugin_id='cablesim.simulation').get('cablesim.simulation');plugin.verify()
        sys.path.insert(0,str(plugin.directory/'src'))
        try:
            from cablesim_simulation.step_response import from_saved_run,prepare
            value=from_saved_run(run,body.capacities)
            original=run['snapshot']['cases'][0]['parameters']
            controls={**{k:v for k,v in original.items() if k in ('mesh','first_time_s','final_time_s','intervals_per_decade','max_levels','tolerance_k')},**body.controls,'operation':'step_response'}
            _,parsed=prepare(value,controls);controls=parsed.model_dump(mode='json')
        except (ValueError,KeyError) as exc:raise HTTPException(422,str(exc)) from exc
        finally:sys.path.pop(0)
        method=dict(plugin_id=plugin.manifest.id,version=plugin.manifest.version,capability='fem-step-response',release_digest=fingerprint(plugin.manifest.model_dump(mode='json',by_alias=True)))
        if not self.research.executor.required(method['plugin_id'],method['capability']):raise HTTPException(422,'未配置 dg83；拒绝本机求解。')
        estimate=allocation_estimate(self.research.executor.resources(plugin.manifest,1),1,read(self.research.executor.profile))
        return run,value,controls,method,2*estimate['upper_core_hours']

    def estimate(self,wid,sid,body):
        run,value,controls,method,budget=self.prepared(wid,sid,body)
        return dict(budget_core_hours=budget,source_run_id=run['id'],reference_current_a=value['reference_current_a'],
                    material_regions=list(value['capacities']),controls=controls,node_limit=controls['mesh']['max_nodes'],
                    estimated_nodes=None,estimate_status='mesh_preflight_required')

    def start(self,wid,sid,body):
        if not body.budget_confirmed:raise HTTPException(422,'请确认阶跃响应预检与运行的核时预算。')
        self.initialize();identifier=str(body.request_id);identity=digest({'workspace':wid,'study':sid,**body.model_dump(mode='json')})
        with self.guard:
            with self.store.db() as db:old=db.execute('SELECT request_digest FROM hpc_step_responses WHERE id=?',(identifier,)).fetchone()
            if old:
                if old['request_digest']!=identity:raise HTTPException(409,'相同请求标识对应不同响应输入。')
                return self.load(identifier)
            run,value,controls,method,budget=self.prepared(wid,sid,body)
            if budget>body.max_core_hours:raise HTTPException(422,f'预检和运行需预留 {budget:.3f} 核时。')
            if self.active or any(v['status'] in ('queued','running','interrupted') for v in self.list(wid,sid)):
                raise HTTPException(409,'已有未结束阶跃响应，请停止或恢复原记录。')
            definition=deepcopy(run['snapshot']['definition'])
            definition.update(title=definition['title'][:85]+' · 阶跃热响应',method=method,task=None,input_source='study',method_input=value,
                              parameters=controls,driver={'kind':'single'},verification=None,crosschecks=[],modules={})
            with self.store.db(True) as db:
                revision=db.execute('SELECT revision FROM workspaces WHERE id=?',(wid,)).fetchone()['revision']
                study=self.research.save(wid,CreateStudy.model_validate({**definition,'expected_revision':revision}),connection=db)
                state=dict(id=identifier,workspace=wid,source_study=sid,source_run_id=run['id'],study=study['id'],status='queued',
                           owner=self.research.owner_epoch,created=utc_now(),updated=utc_now(),definition=definition,workspace_revision=revision,
                           study_revision=study['revision'],budget_core_hours=body.max_core_hours,cancel_requested=False,run_id=None,reason=None)
                db.execute('INSERT INTO hpc_step_responses VALUES (?,?,?)',(identifier,identity,json.dumps(state,ensure_ascii=False)))
            self.launch(identifier)
        return self.load(identifier)

    def launch(self,identifier):
        if identifier in self.active:return
        self.active.add(identifier);self.research.background.submit(self.work,identifier)

    def cancel(self,identifier):
        value=self.load(identifier)
        if value['status'] not in ('queued','running','interrupted'):return value
        value['cancel_requested']=True;self.save(value);method=value['definition']['method']
        if value.get('execution'):
            self.research.executor.request_cancel(value.get('run_id') or value['id'],method['plugin_id'],method['capability'],phase='run' if value.get('run_id') else 'check')
        return self.load(identifier)

    def resume(self,identifier):
        with self.guard:
            value=self.load(identifier)
            if value['status']!='interrupted':return value
            if self.active:raise HTTPException(409,'已有阶跃响应在运行。')
            value.update(owner=self.research.owner_epoch,status='queued',reason=None);self.save(value);self.launch(identifier)
        return self.load(identifier)

    def work(self,identifier):
        value=self.load(identifier)
        try:
            value['status']='running';self.save(value)
            if not value.get('run_id'):
                with self.research.executor.check_operation(identifier,lambda:self.load(identifier)['cancel_requested']):
                    check=self.research.preflight(value['workspace'],value['study'],value['workspace_revision'],value['study_revision'])
                value['preflight_core_hours']=self.load(identifier)['used_core_hours'];self.save(value)
                if self.load(identifier)['cancel_requested']:value.update(status='cancelled',reason='已停止；预检记录保留。');return
                if not check['ready'] or check.get('partial'):raise ValueError('预检未通过：'+json.dumps(check['cases'],ensure_ascii=False))
                body=RunStudy(request_id=identifier,expected_revision=value['workspace_revision'],expected_study_revision=value['study_revision'],lock_digest=check['lock_digest'],scope_acknowledged=True)
                run=self.research.execute(value['workspace'],value['study'],body,asynchronous=True,checked_preflight=check)
                value['run_id']=run['id'];self.save(value)
            else:
                run=self.research.get_run(value['workspace'],value['run_id'])
                if run['status'] in ('failed','interrupted'):run=self.research.resume_remote(value['workspace'],value['study'],run['id'])
            while run['status'] in ('accepted','running','validating'):
                if self.load(identifier)['cancel_requested']:self.cancel(identifier)
                time.sleep(3)
                with self.store.db() as db:status=db.execute('SELECT status FROM study_runs WHERE id=?',(run['id'],)).fetchone()['status']
                if status not in ('accepted','running','validating'):run=self.research.get_run(value['workspace'],run['id'])
            if run['status']=='succeeded':value.update(status='completed',reason=None)
            elif (run.get('error') or {}).get('code') in ('REMOTE_DISCONNECTED','PermissionError','OSError'):value.update(status='interrupted',reason='连接中断，保存原作业；恢复只回收原运行。')
            else:value.update(status='cancelled' if self.load(identifier)['cancel_requested'] else 'failed',reason=str(run.get('error') or run.get('status')))
        except Exception as exc:
            recoverable=isinstance(exc,OSError) or getattr(exc,'code',None) in ('REMOTE_DISCONNECTED','REMOTE_JOB_MISSING')
            value.update(status='interrupted' if recoverable else 'cancelled' if self.load(identifier)['cancel_requested'] else 'failed',reason=str(getattr(exc,'detail',exc)))
        finally:
            value['finished']=utc_now() if value['status'] not in ('running','interrupted') else None;self.save(value);self.active.discard(identifier)

    def result(self,identifier):
        value=self.load(identifier)
        if not value.get('run_id'):return {**value,'response':None}
        run=self.research.get_run(value['workspace'],value['run_id'])
        if run.get('integrity')!='verified' or run['status']!='succeeded':return {**value,'response':None}
        output=run.get('output');cases=output.get('cases',[]) if isinstance(output,dict) else []
        case=cases[0] if isinstance(cases,list) and len(cases)==1 and isinstance(cases[0],dict) else {}
        artifacts=case.get('artifacts');artifacts=artifacts if isinstance(artifacts,dict) else {}
        bundle=artifacts.get('x-cablesim.simulation-bundle')
        response=bundle.get('step_response') if isinstance(bundle,dict) else None
        if not isinstance(response,dict) or response.get('schema')!='cablesim.fem-step-response-result/1' or not isinstance(response.get('curve'),list) or not isinstance(response.get('convergence'),dict):
            raise HTTPException(409,'保存运行缺少有效阶跃响应工件；原运行保留，请核查工件版本与结构。')
        return {**value,'sequence':run.get('sequence'),'response':response,
                'emergency_input':artifacts.get('x-cablesim.emergency-input')}
