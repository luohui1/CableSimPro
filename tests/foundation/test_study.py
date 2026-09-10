"""Study preparation is a read-only projection; no numerical solvers are imported."""
from copy import deepcopy
import pytest
from pydantic import ValidationError
from backend.schemas import Scenario
from backend.foundation.contracts import content_hash
from backend.foundation.study import prepare_study


def snapshot():
    return {"id": "fixture.project", "revision": 1, "scenario": Scenario().model_dump(),
            "locks": ["cable.max_temperature_c"], "sources": []}


def test_schema_preparation_contains_real_geometry_and_no_solved_result():
    w = snapshot(); old = deepcopy(w); report = prepare_study(w)
    assert w == old
    assert report.package_sha256 == content_hash(report.package)
    assert report.status == "package_ready"
    assert not report.native_model_built and not report.solver_executed
    assert report.package.asset_lock == ()
    assert len(report.package.geometry_recipe.layers) == 6
    assert report.package.geometry_recipe.layers[-1].outer_radius_m == pytest.approx(Scenario().cable.radii_mm()[-1] / 1000)
    assert report.package.ambient_temperature.value == pytest.approx(298.15)
    assert report.package.conductor_r20 is None
    assert "ampacity_a" not in report.model_dump_json()
    assert "R20_NOT_PROVIDED" in {i.code for i in report.issues}


@pytest.mark.parametrize("target", ["comsol", "aedt"])
def test_unconfigured_native_backend_is_blocked_not_mock_success(target):
    report = prepare_study(snapshot(), target)
    assert report.status == "blocked"
    assert "NATIVE_ADAPTER_NOT_CONFIGURED" in {i.code for i in report.issues}
    assert not report.native_model_built and not report.solver_executed


def test_changed_input_revision_basis_and_sources_change_package_hash():
    original = snapshot(); first = prepare_study(original).package_sha256
    variants = []
    a = deepcopy(original); a["revision"] = 2; variants.append(a)
    a = deepcopy(original); a["scenario"]["cable"]["area_mm2"] = 300; variants.append(a)
    a = deepcopy(original); a["design_basis"] = {"environment": "buried"}; variants.append(a)
    a = deepcopy(original); a["sources"] = [{"title": "reviewed input"}]; variants.append(a)
    assert all(prepare_study(v).package_sha256 != first for v in variants)
    assert prepare_study(original).package_sha256 == first


def test_r20_converted_not_replaced():
    w = snapshot(); w["scenario"]["cable"]["r20_ohm_km"] = .0754
    report = prepare_study(w)
    assert report.package.conductor_r20.value == pytest.approx(.0000754)
    assert "R20_NOT_PROVIDED" not in {i.code for i in report.issues}


def test_invalid_geometry_does_not_fall_back_to_previous_inputs():
    w = snapshot(); w["scenario"]["installation"]["spacing_m"] = .02
    with pytest.raises(ValidationError):
        prepare_study(w)
