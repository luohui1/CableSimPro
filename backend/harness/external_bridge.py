"""Narrow bridge from the pi sidecar to the legacy Agent's scoped read tools.

The bridge deliberately exposes reads only in this first integration step. Every call
is admitted by the session's visible registry and executed by ToolBroker.execute.
"""
from time import perf_counter
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field


class ExternalCall(BaseModel):
    model_config = ConfigDict(extra='forbid')
    session_id: UUID
    tool: str = Field(min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')
    arguments: dict = Field(default_factory=dict)


def make_router(harness):
    router = APIRouter(prefix='/api/agent/external', tags=['agent-external'])

    def visible(session_id):
        record = harness.tasks.record(str(session_id), model_context=True)
        return record, harness.registry.visible(record)

    @router.get('/tools')
    def tools(session_id: UUID):
        record, catalog = visible(session_id)
        result = []
        for tool in catalog.values():
            if tool.kind != 'read':
                continue
            definition = tool.model()['function']
            result.append({
                'name': tool.name,
                'title': tool.title,
                'description': tool.description,
                'scope': {
                    'kind': record['context']['kind'],
                    'workspace_id': str(record['context']['id']),
                    'study_id': record['context'].get('study_id'),
                },
                'parameters': definition['parameters'],
            })
        return {'tools': result, 'read_only': True}

    @router.post('/calls')
    def call(body: ExternalCall):
        tid = str(body.session_id)
        record, catalog = visible(body.session_id)
        tool = catalog.get(body.tool)
        if tool is None or tool.kind != 'read':
            raise HTTPException(403, {
                'code': 'EXTERNAL_TOOL_FORBIDDEN',
                'message': '外部 Agent 只允许调用当前会话白名单中的只读工具。',
            })

        turn = harness.tasks.begin_turn(tid, '外部 Agent 只读工具调用：' + body.tool)
        try:
            with harness.tasks.db() as db:
                task = harness.tasks.load(db, tid)
            node = {
                'id': 'external-' + uuid4().hex,
                'tool': body.tool,
                'state': 'issued',
                'attempt': 1,
                'arguments': body.arguments,
                'input_identity': {},
                'depends_on': [],
                'provider_call_id': 'external-' + uuid4().hex,
                'bindings': {},
            }
            node['input_identity'] = harness.broker.identity(task, node, tool)
            revision = harness.tasks.add_plan(tid, {'nodes': [node], 'source': 'external-agent'})
            operation = harness.tasks.issue(tid, turn, revision, node)
            harness.tasks.running(tid, operation)
            started = perf_counter()
            result = harness.broker.execute(task, node, tool)
            payload = result.model_dump(mode='json')
            harness.tasks.finish_step(tid, operation, payload, (perf_counter() - started) * 1000)
            harness.tasks.emit(tid, 'external.tool.result', {
                'turn_id': turn, 'tool': body.tool, 'operation_id': operation,
                'status': payload['status'],
            })
            return {
                'tool': body.tool,
                'status': payload['status'],
                'summary': payload['summary'],
                'data': payload['data'],
                'diagnostics': payload['diagnostics'],
                'next_actions': payload['next_actions'],
            }
        finally:
            harness.tasks.finish_turn(tid, turn)

    return router
