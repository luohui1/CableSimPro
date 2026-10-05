"""Elmer per-timestep conductor statistics, checked against a Fourier hand solution."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import pytest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/src'))
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/validation'))
from cablesim_sdk.simulation import validate
from cablesim_simulation.problem_mesh import build
from cablesim_simulation.elmer_adapter import solve
from verify_external import slab_exact


def test_each_time_step_is_saved_with_region_maximum(tmp_path):
    fixture=json.loads((ROOT/'plugins/cablesim.simulation/src/cases/heat-step-cycle.json').read_text('utf-8'))
    value=deepcopy(fixture['input']);value['time'].update(step_s=2.,steps=250)
    value['excitations'][0]['schedule']=[[0,1]]
    value['temperature_regions']={'slab':['slab']}
    controls=dict(fixture['parameters']['mesh'],size_m=.0005,far_size_m=.0005)
    problem,config=validate(value,controls);mesh=build(problem,config)
    result=solve(problem.model_dump(mode='json'),mesh,tmp_path)
    history=result['temperature_history']['slab']
    assert [row['time_s'] for row in history]==pytest.approx(list(range(0,501,2)))
    error=max(abs(row['maximum_k']-slab_exact(.01,row['time_s'],[[0,1]])) for row in history)
    assert error<.1,(error,result['solver'])
    assert result['temperature_history']['field'][-1]['maximum_k']==pytest.approx(history[-1]['maximum_k'],abs=1e-8)
