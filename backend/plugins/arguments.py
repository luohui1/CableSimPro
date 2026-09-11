"""Bounded native command arguments, no Python expressions or caller file paths."""
from typing import Literal
from uuid import UUID
from pydantic import Field
from ..schemas import StrictModel


class CadArgs(StrictModel):
    preview_length_m: float = Field(default=0.25, gt=0, le=1)


class MeshArgs(StrictModel):
    resolution: Literal[16, 24, 32] = 16


class SourceArgs(StrictModel):
    source_job_id: UUID


class ThermalArgs(SourceArgs):
    heat_w_m: float = Field(gt=0, le=1000)
    surface_temperature_c: float = Field(ge=-20, le=110)
    conductor_k_w_m_k: float = Field(gt=1, le=500)
    metal_screen_k_w_m_k: float = Field(gt=1, le=500)


ARGUMENTS = {
    'cadquery.cable-step': CadArgs,
    'gmsh.cable-section': MeshArgs,
    'meshio.to-vtu': SourceArgs,
    'skfem.radial-thermal': ThermalArgs,
    'pyvista.field-summary': SourceArgs,
}
SOURCE_FILES = {
    'meshio.to-vtu': ('mesh.json', 'gmsh.cable-section'),
    'skfem.radial-thermal': ('mesh.json', 'gmsh.cable-section'),
    'pyvista.field-summary': ('temperature.vtu', 'skfem.radial-thermal'),
}
