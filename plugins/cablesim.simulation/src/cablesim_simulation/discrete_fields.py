"""Host entrypoints for sourced terminal matrices and discontinuous heat fields."""
import json
import numpy as np
from cablesim_sdk.discrete_fields import TerminalField,ContactThermalField
from .triangular_fields import terminal_admittance,contact_thermal,floating_admittance
from .artifacts import source,temperature_field,write
from .report import digest


def host_case(request,case,job):
    if case.get('parameters'):raise ValueError('parameters: this method accepts its complete SI contract in input')
    electrical=request['capability']=='terminal-field'
    model=(TerminalField if electrical else ContactThermalField).model_validate(case['input'])
    evidence={'input_sha256':digest(case['input']),'mesh_source':model.mesh.source.model_dump(mode='json')}
    if request['phase']=='check':return {'case_id':case['case_id'],'status':'succeeded','results':[],'artifacts':[],'evidence':evidence}
    mesh=model.mesh;p=np.asarray(mesh.points);t=np.asarray(mesh.triangles);ids=np.asarray(mesh.domain_ids)
    if electrical:
        omega=2*np.pi*model.frequency_hz
        gamma=np.array([model.materials[str(d)].conductivity_s_m+1j*omega*8.8541878128e-12*model.materials[str(d)].relative_permittivity for d in ids])
        groups=[np.unique(t[np.isin(ids,terminal.domain_ids)]) for terminal in model.terminals]
        result=terminal_admittance(p,t,gamma,groups,model.ground_nodes);Y=result.pop('admittance');result.pop('potential')
        result.update(terminal_ids=[t.id for t in model.terminals],admittance_real_s_m=Y.real.tolist(),admittance_imag_s_m=Y.imag.tolist(),capacitance_f_m=(Y.imag/omega).tolist(),frequency_hz=model.frequency_hz)
        indices,reduced=floating_admittance(Y,[i for i,t in enumerate(model.terminals) if t.id in model.floating_terminals])
        result.update(floating_terminal_ids=model.floating_terminals,effective_terminal_ids=[model.terminals[i].id for i in indices],effective_admittance_real_s_m=reduced.real.tolist(),effective_admittance_imag_s_m=reduced.imag.tolist(),effective_capacitance_f_m=(reduced.imag/omega).tolist())
        results=[{'key':'x-cablesim.terminal-capacitance','entity':model.terminals[index].id,'type':'quantity','unit':'F/m','status':'available','value':float(reduced[i,i].imag/omega)} for i,index in enumerate(indices)]
        field=None
    else:
        def conductivity(domains,T):
            k=np.empty(len(domains))
            for key,law in model.thermal_conductivity.items():
                mask=domains==int(key)
                if np.any((T[mask]<law.minimum_temperature_k)|(T[mask]>law.maximum_temperature_k)):raise ValueError('thermal_conductivity.'+key+': current temperature outside sourced Kelvin range; no extrapolation')
                k[mask]=np.polynomial.polynomial.polyval(T[mask],law.coefficients_w_m_k)
            return k
        result=contact_thermal(p,t,ids,conductivity,model.heat_w_m3,model.contact_edges,model.contact_conductance_w_m2k,model.temperature_nodes,model.ambient_k)
        local=result.pop('triangles');original=result.pop('original_nodes');temperatures=result.pop('temperature_k');result.pop('triangle_temperature_k')
        field={'points':p[original].tolist(),'triangles':local.tolist(),'domain_ids':ids.tolist(),
               'regions':[{'id':int(d),'uid':'domain/'+str(d)} for d in sorted(set(ids))],
               'discretization':'P1 triangular field; two independent temperature traces at each declared contact edge'}
        results=[{'key':'x-cablesim.maximum-temperature','entity':'field','type':'quantity','unit':'K','status':'available','value':result['maximum_k']}]
    payload={'schema':'cablesim.discrete-field-result/1','result':result,'evidence':evidence,'engineering_approval':False}
    bundle=write(job,case['case_id'],'discrete-field','x-cablesim.simulation-bundle',payload);artifacts=[bundle]
    if field:
        contract=temperature_field(field,temperatures,source(request,case,(job/bundle['path']).read_bytes()),convergence={'solver_status':'converged','iterations':result['iterations'],'energy_relative_residual':result['relative_energy_error']})
        artifacts.append(write(job,case['case_id'],'temperature','x-cablesim.temperature-field',contract))
    return {'case_id':case['case_id'],'status':'succeeded','results':results,'artifacts':artifacts,'evidence':evidence,
            'warnings':[{'code':'EXPLICIT_MESH_SCOPE','message':'结果仅对应给定离散几何、材料与边界；热源为显式输入，不声明双向电磁热耦合。'}]}
