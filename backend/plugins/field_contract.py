"""Bounded browser field projection of a saved solver artifact; no second solve.

This contract complements the existing Plugin Spec and R2 Quantity/path vocabulary.
It does not introduce another plugin runtime. Values are absolute kelvin on nodes.
"""
from typing import Literal
from pydantic import Field, StrictInt, model_validator
from ..foundation.contracts import Contract


class ThermalField(Contract):
    schema_version: Literal['cablesim.thermal-field/1'] = 'cablesim.thermal-field/1'
    dimension: Literal[2] = 2
    coordinate_unit: Literal['m'] = 'm'
    quantity: Literal['temperature'] = 'temperature'
    unit: Literal['K'] = 'K'
    association: Literal['node'] = 'node'
    points: tuple[tuple[float, float, float], ...] = Field(min_length=3, max_length=50000)
    triangles: tuple[tuple[StrictInt, StrictInt, StrictInt], ...] = Field(min_length=1, max_length=100000)
    domain_ids: tuple[StrictInt, ...]
    values: tuple[float, ...] = Field(min_length=3, max_length=50000)

    @model_validator(mode='after')
    def consistent(self):
        if len(self.points) != len(self.values):
            raise ValueError('FIELD_NODE_COUNT')
        if len(self.triangles) != len(self.domain_ids) or set(self.domain_ids) != set(range(1,7)):
            raise ValueError('FIELD_DOMAIN_MAPPING')
        if min(self.values) < 0:
            raise ValueError('NEGATIVE_ABSOLUTE_TEMPERATURE')
        if any(abs(p[2]) > 1e-12 for p in self.points):
            raise ValueError('NONPLANAR_SECTION')
        for a,b,c in self.triangles:
            if len({a,b,c}) != 3 or min(a,b,c)<0 or max(a,b,c)>=len(self.points):
                raise ValueError('FIELD_CONNECTIVITY')
            x,y,z = self.points[a],self.points[b],self.points[c]
            if abs((y[0]-x[0])*(z[1]-x[1])-(y[1]-x[1])*(z[0]-x[0])) < 1e-20:
                raise ValueError('DEGENERATE_FIELD_ELEMENT')
        return self


def validate_thermal_projection(field, summary):
    result = ThermalField.model_validate(field)
    if len(result.points)!=summary['nodes'] or len(result.triangles)!=summary['elements']:
        raise ValueError('FIELD_SUMMARY_COUNTS')
    if abs(max(result.values)-273.15-summary['maximum_temperature_c'])>1e-7:
        raise ValueError('FIELD_SUMMARY_TEMPERATURE')
    return result
