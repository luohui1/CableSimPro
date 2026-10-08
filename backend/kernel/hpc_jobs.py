"""Read/cancel saved Slurm jobs and manage sequential convergence studies.

Registration: app.include_router(make_router(research, batches)).
No solver runs from a GET, and list polling never opens the field archive.
"""
import json
from datetime import datetime, timezone
from uuid import UUID
from fastapi import APIRouter, HTTPException, Query, Response
from .batch_files import read
from .batch_slurm import SlurmBackend, RemoteDisconnected
from .batch_convergence import Refinements, RefineRequest
from .batch_field_chapter import chapter, selected_case, field_png
from hashlib import sha256
from ..plugin_host import PluginHostError


def study_jobs(research):
    with research.store.db() as db:
        rows=db.execute('SELECT id,workspace,study,sequence,status,created,finished,snapshot FROM study_runs ORDER BY sequence DESC').fetchall()
    result=[]
    for row in rows:
        definition=json.loads(row['snapshot'])['definition'];method=definition['method']
        execution=research.executor.execution_status(row['id'],method['plugin_id'],method['capability'])
        if not execution:continue
        state=row['status'] if row['status'] in ('validating','succeeded','partial','failed','interrupted') else execution.get('state',row['status'])
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
            execution={**execution,'slurm_states':states};done=terminal(execution)
            result.append({'id':'preflight:'+value['id']+':'+identifier,'kind':'preflight','workspace':value['workspace'],'study':value['study'],
                'study_name':value['title']+' · 网格预检','sequence':None,'created':value['created'],
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
                'status':'succeeded' if accounting.get('terminal') and states and all(s=='COMPLETED' for s in states) else 'failed' if accounting.get('terminal') else row['status'],
                'core_hours':accounting.get('actual_cpu_seconds',0)/3600,
                'execution':{'job_id':submission['job_id'],'slurm_states':states,'cancel_requested':(path.parent/'cancellation.json').is_file()},
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


def make_router(research,batches=None):
    router=APIRouter(prefix='/api/hpc');refinements=Refinements(research)

    @router.get('/jobs')
    def jobs(offset:int=Query(0,ge=0),limit:int=Query(50,ge=1,le=100)):
        linked=preflight_jobs(refinements)
        values=sorted(study_jobs(research)+dataset_jobs(batches)+linked+unbound_checks(research,linked),key=created_order,reverse=True)
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
        run=research.get_run(str(wid),str(rid))
        if run.get('integrity')!='verified':raise HTTPException(409,'保存场完整性未通过。')
        output=run.get('output',{})
        cases=[{**case,'artifacts':{key:value for key,value in case.get('artifacts',{}).items()
                                  if not key.startswith('x-cablesim.field-')}} for case in output.get('cases',[])]
        return {**run,'output':{**output,'cases':cases}}

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
