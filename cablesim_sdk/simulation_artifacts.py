"""Versioned result wire contracts shared by producing plugins and consuming host."""
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
    binding: Literal['simulation-bundle', 'iec-trace'] = 'simulation-bundle'
    bundle_sha256: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    trace_sha256: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    manifest_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')

    @model_validator(mode='after')
    def bound_source(self):
        if self.binding == 'simulation-bundle' and (not self.bundle_sha256 or self.trace_sha256 is not None):
            raise ValueError('source：原始场绑定必须提供bundle_sha256，不能混入IEC轨迹摘要。')
        if self.binding == 'iec-trace' and (not self.trace_sha256 or self.bundle_sha256 is not None):
            raise ValueError('source：IEC解析场必须提供trace_sha256，不伪造原始场束。')
        return self


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


class ExcludedCircle(Strict):
    entity: str = Field(min_length=1)
    center_m: tuple[float, float]
    radius_m: float = Field(gt=0)
    kind: Literal['cable-interior', 'duct-interior']


class SurfaceMeanCheck(Strict):
    entity: str = Field(min_length=1)
    reference_temperature_k: float = Field(gt=0)
    mean_temperature_k: float = Field(gt=0)
    absolute_error_k: float = Field(ge=0)
    surface_minimum_k: float = Field(gt=0)
    surface_maximum_k: float = Field(gt=0)


class AnalyticalSoilView(Strict):
    model: Literal['kennelly-image-line-sources']
    condition: Literal['operating']
    soil_thermal_resistivity_k_m_w: float = Field(gt=0)
    limitations: list[str] = Field(min_length=1)
    excluded_regions: list[ExcludedCircle] = Field(min_length=1)
    surface_check_method: Literal['mean-of-64-equal-angle-exterior-samples']
    surface_check_tolerance_k: Literal[0.1]
    surface_checks: list[SurfaceMeanCheck] = Field(min_length=1)

    @model_validator(mode='after')
    def checked(self):
        if {row.entity for row in self.surface_checks} != {region.entity for region in self.excluded_regions}:
            raise ValueError('解析土壤场：每个排除区域必须有对应外表面校核。')
        if any(row.absolute_error_k > self.surface_check_tolerance_k or
               abs(abs(row.mean_temperature_k-row.reference_temperature_k)-row.absolute_error_k) > 1e-9
               or not row.surface_minimum_k <= row.mean_temperature_k <= row.surface_maximum_k
               for row in self.surface_checks):
            raise ValueError('解析土壤场：外表面平均温度未通过0.1 K自检。')
        return self


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
    analytical_soil_view: AnalyticalSoilView | None = None
    engineering_approval: Literal[False] = False

    @model_validator(mode='after')
    def consistent(self):
        if len(self.temperature_k) != len(self.mesh.points) or any(not isfinite(t) or t <= 0 for t in self.temperature_k):
            raise ValueError('temperature_k：温度必须为正K并与节点一一对应。')
        if self.hotspot.temperature_k != max(self.temperature_k):
            raise ValueError('hotspot：必须是输出节点场的实际最大值。')
        if not any(tuple(point) == self.hotspot.point_m and value == self.hotspot.temperature_k
                   for point, value in zip(self.mesh.points, self.temperature_k)):
            raise ValueError('hotspot.point_m：必须指向最高温度的实际输出节点。')
        if (self.source.binding == 'iec-trace') != (self.analytical_soil_view is not None):
            raise ValueError('解析土壤场与来源绑定类型必须一致。')
        return self


class LimitCrossing(Strict):
    time_s: float=Field(ge=0)
    bracket_s: tuple[float,float]
    method: str=Field(min_length=1)

    @model_validator(mode='after')
    def bounded(self):
        if not 0<=self.bracket_s[0]<=self.time_s<=self.bracket_s[1]:
            raise ValueError('limit_crossing：到达时刻须位于实际求解时间步的非负区间内。')
        return self


class TemperatureCurve(Strict):
    entity: str=Field(min_length=1)
    time_s: list[float]=Field(min_length=2,max_length=10001)
    maximum_temperature_k: list[float]=Field(min_length=2,max_length=10001)
    mean_temperature_k: list[float]=Field(min_length=2,max_length=10001)
    peak_temperature_k: float=Field(gt=0)
    peak_time_s: float=Field(ge=0)
    temperature_limit_k: float=Field(gt=0)
    limit_status: Literal['reached','not_reached_in_simulated_interval']
    limit_crossing: LimitCrossing|None

    @model_validator(mode='after')
    def consistent(self):
        if len(self.time_s)!=len(self.maximum_temperature_k) or len(self.time_s)!=len(self.mean_temperature_k):
            raise ValueError('curves：时间、最高温度和平均温度数组须等长。')
        if self.time_s[0]!=0 or any(a>=b for a,b in zip(self.time_s,self.time_s[1:])):
            raise ValueError('curves.time_s：时间须从 0 s 开始并严格递增。')
        if any(mean<=0 or maximum<mean-1e-6 for maximum,mean in zip(self.maximum_temperature_k,self.mean_temperature_k)):
            raise ValueError('curves：平均温度须为正 K，且不得超过同一时间步的实际最高温度。')
        index=self.maximum_temperature_k.index(max(self.maximum_temperature_k))
        if self.peak_temperature_k!=self.maximum_temperature_k[index] or self.peak_time_s!=self.time_s[index]:
            raise ValueError('curves.peak：峰值及其时刻须来自已保存的时间步。')
        if (self.limit_status=='reached') != (self.limit_crossing is not None) or self.limit_crossing is not None and self.limit_crossing.bracket_s[1]>self.time_s[-1]:
            raise ValueError('curves.limit_crossing：温限状态与保存区间不一致，禁止外推。')
        return self


class TemperatureHistory(Strict):
    schema_version: Literal['cablesim.temperature-history/1']
    source: ArtifactSource
    temperature_unit: Literal['K']
    time_unit: Literal['s']
    curves: list[TemperatureCurve]=Field(min_length=1,max_length=64)
    maximum_temperature_k: float=Field(gt=0)
    maximum_time_s: float=Field(ge=0)
    maximum_entity: str=Field(min_length=1)
    solver: dict
    convergence: dict
    engineering_approval: Literal[False]=False

    @model_validator(mode='after')
    def peak(self):
        if len({curve.entity for curve in self.curves})!=len(self.curves):
            raise ValueError('curves.entity：导体实体不能重复。')
        worst=max(self.curves,key=lambda curve:curve.peak_temperature_k)
        if (worst.peak_temperature_k,worst.peak_time_s,worst.entity)!=(self.maximum_temperature_k,self.maximum_time_s,self.maximum_entity):
            raise ValueError('maximum_temperature_k：全局峰值须与实际导体时间曲线一致。')
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

    @model_validator(mode='before')
    @classmethod
    def si_temperature_axis(cls,value):
        if isinstance(value,dict) and 'values_k' in value:
            if 'values_c' in value:raise ValueError('不能同时提供SI和旧摄氏温度轴。')
            value=dict(value)
            temperatures=value.pop('values_k')
            if not isinstance(temperatures,list) or any(type(t) not in (int,float) for t in temperatures):
                raise ValueError('values_k：使用SI数值温度轴。')
            value['values_c']=[t-273.15 for t in temperatures]
        return value

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
