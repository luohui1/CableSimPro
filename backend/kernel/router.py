"""The saved-study API; existing workspace/run endpoints keep their v0 semantics."""
from fastapi import APIRouter, HTTPException, Query, Response
from .study_tasks import task_catalog
from .responses import StudyResponse, RunResponse, RunPage, PreflightResponse, TaskOption

from .contracts import Comparison, CreateStudy, DeliveryRequest, RunStudy, UpdateStudy


def make_router(research):
    router = APIRouter(prefix='/api')

    @router.get('/methods')
    def methods():
        return research.methods()

    @router.get('/study-tasks', response_model=list[TaskOption])
    def tasks():
        return task_catalog(research)

    @router.get('/model-artifacts')
    def model_artifacts():
        from ..plugin_host.model_assets import catalogue
        try:return catalogue(research.executor.registry.root.parent,research.executor.registry)
        except ValueError as exc:raise HTTPException(409,str(exc)) from None

    @router.get('/measurement-input-contract')
    def measurement_input_contract():
        from .input_contracts import model_for
        plugin=research.executor.registry.get('cablesim.hybrid-rating');plugin.verify()
        model,_=model_for('cablesim.hybrid-rating','measurement-import')
        return {'schema_version':'cablesim.field-measurements/1','schema':model.model_json_schema(),
                'method':research.pin(plugin),'authority':'reference_only','engineering_approval':False}

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

    @router.get('/workspaces/{wid}/studies', response_model=list[StudyResponse])
    def studies(wid: str):
        return research.list_studies(wid)

    @router.post('/workspaces/{wid}/studies', status_code=201, response_model=StudyResponse)
    def create(wid: str, body: CreateStudy):
        return research.save(wid, body)

    @router.put('/workspaces/{wid}/studies/{sid}', response_model=StudyResponse)
    def update(wid: str, sid: str, body: UpdateStudy):
        return research.save(wid, body, sid)

    @router.get('/workspaces/{wid}/studies/{sid}/preflight', response_model=PreflightResponse)
    def preflight(wid: str, sid: str, expected_revision: int, expected_study_revision: int,
                  module: str | None = Query(None, pattern=r'^[a-z][a-z0-9-]{0,63}$')):
        return research.preflight(wid, sid, expected_revision, expected_study_revision, module)

    @router.post('/workspaces/{wid}/studies/{sid}/runs', response_model=RunResponse,
                 responses={202: {'model': RunResponse, 'description': 'Accepted asynchronous simulation; poll the Location URL.'}})
    def execute(wid: str, sid: str, body: RunStudy, response: Response):
        result = research.execute(wid, sid, body, asynchronous=None)
        if result['status'] in ('accepted', 'running', 'validating'):
            response.status_code = 202
            response.headers['Location'] = f'/api/workspaces/{wid}/studies/{sid}/runs/{result["id"]}'
            response.headers['Retry-After'] = '2'
        return result

    @router.get('/workspaces/{wid}/studies/{sid}/runs', response_model=RunPage)
    def runs(wid: str, sid: str, after: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100)):
        return research.list_runs(wid, sid, after, limit)

    @router.get('/workspaces/{wid}/studies/{sid}/runs/{rid}', response_model=RunResponse)
    def run(wid: str, sid: str, rid: str):
        value = research.get_run(wid, rid)
        if value['study'] != sid:
            raise HTTPException(404, '运行不属于此研究。')
        return value

    @router.post('/workspaces/{wid}/studies/{sid}/runs/{rid}/resume')
    def resume(wid:str,sid:str,rid:str):
        return research.resume_remote(wid,sid,rid)

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
