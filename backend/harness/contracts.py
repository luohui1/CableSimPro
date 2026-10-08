"""Task-side contracts; engineering documents and solver states stay in kernel/SDK."""
from dataclasses import dataclass
import os
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, JsonValue

from backend.schemas import StrictModel

TaskState = Literal['created','planning','running','waiting','reviewing','completed','blocked','failed','cancelled']
NodeState = Literal['pending','issued','running','succeeded','failed','unknown','cancelled']
WaitReason = Literal['missing_input','scope_confirmation','external_job','capability','budget','human_review']


@dataclass(frozen=True)
class Limits:
    # 思考模式的模型每次请求约 7–11 秒，汇总多个研究常需 15–20 次读取
    max_tool_calls: int = 24
    max_model_requests: int = 16
    max_steps: int = 48
    max_active_ms: int = 240000
    max_tokens: int = 262144
    max_repair_attempts: int = 2
    lifetime_s: int = 1800
    model_timeout_s: int = 30

    @classmethod
    def configured(cls):
        from dataclasses import fields
        values={}
        for field in fields(cls):
            raw=os.environ.get('CABLESIM_AGENT_'+field.name.upper())
            if raw is not None:
                value=int(raw)
                if value<=0:raise ValueError('Agent budget must be positive: '+field.name)
                values[field.name]=value
        return cls(**values)


class CreateSession(StrictModel):
    workspace_id: UUID
    study_id: UUID | None = None


class SessionId(StrictModel):
    id: UUID


class ModelSettingsUpdate(StrictModel):
    base_url: str = Field(max_length=500)
    model: str = Field(max_length=100)
    api_key: str | None = Field(default=None,max_length=500)
    instructions: str = Field(default='',max_length=4000)
    model_timeout_s: int | None = None


class ModelSettingsTest(StrictModel):
    base_url: str | None = Field(default=None,max_length=500)
    model: str | None = Field(default=None,max_length=100)
    api_key: str | None = Field(default=None,max_length=500)


class SessionSummary(StrictModel):
    id: UUID
    workspace_id: UUID
    study_id: UUID | None
    state: TaskState
    waiting_reason: WaitReason | None
    title: str
    created: str
    updated: str
    pending_proposals: int


class Message(StrictModel):
    content: str = Field(min_length=1,max_length=8000)


class AgentStatus(StrictModel):
    configured: bool
    model: str
    tools: int = Field(ge=0)


class ToolInfo(StrictModel):
    name: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,64}$')
    title: str
    kind: Literal['read','propose','run']
    description: str
    plugin_id: str | None = None
    hpc: bool


class Diagnostic(StrictModel):
    code: str
    message: str
    path: str | None = None
    recoverable: bool = False
    evidence_refs: list[dict[str,JsonValue]] = Field(default_factory=list)


class ToolResult(StrictModel):
    status: Literal['ok','error']
    summary: str
    data: dict[str,JsonValue] = Field(default_factory=dict)
    artifact_refs: list[dict[str,JsonValue]] = Field(default_factory=list)
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)
    execution_ref: dict[str,JsonValue] | None = None


class ProposalChange(StrictModel):
    path: str
    label: str
    before: JsonValue
    after: JsonValue
    unit: str | None = None


class Proposal(StrictModel):
    id: UUID
    title: str
    changes: list[ProposalChange]
    checks: list[str]
    status: Literal['pending','approved','rejected'] = 'pending'


class ProposalDecision(StrictModel):
    status: Literal['approved','rejected']


class AuditEvent(StrictModel):
    sequence: int
    type: str
    created: str
    data: dict[str,JsonValue]


class PlanNode(StrictModel):
    id: str
    tool: str
    state: NodeState
    attempt: int = Field(ge=1)
    arguments: dict[str,JsonValue]
    arguments_digest: str
    input_identity: dict[str,JsonValue]
    depends_on: list[str]
    provider_call_id: str
    preparation_error: dict[str,JsonValue] | None = None


class SessionRecord(StrictModel):
    id: UUID
    workspace_id: UUID
    study_id: UUID | None
    workspace_revision: int
    study_revision: int | None
    state: TaskState
    waiting_reason: WaitReason | None
    created: str
    updated: str
    budget: dict[str,JsonValue]
    messages: list[dict[str,JsonValue]]
    tool_calls: list[dict[str,JsonValue]]
    results: list[dict[str,JsonValue]]
    proposals: list[Proposal]
    plans: list[dict[str,JsonValue]]
    steps: list[dict[str,JsonValue]]
    events: list[AuditEvent]
    enabled_tools: list[str] = Field(default_factory=list)


class MessageDelta(StrictModel):
    type: Literal['message.delta']
    text: str


class ToolCallEvent(StrictModel):
    type: Literal['tool.call']
    id: str
    tool: str
    title: str
    arguments: dict[str,JsonValue]


class ToolResultEvent(StrictModel):
    type: Literal['tool.result']
    id: str
    status: Literal['ok','error']
    summary: str
    next_actions: list[str]


class ProposalCreated(StrictModel):
    type: Literal['proposal.created']
    id: UUID
    title: str
    changes: list[ProposalChange]
    checks: list[str]


class StreamError(StrictModel):
    type: Literal['error']
    code: str
    message: str


class StreamDone(StrictModel):
    type: Literal['done']
    usage: dict[str,int]


StreamEvent = Annotated[MessageDelta | ToolCallEvent | ToolResultEvent | ProposalCreated | StreamError | StreamDone,
                        Field(discriminator='type')]
