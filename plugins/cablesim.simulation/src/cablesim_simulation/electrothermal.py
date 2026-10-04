"""Pointwise sigma(T) feedback between native GetDP A-u and P1 heat FEM."""
from pathlib import Path
from math import pi
import numpy as np
from backend.foundation.electrothermal import Electrothermal
from .problem import MeshControls
from .problem_mesh import build,package
from .getdp_adapter import solve as magnetic_solve
from .report import digest


def prepare(value,parameters):
    if set(parameters)!={'mesh'}:
        raise ValueError('parameters：耦合能力只接受mesh，材料/迭代范围写入已固定输入。')
    model=Electrothermal.model_validate(value)
    controls=MeshControls.model_validate(parameters['mesh'])
    if controls.field_order not in (None,1):
        raise ValueError('mesh.field_order：电热耦合当前仅支持P1。')
    return model,build(model.magnetic,controls)


def solve(model,mesh,work):
    from skfem import MeshTri,Basis,ElementTriP1,BilinearForm,LinearForm,asm,condense,solve as fem_solve
    from skfem.helpers import dot,grad
    work=Path(work);work.mkdir(parents=True,exist_ok=True)
    points=np.asarray(mesh['points']);cells=np.asarray(mesh['triangles']);ids=np.asarray(mesh['domain_ids'])
    basis=Basis(MeshTri(points.T,cells.T),ElementTriP1(),intorder=5)
    thermal=package(points,cells,ids,mesh['regions'],[b.model_dump(mode='json') for b in model.thermal_boundaries])
    prescribed={}
    for a,b,_,tag in thermal['boundary_edges']:
        bc=model.thermal_boundaries[tag-1]
        if bc.kind=='temperature':
            for n in (a,b):
                if n in prescribed and abs(prescribed[n]-bc.value)>1e-10:
                    raise ValueError('thermal_boundaries：相交边界温度不一致。')
                prescribed[n]=bc.value
    if not prescribed:raise ValueError('thermal_boundaries：至少需要一条给定温度边界。')
    D=np.array(sorted(prescribed));free=np.setdiff1d(np.arange(basis.N),D)
    fixed=np.zeros(basis.N);fixed[D]=[prescribed[n] for n in D]
    k=np.zeros((len(cells),1))
    for r in mesh['regions']:k[ids==r['id']]=r['material']['k_w_m_k']
    @BilinearForm
    def conduction(u,v,w):return w.k*dot(grad(u),grad(v))
    @LinearForm
    def source(v,w):return w.q*v
    matrix=asm(conduction,basis,k=k)
    temperatures=np.full(basis.N,model.initial_temperature_k);temperatures[D]=fixed[D]
    laws={u:l.model_dump(mode='json') for u,l in model.resistivity_laws.items()}
    problem=model.magnetic.model_dump(mode='json');history=[];previous_power=None
    for iteration in range(1,model.maximum_iterations+1):
        for r in mesh['regions']:
            if r['uid'] not in laws:continue
            law=laws[r['uid']];local=temperatures[np.unique(cells[ids==r['id']])]
            if local.min()<law['minimum_temperature_k'] or local.max()>law['maximum_temperature_k']:
                raise ValueError('resistivity_laws.'+r['uid']+'：温度越出材料有效范围，未外推。')
        result=magnetic_solve(problem,mesh,work/f'iteration-{iteration}',feedback={'laws':laws,'temperature_k':temperatures.tolist()})
        tq=basis.interpolate(temperatures);q=np.zeros_like(basis.dx)
        A=np.asarray(result['a_complex_wb_m']);af=basis.interpolate(A[:,0]+1j*A[:,1])
        for r in mesh['regions']:
            mask=ids==r['id'];mat=r['material'];uid=r['uid']
            if mat['conductivity_s_m']>0:
                field=result['electric_field_by_region'][uid];nodal=np.zeros(basis.N,dtype=complex)
                raw=np.asarray(field['electric_complex_v_m']);nodal[field['nodes']]=raw[:,0]+1j*raw[:,1]
                E=basis.interpolate(nodal);law=laws[uid]
                sigma=mat['conductivity_s_m']/(1+law['alpha_per_k']*(tq[mask]-law['reference_temperature_k']))
                q[mask]+=sigma*np.abs(E[mask])**2
            nu=1/(4*pi*1e-7*complex(mat['relative_permeability'],-mat.get('relative_permeability_loss',0)))
            q[mask]+=2*pi*problem['frequency_hz']*nu.imag*np.sum(np.abs(af.grad[:,mask])**2,axis=0)
        if not np.isfinite(q).all() or q.min()<-1e-12:raise ValueError('heat_source：电磁场产生无效热源。')
        power=float(np.sum(q*basis.dx))
        native_power=sum(r['joule_loss_w_m'] for r in result['regions'])+sum(r['magnetic_loss_w_m'] for r in result['magnetic_losses'])
        transfer_error=abs(power-native_power)/max(native_power,1e-12)
        if transfer_error>1e-5:raise ValueError(f'heat_source：场热源与GetDP原生积分不一致 ({transfer_error:.3g})。')
        load=asm(source,basis,q=q);proposed=fem_solve(*condense(matrix,load,x=fixed,D=D))
        if not np.isfinite(proposed).all() or proposed.min()<=0:raise ValueError('temperature_k：无有效稳态解。')
        delta=float(np.max(np.abs(proposed-temperatures)))
        power_delta=None if previous_power is None else abs(power-previous_power)/max(power,1e-12)
        residual=matrix@temperatures-load
        physical_residual=float(np.max(np.abs(residual[free]))) if len(free) else 0.
        balance_error=abs(power+float(residual[D].sum()))
        balance=balance_error/power if power>1e-12 else None
        history.append(dict(iteration=iteration,temperature_update_inf_k=delta,power_w_m=power,
                            power_relative_update=power_delta,transfer_relative_error=transfer_error,
                            thermal_residual_inf_w_m=physical_residual,energy_relative_residual=balance,
                            energy_absolute_residual_w_m=balance_error,
                            temperature_input_sha256=digest(temperatures.tolist()),magnetic_execution=result['execution']))
        if delta<=model.temperature_tolerance_k and power_delta is not None and power_delta<=model.power_relative_tolerance and balance_error<=1e-8+1e-5*power and physical_residual<=1e-5:break
        previous_power=power;temperatures+=model.relaxation*(proposed-temperatures)
    else:raise ValueError('maximum_iterations：电磁-热反馈未收敛；未输出最后试探值作为结果。')
    region_values=[]
    for r in mesh['regions']:
        mask=ids==r['id']
        region_values.append(dict(entity=r['uid'],mean_temperature_k=float(np.sum(tq[mask]*basis.dx[mask])/np.sum(basis.dx[mask])),
                                  maximum_nodal_temperature_k=float(temperatures[np.unique(cells[mask])].max())))
    return dict(solver={'name':'getdp-scikit-fem-electrothermal','magnetic':result['solver'],'thermal':'scikit-fem P1'},
                mesh_sha256=mesh['sha256'],input_sha256=digest(model.model_dump(mode='json')),
                temperature_k=temperatures.tolist(),maximum_temperature_k=float(temperatures.max()),
                region_temperatures=region_values,element_heat_w_m=np.sum(q*basis.dx,axis=1).tolist(),
                source_heat_w_m=power,magnetic=result,iterations=history,engineering_approval=False)


def host_case(request,case,job):
    import shutil
    from .solver_runtime import environment
    from .artifacts import source,temperature_field,write
    work=job/'output'/('electrothermal-'+case['case_id']);work.mkdir(parents=True,exist_ok=True)
    try:
        _,_,solver=environment('getdp',work)
        model,mesh=prepare(case['input'],case.get('parameters',{}))
        evidence={'input_sha256':digest(case['input']),'mesh_sha256':mesh['sha256'],'solver':solver}
        if request['phase']=='check':return dict(case_id=case['case_id'],status='succeeded',results=[],artifacts=[],evidence=evidence)
        result=solve(model,mesh,work)
        bundle=dict(schema='cablesim.simulation-bundle/2',input=model.model_dump(mode='json'),mesh=mesh,result=result,evidence=evidence,engineering_approval=False)
        artifact=write(job,case['case_id'],'bundle','x-cablesim.simulation-bundle',bundle)
        producer=source(request,case,(job/artifact['path']).read_bytes())
        from skfem import MeshTri,Basis,ElementTriP1
        basis=Basis(MeshTri(np.asarray(mesh['points']).T,np.asarray(mesh['triangles']).T),ElementTriP1())
        points=model.magnetic.probes_m
        values=basis.probes(np.asarray(points).T)@np.asarray(result['temperature_k']) if points else []
        samples=[dict(entity='field',point_m=p,temperature_k=float(t),time_s=0.,method='linear nodal interpolation') for p,t in zip(points,values)]
        field=temperature_field(mesh,result['temperature_k'],producer,samples=samples,convergence={'solver_status':'converged','iterations':result['iterations']})
        field_artifact=write(job,case['case_id'],'temperature','x-cablesim.temperature-field',field)
        return dict(case_id=case['case_id'],status='succeeded',evidence=evidence,
                    results=[dict(key='x-cablesim.maximum-temperature',type='quantity',entity='field',value=result['maximum_temperature_k'],unit='K',status='available')],
                    artifacts=[artifact,field_artifact])
    finally:
        shutil.rmtree(work,ignore_errors=True)
