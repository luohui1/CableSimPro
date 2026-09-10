"""Negative fixtures and independent arithmetic checks; no native solver used."""
from hashlib import sha256
import pytest
from pydantic import ValidationError
from backend.foundation.contracts import (
    AssetParameter, AssetRef, AssetRelease, CircularLayer, CircularRecipe,
    PayloadFile, Quantity, SourceReference, apply_instance_overrides,
    content_hash, resolve_asset_lock, verify_payloads,
)


def material(**kw):
    return AssetRelease(asset_id="material.xlpe", version="1.0.0", kind="material",
                        name="Test material; not manufacturer data",
                        sources=(SourceReference(kind="project_input", reference="fixture", reviewed=False),), **kw)


@pytest.mark.parametrize("unit,dimension,value,expected,si", [
    ("mm", "length", 25.0, .025, "m"),
    ("mm2", "area", 240.0, .000240, "m2"),
    ("ohm/km", "linear_resistance", .0754, .0000754, "ohm/m"),
    ("degC", "absolute_temperature", 25.0, 298.15, "K"),
    ("delta_degC", "temperature_difference", 25.0, 25.0, "delta_K"),
])
def test_explicit_si_conversion(unit, dimension, value, expected, si):
    q = Quantity(value=value, unit=unit, dimension=dimension).si()
    assert q.value == pytest.approx(expected) and q.unit == si
    assert q.si() == q


@pytest.mark.parametrize("value", [True, "25", float("nan"), float("inf"), -float("inf")])
def test_non_numeric_and_nonfinite_rejected(value):
    with pytest.raises(ValidationError):
        Quantity(value=value, unit="m", dimension="length")


def test_absolute_temperature_is_not_temperature_difference():
    with pytest.raises(ValidationError):
        Quantity(value=25.0, unit="degC", dimension="temperature_difference")
    with pytest.raises(ValidationError):
        Quantity(value=-274.0, unit="degC", dimension="absolute_temperature")


def test_thermal_resistivity_is_not_conductivity():
    with pytest.raises(ValidationError):
        Quantity(value=3.5, unit="K.m/W", dimension="thermal_conductivity")


@pytest.mark.parametrize("path", ["../x", "/x", "x/../y", "x\\y", "C:/x", "./x", "a//b", "a\0b", "foo./x", ".", "NUL", "con.txt", "a/COM1.x", "a?b", "a\nb"])
def test_package_path_is_confined(path):
    with pytest.raises(ValidationError):
        PayloadFile(path=path, sha256="a" * 64, size_bytes=0)


def test_file_integrity_and_complete_file_set():
    data = b"reviewed fixture bytes"
    release = material(files=(PayloadFile(path="payload/source.txt", sha256=sha256(data).hexdigest(), size_bytes=len(data)),))
    verify_payloads(release, {"payload/source.txt": data})
    for payloads in ({}, {"payload/source.txt": b"tampered"}, {"payload/source.txt": data, "extra": b"x"}):
        with pytest.raises(ValueError):
            verify_payloads(release, payloads)


def test_exact_version_lock_and_hash():
    a = material()
    b = AssetRelease(asset_id="cable.example", version="1.0.0", kind="assembly", name="fixture",
                     sources=a.sources, dependencies=(a.reference(),))
    lock = resolve_asset_lock((b.reference(),), (b, a))
    assert set(lock) == {a.reference(), b.reference()}
    with pytest.raises(ValueError, match="MISSING"):
        resolve_asset_lock((b.reference(),), (b,))
    bad = AssetRef(asset_id=a.asset_id, version=a.version, content_sha256="b" * 64)
    with pytest.raises(ValueError, match="DIGEST"):
        resolve_asset_lock((bad,), (a,))


def test_duplicate_versions_and_roots_rejected():
    a = material()
    with pytest.raises(ValueError, match="DUPLICATE_ASSET_VERSION"):
        resolve_asset_lock((a.reference(),), (a, a))
    with pytest.raises(ValueError, match="DUPLICATE_ASSET_ROOT"):
        resolve_asset_lock((a.reference(), a.reference()), (a,))


def test_dependency_cycle_rejected_before_any_release_can_be_accepted():
    a_ref = AssetRef(asset_id="a", version="1.0.0", content_sha256="a" * 64)
    b_ref = AssetRef(asset_id="b", version="1.0.0", content_sha256="b" * 64)
    src = material().sources
    a = AssetRelease(asset_id="a", version="1.0.0", kind="assembly", name="a", sources=src, dependencies=(b_ref,))
    b = AssetRelease(asset_id="b", version="1.0.0", kind="assembly", name="b", sources=src, dependencies=(a_ref,))
    with pytest.raises(ValueError, match="CYCLE"):
        resolve_asset_lock((a.reference(),), (a, b))


def test_instance_override_does_not_mutate_release_or_reference():
    original = AssetParameter(name="thickness", quantity=Quantity(value=5.0, unit="mm", dimension="length"), overridable=True)
    release = material(parameters=(original,))
    ref = release.reference()
    replacement = AssetParameter(name="thickness", quantity=Quantity(value=6.0, unit="mm", dimension="length"))
    result = apply_instance_overrides(release, (replacement,))
    assert result[0].quantity.value == pytest.approx(.006)
    assert release.parameters == (original,) and release.reference() == ref
    with pytest.raises(ValidationError):
        release.name = "mutated"


def test_unknown_fixed_and_dimension_changing_override_rejected():
    a = material(parameters=(AssetParameter(name="x", quantity=Quantity(value=1.0, unit="m", dimension="length")),))
    q = AssetParameter(name="x", quantity=Quantity(value=1.0, unit="m", dimension="length"))
    with pytest.raises(ValueError, match="NOT_OVERRIDABLE"):
        apply_instance_overrides(a, (q,))
    a = material(parameters=(AssetParameter(name="x", quantity=q.quantity, overridable=True),))
    bad = AssetParameter(name="x", quantity=Quantity(value=1.0, unit="A", dimension="current"))
    with pytest.raises(ValueError, match="DIMENSION"):
        apply_instance_overrides(a, (bad,))


def test_hash_ignores_object_key_order_not_content_or_array_order():
    assert content_hash({"b": 2, "a": 1}) == content_hash({"a": 1, "b": 2})
    assert content_hash([1, 2]) != content_hash([2, 1])
    for value in ({1: "a"}, {"a": float("nan")}, {"a": object()}):
        with pytest.raises((ValueError, TypeError)):
            content_hash(value)


def test_circular_recipe_gap_overlap_and_duplicate_uid_rejected():
    a = CircularLayer(uid="core", role="conductor", inner_radius_m=0.0, outer_radius_m=.01)
    b = CircularLayer(uid="ins", role="insulation", inner_radius_m=.01, outer_radius_m=.015)
    assert len(CircularRecipe(length_m=1.0, layers=(a, b)).layers) == 2
    for start in [.009, .011]:
        bad = CircularLayer(uid="ins", role="insulation", inner_radius_m=start, outer_radius_m=.015)
        with pytest.raises(ValidationError, match="GAP_OR_OVERLAP"):
            CircularRecipe(length_m=1.0, layers=(a, bad))
    with pytest.raises(ValidationError, match="DUPLICATE_LAYER_UID"):
        CircularRecipe(length_m=1.0, layers=(a, a))


def test_empty_sources_unknown_kind_and_unknown_field_rejected():
    base = material().model_dump()
    for change in ({"sources": []}, {"kind": "magic"}, {"hidden_approval": True}):
        with pytest.raises(ValidationError):
            AssetRelease.model_validate({**base, **change})
