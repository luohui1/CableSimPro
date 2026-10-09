"""Lightweight standard/algebra checks; no OCCT import or native execution."""
import importlib.util
import math
from pathlib import Path
import pytest


def module(path):
    spec=importlib.util.spec_from_file_location('proposal_test',Path(__file__).resolve().parents[1]/path)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


def test_equal_area_solid_round_and_three_core_distance_hand_calculation():
    geometry=module('plugins/cablesim.cable-geometry/src/cablesim_cable_geometry/proposal.py')
    area=70e-6;t=.0011;gap=.002
    result=geometry.propose({'area_m2':area,'thickness_m':t,'construction':'three_core','form':'solid_round','gap_m':gap})
    values={v['path']:v['value'] for v in result['changes']}
    diameter=2*math.sqrt(area/math.pi)
    assert values['/cable_types/0/cores/0/conductor/diameter']==pytest.approx(diameter)
    x0,z0=(values[f'/cable_types/0/cores/0/{axis}'] for axis in ('x','z'))
    x1,z1=(values[f'/cable_types/0/cores/1/{axis}'] for axis in ('x','z'))
    assert math.hypot(x0-x1,z0-z1)==pytest.approx(diameter+2*t+gap)
    with pytest.raises(ValueError): geometry.propose({'area_m2':area,'thickness_m':t,'construction':'three_core','form':'solid_round'})
    with pytest.raises(ValueError): geometry.propose({'area_m2':area,'thickness_m':t,'construction':'single_core','form':'unspecified','diameter_m':.001})


def test_gbt12706_1_table7_and_gbt11017_2_table2_no_interpolation():
    standard=module('plugins/cablesim.standard-check/src/cablesim_standard_check/main.py')
    assert standard.insulation_limit('mv1',600,70,'XLPE')==1.1
    assert standard.insulation_limit('hv',64000,800,'XLPE')==16.0
    assert standard.insulation_limit('hv',64000,801,'XLPE') is None
