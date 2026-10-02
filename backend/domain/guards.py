"""Field locks use stable domain identities; list positions are never lock identities."""
from math import hypot, pi, isclose
import re

from fastapi import HTTPException


def pointer(*parts):
    return '/' + '/'.join(str(p).replace('~', '~0').replace('/', '~1') for p in parts)


def value_at(document, path):
    """Like JSON Pointer, but array selectors are id/role/cable values, not indices."""
    if not path.startswith('/') or '//' in path or re.search(r'~(?![01])', path):
        raise ValueError('需要以 / 开头的领域字段路径')
    value = document
    for encoded in path[1:].split('/'):
        part = encoded.replace('~1', '/').replace('~0', '~')
        if isinstance(value, list):
            matches = [item for item in value if isinstance(item, dict)
                       and part in (item.get('id'), item.get('role'), item.get('cable'))]
            if len(matches) != 1:
                raise ValueError('字段路径中的对象不存在或不唯一：' + part)
            value = matches[0]
        elif isinstance(value, dict) and part in value:
            value = value[part]
        else:
            raise ValueError('领域字段不存在：' + path)
    return value


TYPE = pointer('cable_types', 'cable_type/ct1')
CORE = TYPE + pointer('cores', 'core/1', 'conductor')
SECTION = pointer('sections', 'section/s1')
CIRCUIT = pointer('circuits', 'circuit/c1')
METHOD_LOCKS = {'cable.ac_extra_factor': 'ac_extra_factor', 'cable.screen_loss_factor': 'screen_loss_factor',
                'cable.conductor': 'conductor_kind'}


def targets(document, lock):
    """Resolve legacy aliases to the exact facts produced by the v0 conversion."""
    if lock.startswith('/'):
        return [lock]
    direct = {
        'name': ['/name'], 'cable.name': [TYPE + '/label'],
        'cable.area_mm2': [CORE + '/nominal_area'],
        'cable.fill_factor': [CORE + '/nominal_area', CORE + '/diameter'],
        'cable.r20_ohm_km': [CORE + '/r20'],
        'cable.u0_kv': [TYPE + '/rating/u0'],
        'cable.frequency_hz': [CIRCUIT + '/system/frequency'],
        'cable.max_temperature_c': [TYPE + '/rating/max_conductor_temperature/normal', '/criteria/max_conductor_temperature'],
        'installation.arrangement': [SECTION + '/placements', SECTION + '/layout_template/kind'],
        'installation.depth_m': [SECTION + '/placements', SECTION + '/layout_template/depth'],
        'installation.spacing_m': [SECTION + '/placements', SECTION + '/layout_template/spacing'],
        'installation.ambient_temperature_c': [SECTION + '/medium/surface_temperature'],
        'circuit_length_m': [SECTION + '/length'],
        'operating_current_a': [pointer('load_cases', 'load/steady', 'currents', 'circuit/c1')],
        'cable.ac_extra_factor': [], 'cable.screen_loss_factor': [],
    }
    if lock in direct:
        return direct[lock]
    layers = {'conductor_screen_mm': 'conductor_screen', 'insulation_mm': 'insulation',
              'insulation_screen_mm': 'insulation_screen', 'metallic_screen_mm': 'metallic_screen', 'jacket_mm': 'oversheath'}
    field = lock.removeprefix('cable.')
    if lock.startswith('cable.') and field in layers:
        return [TYPE + pointer('common_layers', layers[field], 'thickness')]
    material_fields = {
        'cable.conductor': ([CORE + '/material'], 'label'),
        'cable.insulation_rho_k_m_w': ([TYPE + '/common_layers/insulation/material'], 'thermal_resistivity'),
        'cable.jacket_rho_k_m_w': ([TYPE + '/common_layers/oversheath/material'], 'thermal_resistivity'),
        'cable.semicon_rho_k_m_w': ([TYPE + '/common_layers/conductor_screen/material',
                                   TYPE + '/common_layers/insulation_screen/material'], 'thermal_resistivity'),
        'cable.relative_permittivity': ([TYPE + '/common_layers/insulation/material'], 'relative_permittivity'),
        'cable.tan_delta': ([TYPE + '/common_layers/insulation/material'], 'loss_tangent'),
        'installation.soil_rho_k_m_w': ([SECTION + '/medium/material'], 'thermal_resistivity'),
    }
    if lock not in material_fields:
        raise ValueError('此旧字段尚无领域锁映射，请先显式解锁：' + lock)
    references, field = material_fields[lock]
    return references + sorted({pointer('materials', value_at(document, ref), field) for ref in references})


def locked_value(document, lock, paths):
    if lock == 'cable.fill_factor':
        area, diameter = (value_at(document, p) for p in paths)
        return area / (pi * (diameter / 2) ** 2)
    if lock.startswith('installation.') and lock.rsplit('.', 1)[-1] in ('arrangement', 'depth_m', 'spacing_m'):
        points, template = (value_at(document, p) for p in paths)
        points = sorted(points, key=lambda p: p['cable'])
        if lock.endswith('depth_m'):
            geometry = sum(p['z'] for p in points) / len(points)
        else:
            distances = [(a['cable'], b['cable'], hypot(a['x'] - b['x'], a['z'] - b['z']))
                         for i, a in enumerate(points) for b in points[i + 1:]]
            if lock.endswith('arrangement'):
                scale = distances[0][2]
                geometry = [(a, b, d / scale) for a, b, d in distances]
            else:
                geometry = distances
        return [geometry, template]
    return [value_at(document, p) for p in paths]


def describe_locks(state):
    result = []
    for lock in state.get('locks', []):
        try:
            paths = targets(state['domain'], lock)
            result.append({'path': lock, 'targets': paths, 'method_parameter': METHOD_LOCKS.get(lock)})
        except ValueError as exc:
            result.append({'path': lock, 'targets': [], 'error': str(exc)})
    return result


def validate_lock(state, path):
    try:
        paths = targets(state['domain'], path)
        value = locked_value(state['domain'], path, paths)
        if path.startswith('/') and isinstance(value[0], (dict, list)):
            raise ValueError('请锁定具体字段，不锁定整个对象或集合')
    except (ValueError, KeyError, IndexError, TypeError, ZeroDivisionError) as exc:
        raise HTTPException(422, str(exc)) from None


def check_locks(state, document, parameters=None):
    original = state['domain']
    for lock in state.get('locks', []):
        try:
            paths = targets(original, lock)
            before, after = locked_value(original, lock, paths), locked_value(document, lock, paths)
            equal = isclose(before, after, rel_tol=1e-12) if lock == 'cable.fill_factor' else before == after
            parameter = METHOD_LOCKS.get(lock)
            if parameter and parameters is not None and parameter in parameters:
                saved = state['domain_conversion']['method_parameters'][parameter]
                equal = equal and parameters[parameter] == saved
            if not equal:
                raise ValueError('领域字段受保护：' + lock)
        except (ValueError, KeyError, IndexError, TypeError, ZeroDivisionError) as exc:
            raise HTTPException(422, str(exc)) from None
