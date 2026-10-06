"""Reviewed SI/public-to-kernel adapters, driven only by sealed schema metadata.

Historical explicit field aliases can be adopted into new SI study versions. No
field suffix, magnitude, user-provided transform or physical default is guessed.
"""
from copy import deepcopy
from hashlib import sha256
import json


def translate(schema, value, *, to_runtime=False):
    definitions = schema.get('$defs', {})

    def convert(node, item):
        if item is None:
            return None
        if '$ref' in node:
            node = {**definitions[node['$ref'][8:]], **{key: val for key, val in node.items() if key != '$ref'}}
        for branch in node.get('anyOf', []):
            if '$ref' in branch or branch.get('type') == ('object' if isinstance(item, dict) else 'array' if isinstance(item, list) else 'number' if isinstance(item, (int, float)) else 'string'):
                node = {**node, **branch}
                if '$ref' in node:
                    node = {**definitions[node['$ref'][8:]], **{key: val for key, val in node.items() if key != '$ref'}}
                break
        if isinstance(item, dict):
            result = {}
            handled = set()
            for public_key, prop in node.get('properties', {}).items():
                runtime = prop.get('x-runtime') or {}
                legacy_key = runtime.get('key', public_key)
                if public_key != legacy_key and public_key in item and legacy_key in item:
                    raise ValueError(f'{public_key}：SI 字段与旧单位字段不能同时出现')
                source_key = public_key if public_key in item else legacy_key
                if source_key not in item:
                    continue
                current = convert(prop, item[source_key])
                # Explicit old-unit aliases are first normalized to SI. Public
                # fields already carry SI; this is not a magnitude heuristic.
                if source_key == legacy_key and legacy_key != public_key and runtime:
                    current = affine(current, 1 / runtime.get('scale', 1), -runtime.get('offset', 0) / runtime.get('scale', 1))
                if to_runtime and runtime:
                    current = affine(current, runtime.get('scale', 1), runtime.get('offset', 0))
                result[legacy_key if to_runtime else public_key] = current
                handled.add(source_key)
            additional = node.get('additionalProperties')
            for key, val in item.items():
                if key not in handled:
                    result[key] = convert(additional, val) if isinstance(additional, dict) else deepcopy(val)
            return result
        if isinstance(item, (list, tuple)):
            if isinstance(node.get('items'), dict):
                return [convert(node['items'], val) for val in item]
            if node.get('prefixItems'):
                return [convert(node['prefixItems'][index], val) if index < len(node['prefixItems']) else deepcopy(val)
                        for index, val in enumerate(item)]
        return deepcopy(item)

    return convert(schema, value)


def affine(value, scale, offset):
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return [affine(item, scale, offset) for item in value]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    return value * scale + offset


def decode_request(request, manifest_path):
    manifest = json.loads(manifest_path.read_text('utf-8'))
    capability = next(value for value in manifest['capabilities'] if value['id'] == request['capability'])
    params = capability.get('parameter_schema')
    contract=capability.get('input_contract') or {}
    inputs = contract.get('standalone_schema')
    result = deepcopy(request)
    for case in result['cases']:
        original = case['input']
        from .reproduction import digest
        case['_source_input_sha256'] = digest(original)
        case['_source_parameters'] = deepcopy(case.get('parameters', {}))
        if inputs and original.get('schema_version') != 'cablesim.domain/1':
            case['input'] = translate(inputs, original, to_runtime=True)
        if params:
            selected=contract.get('standalone_parameter_schema') if original.get('schema_version')!='cablesim.domain/1' else None
            case['parameters'] = translate(selected or params, case.get('parameters', {}), to_runtime=True)
    return result
