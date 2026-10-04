"""Serve the design prototype with the real host API and a separate local database."""
from pathlib import Path
import os
import sys
import json
import logging
from hashlib import sha256
from collections import OrderedDict
from threading import Lock
from time import perf_counter
from contextlib import asynccontextmanager

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi import Response, HTTPException, Request
from fastapi.responses import JSONResponse
from backend.schemas import StrictModel
from backend.domain.models import DomainDocument
from backend.domain.guards import check_locks
from backend.plugin_host import Executor, PluginHostError
from backend.plugin_host.registry import Registry
from backend.plugin_host.resident import ResidentRunner
from backend.plugin_host.executor import minimal_environment
from backend.main import create_app
from backend.kernel.contracts import DeliveryRequest
from backend.kernel.requirements import make_router as requirements_router
from design.workbench.contracts import contracts, synthetic_iec
from design.workbench.scenarios import make_router as scenario_router
from design.workbench.type_rating import make_router as rating_table_router
from design.workbench.cable_example import example

app = create_app(Path(os.environ.get('CABLESIM_DESIGN_DB', str(ROOT / '.data' / 'design-workbench' / 'cablesim.sqlite'))))
app.include_router(scenario_router(app.state.workspace_store))
app.include_router(requirements_router(app.state.research))
app.include_router(rating_table_router(app.state.research))
preview_cache = OrderedDict()
preview_cache_lock = Lock()
preview_runner = ResidentRunner(ROOT/'.tmp/cad-workers')


host_lifespan = app.router.lifespan_context


@asynccontextmanager
async def preview_lifespan(application):
    async with host_lifespan(application):
        try:
            for plugin in Registry(app.state.research.executor.registry.root).plugins.values():
                if not any(c.analysis=='geometry' for c in plugin.manifest.capabilities) or not preview_runner.supports(plugin.entry):continue
                try:
                    plugin.verify()
                    environment=minimal_environment(preview_runner.root)
                    environment['CABLESIM_WORKER_RELEASE']=sha256(plugin.manifest.model_dump_json().encode()).hexdigest()
                    preview_runner.warmup(plugin.entry,env=environment,timeout=plugin.manifest.resources.timeout_s)
                except Exception as error:
                    logging.getLogger(__name__).warning('Geometry preview warmup unavailable for %s: %s',plugin.manifest.id,str(error))
            yield
        finally:preview_runner.close()


app.router.lifespan_context = preview_lifespan


@app.middleware('http')
async def request_arrival(request: Request, call_next):
    request.state.arrived_at = perf_counter()
    return await call_next(request)


class GeometryPreview(StrictModel):
    expected_revision: int
    document: DomainDocument
    method: dict[str, str]
    parameters: dict
    reuse_from: str | None = None


@app.post('/api/design/workspaces/{wid}/geometry-preview')
def geometry_preview(wid: str, body: GeometryPreview, request: Request):
    entered = perf_counter()
    research = app.state.research
    snapshot = research.store.snapshot(wid)
    if snapshot['revision'] != body.expected_revision:
        raise HTTPException(409, '型号已被其他会话修改，请重新打开后更新预览。')
    document = body.document.model_dump(mode='json')
    check_locks(snapshot, document)
    try:
        plugin = Registry(research.executor.registry.root, plugin_id=body.method['plugin_id']).get(body.method['plugin_id'])
        if research.pin(plugin) != {k: body.method[k] for k in ('plugin_id','version','release_digest')}:
            raise HTTPException(409, '建模方法已更新，请刷新方法清单。')
        capability = plugin.manifest.capability(body.method['capability'])
        if capability.analysis != 'geometry' or capability.input_schema != 'cablesim.domain/1':
            raise HTTPException(422, '此方法不支持领域几何预览。')
        jobs = ROOT/'.tmp/cad-jobs'; jobs.mkdir(parents=True,exist_ok=True)
        parameters = {k:v for k,v in body.parameters.items() if k!='_preview_reuse'}
        cache_key = (wid,plugin.manifest.id,plugin.manifest.version,research.pin(plugin)['release_digest'],body.reuse_from)
        with preview_cache_lock:
            previous = preview_cache.get(cache_key)
        prepared = perf_counter()
        result = Executor(jobs_root=jobs,process_runner=preview_runner).run(plugin.manifest.id,capability.id,
            [{'case_id':'preview','input':document,'parameters':parameters}], expected_manifest=plugin.manifest,
            reuse_artifacts=None if preview_runner.supports(plugin.entry) else previous)
        case = result.cases[0]
        if case.status != 'succeeded':
            raise HTTPException(422, case.error['message'])
        with preview_cache_lock:
            preview_cache[cache_key[:-1]+(result.request_sha256,)] = case.artifacts
            while len(preview_cache)>6:preview_cache.popitem(last=False)
        payload={'status':'ready','effect':'preview','method':research.pin(plugin),
                'input_sha256':sha256(json.dumps(document,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),
                'request_sha256':result.request_sha256,'base_revision':body.expected_revision,
                'environment':result.environment,'artifacts':case.artifacts,'warnings':case.warnings,
                'profiling':{'queue_ms':(entered-request.state.arrived_at)*1000,
                    'validation_ms':(prepared-entered)*1000,'server_ms':(perf_counter()-entered)*1000}}
        encoding_started=perf_counter()
        response=JSONResponse(payload)
        response.headers['Server-Timing']=f'encode;dur={(perf_counter()-encoding_started)*1000:.3f}'
        return response
    except PluginHostError as error:
        raise HTTPException(error.status,error.message) from None
    except KeyError as error:
        raise HTTPException(422,'建模方法或能力参数缺失。') from error


@app.get('/api/design/input-contracts')
def input_contracts():
    return contracts(app.state.research)


@app.get('/api/design/examples/iec')
def iec_example():
    return synthetic_iec()


@app.get('/api/design/examples/cable')
def cable_example():
    return example()


@app.get('/api/design/workspaces/{wid}/deliveries/{did}/file')
def delivery_file(wid: str, did: str):
    delivery = app.state.research.delivery(wid, did)
    filename = 'cable-specification.html' if 'CableSimPro 型号规格书草稿' in delivery['html'] else 'ampacity-report.html'
    return Response(delivery['html'], media_type='text/html',
                    headers={'Content-Disposition': f'attachment; filename="{filename}"'})


@app.post('/api/design/workspaces/{wid}/deliveries', status_code=201)
def current_delivery(wid: str, body: DeliveryRequest):
    if len(body.run_ids) != 1:
        from design.workbench.type_rating import is_rating_table
        runs = app.state.research.verified_runs(wid, body.run_ids)
        geometry = [r for r in runs if any('x-cablesim.cad-model' in c.get('artifacts', {}) for c in r['output']['cases'])]
        ratings = [r for r in runs if is_rating_table(r)]
        if len(runs) != 2 or len(geometry) != 1 or len(ratings) != 1:
            raise HTTPException(422, '规格书只接受一个结构推导和一个载流量表运行。')
    return app.state.research.deliver(wid, body.run_ids, current_only=True)


class DesignFiles(StaticFiles):
    # This is a local editing server: a future/matching Last-Modified must not
    # leave the browser rendering an earlier layout after a source edit.
    def is_not_modified(self, response_headers, request_headers):
        return False

    async def get_response(self, path, scope):
        path = path.replace('\\', '/')
        prefix='node_modules/.cache/cablesim-occt/'
        if path.startswith(prefix) and path[len(prefix):] in ('occt-viewer.js','occt-viewer.wasm'):
            digest=Request(scope).query_params.get('v')
            if digest:
                asset=Path(self.directory)/path
                if not asset.is_file() or sha256(asset.read_bytes()).hexdigest()!=digest:
                    return JSONResponse({'detail':'CAD 运行文件已更新，请刷新页面。'},status_code=409,headers={'Cache-Control':'no-store'})
                headers={'Cache-Control':'public, max-age=31536000, immutable','ETag':'"'+digest+'"','Vary':'Accept-Encoding'}
                if Request(scope).headers.get('if-none-match') == headers['ETag']:
                    return Response(status_code=304,headers=headers)
                compressed=asset.with_name(asset.name+'.gz')
                if path.endswith('.wasm') and compressed.is_file() and 'gzip' in Request(scope).headers.get('accept-encoding',''):
                    headers['Content-Encoding']='gzip'
                    return FileResponse(compressed,media_type='application/wasm',headers=headers)
                return FileResponse(asset,media_type='application/wasm' if path.endswith('.wasm') else 'application/javascript',headers=headers)
        response=await super().get_response(path,scope)
        response.headers['Cache-Control']='no-store'
        return response


app.mount('/design', DesignFiles(directory=ROOT / 'design', html=True), name='design')
# The host's unknown-API catch-all must remain last after prototype routes.
fallback = next(route for route in app.router.routes if getattr(route, 'path', None) == '/api/{path:path}')
app.router.routes.remove(fallback)
app.router.routes.append(fallback)

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8027)
