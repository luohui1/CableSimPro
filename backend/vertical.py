"""Compatibility input and transport adapter; vertical physics lives in a plugin."""
from pydantic import Field

from .schemas import StrictModel, Scenario
from .methods import execute_reference


class Vertical(StrictModel):
    height_m: float = Field(default=20, ge=1, le=300)
    ambient_bottom_c: float = Field(default=25, ge=-20, le=60)
    ambient_top_c: float = Field(default=40, ge=-20, le=80)
    h_w_m2k: float = Field(default=8, ge=1, le=50)
    emissivity: float = Field(default=0.85, ge=0, le=1)
    cells: int = Field(default=40, ge=10, le=160)


def vertical_study(cable, config, current, properties=None):
    return execute_reference('vertical-rating', Scenario(cable=cable),
                             {'configuration': config.model_dump(), 'current': current}, 'x-cablesim.vertical')
