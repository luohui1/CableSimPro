"""Versioned design requests and incomplete drafts; physical domain/1 stays readable."""
from copy import deepcopy
from typing import Literal
from pydantic import Field, model_validator
from .base import StrictModel
from .domain import DomainDocument


class CableDesignRequest(StrictModel):
    schema_version: Literal['cablesim.cable-design-request/1', 'cablesim.cable-design-request/2']
    construction: Literal['single_core', 'three_core', 'four_core', 'three_plus_one']
    voltage: str
    conductor: Literal['copper_bare', 'aluminium']
    area_m2: float = Field(gt=0, le=.0025)
    form: Literal['solid_round', 'unspecified']
    diameter_m: float | None = Field(default=None, gt=0, le=.1)
    gap_m: float | None = Field(default=None, ge=0, le=.1)
    neutral_area_m2: float | None = Field(default=None, gt=0, le=.0025)
    neutral_diameter_m: float | None = Field(default=None, gt=0, le=.1)
    filler_thickness_m: float | None = Field(default=None, gt=0, le=.05)
    binder_thickness_m: float | None = Field(default=None, gt=0, le=.05)
    generation_mode: Literal['insulation', 'complete'] = 'insulation'
    # Optional extension of /2. Old requests still produce insulation drafts.
    screened: Literal['yes', 'no'] | None = None
    conductor_screen_thickness_m: float | None = Field(default=None, gt=0, le=.01)
    insulation_screen_thickness_m: float | None = Field(default=None, gt=0, le=.01)
    screen_tape_thickness_m: float | None = Field(default=None, gt=0, le=.005)
    screen_tape_width_m: float | None = Field(default=None, gt=0, le=.5)
    armour: Literal['none', 'steel_tape'] | None = None

    @model_validator(mode='after')
    def version_and_geometry(self):
        if self.schema_version.endswith('/1') and (self.construction not in ('single_core', 'three_core') or any(v is not None for v in (self.neutral_area_m2, self.neutral_diameter_m, self.filler_thickness_m, self.binder_thickness_m))):
            raise ValueError('/schema_version：四芯与新护层字段须使用第二版设计契约。')
        if self.schema_version.endswith('/1') and any(v is not None for v in (self.screened, self.conductor_screen_thickness_m, self.insulation_screen_thickness_m, self.screen_tape_thickness_m, self.screen_tape_width_m, self.armour)):
            raise ValueError('/schema_version：完整护层制造输入须使用第二版设计契约。')
        if self.construction == 'three_plus_one':
            if self.neutral_area_m2 is None or self.neutral_area_m2 >= self.area_m2:
                raise ValueError('/neutral_area_m2：3+1 须明确小于相线的中性线截面。')
            if self.form == 'unspecified' and self.neutral_diameter_m is None:
                raise ValueError('/neutral_diameter_m：请提供中性线圆形导体外径。')
        elif self.neutral_area_m2 is not None or self.neutral_diameter_m is not None:
            raise ValueError('/neutral_area_m2：中性线独立尺寸只用于 3+1。')
        if self.construction not in ('four_core', 'three_plus_one') and (self.filler_thickness_m is not None or self.binder_thickness_m is not None):
            raise ValueError('/filler_thickness_m：此版提案的填充与包带输入仅用于四芯结构。')
        if self.form == 'unspecified' and self.diameter_m is None:
            raise ValueError('/diameter_m：请提供实际圆形导体外径。')
        if self.construction != 'single_core' and self.gap_m is None:
            raise ValueError('/gap_m：请明确芯间最小净距；相切时填 0 mm。')
        return self


def type_draft_schema(version='cablesim.type-draft/1'):
    if version not in ('cablesim.type-draft/1', 'cablesim.type-draft/2'):
        raise ValueError('未知型号草稿版本。')
    schema = deepcopy(DomainDocument.model_json_schema())
    schema['properties']['schema_version']['const'] = version
    for model, fields in [('Conductor', ('nominal_area', 'diameter')), ('Layer', ('thickness',)), ('Core', ('x', 'z')), ('Rating', ('u0',))]:
        for field in fields:
            original = schema['$defs'][model]['properties'][field]
            schema['$defs'][model]['properties'][field] = {'anyOf': [original, {'type': 'null'}]}
    # Four-core drafts use domain/1's existing multi_core construction and
    # individual conductor sections; no new implicit neutral or coordinates.
    return schema
