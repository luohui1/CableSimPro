"""Saved IEC/FEM comparison parameters and presentation contract (SI)."""
from typing import Literal
from pydantic import Field, field_validator, model_validator, model_serializer
from .base import StrictModel
from .simulation_artifacts import ArtifactSource


class Feedback(StrictModel):
    electrical: Literal['native_getdp']
    duct_air: Literal[True]
    conductor_model: Literal['r20_matched_continuum']
    source: str = Field(min_length=1)


class ComparisonParameters(StrictModel):
    section_id: str = Field(min_length=1)
    load_id: str = Field(min_length=1)
    iec: dict
    controls: dict
    bounds_m: tuple[float, float, float, float]
    mesh_scales: list[float] = Field(default=[1.5, 1., .75], min_length=3, max_length=6)
    domain_scale: float = Field(default=2., ge=2, le=4)
    temperature_tolerance_k: float = Field(default=.1, gt=0, le=.1)
    ampacity_tolerance_a: float = Field(default=.5, gt=0, le=1.)
    uniform_soil_counterfactual_acknowledged: bool = False
    frozen_coefficients_acknowledged: bool = False
    feedback: Feedback | None = None
    source: str = Field(min_length=1)

    @field_validator('frozen_coefficients_acknowledged',mode='before')
    @classmethod
    def explicit_scope(cls,value):
        if type(value) is not bool:raise ValueError('冻结口径确认必须为布尔值。')
        return value

    @model_serializer(mode='wrap')
    def preserve_historical_digest(self, handler):
        data = handler(self)
        if self.feedback is None:
            data.pop('feedback',None)
        return data

    @model_validator(mode='after')
    def numerical_scope(self):
        if self.feedback is None and not self.frozen_coefficients_acknowledged:
            raise ValueError('请明确确认冻结损耗和管内热阻的比较口径，或指定完整反馈模型。')
        if self.feedback is not None and self.frozen_coefficients_acknowledged:
            raise ValueError('反馈工况不能同时声明冻结系数。')
        if any(v <= 0 for v in self.mesh_scales) or any(a <= b for a,b in zip(self.mesh_scales,self.mesh_scales[1:])):
            raise ValueError('mesh_scales：至少三档严格递减的正倍率。')
        x0,z0,x1,z1 = self.bounds_m
        if not x0 < x1 or not z0 < z1 or z1 != 0:
            raise ValueError('bounds_m：填写 [左边界,底边界,右边界,0]，单位 m。')
        return self


class MethodResult(StrictModel):
    status: Literal['available', 'unavailable']
    ampacity_a: float | None = Field(default=None, gt=0)
    operating_temperature_k: float | None = Field(default=None, gt=0)
    basis: str

    @model_validator(mode='after')
    def availability(self):
        values = (self.ampacity_a, self.operating_temperature_k)
        if (self.status == 'available' and any(v is None for v in values)) or (self.status == 'unavailable' and any(v is not None for v in values)):
            raise ValueError('不可用方法不得发布可用数值；可用方法须含电流和温度。')
        return self


class ComparisonArtifact(StrictModel):
    schema_version: Literal['cablesim.iec-fem-comparison/1']
    source: ArtifactSource
    parameters_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    section_id: str
    load_id: str
    rated_circuit: str
    valid: bool
    iec: MethodResult
    fem: MethodResult
    iec_over_fem_percent: float | None
    judgment: Literal['conservative','nonconservative','within_numerical_tolerance','unavailable']
    conclusion: str
    assumption_checks: list[dict]
    convergence: dict
    clauses: list[str]
    limitations: list[str]
    decomposition: dict | None = None
    authority: Literal['reference_only'] = 'reference_only'
    engineering_approval: Literal[False] = False

    @model_validator(mode='after')
    def verified_numbers(self):
        if self.valid:
            if self.iec.status != 'available' or self.fem.status != 'available' or self.iec_over_fem_percent is None or self.judgment == 'unavailable':
                raise ValueError('有效比较须有两个完整结果及偏差。')
            if any(self.convergence.get(k) != 'converged' for k in ('solver_status','mesh_status','domain_status')):
                raise ValueError('比较结论须同时通过求解、网格和计算域收敛。')
        elif self.fem.status != 'unavailable' or self.iec_over_fem_percent is not None or self.judgment != 'unavailable':
            raise ValueError('未收敛时仅保留诊断，不给有限元数值或偏差结论。')
        if self.decomposition and self.decomposition.get('status') == 'available':
            rows = self.decomposition.get('counterfactuals',[])
            factors = self.decomposition.get('contributions',[])
            if not self.valid or len(rows)!=8 or {r.get('mask') for r in rows} != set(range(8)):
                raise ValueError('有效分解需全部8种反事实工况。')
            if len(factors)!=3 or {r.get('key') for r in factors}!={'soil','duct_air','losses'}:
                raise ValueError('分解需土层、管内热阻、损耗三项。')
            if any(r.get('valid') is not True for r in rows):
                raise ValueError('每种反事实工况均须通过收敛门禁。')
            total = sum(r['percentage_points'] for r in factors)+self.decomposition['baseline_residual_percentage_points']
            if abs(total-self.iec_over_fem_percent)>1e-8:
                raise ValueError('三项贡献与基线残差之和须等于实际偏差。')
        return self
