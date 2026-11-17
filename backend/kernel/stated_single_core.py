"""Map an explicitly stated single-core structure to the existing domain model.

This adapter does not choose standard thicknesses, material constants or a loss
model. It uses CableType.radius for the existing geometric closure check. Missing
properties remain missing, and unsupported layers never disappear from a row.
"""
from copy import deepcopy
import json
from math import isfinite

from pydantic import ValidationError

from backend.domain.guards import pointer
from backend.domain.models import CableType, Material
from .candidates import CableModelVersion


METHOD = {'name': '单芯明示结构映射', 'version': '1.0.0'}
PROPERTY_UNITS = {
    'thermal_resistivity': {'K.m/W', 'K*m/W', 'K·m/W'},
    'volumetric_heat_capacity': {'J/(m3.K)', 'J/(m³·K)', 'J/(m^3*K)'},
    'electrical_resistivity_20': {'ohm.m', 'ohm*m', 'Ω·m'},
    'temperature_coefficient_20': {'1/K', 'K^-1'},
    'relative_permittivity': {'1'}, 'loss_tangent': {'1'},
    'relative_permeability': {'1'}, 'emissivity': {'1'}, 'solar_absorptivity': {'1'},
    'density': {'kg/m3', 'kg/m³'},
}
REQUIRED_PROPERTIES = {
    'conductor': ('temperature_coefficient_20',),
    'conductor_screen': ('thermal_resistivity',),
    'insulation': ('thermal_resistivity', 'relative_permittivity', 'loss_tangent'),
    'insulation_screen': ('thermal_resistivity',),
    'buffer': ('thermal_resistivity',),
    'metallic_sheath': ('electrical_resistivity_20', 'temperature_coefficient_20'),
    'separator': ('thermal_resistivity',),
    'oversheath': ('thermal_resistivity',),
}
FORM = {'solid_round', 'stranded_round', 'stranded_round_compacted'}
DIMENSIONS = {
    'conductor_screen': 'conductor_screen_thickness', 'insulation': 'insulation_thickness',
    'insulation_screen': 'insulation_screen_thickness', 'buffer': 'buffer_thickness',
    'metallic_sheath': 'metallic_sheath_thickness', 'separator': 'separator_thickness',
    'oversheath': 'oversheath_thickness',
}


def _source(reference, *, kind='user'):
    return {'kind': kind, 'reviewed': False, 'reference': json.dumps({
        'method': METHOD, 'confidence': 'reference', 'evidence': reference}, ensure_ascii=False, sort_keys=True)}


def build(series, parts, name, facts):
    """Return a complete draft or an explicit missing list, never guessed facts.

    ``facts`` is numeric_facts' SI list. ``material_properties`` uses the role
    keys in REQUIRED_PROPERTIES; each property is {value, unit, reference}.
    The caller retains the original PublishedSpecification when payload is None.
    """
    missing, issues, sources = [], [], {}
    result = {'payload': None, 'closure': None, 'derivation': {
        'kind': 'stated', 'method': METHOD, 'confidence': 'reference',
        'note': '只映射逐项声明的结构、材料与温限；不补标准默认值，不计算金属层等效电阻。'},
        'missing': missing, 'issues': issues, 'warnings': []}
    if series['cores'] != 1:
        missing.append('此构造器仅接收单芯；多芯的芯坐标和成缆结构须另行完整声明。')
        return result
    if parts.get('armour'):
        missing.append('铠装的完整层结构与径向包络尚未声明；不能把钢带单带厚度当作径向总厚度。')
        return result
    values = {}
    for fact in facts:
        key, value = fact['key'], fact['value']
        if key in values:
            issues.append({'field': key, 'column': key, 'message': '同一字段重复，不能选择其中一个值。'})
        if type(value) not in (int, float) or not isfinite(value) or value <= 0:
            issues.append({'field': key, 'column': key, 'message': '明示结构数值必须为有限正数。'})
        if not fact.get('source'):
            missing.append('数值来源：' + key)
        values[key] = value
        sources[key] = _source(fact.get('source'), kind=fact.get('source', {}).get('kind', 'manufacturer'))
    allowed = {'area', 'conductor_diameter', 'conductor_wire_count', 'conductor_wire_diameter',
               'r20', 'outer_diameter', 'weight', 'ampacity', 'corrugation_depth', 'corrugation_pitch', *DIMENSIONS.values()}
    for key in sorted(set(values) - allowed):
        missing.append('尚未声明可映射的结构位置或绕包方式：' + key)
    metal = parts.get('metal_sheath')
    if metal not in (None, 'lead', 'smooth_aluminium', 'corrugated_aluminium'):
        missing.append('金属套材料或形态未覆盖：' + str(metal))
    if series['u_v'] > 3000 and not metal:
        missing.append('中高压单芯须明确金属屏蔽或金属套；此入口只接收完整明示金属套。')
    roles = ['conductor']
    for role, key in DIMENSIONS.items():
        required = role in ('insulation', 'oversheath') or series['u_v'] > 3000 and role in ('conductor_screen', 'insulation_screen') or role == 'metallic_sheath' and metal is not None
        if key in values:
            roles.append(role)
        elif required:
            missing.append('结构尺寸：' + key)
    for key in ('area', 'conductor_diameter', 'outer_diameter', 'r20'):
        if key not in values:
            missing.append('结构尺寸：' + key)
    if 'metallic_sheath_thickness' in values and metal is None:
        missing.append('金属套厚度已有数值，但材料和形态尚未声明。')
    if metal == 'corrugated_aluminium':
        for key in ('corrugation_depth', 'corrugation_pitch'):
            if key not in values:
                missing.append('皱纹金属套尺寸：' + key)
    elif 'corrugation_depth' in values or 'corrugation_pitch' in values:
        issues.append({'field': 'corrugation_depth', 'column': 'corrugation_depth',
                       'message': '波深和节距只能关联明确的皱纹金属套。'})

    modelling = series.get('modelling', {})
    def parameter(key, units, required=False):
        item = modelling.get(key)
        if item is None:
            if required:
                missing.append('计算用参数：' + key)
            return None
        if not item.get('reference', '').strip() or item.get('unit') not in units:
            missing.append('参数须有明确来源和单位：' + key)
            return None
        return item['value']

    form = parameter('conductor_form', {'1'}, True)
    if form is not None and form not in FORM:
        missing.append('导体形态须为已声明的实心圆、绞合圆或紧压圆；不反推分割/空心导体尺寸。')
    normal = parameter('normal_temperature_k', {'K'}, True)
    short = parameter('short_circuit_temperature_k', {'K'})
    conductor_class = parameter('conductor_class', {'1'})
    tolerance = parameter('diameter_rounding', {'m'})
    if tolerance is None:
        tolerance = 0.0  # Exact closure; no unclaimed engineering tolerance.
    if type(tolerance) not in (int, float) or not isfinite(tolerance) or tolerance < 0:
        issues.append({'field': 'diameter_rounding', 'column': '', 'message': '外径舍入公差须为有限非负米值。'})
    for key, value in [('normal_temperature_k', normal), ('short_circuit_temperature_k', short)]:
        if value is not None and (type(value) not in (int, float) or not isfinite(value) or value <= 0):
            issues.append({'field': key, 'column': '', 'message': '温限须以 K 给出有限正数。'})
    if conductor_class is not None and (type(conductor_class) not in (int, float) or conductor_class not in (1, 2, 5, 6)):
        issues.append({'field': 'conductor_class', 'column': '', 'message': '导体类别须明确为 1、2、5 或 6。'})

    material_properties = series.get('material_properties', {})
    for role in sorted(set(material_properties) - set(roles)):
        issues.append({'field': 'material_properties.' + role, 'column': '',
                       'message': '材料属性无法对应当前结构层；不忽略额外材料声明。'})
    materials = []
    for role in roles:
        properties = material_properties.get(role, {})
        for key in REQUIRED_PROPERTIES[role]:
            if key not in properties:
                missing.append('材料物性：' + role + '.' + key)
        material = {'id': 'material/import-' + role.replace('_', '-'), 'label': role,
                    'category': {'conductor': 'conductor', 'conductor_screen': 'semiconductor',
                        'insulation_screen': 'semiconductor', 'insulation': 'insulation',
                        'metallic_sheath': 'metal', 'buffer': 'filler'}.get(role, 'polymer')}
        if role == 'conductor':
            material['standard_kind'] = 'copper_bare' if parts['conductor'] == 'copper' else 'aluminium'
        elif role == 'insulation':
            material['standard_kind'] = parts['insulation']
        elif role == 'metallic_sheath':
            material['standard_kind'] = 'lead' if metal == 'lead' else 'aluminium'
        elif role == 'oversheath' and parts.get('sheath') == 'PVC':
            material['standard_kind'] = 'PVC'
        for key, prop in properties.items():
            if (key not in PROPERTY_UNITS or not prop.get('reference', '').strip()
                    or prop.get('unit') not in PROPERTY_UNITS[key]):
                missing.append('材料物性须有明确来源和单位：' + role + '.' + key)
                continue
            if type(prop.get('value')) not in (int, float) or not isfinite(prop['value']):
                issues.append({'field': 'material_properties.' + role + '.' + key, 'column': '',
                               'message': '物性须为有限数值，不接受字符串或布尔值。'})
                continue
            material[key] = prop['value']
            sources[pointer('materials', material['id'], key)] = _source(prop)
        try:
            materials.append(Material.model_validate(material).model_dump(mode='json'))
        except ValidationError as error:
            issues.append({'field': 'material_properties.' + role, 'column': '', 'message': str(error)[:500]})
    if missing or issues:
        return result

    by_role = dict(zip(roles, materials))
    conductor = {'material': by_role['conductor']['id'], 'form': form, 'nominal_area': values['area'],
                 'diameter': values['conductor_diameter'], 'r20': values['r20'],
                 'r20_basis': 'design' if series.get('resistance_basis') == 'standard_limit' else 'manufacturer_limit'}
    if conductor_class is not None:
        conductor['conductor_class'] = int(conductor_class)
    for key, target in [('conductor_wire_count', 'wire_count'), ('conductor_wire_diameter', 'wire_diameter')]:
        if key in values:
            conductor[target] = values[key]
    layers = []
    for role in roles[1:]:
        layer = {'role': 'bedding' if role == 'buffer' else role, 'material': by_role[role]['id'],
                 'thickness': values[DIMENSIONS[role]]}
        if role == 'metallic_sheath':
            layer['form'] = 'corrugated' if metal == 'corrugated_aluminium' else 'smooth'
            if metal == 'corrugated_aluminium':
                layer.update(corrugation_depth=values['corrugation_depth'], corrugation_pitch=values['corrugation_pitch'])
        layers.append(layer)
    rating = {'u0': series['u0_v'], 'u': series['u_v'], 'um': series.get('um_v'),
              'max_conductor_temperature': {'normal': normal}}
    if short is not None:
        rating['max_conductor_temperature']['short_circuit'] = short
    cable = {'id': 'cable_type/imported', 'label': name, 'construction': 'single_core', 'rating': rating,
             'cores': [{'id': 'core/imported', 'conductor': conductor, 'layers': layers, 'x': 0, 'z': 0}],
             'common_layers': []}
    try:
        typed = CableType.model_validate(cable)
    except ValidationError as error:
        issues.append({'field': 'structure', 'column': '', 'message': str(error)[:500]})
        return result
    diameter = typed.radius() * 2
    residual = values['outer_diameter'] - diameter
    result['closure'] = {'declared_mm': values['outer_diameter'] * 1000, 'listed_mm': diameter * 1000,
                         'residual_mm': residual * 1000, 'tolerance_mm': tolerance * 1000,
                         'residual_added_to_model': False}
    if abs(residual) > tolerance + 1e-12:
        issues.append({'field': 'outer_diameter', 'column': 'outer_diameter',
                       'message': f'明示层外径 {diameter * 1000:.6g} mm 与表列外径 {values["outer_diameter"] * 1000:.6g} mm 不闭合；未将差值填为包带。'})
        return result
    core_path = pointer('cable_type', 'cores', 'core/imported')
    for key, target in [('area', 'nominal_area'), ('conductor_diameter', 'diameter'), ('r20', 'r20'),
                        ('conductor_wire_count', 'wire_count'), ('conductor_wire_diameter', 'wire_diameter')]:
        if key in sources:
            sources[core_path + pointer('conductor', target)] = deepcopy(sources[key])
    for layer, role in zip(layers, roles[1:]):
        path = core_path + pointer('layers', layer['role'])
        sources[path + '/thickness'] = deepcopy(sources[DIMENSIONS[role]])
        if layer.get('form') == 'corrugated':
            for key in ('corrugation_depth', 'corrugation_pitch'):
                sources[path + '/' + key] = deepcopy(sources[key])
    sources[core_path + '/conductor/form'] = _source(modelling['conductor_form'])
    if conductor_class is not None:
        sources[core_path + '/conductor/conductor_class'] = _source(modelling['conductor_class'])
    for key, target in [('normal_temperature_k', 'normal'), ('short_circuit_temperature_k', 'short_circuit')]:
        if key in modelling:
            sources['/cable_type/rating/max_conductor_temperature/' + target] = _source(modelling[key])
    declaration = _source({'series_name': series['name'], 'manufacturer': series['manufacturer'],
        'designation': series['designation'], 'u0_v': series['u0_v'], 'u_v': series['u_v'],
        'um_v': series.get('um_v'), 'source': series.get('source'), 'parts': parts})
    sources['/cable_type/rating'] = declaration
    sources['/cable_type'] = _source({'method': METHOD, 'declaration': series,
        'coordinates': '单芯局部坐标原点，单位 m；坐标约定不是厂家测量。', 'closure': result['closure']}, kind='derived')
    result['payload'] = CableModelVersion.model_validate({'name': name, 'version': '1', 'confirmed': False,
        'cable_type': typed.model_dump(mode='json'), 'materials': materials, 'sources': sources}).model_dump(mode='json')
    if any(material['density'] is None for material in materials):
        result['warnings'].append('至少一种材料未声明密度；重量计算须明确拒绝缺项，不能用样本重量反推密度。')
    if any(material['volumetric_heat_capacity'] is None for material in materials):
        result['warnings'].append('材料热容尚未全部声明；暂态方法须拒绝缺项。')
    if metal == 'corrugated_aluminium':
        result['warnings'].append('仅保存波深、节距和材料事实；皱纹间隙及纵向电阻模型必须由对应方法另行明确。')
    return result
