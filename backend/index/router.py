"""Read-only metadata projections; no migration, solver, job refresh or approval."""
from fastapi import APIRouter, Query
from contextlib import asynccontextmanager
from time import perf_counter
from starlette.concurrency import run_in_threadpool
from .contracts import Kind, ObjectList, Relations, Inbox


def make_router(index):
    @asynccontextmanager
    async def lifespan(app):
        # main's existing owned warm-up thread builds the complete index. Wait
        # before declaring startup ready; do not move that wait to the first UI read.
        started=perf_counter()
        await run_in_threadpool(index.warm_done.wait,5)
        index.startup_wait_ms=(perf_counter()-started)*1000
        try:yield
        finally:index.previous=None
    router=APIRouter(prefix='/api/index',tags=['index'],lifespan=lifespan)

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
