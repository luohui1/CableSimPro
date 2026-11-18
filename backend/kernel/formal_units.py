"""Read declared units from frozen inputs, never from installed methods.

The host domain vocabulary is explicit. Method parameters use the parameter
schema saved in the run, including nested references and discriminated units.
No field-name suffix, schema default or display conversion supplies a value.
"""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from backend.harness.fields import domain_metadata
from .formal_contracts import is_number, resolve_pointer


def token(value: Any) -> str:
    return str(value).replace('~', '~0').replace('/', '~1')


def numeric_leaves(value: Any, path: str = ''):
    """Visit every numeric leaf, including nested lists and escaped object IDs."""
    if is_number(value):
        yield path, value
    elif isinstance(value, dict):
        for key, child in value.items():
            yield from numeric_leaves(child, path + '/' + token(key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from numeric_leaves(child, path + '/' + str(index))


def _reference(source_id, path):
    return {'source_id': source_id, 'pointer': path}


def domain_unit(document, path, source_id, root):
    """Return an explicit domain/measurement unit, or None for unknown facts."""
    parts = path[1:].split('/') if path else []
    decoded = [item.replace('~1', '/').replace('~0', '~') for item in parts]
    if not decoded or 'provenance' in decoded or 'layout_template' in decoded:
        return None
    # Measurement values carry their own declared original unit.
    if decoded[-1] == 'value':
        parent_path = '/' + '/'.join(parts[:-1]) if len(parts) > 1 else ''
        parent = resolve_pointer(document, parent_path)
        if isinstance(parent, dict) and isinstance(parent.get('unit'), str):
            return {'unit': parent['unit'], 'unit_ref': _reference(source_id, root + parent_path + '/unit'),
                    'title': parent.get('quantity') or '保存测量值'}
        return None
    try:
        metadata = domain_metadata(path)
    except HTTPException:
        return None
    unit = metadata['x-unit']['si']
    if unit is None:
        return None
    return {'unit': unit, 'unit_ref': {'contract': 'cablesim.domain/1', 'field': path},
            'title': metadata['title']}


def _matches(node, value):
    if 'const' in node and value != node['const']:
        return False
    if 'enum' in node and value not in node['enum']:
        return False
    expected = node.get('type')
    if isinstance(expected, str):
        correct = {'object': isinstance(value, dict), 'array': isinstance(value, list),
                   'number': is_number(value), 'integer': isinstance(value, int) and not isinstance(value, bool),
                   'boolean': isinstance(value, bool), 'string': isinstance(value, str), 'null': value is None}
        if expected in correct and not correct[expected]:
            return False
    if isinstance(value, dict):
        if any(key not in value for key in node.get('required', [])):
            return False
        for key, child in node.get('properties', {}).items():
            if key in value and isinstance(child, dict) and not _matches(child, value[key]):
                return False
    return True


def parameter_unit(schema, parameters, path, source_id, schema_root='/snapshot/input_contract/parameter_schema'):
    """Resolve an actual saved leaf against a frozen (possibly normalized) schema.

    Both the normalized top-level ``unit`` and nested JSON Schema ``x-unit``
    forms occur in saved contracts. A union must select one compatible branch,
    or all compatible branches must declare the same unit; ambiguity is kept
    in the source archive rather than guessed.
    """
    parts = [part.replace('~1', '/').replace('~0', '~') for part in path[1:].split('/')] if path else []

    def declared(node, location, parent):
        selector_key = 'unit_cases' if node.get('unit_cases') else 'x-unit-by'
        choices = node.get(selector_key)
        if isinstance(choices, dict):
            selector = choices.get('selector')
            selected = parent.get(selector) if isinstance(parent, dict) else None
            unit = choices.get('cases', {}).get(selected)
            if not isinstance(unit, dict) or not isinstance(unit.get('si'), str):
                return None
            return {'unit': unit['si'], 'unit_ref': _reference(source_id,
                    schema_root + location + '/' + selector_key + '/cases/' + token(selected) + '/si'),
                    'title': node.get('title')}
        key = 'unit' if isinstance(node.get('unit'), dict) else 'x-unit'
        unit = node.get(key)
        if not isinstance(unit, dict) or not isinstance(unit.get('si'), str):
            return None
        runtime_unit = node.get('runtime_unit')
        if isinstance(runtime_unit, str):
            return {'unit': runtime_unit,
                    'unit_ref': _reference(source_id, schema_root + location + '/runtime_unit'),
                    'title': node.get('title')}
        return {'unit': unit['si'], 'unit_ref': _reference(source_id, schema_root + location + '/' + key + '/si'),
                'title': node.get('title')}

    def visit(node, location, remaining, value, parent, seen):
        if not isinstance(node, dict) or len(seen) > 40:
            return []
        identity = (location, tuple(remaining))
        if identity in seen:
            return []
        seen = {*seen, identity}
        if not remaining:
            found = declared(node, location, parent)
            if found:
                return [found]
        ref = node.get('$ref')
        if ref:
            if not isinstance(ref, str) or not ref.startswith('#/'):
                return []
            target = ref[1:]
            # Normalized manifests retain original #/$defs references while
            # serializing the dictionary under definitions.
            if target.startswith('/$defs/') and '$defs' not in schema and 'definitions' in schema:
                target = '/definitions/' + target[len('/$defs/'):]
            try:
                resolved = resolve_pointer(schema, target)
            except (KeyError, IndexError, TypeError, ValueError):
                return []
            return visit(resolved, target, remaining, value, parent, seen)
        for union in ('oneOf', 'anyOf'):
            if union in node:
                answers = []
                for index, branch in enumerate(node[union]):
                    if isinstance(branch, dict) and _matches(branch, value):
                        answers.extend(visit(branch, location + '/' + union + '/' + str(index),
                                             remaining, value, parent, seen))
                return answers
        if not remaining:
            return []
        key, *tail = remaining
        try:
            if isinstance(value, list):
                index = int(key)
                if 'prefixItems' in node:
                    child = node['prefixItems'][index]
                    child_path = location + '/prefixItems/' + str(index)
                else:
                    child, child_path = node.get('items', {}), location + '/items'
                return visit(child, child_path, tail, value[index], value, seen)
            if isinstance(value, dict) and key in value:
                if key in node.get('properties', {}):
                    child, child_path = node['properties'][key], location + '/properties/' + token(key)
                else:
                    child, child_path = node.get('additionalProperties', {}), location + '/additionalProperties'
                return visit(child, child_path, tail, value[key], value, seen)
        except (KeyError, IndexError, ValueError, TypeError):
            return []
        return []

    results = visit(schema, '', parts, parameters, None, set())
    if not results or len({item['unit'] for item in results}) != 1:
        return None
    return results[0]
