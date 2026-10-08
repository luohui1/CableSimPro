"""Replaceable model boundary; credentials are never part of task contracts."""
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ModelReply:
    text: str
    tool_calls: list[dict]
    usage: dict[str,int]
    finish_reason: str | None = None
    # 思考模式的思维链：带工具的后续请求必须原样回传（DeepSeek 等），不进回答也不做核验
    reasoning: str = ''


class ModelError(Exception):
    def __init__(self,code,message):
        super().__init__(message)
        self.code,self.message = code,message


class ModelPort(Protocol):
    def status(self) -> tuple[bool,str]: ...
    def reply(self,messages:list[dict],tools:list[dict],timeout_s:float) -> ModelReply: ...
