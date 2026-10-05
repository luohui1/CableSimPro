"""Public study commands. Execution accepts identities, never replacement inputs."""
from typing import Literal
import json
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from ..schemas import StrictModel
from ..domain.models import Source
from .simulation_parameters import TransientParameters, SheathLossParameters, CoupledParameters, SIMULATION_PARAMETER_MODELS


class Method(StrictModel):
    plugin_id: str = Field(description='Installed plugin identity.')
    capability: str = Field(description='Declared capability identity in this exact release.')
    version: str = Field(description='Exact plugin version; never resolve latest implicitly.')
    release_digest: str = Field(pattern=r'^[0-9a-f]{64}$', description='Sealed release manifest SHA256.')


class LossArtifactReference(StrictModel):
    run_id: UUID
    case_id: str = Field(min_length=1,max_length=120,strict=True)
    artifact_type: Literal['x-cablesim.loss-coefficients']
    artifact_sha256: str = Field(pattern=r'^[0-9a-f]{64}$',strict=True)


class NativeArtifactReference(StrictModel):
    run_id: UUID
    case_id: str = Field(min_length=1,max_length=120,strict=True)
    artifact_type: Literal['x-cablesim.native-bundle']
    artifact_sha256: str = Field(pattern=r'^[0-9a-f]{64}$',strict=True)


class Sample(StrictModel):
    label: str = Field(min_length=1, max_length=120)
    changes: dict[str, float] = Field(default_factory=dict)


class BatchCase(StrictModel):
    case_id: str = Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$')
    label: str = Field(min_length=1, max_length=120)
    input: dict
    parameters: dict = Field(default_factory=dict)
    metadata: dict = Field(default_factory=dict)


class CandidateFilters(StrictModel):
    voltage_v: float | None = Field(default=None,gt=0)
    conductor: Literal['copper_bare','copper_coated','aluminium'] | None = None
    minimum_area_m2: float | None = Field(default=None,gt=0)
    maximum_area_m2: float | None = Field(default=None,gt=0)

    @model_validator(mode='after')
    def interval(self):
        if self.minimum_area_m2 is not None and self.maximum_area_m2 is not None and self.minimum_area_m2>self.maximum_area_m2:
            raise ValueError('候选截面下限不能超过上限；单位m²。')
        return self


class Driver(StrictModel):
    kind: Literal['single', 'sweep', 'selection', 'crosscheck', 'batch'] = 'single'
    cases: list[BatchCase] = Field(default_factory=list, max_length=100)
    selected_case_ids: list[str] | None = Field(default=None, max_length=100)
    samples: list[Sample] = Field(default_factory=list, max_length=100)
    candidate_ids: list[str] = Field(default_factory=list, max_length=100)
    target_key: str = 'ampacity'
    target_entity: str = 'circuit/c1'
    target_entities: list[str] = Field(default_factory=list, max_length=100)
    target_unit: str = 'A'
    target_condition: str | None = Field(default=None, min_length=1, max_length=120)
    rating_basis: Literal['individual', 'simultaneous'] = Field(default='individual', description='Ampacity selection basis: individual circuit increase with other saved loads held, or common balanced RMS current in all circuits simultaneously.')
    minimum: float | None = None
    allow_demo_candidates: bool = Field(default=False,strict=True)
    candidate_filters: CandidateFilters = Field(default_factory=CandidateFilters)

    @model_validator(mode='after')
    def complete(self):
        if self.kind == 'batch':
            if not self.cases or self.samples or self.candidate_ids:
                raise ValueError('批量工况必须保存完整输入，不能混入扫描或型号候选')
            if len({c.case_id for c in self.cases}) != len(self.cases):
                raise ValueError('批量工况标识不能重复')
            if self.selected_case_ids is not None and (len(set(self.selected_case_ids)) != len(self.selected_case_ids)
                    or not set(self.selected_case_ids) <= {c.case_id for c in self.cases}):
                raise ValueError('所选工况须为保存列表中的唯一标识')
        elif self.cases:
            raise ValueError('完整工况列表仅用于批量运行')
        elif self.selected_case_ids is not None:
            raise ValueError('工况选择仅用于批量运行')
        if self.kind in ('single', 'crosscheck') and (self.samples or self.candidate_ids):
            raise ValueError('单次研究不能带扫描点')
        if self.kind in ('sweep', 'selection') and not (self.samples or self.candidate_ids):
            raise ValueError('扫描和选型必须提供明确的候选，不插值或外推')
        if self.kind == 'selection' and self.minimum is None:
            raise ValueError('选型需要明确目标阈值')
        if self.kind == 'selection' and self.target_unit == 'A' and (self.minimum is None or self.minimum <= 0):
            raise ValueError('选型目标电流必须大于0 A')
        if len(set(self.target_entities))!=len(self.target_entities):
            raise ValueError('目标对象不能重复')
        if self.candidate_ids and (self.kind != 'selection' or self.samples or len(set(self.candidate_ids)) != len(self.candidate_ids)):
            raise ValueError('型号候选只用于选型，且不能重复或混入数值扫描')
        return self


class CrosscheckMethod(StrictModel):
    method: Method
    parameters: dict = Field(default_factory=dict)


class CandidateCompletion(StrictModel):
    method: Method
    parameters: dict


class ThermalConvergence(StrictModel):
    kind: Literal['temperature-field'] = 'temperature-field'
    mesh_case_ids: list[str] = Field(min_length=3, max_length=12)
    domain_case_id: str = Field(min_length=1, max_length=120)
    tolerance_k: float = Field(default=0.1, gt=0, le=0.1)

    @model_validator(mode='after')
    def separate_cases(self):
        if len(set(self.mesh_case_ids)) != len(self.mesh_case_ids) or self.domain_case_id in self.mesh_case_ids:
            raise ValueError('网格与加倍域必须是不同的完整运行工况')
        return self


class StudyConfiguration(StrictModel):
    title: str = Field(min_length=1, max_length=120)
    task: Literal['rating', 'operating', 'target', 'transient-temperature', 'sheath-losses', 'electrothermal-steady'] | None = Field(default=None, description='Study objective; simulation tasks submit asynchronously to Slurm.')
    method: Method
    input_source: Literal['domain', 'study'] = 'domain'
    method_input: dict | None = None
    parameters: dict | TransientParameters | SheathLossParameters | CoupledParameters = Field(default_factory=dict, description='Saved capability parameters. Simulation task models are exposed in OpenAPI; other plugins use GET /api/input-contracts parameter_schema. SI lengths m, time s, temperature K, RMS current A.')
    input_sources: dict[str, Source] = Field(default_factory=dict)
    candidate_completions: dict[str,CandidateCompletion] = Field(default_factory=dict,max_length=100)
    driver: Driver = Field(default_factory=Driver)
    crosschecks: list[CrosscheckMethod] = Field(default_factory=list, max_length=5)
    verification: ThermalConvergence | None = None

    @model_validator(mode='after')
    def input_binding(self):
        if self.task in SIMULATION_PARAMETER_MODELS:
            from pydantic import ValidationError
            raw = self.parameters if isinstance(self.parameters, dict) else self.parameters.model_dump(mode='json', exclude_unset=True)
            try:
                SIMULATION_PARAMETER_MODELS[self.task].model_validate_json(json.dumps(raw, allow_nan=False), strict=True)
            except ValidationError as error:
                raise ValueError('；'.join('parameters.'+'.'.join(map(str,e['loc']))+'：'+e['msg'] for e in error.errors())) from None
            self.parameters = raw
        json.dumps(self.model_dump(mode='json'), allow_nan=False)
        if (self.input_source == 'study') != (self.method_input is not None):
            raise ValueError('独立方法输入必须显式保存；工程输入不得被另一套输入覆盖')
        if (self.driver.kind == 'crosscheck') != bool(self.crosschecks):
            raise ValueError('交叉校核必须列出明确的对照方法')
        if self.verification is not None and self.driver.kind != 'sweep':
            raise ValueError('温度场收敛核验必须保存明确的网格和计算域扫描')
        return self


class StudyDefinition(StudyConfiguration):
    modules: dict[str, StudyConfiguration] = Field(default_factory=dict, max_length=12, description='Independently configured study modules; each freezes its own method and parameters at run acceptance.')

    @field_validator('modules')
    @classmethod
    def module_names(cls, value):
        import re
        if any(not re.fullmatch(r'[a-z][a-z0-9-]{0,63}', key) for key in value):
            raise ValueError('模块标识须为小写字母、数字和连字符')
        return value


class CreateStudy(StudyDefinition):
    expected_revision: int = Field(ge=1)


class UpdateStudy(CreateStudy):
    expected_study_revision: int = Field(ge=1)


class RunStudy(StrictModel):
    module: str | None = Field(default=None, pattern=r'^[a-z][a-z0-9-]{0,63}$')
    request_id: UUID
    expected_revision: int = Field(ge=1)
    expected_study_revision: int = Field(ge=1)
    lock_digest: str = Field(pattern=r'^[0-9a-f]{64}$')
    scope_acknowledged: Literal[True]

    @field_validator('scope_acknowledged', mode='before')
    @classmethod
    def explicit_acknowledgement(cls, value):
        if value is not True:
            raise ValueError('必须明确确认适用范围')
        return value


class RunArguments(StrictModel):
    module: str | None = Field(default=None, pattern=r'^[a-z][a-z0-9-]{0,63}$')
    study_id: UUID
    expected_study_revision: int = Field(ge=1)
    lock_digest: str = Field(pattern=r'^[0-9a-f]{64}$')
    scope_acknowledged: Literal[True]

    @field_validator('scope_acknowledged', mode='before')
    @classmethod
    def explicit_acknowledgement(cls, value):
        return RunStudy.explicit_acknowledgement(value)


class Comparison(StrictModel):
    run_ids: list[UUID] = Field(min_length=2, max_length=10)


class DeliveryRequest(StrictModel):
    run_ids: list[UUID] = Field(min_length=1, max_length=10)
