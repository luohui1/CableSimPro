"""Replaceable model boundary; credentials are never part of task contracts."""
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ModelReply:
    text: str
    tool_calls: list[dict]
    usage: dict[str,int]
    finish_reason: str | None = None


class ModelError(Exception):
    def __init__(self,code,message):
        super().__init__(message)
        self.code,self.message = code,message


class ModelPort(Protocol):
    def status(self) -> tuple[bool,str]: ...
    def reply(self,messages:list[dict],tools:list[dict],timeout_s:float) -> ModelReply: ...
