"""IEC-specific SI mapping; empirical parameters are always explicitly supplied."""
from math import hypot, isclose
from .inputs import Rating


def prepare(value, p):
    if value.get('schema_version') != 'cablesim.domain/1':
        return Rating.model_validate(value)
    from .group_inputs import prepare_group
    return prepare_group(value, p)


def prepare_contact_legacy(value, p):
    """Retained mapping for controlled historical touching-trefoil fixtures."""
    if any(len(value[k]) != 1 for k in ('circuits', 'sections', 'load_cases')):
        raise ValueError('IEC 子集仅支持单回路、单截面、单个稳态负荷')
    circuit, section, load = value['circuits'][0], value['sections'][0], value['load_cases'][0]
    if section.get('backfill') or section.get('soil_layers'):
        raise ValueError('IEC 当前子集仅支持均匀土壤；回填区或土壤分层计算尚未接入。请在敷设截面关闭介质分区，或选择支持分区的方法。')
    if circuit['bonding']['kind'] not in ('both_ends', 'single_point'):
        raise ValueError('IEC 当前能力需要明确护套两端接地或单点接地；请在工况中补齐，不从未知接地方案推断。')
    if circuit['system']['kind'] != 'ac_three_phase' or load['kind'] != 'steady' or section['kind'] != 'ground':
        raise ValueError('IEC 子集仅支持三相地下稳态')
    cable = next(t for t in value['cable_types'] if t['id'] == circuit['cable_type'])
    if cable['construction'] != 'single_core' or len(circuit['cables']) != 3:
        raise ValueError('IEC 子集仅支持三根单芯电缆')
    core = cable['cores'][0]
    if len(cable['cores']) != 1 or core['x'] or core['z'] or load.get('profile'):
        raise ValueError('不支持偏心、多芯或时变负荷')
    if {c['phase'] for c in circuit['cables']} not in ({'A', 'B', 'C'}, {'L1', 'L2', 'L3'}):
        raise ValueError('需要完整且唯一的三相')
    cond = core['conductor']
    if cond['form'] not in ('stranded_round', 'stranded_round_compacted'):
        raise ValueError('不支持该导体结构')
    layers = core['layers'] + cable['common_layers']
    if [l['role'] for l in layers] != ['conductor_screen', 'insulation', 'insulation_screen', 'metallic_sheath', 'oversheath'] or layers[3]['form'] != 'smooth':
        raise ValueError('需要明确的光滑管状金属护套；不能从未知屏蔽结构推断')
    materials = {m['id']: m for m in value['materials']}
    cm, lm = materials[cond['material']], [materials[l['material']] for l in layers]
    spacing = cond['diameter'] + 2*sum(l['thickness'] for l in layers)
    points = section['placements']
    if len(points) != 3 or {q['cable'] for q in points} != {c['id'] for c in circuit['cables']}:
        raise ValueError('不能忽略额外电缆')
    duct = None
    if section['enclosures']:
        ducts = section['enclosures']
        if len(ducts) != 3 or any(d['type'] != 'duct' or len(d['contains']) != 1 for d in ducts):
            raise ValueError('只支持每根一管的三个相同管道')
        first = ducts[0]
        if {d['contains'][0] for d in ducts} != {c['id'] for c in circuit['cables']}:
            raise ValueError('管道必须与电缆一一对应')
        if any((d['inner_diameter'],d['outer_diameter'],d['material']) != (first['inner_diameter'],first['outer_diameter'],first['material']) for d in ducts):
            raise ValueError('管道必须相同')
        if set(p['duct']) - {'u', 'v', 'y_per_k', 'initial_mean_air_temperature_c'}:
            raise ValueError('排管参数只允许经验系数和初始温度，不能覆盖结构事实')
        duct = {**p['duct'], 'inner_diameter_m': first['inner_diameter'], 'outer_diameter_m': first['outer_diameter'],
                'rho_k_m_w': materials[first['material']]['thermal_resistivity']}
        spacing = first['outer_diameter']
        for d in ducts:
            q = next(q for q in points if q['cable'] == d['contains'][0])
            if not isclose(q['x'],d['x'],abs_tol=1e-10) or not isclose(q['z'],d['z'],abs_tol=1e-10):
                raise ValueError('此子集要求电缆与管中心重合')
    if any(not isclose(hypot(a['x']-b['x'],a['z']-b['z']), spacing, rel_tol=1e-8)
           for i,a in enumerate(points) for b in points[i+1:]):
        raise ValueError('只支持接触品字形排列')
    return Rating.model_validate({'frequency_hz': circuit['system']['frequency'], 'phase_voltage_v': cable['rating']['u0'],
        'max_conductor_temperature_c': value['criteria'].get('max_conductor_temperature',cable['rating']['max_conductor_temperature']['normal'])-273.15,
        'conductor': {'diameter_m': cond['diameter'], 'r20_ohm_m': cond['r20'], 'alpha20_per_k': cm['temperature_coefficient_20'], 'ks': p['ks'], 'kp': p['kp']},
        'insulation': {'inner_screen_thickness_m': layers[0]['thickness'], 'thickness_m': layers[1]['thickness'],
                       'outer_screen_thickness_m': layers[2]['thickness'], 'relative_permittivity': lm[1]['relative_permittivity'], 'tan_delta': lm[1]['loss_tangent'],
                       'inner_screen_rho_k_m_w': lm[0]['thermal_resistivity'], 'rho_k_m_w': lm[1]['thermal_resistivity'], 'outer_screen_rho_k_m_w': lm[2]['thermal_resistivity']},
        'sheath': {'thickness_m': layers[3]['thickness'], 'resistivity20_ohm_m': lm[3]['electrical_resistivity_20'], 'alpha20_per_k': lm[3]['temperature_coefficient_20']},
        'oversheath': {'thickness_m': layers[4]['thickness'], 'rho_k_m_w': lm[4]['thermal_resistivity']},
        'installation': {'environment': 'buried_ducts' if duct else 'direct_buried', 'depth_m': -sum(q['z'] for q in points)/3,
                         'soil_rho_k_m_w': materials[section['medium']['material']]['thermal_resistivity'],
                         'ambient_temperature_c': section['medium']['surface_temperature']-273.15, 't4_form': None if duct else p['t4_form'], 'duct': duct},
        'bonding': {'scheme': circuit['bonding']['kind'], 'eddy': p['eddy']}, 'solver': p['solver']})
