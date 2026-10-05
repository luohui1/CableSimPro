"""Safety and contract checks require no commercial installation."""
from pathlib import Path
import json,sys
from copy import deepcopy
import pytest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'plugins/cablesim.comsol-bridge/src'))
from cablesim_comsol_bridge.adapter import prepare,parse
from cablesim_comsol_bridge.runtime import resolve,EnvironmentMissing,SolverFailure
from cablesim_comsol_bridge.java_model import source

def case():return json.loads((ROOT/'plugins/cablesim.simulation/src/cases/eddy-twin.json').read_text('utf-8'))

def test_missing_installation_never_uses_fallback():
    with pytest.raises(EnvironmentMissing,match='环境缺失'):resolve({})

def test_no_case_executable_java_or_file_paths():
    c=case()
    for key in ['executable','java','model_file','commands']:
        with pytest.raises(ValueError,match='parameters'):
            prepare(c['input'],{**c['parameters'],key:'arbitrary'})

def test_unsupported_mesh_is_explicitly_rejected():
    c=case()
    for key,value in [('field_order',1),('probe_cell_size_m',.02),('exterior_growth_start_m',8)]:
        p=deepcopy(c['parameters']);p['mesh'][key]=value
        with pytest.raises(ValueError,match='mesh'):prepare(c['input'],p)

def test_native_peak_conversion_and_no_user_expression_in_source():
    c=case();c['input']['assumptions']=['System.exit(1); malicious source label']
    p,m=prepare(c['input'],c['parameters']);s=source(p,m)
    assert 'System.exit' not in s
    assert '1.4142135623730951' in s
    assert 'real(mf.Jz)/sqrt(2)' in s
    assert 'BRIDGE_COMPLETE' in s

def test_parser_requires_fields_and_refuses_duplicate_or_nonfinite_data():
    p,_=prepare(case()['input'],case()['parameters'])
    for log in ['', 'BRIDGE_DATA|vertices|[[NaN,0],[0,1]]', 'BRIDGE_DATA|a|[]\nBRIDGE_DATA|a|[]']:
        with pytest.raises(SolverFailure):parse(log,p,{'name':'comsol'})

def test_heat_boundary_excludes_material_interfaces():
    c=case();p=c['input'];p['physics']='steady_heat';p.pop('frequency_hz');p['excitations']=[{'regions':['wire-1'],'kind':'heat_w_m','value':[1],'source':'test'}]
    for g in p['geometry']:g['material']={'k_w_m_k':1,'source':'test'}
    p['boundaries'][0]['kind']='temperature';p['boundaries'][0]['value']=300
    value,controls=prepare(p,c['parameters']);text=source(value,controls)
    assert 'getAdj(1,2,b).length==1' in text
    assert 'feature("temp0").selection().set(exterior)' in text

def test_passive_complex_permeability_and_series_constraints():
    c=case();c['input']['geometry'][1]['material']['relative_permeability_loss']=-1
    with pytest.raises(ValueError):prepare(c['input'],c['parameters'])
    c=case();c['input']['excitations'][0]['connection']='series'
    with pytest.raises(ValueError,match='串联组'):prepare(c['input'],c['parameters'])


def test_reference_solver_requires_same_canonical_problem_hash():
    from cablesim_sdk.reproduction import comparison
    target={'id':'r','quantity':'resistance','entity':'wire','unit':'ohm/m','reference':1.,'tolerance':{'absolute':.1,'source':'test'},'source':'test'}
    obs={'quantity':'resistance','entity':'wire','unit':'ohm/m','value':1.01}
    reference={'targets':[target],'reference_solver':{'name':'COMSOL','problem_sha256':'same','observations':[{**obs,'value':1.02}]}}
    row=comparison([obs],reference,{'problem_sha256':'same'})['rows'][0]
    assert row['reference_solver_value']==1.02
    assert row['difference_from_reference_solver']==pytest.approx(-.01)
    row=comparison([obs],reference,{'problem_sha256':'different'})['rows'][0]
    assert row['reference_solver_value'] is None and row['solver_comparison_status']=='not_comparable'


def test_both_solvers_use_identical_problem_digest_without_rewriting_history():
    from hashlib import sha256
    from cablesim_sdk.reproduction import digest as shared
    from cablesim_comsol_bridge.adapter import digest as commercial
    sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/src'))
    from cablesim_simulation.report import digest as opened
    problem,_=prepare(case()['input'],case()['parameters'])
    historical=sha256(json.dumps(problem,ensure_ascii=False,sort_keys=True,allow_nan=False).encode()).hexdigest()
    assert shared(problem)==opened(problem)==commercial(problem)==historical
    assert shared({**problem,'frequency_hz':61})!=historical
