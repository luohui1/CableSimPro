"""Light algebra/contracts locally; actual FEM only under a Slurm allocation."""
import json
import os
import sys
from copy import deepcopy
from pathlib import Path
import numpy as np
import pytest
from scipy.integrate import quad

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'plugins/cablesim.simulation/src'),str(ROOT/'plugins/cablesim.iec60287/src'),str(ROOT/'plugins/cablesim.simulation/validation')]
from cablesim_simulation.step_response import image_step_rise,StepInput,prepare,emergency_export
from step_response_case import case


def test_image_transient_against_integral_and_steady_limit():
    from cablesim_simulation.far_boundary import image_rise
    sources=[dict(center_m=[0.,-1.],loss_w_m=12.)];k=1.25;capacity=2470000.;t=1e6
    real=.2**2;mirror=.2**2+4.;a=k/capacity
    expected=12/(4*np.pi*k)*quad(lambda x:np.exp(-x)/x,real/(4*a*t),mirror/(4*a*t),epsabs=1e-12)[0]
    assert image_step_rise([[.2],[-1.]],sources,k,capacity,t)[0]==pytest.approx(expected,rel=1e-11)
    assert image_step_rise([[0.,2.],[0.,0.]],sources,k,capacity,t).tolist()==[0.,0.]
    assert image_step_rise([[.2],[-1.]],sources,k,capacity,0).tolist()==[0.]
    assert image_step_rise([[.2],[-1.]],sources,k,capacity,1e15)[0]==pytest.approx(image_rise([[.2],[-1.]],sources,1/k)[0],abs=1e-8)


def test_heat_capacity_missing_source_refused_before_mesh():
    value,controls=case();value['capacities']['xlpe'].pop('reference')
    with pytest.raises(ValueError,match='reference'):prepare(value,controls)
    value,controls=case();value['capacities'].pop('soil')
    with pytest.raises(ValueError,match='soil'):prepare(value,controls)
    value,controls=case();value['capacities']['soil']['value_j_m3_k']*=2
    with pytest.raises(ValueError,match='密度'):prepare(value,controls)


def test_endpoint_must_match_saved_steady_directly():
    from cablesim_simulation.step_response import endpoint_passed
    # Both intermediate gaps are 0.09 K, but the final/saved gap is 0.18 K.
    assert not endpoint_passed(9.91,9.82,10.,.1)
    assert endpoint_passed(9.654903969902433,9.63973273923382,9.64118780563788,.1)


def test_emergency_export_matches_receiver_contract():
    from cablesim_iec60287.emergency import Emergency
    response=dict(convergence={'status':'converged'},curve=[{'time_s':0.,'rise_k':0.},{'time_s':10.,'rise_k':.2},{'time_s':100.,'rise_k':1.}],
        circuit_id='single',reference_current_a=400.,steady_joule_rise_k=2.,job_id='contract-test-only',method_version='1.0.0',input_sha256='a'*64)
    exported=emergency_export(response);accepted=Emergency.model_validate(exported)
    assert accepted.scope=='thermally_isolated_circuit' and accepted.initial_current_a==0
    assert accepted.rated_response[0].time_s==10.
    response['convergence']['status']='unconverged'
    with pytest.raises(ValueError,match='不能导出'):emergency_export(response)


def test_step_contract_preserves_typed_validation_and_native_guard():
    from cablesim_simulation.step_contract import schemas
    from backend.plugin_host.manifest import Manifest
    manifest=json.loads((ROOT/'plugins/cablesim.simulation/plugin.json').read_text('utf-8'))
    cap=manifest['capabilities'][0];a,b=schemas(manifest)
    assert cap['input_contract']['standalone_schema']==a
    assert cap['parameter_schema']==b
    Manifest.model_validate(manifest)
    value,controls=case();controls['operation']='step_response'
    with pytest.raises(ValueError,match='先封存'):prepare(value,controls)
    from cablesim_simulation.step_response import time_grid,Controls
    parsed=Controls.model_validate(controls)
    assert time_grid(parsed,1)[1]==time_grid(parsed,0)[1]/2


@pytest.mark.skipif(not os.environ.get('SLURM_JOB_ID'),reason='FEM step-response regression only on dg83')
def test_native_step_response_converges_and_cross_checks():
    from cablesim_simulation.step_response import solve
    value,controls=case();p,c=prepare(value,controls);reference,_,_=solve(p,c)
    value['saved_source']=dict(run_id='native-regression',output_sha256='a'*64,input_sha256='b'*64,
        method='固定焦耳稳态参考 1.0.0',study_name='原生回归',steady_joule_rise_k=reference['steady_joule_rise_k'])
    controls['operation']='step_response';p,c=prepare(value,controls);response,_,_=solve(p,c)
    assert response['convergence']['status']=='converged',response['convergence']
    assert response['analytic_cross_check']['maximum_difference_k']<.1
    assert emergency_export(response)['rated_response']
