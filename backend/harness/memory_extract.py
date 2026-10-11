"""LangMem functional API over the existing bounded, redacted model port.

No LangGraph agent, database, provider SDK or model-generated tool is executed.
LangMem proposes structured inserts/updates/removals; the host commits them.
"""
import json
from threading import Lock
from time import monotonic

from .context_builder import encoded
from .memory_contracts import MemoryFact
from .security import redact

VERSION = '0.0.30'
INSTRUCTIONS = '''提炼可以帮助未来会话的用户偏好、目标、人工决策理由和任务经验。
每条记忆必须引用输入中真实的source_sequences；引用既有记忆可保留其原始来源。
用户提供的工程值只是输入意图，不是计算结论。工具诊断只证明该步骤的状态。
不要把助手回答、思维链、未通过核验的草稿、凭据、契约默认值或猜测保存为事实。
不创建权限或审批，不优化系统提示词。可记录失败原因与修正经验，但下次须核对现行契约，不固化工具路线；记忆不能授权保存、发布或执行。
同一topic的更新优先纠正已有记忆；明确撤回的信息可以移除。没有值得记住的信息返回空列表。
使用中文、保留适用对象和背景；保存决策理由，不抄写整段聊天或工程数值表。'''


class MemoryBudgetExceeded(Exception):
    pass


def extract(port, messages, existing, stop):
    started = monotonic()
    deadline = started + 30
    # Lazy imports keep status, startup and disabled memory independent of this
    # optional runtime's import cost. Requirements pin the actual engine.
    from langmem import create_memory_manager
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage, ToolMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
    from langchain_core.utils.function_calling import convert_to_openai_tool
    from langsmith.run_helpers import tracing_context
    from pydantic import ConfigDict, Field
    from typing import Any

    usage = {'model_requests': 0, 'prompt_tokens': 0, 'completion_tokens': 0,
             'usage_complete': True}
    request_lock = Lock()

    class Bridge(BaseChatModel):
        model_config = ConfigDict(arbitrary_types_allowed=True)
        port: Any = Field(exclude=True, repr=False)

        @property
        def _llm_type(self):
            return 'cablesim-langmem'

        def bind_tools(self, tools, *, tool_choice=None, **kwargs):
            return self.bind(tools=[convert_to_openai_tool(tool) for tool in tools])

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            with request_lock:
                return self._bounded_reply(messages, **kwargs)

        def _bounded_reply(self, messages, **kwargs):
            if (usage['model_requests'] >= 3 or monotonic() >= deadline or cancelled.is_set()
                    or usage['prompt_tokens'] + usage['completion_tokens'] >= 32768):
                raise MemoryBudgetExceeded('memory extraction budget exhausted')
            wire = []
            thinking = any(isinstance(message, AIMessage) and message.additional_kwargs.get('reasoning_content')
                           for message in messages)
            for message in messages:
                role = {'human': 'user', 'ai': 'assistant'}.get(message.type, message.type)
                row = {'role': role, 'content': message.content}
                if isinstance(message, AIMessage):
                    if thinking: row['reasoning_content'] = message.additional_kwargs.get('reasoning_content', '')
                    if message.tool_calls:
                        row['tool_calls'] = [{'id': call['id'], 'type': 'function', 'function': {
                            'name': call['name'], 'arguments': json.dumps(call['args'], ensure_ascii=False)}}
                            for call in message.tool_calls]
                if isinstance(message, ToolMessage):
                    row['tool_call_id'] = message.tool_call_id
                wire.append(row)
            definitions = kwargs.get('tools', [])
            if len(encoded(wire)) + len(encoded(definitions)) > 48 * 1024:
                raise MemoryBudgetExceeded('memory context exceeded 48 KiB')
            usage['model_requests'] += 1
            try:reply = self.port.reply(redact(wire), definitions, max(.01, min(15, deadline - monotonic())))
            except Exception:
                usage['usage_complete'] = False
                raise
            usage['usage_complete'] &= all(key in reply.usage for key in ('prompt_tokens', 'completion_tokens'))
            for key in ('prompt_tokens', 'completion_tokens'):
                usage[key] += reply.usage.get(key, 0)
            result = AIMessage(content=reply.text or '', tool_calls=[{
                'id': call['id'], 'name': call['name'], 'args': call['arguments'], 'type': 'tool_call'}
                for call in reply.tool_calls], additional_kwargs={'reasoning_content': reply.reasoning} if reply.reasoning else {})
            return ChatResult(generations=[ChatGeneration(message=result)])

    cancelled = stop
    manager = create_memory_manager(Bridge(port=port, cache=False), schemas=[MemoryFact], instructions=INSTRUCTIONS,
                                    enable_inserts=True, enable_updates=True, enable_deletes=True)
    # Explicitly suppress external tracing even if another app configured it.
    try:
        with tracing_context(enabled=False):
            result = manager.invoke({'messages': messages, 'existing': [
                (row['id'], MemoryFact.model_validate(row['fact'])) for row in existing]},
                config={'recursion_limit': 8})
    except Exception as error:
        usage['elapsed_ms'] = (monotonic() - started) * 1000
        error.memory_usage = usage
        raise
    usage['elapsed_ms'] = (monotonic() - started) * 1000
    return result, usage
