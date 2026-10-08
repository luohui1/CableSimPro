"""Formal preview, input discovery and current-result delivery endpoints."""
from collections import OrderedDict
from hashlib import sha256
import json
from pathlib import Path
from threading import Lock
from time import perf_counter
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response
from pydantic import Field, JsonValue
from ..domain.models import DomainDocument
from ..domain.editing import DraftDomainDocument, resolve_edit
from ..plugin_host import Executor, PluginHostError
from ..plugin_host.resident import ResidentRunner
from ..schemas import Scenario, StrictModel
from .contracts import Method
from .report_attachments import CadReportImage, FemChapterReference
from .responses import VersionStatus
from .workspace import fingerprint
from .simulation_contract import ProblemContract, contract as problem_contract


class ApiErrorDetail(StrictModel):
    code: str = Field(description='Stable machine-readable error code.')
    message: str = Field(description='Actionable correction or failure description.')


class ApiError(StrictModel):
    detail: ApiErrorDetail | list[dict[str, JsonValue]] = Field(description='Coded business failure, or field validation issues with loc/msg/type.')


ERRORS = {code: {'model': ApiError} for code in (404, 409, 422, 503)}


class GeometryPreview(StrictModel):
    expected_revision: int = Field(ge=1, description='Saved workspace revision; preview does not save input.')
    document: DraftDomainDocument = Field(description='Complete preview input; lengths m, temperatures K, RMS currents A. Dependent type coordinates follow the saved construction before full validation.')
    method: Method = Field(description='Exact geometry capability and sealed plugin release.')
    parameters: dict[str, JsonValue] = Field(description='Capability parameters from the installed input contract; SI units.')
    reuse_from: str | None = Field(default=None, pattern=r'^[0-9a-f]{64}$', description='Prior preview request SHA256; optional cache hint only.')


class PreviewProfiling(StrictModel):
    queue_ms: float = Field(ge=0, description='Host admission and queue time, ms.')
    validation_ms: float = Field(ge=0, description='Host preparation time, ms.')
    server_ms: float = Field(ge=0, description='Total server response time, ms; not a solver benchmark.')


class ReleasePin(StrictModel):
    plugin_id: str = Field(description='Used plugin identity; capability is bound by the preview request.')
    version: str = Field(description='Exact used version.')
    release_digest: str = Field(pattern=r'^[0-9a-f]{64}$', description='Used sealed manifest SHA256.')


class GeometryPreviewResult(StrictModel):
    status: Literal['ready']
    effect: Literal['preview']
    method: ReleasePin
    input_sha256: str = Field(pattern=r'^[0-9a-f]{64}$', description='Canonical domain input SHA256.')
    request_sha256: str = Field(pattern=r'^[0-9a-f]{64}$', description='Executor request SHA256.')
    base_revision: int = Field(ge=1, description='Workspace revision at admission.')
    environment: dict[str, JsonValue] = Field(description='Observed execution environment.')
    artifacts: dict[str, JsonValue] = Field(description='Verified CAD model/scene artifacts indexed by declared type.')
    warnings: list[dict[str, JsonValue]]
    profiling: PreviewProfiling


class InputContract(StrictModel):
    method: Method
    input_schema: str = Field(description='Versioned plugin input schema identity.')
    schema_: dict[str, JsonValue] = Field(alias='schema', description='Complete input JSON Schema with field unit descriptions.')
    parameter_schema: dict[str, JsonValue] = Field(description='Capability parameter JSON Schema; SI units.')
    standalone_schema: dict[str, JsonValue] | None = None
    standalone_parameter_schema: dict[str, JsonValue] | None = None
    schema_digest: str | None = Field(default=None, description='Published input schema SHA256.')
    source: str | None = Field(default=None, description='Repository-relative contract source.')
    source_sha256: str | None = None
    parameter_source: str | None = Field(default=None, description='Host admission model source when it adds typed presentation fields to the plugin contract.')
    parameter_source_sha256: str | None = None
    input_sources: list[Literal['domain', 'study']]
    reference_only: bool = False
    tasks: list[str] = Field(description='Supported study task identities.')
    engineering_fields: list[dict[str, JsonValue]] | None = None
    parameter_groups: list[dict[str, JsonValue]] = Field(default_factory=list, alias='x-groups')
    headlines: list[dict[str, JsonValue]] = Field(default_factory=list, alias='x-headline', max_length=3)
    input_binding: dict[str, JsonValue] | None = None
    preview: bool = False
    preview_timeout_s: int | None = None


class IecExample(StrictModel):
    input: dict[str, JsonValue] = Field(description='Public synthetic scalar input; units defined by its input contract.')
    source: str
    source_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    label: str = Field(description='Example status; not manufacturer or licensed standard data.')


class CableExample(StrictModel):
    document: DomainDocument
    scenario: Scenario = Field(description='Compatibility example only; execution uses document.')
    source: str


class CurrentDeliveryRequest(StrictModel):
    run_ids: list[UUID] = Field(min_length=1, max_length=2, description='One current study run, or geometry plus rating-table runs for a specification.')
    request_id: UUID | None = Field(default=None, description='Retry identity; reuse with identical source runs.')
    cad_images: list[CadReportImage] = Field(default_factory=list, max_length=1, description='One exported CAD display image with colour scale and saved-run provenance.')
    fem_chapter: FemChapterReference | None = Field(default=None, description='Host rebuilds the chapter from these saved runs; client values are never trusted.')


class DeliverySource(StrictModel):
    run_id: UUID
    input_digest: str = Field(pattern=r'^[0-9a-f]{64}$')
    output_digest: str = Field(pattern=r'^[0-9a-f]{64}$')


class DeliveryResult(StrictModel):
    id: UUID
    workspace: UUID
    sources: list[DeliverySource]
    renderer: str = Field(description='Versioned report renderer.')
    html: str = Field(description='Saved HTML; export never reruns calculation.')
    digest: str = Field(pattern=r'^[0-9a-f]{64}$', description='SHA256 of renderer, sources and HTML.')
    created: str = Field(description='UTC creation timestamp.')
    version_status: VersionStatus = Field(description='Current version status of source runs; saved HTML and its digest are not rewritten.')


class DeliverySummary(StrictModel):
    id: UUID = Field(description='Immutable delivery identity.')
    workspace: UUID
    kind: Literal['calculation','specification'] = Field(description='Saved calculation book or specification.')
    version: int = Field(ge=1,description='One-based generation sequence within this workspace; no unit.')
    renderer: str = Field(description='Exact renderer version used to create this delivery.')
    created: str = Field(description='UTC generation time; ISO 8601.')
    sources: list[DeliverySource] = Field(description='Saved source runs and input/output SHA256; export does not rerun them.')
    digest: str = Field(pattern=r'^[0-9a-f]{64}$',description='Integrity digest of renderer, sources and content.')
    download_url: str = Field(description='Relative API URL for integrity-checked saved HTML.')
    media_type: Literal['text/html'] = 'text/html'
    version_status: VersionStatus = Field(description='Dynamic source-version warning for an immutable historical delivery.')


def fail(status, code, message):
    raise HTTPException(status, {'code': code, 'message': message})


def host_call(function, *args, **kwargs):
    try:
        return function(*args, **kwargs)
    except HTTPException as error:
        if isinstance(error.detail, dict) and 'code' in error.detail:
            raise
        code = {404:'RESOURCE_NOT_FOUND', 409:'INPUT_OR_RESULT_CONFLICT', 422:'INPUT_OR_SCOPE_INVALID'}.get(error.status_code,'HOST_REQUEST_FAILED')
        fail(error.status_code, code, str(error.detail))


class Previews:
    def __init__(self, research):
        self.research, self.cache, self.guard = research, OrderedDict(), Lock()
        self.jobs = Path(__file__).resolve().parents[2] / '.tmp' / 'cad-jobs'
        self.jobs.mkdir(parents=True, exist_ok=True)
        self.runner = ResidentRunner(self.jobs.parent / 'cad-workers')

    def close(self):
        self.runner.close()

    def preview(self, wid, body):
        started = perf_counter()
        snapshot = self.research.store.snapshot(wid)
        if snapshot['revision'] != body.expected_revision:
            fail(409, 'WORKSPACE_REVISION_CONFLICT', '型号已更新，请重新打开后预览。')
        if 'domain' not in snapshot:
            fail(422, 'DOMAIN_INPUT_REQUIRED', 'document：请先保存领域工程输入，再生成几何预览。')
        document = resolve_edit(snapshot, body.document)
        plugin, capability = self.research.resolve(body.method.model_dump(mode='json'))
        if capability.analysis != 'geometry' or capability.input_schema != 'cablesim.domain/1':
            fail(422, 'GEOMETRY_CAPABILITY_REQUIRED', '请选择接受领域输入的几何预览能力。')
        parameters = {k: v for k, v in body.parameters.items() if k != '_preview_reuse'}
        identity = fingerprint({'workspace': wid, 'revision': body.expected_revision,
                                'method': body.method.model_dump(), 'input': document, 'parameters': parameters})
        # Concurrent duplicate clicks share one preview; only successful results enter the cache.
        with self.guard:
            if identity in self.cache:
                self.cache.move_to_end(identity)
                return self.cache[identity]
            prepared = perf_counter()
            executor = self.research.executor
            if not (hasattr(executor, 'required') and executor.required(plugin.manifest.id)):
                executor = Executor(registry=self.research.executor.registry,
                                    jobs_root=self.jobs, process_runner=self.runner)
            try:
                result = executor.run(plugin.manifest.id, capability.id,
                                      [{'case_id': 'preview', 'input': document, 'parameters': parameters}], expected_manifest=plugin.manifest)
            except PluginHostError as error:
                fail(error.status, error.code, error.message)
            case = result.cases[0]
            if case.status != 'succeeded':
                error = case.error or {'code': 'PREVIEW_FAILED', 'message': '请检查输入和插件环境。'}
                fail(422, error['code'], error['message'])
            payload = {'status': 'ready', 'effect': 'preview', 'method': self.research.pin(plugin),
                       'input_sha256': sha256(json.dumps(document, sort_keys=True, ensure_ascii=False, allow_nan=False).encode('utf-8')).hexdigest(),
                       'request_sha256': result.request_sha256,
                       'base_revision': body.expected_revision, 'environment': result.environment,
                       'artifacts': case.artifacts, 'warnings': case.warnings,
                       'profiling': {'queue_ms': (prepared-started)*1000, 'validation_ms': (prepared-started)*1000,
                                     'server_ms': (perf_counter()-started)*1000}}
            self.cache[identity] = payload
            while len(self.cache) > 6:
                self.cache.popitem(last=False)
            return payload


def make_router(research, previews):
    router = APIRouter(prefix='/api', tags=['Host inputs and delivery'])
    from .database_ops import make_router as database_router
    router.include_router(database_router(research.store))

    @router.get('/simulation/problem-contract',response_model=ProblemContract,responses=ERRORS)
    def simulation_problem_contract():
        return problem_contract()

    @router.get('/workspaces/{wid}/deliveries', response_model=list[DeliverySummary], responses=ERRORS)
    def deliveries(wid:UUID):
        with research.store.db() as db:
            host_call(research.store.load,db,str(wid))
            ids=[r['id'] for r in db.execute('SELECT id FROM deliveries WHERE workspace=? ORDER BY rowid',(str(wid),))]
        results=[]
        for version,did in enumerate(ids,1):
            saved=host_call(research.delivery,str(wid),did)
            results.append({k:saved[k] for k in ('id','workspace','renderer','created','sources','digest','version_status')})
            results[-1].update(version=version,kind='specification' if 'data-specification-section=' in saved['html'] else 'calculation',download_url=f'/api/workspaces/{wid}/deliveries/{did}/file')
        return results[::-1]

    @router.post('/design/workspaces/{wid}/geometry-preview', response_model=GeometryPreviewResult, responses=ERRORS, deprecated=True)
    @router.post('/workspaces/{wid}/geometry-preview', response_model=GeometryPreviewResult, responses=ERRORS)
    def geometry_preview(wid: UUID, body: GeometryPreview):
        return host_call(previews.preview, str(wid), body)

    @router.get('/design/input-contracts', response_model=list[InputContract], responses=ERRORS, deprecated=True)
    @router.get('/input-contracts', response_model=list[InputContract], responses=ERRORS)
    async def input_contracts():
        from .input_contracts import contracts
        from .read_responses import read_response
        return await read_response(research, ('input-contracts',), None,
            lambda: contracts(research, encoded=True), uses_database=False)

    @router.get('/design/examples/iec', response_model=IecExample, deprecated=True)
    @router.get('/examples/iec', response_model=IecExample)
    def iec_example():
        from .input_contracts import synthetic_iec
        return synthetic_iec()

    @router.get('/design/examples/cable', response_model=CableExample, deprecated=True)
    @router.get('/examples/cable', response_model=CableExample)
    def cable_example():
        from .cable_example import example
        return example()

    @router.post('/design/workspaces/{wid}/deliveries', status_code=201, response_model=DeliveryResult, responses=ERRORS, deprecated=True)
    @router.post('/workspaces/{wid}/deliveries/current', status_code=201, response_model=DeliveryResult, responses=ERRORS)
    def current_delivery(wid: UUID, body: CurrentDeliveryRequest):
        if len(body.run_ids) != 1:
            from .rating_conditions import is_rating_table
            runs = research.verified_runs(str(wid), body.run_ids)
            geometry = [r for r in runs if any('x-cablesim.cad-model' in c.get('artifacts', {}) for c in r['output']['cases'])]
            ratings = [r for r in runs if is_rating_table(r)]
            if len(geometry) != 1 or len(ratings) != 1:
                fail(422, 'DELIVERY_SOURCE_COMBINATION_INVALID', '规格书请选择一个结构推导和一个载流量表运行。')
        try:
            return host_call(research.deliver, str(wid), body.run_ids, request_id=body.request_id, current_only=True,
                             cad_images=[v.model_dump(mode='json', by_alias=True) for v in body.cad_images],
                             fem_chapter=body.fem_chapter.model_dump(mode='json') if body.fem_chapter else None)
        except (ValueError, OSError) as exc:
            fail(422, 'REPORT_ATTACHMENT_INVALID', str(exc))

    file_response = {**ERRORS, 200: {'content': {'text/html': {'schema': {'type': 'string'}}}, 'description': 'Integrity-checked saved HTML attachment.'}}

    @router.get('/design/workspaces/{wid}/deliveries/{did}/file', responses=file_response, deprecated=True, response_class=Response)
    @router.get('/workspaces/{wid}/deliveries/{did}/file', responses=file_response, response_class=Response)
    def delivery_file(wid: UUID, did: UUID):
        delivery = host_call(research.delivery, str(wid), str(did))
        filename = 'cable-specification.html' if 'data-specification-section=' in delivery['html'] else 'ampacity-report.html'
        return Response(delivery['html'], media_type='text/html', headers={
            'Content-Disposition': f'attachment; filename="{filename}"', 'X-Artifact-SHA256': delivery['digest']})

    return router
