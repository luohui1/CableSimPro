"""Read-only result pages for the external Agent, after the ordinary broker.

The saved tool/audit result is complete. A model can ask the same authorized
read for a small JSON-pointer page; it cannot use pagination to replay a write,
change its scope, skip validation, or splice different source revisions.
"""
from copy import deepcopy
import re

from fastapi import HTTPException

from backend.kernel.workspace import fingerprint
from .platform import page


PAGE_FIELDS = {
    'result_view': {'type': 'string', 'maxLength': 500,
                    'description': '仅按需读结果 data 内的 JSON Pointer；空串读目录。'},
    'result_offset': {'type': 'integer', 'minimum': 0, 'maximum': 100000},
    'result_digest': {'type': 'string', 'pattern': '^[a-f0-9]{64}$'},
}


def parameters(tool, schema):
    if tool.kind != 'read':
        return schema
    value = deepcopy(schema)
    value['properties'].update(deepcopy(PAGE_FIELDS))
    return value


def split(tool, arguments):
    # Do not strip these fields from proposals: their normal strict broker
    # contract rejects them before any proposal or business write is prepared.
    if tool.kind != 'read' or not any(key in arguments for key in PAGE_FIELDS):
        return arguments, None
    value = {key: arguments[key] for key in PAGE_FIELDS if key in arguments}
    view, offset, digest = value.get('result_view'), value.get('result_offset', 0), value.get('result_digest')
    if (not isinstance(view, str) or len(view) > 500 or (view and not view.startswith('/'))
            or type(offset) is not int or not 0 <= offset <= 100000
            or (digest is not None and (not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest)))
            or (offset and not digest)):
        raise HTTPException(422, {'code': 'RESULT_PAGE_INVALID',
            'message': '结果分页须指定结果内的路径；续页必须原样携带首段摘要。'})
    return {key: child for key, child in arguments.items() if key not in PAGE_FIELDS}, value


def project(tool, arguments, result, selection):
    if result.get('status') != 'ok':
        return result
    digest = fingerprint(result['data'])
    if selection is None:
        return {**result, 'result_digest': digest}
    if selection.get('result_digest') not in (None, digest):
        raise HTTPException(409, {'code': 'RESULT_CHANGED',
            'message': '读取来源已变化，不能拼接不同版本；请重新读取摘要。'})
    selected = page(result['data'], selection['result_view'], selection.get('result_offset', 0), 10, budget=2400)
    next_read = None
    if selected.get('next_offset') is not None:
        next_read = {'tool': tool.name, 'arguments': {**arguments, **selection,
            'result_offset': selected['next_offset'], 'result_digest': digest}}
    return {**result, 'result_digest': digest, 'data': {
        'projection': 'result_page', 'source': {'response_digest': digest}, 'page': selected,
        **({'next_read': next_read} if next_read else {})}}
