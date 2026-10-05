"""Typed public study responses; plugin extensions remain explicit JSON values."""
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, JsonValue
from .contracts import Method, StudyDefinition


class PublicResponse(BaseModel):
    model_config = ConfigDict(extra='allow')


class StudyResponse(PublicResponse):
    id: UUID
    workspace: UUID
    revision: int = Field(ge=1, description='Study configuration revision.')
    definition: StudyDefinition
    created: str = Field(description='UTC configuration timestamp.')


class TaskOption(PublicResponse):
    task: str
    module: str
    label: str
    method: Method
    analysis: str
    required_artifacts: list[str]
    execution_backend: Literal['local', 'slurm']
    input_contract_url: str
    parameters_unit_system: Literal['SI']
    limitations: list[str]


class PreflightIssue(PublicResponse):
    code: str = Field(description='Stable validation code.')
    message: str = Field(description='Human-readable correction.')
    path: str = Field(description='RFC 6901 JSON Pointer relative to the domain input; /parameters addresses method parameters. Array indices are zero-based, object keys escape ~ and /. No physical unit.')


class PreflightError(PreflightIssue):
    issues: list[PreflightIssue] = Field(default_factory=list, description='Individual invalid fields, each independently navigable.')


class CheckCase(PublicResponse):
    case_id: str
    status: str
    results: list[dict[str, JsonValue]]
    artifacts: dict[str, JsonValue]
    error: PreflightError | None = None
    evidence: dict[str, JsonValue] = Field(default_factory=dict)
    artifact_digests: dict[str, str] = Field(default_factory=dict, description='Original output file SHA256 by artifact type.')
    warnings: list[dict[str, JsonValue]] = Field(default_factory=list)
    method: Method | None = None


class PreflightResponse(PublicResponse):
    ready: bool
    partial: bool
    runnable_case_ids: list[str]
    cases: list[CheckCase]
    crosschecks: list[CheckCase]
    method_scopes: list[dict[str, JsonValue]]
    limitations: list[str]
    validation: dict[str, JsonValue]
    lock_digest: str = Field(pattern=r'^[0-9a-f]{64}$')
    input_digest: str = Field(pattern=r'^[0-9a-f]{64}$')


class RunResponse(PublicResponse):
    id: UUID
    workspace: UUID
    study: UUID
    sequence: int
    request_id: UUID = Field(description='Idempotency identity; repeated clicks reuse this exact run.')
    request_digest: str
    input_digest: str = Field(description='SHA256 of immutable accepted snapshot.')
    snapshot: dict[str, JsonValue] = Field(description='Saved domain/SI input, selected module, exact method, parameters and source bindings.')
    status: Literal['accepted', 'running', 'validating', 'succeeded', 'partial', 'failed', 'interrupted']
    output: dict[str, JsonValue] | None = Field(description='Saved typed quantities and verified artifacts; absent while running.')
    output_digest: str | None
    error: dict[str, JsonValue] | None
    created: str
    finished: str | None
    integrity: Literal['verified', 'corrupt']
    freshness: Literal['current', 'historical', 'unknown']
    artifact_status: dict[str, JsonValue] = Field(default_factory=dict, description='Presentation contract verification by case and artifact type.')
    owner_epoch: str = Field(description='Host owner epoch at admission; not an authentication token.')
    execution_nonce: str = Field(description='Internal attempt identity; does not authorize execution.')
    method_availability: dict[str, JsonValue] | None = Field(default=None, description='Availability of the exact saved method release.')
    convergence: dict[str, JsonValue] | None = Field(default=None, description='Saved mesh/domain convergence gate; unconverged fields cannot enter a calculation book.')


class RunPage(PublicResponse):
    items: list[RunResponse]
    next_cursor: int | None
