"""Versioned result contracts only; physics and result production live in plugins."""
from typing import Literal
from pydantic import Field, model_validator
from .simulation import Strict
from .electrothermal import ResistivityLaw
from math import prod, isfinite


class ArtifactSource(Strict):
    run_id: str = Field(min_length=1)
    case_id: str = Field(min_length=1)
    plugin_id: str = Field(min_length=1)
    plugin_version: str = Field(min_length=1)
    capability: str = Field(min_length=1)
    input_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    bundle_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    manifest_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')


class FieldMesh(Strict):
    length_unit: Literal['m'] = 'm'
    coordinates: Literal['section-x-z; z-up'] = 'section-x-z; z-up'
    points: list[tuple[float, float]] = Field(min_length=3)
    triangles: list[tuple[int, int, int]] = Field(min_length=1)
    domain_ids: list[int]
    regions: list[dict]
    sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    representation: str = Field(min_length=1)

    @model_validator(mode='after')
    def consistent(self):
        if len(self.triangles) != len(self.domain_ids):
            raise ValueError('mesh.domain_ids：每个单元必须绑定一个材料区域。')
        ids = [r['id'] for r in self.regions]
        if len(ids) != len(set(ids)) or not set(self.domain_ids) <= set(ids):
            raise ValueError('mesh.regions：区域标识重复或缺失。')
        for t in self.triangles:
            if len(set(t)) != 3 or min(t) < 0 or max(t) >= len(self.points):
                raise ValueError('mesh.triangles：节点索引无效。')
        return self


class TemperatureSample(Strict):
    entity: str = Field(min_length=1)
    point_m: tuple[float, float]
    temperature_k: float = Field(gt=0)
    time_s: float = Field(ge=0)
    method: str = Field(min_length=1)


class TemperatureField(Strict):
    schema_version: Literal['cablesim.temperature-field/1']
    source: ArtifactSource
    mesh: FieldMesh
    association: Literal['node'] = 'node'
    temperature_unit: Literal['K'] = 'K'
    temperature_k: list[float]
    time_s: float = Field(ge=0)
    samples: list[TemperatureSample]
    hotspot: TemperatureSample
    convergence: dict
    engineering_approval: Literal[False] = False

    @model_validator(mode='after')
    def consistent(self):
        if len(self.temperature_k) != len(self.mesh.points) or any(t <= 0 for t in self.temperature_k):
            raise ValueError('temperature_k：温度必须为正K并与节点一一对应。')
        if self.hotspot.temperature_k != max(self.temperature_k):
            raise ValueError('hotspot：必须是输出节点场的实际最大值。')
        return self


class LossBinding(Strict):
    entity: str = Field(min_length=1)
    conductor_regions: list[str] = Field(min_length=1)
    sheath_regions: list[str]
    armor_regions: list[str]


class LossTemperatureAxis(Strict):
    entity: str = Field(min_length=1)
    state: Literal['conductor_temperature_c', 'sheath_temperature_c']
    regions: list[str] = Field(min_length=1)
    values_c: list[float] = Field(min_length=2, max_length=16)

    @model_validator(mode='after')
    def ordered(self):
        if not all(isfinite(v) for v in self.values_c) or self.values_c[0] <= -273.15 or any(a >= b for a, b in zip(self.values_c, self.values_c[1:])):
            raise ValueError('values_c：温度节点须严格递增且高于绝对零度。')
        return self


class LossTemperatureTable(Strict):
    axes: list[LossTemperatureAxis] = Field(min_length=1, max_length=8)
    resistivity_laws: dict[str, ResistivityLaw] = Field(min_length=1)
    current_scale_range: tuple[float, float]
    maximum_validation_absolute_error: float = Field(gt=0, le=.1)

    @model_validator(mode='after')
    def bounded(self):
        lo, hi = self.current_scale_range
        if not all(isfinite(v) for v in (lo, hi)) or lo < 0 or lo >= hi or not lo <= 1 <= hi:
            raise ValueError('current_scale_range：非负有序范围须包含采样电流倍率1。')
        keys = [(a.entity, a.state) for a in self.axes]
        regions = [r for a in self.axes for r in a.regions]
        if len(set(keys)) != len(keys) or len(set(regions)) != len(regions):
            raise ValueError('axes：对象温度轴或材料区域重复。')
        if set(regions) != set(self.resistivity_laws):
            raise ValueError('resistivity_laws：须覆盖且仅覆盖所有温度轴区域。')
        if prod(len(a.values_c) for a in self.axes) > 2048:
            raise ValueError('axes：张量表超过2048个求解节点，请缩小工况或节点数。')
        for a in self.axes:
            for uid in a.regions:
                law = self.resistivity_laws[uid]
                if a.values_c[0]+273.15 < law.minimum_temperature_k or a.values_c[-1]+273.15 > law.maximum_temperature_k:
                    raise ValueError('values_c：温度表超出'+uid+'材料定律有效范围。')
        return self


class LossExport(Strict):
    bindings: list[LossBinding] = Field(min_length=1, max_length=64)
    source_domain_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    topology: dict = Field(min_length=1)
    material_temperatures_k: dict[str, float] = Field(min_length=1)
    source: str = Field(min_length=1)
    temperature_table: LossTemperatureTable | None = None

    @model_validator(mode='after')
    def consistent(self):
        entities = [b.entity for b in self.bindings]
        regions = [u for b in self.bindings for u in b.conductor_regions+b.sheath_regions+b.armor_regions]
        if len(set(entities)) != len(entities) or len(set(regions)) != len(regions):
            raise ValueError('loss_export.bindings：实体和区域分配不得重复；共享铠装请绑定整组，不能重复计损。')
        if any(not isfinite(v) or v <= 0 for v in self.material_temperatures_k.values()):
            raise ValueError('loss_export.material_temperatures_k：材料温度必须使用正K。')
        if self.temperature_table:
            expected = {(b.entity, 'conductor_temperature_c'): set(b.conductor_regions) for b in self.bindings}
            expected.update({(b.entity, 'sheath_temperature_c'): set(b.sheath_regions+b.armor_regions)
                             for b in self.bindings if b.sheath_regions or b.armor_regions})
            actual = {(a.entity, a.state): set(a.regions) for a in self.temperature_table.axes}
            if actual != expected:
                raise ValueError('temperature_table.axes：须按绑定对象完整分配导体和护套/铠装温度轴。')
        return self
