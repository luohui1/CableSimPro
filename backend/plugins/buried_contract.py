"""Additive contract for a three-cable + soil research domain, not ampacity.

The old six-domain cablesim.thermal-field/1 contract is deliberately unchanged.
All inputs come from a saved Scenario plus explicit research arguments.
"""
from collections import Counter
from typing import Annotated, Literal
from pydantic import Field, StrictInt, model_validator
from ..foundation.contracts import Contract
from ..schemas import StrictModel

Power = Annotated[float, Field(ge=0, le=1000, strict=True)]


class BuriedArgs(StrictModel):
    conductor_powers_w_m: tuple[Power, Power, Power]
    conductor_k_w_m_k: float = Field(gt=1, le=500, strict=True)
    metal_screen_k_w_m_k: float = Field(gt=1, le=500, strict=True)
    domain_scale: Literal[4, 8, 16] = 8
    resolution: Literal[16, 24, 32] = 16


class BuriedDomain(Contract):
    domain_id: int = Field(ge=1, le=19, strict=True)
    phase: Literal['A', 'B', 'C'] | None
    role: Literal['conductor', 'conductor_screen', 'insulation', 'insulation_screen', 'metallic_screen', 'jacket', 'soil']
    uid: str = Field(min_length=1, max_length=200)


class BuriedField(Contract):
    schema_version: Literal['cablesim.buried-field/1'] = 'cablesim.buried-field/1'
    dimension: Literal[2] = 2
    coordinate_unit: Literal['m'] = 'm'
    quantity: Literal['temperature'] = 'temperature'
    unit: Literal['K'] = 'K'
    association: Literal['node'] = 'node'
    positive_y: Literal['depth'] = 'depth'
    points: tuple[tuple[float, float, float], ...] = Field(min_length=3, max_length=100000)
    triangles: tuple[tuple[StrictInt, StrictInt, StrictInt], ...] = Field(min_length=1, max_length=200000)
    domain_ids: tuple[StrictInt, ...] = Field(max_length=200000)
    domains: tuple[BuriedDomain, ...] = Field(min_length=19, max_length=19)
    values: tuple[float, ...] = Field(min_length=3, max_length=100000)
    boundary_nodes: tuple[StrictInt, ...] = Field(min_length=4, max_length=100000)
    cable_centers_m: tuple[tuple[float, float], tuple[float, float], tuple[float, float]]
    cable_outer_radius_m: float = Field(gt=0)
    half_width_m: float = Field(gt=0)
    bottom_depth_m: float = Field(gt=0)

    @model_validator(mode='after')
    def valid_mesh_and_field(self):
        if len(self.values) != len(self.points) or len(self.domain_ids) != len(self.triangles):
            raise ValueError('BURIED_FIELD_COUNTS')
        if set(self.domain_ids) != set(range(1, 20)):
            raise ValueError('BURIED_DOMAIN_MAPPING')
        roles = ('conductor', 'conductor_screen', 'insulation', 'insulation_screen', 'metallic_screen', 'jacket')
        expected = [(i, ('A', 'B', 'C')[(i-1)//6], roles[(i-1)%6]) for i in range(1, 19)] + [(19, None, 'soil')]
        if [(d.domain_id, d.phase, d.role) for d in self.domains] != expected or len({d.uid for d in self.domains}) != 19:
            raise ValueError('BURIED_DOMAIN_SEMANTICS')
        if min(self.values) < 0:
            raise ValueError('NEGATIVE_ABSOLUTE_TEMPERATURE')
        tolerance = 1e-9 * max(self.half_width_m, self.bottom_depth_m, 1)
        geometric_boundary = set()
        for i, (x, y, z) in enumerate(self.points):
            if abs(z) > 1e-12 or abs(x) > self.half_width_m+tolerance or not -tolerance <= y <= self.bottom_depth_m+tolerance:
                raise ValueError('BURIED_DOMAIN_EXTENT')
            if abs(abs(x)-self.half_width_m) < tolerance or min(abs(y), abs(y-self.bottom_depth_m)) < tolerance:
                geometric_boundary.add(i)
        edges = Counter()
        used, unique = set(), set()
        for tri in self.triangles:
            if len(set(tri)) != 3 or min(tri) < 0 or max(tri) >= len(self.points):
                raise ValueError('BURIED_CONNECTIVITY')
            canonical = tuple(sorted(tri))
            if canonical in unique:
                raise ValueError('DUPLICATE_ELEMENT')
            unique.add(canonical); used.update(tri)
            a, b, c = (self.points[i] for i in tri)
            if abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])) < 1e-20:
                raise ValueError('DEGENERATE_ELEMENT')
            for x, y in zip(tri, (tri[1], tri[2], tri[0])):
                edges[tuple(sorted((x, y)))] += 1
        boundary = {i for edge, count in edges.items() if count == 1 for i in edge}
        if max(edges.values()) > 2 or used != set(range(len(self.points))):
            raise ValueError('NONMANIFOLD_OR_UNUSED_NODES')
        if len(set(self.boundary_nodes)) != len(self.boundary_nodes) or set(self.boundary_nodes) != boundary or boundary != geometric_boundary:
            raise ValueError('UNEXPECTED_INTERNAL_BOUNDARY')
        return self


class BuriedSummary(Contract):
    schema_version: Literal['cablesim.buried-reference/1'] = 'cablesim.buried-reference/1'
    method: Literal['P1 2D conduction; three cables and finite homogeneous soil'] = 'P1 2D conduction; three cables and finite homogeneous soil'
    boundary_condition: Literal['ambient temperature on ground, sides and bottom'] = 'ambient temperature on ground, sides and bottom'
    ampacity_a: None = None
    maximum_temperature_c: float
    conductor_max_temperatures_c: tuple[float, float, float]
    ambient_temperature_c: float
    source_powers_w_m: tuple[Power, Power, Power]
    source_heat_w_m: float = Field(ge=0)
    boundary_heat_w_m: float
    energy_relative_residual: float | None = Field(default=None, ge=0)
    free_equation_residual_inf_w_m: float = Field(ge=0)
    nodes: int = Field(gt=0, strict=True)
    elements: int = Field(gt=0, strict=True)
    domains: Literal[19] = 19
    half_width_m: float = Field(gt=0)
    bottom_depth_m: float = Field(gt=0)
    domain_scale: Literal[4, 8, 16]
    resolution: Literal[16, 24, 32]
    soil_k_w_m_k: float = Field(gt=0)

    @model_validator(mode='after')
    def energy(self):
        power = sum(self.source_powers_w_m)
        if abs(power-self.source_heat_w_m) > 1e-9*max(power, 1):
            raise ValueError('SOURCE_POWER_MISMATCH')
        difference = abs(self.boundary_heat_w_m-power)
        if difference > 1e-6*max(power, 1):
            raise ValueError('BURIED_ENERGY_BALANCE')
        if power == 0:
            if self.energy_relative_residual is not None:
                raise ValueError('ZERO_POWER_RELATIVE_ERROR_UNDEFINED')
        elif self.energy_relative_residual is None or abs(self.energy_relative_residual-difference/power) > 1e-12:
            raise ValueError('BURIED_ENERGY_SUMMARY')
        if self.free_equation_residual_inf_w_m > 1e-6*max(power, 1):
            raise ValueError('BURIED_FREE_RESIDUAL')
        return self


def validate_buried_projection(raw, summary):
    field = BuriedField.model_validate(raw)
    result = BuriedSummary.model_validate(summary)
    if len(field.points) != result.nodes or len(field.triangles) != result.elements:
        raise ValueError('FIELD_SUMMARY_COUNTS')
    if abs(max(field.values)-273.15-result.maximum_temperature_c) > 1e-7:
        raise ValueError('FIELD_SUMMARY_TEMPERATURE')
    if any(abs(field.values[i]-273.15-result.ambient_temperature_c) > 1e-7 for i in field.boundary_nodes):
        raise ValueError('FIELD_BOUNDARY_TEMPERATURE')
    if field.half_width_m != result.half_width_m or field.bottom_depth_m != result.bottom_depth_m:
        raise ValueError('FIELD_SUMMARY_EXTENT')
    for phase, domain in enumerate((1, 7, 13)):
        nodes = {i for tri, tag in zip(field.triangles, field.domain_ids) if tag == domain for i in tri}
        if abs(max(field.values[i] for i in nodes)-273.15-result.conductor_max_temperatures_c[phase]) > 1e-7:
            raise ValueError('FIELD_PHASE_TEMPERATURE')
    return field
