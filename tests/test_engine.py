"""Mathematical/property tests are not third-party IEC compliance validation."""
import math

import numpy as np
import pytest
from pydantic import ValidationError

from backend.engine import ModelError, ThermalNetwork, calculate
from backend.schemas import Scenario


def modified(**installation):
    p = Scenario().model_dump()
    p["installation"].update(installation)
    return Scenario.model_validate(p)


def test_geometry_area_changes_both_radius_and_resistance():
    a = Scenario()
    b = a.model_copy(deep=True)
    b.cable.area_mm2 = 480
    x, y = ThermalNetwork(a), ThermalNetwork(b)
    assert y.r20 == pytest.approx(x.r20 / 2)
    assert y.radii[0] == pytest.approx(x.radii[0] * math.sqrt(2))


def test_manual_radial_thermal_resistance():
    n = ThermalNetwork(Scenario())
    r = n.s.cable.radii_mm()
    expected = 3.5 / (2 * math.pi) * math.log(r[2] / r[1])
    assert n.t[1] == pytest.approx(expected, rel=1e-12)


def test_manual_self_and_mutual_soil_resistance():
    n = ThermalNetwork(Scenario())
    h, s, rho, r = 0.8, 0.12, 1.2, n.radii[-1]
    assert n.g[0, 0] == pytest.approx(rho / (2 * math.pi) * math.log(h / r + math.sqrt((h / r) ** 2 - 1)))
    assert n.g[0, 1] == pytest.approx(rho / (4 * math.pi) * math.log(1 + 4 * h * h / (s * s)))
    assert np.allclose(n.g, n.g.T)
    assert min(np.linalg.eigvalsh(n.g)) > 0


def test_zero_alpha_matches_closed_form_rating():
    n = ThermalNetwork(Scenario())
    n.alpha = 0
    # Independent no-feedback heat balance: theta_i = ambient + I² R sum(H_i) + d_i.
    expected = np.sqrt((90 - 25 - n.d) / (n.r20ac * np.sum(n.h, axis=1)))
    current = float(min(expected))
    assert max(n.temperatures(current)) == pytest.approx(90, abs=1e-10)


def test_ampacity_round_trip_and_limiting_phase():
    n = ThermalNetwork(Scenario())
    current = n.ampacity()
    assert 100 < current < 1000
    assert max(n.temperatures(current)) == pytest.approx(90, abs=1e-8)
    assert int(np.argmax(n.temperatures(current))) == 1
    assert n.temperatures(current)[0] == pytest.approx(n.temperatures(current)[2])


def test_temperature_and_radial_energy_balance():
    n = ThermalNetwork(Scenario())
    state = n.state(350)
    assert state["residual_k"] < 1e-9
    for phase, outside in zip(state["radial_profiles"], state["surface_temperatures_c"]):
        points = phase["points"]
        assert points[-1]["temperature_c"] == pytest.approx(outside, abs=1e-9)
        assert all(a["temperature_c"] >= b["temperature_c"] for a, b in zip(points, points[1:]))
    total = np.array(state["conductor_losses_w_m"]) + state["screen_losses_w_m"] + n.wd
    assert state["total_losses_w_m"] == pytest.approx(total)


@pytest.mark.parametrize("changes", [{"ambient_temperature_c": 35}, {"soil_rho_k_m_w": 2.0}, {"depth_m": 1.2}])
def test_harsher_environment_reduces_rating(changes):
    assert ThermalNetwork(modified(**changes)).ampacity() < ThermalNetwork(Scenario()).ampacity()


def test_wider_spacing_increases_rating():
    assert ThermalNetwork(modified(spacing_m=0.3)).ampacity() > ThermalNetwork(Scenario()).ampacity()


def test_trefoil_is_valid_and_symmetric_lower_phases():
    n = ThermalNetwork(modified(arrangement="trefoil"))
    temperatures = n.temperatures(n.ampacity())
    assert temperatures[1] == pytest.approx(temperatures[2])
    assert max(temperatures) == pytest.approx(90)


def test_zero_current_and_no_dielectric_loss_are_ambient():
    s = Scenario()
    s.cable.tan_delta = 0
    assert ThermalNetwork(s).temperatures(0) == pytest.approx([25, 25, 25])


def test_loss_factors_reduce_ampacity():
    base = ThermalNetwork(Scenario()).ampacity()
    for key in ["ac_extra_factor", "screen_loss_factor", "tan_delta"]:
        s = Scenario()
        setattr(s.cable, key, 0.01 if key == "tan_delta" else 0.3)
        assert ThermalNetwork(s).ampacity() < base


def test_explicit_resistance_override_is_respected():
    s = Scenario()
    s.cable.r20_ohm_km = 0.09
    assert ThermalNetwork(s).r20 == pytest.approx(0.00009)


def test_unstable_load_is_reported_without_losing_rating():
    s = Scenario()
    s.operating_current_a = 3000
    r = calculate(s, include_field=False)
    assert r["operating"] is None
    assert r["operating_error"]
    assert r["summary"]["ampacity_a"] > 0
    assert r["summary"]["thermal_margin_c"] is None


def test_field_surface_boundary_and_no_nonfinite_output():
    r = calculate(Scenario())
    assert r["field"]["temperature_c"][0] == pytest.approx([25] * 81)
    import json
    assert "NaN" not in json.dumps(r, allow_nan=False)


def test_reproducible_hash_and_input_snapshot():
    a, b = calculate(Scenario(), False), calculate(Scenario(), False)
    assert a["input_sha256"] == b["input_sha256"]
    assert a["summary"] == b["summary"]
    assert len(a["input_sha256"]) == 64


@pytest.mark.parametrize("section,key,value", [
    ("cable", "area_mm2", 0), ("cable", "area_mm2", float("nan")),
    ("cable", "insulation_mm", -1), ("cable", "r20_ohm_km", 0),
    ("installation", "soil_rho_k_m_w", 0), ("installation", "spacing_m", 0.02),
    ("installation", "depth_m", 0.01), ("installation", "arrangement", "duct"),
])
def test_invalid_inputs_rejected(section, key, value):
    p = Scenario().model_dump()
    p[section][key] = value
    with pytest.raises(ValidationError):
        Scenario.model_validate(p)


def test_trefoil_cannot_cross_ground():
    with pytest.raises(ValidationError):
        modified(arrangement="trefoil", depth_m=0.2, spacing_m=0.5)


def test_invalid_solver_current_rejected():
    n = ThermalNetwork(Scenario())
    with pytest.raises(ModelError):
        n.temperatures(-1)
