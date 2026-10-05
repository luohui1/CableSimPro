"""Domain bonding to native GetDP circulating currents and IEC external loss artifact."""
from hashlib import sha256
import json
import shutil
from pydantic import Field
from cablesim_sdk.simulation import Strict,MeshControls
from cablesim_sdk.simulation_artifacts import LossExport,LossTemperatureTable
from .research_electromagnetic import prepare_domain
from .report import digest


class Options(Strict):
    electromagnetic_options: dict
    mesh: MeshControls
    temperature_table: LossTemperatureTable|None=None


def prepare(value,parameters):
    options=Options.model_validate(parameters)
    problem,bindings,materials,topology,document,section=prepare_domain(value,options.electromagnetic_options)
    if options.temperature_table is not None and problem.axial_lengths_m:
        raise ValueError('temperature_table：三小段当前只导出固定工作点 λ1；跨段变温 IEC 插值尚未覆盖。')
    states=options.electromagnetic_options['material_states']
    temperatures={uid:states[mid]['temperature_k'] for uid,mid in materials.items()
                  if uid in {g.uid for g in problem.geometry if g.material.conductivity_s_m>0}}
    constraints=[{'regions':e.regions,'kind':e.kind,'connection':e.connection,'value':e.value} for e in problem.excitations]
    configuration={'bindings':bindings,
        'source_domain_sha256':sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()).hexdigest(),
        'topology':{'circuits':{c.id:{'electrical_topology':c.electrical_topology.model_dump(mode='json') if c.electrical_topology else None,
                                       'bonding':c.bonding.model_dump(mode='json')} for c in document.circuits},
                    'constraints':constraints,'electrical_networks':[n.model_dump(mode='json') for n in problem.electrical_networks],
                    'axial_lengths_m':problem.axial_lengths_m},
        'material_temperatures_k':temperatures,'source':options.electromagnetic_options['source'],
        'temperature_table':options.temperature_table.model_dump(mode='json') if options.temperature_table else None}
    if problem.axial_lengths_m:
        configuration['topology']['longitudinal_integration']={'section_length_m':section.length,
            'regional_length_weights':{uid:length/section.length for uid,length in problem.axial_lengths_m.items()}}
    export=LossExport.model_validate(configuration)
    if export.temperature_table:
        from .loss_table import validate_scope
        validate_scope(problem.model_dump(mode='json'),export.model_dump(mode='json'))
    return problem,options.mesh,export


def host_case(request,case,job):
    from .problem_mesh import build
    from .getdp_adapter import solve
    from .external import observations
    from .artifacts import source,loss_coefficients,write
    problem,controls,configuration=prepare(case['input'],case.get('parameters',{}))
    evidence={'input_sha256':digest(case['input']),'prepared_input_sha256':digest(problem.model_dump(mode='json')),
              'bindings':[binding.model_dump(mode='json') for binding in configuration.bindings]}
    if request['phase']=='check':
        return dict(case_id=case['case_id'],status='succeeded',results=[],artifacts=[],evidence=evidence)
    work=job/'output'/('sheath-'+case['case_id']);work.mkdir(parents=True,exist_ok=True)
    try:
        mesh=build(problem,controls);value=problem.model_dump(mode='json')
        result=solve(value,mesh,work)
        bundle={'schema':'cablesim.simulation-bundle/2','problem':value,'mesh':mesh,'result':result,
                'observations':observations(value,mesh,result),'evidence':evidence,'engineering_approval':False}
        artifact=write(job,case['case_id'],'bundle','x-cablesim.simulation-bundle',bundle)
        producer=source(request,case,(job/artifact['path']).read_bytes())
        losses=loss_coefficients(value,result,configuration.model_dump(mode='json'),producer)
        if configuration.temperature_table:
            from .loss_table import produce
            losses['temperature_table']=produce(value,mesh,configuration.model_dump(mode='json'),producer,work)
            losses['validity']={'kind':'temperature_tensor','ampacity_iteration_allowed':True,
                'reason':'仅在声明温度张量和共同电流倍率范围内，独立中心点已校核，禁止外推。'}
        loss_artifact=write(job,case['case_id'],'losses','x-cablesim.loss-coefficients',losses)
        currents=[]
        by_region={row['entity']:row for row in result['regions']}
        for binding in configuration.bindings:
            currents.append({'entity':binding.entity,'regional_currents':[
                {key:by_region[uid][key] for key in ('entity','current_complex_rms_a','current_rms_a','joule_loss_w_m')}
                for uid in binding.sheath_regions],
                'sheath_loss_w_m':next(row['sheath_loss_w_m'] for row in losses['rows'] if row['entity']==binding.entity)})
        summary={'schema_version':'cablesim.sheath-losses/1','source':producer,'circuits':configuration.topology['circuits'],
                 'currents':currents,'solver':result['solver'],
                 'convergence':{'solver_status':'completed','current_constraint_errors':result['current_constraint_errors'],
                                'mesh_status':'not_assessed_single_mesh','linear_residual':'not_reported_by_native_solver'},
                 'engineering_approval':False}
        current_artifact=write(job,case['case_id'],'currents','x-cablesim.sheath-losses',summary)
        return dict(case_id=case['case_id'],status='succeeded',evidence={**evidence,'solver':result['solver'],'mesh_sha256':mesh['sha256']},
            results=[dict(key='x-cablesim.sheath-loss',type='quantity',entity=row['entity'],value=row['sheath_loss_w_m'],unit='W/m',status='available') for row in losses['rows']],
            artifacts=[artifact,loss_artifact,current_artifact])
    finally:shutil.rmtree(work,ignore_errors=True)
