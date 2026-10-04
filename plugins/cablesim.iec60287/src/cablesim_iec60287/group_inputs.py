"""Validated SI mapping for N underground heat sources.

Automatic electrical losses use isolated balanced three-phase circuit formulas.
An arbitrary/unbalanced arrangement requires explicit per-cable AC and sheath
loss factors and their source, never a fabricated electrical approximation.
"""
from dataclasses import dataclass
from math import acosh, hypot, isclose, isfinite, log, pi

from .inputs import Rating
from .method import geometry, RatingRefused
from .soil import resistance_matrix


@dataclass
class GroupRating:
    document: dict
    parameters: dict
    cables: list
    circuits: list
    matrix: list
    soil: dict
    ambient: float

    def model_dump(self, **kwargs):
        return {'schema_version': 'cablesim.iec60287.group/1',
                'document': self.document, 'parameters': self.parameters}


def physical(value, p, circuit, cable, point, duct, materials, section):
    if cable['construction'] != 'single_core' or len(cable['cores']) != 1:
        raise ValueError('当前电损耗模型只支持单芯圆形电缆；多芯请改用专门方法。')
    core = cable['cores'][0]
    cond, layers = core['conductor'], core['layers']+cable['common_layers']
    if core['x'] or core['z'] or cond['form'] not in ('stranded_round', 'stranded_round_compacted'):
        raise ValueError('当前模型要求同心圆绞线导体；分割导体或偏心结构请改用专门方法。')
    if [l['role'] for l in layers] != ['conductor_screen','insulation','insulation_screen','metallic_sheath','oversheath'] or layers[3]['form'] != 'smooth':
        raise ValueError('需要明确光滑管状金属护套；铜丝屏蔽、铠装或皱纹护套请改用专门方法。')
    cm, lm = materials[cond['material']], [materials[l['material']] for l in layers]
    dp = None
    if duct:
        constants = p.get('duct', {})
        if set(constants)-{'u','v','y_per_k','initial_mean_air_temperature_c'}:
            raise ValueError('管道经验参数不能覆盖结构事实。')
        dp = {**constants, 'inner_diameter_m': duct['inner_diameter'], 'outer_diameter_m': duct['outer_diameter'],
              'rho_k_m_w': materials[duct['material']]['thermal_resistivity']}
    # The physical layer contract is shared with the previously verified method.
    # Arrangement-specific thermal/electrical formulas are applied by group.py.
    return Rating.model_validate({
        'frequency_hz': circuit['system']['frequency'], 'phase_voltage_v': cable['rating']['u0'],
        'max_conductor_temperature_c': value['criteria'].get('max_conductor_temperature', cable['rating']['max_conductor_temperature']['normal'])-273.15,
        'conductor': {'diameter_m': cond['diameter'], 'r20_ohm_m': cond['r20'], 'alpha20_per_k': cm['temperature_coefficient_20'], 'ks': p['ks'], 'kp': p['kp']},
        'insulation': {'inner_screen_thickness_m': layers[0]['thickness'], 'thickness_m': layers[1]['thickness'], 'outer_screen_thickness_m': layers[2]['thickness'],
                       'relative_permittivity': lm[1]['relative_permittivity'], 'tan_delta': lm[1]['loss_tangent'],
                       'inner_screen_rho_k_m_w': lm[0]['thermal_resistivity'], 'rho_k_m_w': lm[1]['thermal_resistivity'], 'outer_screen_rho_k_m_w': lm[2]['thermal_resistivity']},
        'sheath': {'thickness_m': layers[3]['thickness'], 'resistivity20_ohm_m': lm[3]['electrical_resistivity_20'], 'alpha20_per_k': lm[3]['temperature_coefficient_20']},
        'oversheath': {'thickness_m': layers[4]['thickness'], 'rho_k_m_w': lm[4]['thermal_resistivity']},
        'installation': {'environment': 'buried_ducts' if duct else 'direct_buried', 'depth_m': -point['z'],
                         'soil_rho_k_m_w': materials[section['medium']['material']]['thermal_resistivity'],
                         'ambient_temperature_c': section['medium']['surface_temperature']-273.15,
                         't4_form': None if duct else 'exact', 'duct': dp},
        # The legacy physical contract requires an eddy branch for single-point
        # bonding. In supplied-loss mode this selector is never evaluated:
        # group._loss_factors uses the sourced lambda1 instead.
        'bonding': {'scheme': circuit['bonding']['kind'],
                    'eddy': 'trefoil' if 'per_cable_losses' in p and circuit['bonding']['kind'] == 'single_point' else p['eddy']},
        'solver': p['solver']})


def prepare_group(value, p):
    basis = p.get('reference_basis', 'iec2023')
    if basis not in ('iec2023', 'tb880_reference'):
        raise ValueError('reference_basis 必须为 iec2023 或 tb880_reference。')
    if basis == 'tb880_reference' and len(value['circuits']) != 1:
        raise RatingRefused('TB880_REFERENCE_SCOPE', 'TB880 旧版公式复现仅用于单回路验证，不能作为多回路工程计算。')
    if basis == 'iec2023' and p.get('t4_form', 'exact') != 'exact':
        raise RatingRefused('T4_APPROXIMATION_SUPERSEDED', 'IEC 60287-2-1:2023 已停用 ln(2u) 近似；请将 t4_form 改为 exact。')
    if len(value['sections']) != 1 or len(value['load_cases']) != 1:
        raise ValueError('每次稳态研究需选定一个截面和一个负荷工况。')
    section, load = value['sections'][0], value['load_cases'][0]
    if section['kind'] != 'ground' or load['kind'] != 'steady' or load.get('profile'):
        raise ValueError('此 IEC 方法支持地下稳态；空气、隧道和时变负荷请使用对应方法。')
    if section.get('soil_layers'):
        raise RatingRefused('SOIL_LAYERS_NOT_SUPPORTED', '分层土壤超出此 IEC 镜像法范围；请使用数值热传导 / 有限元仿真插件。')
    materials = {m['id']: m for m in value['materials']}
    types = {t['id']: t for t in value['cable_types']}
    points = {q['cable']: q for q in section['placements']}
    enclosures = {d['id']: d for d in section['enclosures']}
    if any(d['type'] != 'duct' or len(d['contains']) != 1 for d in enclosures.values()):
        raise ValueError('支持每根电缆一管；包封区请用截面中的矩形回填区表示，多管共腔请改用数值方法。')
    explicit = p.get('per_cable_losses', {})
    explicit_mode = 'per_cable_losses' in p
    if len(value['circuits']) > 1 and not explicit_mode:
        raise RatingRefused('MULTICIRCUIT_ELECTRICAL_MODEL_REQUIRED',
                            '多回路不能套用 IEC 60287-1-1 单回路电损耗公式；请在 per_cable_losses 填齐有来源的逐电缆交流与护套损耗系数，并填写 loss_input_source，或改用适用的电磁计算方法。')
    if explicit_mode and not str(p.get('loss_input_source') or '').strip():
        raise ValueError('逐电缆损耗系数必须注明测量、厂家或电磁计算来源。')
    cables, circuits = [], []
    for circuit in value['circuits']:
        if circuit['bonding']['kind'] not in ('both_ends','single_point') or circuit['system']['kind'] != 'ac_three_phase':
            raise ValueError('自动电损耗模型只支持三相交流、两端或单点接地；交叉互联请使用专门电损耗模型。')
        indices = []
        for instance in circuit['cables']:
            cid = instance['id']
            if cid not in points:
                raise ValueError('截面缺少电缆位置，不能忽略热源。')
            q = points[cid]
            duct = enclosures.get(q.get('enclosure'))
            if q.get('enclosure') and not duct or duct and duct['contains'] != [cid]:
                raise ValueError('电缆与管道必须一一对应。')
            if duct and (not isclose(q['x'],duct['x'],abs_tol=1e-10) or not isclose(q['z'],duct['z'],abs_tol=1e-10)):
                raise ValueError('管内经验式要求电缆与管道同心；偏心请改用数值方法。')
            current = load['currents'].get(cid, load['currents'].get(circuit['id']))
            if current is None or not isfinite(current) or current < 0:
                raise ValueError('每根电缆必须有明确的非负负荷电流。')
            r = physical(value,p,circuit,types[circuit['cable_type']],q,duct,materials,section)
            g = geometry(r)
            if duct and not .025 <= g.overall_m <= .1:
                raise RatingRefused('DUCT_AIR_FORMULA_OUT_OF_RANGE', '管内空气经验式适用于外径 25–100 mm 的单根电缆；请改用数值方法。')
            factors = explicit.get(cid)
            if explicit_mode and factors is None:
                raise ValueError('逐电缆损耗模式尚未填齐所有电缆的交流与护套损耗系数。')
            if factors is not None and (set(factors) != {'ac_extra_factor','lambda1'} or any(not isinstance(v,(float,int)) or isinstance(v,bool) or not isfinite(v) or v < 0 for v in factors.values())):
                raise ValueError('逐电缆损耗输入需要非负有限 ac_extra_factor 和 lambda1。')
            indices.append(len(cables))
            cables.append({'id': cid,'phase': instance['phase'],'circuit': circuit['id'], 'point': (q['x'],q['z']),
                           'rating': r,'geometry': g,'current': current,'duct': duct,'factors': factors})
        coords = [cables[i]['point'] for i in indices]
        distances = sorted(hypot(a[0]-b[0],a[1]-b[1]) for i,a in enumerate(coords) for b in coords[i+1:])
        phases = {cables[i]['phase'] for i in indices}
        arrangement, spacing = None, None
        if len(indices) == 3 and phases in ({'A','B','C'}, {'L1','L2','L3'}):
            if isclose(distances[0],distances[-1],rel_tol=1e-7):
                arrangement, spacing = 'trefoil', distances[0]
            elif isclose(distances[0],distances[1],rel_tol=1e-7) and isclose(distances[-1],2*distances[0],rel_tol=1e-7):
                arrangement, spacing = 'flat', distances[0]
        automatic = not all(cables[i]['factors'] is not None for i in indices)
        if automatic and (not arrangement or any(cables[i]['factors'] is not None for i in indices)):
            raise ValueError('该回路布置不满足 IEC 自动电损耗公式；请逐根提供有来源的交流与护套损耗系数，或使用电磁仿真方法。')
        if automatic and len({cables[i]['current'] for i in indices}) != 1:
            raise ValueError('自动电损耗公式要求回路内三相平衡；各回路可不同负荷。不平衡三相需逐根提供有来源的损耗系数。')
        if automatic and circuit['bonding'].get('transposed') and (circuit['bonding']['kind'] != 'both_ends' or p['eddy'] != 'ignored'):
            raise RatingRefused('TRANSPOSED_EDDY_NOT_VERIFIED', '换位排列的单点接地或涡流分支未验证；请提供有来源的逐电缆损耗系数或使用适用的电磁方法。')
        circuits.append({'id': circuit['id'],'label': circuit['label'],'indices': indices,'arrangement': arrangement,
                         'spacing': spacing,'automatic': automatic,'transposed': circuit['bonding'].get('transposed',False)})
    if set(points) != {c['id'] for c in cables} or set(explicit)-set(points):
        raise ValueError('不能忽略额外电缆或引用未知电缆损耗。')
    backfill = section.get('backfill')
    if backfill:
        backfill = {**backfill, 'rho': materials[backfill['material']]['thermal_resistivity']}
    rho = materials[section['medium']['material']]['thermal_resistivity']
    radii = [c['rating'].installation.duct.outer_diameter_m/2 if c['duct'] else c['geometry'].overall_m/2 for c in cables]
    contact = len(circuits) == 1 and circuits[0]['arrangement'] == 'trefoil' and isclose(circuits[0]['spacing'], 2*radii[0], rel_tol=1e-8)
    if contact and not backfill and circuits[0]['automatic']:
        depth = -sum(c['point'][1] for c in cables)/3
        u = depth/radii[0]
        term = log(2*u) if basis == 'tb880_reference' and (cables[0]['duct'] or p.get('t4_form') == 'simplified') else acosh(u)
        ext = rho/(2*pi)*(term+2*log(u)) if cables[0]['duct'] else 1.5*rho/pi*(term-.630)
        matrix = [[ext/3]*3 for _ in cables]
        soil = {'base_matrix_k_m_w': matrix, 'common_correction_k_m_w': 0.0,
                'source': 'IEC 60287-2-1:2023 4.2.4.3.2 / 4.2.6.5 (接触品字形等效组)',
                'contact_trefoil': True}
    else:
        matrix, soil = resistance_matrix([c['point'] for c in cables],radii, rho, backfill, reference_basis=basis)
    soil['reference_basis'] = basis
    return GroupRating(value,p,cables,circuits,matrix,soil,section['medium']['surface_temperature']-273.15)
