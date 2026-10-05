"""GetDP magnetic loss <-> nonlinear contact-thermal field, with port Rac(T).

The explicit homogenized winding law constrains mean terminal resistance,
including passive losses. It is not a substitute for a supplied AC resistance
law and does not infer an IEC coefficient or a three-dimensional strand model.
"""
from pathlib import Path
from math import pi,hypot
import shutil
import numpy as np
from cablesim_sdk.contact_electrothermal import ContactElectrothermal
from .triangular_fields import geometry,contact_thermal
from .problem_mesh import package
from .getdp_adapter import solve as magnetic_solve
from .report import digest


def solve(model,work):
    from skfem.quadrature import get_quadrature_tri
    p,t,area,grad=geometry(model.mesh.points,model.mesh.triangles);ids=np.asarray(model.mesh.domain_ids)
    # Keep local nodal temperatures and gradients in the same orientation as
    # package(), which canonicalizes the magnetic triangles before GetDP.
    corners=p[t];u=corners[:,1]-corners[:,0];v=corners[:,2]-corners[:,0]
    clockwise=u[:,0]*v[:,1]-u[:,1]*v[:,0]<0
    if np.any(clockwise):
        t=t.copy();t[clockwise]=t[clockwise][:,[0,2,1]]
        p,t,area,grad=geometry(p,t)
    active=np.isin(ids,model.magnetic_domain_ids);used=np.unique(t[active]);mapping=np.full(len(p),-1,int);mapping[used]=np.arange(len(used))
    materials={int(d):m for d,m in model.magnetic_materials.items()}
    regions=[{'id':d,'uid':'domain/'+str(d),'material':{k:getattr(m,k) for k in ('conductivity_s_m','relative_permeability','relative_permeability_loss')}} for d,m in materials.items()]
    magnetic=package(p[used],mapping[t[active]],ids[active],regions,[{'selector':'outer','values':[]}])
    magnetic['field_order']=1;magnetic.pop('sha256');magnetic['sha256']=digest(magnetic)
    problem={'schema_version':'cablesim.discrete-magnetic-problem/1','frequency_hz':model.frequency_hz,
             'geometry':[],'boundaries':[{'kind':'magnetic_potential','selector':'outer','values':[],'value':0.}],
             'excitations':[e.model_dump(mode='json') for e in model.excitations],'probes_m':[],'current_probes':[],
             'source':model.mesh.source.model_dump(mode='json'),'boundary_source':model.magnetic_boundary_source}
    mt=np.asarray(magnetic['triangles']);mids=ids[active];ma=area[active];mg=grad[active]
    X,W=get_quadrature_tri(5);bary=np.vstack([1-X.sum(axis=0),X]).T;weights=2*W
    T=np.full(t.shape,model.ambient_k,dtype=float);history=[];previous_power=None;law=model.port_resistance
    currents={int(e.regions[0].split('/')[1]):hypot(*e.value) if len(e.value)==2 else abs(e.value[0]) for e in model.excitations if e.kind=='impressed_current_rms_a'}
    common_i=next(iter(currents.values()));source_mask=np.isin(ids,law.domain_ids)
    laws={r['uid']:model.magnetic_materials[str(r['id'])].model_dump(mode='json') for r in regions if r['material']['conductivity_s_m']>0}
    def conductivity(domains,temperature):
        output=np.full(len(domains),np.nan)
        for key,prop in model.thermal_conductivity.items():
            mask=domains==int(key)
            if np.any((temperature[mask]<prop.minimum_temperature_k)|(temperature[mask]>prop.maximum_temperature_k)):
                raise ValueError('thermal_conductivity.'+key+': temperature outside the sourced Kelvin interval')
            output[mask]=np.polynomial.polynomial.polyval(temperature[mask],prop.coefficients_w_m_k)
        return output
    for iteration in range(1,model.maximum_iterations+1):
        for d,mat in materials.items():
            local=T[ids==d]
            if local.min()<mat.minimum_temperature_k or local.max()>mat.maximum_temperature_k:raise ValueError('magnetic_materials.'+str(d)+': temperature outside validity interval')
        mean=float(area[source_mask]@T[source_mask].mean(axis=1)/area[source_mask].sum())
        if not law.minimum_temperature_k<=mean<=law.maximum_temperature_k:raise ValueError('port_resistance: mean winding temperature outside validity interval')
        resistance=law.resistance_reference_ohm_m*(1+law.alpha_per_k*(mean-law.reference_temperature_k))
        result=magnetic_solve(problem,magnetic,Path(work)/('iteration-'+str(iteration)),feedback={'laws':laws,'temperature_triangles_k':T[active].tolist()})
        tq=T[active]@bary.T;qmag=np.zeros((len(mt),len(W)))
        A=np.asarray(result['a_complex_wb_m']);A=A[:,0]+1j*A[:,1]
        curl=np.einsum('eik,ei->ek',mg,A[mt]);regional=[]
        for d,mat in materials.items():
            mask=mids==d;part=np.zeros((np.count_nonzero(mask),len(W)))
            if mat.conductivity_s_m>0:
                entry=result['electric_field_by_region']['domain/'+str(d)];nodal=np.full(len(used),np.nan+1j*np.nan)
                raw=np.asarray(entry['electric_complex_v_m']);nodal[entry['nodes']]=raw[:,0]+1j*raw[:,1]
                if not np.isfinite(nodal[mt[mask]]).all():raise ValueError('magnetic field: material-side electric field is incomplete')
                E=nodal[mt[mask]]@bary.T
                sigma=mat.conductivity_s_m/(1+mat.alpha_per_k*(tq[mask]-mat.reference_temperature_k))
                part+=sigma*abs(E)**2
            nu=1/(4*pi*1e-7*complex(mat.relative_permeability,-mat.relative_permeability_loss))
            part+=2*pi*model.frequency_hz*nu.imag*np.sum(abs(curl[mask])**2,axis=1)[:,None]
            qmag[mask]=part;regional.append({'domain_id':d,'passive_loss_w_m':float(ma[mask]@(part@weights))})
        passive=float(ma@(qmag@weights));native=sum(r['joule_loss_w_m'] for r in result['regions'])+sum(r['magnetic_loss_w_m'] for r in result['magnetic_losses'])
        transfer_error=abs(passive-native)/max(native,1e-15)
        if transfer_error>1e-5:raise ValueError(f'heat_source: conservative transfer differs from GetDP integration ({transfer_error:.4g})')
        total_port_power=len(currents)*common_i**2*resistance
        winding_heat=total_port_power-passive
        if winding_heat<=0:raise ValueError('port_resistance: requested terminal resistance is below passive electromagnetic losses; no positive winding resistivity exists')
        q=np.repeat(np.asarray(model.heat_w_m3)[:,None],len(W),axis=1);q[active]+=qmag
        for d in currents:q[ids==d]+=winding_heat/len(currents)/area[ids==d].sum()
        qmean=q@weights;load=area[:,None]*np.einsum('eq,q,qi->ei',q,weights,bary)
        thermal=contact_thermal(p,t,ids,conductivity,qmean,model.contact_edges,model.contact_conductance_w_m2k,model.temperature_nodes,model.ambient_k,element_load_w_m=load)
        proposed=thermal['triangle_temperature_k'];change=float(np.max(abs(proposed-T)))
        power=float(qmean@area);power_change=None if previous_power is None else abs(power-previous_power)/max(power,1e-20)
        history.append({'iteration':iteration,'temperature_update_inf_k':change,'total_heat_w_m':power,'passive_heat_w_m':passive,
                        'winding_heat_w_m':winding_heat,'mean_winding_temperature_k':mean,'port_resistance_ohm_m':resistance,
                        'power_relative_update':power_change,'transfer_relative_error':transfer_error,'thermal_energy_relative_error':thermal['relative_energy_error'],
                        'temperature_input_sha256':digest(T.tolist()),'magnetic_execution':result['execution'],
                        'magnetic_source_sha256':digest((Path(work)/('iteration-'+str(iteration))/'case.pro').read_text('ascii'))})
        if change<=model.temperature_tolerance_k and power_change is not None and power_change<=model.power_relative_tolerance:break
        T+=model.relaxation*(proposed-T);previous_power=power
    else:raise ValueError('maximum_iterations: coupled magnetic/contact-thermal fixed point did not converge')
    regional_heat=[]
    for d in sorted(set(ids)):
        mask=ids==d;regional_heat.append({'domain_id':int(d),'heat_w_m':float(area[mask]@qmean[mask]),
            'mean_temperature_k':float(area[mask]@proposed[mask].mean(axis=1)/area[mask].sum()),'maximum_temperature_k':float(proposed[mask].max())})
    return {'solver':{'name':'getdp-contact-electrothermal','magnetic':result['solver'],'thermal':'independent P1 contact FEM with k(T)'},
            'maximum_temperature_k':thermal['maximum_k'],'total_heat_w_m':power,'passive_heat_w_m':passive,'winding_heat_w_m':winding_heat,
            'port_resistance_ohm_m':resistance,'iterations':history,'regional':regional_heat,'thermal':thermal,
            'electromagnetic_mesh_sha256':magnetic['sha256'],'engineering_approval':False}


def host_case(request,case,job):
    from .solver_runtime import environment
    from .artifacts import source,temperature_field,write
    if case.get('parameters'):raise ValueError('parameters: complete coupled SI input is required, no additional options')
    model=ContactElectrothermal.model_validate(case['input']);work=job/'output'/('contact-coupled-'+case['case_id']);work.mkdir(parents=True,exist_ok=True)
    try:
        _,_,solver=environment('getdp',work)
        evidence={'input_sha256':digest(case['input']),'mesh_source':model.mesh.source.model_dump(mode='json'),'solver':solver}
        if request['phase']=='check':return {'case_id':case['case_id'],'status':'succeeded','results':[],'artifacts':[],'evidence':evidence}
        result=solve(model,work);thermal=result['thermal'];original=thermal.pop('original_nodes');triangles=thermal.pop('triangles');temperatures=thermal.pop('temperature_k');thermal.pop('triangle_temperature_k')
        bundle=write(job,case['case_id'],'coupled','x-cablesim.simulation-bundle',{'schema':'cablesim.contact-electrothermal-result/1','result':result,'evidence':evidence,'engineering_approval':False})
        mesh={'points':np.asarray(model.mesh.points)[original].tolist(),'triangles':triangles.tolist(),'domain_ids':model.mesh.domain_ids,
              'regions':[{'id':d,'uid':'domain/'+str(d)} for d in sorted(set(model.mesh.domain_ids))],
              'discretization':'P1 contact thermal traces; independent GetDP A-u field; explicit homogenized winding Rac(T)'}
        field=temperature_field(mesh,temperatures,source(request,case,(job/bundle['path']).read_bytes()),convergence={'solver_status':'converged','iterations':len(result['iterations']),'energy_relative_residual':thermal['relative_energy_error']})
        artifact=write(job,case['case_id'],'temperature','x-cablesim.temperature-field',field)
        return {'case_id':case['case_id'],'status':'succeeded','results':[{'key':'x-cablesim.maximum-temperature','entity':'field','type':'quantity','unit':'K','status':'available','value':result['maximum_temperature_k']}],
                'artifacts':[bundle,artifact],'evidence':evidence,
                'warnings':[{'code':'HOMOGENIZED_WINDING_SCOPE','message':'给定的均质绕组Rac(T)约束包含无源区域损耗；适用范围由输入来源限定，不是自动IEC或三维绞合模型。'}]}
    finally:shutil.rmtree(work,ignore_errors=False)
