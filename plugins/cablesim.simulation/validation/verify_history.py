"""Real dg83 method validation, using explicitly synthetic method parameters.

Run via scripts/run_plugin_tests_hpc.py --test
plugins/cablesim.simulation/validation/verify_history.py --wall-seconds 3600.
No engineering material, release seed, manufacturer result or IEC example is
claimed. Evidence is exported by the native test worker with SHA256 digests.
"""
from copy import deepcopy
import json
import os
from pathlib import Path
import sys
import pytest

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'plugins/cablesim.simulation/src'),str(ROOT/'plugins/cablesim.iec60287/src'),
             str(ROOT/'plugins/cablesim.iec60287/tests')]
from test_three_core import document,parameters
from cablesim_simulation.three_core_thermal import prepare
from cablesim_simulation.three_core_history import ResolvedHistory, response_change, history_rise
from cablesim_simulation.report import digest

pytestmark=pytest.mark.skipif(not os.environ.get('SLURM_JOB_ID'),reason='原生方法验证只在 dg83')


def case(level=0,homogeneous=False):
    d=document()
    labels={'cu':'conductor','steel':'metal','soil':'soil','duct':'duct','fibre':'filler','semi':'semiconductor','xlpe':'insulation','pvc':'polymer'}
    for m in d['materials']:
        name=m['id'].split('/')[-1];m.update(label=name,category=labels[name])
        if name=='steel':m['thermal_resistivity']=.0133
    circuit=deepcopy(d['circuits'][0]);d['circuits']=[];s=d['sections'][0];s['placements']=[]
    # 0.16 m spacing is non-overlapping and lies within the four-hour soil
    # diffusion scale. A 0.70 m pilot spacing gave only ~3e-8 K mutual change,
    # too small to distinguish meaningful interaction from numerical noise.
    for i,x in enumerate([-.08,.08]):
        c=deepcopy(circuit);c.update(id=f'circuit/{i}',label=f'方法验证回路{i+1}')
        c['cables'][0]['id']=f'cable/{i}';d['circuits'].append(c)
        s['placements'].append(dict(cable=f'cable/{i}',x=x,z=-1.2))
    currents={c['id']:250. for c in d['circuits']};d['load_cases'][0]['currents']=currents
    p={'domain_options':{'section_id':s['id'],'load_id':'load/steady','bounds_m':[-4.,-4.,4.,0.],
        'equivalent_layers_acknowledged':True,'source':'方法验证参数：显式三芯/双回路测试几何，不是工程输入'},
       'iec':parameters(),'outer_boundary':'kennelly_image','tolerance_k':1e-7,'maximum_iterations':200,
       'mesh':{'size_m':.003/2**level,'far_size_m':.5/2**level,'transition_m':.4,
               'minimum_circle_segments':64,'field_order':2,'max_nodes':120000}}
    prepared=prepare(d,p)
    if homogeneous:
        for g in prepared[3].geometry:g.material.k_w_m_k=1/1.2
    values={g.uid:(2e6 if homogeneous else 3.2e6 if g.uid.endswith('/conductor') else 2e6) for g in prepared[3].geometry}
    reference=digest({'purpose':'method_validation_parameters','values_j_m3_k':values})
    capacities={uid:dict(value_j_m3_k=value,material=uid,reference='方法验证参数：明确给定的质量矩阵测试值，不用于工程或种子',
        source_sha256=reference,page=1,table='显式验证参数表',limitations='仅用于数值方法验证；不声称实际材料物性') for uid,value in values.items()}
    return prepared,capacities,currents


def save(name,value):
    folder=ROOT/'artifacts'/'history-method';folder.mkdir(parents=True,exist_ok=True)
    (folder/(name+'.json')).write_text(json.dumps(value,ensure_ascii=False,allow_nan=False,indent=2),'utf-8')


def test_resolved_preload_cooling_energy_and_convergence():
    import numpy as np
    prepared,capacities,currents=case();system=ResolvedHistory(prepared,capacities,validation_parameters=True)
    preload=system.freeze_preload(currents);save('preload',preload)
    # Exercise actual saved-file input, not an in-memory initial-temperature stub.
    restored=json.loads((ROOT/'artifacts/history-method/preload.json').read_text('utf-8'))
    hold=system.march(restored,[dict(time_s=0.,currents_a=currents)],np.arange(0.,3600.+60.,60.))
    drift=max(abs(core['temperature_k']-initial['temperature_k']) for row in hold['rows']
              for core,initial in zip(row['conductors'],hold['rows'][0]['conductors']))
    assert drift<.1
    cool=system.march(restored,[dict(time_s=0.,currents_a={uid:0. for uid in currents})],np.arange(0.,3600.+60.,60.))
    assert cool['rows'][-1]['maximum_temperature_k']<cool['rows'][0]['maximum_temperature_k']
    # Dielectric power remains at zero current: explicitly retained, never called zero-heat.
    schedule=[dict(time_s=0.,currents_a={**currents,'circuit/0':300.}),
              dict(time_s=7200.,currents_a={**currents,'circuit/0':275.})]
    levels=[];previous=None;accepted=None;dt=120.
    for level in range(4):
        dt=120./2**level
        current=system.march(restored,schedule,np.arange(0.,14400.+dt,dt),wall_limit_s=600,cpu_limit_s=600)
        change=response_change(previous,current) if previous else None
        levels.append(dict(kind='time',level=level+1,change_k=change,**{k:v for k,v in current.items() if k not in ('rows','capacities')}))
        save('time-'+str(level+1),current)
        previous=current;accepted=current
        if change is not None and change<=.1:break
    time_passed=change is not None and change<=.1
    previous=accepted;mesh_passed=False
    for level in range(1,3):
        fine,cap,_=case(level);system=ResolvedHistory(fine,cap,validation_parameters=True)
        # Each mesh obtains and saves its own verified full-mesh steady field.
        saved=system.freeze_preload(currents);save('preload-mesh-'+str(level+1),saved)
        current=system.march(saved,schedule,np.arange(0.,14400.+dt,dt),wall_limit_s=600,cpu_limit_s=600)
        change=response_change(previous,current);previous=current
        levels.append(dict(kind='mesh',level=level+1,change_k=change,**{k:v for k,v in current.items() if k not in ('rows','capacities')}))
        save('mesh-'+str(level+1),current)
        if change<=.1:mesh_passed=True;break
    finer=system.march(saved,schedule,np.arange(0.,14400.+dt/2,dt/2),wall_limit_s=600,cpu_limit_s=600)
    final_change=response_change(current,finer);time_passed=time_passed and final_change<=.1
    levels.append(dict(kind='time_final_mesh',change_k=final_change,dofs=finer['dofs'],wall_seconds=finer['wall_seconds'],cpu_seconds=finer['cpu_seconds'],frozen_limits=finer['frozen_limits']))
    save('final',finer)
    assert len(finer['rows'][0]['conductors'])==6
    # The unchanged neighboring circuit actually warms in the shared soil.
    by_circuit=lambda row,c:max(r['temperature_k'] for r in row['conductors'] if r['circuit_id']==c)
    mutual=by_circuit(finer['rows'][-1],'circuit/1')-by_circuit(finer['rows'][0],'circuit/1')
    report=dict(reference_kind='method_validation_parameters',engineering_approval=False,job_id=os.environ['SLURM_JOB_ID'],
        hold_maximum_drift_k=drift,cooling_drop_k=cool['rows'][0]['maximum_temperature_k']-cool['rows'][-1]['maximum_temperature_k'],
        cooling_retains_dielectric_heat=True,mutual_temperature_change_k=mutual,energy_relative_residual=finer['energy_relative_residual'],
        tolerance_k=.1,time_passed=time_passed,mesh_passed=mesh_passed,levels=levels)
    save('convergence',report);save('hold',hold);save('cooling',cool)
    assert mutual>.01, '互热应达到可分辨量级，不能用浮点噪声证明共享域互热'
    assert finer['energy_relative_residual']<1e-6
    assert time_passed and mesh_passed,report
    corrupted=deepcopy(restored);corrupted['temperature_k'][0]+=1.
    with pytest.raises(ValueError,match='摘要'):system.restore_preload(corrupted)


def test_piecewise_image_history_in_external_homogeneous_soil():
    import numpy as np
    prepared,capacities,currents=case(homogeneous=True)
    system=ResolvedHistory(prepared,capacities,validation_parameters=True)
    # Six resolved finite disk heat sources. Their radii are explicit; the E1
    # line-source reference checks exterior soil, not cable internal storage.
    base={uid:2. for b in system.bindings for uid in b['conductors']}
    initial=system.freeze_preload(currents,fixed_region_heat=base)
    schedules=[dict(time_s=t,currents_a=currents) for t in (0.,3600.,7200.)]
    powers=[{uid:(4. if uid.startswith('cable/0/') else 2.) for uid in base},
            {uid:(1. if uid.startswith('cable/0/') else 3.) for uid in base},
            {uid:0. for uid in base}]
    at=[0.,3600.,7200.];last=initial['sources'];changes=[]
    from cablesim_simulation.three_core_history import increments
    for t,power in zip(at,powers):
        _,_,sources,_=system.evaluate(np.full(system.basis.N,system.ambient),currents,power)
        changes.append((t,increments(last,sources)));last=sources
    probe=[0.,-1.2];dt=30.;times=np.arange(0.,14400.+dt,dt)
    result=system.march(initial,schedules,times,fixed_heat_history=powers,probe_m=probe,wall_limit_s=600,cpu_limit_s=600)
    analytic=[float(history_rise([[probe[0]],[probe[1]]],initial['sources'],changes,system.k,system.capacity,t)[0])+system.ambient for t in times]
    error=max(abs(row['probe_temperature_k']-a) for row,a in zip(result['rows'],analytic))
    save('analytic-history',dict(reference_kind='analytic_cross_check',official_iec_example=False,method_validation_parameters=True,
        maximum_difference_k=error,tolerance_k=.1,probe_m=probe,dofs=result['dofs'],frozen_limits=result['frozen_limits'],
        wall_seconds=result['wall_seconds'],cpu_seconds=result['cpu_seconds'],job_id=os.environ['SLURM_JOB_ID'],
        scope='均匀土壤外部有限圆域热源与 E1 镜像线源分段历史叠加；包含有限半径和离散误差',
        rows=[dict(time_s=row['time_s'],fem_temperature_k=row['probe_temperature_k'],analytic_temperature_k=a) for row,a in zip(result['rows'],analytic)]))
    assert error<=.1
