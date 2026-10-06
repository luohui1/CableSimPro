"""IEC N-source steady-state heat balance and independent circuit limits.

Electrical: IEC 60287-1-1:2023 5.1.2, 5.1.5.1, 5.2, 5.3.2–5.3.4, 5.3.7.
Thermal: IEC 60287-2-1:2023 4.1, 4.2.2–4.2.3, 4.2.6, 4.2.7.
Every source contributes its actual converged W/m, not a mean group load.
"""
from dataclasses import asdict, replace
from math import isfinite, log, pi, sqrt

from .method import RatingRefused, _layer, electrical, sheath_loss, t1, t3, dielectric_path as dielectric_resistance
from .electrical import (ac_factors, resistance, sheath_reactance, circulating as circulating_loss,
                         sheath_thickness_terms, eddy_geometry)

GROUP_METHOD_VERSION = '1.0.0'


def _resistance(c, temperature, spacing):
    r, g = c['rating'], c['geometry']
    dc = resistance(r.conductor.r20_ohm_m, r.conductor.alpha20_per_k, temperature)
    if c['factors'] is not None:
        return dc*(1+c['factors']['ac_extra_factor'])
    return ac_factors(dc,r.frequency_hz,r.conductor.ks,r.conductor.kp,g.conductor_m,spacing)[-1]


def _flat_eddy(r, g, rs, theta_s, spacing, role):
    """IEC 60287-1-1:2023 5.3.7.1(2); TB 880 pp.98 and 100."""
    omega = 2*pi*r.frequency_hz
    rho = r.sheath.resistivity20_ohm_m*(1+r.sheath.alpha20_per_k*(theta_s-20))
    cgs, thickness_term = sheath_thickness_terms(rho,r.sheath.thickness_m,g.over_sheath_m,r.frequency_hz)
    m,ratio = omega*1e-7/rs,g.sheath_mean_m/(2*spacing)
    return cgs*eddy_geometry(m,ratio,role)+thickness_term


def _loss_details(group, resistances, sheath_temperatures):
    if group.soil.get('double_flat'):
        from .double_flat import eddy_factor
        setup = group.soil['double_flat']
        result = [None]*len(group.cables)
        for position,i in enumerate(setup['indices']):
            c = group.cables[i]; r,g = c['rating'],c['geometry']
            rho = r.sheath.resistivity20_ohm_m*(1+r.sheath.alpha20_per_k*(sheath_temperatures[i]-20))
            rs = rho/(pi*g.sheath_mean_m*r.sheath.thickness_m)
            result[i] = eddy_factor(rs,resistances[i],rho,r.sheath.thickness_m,g.over_sheath_m,
                g.sheath_mean_m,r.frequency_hz,setup['spacing'],setup['separation'],position,setup['direction'],group.parameters.get('double_flat_tables'))
        return result
    losses = [None]*len(group.cables)
    for circuit in group.circuits:
        ids, spacing = circuit['indices'], circuit['spacing']
        if not circuit['automatic']:
            for i in ids:
                losses[i] = {'total':group.cables[i]['factors']['lambda1'], 'circulating':None,
                             'eddy_raw':None,'eddy_factor_f':None,'sheath_r_ohm_m':None,'basis':'supplied'}
            continue
        first = group.cables[ids[0]]
        r, g = first['rating'], replace(first['geometry'], axis_spacing_m=spacing)
        rs20 = r.sheath.resistivity20_ohm_m/(pi*g.sheath_mean_m*r.sheath.thickness_m)
        omega = 2*pi*r.frequency_hz
        x = sheath_reactance(r.frequency_hz,spacing,g.sheath_mean_m)
        if circuit['arrangement'] == 'trefoil':
            for i in ids:
                ci = group.cables[i]
                e = replace(electrical(ci['rating'],g),r_ac_max_ohm_m=resistances[i],sheath_reactance_ohm_m=x)
                losses[i] = asdict(sheath_loss(ci['rating'],g,e,sheath_temperatures[i]))
        elif circuit['transposed']:
            x1 = sheath_reactance(r.frequency_hz,2**(1/3)*spacing,g.sheath_mean_m)
            for i in ids:
                rs = rs20*(1+r.sheath.alpha20_per_k*(sheath_temperatures[i]-20))
                value = circulating_loss(rs,resistances[i],x1)
                losses[i] = {'total':value,'circulating':value,'eddy_raw':0.0,'eddy_factor_f':None,'sheath_r_ohm_m':rs}
        else:
            # Identify the middle from distances, independent of placement ordering.
            middle = min(ids,key=lambda i: sum((group.cables[i]['point'][0]-group.cables[j]['point'][0])**2+(group.cables[i]['point'][1]-group.cables[j]['point'][1])**2 for j in ids))
            xm = 2*omega*1e-7*log(2)
            cp, cq = x+xm, x-xm/3
            phases = {'A':0,'B':1,'C':2,'L1':0,'L2':1,'L3':2}
            center_phase = phases[group.cables[middle]['phase']]
            for i in ids:
                rs = rs20*(1+r.sheath.alpha20_per_k*(sheath_temperatures[i]-20))
                if i == middle:
                    role = 'middle'
                    factor = cq*cq/(rs*rs+cq*cq)  # Eq. (10), no multiplier 2
                else:
                    lagging = (phases[group.cables[i]['phase']]-center_phase)%3 == (1 if circuit['phase_sequence']=='ABC' else 2)
                    role = 'outer_lagging' if lagging else 'outer_leading'
                    factor = .75*cp*cp/(rs*rs+cp*cp)+.25*cq*cq/(rs*rs+cq*cq)
                    cross = 2*rs*cp*cq*xm/(sqrt(3)*(rs*rs+cp*cp)*(rs*rs+cq*cq))
                    factor += cross if lagging else -cross
                circulating = rs/resistances[i]*factor if r.bonding.scheme == 'both_ends' else 0.0
                eddy,reduction = 0.0,None
                if r.bonding.eddy == 'trefoil':
                    eddy = rs/resistances[i]*_flat_eddy(r,g,rs,sheath_temperatures[i],spacing,role)
                    if r.bonding.scheme == 'both_ends':
                        m1,n1 = rs/cp,rs/cq
                        reduction = (4*m1*m1*n1*n1+(m1+n1)**2)/(4*(m1*m1+1)*(n1*n1+1))
                losses[i] = {'total':circulating+eddy*(reduction if reduction is not None else 1),
                             'circulating':circulating,'eddy_raw':eddy,'eddy_factor_f':reduction,
                             'sheath_r_ohm_m':rs,'phase_role':role}
    for circuit in group.circuits:
        if circuit['automatic'] and circuit['bonding']['kind'] == 'cross_bonded':
            lengths = circuit['bonding'].get('minor_section_lengths',[])
            if len(lengths)!=3 or any(v<=0 for v in lengths) or not circuit['bonding'].get('section_permutations') or not circuit['bonding'].get('source'):
                raise RatingRefused('CROSS_BONDING_TOPOLOGY_REQUIRED','bonding：交叉互联需要三个正小段长度（m）、护套换位和来源。')
            a,b,c = sorted(lengths); p,q=b/a,c/a
            factor = (1+p*p+q*q-p-p*q-q)/(1+p+q)**2
            for i in circuit['indices']:
                row = losses[i]
                row.update(circulating=row['circulating']*factor,eddy_factor_f=None,
                           cross_bonding_factor=factor,basis='IEC 60287-1-1:2023 5.3.7.2 Eq.(11)')
                row['total'] = row['circulating']+row['eddy_raw']
    if any(not isfinite(x['total']) or x['total'] < 0 for x in losses):
        raise RatingRefused('LOSS_STATE_INVALID', '护套损耗计算产生无效值。')
    return losses


def _loss_factors(group, resistances, sheath_temperatures):
    return [row['total'] for row in _loss_details(group,resistances,sheath_temperatures)]


def operating(group, currents=None):
    if group.soil.get('three_core'):
        from .three_core import operating as three_core_operating
        return three_core_operating(group,currents)
    n, ambient = len(group.cables), group.ambient
    currents = [c['current'] for c in group.cables] if currents is None else currents
    limits = [c['rating'].max_conductor_temperature_c for c in group.cables]
    temperatures, sheaths, mean_air = [ambient]*n, [ambient]*n, [ambient]*n
    T1, T3, dielectric_path, capacitance, wd, walls = [], [], [], [], [], []
    spacings = {i:circuit['spacing'] for circuit in group.circuits for i in circuit['indices']}
    for c in group.cables:
        r, g = c['rating'], c['geometry']
        T1.append(t1(r,g))
        multiplier = 1.6 if group.soil.get('contact_trefoil') and not c['duct'] else 1.0
        T3.append(multiplier*t3(r,g))
        # IEC 60287-1-1:2023 4.2.1, Eq. (1): Wd traverses half of T1.
        # T1 includes both semiconducting layers (TB 880 pp. 70 and 74).
        dielectric_path.append(dielectric_resistance(r,g))
        cap_coefficient = 1e-9/18 if group.parameters.get('reference_basis') == 'tb880_reference' else 2*pi*8.8541878128e-12
        capacitance.append(cap_coefficient*r.insulation.relative_permittivity/log(g.over_insulation_m/g.over_inner_screen_m))
        wd.append(2*pi*r.frequency_hz*capacitance[-1]*r.phase_voltage_v**2*r.insulation.tan_delta)
        duct = r.installation.duct
        walls.append(_layer(duct.rho_k_m_w,duct.outer_diameter_m,duct.inner_diameter_m) if duct else 0.0)
    max_iterations = max(c['rating'].solver.max_iterations for c in group.cables)
    tolerance = 1e-6
    for iteration in range(1,max_iterations+1):
        supplied = group.parameters.get('external_loss_artifact')
        if supplied:
            from .loss_table import interpolate
            factors=interpolate(supplied,group.cables,currents,temperatures,sheaths)
            for cable in group.cables:
                cable['factors']=factors[cable['id']]
        if group.soil.get('double_flat') and max(currents)-min(currents)>1e-9:
            raise RatingRefused('DOUBLE_FLAT_BALANCED_LOAD_REQUIRED','IEC 1-2 的此分支要求两回共同平衡负荷。')
        resistances = [_resistance(c,temperatures[i],spacings[i]) for i,c in enumerate(group.cables)]
        loss_details = _loss_details(group,resistances,sheaths)
        lambdas = [row['total'] for row in loss_details]
        wc = [currents[i]**2*resistances[i] for i in range(n)]
        ws = [wc[i]*lambdas[i] for i in range(n)]
        total = [wc[i]+ws[i]+wd[i] for i in range(n)]
        gap = []
        for i,c in enumerate(group.cables):
            d = c['rating'].installation.duct
            denom = 1+.1*(d.v+d.y_per_k*mean_air[i])*c['geometry'].overall_m*1000 if d else 1
            if denom <= 0:
                raise RatingRefused('DUCT_AIR_STATE_INVALID', '管内平均温度使空气经验式无效。')
            gap.append(d.u/denom if d else 0.0)
        external = [sum(group.matrix[i][j]*total[j] for j in range(n)) for i in range(n)]
        duct_outer = [ambient+external[i] for i in range(n)]
        duct_inner = [duct_outer[i]+walls[i]*total[i] for i in range(n)]
        surfaces = [duct_inner[i]+gap[i]*total[i] for i in range(n)]
        new_sheaths = [surfaces[i]+T3[i]*total[i] for i in range(n)]
        new_temperatures = [new_sheaths[i]+T1[i]*wc[i]+dielectric_path[i]*wd[i] for i in range(n)]
        new_mean = [(surfaces[i]+duct_inner[i])/2 for i in range(n)]
        residual = max(abs(a-b) for a,b in zip(temperatures+sheaths+mean_air,new_temperatures+new_sheaths+new_mean))
        if not all(isfinite(v) and -273.15 < v < 500 for v in new_temperatures):
            raise RatingRefused('THERMAL_RUNAWAY', '该负荷下无有效稳态温度解；请减小负荷或采用适用的数值模型。')
        if residual < tolerance:
            if supplied:
                interpolate(supplied,group.cables,currents,new_temperatures,new_sheaths)
            break
        temperatures = [(a+b)/2 for a,b in zip(temperatures,new_temperatures)]
        sheaths = [(a+b)/2 for a,b in zip(sheaths,new_sheaths)]
        mean_air = [(a+b)/2 for a,b in zip(mean_air,new_mean)]
    else:
        raise RatingRefused('NOT_CONVERGED', f'稳态温度在 {max_iterations} 次迭代内未收敛；未生成结果。')
    states = []
    for i,c in enumerate(group.cables):
        states.append({'entity': c['id'],'circuit': c['circuit'],'phase': c['phase'],'current_a': currents[i],
            'conductor_temperature_c': new_temperatures[i], 'temperature_limit_c': limits[i], 'margin_k': limits[i]-new_temperatures[i],
            'sheath_temperature_c': new_sheaths[i],'surface_temperature_c': surfaces[i],
            'ac_resistance_ohm_m': resistances[i],'capacitance_f_m': capacitance[i], 'lambda1': lambdas[i],
            'ac_extra_factor':resistances[i]/(c['rating'].conductor.r20_ohm_m*(1+c['rating'].conductor.alpha20_per_k*(new_temperatures[i]-20)))-1,
            'lambda1_components':loss_details[i],
            'conductor_loss_w_m': wc[i],'sheath_loss_w_m': ws[i],'dielectric_loss_w_m': wd[i],'total_loss_w_m': total[i],
            't1_k_m_w': T1[i],'t3_k_m_w': T3[i], 't4_air_gap_k_m_w': gap[i], 't4_wall_k_m_w': walls[i],
            't4_self_soil_k_m_w': group.matrix[i][i], 'mutual_temperature_rise_k': sum(group.matrix[i][j]*total[j] for j in range(n) if j != i),
            'external_temperature_rise_k': external[i],'duct_outer_temperature_c': duct_outer[i],'duct_inner_temperature_c': duct_inner[i]})
    return {'cable_states': states,'iterations': iteration,'residual_k': residual,
            'hottest_cable': max(states,key=lambda s:s['conductor_temperature_c'])['entity'],
            'limiting_cable': min(states,key=lambda s:s['margin_k'])['entity']}


def simultaneous_rating(group):
    """IEC 1-1 heat balance with one balanced RMS current in every circuit.

    Every trial recomputes R(T), screen/armour losses, duct air and mutual heat.
    The first cable to reach its own limit constrains the common current.
    """
    def solve(current):
        return operating(group, [current]*len(group.cables))
    zero = solve(0.0)
    if min(s['margin_k'] for s in zero['cable_states']) <= 0:
        return {'ampacity_a': None, 'limiting_cable': zero['limiting_cable'],
                'error': {'code': 'NO_POSITIVE_RATING', 'message': '全部回路零电流时仍超温；不存在正共同允许电流。'}}
    lo, hi, safe, boundary = 0., 100., zero, None
    for _ in range(30):
        try:
            state = solve(hi)
            if min(s['margin_k'] for s in state['cable_states']) <= 0:
                break
            lo, safe, hi = hi, state, hi*2
        except RatingRefused as exc:
            if exc.code not in ('THERMAL_RUNAWAY', 'NOT_CONVERGED', 'LOSS_COEFFICIENT_VALIDITY_EXCEEDED'):
                raise
            boundary = exc
            break
    else:
        raise RatingRefused('RATING_NOT_BRACKETED', '全回路等负荷温限区间未括住。')
    tolerance = max(1e-5, min(c['rating'].solver.current_tolerance_a for c in group.cables))
    while hi-lo > tolerance:
        mid = (lo+hi)/2
        try:
            state = solve(mid)
            good = min(s['margin_k'] for s in state['cable_states']) >= 0
        except RatingRefused as exc:
            if exc.code not in ('THERMAL_RUNAWAY', 'NOT_CONVERGED', 'LOSS_COEFFICIENT_VALIDITY_EXCEEDED'):
                raise
            boundary, good = exc, False
        if good:
            lo, safe = mid, state
        else:
            hi = mid
    limiting = min(safe['cable_states'], key=lambda s: s['margin_k'])
    if limiting['margin_k'] > 1e-3:
        if boundary and boundary.code == 'LOSS_COEFFICIENT_VALIDITY_EXCEEDED':
            raise boundary
        raise RatingRefused('RATING_NOT_CONVERGED', '共同电流区间收敛但温限残差未通过；未给出允许电流。')
    return {'ampacity_a': lo, 'limiting_cable': limiting['entity'],
            'limiting_circuit': limiting['circuit'], 'cable_states': safe['cable_states'],
            'cable_currents_a': {c['id']: lo for c in group.cables}, 'held_currents_a': {}}


def rate_group(group, *, verification_coefficients=None):
    temperature_only = group.parameters.get('operation') == 'temperature'
    common = simultaneous_rating(group) if not temperature_only and group.parameters.get('rating_mode') in ('simultaneous','both') else None
    try:
        saved = operating(group)
    except RatingRefused as exc:
        if common is None or exc.code != 'THERMAL_RUNAWAY':
            raise
        saved = {'status':'unavailable','error':{'code':exc.code,'message':str(exc)},
                 'cable_states':[],'iterations':None,'residual_k':None,'hottest_cable':None,'limiting_cable':None}
    ratings = []
    base = [c['current'] for c in group.cables]
    for circuit in group.circuits:
        if group.parameters.get('operation') == 'temperature':
            ratings.append({'entity':circuit['id'],'label':circuit['label'],'ampacity_a':None,
                'limiting_cable':None,'error':{'code':'TEMPERATURE_ONLY','message':'本次仅计算保存负荷温度，未求允许电流。'}})
            continue
        indices = circuit['indices']
        # With explicit unequal phase loads, vary a common scale; report each
        # phase current as well as the largest current, rather than averaging.
        largest = max(base[i] for i in indices)
        ratios = [base[i]/largest if largest else 1.0 for i in indices]
        def solve(current):
            loads = base.copy()
            for i,ratio in zip(indices,ratios):
                loads[i] = current*ratio
            return operating(group,loads)
        try:
            zero = solve(0.0)
        except RatingRefused as exc:
            if exc.code != 'THERMAL_RUNAWAY':
                raise
            ratings.append({'entity':circuit['id'],'label':circuit['label'],'ampacity_a':None,
                            'limiting_cable':None,'error':{'code':'NO_POSITIVE_RATING',
                            'message':'其他回路维持目标负荷时无有效稳态，逐回路条件上限不存在；请查看全回路等负荷允许电流。'}})
            continue
        if min(s['margin_k'] for s in zero['cable_states']) <= 0:
            ratings.append({'entity':circuit['id'],'label':circuit['label'],'ampacity_a':None,
                            'limiting_cable':zero['limiting_cable'], 'error':{'code':'NO_POSITIVE_RATING',
                            'message':f"{circuit['label']}：其他回路保存负荷已使电缆超温，不存在正允许电流；运行温度仍可查看。"}})
            continue
        lo, hi, safe = 0.0, max(100.0,largest), zero
        unavailable_boundary = None
        for _ in range(30):
            try:
                state = solve(hi)
                if min(s['margin_k'] for s in state['cable_states']) <= 0:
                    break
                lo, safe, hi = hi, state, hi*2
            except RatingRefused as exc:
                if exc.code not in ('THERMAL_RUNAWAY','NOT_CONVERGED','LOSS_COEFFICIENT_VALIDITY_EXCEEDED'):
                    raise
                if exc.code == 'LOSS_COEFFICIENT_VALIDITY_EXCEEDED':
                    unavailable_boundary = exc
                break
        else:
            raise RatingRefused('RATING_NOT_BRACKETED', '无法找到允许电流的温限区间。')
        tolerance = max(1e-5,min(group.cables[i]['rating'].solver.current_tolerance_a for i in indices))
        while hi-lo > tolerance:
            mid = (lo+hi)/2
            try:
                state = solve(mid)
                admissible = min(s['margin_k'] for s in state['cable_states']) >= 0
            except RatingRefused as exc:
                if exc.code not in ('THERMAL_RUNAWAY','NOT_CONVERGED','LOSS_COEFFICIENT_VALIDITY_EXCEEDED'):
                    raise
                if exc.code == 'LOSS_COEFFICIENT_VALIDITY_EXCEEDED':
                    unavailable_boundary = exc
                admissible = False
            if admissible:
                lo, safe = mid, state
            else:
                hi = mid
        limiting = min(safe['cable_states'],key=lambda s:s['margin_k'])
        if limiting['margin_k'] > 1e-3:
            if unavailable_boundary:
                raise RatingRefused('LOSS_COEFFICIENT_VALIDITY_EXCEEDED','外部损耗表有效范围内未到达温限；未将范围边界冒充允许电流。'+str(unavailable_boundary))
            raise RatingRefused('RATING_NOT_CONVERGED', '电流区间收敛但温限残差未通过，未生成允许电流。')
        ratings.append({'entity': circuit['id'],'label': circuit['label'],'ampacity_a': lo,'limiting_cable': limiting['entity'],
                        'cable_currents_a': {group.cables[i]['id']:lo*ratio for i,ratio in zip(indices,ratios)},
                        'held_currents_a': {group.cables[i]['id']:base[i] for i in range(len(base)) if i not in indices},
                        'cable_states': safe['cable_states']})
    contributions = [{'target': target['id'],'source': source['id'],'self': i == j,
                      'resistance_k_m_w': group.matrix[i][j],
                      'base_resistance_k_m_w': group.soil['base_matrix_k_m_w'][i][j],
                      'backfill_correction_k_m_w': group.matrix[i][j]-group.soil['base_matrix_k_m_w'][i][j],
                      'source_loss_w_m': saved['cable_states'][j]['total_loss_w_m'],
                      'temperature_rise_k': group.matrix[i][j]*saved['cable_states'][j]['total_loss_w_m']}
                     for i,target in enumerate(group.cables) for j,source in enumerate(group.cables)] if saved['cable_states'] else []
    from .verification import verify_balance
    if group.soil.get('three_core'):
        from .three_core import verify as verify_three_core
        verification = verify_three_core(group,saved,ratings+([{**common,'entity':'circuit/group'}] if common and common['ampacity_a'] is not None else []))
    else:
        verification = verify_balance(group, saved if saved['cable_states'] else {'cable_states':common['cable_states']}, ratings, external_coefficients=verification_coefficients)
        if not saved['cable_states']:
            verification['checked_temperature_state'] = 'simultaneous-rating'
    components = None
    if group.soil.get('contact_trefoil') and len(ratings) == 1 and ratings[0]['ampacity_a'] is not None:
        s = ratings[0]['cable_states'][0]
        ext = sum(group.matrix[0])+s['t4_air_gap_k_m_w']+s['t4_wall_k_m_w']
        headroom = s['temperature_limit_c']-group.ambient
        denominator = s['ac_resistance_ohm_m']*(s['t1_k_m_w']+(1+s['lambda1'])*(s['t3_k_m_w']+ext))
        components = {'schema':'cablesim.rating-components/1','phase':'三相等效','ampacity_a':ratings[0]['ampacity_a'],
                      'temperature_headroom_k':headroom,'ac_resistance_ohm_m':s['ac_resistance_ohm_m'],
                      'lambda1':s['lambda1'],'lambda2':0.0,'t1_k_m_w':s['t1_k_m_w'],'t2_k_m_w':0.0,'metal_k_m_w':0.0,
                      't3_k_m_w':s['t3_k_m_w'],'t4_k_m_w':ext,
                      'dielectric_rise_k':headroom-ratings[0]['ampacity_a']**2*denominator,
                      'dielectric_loss_w_m':s['dielectric_loss_w_m'],'temperature_c':s['temperature_limit_c'],
                      'notes':'单回路接触品字形等效组；Rac、λ1、T4 取额定收敛状态，保留同输入分项对比。'}
    reference = group.parameters.get('reference_basis') == 'tb880_reference'
    payload = {'schema': 'cablesim.iec60287.group-trace/1','method_version': GROUP_METHOD_VERSION,
            'reference_basis': 'tb880_reference' if reference else 'iec2023',
            'result_scope': '旧版 TB880 参考复现，不能作为 IEC 2023 工程结论' if reference else 'IEC 2023 地下稳态；电损耗须满足声明范围',
            'operating': saved, 'circuit_ratings': ratings,'heat_contributions': contributions,'soil': group.soil, 'verification': verification,
            'rating_components':components,
            'electrical_topology':[{c['id']: {'bonding':c['bonding'], 'phase_reference':c['electrical_topology'],
                'legacy_assumption':None if c['electrical_topology'] else '旧输入未给相序/相角，沿用原单回路 ABC 假设'}} for c in group.circuits],
            'external_loss_source':(group.parameters.get('external_loss_artifact') or {}).get('resolved_source'),
            'external_loss_interpolation_error':((group.parameters.get('external_loss_artifact') or {}).get('temperature_table') or {}).get('error'),
            'rating_basis': '单回路能力；同回路各相共同变化，按最先达到温限的电缆确定上限。' if len(group.circuits)==1 else '逐回路求允许电流；其他回路保持已保存负荷。各回路上限不能同时使用。',
            'electrical_basis': '双回平排按 IEC 60287-1-2:2023，仅同负荷、无显著环流的温度工况；表1–11在声明范围内插值。' if group.soil.get('double_flat') else '单回路按 IEC 60287-1-1:2023（含已知段长交叉互联）；其余多回路仅接受有来源、有效范围匹配的外部损耗系数。旧输入未声明相序时沿用原 ABC 假设。',
            'sources': (['CIGRE TB 880:2022 Cases 0-1 / 0-2 / 0-3, pp. 62–101; reference conventions only'] if reference else
                        ['IEC 60287-1-1:2023 4.2.1 / 5.1.2 / 5.1.5.1 / 5.2 / 5.3.2–5.3.4 / 5.3.7.1–5.3.7.2; IEC 60287-1-2:2023 4–7 (double-flat only)',
                         'IEC 60287-2-1:2023 4.1 / 4.2.2 / 4.2.3.2 / 4.2.6 / 4.2.7, Table 2']),
            'decisions': ['导体电阻、护套电阻、管内空气热阻随温度迭代；返回热平衡残差。',
                          '每根源电缆采用实际损耗 W/m；镜像法互热未以平均负荷替代。',
                          '介质损耗内部热路按 IEC 60287-1-1 4.2.1 式 (1) 取 0.5·T1，包含半导电层。',
                          'TB880 参考复现：旧版电容与矩形半径，回填采用算例 N·C；不作为 IEC 2023 工程结论。' if reference else
                          '回填修正按共同温升 C·ΣW 叠加；等负荷时还原标准 N·C 热阻修正。']}
    if group.soil.get('three_core'):
        from .three_core import SOURCES
        payload.update(sources=SOURCES,electrical_basis='平衡圆形三芯独立金属屏蔽；每芯环流按SL分支，公共磁性钢带/钢丝铠装按对应条款。')
        payload['decisions'].append('T1、Rc及电容按每芯；导体、屏蔽、介质及铠装损耗按整根三芯电缆W/m输出；芯明细单独保留。')
    payload['rating_modes'] = {
        'individual': {'name': '逐回路允许电流', 'meaning': payload['rating_basis']},
        'simultaneous': {'name': '全回路等负荷允许电流', 'meaning': '全部回路同时采用相同的平衡RMS电流，最先到达各自温限的电缆限制共同电流；其他电缆可低于温限。'},
    }
    if common is not None:
        payload['simultaneous_rating'] = common
    from .rating_basis import basis
    for rated in ratings:
        rated['rating_basis'] = basis(group, rated['entity'])
    if common is not None:
        common['rating_basis'] = basis(group, common=True)
    if not group.soil.get('three_core'):
        from .method import buffer_resistance
        waves=[]
        for c in group.cables:
            r,g=c['rating'],c['geometry'];wave=r.sheath.corrugation
            if wave is None:continue
            waves.append({'entity':c['id'],'depth_m':wave.depth_m,'pitch_m':wave.pitch_m,
                'trough_inner_diameter_m':g.sheath_mean_m-r.sheath.thickness_m-wave.depth_m,
                'crest_outer_diameter_m':g.over_sheath_m+wave.depth_m,'mean_diameter_m':g.sheath_mean_m,
                'mean_inner_diameter_m':g.sheath_mean_m-r.sheath.thickness_m,'mean_outer_diameter_m':g.over_sheath_m,
                'sheath_r20_ohm_m':r.sheath.resistivity20_ohm_m/(pi*g.sheath_mean_m*r.sheath.thickness_m),
                'buffer_and_gap_resistance_k_m_w':buffer_resistance(r,g),'dielectric_path_k_m_w':dielectric_resistance(r,g),
                'gap_rho_k_m_w':wave.gap_rho_k_m_w,'gap_source':wave.gap_source,'geometry_source':wave.source,
                'pitch_role':'记录几何；IEC平均直径表达式不使用节距经验修正',
                'clauses':['IEC 60287-1-1:2023 5.3.1/5.3.2/5.3.7.1','IEC 60287-2-1:2023 4.1.2.1/4.1.3/4.1.5.1']})
        if waves:payload['corrugated_sheaths']=waves
    return payload
