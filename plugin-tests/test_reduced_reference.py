"""Historical reduced methods: independent hand mathematics retained during pruning.

These are reference regressions, not selectable engineering capabilities. Solver
checks run through the native Slurm gate together with the other numerical tests.
"""
from math import pi, sqrt
import numpy as np
import pytest
from backend.schemas import Cable, Scenario
from cablesim_thermal_network.reference_vertical import Vertical, VerticalNetwork, vertical_study
from cablesim_thermal_network.reference_fields import poisson, compute_fields


def test_vertical_zero_current_uniform_no_dielectric():
    state=VerticalNetwork(Cable(tan_delta=0),Vertical(ambient_bottom_c=25,ambient_top_c=25,cells=20)).state(0)
    assert max(abs(np.array(state['conductor_c'])-25))<1e-8
    assert state['single_cable_loss_w']==0


@pytest.mark.parametrize('screen,dielectric',[(0,0),(.15,.0004)])
def test_uniform_air_exact_closed_form_including_all_losses(screen,dielectric):
    c=Cable(tan_delta=dielectric,screen_loss_factor=screen)
    v=Vertical(ambient_bottom_c=25,ambient_top_c=25,emissivity=0,cells=20)
    n=VerticalNetwork(c,v);external=1/(pi*n.diameter*v.h_w_m2k)
    thermal=sum(n.t)+screen*n.t[-1]+(1+screen)*external
    dielectric_r=n.t[1]+n.t[2]+external
    expected=sqrt((c.max_temperature_c-25-n.wd*dielectric_r)/(n.r*(1+n.alpha*(c.max_temperature_c-20))*thermal))
    rated,state=n.rating()
    assert rated==pytest.approx(expected,rel=1e-7)
    assert np.ptp(state['conductor_c'])<1e-8
    assert state['balance_error_w']<1e-5


def test_axial_balance_refinement_hotspot():
    a=vertical_study(Cable(),Vertical(cells=20),350)
    b=vertical_study(Cable(),Vertical(cells=80),350)
    assert a['ampacity_a']==pytest.approx(b['ampacity_a'],rel=.008)
    assert b['operating']['balance_error_w']<1e-4
    assert b['operating']['hotspot_height_m']>15
    assert b['operating']['max_node_residual_w_m']<1e-6


def test_air_heat_transfer_monotonic_and_overload_rejection():
    low=VerticalNetwork(Cable(),Vertical(cells=20,h_w_m2k=4)).rating()[0]
    high=VerticalNetwork(Cable(),Vertical(cells=20,h_w_m2k=12)).rating()[0]
    assert high>low
    r=vertical_study(Cable(),Vertical(cells=20),3000)
    assert r['operating'] is None and r['operating_error']


def test_poisson_manufactured_quadratic_and_energy_balance():
    n=25;xs=ys=np.linspace(0,1,n);xx,yy=np.meshgrid(xs,ys)
    exact=xx*(1-xx)+yy*(1-yy)
    sol,d=poisson(exact,np.full_like(exact,4),1/(n-1),1/(n-1),1)
    assert np.max(abs(exact-sol))<1e-12
    assert d['energy_error_w_m']<1e-10


def test_thermal_fd_grid_refinement_and_boundary():
    s=Scenario();out=compute_fields(s,'thermal_fd',129);d=out['diagnostics']
    assert d['energy_error_w_m']<1e-7
    assert d['linear_residual']<1e-6
    assert d['reference_rmse_k']<d['coarse_reference_rmse_k']
    assert np.max(abs(np.array(out['values'][0],dtype=float)-s.installation.ambient_temperature_c))<1e-10
    assert any(v is None for row in out['values'] for v in row)


def test_electric_integral_and_voltage_scaling():
    s=Scenario();out=compute_fields(s,'electric');d=out['diagnostics']
    assert d['voltage_integral_kv']==pytest.approx(s.cable.u0_kv,rel=1e-6)
    assert d['max_field_kv_mm_rms']>d['min_field_kv_mm_rms']
    s.cable.u0_kv=6;second=compute_fields(s,'electric')
    assert second['diagnostics']['max_field_kv_mm_rms']==pytest.approx(d['max_field_kv_mm_rms']/2)


def test_magnetic_zero_and_current_scaling():
    s=Scenario();s.operating_current_a=0
    assert compute_fields(s,'magnetic')['range']==[0,0]
    s.operating_current_a=100;one=compute_fields(s,'magnetic')
    s.operating_current_a=200;two=compute_fields(s,'magnetic')
    assert two['range'][1]==pytest.approx(one['range'][1]*2)
