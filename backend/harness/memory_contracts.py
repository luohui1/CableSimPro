"""Memory suggestions are context, never engineering evidence or authority."""
from typing import Annotated, Literal

from pydantic import Field, field_validator

from backend.schemas import StrictModel


class MemoryFact(StrictModel):
    kind: Literal['preference', 'goal', 'decision', 'lesson']
    topic: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1, max_length=800)
    source_sequences: list[Annotated[int, Field(gt=0, strict=True)]] = Field(min_length=1, max_length=8)

    @field_validator('source_sequences')
    @classmethod
    def unique_sources(cls, value):
        return list(dict.fromkeys(value))

    @field_validator('topic', 'content')
    @classmethod
    def nonempty(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('记忆内容不能为空。')
        return value


class MemorySettings(StrictModel):
    enabled: bool = False
    recall_limit: int = Field(default=5, ge=1, le=8)


class MemoryEdit(StrictModel):
    expected_revision: int = Field(ge=1)
    content: str = Field(min_length=1, max_length=800)

    @field_validator('content')
    @classmethod
    def nonempty(cls, value):
        return MemoryFact.nonempty(value)
