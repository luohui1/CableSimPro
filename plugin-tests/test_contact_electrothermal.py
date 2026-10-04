"""Real GetDP impressed-source and coupled contact checks against hand solutions."""
from pathlib import Path
import sys
import numpy as np
import pytest
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'plugins/cablesim.simulation/src')]
from backend.foundation.simulation import validate
from backend.foundation.contact_electrothermal import ContactElectrothermal
from cablesim_simulation.problem_mesh import build
from cablesim_simulation.solver_runtime import environment,EnvironmentMissing


def cylinder():
    return {'schema_version':'cablesim.simulation-problem/1','physics':'magnetic_harmonic',
        'geometry':[{'uid':'outside','kind':'disk','values':[0,0,.02],'material':{'conductivity_s_m':0.,'relative_permeability':1.,'source':'hand solution'}},
                    {'uid':'source','kind':'disk','values':[0,0,.01],'material':{'conductivity_s_m':0.,'relative_permeability':1.,'source':'uniform prescribed current'}}],
        'boundaries':[{'uid':'outer','selector':'outer','values':[],'kind':'magnetic_potential','value':0.}],
        'excitations':[{'regions':['source'],'kind':'impressed_current_rms_a','value':[100.,0.],'source':'RMS hand solution'}],
        'frequency_hz':50.,'probes_m':[[.015,0]],'provenance':{'reference':'Ampere law in concentric circles'},'assumptions':[]}


def require(tmp_path):
    try:environment('getdp',tmp_path)
    except EnvironmentMissing as exc:pytest.skip(str(exc))


def test_uniform_impressed_source_matches_ampere_law(tmp_path):
    require(tmp_path)
    from cablesim_simulation.getdp_adapter import solve
    p,c=validate(cylinder(),{'size_m':.001,'far_size_m':.002,'transition_m':.01,'minimum_circle_segments':128,'field_order':2})
    mesh=build(p,c);result=solve(p.model_dump(mode='json'),mesh,tmp_path/'source')
    assert result['probes'][0]['b_rms_t']==pytest.approx(2e-7*100/.015,rel=.003)
    assert result['regions']==[]
    assert result['impressed_currents'][0]['current_complex_rms_a']==[100.,0.]


def contact_case(size=.001,segments=128):
    from cablesim_simulation.report import digest
    p,c=validate(cylinder(),{'size_m':size,'far_size_m':.002,'transition_m':.01,'minimum_circle_segments':segments,'field_order':1})
    mesh=build(p,c);t=np.array(mesh['triangles']);ids=np.array(mesh['domain_ids']);edges={}
    for i,tri in enumerate(t):
        for a,b in [(tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])]:edges.setdefault(tuple(sorted((a,b))),[]).append(i)
    contacts=[tuple(map(int,edge)) for edge,owners in edges.items() if len(owners)==2 and ids[owners[0]]!=ids[owners[1]]]
    provenance={'reference':'Independent radial conduction/contact/R(T) hand calculation','sha256':digest(p.model_dump(mode='json'))}
    value={'schema_version':'cablesim.contact-electrothermal-field/1','mesh':{k:mesh[k] for k in ('length_unit','points','triangles','domain_ids')},
           'thermal_conductivity':{str(d):{'coefficients_w_m_k':[k],'minimum_temperature_k':273.15,'maximum_temperature_k':373.15,'source':'hand solution'} for d,k in [(1,.2),(2,400.)]},
           'heat_w_m3':[0.]*len(t),'heat_source':provenance,'contact_edges':contacts,'contact_conductance_w_m2k':[100.]*len(contacts),
           'contact_source':'h=100 W/(m2 K), exact radial resistance','temperature_nodes':sorted({v for a,b,_,_ in mesh['boundary_edges'] for v in (a,b)}),
           'ambient_k':293.15,'boundary_source':'Outer circle20C','frequency_hz':50.,'magnetic_domain_ids':[1,2],
           'magnetic_materials':{str(d):{'conductivity_s_m':0.,'relative_permeability':1.,'alpha_per_k':0.,'reference_temperature_k':293.15,'minimum_temperature_k':273.15,'maximum_temperature_k':373.15,'source':'nonconducting field domain'} for d in (1,2)},
           'excitations':[{'regions':['domain/2'],'kind':'impressed_current_rms_a','value':[100.,0.],'source':'100 A RMS'}],
           'magnetic_boundary_source':'concentric A=0 boundary','port_resistance':{'domain_ids':[2],'resistance_reference_ohm_m':.001,'alpha_per_k':.004,
                'reference_temperature_k':293.15,'minimum_temperature_k':273.15,'maximum_temperature_k':373.15,'source':'declared resistor law','scope':'mean_terminal_resistance_including_passive_losses'},
           'maximum_iterations':30,'temperature_tolerance_k':1e-5,'power_relative_tolerance':1e-7,'relaxation':1.}
    value['mesh']['source']=provenance
    return value


def test_coupled_contact_temperature_and_power_match_radial_hand_solution(tmp_path):
    require(tmp_path)
    from cablesim_simulation.contact_electrothermal import solve
    value=contact_case()
    result=solve(ContactElectrothermal.model_validate(value),tmp_path/'coupled')
    resistance=np.log(2)/(2*np.pi*.2)+1/(2*np.pi*.01*100)
    mean_resistance=resistance+1/(8*np.pi*400)
    power=10/(1-10*.004*mean_resistance)
    maximum=293.15+power*(resistance+1/(4*np.pi*400))
    assert result['total_heat_w_m']==pytest.approx(power,rel=.001)
    assert result['maximum_temperature_k']==pytest.approx(maximum,abs=.02)
    assert result['thermal']['maximum_contact_jump_k']==pytest.approx(power/(2*np.pi*.01*100),rel=.003)
    assert result['thermal']['relative_energy_error']<1e-8
    assert len(result['iterations'])>2


def test_coupled_contact_is_invariant_to_triangle_orientation(tmp_path):
    require(tmp_path)
    from copy import deepcopy
    from cablesim_simulation.contact_electrothermal import solve
    value=contact_case(.002,64)
    value['magnetic_materials']['1'].update(conductivity_s_m=1e6,alpha_per_k=.003,
        relative_permeability=5.,relative_permeability_loss=1.,source='explicit lossy passive shell')
    value['excitations'].append({'regions':['domain/1'],'kind':'voltage_gradient_v_m','value':[0.,0.],'source':'passive shell'})
    ccw=solve(ContactElectrothermal.model_validate(value),tmp_path/'ccw')
    reversed_value=deepcopy(value)
    reversed_value['mesh']['triangles']=[[a,c,b] for a,b,c in value['mesh']['triangles']]
    clockwise=solve(ContactElectrothermal.model_validate(reversed_value),tmp_path/'clockwise')
    assert ccw['passive_heat_w_m']>0
    for key in ('total_heat_w_m','passive_heat_w_m','maximum_temperature_k'):
        assert clockwise[key]==pytest.approx(ccw[key],rel=1e-9,abs=1e-8)
    np.testing.assert_allclose(clockwise['thermal']['triangle_temperature_k'],
        ccw['thermal']['triangle_temperature_k'],rtol=0,atol=1e-8)
