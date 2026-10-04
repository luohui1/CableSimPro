from pathlib import Path
import json,sys,math
import pytest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/src'))
from cablesim_simulation.capacitive import prepare,solve,EPS0


def fixture():return json.loads((ROOT/'plugins/cablesim.simulation/src/cases/capacitive-submarine.json').read_text('utf-8'))


@pytest.mark.parametrize('bonding,power,voltage',[('single_point',1500,83),('both_ends',380,21),('cross_bonded',85,6.9)])
def test_axisymmetric_charging_matches_published_bonding(bonding,power,voltage):
    d=fixture();v=d['input'];v['bonding']=bonding
    if bonding=='cross_bonded':v.update(section_fractions=[1/3]*3,section_phase_rad=[0,-2*math.pi/3,2*math.pi/3])
    m,c=prepare(v,d['parameters']);mesh,result=solve(m,c)
    assert result['regions'][-1]['joule_loss_w']==pytest.approx(power,rel=.025)
    assert result['sheath_maximum_nodal_voltage_peak_v']==pytest.approx(voltage,rel=.02)
    assert result['current_kcl_relative_error']<2e-5
    assert result['weak_residual_relative_error']<2e-5
    assert len(result['voltage_complex_peak_v'])==len(mesh['points'])


def test_radial_displacement_current_matches_independent_complex_impedance():
    d=fixture();v=d['input'];v.update(bonding='radial_ground',length_m=1,axial_coordinate_scale=100,axial_voltage_drop_peak_v_m=0)
    v['layers'][-1].update(conductivity_radial_s_m=5,conductivity_axial_s_m=5)
    m,c=prepare(v,d['parameters']);_,result=solve(m,c)
    radii=[m.inner_radius_m]+[l.outer_radius_m for l in m.layers];omega=2*math.pi*m.frequency_hz
    impedance=sum(math.log(b/a)/(2*math.pi*(l.conductivity_radial_s_m+1j*omega*EPS0*l.relative_permittivity)) for a,b,l in zip(radii,radii[1:],m.layers))
    expected=m.voltage_peak_v/impedance
    assert complex(*result['phase_currents_peak_a'][0]).imag==pytest.approx(expected.imag,rel=.002)
    assert result['capacitance_f_m']==pytest.approx((1/impedance).imag/omega,rel=.002)


def test_capacitive_requires_phases_and_rejects_unordered_layers():
    d=fixture();d['input']['bonding']='cross_bonded'
    with pytest.raises(ValueError,match='section_fractions'):prepare(d['input'],d['parameters'])
    d=fixture();d['input']['layers'][1]['outer_radius_m']=.01
    with pytest.raises(ValueError,match='outer_radius_m'):prepare(d['input'],d['parameters'])


def test_capacitive_mesh_budget_fails_before_large_allocation():
    from cablesim_simulation.capacitive import build
    d=fixture();d['parameters']['mesh'].update(radial_elements_per_layer=100,axial_elements_per_section=2000,max_nodes=60000)
    m,c=prepare(d['input'],d['parameters'])
    with pytest.raises(ValueError,match='mesh.max_nodes'):build(m,c)
