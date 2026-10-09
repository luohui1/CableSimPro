"""Read-only metadata projections; no migration, solver, job refresh or approval."""
from fastapi import APIRouter, Query
from .contracts import Kind, ObjectList, Relations, Inbox


def make_router(index):
    router=APIRouter(prefix='/api/index',tags=['index'])

    @router.get('/objects',response_model=ObjectList)
    def objects(kind:Kind|None=None,q:str=Query('',max_length=200),
                limit:int=Query(50,ge=1,le=100),offset:int=Query(0,ge=0)):
        return index.objects(kind=kind,q=q,limit=limit,offset=offset)

    @router.get('/objects/{kind}/{id:path}/relations',response_model=Relations)
    def relations(kind:Kind,id:str):
        return index.relations(kind,id)

    @router.get('/inbox',response_model=Inbox)
    def inbox():
        return index.inbox()

    return router
