"""Bundled cable library: declared teaching structures and public manufacturer tables.

Nothing here is a manufacturer certification. Every entry states where its numbers
come from and which of them are assumptions; ratings are always computed by a plugin.
The teaching structures are carried over unchanged from the CableSimPro system
catalogue; the manufacturer tables are read from the files that catalogue shipped.
"""
from copy import deepcopy
from functools import lru_cache
from hashlib import sha256
import json
from math import sqrt

from cablesim_sdk.domain import CableType, Material
from . import CoreError, REPO
from . import runner

SERIES = REPO / 'backend/kernel/model_series_data'
IEC = 'cablesim.iec60287'
# Skin and proximity coefficients, the duct air-gap constants and the solver controls are
# method inputs that the plugin requires explicitly; these are the declared defaults.
METHOD_DEFAULTS = {
    'ks': 1.0, 'kp': 1.0, 't4_form': 'exact', 'eddy': 'ignored',
    'duct': {'u': 1.87, 'v': .312, 'y_per_k': .0037, 'initial_mean_air_temperature_c': 40.0},
    'solver': {'initial_sheath_temperature_c': 70.0, 'current_tolerance_a': 1e-8, 'max_iterations': 300},
}
DIELECTRIC_REFERENCE = ('IEC 60287-1-1:2023 Table 3，PDF43/印刷41页：未填充XLPE，U0≤18 kV档，εr=2.5、tanδ=0.004；'
                        '标准参考值，非厂家实测。')


def fingerprint(payload):
    return sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def _validated(cable, materials):
    return {'cable_type': CableType.model_validate(cable).model_dump(mode='json', exclude_none=True),
            'materials': [Material.model_validate(m).model_dump(mode='json', exclude_none=True) for m in materials]}


def _single_core(label, area_mm2, diameter, r20, rating, thicknesses, *, form='stranded_round', loss_tangent=.001,
                 sheath=None, oversheath_rho=3.5):
    materials = [
        {'id': 'material/cu', 'label': '铜', 'category': 'conductor', 'temperature_coefficient_20': .00393},
        {'id': 'material/semi', 'label': '半导电材料', 'category': 'semiconductor', 'thermal_resistivity': 2.5},
        {'id': 'material/xlpe', 'label': 'XLPE', 'category': 'insulation', 'thermal_resistivity': 3.5,
         'relative_permittivity': 2.5, 'loss_tangent': loss_tangent},
        sheath or {'id': 'material/al-sheath', 'label': '铝护套', 'category': 'metal', 'thermal_resistivity': .004,
                   'electrical_resistivity_20': 2.84e-8, 'temperature_coefficient_20': .00403},
        {'id': 'material/pvc', 'label': 'PVC 外护套', 'category': 'polymer', 'thermal_resistivity': oversheath_rho},
    ]
    roles = ['conductor_screen', 'insulation', 'insulation_screen', 'metallic_sheath', 'oversheath']
    ids = ['material/semi', 'material/xlpe', 'material/semi', materials[3]['id'], 'material/pvc']
    layers = [{'role': role, 'material': material, 'thickness': thickness,
               **({'form': 'smooth'} if role == 'metallic_sheath' else {})}
              for role, material, thickness in zip(roles, ids, thicknesses)]
    cable = {'id': 'cable_type/ct1', 'label': label, 'construction': 'single_core',
             'rating': {**rating, 'max_conductor_temperature': {'normal': 363.15}},
             'cores': [{'id': 'core/1', 'x': 0.0, 'z': 0.0, 'layers': [],
                        'conductor': {'material': 'material/cu', 'form': form, 'nominal_area': area_mm2 * 1e-6,
                                      'diameter': diameter, 'r20': r20}}],
             'common_layers': layers}
    return _validated(cable, materials)


def _entry(model_id, version, name, family, state, source, payload, **extra):
    cable = payload['cable_type']
    core = cable['cores'][0]
    return {'id': model_id, 'version': version, 'name': name, 'family': family, 'state': state, 'source': source,
            'content_sha256': fingerprint(payload), 'payload': payload,
            'method_defaults': deepcopy(METHOD_DEFAULTS), 'method_parameters': extra.get('method_parameters', {}),
            'summary': {'construction': cable['construction'], 'cores': len(cable['cores']),
                        'area_mm2': round(core['conductor']['nominal_area'] * 1e6, 3),
                        'u0_v': cable['rating']['u0'], 'u_v': cable['rating'].get('u'),
                        'outer_diameter_m': 2 * CableType.model_validate(cable).radius(),
                        'r20_ohm_m': core['conductor'].get('r20')}}


def _teaching():
    taikai = ('型号代号依据：山东泰开官方目录铜芯栏为 YJL02，铝芯栏为 YJLL02。YJ 为 XLPE 绝缘；铜导体代号省略；'
              'L 为平滑铝套；02 为 PVC 外套。目录产品为 66–500 kV，本 12/20 kV 结构为演示输入，并非该厂此规格产品数据；'
              '尺寸与物性为明示假设。 https://www.taikaidianlan.com/index.php?c=show&id=211；' + DIELECTRIC_REFERENCE)
    medium = {'u0': 12000.0, 'u': 20000.0, 'um': 24000.0}
    entries = []
    for area, diameter, r20 in [(240, .0185, 7.54e-5), (400, .025, 4.7e-5)]:
        name = f'YJL02-12/20 kV 1×{area}（结构演示）'
        entries.append(_entry(f'system.cu-xlpe-al-{area}', '1.0.2', name, 'YJL02-12/20 kV 单芯', 'demo', taikai,
                              _single_core(name, area, diameter, r20, medium, [.0006, .0055, .0007, .0008, .0025],
                                           loss_tangent=.004)))
    name = '6/10 kV 1×240 光滑管套校核模型（结构演示）'
    entries.append(_entry(
        'system.cu-xlpe-10kv-240', '1.0.1', name, '6/10 kV 单芯', 'demo',
        'Tratos 官方 6/10 kV 结构表：铜 240 mm² 导体参考直径 18.2 mm、绝缘 3.4 mm、R20 0.0754 Ω/km。'
        '厂家产品为铜丝屏蔽；此校核模型使用明示的 0.8 mm 光滑铝管套及 2.0 mm PVC 外套，不能视为该厂产品。'
        ' https://tratosgroup.com/wp-content/uploads/2020/06/XLPE-Medium-Tension-Cable-mod2.pdf；' + DIELECTRIC_REFERENCE,
        _single_core(name, 240, .0182, 7.54e-5, {'u0': 6000.0, 'u': 10000.0, 'um': 12000.0},
                     [.0006, .0034, .0007, .0008, .0020], loss_tangent=.004, oversheath_rho=5.0)))
    name = 'YJQ02-64/110 kV 1×800（典型结构演示）'
    lead = {'id': 'material/pb-sheath', 'label': '铅护套', 'category': 'metal', 'thermal_resistivity': .028,
            'electrical_resistivity_20': 2.14e-7, 'temperature_coefficient_20': .004, 'density': 11340.0}
    entries.append(_entry(
        'system.yjq02-110kv-800', '1.0.0', name, '64/110 kV 单芯', 'demo',
        '型号系列来自中环特种电缆的高压产品目录；800 mm² 导体设计包络直径采用 34.0 mm，R20 0.0221 Ω/km，'
        '参考皖特缆 64/110 kV 产品导体表（跨护套系列参考，不是本型号完整厂家数据）。'
        '其余尺寸、物性和制造参数为明示假设，不能用于实际产品选型。 http://www.zhtzdl.com/cable/gaoya/97.html',
        _single_core(name, 800, .034, 2.21e-5, {'u0': 64000.0, 'u': 110000.0, 'um': 123000.0},
                     [.001, .016, .001, .0029, .004], form='stranded_round_compacted', sheath=lead)))
    return entries


def _three_core_teaching():
    """Public YJV22 3×300 dimensions with explicitly given manufacturing inputs."""
    name = 'YJV22-8.7/15 kV 3×300（公开结构 + 明示工程参数）'
    materials = [
        {'id': 'material/cu', 'label': '铜', 'category': 'conductor', 'standard_kind': 'copper_bare', 'density': 8900,
         'electrical_resistivity_20': 1.7241e-8, 'temperature_coefficient_20': .00393},
        {'id': 'material/semi', 'label': '半导电材料', 'category': 'semiconductor', 'standard_kind': 'other',
         'density': 1100, 'thermal_resistivity': 2.5},
        {'id': 'material/xlpe', 'label': '交联聚乙烯', 'category': 'insulation', 'standard_kind': 'XLPE', 'density': 920,
         'thermal_resistivity': 3.5, 'relative_permittivity': 2.5, 'loss_tangent': .004},
        {'id': 'material/filler', 'label': '纤维填充料', 'category': 'filler', 'standard_kind': 'other', 'density': 1100,
         'thermal_resistivity': 6},
        {'id': 'material/pvc', 'label': '聚氯乙烯', 'category': 'polymer', 'standard_kind': 'PVC', 'density': 1400,
         'thermal_resistivity': 6},
        {'id': 'material/steel', 'label': '镀锌钢带', 'category': 'metal', 'standard_kind': 'steel_galvanized',
         'density': 7850, 'relative_permeability': 300},
    ]
    cores = []
    for index, (x, z) in enumerate([(0, .033 / sqrt(3)), (-.0165, -.033 / (2 * sqrt(3))), (.0165, -.033 / (2 * sqrt(3)))]):
        cores.append({
            'id': f'core/{index + 1}', 'x': x, 'z': z,
            'conductor': {'material': 'material/cu', 'form': 'stranded_round_compacted', 'nominal_area': .0003,
                          'diameter': .0206, 'r20': 6.01e-5, 'r20_basis': 'design', 'conductor_class': 2, 'lay_factor': 1.02},
            'layers': [{'role': role, 'material': material, 'thickness': thickness} for role, material, thickness in [
                ('conductor_screen', 'material/semi', .0008), ('insulation', 'material/xlpe', .0045),
                ('insulation_screen', 'material/semi', .0007)]] + [
                {'role': 'metallic_screen', 'material': 'material/cu', 'form': 'tape', 'thickness': .0002,
                 'nominal_tape_thickness': .0001, 'tape_width': .04, 'tape_count': 1, 'overlap': .15,
                 'tape_application': 'helical_overlap', 'longitudinal_r20': .0014249338001803575,
                 'longitudinal_resistance_basis': 'dc'}]})
    cable = {'id': 'cable_type/ct1', 'label': name, 'construction': 'three_core', 'core_lay_length': 2.152,
             'rating': {'u0': 8700, 'u': 15000, 'um': 17500,
                        'max_conductor_temperature': {'normal': 363.15, 'short_circuit': 523.15}},
             'cores': cores, 'common_layers': [
                 {'role': 'filler', 'material': 'material/filler', 'thickness': .0002},
                 {'role': 'bedding', 'material': 'material/pvc', 'form': 'smooth', 'thickness': .002},
                 {'role': 'armour', 'material': 'material/steel', 'form': 'tape', 'thickness': .0016,
                  'nominal_tape_thickness': .0008, 'tape_count': 2, 'tape_width': .06, 'tape_gap': .03,
                  'tape_application': 'two_tape_gap'},
                 {'role': 'oversheath', 'material': 'material/pvc', 'form': 'smooth', 'thickness': .0037}]}
    return _entry(
        'system.yjv22-15kv-300', '1.0.0', name, 'YJV22-8.7/15 kV 三芯', 'demo',
        '公开结构：江苏华远YJV22 8.7/15kV结构表3×300行，http://jshydlyxgs.com/showproduct.asp?id=49；'
        '2026-10-04下载，SHA256 e1eb8537ee1a836abbadb64415fd0838fe03d8d9a30e655bf3c0656b2b8bd957。'
        '铜带连续接触与15%搭盖、导体1.02绞入系数、材料密度及镀锌钢带材质为设计假设；'
        '成缆节距2.152m与钢带相对磁导率300分别参考TB880 Case2/10，非本型号实测；'
        'R20取GB/T3956表2的设计上限，非测量值；材料热电参数采用IEC60287参考输入。',
        _validated(cable, materials))


def _qifan():
    raw = (SERIES / 'qifan_yjlw03.json').read_bytes()
    data = json.loads(raw)
    model = data['model']
    sources = data['sources']
    return _entry(
        data['id'], data['version'], data['name'], '64/110 kV 单芯', 'public',
        '；'.join([sources['factory']['reference'], sources['installed_dimensions']['reference'],
                  sources['standard']['reference'], sources['geometry_reference']['reference'],
                  sources['buffer_reference']['reference'],
                  f"资料包 {data['id']} {data['version']} sha256:{sha256(raw).hexdigest()}；{data['scope']}"]),
        _validated(model['cable_type'], model['materials']),
        method_parameters={'corrugated_gap': deepcopy(data['parameters']['corrugated_gap'])})


def _huayuan_specifications():
    """Public YJV22 8.7/15 kV three-core rows, converted to SI with their sources."""
    raw = (SERIES / 'huayuan_yjv22.json').read_bytes()
    data = json.loads(raw)
    factory, resistance = data['sources']['factory'], data['sources']['r20']
    units = {'mm': (.001, 'm'), 'mm2': (1e-6, 'm2'), 'ohm/km': (.001, 'ohm/m'), '1': (1, '1')}
    for row in data['rows']:
        facts = {key: (value, unit) for (key, unit), value in zip(data['columns'], row)}
        area = facts.pop('area')[0]
        facts = {**{key: tuple(item) for key, item in data['common_manufacturer_values'].items()}, **facts}
        values = {}
        for key, (value, unit) in facts.items():
            scale, target = units[unit]
            values[key] = {'value': value * scale, 'unit': target,
                           'basis': 'standard_limit' if key == 'r20' else 'manufacturer',
                           'source': 'r20' if key == 'r20' else 'factory'}
        yield area, {
            'schema_version': 'cablesim.product-specification/1',
            'name': f'YJV22-8.7/15 kV 3×{area}', 'version': data['version'], 'confirmed': False,
            'specification': {'manufacturer': data['manufacturer'], 'designation': data['designation'],
                              'u0_v': data['u0_v'], 'voltage_v': data['voltage_v'], 'cores': 3, 'area_m2': area * 1e-6,
                              'conductor': 'copper_bare', 'values': values,
                              'missing': ['三芯成缆位置及节距', '铜带接触/径向包络', '填料热阻率', '钢带间隙及磁导率']},
            'sources': {
                'factory': {'kind': 'manufacturer', 'reviewed': False, 'reference':
                            f"{factory['title']}；{factory['location']}；3×{area}行；{factory['url']}；"
                            f"下载{factory['downloaded']}；sha256:{factory['sha256']}"},
                'r20': {'kind': 'standard', 'reviewed': False, 'reference':
                        f"{resistance['title']}；{area} mm²标准上限；sha256:{resistance['sha256']}"},
                'bundle': {'kind': 'asset', 'reviewed': False, 'reference':
                           f"随附资料包 {data['id']} {data['version']}；sha256:{sha256(raw).hexdigest()}；"
                           '非厂家试验认证，未批准型号。'}}}, data


def _huayuan_series():
    """The plugin's model-completion turns each public row into a rateable structure.

    Laying length, tape contact model, filler resistivity, armour gap and steel
    permeability are not in the manufacturer's table; they are the engineer-given
    reference inputs recorded in the series file and repeated in each entry's source.
    """
    rows = list(_huayuan_specifications())
    parameters = rows[0][2]['engineering_scenario']['parameters']
    scope = rows[0][2]['engineering_scenario']['scope']
    result = runner.run(IEC, 'model-completion', [
        {'case_id': f'yjv22-{area}', 'input': spec, 'parameters': deepcopy(parameters)} for area, spec, _ in rows])
    entries = []
    for (area, spec, _), case in zip(rows, result['cases']):
        if case['status'] != 'succeeded':
            continue  # an incomplete public row stays out of the library rather than being patched
        model = case['artifacts']['x-cablesim.engineering-model']
        cable = deepcopy(model['cable_type'])
        cable['id'] = 'cable_type/ct1'
        given = '；'.join(f"{key}={item['value']}（{item['reference']}）" for key, item in parameters['values'].items())
        entries.append(_entry(
            f'huayuan.yjv22-15kv-{area}', spec['version'], f"华远 {spec['name']}", 'YJV22-8.7/15 kV 三芯（华远公开表）',
            'public',
            '；'.join(item['reference'] for item in spec['sources'].values()) + '；' + scope + ' 工程师给定参数：' + given
            + f"；由 {IEC} {result['plugin_version']} model-completion 推导，径向尺寸闭合已核对。",
            _validated(cable, model['materials']),
            method_parameters={}))
    return entries


@lru_cache(maxsize=1)
def _entries():
    entries = _teaching() + [_qifan(), _three_core_teaching()] + _huayuan_series()
    if len({entry['id'] for entry in entries}) != len(entries):
        raise CoreError('LIBRARY_INVALID', '型号库条目标识重复。')
    return entries


def entries():
    return deepcopy(_entries())


def get(model_id, content_sha256=None):
    entry = next((item for item in _entries() if item['id'] == model_id), None)
    if entry is None:
        raise CoreError('MODEL_UNKNOWN', f'型号库中没有 {model_id}。', '/cable/library_id')
    if content_sha256 is not None and entry['content_sha256'] != content_sha256:
        raise CoreError('MODEL_CHANGED', '型号内容已变化，请重新选择；未更新任何输入。', '/cable/content_sha256')
    return deepcopy(entry)
