"""Local engineering host; all calculations use versioned v2 study methods."""
from contextlib import asynccontextmanager
import os
from pathlib import Path
from urllib.parse import urlsplit
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from . import __version__
from .kernel.presets import presets
from .kernel.workspace import make_router as workspace_router
from .sqlite_workspace import WorkspaceStore
from .foundation.router import make_router as foundation_router
from .foundation.assets import AssetRepository, AssetError
from .foundation.asset_router import make_router as asset_router
from .foundation.reproduction_library import make_router as reproduction_library_router
from .kernel.research import Research
from .kernel.type_versions import Types, make_router as type_versions_router
from .kernel.router import make_router as research_router
from .kernel.ownership import OwnerLock
from .plugin_host import PluginHostError
from .domain.router import make_router as domain_router
from .kernel.scenarios import make_router as scenario_router
from .kernel.requirements import make_router as requirements_router
from .kernel.rating_conditions import make_router as rating_table_router

ROOT = Path(__file__).resolve().parent.parent


def create_app(db_path: str | Path | None = None) -> FastAPI:
    workspace_store = WorkspaceStore(db_path or os.environ.get('CABLESIM_DB', str(ROOT/'.data/cablesim.sqlite')))
    assets = AssetRepository(workspace_store.path)
    research = Research(workspace_store)
    from .kernel.host_api import Previews, make_router as host_api_router
    previews = Previews(research)
    from .kernel.batch_service import Batches, make_router as batch_router
    batches = Batches(research, root=os.environ.get('CABLESIM_DATASETS_DIR'))
    types = Types(research, assets)
    from .kernel.datasheets import Documents, make_router as documents_router
    documents = Documents(workspace_store)
    owner = OwnerLock(workspace_store.path)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        owner.acquire()
        try:
            workspace_store.initialize()
            assets.initialize()
            research.initialize()
            batches.initialize()
            types.initialize()
            documents.initialize()
            from .kernel.candidates import initialize
            with workspace_store.db(True) as db:
                initialize(db)
            yield
        finally:
            documents.close()
            previews.close()
            research.close()
            batches.close()
            workspace_store.close()
            owner.close()

    app = FastAPI(title='CableSimPro · Engineering Workspace', version=__version__, lifespan=lifespan)
    app.include_router(workspace_router(workspace_store))
    app.include_router(foundation_router(workspace_store))
    app.include_router(asset_router(assets, workspace_store))
    app.include_router(reproduction_library_router(os.environ.get('CABLESIM_REPRODUCTION_LIBRARY',str(ROOT/'.data/simulation/library'))))
    app.include_router(research_router(research))
    app.include_router(host_api_router(research, previews))
    app.include_router(batch_router(batches))
    from .kernel.candidates import make_router as candidate_router
    app.include_router(candidate_router(workspace_store))
    app.include_router(documents_router(documents))
    app.include_router(domain_router(workspace_store))
    app.include_router(type_versions_router(types))
    app.include_router(scenario_router(workspace_store,research))
    app.include_router(requirements_router(research))
    app.include_router(rating_table_router(research))
    app.state.types, app.state.assets = types, assets
    app.state.research, app.state.batches = research, batches
    app.state.previews = previews
    app.state.workspace_store = workspace_store
    app.state.documents = documents

    @app.exception_handler(PluginHostError)
    async def method_error(request, exc):
        return JSONResponse({'detail': {'code': exc.code, 'message': exc.message}}, status_code=exc.status)

    @app.exception_handler(AssetError)
    async def asset_error(request, exc):
        return JSONResponse({'detail': {'code': exc.code, 'message': exc.message}}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, exc):
        return JSONResponse({'detail':[{'loc':e['loc'],'msg':e['msg'],'type':e['type']} for e in exc.errors()]},status_code=422)

    @app.middleware('http')
    async def local_boundary(request, call_next):
        allowed = {'localhost', '127.0.0.1', '::1', 'testserver'} | {h.strip() for h in os.getenv('CABLESIM_TRUSTED_HOSTS', '').split(',') if h.strip()}
        if request.url.hostname not in allowed:
            return JSONResponse({'detail':'此预览版只接受受信任本机 Host。'}, status_code=403)
        if request.method not in ('GET','HEAD','OPTIONS'):
            origin = request.headers.get('origin')
            if origin and urlsplit(origin).hostname not in allowed:
                return JSONResponse({'detail':'拒绝不受信任的跨站写入。'}, status_code=403)
            length = request.headers.get('content-length')
            maximum = 65*1024*1024 if request.url.path == '/api/documents' else 11*1024*1024
            if length and (not length.isdigit() or int(length)>maximum):
                return JSONResponse({'detail':{'code':'REQUEST_SIZE_LIMIT','message':'请求体超过上传上限。'}}, status_code=413)
        response = await call_next(request)
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
            response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.get('/api/health')
    def health():
        return {'status':'ok', 'version':__version__, 'model_version':'cablesim.domain/1', 'scope':'versioned-plugin-studies'}

    @app.get('/api/presets')
    def get_presets():
        return presets()

    @app.api_route('/api/{path:path}', methods=['GET','POST','PUT','DELETE','PATCH'], include_in_schema=False)
    def unknown_api(path: str):
        raise HTTPException(404, 'API endpoint not found')

    @app.get('/', response_class=HTMLResponse)
    def home():
        return "<h1>CableSimPro API 已启动</h1><a href='/docs'>API 文档</a>"
    return app


app = create_app()
