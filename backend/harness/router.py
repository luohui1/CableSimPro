"""Frontend-compatible human session, streaming and proposal decision endpoints."""
from uuid import UUID
from itertools import chain
from contextlib import asynccontextmanager

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import TypeAdapter
from starlette.background import BackgroundTask

from .contracts import AgentStatus,ToolInfo,RecipeInfo,CreateSession,SessionId,SessionSummary,ModelSettingsUpdate,ModelSettingsTest,Message,SessionRecord,ProposalDecision,StreamEvent,PlanNode
from .memory_contracts import MemorySettings, MemoryEdit


def make_router(harness):
    @asynccontextmanager
    async def lifespan(app):
        harness.platform.bind(app)
        harness.memories.start()
        try:yield
        finally:
            try:harness.memories.close()
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

    @router.get('/memory/settings')
    def memory_settings():return harness.memories.status()

    @router.put('/memory/settings')
    def save_memory_settings(body:MemorySettings):return harness.memories.configure(body)

    @router.get('/memories')
    def memories(workspace_id:UUID,study_id:UUID|None=None,q:str=Query('',max_length=256),
                 limit:int=Query(10,ge=1,le=20),offset:int=Query(0,ge=0)):
        return harness.memories.listing(str(workspace_id),str(study_id) if study_id else None,q,limit,offset)

    @router.put('/memories/{id}')
    def correct_memory(id:UUID,body:MemoryEdit):return harness.memories.edit(str(id),body)

    @router.delete('/memories/{id}')
    def delete_memory(id:UUID,expected_revision:int=Query(ge=1)):
        return harness.memories.edit(str(id),expected_revision=expected_revision)

    @router.get('/sessions/{id}/memory')
    def session_memory(id:str):
        record=harness.model_record(id)
        return {'context':record['memory'],'jobs':harness.memories.jobs(id)}

    @router.post('/sessions/{id}/memory')
    def remember_session(id:str):
        record=harness.tasks.record(id,model_context=True)
        with harness.tasks.db() as db:task=harness.tasks.load(db,id)
        if task['active_turn']:raise HTTPException(409,{'code':'MEMORY_TURN_ACTIVE','message':'本条消息尚未结束，不能提前抽取。'})
        if not harness.memories.settings().enabled:
            raise HTTPException(409,{'code':'MEMORY_DISABLED','message':'请先启用长期记忆，再抽取会话。'})
        turn=next((message.get('turn_id') for message in reversed(record['messages']) if message['role']=='user'),None)
        if not turn:raise HTTPException(422,{'code':'MEMORY_TURN_NOT_FOUND','message':'尚无可抽取的用户消息。'})
        return {'job_id':harness.memories.enqueue(id,turn)}

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
