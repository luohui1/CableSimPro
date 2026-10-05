"""Independent radial heat formula and paired-label domain sensitivity on Slurm."""
import importlib.util
from math import log,pi
import os
from pathlib import Path
import json
import pytest

pytestmark=pytest.mark.skipif(not os.environ.get('SLURM_JOB_ID'),reason='Native FEM checks require a Slurm allocation')


def prepare_module():
    root=Path(__file__).resolve().parents[1]
    path=root/'plugins/cablesim.hybrid-rating/validation/prepare_batches.py'
    spec=importlib.util.spec_from_file_location('hybrid_prepare',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def test_fine_interface_band_preserves_closed_radial_temperature_and_energy():
    from cablesim_simulation.thermal_input import ThermalModel,Controls
    from cablesim_simulation.thermal import solve_thermal
    ambient=293.15;heat=2.;r=.01;outer=.02;core_k=10.;ins_k=.5
    model=ThermalModel.model_validate({'schema_version':'cablesim.thermal-model/1',
        'cables':[{'uid':'cable/one','circuit':'circuit/one','x_m':0.,'z_m':0.,'current_a':0.,
            'electrical':None,'prescribed_core_temperature_k':None,'temperature_limit_k':363.15,'duct':None,
            'layers':[{'uid':'core','role':'conductor','outer_radius_m':r,'k_w_m_k':core_k,'fixed_heat_w_m':heat},
                      {'uid':'insulation','role':'insulation','outer_radius_m':outer,'k_w_m_k':ins_k,'fixed_heat_w_m':0.}]}],
        'environment':{'kind':'isolated_cables','background':None,'soil_layers':[],'backfills':[],
            'boundaries':{'surface':{'kind':'temperature','temperature_k':ambient,'h_w_m2_k':None,'emissivity':None}}},
        'provenance':{'source':{'reference':'Hand derivation of radial Fourier/Poisson heat equation; explicit test constants'}},'assumptions':[]})
    cfg=Controls.model_validate({'operation':'temperature','mesh_size_m':.0007,'far_mesh_size_m':.004,
        'mesh_transition_m':.02,'fine_mesh_band_m':.0005,'max_nodes':70000,'tolerance_k':1e-6,
        'max_iterations':40,'relaxation':.8,'current_upper_a':10.,'current_tolerance_a':.01,'rated_circuit':None})
    result,_=solve_thermal(model,cfg)
    expected_peak=ambient+heat/(4*pi*core_k)+heat/(2*pi*ins_k)*log(outer/r)
    expected_mean=ambient+heat/(8*pi*core_k)+heat/(2*pi*ins_k)*log(outer/r)
    state=result['cables'][0]
    assert state['conductor_max_temperature_k']==pytest.approx(expected_peak,abs=.005)
    assert state['conductor_mean_temperature_k']==pytest.approx(expected_mean,abs=.005)
    assert result['energy_relative_residual']<1e-6
    assert result['boundary_heat_w_m']==pytest.approx(heat,abs=1e-6)


def test_converged_pair_retains_independent_iec_check_and_far_domain_evidence():
    from cablesim_hybrid_rating.labels import calculate
    case=prepare_module().base_case()
    c=case['input']['cable_types'][0]['cores'][0]['conductor']
    c.update(nominal_area=.00024,diameter=.0185,r20=7.54e-5)
    first=calculate(case['input'],case['parameters'])
    assert first['valid'] and first['convergence']['mesh_status']=='converged'
    assert first['hybrid']['iec']['verification']['passed']
    from cablesim_hybrid_rating.comparison import present
    comparison=present(first,case['input'],case['parameters'])
    assert comparison['valid'] and comparison['authority']=='reference_only'
    assert comparison['methods'][1]['ampacity_a']==first['hybrid']['fem']['ampacity_a']
    assert comparison['methods'][1]['temperature_difference_k']==pytest.approx(first['hybrid']['fem']['temperature_k']-first['hybrid']['baseline']['temperature_k'])
    case['parameters']['bounds_m']=[-30.,-30.,30.,0.]
    case['parameters']['controls']['far_mesh_size_m']*=2
    case['parameters']['controls']['mesh_transition_m']*=2
    second=calculate(case['input'],case['parameters'])
    amp_change=abs(first['hybrid']['fem']['ampacity_a']-second['hybrid']['fem']['ampacity_a'])
    temp_change=abs(first['hybrid']['fem']['temperature_k']-second['hybrid']['fem']['temperature_k'])
    evidence={'small':first,'large':second,'ampacity_change_a':amp_change,'temperature_change_k':temp_change,
              'scope':'one 240 mm2 declared structure; doubled domain with matched near-field gradient; not every training sample'}
    path=Path('artifacts/hybrid-domain.json');path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(evidence,ensure_ascii=False,allow_nan=False),encoding='utf-8')
    assert second['valid']
    assert temp_change<=.1 and amp_change<=1.
