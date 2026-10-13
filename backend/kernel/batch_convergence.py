"""Sequential refinement of saved runs; solvers remain in the selected plugin.

Each accepted level is a normal study run. This table stores only orchestration
and verified observations, so database backups retain the complete study.
"""
from copy import deepcopy
from math import isfinite, isclose
import json
from threading import Lock
from uuid import UUID, uuid4, uuid5

from fastapi import HTTPException
from pydantic import Field
from ..schemas import StrictModel
from ..plugin_host import PluginHostError
from .batch_files import digest, read
from .batch_budget import utc_now
from .contracts import CreateStudy, UpdateStudy, RunStudy
from .batch_slurm import allocation_estimate


class RefineRequest(StrictModel):
    request_id: UUID
    source_run_id: UUID
    max_core_hours: float = Field(default=12, gt=0, le=2000)
    max_steps: int = Field(default=8, ge=1, le=16)
    tolerance_k: float = Field(default=.1, gt=0, le=.1)
    budget_confirmed: bool = False
    max_nodes: int | None = Field(default=None,ge=100,le=4000000)
    upgrade_method: bool = False
    temperature_only_levels: bool = True
    calculate_final_rating: bool = False
    continue_from: UUID | None = None
    minimum_domain_levels: int = Field(default=2,ge=2,le=3,description='Minimum doubled-domain validation levels before final rating; never relaxes the two-change threshold.')
    retain_domain_levels: int | None = Field(default=None,ge=2,le=3,description='Continue on a verified converged domain prefix; retain later validation as history.')


def observation(run, case_id, kind):
    if run['integrity'] != 'verified':raise ValueError('保存运行完整性未通过。')
    row=next(c for c in run['output']['cases'] if c['case_id']==case_id)
    if row['status']!='succeeded' or run['artifact_status'][case_id]['x-cablesim.temperature-field']['status']!='verified':
        raise ValueError('温度场工件没有通过校验。')
    field=row['artifacts']['x-cablesim.temperature-field']
    if field.get('source',{}).get('binding')=='iec-trace':raise ValueError('自动收敛需要有限元保存场。')
    original=next(c for c in run['snapshot']['cases'] if c['case_id']==case_id)
    parameters=original['parameters']; peak=field['hotspot']['temperature_k']
    if not isfinite(peak):raise ValueError('热点温度不是有限数值。')
    if row['artifacts'].get('x-cablesim.simulation-bundle',{}).get('field_storage'):
        from .batch_field_storage import full_field
        full=full_field(row);nodes=len(full['points']);peak=float(full['temperature_k'].max())
    else:nodes=len(field['mesh']['points'])
    return {'run_id':run['id'],'case_id':case_id,'kind':kind,'hotspot_k':peak,
            'nodes':nodes,'mesh_size_m':parameters['mesh']['size_m'],
            'bounds_m':parameters['domain_options']['bounds_m'],
            'output_digest':run['output_digest'],'artifact_digest':row['artifact_digests']['x-cablesim.temperature-field'],
            'sequence':run.get('sequence'),'created':run.get('created'),'study_name':run['snapshot']['definition']['title'],'change_k':None,
            **({'outer_boundary':parameters['outer_boundary']} if 'outer_boundary' in parameters else {})}


def verdict(rows,tolerance):
    mesh=[r for r in rows if r['kind']=='mesh']
    domain=[r for r in rows if r['kind']=='domain']
    boundary_consistent=len({r.get('outer_boundary','ambient_truncated') for r in rows})<=1
    changes=[abs(a['hotspot_k']-b['hotspot_k']) for a,b in zip(mesh,mesh[1:])]
    mesh_ok=boundary_consistent and len(changes)>=2 and all(v<tolerance for v in changes[-2:]) and all(
        a['mesh_size_m']>b['mesh_size_m'] and a['bounds_m']==b['bounds_m'] for a,b in zip(mesh,mesh[1:]))
    # Domain observations must use the latest mesh. A mesh advance invalidates
    # the old domain sequence; callers retain it as history, never as evidence.
    matching=[r for r in domain if mesh and r['mesh_size_m']==mesh[-1]['mesh_size_m']]
    domain_change=None; domain_changes=[]; domain_geometry=True
    for previous,current in zip([mesh[-1]]+matching,matching) if mesh else []:
        a,b=previous['bounds_m'],current['bounds_m']
        domain_geometry &= (isclose(b[2]-b[0],2*(a[2]-a[0])) and isclose(b[3]-b[1],2*(a[3]-a[1]))
                            and isclose(b[0]+b[2],a[0]+a[2],abs_tol=1e-9) and b[3]==a[3])
        domain_change=abs(current['hotspot_k']-previous['hotspot_k'])
        domain_changes.append(domain_change)
    domain_ok=boundary_consistent and domain_geometry and len(domain_changes)>=2 and all(v<tolerance for v in domain_changes[-2:])
    return {'mesh_passed':mesh_ok,'domain_passed':domain_ok,'status':'converged' if mesh_ok and domain_ok else 'unconverged',
            'grid_change_k':changes[-1] if changes else None,'domain_change_k':domain_change,
            'tolerance_k':tolerance,'engineering_approval':False}


def next_parameters(parameters,kind):
    value=deepcopy(parameters)
    if kind=='mesh':
        value['mesh']['size_m']/=2
        value['mesh']['far_size_m']/=2
        value['mesh']['minimum_circle_segments']=min(512,2*value['mesh'].get('minimum_circle_segments',8))
    else:
        left,bottom,right,top=value['domain_options']['bounds_m'];center=(left+right)/2
        value['domain_options']['bounds_m']=[center-(right-left),top-2*(top-bottom),center+(right-left),top]
    return value


def verified_domain_prefix(rows,levels,tolerance):
    mesh=[r for r in rows if r['kind']=='mesh']
    domains=[r for r in rows if r['kind']=='domain']
    if len(domains)<levels:raise ValueError('所选计算域没有足够的已保存扩域级别。')
    selected=deepcopy(mesh+domains[:levels])
    if verdict(selected,tolerance)['status']!='converged':raise ValueError('所选计算域尚未满足两类连续两级门槛。')
    return selected


def failure_state(states,cancelled,recoverable=False):
    terminal=('COMPLETED','CANCELLED','TIMEOUT','OUT_OF_MEMORY','FAILED','NODE_FAIL','PREEMPTED','BOOT_FAIL','DEADLINE')
    if not states or not all(s in terminal for s in states):return 'interrupted'
    if cancelled:return 'cancelled'
    if recoverable and all(s=='COMPLETED' for s in states):return 'interrupted'
    return 'failed'


class Refinements:
    def __init__(self,research):
        self.research=research;self.store=research.store;self.guard=Lock();self.active=set()

    def initialize(self):
        with self.store.db(True) as db:
            db.execute('CREATE TABLE IF NOT EXISTS hpc_convergence(id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,request_digest TEXT NOT NULL,state TEXT NOT NULL)')

    def load(self,identifier):
        self.initialize()
        with self.store.db() as db:row=db.execute('SELECT state FROM hpc_convergence WHERE id=?',(str(identifier),)).fetchone()
        if row is None:raise HTTPException(404,'收敛研究不存在。')
        value=json.loads(row['state'])
        if not value.get('source_execution'):
            method=value['definition']['method']
            value['source_execution']=self.research.executor.execution_status(value['source_run_id'],method['plugin_id'],method['capability'])
        value.pop('current_execution',None);value.pop('live_core_hours',None)
        if value.get('request',{}).get('continue_from') and ('history_attempts' not in value or 'origin_study' not in value):
            with self.store.db() as db:parent=db.execute('SELECT state FROM hpc_convergence WHERE id=?',(value['request']['continue_from'],)).fetchone()
            previous=json.loads(parent['state']) if parent else {}
            value['history_attempts']=previous.get('history_attempts',[])+previous.get('attempts',[])
            value['origin_study']=previous.get('origin_study',previous.get('source_study',value['source_study']))
        if value['status'] in ('queued','running') and value['owner']!=self.research.owner_epoch:
            value['status']='interrupted';value['reason']='宿主已重启；恢复时先回收原运行，不重复提交。'
        if value.get('pending'):
            method=value['definition']['method'];operation=value.get('current_run_id') or value['pending']['request_id']
            value['current_execution']=self.research.executor.execution_status(operation,method['plugin_id'],method['capability'],
                **({} if value.get('current_run_id') else {'phase':'check'}))
            execution=value['current_execution'] or {}
            recorded=value.get('run_executions',{}).get(operation,{}) if value.get('current_run_id') else value.get('preflight_executions',{}).get(execution.get('plan_id'),{})
            value['live_core_hours']=value['actual_core_hours']+max(0,execution.get('actual_cpu_seconds',0)-recorded.get('actual_cpu_seconds',0))/3600
        return value

    def save(self,value):
        value['updated']=utc_now()
        with self.store.db(True) as db:
            previous=db.execute('SELECT state FROM hpc_convergence WHERE id=?',(value['id'],)).fetchone()
            if previous:value['cancel_requested']=value['cancel_requested'] or json.loads(previous['state'])['cancel_requested']
            db.execute('UPDATE hpc_convergence SET state=? WHERE id=?',(json.dumps(value,ensure_ascii=False,allow_nan=False),value['id']))

    def list(self,wid=None,sid=None):
        self.initialize()
        with self.store.db() as db:ids=[r['id'] for r in db.execute('SELECT id FROM hpc_convergence ORDER BY rowid DESC')]
        return [v for i in ids if (v:=self.load(i)) and (wid is None or v['workspace']==wid) and (sid is None or sid in (v['source_study'],v['study'],v.get('origin_study')))]

    def start(self,wid,sid,body):
        if not body.budget_confirmed:raise HTTPException(422,'请确认本次累计核时预算。')
        if body.retain_domain_levels is not None and not body.continue_from:raise HTTPException(422,'选择已验证计算域需要原收敛记录。')
        if body.retain_domain_levels is not None and body.retain_domain_levels<body.minimum_domain_levels:raise HTTPException(422,'所选计算域级数不能小于要求的验证级数。')
        self.initialize();request=body.model_dump(mode='json');identity=digest({'workspace':wid,'study':sid,**request})
        with self.store.db() as db:old=db.execute('SELECT id,request_digest FROM hpc_convergence WHERE request_id=?',(str(body.request_id),)).fetchone()
        if old:
            if old['request_digest']!=identity:raise HTTPException(409,'同一请求标识对应不同收敛设置。')
            return self.load(old['id'])
        run=self.research.get_run(wid,str(body.source_run_id))
        previous=self.load(str(body.continue_from)) if body.continue_from else None
        inherited_source=previous and previous['workspace']==wid and previous['study']==sid and previous['source_run_id']==run['id']
        if (run['study']!=sid and not inherited_source) or run['status'] not in ('succeeded','partial'):raise HTTPException(422,'请选择此研究或其已绑定收敛起点的完整有限元运行。')
        if body.tolerance_k>min(.1,run.get('convergence',{}).get('tolerance_k',.1)):
            raise HTTPException(422,'不能放宽原保存研究的收敛门槛。')
        reference=run.get('convergence',{}).get('reference_case_id') or run['output']['cases'][0]['case_id']
        try:
            base=observation(run,reference,'mesh')
            original=next(c for c in run['snapshot']['cases'] if c['case_id']==reference)
            parameters=deepcopy(original['parameters'])
            method=deepcopy(run['snapshot']['definition']['method'])
            if body.upgrade_method:
                from .workspace import fingerprint
                from ..plugin_host.registry import Registry
                installed=Registry(self.research.executor.registry.root,plugin_id=method['plugin_id']).get(method['plugin_id']).manifest
                method.update(version=installed.version,release_digest=fingerprint(installed.model_dump(mode='json',by_alias=True)))
            if body.max_nodes is not None:parameters['mesh']['max_nodes']=body.max_nodes
            if method['capability']!='iec-thermal-field':raise ValueError('自动加密当前仅覆盖 IEC 耦合有限元热场；此能力尚未覆盖。')
            if not self.research.executor.required(method['plugin_id'],method['capability']):raise ValueError('该方法未配置超算执行，拒绝本机求解。')
            plugin,_=self.research.resolve(method)
            if not parameters['domain_options']['bounds_m'] or parameters['mesh']['size_m']<=0:raise ValueError('缺少有单位的网格和有限计算域。')
        except (KeyError,ValueError,StopIteration) as exc:raise HTTPException(422,str(exc)) from exc
        rows=[];validation_history=None
        # Only accept the existing checker history after it verified model identity,
        # refinement order and domain geometry (it sets reference_case_id last).
        if run.get('convergence',{}).get('rows') and not run['convergence'].get('reference_case_id'):
            raise HTTPException(422,'原收敛研究的工况身份或几何校验未通过；不能继续其序列。')
        for source in run.get('convergence',{}).get('rows',[]):
            try:row=observation(run,source['case_id'],source['kind'])
            except (KeyError,ValueError,StopIteration):continue
            row['change_k']=source.get('change_k');rows.append(row)
        if body.continue_from:
            if previous['workspace']!=wid or previous['study']!=sid or previous['status'] in ('queued','running','interrupted'):
                raise HTTPException(409,'继续来源须为本研究已结束的收敛记录；请先停止原任务。')
            stop=next((i for i,r in enumerate(previous['rows']) if r['run_id']==run['id'] and r['kind']=='mesh'),None)
            if stop is None:raise HTTPException(422,'继续来源必须包含所选保存网格。')
            # Keep completed expansions after the selected finest mesh. They
            # remain valid evidence and must not be submitted a second time.
            tail=previous['rows'][stop+1:]
            keep_tail=all(r['kind']=='domain' and r['mesh_size_m']==base['mesh_size_m'] for r in tail)
            rows=deepcopy(previous['rows'] if keep_tail else previous['rows'][:stop+1])
            for row in rows:
                saved=self.research.get_run(wid,row['run_id']);actual=observation(saved,row['case_id'],row['kind'])
                if any(actual[k]!=row[k] for k in actual if k not in ('change_k','study_name')):raise HTTPException(409,'原收敛记录与保存工件不一致。')
            if body.retain_domain_levels is not None:
                validation_history={'convergence_id':previous['id'],'rows':deepcopy(rows),
                    'preflight_executions':previous.get('preflight_executions',{}),
                    'run_executions':previous.get('run_executions',{}),'actual_core_hours':previous['actual_core_hours'],
                    'status':previous['status'],'reason':previous.get('reason')}
                try:rows=verified_domain_prefix(rows,body.retain_domain_levels,body.tolerance_k)
                except ValueError as exc:raise HTTPException(422,str(exc)) from exc
            # Intermediate temperature-only runs do not replace the original
            # request to calculate the final rating after convergence.
            parameters.setdefault('iec',{})['operation']=previous['definition']['parameters'].get('iec',{}).get('operation','both')
        if not rows:rows=[base]
        definition=deepcopy(run['snapshot']['definition'])
        definition.update(title=(definition['title'].removesuffix(' · 自动收敛')[:90]+' · 自动收敛'),method=method,task=None,input_source='study',method_input=original['input'],
                          parameters=parameters,driver={'kind':'single'},verification=None,crosschecks=[],modules={})
        with self.store.db() as db:revision=db.execute('SELECT revision FROM workspaces WHERE id=?',(wid,)).fetchone()['revision']
        identifier=str(uuid4());stamp=utc_now()
        estimate=allocation_estimate(self.research.executor.resources(plugin.manifest,1),1,read(self.research.executor.profile))
        # Reserve enough headroom for a fresh mesh preflight and one solved level.
        per_step=2*estimate['upper_core_hours']
        if per_step>body.max_core_hours:raise HTTPException(422,f'核时预算不足；一次预检及运行预算上限为 {per_step:.3f} 核时。')
        with self.guard:
            with self.store.db() as db:old=db.execute('SELECT id,request_digest FROM hpc_convergence WHERE request_id=?',(str(body.request_id),)).fetchone()
            if old:
                if old['request_digest']!=identity:raise HTTPException(409,'同一请求标识对应不同收敛设置。')
                return self.load(old['id'])
            if self.active:raise HTTPException(409,'已有自动收敛任务在执行；为限制内存与核时，请等待其完成。')
            if any(v['status'] in ('queued','running','interrupted') for v in self.list(wid,sid)):raise HTTPException(409,'此研究已有未完成的自动收敛任务，请恢复或取消原任务。')
            with self.store.db(True) as db:
                study=self.research.save(wid,CreateStudy.model_validate({**definition,'expected_revision':revision}),connection=db)
                value={'id':identifier,'workspace':wid,'source_study':sid,'origin_study':previous.get('origin_study',previous['source_study']) if body.continue_from else sid,'source_run_id':run['id'],'study':study['id'],
                    'title':definition['title'],'owner':self.research.owner_epoch,'status':'queued','created':stamp,'updated':stamp,
                    'request':request,'workspace_revision':revision,'study_revision':study['revision'],'definition':definition,
                    'mesh_parameters':parameters,'domain_parameters':deepcopy(parameters),'rows':rows,'attempts':[],
                    'preflight_executions':{},
                    'source_execution':run.get('execution'),
                    'actual_core_hours':0.,'per_step_upper_core_hours':per_step,'cancel_requested':False,
                    'reason':None,'blocked_phases':[],'verdict':verdict(rows,body.tolerance_k)}
                if validation_history:value['validation_history']=validation_history
                # Continue the existing expanded domain only while it uses the same finest mesh.
                domain=[r for r in rows if r['kind']=='domain' and r['mesh_size_m']==base['mesh_size_m']]
                if domain:value['domain_parameters']['domain_options']['bounds_m']=domain[-1]['bounds_m']
                db.execute('INSERT INTO hpc_convergence VALUES (?,?,?,?)',(identifier,str(body.request_id),identity,json.dumps(value,ensure_ascii=False)))
            self.launch(identifier)
        return self.load(identifier)

    def launch(self,identifier):
        if identifier in self.active:return
        self.active.add(identifier);self.research.background.submit(self.work,identifier)

    def cancel(self,identifier):
        value=self.load(identifier)
        if value['status'] not in ('queued','running','interrupted'):return value
        with self.store.db(True) as db:
            current=json.loads(db.execute('SELECT state FROM hpc_convergence WHERE id=?',(value['id'],)).fetchone()['state'])
            current['cancel_requested']=True
            db.execute('UPDATE hpc_convergence SET state=? WHERE id=?',(json.dumps(current,ensure_ascii=False),value['id']))
        value=self.load(identifier)
        if value.get('current_run_id'):
            method=value['definition']['method'];self.research.executor.request_cancel(value['current_run_id'],method['plugin_id'],method['capability'])
        elif value.get('pending'):
            method=value['definition']['method']
            try:self.research.executor.request_cancel(value['pending']['request_id'],method['plugin_id'],method['capability'],phase='check')
            except PluginHostError as exc:
                if exc.code!='REMOTE_JOB_MISSING':raise
        if identifier not in self.active:
            # An interrupted workflow has no worker to settle its cancellation.
            # Restart accounting only; work() sees the saved cancel intent first.
            value.update(owner=self.research.owner_epoch,status='queued');self.save(value);self.launch(identifier)
        return self.load(identifier)

    def resume(self,identifier):
        with self.guard:
            value=self.load(identifier)
            execution=value.get('current_execution') or {}
            collection_failed=value['status']=='failed' and value.get('current_run_id') and execution.get('state')=='collecting' and execution.get('slurm_states') and all(s=='COMPLETED' for s in execution['slurm_states'])
            if value['status']!='interrupted' and not collection_failed:return value
            if self.active:raise HTTPException(409,'请等待当前自动收敛任务完成。')
            value.update(owner=self.research.owner_epoch,status='queued',reason=None);self.save(value);self.launch(identifier)
        return self.load(identifier)

    def work(self,identifier):
        try:
            value=self.load(identifier);value['status']='running';self.save(value)
            while True:
                value=self.load(identifier)
                if value['cancel_requested']:
                    self.settle_cancel(value)
                    value.update(status='cancelled',reason='已停止后续加密；现有作业已核对终态与核时。');break
                value['verdict']=verdict(value['rows'],value['request']['tolerance_k'])
                matched_domains=[r for r in value['rows'] if r['kind']=='domain' and r['mesh_size_m']==value['mesh_parameters']['mesh']['size_m']]
                extra_domain=value['verdict']['status']=='converged' and len(matched_domains)<value['request'].get('minimum_domain_levels',2)
                passed=value['verdict']['status']=='converged' and not extra_domain
                needs_rating=value['request'].get('calculate_final_rating',False) or (value['request'].get('temperature_only_levels',True) and value['definition']['parameters'].get('iec',{}).get('operation','both')=='both')
                if passed and (not needs_rating or value.get('rating_run_id')):
                    value.update(status='completed',reason='网格与扩域各连续两级均小于原阈值；最终量值来自保存的全网格运行。');break
                kind='rating' if passed else 'domain' if extra_domain and 'domain' not in value['blocked_phases'] else next((k for k in ('mesh','domain') if not value['verdict'][k+'_passed'] and k not in value['blocked_phases']),None)
                if kind is None:value.update(status='blocked',reason='当前资源上限不能完成收敛；原阈值未改变。');break
                if not value.get('pending') and (len(value['attempts'])>=value['request']['max_steps'] or value['actual_core_hours']+value['per_step_upper_core_hours']>value['request']['max_core_hours']):
                    value.update(status='budget_exhausted',reason='达到级数或核时预算上限；后续一级仍需预留 '+str(round(value['per_step_upper_core_hours'],3))+' 核时，实际用量须运行后结算。');break
                self.step(value,value.get('pending',{}).get('kind',kind))
            value['finished']=utc_now();self.save(value)
        except Exception as exc:
            value=self.load(identifier)
            pending=value.get('pending');execution=None
            if pending:
                method=value['definition']['method']
                execution=self.research.executor.execution_status(pending['request_id'],method['plugin_id'],method['capability'],phase='check')
                if execution:self.charge(value,'preflight_executions',execution['plan_id'],execution)
                if value.get('current_run_id'):
                    execution=self.research.executor.execution_status(value['current_run_id'],method['plugin_id'],method['capability'])
                    if execution:self.charge(value,'run_executions',value['current_run_id'],execution)
            states=(execution or {}).get('slurm_states',[])
            recoverable=isinstance(exc,OSError)
            if value.get('current_run_id'):
                try:
                    failed_run=self.research.get_run(value['workspace'],value['current_run_id'])
                    recoverable |= (failed_run.get('error') or {}).get('code') in ('REMOTE_DISCONNECTED','PermissionError','OSError')
                except Exception:pass  # Preserve the original error if its saved record cannot be read.
            status=failure_state(states,value['cancel_requested'],recoverable)
            value.update(status=status,reason=str(getattr(exc,'detail',exc)))
            if status in ('failed','cancelled'):value['finished']=utc_now()
            self.save(value)
        finally:self.active.discard(identifier)

    def settle_cancel(self,value):
        import time
        pending=value.get('pending')
        if not pending:return
        method=value['definition']['method'];phase='run' if value.get('current_run_id') else 'check'
        operation=value.get('current_run_id') or pending['request_id'];executor=self.research.executor
        if executor.execution_status(operation,method['plugin_id'],method['capability'],phase=phase) is None:return
        executor.request_cancel(operation,method['plugin_id'],method['capability'],phase=phase)
        while True:
            execution=executor.refresh_status(operation,method['plugin_id'],method['capability'],phase=phase)
            if execution is None:raise ValueError('提交身份尚未确认；取消意图已保存，请恢复后核对原作业。')
            self.charge(value,'run_executions' if phase=='run' else 'preflight_executions',operation if phase=='run' else execution['plan_id'],execution)
            self.save(value)
            states=execution.get('slurm_states',[])
            if states and all(s in ('COMPLETED','CANCELLED','TIMEOUT','OUT_OF_MEMORY','FAILED','NODE_FAIL','PREEMPTED','BOOT_FAIL','DEADLINE') for s in states):return
            time.sleep(5)

    @staticmethod
    def charge(value,key,identifier,execution):
        previous=value.setdefault(key,{}).get(identifier,{})
        seconds=max(previous.get('actual_cpu_seconds',0),execution.get('actual_cpu_seconds',0))
        value['actual_core_hours']+=(seconds-previous.get('actual_cpu_seconds',0))/3600
        value[key][identifier]={**execution,'actual_cpu_seconds':seconds}

    def step(self,value,kind):
        # The persisted request ID is written before execute, making replay safe
        # if the response or process is lost after Slurm accepted a job.
        pending=value.get('pending')
        if not pending:
            parameters=deepcopy(value['domain_parameters']) if kind=='rating' else next_parameters(value[kind+'_parameters'],kind)
            if kind=='rating':
                parameters['iec']=deepcopy(value['definition']['parameters']['iec'])
                if value['request'].get('calculate_final_rating',False):parameters['iec']['operation']='both'
            elif value['request'].get('temperature_only_levels',True):parameters.setdefault('iec',{})['operation']='temperature'
            definition={**value['definition'],'parameters':parameters}
            body=UpdateStudy.model_validate({**definition,'expected_revision':value['workspace_revision'],'expected_study_revision':value['study_revision']})
            with self.store.db(True) as db:
                study=self.research.save(value['workspace'],body,value['study'],connection=db)
                pending={'kind':kind,'parameters':parameters,'request_id':str(uuid5(UUID(value['id']),str(len(value['attempts'])))),
                         'study_revision':study['revision'],'created':utc_now()}
                value.update(study_revision=study['revision'],pending=pending)
                previous=json.loads(db.execute('SELECT state FROM hpc_convergence WHERE id=?',(value['id'],)).fetchone()['state'])
                value['cancel_requested']=previous['cancel_requested']
                db.execute('UPDATE hpc_convergence SET state=? WHERE id=?',(json.dumps(value,ensure_ascii=False),value['id']))
            if value['cancel_requested']:return
        wid=value['workspace'];sid=value['study']
        with self.research.executor.check_operation(pending['request_id'],lambda:self.load(value['id'])['cancel_requested']):
            check=self.research.preflight(wid,sid,value['workspace_revision'],pending['study_revision'])
        for case in check['cases']:
            evidence=(case.get('evidence') or {}).get('preflight_execution')
            if evidence:self.charge(value,'preflight_executions',evidence['plan_id'],evidence)
        self.save(value)
        if value['cancel_requested']:return
        if not check['ready'] or check.get('partial'):
            errors=[c.get('error') for c in check['cases'] if c['status']!='succeeded']
            value['attempts'].append({**pending,'status':'preflight_failed','errors':errors})
            value['blocked_phases'].append(kind);value.pop('pending',None);self.save(value);return
        body=RunStudy(request_id=pending['request_id'],expected_revision=value['workspace_revision'],expected_study_revision=pending['study_revision'],lock_digest=check['lock_digest'],scope_acknowledged=True)
        run=self.research.execute(wid,sid,body,asynchronous=True,checked_preflight=check)
        value['current_run_id']=run['id'];self.save(value)
        if run['status'] in ('failed','interrupted'):
            execution=run.get('execution') or {}
            self.charge(value,'run_executions',run['id'],execution);self.save(value)
            preparing=execution.get('plan_id') and not execution.get('job_id')
            completed_collection=execution.get('job_id') and execution.get('slurm_states') and all(s=='COMPLETED' for s in execution['slurm_states'])
            if preparing or completed_collection or execution.get('state')=='disconnected' or run['status']=='interrupted' or (run.get('error') or {}).get('code') in ('REMOTE_DISCONNECTED','PermissionError','OSError'):
                run=self.research.resume_remote(wid,sid,run['id'])
            else:raise ValueError('原作业已经失败：'+str(run.get('error') or '请查看原运行诊断')+'；原记录保留，不重复提交。')
        value['current_run_id']=run['id'];self.save(value)
        import time
        while run['status'] in ('accepted','running','validating'):
            if self.load(value['id'])['cancel_requested']:
                method=value['definition']['method'];self.research.executor.request_cancel(run['id'],method['plugin_id'],method['capability'])
            time.sleep(3)
            with self.store.db() as db:status=db.execute('SELECT status FROM study_runs WHERE id=?',(run['id'],)).fetchone()['status']
            if status not in ('accepted','running','validating'):run=self.research.get_run(wid,run['id'])
        self.charge(value,'run_executions',run['id'],run.get('execution') or {})
        self.save(value)
        if value['cancel_requested']:return
        if run['status'] not in ('succeeded','partial'):
            failures=[c.get('error') for c in (run.get('output') or {}).get('cases',[]) if c.get('error')]
            raise ValueError('原运行未完成：'+str(run.get('error') or failures)+'；恢复时仅回收原作业。')
        row=observation(run,run['output']['cases'][0]['case_id'],kind)
        previous=[r for r in value['rows'] if r['kind']==kind and (kind!='domain' or r['mesh_size_m']==row['mesh_size_m'])]
        if not previous:previous=[r for r in value['rows'] if r['kind']=='mesh']
        row['change_k']=abs(row['hotspot_k']-previous[-1]['hotspot_k']) if previous else None
        value['rows'].append(row);value[kind+'_parameters']=pending['parameters']
        if kind=='rating':value['rating_run_id']=run['id']
        if kind=='mesh':value['domain_parameters']=deepcopy(pending['parameters'])
        seconds=(run.get('execution') or {}).get('actual_cpu_seconds',0)
        value['attempts'].append({**pending,'status':'succeeded','run_id':run['id'],'actual_cpu_seconds':seconds,
            'nodes':row['nodes'],'hotspot_k':row['hotspot_k'],'execution':run.get('execution')})
        value.pop('pending',None);value.pop('current_run_id',None)
        value['cancel_requested']=self.load(value['id'])['cancel_requested'];self.save(value)
