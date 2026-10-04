from pathlib import Path
from copy import deepcopy
import json,sys
import pytest
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/src'))
from cablesim_simulation.electrothermal import prepare,solve


def fixture():return json.loads((ROOT/'plugins/cablesim.simulation/src/cases/electrothermal-coaxial.json').read_text('utf-8'))


def test_coupled_constant_conductivity_matches_bessel_heat_integral(tmp_path):
    from scipy.special import jv
    from scipy.integrate import quad
    d=fixture();d['input']['resistivity_laws']['core']['alpha_per_k']=0
    m,mesh=prepare(d['input'],d['parameters']);r=solve(m,mesh,tmp_path)
    a,b,sigma,kc,ki,I,f=.0131,.04,5.96e7,400,.46,655,50
    q=np.sqrt(-1j*2*np.pi*f*4*np.pi*1e-7*sigma)
    def density(radius):return abs(I*q*jv(0,q*radius)/(2*np.pi*a*jv(1,q*a)))**2/sigma
    power=quad(lambda radius:2*np.pi*radius*density(radius),0,a,epsabs=1e-10)[0]
    rise=power*np.log(b/a)/(2*np.pi*ki)+quad(lambda radius:density(radius)*radius*np.log(a/radius)/kc,0,a,epsabs=1e-10)[0]
    assert r['source_heat_w_m']==pytest.approx(power,rel=.0025)
    assert r['maximum_temperature_k']-293.15==pytest.approx(rise,abs=.015)
    assert r['iterations'][-1]['transfer_relative_error']<1e-8
    assert r['iterations'][-1]['energy_relative_residual']<1e-5


def test_coupled_feedback_increases_resistive_heat_and_refuses_range(tmp_path):
    d=fixture();m,mesh=prepare(d['input'],d['parameters']);r=solve(m,mesh,tmp_path/'normal')
    assert 298<r['maximum_temperature_k']<300
    assert r['source_heat_w_m']>14.5
    assert len(r['iterations'])>3
    assert r['iterations'][-1]['temperature_update_inf_k']<=m.temperature_tolerance_k
    d['input']['resistivity_laws']['core']['maximum_temperature_k']=294
    m,mesh=prepare(d['input'],d['parameters'])
    with pytest.raises(ValueError,match='resistivity_laws.core'):solve(m,mesh,tmp_path/'invalid')


def test_coupled_refuses_incomplete_law_and_nonconvergence(tmp_path):
    d=fixture();d['input']['resistivity_laws']={}
    with pytest.raises(ValueError):prepare(d['input'],d['parameters'])
    d=fixture();d['input']['maximum_iterations']=2
    m,mesh=prepare(d['input'],d['parameters'])
    with pytest.raises(ValueError,match='maximum_iterations'):solve(m,mesh,tmp_path)


def test_zero_current_accepts_roundoff_without_fabricated_relative_balance(tmp_path):
    d=fixture();d['input']['magnetic']['excitations'][0]['value']=[0,0]
    m,mesh=prepare(d['input'],d['parameters']);r=solve(m,mesh,tmp_path)
    assert r['source_heat_w_m']==pytest.approx(0,abs=1e-15)
    assert np.max(np.abs(np.asarray(r['temperature_k'])-293.15))<1e-8
    assert r['iterations'][-1]['energy_absolute_residual_w_m']<1e-8
    assert r['iterations'][-1]['energy_relative_residual'] is None
