"""Common preparation and host artifact contract for independent solver processes."""
from pathlib import Path
from hashlib import sha256
import json
from math import isfinite, atan2, degrees
import shutil
from .problem import validate
from .problem_mesh import build,from_thermal
from .report import digest
from .solver_runtime import environment


def prepare(value,parameters,solver):
    original=value
    allowed={'mesh','controls','domain_options','reproduction','electromagnetic_options','loss_export'}
    if set(parameters)-allowed:
        raise ValueError('未知外部仿真研究参数；案例不能指定可执行文件或命令行。')
    if parameters.get('reproduction',{}).get('missing_inputs'):
        raise ValueError('复现案例存在未补齐的输入。')
    schema=value.get('schema_version')
    if solver=='elmer' and schema in ('cablesim.domain/1','cablesim.thermal-model/1'):
        if parameters.get('mesh') or parameters.get('electromagnetic_options'):
            raise ValueError('热模型适配使用现有controls与domain_options。')
        p={k:v for k,v in parameters.items() if k in ('controls','domain_options','reproduction')}
        problem,mesh,_,_=from_thermal(value,p)
    else:
        if parameters.get('controls') or parameters.get('domain_options'):
            raise ValueError('统一问题描述不能叠加热模型参数。')
        if schema=='cablesim.domain/1':
            from .problem_domain import electromagnetic
            value=electromagnetic(value,parameters.get('electromagnetic_options',{}))
        elif parameters.get('electromagnetic_options'):
            raise ValueError('显式问题不能叠加领域电磁参数。')
        p,c=validate(value,parameters['mesh'])
        if (solver=='getdp') != (p.physics=='magnetic_harmonic'):
            raise ValueError('所选适配器不支持该物理类型，未回退到另一求解器。')
        mesh=build(p,c);problem=p.model_dump(mode='json')
    if parameters.get('loss_export') is not None:
        from backend.foundation.simulation_artifacts import LossExport
        if solver != 'getdp':
            raise ValueError('loss_export：仅GetDP电磁能力接受损耗系数导出。')
        cfg=LossExport.model_validate(parameters['loss_export'])
        from .loss_table import validate_scope
        validate_scope(problem, parameters['loss_export'])
        if original.get('schema_version')=='cablesim.domain/1':
            expected=sha256(json.dumps(original,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')).hexdigest()
            if cfg.source_domain_sha256!=expected:
                raise ValueError('loss_export.source_domain_sha256：与本次完整领域输入的宿主紧凑JSON摘要不一致。')
            topology={c['id']:{'electrical_topology':c.get('electrical_topology'),'bonding':c['bonding']} for c in original['circuits']}
            if cfg.topology.get('circuits')!=topology:
                raise ValueError('loss_export.topology.circuits：必须逐项保留当前领域的相序/参考角、护套互联及来源。')
        constraints=[{'regions':e['regions'],'kind':e['kind'],'connection':e.get('connection','parallel'),'value':e['value']} for e in problem['excitations']]
        if cfg.topology.get('constraints') != constraints:
            raise ValueError('loss_export.topology.constraints：必须匹配本次求解约束。')
        ids={r['uid'] for r in problem['geometry'] if not r['void'] and r['material']['conductivity_s_m']>0}
        selected={u for b in cfg.bindings for u in b.conductor_regions+b.sheath_regions+b.armor_regions}
        if not selected<=ids or not selected<=set(cfg.material_temperatures_k):
            raise ValueError('loss_export.bindings：缺导电区域或工作温度。')
    return problem,mesh


def observations(problem,mesh,result):
    """Named SI quantities; no implicit mapping between incomparable metrics."""
    import numpy as np
    rows=[]
    def add(quantity,entity,value,unit,**more):
        rows.append({'quantity':quantity,'entity':entity,'value':float(value),'unit':unit,**more})
    if result['solver']['name']=='getdp':
        for r in result['regions']:
            add('current_rms_a',r['entity'],r['current_rms_a'],'A')
            add('joule_loss_w_m',r['entity'],r['joule_loss_w_m'],'W/m')
            if r['ac_resistance_ohm_m'] is not None:
                add('ac_resistance_ohm_m',r['entity'],r['ac_resistance_ohm_m'],'ohm/m')
        magnetic_losses=result.get('magnetic_losses',[])
        for r in magnetic_losses:
            add('magnetic_loss_w_m',r['entity'],r['magnetic_loss_w_m'],'W/m')
        add('total_loss_w_m','all_conductors',sum(r['joule_loss_w_m'] for r in result['regions'])+sum(r['magnetic_loss_w_m'] for r in magnetic_losses),'W/m')
        if len(result['regions'])==2:
            a,b=[complex(*r['current_complex_rms_a']) for r in result['regions']]
            if abs(a)>1e-8 and abs(a+b)<1e-7*abs(a):
                add('series_resistance_ohm_m','current-path',sum(r['joule_loss_w_m'] for r in result['regions'])/abs(a)**2,'ohm/m')
        for i,p in enumerate(result['probes']):
            add('magnetic_flux_density_rms','field',p['b_rms_t'],'T',probe_index=i,point_m=p['point_m'])
            if 'b_current_integral_rms_t' in p:
                add('magnetic_flux_density_integrated_rms','field',p['b_current_integral_rms_t'],'T',probe_index=i,point_m=p['point_m'])
        for i,p in enumerate(result['current_density_probes']):
            add('current_density_rms',p['entity'],p['j_rms_a_m2'],'A/m^2',probe_index=i,point_m=p['point_m'])
            real,imag=p['j_complex_rms_a_m2']
            add('current_density_phase',p['entity'],degrees(atan2(imag,real)),'deg',probe_index=i,point_m=p['point_m'])
    else:
        from skfem import MeshTri,Basis,ElementTriP1
        # Sampling only. No heat matrix or time step is solved by scikit-fem.
        basis=Basis(MeshTri(np.asarray(mesh['points']).T,np.asarray(mesh['triangles']).T),ElementTriP1())
        probes=basis.probes(np.asarray(problem['probes_m']).T) if problem['probes_m'] else None
        for snap in result['snapshots']:
            t=snap['time_s'];temps=np.asarray(snap['temperature_k'])
            add('maximum_temperature_k','field',snap['maximum_k'],'K',time_s=t)
            if probes is not None:
                for i,v in enumerate(probes@temps):
                    add('probe_temperature_k','field',v,'K',probe_index=i,time_s=t,point_m=problem['probes_m'][i])
        # Keep final spatial field and sampled temporal quantities; full VTU
        # frames remain raw working files until the job is collected.
    return rows


from backend.foundation.reproduction import comparison


def run(problem,mesh,solver,work):
    if solver=='getdp':
        from .getdp_adapter import solve
    else:
        from .elmer_adapter import solve
    result=solve(problem,mesh,work)
    observed=observations(problem,mesh,result)
    if solver=='elmer':
        final=result['snapshots'][-1]
        result['time_history']=[{k:v for k,v in s.items() if k!='temperature_k'} for s in result.pop('snapshots')]
        result['final_field']=final
    # Input files and logs are text evidence, not executable commands supplied
    # by a case. The mesh has one canonical JSON form plus a SHA256.
    files=['case.pro' if solver=='getdp' else 'case.sif','solver.log']
    result['solver_files']={name:(work/name).read_text('utf-8',errors='replace') for name in files}
    return result,observed


def host_case(request,case,job,solver):
    work=job/'output'/('solver-'+case['case_id'])
    work.mkdir(parents=True,exist_ok=True)
    try:
        # Detect missing environment before spending time on geometry/meshing.
        _,_,env=environment(solver,work)
        problem,mesh=prepare(case['input'],case.get('parameters',{}),solver)
        evidence={'input_sha256':digest(case['input']),'problem_sha256':digest(problem),'mesh_sha256':mesh['sha256'],'solver':env,
                  'plugin_manifest_sha256':sha256((Path(__file__).resolve().parents[2]/'plugin.json').read_bytes()).hexdigest()}
        if request['phase']=='check':
            return {'case_id':case['case_id'],'status':'succeeded','results':[],'artifacts':[],'evidence':evidence}
        result,obs=run(problem,mesh,solver,work)
        numerical={'nodes':len(mesh['points']),'elements':len(mesh['triangles']),'mesh_sha256':mesh['sha256'],'problem_sha256':digest(problem),'solver':result['solver']}
        if solver=='getdp':
            numerical['current_constraint_max_error_a']=max((r['absolute_error_a'] for r in result['current_constraint_errors']),default=0.)
        ref=case.get('parameters',{}).get('reproduction',{})
        report=comparison(obs,ref,numerical)
        report.update(run={'run_id':request['run_id'],**evidence})
        payload={'schema':'cablesim.simulation-bundle/2','problem':problem,'mesh':mesh,'result':result,'observations':obs,'evidence':evidence,'engineering_approval':False}
        name='output/'+case['case_id']+'.json';report_name='output/'+case['case_id']+'-comparison.json'
        for path,value in [(name,payload),(report_name,report)]:
            raw=json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':'))
            if len(raw.encode('utf-8'))>16*1024*1024:
                raise ValueError('仿真工件超过宿主16 MiB限制；未丢弃字段或替换精度。')
            (job/path).write_text(raw,'utf-8')
        from .artifacts import source,temperature_field,loss_coefficients,write
        source_info=source(request,case,(job/name).read_bytes())
        extra=[]
        if solver=='elmer':
            frame=result['final_field']
            samples=[dict(entity=o['entity'],point_m=o['point_m'],temperature_k=o['value'],
                          time_s=o['time_s'],method='linear nodal interpolation') for o in obs if o['quantity']=='probe_temperature_k']
            field=temperature_field(mesh,frame['temperature_k'],source_info,time_s=frame['time_s'],samples=samples,
                                    convergence={'solver_status':'completed','time_history':result['time_history']})
            extra.append(write(job,case['case_id'],'temperature','x-cablesim.temperature-field',field))
        if case.get('parameters',{}).get('loss_export') is not None:
            coefficients=loss_coefficients(problem,result,case['parameters']['loss_export'],source_info)
            if case['parameters']['loss_export'].get('temperature_table'):
                from .loss_table import produce
                coefficients['temperature_table']=produce(problem,mesh,case['parameters']['loss_export'],source_info,work)
                coefficients['validity']={'kind':'temperature_tensor','ampacity_iteration_allowed':True,
                    'reason':'仅在温度张量范围与共同电流倍率范围内；误差为独立中心点实测，非全域上界。'}
            extra.append(write(job,case['case_id'],'losses','x-cablesim.loss-coefficients',coefficients))
        if solver=='getdp':
            values=[{'key':'x-cablesim.joule-loss','entity':r['entity'],'value':r['joule_loss_w_m'],'unit':'W/m'} for r in result['regions']]
        else:
            values=[{'key':'x-cablesim.maximum-temperature','entity':'field','value':result['final_field']['maximum_k'],'unit':'K'}]
        return {'case_id':case['case_id'],'status':'succeeded','evidence':evidence,
                'results':[{**v,'type':'quantity','status':'available'} for v in values],
                'artifacts':[{'path':name,'type':'x-cablesim.simulation-bundle'},{'path':report_name,'type':'x-cablesim.reproduction-report'},*extra]}
    finally:
        # Only our job-owned raw files; canonical mesh/input/log/results already
        # reside in declared JSON artifacts. Keeps batched host output bounded.
        shutil.rmtree(work,ignore_errors=True)
