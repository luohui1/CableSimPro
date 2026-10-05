"""Saved domain section and sourced load curves to Elmer transient heat."""
from bisect import bisect_right
from copy import deepcopy
from math import isclose,log,pi
import shutil

from pydantic import Field
from cablesim_sdk.domain import DomainDocument
from cablesim_sdk.simulation import Strict,Time,Problem,MeshControls
from .thermal_domain import from_domain
from .report import digest


class AirCapacity(Strict):
    heat_capacity_j_m3_k: float=Field(gt=0)
    source: str=Field(min_length=1)


class Options(Strict):
    domain_options: dict
    time: Time
    mesh: MeshControls
    resistance_temperature_k: dict[str,float]
    duct_air_capacity: dict[str,AirCapacity]=Field(default_factory=dict)


def current_at(load,circuit,cable,time_s):
    series=load.profile.get(circuit)
    if series is None:
        value=load.currents.get(cable,load.currents.get(circuit))
        if value is None:raise ValueError('load_cases.'+load.id+'.profile.'+circuit+'：缺少当前回路的负荷曲线或应急电流。')
        return value
    at=time_s%load.period if load.kind=='cyclic' else time_s
    index=max(0,bisect_right(series.time,at)-1)
    value=series.value[index]
    if series.interpolation=='linear' and index+1<len(series.time):
        a,b=series.time[index:index+2]
        value+=(series.value[index+1]-value)*(at-a)/(b-a)
    return value*load.base_current[circuit] if series.scale=='per_unit' else value


def prepare(value,parameters):
    options=Options.model_validate(parameters)
    if options.mesh.field_order not in (None,1):
        raise ValueError('mesh.field_order：当前 Elmer 暂态接口使用 P1 三角形，请选择 1。')
    document=DomainDocument.model_validate(value)
    load=next((item for item in document.load_cases if item.id==options.domain_options.get('load_id')),None)
    if load is None or load.kind not in ('time_series','cyclic','emergency'):
        raise ValueError('domain_options.load_id：请选择 time_series、cyclic 或 emergency 负荷。')
    if load.preload or load.initial:
        raise ValueError('load_cases.'+load.id+'.preload/initial：当前接口仅接受明确的均匀初温；不能忽略已保存的预负荷或初始场引用。')
    duration=options.time.step_s*options.time.steps
    if load.duration is not None and not isclose(duration,load.duration,rel_tol=1e-10):
        raise ValueError('time.steps：总时长必须等于已保存 load.duration，单位 s。')
    if load.kind=='cyclic' and (load.period is None or load.period<=0):
        raise ValueError('load_cases.'+load.id+'.period：日负荷须明确正周期，单位 s。')
    for circuit,series in load.profile.items():
        if series.time[0]!=0:
            raise ValueError('load_cases.'+load.id+'.profile.'+circuit+'.time：曲线必须从 0 s 开始。')
        if load.kind=='cyclic' and (not isclose(series.time[-1],load.period,rel_tol=1e-10) or series.value[-1]!=series.value[0]):
            raise ValueError('load_cases.'+load.id+'.profile.'+circuit+'：周期末点须等于 period，并与起点电流相同。')
        if series.interpolation=='step' and any(abs(at/options.time.step_s-round(at/options.time.step_s))>1e-8 for at in series.time):
            raise ValueError('load_cases.'+load.id+'.profile.'+circuit+'.time：阶跃时刻须落在 time.step_s 的整数倍上。')
    section=next((item for item in document.sections if item.id==options.domain_options.get('section_id')),None)
    if section is None:raise ValueError('domain_options.section_id：所选截面不存在。')
    instances={c.id:(circuit,c) for circuit in document.circuits for c in circuit.cables}
    normalized=deepcopy(value)
    selected=next(item for item in normalized['load_cases'] if item['id']==load.id)
    selected.update(kind='steady',profile={},base_current={},currents={
        p.cable:current_at(load,instances[p.cable][0].id,p.cable,0.) for p in section.placements})
    model=from_domain(normalized,options.domain_options)
    if set(options.resistance_temperature_k)!={c.uid for c in model.cables}:
        raise ValueError('resistance_temperature_k：须逐缆填写电阻冻结温度，单位 K。')
    materials={m.id:m for m in document.materials};types={t.id:t for t in document.cable_types}
    enclosures={item.id:item for item in section.enclosures}
    if set(options.duct_air_capacity)!=set(enclosures):
        raise ValueError('duct_air_capacity：须为每个排管空气等效区域填写体积热容和来源。')
    def material(mid,k):
        capacity=materials[mid].volumetric_heat_capacity
        if capacity is None:
            raise ValueError('materials.'+mid+'.volumetric_heat_capacity：暂态需正体积热容，单位 J/(m³*K)。')
        return {'k_w_m_k':k,'heat_capacity_j_m3_k':capacity,'source':'saved domain material '+mid}
    geometry=[];environment=model.environment
    if environment.kind=='ground':
        mapping={environment.background.uid:section.medium.material,
                 **{r.id:r.material for r in section.soil_layers},
                 **({section.backfill.id:section.backfill.material} if section.backfill else {})}
        for region in [environment.background,*environment.soil_layers,*environment.backfills]:
            geometry.append({'uid':region.uid,'kind':'rectangle','values':list(region.bounds_m),'material':material(mapping[region.uid],region.k_w_m_k)})
    excitations=[];limits={};states={}
    for cable in model.cables:
        circuit,instance=instances[cable.uid];cable_type=types[circuit.cable_type]
        if cable.prescribed_core_temperature_k is not None:
            raise ValueError('domain_options.per_cable.'+cable.uid+'.prescribed_core_temperature_k：暂态导体不能同时指定恒定芯温。')
        if cable.electrical is None:
            raise ValueError('domain_options.per_cable.'+cable.uid+'.electrical：负荷曲线需明确的电阻与交流/护套损耗参数。')
        state=options.resistance_temperature_k[cable.uid]
        electrical=cable.electrical
        factor=1+electrical.alpha20_per_k*(state-293.15)
        if state<=0 or factor<=0:
            raise ValueError('resistance_temperature_k.'+cable.uid+'：工作温度须为正 K，冻结电阻须为正。')
        states[cable.uid]={'temperature_k':state,'resistance_ohm_m':electrical.r20_ohm_m*factor*(1+electrical.ac_extra_factor),
                          'source':electrical.source,'temperature_feedback':False}
        core=cable_type.cores[0]
        material_ids=[core.conductor.material,*[layer.material for layer in core.layers+cable_type.common_layers]]
        if cable.duct:
            duct=cable.duct;air=options.duct_air_capacity[duct.uid]
            geometry.extend([
                {'uid':duct.uid+'/wall','kind':'disk','values':[cable.x_m,cable.z_m,duct.outer_radius_m],
                 'material':material(enclosures[duct.uid].material,duct.k_w_m_k)},
                {'uid':duct.uid+'/air','kind':'disk','values':[cable.x_m,cable.z_m,duct.inner_radius_m],
                 'material':{'k_w_m_k':log(duct.inner_radius_m/cable.layers[-1].outer_radius_m)/(2*pi*duct.air_resistance_k_m_w),
                             'heat_capacity_j_m3_k':air.heat_capacity_j_m3_k,'source':air.source}}])
        for layer,mid in reversed(list(zip(cable.layers,material_ids))):
            geometry.append({'uid':layer.uid,'kind':'disk','values':[cable.x_m,cable.z_m,layer.outer_radius_m],
                             'material':material(mid,layer.k_w_m_k)})
            resistance=states[cable.uid]['resistance_ohm_m']*(1 if layer.role=='conductor' else
                electrical.sheath_loss_factor if layer.uid==electrical.sheath_layer_uid else 0.)
            powers=[layer.fixed_heat_w_m+resistance*current_at(load,circuit.id,cable.uid,i*options.time.step_s)**2
                    for i in range(options.time.steps)]
            maximum=max(powers)
            if maximum:
                schedule=[]
                for i,power in enumerate(powers):
                    if not schedule or power/maximum!=schedule[-1][1]:schedule.append([i*options.time.step_s,power/maximum])
                excitations.append({'regions':[layer.uid],'kind':'heat_w_m','value':[maximum],
                                    'schedule':schedule,'source':'saved load '+load.id+'; '+electrical.source})
        criterion=document.criteria.get('max_conductor_temperature')
        limit=criterion if criterion is not None else cable_type.rating.max_conductor_temperature.get('emergency' if load.kind=='emergency' else 'normal')
        if limit is None:raise ValueError('cable_types.'+cable_type.id+'.rating.max_conductor_temperature：缺少当前负荷种类的温限，单位 K。')
        limits[cable.uid]=limit
    boundaries=[]
    for name,bc in environment.boundaries.items():
        if bc.emissivity:raise ValueError('domain_options.boundaries.'+name+'.emissivity：当前 Elmer 暂态未翻译辐射，请使用明确的无辐射边界或其他方法。')
        if name=='surface':
            selectors=[('circle',[c.x_m,c.z_m,c.layers[-1].outer_radius_m]) for c in model.cables]
        else:
            axis,index={'left':('x',0),'bottom':('z',1),'right':('x',2),'top':('z',3)}[name]
            selectors=[(axis,[environment.background.bounds_m[index]])]
        for index,(selector,values) in enumerate(selectors):
            boundaries.append({'uid':name+str(index),'selector':selector,'values':values,'kind':bc.kind,
                               'value':bc.temperature_k,'h_w_m2_k':bc.h_w_m2_k})
    problem=Problem.model_validate({'schema_version':'cablesim.simulation-problem/1','physics':'transient_heat',
        'geometry':geometry,'boundaries':boundaries,'excitations':excitations,'time':options.time.model_dump(),
        'probes_m':[[c.x_m,c.z_m] for c in model.cables],
        'temperature_regions':{c.uid:[c.layers[0].uid] for c in model.cables},
        'provenance':{'domain':{'input_sha256':digest(value),'load_id':load.id},'electrical_states':states},
        'assumptions':[*model.assumptions,'Uniform explicitly supplied initial temperature; no implicit preload field.',
                       'Current curves generate I(t)^2 R at the declared fixed resistance temperature; no transient R(T) feedback.',
                       'Linear current histories are sampled at the left endpoint of each explicit time interval.']})
    return problem,options.mesh,limits


def history_artifact(result,limits,producer):
    curves=[]
    for entity,limit in limits.items():
        history=result['temperature_history'][entity]
        peak=max(history,key=lambda row:row['maximum_k'])
        crossing=None
        if history[0]['maximum_k']>=limit:
            crossing={'time_s':0.,'bracket_s':[0.,0.],'method':'declared initial temperature'}
        else:
            for a,b in zip(history,history[1:]):
                if a['maximum_k']<limit<=b['maximum_k']:
                    crossing={'time_s':a['time_s']+(limit-a['maximum_k'])*(b['time_s']-a['time_s'])/(b['maximum_k']-a['maximum_k']),
                              'bracket_s':[a['time_s'],b['time_s']],'method':'linear interpolation between actual solver time steps'}
                    break
        curves.append({'entity':entity,'time_s':[row['time_s'] for row in history],
            'maximum_temperature_k':[row['maximum_k'] for row in history],
            'mean_temperature_k':[row['mean_k'] for row in history],
            'peak_temperature_k':peak['maximum_k'],'peak_time_s':peak['time_s'],'temperature_limit_k':limit,
            'limit_status':'reached' if crossing else 'not_reached_in_simulated_interval','limit_crossing':crossing})
    worst=max(curves,key=lambda curve:curve['peak_temperature_k'])
    payload={'schema_version':'cablesim.temperature-history/1','source':producer,'temperature_unit':'K','time_unit':'s',
            'curves':curves,'maximum_temperature_k':worst['peak_temperature_k'],'maximum_time_s':worst['peak_time_s'],
            'maximum_entity':worst['entity'],'solver':result['solver'],
            'convergence':{'solver_status':'completed','time_history':'every declared time step',
                           'time_step_status':'not_assessed_single_step','mesh_status':'not_assessed_single_mesh'},
            'engineering_approval':False}
    from cablesim_sdk.simulation_artifacts import TemperatureHistory
    return TemperatureHistory.model_validate(payload).model_dump(mode='json')


def host_case(request,case,job):
    from .problem_mesh import build
    from .elmer_adapter import solve
    from .external import observations
    from .artifacts import source,temperature_field,write
    problem,controls,limits=prepare(case['input'],case.get('parameters',{}))
    evidence={'input_sha256':digest(case['input']),'prepared_input_sha256':digest(problem.model_dump(mode='json'))}
    if request['phase']=='check':
        return dict(case_id=case['case_id'],status='succeeded',results=[],artifacts=[],evidence=evidence)
    work=job/'output'/('transient-'+case['case_id']);work.mkdir(parents=True,exist_ok=True)
    try:
        mesh=build(problem,controls);result=solve(problem.model_dump(mode='json'),mesh,work)
        observed=observations(problem.model_dump(mode='json'),mesh,result)
        final=result['snapshots'][-1]
        result['time_history']=[{k:v for k,v in frame.items() if k!='temperature_k'} for frame in result.pop('snapshots')]
        result['final_field']=final
        bundle={'schema':'cablesim.simulation-bundle/2','problem':problem.model_dump(mode='json'),'mesh':mesh,
                'result':result,'observations':observed,'evidence':evidence,'engineering_approval':False}
        artifact=write(job,case['case_id'],'bundle','x-cablesim.simulation-bundle',bundle)
        producer=source(request,case,(job/artifact['path']).read_bytes())
        history=history_artifact(result,limits,producer)
        curve_artifact=write(job,case['case_id'],'history','x-cablesim.temperature-history',history)
        samples=[dict(entity=o['entity'],point_m=o['point_m'],temperature_k=o['value'],time_s=o['time_s'],
                      method='linear nodal interpolation') for o in observed if o['quantity']=='probe_temperature_k']
        field=temperature_field(mesh,final['temperature_k'],producer,time_s=final['time_s'],samples=samples,
                                convergence=history['convergence'])
        field_artifact=write(job,case['case_id'],'temperature','x-cablesim.temperature-field',field)
        return dict(case_id=case['case_id'],status='succeeded',evidence={**evidence,'solver':result['solver'],'mesh_sha256':mesh['sha256']},
                    results=[dict(key='conductor_temperature',type='quantity',entity=curve['entity'],
                                  status='available',value=curve['peak_temperature_k'],unit='K',case='peak-over-simulated-time') for curve in history['curves']],
                    artifacts=[artifact,curve_artifact,field_artifact])
    finally:shutil.rmtree(work,ignore_errors=True)
