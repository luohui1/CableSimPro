"""Saved three-core IEC-loss / spatial thermal-field input, in SI units."""
from typing import Literal
from pydantic import Field, model_validator
from .base import StrictModel
from .simulation import MeshControls


class DomainSelection(StrictModel):
    section_id: str = Field(min_length=1)
    load_id: str = Field(min_length=1)
    bounds_m: tuple[float,float,float,float]
    equivalent_layers_acknowledged: Literal[True]
    source: str = Field(min_length=1)

    @model_validator(mode='after')
    def bounds(self):
        x,z,X,Z = self.bounds_m
        if not x<X or not z<Z or Z!=0:
            raise ValueError('bounds_m：须为有正面积、以z=0为地表的矩形，单位m。')
        return self


class MissingThermalProperty(StrictModel):
    thermal_resistivity: float = Field(gt=0,description='Thermal resistivity K*m/W, only for a missing saved material property.')
    source: str = Field(min_length=1)


class ThreeCoreThermalParameters(StrictModel):
    domain_options: DomainSelection
    iec: dict
    mesh: MeshControls
    material_thermal_resistivity: dict[str,MissingThermalProperty] = Field(default_factory=dict)
    tolerance_k: float = Field(default=1e-5,gt=0,le=.001)
    maximum_iterations: int = Field(default=100,ge=2,le=200)
    relaxation: float = Field(default=.7,gt=0,le=1)
