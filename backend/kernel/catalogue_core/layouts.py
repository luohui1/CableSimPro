"""Laying-section templates: positions only, no thermal or electrical assumption.

Carried over from the CableSimPro section templates. A template places the cables of
one cable type at explicit coordinates (x to the right, z upward, ground surface z = 0);
the engineer's depth, spacing and duct sizes are inputs, never silently adjusted.
"""
from math import sqrt

from . import CoreError

SINGLE_CORE = {
    'trefoil': {'label': '直埋 · 品字形', 'circuits': 1, 'ducted': False},
    'flat': {'label': '直埋 · 水平', 'circuits': 1, 'ducted': False},
    'ducts': {'label': '排管 · 品字形', 'circuits': 1, 'ducted': True},
    'backfill': {'label': '矩形回填 · 留间隔品字形', 'circuits': 1, 'ducted': False},
    'double_trefoil': {'label': '直埋双回 · 留间隔品字形', 'circuits': 2, 'ducted': False},
    'double_flat': {'label': '直埋双回 · 水平', 'circuits': 2, 'ducted': False},
    'ducts_2x3': {'label': '排管 · 2×3', 'circuits': 2, 'ducted': True},
    'ducts_3x3': {'label': '排管 · 3×3', 'circuits': 3, 'ducted': True},
    'duct_bank': {'label': '包封排管 · 3×3', 'circuits': 3, 'ducted': True},
}
THREE_CORE = {
    'three_core_buried_single': {'label': '三芯直埋 · 单回', 'circuits': 1, 'ducted': False},
    'three_core_buried_horizontal': {'label': '三芯直埋 · 三回水平', 'circuits': 3, 'ducted': False},
    'three_core_ducts_horizontal': {'label': '三芯排管 · 三回水平', 'circuits': 3, 'ducted': True},
    'three_core_ducts_2x3': {'label': '三芯排管 · 2×3', 'circuits': 6, 'ducted': True},
    'three_core_ducts_3x3': {'label': '三芯排管 · 3×3', 'circuits': 9, 'ducted': True},
}
LAYOUTS = {**SINGLE_CORE, **THREE_CORE}
PHASES = ('A', 'B', 'C')


def options(construction):
    table = THREE_CORE if construction == 'three_core' else SINGLE_CORE
    return [{'kind': kind, **item} for kind, item in table.items()]


def default_duct(kind):
    """Template duct sizes (inner, outer) in m; shown to the engineer as editable inputs."""
    if kind == 'ducts':
        return {'inner_diameter_m': .064, 'outer_diameter_m': .075}
    if LAYOUTS[kind]['ducted']:
        return {'inner_diameter_m': .14, 'outer_diameter_m': .16}
    return None


def default_spacing(kind, diameter):
    """Centre spacing in m used when the engineer has not set one."""
    if kind in ('flat', 'double_trefoil', 'double_flat', 'backfill'):
        return max(.15, diameter * 1.5)
    if kind in ('ducts_2x3', 'ducts_3x3', 'duct_bank'):
        return max(.25, diameter)
    if kind in THREE_CORE:
        return max(.25, 1.5 * diameter)
    return None  # touching: spacing is the cable or duct diameter


def place(kind, diameter, depth, spacing=None, duct=None):
    """Circuits with cable positions, the ducts that hold them and the template record."""
    if kind not in LAYOUTS:
        raise CoreError('LAYOUT_UNKNOWN', f'未知的敷设方式：{kind}', '/installation/layout')
    if not depth or depth <= 0:
        raise CoreError('LAYOUT_INVALID', '中心埋深必须为正，单位 m。', '/installation/depth_m')
    if spacing is not None and spacing <= 0:
        raise CoreError('LAYOUT_INVALID', '中心距必须为正，单位 m。', '/installation/spacing_m')
    template = LAYOUTS[kind]
    duct = duct or default_duct(kind) if template['ducted'] else None
    if duct:
        inner, outer = duct['inner_diameter_m'], duct['outer_diameter_m']
        if not 0 < inner < outer:
            raise CoreError('LAYOUT_INVALID', '管内径须为正且小于管外径，单位 m。', '/installation/duct/inner_diameter_m')
        if diameter >= inner:
            raise CoreError('LAYOUT_INVALID', f'电缆外径 {diameter * 1000:.1f} mm 放不进内径 {inner * 1000:g} mm 的管，请加大管径。',
                            '/installation/duct/inner_diameter_m')
    if kind in THREE_CORE:
        return _three_core(kind, diameter, depth, spacing, duct)
    touching = duct['outer_diameter_m'] if duct else diameter
    if kind == 'ducts':
        if spacing is not None and abs(spacing - touching) > 1e-9:
            raise CoreError('LAYOUT_INVALID', '品字形排管按管与管相切布置，中心距等于管外径，不能另设。', '/installation/spacing_m')
        spacing = touching
    else:
        if spacing is None:
            spacing = default_spacing(kind, diameter) or touching
        if spacing < touching - 1e-12:
            raise CoreError('LAYOUT_INVALID', f'中心距 {spacing * 1000:g} mm 小于{"管" if duct else "电缆"}外径 {touching * 1000:.1f} mm。',
                            '/installation/spacing_m')
    count = template['circuits']
    rows = kind in ('ducts_2x3', 'ducts_3x3', 'duct_bank')
    flat = kind in ('flat', 'double_flat') or rows
    base = [(-spacing, -depth), (0.0, -depth), (spacing, -depth)] if flat else [
        (0.0, -depth + sqrt(3) * spacing / 3), (-spacing / 2, -depth - sqrt(3) * spacing / 6),
        (spacing / 2, -depth - sqrt(3) * spacing / 6)]
    circuits, ducts = [], []
    for ci in range(count):
        shift = (ci - .5) * max(.6, 4 * spacing) if kind in ('double_trefoil', 'double_flat') else 0.0
        cables = []
        for i, (x, z) in enumerate(base):
            if rows:
                z += (ci - (count - 1) / 2) * spacing
            cable_id = f'cable/c{ci + 1}-{PHASES[i].lower()}'
            enclosure = f'enclosure/duct-{ci * 3 + i + 1}' if duct else None
            cables.append({'id': cable_id, 'phase': PHASES[i], 'x': x + shift, 'z': z, 'enclosure': enclosure})
            if duct:
                ducts.append({'id': enclosure, 'x': x + shift, 'z': z, 'contains': [cable_id], **duct})
        circuits.append({'id': f'circuit/c{ci + 1}', 'label': f'回路 {ci + 1}', 'cables': cables})
    top = max(c['z'] for circuit in circuits for c in circuit['cables']) + (duct['outer_diameter_m'] if duct else diameter) / 2
    if top > 1e-12:
        raise CoreError('LAYOUT_INVALID', '埋深不足：最上面的电缆或管道高出地表，请增大中心埋深。', '/installation/depth_m')
    backfill = None
    if kind in ('backfill', 'duct_bank'):
        width, height = (1.2, .6) if kind == 'backfill' else (1.2, 1.0)
        backfill = {'x': 0.0, 'z': -depth, 'width': width, 'height': height}
    return {'circuits': circuits, 'ducts': ducts, 'backfill': backfill, 'label': template['label'],
            'template': {'kind': kind, 'depth': depth, 'spacing': spacing}}


def _three_core(kind, diameter, depth, spacing, duct):
    """One three-core cable per balanced circuit; an empty duct is not a heat source."""
    rows = 2 if kind == 'three_core_ducts_2x3' else 3 if kind == 'three_core_ducts_3x3' else 1
    count = LAYOUTS[kind]['circuits']
    spacing = default_spacing(kind, diameter) if spacing is None else spacing
    outer = duct['outer_diameter_m'] if duct else diameter
    if count > 1 and spacing < outer - 1e-12:
        raise CoreError('LAYOUT_INVALID', '回路中心距小于管道或电缆外径，请增大中心距。', '/installation/spacing_m')
    if depth <= (rows - 1) * spacing / 2 + outer / 2:
        raise CoreError('LAYOUT_INVALID', '地表以下埋深不足，请增大中心埋深。', '/installation/depth_m')
    circuits, ducts = [], []
    for i in range(count):
        x = (i % 3 - 1) * spacing if count > 1 else 0.0
        z = -depth + (i // 3 - (rows - 1) / 2) * spacing
        cable_id = f'cable/c{i + 1}'
        enclosure = f'enclosure/duct-{i + 1}' if duct else None
        circuits.append({'id': f'circuit/c{i + 1}', 'label': f'回路 {i + 1}',
                         'cables': [{'id': cable_id, 'phase': 'L1L2L3', 'x': x, 'z': z, 'enclosure': enclosure}]})
        if duct:
            ducts.append({'id': enclosure, 'x': x, 'z': z, 'contains': [cable_id], **duct})
    return {'circuits': circuits, 'ducts': ducts, 'backfill': None, 'label': LAYOUTS[kind]['label'],
            'template': {'kind': kind, 'depth': depth, 'spacing': spacing if count > 1 else None}}
