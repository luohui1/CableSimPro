"""Project saved FEM evidence. No solver, approvals, or guessed IEC pairing."""
import json
from math import isfinite
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import Field
from ..schemas import StrictModel
from .report_attachments import FemChapterReference


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


def proof(research, run, identifier=None):
    from .batch_convergence import Refinements, observation, verdict
    workflow=Refinements(research).load(identifier) if identifier else workflow_for(research,run['workspace'],run['id'])
    if not workflow:return run.get('convergence',{'status':'unconverged','reason':'尚无收敛证明。','tolerance_k':.1})
    if workflow['workspace']!=run['workspace'] or workflow['rows'][-1]['run_id']!=run['id']:
        raise HTTPException(409,'收敛证明必须绑定同工程的最终保存运行。')
    tolerance=workflow['request']['tolerance_k']
    if not 0<tolerance<=.1:raise HTTPException(422,'收敛门槛不能放宽到 0.1 K 以上。')
    proven=verdict(workflow['rows'],tolerance)
    for row in workflow['rows']:
        actual=observation(run if row['run_id']==run['id'] else research.get_run(run['workspace'],row['run_id']),row['case_id'],row['kind'])
        if any(actual[k]!=row[k] for k in actual if k not in ('change_k','study_name')):
            raise HTTPException(409,'收敛记录与保存结果不一致。')
    return {**workflow,**proven,'reference_case_id':workflow['rows'][-1]['case_id'],
        'reason':'网格与扩域均通过连续两级核验。' if proven['status']=='converged' else '网格或扩域未通过连续两级核验。'}


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


def conclusion(research, wid, rid):
    from .batch_field_chapter import compare
    from .study_pdf import _names
    run=research.get_run(wid,rid)
    if run['integrity']!='verified':raise HTTPException(409,'保存运行完整性未通过，不能展示有限元结论。')
    if run['snapshot']['definition']['method']['capability']!='iec-thermal-field':raise HTTPException(422,'此运行不是 IEC 耦合有限元热场。')
    evidence=proof(research,run)
    response={'run_id':rid,'status':evidence['status'],'reason':evidence.get('reason','未收敛。'),'tolerance_k':evidence.get('tolerance_k',.1)}
    if evidence['status']!='converged':return response
    metrics,document=values(run,evidence);response.update(metrics)
    with research.store.db() as db:
        ids=[row['id'] for row in db.execute("SELECT id FROM study_runs WHERE workspace=? AND status IN ('succeeded','partial') AND json_extract(snapshot,'$.definition.method.plugin_id')='cablesim.iec60287' ORDER BY sequence DESC",(wid,))]
    names=_names(document)
    for identifier in ids:
        iec=research.get_run(wid,identifier)
        try:data=compare(run,iec,evidence.get('reference_case_id'))
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
    return response
