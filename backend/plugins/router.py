"""Typed marketplace endpoints; browsing and planning never execute plugins."""
from uuid import UUID
from fastapi import APIRouter
from fastapi.responses import FileResponse
from .contracts import PluginManifest, ProjectPluginLock
from .service import InstallRequest, InstallApproval, ProjectApproval, UninstallRequest, PluginInvocation
from .managed_commands import COMMAND_ARGUMENTS
from .buried_contract import BuriedField, BuriedSummary
from .electrothermal_contract import ElectrothermalSummary
from .line_source_contract import LineSourceComparison
from .line_source_extension import install_line_source_extension

install_line_source_extension()


def make_router(service):
    router = APIRouter(prefix='/api/plugins', tags=['plugins'])

    @router.get('/catalog')
    def catalog(): return service.catalog_view()

    @router.get('/spec')
    def spec():
        return {'manifest': PluginManifest.model_json_schema(), 'lock': ProjectPluginLock.model_json_schema(),
                'commands': {k: v.model_json_schema() for k, v in COMMAND_ARGUMENTS.items()},
                'artifacts': {'buried-field': BuriedField.model_json_schema(),
                              'buried-summary': BuriedSummary.model_json_schema(),
                              'electrothermal-summary': ElectrothermalSummary.model_json_schema(),
                              'line-source-crosscheck': LineSourceComparison.model_json_schema()}}

    @router.post('/install-plan')
    def plan(body: InstallRequest): return service.plan(body)

    @router.post('/install')
    def install(body: InstallApproval): return service.install(body)

    @router.post('/uninstall')
    def uninstall(body: UninstallRequest): return service.uninstall(body)

    @router.get('/workspaces/{wid}/lock')
    def lock(wid: UUID): return service.project_lock(str(wid))

    @router.post('/workspaces/{wid}/enable')
    def enable(wid: UUID, body: ProjectApproval): return service.enable(str(wid), body)

    @router.post('/workspaces/{wid}/invoke')
    async def invoke(wid: UUID, body: PluginInvocation): return await service.invoke(str(wid), body)

    @router.get('/workspaces/{wid}/jobs')
    def jobs(wid: UUID): return service.jobs(str(wid))

    @router.get('/workspaces/{wid}/jobs/{tid}/artifacts/{name}')
    def artifact(wid: UUID, tid: UUID, name: str):
        return FileResponse(service.artifact(str(wid), str(tid), name), filename=name, media_type='application/octet-stream')

    return router
