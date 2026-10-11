"""Immutable input drafts connecting ordinary layout, geometry and study services.

Only Agent records are written here. The existing human proposal route is the
sole place that commits a domain document or creates a saved study.
"""
from copy import deepcopy
from hashlib import sha256
import json
from time import time
from uuid import uuid4

from fastapi import HTTPException

from backend.domain.editing import DraftDomainDocument, resolve_edit
from backend.kernel.contracts import CreateStudy, Method
from backend.kernel.host_api import GeometryPreview
from backend.kernel.scenarios import LayoutPreview
from backend.kernel.workspace import fingerprint
from backend.plugin_host.parameter_contracts import validate_case

from .context_builder import fits, content_digest, draft_card, RESULT_BYTES
from .contracts import ToolResult
from .fields import check_edits, domain_metadata, displayed, stored, target
from .session_scope import is_type


def reject(code, message, path=None):
    raise HTTPException(422, {'code': code, 'message': message, 'path': path})


def review_changes(before, after, type_workspace=False):
    """Complete stable diffs, including template-created or removed objects."""
    rows = []
    def walk(old, new, tokens):
        if old == new:
            return
        if isinstance(old, dict) and isinstance(new, dict):
            for key in sorted(old.keys() | new.keys()):
                if key != 'provenance':
                    walk(old.get(key), new.get(key), [*tokens, key])
            return
        if isinstance(old, list) and isinstance(new, list):
            identity = next((key for key in ('id', 'role', 'cable') if all(
                isinstance(row, dict) and key in row for row in [*old, *new])), None)
            if identity and len({r[identity] for r in old}) == len(old) and len({r[identity] for r in new}) == len(new):
                previous, current = {r[identity]: r for r in old}, {r[identity]: r for r in new}
                for key in sorted(previous.keys() | current.keys()):
                    walk(previous.get(key), current.get(key), [*tokens, key])
                # Order is an input fact too, even when all identities match.
                if previous.keys() == current.keys() and [r[identity] for r in old] != [r[identity] for r in new]:
                    rows.append({'path': '/'+ '/'.join(str(t).replace('~', '~0').replace('/', '~1') for t in tokens), 'label': '对象顺序',
                        'before': [r[identity] for r in old], 'after': [r[identity] for r in new], 'unit': None})
                return
        path = '/'+ '/'.join(str(t).replace('~', '~0').replace('/', '~1') for t in tokens)
        try:
            spec = domain_metadata(path); unit = spec['x-unit']
            if type_workspace and unit['si'] == 'm':
                unit = {**unit, 'display': 'mm', 'scale': 1000}
            label = spec['title']; old, new = displayed(old, unit), displayed(new, unit)
        except HTTPException:
            unit = {'display': None}; label = '结构变更（内部量值为 SI）'
        rows.append({'path': path, 'label': label, 'before': old, 'after': new, 'unit': unit['display']})
    walk(before, after, [])
    return rows


class Drafts:
    def __init__(self, broker):
        self.broker = broker
        self.proposals, self.tasks = broker.proposals, broker.tasks

    def base(self, task):
        current, state, _ = self.proposals.source(task)
        if current['revision'] != task['workspace_revision']:
            raise HTTPException(409, {'code': 'DRAFT_BASE_CHANGED', 'message': '共享输入修订已变化，请重新读取并建立会话。'})
        with self.proposals.workspace.db() as db:
            self.proposals.workspace.assert_mutable(db, task['workspace_id'])
        if 'domain' not in state:
            reject('DOMAIN_INPUT_REQUIRED', '请先在工作台保存明确的领域输入。')
        return state

    def load(self, task, identifier, kind='draft'):
        with self.tasks.db() as db:
            row = db.execute("SELECT body,digest FROM agent_plan_revisions WHERE task_id=? "
                "AND json_extract(body,'$.kind')=? AND json_extract(body,'$.id')=?",
                (task['id'], kind, identifier)).fetchone()
        if not row:
            reject('DRAFT_NOT_FOUND', '只能使用本会话返回的准确草稿或仿真配置标识。', '/'+kind+'_id')
        value = json.loads(row['body'])
        if fingerprint(value) != row['digest'] or value['workspace_revision'] != task['workspace_revision']:
            raise HTTPException(409, {'code': 'DRAFT_IDENTITY_CHANGED', 'message': '草稿身份、摘要或基准修订不一致。'})
        if time() > value['expires']:
            raise HTTPException(409, {'code': 'DRAFT_EXPIRED', 'message': '草稿已过期，请重新读取输入。'})
        if kind == 'draft' and fingerprint(value['document']) != value['input_digest']:
            raise HTTPException(409, {'code': 'DRAFT_INTEGRITY_FAILED', 'message': '草稿输入摘要不匹配。'})
        return value

    def document(self, task, args):
        state = self.base(task)
        draft = self.load(task, args['draft_id']) if args.get('draft_id') else None
        document = deepcopy(draft['document'] if draft else state['domain'])
        # Validate with the original saved locks and dependent-coordinate rules.
        document = resolve_edit(state, DraftDomainDocument.model_validate(document))
        if draft and fingerprint(document) != draft['input_digest']:
            raise HTTPException(409, {'code': 'DRAFT_RULES_CHANGED', 'message': '输入校验或派生规则已变化，请重新生成草稿。'})
        return state, document, draft

    def read(self, task, args):
        view=args.get('view','input')
        incompatible=({'draft_id','compare_to','paths'} if view=='catalog' else
            {'paths','expected_catalog_revision'} if view=='changes' else {'compare_to','offset','limit','expected_catalog_revision'})
        if incompatible & args.keys():
            key=sorted(incompatible & args.keys())[0]
            reject('DRAFT_VIEW_ARGUMENT_INVALID', '此参数不适用于 '+view+' 视图。', '/'+key)
        if view=='catalog':return self.catalog(task,args)
        _, document, draft = self.document(task, args)
        if view=='changes':
            if not draft:reject('DRAFT_REQUIRED', '差异视图需要准确的候选草稿ID。', '/draft_id')
            _,before,reference=self.document(task, {'draft_id':args['compare_to']} if args.get('compare_to') else {})
            rows=review_changes(before,document,is_type(task))
            data={'projection':'draft_changes','draft_id':draft['id'],'input_digest':draft['input_digest'],
                'reference':{'draft_id':reference['id'] if reference else None,'input_digest':fingerprint(before),
                    'persisted':reference is None},'workspace_revision':task['workspace_revision'],
                'persisted':False,'engineering_approval':False,'comparison':'input_only'}
            result=ToolResult(status='ok',summary='候选输入差异；未计算温度、载流量或标准符合性的变化。',data=data)
            return self.page(result,rows,args,'changes')
        if args.get('paths'):
            data = {'fields': self.broker.field_points(document, args['paths'])}
            if is_type(task):
                for field in data['fields']:
                    if field.get('unit') == 'm':
                        field.update(value=field['value']*1000, unit='mm')
        else:
            from .tool_broker import outline
            data = outline(document)
        return ToolResult(status='ok', summary='已读取未保存草稿。' if draft else '已读取会话固定修订的保存输入；不是计算结果。', data={
            'projection':'draft_input',
            **data, 'draft_id': draft['id'] if draft else None, 'input_digest': fingerprint(document),
            'workspace_id': task['workspace_id'], 'workspace_revision': task['workspace_revision'],
            'persisted': draft is None, 'engineering_approval': False})

    def page(self,result,rows,args,key):
        """Whole rows within the model envelope; never cut a field value in half."""
        offset=args.get('offset',0);limit=args.get('limit',10)
        result.data.update(total=len(rows),offset=offset,**{key:[]},next_page=None)
        for row in rows[offset:offset+limit]:
            result.data[key].append(row)
            following=offset+len(result.data[key])
            result.data['next_page']={**args,'view':args.get('view','input'),'offset':following,'limit':limit} if following<len(rows) else None
            if not fits(result.model_dump(mode='json'),RESULT_BYTES):
                result.data[key].pop()
                if not result.data[key]:
                    reject('DRAFT_ITEM_TOO_LARGE','一项完整差异或名片超过6KiB；请在工作台查看完整对象，未截断待审字段。',row.get('path'))
                following=offset+len(result.data[key])
                result.data['next_page']={**args,'view':args.get('view','input'),'offset':following,'limit':limit}
                break
        return result

    def catalog(self,task,args):
        # Read metadata with SQLite JSON projection, not the document TEXT.
        with self.tasks.db() as db:
            db.execute('BEGIN')
            current=db.execute('SELECT revision FROM workspaces WHERE id=?',(task['workspace_id'],)).fetchone()
            rows=db.execute("""SELECT created,json_object('kind',json_extract(body,'$.kind'),
                'id',json_extract(body,'$.id'),'draft_id',json_extract(body,'$.draft_id'),
                'parent_id',json_extract(body,'$.parent_id'),'workspace_revision',json_extract(body,'$.workspace_revision'),
                'input_digest',json_extract(body,'$.input_digest'),'expires',json_extract(body,'$.expires'),
                'definition',json_object('title',json_extract(body,'$.definition.title'),
                    'method',json_extract(body,'$.definition.method'))) AS card,revision
                FROM agent_plan_revisions WHERE task_id=? AND json_extract(body,'$.kind') IN ('draft','simulation')
                ORDER BY revision DESC""",(task['id'],)).fetchall()
        revision=rows[0]['revision'] if rows else 0
        if 'expected_catalog_revision' in args and args['expected_catalog_revision']!=revision:
            reject('DRAFT_CATALOG_CHANGED','候选目录已变化；从offset=0重新读取，勿拼接不同版本。','/expected_catalog_revision')
        now=time()
        cards=[draft_card(json.loads(row['card']),task['workspace_revision'],current['revision'],created=row['created'],now=now) for row in rows]
        result=ToolResult(status='ok',summary='本会话候选目录；过期和修订变化的候选保留原因，不自动恢复或保存。',data={
            'projection':'draft_catalog','workspace_id':task['workspace_id'],
            'workspace_revision':task['workspace_revision'],'current_workspace_revision':current['revision'],
            'catalog_revision':revision,'engineering_approval':False})
        return self.page(result,cards,{**args,'expected_catalog_revision':revision},'items')

    def update(self, task, args):
        state, document, previous = self.document(task, args)
        identifier = str(uuid4())
        changes = args.get('changes') or []
        if bool(changes) == bool(args.get('template')):
            reject('DRAFT_OPERATION_REQUIRED', '一次修改须选择字段变更或显式敷设模板。', '/changes')
        if changes:
            if is_type(task):
                from .type_design import candidate
                document, _, _ = candidate({**state, 'domain': document}, changes, identifier)
            else:
                check_edits(changes)
                for change in changes:
                    parent, key = target(document, change['path'], stable=True)
                    unit = domain_metadata(change['path'])['x-unit']
                    if unit['si'] and change.get('unit') is None:
                        reject('DRAFT_UNIT_REQUIRED', '工程量必须带明确的界面单位：'+str(unit['display']), change['path'])
                    try:
                        parent[key] = stored(change['value'], unit, change.get('unit'))
                    except HTTPException as error:
                        raise HTTPException(error.status_code, {**error.detail, 'path': change['path']}) from None
                    document.setdefault('provenance', {})[change['path']] = {
                        'kind': 'user', 'reviewed': False, 'reference': 'Agent 草稿 '+identifier+'；未批准的设计输入。'}
        else:
            if is_type(task):
                reject('TYPE_TOOL_NOT_APPLICABLE', '型号会话不能应用工程敷设模板。', '/template')
            template = args['template']
            if template.get('unit') != 'm':
                reject('DISPLAY_UNIT_MISMATCH', '模板埋深和间距须明确使用 m。', '/template/unit')
            request = LayoutPreview.model_validate({'expected_revision': task['workspace_revision'],
                'document': document, **{k: v for k, v in template.items() if k != 'unit'}})
            # This ordinary endpoint checks template applicability and saved locks;
            # it returns a document and never saves it or executes a solver.
            route = next(r for r in self.broker.platform.app.routes
                if getattr(r, 'path', None) == '/api/design/workspaces/{wid}/section-template')
            document = route.endpoint(task['workspace_id'], request)
        document = resolve_edit(state, DraftDomainDocument.model_validate(document))
        if fingerprint(document) == fingerprint(previous['document'] if previous else state['domain']):
            reject('DRAFT_NO_CHANGE', '草稿没有实际变化。')
        draft = {'kind': 'draft', 'id': identifier, 'workspace_revision': task['workspace_revision'],
            'parent_id': previous['id'] if previous else None, 'document': document,
            'input_digest': fingerprint(document), 'expires': time()+3600}
        if not fits(draft, 1024*1024):
            reject('DRAFT_TOO_LARGE', '草稿超过 1 MiB；请在工作台缩小工作对象范围。')
        self.tasks.add_plan(task['id'], draft)
        self.tasks.emit(task['id'], 'draft.created', {k: v for k, v in draft.items() if k != 'document'})
        fields = self.broker.field_points(document, [c['path'] for c in changes])
        if is_type(task):
            for field in fields:
                if field.get('unit') == 'm':
                    field.update(value=field['value']*1000, unit='mm')
        return ToolResult(status='ok', summary='草稿修改及领域校验通过；尚未生成审核方案或保存工程。', data={
            'draft_id': identifier, 'parent_id': draft['parent_id'], 'input_digest': draft['input_digest'],
            'persisted': False, 'engineering_approval': False,
            'template': args.get('template'), 'fields': fields,
            'limitations': ['模板保留宿主的演示来源与未核对假设；应用模板会重排截面，正式使用须人工核对。'] if args.get('template') else []},
            next_actions=['用 draft_read 检查草稿，draft_geometry 检查几何；确认后 draft_propose 生成审核方案。'])

    def geometry(self, task, args):
        _, document, draft = self.document(task, args)
        method = Method.model_validate(args['method'])
        plugin, capability = self.broker.research.resolve(method.model_dump(mode='json'))
        executor = self.broker.research.executor
        if capability.analysis != 'geometry' or capability.input_schema != 'cablesim.domain/1':
            reject('GEOMETRY_CAPABILITY_REQUIRED', '请选择接受领域输入的封签几何能力。', '/method')
        if hasattr(executor, 'required') and (executor.required(plugin.manifest.id) or executor.required(plugin.manifest.id, capability.id)):
            reject('HUMAN_EXECUTION_REQUIRED', '此几何能力需要超算，须由人在工作台确认执行。', '/method')
        remaining = min((task['limits']['max_active_ms']-task['elapsed_ms'])/1000, task['deadline']-time())
        if plugin.manifest.resources.timeout_s > remaining:
            reject('GEOMETRY_BUDGET_INSUFFICIENT', '剩余执行预算不足以容纳此能力的超时上限；请在工作台执行几何预览。', '/method')
        parameters = deepcopy(args['parameters'])
        if any(key.startswith('_') for key in parameters):
            reject('GEOMETRY_PARAMETER_INVALID', '内部缓存及来源参数不能由模型注入。', '/parameters')
        validate_case(capability, {'input': document, 'parameters': parameters})
        if parameters.get('include_exact') is True:
            reject('HUMAN_EXECUTION_REQUIRED', '完整 STEP/BRep 导出请在型号或敷设工作台人工执行；此工具只检查显示几何。', '/parameters/include_exact')
        if 'include_exact' in capability.parameter_schema.properties:
            parameters['include_exact'] = False
        validate_case(capability, {'input': document, 'parameters': parameters})
        response = self.broker.platform.app.state.previews.preview(task['workspace_id'], GeometryPreview(
            expected_revision=task['workspace_revision'], document=DraftDomainDocument.model_validate(document),
            method=method, parameters=parameters))
        expected = sha256(json.dumps(document, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()
        if response['effect'] != 'preview' or response['base_revision'] != task['workspace_revision'] or response['input_sha256'] != expected:
            raise HTTPException(409, {'code': 'GEOMETRY_IDENTITY_CHANGED', 'message': '几何工件与草稿输入不一致。'})
        if response['method'] != self.broker.research.pin(plugin):
            raise HTTPException(409, {'code': 'GEOMETRY_IDENTITY_CHANGED', 'message': '几何回执与封签方法版本不一致。'})
        # Preview identity and executor request hashes use different envelopes.
        # The latter includes a generated run_id which this API does not expose;
        # retain both without pretending they can be compared independently here.
        request_digest=fingerprint({'workspace':task['workspace_id'],'revision':task['workspace_revision'],
            'method':method.model_dump(),'input':document,'parameters':parameters})
        self.base(task)  # Do not accept a result built while the saved basis changed.
        artifacts = response['artifacts']; rows = []
        for kind, artifact in artifacts.items():
            if artifact.get('input_sha256') != expected:
                raise HTTPException(409, {'code': 'GEOMETRY_IDENTITY_CHANGED', 'message': '几何工件未绑定本次输入。'})
            if 'outer_diameter_m' in artifact:
                rows.append({'key': 'outer_diameter', 'entity': parameters.get('cable_type_id'),
                    'value': artifact['outer_diameter_m'], 'unit': 'm'})
        source = {'draft_id': draft['id'] if draft else None, 'input_digest': fingerprint(document),
            'input_sha256': expected, 'method': args['method'], 'host_request_digest': request_digest,
            'request_sha256': response['request_sha256']}
        refs = [{'artifact_type': kind, 'sha256': content_digest(value), 'verification': 'verified'} for kind, value in artifacts.items()]
        return ToolResult(status='ok', summary='同源几何预览已完成；未保存、未提交仿真，不具有分析网格资格。', data={
            'projection': 'draft_geometry',
            'agent_projection': {'source': source, 'quantities': rows,
                'artifact_types': list(artifacts), 'warnings': response['warnings'],
                'persisted': False, 'engineering_approval': False, 'analysis_qualification': 'not_connected',
                'mesh_copy_omitted': True, 'detail_ref': {'workspace_id': task['workspace_id'], 'draft_id': source['draft_id'],
                    'view': 'geometry-preview', 'reason': '原网格在普通几何预览服务；聊天只保留已核对量值和工件摘要。'}},
            'evidence': {'source': source, 'quantities': rows}},
            artifact_refs=refs,
            next_actions=['几何检查后可准备仿真；仿真使用领域输入，显示网格不能作为求解网格。'])

    def simulation(self, task, args):
        _, document, draft = self.document(task, args)
        method = Method.model_validate(args['method']).model_dump(mode='json')
        _, capability = self.broker.research.resolve(method)
        if capability.analysis not in ('steady_state', 'transient', 'frequency_domain') or not capability.input_contract or 'domain' not in capability.input_contract.input_sources:
            reject('SIMULATION_CAPABILITY_REQUIRED', '请选择接受领域输入的分析能力；独立网格或独立物理问题须人工准备。', '/method')
        if {'source_bundle', 'source_metadata', 'external_loss_artifact', '_artifact_reuse_sha256'} & args['parameters'].keys():
            reject('SOURCE_BINDING_REQUIRED', '来源工件只能由宿主按保存运行绑定。', '/parameters')
        from backend.domain.guards import check_locks
        state = self.base(task); check_locks(state, document, args['parameters'])
        validate_case(capability, {'input': document, 'parameters': args['parameters']})
        config = CreateStudy(expected_revision=task['workspace_revision'], title=args['title'],
            method=method, input_source='domain', parameters=args['parameters'])
        plan = {'kind': 'simulation', 'id': str(uuid4()), 'draft_id': draft['id'] if draft else None,
            'workspace_revision': task['workspace_revision'], 'input_digest': fingerprint(document),
            'definition': config.model_dump(mode='json', exclude={'expected_revision'}),
            'schema_digest': fingerprint(capability.parameter_schema.model_dump(mode='json', by_alias=True, exclude_none=True)),
            'expires': time()+3600}
        self.tasks.add_plan(task['id'], plan)
        self.tasks.emit(task['id'], 'simulation.prepared', {k: v for k, v in plan.items() if k != 'definition'})
        return ToolResult(status='ok', summary='仿真配置结构和输入锁校验通过；未执行物理预检、求解或提交超算。', data={
            'projection': 'capability_request', 'simulation_plan_id': plan['id'], 'draft_id': plan['draft_id'],
            'input_digest': plan['input_digest'], 'method': method, 'title': args['title'],
            'parameters': args['parameters'], 'executed': False, 'engineering_approval': False,
            'budget': {'status': 'requires_saved_study', 'core_hours': None,
                'reason': '批准保存研究后，从普通研究 estimate 接口读取资源预算；未建网格，不猜节点数或耗时。'}},
            next_actions=['draft_propose 携带此 simulation_plan_id，生成输入及新研究的联合审核方案。人工批准后在研究工作台预检、核对预算并提交。'])

    def propose(self, task, args):
        state, document, draft = self.document(task, args)
        plan = self.load(task, args['simulation_plan_id'], 'simulation') if args.get('simulation_plan_id') else None
        if plan and (plan['input_digest'] != fingerprint(document) or plan['draft_id'] != (draft['id'] if draft else None)):
            reject('SIMULATION_DRAFT_MISMATCH', '仿真配置必须对应同一份草稿；输入变化后须重新准备。', '/simulation_plan_id')
        changed = fingerprint(document) != fingerprint(state['domain'])
        if not changed and not plan:
            reject('DRAFT_NO_CHANGE', '没有输入变化或待保存的研究配置。')
        # Whole-document replacements are host-generated only, never model supplied.
        # Human reviewers see every changed top-level collection, including additions
        # and removals made by the ordinary template service.
        differences = review_changes(state['domain'], document, is_type(task)) if changed else []
        if plan:
            differences.append({'path': '/studies', 'label': '新建分析研究', 'before': None, 'after': plan['definition'], 'unit': None})
        identifier = str(uuid4())
        proposal = {'id': identifier, 'kind': 'draft_workflow', 'workspace_revision': task['workspace_revision'],
            'study_id': None, 'document': document, 'candidate_digest': fingerprint(document),
            'draft_id': draft['id'] if draft else None, 'simulation': plan, 'expires': time()+3600,
            'public': {'id': identifier, 'kind': 'draft_workflow', 'title': args['title'], 'changes': differences,
                'base_revision': task['workspace_revision'], **({'type_id': task['workspace_id']} if is_type(task) else {}),
                'checks': ['草稿身份、输入结构、引用和锁校验通过。',
                    '批准仅保存输入及所列研究；不批准工程结果，不预检、不运行、不发布、不提交超算。']}}
        if not fits(proposal['public'], 64*1024):
            reject('PROPOSAL_TOO_LARGE', '完整审核差异超过64KiB，请缩小草稿修改范围；未省略待批准变更。')
        self.proposals.persist(task, proposal)
        return ToolResult(status='ok', summary='草稿已转成完整审核方案，等待人批准；工程与研究均未保存。', data={'proposal': proposal['public']})
