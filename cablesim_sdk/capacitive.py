"""Explicit coaxial frequency-current wire contract, SI units and peak phasors."""
from typing import Literal
from pydantic import Field,model_validator
from .simulation import Strict


class CapacitiveLayer(Strict):
    uid: str = Field(min_length=1)
    outer_radius_m: float = Field(gt=0)
    conductivity_radial_s_m: float = Field(ge=0)
    conductivity_axial_s_m: float = Field(ge=0)
    relative_permittivity: float = Field(gt=0)
    source: str = Field(min_length=1)


class CapacitiveCable(Strict):
    schema_version: Literal['cablesim.capacitive-cable/1']
    inner_radius_m: float = Field(gt=0)
    layers: list[CapacitiveLayer] = Field(min_length=2,max_length=16)
    sheath_layer: str = Field(min_length=1)
    frequency_hz: float = Field(gt=0)
    voltage_peak_v: float = Field(gt=0)
    axial_voltage_drop_peak_v_m: float = Field(ge=0)
    length_m: float = Field(gt=0)
    axial_coordinate_scale: float = Field(gt=0)
    bonding: Literal['radial_ground','single_point','both_ends','cross_bonded']
    section_fractions: list[float] = Field(default_factory=list)
    section_phase_rad: list[float] = Field(default_factory=list)
    source: str = Field(min_length=1)

    @model_validator(mode='after')
    def valid(self):
        radii=[self.inner_radius_m]+[r.outer_radius_m for r in self.layers]
        if any(a>=b for a,b in zip(radii,radii[1:])):raise ValueError('layers.outer_radius_m：必须逐层严格增加。')
        if len({r.uid for r in self.layers})!=len(self.layers):raise ValueError('layers.uid：必须唯一。')
        if self.sheath_layer!=self.layers[-1].uid or self.layers[-1].conductivity_axial_s_m<=0:
            raise ValueError('sheath_layer：当前模型要求最外层是显式导电护套。')
        if self.axial_voltage_drop_peak_v_m*self.length_m>=self.voltage_peak_v:
            raise ValueError('axial_voltage_drop_peak_v_m：导体全长电压降必须小于端电压。')
        if self.bonding=='cross_bonded':
            if len(self.section_fractions)!=3 or len(self.section_phase_rad)!=3 or any(x<=0 for x in self.section_fractions) or abs(sum(self.section_fractions)-1)>1e-12:
                raise ValueError('section_fractions/section_phase_rad：交叉互联需三个正长度比例（合计1）和各段明确相角。')
        elif self.section_fractions or self.section_phase_rad:
            raise ValueError('section_fractions：分段仅用于交叉互联。')
        if self.bonding=='radial_ground' and self.axial_voltage_drop_peak_v_m:
            raise ValueError('axial_voltage_drop_peak_v_m：径向电容工况要求轴向电压不变。')
        return self


class CapacitiveMesh(Strict):
    radial_elements_per_layer: int = Field(ge=2,le=100)
    axial_elements_per_section: int = Field(ge=4,le=2000)
    max_nodes: int = Field(default=60000,ge=100,le=120000)
