"""Read/cancel saved Slurm jobs and manage sequential convergence studies.

Registration: app.include_router(make_router(research, batches)).
No solver runs from a GET, and list polling never opens the field archive.
"""
import json
from datetime import datetime, timezone
from uuid import UUID, uuid5
from fastapi import APIRouter, HTTPException, Query, Response
from .batch_files import read
from .batch_slurm import SlurmBackend, RemoteDisconnected, allocation_estimate
from .batch_convergence import Refinements, RefineRequest
from .batch_step_response import StepResponses, StepRequest
from .batch_field_chapter import chapter, selected_case, field_png
from hashlib import sha256
from ..plugin_host import PluginHostError
from .hpc_profile import HpcProfile
from .hpc_executor import ROOT


def study_jobs(research):
    with research.store.db() as db:
        rows=db.execute('SELECT id,workspace,study,sequence,status,created,finished,snapshot FROM study_runs ORDER BY sequence DESC').fetchall()
    result=[]
    for row in rows:
        definition=json.loads(row['snapshot'])['definition'];method=definition['method']
        execution=research.executor.execution_status(row['id'],method['plugin_id'],method['capability'])
        if not execution:continue
        recovering_live=row['status']=='validating' and execution.get('slurm_states') and not terminal(execution)
        state=row['status'] if row['status'] in ('validating','succeeded','partial','failed','interrupted') and not recovering_live else execution.get('state',row['status'])
        result.append({'id':row['id'],'kind':'study','workspace':row['workspace'],'study':row['study'],
            'study_name':definition['title'],'sequence':row['sequence'],'created':row['created'],
            'started':execution.get('started'),'finished':execution.get('finished') or row['finished'],
            'status':state,'execution':execution,'core_hours':execution.get('actual_cpu_seconds',0)/3600,
            'cancellable':bool(execution.get('job_id')) and row['status'] not in ('succeeded','partial') and
                not terminal(execution)})
    return result


def terminal(execution):
    states=execution.get('slurm_states',[])
    return bool(states) and all(s in ('COMPLETED','CANCELLED','TIMEOUT','OUT_OF_MEMORY','FAILED','NODE_FAIL','PREEMPTED','BOOT_FAIL','DEADLINE') for s in states)


def created_order(row):
    try:return datetime.fromisoformat(row['created'].replace('Z','+00:00')).timestamp()
    except (ValueError,KeyError):return 0


def preflight_jobs(refinements):
    result=[]
    for value in refinements.list():
        saved=dict(value.get('preflight_executions',{}));pending=value.get('pending')
        if pending:
            method=value['definition']['method']
            current=refinements.research.executor.execution_status(pending['request_id'],method['plugin_id'],method['capability'],phase='check')
            if current:saved[current['plan_id']]=current
        for identifier,execution in saved.items():
            states=execution.get('slurm_states') or [r['State'].split()[0].rstrip('+') for r in execution.get('accounting',[]) if '.' not in r['JobID']]
            execution={**execution,'plan_id':identifier,'slurm_states':states};done=terminal(execution)
            result.append({'id':'preflight:'+value['id']+':'+identifier,'kind':'preflight','workspace':value['workspace'],'study':value['study'],
                'study_name':value['title'],'sequence':None,'created':value['created'],
                'started':execution.get('started'),'finished':execution.get('finished'),
                'status':'succeeded' if done and all(s=='COMPLETED' for s in states) else 'failed' if done else execution.get('state','queued'),
                'execution':execution,'core_hours':execution.get('actual_cpu_seconds',0)/3600,
                'cancellable':not done and bool(execution.get('job_id')) and value['status'] in ('running','queued','interrupted')})
    return result


def dataset_jobs(batches):
    if batches is None:return []
    with batches.store.db() as db:
        exists=db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='dataset_runs'").fetchone()
        rows=db.execute('SELECT * FROM dataset_runs ORDER BY created DESC').fetchall() if exists else []
    result=[]
    for row in rows:
        folder=batches.root/row['id']
        for path in (folder/'submissions').glob('*/submission.json'):
            submission=read(path);accounting=read(path.parent/'accounting.json') if (path.parent/'accounting.json').is_file() else {}
            if not submission.get('job_id'):continue
            states=[r['State'].split()[0].rstrip('+') for r in accounting.get('accounting',[]) if '.' not in r['JobID']]
            snapshot=json.loads(row['snapshot'])
            result.append({'id':row['id']+':'+path.parent.name,'kind':'dataset','workspace':row['workspace'],'study':row['study'],
                'study_name':snapshot.get('definition',{}).get('title','数据集研究'),'sequence':None,'created':row['created'],
                'started':accounting.get('started'),'finished':accounting.get('finished'),
                'status':'succeeded' if accounting.get('terminal') and states and all(s=='COMPLETED' for s in states) else 'failed' if accounting.get('terminal') else 'queued' if states and all(s in ('PENDING','REQUEUED','REQUEUE_HOLD') for s in states) else row['status'],
                'core_hours':accounting.get('actual_cpu_seconds',0)/3600,
                'execution':{'job_id':submission['job_id'],'slurm_states':states,'cancel_requested':(path.parent/'cancellation.json').is_file(),
                    'queue_position':accounting.get('queue_position'),'queue_position_basis':accounting.get('queue_position_basis'),
                    'budget_core_hours':submission.get('budget_core_hours')},
                'cancellable':not accounting.get('terminal',False)})
    return result


def unbound_checks(research,linked):
    """Legacy checks predate study binding; expose them without guessing an owner."""
    root=getattr(research.executor,'root',None)
    if root is None:return []
    known={row['execution'].get('plan_id') for row in linked};result=[]
    for path in root.glob('*/plan.json'):
        plan=read(path)
        if plan.get('phase')!='check' or plan.get('operation_id') or plan['id'] in known:continue
        progress=path.parent/'execution.json';execution=read(progress) if progress.is_file() else {}
        if not execution.get('job_id'):continue
        execution={**execution,'plan_id':plan['id'],'cancel_requested':(path.parent/'cancel-request.json').is_file()}
        result.append({'id':'unbound:'+plan['id'],'kind':'preflight','workspace':None,'study':None,
            'study_name':'历史预检（研究归属未记录）','sequence':None,
            'created':datetime.fromtimestamp(path.stat().st_mtime,timezone.utc).isoformat(),
            'created_basis':'local_plan_record_time','started':execution.get('started'),'finished':execution.get('finished'),
            'execution':execution,'core_hours':execution.get('actual_cpu_seconds',0)/3600,
            'status':'succeeded' if terminal(execution) and all(s=='COMPLETED' for s in execution['slurm_states']) else 'failed' if terminal(execution) else execution.get('state','queued'),
            'cancellable':not terminal(execution)})
    return result


def job_cards(research,refinements,values,batches=None):
    """Shared record cards; missing legacy identities remain explicit nulls."""
    with research.store.db() as db:
        columns={row['name'] for row in db.execute('PRAGMA table_info(workspaces)')}
        names={row['id']:(state.get('domain') or state.get('scenario') or {}).get('name')
               for row in db.execute('SELECT id,state FROM workspaces')
               for state in [json.loads(row['state'])]} if 'state' in columns else {}
    workflows=refinements.list();owners={}
    for workflow in workflows:
        for index,row in enumerate(workflow['rows']):owners.setdefault(row['run_id'],(workflow,index+1,row['kind']))
        if workflow.get('current_run_id'):
            owners[workflow['current_run_id']]=(workflow,len(workflow['rows'])+1,workflow.get('pending',{}).get('kind'))
    for row in values:
        execution=row['execution'];owner=owners.get(row['id']);workflow=owner[0] if owner else next(
            (w for w in workflows if row['id'].startswith('preflight:'+w['id']+':')),None)
        kind='batch' if row['kind']=='dataset' else 'convergence' if workflow else 'single'
        run_id=row['id'].split(':')[0] if row['kind'] in ('study','dataset') else None
        if workflow and row['kind']=='preflight':
            method=workflow['definition']['method']
            for attempt in workflow.get('attempts',[]):
                if attempt.get('request_id') and str(uuid5(UUID(attempt['request_id']),method['plugin_id']+'/'+method['capability']+'/check'))==execution.get('plan_id'):
                    run_id=attempt.get('run_id');break
        budget=execution.get('budget_core_hours')
        folder=(batches.root/row['id'].split(':')[0]) if kind=='batch' and batches else (
            research.executor.root/execution['plan_id'] if getattr(research.executor,'root',None) and execution.get('plan_id') else None)
        if budget is None and folder and (folder/'plan.json').is_file():
            resources=read(folder/'plan.json').get('execution',{})
            for path in (folder/'submissions').glob('*/submission.json'):
                saved=read(path)
                if saved.get('job_id')!=execution.get('job_id'):continue
                budget=saved.get('budget_core_hours')
                if budget is None and all(k in saved for k in ('task_count','task_wall_seconds')) and 'slurm_memory_mb' in resources:
                    cpus=max(resources.get('slurm_cpus_per_task',1),-(-resources['slurm_memory_mb']//6500))
                    budget=saved['task_count']*saved['task_wall_seconds']*cpus/3600
        row.update(workspace_id=row['workspace'],workspace_name=names.get(row['workspace']),study_id=row['study'],
                   run_id=run_id,
                   type=kind,job_id=execution.get('job_id'),queue_position=execution.get('queue_position'),
                   queue_position_basis=execution.get('queue_position_basis','not_recorded'),
                   used_core_hours=row['core_hours'],budget_core_hours=budget,
                   convergence_id=workflow['id'] if workflow else None,
                   convergence_level=owner[1] if owner else len(workflow['rows'])+1 if workflow and workflow.get('pending') else None,
                   phase=owner[2] if owner else 'preflight' if row['kind']=='preflight' else 'solve',
                   workflow_budget_core_hours=workflow['request']['max_core_hours'] if workflow else None)
        row['missing_fields']=[key for key in ('workspace_id','workspace_name','study_id','run_id','budget_core_hours') if row[key] is None]
    return values


def make_router(research,batches=None):
    router=APIRouter(prefix='/api/hpc');refinements=Refinements(research);responses=StepResponses(research)

    @router.get('/profile')
    def profile():return research.executor.profile_status()

    def profile_editor():return HpcProfile(research.executor,managed_path=ROOT/'.data/hpc/config.json')

    def profile_operation(action,*args):
        try:return getattr(profile_editor(),action)(*args)
        except OSError:raise HTTPException(503,'配置文件操作未完成，请重新读取当前配置；已有备份保留。') from None

    @router.get('/profile/configuration')
    def profile_configuration():return profile_operation('configuration')

    @router.put('/profile')
    def save_profile(body:dict):return profile_operation('save',body)

    @router.post('/profile/undo')
    def undo_profile(body:dict):return profile_operation('undo',body)

    @router.post('/profile/check')
    def check_profile():return profile_operation('check')

    @router.get('/workspaces/{wid}/studies/{sid}/input-preflight')
    def input_preflight(wid:UUID,sid:UUID,expected_revision:int=Query(...,ge=0),
                        expected_study_revision:int=Query(...,ge=0),module:str|None=None):
        from .hpc_preflight import local_preflight
        return local_preflight(research,str(wid),str(sid),expected_revision,expected_study_revision,module)

    @router.get('/workspaces/{wid}/studies/{sid}/step-responses')
    def step_responses(wid:UUID,sid:UUID):return {'items':responses.list(str(wid),str(sid))}

    @router.post('/workspaces/{wid}/studies/{sid}/step-responses/estimate')
    def step_estimate(wid:UUID,sid:UUID,body:StepRequest):return responses.estimate(str(wid),str(sid),body)

    @router.post('/workspaces/{wid}/studies/{sid}/step-responses',status_code=202)
    def step_start(wid:UUID,sid:UUID,body:StepRequest):return responses.start(str(wid),str(sid),body)

    @router.get('/step-responses/{identifier}')
    def step_detail(identifier:UUID):return responses.result(str(identifier))

    @router.post('/step-responses/{identifier}/cancel')
    def step_cancel(identifier:UUID):return responses.cancel(str(identifier))

    @router.post('/step-responses/{identifier}/resume',status_code=202)
    def step_resume(identifier:UUID):return responses.resume(str(identifier))

    @router.get('/jobs')
    def jobs(offset:int=Query(0,ge=0),limit:int=Query(50,ge=1,le=100)):
        linked=preflight_jobs(refinements)
        values=sorted(study_jobs(research)+dataset_jobs(batches)+linked+unbound_checks(research,linked),key=created_order,reverse=True)
        values=job_cards(research,refinements,values,batches)
        return {'items':values[offset:offset+limit],'total':len(values),'next_offset':offset+limit if offset+limit<len(values) else None}

    @router.post('/jobs/{identifier}/cancel')
    def cancel(identifier:str):
        try:
            if identifier.startswith('unbound:'):
                if identifier not in {row['id'] for row in unbound_checks(research,preflight_jobs(refinements))}:raise HTTPException(404,'未绑定的历史预检不存在。')
                return research.executor.cancel_plan(research.executor.root/str(UUID(identifier.split(':')[1])))
            if identifier.startswith('preflight:'):
                _,workflow_id,plan_id=identifier.split(':');value=refinements.load(str(UUID(workflow_id)))
                job=next((row for row in preflight_jobs(refinements) if row['id']==identifier),None)
                if job is None:raise HTTPException(404,'预检作业不存在。')
                if not job['cancellable']:return {'state':job['status']}
                return refinements.cancel(value['id'])
            if ':' in identifier:
                if batches is None:raise HTTPException(404,'数据集服务未注册。')
                batch_id,token=map(lambda value:str(UUID(value)),identifier.split(':'))
                with research.store.db() as db:row=db.execute('SELECT id FROM dataset_runs WHERE id=?',(batch_id,)).fetchone()
                if row is None:raise HTTPException(404,'数据集不存在。')
                return SlurmBackend(batches.profile,batches.ledger_path).cancel(batches.root/batch_id,token)
            identifier=str(UUID(identifier))
            with research.store.db() as db:row=db.execute('SELECT workspace,study FROM study_runs WHERE id=?',(identifier,)).fetchone()
            if row is None:raise HTTPException(404,'研究运行不存在。')
            run=research.get_run(row['workspace'],identifier)
            if run['status'] in ('succeeded','partial'):return {'state':run['status']}
            method=run['snapshot']['definition']['method']
            return research.executor.request_cancel(identifier,method['plugin_id'],method['capability'])
        except ValueError as exc:raise HTTPException(422,'作业标识无效。') from exc
        except RemoteDisconnected as exc:raise HTTPException(503,'超算连接中断；取消意图保留，尚未确认终止。') from exc
        except PluginHostError as exc:raise HTTPException(exc.status,exc.message) from exc

    @router.post('/jobs/{identifier}/refresh')
    def refresh(identifier:str):
        try:
            if identifier.startswith('unbound:'):
                if identifier not in {row['id'] for row in unbound_checks(research,preflight_jobs(refinements))}:raise HTTPException(404,'未绑定的历史预检不存在。')
                return research.executor.refresh_plan(research.executor.root/str(UUID(identifier.split(':')[1])))
            if identifier.startswith('preflight:'):
                _,workflow_id,plan_id=identifier.split(':');workflow_id=str(UUID(workflow_id));plan_id=str(UUID(plan_id))
                workflow=refinements.load(workflow_id)
                if identifier not in {row['id'] for row in preflight_jobs(refinements)}:raise HTTPException(404,'预检作业不存在。')
                execution=research.executor.refresh_plan(research.executor.root/plan_id)
                if execution:
                    with research.store.db(True) as db:
                        value=json.loads(db.execute('SELECT state FROM hpc_convergence WHERE id=?',(workflow['id'],)).fetchone()['state'])
                        if value['status'] in ('queued','running'):return execution
                        previous=value.get('preflight_executions',{}).get(plan_id,{})
                        refinements.charge(value,'preflight_executions',plan_id,{**previous,**execution})
                        db.execute('UPDATE hpc_convergence SET state=? WHERE id=?',(json.dumps(value,ensure_ascii=False),value['id']))
                return execution or {'state':'preparing'}
            if ':' in identifier:
                if batches is None:raise HTTPException(404,'数据集服务未注册。')
                batch_id,token=map(lambda value:str(UUID(value)),identifier.split(':'))
                if identifier not in {row['id'] for row in dataset_jobs(batches)}:raise HTTPException(404,'数据集作业不存在。')
                remote=SlurmBackend(batches.profile,batches.ledger_path);remote.install_agent()
                return remote.poll(batches.root/batch_id,token)
            identifier=str(UUID(identifier))
            with research.store.db() as db:row=db.execute('SELECT snapshot FROM study_runs WHERE id=?',(identifier,)).fetchone()
            if row is None:raise HTTPException(404,'研究运行不存在。')
            method=json.loads(row['snapshot'])['definition']['method']
            return research.executor.refresh_status(identifier,method['plugin_id'],method['capability']) or {'state':'preparing'}
        except ValueError as exc:raise HTTPException(422,'作业标识无效。') from exc
        except RemoteDisconnected as exc:raise HTTPException(503,'超算连接中断；保留上次状态，请稍后核对。') from exc
        except PluginHostError as exc:raise HTTPException(exc.status,exc.message) from exc

    @router.get('/convergence')
    def convergence(workspace:str|None=None,study:str|None=None):return {'items':refinements.list(workspace,study)}

    @router.get('/workspaces/{wid}/studies/{sid}/estimate')
    def estimate(wid:UUID,sid:UUID,expected_revision:int,expected_study_revision:int,module:str|None=None):
        # Preparation only. Mesh generation remains an explicit Slurm preflight.
        with research.store.db() as db:
            snapshot=research.prepare(db,str(wid),str(sid),expected_revision,expected_study_revision,module)
        method=snapshot['definition']['method'];plugin,_=research.resolve(method)
        if not research.executor.required(method['plugin_id'],method['capability']):raise HTTPException(422,'此方法未配置超算。')
        count=len(snapshot['cases'])
        budget=allocation_estimate(research.executor.resources(plugin.manifest,count),count,read(research.executor.profile))
        limits=[c.get('parameters',{}).get('mesh',{}).get('max_nodes') for c in snapshot['cases']]
        return {'estimated_nodes':None,'node_limit':max((n for n in limits if n is not None),default=None),
                'estimate_status':'mesh_preflight_required','budget_core_hours':budget['upper_core_hours'],'case_count':count}

    @router.get('/workspaces/{wid}/studies/{sid}/availability')
    def availability(wid:UUID,sid:UUID,module:str|None=None):
        # Configuration lookup only: never prepare inputs, mesh or submit a job.
        with research.store.db() as db:
            definition=research.definition(db,str(wid),str(sid))['definition']
        configuration=definition.get('modules',{}).get(module,definition) if module else definition
        method=configuration['method']
        profile=research.executor.profile_status()
        try:capability=research.registry(method['plugin_id']).get(method['plugin_id']).manifest.capability(method['capability'])
        except (PluginHostError,KeyError):raise HTTPException(409,'研究的方法或能力声明暂不可读，请重新安装方法或选择可用版本；保存结果保留。') from None
        solver=capability.solver
        selected=method['plugin_id'] in profile['remote_plugins'] or method['capability'] in profile['remote_capabilities'].get(method['plugin_id'],[])
        remote=solver=='slurm' or (solver=='either' and selected)
        conflict=solver=='local' and selected
        return {'configured':not conflict and (not remote or (profile['configured'] and selected)),
                'location':'slurm' if remote else 'local','solver':solver,
                'local_solver_allowed':solver!='slurm','conflict':conflict}

    @router.post('/workspaces/{wid}/studies/{sid}/convergence',status_code=202)
    def start(wid:str,sid:str,body:RefineRequest):return refinements.start(wid,sid,body)

    @router.get('/convergence/{identifier}')
    def detail(identifier:UUID):return refinements.load(str(identifier))

    @router.post('/convergence/{identifier}/cancel')
    def cancel_convergence(identifier:UUID):return refinements.cancel(str(identifier))

    @router.post('/convergence/{identifier}/resume',status_code=202)
    def resume(identifier:UUID):return refinements.resume(str(identifier))

    @router.get('/workspaces/{wid}/chapters/{rid}')
    def report_chapter(wid:UUID,rid:UUID,iec_run_id:UUID,convergence_id:UUID|None=None):
        try:return chapter(research,refinements,str(wid),str(rid),str(iec_run_id),str(convergence_id) if convergence_id else None)
        except (ValueError,KeyError,StopIteration) as exc:raise HTTPException(422,str(exc)) from exc

    @router.get('/workspaces/{wid}/fields/{rid}.png')
    def image(wid:UUID,rid:UUID,case_id:str|None=None):
        try:
            case,_=selected_case(research.get_run(str(wid),str(rid)),case_id)
            value=field_png(case['artifacts']['x-cablesim.temperature-field'])
            return Response(value,media_type='image/png',headers={'ETag':'"'+sha256(value).hexdigest()+'"','Cache-Control':'private, no-cache'})
        except (ValueError,KeyError,StopIteration) as exc:raise HTTPException(422,str(exc)) from exc

    @router.get('/workspaces/{wid}/fields/{rid}/view')
    def field_view(wid:UUID,rid:UUID):
        """Verified display projection: binary arrays stay on the server."""
        from time import perf_counter
        from .batch_field_projection import read_display
        started=perf_counter()
        projected=read_display(research,str(wid),str(rid))
        if projected.get('integrity')!='verified':raise HTTPException(409,'保存场完整性未通过。')
        loaded=perf_counter()
        # read_display has verified the saved contracts; avoid FastAPI walking every
        # scalar of the display mesh a second time through jsonable_encoder.
        payload=json.dumps(projected,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')
        return Response(payload,media_type='application/json',headers={
            'Cache-Control':'private, no-cache',
            'Server-Timing':f'verify;dur={(loaded-started)*1000:.1f}, serialize;dur={(perf_counter()-loaded)*1000:.1f}'})

    @router.get('/workspaces/{wid}/fields/{rid}/full')
    def field_archive(wid:UUID,rid:UUID,case_id:str|None=None):
        """Download lossless arrays; normal view requests never download these."""
        from .batch_field_storage import full_field
        from io import BytesIO
        import numpy as np
        try:
            case,_=selected_case(research.get_run(str(wid),str(rid)),case_id)
            arrays=full_field(case);stream=BytesIO();np.savez_compressed(stream,**arrays)
        except (ValueError,KeyError) as exc:raise HTTPException(422,str(exc)) from exc
        return Response(stream.getvalue(),media_type='application/octet-stream',
            headers={'Content-Disposition':f'attachment; filename="field-{rid}.npz"'})

    @router.post('/workspaces/{wid}/fields/{rid}/sample')
    def field_sample(wid:UUID,rid:UUID,points:list[tuple[float,float]],case_id:str|None=None):
        from .batch_field_storage import full_field,sample
        try:
            case,_=selected_case(research.get_run(str(wid),str(rid)),case_id)
            values=sample(full_field(case),points)
            return {'points_m':points,'temperature_k':values,'mesh':'full',
                    'artifact_digest':case['artifact_digests']['x-cablesim.temperature-field']}
        except (ValueError,KeyError) as exc:raise HTTPException(422,str(exc)) from exc

    return router
