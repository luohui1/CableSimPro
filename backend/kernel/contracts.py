"""Public study commands. Execution accepts identities, never replacement inputs."""
from typing import Literal
import json
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from ..schemas import StrictModel
from ..domain.models import Source


class Method(StrictModel):
    plugin_id: str
    capability: str
    version: str
    release_digest: str = Field(pattern=r'^[0-9a-f]{64}$')


class Sample(StrictModel):
    label: str = Field(min_length=1, max_length=120)
    changes: dict[str, float] = Field(default_factory=dict)


class Driver(StrictModel):
    kind: Literal['single', 'sweep', 'selection', 'crosscheck'] = 'single'
    samples: list[Sample] = Field(default_factory=list, max_length=100)
    candidate_ids: list[str] = Field(default_factory=list, max_length=100)
    target_key: str = 'ampacity'
    target_entity: str = 'circuit/c1'
    target_unit: str = 'A'
    target_condition: str | None = Field(default=None, min_length=1, max_length=120)
    minimum: float | None = None

    @model_validator(mode='after')
    def complete(self):
        if self.kind in ('single', 'crosscheck') and (self.samples or self.candidate_ids):
            raise ValueError('单次研究不能带扫描点')
        if self.kind in ('sweep', 'selection') and not (self.samples or self.candidate_ids):
            raise ValueError('扫描和选型必须提供明确的候选，不插值或外推')
        if self.kind == 'selection' and self.minimum is None:
            raise ValueError('选型需要明确目标阈值')
        if self.candidate_ids and (self.kind != 'selection' or self.samples or len(set(self.candidate_ids)) != len(self.candidate_ids)):
            raise ValueError('型号候选只用于选型，且不能重复或混入数值扫描')
        return self


class CrosscheckMethod(StrictModel):
    method: Method
    parameters: dict = Field(default_factory=dict)


class StudyDefinition(StrictModel):
    title: str = Field(min_length=1, max_length=120)
    task: Literal['rating', 'operating', 'target'] | None = None
    method: Method
    input_source: Literal['scenario', 'domain', 'study'] = 'scenario'
    method_input: dict | None = None
    parameters: dict = Field(default_factory=dict)
    input_sources: dict[str, Source] = Field(default_factory=dict)
    driver: Driver = Field(default_factory=Driver)
    crosschecks: list[CrosscheckMethod] = Field(default_factory=list, max_length=5)

    @model_validator(mode='after')
    def input_binding(self):
        json.dumps(self.model_dump(mode='json'), allow_nan=False)
        if (self.input_source == 'study') != (self.method_input is not None):
            raise ValueError('独立方法输入必须显式保存；工程输入不得被另一套输入覆盖')
        if (self.driver.kind == 'crosscheck') != bool(self.crosschecks):
            raise ValueError('交叉校核必须列出明确的对照方法')
        return self


class CreateStudy(StudyDefinition):
    expected_revision: int = Field(ge=1)


class UpdateStudy(CreateStudy):
    expected_study_revision: int = Field(ge=1)


class RunStudy(StrictModel):
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
