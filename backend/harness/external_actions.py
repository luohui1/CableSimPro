"""Reviewed platform actions for the external kernel.

The model can request a bounded action, never authorize it. Preparation only
stores an immutable proposal. The existing human proposals route calls apply;
the normal workspace/research/type services still enforce revisions and scope.
"""
from copy import deepcopy
import getpass
from hashlib import sha256
import json
from time import time
from uuid import UUID, uuid4

from fastapi import HTTPException

from backend.kernel.contracts import CreateStudy, Method, RunStudy
from backend.kernel.type_versions import NewType
from backend.kernel.workspace import fingerprint, stamp
from backend.plugin_host.parameter_contracts import validate_case
from backend.plugin_host import PluginHostError

from .contracts import ToolResult
from .security import redact
from .session_scope import is_type
from .tool_registry import Tool, TEXT, object_schema


READ_SCOPES = {
    'method_list': 'global', 'type_creation_options': 'global',
    'structure_import_inspect': 'global', 'study_compare': 'workspace',
}
ACTION_SCOPES = {
    'propose_study': 'workspace', 'propose_study_run': 'workspace',
    'propose_delivery': 'workspace', 'propose_type_create': 'workspace',
    'propose_standard_structure': 'workspace', 'propose_type_basis': 'type',
    'propose_type_specification': 'type',
}
SCOPES = {**READ_SCOPES, **ACTION_SCOPES}
RUN_IDS = {'type': 'array', 'minItems': 1, 'maxItems': 2,
           'uniqueItems': True, 'items': {'type': 'string', 'format': 'uuid'}}


def tools():
    definitions = [
        ('method_list', '读取计算方法', 'read', '读取已安装方法的准确版本和能力；参数须继续用 plugin_inspect 读取，不猜方法标识或缺失数据。', object_schema()),
        ('type_creation_options', '读取型号创建起点', 'read', '读取旧平台实际型号版本及其摘要、标准结构输入契约。不会新建型号。', object_schema()),
        ('structure_import_inspect', '检查结构表导入能力', 'read', '检查老平台是否接入厂家 Excel/CSV 结构表。未接入时明确拒绝，不调用另一套产品库。', object_schema({'filename': {'type': 'string', 'maxLength': 255}})),
        ('study_compare', '比较保存运行', 'read', '比较同工程内两条真实保存运行，先看输入差异，再看同量纲结果；不重新计算。', object_schema({'run_ids': {**RUN_IDS, 'minItems': 2}}, ['run_ids'])),
        ('propose_study', '提出新建研究', 'propose', '在当前工程或型号建立研究提案。source_study_id 可复制本工程准确保存的方法、参数和驱动；否则须明确 method 与 parameters。接受只保存研究，不运行。basis_request_id 只能引用本型号已接受的标准依据查询。', object_schema({
            'title': TEXT, 'source_study_id': TEXT, 'method': Method.model_json_schema(),
            'parameters': {'type': 'object'}, 'basis_request_id': TEXT,
        }, ['title'])),
        ('propose_study_run', '提出运行研究', 'propose', '提出对当前保存修订预检并运行一次；接受后调用原研究执行服务。缺数据或范围不适用则拒绝，无结果替代；不支持本机原生求解。', object_schema({
            'study_id': TEXT, 'module': {'type': 'string', 'pattern': '^[a-z][a-z0-9-]{0,63}$'},
        }, ['study_id'])),
        ('propose_delivery', '提出导出计算书', 'propose', '从本工程指定的当前有效运行生成计算书；接受前不生成交付，接受后不重算。', object_schema({'run_ids': RUN_IDS}, ['run_ids'])),
        ('propose_type_create', '提出新建型号', 'propose', '从已读取的准确库版本、已接受的标准结构提案或空白结构创建型号草稿。接受前不建型号；接受不发布、不核实厂家数据。', object_schema({
            'name': {'type': 'string', 'minLength': 1, 'maxLength': 80},
            'origin': {'enum': ['library', 'standard', 'blank']}, 'resource_id': TEXT,
            'proposal_id': TEXT, 'content_sha256': {'type': 'string', 'pattern': '^[a-f0-9]{64}$'},
            'construction': {'enum': ['single_core', 'three_core', 'four_core']},
        }, ['name', 'origin'])),
        ('propose_standard_structure', '提出按标准生成结构', 'propose', '按 type_creation_options 的真实标准结构契约计算并保存一个结构提案。缺数据不推测；接受后仍只是结构提案，新建型号须另行接受。', object_schema({'input': {'type': 'object'}}, ['input'])),
        ('propose_type_basis', '提出查询型号标准依据', 'propose', '按当前型号声明的标准查询封签依据并保存查询回执；不批准标准要求、不修改结构、不运行核对研究。', object_schema()),
        ('propose_type_specification', '提出导出规格书', 'propose', '只用当前型号的保存结构及真实保存运行导出 PDF。客户版缺证据拒绝；内部版保留缺项。不会暗中建研究、重算或发布。', object_schema({'audience': {'enum': ['internal', 'customer']}}, ['audience'])),
    ]
    return {entry[0]: Tool(*entry) for entry in definitions}


def fail(code, message, path=None, status=422):
    raise HTTPException(status, {'code': code, 'message': message, 'path': path})


def initialize(store):
    with store.db(True) as db:
        db.execute('''CREATE TABLE IF NOT EXISTS agent_external_files (
            proposal_id TEXT PRIMARY KEY, workspace TEXT NOT NULL,
            filename TEXT NOT NULL, media_type TEXT NOT NULL, sha256 TEXT NOT NULL,
            content BLOB NOT NULL, created TEXT NOT NULL)''')


class ExternalActions:
    def __init__(self, broker):
        self.broker = broker
        self.research, self.tasks, self.proposals = broker.research, broker.tasks, broker.proposals
        self.store = self.research.store

    @property
    def types(self):
        return self.broker.platform.app.state.types

    def current(self, task):
        with self.store.db() as db:
            row, state = self.store.load(db, task['workspace_id'], task['workspace_revision'], allow_domain=True)
            self.store.assert_mutable(db, task['workspace_id'])
        return row, state

    def study(self, task, sid, module=None):
        if task.get('study_id') and task['study_id'] != sid:
            fail('SCOPE_VIOLATION', '研究不在此会话范围；请在目标研究重新建立会话。', '/study_id')
        with self.store.db() as db:
            study = self.research.definition(db, task['workspace_id'], sid,
                task.get('study_revision') if task.get('study_id') == sid else None)
        selected = self.research.module_definition(study['definition'], module)
        return study, selected

    def dispatch(self, task, name, args):
        if name == 'method_list':
            methods = [{**{key: row[key] for key in ('method', 'name', 'description', 'platform_supported')},
                        'capabilities': [{key: cap[key] for key in ('id', 'title', 'description', 'preview', 'parameter_fields') if key in cap}
                                         for cap in row['capabilities']]}
                       for row in self.research.methods(summary=True)]
            return ToolResult(status='ok', summary='已读取当前安装的方法与准确版本；详细范围和参数须继续读取插件契约。',
                              data={'methods': methods, 'next_read': 'plugin_inspect'})
        if name == 'type_creation_options':
            return ToolResult(status='ok', summary='已读取型号库版本与标准结构契约。', data=self.types.creation_options())
        if name == 'structure_import_inspect':
            return ToolResult(status='error', summary='老平台尚未接入厂家 Excel/CSV 结构表的预览与批量入库接口，不能导入或核对这张表。',
                diagnostics=[{'code': 'STRUCTURE_IMPORT_UNAVAILABLE', 'message': '缺少结构表上传、列映射预览与批量草稿提交接口（T3）。原始文件未写入型号库。', 'recoverable': True}],
                data={'available': False, 'formats': ['xlsx', 'csv'], 'workbench_path': '/resources/cables/imports',
                      'required_contract': ['upload: immutable file id and SHA256', 'preview: rows, sources, missing fields and preview digest', 'commit: exact preview digest and human proposal id; atomic version drafts']},
                next_actions=['请在资源库核对已有厂家 PDF 导入能力；Excel/CSV 结构表须待批量导入接口接入后重试。'])
        if name == 'study_compare':
            runs = self.research.verified_runs(task['workspace_id'], args['run_ids'])
            if task.get('study_id') and any(run['study'] != task['study_id'] for run in runs):
                fail('SCOPE_VIOLATION', '比较运行必须属于此会话绑定的研究。', '/run_ids')
            return ToolResult(status='ok', summary='已比较两条保存运行；历史输入与方法差异保持可见。',
                data={'comparison': self.research.comparison(task['workspace_id'], args['run_ids']),
                      'workspace_id': task['workspace_id'], 'run_ids': args['run_ids']})
        return self.prepare(task, name, args)

    def prepare(self, task, name, args):
        if name not in ACTION_SCOPES:
            fail('TOOL_NOT_ALLOWED', '此动作不在已审查白名单。', '/tool', 403)
        _, state = self.current(task)
        if ACTION_SCOPES[name] == 'type' and not is_type(task):
            fail('SCOPE_VIOLATION', '此动作须在目标型号的会话中提出。', '/workspace_id')
        pid = str(uuid4())
        action = deepcopy(args)
        checks = ['只有人在对话中接受后才执行；接受时重新核对保存修订与来源。',
                  '接受该操作不等于工程结果核准或型号发布。']
        changes, assumptions = [], []
        title = tools()[name].title.removeprefix('提出')
        def change(label, after, unit=None, before=None, path=''):
            changes.append({'path': path, 'label': label, 'before': before, 'after': after, 'unit': unit})
        if name == 'propose_study':
            if args.get('source_study_id'):
                original, _ = self.study(task, args['source_study_id'])
                definition = deepcopy(original['definition'])
                action['source_study_revision'] = original['revision']
            else:
                if not args.get('method') or 'parameters' not in args:
                    fail('STUDY_INPUT_REQUIRED', '请提供准确方法与明确参数，或指定本工程内要复制的保存研究；不会猜测缺失输入。')
                definition = {'method': args['method'], 'parameters': args['parameters'], 'input_source': 'domain'}
            definition['title'] = args['title']
            for field in ('method', 'parameters'):
                if field in args: definition[field] = deepcopy(args[field])
            if args.get('basis_request_id'):
                if not is_type(task): fail('SCOPE_VIOLATION', '标准依据回执仅能绑定本型号。')
                with self.store.db() as db:
                    basis = db.execute('SELECT * FROM requirement_basis_queries WHERE workspace=? AND request_id=?',
                        (task['workspace_id'], args['basis_request_id'])).fetchone()
                if not basis or basis['revision'] != task['workspace_revision']:
                    fail('BASIS_REQUIRED', '请先接受本型号当前修订的标准依据查询。', '/basis_request_id')
                payload = json.loads(basis['payload'])
                if fingerprint(payload) != basis['digest']: fail('BASIS_INTEGRITY_FAILED', '依据查询回执摘要不一致。')
                definition['parameters'].update(payload['parameters'])
                action['basis_digest'] = basis['digest']
            configuration = CreateStudy.model_validate({**definition, 'expected_revision': task['workspace_revision']})
            plugin, capability = self.research.resolve(configuration.method.model_dump())
            document = configuration.method_input if configuration.input_source == 'study' else state.get('domain')
            if document is None: fail('DOMAIN_INPUT_REQUIRED', '请先在工作台补齐并保存领域输入。')
            validate_case(capability, {'input': document, 'parameters': configuration.parameters})
            action['definition'] = configuration.model_dump(mode='json', exclude={'expected_revision'})
            change('研究名称', args['title'])
            change('方法', plugin.manifest.name + ' ' + plugin.manifest.version + ' · ' + capability.title)
            for point in self.broker.parameter_points(configuration.parameters,
                    capability.parameter_schema.model_dump(mode='json', by_alias=True, exclude_none=True)):
                change(point['label'], point['value'], point['unit'], path=point['path'])
            checks.append('只新建研究定义；运行、修改输入及导出都须另行接受。')
        elif name == 'propose_study_run':
            study, selected = self.study(task, args['study_id'], args.get('module'))
            plugin, capability = self.research.resolve(selected['method'])
            if not capability.preview or (hasattr(self.research.executor, 'required') and self.research.executor.required(plugin.manifest.id, capability.id)):
                fail('NATIVE_EXECUTION_UNAVAILABLE', '此方法需要原生或超算执行；请在工作台确认计算位置和核时后提交，边车不在本机代算。')
            if selected.get('task') in ('transient-temperature', 'sheath-losses', 'electrothermal-steady', 'iec-fem-comparison'):
                fail('NATIVE_EXECUTION_UNAVAILABLE', '此研究须通过工作台提交超算。')
            action.update(study_revision=study['revision'], method=selected['method'])
            change('研究', study['definition']['title'])
            change('方法', plugin.manifest.name + ' ' + plugin.manifest.version + ' · ' + capability.title)
            checks.extend(['接受后先执行原后端预检；缺项或范围不通过时停止。',
                           '保存一次不可变运行，保留输入、方法版本及失败诊断；不修改工程输入。'])
            for limit in getattr(capability, 'limitations', []) or []:
                if isinstance(limit, str): assumptions.append(limit)
        elif name == 'propose_delivery':
            runs = self.research.verified_runs(task['workspace_id'], args['run_ids'])
            if any(run['status'] != 'succeeded' or run['freshness'] != 'current' for run in runs):
                fail('DELIVERY_SOURCE_INVALID', '计算书只接受当前有效的完整保存运行；请先重算或补齐缺项。', '/run_ids')
            if task.get('study_id') and any(run['study'] != task['study_id'] for run in runs):
                fail('SCOPE_VIOLATION', '交付来源不在此会话研究范围内。', '/run_ids')
            action['sources'] = [{'run_id': run['id'], 'input_digest': run['input_digest'], 'output_digest': run['output_digest']} for run in runs]
            change('交付内容', '已选择的 ' + str(len(runs)) + ' 条保存运行')
            checks.append('计算书引用所选运行的输入、数值及限制，不重算、不混入当前未保存输入。')
        elif name == 'propose_type_create':
            request = NewType.model_validate({**args, 'request_id': pid})
            if request.origin == 'library':
                choices = self.types.creation_options()['library']
                selected = next((item for item in choices if item['id'] == str(request.resource_id)
                    and item['content_sha256'] == request.content_sha256), None)
                if not selected: fail('TYPE_SOURCE_INVALID', '请重新读取并选择准确型号库版本及摘要。')
                change('来源型号', selected['name'] + ' · ' + selected['version'])
            elif request.origin == 'standard':
                with self.store.db() as db:
                    source = db.execute('SELECT * FROM type_creation_proposals WHERE id=?', (str(request.proposal_id),)).fetchone()
                if not source or source['digest'] != request.content_sha256: fail('TYPE_SOURCE_INVALID', '请先接受标准结构计算并引用其确切提案和摘要。')
                prepared = json.loads(source['payload'])
                for row in prepared.get('rows', []):
                    change(row.get('title') or row.get('label') or '结构参数', row.get('value'), row.get('unit'))
                checks.extend(prepared.get('limitations', []))
            else:
                change('结构形式', {'single_core': '单芯', 'three_core': '三芯', 'four_core': '四芯'}[request.construction])
                checks.append('空白草稿保留缺项，不生成材料物性或工程计算结果。')
            change('新型号名称', request.name)
            action['request'] = request.model_dump(mode='json')
            checks.append('创建新的未发布型号草稿；源库版本及其他工程不变。')
        elif name == 'propose_standard_structure':
            from backend.kernel.type_versions import NewTypeProposal
            from jsonschema import Draft202012Validator
            request = NewTypeProposal.model_validate({'request_id': pid, 'input': args['input']})
            options = self.types.creation_options()['generation']
            if len(options) != 1: fail('STRUCTURE_METHOD_UNAVAILABLE', '没有唯一的已安装标准结构方法。')
            errors = list(Draft202012Validator(options[0]['schema']).iter_errors(args['input']))
            if errors: fail('STRUCTURE_INPUT_REQUIRED', '标准结构输入不完整或不合法：' + errors[0].message)
            action['request'] = request.model_dump(mode='json')
            action['method'] = options[0]['method']
            for key, value in args['input'].items():
                field = options[0]['schema'].get('properties', {}).get(key, {})
                change(field.get('title', key), value, (field.get('x-unit') or {}).get('si'))
            checks.append('保存标准尺寸及来源条款为结构提案；新建型号还需要下一张待审卡。')
        elif name == 'propose_type_basis':
            change('查询对象', state['domain']['name'])
            checks.append('只查询当前声明标准的封签依据；缺少的条款和厂家实测值保持缺项。')
        elif name == 'propose_type_specification':
            spec = self.types.specification(task['workspace_id'], args['audience'])
            self.check_specification(task, spec, args['audience'])
            action['specification_digest'] = spec['digest']
            change('文件', '内部规格书（含缺项）' if args['audience'] == 'internal' else '客户规格书')
            change('型号', spec['payload']['name'])
            checks.extend(str(row['message']) for row in spec['payload']['checks'] if row.get('blocking'))
            checks.append('只读取已保存证据；不自动创建研究、求解或发布型号。')
        proposal = {'id': pid, 'kind': 'external_action', 'action': name,
            'arguments': action, 'workspace_revision': task['workspace_revision'], 'expires': time() + 3600,
            'public': {'id': pid, 'kind': 'external_action', 'action': name, 'title': title,
                       'base_revision': task['workspace_revision'], 'changes': changes, 'checks': checks,
                       'assumptions': assumptions}}
        self.proposals.persist(task, proposal)
        return ToolResult(status='ok', summary='待审方案已生成；接受前没有执行业务写入。', data={'proposal': proposal['public']},
            next_actions=['等待人在对话中接受或拒绝；接受后根据真实回执继续下一步。'])

    def check_specification(self, task, spec, audience):
        if spec['payload']['revision'] != task['workspace_revision']:
            fail('PROPOSAL_STALE', '型号修订已变化，请重新读取后提出导出。', status=409)
        if audience == 'customer':
            from backend.kernel.specification_generation import generation_gap, ORDER
            _, _, channels, _ = self.types.evidence(task['workspace_id'])
            for channel in ORDER:
                gap = generation_gap(channel, channels.get(channel), spec['payload'].get('release_exclusions', []))
                if gap: fail('SPECIFICATION_EVIDENCE_REQUIRED', '客户规格书缺少保存证据：' + gap)

    def complete(self, task, proposal, decision, marker, receipt, db):
        fresh = self.tasks.load(db, task['id'])
        if fresh['active_turn'] != marker: fail('DECISION_IDENTITY_CHANGED', '人工决定执行身份已变化。', status=409)
        self.tasks.event(db, task['id'], 'proposal.decision', {'id': proposal['id'], 'status': decision,
            'actor': getpass.getuser(), 'source': 'human.route', 'engineering_approval': False,
            'receipt': redact(receipt), **{k: receipt[k] for k in ('workspace_revision', 'study_id', 'study_revision') if k in receipt}})
        # Creating a different object does not silently expand the old session's
        # scope. The kernel explicitly opens a new scoped session for that object.
        db.execute('UPDATE agent_tasks SET state=?,waiting_reason=NULL,active_turn=NULL,updated=? WHERE id=?',
            ('completed', stamp(), task['id']))
        return {'status': decision, 'receipt': redact(receipt)}

    def apply(self, pid, decision, marker):
        try:
            return self.execute_approved(pid, decision, marker)
        except (HTTPException, PluginHostError, ValueError) as error:
            # The human accepted an intent, not a guarantee of execution. Record
            # deterministic refusal durably so reconnect/retry cannot leave an
            # ambiguous pending card or repeatedly attempt a stale operation.
            details = {}
            if isinstance(error, HTTPException):
                detail = error.detail
                code = detail.get('code', 'ACTION_REJECTED') if isinstance(detail, dict) else 'ACTION_REJECTED'
                message = detail.get('message', str(detail)) if isinstance(detail, dict) else str(detail)
                if isinstance(detail, dict):
                    details = {key: detail[key] for key in ('path', 'issues', 'diagnostics', 'workbench_path', 'next_actions', 'input_digest') if key in detail}
            elif isinstance(error, PluginHostError):
                code, message = error.code, error.message
            else:
                code, message = 'INPUT_INVALID', str(error)
            with self.store.db(True) as db:
                task, proposal, previous = self.tasks.proposal(db, pid)
                if previous: return {'status': previous['status'], 'receipt': previous.get('receipt', {})}
            # A service may have committed before a response/receipt failed.
            # Reconcile its existing idempotency record before claiming that no
            # business write occurred. Recovery never executes a second action.
            receipt = self.recover(task, proposal)
            recorded_decision = 'approved' if receipt is not None else decision
            if receipt is None:
                receipt = {'status': 'failed', 'executed': False, 'error': redact({'code': code, 'message': message, **details}),
                           'workspace_id': task['workspace_id']}
                if proposal['action'] == 'propose_study_run':
                    receipt['study_id'] = proposal['arguments']['study_id']
            with self.store.db(True) as db:
                return self.complete(task, proposal, recorded_decision, marker, receipt, db)

    def run_receipt(self, task, proposal, run):
        receipt = {'workspace_id': task['workspace_id'], 'study_id': proposal['arguments']['study_id'],
                   'run_id': run['id'], 'kind': 'run', 'status': run['status'], 'executed': True,
                   'title': run['snapshot']['definition']['title']}
        if run['status'] == 'succeeded' and run.get('integrity') == 'verified':
            from .evidence import run_points
            receipt['result'] = run_points(self.research, run, all_quantities=True)
        else:
            receipt['error'] = run.get('error') or {'message': '运行未完整成功，请在工作台查看保存诊断。'}
        return receipt

    def recover(self, task, proposal):
        """Use the old services' durable operation IDs after a lost receipt."""
        pid, name, args, wid = proposal['id'], proposal['action'], proposal['arguments'], task['workspace_id']
        with self.store.db() as db:
            if name == 'propose_study_run':
                row = db.execute('SELECT id,study FROM study_runs WHERE workspace=? AND request_id=?', (wid, pid)).fetchone()
                if row:
                    if row['study'] != args['study_id']: fail('ACTION_IDENTITY_CHANGED', '运行回执不属于已接受研究。', status=409)
                    run = self.research.get_run(wid, row['id'])
                    return self.run_receipt(task, proposal, run)
            elif name == 'propose_delivery':
                row = db.execute('SELECT d.id,d.digest FROM deliveries d JOIN delivery_requests r ON r.delivery=d.id WHERE r.workspace=? AND r.request_id=?', (wid, pid)).fetchone()
                if row:
                    return {'workspace_id': wid, 'delivery_id': row['id'], 'run_ids': args['run_ids'], 'kind': 'delivery', 'title': '计算书',
                            'href': '/deliveries?workspace=' + wid, 'download_url': f'/api/workspaces/{wid}/deliveries/{row["id"]}/file',
                            'media_type': 'text/html', 'digest': row['digest']}
            elif name == 'propose_type_create':
                row = db.execute('SELECT workspace FROM type_create_requests WHERE request_id=?', (pid,)).fetchone()
                if row:
                    saved = self.store.snapshot(row['workspace'], db)
                    return {'workspace_id': saved['id'], 'type_id': saved['id'], 'workspace_revision': saved['revision'],
                            'kind': 'type', 'title': args['request']['name']}
            elif name == 'propose_standard_structure':
                row = db.execute('SELECT payload FROM type_creation_proposals WHERE request_id=?', (pid,)).fetchone()
                if row:
                    result = json.loads(row['payload'])
                    return {'kind': 'structure', 'workspace_id': wid, 'proposal_id': result['id'],
                            'content_sha256': result['content_sha256'], 'rows': result['rows'], 'limitations': result['limitations']}
            elif name == 'propose_type_basis':
                row = db.execute('SELECT payload,digest FROM requirement_basis_queries WHERE workspace=? AND request_id=?', (wid, pid)).fetchone()
                if row:
                    result = json.loads(row['payload'])
                    if fingerprint(result) != row['digest']: fail('BASIS_INTEGRITY_FAILED', '依据查询回执摘要不一致。')
                    return {'kind': 'basis', 'workspace_id': wid, 'basis_request_id': pid, **result}
            elif name == 'propose_type_specification' and db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_external_files'").fetchone():
                row = db.execute('SELECT sha256 FROM agent_external_files WHERE proposal_id=? AND workspace=?', (pid, wid)).fetchone()
                if row: return self.specification_receipt(wid, pid, args['audience'], row['sha256'])
        return None

    @staticmethod
    def specification_receipt(wid, pid, audience, digest):
        url = '/api/agent/files/' + pid
        return {'kind': 'specification', 'workspace_id': wid,
                'title': '内部规格书' if audience == 'internal' else '客户规格书', 'href': url, 'download_url': url,
                'media_type': 'application/pdf', 'digest': digest, 'audience': audience}

    def execute_approved(self, pid, decision, marker):
        with self.store.db() as db:
            task, proposal, previous = self.tasks.proposal(db, pid)
        if previous: return {'status': previous['status'], 'receipt': previous.get('receipt', {})}
        existing = self.recover(task, proposal)
        if existing is not None:
            # A previously accepted action can already be durable when its
            # decision response was lost. Even a later rejection must report
            # that completed approval truthfully instead of claiming no write.
            with self.store.db(True) as db: return self.complete(task, proposal, 'approved', marker, existing, db)
        if decision == 'rejected':
            with self.store.db(True) as db: return self.complete(task, proposal, decision, marker, {}, db)
        self.current(task)
        name, args, wid = proposal['action'], proposal['arguments'], task['workspace_id']
        if name not in ACTION_SCOPES: fail('ACTION_NOT_ALLOWED', '此方案的操作不在已审查白名单。', status=403)
        if name == 'propose_study':
            if args.get('source_study_id'):
                original, _ = self.study(task, args['source_study_id'])
                if original['revision'] != args['source_study_revision']:
                    fail('PROPOSAL_STALE', '被复制的研究在审阅期间已变化；未创建研究。', status=409)
            with self.store.db(True) as db:
                saved = self.research.save(wid, CreateStudy.model_validate({**args['definition'],
                    'expected_revision': proposal['workspace_revision']}), connection=db)
                receipt = {'workspace_id': wid, 'study_id': saved['id'], 'study_revision': saved['revision'],
                           'kind': 'study', 'title': saved['definition']['title']}
                return self.complete(task, proposal, decision, marker, receipt, db)
        if name == 'propose_study_run':
            saved, selected = self.study(task, args['study_id'], args.get('module'))
            if saved['revision'] != args['study_revision'] or selected['method'] != args['method']:
                fail('PROPOSAL_STALE', '研究配置在审阅期间已变化；未运行。', status=409)
            checked = self.research.preflight(wid, saved['id'], task['workspace_revision'], saved['revision'], args.get('module'))
            if not checked['ready'] or checked.get('partial'):
                from .external_preflight import refusal
                raise HTTPException(422, refusal(self.research, wid, saved, selected, checked))
            run = self.research.execute(wid, saved['id'], RunStudy(request_id=UUID(pid),
                expected_revision=task['workspace_revision'], expected_study_revision=saved['revision'],
                lock_digest=checked['lock_digest'], scope_acknowledged=True, module=args.get('module')), checked_preflight=checked)
            receipt = self.run_receipt(task, proposal, run)
        elif name == 'propose_delivery':
            runs = self.research.verified_runs(wid, args['run_ids'])
            sources = [{'run_id': run['id'], 'input_digest': run['input_digest'], 'output_digest': run['output_digest']} for run in runs]
            if sources != args['sources']: fail('DELIVERY_SOURCE_CHANGED', '保存运行来源摘要变化，未导出。', status=409)
            delivery = self.research.deliver(wid, args['run_ids'], request_id=UUID(pid), current_only=True)
            receipt = {'workspace_id': wid, 'delivery_id': delivery['id'], 'run_ids': args['run_ids'],
                       'kind': 'delivery', 'title': '计算书', 'href': '/deliveries?workspace=' + wid,
                       'download_url': f'/api/workspaces/{wid}/deliveries/{delivery["id"]}/file',
                       'media_type': 'text/html', 'digest': delivery['digest']}
        elif name == 'propose_type_create':
            request = {**args['request'], 'human_confirmed': args['request']['origin'] == 'standard'}
            # This method is reachable only from the existing human decision
            # route; the ordinary type service resolves the local operator.
            saved = self.types.create_type(NewType.model_validate(request), 'human')
            receipt = {'workspace_id': saved['id'], 'type_id': saved['id'], 'workspace_revision': saved['revision'],
                       'kind': 'type', 'title': args['request']['name']}
        elif name == 'propose_standard_structure':
            from backend.kernel.type_versions import NewTypeProposal
            self.research.resolve(args['method'])
            result = self.types.propose_type(NewTypeProposal.model_validate(args['request']))
            receipt = {'kind': 'structure', 'workspace_id': wid, 'proposal_id': result['id'],
                       'content_sha256': result['content_sha256'], 'rows': result['rows'], 'limitations': result['limitations']}
        elif name == 'propose_type_basis':
            from backend.kernel.requirements import Requirements, ResolveBasis
            result = Requirements(self.research).resolve_basis(wid, ResolveBasis(request_id=UUID(pid), expected_revision=task['workspace_revision']))
            receipt = {'kind': 'basis', 'workspace_id': wid, 'basis_request_id': pid, **result}
        elif name == 'propose_type_specification':
            spec = self.types.specification(wid, args['audience'])
            self.check_specification(task, spec, args['audience'])
            if spec['digest'] != args['specification_digest']:
                fail('SPECIFICATION_CHANGED', '规格书内容在审阅期间变化，未导出。', status=409)
            from backend.kernel.specification_pdf import render_pdf
            content = render_pdf(spec, args['audience'])
            initialize(self.store)
            digest = sha256(content).hexdigest()
            with self.store.db(True) as db:
                self.store.load(db, wid, task['workspace_revision'], allow_domain=True)
                db.execute('INSERT OR IGNORE INTO agent_external_files VALUES (?,?,?,?,?,?,?)',
                    (pid, wid, 'cable-specification.pdf', 'application/pdf', digest, content, stamp()))
            receipt = self.specification_receipt(wid, pid, args['audience'], digest)
        else: fail('ACTION_NOT_ALLOWED', '没有可执行的已接受动作。', status=403)
        with self.store.db(True) as db: return self.complete(task, proposal, decision, marker, receipt, db)
