"""Conversation-owned structure imports over the existing TypeLibrary service.

Attachments are conversation input, not library uploads. Each library mutation
requires its own immutable proposal. The journal prevents a lost upload/preview
response from causing another non-idempotent call; commit/check reuse the
library's durable request receipts. No parsing or engineering algorithm lives
in this adapter.
"""
import base64
import binascii
from copy import copy, deepcopy
from hashlib import sha256
import json
import re
from time import time
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import Field

from backend.schemas import StrictModel
from backend.kernel.workspace import fingerprint, stamp
from .contracts import ToolResult
from .platform import page
from .tool_registry import Tool, object_schema


MAX_BYTES = 1024 * 1024
MAX_REVIEW_BYTES = 256 * 1024
MAX_SPECS = 100
READ_SCOPES = {'structure_import_read': 'workspace'}
ACTION_SCOPES = {name: 'workspace' for name in (
    'propose_structure_upload', 'propose_structure_preview',
    'propose_structure_import', 'propose_structure_check')}
IDENTIFIER = {'type': 'string', 'format': 'uuid'}
DIGEST = {'type': 'string', 'pattern': '^[a-f0-9]{64}$'}


def fail(code, message, status=422, path=None):
    raise HTTPException(status, {'code': code, 'message': message, 'path': path})


def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True)


def bounded(value):
    if len(encoded(value).encode()) > MAX_REVIEW_BYTES:
        fail('IMPORT_REVIEW_TOO_LARGE', '完整审阅内容超过 256 KiB，请拆分结构表后重新提交；没有截掉任何字段或规格。')
    return value


class AttachmentInput(StrictModel):
    model_config = {'str_strip_whitespace': False}
    conversation_id: UUID
    filename: str = Field(min_length=1, max_length=160)
    content_base64: str = Field(min_length=1, max_length=4 * ((MAX_BYTES + 2) // 3))


def initialize(store):
    with store.db(True) as db:
        db.execute('''CREATE TABLE IF NOT EXISTS agent_external_attachments (
            id TEXT PRIMARY KEY, conversation TEXT NOT NULL, filename TEXT NOT NULL,
            digest TEXT NOT NULL, size INTEGER NOT NULL, content BLOB NOT NULL, created TEXT NOT NULL)''')
        db.execute('''CREATE TABLE IF NOT EXISTS agent_import_actions (
            proposal TEXT PRIMARY KEY, conversation TEXT NOT NULL, action TEXT NOT NULL,
            digest TEXT NOT NULL, state TEXT NOT NULL, receipt TEXT, created TEXT NOT NULL)''')


def stage_attachment(store, body):
    name = body.filename
    if (name != name.strip() or name.endswith('.') or name in ('.', '..')
            or re.search(r'[\\/<>:"|?*\x00-\x1f\x7f]', name)
            or name.rsplit('.', 1)[-1].lower() not in ('csv', 'xlsx')):
        fail('IMPORT_ATTACHMENT_NAME', '请选择安全文件名的 CSV 或 XLSX 结构表；文件名不能包含路径或控制字符。', path='/filename')
    try:
        content = base64.b64decode(body.content_base64, validate=True)
    except (ValueError, binascii.Error):
        fail('IMPORT_ATTACHMENT_ENCODING', '附件编码不合法，请重新选择原始文件。', path='/content_base64')
    if not content or len(content) > MAX_BYTES:
        fail('IMPORT_ATTACHMENT_SIZE', '请选择非空且不超过 1 MiB 的结构表；较大文件请拆分。')
    try:
        from backend.kernel.factory_tables import read
    except ImportError:
        fail('STRUCTURE_IMPORT_UNAVAILABLE', '当前后端尚未接入结构表解析服务，附件未保存。', 503)
    # Pure validation only. No TypeLibrary upload/preview or business table is
    # written before its separate human decision.
    parsed = read(name, content)
    identifier = str(uuid4())
    initialize(store)
    with store.db(True) as db:
        db.execute('INSERT INTO agent_external_attachments VALUES (?,?,?,?,?,?,?)',
                   (identifier, str(body.conversation_id), name, parsed['sha256'], len(content), content, stamp()))
    return {'id': identifier, 'filename': name, 'sha256': parsed['sha256'], 'size': len(content)}


def tools():
    try:
        from backend.kernel.type_library import Preview
        request = Preview.model_json_schema()
        definitions = request.pop('$defs', {})
        request['properties'].pop('upload_id')
        request['required'].remove('upload_id')
    except ImportError:
        request, definitions = object_schema(), {}
    preview = object_schema({'upload_id': IDENTIFIER, 'sha256': DIGEST, 'request': request},
                            ['upload_id', 'sha256', 'request'])
    if definitions:
        # Pydantic refs are rooted at the tool, not the nested request object.
        preview['$defs'] = definitions
    read = object_schema({
        'kind': {'enum': ['attachment', 'upload', 'preview', 'series', 'check']}, 'id': IDENTIFIER,
        'view': {'type': 'string', 'maxLength': 500, 'description': '对象内 JSON Pointer；按省略条目的 path 展开。'},
        'offset': {'type': 'integer', 'minimum': 0, 'description': '续读必须同时提供首段 expected_digest；原样使用 next_read。'},
        'limit': {'type': 'integer', 'minimum': 1, 'maximum': 20}, 'expected_digest': DIGEST,
    }, ['kind', 'id'])
    entries = [
        ('structure_import_read', '读取结构表保存记录', 'read',
         '仅读本对话附件元数据及已接受的上传、预览、系列和核对回执。保留摘要、来源、缺项及分页；不返回文件字节或路径。', read),
        ('propose_structure_upload', '提出上传结构表原件', 'propose',
         '只使用本对话用户实际选择的附件及其 SHA256；文件名不能代替附件。接受后才保存到原型号库上传区，不预览或入库。',
         object_schema({'attachment_id': IDENTIFIER, 'expected_sha256': DIGEST}, ['attachment_id', 'expected_sha256'])),
        ('propose_structure_preview', '提出保存结构表预览', 'propose',
         '明确选择已接受原件的工作表、起始行、列映射与系列声明。保留原行、单位和来源；接受后调用原预览服务，尚不创建型号。', preview),
        ('propose_structure_import', '提出结构表草稿入库', 'propose',
         '按准确保存预览及摘要创建系列和型号草稿。必须明确 skip_errors；每行事实、缺项及错误均待人审，不审核、不发布。',
         object_schema({'preview_id': IDENTIFIER, 'preview_digest': DIGEST, 'skip_errors': {'type': 'boolean'}},
                       ['preview_id', 'preview_digest', 'skip_errors'])),
        ('propose_structure_check', '提出核对导入规格', 'propose',
         '仅本对话导入系列中明确选择的规格；冻结型号版本、工作区修订与本机标准核对方法。接受后保存普通研究和运行，不计算载流量、不审核或发布。',
         object_schema({'series_id': IDENTIFIER, 'spec_ids': {'type': 'array', 'minItems': 1,
                       'maxItems': MAX_SPECS, 'uniqueItems': True, 'items': IDENTIFIER}}, ['series_id', 'spec_ids'])),
    ]
    return {row[0]: Tool(*row) for row in entries}


def next_read(kind, identifier):
    return {'tool': 'structure_import_read', 'arguments': {'kind': kind, 'id': identifier}}


def preview_projection(payload):
    return {**{key: deepcopy(value) for key, value in payload.items() if key != 'rows'},
            'rows': [{key: deepcopy(value) for key, value in row.items() if key != 'payload'} for row in payload['rows']]}


class FrozenCheckResearch:
    """A per-call read-only view; writes retain their original bound services.

TypeLibrary asks pin for each selected specification. Recheck the reviewed
release and execution location there, including changes made during a batch.
Nothing on the shared Research or TypeLibrary instance is replaced.
"""
    def __init__(self, research, method):
        self._research, self._method = research, deepcopy(method)

    def __getattr__(self, name):
        return getattr(self._research, name)

    def pin(self, plugin):
        from .external_execution import require_local
        actual = {**self._research.pin(plugin), 'capability': 'dimensions'}
        if (self._method.get('plugin_id') != 'cablesim.standard-check'
                or self._method.get('capability') != 'dimensions' or actual != self._method):
            fail('IMPORT_CHECK_METHOD_CHANGED', '标准核对方法的发行封签在批处理中变化；该规格未开始运行，之前的保存运行保留。', 409)
        require_local(self._research, {'method': self._method})
        return {key: actual[key] for key in ('plugin_id', 'version', 'release_digest')}


class StructureImports:
    def __init__(self, actions):
        self.actions, self.store = actions, actions.store

    def service(self):
        service = getattr(self.actions.broker.platform.app.state, 'type_library', None)
        if service is None:
            fail('STRUCTURE_IMPORT_UNAVAILABLE', '当前后端尚未接入结构表上传、预览和原子入库服务；没有写入型号库。', 503)
        return service

    def inspect(self):
        try:
            service = self.service()
        except HTTPException:
            return ToolResult(status='error', summary='当前后端尚未接入厂家结构表导入服务。',
                data={'available': False, 'formats': ['csv', 'xlsx'], 'attachment_required': True},
                diagnostics=[{'code': 'STRUCTURE_IMPORT_UNAVAILABLE', 'message': '须接入原型号库上传、预览及原子入库服务。', 'recoverable': True}])
        return ToolResult(status='ok', summary='结构表服务已接入。请实际选择附件；只提供文件名不能读取或导入文件。', data={
            'available': True, 'formats': ['csv', 'xlsx'], 'max_bytes': MAX_BYTES, 'max_specs': MAX_SPECS,
            'attachment_required': True, 'vocabulary': service.vocabulary(),
            'preview_parameters': tools()['propose_structure_preview'].parameters,
            'approvals': list(ACTION_SCOPES), 'engineering_approval': False})

    def conversation(self, task):
        with self.store.db() as db:
            row = db.execute("SELECT data FROM agent_events WHERE task_id=? AND type='external.session.opened' ORDER BY sequence LIMIT 1", (task['id'],)).fetchone()
        value = json.loads(row['data']).get('conversation_id') if row else None
        if not value:
            fail('IMPORT_CONVERSATION_REQUIRED', '请在已选择工作区的对话中上传附件；旧会话没有附件归属，须重新发起对话任务。', 403)
        return str(UUID(value))

    def attachment(self, conversation, identifier):
        with self.store.db() as db:
            exists = db.execute("SELECT 1 FROM sqlite_master WHERE name='agent_external_attachments' AND type='table'").fetchone()
            row = db.execute('SELECT * FROM agent_external_attachments WHERE id=? AND conversation=?', (identifier, conversation)).fetchone() if exists else None
        if row is None:
            fail('IMPORT_ATTACHMENT_REQUIRED', '本对话没有这个实际附件；请使用附件按钮选择原始 CSV 或 XLSX 文件，文件名不能代替文件。', 403, '/attachment_id')
        content = bytes(row['content'])
        if sha256(content).hexdigest() != row['digest'] or len(content) != row['size']:
            fail('IMPORT_ATTACHMENT_CHANGED', '附件完整性校验失败，请重新选择原始文件。', 409)
        return {'id': row['id'], 'filename': row['filename'], 'sha256': row['digest'], 'size': row['size']}, content

    def owned(self, conversation, kind, identifier):
        field = {'upload': 'upload_id', 'preview': 'preview_id', 'series': 'series_id', 'check': 'batch_id'}[kind]
        action = {'upload': 'propose_structure_upload', 'preview': 'propose_structure_preview',
                  'series': 'propose_structure_import', 'check': 'propose_structure_check'}[kind]
        with self.store.db() as db:
            exists = db.execute("SELECT 1 FROM sqlite_master WHERE name='agent_import_actions' AND type='table'").fetchone()
            row = db.execute("SELECT * FROM agent_import_actions WHERE conversation=? AND action=? AND state='completed' AND json_extract(receipt,?)=?",
                (conversation, action, '$.receipt.' + field, identifier)).fetchone() if exists else None
        if row is None:
            fail('IMPORT_SCOPE_VIOLATION', '此记录不属于本对话已接受的结构表流程；不能读取或提交其他对话、其他来源的记录。', 403)
        saved = self.journal_receipt(row)
        with self.store.db() as db:
            _, proposal, _ = self.actions.tasks.proposal(db, row['proposal'])
        if fingerprint(proposal['arguments']) != row['digest'] or proposal['arguments']['conversation_id'] != conversation:
            fail('IMPORT_ACTION_CHANGED', '归属记录与不可变人工方案不一致。', 409)
        return saved

    def saved(self, conversation, kind, identifier):
        service = self.service()
        if kind == 'attachment':
            return self.attachment(conversation, identifier)[0]
        owned = self.owned(conversation, kind, identifier)
        if kind == 'upload':
            with self.store.db() as db:
                parsed = service._upload(db, identifier)
            if any(parsed[key] != owned[key] for key in ('sha256', 'file', 'size')):
                fail('IMPORT_SOURCE_CHANGED', '上传原件摘要与已接受记录不一致。', 409)
            from backend.kernel.factory_tables import inspect
            from backend.kernel.public_catalogues import match_sample
            return {'upload_id': identifier, **inspect(parsed), 'declarations': match_sample(parsed['sha256']) or []}
        if kind == 'preview':
            with self.store.db() as db:
                row = db.execute('SELECT * FROM type_table_previews WHERE id=?', (identifier,)).fetchone()
            if not row:
                fail('IMPORT_PREVIEW_UNKNOWN', '保存预览不存在，请重新预览。', 404)
            payload = json.loads(row['payload'])
            if row['digest'] != owned['preview_digest'] or fingerprint(payload) != row['digest']:
                fail('IMPORT_PREVIEW_CHANGED', '保存预览摘要不一致，拒绝继续。', 409)
            upload = self.saved(conversation, 'upload', payload['upload_id'])
            if upload['sha256'] != payload['sha256']:
                fail('IMPORT_SOURCE_CHANGED', '预览引用的原件摘要不一致。', 409)
            return {'preview_id': identifier, 'preview_digest': row['digest'], **preview_projection(payload)}
        if kind == 'series':
            return service.series_detail(identifier)
        with self.store.db() as db:
            row = db.execute('SELECT * FROM type_library_batches WHERE id=?', (identifier,)).fetchone()
        if not row or row['series'] != owned['series_id']:
            fail('IMPORT_CHECK_UNKNOWN', '保存核对回执不存在或系列身份不一致。', 409)
        payload = json.loads(row['payload'])
        if any(payload.get(key) != owned.get(key) for key in ('id', 'series_id', 'operation', 'items')):
            fail('IMPORT_CHECK_CHANGED', '保存核对内容与此人工方案的真实回执不一致，拒绝采用。', 409)
        return {**payload, 'status': row['status']}

    def read(self, task, args):
        conversation = self.conversation(task)
        if args.get('offset', 0) > 0 and not args.get('expected_digest'):
            fail('IMPORT_DIGEST_REQUIRED', '续读必须绑定首段摘要；请先读 offset=0，再原样使用 next_read。', path='/expected_digest')
        value = self.saved(conversation, args['kind'], args['id'])
        digest = fingerprint(value)
        if args.get('expected_digest') and args['expected_digest'] != digest:
            fail('IMPORT_RECORD_CHANGED', '保存记录已变化，不能拼接不同版本；请重新读取首段。', 409)
        selected = page(value, args.get('view', ''), args.get('offset', 0), args.get('limit', 10))
        identity = {'kind': args['kind'], 'id': args['id'], **{key: value[key] for key in (
            'file', 'filename', 'sha256', 'size', 'upload_id', 'preview_id', 'preview_digest',
            'valid_count', 'error_count', 'incomplete_count', 'series_id', 'status') if key in value}}
        if args['kind'] == 'preview': identity['row_count'] = len(value['rows'])
        if args['kind'] == 'check': identity['batch_id'] = value['id']
        data = {'resource': identity, 'source': {'response_digest': digest}, 'page': selected}
        if selected.get('next_offset') is not None:
            data['next_read'] = {'tool': 'structure_import_read', 'arguments': {
                **args, 'offset': selected['next_offset'], 'expected_digest': digest}}
        return ToolResult(status='ok', summary='已读取本对话的真实保存记录；省略条目须按 path 展开，不代表已核对。', data=data)

    @staticmethod
    def change(changes, label, value, unit=None, path=''):
        changes.append({'path': path, 'label': label, 'before': None, 'after': value, 'unit': unit})

    def source_changes(self, changes, saved):
        for key, label in (('file', '原始文件'), ('sha256', '原件 SHA256'), ('sheet', '工作表'),
                           ('preview_id', '保存预览标识'), ('preview_digest', '保存预览 SHA256'),
                           ('first_data_row', '首个数据行'), ('mapping', '列映射'), ('series', '系列声明及来源')):
            if key in saved: self.change(changes, label, saved[key], path='/' + key)

    def row_changes(self, changes, rows, raw=False):
        from backend.kernel.factory_tables import FIELDS
        if len(rows) > MAX_SPECS:
            fail('IMPORT_TOO_MANY_ROWS', '一次最多审阅 100 条规格，请拆分结构表后提交；未截取部分行。')
        for row in rows:
            prefix = '原表第 ' + str(row['row_number']) + ' 行 · '
            if raw:
                for key, value in row['raw'].items():
                    self.change(changes, prefix + FIELDS[key][0], value, FIELDS[key][1], '/rows/' + str(row['row_number']) + '/' + key)
            else:
                self.change(changes, prefix + '规格', row['name'])
                for value in row['values']:
                    self.change(changes, prefix + value['label'], value['display_value'], value['display_unit'],
                                '/rows/' + str(row['row_number']) + '/' + value['key'])
                    self.change(changes, prefix + value['label'] + '来源', value['source'])
                for key, label in (('status', '状态'), ('missing', '缺项'), ('derivation', '构造方法'),
                                   ('closure', '尺寸闭合'), ('warnings', '限制')):
                    if key in row:
                        value = {'ready': '可入库', 'incomplete': '保留缺项', 'error': '错误行'}.get(row[key], row[key]) if key == 'status' else row[key]
                        self.change(changes, prefix + label, value)
            if row.get('issues'): self.change(changes, prefix + '错误', row['issues'])

    def prepare(self, task, name, args):
        service = self.service()
        conversation = self.conversation(task)
        self.actions.current(task)
        pid, action, changes = str(uuid4()), deepcopy(args), []
        action['conversation_id'] = conversation
        checks = ['只有人在对话中接受后才执行本步骤；下一步仍须独立接受。',
                  '接受导入或核对不代表厂家数据已认证，不审核或发布工程型号。']
        if name == 'propose_structure_upload':
            saved, _ = self.attachment(conversation, args['attachment_id'])
            if saved['sha256'] != args['expected_sha256']:
                fail('IMPORT_ATTACHMENT_CHANGED', '附件摘要与选择的原件不符，请重新读取附件元数据。', 409)
            action['attachment'] = saved
            for key, label in (('filename', '原始文件'), ('sha256', '原件 SHA256'), ('size', '文件大小')):
                self.change(changes, label, saved[key], 'byte' if key == 'size' else None)
            checks.append('只保存原件到型号库上传区，不保存预览、不创建系列或型号。')
        elif name == 'propose_structure_preview':
            from backend.kernel.type_library import Preview
            from backend.kernel.factory_tables import mapped_rows
            saved = self.saved(conversation, 'upload', args['upload_id'])
            if saved['sha256'] != args['sha256']:
                fail('IMPORT_SOURCE_CHANGED', '上传原件摘要不一致，请重新读取。', 409)
            request = Preview.model_validate({'upload_id': args['upload_id'], **args['request']})
            action['request'] = request.model_dump(mode='json', exclude_none=True, exclude={'upload_id'})
            with self.store.db() as db: parsed = service._upload(db, args['upload_id'])
            rows, skipped = mapped_rows(parsed, request.sheet, request.first_data_row, request.mapping)
            self.source_changes(changes, {**saved, **action['request']})
            self.row_changes(changes, rows, raw=True)
            if skipped: self.change(changes, '不作为规格的原表说明行', skipped)
            checks.append('按明确列映射和声明生成并保存预览；表内错误和缺项保留，不创建型号。')
        elif name == 'propose_structure_import':
            saved = self.saved(conversation, 'preview', args['preview_id'])
            if saved['preview_digest'] != args['preview_digest']:
                fail('IMPORT_PREVIEW_CHANGED', '指定预览摘要与保存内容不一致。', 409)
            if saved['error_count'] and not args['skip_errors']:
                fail('IMPORT_ROWS_INVALID', '存在错误行；请修正原表重新预览，或明确选择跳过错误行后提出新方案。')
            if not saved['valid_count']:
                fail('IMPORT_NO_VALID_ROWS', '预览没有可入库规格；请修正原表后重新预览。')
            self.source_changes(changes, saved)
            self.row_changes(changes, saved['rows'])
            self.change(changes, '错误行处理', '明确跳过错误行' if args['skip_errors'] else '不允许跳过错误行')
            self.change(changes, '跳过的规格行号', [row['row_number'] for row in saved['rows'] if row['status'] == 'error'])
            if saved.get('skipped'): self.change(changes, '不作为规格的原表说明行', saved['skipped'])
            checks.append('原子创建系列及每条可入库规格的独立型号草稿；错误行不会被补值，缺项仍保留。')
        elif name == 'propose_structure_check':
            saved = self.saved(conversation, 'series', args['series_id'])
            specs = {row['id']: row for row in saved['specs']}
            if any(identifier not in specs for identifier in args['spec_ids']):
                fail('IMPORT_SCOPE_VIOLATION', '只能核对本对话已导入系列中的明确规格。', 403)
            selected = [specs[identifier] for identifier in args['spec_ids']]
            method, label = self.check_method()
            action['method'] = method
            action['declaration_digest'] = fingerprint(saved['declaration'])
            action['specs'] = [{key: row[key] for key in ('id', 'name', 'version', 'workspace_id',
                                'workspace_revision', 'content_sha256')} for row in selected]
            self.change(changes, '系列', saved['series']['name'])
            self.change(changes, '核对方法', label)
            for row in selected:
                self.change(changes, row['name'] + ' · 固定版本与保存修订',
                            {key: row[key] for key in ('version', 'workspace_id', 'workspace_revision', 'content_sha256')})
                self.change(changes, row['name'] + ' · 已知缺项', row['missing'])
            checks.append('只使用本机标准尺寸核对方法；为所选规格分别保存真实研究和运行，逐项失败保持可见。')
        else:
            fail('TOOL_NOT_ALLOWED', '未开放此结构表动作。', 403)
        bounded(changes)
        proposal = {'id': pid, 'kind': 'external_action', 'action': name, 'arguments': action,
            'workspace_revision': task['workspace_revision'], 'expires': time() + 3600,
            'public': {'id': pid, 'kind': 'external_action', 'action': name,
                       'title': tools()[name].title.removeprefix('提出'), 'base_revision': task['workspace_revision'],
                       'changes': changes, 'checks': checks, 'assumptions': []}}
        self.actions.proposals.persist(task, proposal)
        return ToolResult(status='ok', summary='已保存完整待审方案；接受前没有执行该业务写入。', data={'proposal': proposal['public']})

    def check_method(self):
        from .external_execution import require_local
        research = self.actions.research
        plugin = research.registry('cablesim.standard-check').get('cablesim.standard-check')
        method = {**research.pin(plugin), 'capability': 'dimensions'}
        _, capability = require_local(research, {'method': method})
        return method, plugin.manifest.name + ' ' + plugin.manifest.version + ' · ' + capability.title

    def request(self, proposal):
        """Human flags are created only while executing/reconciling a human route."""
        from backend.kernel.type_library import Commit, Batch
        args, pid = proposal['arguments'], proposal['id']
        if proposal['action'] == 'propose_structure_import':
            return Commit(preview_id=args['preview_id'], preview_digest=args['preview_digest'],
                request_id=pid, human_confirmed=True, skip_errors=args['skip_errors']).model_dump(mode='json')
        return Batch(request_id=pid, operation='check', spec_ids=args['spec_ids'],
            expected_versions={row['id']: row['version'] for row in args['specs']},
            expected_revisions={row['id']: row['workspace_revision'] for row in args['specs']},
            human_confirmed=True, scope_acknowledged=True).model_dump(mode='json')

    def receipt(self, proposal, result):
        name, args = proposal['action'], proposal['arguments']
        receipt = {'status': 'succeeded', 'executed': True}
        if name == 'propose_structure_upload':
            receipt.update(kind='structure_upload', attachment_id=args['attachment_id'], filename=result['file'], **result)
            read = next_read('upload', result['upload_id'])
        elif name == 'propose_structure_preview':
            projection = preview_projection(result)
            receipt.update(kind='structure_preview', row_count=len(result['rows']),
                           **{key: result[key] for key in ('upload_id', 'sha256', 'preview_id', 'preview_digest',
                                                         'valid_count', 'error_count', 'incomplete_count')})
            if len(encoded(projection).encode()) <= MAX_REVIEW_BYTES:
                receipt['preview'] = projection
            else:
                receipt['preview_omitted'] = True
                receipt['message'] = '完整预览已保存，内容较大须分页读取；省略部分尚未核对，入库仍须另行接受完整方案。'
            read = next_read('preview', result['preview_id'])
        elif name == 'propose_structure_import':
            receipt.update(kind='structure_import', preview_id=args['preview_id'], **result)
            read = next_read('series', result['series_id'])
        else:
            receipt.update(kind='structure_check', batch_id=result['id'], **result)
            if result['status'] in ('running', 'interrupted'):
                receipt.update(complete=False, may_have_written=True,
                    message='批量核对中断或尚未完成；已保存的逐项运行保持可查，不代表全批完成。不会自动重跑；请核对已保存项后再提出新的人工方案。')
            read = next_read('check', result['id'])
        receipt['next_read'] = read
        return receipt

    def uncertain(self, proposal):
        return {'kind': proposal['action'].removeprefix('propose_'), 'status': 'uncertain', 'executed': None,
                'may_have_written': True, 'proposal_id': proposal['id'], 'error': {'code': 'IMPORT_ACTION_UNCERTAIN',
                'message': '操作已开始但没有取得确定回执，可能已保存原件或预览记录。不会自动重复执行；请在型号库检查保存记录，再决定是否提出新方案。'}}

    def remember(self, proposal, receipt):
        with self.store.db(True) as db:
            db.execute("UPDATE agent_import_actions SET state='completed',receipt=? WHERE proposal=?",
                       (encoded({'receipt': receipt, 'digest': fingerprint(receipt)}), proposal['id']))
        return receipt

    @staticmethod
    def journal_receipt(row):
        saved = json.loads(row['receipt'])
        if not isinstance(saved, dict) or 'receipt' not in saved or fingerprint(saved['receipt']) != saved.get('digest'):
            fail('IMPORT_RECEIPT_CHANGED', '结构表执行回执摘要不一致，拒绝重试或采用。', 409)
        return saved['receipt']

    def recover(self, task, proposal):
        args = proposal['arguments']
        if self.conversation(task) != args['conversation_id']:
            fail('IMPORT_SCOPE_VIOLATION', '人工方案与当前对话归属不一致。', 403)
        with self.store.db() as db:
            exists = db.execute("SELECT 1 FROM sqlite_master WHERE name='agent_import_actions' AND type='table'").fetchone()
            row = db.execute('SELECT * FROM agent_import_actions WHERE proposal=?', (proposal['id'],)).fetchone() if exists else None
            if row is None: return None
            if row['digest'] != fingerprint(args) or row['conversation'] != args['conversation_id'] or row['action'] != proposal['action']:
                fail('IMPORT_ACTION_CHANGED', '执行记录与不可变人工方案不一致。', 409)
            if row['state'] == 'completed': return self.journal_receipt(row)
            result = None
            if proposal['action'] in ('propose_structure_import', 'propose_structure_check'):
                request = self.request(proposal)
                if proposal['action'] == 'propose_structure_check': request['series_id'] = args['series_id']
                saved = db.execute('SELECT digest,result FROM type_library_requests WHERE request=?', (proposal['id'],)).fetchone()
                if saved:
                    if saved['digest'] != fingerprint(request): fail('IMPORT_ACTION_CHANGED', '型号库请求摘要与人工方案不一致。', 409)
                    result = json.loads(saved['result'])
                elif proposal['action'] == 'propose_structure_check':
                    saved = db.execute('SELECT digest,payload,status FROM type_library_batches WHERE request=?', (proposal['id'],)).fetchone()
                    if saved:
                        if saved['digest'] != fingerprint(request): fail('IMPORT_ACTION_CHANGED', '批量回执摘要与人工方案不一致。', 409)
                        result = {**json.loads(saved['payload']), 'status': saved['status']}
        return self.remember(proposal, self.receipt(proposal, result) if result is not None else self.uncertain(proposal))

    def execute(self, task, proposal):
        service, args, name = self.service(), proposal['arguments'], proposal['action']
        conversation = self.conversation(task)
        if conversation != args['conversation_id']: fail('IMPORT_SCOPE_VIOLATION', '方案不属于当前对话。', 403)
        # Re-read every immutable source and revision before starting a write.
        if name == 'propose_structure_upload':
            attachment, content = self.attachment(conversation, args['attachment_id'])
            if attachment != args['attachment'] or attachment['sha256'] != args['expected_sha256']:
                fail('IMPORT_ATTACHMENT_CHANGED', '原件名称、大小或摘要已变化，未上传。', 409)
        elif name == 'propose_structure_preview':
            saved = self.saved(conversation, 'upload', args['upload_id'])
            if saved['sha256'] != args['sha256']: fail('IMPORT_SOURCE_CHANGED', '原件摘要已变化，未保存预览。', 409)
        elif name == 'propose_structure_import':
            saved = self.saved(conversation, 'preview', args['preview_id'])
            if saved['preview_digest'] != args['preview_digest']: fail('IMPORT_PREVIEW_CHANGED', '预览摘要已变化，未入库。', 409)
        else:
            saved = self.saved(conversation, 'series', args['series_id'])
            current = {row['id']: row for row in saved['specs']}
            if fingerprint(saved['declaration']) != args['declaration_digest'] or self.check_method()[0] != args['method']:
                fail('IMPORT_CHECK_STALE', '系列声明或核对方法在审阅期间变化，未开始核对。', 409)
            if any(row['id'] not in current or any(current[row['id']][key] != value for key, value in row.items()) for row in args['specs']):
                fail('IMPORT_CHECK_STALE', '所选型号版本或保存修订在审阅期间变化，未开始核对。', 409)
        initialize(self.store)
        with self.store.db(True) as db:
            db.execute('INSERT INTO agent_import_actions VALUES (?,?,?,?,?,?,?)',
                (proposal['id'], conversation, name, fingerprint(args), 'started', None, stamp()))
        try:
            if name == 'propose_structure_upload': result = service.upload(attachment['filename'], content)
            elif name == 'propose_structure_preview': result = service.preview({'upload_id': args['upload_id'], **args['request']})
            elif name == 'propose_structure_import': result = service.commit(self.request(proposal), 'human')
            else:
                scoped = copy(service)
                scoped.research = FrozenCheckResearch(service.research, args['method'])
                result = scoped.batch(args['series_id'], self.request(proposal), 'human')
            return self.remember(proposal, self.receipt(proposal, result))
        except Exception:
            # Even an exception raised after the service committed is not proof
            # that nothing was written. Reconciliation never calls it again.
            return self.recover(task, proposal)
