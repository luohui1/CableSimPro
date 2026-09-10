"""Typed, immutable engineering inputs for the R2 architecture foundation.

No persistence, subprocesses, network access, model approval, or simulation occurs
here. A validated contract is not a validated numerical model.
"""
from __future__ import annotations

from hashlib import sha256
import json
import math
from pathlib import PurePosixPath
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Identifier = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:/-]*$")]
Version = Annotated[str, Field(pattern=r"^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$", max_length=64)]
AssetKind = Literal["material", "component", "assembly", "installation", "study_template", "rule"]
Dimension = Literal["length", "area", "absolute_temperature", "temperature_difference", "linear_resistance", "thermal_resistivity", "thermal_conductivity", "current", "frequency"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


# Unit conversion is explicit. Temperature differences never use the Celsius offset.
UNITS: dict[str, tuple[Dimension, float, float, str]] = {
    "m": ("length", 1.0, 0.0, "m"),
    "mm": ("length", 1e-3, 0.0, "m"),
    "m2": ("area", 1.0, 0.0, "m2"),
    "mm2": ("area", 1e-6, 0.0, "m2"),
    "K": ("absolute_temperature", 1.0, 0.0, "K"),
    "degC": ("absolute_temperature", 1.0, 273.15, "K"),
    "delta_K": ("temperature_difference", 1.0, 0.0, "delta_K"),
    "delta_degC": ("temperature_difference", 1.0, 0.0, "delta_K"),
    "ohm/m": ("linear_resistance", 1.0, 0.0, "ohm/m"),
    "ohm/km": ("linear_resistance", 1e-3, 0.0, "ohm/m"),
    "K.m/W": ("thermal_resistivity", 1.0, 0.0, "K.m/W"),
    "W/(m.K)": ("thermal_conductivity", 1.0, 0.0, "W/(m.K)"),
    "A": ("current", 1.0, 0.0, "A"),
    "Hz": ("frequency", 1.0, 0.0, "Hz"),
}


class Quantity(Contract):
    value: float = Field(strict=True)
    unit: str = Field(min_length=1, max_length=32)
    dimension: Dimension

    @model_validator(mode="after")
    def validate_unit(self) -> Quantity:
        entry = UNITS.get(self.unit)
        if entry is None or entry[0] != self.dimension:
            raise ValueError("UNIT_DIMENSION_MISMATCH: unsupported unit for this quantity")
        converted = self.value * entry[1] + entry[2]
        if not math.isfinite(converted):
            raise ValueError("NONFINITE_QUANTITY")
        if self.dimension == "absolute_temperature" and converted < 0:
            raise ValueError("NEGATIVE_ABSOLUTE_TEMPERATURE")
        return self

    def si(self) -> Quantity:
        _, scale, offset, unit = UNITS[self.unit]
        return Quantity(value=self.value * scale + offset, unit=unit, dimension=self.dimension)


def content_hash(value: Any) -> str:
    """CSP JSON v1 fingerprint; not an RFC 8785 canonicalization claim.

    Pydantic input types define numeric forms. Object-key order is ignored; array
    order remains meaningful. Invalid JSON keys and non-finite numbers are rejected.
    """
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")

    def inspect(node: Any) -> None:
        if isinstance(node, dict):
            if any(not isinstance(k, str) for k in node):
                raise ValueError("NON_STRING_JSON_KEY")
            for child in node.values():
                inspect(child)
        elif isinstance(node, (list, tuple)):
            for child in node:
                inspect(child)
        elif node is not None and not isinstance(node, (str, bool, int, float)):
            raise ValueError("NON_JSON_VALUE")

    inspect(value)
    payload = json.dumps(value, sort_keys=True, ensure_ascii=False,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
    return sha256(payload).hexdigest()


class SourceReference(Contract):
    kind: Literal["manufacturer", "standard", "project_input", "derived"]
    reference: str = Field(min_length=1, max_length=512)
    reviewed: bool = Field(strict=True)


class AssetRef(Contract):
    asset_id: Identifier
    version: Version
    content_sha256: Digest


class AssetParameter(Contract):
    name: Identifier
    quantity: Quantity
    overridable: bool = Field(default=False, strict=True)


class PayloadFile(Contract):
    path: str = Field(min_length=1, max_length=240)
    sha256: Digest
    size_bytes: int = Field(ge=0, le=128 * 1024 * 1024, strict=True)

    @model_validator(mode="after")
    def confined_relative_path(self) -> PayloadFile:
        path = PurePosixPath(self.path)
        reserved = {"CON", "PRN", "AUX", "NUL"} | {f"{prefix}{i}" for prefix in ("COM", "LPT") for i in range(1, 10)}
        if (not path.parts or path.is_absolute() or str(path) != self.path or ".." in path.parts
                or any(ord(c) < 32 or c in '\\:<>"|?*' for c in self.path)
                or any(part.rstrip(" .") != part or part.split(".")[0].upper() in reserved for part in path.parts)):
            raise ValueError("UNSAFE_ASSET_PATH")
        return self


class CircularLayer(Contract):
    uid: Identifier
    role: Literal["conductor", "conductor_screen", "insulation", "insulation_screen", "metallic_screen", "jacket"]
    inner_radius_m: float = Field(ge=0, strict=True)
    outer_radius_m: float = Field(gt=0, strict=True)

    @model_validator(mode="after")
    def ordered_radii(self) -> CircularLayer:
        if self.outer_radius_m <= self.inner_radius_m:
            raise ValueError("NONPOSITIVE_LAYER_THICKNESS")
        return self


class CircularRecipe(Contract):
    family: Literal["single_core_circular"] = "single_core_circular"
    representation: Literal["declarative_recipe"] = "declarative_recipe"
    length_m: float = Field(gt=0, le=10, strict=True)
    layers: tuple[CircularLayer, ...] = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def continuous_nonoverlapping_layers(self) -> CircularRecipe:
        if len({layer.uid for layer in self.layers}) != len(self.layers):
            raise ValueError("DUPLICATE_LAYER_UID")
        if self.layers[0].role != "conductor" or self.layers[0].inner_radius_m != 0:
            raise ValueError("CONDUCTOR_MUST_START_AT_AXIS")
        previous = 0.0
        for layer in self.layers:
            if not math.isclose(layer.inner_radius_m, previous, rel_tol=0, abs_tol=1e-12):
                raise ValueError("LAYER_GAP_OR_OVERLAP")
            previous = layer.outer_radius_m
        return self


class AssetRelease(Contract):
    asset_id: Identifier
    version: Version
    kind: AssetKind
    name: str = Field(min_length=1, max_length=128)
    parameters: tuple[AssetParameter, ...] = Field(default=(), max_length=256)
    dependencies: tuple[AssetRef, ...] = Field(default=(), max_length=128)
    files: tuple[PayloadFile, ...] = Field(default=(), max_length=256)
    sources: tuple[SourceReference, ...] = Field(min_length=1, max_length=64)
    geometry_recipe: CircularRecipe | None = None

    @model_validator(mode="after")
    def unique_members(self) -> AssetRelease:
        if not self.name.strip() or any(not s.reference.strip() for s in self.sources):
            raise ValueError("EMPTY_ASSET_TEXT")
        if self.geometry_recipe is not None and self.kind not in ("component", "assembly"):
            raise ValueError("GEOMETRY_REQUIRES_COMPONENT_OR_ASSEMBLY")
        groups = [tuple(p.name for p in self.parameters),
                  tuple(f.path.casefold() for f in self.files),
                  tuple((d.asset_id, d.version) for d in self.dependencies)]
        if any(len(g) != len(set(g)) for g in groups):
            raise ValueError("DUPLICATE_ASSET_MEMBER")
        return self

    def reference(self) -> AssetRef:
        return AssetRef(asset_id=self.asset_id, version=self.version,
                        content_sha256=content_hash(self))


def verify_payloads(release: AssetRelease, payloads: dict[str, bytes]) -> None:
    """Verify already isolated bytes. Does not extract or execute archive contents."""
    if set(payloads) != {f.path for f in release.files}:
        raise ValueError("ASSET_FILE_SET_MISMATCH")
    for f in release.files:
        data = payloads[f.path]
        if len(data) != f.size_bytes or sha256(data).hexdigest() != f.sha256:
            raise ValueError("ASSET_FILE_DIGEST_MISMATCH")


def resolve_asset_lock(roots: tuple[AssetRef, ...],
                       releases: tuple[AssetRelease, ...]) -> tuple[AssetRef, ...]:
    """Resolve a bounded exact dependency closure without selecting latest versions."""
    if len(releases) > 1024 or len(roots) > 128:
        raise ValueError("ASSET_GRAPH_LIMIT")
    index: dict[tuple[str, str], AssetRelease] = {}
    for release in releases:
        key = (release.asset_id, release.version)
        if key in index:
            raise ValueError("DUPLICATE_ASSET_VERSION")
        index[key] = release
    if len({(r.asset_id, r.version) for r in roots}) != len(roots):
        raise ValueError("DUPLICATE_ASSET_ROOT")
    resolved: dict[tuple[str, str], AssetRef] = {}
    visiting: set[tuple[str, str]] = set()

    def visit(ref: AssetRef, depth: int) -> None:
        key = (ref.asset_id, ref.version)
        if depth > 64:
            raise ValueError("ASSET_DEPENDENCY_DEPTH")
        if key in visiting:
            raise ValueError("ASSET_DEPENDENCY_CYCLE")
        release = index.get(key)
        if release is None:
            raise ValueError("ASSET_DEPENDENCY_MISSING")
        if key in resolved:
            if resolved[key].content_sha256 != ref.content_sha256:
                raise ValueError("ASSET_VERSION_DIGEST_MISMATCH")
            return
        visiting.add(key)
        for child in release.dependencies:
            visit(child, depth + 1)
        visiting.remove(key)
        actual = release.reference()
        if actual.content_sha256 != ref.content_sha256:
            raise ValueError("ASSET_VERSION_DIGEST_MISMATCH")
        resolved[key] = actual

    for root in roots:
        visit(root, 0)
    return tuple(resolved[key] for key in sorted(resolved))


def apply_instance_overrides(release: AssetRelease,
                             overrides: tuple[AssetParameter, ...]) -> tuple[AssetParameter, ...]:
    """Produce instance parameters; the immutable release and reference stay unchanged."""
    parameters = {p.name: p for p in release.parameters}
    if len({p.name for p in overrides}) != len(overrides):
        raise ValueError("DUPLICATE_OVERRIDE")
    for replacement in overrides:
        original = parameters.get(replacement.name)
        if original is None or not original.overridable:
            raise ValueError("PARAMETER_NOT_OVERRIDABLE")
        if original.quantity.dimension != replacement.quantity.dimension:
            raise ValueError("OVERRIDE_DIMENSION_MISMATCH")
        parameters[replacement.name] = AssetParameter(
            name=original.name, quantity=replacement.quantity.si(), overridable=True)
    return tuple(parameters[p.name] for p in release.parameters)
