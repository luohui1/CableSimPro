"""Independent Fourier evidence separating temporal and spatial error on Slurm."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import numpy as np
import pytest

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'plugins/cablesim.simulation/src'),str(ROOT/'plugins/cablesim.simulation/validation'),
              str(ROOT/'plugins/cablesim.comsol-bridge/src')]
from cablesim_simulation.problem import validate
from cablesim_simulation.problem_mesh import build
from cablesim_simulation.elmer_adapter import solve as elmer
from cablesim_comsol_bridge.adapter import solve as comsol
from verify_external import slab_exact


def fixture(h,dt):
    value=json.loads((ROOT/'plugins/cablesim.simulation/src/cases/heat-step-cycle.json').read_text('utf-8'))
    value['parameters']['mesh'].update(size_m=h,far_size_m=h,max_nodes=50000)
    value['input']['time'].update(step_s=dt,steps=round(4000/dt))
    return value


@pytest.mark.parametrize('h,dt',[(.0005,10.),(.00025,10.),(.0005,5.),(.0005,2.5)])
def test_elmer_time_vs_mesh_full_curve(tmp_path,h,dt):
    value=fixture(h,dt);problem,controls=validate(value['input'],value['parameters']['mesh'])
    mesh=build(problem,controls);result=elmer(problem.model_dump(mode='json'),mesh,tmp_path)
    curve=result['temperature_history']['field']
    rows=[{'time_s':row['time_s'],'calculated_k':row['maximum_k'],
           'reference_k':slab_exact(.01,row['time_s'],problem.excitations[0].schedule)} for row in curve]
    error=max(abs(row['calculated_k']-row['reference_k']) for row in rows)
    evidence={'solver':'Elmer','mesh_size_m':h,'time_step_s':dt,'nodes':len(mesh['points']),
              'maximum_absolute_error_k':error,'mesh_sha256':mesh['sha256'],'rows':rows,
              'threshold_k':.1,'meets_threshold':error<.1,'engineering_approval':False}
    path=ROOT/'artifacts'/f'transient-refinement-elmer-{h}-{dt}.json';path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(evidence,indent=2),encoding='utf-8')
    assert error<.5  # Coarse cases diagnose the declared 0.1 K target; retain every result.
    if dt==2.5:assert error<.1,error


def test_comsol_refined_full_curve_against_fourier(tmp_path):
    value=fixture(.0005,2.5);problem,controls=validate(value['input'],value['parameters']['mesh'])
    raw=problem.model_dump(mode='json');configuration=controls.model_dump(mode='json');configuration['field_order']=2
    mesh,result,observations=comsol(raw,configuration,tmp_path)
    rows=[{'time_s':row['time_s'],'calculated_k':row['value'],
           'reference_k':slab_exact(.01,row['time_s'],problem.excitations[0].schedule)}
          for row in observations if row['quantity']=='probe_temperature_k']
    error=max(abs(row['calculated_k']-row['reference_k']) for row in rows)
    path=ROOT/'artifacts/transient-refinement-comsol.json';path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps({'solver':'COMSOL','mesh_size_m':.0005,'time_step_s':2.5,
        'nodes':len(mesh['points']),'maximum_absolute_error_k':error,'rows':rows,
        'threshold_k':.1,'meets_threshold':error<.1,'engineering_approval':False},indent=2),encoding='utf-8')
    assert error<.1,error
