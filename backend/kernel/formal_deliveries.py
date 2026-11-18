"""Additive, read-only formal PDF/Excel exports with optimistic source pinning."""
from hashlib import sha256
import re
from urllib.parse import quote

from fastapi import APIRouter
from fastapi.responses import Response

from .formal_contracts import ExportRequest, PreviewRequest, fail, filename, public_model
from .formal_batches import BatchExportRequest, BatchPreviewRequest, FormalBatches
from .formal_sources import build_model


MIME = {'pdf': 'application/pdf',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
MAX_FILE_BYTES = 64 * 1024 * 1024


class FormalDeliveries:
    def __init__(self, research, types):
        self.research, self.types = research, types

    def build(self, request: PreviewRequest) -> dict:
        selection = {'kind': request.kind, 'source': request.source.model_dump(mode='json'),
                     'document': request.document.model_dump(mode='json')}
        return build_model(self.research, self.types, selection)

    def preview(self, request: PreviewRequest) -> dict:
        return public_model(self.build(request))

    def render(self, model: dict, format: str) -> bytes:
        if format == 'pdf':
            from .formal_pdf import render_pdf
            content = render_pdf(model)
        elif format == 'xlsx':
            from .formal_xlsx import render_xlsx
            content = render_xlsx(model)
        else:
            fail('FORMAL_FORMAT', '只支持 PDF 和 Excel。')
        if len(content) > MAX_FILE_BYTES:
            fail('FORMAL_FILE_LIMIT', '单份文件超过 64 MiB，请减少所选运行；不会截断来源。')
        return content

    def export(self, request: ExportRequest) -> tuple[dict, bytes]:
        model = self.build(request)
        if model['model_digest'] != request.expected_model_digest:
            fail('FORMAL_MODEL_CHANGED', '预览后的来源、签核记录或文件元数据已变化，请重新预览。', 409)
        content = self.render(model, request.format)
        # Rendering can take seconds. Reject changes committed during that
        # interval instead of returning a file with a stale approval or revision.
        if self.build(request)['model_digest'] != model['model_digest']:
            fail('FORMAL_SOURCE_CHANGED', '生成期间来源或签核记录已变化，未返回文件，请重新预览。', 409)
        return model, content


def file_response(model: dict, content: bytes, format: str) -> Response:
    name = filename(model, format)
    return Response(content, media_type=MIME[format], headers={
        'Content-Disposition': f"attachment; filename=\"CableSimPro-{model['kind']}.{format}\"; filename*=UTF-8''{quote(name, safe='')}",
        'X-Artifact-SHA256': sha256(content).hexdigest(),
        'X-Delivery-Source-SHA256': model['source_digest'],
        'X-Delivery-Model-SHA256': model['model_digest'],
        'Cache-Control': 'no-store',
    })


def batch_response(manifest: dict, content: bytes) -> Response:
    scope = manifest['scope']
    label = scope['series_name'] if scope['kind'] == 'series' else scope['workspace_id']
    label = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', label).strip(' .') or 'CableSimPro'
    name = label + '-正式交付.zip'
    return Response(content, media_type='application/zip', headers={
        'Content-Disposition': f"attachment; filename=\"CableSimPro-formal-batch.zip\"; filename*=UTF-8''{quote(name, safe='')}",
        'X-Artifact-SHA256': sha256(content).hexdigest(),
        'X-Delivery-Batch-SHA256': manifest['batch_digest'],
        'Cache-Control': 'no-store',
    })


def make_router(research, types):
    service = FormalDeliveries(research, types)
    batches = FormalBatches(service)
    router = APIRouter(prefix='/api/formal-deliveries', tags=['formal-deliveries'])

    @router.post('/preview')
    def preview(request: PreviewRequest, response: Response):
        response.headers['Cache-Control'] = 'no-store'
        return service.preview(request)

    @router.post('/export')
    def export(request: ExportRequest):
        model, content = service.export(request)
        return file_response(model, content, request.format)

    @router.post('/batch/preview')
    def batch_preview(request: BatchPreviewRequest, response: Response):
        response.headers['Cache-Control'] = 'no-store'
        return batches.preview(request)

    @router.post('/batch/export')
    def batch_export(request: BatchExportRequest):
        manifest, content = batches.export(request)
        return batch_response(manifest, content)

    return router
