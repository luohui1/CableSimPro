"""Frontend-compatible human session, streaming and proposal decision endpoints."""
from uuid import UUID

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import TypeAdapter
from starlette.background import BackgroundTask

from .contracts import AgentStatus,ToolInfo,CreateSession,SessionId,SessionSummary,ModelSettingsUpdate,ModelSettingsTest,Message,SessionRecord,ProposalDecision,StreamEvent,PlanNode


def make_router(harness):
    router=APIRouter(prefix='/api/agent',tags=['agent'])

    @router.get('/status',response_model=AgentStatus)
    def status():return harness.status()

    # 模型设置：密钥只写不读，响应里只有是否已保存与末四位
    @router.get('/settings')
    def settings():return harness.settings.public()

    @router.put('/settings')
    def save_settings(body:ModelSettingsUpdate):return harness.settings.update(body)

    @router.delete('/settings')
    def reset_settings():return harness.settings.reset()

    @router.post('/settings/test')
    def test_settings(body:ModelSettingsTest):return harness.test_model(body)

    @router.get('/tools',response_model=list[ToolInfo],response_model_exclude_none=True)
    def tools():return harness.tools()

    @router.post('/sessions',response_model=SessionId)
    def create(body:CreateSession):return harness.create(body)

    @router.get('/sessions',response_model=list[SessionSummary])
    def sessions(workspace_id:UUID|None=None):return harness.tasks.sessions(str(workspace_id) if workspace_id else None)

    @router.get('/sessions/{id}',response_model=SessionRecord)
    def session(id:str):return harness.tasks.record(id)

    @router.post('/sessions/{id}/messages',response_class=StreamingResponse,
        responses={200:{'description':'SSE events, each event/data JSON pair separated by a blank line.',
            'content':{'text/event-stream':{'schema':{'type':'string'}}}}},
        openapi_extra={'x-sse-events':TypeAdapter(StreamEvent).json_schema()})
    def message(id:str,body:Message):
        turn=harness.begin(id,body.content)
        iterator=harness.stream(id,turn)
        return StreamingResponse(iterator,media_type='text/event-stream',
            headers={'Cache-Control':'no-store','X-Accel-Buffering':'no'},
            background=BackgroundTask(harness.close_stream,id,turn,iterator))

    @router.post('/proposals/{id}/approve',response_model=ProposalDecision)
    def approve(id:str):return harness.proposals.decide(id,'approved')

    @router.post('/proposals/{id}/reject',response_model=ProposalDecision)
    def reject(id:str):return harness.proposals.decide(id,'rejected')

    @router.post('/sessions/{id}/reconcile')
    def reconcile(id:str):return harness.reconciliation(id)

    @router.get('/contract')
    def contract():
        return {'schema':'cablesim.agent-stream/1','events':TypeAdapter(StreamEvent).json_schema(),'plan_node':PlanNode.model_json_schema(),
                'tools':[{'name':tool.name,'parameters':tool.model()['function']['parameters']} for tool in harness.registry.tools().values()]}

    return router
