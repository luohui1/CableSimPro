"""Operating and rated temperatures with explicit per-sample mesh convergence."""
from copy import deepcopy
from importlib.metadata import version
import os
import time
from pydantic import Field, model_validator
from .thermal_input import Strict, prepare
from .thermal import ThermalSystem
from .report import digest


class Verification(Strict):
    mesh_scales: list[float] = Field(default=[1.5,1.,.75], min_length=3, max_length=6)
    temperature_tolerance_k: float = Field(default=.1, gt=0, le=.1)
    ampacity_tolerance_a: float = Field(default=.5, gt=0, le=1.)

    @model_validator(mode='after')
    def ordered(self):
        if any(v<=0 for v in self.mesh_scales) or any(a<=b for a,b in zip(self.mesh_scales,self.mesh_scales[1:])):
            raise ValueError('dataset.mesh_scales: 至少三档严格递减的正网格倍率。')
        return self


def calculate(value, parameters):
    parameters = deepcopy(parameters)
    verification = Verification.model_validate(parameters.pop('dataset', {}))
    model,controls = prepare(value, parameters)
    if controls.operation != 'ampacity':
        raise ValueError('controls.operation: 数据集方法须选 ampacity 并明确 rated_circuit，才能同时提供工况温度与允许电流。')
    levels=[]
    started=time.perf_counter()
    for scale in verification.mesh_scales:
        cfg=controls.model_copy(update={'mesh_size_m':controls.mesh_size_m*scale,
            'far_mesh_size_m':controls.far_mesh_size_m*scale,
            'near_soil_mesh_size_m':controls.near_soil_mesh_size_m*scale if controls.near_soil_mesh_size_m is not None else None})
        system=ThermalSystem(model,cfg)
        operating=system.state([c.current_a for c in model.cables])
        operating.pop('temperature_k')
        rated,field=system.solve()
        mesh={'points':field['points'],'triangles':field['triangles'],'domain_ids':field['domain_ids']}
        levels.append({'mesh_scale':scale,'mesh_size_m':cfg.mesh_size_m,'far_mesh_size_m':cfg.far_mesh_size_m,
            'nodes':len(field['points']),'elements':len(field['triangles']),'mesh_sha256':digest(mesh),
            'operating':operating,'rating':rated})
    previous,last=levels[-2:]
    temperature_change=max(abs(a['conductor_max_temperature_k']-b['conductor_max_temperature_k'])
        for condition in ('operating','rating')
        for a,b in zip(previous[condition]['cables'],last[condition]['cables']))
    ampacity_change=abs(last['rating']['rating']['ampacity_a']-previous['rating']['rating']['ampacity_a'])
    converged=(temperature_change<=verification.temperature_tolerance_k and
               ampacity_change<=verification.ampacity_tolerance_a)
    return {'schema_version':'cablesim.dataset-sample/1','kind':'thermal',
        'input_sha256':digest(value),'prepared_input_sha256':digest({'model':model.model_dump(mode='json'),
            'controls':controls.model_dump(mode='json'),'verification':verification.model_dump(mode='json')}),
        'valid':converged,'status':'succeeded' if converged else 'nonconverged',
        'reason':None if converged else {'code':'MESH_NOT_CONVERGED',
            'message':'末两档网格差异超过声明容差；样本已保留，请细化网格后另行运行。'},
        'solver':{'name':f'scikit-fem P{controls.element_order} thermal','version':version('scikit-fem'),
            'license_source':'hpc-installation' if os.environ.get('SLURM_JOB_ID') else 'local-installation',
            'license_type':'open-source','slurm_job_id':os.environ.get('SLURM_JOB_ID'),
            'packages':{p:version(p) for p in ('gmsh','numpy','scipy','scikit-fem')}},
        'mesh':{k:last[k] for k in ('nodes','elements','mesh_size_m','far_mesh_size_m','mesh_sha256')},
        'convergence':{'solver_status':'converged','mesh_status':'converged' if converged else 'nonconverged',
            'verification':verification.model_dump(mode='json'),'maximum_temperature_change_k':temperature_change,
            'ampacity_change_a':ampacity_change,'domain_status':'not_assessed',
            'energy_relative_residual':max(last[k]['energy_relative_residual'] for k in ('operating','rating'))},
        'operating':last['operating'],'rating':last['rating'],'mesh_history':levels,
        'wall_seconds':time.perf_counter()-started,'authority':'reference_only','engineering_approval':False,
        'assumptions':model.assumptions,
        'scope':'二维常热物性、显式温变电阻/损耗；同心管内为给定等效热阻；允许电流为指定回路且保持其他回路的保存负荷。'}


def host_case(request,case,job):
    from .artifacts import write
    parameters=deepcopy(case.get('parameters',{}))
    Verification.model_validate(parameters.pop('dataset',{}))
    model,controls=prepare(case['input'],parameters)
    if controls.operation!='ampacity':
        raise ValueError('controls.operation: 数据集方法须为 ampacity，并明确 rated_circuit。')
    if request['phase']=='check':
        return {'case_id':case['case_id'],'status':'succeeded','results':[],'artifacts':[],
                'evidence':{'input_sha256':digest(case['input'])}}
    payload=calculate(case['input'],case.get('parameters',{}))
    artifact=write(job,case['case_id'],'dataset','x-cablesim.dataset-sample',payload)
    results=[]
    if payload['valid']:
        for condition in ('operating','rating'):
            results += [{'key':'conductor_temperature','type':'quantity','entity':c['entity'],
                'status':'available','value':c['conductor_max_temperature_k'],'unit':'K','case':condition}
                for c in payload[condition]['cables']]
        results.append({'key':'ampacity','type':'quantity','entity':controls.rated_circuit,
            'status':'available','value':payload['rating']['rating']['ampacity_a'],'unit':'A','case':'rating'})
    else:
        # A completed experiment may have an unusable label: preserve diagnostics
        # in its artifact, and expose no available engineering quantity.
        results=[{'key':key,'type':'quantity','entity':entity,'status':'unavailable',
            'unit':unit,'reason':payload['reason']} for key,entity,unit in
            [('conductor_temperature',model.cables[0].uid,'K'),('ampacity',controls.rated_circuit,'A')]]
    return {'case_id':case['case_id'],'status':'succeeded','results':results,'artifacts':[artifact],
            'evidence':{'input_sha256':payload['input_sha256'],'prepared_input_sha256':payload['prepared_input_sha256']},
            'warnings':[{'code':'REFERENCE_DATASET','message':payload['scope']}]}
