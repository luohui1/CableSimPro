"""Slurm physical pilots, checked against published/hand analytical limits."""
from pathlib import Path
import sys
import pytest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/validation'))
from iec_edge_pilots import run,crossing_rating,crossing_field


def test_drying_and_crossing_small_pilots():
    output=run()
    assert output['drying']['distribution']['valid']==27
    assert output['crossing']['distribution']['valid']==12
    assert max(abs(r['iec_over_fem_percent']) for r in output['drying']['rows'])<.5
    assert all(r['fem']['balance_residual_k']<1e-8 for r in output['drying']['rows'])
    # IEC Annex A Table A.2 reports DF=0.89 and crossing rise=14.1 K.
    row=next(r for r in output['crossing']['infinite_source_controls'] if r['angle_deg']==90)
    assert row['iec']['derating_factor']==pytest.approx(.89,abs=.006)
    assert row['iec']['crossing_rise_k']==pytest.approx(14.1,abs=.3)
    assert max(abs(r['difference_percent']) for r in output['crossing']['infinite_source_controls'])<.05
    assert max(r['quasi3d']['equation_residual'] for r in output['crossing']['rows'])<1e-8


def test_crossing_green_segment_converges_to_iec_half_space():
    import numpy as np
    z=np.array([-4.,-1.,0.,1.,4.])
    args=(z,1.2,.9,.7,77.7,.8)
    exact=crossing_field(*args)
    finite=crossing_field(*args,length=10000.)
    assert np.max(abs(finite-exact))<1e-6
    assert np.max(abs(finite-finite[::-1]))<1e-10
