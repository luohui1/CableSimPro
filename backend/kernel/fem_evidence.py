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
    operating_currents_a: list[float] = Field(default_factory=list, description='Distinct operating currents from the verified saved case input, A; never from current workspace input.')
    temperature_limits_k: list[float] = Field(default_factory=list, description='Distinct conductor limits from the same saved case, K.')
    rating_basis: str = Field(default='', description='Saved rating condition of the selected ampacity quantities.')
    boundary_label: str = Field(default='', description='Saved boundary display label from the plugin contract or verified chapter.')
    reference: FemChapterReference | None = None
    comparison: list[FemValue] = Field(default_factory=list, description='Same-input saved IEC comparison; empty if no verified match.')


def workflow_for(research, wid, rid):
    with getattr(research.store, 'read_snapshot', research.store.db)() as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='hpc_convergence'").fetchone():return None
        row=db.execute("SELECT state FROM hpc_convergence WHERE json_extract(state,'$.workspace')=? "
                       "AND json_extract(state,'$.rows[#-1].run_id')=? "
                       "AND json_extract(state,'$.status') IN ('completed','converged') ORDER BY rowid DESC LIMIT 1",(wid,rid)).fetchone()
    return json.loads(row['state']) if row else None


def proof(research, run, identifier=None, *, display=False, summary=False):
    from .batch_convergence import Refinements, observation, verdict
    workflow=Refinements(research).load(identifier) if identifier else workflow_for(research,run['workspace'],run['id'])
    if not workflow:return run.get('convergence',{'status':'unconverged','reason':'尚无收敛证明。','tolerance_k':.1})
    if workflow['workspace']!=run['workspace'] or workflow['rows'][-1]['run_id']!=run['id']:
        raise HTTPException(409,'收敛证明必须绑定同工程的最终保存运行。')
    tolerance=workflow['request']['tolerance_k']
    if not 0<tolerance<=.1:raise HTTPException(422,'收敛门槛不能放宽到 0.1 K 以上。')
    proven=verdict(workflow['rows'],tolerance)
    summary_sources=None
    if summary and hasattr(research,'store'):
        identifiers=list(dict.fromkeys(row['run_id'] for row in workflow['rows']))
        # Verify all frozen row bindings against one independent snapshot. A
        # connection per refinement repeats snapshot setup and cannot improve
        # consistency; the same status/digest checks remain below for every row.
        with getattr(research.store,'read_snapshot',research.store.db)() as db:
            # The covering receipt index returns the frozen status/digest without
            # fetching the large output stored before output_digest in the row.
            # Display and formal-proof reads still authenticate original bytes.
            # SQLite otherwise prefers the older unique ID index and fetches
            # the record's overflow pages despite the covering index. Legacy
            # read-only libraries without the new index retain the same checks.
            indexed=' INDEXED BY study_runs_receipts' if db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='index' AND name='study_runs_receipts'").fetchone() else ''
            sources=(db.execute('SELECT id,status,output_digest FROM study_runs'+indexed+' WHERE id=? AND workspace=?',
                                (identifier,run['workspace'])).fetchone() for identifier in identifiers)
            summary_sources={source['id']:source for source in sources if source is not None}
    for row in workflow['rows']:
        if summary_sources is not None:
            # The saved summary is not a proof inspection. Bind each frozen row
            # to its source identity/digest without reading gigabytes of arrays.
            # Formal delivery below still verifies actual bytes and observations.
            source=summary_sources.get(row['run_id'])
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
    from .report_reads import read_cache
    cache=read_cache();key=('display-read',id(research),wid,rid)
    # One report operation uses one authenticated source snapshot. Returning an
    # isolated copy prevents its chapter/cover formatting from changing the
    # source receipt. Every new request still rechecks bytes and currentness;
    # deliver() retains the final revision/consistency checks before saving.
    if cache is not None and key in cache:return json.loads(cache[key])
    run=read_display(research,wid,rid)
    if cache is not None:cache[key]=json.dumps(run,ensure_ascii=False,separators=(',',':'),allow_nan=False)
    return run


def source_observation(research,wid,rid,case_id,kind):
    """Verify actual source bytes, then read only sealed observation metadata.

    SQLite projects the metadata before it crosses the Python boundary. Binary
    shards and display triangles are irrelevant to a saved convergence table.
    Legacy noncanonical output keeps the full verifier rather than weakening it.
    """
    from .report_reads import byte_digest,read_cache,observation_generation,observation_receipt,saved_observation_receipt
    from cablesim_sdk.reproduction import digest as artifact_digest_of
    from .batch_convergence import observation
    def legacy_observation():
        saved=research.get_run(wid,rid)
        if saved.get('integrity')!='verified':
            raise HTTPException(409,'收敛来源运行完整性未通过，拒绝引用。')
        return observation(saved,case_id,kind)
    cache=read_cache();key=('observation',id(research),wid,rid,case_id,kind)
    if cache is not None and key in cache:return cache[key]
    from pathlib import Path
    import cablesim_sdk.reproduction as reproduction
    source_generation=('observation-code',byte_digest(Path(__file__).read_bytes()),
        byte_digest(Path(__file__).with_name('batch_convergence.py').read_bytes()),
        byte_digest(Path(reproduction.__file__).read_bytes()))
    generation=observation_generation(research,source_generation)
    receipt=observation_receipt(research,key,generation)
    if receipt is not None:
        if cache is not None:cache[key]=receipt
        return receipt
    with getattr(research.store, 'read_snapshot', research.store.db)() as db:
        if not hasattr(research.store, 'read_snapshot'):
            db.execute('BEGIN')  # Legacy adapter only; production snapshot already began.
        # Fetch each immutable source row once. Two SELECTs traverse the same
        # large overflow pages twice even when only the first reads metadata.
        row=db.execute('SELECT id,sequence,created,status,snapshot,input_digest,output_digest,CAST(output AS BLOB) AS output FROM study_runs WHERE workspace=? AND id=?',(wid,rid)).fetchone()
        if row is None:raise HTTPException(404,'收敛来源运行不存在。')
        if byte_digest(row['snapshot'])!=row['input_digest']:
            return legacy_observation()
        # Rehash actual saved bytes on a database commit, but do not repeatedly
        # parse megabytes of immutable field JSON for a convergence-table row.
        raw=row['output']
        if not raw or byte_digest(raw)!=row['output_digest']:
            return legacy_observation()
        content_key=(key,row['input_digest'],row['output_digest'],row['status'],row['sequence'],row['created'])
        # This receipt contains frozen observation metadata, not currentness.
        # Actual input/output bytes were rehashed above. Bind the exact observer
        # and digest implementation as well, so an unavailable directory-watch
        # snapshot cannot force repeated large JSON parsing (or confer trust).
        # Live method/input eligibility is still verified by the caller.
        content_receipt=observation_receipt(research,content_key,source_generation)
        disk_identity=artifact_digest_of((wid,rid,case_id,kind,row['input_digest'],row['output_digest'],
            row['status'],row['sequence'],row['created'],source_generation))
        if content_receipt is None:content_receipt=saved_observation_receipt(research,disk_identity)
        if content_receipt is not None:
            if cache is not None:cache[key]=content_receipt
            observation_receipt(research,content_key,source_generation,content_receipt)
            if generation==observation_generation(research,source_generation):
                observation_receipt(research,key,generation,content_receipt)
            return content_receipt
        snapshot=json.loads(row['snapshot']);index=next(i for i,c in enumerate(snapshot['cases']) if c['case_id']==case_id)
        base=f'$.cases[{index}]';field=base+'.artifacts."x-cablesim.temperature-field"';bundle=base+'.artifacts."x-cablesim.simulation-bundle"'
        paths=[base+'.case_id',base+'.status',field+'.source',field+'.hotspot.temperature_k',field+'.convergence.full_mesh_nodes',bundle+'.field_storage.nodes',base+'.artifact_digests."x-cablesim.temperature-field"',base+'.artifact_digests."x-cablesim.simulation-bundle"']
        metadata=db.execute('SELECT json_extract(output,'+','.join('?' for _ in paths)+') AS metadata,CASE WHEN json_extract(output,?) IS NULL THEN json_array_length(output,?) END AS display_nodes FROM study_runs WHERE workspace=? AND id=?',(*paths,bundle+'.field_storage.nodes',field+'.mesh.points',wid,rid)).fetchone()
    actual_id,state,source,peak,full_nodes,storage_nodes,artifact_digest,bundle_digest=json.loads(metadata['metadata'])
    if actual_id!=case_id:return legacy_observation()  # Legacy reordered output.
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
    saved_observation_receipt(research,disk_identity,actual)
    observation_receipt(research,content_key,source_generation,actual)
    if generation==observation_generation(research,source_generation):observation_receipt(research,key,generation,actual)
    return actual


def saved_execution(research,wid,rid):
    with getattr(research.store, 'read_snapshot', research.store.db)() as db:row=db.execute('SELECT status,error,snapshot,input_digest FROM study_runs WHERE workspace=? AND id=?',(wid,rid)).fetchone()
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
        outer_boundary=saved_boundary(fem,chosen['case_id']),
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


def saved_boundary(run, case_id=None):
    """Frozen parameter, then frozen bundle, then the historical truncated boundary.

    Current plugin defaults must never relabel an old result.
    """
    original=next(c for c in run['snapshot']['cases'] if not case_id or c['case_id']==case_id)
    case=next(c for c in run['output']['cases'] if c['case_id']==original['case_id'])
    return (original.get('parameters',{}).get('outer_boundary') or
        case.get('artifacts',{}).get('x-cablesim.simulation-bundle',{}).get('result',{}).get('outer_boundary',{}).get('kind') or
        'ambient_truncated')


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
        'rating_basis':next(iter(bases),''),
        'operating_currents_a':sorted({current for load in document.get('load_cases',[]) for current in load.get('currents',{}).values() if isinstance(current,(int,float)) and isfinite(current)}),
        'temperature_limits_k':sorted(set(limits.values()))},document


def saved_comparison_result(research,wid,rid):
    """Read verified IEC quantities for the first-screen comparison, not its mesh.

    The complete original envelope is hashed and its bound headline witnesses
    checked by the list reader. A field/display/report still uses display_read;
    this projection cannot authorize a picture or a formal delivery. Old runs
    without a verified witness keep the full existing reader.
    """
    from .read_models import source_facts,run_state,answer_output
    from .report_reads import read_cache
    shared=read_cache()
    cache=shared.setdefault('methods',{}) if shared is not None else {}
    with research.store.read_snapshot() as db:
        row,facts=source_facts(research,db,wid,rid,cache)
        if facts['integrity']!='verified':raise HTTPException(409,'参考保存运行完整性未通过。')
        if not facts['headlines']:return display_read(research,wid,rid)
        revision=db.execute('SELECT revision FROM workspaces WHERE id=?',(wid,)).fetchone()['revision']
        study=research.definition(db,wid,row['study'])
    snapshot=json.loads(row['snapshot'])
    state=run_state(research,snapshot,wid,revision,study,cache)
    return {**{key:row[key] for key in ('id','workspace','study','sequence','status','created','finished','input_digest','output_digest')},
            **state,'snapshot':snapshot,'output':json.loads(json.dumps(facts['answer'])) if facts.get('answer') else answer_output(research,row['output'],snapshot)}


def compare_saved_quantities(fem, iec, case_id=None):
    """Same-input scalar comparison; cannot authorize a field or formal report.

    The summary caller already authenticated complete source bytes and bound its
    convergence rows. The formal chapter keeps its independent mesh proof.
    """
    if iec.get('integrity')!='verified' or iec.get('status') not in ('succeeded','partial'):
        raise ValueError('参考运行未通过保存完整性检查。')
    if iec['snapshot']['definition']['method']['plugin_id']!='cablesim.iec60287':
        raise ValueError('参考运行必须是保存 IEC 结果。')
    chosen=next(c for c in fem['output']['cases'] if not case_id or c['case_id']==case_id)
    original=next(c for c in fem['snapshot']['cases'] if c['case_id']==chosen['case_id'])
    def scope(parameters):
        value=json.loads(json.dumps({k:v for k,v in parameters.items() if k!='operation'}))
        solver=value.get('solver',{})
        if 'initial_sheath_temperature_c' in solver and 'initial_sheath_temperature_k' not in solver:
            solver['initial_sheath_temperature_k']=solver.pop('initial_sheath_temperature_c')+273.15
        return value
    ids={c['case_id'] for c in iec['snapshot']['cases'] if c['input']==original['input']
         and scope(c['parameters'])==scope(original['parameters'].get('iec',{}))}
    other=next((c for c in iec['output']['cases'] if c['case_id'] in ids and c['status']=='succeeded'),None)
    if other is None:raise ValueError('保存领域输入或 IEC 损耗参数不一致。')
    keys=lambda r:tuple(r.get(k) for k in ('key','entity','unit','case'))
    left={keys(r):r for r in chosen['results']};right={keys(r):r for r in other['results']}
    rows=[]
    for key in dict.fromkeys([*left,*right]):
        if key[0] not in ('conductor_temperature','ampacity'):continue
        def number(row):
            value=row.get('value') if row.get('status')=='available' else None
            if value is not None and (not isinstance(value,(int,float)) or not isfinite(value)):
                raise ValueError('保存量值不是有限数。')
            return value
        a,b=number(left.get(key,{})),number(right.get(key,{}))
        delta=a-b if a is not None and b is not None else None
        rows.append({'key':key[0],'entity':key[1],'unit':key[2],'case':key[3],
                     'fem':a,'iec':b,'delta':delta,'relative_percent':delta/b*100 if delta is not None and b else None})
    temperatures=[r for r in rows if r['key']=='conductor_temperature']
    if temperatures and all(r['fem'] is not None and r['iec'] is not None for r in temperatures):
        a=max(r['fem'] for r in temperatures);b=max(r['iec'] for r in temperatures)
        rows.insert(0,{'key':'conductor_temperature','entity':'maximum','unit':'K','case':'operating',
                      'fem':a,'iec':b,'delta':a-b,'relative_percent':(a-b)/b*100})
    return rows


@saved_scope
def conclusion(research, wid, rid, *, prepare_report=False):
    from .study_pdf import _names
    # A frozen convergence workflow + authenticated producer quantities is the
    # summary contract. Its table does not need a display mesh. Legacy/no-proof
    # and explicit report preparation keep the original display/proof reader.
    run=(saved_comparison_result(research,wid,rid) if not prepare_report and hasattr(research,'store')
         and workflow_for(research,wid,rid) else display_read(research,wid,rid))
    if run['integrity']!='verified':raise HTTPException(409,'保存运行完整性未通过，不能展示有限元结论。')
    if run['snapshot']['definition']['method']['capability']!='iec-thermal-field':raise HTTPException(422,'此运行不是 IEC 耦合有限元热场。')
    # First-screen metadata is checked against frozen observation rows. Reading
    # and hashing every full-field shard belongs to the proof/report operation;
    # a summary receipt never authorizes formal delivery.
    evidence=proof(research,run,display=True,summary=True)
    response={'run_id':rid,'status':evidence['status'],'reason':evidence.get('reason','未收敛。'),'tolerance_k':evidence.get('tolerance_k',.1)}
    if evidence['status']!='converged':return response
    metrics,document=values(run,evidence);response.update(metrics)
    with getattr(research.store, 'read_snapshot', research.store.db)() as db:
        ids=[row['id'] for row in db.execute("SELECT id FROM study_runs WHERE workspace=? AND status IN ('succeeded','partial') AND json_extract(snapshot,'$.definition.method.plugin_id')='cablesim.iec60287' ORDER BY sequence DESC",(wid,))]
    names=_names(document)
    for identifier in ids:
        iec=saved_comparison_result(research,wid,identifier) if hasattr(research,'store') else display_read(research,wid,identifier)
        try:data=compare_saved_quantities(run,iec,evidence.get('reference_case_id'))
        except ValueError:continue
        response['reference']={'fem_run_id':rid,'iec_run_id':identifier,'convergence_id':evidence.get('id')}
        response['comparison']=[{'quantity':r['key'],'entity':r['entity'],'label':'最热导体' if r['entity']=='maximum' else names.get(r['entity'],names.get(r['entity'].split('/',1)[-1],'整体工况')),
            'condition':r['case'],'unit':r['unit'],'fem':r['fem'],'iec':r['iec'],'delta':r['delta'],'relative_percent':r['relative_percent']} for r in data]
        break
    boundary=saved_boundary(run,evidence.get('reference_case_id'))
    # Labels may use installed presentation metadata; the frozen result is not
    # a new execution and must not require its old release to be installed.
    method=run['snapshot']['definition']['method']
    plugin=research.registry(method['plugin_id']).get(method['plugin_id'])
    capability=next(c for c in plugin.manifest.capabilities if c.id=='iec-thermal-field')
    boundary_field=capability.parameter_schema.properties.get('outer_boundary')
    boundary_schema=boundary_field.model_dump(mode='json',by_alias=True) if boundary_field is not None else {}
    response['boundary_label']=boundary_schema.get('x-enum-labels',{}).get(boundary,boundary)
    jobs=getattr(research,'delivery_jobs',None)
    if prepare_report and jobs is not None:
        from .report_reads import saved_field_image
        chosen=next(c for c in run['output']['cases'] if c['case_id']==evidence['reference_case_id'])
        # Report view may preformat its saved image. First-screen conclusion
        # reads never start a CPU-heavy renderer competing with the canvas.
        jobs.worker.submit(saved_field_image,chosen['artifacts']['x-cablesim.temperature-field'])
    return response
