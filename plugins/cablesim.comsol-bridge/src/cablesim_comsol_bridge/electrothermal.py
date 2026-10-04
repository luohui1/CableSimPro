"""Independent native COMSOL FrequencyStationary reference for sigma(T)."""
import json
import numpy as np
from backend.foundation.electrothermal import Electrothermal
from backend.foundation.simulation import MeshControls
from backend.foundation.reproduction import digest
from .java_model import source
from .runtime import execute,SolverFailure
from .adapter import parse


def prepare(value,parameters):
    if set(parameters)!={'mesh'}:raise ValueError('parameters：电热对照只接受mesh。')
    model=Electrothermal.model_validate(value)
    controls=MeshControls.model_validate(parameters['mesh']).model_dump(mode='json')
    source(model.magnetic.model_dump(mode='json'),controls,coupling=model.model_dump(mode='json'))
    return model,controls


def solve(model,controls,work,check=False):
    problem=model.magnetic.model_dump(mode='json')
    java=source(problem,controls,coupling=model.model_dump(mode='json'),check=check)
    log,evidence=execute(java,work,['COMSOL','ACDC','HEATTRANSFER'],save_model=not check)
    if check:return None,{'solver':evidence},[]
    mesh,result,observations=parse(log,problem,evidence)
    data={line.split('|',2)[1]:json.loads(line.split('|',2)[2]) for line in log.splitlines() if line.startswith('BRIDGE_DATA|')}
    if data.get('frequency_hz')!=problem['frequency_hz']:
        raise SolverFailure('frequency_hz：COMSOL实际求解频率与固定输入不一致。')
    temperature=np.asarray(data.get('temperature',[]),dtype=float)
    if temperature.shape!=(1,1,len(mesh['points'])) or not np.isfinite(temperature).all() or temperature.min()<=0:
        raise SolverFailure('temperature：COMSOL未输出完整有限正温度场。')
    temperature=temperature[0,0];cells=np.asarray(mesh['triangles']);ids=np.asarray(mesh['domain_ids'])
    regions=[];total_heat=0.
    for i,g in enumerate(problem['geometry']):
        values=np.asarray(data.get('thermal-integrals-'+str(i),[]),dtype=float)
        if values.shape!=(3,1) or not np.isfinite(values).all() or values[1,0]<=0:raise SolverFailure('thermal-integrals：区域温度/热源积分无效。')
        raw_heat=float(values[2,0]);heat=raw_heat
        if raw_heat<0:
            # A material with exactly zero sigma and zero magnetic loss has
            # analytically zero dissipation. Preserve native roundoff evidence.
            m=g['material']
            if m['conductivity_s_m']==0 and m.get('relative_permeability_loss',0)==0 and abs(raw_heat)<=1e-12:heat=0.
            else:raise SolverFailure('thermal-integrals：区域热源为负，不是无损材料的舍入误差。')
        local=temperature[np.unique(cells[ids==i+1])]
        law=model.resistivity_laws.get(g['uid'])
        if law and (local.min()<law.minimum_temperature_k or local.max()>law.maximum_temperature_k):
            raise SolverFailure('resistivity_laws.'+g['uid']+'：COMSOL温度场越出已声明范围。')
        total_heat+=heat
        regions.append(dict(entity=g['uid'],mean_temperature_k=float(values[0,0]/values[1,0]),maximum_nodal_temperature_k=float(local.max()),heat_source_w_m=heat,raw_native_heat_source_w_m=raw_heat,lossless_roundoff_removed=heat!=raw_heat))
    maximum=float(temperature.max())
    result.update(temperature_k=temperature.tolist(),maximum_temperature_k=maximum,region_temperatures=regions,
                  actual_frequency_hz=data['frequency_hz'],
                  source_heat_w_m=total_heat,
                  coupling='native FrequencyStationary; pointwise sigma(T); heat source mf.Qh; no regional average conductivity',
                  input_sha256=digest(model.model_dump(mode='json')))
    result['solver_files']={'BridgeJob.java':java,'solver.log':'\n'.join(l for l in log.splitlines() if not l.startswith('BRIDGE_DATA|'))}
    observations.append(dict(quantity='maximum_temperature_k',entity='field',value=maximum,unit='K',time_s=0.))
    observations.append(dict(quantity='total_heat_source_w_m',entity='field',value=total_heat,unit='W/m'))
    return mesh,result,observations
