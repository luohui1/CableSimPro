"""Controlled TB880 steel-wire SL reference and independent parallel-R hand check."""
from pathlib import Path
import json
import pytest
from cablesim_iec60287.armour import ArmouredRating,armoured_rating,nonmagnetic_equivalent


FIXTURE=Path(__file__).resolve().parents[3]/'.data/tb880/fixtures/tb880-case-2-armour.json'


@pytest.mark.skipif(not FIXTURE.exists(),reason='controlled TB880 Case2 reference not supplied')
def test_tb880_case2_lambda2_thermal_iteration_and_power():
    f=json.loads(FIXTURE.read_text('utf-8'));r=armoured_rating(ArmouredRating.model_validate(f['input']))
    assert r['lambda2']==pytest.approx(f['expected']['lambda2'],abs=1e-8)
    assert r['ampacity_a']==pytest.approx(f['expected']['ampacity_a'],abs=5e-5)
    assert r['armour_temperature_k']==pytest.approx(f['expected']['armour_temperature_k'],abs=1e-5)
    assert r['armour_loss_w_m']==pytest.approx(f['expected']['armour_loss_w_m'],abs=1e-5)
    assert abs(r['history'][-1]['armour_temperature_k']-r['history'][-2]['armour_temperature_k'])<1e-7


def test_nonmagnetic_parallel_resistance_and_rms_diameter_hand_calculation():
    resistance,diameter=nonmagnetic_equivalent(.002,.003,.04,.06)
    assert resistance==pytest.approx(.0012)
    assert diameter**2==pytest.approx(.0026)
    with pytest.raises(ValueError):nonmagnetic_equivalent(0,.003,.04,.06)


@pytest.mark.skipif(not FIXTURE.exists(),reason='controlled TB880 input not supplied')
def test_nonmagnetic_full_thermal_path_and_missing_sources_refused():
    value=json.loads(FIXTURE.read_text('utf-8'))['input']
    with pytest.raises(ValueError,match='非磁性'):armoured_rating(ArmouredRating.model_validate({**value,'armour_kind':'nonmagnetic_parallel'}))
    with pytest.raises(ValueError):ArmouredRating.model_validate({**value,'source_reference':' '})
