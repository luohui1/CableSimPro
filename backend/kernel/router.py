"""The saved-study API; existing workspace/run endpoints keep their v0 semantics."""
from fastapi import APIRouter, HTTPException, Query, Response, Request
from typing import Literal
from .study_tasks import task_catalog
from .responses import StudyResponse, StudyCardResponse, RunResponse, RunDetailResponse, RunCaseInput, RunPage, RunSummaryPage, PreflightResponse, TaskOption

from .contracts import Comparison, CreateStudy, DeliveryRequest, RunStudy, UpdateStudy, RecalculateStudy, PreviewStudy, UpgradeStudyMethods
from .study_history import StudyHistoryRequest, restore
from .host_api import ERRORS, host_call, DeliveryResult, DeliveryReceipt
from .read_responses import read_response
from starlette.concurrency import run_in_threadpool


def make_router(research):
    router = APIRouter(prefix='/api')

    @router.get('/methods')
    async def methods(request: Request, view: Literal['full', 'summary'] = 'full'):
        # The catalog parses and validates every manifest; reuse it until plugin
        # sources or seals change (same invalidation as /api/input-contracts).
        import json
        from .read_responses import read_response
        def load():
            values = research.methods()
            if view == 'summary':
                # Method selectors need identities and presentation, not all
                # recursively expanded parameter schemas. A selected capability
                # reads its exact, sealed /input-contracts contract separately.
                values = [{**row, 'capabilities': [{
                    **{key:value for key,value in cap.items()
                       if key not in ('input_contract', 'parameters_schema', 'parameter_schema', 'output_schema', 'artifact_schemas')},
                    # Optional inspectors can avoid downloading an unrelated
                    # capability's full contract; values still use that contract.
                    'parameter_fields': list(cap.get('parameter_schema', {}).get('properties', {}))}
                    for cap in row['capabilities']]} for row in values]
            return json.dumps(values, ensure_ascii=False, allow_nan=False).encode()
        return await read_response(research, ('methods',) if view == 'full' else ('methods', 'summary'), None,
            load, uses_database=False, request=request)

    @router.get('/plugins/{plugin_id}/assets/{role}')
    def plugin_asset(plugin_id: str, role: Literal['cover', 'method', 'validation'], sha256: str | None = None):
        from ..plugin_host.presentation import asset_bytes
        plugin = research.registry(plugin_id).get(plugin_id)
        data, resource = host_call(asset_bytes, plugin, role, sha256)
        return Response(data, media_type=resource['media_type'], headers={
            'ETag': '"' + resource['sha256'] + '"', 'X-Content-SHA256': resource['sha256'],
            'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600, must-revalidate'})

    @router.get('/study-tasks', response_model=list[TaskOption])
    def tasks():
        return task_catalog(research)

    @router.get('/model-artifacts')
    async def model_artifacts(request: Request):
        from .model_catalog_reads import content_identity, verified_catalogue
        try:
            identity = await run_in_threadpool(content_identity, research.executor.registry.root.parent)
            return await read_response(research, ('model-artifacts', identity), None,
                lambda: verified_catalogue(research, identity), uses_database=False, request=request)
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

    @router.get('/workspaces/{wid}/studies', response_model=list[StudyResponse] | list[StudyCardResponse])
    async def studies(wid: str, request: Request, view: Literal['full', 'summary'] = 'full'):
        if view == 'summary':
            return await read_response(research, ('study-cards',wid), list[StudyCardResponse],
                                       lambda: research.list_study_cards(wid), request=request)
        return await read_response(research, ('studies',wid), list[StudyResponse], lambda: research.list_studies(wid), request=request)

    @router.get('/studies/{sid}', response_model=StudyResponse, responses=ERRORS)
    async def direct_study_detail(sid: str, request: Request):
        return await read_response(research, ('study-location',sid), StudyResponse,
            lambda: host_call(research.study_detail_by_id, sid), request=request)

    @router.get('/workspaces/{wid}/studies/{sid}', response_model=StudyResponse, responses=ERRORS)
    async def study_detail(wid: str, sid: str, request: Request):
        return await read_response(research, ('study',wid,sid), StudyResponse, lambda: host_call(research.study_detail, wid, sid), request=request)

    @router.post('/workspaces/{wid}/studies/{sid}/recalculate', response_model=RunResponse,
                 response_model_exclude_unset=True, responses={**ERRORS, 202: {'model': RunResponse, 'description': 'Accepted current-version run; poll Location.'}})
    def recalculate(wid: str, sid: str, body: RecalculateStudy, response: Response):
        from .recalculate import recalculate as apply
        result = host_call(apply, research, wid, sid, body)
        if result['status'] in ('accepted', 'running', 'validating'):
            response.status_code = 202
            response.headers['Location'] = f'/api/workspaces/{wid}/studies/{sid}/runs/{result["id"]}'
            response.headers['Retry-After'] = '2'
        return result

    @router.post('/workspaces/{wid}/studies/{sid}/preview', responses=ERRORS)
    def preview(wid: str, sid: str, body: PreviewStudy):
        from .preview import preview as calculate
        return host_call(calculate, research, wid, sid, body)

    @router.post('/workspaces/{wid}/studies', status_code=201, response_model=StudyResponse)
    def create(wid: str, body: CreateStudy):
        return research.save(wid, body)

    @router.put('/workspaces/{wid}/studies/{sid}', response_model=StudyResponse)
    def update(wid: str, sid: str, body: UpdateStudy):
        return research.save(wid, body, sid)

    @router.post('/workspaces/{wid}/studies/{sid}/upgrade-methods', response_model=StudyResponse, responses=ERRORS)
    def upgrade_methods(wid:str,sid:str,body:UpgradeStudyMethods):
        from .method_adoption import upgrade
        return host_call(upgrade,research,wid,sid,body)

    @router.post('/workspaces/{wid}/studies/{sid}/undo', response_model=StudyResponse, responses=ERRORS)
    def undo(wid:str,sid:str,body:StudyHistoryRequest):
        return host_call(restore,research,wid,sid,'undo',body)

    @router.post('/workspaces/{wid}/studies/{sid}/redo', response_model=StudyResponse, responses=ERRORS)
    def redo(wid:str,sid:str,body:StudyHistoryRequest):
        return host_call(restore,research,wid,sid,'redo',body)

    @router.get('/workspaces/{wid}/studies/{sid}/preflight', response_model=PreflightResponse, response_model_exclude_unset=True)
    def preflight(wid: str, sid: str, expected_revision: int, expected_study_revision: int,
                  module: str | None = Query(None, pattern=r'^[a-z][a-z0-9-]{0,63}$')):
        return research.preflight(wid, sid, expected_revision, expected_study_revision, module)

    @router.post('/workspaces/{wid}/studies/{sid}/runs', response_model=RunResponse, response_model_exclude_unset=True,
                 responses={202: {'model': RunResponse, 'description': 'Accepted asynchronous simulation; poll the Location URL.'}})
    def execute(wid: str, sid: str, body: RunStudy, response: Response):
        result = research.execute(wid, sid, body, asynchronous=None)
        if result['status'] in ('accepted', 'running', 'validating'):
            response.status_code = 202
            response.headers['Location'] = f'/api/workspaces/{wid}/studies/{sid}/runs/{result["id"]}'
            response.headers['Retry-After'] = '2'
        return result

    @router.get('/workspaces/{wid}/studies/{sid}/runs', response_model=RunPage | RunSummaryPage, response_model_exclude_unset=True)
    async def runs(wid: str, sid: str, request: Request, after: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
             view: Literal['full', 'summary'] = Query('full', description='full preserves the complete saved output and snapshot. summary returns list metadata, method identity and snapshot.module only; pagination and integrity/currentness semantics are unchanged.')):
        if view == 'summary':
            return await read_response(research, ('runs',wid,sid,after,limit), RunSummaryPage,
                lambda: research.list_runs(wid,sid,after,limit,view='summary'), request=request)
        return await run_in_threadpool(research.list_runs, wid, sid, after, limit)

    @router.get('/workspaces/{wid}/studies/{sid}/runs/{rid}', response_model=RunResponse | RunDetailResponse, response_model_exclude_unset=True)
    async def run(wid: str, sid: str, rid: str, request: Request,
                  view: Literal['detail', 'evidence', 'full'] = Query('detail', description='detail returns the working result and display mesh, deferring verbose material basis, preflight and manifests via evidence_ref. evidence includes those disclosures but defers case inputs and lossless field shards. full returns unchanged complete evidence. All verify the original stored input and output before projecting.')):
        from .run_details import detail
        model = RunResponse if view == 'full' else RunDetailResponse
        return await read_response(research, ('run-detail',wid,sid,rid,view), model,
            lambda: detail(research,wid,sid,rid,view), exclude_unset=True, request=request)

    @router.get('/workspaces/{wid}/studies/{sid}/runs/{rid}/cases/{case_id}/input', response_model=RunCaseInput)
    async def run_case_input(wid: str, sid: str, rid: str, case_id: str):
        from .run_details import case_input
        return await read_response(research, ('run-input',wid,sid,rid,case_id), RunCaseInput,
            lambda: case_input(research,wid,sid,rid,case_id))

    @router.post('/workspaces/{wid}/studies/{sid}/runs/{rid}/resume')
    def resume(wid:str,sid:str,rid:str):
        return research.resume_remote(wid,sid,rid)

    @router.post('/workspaces/{wid}/study-comparisons')
    def comparison(wid: str, body: Comparison):
        return research.comparison(wid, body.run_ids)

    @router.post('/workspaces/{wid}/deliveries', status_code=201, response_model=DeliveryResult, responses=ERRORS)
    def deliver(wid: str, body: DeliveryRequest):
        return research.deliver(wid, body.run_ids)

    @router.get('/workspaces/{wid}/deliveries/{did}', response_model=DeliveryResult | DeliveryReceipt, responses=ERRORS)
    async def delivery(wid: str, did: str, request: Request,
                       view: Literal['full', 'summary'] = Query(default='full', description='summary returns verified structure and source digests; full includes saved HTML/PDF attachments.')):
        model = DeliveryReceipt if view == 'summary' else DeliveryResult
        return await read_response(research, ('delivery', wid, did, view), model,
            lambda: research.delivery_receipt(wid, did) if view == 'summary' else research.delivery(wid, did), request=request)

    return router
