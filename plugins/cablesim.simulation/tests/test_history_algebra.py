"""Independent heat-kernel quadrature; pure algebra, no local FEM/meshing."""
from math import exp,expm1,pi
from pathlib import Path
import sys
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from cablesim_simulation.three_core_history import history_rise


def test_signed_preloaded_history_against_heat_kernel_integral():
    from scipy.integrate import quad
    # Explicit method validation parameters, not material data or an IEC example.
    k=1.2;capacity=2e6;alpha=k/capacity;t=7200.;point=(.3,-.8);source=(0.,-1.)
    real=(point[0]-source[0])**2+(point[1]-source[1])**2
    mirror=(point[0]-source[0])**2+(point[1]+source[1])**2
    def kernel(age):
        if age==0:return 0.
        return (exp(-real/(4*alpha*age))-exp(-mirror/(4*alpha*age)))/(4*pi*k*age)
    # Heat is 3 W/m before t=0, 8 W/m until 1500 s, 1 W/m until
    # 3600 s, then zero. Integrate absolute heat in independent age intervals.
    # age=t/u maps the infinite prehistory to [0,1]; direct infinite
    # quadrature here loses precision and emits IntegrationWarning.
    ar=real/(4*alpha*t);am=mirror/(4*alpha*t)
    def prehistory(u):
        if u==0:return (am-ar)/(4*pi*k)
        return exp(-ar*u)*(-expm1(-(am-ar)*u))/(4*pi*k*u)
    expected=3*quad(prehistory,0.,1.,epsabs=1e-10)[0]
    expected+=8*quad(kernel,t-1500,t,epsabs=1e-10)[0]
    expected+=quad(kernel,t-3600,t-1500,epsabs=1e-10)[0]
    row=lambda power:dict(center_m=list(source),loss_w_m=power)
    actual=history_rise([[point[0]],[point[1]]],[row(3.)],[(0.,[row(5.)]),(1500.,[row(-7.)]),(3600.,[row(-1.)])],k,capacity,t)[0]
    assert actual==pytest.approx(expected,rel=1e-9,abs=1e-10)


def test_native_history_refuses_local_execution_before_mesh():
    # Real entry guard, not a fabricated numerical result or solver substitute.
    import os
    if os.environ.get('SLURM_JOB_ID'):pytest.skip('This check is for a non-Slurm host')
    from cablesim_simulation.three_core_history import ResolvedHistory
    with pytest.raises(ValueError,match='Slurm'):ResolvedHistory(None,{})
