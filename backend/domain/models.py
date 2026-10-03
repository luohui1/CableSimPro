"""cablesim.domain/1: structural facts and stable identities, never solver defaults."""
from math import hypot
import json
from typing import Literal

from pydantic import Field, model_validator

from ..schemas import StrictModel
from .environment import Backfill, SoilLayer


class Source(StrictModel):
    kind: Literal['demo', 'user', 'manufacturer', 'standard', 'measurement', 'derived', 'asset']
    reference: str | None = None
    reviewed: bool = False


class Series(StrictModel):
    time: list[float] = Field(min_length=1, max_length=10000)
    value: list[float] = Field(min_length=1, max_length=10000)
    interpolation: Literal['step', 'linear']
    scale: Literal['absolute', 'per_unit']

    @model_validator(mode='after')
    def ordered(self):
        if len(self.time) != len(self.value) or self.time[0] < 0 or any(b <= a for a, b in zip(self.time, self.time[1:])):
            raise ValueError('时间轴必须非负、严格递增且与数值长度一致')
        return self


class Material(StrictModel):
    id: str = Field(pattern=r'^material/[A-Za-z0-9_-]+$')
    label: str
    category: Literal['conductor', 'semiconductor', 'insulation', 'metal', 'polymer', 'filler', 'soil', 'backfill', 'concrete', 'duct', 'fluid']
    thermal_resistivity: float | None = Field(default=None, gt=0)
    volumetric_heat_capacity: float | None = Field(default=None, gt=0)
    electrical_resistivity_20: float | None = Field(default=None, gt=0)
    temperature_coefficient_20: float | None = Field(default=None, gt=0)
    relative_permittivity: float | None = Field(default=None, ge=1)
    loss_tangent: float | None = Field(default=None, ge=0)
    relative_permeability: float | None = Field(default=None, gt=0)
    emissivity: float | None = Field(default=None, ge=0, le=1)
    solar_absorptivity: float | None = Field(default=None, ge=0, le=1)
    dry_thermal_resistivity: float | None = Field(default=None, gt=0)
    critical_temperature_rise: float | None = Field(default=None, gt=0)
    density: float | None = Field(default=None, gt=0, description='质量密度 / kg/m³；未知时为空')


class Conductor(StrictModel):
    material: str
    form: Literal['unspecified', 'solid_round', 'stranded_round', 'stranded_round_compacted', 'segmental', 'hollow', 'sectoral']
    nominal_area: float = Field(gt=0)
    diameter: float = Field(gt=0)
    r20: float | None = Field(default=None, gt=0)
    inner_diameter: float | None = Field(default=None, ge=0)
    segments: int | None = Field(default=None, ge=1)
    wire_count: int | None = Field(default=None, ge=1)
    insulated_wires: bool | None = None
    wire_diameter: float | None = Field(default=None, gt=0)
    lay_length: float | None = Field(default=None, gt=0)
    lay_direction: Literal['left', 'right'] | None = None
    lay_factor: float | None = Field(default=None, ge=1, description='导体用料绞入系数；明确制造输入，未知时为空')


class Layer(StrictModel):
    role: Literal['conductor_screen', 'insulation', 'insulation_screen', 'metallic_screen', 'metallic_sheath', 'bedding', 'separator', 'filler', 'binder', 'armour', 'oversheath']
    material: str
    thickness: float = Field(gt=0)
    form: Literal['wires', 'tape', 'smooth', 'corrugated', 'unspecified'] | None = None
    wire_count: int | None = Field(default=None, ge=1)
    wire_diameter: float | None = Field(default=None, gt=0)
    lay_length: float | None = Field(default=None, gt=0)
    overlap: float | None = Field(default=None, ge=0, lt=1)
    tape_width: float | None = Field(default=None, gt=0)
    lay_direction: Literal['left', 'right'] | None = None


class Core(StrictModel):
    id: str = Field(pattern=r'^core/[A-Za-z0-9_-]+$')
    conductor: Conductor
    layers: list[Layer]
    x: float = 0
    z: float = 0


class Rating(StrictModel):
    u0: float = Field(ge=0)
    u: float | None = Field(default=None, ge=0)
    um: float | None = Field(default=None, ge=0)
    max_conductor_temperature: dict[Literal['normal', 'emergency', 'short_circuit'], float]


class CableType(StrictModel):
    id: str = Field(pattern=r'^cable_type/[A-Za-z0-9_-]+$')
    label: str
    construction: Literal['single_core', 'three_core', 'multi_core']
    rating: Rating
    cores: list[Core] = Field(min_length=1, max_length=100)
    common_layers: list[Layer]

    def radius(self):
        return max(hypot(c.x, c.z) + c.conductor.diameter / 2 + sum(l.thickness for l in c.layers) for c in self.cores) + sum(l.thickness for l in self.common_layers)

    @model_validator(mode='after')
    def construction_valid(self):
        count = len(self.cores)
        if self.construction == 'single_core' and count != 1 or self.construction == 'three_core' and count != 3:
            raise ValueError('芯数与电缆类型不一致')
        if len({c.id for c in self.cores}) != count:
            raise ValueError('芯 ID 重复')
        if any(t <= 0 for t in self.rating.max_conductor_temperature.values()):
            raise ValueError('绝对温度必须以 K 表示且大于零')
        for i, a in enumerate(self.cores):
            for b in self.cores[i + 1:]:
                ra = a.conductor.diameter / 2 + sum(l.thickness for l in a.layers)
                rb = b.conductor.diameter / 2 + sum(l.thickness for l in b.layers)
                if hypot(a.x-b.x, a.z-b.z) < ra+rb-1e-12:
                    raise ValueError('电缆内部芯相互重叠；多芯必须给出明确位置')
        return self


class System(StrictModel):
    kind: Literal['ac_three_phase', 'ac_single_phase', 'dc']
    frequency: float = Field(ge=0)
    voltage: float | None = Field(default=None, ge=0, description='系统线电压 / V；未知时为 null，不从电缆 U0 推断')


class CableInstance(StrictModel):
    id: str = Field(pattern=r'^cable/[A-Za-z0-9_-]+$')
    phase: Literal['A', 'B', 'C', 'L1', 'L2', 'L3', 'L1L2L3', 'N', 'PE', '+', '-']
    parallel_index: int = Field(default=1, ge=1)


class Bonding(StrictModel):
    kind: Literal['both_ends', 'single_point', 'cross_bonded', 'none', 'unspecified']
    minor_section_lengths: list[float] = Field(default_factory=list)
    transposed: bool = False


class Circuit(StrictModel):
    id: str = Field(pattern=r'^circuit/[A-Za-z0-9_-]+$')
    label: str
    system: System
    cable_type: str
    cables: list[CableInstance] = Field(min_length=1, max_length=100)
    bonding: Bonding


class Placement(StrictModel):
    cable: str
    x: float
    z: float
    enclosure: str | None = None


class Enclosure(StrictModel):
    id: str = Field(pattern=r'^enclosure/[A-Za-z0-9_-]+$')
    type: Literal['duct', 'duct_bank', 'tray', 'cleat_group', 'rack']
    x: float
    z: float
    material: str | None = None
    inner_diameter: float | None = Field(default=None, gt=0)
    outer_diameter: float | None = Field(default=None, gt=0)
    width: float | None = Field(default=None, gt=0)
    height: float | None = Field(default=None, gt=0)
    contains: list[str] = Field(default_factory=list)


class Medium(StrictModel):
    material: str | None = None
    surface_temperature: float | Series | None = None
    air_temperature: float | Series | None = None
    wind_speed: float | None = Field(default=None, ge=0)
    solar_irradiance: float | None = Field(default=None, ge=0)
    ventilation: Literal['natural', 'forced', 'none'] | None = None


class Section(StrictModel):
    id: str = Field(pattern=r'^section/[A-Za-z0-9_-]+$')
    label: str
    kind: Literal['ground', 'air', 'tunnel', 'shaft']
    length: float = Field(gt=0)
    medium: Medium
    enclosures: list[Enclosure] = Field(default_factory=list)
    placements: list[Placement] = Field(min_length=1)
    layout_template: dict = Field(default_factory=dict)
    backfill: Backfill | None = None
    soil_layers: list[SoilLayer] = Field(default_factory=list)


class Load(StrictModel):
    id: str = Field(pattern=r'^load/[A-Za-z0-9_-]+$')
    kind: Literal['steady', 'cyclic', 'emergency', 'short_circuit', 'time_series']
    currents: dict[str, float] = Field(default_factory=dict)
    profile: dict[str, Series] = Field(default_factory=dict)
    base_current: dict[str, float] = Field(default_factory=dict)
    duration: float | None = Field(default=None, gt=0)
    period: float | None = Field(default=None, gt=0)
    preload: str | None = None
    initial: str | None = None


class DomainDocument(StrictModel):
    schema_version: Literal['cablesim.domain/1'] = 'cablesim.domain/1'
    name: str = Field(min_length=1, max_length=100)
    materials: list[Material] = Field(min_length=1, max_length=1000)
    cable_types: list[CableType] = Field(min_length=1, max_length=1000)
    circuits: list[Circuit] = Field(min_length=1, max_length=1000)
    sections: list[Section] = Field(min_length=1, max_length=1000)
    load_cases: list[Load] = Field(min_length=1, max_length=1000)
    criteria: dict[str, float] = Field(default_factory=dict)
    provenance: dict[str, Source] = Field(default_factory=dict)

    @model_validator(mode='after')
    def references(self):
        json.dumps(self.model_dump(mode='json'), allow_nan=False)
        objects = [*self.materials, *self.cable_types, *self.circuits, *self.sections, *self.load_cases,
                   *(c for circuit in self.circuits for c in circuit.cables), *(e for s in self.sections for e in s.enclosures)]
        if len({o.id for o in objects}) != len(objects):
            raise ValueError('领域对象 ID 必须唯一')
        materials = {m.id for m in self.materials}
        types = {c.id: c for c in self.cable_types}
        radii = {}
        for t in self.cable_types:
            refs = [c.conductor.material for c in t.cores] + [l.material for c in t.cores for l in c.layers] + [l.material for l in t.common_layers]
            if not set(refs) <= materials:
                raise ValueError('电缆材料引用不存在')
        for c in self.circuits:
            if c.cable_type not in types:
                raise ValueError('回路引用的电缆类型不存在')
            radii.update({i.id: types[c.cable_type].radius() for i in c.cables})
            if (c.system.kind == 'dc') != (c.system.frequency == 0):
                raise ValueError('直流频率必须为零，交流频率必须大于零')
            if any(v <= 0 for v in c.bonding.minor_section_lengths):
                raise ValueError('接地小段长度必须为正')
            if len({(i.phase, i.parallel_index) for i in c.cables}) != len(c.cables):
                raise ValueError('相位与并联序号重复')
        for s in self.sections:
            if s.medium.material and s.medium.material not in materials:
                raise ValueError('环境材料引用不存在')
            regions = ([s.backfill] if s.backfill else []) + s.soil_layers
            if regions and s.kind != 'ground':
                raise ValueError('回填与土壤分层仅适用于地下截面')
            if len({r.id for r in regions}) != len(regions) or any(r.material not in materials for r in regions):
                raise ValueError('介质分区标识重复或材料引用不存在')
            for a, b in zip(s.soil_layers, s.soil_layers[1:]):
                if abs(a.bottom_z - b.top_z) > 1e-12:
                    raise ValueError('土壤层应从上到下连续排列')
            if len({p.cable for p in s.placements}) != len(s.placements):
                raise ValueError('截面中电缆位置重复')
            enclosures = {e.id: e for e in s.enclosures}
            for e in s.enclosures:
                if e.material and e.material not in materials:
                    raise ValueError('容纳结构材料不存在')
                if len(set(e.contains)) != len(e.contains) or not set(e.contains) <= radii.keys():
                    raise ValueError('容纳结构内容重复或引用未知电缆')
                if any(not any(p.cable == cid and p.enclosure == e.id for p in s.placements) for cid in e.contains):
                    raise ValueError('容纳结构内容与敷设引用不一致')
            for i, p in enumerate(s.placements):
                if p.cable not in radii:
                    raise ValueError('敷设位置引用未知电缆')
                r = radii[p.cable]
                if s.kind == 'ground' and p.z + r > 1e-12:
                    raise ValueError('地下电缆超出地表')
                for q in s.placements[i + 1:]:
                    if q.cable not in radii or hypot(p.x-q.x, p.z-q.z) < r+radii[q.cable]-1e-12:
                        raise ValueError('电缆相互重叠或引用不存在')
                if p.enclosure:
                    e = enclosures.get(p.enclosure)
                    if not e or p.cable not in e.contains:
                        raise ValueError('容纳结构引用不一致')
                    if e.type == 'duct' and (e.inner_diameter is None or e.outer_diameter is None or e.inner_diameter >= e.outer_diameter or hypot(p.x-e.x,p.z-e.z)+r > e.inner_diameter/2):
                        raise ValueError('电缆超出管内边界或管径无效')
        circuits = {c.id for c in self.circuits}
        loads = {l.id for l in self.load_cases}
        for load in self.load_cases:
            if not (set(load.currents) | set(load.profile) | set(load.base_current)) <= circuits:
                raise ValueError('负荷引用未知回路')
            if any(v < 0 for v in [*load.currents.values(), *load.base_current.values()]):
                raise ValueError('负荷电流不得为负')
            if load.kind == 'steady' and (not load.currents or load.profile):
                raise ValueError('稳态负荷需要明确电流且不得混入时间序列')
            if any(v < 0 for series in load.profile.values() for v in series.value):
                raise ValueError('负荷序列不得为负')
            if any(series.scale == 'per_unit' and cid not in load.base_current for cid, series in load.profile.items()):
                raise ValueError('标幺负荷必须指定基准电流')
            if any(ref and ref not in loads for ref in (load.preload, load.initial)):
                raise ValueError('初始负荷引用不存在')
        return self
