"""Portable current series versions with original tables and unapproved sources.

Both formats carry the identical checked JSON. Approval and execution history
are deliberately kept in the existing whole-database backup/restore workflow.
"""
from base64 import b64encode, b64decode
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
import math
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, Header, UploadFile
from fastapi.responses import Response
from openpyxl import Workbook
from openpyxl.styles import Font
from pydantic import Field, model_validator

from backend.schemas import StrictModel
from . import candidates, factory_tables as tables
from .resource_exchange import MAX_BYTES, TRANSFER_SHEET, _excel_string, parse_file
from .type_import_models import SeriesDeclaration
from .type_library_evidence import ExchangeEvidence
from .workspace import fingerprint, stamp


SCHEMA = 'cablesim.type-library-exchange/1'
METADATA_FIELDS = {'row_number', 'name', 'key', 'area_m2', 'values', 'issues', 'missing', 'status',
                   'derivation', 'closure', 'warnings', 'source_model_digest', 'version_note',
                   'parent_version', 'version_document_sha256', 'exchange_origin'}


class Selection(StrictModel):
    series_ids: list[UUID] = Field(min_length=1, max_length=20)
    format: Literal['json', 'xlsx'] = 'json'

    @model_validator(mode='after')
    def unique(self):
        if len(set(self.series_ids)) != len(self.series_ids):
            raise ValueError('请选择唯一的系列。')
        return self


def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True).encode('utf-8')


def validate_bundle(value):
    if not isinstance(value, dict) or set(value) != {'schema_version', 'created', 'series', 'files', 'sha256'} or value['schema_version'] != SCHEMA:
        tables.fail('TYPE_EXCHANGE_FORMAT', '请选择 CableSimPro 型号库交换文件。')
    if fingerprint({key: data for key, data in value.items() if key != 'sha256'}) != value['sha256']:
        tables.fail('TYPE_EXCHANGE_DIGEST', '型号交换内容与摘要不一致。', 409)
    if not isinstance(value['series'], list) or not 1 <= len(value['series']) <= 20 or not isinstance(value['files'], list) or len(value['files']) > 100:
        tables.fail('TYPE_EXCHANGE_COUNT', '每次交换须为 1–20 个系列、最多 100 个来源文件。')
    files, names, count = {}, set(), 0
    for source in value['files']:
        if not isinstance(source, dict) or set(source) != {'filename', 'sha256', 'content_base64'}:
            tables.fail('TYPE_EXCHANGE_SOURCE', '型号来源原件字段无效。')
        raw = b64decode(source['content_base64'], validate=True)
        if sha256(raw).hexdigest() != source['sha256'] or source['sha256'] in files:
            tables.fail('TYPE_EXCHANGE_SOURCE', '型号来源原件重复或摘要不一致。', 409)
        tables.read(source['filename'], raw)
        files[source['sha256']] = raw
    evidence = ExchangeEvidence(files)
    for series in value['series']:
        if not isinstance(series, dict) or set(series) != {'origin_id', 'declaration', 'specs'}:
            tables.fail('TYPE_EXCHANGE_SERIES', '系列字段无效。')
        UUID(series['origin_id'])
        declaration = SeriesDeclaration.model_validate(series['declaration'])
        if declaration.name in names or not isinstance(series['specs'], list) or not series['specs']:
            tables.fail('TYPE_EXCHANGE_SERIES', '系列名称重复或没有规格。')
        names.add(declaration.name)
        keys = set()
        for item in series['specs']:
            if not isinstance(item, dict) or set(item) != {'origin_id', 'origin_version', 'origin_state', 'payload', 'content_sha256', 'metadata'}:
                tables.fail('TYPE_EXCHANGE_SPEC', '规格交换字段无效。')
            UUID(item['origin_id'])
            if type(item['origin_version']) is not int or item['origin_version'] < 1:
                tables.fail('TYPE_EXCHANGE_SPEC', '来源版本须为正整数。')
            payload = candidates.CableModelVersion.model_validate(item['payload'])
            if fingerprint(item['payload']) != item['content_sha256']:
                tables.fail('TYPE_EXCHANGE_SPEC_DIGEST', '电缆型号版本摘要不一致。', 409)
            metadata = item['metadata']
            if not isinstance(metadata, dict) or not {'key', 'area_m2', 'values', 'missing', 'name', 'status'} <= set(metadata):
                tables.fail('TYPE_EXCHANGE_SPEC', '规格缺少逐数值来源或缺项说明。')
            if set(metadata) - METADATA_FIELDS:
                tables.fail('TYPE_EXCHANGE_METADATA', '规格附带了未定义的元数据；本机型号身份、工作区、审核状态和运行记录不能由交换文件指定。')
            if (not isinstance(metadata['key'], str) or not metadata['key'].strip()
                    or metadata['name'] != payload.name or metadata['status'] not in ('ready', 'incomplete')
                    or type(metadata['area_m2']) not in (int, float) or not math.isfinite(metadata['area_m2'])
                    or not isinstance(metadata['missing'], list) or not all(isinstance(item, str) for item in metadata['missing'])):
                tables.fail('TYPE_EXCHANGE_METADATA', '规格名称、状态、截面或缺项说明无效。')
            if metadata['key'] in keys or not isinstance(metadata['values'], list):
                tables.fail('TYPE_EXCHANGE_SPEC', '规格重复或来源列表无效。')
            keys.add(metadata['key'])
            cable = payload.cable_type
            cores = len(cable.cores) if cable else payload.specification.cores
            area = cable.cores[0].conductor.nominal_area if cable else payload.specification.area_m2
            u0 = cable.rating.u0 if cable else payload.specification.u0_v
            voltage = cable.rating.u if cable else payload.specification.voltage_v
            if (cores != declaration.cores or u0 != declaration.u0_v or voltage != declaration.u_v
                    or abs(area - metadata['area_m2']) > 1e-12 or metadata['key'] != f'{cores}×{area * 1e6:g}'):
                tables.fail('TYPE_EXCHANGE_SERIES', '型号电压、芯数或截面与系列不一致。')
            evidence.facts(item, declaration)
            count += 1
    if count > 200 or len(encoded(value)) > MAX_BYTES:
        tables.fail('TYPE_EXCHANGE_TOO_LARGE', '每次最多 200 个规格或 8 MiB，请分批导出。', 413)
    evidence.verify()
    return value


def workbook_bytes(bundle):
    book = Workbook()
    index = book.active
    index.title = '型号与来源'
    index.append(['系列', '规格', '原版本', '数值', '单位', '字段', '来源'])
    for series in bundle['series']:
        for spec in series['specs']:
            for fact in spec['metadata']['values']:
                values = [series['declaration']['name'], spec['metadata']['name'], spec['origin_version'],
                          fact['value'], fact['unit'], fact['key'], json.dumps(fact['source'], ensure_ascii=False)]
                index.append(values)
                for column in (1, 2, 5, 6, 7):
                    _excel_string(index.cell(index.max_row, column), values[column - 1])
    index.freeze_panes = 'A2'
    index.auto_filter.ref = index.dimensions
    for column, width in [('A', 40), ('B', 42), ('C', 12), ('D', 16), ('E', 12), ('F', 28), ('G', 100)]:
        index.column_dimensions[column].width = width
    for cell in index[1]:
        cell.font = Font(bold=True)
    transfer = book.create_sheet(TRANSFER_SHEET)
    transfer.append(['顺序', 'JSON 内容分段'])
    text = encoded(bundle).decode('utf-8')
    for n, offset in enumerate(range(0, len(text), 16000), 1):
        transfer.append([n, None])
        _excel_string(transfer.cell(n + 1, 2), text[offset:offset + 16000])
    stream = BytesIO()
    book.save(stream)
    return stream.getvalue()


def export(service, selection):
    series, files = [], {}
    with service.store.read_snapshot() as db:
        for identifier in selection.series_ids:
            _, declaration = service._series(db, identifier)
            specs = []
            for row in db.execute('SELECT id FROM type_series_specs WHERE series=? ORDER BY rowid', (str(identifier),)):
                spec = service._spec(db, row['id'])
                if spec['has_design_changes']:
                    tables.fail('TYPE_EXCHANGE_UNSNAPSHOTTED', '规格有尚未改版的设计修改，请先建立新版本再导出。', 409)
                saved = db.execute('SELECT metadata FROM type_series_versions WHERE spec=? AND version=?', (spec['id'], spec['version'])).fetchone()
                metadata = json.loads(saved['metadata'])
                candidate = candidates.read(db, spec['model_id'])
                specs.append({'origin_id': spec['id'], 'origin_version': spec['version'], 'origin_state': spec['state'],
                              'payload': candidate['payload'], 'content_sha256': candidate['digest'], 'metadata': metadata})
                for fact in metadata['values']:
                    digest = fact['source'].get('file_sha256')
                    if not digest or digest in files:
                        continue
                    original = db.execute('SELECT * FROM type_table_uploads WHERE digest=? LIMIT 1', (digest,)).fetchone()
                    if original is None:
                        tables.fail('TYPE_EXCHANGE_SOURCE', '规格的原始结构表已缺失，拒绝导出不完整来源。', 409)
                    files[digest] = {'filename': original['filename'], 'sha256': digest,
                                     'content_base64': b64encode(bytes(original['original'])).decode('ascii')}
            series.append({'origin_id': str(identifier), 'declaration': declaration, 'specs': specs})
    bundle = {'schema_version': SCHEMA, 'created': stamp(), 'series': series, 'files': list(files.values())}
    bundle['sha256'] = fingerprint(bundle)
    validate_bundle(bundle)
    return (workbook_bytes(bundle) if selection.format == 'xlsx' else encoded(bundle)), bundle['sha256']


def preview(service, filename, content):
    bundle = parse_file(filename, content, validator=validate_bundle)
    with service.store.db() as db:
        names = {row['name'] for row in db.execute('SELECT name FROM type_series')}
    return {'file_sha256': sha256(content).hexdigest(), 'bundle_sha256': bundle['sha256'],
            'series': [{'origin_id': s['origin_id'], 'name': s['declaration']['name'], 'spec_count': len(s['specs']),
                        'conflict': s['declaration']['name'] in names} for s in bundle['series']],
            'original_file_count': len(bundle['files']), 'state': 'draft',
            'message': '导入当前规格快照和来源原件；新机不继承审核或运行历史，全部建立草稿。'}


def import_bundle(service, filename, content, reviewed_sha256, confirmed, request_id, actor):
    reviewer = service.types._human(actor)
    if not confirmed or sha256(content).hexdigest() != reviewed_sha256:
        tables.fail('TYPE_EXCHANGE_CONFIRM', '请先预览并人工确认同一份文件。', 409)
    bundle = parse_file(filename, content, validator=validate_bundle)
    request = {'operation': 'exchange', 'file_sha256': reviewed_sha256}
    with service.lock, service.store.db(True) as db:
        replay = service._replay(db, request_id, request)
        if replay:
            return replay
        if any(db.execute('SELECT 1 FROM type_series WHERE name=?', (s['declaration']['name'],)).fetchone() for s in bundle['series']):
            tables.fail('TYPE_EXCHANGE_NAME_CONFLICT', '存在同名系列；整包未导入，请核对目标库后重新操作。', 409)
        for source in bundle['files']:
            if not db.execute('SELECT 1 FROM type_table_uploads WHERE digest=?', (source['sha256'],)).fetchone():
                db.execute('INSERT INTO type_table_uploads VALUES(?,?,?,?,?)', (str(uuid4()), source['filename'], source['sha256'],
                    b64decode(source['content_base64'], validate=True), stamp()))
        imported = []
        for series in bundle['series']:
            identifier, declaration = str(uuid4()), series['declaration']
            db.execute('INSERT INTO type_series VALUES(?,?,?,?,?)', (identifier, declaration['name'], encoded(declaration).decode(), stamp(), reviewer))
            specs = []
            for saved in series['specs']:
                payload = deepcopy(saved['payload'])
                payload.update(confirmed=False, version='1')
                for source in payload['sources'].values():
                    source['reviewed'] = False
                item = {**saved['metadata'], 'payload': payload,
                        'exchange_origin': {'series_id': series['origin_id'], 'spec_id': saved['origin_id'],
                            'version': saved['origin_version'], 'content_sha256': saved['content_sha256'], 'bundle_sha256': bundle['sha256']}}
                item.pop('version_document_sha256', None)
                specs.append(service._insert_spec(db, identifier, item, actor, request_id))
            imported.append({'series_id': identifier, 'name': declaration['name'], 'specs': specs})
            service._event(db, identifier, None, 'exchange_imported', reviewer, {'bundle_sha256': bundle['sha256']})
        result = {'series': imported, 'created': sum(len(s['specs']) for s in imported), 'state': 'draft', 'bundle_sha256': bundle['sha256']}
        service._remember(db, request_id, request, result)
        return result


def make_router(service):
    router = APIRouter(prefix='/api/type-library/exchange', tags=['Type library exchange'])

    @router.post('/export')
    def export_route(body: Selection):
        content, digest = export(service, body)
        media = 'application/json' if body.format == 'json' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        return Response(content, media_type=media, headers={'Content-Disposition': f'attachment; filename="cable-types.{body.format}"',
            'X-Content-SHA256': sha256(content).hexdigest(), 'X-Bundle-SHA256': digest})

    @router.post('/preview')
    async def preview_route(file: UploadFile = File(...)):
        return preview(service, file.filename, await file.read(MAX_BYTES + 1))

    @router.post('/import', status_code=201)
    async def import_route(file: UploadFile = File(...), reviewed_sha256: str = Form(...), confirmed: bool = Form(...),
                           request_id: UUID = Form(...), x_cablesim_actor: str | None = Header(default=None)):
        return import_bundle(service, file.filename, await file.read(MAX_BYTES + 1), reviewed_sha256, confirmed, request_id, x_cablesim_actor)

    return router
