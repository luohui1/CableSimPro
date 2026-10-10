"""Frontend-compatible human session, streaming and proposal decision endpoints."""
from uuid import UUID
from itertools import chain
from contextlib import asynccontextmanager

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import TypeAdapter
from starlette.background import BackgroundTask

from .contracts import AgentStatus,ToolInfo,RecipeInfo,CreateSession,SessionId,SessionSummary,ModelSettingsUpdate,ModelSettingsTest,Message,SessionRecord,ProposalDecision,StreamEvent,PlanNode


def make_router(harness):
    @asynccontextmanager
    async def lifespan(app):
        harness.platform.bind(app)
        try:yield
        finally:harness.platform.bind(None)
    router=APIRouter(prefix='/api/agent',tags=['agent'],lifespan=lifespan)

    @router.get('/capabilities')
    def capabilities(module:str|None=None,q:str|None=None,offset:int=0,limit:int=10):
        from fastapi import HTTPException
        if offset<0 or not 1<=limit<=20:raise HTTPException(422,'offset须非负，limit须为1至20。')
        cards=[card for _,card,_ in harness.platform.catalog().values()]
        cards=[card for card in cards if (not module or card['module']==module)
            and (not q or q.casefold() in str(card).casefold())]
        return {'items':cards[offset:offset+limit],'total':len(cards),
            'next_offset':offset+limit if offset+limit<len(cards) else None}

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
    def tools(session_id:UUID|None=None,workspace_id:UUID|None=None):
        return harness.tools(str(session_id) if session_id else None,str(workspace_id) if workspace_id else None)

    @router.get('/recipes',response_model=list[RecipeInfo])
    def recipe_catalog(session_id:UUID|None=None,workspace_id:UUID|None=None):
        return harness.recipes(str(session_id) if session_id else None,str(workspace_id) if workspace_id else None)

    @router.post('/sessions',response_model=SessionId)
    def create(body:CreateSession):return harness.create(body)

    @router.get('/sessions',response_model=list[SessionSummary])
    def sessions(workspace_id:UUID|None=None):return harness.tasks.sessions(str(workspace_id) if workspace_id else None)

    @router.get('/sessions/{id}',response_model=SessionRecord)
    def session(id:str):
        iterator=harness.tasks.stream_record(id)
        first=next(iterator)  # Resolve 404 before sending headers.
        return StreamingResponse(chain((first,),iterator),media_type='application/json',
            headers={'Cache-Control':'no-store'},background=BackgroundTask(iterator.close))

    @router.post('/sessions/{id}/messages',response_class=StreamingResponse,
        responses={200:{'description':'SSE events, each event/data JSON pair separated by a blank line.',
            'content':{'text/event-stream':{'schema':{'type':'string'}}}}},
        openapi_extra={'x-sse-events':TypeAdapter(StreamEvent).json_schema()})
    def message(id:str,body:Message):
        turn=harness.begin(id,body.content,body.recipe.model_dump(mode='json') if body.recipe else None)
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
