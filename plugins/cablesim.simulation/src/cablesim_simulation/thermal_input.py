"""统一二维热场输入：显式模型和领域文档均生成相同的可追溯模型。"""
from math import hypot, isfinite, pi
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Layer(Strict):
    uid: str
    role: str
    outer_radius_m: float = Field(gt=0)
    k_w_m_k: float | None
    fixed_heat_w_m: float = Field(ge=0)


class Electrical(Strict):
    r20_ohm_m: float = Field(gt=0)
    alpha20_per_k: float = Field(ge=0)
    ac_extra_factor: float = Field(ge=0)
    sheath_loss_factor: float = Field(ge=0)
    sheath_layer_uid: str | None
    source: str = Field(min_length=1)


class Duct(Strict):
    uid: str
    inner_radius_m: float = Field(gt=0)
    outer_radius_m: float = Field(gt=0)
    k_w_m_k: float = Field(gt=0)
    air_resistance_k_m_w: float = Field(gt=0)
    source: str = Field(min_length=1)


class Cable(Strict):
    uid: str
    circuit: str
    x_m: float
    z_m: float
    layers: list[Layer] = Field(min_length=1, max_length=32)
    current_a: float = Field(ge=0)
    electrical: Electrical | None
    prescribed_core_temperature_k: float | None
    temperature_limit_k: float = Field(gt=0)
    duct: Duct | None

    @model_validator(mode='after')
    def check(self):
        rs = [l.outer_radius_m for l in self.layers]
        if any(a >= b for a, b in zip(rs, rs[1:])) or len({l.uid for l in self.layers}) != len(rs):
            raise ValueError('层半径必须严格递增，UID必须唯一。')
        if self.layers[0].role != 'conductor':
            raise ValueError('第一层必须为圆形导体。')
        for i,l in enumerate(self.layers):
            if l.k_w_m_k is None:
                if i or self.prescribed_core_temperature_k is None:
                    raise ValueError('除给定温度的芯孔外，每层必须有明确热导率。')
            elif l.k_w_m_k <= 0:
                raise ValueError('热导率必须为正。')
        if self.prescribed_core_temperature_k is not None:
            if self.prescribed_core_temperature_k <= 0 or self.electrical or self.layers[0].fixed_heat_w_m:
                raise ValueError('给定芯温和导体热源/电阻驱动不能同时指定。')
        if self.current_a and self.electrical is None:
            raise ValueError('有电流时必须提供电阻和损耗模型。')
        if self.electrical and self.electrical.sheath_loss_factor:
            if self.electrical.sheath_layer_uid not in {l.uid for l in self.layers[1:]}:
                raise ValueError('护套损耗必须绑定实际非导体层。')
        if self.duct and not rs[-1] < self.duct.inner_radius_m < self.duct.outer_radius_m:
            raise ValueError('电缆必须严格位于同心管内。')
        return self


class Region(Strict):
    uid: str
    bounds_m: tuple[float,float,float,float]
    k_w_m_k: float = Field(gt=0)

    @model_validator(mode='after')
    def ordered(self):
        x0,z0,x1,z1 = self.bounds_m
        if x1 <= x0 or z1 <= z0:
            raise ValueError('矩形区域范围必须有正宽高。')
        return self


class Boundary(Strict):
    kind: Literal['temperature','convection','insulated']
    temperature_k: float | None
    h_w_m2_k: float | None
    emissivity: float | None

    @model_validator(mode='after')
    def physical(self):
        if self.kind != 'insulated' and (self.temperature_k is None or self.temperature_k <= 0):
            raise ValueError('换热或温度边界必须明确环境绝对温度。')
        if self.kind == 'convection':
            if self.h_w_m2_k is None or self.h_w_m2_k <= 0 or self.emissivity is None or not 0 <= self.emissivity <= 1:
                raise ValueError('对流边界需要明确h和发射率（无辐射须显式填0）。')
        elif self.h_w_m2_k is not None or self.emissivity is not None:
            raise ValueError('仅对流边界接受h和辐射参数。')
        return self


class Environment(Strict):
    kind: Literal['ground','isolated_cables']
    background: Region | None
    soil_layers: list[Region]
    backfills: list[Region]
    boundaries: dict[str,Boundary]

    @model_validator(mode='after')
    def check(self):
        expected = {'top','bottom','left','right'} if self.kind == 'ground' else {'surface'}
        if set(self.boundaries) != expected:
            raise ValueError('必须逐一指定全部外边界。')
        if self.kind == 'ground':
            if self.background is None or abs(self.background.bounds_m[3]) > 1e-12:
                raise ValueError('地下模型背景矩形必须以z=0为地表。')
            x0,z0,x1,z1 = self.background.bounds_m
            for r in self.soil_layers+self.backfills:
                a,b,c,d = r.bounds_m
                if a < x0 or b < z0 or c > x1 or d > z1:
                    raise ValueError('材料区域必须位于计算域内。')
            for group in (self.soil_layers,self.backfills):
                for i,a in enumerate(group):
                    for b in group[i+1:]:
                        if min(a.bounds_m[2],b.bounds_m[2]) > max(a.bounds_m[0],b.bounds_m[0])+1e-12 and min(a.bounds_m[3],b.bounds_m[3]) > max(a.bounds_m[1],b.bounds_m[1])+1e-12:
                            raise ValueError('同类土层或回填区域不能重叠。')
        elif self.background is not None or self.soil_layers or self.backfills:
            raise ValueError('孤立空气电缆仅在电缆表面指定边界，不接受伪空气导热域。')
        if all(b.kind == 'insulated' for b in self.boundaries.values()):
            raise ValueError('所有外边界绝热不能构成可散热的稳态模型。')
        return self


class ThermalModel(Strict):
    schema_version: Literal['cablesim.thermal-model/1']
    cables: list[Cable] = Field(min_length=1,max_length=64)
    environment: Environment
    provenance: dict[str,dict]
    assumptions: list[str]

    @model_validator(mode='after')
    def check(self):
        uids = [c.uid for c in self.cables]+[l.uid for c in self.cables for l in c.layers]
        uids += [c.duct.uid for c in self.cables if c.duct]
        if len(set(uids)) != len(uids):
            raise ValueError('电缆和层UID必须全局唯一。')
        if not self.provenance:
            raise ValueError('物理输入必须保留来源索引。')
        for i,c in enumerate(self.cables):
            r = c.duct.outer_radius_m if c.duct else c.layers[-1].outer_radius_m
            for d in self.cables[i+1:]:
                s = d.duct.outer_radius_m if d.duct else d.layers[-1].outer_radius_m
                if hypot(c.x_m-d.x_m,c.z_m-d.z_m) <= r+s+1e-9:
                    raise ValueError('重叠或点接触需专用接触拓扑，本方法要求正间隙。')
            if self.environment.kind == 'ground':
                x0,z0,x1,z1 = self.environment.background.bounds_m
                if c.x_m-r <= x0 or c.x_m+r >= x1 or c.z_m-r <= z0 or c.z_m+r >= z1:
                    raise ValueError('电缆/排管必须严格在土壤域内。')
            elif c.duct:
                raise ValueError('孤立空气模式不支持排管。')
        return self


class Controls(Strict):
    operation: Literal['temperature','ampacity']
    mesh_size_m: float = Field(gt=0)
    far_mesh_size_m: float = Field(gt=0)
    mesh_transition_m: float = Field(gt=0)
    max_nodes: int = Field(ge=100,le=70000)
    tolerance_k: float = Field(gt=0,le=.01)
    max_iterations: int = Field(ge=2,le=500)
    relaxation: float = Field(gt=0,le=1)
    current_upper_a: float = Field(gt=0)
    current_tolerance_a: float = Field(gt=0,le=1)
    rated_circuit: str | None


def prepare(value, parameters):
    if set(parameters)-{'controls','domain_options','reproduction'}:
        raise ValueError('未知的热场研究参数。')
    if parameters.get('reproduction',{}).get('missing_inputs'):
        raise ValueError('论文工况有未补齐输入，禁止使用默认值求解。')
    controls = Controls.model_validate(parameters['controls'])
    if value.get('schema_version') == 'cablesim.domain/1':
        from .thermal_domain import from_domain
        model = from_domain(value,parameters.get('domain_options',{}))
    else:
        if parameters.get('domain_options'):
            raise ValueError('显式热模型不能再叠加领域覆盖参数。')
        model = ThermalModel.model_validate(value)
    if controls.far_mesh_size_m < controls.mesh_size_m:
        raise ValueError('远场网格尺寸不能小于局部网格。')
    if controls.operation == 'ampacity':
        selected = [c for c in model.cables if c.circuit == controls.rated_circuit]
        if not selected or any(c.electrical is None or c.prescribed_core_temperature_k is not None for c in selected):
            raise ValueError('反求电流必须选择有完整电阻模型且未指定芯温的回路。')
    return model,controls
