"""The studio's three inputs (型号, 敷设, 工况) composed into one cablesim.domain/1 document.

The parts are what the engineer edits; the document is what a method sees and what a
run record freezes. Composition adds nothing that is not in the parts.
"""
from copy import deepcopy

from pydantic import ValidationError

from cablesim_sdk.domain import CableType, DomainDocument
from cablesim_sdk.validation import FieldValueError
from . import CoreError
from . import layouts

BONDING = {'both_ends': '两端接地', 'single_point': '单点接地'}


def outer_diameter(cable):
    return 2 * CableType.model_validate(cable['payload']['cable_type']).radius()


def default_installation(cable):
    three = cable['payload']['cable_type']['construction'] == 'three_core'
    kind = 'three_core_buried_single' if three else 'trefoil'
    return {'layout': kind, 'depth_m': 1.2 if three else 1.0, 'spacing_m': None, 'duct': None, 'backfill': None,
            'bonding': 'both_ends'}


def default_conditions(cable):
    return {'soil_thermal_resistivity': 1.0, 'ambient_temperature_c': 25.0, 'frequency_hz': 50.0,
            'system_voltage_v': cable['payload']['cable_type']['rating'].get('u'), 'currents_a': [300.0]}


def _number(value, path, label, *, minimum=None, exclusive=True):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value or abs(value) == float('inf'):
        raise CoreError('INPUT_INVALID', f'{label}：请输入数值。', path)
    if minimum is not None and (value <= minimum if exclusive else value < minimum):
        raise CoreError('INPUT_INVALID', f'{label}：须{"大于" if exclusive else "不小于"} {minimum:g}。', path)
    return float(value)


def compose(name, cable, installation, conditions):
    """Domain document plus the resolved layout facts the screens need."""
    payload = cable['payload']
    cable_type = deepcopy(payload['cable_type'])
    three = cable_type['construction'] == 'three_core'
    kind = installation['layout']
    if kind not in layouts.LAYOUTS or (kind in layouts.THREE_CORE) != three:
        raise CoreError('LAYOUT_INVALID', '敷设方式与电缆芯数不匹配：三芯电缆用三芯模板，单芯电缆用单芯模板。', '/installation/layout')
    if installation.get('bonding') not in BONDING:
        raise CoreError('INPUT_INVALID', '请选择护套接地方式：两端接地或单点接地。', '/installation/bonding')
    rho = _number(conditions.get('soil_thermal_resistivity'), '/conditions/soil_thermal_resistivity', '土壤热阻率', minimum=0)
    ambient = _number(conditions.get('ambient_temperature_c'), '/conditions/ambient_temperature_c', '环境温度', minimum=-273.15)
    frequency = _number(conditions.get('frequency_hz'), '/conditions/frequency_hz', '频率', minimum=0)
    voltage = conditions.get('system_voltage_v')
    if voltage is not None:
        voltage = _number(voltage, '/conditions/system_voltage_v', '系统线电压', minimum=0)
    diameter = outer_diameter(cable)
    placed = layouts.place(kind, diameter, _number(installation.get('depth_m'), '/installation/depth_m', '中心埋深', minimum=0),
                           installation.get('spacing_m'), installation.get('duct'))
    currents = list(conditions.get('currents_a') or [])
    if not currents:
        raise CoreError('INPUT_INVALID', '请填写负荷电流，单位 A。', '/conditions/currents_a')
    # A single value applies to every circuit; otherwise one value per circuit is required.
    if len(currents) == 1:
        currents = currents * len(placed['circuits'])
    if len(currents) != len(placed['circuits']):
        raise CoreError('INPUT_INVALID', f'本敷设有 {len(placed["circuits"])} 个回路，请为每个回路填写负荷电流。', '/conditions/currents_a')
    materials = deepcopy(payload['materials'])
    materials.append({'id': 'material/soil', 'label': '原土', 'category': 'soil', 'thermal_resistivity': rho})
    reference = f"型号库 · {cable['name']} · {cable['version']} · sha256:{cable['content_sha256']}"
    provenance = {
        '/cable_types/cable_type~1ct1': {'kind': 'asset', 'reference': reference + '；' + cable['source'], 'reviewed': False},
        '/materials/material~1soil/thermal_resistivity': {'kind': 'user', 'reference': '工况输入：土壤热阻率', 'reviewed': False},
        '/sections/section~1s1/medium/surface_temperature': {'kind': 'user', 'reference': '工况输入：环境（地表）温度', 'reviewed': False},
        '/sections/section~1s1/placements': {'kind': 'user', 'reference': f"敷设模板 {kind}：埋深、间距与管径为敷设输入", 'reviewed': False},
        '/load_cases/load~1steady/currents': {'kind': 'user', 'reference': '工况输入：稳态负荷电流', 'reviewed': False},
    }
    section = {'id': 'section/s1', 'label': placed['label'], 'kind': 'ground', 'length': 1.0,
               'medium': {'material': 'material/soil', 'surface_temperature': ambient + 273.15},
               'enclosures': [], 'placements': [], 'layout_template': placed['template']}
    if placed['ducts']:
        duct = installation.get('duct') or layouts.default_duct(kind)
        duct_rho = _number(duct.get('thermal_resistivity', 6.0), '/installation/duct/thermal_resistivity', '管材热阻率', minimum=0)
        materials.append({'id': 'material/duct', 'label': '管材', 'category': 'duct', 'thermal_resistivity': duct_rho})
        provenance['/materials/material~1duct/thermal_resistivity'] = {
            'kind': 'standard' if duct_rho == 6.0 else 'user',
            'reference': 'IEC 60287-2-1:2023 Table 1，PVC 管材 6.0 K·m/W' if duct_rho == 6.0 else '敷设输入：管材热阻率',
            'reviewed': False}
        section['enclosures'] = [{'id': item['id'], 'type': 'duct', 'material': 'material/duct', 'x': item['x'], 'z': item['z'],
                                  'inner_diameter': item['inner_diameter_m'], 'outer_diameter': item['outer_diameter_m'],
                                  'contains': item['contains']} for item in placed['ducts']]
    if placed['backfill']:
        region = {**placed['backfill'], **{k: v for k, v in (installation.get('backfill') or {}).items() if k in ('width', 'height')}}
        fill_rho = _number((installation.get('backfill') or {}).get('thermal_resistivity', .8),
                           '/installation/backfill/thermal_resistivity', '回填热阻率', minimum=0)
        materials.append({'id': 'material/backfill', 'label': '混凝土包封' if kind == 'duct_bank' else '回填料',
                          'category': 'soil', 'thermal_resistivity': fill_rho})
        provenance['/materials/material~1backfill/thermal_resistivity'] = {
            'kind': 'user', 'reference': '敷设输入：回填 / 包封热阻率；使用前核实材料', 'reviewed': False}
        section['backfill'] = {'id': 'region/backfill', 'material': 'material/backfill', **region}
    circuits, load = [], {}
    for circuit, current in zip(placed['circuits'], currents):
        circuits.append({'id': circuit['id'], 'label': circuit['label'], 'cable_type': cable_type['id'],
                         'system': {'kind': 'ac_three_phase', 'frequency': frequency, 'voltage': voltage},
                         'cables': [{'id': c['id'], 'phase': c['phase']} for c in circuit['cables']],
                         'bonding': {'kind': installation['bonding']}})
        load[circuit['id']] = _number(current, '/conditions/currents_a', '负荷电流', minimum=0, exclusive=False)
        section['placements'] += [{'cable': c['id'], 'x': c['x'], 'z': c['z'], 'enclosure': c['enclosure']}
                                  for c in circuit['cables']]
    document = {'schema_version': 'cablesim.domain/1', 'name': name, 'materials': materials, 'cable_types': [cable_type],
                'circuits': circuits, 'sections': [section],
                'load_cases': [{'id': 'load/steady', 'kind': 'steady', 'currents': load}],
                'criteria': {}, 'provenance': provenance}
    try:
        document = DomainDocument.model_validate(document).model_dump(mode='json', exclude_none=True)
    except FieldValueError as error:
        raise CoreError('INPUT_INVALID', str(error), '/document/' + '/'.join(str(part) for part in error.field_path)) from None
    except ValidationError as error:
        first = error.errors()[0]
        raise CoreError('INPUT_INVALID', first['msg'], '/document/' + '/'.join(str(part) for part in first['loc'])) from None
    return {'document': document, 'outer_diameter_m': diameter, 'layout': placed['template'],
            'layout_label': placed['label'], 'circuit_count': len(circuits),
            'duct': (installation.get('duct') or layouts.default_duct(kind)) if placed['ducts'] else None}
