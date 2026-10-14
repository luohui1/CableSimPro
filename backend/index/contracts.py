"""Shared read-only cards. References never carry navigation or write authority."""
from typing import Literal
from pydantic import Field
from backend.schemas import StrictModel

Kind = Literal['project','study','type','cable_version','asset','run','job','delivery',
               'plugin','validation','document','proposal','agent_task','input_snapshot']


class Status(StrictModel):
    code: str
    label: str
    reason: str | None = None


class IndexSource(StrictModel):
    kind: str
    label: str


# Preserve Python callers while keeping the public schema name unambiguous.
Source = IndexSource


class Parent(StrictModel):
    kind: Kind
    id: str
    name: str


class ValidationMetric(StrictModel):
    id: str
    variant: str
    quantity: str
    unit: str | None = None
    reference: float | None = None
    open_source: float | None = None
    comsol: float | None = None
    difference: float | None = None
    relative_difference: float | None = None
    relative_difference_percent: float | None = None
    status: str
    source: str | dict | None = None
    tolerance: dict | None = None


class ValidationEvidence(StrictModel):
    snapshot_digest: str
    citation: str
    reference_location: str
    source_pages: list[dict]
    scope: str
    metrics: list[ValidationMetric]
    total_metrics: int
    outside_tolerance: int
    convergence_passed: bool | None = None
    limitations: list[str]
    runs: list[dict]
    report_tolerance: dict | None = None


class ObjectCard(StrictModel):
    kind: Kind
    id: str
    name: str
    version: str | None = None
    revision: int | None = None
    status: Status
    source: Source | None = None
    updated: str | None
    parent: Parent | None = None
    subtype: Literal['material','component','assembly','installation','study_template','rule','declared','reproduced'] | None = None
    validation: ValidationEvidence | None = None


class ObjectList(StrictModel):
    items: list[ObjectCard]
    total: int
    source_errors: list[dict] = Field(default_factory=list)


class Pin(StrictModel):
    version: str | None = None
    revision: int | None = None
    digest: str | None = None


class Relation(StrictModel):
    role: str
    target: ObjectCard
    pinned: Pin | None = None
    freshness: Literal['current','outdated','unknown']
    reason: str | None = None


class Unresolved(StrictModel):
    role: str
    freshness: Literal['unknown'] = 'unknown'
    reason: str


class Relations(StrictModel):
    uses: list[Relation]
    used_by: list[Relation]
    unresolved: list[Unresolved] = Field(default_factory=list)
    source_errors: list[dict] = Field(default_factory=list)


class InboxItem(StrictModel):
    category: Literal['review','stale','missing','running']
    origin: Literal['agent','document','asset','type','study','job','validation']
    title: str
    object: ObjectCard
    reason: str
    created: str | None


class Inbox(StrictModel):
    items: list[InboxItem]
    counts: dict[Literal['review','stale','missing','running'],int]
    source_errors: list[dict] = Field(default_factory=list)
