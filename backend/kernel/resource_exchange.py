"""Portable resource definitions and saved project inputs, without copied approval.

JSON and XLSX carry the same checked payload. A workbook includes readable index
sheets and a lossless transfer sheet; edits invalidate its digest. Full execution
history and original files remain the responsibility of workspace_db backups.
"""
from __future__ import annotations

from copy import deepcopy
import getpass
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile, ZipFile

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils.exceptions import InvalidFileException
from pydantic import Field, ValidationError, model_validator

from backend.domain.models import DomainDocument
from backend.foundation.contracts import AssetRelease, content_hash
from backend.schemas import Scenario, StrictModel
from .project_exchange import prepare_reference, validate_reference
from .workspace import fingerprint, stamp


SCHEMA = 'cablesim.library-exchange/1'
MAX_BYTES = 8 * 1024 * 1024
# Complete release examples carry per-field provenance and pinned model proofs.
# Keep these inputs intact while bounding each project and the whole bundle.
PROJECT_LIMIT = 1024 * 1024
PROJECT_MAX_LOCKS = 4096
TRANSFER_SHEET = '传输内容（勿修改）'
PROJECT_KEYS = {'scenario', 'domain', 'locks', 'sources', 'domain_conversion',
                'study_cable_reference', 'engineering_model_reference'}


def fail(code, message, status=422):
    raise HTTPException(status, {'code': code, 'message': message})


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


class ExportSelection(StrictModel):
    asset_ids: list[str] = Field(default_factory=list, max_length=100)
    workspace_ids: list[str] = Field(default_factory=list, max_length=20)
    format: Literal['json', 'xlsx'] = 'json'

    @model_validator(mode='after')
    def members(self):
        if not self.asset_ids and not self.workspace_ids:
            raise ValueError('请至少选择一个资源或工程。')
        for values in (self.asset_ids, self.workspace_ids):
            if len(values) != len(set(values)) or any(not value.strip() or len(value) > 128 for value in values):
                raise ValueError('导出对象标识不能为空或重复。')
        return self


def _project_inputs(value):
    if not isinstance(value, dict) or set(value) - PROJECT_KEYS or not {'scenario', 'locks', 'sources'} <= set(value):
        fail('EXCHANGE_PROJECT_FIELDS', '工程输入字段不完整或包含运行、审批等不允许导入的字段。')
    if len(encoded(value)) > PROJECT_LIMIT:
        fail('EXCHANGE_PROJECT_TOO_LARGE', '单个工程输入超过 1 MiB；请使用数据库备份恢复，不能删减来源或锁记录。', 413)
    scenario = Scenario.model_validate(value['scenario']).model_dump(mode='json')
    if scenario != value['scenario']:
        fail('EXCHANGE_INCOMPLETE_INPUT', '工程输入缺少明确字段；导入不采用演示默认值。')
    if value.get('domain') is not None:
        document = DomainDocument.model_validate(value['domain']).model_dump(mode='json')
        if document != value['domain']:
            fail('EXCHANGE_INCOMPLETE_INPUT', '领域文档缺少明确字段；请从已保存工程重新导出。')
    if (not isinstance(value['locks'], list) or len(value['locks']) > PROJECT_MAX_LOCKS
            or any(not isinstance(v, str) for v in value['locks'])):
        fail('EXCHANGE_PROJECT_LOCKS', '工程锁记录格式无效。')
    if not isinstance(value['sources'], list):
        fail('EXCHANGE_PROJECT_SOURCES', '工程来源必须为列表。')
    binding = value.get('study_cable_reference')
    if binding is not None:
        if not isinstance(value.get('domain'), dict):
            fail('EXCHANGE_CABLE_REFERENCE', '工程引用的型号快照缺少完整领域输入。')
        validate_reference(binding)
        # Existing reference guards enforce the exact original bound inputs.
        from backend.domain.guards import check_locks
        check_locks(value, value['domain'])
    return deepcopy(value)


def validate_bundle(value):
    if not isinstance(value, dict) or set(value) != {'schema_version', 'created', 'assets', 'projects', 'sha256'}:
        fail('EXCHANGE_FORMAT', '请选择 CableSimPro 数据交换 JSON 或 Excel 文件。')
    if value['schema_version'] != SCHEMA:
        fail('EXCHANGE_VERSION', '数据交换版本不受支持，未导入任何对象。')
    if not isinstance(value['created'], str) or len(value['created']) > 80:
        fail('EXCHANGE_FORMAT', '交换文件的创建时间无效。')
    raw = {key: content for key, content in value.items() if key != 'sha256'}
    if fingerprint(raw) != value['sha256']:
        fail('EXCHANGE_DIGEST', '文件内容与摘要不一致；请重新导出，未导入任何对象。', 409)
    if not isinstance(value['assets'], list) or not isinstance(value['projects'], list):
        fail('EXCHANGE_FORMAT', '资源和工程须为列表。')
    if not value['assets'] and not value['projects'] or len(value['assets']) > 100 or len(value['projects']) > 20:
        fail('EXCHANGE_COUNT', '交换文件须包含 1–100 个资源或 1–20 个工程。')
    identities, project_ids = set(), set()
    for item in value['assets']:
        if not isinstance(item, dict) or set(item) != {'origin_id', 'origin_status', 'release', 'content_sha256'}:
            fail('EXCHANGE_ASSET_FIELDS', '资源交换字段不完整。')
        if (not isinstance(item['origin_id'], str) or not item['origin_id'] or len(item['origin_id']) > 128
                or item['origin_status'] not in ('draft', 'reviewed', 'published', 'deprecated')):
            fail('EXCHANGE_ASSET_FIELDS', '资源来源标识或状态无效。')
        release = AssetRelease.model_validate(item['release'])
        if release.files:
            fail('EXCHANGE_EXTERNAL_FILES', '资源包含外部文件载荷，请使用完整备份恢复。')
        if content_hash(release) != item['content_sha256']:
            fail('EXCHANGE_ASSET_DIGEST', '资源摘要不一致。', 409)
        key = (release.asset_id, release.version)
        if key in identities:
            fail('EXCHANGE_DUPLICATE', '交换文件包含重复的资源版本。')
        identities.add(key)
    for item in value['projects']:
        if not isinstance(item, dict) or set(item) != {'origin_id', 'origin_revision', 'inputs', 'input_sha256'}:
            fail('EXCHANGE_PROJECT_FIELDS', '工程交换字段不完整。')
        if (not isinstance(item['origin_id'], str) or not item['origin_id'] or len(item['origin_id']) > 128
                or item['origin_id'] in project_ids):
            fail('EXCHANGE_DUPLICATE', '工程来源标识不能为空或重复。')
        project_ids.add(item['origin_id'])
        if type(item['origin_revision']) is not int or item['origin_revision'] < 1:
            fail('EXCHANGE_PROJECT_REVISION', '工程来源修订号无效。')
        if fingerprint(item['inputs']) != item['input_sha256']:
            fail('EXCHANGE_PROJECT_DIGEST', '工程输入摘要不一致。', 409)
        _project_inputs(item['inputs'])
    if len(encoded(value)) > MAX_BYTES:
        fail('EXCHANGE_TOO_LARGE', '交换文件超过 8 MiB，请分批导出。', 413)
    return value


def _excel_string(cell, value):
    # Explicit strings keep names beginning with '=' from becoming formulas.
    cell.value = str(value)
    cell.data_type = 's'


def workbook_bytes(bundle):
    workbook = Workbook()
    guide = workbook.active
    guide.title = '说明'
    for row in [
        ['CableSimPro 数据交换', SCHEMA],
        ['范围', '资源定义与已保存工程输入；运行、审核、原始资料和交付历史请使用数据库备份。'],
        ['导入方式', '先预览，再人工确认；资源成为草稿，工程建立独立副本。'],
        ['编辑说明', '索引页供核对；传输内容须保持原样，修改后摘要校验会拒绝导入。'],
        ['摘要', bundle['sha256']],
    ]:
        guide.append(row)
    assets = workbook.create_sheet('资源索引（只读）')
    assets.append(['名称', '分类', '资源标识', '版本', '来源状态（不继承审核）', '出处'])
    parameters = workbook.create_sheet('资源参数（只读）')
    parameters.append(['资源标识', '版本', '参数', '数值', '单位', '出处'])
    for item in bundle['assets']:
        release = item['release']
        sources = '；'.join(source['reference'] for source in release['sources'])
        row = [release['name'], release['kind'], release['asset_id'], release['version'], item['origin_status'], sources]
        assets.append([None] * len(row))
        for cell, value in zip(assets[assets.max_row], row):
            _excel_string(cell, value)
        for parameter in release['parameters']:
            row = [release['asset_id'], release['version'], parameter['name'],
                   parameter['quantity']['value'], parameter['quantity']['unit'], sources]
            parameters.append(row)
            for index in (1, 2, 3, 5, 6):
                _excel_string(parameters.cell(parameters.max_row, index), row[index - 1])
    projects = workbook.create_sheet('工程索引（只读）')
    projects.append(['工程名称', '来源工程', '来源修订', '输入摘要'])
    for item in bundle['projects']:
        inputs = item['inputs']
        projects.append([None, None, item['origin_revision'], item['input_sha256']])
        _excel_string(projects.cell(projects.max_row, 1), (inputs.get('domain') or inputs['scenario'])['name'])
        _excel_string(projects.cell(projects.max_row, 2), item['origin_id'])
    transfer = workbook.create_sheet(TRANSFER_SHEET)
    transfer.append(['顺序', 'JSON 内容分段'])
    text = encoded(bundle).decode('utf-8')
    for index, offset in enumerate(range(0, len(text), 16000), start=1):
        transfer.append([index, None])
        _excel_string(transfer.cell(index + 1, 2), text[offset:offset + 16000])
    for sheet in workbook:
        sheet.freeze_panes = 'A2'
        sheet.auto_filter.ref = sheet.dimensions
        sheet.column_dimensions['A'].width = 32
        sheet.column_dimensions['B'].width = 72 if sheet in (guide, transfer) else 26
        for cell in sheet[1]:
            cell.font = Font(bold=True)
            cell.fill = PatternFill('solid', fgColor='EEEEEE')
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def parse_file(filename, data, *, validator=validate_bundle):
    if len(data) > MAX_BYTES:
        fail('EXCHANGE_TOO_LARGE', '交换文件超过 8 MiB，请分批导出。', 413)
    try:
        suffix = Path(filename or '').suffix.lower()
        if suffix == '.json':
            value = json.loads(data.decode('utf-8-sig'))
        elif suffix == '.xlsx':
            with ZipFile(BytesIO(data)) as archive:
                if sum(entry.file_size for entry in archive.infolist()) > 32 * 1024 * 1024:
                    fail('EXCHANGE_TOO_LARGE', 'Excel 解压后的内容超过 32 MiB。', 413)
            workbook = load_workbook(BytesIO(data), read_only=True, data_only=False, keep_links=False)
            try:
                if TRANSFER_SHEET not in workbook.sheetnames:
                    fail('EXCHANGE_WORKBOOK', 'Excel 缺少数据交换内容；厂家结构表请使用结构表导入。')
                sheet = workbook[TRANSFER_SHEET]
                if sheet.max_row > 1026 or sheet.max_column != 2:
                    fail('EXCHANGE_WORKBOOK', 'Excel 传输内容格式或数量无效。')
                parts = []
                for index, row in enumerate(sheet.iter_rows(min_row=2), start=1):
                    if row[0].value != index or row[1].data_type == 'f' or not isinstance(row[1].value, str):
                        fail('EXCHANGE_WORKBOOK', f'传输内容第 {index + 1} 行无效；不执行 Excel 公式。')
                    parts.append(row[1].value)
                value = json.loads(''.join(parts))
            finally:
                workbook.close()
        else:
            fail('EXCHANGE_FILE_TYPE', '数据交换仅接受 .json 或 .xlsx。')
        return validator(value)
    except (ValueError, KeyError, TypeError, UnicodeError, BadZipFile, ValidationError,
            ParseError, InvalidFileException, OSError) as error:
        fail('EXCHANGE_INVALID', '文件内容无效，请重新导出或修正：' + str(error)[:300])


class ResourceExchange:
    def __init__(self, store, assets):
        self.store, self.assets = store, assets

    def initialize(self):
        with self.store.db(True) as db:
            db.execute('CREATE TABLE IF NOT EXISTS library_exchange_imports ('
                       'request_id TEXT PRIMARY KEY, bundle_sha256 TEXT NOT NULL, '
                       'receipt TEXT NOT NULL, created TEXT NOT NULL)')

    def export(self, body: ExportSelection):
        assets, projects, seen = [], [], set()
        with self.store.read_snapshot() as db:
            def include_asset(identifier):
                detail = self.assets._detail(db, self.assets._load(db, identifier))
                key = (detail['asset_id'], detail['version'])
                if key in seen:
                    return
                seen.add(key)
                if len(seen) > 100:
                    fail('EXCHANGE_COUNT', '包含依赖后超过 100 个资源，请分批导出。')
                release = detail['release']
                for dependency in release['dependencies']:
                    row = db.execute('SELECT id,content_sha256 FROM engineering_assets WHERE asset_id=? AND version=?',
                                     (dependency['asset_id'], dependency['version'])).fetchone()
                    if row is None or row['content_sha256'] != dependency['content_sha256']:
                        fail('EXCHANGE_DEPENDENCY', '资源依赖缺失或摘要不一致，未生成不完整交换包。', 409)
                    include_asset(row['id'])
                assets.append({'origin_id': identifier, 'origin_status': detail['status'],
                               'release': release, 'content_sha256': detail['content_sha256']})
            for identifier in body.asset_ids:
                include_asset(identifier)
            for identifier in body.workspace_ids:
                row, state = self.store.load(db, identifier)
                inputs = {key: deepcopy(value) for key, value in state.items() if key in PROJECT_KEYS}
                prepare_reference(db, inputs)
                _project_inputs(inputs)
                projects.append({'origin_id': identifier, 'origin_revision': row['revision'],
                                 'inputs': inputs, 'input_sha256': fingerprint(inputs)})
        payload = {'schema_version': SCHEMA, 'created': stamp(), 'assets': assets, 'projects': projects}
        return validate_bundle({**payload, 'sha256': fingerprint(payload)})

    def _plan(self, db, bundle):
        asset_items, available = [], {}
        for item in bundle['assets']:
            release = item['release']
            key = (release['asset_id'], release['version'])
            row = db.execute('SELECT id,content_sha256,release_json FROM engineering_assets WHERE asset_id=? AND version=?', key).fetchone()
            if row and (row['content_sha256'] != item['content_sha256']
                        or content_hash(AssetRelease.model_validate_json(row['release_json'])) != item['content_sha256']):
                fail('EXCHANGE_VERSION_CONFLICT', f'资源 {release["name"]} 的同一版本内容不同；未覆盖任何对象。', 409)
            available[key] = item['content_sha256']
            asset_items.append({'origin_id': item['origin_id'], 'name': release['name'], 'kind': release['kind'],
                                'action': 'reuse' if row else 'create_draft',
                                'existing_id': row['id'] if row else None})
        for item in bundle['assets']:
            for dependency in item['release']['dependencies']:
                key = (dependency['asset_id'], dependency['version'])
                if available.get(key) == dependency['content_sha256']:
                    continue
                row = db.execute('SELECT content_sha256,release_json FROM engineering_assets WHERE asset_id=? AND version=?', key).fetchone()
                if (not row or row['content_sha256'] != dependency['content_sha256']
                        or content_hash(AssetRelease.model_validate_json(row['release_json'])) != dependency['content_sha256']):
                    fail('EXCHANGE_DEPENDENCY', '交换包与本机均缺少准确的资源依赖。', 409)
        return {'sha256': bundle['sha256'], 'assets': asset_items,
                'projects': [{'origin_id': item['origin_id'], 'name': (item['inputs'].get('domain') or item['inputs']['scenario'])['name'],
                              'action': 'create_independent_input_copy'} for item in bundle['projects']],
                'requires_human_confirmation': True, 'approval_inherited': False,
                'limitations': ['仅搬运已保存输入和资源定义；不复制运行、审核、原始资料或交付历史。',
                                '资源原始来源记录原样保留，属于来源方的核对声明；本机审核状态为草稿。',
                                '候选型号保留原始内容摘要、完整来源快照与原标识；工程绑定独立快照，不关联本机同名或同标识型号。',
                                '已发布型号引用的完整发行证明链不在输入交换范围内，请使用数据库备份恢复。',
                                '需要完整历史时使用数据库备份恢复。']}

    def preview(self, bundle):
        validate_bundle(bundle)
        with self.store.read_snapshot() as db:
            return self._plan(db, bundle)

    def import_bundle(self, bundle, *, reviewed_sha256, confirmed, request_id, actor):
        if actor != 'human' or confirmed is not True:
            fail('EXCHANGE_HUMAN_CONFIRMATION', '请由工程师预览并确认导入；AI 和插件不能自行确认。', 403)
        validate_bundle(bundle)
        if reviewed_sha256 != bundle['sha256']:
            fail('EXCHANGE_PREVIEW_CHANGED', '确认的文件与预览内容不同，请重新预览。', 409)
        with self.store.db(True) as db:
            previous = db.execute('SELECT * FROM library_exchange_imports WHERE request_id=?', (str(request_id),)).fetchone()
            if previous:
                if previous['bundle_sha256'] != bundle['sha256']:
                    fail('EXCHANGE_REQUEST_REUSED', '此请求标识已经用于另一份文件。', 409)
                return json.loads(previous['receipt'])
            plan = self._plan(db, bundle)
            imported_assets, imported_projects = [], []
            for item, action in zip(bundle['assets'], plan['assets']):
                identifier = action['existing_id']
                if identifier is None:
                    identifier = self.assets._insert(db, AssetRelease.model_validate(item['release']),
                        '人工确认数据交换导入（' + getpass.getuser() + '）；来源摘要 ' + bundle['sha256'] + '；未继承来源方审批。')
                imported_assets.append({'origin_id': item['origin_id'], 'id': identifier, 'action': action['action']})
            for item in bundle['projects']:
                identifier, now = str(uuid4()), stamp()
                state = _project_inputs(item['inputs'])
                state['exchange_origin'] = {'workspace': item['origin_id'], 'revision': item['origin_revision'],
                    'input_sha256': item['input_sha256'], 'bundle_sha256': bundle['sha256'],
                    'approval_inherited': False}
                raw = json.dumps(state, ensure_ascii=False, allow_nan=False)
                db.execute('INSERT INTO workspaces VALUES (?,?,?,?,?,?)', (identifier, 1, 0, raw, now, now))
                db.execute('INSERT INTO workspace_history VALUES (?,?,?,?)', (identifier, 0, raw, '导入独立工程输入'))
                self.store.audit(db, identifier, 1, '导入独立工程输入', json.dumps(state['exchange_origin'], ensure_ascii=False))
                self.store.archive(db, identifier, 1, state)
                imported_projects.append({'origin_id': item['origin_id'], 'id': identifier, 'revision': 1})
            receipt = {'request_id': str(request_id), 'sha256': bundle['sha256'], 'assets': imported_assets,
                       'projects': imported_projects, 'approval_inherited': False,
                       'confirmed_by': getpass.getuser(), 'created': stamp()}
            db.execute('INSERT INTO library_exchange_imports VALUES (?,?,?,?)',
                       (str(request_id), bundle['sha256'], json.dumps(receipt, ensure_ascii=False), receipt['created']))
            return receipt


def make_router(service: ResourceExchange):
    router = APIRouter(prefix='/api/library/exchange', tags=['Portable engineering data'])

    @router.post('/export')
    def export(body: ExportSelection):
        bundle = service.export(body)
        raw = workbook_bytes(bundle) if body.format == 'xlsx' else encoded(bundle)
        media = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' if body.format == 'xlsx' else 'application/json'
        return Response(raw, media_type=media, headers={
            'Content-Disposition': f'attachment; filename="cablesim-data.{body.format}"',
            'X-Content-SHA256': sha256(raw).hexdigest(), 'X-Bundle-SHA256': bundle['sha256']})

    @router.post('/preview')
    async def preview(file: UploadFile = File()):
        return service.preview(parse_file(file.filename, await file.read(MAX_BYTES + 1)))

    @router.post('/import', status_code=201)
    async def import_data(file: UploadFile = File(), reviewed_sha256: str = Form(),
                          confirmed: bool = Form(), request_id: UUID = Form(),
                          x_cablesim_actor: str | None = Header(default=None)):
        bundle = parse_file(file.filename, await file.read(MAX_BYTES + 1))
        return service.import_bundle(bundle, reviewed_sha256=reviewed_sha256,
                                     confirmed=confirmed, request_id=request_id, actor=x_cablesim_actor)

    return router
