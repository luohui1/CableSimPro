"""Steady A-u / heat coupling wire contract; no solver or host dependency."""
from typing import Literal
from pydantic import Field, model_validator
from .simulation import Strict, Problem, Condition


class ResistivityLaw(Strict):
    reference_temperature_k: float = Field(gt=0)
    alpha_per_k: float = Field(ge=0)
    minimum_temperature_k: float = Field(gt=0)
    maximum_temperature_k: float = Field(gt=0)
    source: str = Field(min_length=1)

    @model_validator(mode='after')
    def bounded(self):
        if not self.minimum_temperature_k <= self.reference_temperature_k <= self.maximum_temperature_k:
            raise ValueError('reference_temperature_k：必须位于材料有效温度区间。')
        if self.minimum_temperature_k >= self.maximum_temperature_k or 1+self.alpha_per_k*(self.minimum_temperature_k-self.reference_temperature_k)<=0:
            raise ValueError('minimum_temperature_k：温度区间必须有序且电阻率保持正值。')
        return self


class Electrothermal(Strict):
    schema_version: Literal['cablesim.electrothermal/1']
    magnetic: Problem
    thermal_boundaries: list[Condition] = Field(min_length=1,max_length=64)
    resistivity_laws: dict[str,ResistivityLaw] = Field(min_length=1)
    fixed_heat_w_m_by_region: dict[str,float] = Field(default_factory=dict)
    initial_temperature_k: float = Field(gt=0)
    temperature_tolerance_k: float = Field(default=1e-4,gt=0,le=.01)
    power_relative_tolerance: float = Field(default=1e-6,gt=0,le=1e-3)
    relaxation: float = Field(default=.7,gt=0,le=1)
    maximum_iterations: int = Field(default=60,ge=2,le=200)

    @model_validator(mode='after')
    def complete(self):
        if self.magnetic.physics!='magnetic_harmonic':
            raise ValueError('magnetic.physics：必须为时谐A-u问题。')
        conducting={g.uid for g in self.magnetic.geometry if g.material.conductivity_s_m>0}
        if set(self.fixed_heat_w_m_by_region)-{g.uid for g in self.magnetic.geometry} or any(
                value<0 for value in self.fixed_heat_w_m_by_region.values()):
            raise ValueError('fixed_heat_w_m_by_region：热源须绑定现有材料域且为非负有限值，单位 W/m。')
        if set(self.resistivity_laws)!=conducting:
            raise ValueError('resistivity_laws：每个导电域均须显式给出温变电阻率定律；常量用alpha=0。')
        for g in self.magnetic.geometry:
            if g.void or g.material.k_w_m_k is None:
                raise ValueError('magnetic.geometry：耦合域须为有热导率的实体，当前不支持薄层接触热阻或内孔。')
        heat=self.magnetic.model_dump(mode='json')
        heat.update(physics='steady_heat',frequency_hz=None,excitations=[],current_probes=[],boundaries=[b.model_dump(mode='json') for b in self.thermal_boundaries])
        Problem.model_validate(heat)
        if any(b.kind not in ('temperature','insulated') for b in self.thermal_boundaries):
            raise ValueError('thermal_boundaries.kind：当前耦合仅支持给定温度和绝热边界。')
        for uid,law in self.resistivity_laws.items():
            if not law.minimum_temperature_k<=self.initial_temperature_k<=law.maximum_temperature_k:
                raise ValueError('initial_temperature_k：越出'+uid+'材料有效范围。')
        return self
