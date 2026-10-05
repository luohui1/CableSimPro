"""Bounded v2 native adapter arguments, no Python expressions or file paths."""
from typing import Literal
from pydantic import Field
from ..schemas import StrictModel
from .buried_contract import BuriedArgs


class CadArgs(StrictModel):
    preview_length_m: float = Field(default=0.25, gt=0, le=1)


class MeshArgs(StrictModel):
    resolution: Literal[16, 24, 32] = 16


class SourceArgs(StrictModel):
    source_bundle: dict
    source_metadata: dict


class ThermalArgs(SourceArgs):
    heat_w_m: float = Field(gt=0, le=1000)
    surface_temperature_c: float = Field(ge=-20, le=110)
    conductor_k_w_m_k: float = Field(gt=1, le=500)
    metal_screen_k_w_m_k: float = Field(gt=1, le=500)


ARGUMENTS = {
    'cable-step': CadArgs,
    'section-mesh': MeshArgs,
    'mesh-vtu': SourceArgs,
    'radial-thermal': ThermalArgs,
    'field-summary': SourceArgs,
    'line-source-crosscheck': SourceArgs,
}
SOURCE_FILES = {
    'mesh-vtu': ('mesh.json', 'section-mesh'),
    'radial-thermal': ('mesh.json', 'section-mesh'),
    'field-summary': ('temperature.vtu', 'radial-thermal'),
    'line-source-crosscheck': ('thermal.json', 'fixed-power'),
}
