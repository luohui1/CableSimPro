"""Run from repository root: python -m uvicorn backend.main:app --reload."""
from contextlib import asynccontextmanager
import os
from pathlib import Path
from uuid import UUID
from fastapi import FastAPI, HTTPException, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import ValidationError
from .agent import router as agent_router
from .catalog import presets
from . import __version__
from .methods import MODEL_VERSION, ModelError, calculate, calculate_many
from .report import render_report
from .schemas import Scenario, SweepRequest
from .storage import ProjectStore
from .workbench import make_router
from .sqlite_workspace import WorkspaceStore
from .providers import Providers, router as integrations_router
from .library import Library, make_router as library_router
from .selection import Designs, make_router as designs_router
from urllib.parse import urlsplit
from .nonblocking_runtime import EngineeringRuntime
from .runtime import make_router as runtime_router
from .enterprise import Enterprise, make_router as enterprise_router
from .foundation.router import make_router as foundation_router
from .foundation.assets import AssetRepository, AssetError
from .foundation.asset_router import make_router as asset_router
from .foundation.reproduction_library import make_router as reproduction_library_router
from .plugins.service import PluginService
from .plugins.catalog import PluginError
from .plugins.router import make_router as plugin_router
from .kernel.research import Research
from .kernel.type_versions import Types, make_router as type_versions_router
from .kernel.router import make_router as research_router
from .kernel.ownership import OwnerLock
from .plugin_host import PluginHostError
from .domain.router import make_router as domain_router
ROOT = Path(__file__).resolve().parent.parent


def create_app(db_path: str | Path | None = None) -> FastAPI:
    store = ProjectStore(db_path or os.environ.get('CABLESIM_DB', str(ROOT / '.data' / 'cablesim.sqlite')))
    workspace_store = WorkspaceStore(store.path)
    assets = AssetRepository(store.path)
    providers = Providers(Path(store.path).parent)
    library = Library(workspace_store, Path(store.path).parent)
    designs = Designs(workspace_store)
    enterprise = Enterprise(workspace_store, designs)
    runtime = EngineeringRuntime(workspace_store, designs, library, providers, enterprise)
    plugins = PluginService(workspace_store, runtime)
    research = Research(workspace_store, plugins)
    from .kernel.batch_service import Batches,make_router as batch_router
    batches = Batches(research,root=os.environ.get('CABLESIM_DATASETS_DIR'))
    types = Types(research, assets)
    runtime.research = research
    owner = OwnerLock(store.path)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        owner.acquire()
        try:
            store.initialize()
            workspace_store.initialize()
            assets.initialize()
            library.initialize()
            designs.initialize()
            enterprise.initialize()
            runtime.initialize()
            plugins.initialize()
            research.initialize()
            batches.initialize()
            types.initialize()
            from .kernel.candidates import initialize as initialize_candidates
            with workspace_store.db(True) as db:
                initialize_candidates(db)
            yield
        finally:
            batches.close()
            # The workspace store deliberately holds one idle SQLite connection so
            # WAL cleanup/checkpointing is an application-shutdown concern instead
            # of something an arbitrary UI request can inherit on connection close.
            workspace_store.close()
            owner.close()

    app = FastAPI(title='CableSimPro · Engineering Workspace', version=__version__, lifespan=lifespan)
    app.include_router(agent_router)
    app.include_router(make_router(workspace_store, providers))
    app.include_router(integrations_router(providers))
    app.include_router(library_router(library, providers))
    app.include_router(designs_router(designs))
    app.include_router(runtime_router(runtime))
    app.include_router(enterprise_router(enterprise))
    app.include_router(foundation_router(workspace_store))
    app.include_router(asset_router(assets, workspace_store))
    app.include_router(reproduction_library_router(os.environ.get('CABLESIM_REPRODUCTION_LIBRARY',str(ROOT/'.data/simulation/library'))))
    app.include_router(plugin_router(plugins))
    app.include_router(research_router(research))
    app.include_router(batch_router(batches))
    from .kernel.candidates import make_router as candidate_router
    app.include_router(candidate_router(workspace_store))
    app.include_router(domain_router(workspace_store))
    app.include_router(type_versions_router(types))
    app.state.types = types
    app.state.assets = assets
    app.state.research = research
    app.state.batches = batches
    app.state.plugins = plugins
    app.state.workspace_store = workspace_store
    app.state.enterprise = enterprise
    app.state.providers = providers
    app.state.library = library
    app.state.designs = designs

    @app.exception_handler(PluginError)
    async def plugin_error(request, exc):
        return JSONResponse({'detail': {'code': exc.code, 'message': exc.message}}, status_code=exc.status)

    @app.exception_handler(PluginHostError)
    async def method_error(request, exc):
        return JSONResponse({'detail': {'code': exc.code, 'message': exc.message}}, status_code=exc.status)

    @app.exception_handler(AssetError)
    async def asset_error(request, exc):
        return JSONResponse({"detail": {"code": exc.code, "message": exc.message}}, status_code=exc.status)

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
            if length and (not length.isdigit() or int(length)>11*1024*1024):
                return JSONResponse({'detail':'请求体超过 11 MiB 限制。'}, status_code=413)
        response = await call_next(request)
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
            response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.get('/api/health')
    def health():
        return {'status': 'ok', 'version': __version__, 'model_version': MODEL_VERSION, 'scope': 'single-circuit-direct-buried-demo'}

    @app.get('/api/presets')
    def get_presets():
        return presets()

    @app.post('/api/validate')
    def validate(scenario: Scenario):
        return scenario

    @app.post('/api/calculate')
    def run_calculation(scenario: Scenario):
        try:
            return calculate(scenario)
        except ModelError as exc:
            raise HTTPException(422, detail=str(exc)) from exc

    @app.post('/api/sweep')
    def sweep(request: SweepRequest):
        points, scenarios, slots = [], [], []
        for value in request.values:
            payload = request.scenario.model_dump()
            payload['installation'][request.parameter] = value
            try:
                scenarios.append(Scenario.model_validate(payload))
                slots.append(len(points))
                points.append({'value': value, 'ampacity_a': None, 'error': None})
            except ValidationError as exc:
                points.append({'value': value, 'ampacity_a': None, 'error': str(exc)})
        for slot, result in zip(slots, calculate_many(scenarios)):
            if isinstance(result, ModelError):
                points[slot]['error'] = str(result)
            else:
                points[slot]['ampacity_a'] = result['summary']['ampacity_a']
        return {'parameter': request.parameter, 'points': points}

    @app.post('/api/report', response_class=HTMLResponse)
    def report(scenario: Scenario):
        try:
            return render_report(calculate(scenario, include_field=False))
        except ModelError as exc:
            raise HTTPException(422, detail=str(exc)) from exc

    @app.get('/api/projects')
    def list_projects():
        return store.list()

    @app.post('/api/projects', status_code=201)
    def create_project(scenario: Scenario):
        return store.save(scenario)

    @app.get('/api/projects/{project_id}')
    def get_project(project_id: UUID):
        project = store.get(str(project_id))
        if project is None:
            raise HTTPException(404, '工程不存在。')
        return project

    @app.put('/api/projects/{project_id}')
    def update_project(project_id: UUID, scenario: Scenario):
        try:
            return store.save(scenario, str(project_id))
        except KeyError as exc:
            raise HTTPException(404, '工程不存在。') from exc

    @app.delete('/api/projects/{project_id}', status_code=204)
    def delete_project(project_id: UUID):
        if not store.delete(str(project_id)):
            raise HTTPException(404, '工程不存在。')
        return Response(status_code=204)

    @app.api_route('/api/{path:path}', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
    def unknown_api(path: str):
        raise HTTPException(404, 'API endpoint not found')

    # The user interface is being rebuilt (docs/design/FRONTEND_REQUIREMENTS.md); until then only the API is served.
    @app.get('/', response_class=HTMLResponse)
    def home():
        return "<h1>CableSimPro API 已启动</h1><p>界面正在重建。</p><a href='/docs'>API 文档</a>"
    return app


app = create_app()
