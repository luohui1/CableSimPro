"""Solver-neutral SI wire contract; independent of the host and numerical solvers."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Material(Strict):
    k_w_m_k: float | None = Field(default=None, gt=0)
    heat_capacity_j_m3_k: float | None = Field(default=None, gt=0)
    conductivity_s_m: float | None = Field(default=None, ge=0)
    relative_permeability: float | None = Field(default=None, gt=0)
    relative_permeability_loss: float = Field(default=0, ge=0)
    relative_permittivity: float | None = Field(default=None, gt=0)
    source: str = Field(min_length=1)


class Shape(Strict):
    uid: str = Field(min_length=1)
    kind: Literal['rectangle','disk']
    values: list[float]
    material: Material
    void: bool = False

    @model_validator(mode='after')
    def valid(self):
        a = self.values
        if self.kind == 'disk' and (len(a) != 3 or a[2] <= 0):
            raise ValueError('圆域需要x,z,正半径。')
        if self.kind == 'rectangle' and (len(a) != 4 or a[2] <= a[0] or a[3] <= a[1]):
            raise ValueError('矩形需要有正面积的x0,z0,x1,z1。')
        return self


class Condition(Strict):
    uid: str
    selector: Literal['outer','x','z','circle']
    values: list[float]
    kind: Literal['temperature','convection','insulated','magnetic_potential']
    value: float | None
    h_w_m2_k: float | None = Field(default=None,gt=0)


class Excitation(Strict):
    regions: list[str] = Field(min_length=1)
    kind: Literal['heat_w_m','current_rms_a','voltage_gradient_v_m','impressed_current_rms_a']
    connection: Literal['parallel', 'series'] = 'parallel'
    value: list[float] = Field(min_length=1,max_length=2)
    # Piecewise constant heat factors, at time t the latest entry applies.
    schedule: list[tuple[float,float]] = Field(default_factory=list)
    source: str = Field(min_length=1)


class Time(Strict):
    initial_temperature_k: float = Field(gt=0)
    step_s: float = Field(gt=0)
    steps: int = Field(ge=1,le=10000)
    bdf_order: Literal[1,2] = 1


class CurrentProbe(Strict):
    region: str
    point_m: tuple[float,float]
    source: str = Field(min_length=1)


class CircuitBranch(Strict):
    region: str=Field(min_length=1)
    nodes: tuple[int,int]

    @model_validator(mode='after')
    def distinct(self):
        if self.nodes[0]==self.nodes[1] or min(self.nodes)<1:
            raise ValueError('electrical_networks.branches.nodes：两个不同的正节点标识，禁止隐式自环。')
        return self


class ElectricalNetwork(Strict):
    id: str=Field(min_length=1)
    branches: list[CircuitBranch]=Field(min_length=2,max_length=256)
    source: str=Field(min_length=1)


class Problem(Strict):
    schema_version: Literal['cablesim.simulation-problem/1']
    physics: Literal['steady_heat','transient_heat','magnetic_harmonic']
    geometry: list[Shape] = Field(min_length=1,max_length=256)
    boundaries: list[Condition] = Field(min_length=1,max_length=64)
    excitations: list[Excitation]
    frequency_hz: float | None = Field(default=None,gt=0)
    time: Time | None = None
    probes_m: list[tuple[float,float]] = Field(default_factory=list,max_length=100)
    current_probes: list[CurrentProbe] = Field(default_factory=list,max_length=100)
    temperature_regions: dict[str,list[str]] = Field(default_factory=dict,max_length=100)
    axial_lengths_m: dict[str,float] = Field(default_factory=dict,max_length=256)
    electrical_networks: list[ElectricalNetwork] = Field(default_factory=list,max_length=32)
    provenance: dict = Field(min_length=1)
    assumptions: list[str]

    @model_validator(mode='after')
    def complete(self):
        ids = [r.uid for r in self.geometry]
        if len(ids) != len(set(ids)):
            raise ValueError('区域UID必须唯一。')
        magnetic = self.physics == 'magnetic_harmonic'
        if magnetic != (self.frequency_hz is not None) or (self.physics == 'transient_heat') != (self.time is not None):
            raise ValueError('物理类型与频率/时间参数不匹配。')
        for r in self.geometry:
            m = r.material
            if r.void:
                continue
            if magnetic and (m.conductivity_s_m is None or m.relative_permeability is None):
                raise ValueError('电磁区域必须给出sigma和mur，包括非导电区域的显式0。')
            if not magnetic and m.k_w_m_k is None:
                raise ValueError('热区域缺k。')
            if self.time and m.heat_capacity_j_m3_k is None:
                raise ValueError('瞬态区域缺体积热容。')
        used = set()
        for e in self.excitations:
            if not set(e.regions) <= set(ids) or used.intersection(e.regions) or len(set(e.regions)) != len(e.regions):
                raise ValueError('激励区域缺失或重复。')
            if e.connection == 'series' and (not magnetic or len(e.regions) < 2 or e.kind != 'voltage_gradient_v_m' or any(e.value)):
                raise ValueError('excitations.connection：串联组需要至少两个导电区域，当前仅支持显式零总电压梯度。')
            used.update(e.regions)
            if magnetic == (e.kind == 'heat_w_m'):
                raise ValueError('激励与物理类型不匹配。')
            if not magnetic and (len(e.value) != 1 or e.value[0] < 0):
                raise ValueError('热源必须是非负实数W/m。')
            if e.schedule:
                if not self.time or e.schedule[0][0] != 0 or any(a[0]>=b[0] for a,b in zip(e.schedule,e.schedule[1:])) or any(t<0 or v<0 for t,v in e.schedule):
                    raise ValueError('负荷表必须从0开始，时间严格递增、热源倍数非负。')
                if any(abs(t/self.time.step_s-round(t/self.time.step_s))>1e-8 for t,_ in e.schedule):
                    raise ValueError('负荷切换时间必须落在时间步边界。')
        if magnetic:
            conducting = {r.uid for r in self.geometry if not r.void and r.material.conductivity_s_m > 0}
            network_regions=[branch.region for network in self.electrical_networks for branch in network.branches]
            if (len(network_regions)!=len(set(network_regions)) or not set(network_regions)<=conducting or used.intersection(network_regions) or
                    len({network.id for network in self.electrical_networks})!=len(self.electrical_networks)):
                raise ValueError('electrical_networks：每个真实导电区域只绑定一个已说明来源的网络或独立激励。')
            if self.axial_lengths_m and (set(self.axial_lengths_m)!=conducting or any(length<=0 for length in self.axial_lengths_m.values())):
                raise ValueError('axial_lengths_m：须逐个导电区域给出正轴向长度，单位 m。')
            impressed = {u for e in self.excitations if e.kind=='impressed_current_rms_a' for u in e.regions}
            for e in self.excitations:
                if e.kind=='impressed_current_rms_a' and (len(e.regions)!=1 or e.connection!='parallel'):
                    raise ValueError('excitations：给定均匀电流源需要单个非导电实体区域，不接受互联约束。')
            if any(r.uid in impressed and (r.void or r.material.conductivity_s_m!=0) for r in self.geometry):
                raise ValueError('excitations：给定均匀电流源的 conductivity_s_m 必须显式为0；不同时求解源域涡流。')
            if (used-impressed)|set(network_regions) != conducting:
                raise ValueError('每个导电区域必须显式指定电流/电压或互联组；零净电流不能默认猜测。')
            if any(probe.region not in conducting for probe in self.current_probes):
                raise ValueError('电流密度测点必须绑定导电区域。')
        elif self.current_probes:
            raise ValueError('热问题不接受电流密度测点。')
        elif self.axial_lengths_m or self.electrical_networks:
            raise ValueError('electrical_networks/axial_lengths_m：仅用于明确的二维时谐电路分段。')
        observed=[uid for group in self.temperature_regions.values() for uid in group]
        if self.temperature_regions and (magnetic or any(not entity or not group for entity,group in self.temperature_regions.items()) or
                not set(observed)<=set(ids) or len(observed)!=len(set(observed)) or
                any(region.uid in observed and region.void for region in self.geometry)):
            raise ValueError('temperature_regions：逐个实体绑定非空且不重复的实际热实体区域。')
        for b in self.boundaries:
            expected = {'outer':0,'x':1,'z':1,'circle':3}[b.selector]
            if len(b.values) != expected or (b.kind != 'insulated' and b.value is None):
                raise ValueError('边界选择器/值不完整。')
            if magnetic != (b.kind == 'magnetic_potential'):
                raise ValueError('边界与物理类型不匹配。')
            if b.kind == 'convection' and b.h_w_m2_k is None:
                raise ValueError('Robin边界缺h。')
            if b.kind in ('temperature','convection') and b.value<=0:
                raise ValueError('热边界必须使用正的绝对温度K。')
        if self.physics=='steady_heat' and all(b.kind=='insulated' for b in self.boundaries):
            raise ValueError('全绝热稳态问题没有温度基准或散热路径。')
        return self


class MeshControls(Strict):
    size_m: float = Field(gt=0)
    far_size_m: float = Field(gt=0)
    transition_m: float = Field(gt=0)
    max_nodes: int = Field(default=60000,ge=100,le=4000000)
    probe_cell_size_m: float | None = Field(default=None,gt=0)
    exterior_growth_start_m: float | None = Field(default=None,gt=0)
    exterior_growth_rate: float = Field(default=0.1,gt=0,le=0.25)
    field_order: Literal[1,2] | None = None
    minimum_circle_segments: int = Field(default=8,ge=8,le=512)

    @model_validator(mode='after')
    def consistent(self):
        if self.far_size_m < self.size_m:
            raise ValueError('mesh.far_size_m：远场尺寸不能小于近场 size_m；两者单位均为 m。')
        return self


def validate(value, controls):
    return Problem.model_validate(value), MeshControls.model_validate(controls)

