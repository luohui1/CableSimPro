"""Read-only, bounded, all-or-nothing batches of pinned formal deliveries.

Series membership is an explicit user selection, not an inferred relationship
between model names or revision families. No file is written outside memory;
all sources are checked again after all rendered files and the ZIP are ready.
"""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
from pathlib import PurePosixPath
from typing import Annotated, Literal, TYPE_CHECKING
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from fastapi import HTTPException
from pydantic import Field, StringConstraints, field_validator, model_validator

from .formal_contracts import Digest, PreviewRequest, StrictRequest, canonical_bytes, fail, jsonsha

if TYPE_CHECKING:
    from .formal_deliveries import FormalDeliveries


BATCH_SCHEMA = 'cablesim.formal-batch/1'
MAX_ITEMS = 16
MAX_FILES = 32
MAX_SOURCE_BYTES = 128 * 1024 * 1024
MAX_ARCHIVE_BYTES = 128 * 1024 * 1024  # Uncompressed files, including manifest.json.
MAX_FILE_BYTES = 64 * 1024 * 1024
ItemKey = Annotated[str, StringConstraints(pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$')]
WorkspaceId = Annotated[str, StringConstraints(min_length=1, max_length=128)]
FileFormat = Literal['pdf', 'xlsx']


class ProjectScope(StrictRequest):
    kind: Literal['project']
    workspace_id: WorkspaceId


class SeriesScope(StrictRequest):
    kind: Literal['series']
    series_name: str = Field(min_length=1, max_length=120)
    workspace_ids: list[WorkspaceId] = Field(min_length=1, max_length=MAX_ITEMS)

    @field_validator('series_name')
    @classmethod
    def printable_name(cls, value):
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError('系列名称不能包含控制字符或换行。')
        if not value.strip():
            raise ValueError('系列名称不能为空。')
        return value.strip()

    @field_validator('workspace_ids')
    @classmethod
    def unique_members(cls, value):
        if len(value) != len(set(value)):
            raise ValueError('系列中明确选择的工程不可重复。')
        return value


class BatchItem(PreviewRequest):
    key: ItemKey
    formats: list[FileFormat] = Field(min_length=1, max_length=2)

    @field_validator('formats')
    @classmethod
    def unique_formats(cls, value):
        if len(value) != len(set(value)):
            raise ValueError('同一批量条目的文件格式不可重复。')
        return value


class BatchPreviewRequest(StrictRequest):
    scope: Annotated[ProjectScope | SeriesScope, Field(discriminator='kind')]
    items: list[BatchItem] = Field(min_length=1, max_length=MAX_ITEMS)

    @model_validator(mode='after')
    def exact_members_and_revisions(self):
        if len({item.key.casefold() for item in self.items}) != len(self.items):
            raise ValueError('批量条目的 key 不可重复，大小写视为相同。')
        if sum(len(item.formats) for item in self.items) > MAX_FILES:
            raise ValueError('批量最多导出 32 份文件。')
        revisions = {}
        for item in self.items:
            workspace_id, revision = item.source.workspace_id, item.source.expected_revision
            if workspace_id in revisions and revisions[workspace_id] != revision:
                raise ValueError('同一工程的批量条目必须固定相同的工程修订。')
            revisions[workspace_id] = revision
        members = {self.scope.workspace_id} if self.scope.kind == 'project' else set(self.scope.workspace_ids)
        if set(revisions) != members:
            raise ValueError('批量范围须与条目实际选择的工程集合完全一致；不推断系列成员。')
        return self


class BatchExportRequest(BatchPreviewRequest):
    expected_batch_digest: Digest


@contextmanager
def _item_errors(item: BatchItem, index: int, stage: str):
    """Keep the original failure and identify the item without a partial ZIP."""
    try:
        yield
    except Exception as error:
        status = error.status_code if isinstance(error, HTTPException) else 500
        detail = error.detail if isinstance(error, HTTPException) else {
            'code': type(error).__name__, 'message': str(error)}
        # A source that disappeared, became invalid or lost its approval while
        # files were being generated is a conflict with this pinned batch.
        response_status = 409 if stage == 'revalidate' and status in (404, 409, 410, 422) else status
        raise HTTPException(status_code=response_status, detail={
            'code': 'FORMAL_BATCH_ITEM_FAILED',
            'message': '批量条目失败，未返回任何交付文件。',
            'item': {'index': index, 'key': item.key, 'kind': item.kind,
                     'workspace_id': item.source.workspace_id},
            'stage': stage, 'cause_status': status, 'cause': detail,
        }) from error


@contextmanager
def _archive_errors():
    """An aggregate budget or ZIP failure belongs to the batch, not an item."""
    try:
        yield
    except Exception as error:
        status = error.status_code if isinstance(error, HTTPException) else 500
        detail = error.detail if isinstance(error, HTTPException) else {
            'code': type(error).__name__, 'message': str(error)}
        raise HTTPException(status_code=status, detail={
            'code': 'FORMAL_BATCH_ARCHIVE_FAILED',
            'message': '整包归档失败，未返回任何交付文件。',
            'stage': 'archive', 'cause_status': status, 'cause': detail,
        }) from error


def _descriptors(model: dict) -> dict:
    return {identifier: {key: deepcopy(value) for key, value in source.items() if key != 'payload'}
            for identifier, source in model['sources'].items()}


def _safe_paths(paths: list[str]) -> None:
    """Defend Windows and POSIX extraction even if a future path rule changes."""
    seen = {'manifest.json'}
    for name in paths:
        path = PurePosixPath(name)
        if (not name or '\\' in name or path.is_absolute() or path.as_posix() != name
                or any(part in ('.', '..', '') or part.endswith((' ', '.')) or ':' in part for part in path.parts)
                or name.casefold() in seen):
            fail('FORMAL_BATCH_PATH', '批量文件路径不安全或重复。')
        seen.add(name.casefold())


def _archive(entries: list[tuple[str, bytes]]) -> bytes:
    content = BytesIO()
    with ZipFile(content, 'w', compression=ZIP_DEFLATED, compresslevel=6, allowZip64=False) as archive:
        for name, value in entries:
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100600 << 16
            archive.writestr(info, value, compress_type=ZIP_DEFLATED, compresslevel=6)
    return content.getvalue()


class FormalBatches:
    def __init__(self, single_service: FormalDeliveries):
        self.single = single_service

    def _plan(self, request: BatchPreviewRequest) -> tuple[dict, list[dict]]:
        scope = request.scope.model_dump(mode='json')
        if request.scope.kind == 'series':
            scope['membership_source'] = 'explicit_workspace_ids'
        summaries, models, source_bytes = [], [], 0
        for index, item in enumerate(request.items, 1):
            with _item_errors(item, index, 'build'):
                model = self.single.build(item)
                source_bytes += len(canonical_bytes(model['sources']))
                if source_bytes > MAX_SOURCE_BYTES:
                    fail('FORMAL_BATCH_SOURCE_LIMIT', '批量完整来源累计超过 128 MiB，请减少条目；不会截断来源。')
                summaries.append({
                    'index': index, 'key': item.key, 'kind': item.kind, 'title': model['title'],
                    'source': item.source.model_dump(mode='json'),
                    'source_identity': deepcopy(model['source_identity']),
                    'document': item.document.model_dump(mode='json'),
                    'model_digest': model['model_digest'], 'source_digest': model['source_digest'],
                    'sources': _descriptors(model), 'formats': list(item.formats),
                    'files': [{'format': format, 'path': f'{index:03d}-{item.key}/{item.kind}.{format}'}
                              for format in item.formats],
                })
                models.append(model)
        paths = [file['path'] for item in summaries for file in item['files']]
        _safe_paths(paths)
        plan = {'schema': BATCH_SCHEMA, 'scope': scope, 'items': summaries,
                'file_count': len(paths), 'source_bytes': source_bytes}
        return {**plan, 'batch_digest': jsonsha(plan)}, models

    def preview(self, request: BatchPreviewRequest) -> dict:
        plan, _models = self._plan(request)
        return plan

    def export(self, request: BatchExportRequest) -> tuple[dict, bytes]:
        plan, models = self._plan(request)
        if plan['batch_digest'] != request.expected_batch_digest:
            fail('FORMAL_BATCH_CHANGED', '批量预览后的范围、顺序、文件元数据或来源已变化，请重新预览。', 409)
        entries, files, file_bytes = [], [], 0
        for item, summary, model in zip(request.items, plan['items'], models):
            for planned in summary['files']:
                with _item_errors(item, summary['index'], 'render'):
                    content = self.single.render(model, planned['format'])
                    if len(content) > MAX_FILE_BYTES:
                        fail('FORMAL_FILE_LIMIT', '单份文件超过 64 MiB，请减少所选运行；不会截断来源。')
                    file = {
                        'item_index': summary['index'], 'item_key': item.key, 'kind': item.kind,
                        **planned, 'bytes': len(content), 'sha256': sha256(content).hexdigest(),
                        'model_digest': model['model_digest'], 'source_digest': model['source_digest'],
                        'source': deepcopy(summary['source']),
                        'source_identity': deepcopy(summary['source_identity']),
                        'sources': deepcopy(summary['sources']),
                    }
                file_bytes += len(content)
                with _archive_errors():
                    if file_bytes > MAX_ARCHIVE_BYTES:
                        fail('FORMAL_BATCH_ARCHIVE_LIMIT', '批量文件未压缩总量超过 128 MiB，请减少条目。')
                entries.append((planned['path'], content))
                files.append(file)
        manifest = {**plan, 'files': files}
        with _archive_errors():
            manifest_bytes = canonical_bytes(manifest)
            if file_bytes + len(manifest_bytes) > MAX_ARCHIVE_BYTES:
                fail('FORMAL_BATCH_ARCHIVE_LIMIT', '批量文件与完整清单的未压缩总量超过 128 MiB，请减少条目。')
            content = _archive([('manifest.json', manifest_bytes), *entries])
        # Check EVERY item at the end, including an early item's source or
        # signature changed while a later item/format was being rendered.
        for item, summary in zip(request.items, plan['items']):
            with _item_errors(item, summary['index'], 'revalidate'):
                current = self.single.build(item)
                if current['model_digest'] != summary['model_digest']:
                    fail('FORMAL_SOURCE_CHANGED', '生成期间来源或签核记录已变化，整批文件均未返回，请重新预览。', 409)
        return manifest, content
