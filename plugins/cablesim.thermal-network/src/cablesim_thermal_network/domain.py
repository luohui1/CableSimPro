"""The simplified method's deliberately narrow domain adapter (no inferred facts)."""
from math import isclose, pi

from .inputs import Scenario


def prepare(value, parameters):
    if value.get('schema_version') != 'cablesim.domain/1':
        return Scenario.model_validate(value)
    if len(value['circuits']) != 1 or len(value['sections']) != 1 or len(value['load_cases']) != 1:
        raise ValueError('简化参考仅支持单回路、单截面、单个稳态负荷')
    circuit, section, load = value['circuits'][0], value['sections'][0], value['load_cases'][0]
    if circuit['system']['kind'] != 'ac_three_phase' or load.get('profile'):
        raise ValueError('简化参考仅支持明确的三相稳态负荷')
    if section['kind'] != 'ground' or section['enclosures'] or load['kind'] != 'steady':
        raise ValueError('简化参考仅支持均匀土壤直埋稳态，无排管')
    types = {t['id']: t for t in value['cable_types']}
    cable = types[circuit['cable_type']]
    if cable['construction'] != 'single_core' or len(cable['cores']) != 1:
        raise ValueError('简化参考仅支持单芯电缆')
    if [c['phase'] for c in circuit['cables']] not in (['A', 'B', 'C'], ['L1', 'L2', 'L3']):
        raise ValueError('简化参考仅支持平衡三相且每相一根电缆')
    materials = {m['id']: m for m in value['materials']}
    core = cable['cores'][0]
    if core['x'] or core['z'] or core['conductor']['form'] not in ('unspecified', 'solid_round', 'stranded_round', 'stranded_round_compacted'):
        raise ValueError('简化参考不支持偏心或非圆形导体')
    layers = core['layers'] + cable['common_layers']
    roles = ['conductor_screen', 'insulation', 'insulation_screen', 'metallic_screen', 'oversheath']
    actual_roles = [l['role'] for l in layers]
    if len(actual_roles) == 5 and actual_roles[3] == 'metallic_sheath':
        actual_roles[3] = 'metallic_screen'
    if actual_roles != roles:
        raise ValueError('简化参考要求原六层同心结构，不支持铠装或额外层')
    by_role = dict(zip(roles, layers))
    insulation = materials[by_role['insulation']['material']]
    conductor = core['conductor']
    if conductor['r20'] is None:
        raise ValueError('领域研究需要明确 R20，不采用演示电阻')
    # These are explicit method assumptions, not material facts or labels.
    kind = parameters['conductor_kind']
    area = conductor['nominal_area'] * 1e6
    fill = conductor['nominal_area'] / (pi * (conductor['diameter']/2)**2)
    places = {p['cable']: p for p in section['placements']}
    if len(places) != 3 or len(section['placements']) != 3 or set(places) != {c['id'] for c in circuit['cables']}:
        raise ValueError('位置必须与三根电缆一一对应')
    ordered = [places[c['id']] for c in circuit['cables']]
    depth = -sum(p['z'] for p in ordered)/3
    if all(isclose(p['z'], ordered[0]['z'], abs_tol=1e-10) for p in ordered):
        arrangement, spacing = 'flat', ordered[1]['x']-ordered[0]['x']
    else:
        arrangement, spacing = 'trefoil', ordered[2]['x']-ordered[1]['x']
    data = {'name': value['name'], 'cable': {'name': cable['label'], 'conductor': kind,
            'area_mm2': area, 'fill_factor': fill, 'r20_ohm_km': conductor['r20']*1000,
            'conductor_screen_mm': layers[0]['thickness']*1000, 'insulation_mm': layers[1]['thickness']*1000,
            'insulation_screen_mm': layers[2]['thickness']*1000, 'metallic_screen_mm': layers[3]['thickness']*1000,
            'jacket_mm': layers[4]['thickness']*1000, 'insulation_rho_k_m_w': insulation['thermal_resistivity'],
            'jacket_rho_k_m_w': materials[layers[4]['material']]['thermal_resistivity'],
            'semicon_rho_k_m_w': materials[layers[0]['material']]['thermal_resistivity'],
            'u0_kv': cable['rating']['u0']/1000, 'frequency_hz': circuit['system']['frequency'],
            'relative_permittivity': insulation['relative_permittivity'], 'tan_delta': insulation['loss_tangent'],
            'ac_extra_factor': parameters['ac_extra_factor'], 'screen_loss_factor': parameters['screen_loss_factor'],
            'max_temperature_c': value['criteria'].get('max_conductor_temperature', cable['rating']['max_conductor_temperature']['normal'])-273.15},
            'installation': {'arrangement': arrangement, 'depth_m': depth, 'spacing_m': spacing,
                'ambient_temperature_c': section['medium']['surface_temperature']-273.15,
                'soil_rho_k_m_w': materials[section['medium']['material']]['thermal_resistivity']},
            'operating_current_a': load['currents'][circuit['id']], 'circuit_length_m': section['length']}
    result = Scenario.model_validate(data)
    if materials[layers[2]['material']]['thermal_resistivity'] != data['cable']['semicon_rho_k_m_w']:
        raise ValueError('此简化方法要求两层半导电材料热阻率一致')
    origin = sum(p['x'] for p in ordered)/3
    if any(not isclose(x+origin,p['x'],abs_tol=1e-9) or not isclose(-z,p['z'],abs_tol=1e-9)
           for (x,z),p in zip(result.installation.positions_m(),ordered)):
        raise ValueError('坐标不是受支持的平排或等边品字形，不能按模板覆盖坐标')
    return result
