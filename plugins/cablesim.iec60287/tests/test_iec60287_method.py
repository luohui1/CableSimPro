"""Public tests on synthetic inputs: physical consistency, monotonic trends and refusals.

The cable below is an invented 12/20 kV-class example, not manufacturer data and not a
standard worked example. Numerical agreement with the standard is established separately
by test_iec60287_tb880.py against licensed fixtures kept outside this repository.
"""
from __future__ import annotations

import json
from copy import deepcopy
from math import isfinite

import pytest
from pydantic import ValidationError

from cablesim_iec60287 import METHOD_ID, Rating, RatingRefused, rate

BASE = {
    'frequency_hz': 50, 'phase_voltage_v': 12000, 'max_conductor_temperature_c': 90,
    'conductor': {'diameter_m': 0.0185, 'r20_ohm_m': 7.54e-5, 'alpha20_per_k': 0.00393, 'ks': 1, 'kp': 1},
    'insulation': {'inner_screen_thickness_m': 0.0006, 'thickness_m': 0.0055, 'outer_screen_thickness_m': 0.0007,
                   'relative_permittivity': 2.5, 'tan_delta': 0.001, 'inner_screen_rho_k_m_w': 2.5,
                   'rho_k_m_w': 3.5, 'outer_screen_rho_k_m_w': 2.5},
    'sheath': {'thickness_m': 0.0008, 'resistivity20_ohm_m': 2.84e-8, 'alpha20_per_k': 0.00403},
    'oversheath': {'thickness_m': 0.0025, 'rho_k_m_w': 3.5},
    'installation': {'environment': 'direct_buried', 'depth_m': 0.8, 'soil_rho_k_m_w': 1.0,
                     'ambient_temperature_c': 20, 't4_form': 'simplified', 'duct': None},
    'bonding': {'scheme': 'both_ends', 'eddy': 'ignored'},
    'solver': {'initial_sheath_temperature_c': 70, 'current_tolerance_a': 1e-8},
}
DUCT = {'outer_diameter_m': 0.075, 'inner_diameter_m': 0.064, 'rho_k_m_w': 3.5, 'u': 1.87, 'v': 0.312,
        'y_per_k': 0.0037, 'initial_mean_air_temperature_c': 60}


def rating(**patch) -> Rating:
    data = deepcopy(BASE)
    for dotted, value in patch.items():
        target = data
        *path, key = dotted.split('__')
        for part in path:
            target = target[part]
        target[key] = value
    return Rating.model_validate(data)


def ducted(**patch) -> Rating:
    return rating(**{'installation__environment': 'buried_ducts', 'installation__t4_form': None,
                     'installation__duct': DUCT, **patch})


@pytest.mark.parametrize('make', [rating, ducted], ids=['direct', 'ducts'])
def test_converged_rating_satisfies_the_thermal_ladder_exactly(make):
    r = make()
    result = rate(r)
    last = result.history[-1]
    wc, wd, lam = last.conductor_loss_w_m, result.electrical.dielectric_loss_w_m, last.loss.total
    t1, t3, t4 = result.t1_k_m_w, result.t3_k_m_w, last.t4_k_m_w
    conductor = (r.installation.ambient_temperature_c + wc * t1 + 0.5 * wd * t1
                 + (wc * (1 + lam) + wd) * (t3 + t4))
    assert conductor == pytest.approx(r.max_conductor_temperature_c, abs=1e-9)
    assert wc == pytest.approx(result.electrical.r_ac_max_ohm_m * result.ampacity_a ** 2, rel=1e-12)
    # Fixed point reached: the sheath temperature used equals the one it produces.
    assert last.next_sheath_temperature_c == pytest.approx(last.sheath_temperature_c, abs=1e-5)
    assert result.method == METHOD_ID and result.converged


def test_result_is_finite_and_json_serialisable():
    data = rate(rating()).as_dict()
    text = json.dumps(data, allow_nan=False)
    assert json.loads(text)['ampacity_a'] > 0

    def walk(value):
        if isinstance(value, float):
            assert isfinite(value)
        elif isinstance(value, dict):
            for v in value.values():
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)
    walk(data)


def test_harsher_environment_lowers_the_rating():
    base = rate(rating()).ampacity_a
    assert rate(rating(installation__soil_rho_k_m_w=2.0)).ampacity_a < base
    assert rate(rating(installation__depth_m=1.5)).ampacity_a < base
    assert rate(rating(installation__ambient_temperature_c=30)).ampacity_a < base
    assert rate(rating(max_conductor_temperature_c=70)).ampacity_a < base


def test_exact_radical_t4_is_smaller_than_the_simplified_form():
    simplified, exact = rate(rating()), rate(rating(installation__t4_form='exact'))
    assert exact.t4_external_k_m_w < simplified.t4_external_k_m_w
    assert exact.ampacity_a > simplified.ampacity_a


def test_sheath_loss_treatments_are_ordered():
    circulating = rate(rating())
    with_eddy = rate(rating(bonding__eddy='trefoil'))
    single_point = rate(rating(bonding__scheme='single_point', bonding__eddy='trefoil'))
    assert with_eddy.history[-1].loss.eddy_factor_f is not None
    assert 0 < with_eddy.history[-1].loss.eddy_factor_f < 1
    assert with_eddy.ampacity_a < circulating.ampacity_a
    assert single_point.history[-1].loss.circulating == 0
    assert single_point.ampacity_a > circulating.ampacity_a


def test_no_dielectric_loss_without_tan_delta():
    result = rate(rating(insulation__tan_delta=0))
    assert result.electrical.dielectric_loss_w_m == 0
    assert result.ampacity_a > rate(rating()).ampacity_a


def test_ducts_add_air_gap_and_wall_resistance():
    direct, duct = rate(rating()), rate(ducted())
    last = duct.history[-1]
    assert duct.t3_multiplier == 1.0 and direct.t3_multiplier == 1.6
    assert last.t4_air_gap_k_m_w > 0 and duct.t4_duct_wall_k_m_w > 0
    assert last.t4_k_m_w == pytest.approx(last.t4_air_gap_k_m_w + duct.t4_duct_wall_k_m_w + duct.t4_external_k_m_w)
    assert last.next_duct_air_temperature_c < last.cable_surface_temperature_c


@pytest.mark.parametrize('patch,code', [
    ({'conductor__r20_ohm_m': 2e-6}, 'SKIN_PROXIMITY_OUT_OF_RANGE'),
    ({'installation__depth_m': 0.03}, 'DEPTH_TOO_SMALL'),
    ({'insulation__tan_delta': 0.1, 'phase_voltage_v': 400000}, 'NO_POSITIVE_RATING'),
    ({'solver__max_iterations': 1}, 'NOT_CONVERGED'),
])
def test_out_of_scope_or_unsolvable_inputs_are_refused(patch, code):
    with pytest.raises(RatingRefused) as refused:
        rate(rating(**patch))
    assert refused.value.code == code


def test_cable_that_does_not_fit_the_duct_is_refused():
    with pytest.raises(RatingRefused) as refused:
        rate(ducted(installation__duct={**DUCT, 'inner_diameter_m': 0.03}))
    assert refused.value.code == 'CABLE_DOES_NOT_FIT_DUCT'


@pytest.mark.parametrize('patch', [
    {'installation__t4_form': None},
    {'installation__duct': DUCT},
    {'bonding__scheme': 'single_point'},
    {'installation__ambient_temperature_c': 90},
    {'sheath__geometry': 'corrugated'},
    {'conductor__construction': 'milliken'},
    {'conductor__unexpected': 1},
])
def test_invalid_or_unsupported_inputs_fail_validation(patch):
    with pytest.raises(ValidationError):
        rating(**patch)


def test_physical_data_has_no_defaults():
    data = deepcopy(BASE)
    del data['conductor']['r20_ohm_m']
    with pytest.raises(ValidationError):
        Rating.model_validate(data)
    data = deepcopy(BASE)
    del data['conductor']['ks']
    with pytest.raises(ValidationError):
        Rating.model_validate(data)
