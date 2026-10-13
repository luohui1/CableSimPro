"""Discover the actual host API; bounded local reads, explicit human handoffs.

API discovery does not grant execution authority. No model-supplied URL, header,
credential or endpoint can enter the transport. Mutations never enter it.
"""
import asyncio
from copy import deepcopy
from hashlib import sha256
import json
import re
from threading import RLock
from time import time
from urllib.parse import quote, urlencode

from fastapi import HTTPException
from fastapi.openapi.utils import get_openapi
from fastapi.routing import APIRoute
from jsonschema import Draft202012Validator, FormatChecker
from starlette.routing import Match

from backend.kernel.workspace import fingerprint
from .context_builder import encoded, fits
from .contracts import ToolResult
from .security import redact
from .session_scope import is_type


READ_BYTES = 1024 * 1024
SCHEMA_FIELDS = frozenset({'schema', 'input_schema', 'output_schema', 'parameters_schema',
                          'parameter_schema', 'request_schema', 'components'})


def evidence_view(research, value):
    """Reuse run qualification; API contracts are never engineering evidence."""
    if isinstance(value, list):
        return [evidence_view(research, item) for item in value]
    if not isinstance(value, dict):
        return value
    if 'integrity' in value and value['integrity'] != 'verified':
        return {'integrity': value['integrity'], 'run_id': value.get('id') or value.get('run_id')}
    if {'snapshot', 'output', 'integrity', 'study', 'id'} <= value.keys():
        from .evidence import run_points
        return run_points(research, value, all_quantities=True)
    return {key: evidence_view(research, child) for key, child in value.items() if key not in SCHEMA_FIELDS}


class OutputRejected(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def fail(code, message, path=None):
    raise HTTPException(422, {'code': code, 'message': message, 'path': path})


def pointer(value, path):
    if not path: return value
    if not path.startswith('/'): fail('PLATFORM_VIEW_INVALID', 'view须为返回对象内的JSON Pointer。', '/view')
    try:
        for token in path[1:].split('/'):
            token = token.replace('~1', '/').replace('~0', '~')
            value = value[int(token)] if isinstance(value, list) and token.isdigit() else value[token]
        return value
    except (KeyError, IndexError, TypeError, ValueError):
        fail('PLATFORM_VIEW_INVALID', '所选字段不存在；按返回的children路径继续读取。', '/view')


def page(value, view='', offset=0, limit=10, budget=4000):
    selected = pointer(value, view)
    if fits(selected, budget) and not offset:
        return {'view': view, 'value': selected, 'complete': True}
    if not isinstance(selected, (dict, list)):
        return {'view': view, 'omitted': True, 'complete': False,
                'reason': '单个值超出上下文上限；未截断正文，请在该平台对象的家查看全文。'}
    pairs = list(selected.items()) if isinstance(selected, dict) else list(enumerate(selected))
    items = []
    for key, child in pairs[offset:offset + limit]:
        path = view + '/' + str(key).replace('~', '~0').replace('/', '~1')
        row = {'path': path, 'value': child}
        if not fits(row, budget // 2):
            row = {'path': path, 'omitted': True, 'type': type(child).__name__,
                   'reason': '完整条目未展开；使用此path作为view继续读，长文本在对象的家查看。'}
            if isinstance(child, (dict, list)):
                keys = list(child) if isinstance(child, dict) else list(range(len(child)))
                row['children'] = [path + '/' + str(k).replace('~', '~0').replace('/', '~1') for k in keys[:12]]
                row['total_children'] = len(keys)
        if not fits(items + [row], budget): break
        items.append(row)
    end = offset + len(items)
    return {'view': view, 'items': items, 'total': len(pairs), 'offset': offset,
            'next_offset': end if end < len(pairs) else None, 'complete': end == len(pairs) and not offset
            and not any(row.get('omitted') for row in items)}


class Platform:
    def __init__(self, research, tasks, registry):
        self.research, self.tasks, self.registry = research, tasks, registry
        self.app = None
        self.lock = RLock()
        self.signature = None
        self.operations = {}
        self.schemas = {}

    def bind(self, app):
        self.app = app

    def catalog(self):
        if self.app is None: fail('PLATFORM_UNAVAILABLE', '平台能力入口尚未绑定宿主。')
        routes = [r for r in self.app.routes if isinstance(r, APIRoute) and r.include_in_schema
                  and r.path.startswith('/api/') and not r.deprecated]
        signature = tuple((id(r), r.path, tuple(sorted(r.methods)),fingerprint(r.openapi_extra or {})) for r in routes)
        with self.lock:
            if signature != self.signature:
                self.operations = {}
                self.schemas = {}
                for route in routes:
                    for method in sorted(route.methods):
                        identifier = route.unique_id if len(route.methods) == 1 else route.unique_id + '_' + method.lower()
                        if identifier in self.operations: raise RuntimeError('duplicate platform operation identity')
                        module = (route.tags or [route.path.split('/')[2]])[0]
                        sensitive = route.path.startswith(('/api/agent/', '/api/database/'))
                        binary = any(media != 'application/json' for response in route.responses.values()
                                     for media in response.get('content', {}))
                        binary = binary or any(route.path.endswith(suffix) for suffix in ('/file', '/image', '.png', '/full'))
                        binary = binary or '/fields/' in route.path  # Display meshes also contain large arrays.
                        executes = route.path.endswith('/preflight') and '/studies/' in route.path
                        # This existing host router admits only manifest-declared
                        # read_only capabilities and authenticates the exact seal.
                        # A tag, arbitrary POST, or model instruction grants no access.
                        query_read=(method=='POST' and route.path=='/api/plugin-queries/{plugin_id}/{capability_id}'
                            and route.endpoint.__module__=='backend.plugin_host.query_router')
                        mode = 'human' if sensitive or (method != 'GET' and not query_read) or executes else 'reference' if binary else 'read'
                        if mode != 'human' and (route.openapi_extra or {}).get('x-agent-access') in ('human','reference'):
                            mode=route.openapi_extra['x-agent-access']
                        reason = ('系统管理与Agent控制由人操作，不能经通用入口取得凭据或审批权。' if sensitive else
                                  '写入、执行、批准、发布及外发由人通过普通平台入口确认。' if mode == 'human' else
                                  '工件正文在对象的家读取；此入口仅准备保存工件引用，不加载大场数组或二进制文件。' if mode == 'reference' else
                                  '只读调用现有JSON接口，沿用其业务校验。')
                        card = {'id': identifier, 'module': str(module), 'name': route.summary or route.name,
                                'method': method, 'path': route.path, 'mode': mode, 'reason': reason}
                        self.operations[identifier] = (route, card, sensitive)
                self.signature = signature
            return self.operations

    def operation(self, identifier):
        value = self.catalog().get(identifier)
        if value is None: fail('PLATFORM_OPERATION_UNKNOWN', '请选择能力目录返回的准确operation，不提供URL。', '/operation')
        return value

    def schema(self, identifier):
        route, card, sensitive = self.operation(identifier)
        if sensitive: fail('PLATFORM_OPERATION_RESTRICTED', card['reason'], '/operation')
        with self.lock:
            if identifier not in self.schemas:
                document = get_openapi(title='Platform operation', version='1', routes=[route])
                operation = document['paths'][route.path][card['method'].lower()]
                properties = {'path_parameters': {'type': 'object', 'properties': {}, 'additionalProperties': False},
                              'query': {'type': 'object', 'properties': {}, 'additionalProperties': False}}
                for parameter in operation.get('parameters', []):
                    if parameter['in'] not in ('path', 'query'):
                        fail('PLATFORM_AUTH_REQUIRED', '此接口需要宿主身份或请求头，由人在普通入口操作。', '/operation')
                    target = properties['path_parameters' if parameter['in'] == 'path' else 'query']
                    target['properties'][parameter['name']] = parameter['schema']
                    if parameter.get('required'): target.setdefault('required', []).append(parameter['name'])
                required = ['path_parameters'] if properties['path_parameters'].get('required') else []
                if properties['query'].get('required'): required.append('query')
                body = operation.get('requestBody')
                if body:
                    content = body.get('content', {})
                    if 'application/json' in content:
                        properties['body'] = content['application/json']['schema']
                        if body.get('required'): required.append('body')
                    else: fail('PLATFORM_UPLOAD_REQUIRED', '此接口需要原始文件；由人在资料或资源入口上传，不接受模型编造文件。', '/body')
                request = {'type': 'object', 'properties': properties, 'required': required, 'additionalProperties': False,
                           'components': document.get('components', {})}
                self.schemas[identifier] = {'operation': card, 'request_schema': request,
                    'responses': operation.get('responses', {}), 'description': operation.get('description', ''),
                    'contract_digest': fingerprint({'request': request, 'responses': operation.get('responses', {})})}
            return deepcopy(self.schemas[identifier])

    def discover(self, task, arguments):
        if arguments.get('tool'):
            tool=self.registry.visible(self.tasks.record(task['id'],model_context=True)).get(arguments['tool'])
            if not tool or tool.plugin_id:fail('TOOL_INSPECTION_REQUIRED', '宿主工具须在本会话可见；插件能力用plugin_inspect检查并启用。', '/tool')
            return ToolResult(status='ok',summary='宿主工具完整参数与权限契约，不是工程证据。',data={
                'projection':'capability_contract','tool':tool.info(),
                'schema':page(tool.model(),arguments.get('schema_path',''),arguments.get('offset',0),arguments.get('limit',10))})
        if arguments.get('operation'):
            schema = self.schema(arguments['operation'])
            self.tasks.emit(task['id'], 'platform.inspected', {'operation': arguments['operation'],
                            'contract_digest': schema['contract_digest'], 'turn_id': task['active_turn']})
            data = {'projection': 'capability_contract', 'operation': schema['operation'],
                    'contract_digest': schema['contract_digest'],
                    'schema': page(schema, arguments.get('schema_path', ''), arguments.get('offset', 0), arguments.get('limit', 10))}
        else:
            cards = [card for _, card, _ in self.catalog().values()]
            modules = {name: sum(c['module'] == name for c in cards) for name in sorted({c['module'] for c in cards})}
            selected = [c for c in cards if (not arguments.get('module') or arguments['module'] == c['module'])
                        and (not arguments.get('q') or arguments['q'].casefold() in encoded(c).decode().casefold())]
            offset = arguments.get('offset', 0)
            items = []
            for card in selected[offset:offset + arguments.get('limit', 10)]:
                if not fits({'items': items + [card], 'modules': modules}, 5000): break
                items.append(card)
            data = {'projection': 'capability_catalog', 'items': items, 'modules': modules, 'total': len(selected),
                    'platform_total': len(cards), 'next_offset': offset + len(items) if offset + len(items) < len(selected) else None}
        return ToolResult(status='ok', summary='实际宿主能力契约；目录与参数不是工程结果证据。', data=data,
                          next_actions=['按operation按需检查契约；read可读取，其他模式先准备人工执行请求。'])

    def validate(self, task, arguments):
        identifier = arguments['operation']
        route, card, _ = self.operation(identifier)
        schema = self.schema(identifier)
        record = self.tasks.record(task['id'],model_context=True)
        if not any(row['type'] == 'platform.inspected' and row['data']['operation'] == identifier
                   and row['data']['contract_digest'] == schema['contract_digest'] for row in record['events']):
            fail('PLATFORM_INSPECTION_REQUIRED', '先用platform_capabilities(operation)读取当前参数契约。', '/operation')
        supplied = {key: arguments[key] for key in ('path_parameters', 'query', 'body') if key in arguments}
        errors = list(Draft202012Validator(schema['request_schema'], format_checker=FormatChecker()).iter_errors(supplied))
        if errors:
            error = errors[0]
            path = '/' + '/'.join(str(k) for k in error.absolute_path)
            if error.validator == 'required': path += '/' + next(k for k in error.validator_value if k not in error.instance)
            fail('PLATFORM_ARGUMENTS_INVALID', '参数不符合平台契约：' + error.message, path)
        params = supplied.get('path_parameters', {})
        scoped = [(section, key, value) for section in ('path_parameters', 'query')
                  for key, value in supplied.get(section, {}).items()
                  if key in ('wid', 'workspace_id', 'workspace') and value is not None]
        for section, key, wid in scoped:
            if str(wid) != task['workspace_id']:
                fail('SCOPE_VIOLATION', '此操作对象不在会话工作区；请在目标工作区建立会话。', '/'+section+'/'+key)
        if is_type(task) and any(segment in route.path.split('/') for segment in ('studies', 'datasets', 'convergence', 'step-responses')):
            fail('TYPE_TOOL_NOT_APPLICABLE', '研究操作须在工程或研究会话使用。', '/operation')
        if scoped:
            with self.research.store.db() as db:
                current, _ = self.research.store.load(db, task['workspace_id'], allow_domain=True)
            if current['revision'] != task['workspace_revision']:
                fail('PLATFORM_CONTEXT_CHANGED', '工作区修订已变化；重新建立会话或在人工批准后采用新修订。', '/path_parameters')
        return route, card, supplied, schema['contract_digest']

    def prepare(self, task, arguments):
        _, card, supplied, digest = self.validate(task, arguments)
        if not fits(supplied, 4 * 1024): fail('PLATFORM_REQUEST_TOO_LARGE', '人工请求参数限4KiB，不复制工件、来源正文或整场数组。', '/body')
        request = {'operation': card, 'arguments': redact(supplied), 'contract_digest': digest,
                   'workspace_revision': task['workspace_revision'], 'executed': False, 'human_confirmation_required': True,
                   'business_validation': 'pending', 'approval_granted': False}
        self.tasks.emit(task['id'], 'platform.action.prepared', {'turn_id': task['active_turn'], **request})
        return ToolResult(status='ok', summary='平台请求参数已准备；未执行、未保存、未批准。',
                          data={'projection': 'capability_request', 'request': request},
                          next_actions=[f'由人在{card["module"]}对象的家核对参数并执行对应操作；普通入口再次校验修订、锁、来源及适用性。'])

    def read(self, task, arguments):
        _, card, _ = self.operation(arguments['operation'])
        if card['mode'] != 'read': fail('HUMAN_EXECUTION_REQUIRED', card['reason'], '/operation')
        route, card, supplied, digest = self.validate(task, arguments)
        params = supplied.get('path_parameters', {})
        path = route.path
        for name in route.param_convertors:
            value = str(params[name])
            if any(token in value for token in ('..', '/', '\\', '?', '#', '%')):
                fail('PLATFORM_PATH_INVALID', '路径参数只能是目录对象的准确标识，不接受路径或URL。', '/path_parameters/' + name)
            path = re.sub(r'\{' + re.escape(name) + r'(?::[^}]+)?\}', lambda _: value, path)
        query = supplied.get('query', {})
        pairs = [(key, 'true' if value is True else 'false' if value is False else value)
                 for key, values in query.items() for value in (values if isinstance(values, list) else [values]) if value is not None]
        body=encoded(supplied['body']) if 'body' in supplied else b''
        headers=[(b'host',b'127.0.0.1')]
        if body:headers.extend([(b'content-type',b'application/json'),(b'content-length',str(len(body)).encode())])
        scope = {'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1', 'method': card['method'],
                 'scheme': 'http', 'path': path, 'raw_path': quote(path, safe='/').encode(),
                 'query_string': urlencode(pairs).encode(), 'headers': headers,
                 'client': ('127.0.0.1', 0), 'server': ('127.0.0.1', 80), 'app': self.app}
        actual = next((r for r in self.app.routes if r.matches(scope)[0] == Match.FULL), None)
        if actual is not route: fail('PLATFORM_PATH_INVALID', '参数没有定位到所选能力，未调用其他接口。', '/path_parameters')
        timeout=min(task['limits'].get('platform_read_timeout_s',8),
                    (task['limits']['max_active_ms']-task['elapsed_ms'])/1000,task['deadline']-time())
        status, payload = asyncio.run(self.fetch(scope, timeout,body))
        if status >= 400:
            detail = payload.get('detail', payload) if isinstance(payload, dict) else payload
            code = detail.get('code', 'PLATFORM_READ_FAILED') if isinstance(detail, dict) else 'PLATFORM_READ_FAILED'
            fail(code, str(detail), '/operation')
        # Never present mutable current inputs as the session's pinned inputs.
        if any(key in group for group in (params, query) for key in ('wid','workspace_id','workspace')):
            self.validate(task, arguments)
        source = {'operation': card['id'], 'contract_digest': digest, 'response_digest': fingerprint(payload),
                  'workspace_id': task['workspace_id'], 'workspace_revision': task['workspace_revision'], 'read_only': True}
        model_view = {'projection': 'platform_read', 'source': source,
                      'page': page(payload, arguments.get('view', ''), arguments.get('offset', 0), arguments.get('limit', 10))}
        return ToolResult(status='ok', summary='已通过实际平台接口读取；数值仅引用返回的保存数据。',
                          data={'projection': 'platform_read', 'source': source, 'response': payload,
                                'evidence': evidence_view(self.research, payload), 'agent_projection': model_view},
                          next_actions=['page未完整时，保持operation与请求参数，用view/offset继续读取。'])

    def query(self,task,arguments):
        plugin=self.research.registry(arguments['plugin_id']).get(arguments['plugin_id'])
        plugin.verify()
        try:capability=plugin.manifest.capability(arguments['capability'])
        except KeyError:fail('CAPABILITY_UNKNOWN','没有此安装能力。','/capability')
        if not capability.read_only or (hasattr(self.research.executor,'required') and
                self.research.executor.required(plugin.manifest.id,capability.id)):
            fail('QUERY_NOT_READ_ONLY','此能力不是本机只读依据查询，请使用正式运行及人工确认流程。','/capability')
        method={**self.research.pin(plugin),'capability':capability.id}
        if 'input' not in arguments:
            contract=capability.input_contract
            input_schema=(contract.standalone_schema.model_dump(mode='json',by_alias=True,exclude_none=True)
                if contract and contract.standalone_schema else None)
            if input_schema is None:
                candidates=[]
                for sealed in plugin.manifest.files:
                    if not sealed.path.endswith('.json') or sealed.size_bytes>READ_BYTES:continue
                    raw=(plugin.directory/sealed.path).read_bytes()
                    if len(raw)!=sealed.size_bytes or sha256(raw).hexdigest()!=sealed.sha256:
                        fail('QUERY_CONTRACT_CHANGED','查询契约文件已变化，请重新核对插件发行。','/capability')
                    try:value=json.loads(raw)
                    except (ValueError,UnicodeDecodeError):continue
                    if isinstance(value,dict) and value.get('$id')==capability.input_schema:
                        candidates.append(value)
                if len(candidates)!=1:
                    fail('QUERY_CONTRACT_UNAVAILABLE','安装插件未提供唯一的封签查询契约，请在依据页查看；不能把schema标识当作参数定义。','/capability')
                input_schema=candidates[0]
            return ToolResult(status='ok',summary='已核对只读依据查询契约；尚未查询，不把默认值当作证据。',data={
                'projection':'capability_contract','method':method,'read_only':True,
                'schema':page(input_schema,arguments.get('view',''),
                    arguments.get('offset',0),arguments.get('limit',10)),
                'next_action':'按完整查询契约带input再次调用plugin_query；长结果按view/offset续读。'})
        identifier=next((identifier for identifier,(route,card,_) in self.catalog().items()
            if card['mode']=='read' and route.path=='/api/plugin-queries/{plugin_id}/{capability_id}'),None)
        if identifier is None:fail('PLATFORM_UNAVAILABLE','宿主只读查询入口尚未注册。','/capability')
        schema=self.schema(identifier)
        self.tasks.emit(task['id'],'platform.inspected',{'operation':identifier,
            'contract_digest':schema['contract_digest'],'turn_id':task['active_turn']})
        return self.read(task,{'operation':identifier,'path_parameters':{
            'plugin_id':plugin.manifest.id,'capability_id':capability.id},
            'body':{'release_digest':method['release_digest'],'input':arguments['input']},
            **{key:arguments[key] for key in ('view','offset','limit') if key in arguments}})

    async def fetch(self, scope, timeout,body=b''):
        chunks, size, status, content_type = [], 0, 0, ''
        done = asyncio.Event()
        received = False

        async def receive():
            nonlocal received
            if not received:
                received = True
                return {'type': 'http.request', 'body': body, 'more_body': False}
            await done.wait()
            return {'type': 'http.disconnect'}

        async def send(message):
            nonlocal size, status, content_type
            if message['type'] == 'http.response.start':
                status = message['status']
                content_type = dict(message.get('headers', [])).get(b'content-type', b'').decode()
                if 'application/json' not in content_type:
                    raise OutputRejected('PLATFORM_NON_JSON', '此能力返回文件或流，请在对象的家读取；未作为数值证据。')
            elif message['type'] == 'http.response.body':
                body = message.get('body', b'')
                size += len(body)
                if size > READ_BYTES: raise OutputRejected('PLATFORM_RESULT_TOO_LARGE', '返回超过1MiB；请使用平台查询参数缩小范围，不读取整场工件。')
                chunks.append(body)
                if not message.get('more_body'): done.set()
        try:
            await asyncio.wait_for(self.app(scope, receive, send), timeout=max(.001, timeout))
        except asyncio.TimeoutError:
            fail('PLATFORM_READ_TIMEOUT', '平台读取超时，未执行计算或生成替代结果。', '/operation')
        except OutputRejected as error:
            fail(error.code, error.message, '/operation')
        try: return status, json.loads(b''.join(chunks))
        except (ValueError, UnicodeDecodeError): fail('PLATFORM_RESPONSE_INVALID', '平台未返回合法JSON，不能作为证据。', '/operation')
