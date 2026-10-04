"""The saved-study API; existing workspace/run endpoints keep their v0 semantics."""
from fastapi import APIRouter, HTTPException, Query

from .contracts import Comparison, CreateStudy, DeliveryRequest, RunStudy, UpdateStudy


def make_router(research):
    router = APIRouter(prefix='/api')

    @router.get('/methods')
    def methods():
        return research.methods()

    @router.get('/workspaces/{wid}/revisions')
    def revisions(wid: str, after: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100)):
        with research.store.db() as db:
            research.store.load(db, wid)
            return [dict(r) for r in db.execute('SELECT revision,digest,created FROM workspace_revisions WHERE workspace=? AND revision>? ORDER BY revision LIMIT ?', (wid, after, limit))]

    @router.get('/workspaces/{wid}/revisions/{revision}')
    def revision(wid: str, revision: int):
        import json
        with research.store.db() as db:
            r = db.execute('SELECT * FROM workspace_revisions WHERE workspace=? AND revision=?', (wid, revision)).fetchone()
            if r is None:
                raise HTTPException(404, '此版本没有档案；不从撤销历史补猜。')
            return {**dict(r), 'state': json.loads(r['state'])}

    @router.get('/workspaces/{wid}/studies')
    def studies(wid: str):
        return research.list_studies(wid)

    @router.post('/workspaces/{wid}/studies', status_code=201)
    def create(wid: str, body: CreateStudy):
        return research.save(wid, body)

    @router.put('/workspaces/{wid}/studies/{sid}')
    def update(wid: str, sid: str, body: UpdateStudy):
        return research.save(wid, body, sid)

    @router.get('/workspaces/{wid}/studies/{sid}/preflight')
    def preflight(wid: str, sid: str, expected_revision: int, expected_study_revision: int,
                  module: str | None = Query(None, pattern=r'^[a-z][a-z0-9-]{0,63}$')):
        return research.preflight(wid, sid, expected_revision, expected_study_revision, module)

    @router.post('/workspaces/{wid}/studies/{sid}/runs')
    def execute(wid: str, sid: str, body: RunStudy):
        return research.execute(wid, sid, body)

    @router.get('/workspaces/{wid}/studies/{sid}/runs')
    def runs(wid: str, sid: str, after: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100)):
        return research.list_runs(wid, sid, after, limit)

    @router.get('/workspaces/{wid}/studies/{sid}/runs/{rid}')
    def run(wid: str, sid: str, rid: str):
        value = research.get_run(wid, rid)
        if value['study'] != sid:
            raise HTTPException(404, '运行不属于此研究。')
        return value

    @router.post('/workspaces/{wid}/study-comparisons')
    def comparison(wid: str, body: Comparison):
        return research.comparison(wid, body.run_ids)

    @router.post('/workspaces/{wid}/deliveries', status_code=201)
    def deliver(wid: str, body: DeliveryRequest):
        return research.deliver(wid, body.run_ids)

    @router.get('/workspaces/{wid}/deliveries/{did}')
    def delivery(wid: str, did: str):
        return research.delivery(wid, did)

    return router
