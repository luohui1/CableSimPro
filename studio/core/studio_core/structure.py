"""A product structure as a factory states it, turned into the cable type the methods read.

A structure table gives, per size, the diameters and thicknesses of the layers. What the table does not give
(screen thicknesses, tape dimensions, the lay of the cores) is declared once for the series, each value with where
it comes from. Nothing is filled in silently: a missing dimension stops the row and names the field. The declared
outer diameter is a check, not a target: the layers must fit inside it, and what is left over is the unlisted
wrapping, reported as such.

Quantities a rating method derives from the structure (the longitudinal resistance of a tape screen, the
equivalent thickness of an armour) are not computed here. Where the sealed model completion of the IEC 60287
plugin covers a family, the row goes through it; elsewhere the structure is built as stated and a method that
needs more says what it is missing.
"""
from copy import deepcopy
from math import isfinite, sqrt
from statistics import median

from . import CoreError, basis, designation, library, runner

# key: label, unit as written in a table, scale to SI, header words that name the column in factory tables
FIELDS = {
    'area': ('标称截面', 'mm²', 1e-6, ['标称截面', '截面', '规格']),
    'conductor_diameter': ('导体外径', 'mm', 1e-3, ['导体外径', '导体直径', '导体标称直径']),
    'conductor_wire_count': ('导体单线根数', '根', 1, ['单线根数', '导体根数', '根数']),
    'conductor_wire_diameter': ('导体单线直径', 'mm', 1e-3, ['单线直径', '单丝直径']),
    'r20': ('20 °C 导体直流电阻', 'Ω/km', 1e-3, ['直流电阻', '导体电阻', '20℃', '20°C']),
    'conductor_screen_thickness': ('导体屏蔽厚度', 'mm', 1e-3, ['导体屏蔽', '内屏蔽', '内屏']),
    'insulation_thickness': ('绝缘标称厚度', 'mm', 1e-3, ['绝缘标称厚度', '绝缘厚度', '绝缘']),
    'insulation_screen_thickness': ('绝缘屏蔽厚度', 'mm', 1e-3, ['绝缘屏蔽', '外屏蔽', '外屏']),
    'screen_tape_thickness': ('铜带厚度', 'mm', 1e-3, ['铜带厚度', '屏蔽铜带厚度', '铜带']),
    'screen_tape_width': ('铜带宽度', 'mm', 1e-3, ['铜带宽度']),
    'screen_tape_overlap': ('铜带标称搭盖率', '%', 1e-2, ['搭盖率', '搭盖']),
    'binder_thickness': ('包带厚度', 'mm', 1e-3, ['包带厚度', '绕包带', '包带']),
    'bedding_thickness': ('内衬层厚度', 'mm', 1e-3, ['内衬层', '内护套', '隔离套', '内衬']),
    'armour_tape_thickness': ('钢带厚度', 'mm', 1e-3, ['钢带厚度', '铠装钢带', '钢带']),
    'armour_tape_width': ('钢带宽度', 'mm', 1e-3, ['钢带宽度']),
    'armour_wire_diameter': ('钢丝直径', 'mm', 1e-3, ['钢丝直径', '钢丝']),
    'armour_wire_count': ('钢丝根数', '根', 1, ['钢丝根数']),
    'oversheath_thickness': ('外护套标称厚度', 'mm', 1e-3, ['护套标称厚度', '外护套厚度', '护套厚度', '外护套', '护套']),
    'outer_diameter': ('电缆近似外径', 'mm', 1e-3, ['电缆近似外径', '近似外径', '电缆外径', '参考外径', '外径']),
    'weight': ('电缆近似重量', 'kg/km', 1, ['近似重量', '参考重量', '重量']),
}
# What a rating method needs beyond the structure. The reference values are those the repository's public
# series declares, each with its origin; a factory replaces them with its own.
MODELLING = {
    'conductor_form': ('导体构造', '1'), 'core_lay_length': ('成缆节距', 'm'), 'screen_model': ('铜带纵向电阻模型', '1'),
    'screen_radial_factor': ('铜带径向包络 / 单带厚度', '1'), 'filler_rho': ('填充与包带热阻率', 'K*m/W'),
    'armour_gap_ratio': ('钢带间隙 / 带宽', '1'), 'steel_relative_permeability': ('钢带相对磁导率', '1'),
    'diameter_rounding': ('外径列示精度的半个单位', 'm'),
}
# What a row must state, in its own cells or in the series declaration, before a structure can be built.
REQUIRED = ('conductor_diameter', 'conductor_screen_thickness', 'insulation_thickness', 'insulation_screen_thickness',
            'screen_tape_thickness', 'oversheath_thickness', 'outer_diameter')
IEC = 'cablesim.iec60287'
THERMAL = 'IEC 60287-2-1:2023 表 1（XLPE 3.5、半导电料 2.5、3 kV 以上 PVC 6.0、PE 3.5 K·m/W）'
DIELECTRIC = 'IEC 60287-1-1:2023 表 3（XLPE：εr 2.5，36 kV 及以下 tanδ 0.004）'


def reference_modelling():
    """The engineering parameters of the repository's public YJV22 series, as reference values to start from."""
    import json
    data = json.loads((library.SERIES / 'huayuan_yjv22.json').read_text('utf-8'))
    return deepcopy(data['engineering_scenario']['parameters']['values'])


def _number(value, key):
    label = FIELDS[key][0]
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) or value <= 0:
        raise CoreError('STRUCTURE_INVALID', f'{label}：须为正数，现为 {value!r}。', f'/values/{key}')
    return float(value)


def _series(series):
    """The declaration checked and its designation read."""
    parts = designation.parse(series.get('designation'))
    cores = series.get('cores')
    if cores not in (1, 3):
        raise CoreError('SERIES_INVALID', '芯数：目前收录单芯和三芯。', '/series/cores')
    for key, label in (('u0_v', 'U0'), ('u_v', 'U')):
        value = series.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
            raise CoreError('SERIES_INVALID', f'额定电压 {label}：须为正数，单位 V。', f'/series/{key}')
    if parts['metal_sheath']:
        raise CoreError('STRUCTURE_UNSUPPORTED', '金属套高压电缆的结构表导入尚未开放；现有的 110 kV 型号已在库中。', '/series/designation')
    if parts['screen'] != 'copper_tape':
        raise CoreError('STRUCTURE_UNSUPPORTED', '铜丝屏蔽结构的导入尚未开放。', '/series/designation')
    if parts['armour'] and parts['armour']['kind'].startswith('nonmagnetic'):
        raise CoreError('STRUCTURE_UNSUPPORTED', '非磁性铠装结构的导入尚未开放。', '/series/designation')
    unknown = [key for key in series.get('common') or {} if key not in FIELDS]
    if unknown:
        raise CoreError('SERIES_INVALID', f'系列声明里有未收录的字段：{unknown[0]}。', f'/series/common/{unknown[0]}')
    return parts


def covered_by_completion(series, parts):
    """Whether the sealed model completion of the IEC 60287 plugin derives this family."""
    return (series['cores'] == 3 and parts['model'] in ('YJV', 'YJV22') and parts['conductor'] == 'copper'
            and series['u0_v'] == 8700 and series['u_v'] == 15000)


def _resolved(series, values, bases=None):
    """Each field with its value and where it comes from: the table row first, then the series declaration.

    `bases` is what a person who typed a row says about a value (a clause, a drawing); it travels with the value.
    """
    resolved = {}
    common, notes = series.get('common') or {}, series.get('common_basis') or {}
    for key in FIELDS:
        if values.get(key) is not None:
            resolved[key] = {'value': _number(values[key], key), 'origin': 'table', **({'basis': bases[key]} if bases and bases.get(key) else {})}
        elif common.get(key) is not None:
            resolved[key] = {'value': _number(common[key], key), 'origin': 'series', 'basis': notes.get(key) or '系列声明'}
    if 'area' not in resolved:
        raise CoreError('STRUCTURE_INCOMPLETE', '缺标称截面。', '/values/area')
    for key in REQUIRED:
        if key not in resolved:
            raise CoreError('STRUCTURE_INCOMPLETE', f'缺{FIELDS[key][0]}：结构表和系列声明里都没有。', f'/values/{key}')
    return resolved


def _resistance(series, parts, rows):
    """The conductor resistance of rows that do not state one: the limit of GB/T 3956, read from the basis library."""
    queries = {}
    for index, row in enumerate(rows):
        if isinstance(row, dict) and 'r20' not in row:
            conditions = {'area_m2': row['area']['value'] * 1e-6, 'conductor_class': 2,
                          'conductor_material': parts['conductor'], **({'coating': 'plain'} if parts['conductor'] == 'copper' else {})}
            queries[str(index)] = {'schema_version': 'cablesim.standards-query/1', 'standard': 'GB/T 3956', 'edition': '2008',
                                   'locator': '表 2', 'quantity': 'resistance_20_max', 'conditions': conditions}
    if not queries:
        return
    references, missing = basis.resolve(queries)
    for index, reference in references.items():
        record = reference['record']
        rows[int(index)]['r20'] = {
            'value': record['value'], 'origin': 'standard',
            'basis': f"{record['standard']}—{record['edition']} {record['table']}，第 2 种导体 20 °C 直流电阻上限，PDF 第 {record['pdf_page']} 页"}
    for item in missing:
        index = int(item['key'])
        area = rows[index]['area']['value']
        rows[index] = CoreError('STRUCTURE_INCOMPLETE', f'缺 20 °C 导体直流电阻：结构表没有这一列，GB/T 3956—2008 表 2 也没有 {area:g} mm² 这一截面。', '/values/r20')


def _source(series, resolved, derivation):
    stated = series.get('source') or {}
    text = '；'.join(str(stated[key]) for key in ('title', 'location') if stated.get(key)) or '结构表'
    if stated.get('sha256'):
        text += f"；sha256:{stated['sha256']}"
    declared = [f"{FIELDS[key][0]} {item['value']:g} {FIELDS[key][1]}（{item['basis']}）" for key, item in resolved.items() if item['origin'] != 'table']
    if declared:
        text += '。表中未列、另行取值：' + '；'.join(declared)
    given = [f"{MODELLING[key][0]} = {item['value']}（{item['reference']}）" for key, item in (series.get('modelling') or {}).items() if key in MODELLING]
    if given:
        text += '。计算用参数：' + '；'.join(given)
    return text + '。' + derivation


def _plugin_specification(series, parts, resolved, name):
    rename = {'screen_tape_thickness': 'metallic_screen_tape_thickness', 'screen_tape_width': 'metallic_screen_tape_width',
              'binder_thickness': 'binder_tape_thickness'}
    units = {'mm': 'm', 'mm²': 'm2', 'Ω/km': 'ohm/m', '根': '1'}
    values = {}
    for key, item in resolved.items():
        if key in ('area', 'weight', 'screen_tape_overlap'):  # the completion uses the nominal overlap of the standard
            continue
        label, unit, scale, _ = FIELDS[key]
        values[rename.get(key, key)] = {'value': item['value'] * scale, 'unit': units[unit],
                                        'basis': 'standard_limit' if item['origin'] == 'standard' else 'manufacturer',
                                        'source': item['origin']}
    stated = series.get('source') or {}
    return {
        'schema_version': 'cablesim.product-specification/1', 'name': name, 'version': '1.0.0', 'confirmed': False,
        'specification': {'manufacturer': series.get('manufacturer') or '', 'designation': parts['model'], 'u0_v': series['u0_v'],
                          'voltage_v': series['u_v'], 'cores': 3, 'area_m2': resolved['area']['value'] * 1e-6,
                          'conductor': 'copper_bare' if parts['conductor'] == 'copper' else 'aluminium', 'values': values, 'missing': []},
        'sources': {
            'table': {'kind': 'manufacturer', 'reviewed': False, 'reference': '；'.join(str(stated.get(key)) for key in ('title', 'location') if stated.get(key)) or '结构表'},
            'series': {'kind': 'user', 'reviewed': False, 'reference': '系列声明：结构表未列的尺寸按系列统一取值，依据见各项。'},
            'standard': {'kind': 'standard', 'reviewed': False, 'reference': 'GB/T 3956—2008 表 2，第 2 种导体 20 °C 直流电阻上限'}}}


def _materials(series, parts, modelling):
    conductor = ({'id': 'material/cu', 'label': '铜', 'category': 'conductor', 'standard_kind': 'copper_bare',
                  'electrical_resistivity_20': 1.7241e-8, 'temperature_coefficient_20': .00393}
                 if parts['conductor'] == 'copper' else
                 {'id': 'material/al', 'label': '铝', 'category': 'conductor', 'standard_kind': 'aluminium',
                  'electrical_resistivity_20': 2.8264e-8, 'temperature_coefficient_20': .00403})
    materials = [conductor]
    if parts['conductor'] != 'copper':  # the screen is copper tape whatever the conductor is
        materials.append({'id': 'material/cu', 'label': '铜', 'category': 'conductor', 'standard_kind': 'copper_bare',
                          'electrical_resistivity_20': 1.7241e-8, 'temperature_coefficient_20': .00393})
    materials += [
        {'id': 'material/semi', 'label': '半导电屏蔽料', 'category': 'semiconductor', 'thermal_resistivity': 2.5},
        {'id': 'material/xlpe', 'label': '交联聚乙烯', 'category': 'insulation', 'standard_kind': 'XLPE', 'thermal_resistivity': 3.5,
         'relative_permittivity': 2.5, 'loss_tangent': .004 if series['u0_v'] <= 18000 else .001},
        {'id': 'material/filler', 'label': '填充与包带', 'category': 'filler',
         'thermal_resistivity': modelling['filler_rho']['value'] if 'filler_rho' in modelling else 6.0},
    ]
    polymers = {'PVC': {'id': 'material/pvc', 'label': '聚氯乙烯', 'category': 'polymer', 'standard_kind': 'PVC', 'thermal_resistivity': 6.0},
                'PE': {'id': 'material/pe', 'label': '聚乙烯', 'category': 'polymer', 'standard_kind': 'other', 'thermal_resistivity': 3.5}}
    for kind in dict.fromkeys([parts.get('inner_covering') or parts['sheath'], parts['sheath']]):
        materials.append(polymers[kind])
    if parts['armour']:
        steel = {'id': 'material/steel', 'label': '钢带' if parts['armour']['kind'] == 'steel_tape' else '钢丝', 'category': 'metal'}
        if series.get('armour_material'):
            steel['standard_kind'] = series['armour_material']
        if 'steel_relative_permeability' in modelling:
            steel['relative_permeability'] = modelling['steel_relative_permeability']['value']
        materials.append(steel)
    return materials


def _stated(series, parts, resolved, name):
    """The structure as stated, layer by layer, closed against the declared outer diameter."""
    modelling = series.get('modelling') or {}

    def need(key):
        if key not in resolved:
            raise CoreError('STRUCTURE_INCOMPLETE', f'缺{FIELDS[key][0]}：结构表和系列声明里都没有。', f'/values/{key}')
        return resolved[key]['value'] * FIELDS[key][2]

    def given(key):
        if key not in modelling:
            raise CoreError('STRUCTURE_INCOMPLETE', f'缺计算用参数：{MODELLING[key][0]}。', f'/series/modelling/{key}')
        return modelling[key]['value']

    three = series['cores'] == 3
    polymer = lambda kind: 'material/pvc' if kind == 'PVC' else 'material/pe'
    conductor_id = 'material/cu' if parts['conductor'] == 'copper' else 'material/al'
    tape = need('screen_tape_thickness')
    screen = {'role': 'metallic_screen', 'material': 'material/cu', 'form': 'tape', 'thickness': tape * given('screen_radial_factor'),
              'nominal_tape_thickness': tape, 'tape_application': 'helical_overlap'}
    if 'screen_tape_width' in resolved:
        screen['tape_width'] = need('screen_tape_width')
    if 'screen_tape_overlap' in resolved:
        screen['overlap'] = need('screen_tape_overlap')
    core_layers = [{'role': 'conductor_screen', 'material': 'material/semi', 'thickness': need('conductor_screen_thickness')},
                   {'role': 'insulation', 'material': 'material/xlpe', 'thickness': need('insulation_thickness')},
                   {'role': 'insulation_screen', 'material': 'material/semi', 'thickness': need('insulation_screen_thickness')}, screen]
    diameter = need('conductor_diameter')
    core_diameter = diameter + 2 * sum(layer['thickness'] for layer in core_layers)
    outer = []
    if 'bedding_thickness' in resolved:
        outer.append({'role': 'bedding', 'material': polymer(parts.get('inner_covering') or parts['sheath']), 'thickness': need('bedding_thickness')})
    if parts['armour'] and parts['armour']['kind'] == 'steel_tape':
        gauge = need('armour_tape_thickness')
        armour = {'role': 'armour', 'material': 'material/steel', 'form': 'tape', 'thickness': 2 * gauge, 'nominal_tape_thickness': gauge,
                  'tape_count': 2, 'tape_application': 'two_tape_gap'}
        if 'armour_tape_width' in resolved:
            armour['tape_width'] = need('armour_tape_width')
            if 'armour_gap_ratio' in modelling:
                armour['tape_gap'] = armour['tape_width'] * modelling['armour_gap_ratio']['value']
        outer.append(armour)
    elif parts['armour']:
        wire = need('armour_wire_diameter')
        armour = {'role': 'armour', 'material': 'material/steel', 'form': 'wires', 'thickness': wire, 'wire_diameter': wire}
        if 'armour_wire_count' in resolved:
            armour['wire_count'] = round(resolved['armour_wire_count']['value'])
        outer.append(armour)
    outer.append({'role': 'oversheath', 'material': polymer(parts['sheath']), 'thickness': need('oversheath_thickness')})
    laid = core_diameter * (1 + 2 / sqrt(3)) if three else core_diameter
    binder = need('binder_thickness') if 'binder_thickness' in resolved else 0.0
    built = laid + 2 * (binder + sum(layer['thickness'] for layer in outer))
    declared = need('outer_diameter')
    residual = (declared - built) / 2
    tolerance = given('diameter_rounding') + max(.0005, .01 * declared)
    if residual < 0 and -2 * residual > tolerance:
        raise CoreError('RADIAL_DIMENSIONS_CONFLICT',
                        f'各层加起来 {built * 1000:.2f} mm，超过表中外径 {declared * 1000:g} mm，差值超出 {tolerance * 1000:.2f} mm 的闭合容差。'
                        '请核对外径或层厚；不会自动缩减层厚。', '/values/outer_diameter')
    wrap = binder + max(0.0, residual)
    if three and wrap <= 0:
        raise CoreError('STRUCTURE_INCOMPLETE', '缺包带厚度：三芯成缆外须有填充与包带。', '/values/binder_thickness')
    wrapping = [{'role': 'filler' if three else 'binder', 'material': 'material/filler', 'thickness': wrap}] if wrap > 0 else []
    conductor = {'material': conductor_id, 'form': modelling['conductor_form']['value'] if 'conductor_form' in modelling else 'unspecified',
                 'nominal_area': resolved['area']['value'] * 1e-6, 'diameter': diameter, 'r20': resolved['r20']['value'] * 1e-3,
                 'conductor_class': 2, 'r20_basis': 'design' if resolved['r20']['origin'] == 'standard' else 'manufacturer_limit'}
    for key, field in (('conductor_wire_count', 'wire_count'), ('conductor_wire_diameter', 'wire_diameter')):
        if key in resolved:
            conductor[field] = round(resolved[key]['value']) if field == 'wire_count' else resolved[key]['value'] * 1e-3
    rating = {'u0': series['u0_v'], 'u': series['u_v'], **({'um': series['um_v']} if series.get('um_v') else {}),
              'max_conductor_temperature': {'normal': 363.15, 'short_circuit': 523.15}}
    if three:
        c = core_diameter / sqrt(3)
        cores = [{'id': f'core/{index + 1}', 'x': x, 'z': z, 'conductor': deepcopy(conductor), 'layers': deepcopy(core_layers)}
                 for index, (x, z) in enumerate([(0, c), (-core_diameter / 2, -c / 2), (core_diameter / 2, -c / 2)])]
        cable = {'id': 'cable_type/ct1', 'label': name, 'construction': 'three_core', 'rating': rating, 'cores': cores,
                 'common_layers': wrapping + outer}
        if 'core_lay_length' in modelling:
            cable['core_lay_length'] = modelling['core_lay_length']['value']
    else:
        cable = {'id': 'cable_type/ct1', 'label': name, 'construction': 'single_core', 'rating': rating,
                 'cores': [{'id': 'core/1', 'x': 0.0, 'z': 0.0, 'conductor': conductor, 'layers': []}],
                 'common_layers': core_layers + wrapping + outer}
    payload = library._validated(cable, _materials(series, parts, modelling))
    closure = {'declared_mm': declared * 1000, 'listed_mm': built * 1000, 'residual_mm': residual * 1000, 'tolerance_mm': tolerance * 1000,
               'placed_in': (wrapping[0]['role'] if wrapping and residual > 0 else None)}
    return payload, closure, {'kind': 'stated', 'note': f'结构按表列尺寸逐层组成；材料热、电参考值取 {THERMAL}，{DIELECTRIC}。'}


def _completed(series, parts, built):
    """Rows of a family the sealed model completion covers, derived in one run of the plugin."""
    modelling = series.get('modelling') or {}
    cases = [{'case_id': f'row-{index}', 'input': _plugin_specification(series, parts, item['resolved'], item['name']),
              'parameters': {'values': deepcopy(modelling)}} for index, item in built.items() if not isinstance(item, CoreError)]
    if not cases:
        return
    run = runner.run(IEC, 'model-completion', cases)
    for case in run['cases']:
        index = int(case['case_id'].split('-')[1])
        if case['status'] != 'succeeded':
            error = case.get('error') or {}
            built[index] = CoreError(error.get('code', 'MODEL_COMPLETION_FAILED'), error.get('message', '结构推导没有给出结果。'), error.get('path'))
            continue
        model = case['artifacts']['x-cablesim.engineering-model']
        cable = deepcopy(model['cable_type'])
        cable['id'] = 'cable_type/ct1'
        materials = deepcopy(model['materials'])
        if series.get('armour_material'):
            for material in materials:
                if material['id'] == 'material/steel':
                    material['standard_kind'] = series['armour_material']
        derived = model['derived']
        residual = (derived['reported_outer_diameter_m'] - (derived['model_outer_diameter_m'] - 2 * (derived['filler_cover_thickness_m'] - built[index]['binder']))) / 2
        built[index].update(
            payload=library._validated(cable, materials),
            closure={'declared_mm': derived['reported_outer_diameter_m'] * 1000, 'listed_mm': (derived['reported_outer_diameter_m'] - 2 * residual) * 1000,
                     'residual_mm': residual * 1000, 'tolerance_mm': derived['diameter_closure_tolerance_m'] * 1000,
                     'placed_in': 'filler' if residual > 0 else None},
            derivation={'kind': 'plugin', 'plugin_id': run['plugin_id'], 'plugin_version': run['plugin_version'], 'capability': run['capability'],
                        'request_sha256': run['request_sha256'], 'manifest_sha256': run['manifest_sha256'],
                        'note': f"由 {run['plugin_id']} {run['plugin_version']} model-completion 推导，径向尺寸闭合已核对；铜带纵向电阻按系列声明的接触模型得出。"})


def declare(series):
    """A series declaration checked before it has any row: what a hand-made series has to state."""
    parts = _series(series)
    return {'designation': {**parts, 'description': designation.describe(parts)}}


def build(series, rows, bases=None):
    """Every row of a structure table as a product ready for the methods; a row that cannot be built says why.

    `bases`, when given, holds one dict per row: what the person who typed that row says about its values.
    """
    parts = _series(series)
    modelling = series.get('modelling') or {}
    resolved = []
    for index, values in enumerate(rows):
        try:
            resolved.append(_resolved(series, values, bases[index] if bases else None))
        except CoreError as error:
            resolved.append(error)
    _resistance(series, parts, resolved)
    built = {}
    for index, item in enumerate(resolved):
        if isinstance(item, CoreError):
            built[index] = item
            continue
        area = item['area']['value']
        named = designation.name({**parts, 'u0_v': series['u0_v'], 'u_v': series['u_v']}, series['cores'], area)
        built[index] = {'name': named, 'key': f"{series['cores']}×{area:g}", 'area_mm2': area, 'resolved': item,
                        'binder': item['binder_thickness']['value'] * 1e-3 if 'binder_thickness' in item else 0.0}
    if covered_by_completion(series, parts):
        _completed(series, parts, built)
    else:
        for index, item in built.items():
            if isinstance(item, CoreError):
                continue
            try:
                item['payload'], item['closure'], item['derivation'] = _stated(series, parts, item['resolved'], item['name'])
            except CoreError as error:
                built[index] = error
    results = []
    for index in range(len(rows)):
        item = built[index]
        if isinstance(item, CoreError):
            results.append({'ok': False, 'row': index, 'error': item.as_dict()})
            continue
        family = series.get('name') or designation.name({**parts, 'u0_v': series['u0_v'], 'u_v': series['u_v']})
        entry = library._entry('', '', item['name'], family, series.get('origin') or 'factory',
                               _source(series, item['resolved'], item['derivation']['note']), item['payload'])
        structure = [{'key': key, 'label': FIELDS[key][0], 'unit': FIELDS[key][1], **value} for key, value in item['resolved'].items()]
        results.append({'ok': True, 'row': index, 'key': item['key'], 'name': item['name'], 'area_mm2': item['area_mm2'], 'entry': entry,
                        'structure': structure, 'closure': item['closure'], 'derivation': item['derivation'], 'warnings': []})
    _flag_outliers(results)
    return {'designation': {**parts, 'description': designation.describe(parts)}, 'rows': results,
            'modelling_used': sorted(key for key in modelling if key in MODELLING)}


def _flag_outliers(results):
    """Rows whose leftover wrapping or weight is out of line with the rest of the series: likely a typing error in the table."""
    good = [item for item in results if item['ok']]
    if len(good) >= 4:
        typical = median(item['closure']['residual_mm'] for item in good)
        for item in good:
            if abs(item['closure']['residual_mm'] - typical) > 1.0:
                item['warnings'].append({'code': 'CLOSURE_OUTLIER', 'message':
                                         f"层厚以外的余量 {item['closure']['residual_mm']:.2f} mm，同系列其余规格约 {typical:.2f} mm；请核对这一行的外径或层厚。"})
    weights = [(item['area_mm2'], next((s['value'] for s in item['structure'] if s['key'] == 'weight'), None), item) for item in good]
    weights = sorted((entry for entry in weights if entry[1] is not None), key=lambda entry: entry[0])
    for (_, lighter, _), (_, weight, item) in zip(weights, weights[1:]):
        if weight <= lighter:
            item['warnings'].append({'code': 'WEIGHT_ORDER', 'message': f'重量 {weight:g} kg/km 不大于更小截面的 {lighter:g} kg/km；请核对这一行的重量。'})
