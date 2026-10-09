"""Project saved FEM evidence. No solver, approvals, or guessed IEC pairing."""
import json
from math import isfinite
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import Field
from ..schemas import StrictModel
from .report_attachments import FemChapterReference
from .report_reads import saved_scope


class FemValue(StrictModel):
    quantity: Literal['ampacity','conductor_temperature']
    entity: str = Field(description='Saved object identity, or maximum for the hottest conductor.')
    label: str = Field(description='Engineering object label.')
    condition: str = Field(description='Saved operating/rating basis, never inferred from target load.')
    unit: Literal['A','K'] = Field(description='SI unit; temperature relative differences use absolute K.')
    fem: float | None
    iec: float | None
    delta: float | None = Field(description='FEM minus IEC, A or K.')
    relative_percent: float | None = Field(description='100*(FEM-IEC)/IEC; percent, temperature denominator in K.')


class FemConclusion(StrictModel):
    schema_version: Literal['cablesim.fem-conclusion/1'] = 'cablesim.fem-conclusion/1'
    run_id: UUID
    status: Literal['converged','unconverged']
    reason: str
    tolerance_k: float = Field(description='Saved convergence threshold, K; cannot exceed 0.1 K.')
    allowable_current_a: float | None = Field(default=None, description='Saved current capacity, A; absent without verified convergence.')
    hottest_temperature_k: float | None = Field(default=None, description='Hottest saved conductor temperature, K; not the soil hotspot.')
    margin_k: float | None = Field(default=None, description='Smallest per-conductor normal temperature-limit margin, K.')
    rating_basis: str = Field(default='', description='Saved rating condition of the selected ampacity quantities.')
    boundary_label: str = Field(default='', description='Saved boundary display label from the plugin contract or verified chapter.')
    reference: FemChapterReference | None = None
    comparison: list[FemValue] = Field(default_factory=list, description='Same-input saved IEC comparison; empty if no verified match.')


def workflow_for(research, wid, rid):
    with research.store.db() as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='hpc_convergence'").fetchone():return None
        states=db.execute('SELECT state FROM hpc_convergence ORDER BY rowid DESC').fetchall()
    return next((v for row in states if (v:=json.loads(row['state']))['workspace']==wid
        and v.get('rows') and v['rows'][-1]['run_id']==rid and v['status'] in ('completed','converged')),None)


def proof(research, run, identifier=None, *, display=False, summary=False):
    from .batch_convergence import Refinements, observation, verdict
    workflow=Refinements(research).load(identifier) if identifier else workflow_for(research,run['workspace'],run['id'])
    if not workflow:return run.get('convergence',{'status':'unconverged','reason':'尚无收敛证明。','tolerance_k':.1})
    if workflow['workspace']!=run['workspace'] or workflow['rows'][-1]['run_id']!=run['id']:
        raise HTTPException(409,'收敛证明必须绑定同工程的最终保存运行。')
    tolerance=workflow['request']['tolerance_k']
    if not 0<tolerance<=.1:raise HTTPException(422,'收敛门槛不能放宽到 0.1 K 以上。')
    proven=verdict(workflow['rows'],tolerance)
    for row in workflow['rows']:
        if summary and hasattr(research,'store'):
            # The saved summary is not a proof inspection. Bind each frozen row
            # to its source identity/digest without reading gigabytes of arrays.
            # Formal delivery below still verifies actual bytes and observations.
            with research.store.db() as db:
                source=db.execute('SELECT status,output_digest FROM study_runs WHERE workspace=? AND id=?',(run['workspace'],row['run_id'])).fetchone()
            if not source or source['status'] not in ('succeeded','partial') or source['output_digest']!=row['output_digest']:
                raise HTTPException(409,'收敛摘要的保存来源已改变。')
            continue
        if display and hasattr(research,'store'):actual=source_observation(research,run['workspace'],row['run_id'],row['case_id'],row['kind'])
        else:
            saved=run if row['run_id']==run['id'] else research.get_run(run['workspace'],row['run_id'])
            actual=display_observation(saved,row['case_id'],row['kind']) if display else observation(saved,row['case_id'],row['kind'])
        if any(actual[k]!=row[k] for k in actual if k not in ('change_k','study_name')):
            raise HTTPException(409,'收敛记录与保存结果不一致。')
    return {**workflow,**proven,'reference_case_id':workflow['rows'][-1]['case_id'],
        'reason':'网格与扩域均通过连续两级核验。' if proven['status']=='converged' else '网格或扩域未通过连续两级核验。'}


def display_read(research,wid,rid):
    # Test/legacy services without a database keep their existing full reader.
    if not hasattr(research,'store'):return research.get_run(wid,rid)
    from .batch_field_projection import read_display
    return read_display(research,wid,rid)


def source_observation(research,wid,rid,case_id,kind):
    """Verify actual source bytes, then read only sealed observation metadata.

    SQLite projects the metadata before it crosses the Python boundary. Binary
    shards and display triangles are irrelevant to a saved convergence table.
    Legacy noncanonical output keeps the full verifier rather than weakening it.
    """
    from .report_reads import byte_digest,read_cache,read_generation,observation_receipt
    from cablesim_sdk.reproduction import digest as artifact_digest_of
    from .batch_convergence import observation
    cache=read_cache();key=('observation',id(research),wid,rid,case_id,kind)
    if cache is not None and key in cache:return cache[key]
    generation=read_generation(research)
    receipt=observation_receipt(research,key,generation)
    if receipt is not None:
        if cache is not None:cache[key]=receipt
        return receipt
    with research.store.db() as db:
        db.execute('BEGIN')
        row=db.execute('SELECT id,sequence,created,status,snapshot,input_digest,output_digest FROM study_runs WHERE workspace=? AND id=?',(wid,rid)).fetchone()
        if row is None:raise HTTPException(404,'收敛来源运行不存在。')
        if byte_digest(row['snapshot'])!=row['input_digest']:
            return observation(research.get_run(wid,rid),case_id,kind)
        snapshot=json.loads(row['snapshot']);index=next(i for i,c in enumerate(snapshot['cases']) if c['case_id']==case_id)
        base=f'$.cases[{index}]';field=base+'.artifacts."x-cablesim.temperature-field"';bundle=base+'.artifacts."x-cablesim.simulation-bundle"'
        paths=[base+'.case_id',base+'.status',field+'.source',field+'.hotspot.temperature_k',field+'.convergence.full_mesh_nodes',bundle+'.field_storage.nodes',base+'.artifact_digests."x-cablesim.temperature-field"',base+'.artifact_digests."x-cablesim.simulation-bundle"']
        metadata=db.execute('SELECT CAST(output AS BLOB) AS output,json_extract(output,'+','.join('?' for _ in paths)+') AS metadata,CASE WHEN json_extract(output,?) IS NULL THEN json_array_length(output,?) END AS display_nodes FROM study_runs WHERE workspace=? AND id=?',(*paths,bundle+'.field_storage.nodes',field+'.mesh.points',wid,rid)).fetchone()
        if not metadata['output'] or byte_digest(metadata['output'])!=row['output_digest']:
            return observation(research.get_run(wid,rid),case_id,kind)
    actual_id,state,source,peak,full_nodes,storage_nodes,artifact_digest,bundle_digest=json.loads(metadata['metadata'])
    if actual_id!=case_id:return observation(research.get_run(wid,rid),case_id,kind)  # Legacy reordered output.
    original=snapshot['cases'][index];pin=snapshot['definition']['method'];parameters=original['parameters']
    if (row['status'] not in ('succeeded','partial') or state!='succeeded' or not source or source.get('binding')=='iec-trace'
        or source.get('input_sha256')!=artifact_digest_of(original['input']) or source.get('case_id')!=case_id
        or source.get('plugin_id')!=pin['plugin_id'] or source.get('plugin_version')!=pin['version'] or source.get('capability')!=pin['capability']
        or source.get('bundle_sha256')!=bundle_digest or not artifact_digest or not isinstance(peak,(float,int)) or not isfinite(peak)
        or storage_nodes is not None and (storage_nodes<=0 or full_nodes is not None and storage_nodes!=full_nodes)):
        raise HTTPException(409,'收敛投影与封存来源或全网格记录不一致。')
    actual={'run_id':rid,'case_id':case_id,'kind':kind,'hotspot_k':peak,'nodes':storage_nodes or metadata['display_nodes'],'mesh_size_m':parameters['mesh']['size_m'],
        'bounds_m':parameters['domain_options']['bounds_m'],'output_digest':row['output_digest'],'artifact_digest':artifact_digest,
        'sequence':row['sequence'],'created':row['created'],'study_name':snapshot['definition']['title'],'change_k':None,
        **({'outer_boundary':parameters['outer_boundary']} if 'outer_boundary' in parameters else {})}
    if cache is not None:cache[key]=actual
    if generation==read_generation(research):observation_receipt(research,key,generation,actual)
    return actual


def saved_execution(research,wid,rid):
    with research.store.db() as db:row=db.execute('SELECT status,error,snapshot,input_digest FROM study_runs WHERE workspace=? AND id=?',(wid,rid)).fetchone()
    from .report_reads import byte_digest
    if not row or byte_digest(row['snapshot'])!=row['input_digest']:raise HTTPException(409,'作业来源快照完整性未通过。')
    pin=json.loads(row['snapshot'])['definition']['method']
    execution=research.executor.execution_status(rid,pin['plugin_id'],pin['capability']) if hasattr(research.executor,'execution_status') else None
    if execution and row['status'] in ('succeeded','partial','failed','interrupted'):execution={**execution,'state':row['status']}
    return {'id':rid,'status':row['status'],'error':json.loads(row['error']) if row['error'] else None,'execution':execution}


@saved_scope
def report_chapter(research,wid,rid,iec_id,convergence_id=None):
    """Freeze source-verified saved observations, without decoding full arrays.

    The proof page remains the full-mesh reader. The report checks the same
    workflow verdict against sealed hotspot/node metadata and every source
    output digest, including previous validation runs; it never trusts status.
    """
    from .batch_field_chapter import compare
    from .batch_files import digest
    fem=display_read(research,wid,rid);iec=display_read(research,wid,iec_id)
    evidence=proof(research,fem,convergence_id,display=True)
    data=compare(projection_run(fem),iec,evidence.get('reference_case_id'))
    workflow=evidence if evidence.get('id') else None
    if workflow:
        sources={rid:fem}
        validation=workflow.get('validation_history')
        proof_rows=workflow['rows']+(validation or {}).get('rows',[])
        for row in proof_rows:
            if row['run_id'] not in sources:sources[row['run_id']]=saved_execution(research,wid,row['run_id'])
            saved=sources[row['run_id']]
            actual=source_observation(research,wid,row['run_id'],row['case_id'],row['kind'])
            if any(actual[k]!=row[k] for k in actual if k not in ('change_k','study_name')):raise HTTPException(409,'收敛记录与封存结果不一致，拒绝引用。')
        conv={k:workflow[k] for k in ('id','status','reason','attempts','actual_core_hours','per_step_upper_core_hours')}
        from .batch_convergence import verdict
        conv.update(rows=[{**row,'execution':sources[row['run_id']].get('execution')} for row in workflow['rows']],verdict=verdict(workflow['rows'],workflow['request']['tolerance_k']))
        if validation:
            failed=[]
            for identifier in validation.get('run_executions',{}):
                if identifier in sources:continue
                saved=saved_execution(research,wid,identifier)
                if saved['status'] in ('failed','interrupted'):failed.append({'run_id':identifier,'status':saved['status'],'error':saved.get('error'),'execution':saved.get('execution')})
            conv['validation_history']={**validation,'rows':[{**row,'execution':sources[row['run_id']].get('execution')} for row in validation['rows']],'failed_runs':failed}
    else:conv=evidence
    chosen=next(c for c in fem['output']['cases'] if c['case_id']==data['fem']['case_id'])
    field=chosen['artifacts']['x-cablesim.temperature-field']
    data.update(schema_version='cablesim.fem-report-chapter/1',title='有限元温度场与 IEC 对照',convergence=conv,
        boundary=chosen['artifacts'].get('x-cablesim.simulation-bundle',{}).get('result',{}).get('outer_boundary'),
        execution={**(fem.get('execution') or {}),'core_hours':(fem.get('execution') or {}).get('actual_cpu_seconds',0)/3600},
        preflight_jobs=list(workflow['preflight_executions'].values()) if workflow else [],
        convergence_jobs=([a['execution'] for a in workflow.get('history_attempts',[]) if a.get('execution')]+list(workflow.get('run_executions',{}).values())) if workflow else [],
        field={'artifact_digest':chosen['artifact_digests']['x-cablesim.temperature-field'],'display_decimated':field.get('convergence',{}).get('display_decimated',False),
            'full_mesh_nodes':field.get('convergence',{}).get('full_mesh_nodes'),
            'image_url':f'/api/hpc/workspaces/{wid}/fields/{rid}.png?case_id={chosen["case_id"]}',
            'media_type':'image/png','temperature_unit':'degC','length_unit':'m'})
    if data['outer_boundary']=='kennelly_image':
        data['boundary_source']={'standard':'IEC 60287-2-1:2023','clause':'4.2.3.2','printed_page':22,'pdf_page':24,'kind':'standard_reference',
            'scope':'镜像线热源温升公式；将其用于有限元侧边/底边是本插件的远场边界处理，不是标准新增载流量公式。'}
    data['chapter_digest']=digest(data)
    return data,fem


def projection_run(run):
    """Compare sealed display results without opening binary full-mesh shards."""
    cases=[]
    for case in run['output']['cases']:
        artifacts=dict(case.get('artifacts',{}))
        if 'x-cablesim.simulation-bundle' in artifacts:
            artifacts['x-cablesim.simulation-bundle']={k:v for k,v in artifacts['x-cablesim.simulation-bundle'].items() if k!='field_storage'}
        cases.append({**case,'artifacts':artifacts})
    return {**run,'output':{**run['output'],'cases':cases}}


def display_observation(run,case_id,kind):
    from .batch_convergence import observation
    case=next(c for c in run['output']['cases'] if c['case_id']==case_id)
    field=case['artifacts']['x-cablesim.temperature-field']
    storage=case['artifacts'].get('x-cablesim.simulation-bundle',{}).get('field_storage')
    actual=observation(projection_run(run),case_id,kind)
    if storage:
        nodes=storage['nodes']
        if field.get('convergence',{}).get('full_mesh_nodes',nodes)!=nodes:raise HTTPException(409,'保存投影与全网格节点记录不一致。')
        actual['nodes']=nodes
    # The sealed field hotspot is the full-mesh peak, not a display-node maximum.
    # Compare every workflow observation with its source digest, inputs and peak;
    # formal delivery still performs full-shard proof verification on demand.
    return actual


def values(run, evidence):
    """Only project saved conductor results and each conductor's own normal limit."""
    case_id=evidence.get('reference_case_id')
    case=next(c for c in run['output']['cases'] if c['case_id']==case_id) if case_id else run['output']['cases'][0]
    document=next(c['input'] for c in run['snapshot']['cases'] if c['case_id']==case['case_id'])
    rows=[r for r in case['results'] if r['status']=='available' and isinstance(r.get('value'),(int,float)) and isfinite(r['value'])]
    temperatures=[r for r in rows if r['key']=='conductor_temperature' and r['unit']=='K']
    capacities=[r for r in rows if r['key']=='ampacity' and r['unit']=='A']
    # Prefer explicitly saved common capacity. Do not mix different capacity bases.
    common=[r for r in capacities if r.get('case')=='rating-simultaneous']
    capacities=common or capacities
    bases={r.get('case','') for r in capacities}
    capacity=min((r['value'] for r in capacities),default=None) if len(bases)<=1 else None
    types={t['id']:t for t in document['cable_types']};limits={}
    for circuit in document['circuits']:
        for cable in circuit['cables']:
            limit=types[circuit['cable_type']].get('rating',{}).get('max_conductor_temperature',{}).get('normal')
            if isinstance(limit,(int,float)):limits['cable/'+cable['id']]=limit;limits[cable['id']]=limit
    margins=[limits[r['entity']]-r['value'] for r in temperatures if r['entity'] in limits]
    return {'allowable_current_a':capacity,'hottest_temperature_k':max((r['value'] for r in temperatures),default=None),
        'margin_k':min(margins) if temperatures and len(margins)==len(temperatures) else None,
        'rating_basis':next(iter(bases),'')},document


@saved_scope
def conclusion(research, wid, rid):
    from .batch_field_chapter import compare
    from .study_pdf import _names
    run=display_read(research,wid,rid)
    if run['integrity']!='verified':raise HTTPException(409,'保存运行完整性未通过，不能展示有限元结论。')
    if run['snapshot']['definition']['method']['capability']!='iec-thermal-field':raise HTTPException(422,'此运行不是 IEC 耦合有限元热场。')
    # First-screen metadata is checked against frozen observation rows. Reading
    # and hashing every full-field shard belongs to the proof/report operation;
    # a summary receipt never authorizes formal delivery.
    evidence=proof(research,run,display=True,summary=True)
    response={'run_id':rid,'status':evidence['status'],'reason':evidence.get('reason','未收敛。'),'tolerance_k':evidence.get('tolerance_k',.1)}
    if evidence['status']!='converged':return response
    metrics,document=values(run,evidence);response.update(metrics)
    with research.store.db() as db:
        ids=[row['id'] for row in db.execute("SELECT id FROM study_runs WHERE workspace=? AND status IN ('succeeded','partial') AND json_extract(snapshot,'$.definition.method.plugin_id')='cablesim.iec60287' ORDER BY sequence DESC",(wid,))]
    names=_names(document)
    for identifier in ids:
        iec=display_read(research,wid,identifier)
        try:data=compare(projection_run(run),iec,evidence.get('reference_case_id'))
        except ValueError:continue
        response['reference']={'fem_run_id':rid,'iec_run_id':identifier,'convergence_id':evidence.get('id')}
        response['boundary_label']=data['scope'][0]['fem']
        response['comparison']=[{'quantity':r['key'],'entity':r['entity'],'label':'最热导体' if r['entity']=='maximum' else names.get(r['entity'],names.get(r['entity'].split('/',1)[-1],'整体工况')),
            'condition':r['case'],'unit':r['unit'],'fem':r['fem'],'iec':r['iec'],'delta':r['delta'],'relative_percent':r['relative_percent']} for r in data['rows']]
        break
    if not response.get('boundary_label'):
        original=next(c for c in run['snapshot']['cases'] if c['case_id']==evidence.get('reference_case_id',run['snapshot']['cases'][0]['case_id']))
        plugin,_=research.resolve(run['snapshot']['definition']['method'])
        capability=next(c for c in plugin.manifest.capabilities if c.id=='iec-thermal-field')
        schema=capability.parameter_schema
        response['boundary_label']=schema.get('properties',{}).get('outer_boundary',{}).get('x-enum-labels',{}).get(original['parameters'].get('outer_boundary'),'保存边界')
    jobs=getattr(research,'delivery_jobs',None)
    if jobs is not None:
        from .report_reads import saved_field_image
        chosen=next(c for c in run['output']['cases'] if c['case_id']==evidence['reference_case_id'])
        # Format the saved projection while the engineer reads the conclusion.
        # This worker is also used for books: no second rendering process/solver.
        jobs.worker.submit(saved_field_image,chosen['artifacts']['x-cablesim.temperature-field'])
    return response
