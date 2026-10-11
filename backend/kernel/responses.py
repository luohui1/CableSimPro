"""Typed public study responses; plugin extensions remain explicit JSON values."""
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, JsonValue
from .contracts import Method, StudyDefinition
from cablesim_sdk.ampacity import AmpacityBasis


class PublicResponse(BaseModel):
    model_config = ConfigDict(extra='allow')


class VersionChange(PublicResponse):
    kind: Literal['method', 'model'] = Field(description='Changed installed method or referenced model family; no unit.')
    code: str = Field(description='METHOD_VERSION_CHANGED, METHOD_UNAVAILABLE, MODEL_VERSION_CHANGED or informational METHOD_PRESENTATION_UPDATED.')
    id: str = Field(description='Stable plugin ID or model family ID, never a display-name match.')
    from_version: str = Field(description='Version frozen in the source run.')
    to_version: str | None = Field(description='Installed plugin or latest published model version; null if unavailable.')
    from_digest: str = Field(description='Frozen release/content SHA256.')
    to_digest: str | None = Field(description='Current release/content SHA256; detects changes even at the same version.')
    message: str = Field(description='Display-ready version difference.')
    classification: Literal['presentation_only', 'calculation_changed', 'unproven'] | None = Field(default=None, description='Proven release change class. Missing historical sealed manifest fails closed as unproven.')
    rule: str | None = Field(default=None, description='Versioned rule used to compare method version, sealed files/dependencies and executable contracts; no unit.')
    from_computation_digest: str | None = Field(default=None, description='SHA256 of historical computation identity under rule; null when evidence is absent.')
    to_computation_digest: str | None = Field(default=None, description='SHA256 of current computation identity under rule; equality proves presentation-only changes after both release digests are verified.')


class VersionStatus(PublicResponse):
    status: Literal['current', 'stale', 'empty'] = Field(description='Version comparison only; execution status and input freshness are separate.')
    reasons: list[VersionChange] = Field(default_factory=list)
    notices: list[VersionChange] = Field(default_factory=list, description='Informational presentation-only release changes; do not make the saved result stale. Clients may acknowledge once per new release digest.')
    display_name: str = Field(description='One combined status message for the result or document cover.')


class ModelReference(BaseModel):
    id: str | None = Field(description='Saved model identity or local cable type ID; not inferred from its name.')
    name: str | None
    version: str | None = Field(description='Saved referenced model version; null for an unversioned local domain model.')
    content_sha256: str | None = Field(description='Saved referenced model digest; null when there is no version binding.')


class StudyResponse(PublicResponse):
    id: UUID
    workspace: UUID
    revision: int = Field(ge=1, description='Study configuration revision.')
    definition: StudyDefinition
    created: str = Field(description='UTC configuration timestamp.')
    can_undo: bool = Field(default=False, description='Earlier study configuration exists; separate from workspace structure history.')
    can_redo: bool = Field(default=False, description='Later configuration on the active history branch exists.')
    latest_run_id: UUID | None = Field(default=None, description='Most recently accepted run; null before first execution.')
    latest_run: 'RunSummary | None' = Field(default=None, description='Verified latest-run status and producer headlines from the same read snapshot. No history, full field arrays or physical recalculation; null before execution.')
    latest_module_run_ids: dict[str, UUID] = Field(default_factory=dict, description='Latest saved run ID per configured module, from this read snapshot; allows on-demand module reads without loading history.')
    version_status: VersionStatus | None = Field(default=None, description='Version status of latest_run_id, computed at read time.')
    workspace_revision: int | None = Field(default=None, description='Current workspace revision for this read.', json_schema_extra={'readOnly': True})
    model_reference: ModelReference | None = Field(default=None, description='Model display identity from the saved workspace binding or local domain; null for standalone study input. Does not load the complete workspace payload.', json_schema_extra={'readOnly': True})


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


class QuantityResult(PublicResponse):
    key: str = Field(description='Stable physical quantity key declared by the plugin.')
    type: str = Field(description='Plugin result type; quantity for scalar engineering values.')
    entity: str = Field(description='Domain object ID to which this quantity belongs; no unit.')
    unit: str = Field(description='Physical unit of value; ampacity uses A (balanced RMS unless its basis states otherwise).')
    status: Literal['available', 'unavailable'] = Field(description='Whether the producer supplied a valid value; unavailable is never zero.')
    value: int | float | None = Field(default=None, description='Numeric result in the declared unit; absent when unavailable.')
    case: str | None = Field(default=None, description='Result condition identity; rating versus rating-simultaneous must not be merged.')
    reason: dict[str, JsonValue] | None = Field(default=None, description='Producer error code, explanation and field location for an unavailable quantity.')
    rating_basis: AmpacityBasis | None = Field(default=None, description='Producer-declared ampacity meaning and fixed loads. Absent in historical outputs; do not infer a common rating from an unlabelled value.')


class CheckCase(PublicResponse):
    case_id: str
    status: str
    results: list[QuantityResult]
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


class RemoteExecution(PublicResponse):
    backend: Literal['slurm']
    state: str = Field(description='Cached scheduler phase: preparing/submitted/queued/running/collecting, then the saved run terminal state. Not inferred from host running status.')
    job_id: str | None = None
    plan_id: str | None = None
    slurm_states: list[str] = Field(default_factory=list)
    actual_cpu_seconds: float | None = Field(default=None,ge=0)
    updated: str | None = None


class RunCase(CheckCase):
    error: dict[str, JsonValue] | None = None


class ResultSelector(PublicResponse):
    key: str = Field(description='Physical quantity key to select, such as ampacity.')
    entity: str = Field(description='Exact domain object ID to select; no unit.')
    unit: str = Field(description='Exact quantity unit to match, such as A.')
    case: str | None = Field(default=None, description='Exact producer result condition; omitted only when the producer has no condition identifier.')


class RunOutput(PublicResponse):
    cases: list[RunCase]
    default_result: ResultSelector | None = Field(default=None, description='Default sweep quantity identity; match all four keys, never choose the first ampacity. Missing results remain gaps.')


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
    output: RunOutput | None = Field(description='Saved typed quantities and verified artifacts; absent while running.')
    output_digest: str | None
    error: dict[str, JsonValue] | None
    created: str
    finished: str | None
    integrity: Literal['verified', 'corrupt']
    freshness: Literal['current', 'historical', 'unknown']
    version_status: VersionStatus | None = Field(default=None, description='Dynamic method/model version differences, outside the immutable result digest.')
    artifact_status: dict[str, JsonValue] = Field(default_factory=dict, description='Presentation contract verification by case and artifact type.')
    owner_epoch: str = Field(description='Host owner epoch at admission; not an authentication token.')
    execution_nonce: str = Field(description='Internal attempt identity; does not authorize execution.')
    method_availability: dict[str, JsonValue] | None = Field(default=None, description='Availability of the exact saved method release.')
    convergence: dict[str, JsonValue] | None = Field(default=None, description='Saved mesh/domain convergence gate; unconverged fields cannot enter a calculation book.')
    execution: RemoteExecution | None = None


class RunPage(PublicResponse):
    items: list[RunResponse]
    next_cursor: int | None


class RunDetailResponse(RunResponse):
    snapshot_view: Literal['inputs-on-demand'] = Field(description='Response projection only. Each snapshot case has input_ref instead of input; input_digest still identifies the full stored snapshot, which was verified before projection. Use view=full for the unchanged complete response.')


class RunCaseInput(PublicResponse):
    run_id: UUID
    case_id: str
    input: dict[str, JsonValue] = Field(description='Exact immutable accepted case input, never the current workspace.')
    input_digest: str = Field(description='Canonical SHA256 of this case input.')
    run_input_digest: str = Field(description='Canonical SHA256 of the full accepted run snapshot.')
    integrity: Literal['verified']


class RunSummarySnapshot(BaseModel):
    module: str | None = Field(description='Saved selected module; null means the root study configuration.')


class RunSummary(BaseModel):
    id: UUID
    workspace: UUID
    study: UUID
    sequence: int
    status: Literal['accepted', 'running', 'validating', 'succeeded', 'partial', 'failed', 'interrupted']
    created: str
    finished: str | None
    freshness: Literal['current', 'historical', 'unknown']
    integrity: Literal['verified', 'corrupt']
    version_status: VersionStatus | None
    snapshot: RunSummarySnapshot
    method: Method | None = Field(description='Exact saved method release; null when the snapshot integrity cannot be established.')
    task: str | None = Field(default=None, description='Task frozen in this accepted run; absent in older snapshots or when integrity fails. Never taken from the current study.')
    driver: dict[str, JsonValue] | None = Field(default=None, description='Saved run driver and its SI parameters; null when historical input does not declare one or integrity fails.')
    headline: str | None = Field(default=None, max_length=500, description='Producer-supplied conclusion from the saved successful case evidence, with quantity/unit/condition. The host selects the same verified case as its headline witness; no client inference. Null when unavailable.')
    error: dict[str, str] | None = Field(description='Saved run-level error code and message, each limited to 512 characters; full detail remains at GET runs/{rid}.')
    headlines: list[dict[str, JsonValue]] = Field(default_factory=list, max_length=3,
        description='Up to three producer-declared answers from verified sealed output; SI value and display conversion, entity, condition and same-case artifact digest. Empty when unavailable; no defaults.')


class RunSummaryPage(BaseModel):
    items: list[RunSummary]
    next_cursor: int | None


StudyResponse.model_rebuild()
