"""TB 880 0-2 diagnostic interventions; never fit or replace a saved result.

Invoked by the reproduction library's diagnostic importer. Native work requires
Slurm. Air coefficients and the soil-resistance intervention are sourced from
TB 880 pp.85–86; HDPE +/-10% is explicitly a hypothetical perturbation because
the report gives only rho=3.5 K m/W, not a material uncertainty interval.
"""
from copy import deepcopy
from hashlib import sha256
import json
import os
from pathlib import Path
import time
from unittest.mock import patch

from tb880_fem import inputs, thermal_model, ConstrainedField


def variants():
    return [
        dict(id='baseline',label='原工况：同心、空气温度反馈'),
        dict(id='air-20',label='空气经验式固定为 20 °C',air_c=20.,basis='温度包络；U/V/Y 不变，TB 880 p.85 表4'),
        dict(id='air-90',label='空气经验式固定为 90 °C',air_c=90.,basis='温度包络；U/V/Y 不变，TB 880 p.85 表4'),
        dict(id='hdpe-low',label='HDPE 热阻率 −10%',rho_factor=.9,basis='假设扰动；报告 p.85 仅给 3.5，无变化区间'),
        dict(id='hdpe-high',label='HDPE 热阻率 +10%',rho_factor=1.1,basis='假设扰动；报告 p.85 仅给 3.5，无变化区间'),
        dict(id='air-mesh-1',label='空气层局部网格 0.3 mm',air_size=.0003),
        dict(id='air-mesh-2',label='空气层局部网格 0.15 mm',air_size=.00015),
        dict(id='offset-half',label='电缆下移半个间隙（未接触）',offset_fraction=.5,basis='几何诊断；报告 p.84 未声明电缆接触管壁'),
        dict(id='contact',label='电缆与管底相切',offset_fraction=1.,basis='几何诊断；零厚接触无接触热阻，未改变材料'),
        dict(id='contact-refined',label='管底相切、网格加密',offset_fraction=1.,mesh_size=.0003),
        dict(id='air-isothermal',label='空气两侧周向恒温',interfaces=('cable','inner'),basis='空气集中热阻口径诊断；经验式不变'),
        dict(id='soil-network',label='管外替换为报告土壤热阻',soil_r=1.38002093961,basis='TB 880 p.86 T4‴，实际损耗反馈；模型口径诊断，不是工程场结果'),
        dict(id='network-interfaces',label='报告土壤热阻 + 空气周向恒温',soil_r=1.38002093961,interfaces=('cable','inner'),basis='报告集中热阻口径诊断；非工程场结果'),
    ]


def diagnostic_mesh(model, controls, centers, air_size):
    """Keep pipe centers fixed while shifting cables; refine only air regions."""
    import gmsh
    from cablesim_simulation.thermal_mesh import build
    add_disk=gmsh.model.occ.addDisk
    background=gmsh.model.mesh.field.setAsBackgroundMesh
    def disk(x,y,z,rx,ry,*args,**kwargs):
        if centers:
            cable=next((c for c in model.cables if abs(c.x_m-x)<1e-10 and abs(c.z_m-y)<1e-10),None)
            if cable and rx>cable.layers[-1].outer_radius_m+1e-10:x,y=centers[cable.uid]
        return add_disk(x,y,z,rx,ry,*args,**kwargs)
    def field(tag):
        if air_size:
            air=[]
            for dim,group in gmsh.model.getPhysicalGroups(2):
                if gmsh.model.getPhysicalName(dim,group).endswith('/air'):
                    air.extend(gmsh.model.getEntitiesForPhysicalGroup(dim,group))
            if not air:raise ValueError('Air refinement requires actual air surfaces')
            f=gmsh.model.mesh.field
            constant=f.add('MathEval');f.setString(constant,'F',str(air_size))
            restricted=f.add('Restrict');f.setNumber(restricted,'InField',constant)
            f.setNumbers(restricted,'SurfacesList',[int(t) for t in air])
            minimum=f.add('Min');f.setNumbers(minimum,'FieldsList',[tag,restricted]);tag=minimum
        return background(tag)
    with patch.object(gmsh.model.occ,'addDisk',disk),patch.object(gmsh.model.mesh.field,'setAsBackgroundMesh',field):
        return build(model,controls)


def interface_states(solver, temperature, powers, centers):
    import numpy as np
    from skfem import FacetBasis, ElementTriP2
    s=solver.system;ends=s.mesh.p[:,s.mesh.facets];rows=[]
    for cable,power in zip(s.model.cables,powers):
        pipe=centers.get(cable.uid,(cable.x_m,cable.z_m));values={}
        for key,pos,radius in [('cable',(cable.x_m,cable.z_m),cable.layers[-1].outer_radius_m),
                              ('inner',pipe,cable.duct.inner_radius_m),('outer',pipe,cable.duct.outer_radius_m)]:
            distances=np.hypot(ends[0]-pos[0],ends[1]-pos[1])
            facets=np.flatnonzero(np.all(np.isclose(distances,radius,atol=1e-8,rtol=0),axis=0))
            fb=FacetBasis(s.mesh,ElementTriP2(),facets=facets,intorder=4)
            values[key+'_temperature_k']=float(np.sum(fb.interpolate(temperature)*fb.dx)/fb.dx.sum())
        q=sum(power[k] for k in ('conductor_loss_w_m','sheath_loss_w_m','dielectric_loss_w_m'))
        values.update(entity=cable.uid,loss_w_m=q,
            air_effective_r=(values['cable_temperature_k']-values['inner_temperature_k'])/q,
            wall_effective_r=(values['inner_temperature_k']-values['outer_temperature_k'])/q,
            soil_effective_r=(values['outer_temperature_k']-s.reference)/q)
        rows.append(values)
    return rows


def run(folder, selected=None):
    if not os.environ.get('SLURM_JOB_ID'):raise RuntimeError('Diagnostics require Slurm dg83')
    from cablesim_iec60287.domain import prepare
    from scipy.optimize import brentq
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    raw=(Path(__file__).parent/'cases/tb880-ducts.json').read_bytes();fixture=json.loads(raw)
    base,parameters=inputs(fixture);reference=fixture['expected']['ampacityA']
    plugin=json.loads((Path(__file__).parents[1]/'plugin.json').read_text('utf-8'))
    report=dict(schema='cablesim.tb880-sensitivity/1',case_id='B02-2',job_id=os.environ['SLURM_JOB_ID'],
        plugin_version=plugin['version'],method='tb880-duct-diagnostics/1',fixture_sha256=sha256(raw).hexdigest(),
        source=fixture['source'],reference_current_a=reference,input=base,parameters=parameters,
        allocated_cpus=int(os.environ.get('SLURM_CPUS_PER_TASK','1')),rows=[])
    def save():
        temp=folder/'report.pending';temp.write_text(json.dumps(report,ensure_ascii=False,allow_nan=False),'utf-8')
        temp.replace(folder/'report.json')
    for variation in variants():
        if selected and variation['id'] not in selected:continue
        started=time.monotonic();row={**variation,'status':'running'};report['rows'].append(row);save()
        try:
            d=deepcopy(base)
            if 'rho_factor' in variation:
                next(m for m in d['materials'] if m['id']=='material/tb-duct')['thermal_resistivity']*=variation['rho_factor']
            group=prepare(d,parameters);size=variation.get('mesh_size',.0006)
            model,controls=thermal_model(d,group,size,64.);controls.max_nodes=4000000
            centers={}
            if 'offset_fraction' in variation:
                for cable,g in zip(model.cables,group.cables):
                    centers[cable.uid]=(cable.x_m,cable.z_m)
                    gap=cable.duct.inner_radius_m-cable.layers[-1].outer_radius_m
                    cable.z_m-=gap*variation['offset_fraction'];g['point']=(cable.x_m,cable.z_m)
            if 'air_c' in variation:
                from math import log,pi
                for c in model.cables:
                    law=c.duct.air_law;diameter_mm=c.layers[-1].outer_radius_m*2000
                    c.duct.air_resistance_k_m_w=law.u/(1+.1*(law.v+law.y_per_k*variation['air_c'])*diameter_mm)
                    c.duct.air_law=None
            mesh=diagnostic_mesh(model,controls,centers,variation.get('air_size')) if centers or variation.get('air_size') else None
            solver=ConstrainedField(model,controls,group,prepared_mesh=mesh,duct_centers=centers,
                interfaces=variation.get('interfaces',()),outer_resistance=variation.get('soil_r'))
            row.update(nodes=int(solver.system.basis.N),phase='published_current');save()
            public,_=solver.state(reference);trials=[]
            row.update(public_current_state=public,phase='rating',rating_trials=trials);save()
            def excess(current):
                state,_=solver.state(current);trials.append(dict(current_a=current,hotspot_k=state['hotspot_k']))
                save()
                return state['hotspot_k']-363.15
            ampacity=brentq(excess,0.,reference*1.3,xtol=.001)
            state,t=solver.state(ampacity)
            row.update(status='complete',ampacity_a=ampacity,public_current_state=public,rating_state=state,rating_trials=trials,
                interface_states=interface_states(solver,t,state['cables'],centers),mesh_size_m=size,extent_m=64.,
                duct_centers_m=centers,thermal_input=model.model_dump(mode='json'),controls=controls.model_dump(mode='json'))
            del solver,mesh,t
            import gc;gc.collect()
        except Exception as exc:
            row.update(status='failed',failure=dict(type=type(exc).__name__,message=str(exc)))
        row['wall_seconds']=time.monotonic()-started
        row['allocated_core_hours']=row['wall_seconds']*report['allocated_cpus']/3600;save()
    return report


if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--only',nargs='*')
    a=p.parse_args();run(a.output,a.only)
