"""A fixed resource allowlist over the existing schema-checked Platform reader."""
from fastapi import HTTPException

from .contracts import ToolResult
from .tool_registry import TEXT, object_schema


ROUTES = {
    'asset': ('/api/foundation/assets/{rid}', {'rid': 'id'}),
    'document': ('/api/documents/{did}', {'did': 'id'}),
    'document_page': ('/api/documents/{did}/pages/{page}', {'did': 'id', 'page': 'page'}),
    'document_extraction': ('/api/documents/{did}/extractions/{eid}', {'did': 'id', 'eid': 'extraction_id'}),
    'rating_table': ('/api/design/workspaces/{wid}/rating-table-runs/{rid}', {'wid': 'workspace_id', 'rid': 'run_id'}),
}
SELECTORS = frozenset({'id', 'page', 'extraction_id', 'workspace_id', 'run_id'})


def schema():
    result = object_schema({
        'kind': {'enum': list(ROUTES)},
        'id': {**TEXT, 'description': 'object_find 返回的资源或资料标识；不接受路径或URL。'},
        'page': {'type': 'integer', 'minimum': 1}, 'extraction_id': TEXT,
        'workspace_id': {'type': 'string', 'format': 'uuid'},
        'run_id': {'type': 'string', 'format': 'uuid'},
        'view': {'type': 'string', 'maxLength': 500, 'description': '返回对象内的JSON Pointer；表行用 /rows。'},
        'offset': {'type': 'integer', 'minimum': 0,
                   'description': '大于0时必须提供首段的 expected_digest；优先原样使用 next_read 续读。'},
        'limit': {'type': 'integer', 'minimum': 1, 'maximum': 20},
        'expected_digest': {'type': 'string', 'pattern': '^[a-f0-9]{64}$',
                            'description': 'offset大于0时必填，使用首段 source.response_digest；对象变化则拒绝混读。'},
    }, ['kind'])
    result['oneOf'] = [{'properties': {'kind': {'const': kind}},
                       'required': [field for field in mapping.values() if field != 'workspace_id']}
                      for kind, (_, mapping) in ROUTES.items()]
    return result


def fail(code, message, path=None):
    raise HTTPException(422, {'code': code, 'message': message, 'path': path})


def read(actions, task, arguments):
    kind = arguments['kind']
    if kind not in ROUTES:
        fail('RESOURCE_NOT_ALLOWED', '只读取明确开放的资源正文；不调用任意接口。', '/kind')
    if arguments.get('offset', 0) > 0 and not arguments.get('expected_digest'):
        fail('RESOURCE_DIGEST_REQUIRED', '续读资源正文必须绑定首段摘要。请先以 offset=0 读取首段，再按返回的 next_read 原样继续。', '/expected_digest')
    route_path, mapping = ROUTES[kind]
    extra = (set(arguments) & SELECTORS) - set(mapping.values()) - {'workspace_id'}
    if extra:
        fail('RESOURCE_ARGUMENTS_INVALID', '此资源类型不接受其他对象的标识。', '/' + sorted(extra)[0])
    values = {**arguments, 'workspace_id': arguments.get('workspace_id', task['workspace_id'])}
    if values['workspace_id'] != task['workspace_id']:
        fail('SCOPE_VIOLATION', '资源读取不能跨出此会话工作区。', '/workspace_id')
    if any(not values.get(field) for field in mapping.values()):
        fail('RESOURCE_ARGUMENTS_REQUIRED', '请提供该资源正文的完整对象标识。')
    identity = {'kind': kind, **{field: values[field] for field in mapping.values()}}
    run = None
    if kind == 'rating_table':
        run = actions.research.get_run(task['workspace_id'], values['run_id'])
        if task.get('study_id') and run['study'] != task['study_id']:
            fail('SCOPE_VIOLATION', '载流量表运行不属于此会话绑定研究。', '/run_id')
        if run.get('integrity') != 'verified':
            fail('RESOURCE_INTEGRITY_FAILED', '载流量表保存运行完整性未通过，不能作为结果。', '/run_id')
        definition = run['snapshot']['definition']
        identity.update(workspace_id=run['workspace'], study_id=run['study'], run_id=run['id'],
                        method=definition['method'], title=definition['title'],
                        **{key: run[key] for key in ('input_digest', 'output_digest', 'integrity', 'status', 'freshness')})
    platform = actions.broker.platform
    operation = next((key for key, (_, card, _) in platform.catalog().items()
                      if card['path'] == route_path and card['method'] == 'GET' and card['mode'] == 'read'), None)
    if operation is None:
        fail('RESOURCE_NOT_AVAILABLE', '当前后端没有注册此资源的只读JSON契约；请在资源工作台核对。')
    platform.discover(task, {'operation': operation})
    request = {'operation': operation, 'path_parameters': {key: values[field] for key, field in mapping.items()},
               **{key: arguments[key] for key in ('view', 'offset', 'limit') if key in arguments}}
    if kind == 'rating_table': request['query'] = {'view': 'rows'}
    result = platform.read(task, request)
    data = result.data
    if arguments.get('expected_digest') and arguments['expected_digest'] != data['source']['response_digest']:
        fail('RESOURCE_CHANGED', '资源正文已变化，请重新读取，不能拼接不同版本的分页。', '/expected_digest')
    if run is not None:
        observed = data['response']['run']
        if any(observed.get(key) != run[key] for key in ('id', 'workspace', 'study', 'input_digest', 'output_digest', 'integrity')):
            fail('RESOURCE_IDENTITY_CHANGED', '载流量表与保存运行的身份或摘要不一致。', '/run_id')
    page = data['agent_projection']['page']
    returned = {'resource': identity, 'source': data['source'], 'page': page}
    if page.get('next_offset') is not None:
        returned['next_read'] = {'tool': 'resource_read', 'arguments': {
            **arguments, 'offset': page['next_offset'], 'expected_digest': data['source']['response_digest']}}
    return ToolResult(status='ok', summary='已按原后端契约读取保存的资源正文；分页与省略项保持可见。', data=returned,
                      next_actions=['续读保留 source.response_digest；只读可见字段，不把省略内容当作已核对。'])
