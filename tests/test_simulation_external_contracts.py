"""Input, environment refusal and report semantics without native solver requirements."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import pytest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/src'))
from cablesim_simulation.problem import Problem
from cablesim_simulation.external import comparison,prepare
from cablesim_simulation.solver_runtime import environment,EnvironmentMissing


def fixture(name='eddy-twin'):
    return json.loads((ROOT/f'plugins/cablesim.simulation/src/cases/{name}.json').read_text('utf-8'))


def test_missing_solver_does_not_fallback(tmp_path,monkeypatch):
    monkeypatch.setattr('cablesim_simulation.solver_runtime.shutil.which',lambda _:None)
    with pytest.raises(EnvironmentMissing,match='环境缺失'):
        environment('getdp',tmp_path,{})
    with pytest.raises(EnvironmentMissing,match='环境缺失'):
        environment('elmer',tmp_path,{})


def test_case_cannot_supply_executable_or_unknown_controls():
    d=fixture()
    with pytest.raises(ValueError,match='可执行文件'):
        prepare(d['input'],{**d['parameters'],'executable':'arbitrary.exe'},'getdp')


def test_conducting_regions_need_explicit_constraints_and_materials():
    d=fixture()['input']
    p=deepcopy(d);p['excitations'].pop()
    with pytest.raises(ValueError,match='每个导电区域'):
        Problem.model_validate(p)
    p=deepcopy(d);del p['geometry'][1]['material']['conductivity_s_m']
    with pytest.raises(ValueError,match='sigma'):
        Problem.model_validate(p)


def test_transient_requires_capacity_and_step_aligned_history():
    d=fixture('heat-step-cycle')['input']
    p=deepcopy(d);del p['geometry'][0]['material']['heat_capacity_j_m3_k']
    with pytest.raises(ValueError,match='体积热容'):
        Problem.model_validate(p)
    p=deepcopy(d);p['excitations'][0]['schedule'][1][0]=1001
    with pytest.raises(ValueError,match='时间步边界'):
        Problem.model_validate(p)


def test_report_cannot_match_wrong_unit_time_or_statistic():
    target={'id':'point','quantity':'probe_temperature_k','entity':'field','unit':'K','probe_index':0,'time_s':10,
            'reference':300,'tolerance':{'absolute':.1,'source':'predeclared test'},'source':'test'}
    observation={'quantity':'probe_temperature_k','entity':'field','unit':'K','probe_index':0,'time_s':10,'value':300.01}
    reference={'targets':[target]}
    assert comparison([observation],reference,{})['status']=='matched'
    assert comparison([{**observation,'time_s':20}],reference,{})['rows'][0]['status']=='not_comparable'
    assert comparison([{**observation,'unit':'C'}],reference,{})['rows'][0]['status']=='not_comparable'
    assert comparison([observation,observation],reference,{})['rows'][0]['status']=='not_comparable'
    target['tolerance']=None
    assert comparison([observation],reference,{})['rows'][0]['status']=='not_assessed'


def test_empty_reference_is_not_a_pass():
    assert comparison([],{}, {})['status']=='missing_reference'


def test_nonfinite_reference_or_tolerance_refused():
    d=fixture()['targets'][0]
    for patch in [{'reference':float('nan')},{'tolerance':{'absolute':float('inf'),'source':'test'}}]:
        with pytest.raises(ValueError):
            comparison([],{'targets':[{**d,**patch}]},{})
