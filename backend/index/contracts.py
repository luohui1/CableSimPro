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


class Source(StrictModel):
    kind: str
    label: str


class Parent(StrictModel):
    kind: Kind
    id: str
    name: str


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
    subtype: Literal['material','component','assembly','installation','study_template','rule'] | None = None


class ObjectList(StrictModel):
    items: list[ObjectCard]
    total: int


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


class InboxItem(StrictModel):
    category: Literal['review','stale','missing','running']
    origin: Literal['agent','document','asset','type','study','job']
    title: str
    object: ObjectCard
    reason: str
    created: str | None


class Inbox(StrictModel):
    items: list[InboxItem]
    counts: dict[Literal['review','stale','missing','running'],int]

