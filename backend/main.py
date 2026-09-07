"""Run from repository root: python -m uvicorn backend.main:app --reload."""
from contextlib import asynccontextmanager
import os
from pathlib import Path
from uuid import UUID
from fastapi import FastAPI, HTTPException, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from .agent import router as agent_router
from .catalog import presets
from .engine import MODEL_VERSION, ModelError, calculate
from .report import render_report
from .schemas import Scenario, SweepRequest
from .storage import ProjectStore
from .workbench import WorkspaceStore, make_router
from .providers import Providers, router as integrations_router
from .library import Library, make_router as library_router
from .selection import Designs, make_router as designs_router
from urllib.parse import urlsplit
ROOT = Path(__file__).resolve().parent.parent


def create_app(db_path: str | Path | None = None) -> FastAPI:
    store = ProjectStore(db_path or os.environ.get('CABLESIM_DB', str(ROOT / '.data' / 'cablesim.sqlite')))
    workspace_store = WorkspaceStore(store.path)
    providers = Providers(Path(store.path).parent)
    library = Library(workspace_store, Path(store.path).parent)
    designs = Designs(workspace_store)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        store.initialize()
        workspace_store.initialize()
        library.initialize()
        designs.initialize()
        yield

    app = FastAPI(title='CableSimPro · Engineering Workspace', version='0.4.1', lifespan=lifespan)
    app.include_router(agent_router)
    app.include_router(make_router(workspace_store, providers))
    app.include_router(integrations_router(providers))
    app.include_router(library_router(library, providers))
    app.include_router(designs_router(designs))
    app.state.providers = providers
    app.state.library = library
    app.state.designs = designs

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
        return {'status': 'ok', 'model_version': MODEL_VERSION, 'scope': 'single-circuit-direct-buried-demo'}

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
        points = []
        for value in request.values:
            payload = request.scenario.model_dump()
            payload['installation'][request.parameter] = value
            try:
                result = calculate(Scenario.model_validate(payload), include_field=False)
                points.append({'value': value, 'ampacity_a': result['summary']['ampacity_a'], 'error': None})
            except (ValidationError, ModelError) as exc:
                points.append({'value': value, 'ampacity_a': None, 'error': str(exc)})
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

    dist = ROOT / 'frontend' / 'dist'
    if (dist / 'index.html').exists():
        app.mount('/', StaticFiles(directory=dist, html=True), name='frontend')
    else:
        @app.get('/', response_class=HTMLResponse)
        def home():
            return "<h1>CableSimPro API 已启动</h1><p>请构建 frontend 或运行 python scripts/run_demo.py。</p><a href='/docs'>API 文档</a>"
    return app


app = create_app()
