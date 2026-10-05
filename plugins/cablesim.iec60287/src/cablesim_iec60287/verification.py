"""Independent logarithmic reconstruction of the converged heat balance.

This is a coefficient and frozen-loss hand check, not an independent electrical
solver or a measured engineering case. It never reads the solver's soil matrix.
"""
from math import exp, log, pi, sqrt

from .soil import geometric_factor
from .method import RatingRefused


def verify_balance(group, operating_state, ratings, *, external_coefficients=None):
    n = len(group.cables)
    radii = [c['rating'].installation.duct.outer_diameter_m/2 if c['duct'] else c['geometry'].overall_m/2 for c in group.cables]
    section = group.document['sections'][0]
    materials = {m['id']:m for m in group.document['materials']}
    earth = materials[section['medium']['material']]['thermal_resistivity']
    fill = section.get('backfill')
    rho, common = earth, 0.0
    if fill:
        rho = materials[fill['material']]['thermal_resistivity']
        depth = -fill['z']
        if group.parameters.get('reference_basis') == 'tb880_reference':
            short,long = sorted((fill['height'],fill['width']))
            ratio = short/long
            radius = (short/2)*(1+1/ratio**2)**(.5*ratio*(4/pi-ratio))
        else:
            factor = geometric_factor(depth,fill['height'],fill['width'])
            radius = depth/exp(factor)
        u = depth/radius
        common = (earth-rho)/(2*pi)*log(u+sqrt(u*u-1))
    coefficients = []
    for i,ci in enumerate(group.cables):
        row = []
        xi,zi = ci['point']
        for j,cj in enumerate(group.cables):
            xj,zj = cj['point']
            if group.soil.get('contact_trefoil'):
                depth = -sum(c['point'][1] for c in group.cables)/n
                u = depth/radii[i]
                term = log(2*u) if group.parameters.get('reference_basis') == 'tb880_reference' and (ci['duct'] or group.parameters.get('t4_form') == 'simplified') else log(u+sqrt(u*u-1))
                value = rho/(2*pi)*(term+2*log(u))/3 if ci['duct'] else 1.5*rho/pi*(term-.630)/3
            elif i == j:
                u = -zi/radii[i]
                correction = n*common if group.parameters.get('reference_basis') == 'tb880_reference' else common
                value = rho/(2*pi)*log(u+sqrt(u*u-1))+correction
            else:
                distance_squared = (xi-xj)**2+(zi-zj)**2
                image_squared = (xi-xj)**2+(zi+zj)**2
                correction = 0 if group.parameters.get('reference_basis') == 'tb880_reference' else common
                value = rho/(4*pi)*log(image_squared/distance_squared)+correction
            row.append(value)
        coefficients.append(row)
    if external_coefficients is not None:
        if not section.get('soil_layers') or len(external_coefficients)!=n or any(len(row)!=n for row in external_coefficients):
            raise ValueError('external_coefficients：独立分层热阻核验必须匹配实际土层与全部热源。')
        coefficients=external_coefficients
    rows = []
    def add(entity,label,computed,reference,unit,tolerance,source):
        delta = computed-reference
        row = {'entity':entity,'item':label,'computed':computed,'reference':reference,'difference':delta,
               'unit':unit,'tolerance':tolerance,'passed':abs(delta)<=tolerance,'source':source}
        rows.append(row)
        if not row['passed']:
            raise RatingRefused('INDEPENDENT_HEAT_CHECK_FAILED', f'{entity}：{label}独立热平衡核对未通过。')
    def paths(c,s):
        r,g = c['rating'],c['geometry']
        inner = r.insulation.inner_screen_rho_k_m_w/(2*pi)*log(g.over_inner_screen_m/g.conductor_m)
        ins = r.insulation.rho_k_m_w/(2*pi)*log(g.over_insulation_m/g.over_inner_screen_m)
        outer = r.insulation.outer_screen_rho_k_m_w/(2*pi)*log(g.over_outer_screen_m/g.over_insulation_m)
        cover = r.oversheath.rho_k_m_w/(2*pi)*log(g.overall_m/g.over_sheath_m)
        if group.soil.get('contact_trefoil') and not c['duct']:
            cover *= 1.6
        d = r.installation.duct
        wall = d.rho_k_m_w/(2*pi)*log(d.outer_diameter_m/d.inner_diameter_m) if d else 0.0
        mean = (s['surface_temperature_c']+s['duct_inner_temperature_c'])/2
        gap = d.u/(1+.1*(d.v+d.y_per_k*mean)*g.overall_m*1000) if d else 0.0
        return inner+ins+outer, .5*(inner+ins+outer), cover+wall+gap, wall, gap
    states = operating_state['cable_states']
    for i,(c,s) in enumerate(zip(group.cables,states)):
        t1,tdiel,outside,wall,gap = paths(c,s)
        surface = group.ambient+sum(coefficients[i][j]*states[j]['total_loss_w_m'] for j in range(n))
        theta = surface+outside*s['total_loss_w_m']+t1*s['conductor_loss_w_m']+tdiel*s['dielectric_loss_w_m']
        add(c['id'],'运行导体温度（逐源热平衡）',s['conductor_temperature_c'],theta,'°C',1e-4,'IEC 60287-2-1:2023 4.1 / 4.2.3.2；已收敛损耗代入独立对数式')
        if c['duct']:
            add(c['id'],"管壁 T4″",s['t4_wall_k_m_w'],wall,'K·m/W',1e-10,'IEC 60287-2-1:2023 4.2.6.4')
            add(c['id'],"管内 T4′",s['t4_air_gap_k_m_w'],gap,'K·m/W',1e-7,'IEC 60287-2-1:2023 4.2.6.3, Table 5')
    for rated,circuit in zip(ratings,group.circuits):
        if rated['ampacity_a'] is None:
            continue
        target = next(i for i,c in enumerate(group.cables) if c['id'] == rated['limiting_cable'])
        state = rated['cable_states'][target]
        t1,tdiel,outside,_,_ = paths(group.cables[target],state)
        constant = tdiel*state['dielectric_loss_w_m']+outside*state['dielectric_loss_w_m']
        coefficient = 0.0
        for j,source in enumerate(rated['cable_states']):
            path = coefficients[target][j]+(outside if j == target else 0)
            constant += path*source['dielectric_loss_w_m'] if j != target else coefficients[target][j]*source['dielectric_loss_w_m']
            if j in circuit['indices']:
                ratio = rated['cable_currents_a'][source['entity']]/rated['ampacity_a']
                coefficient += ratio**2*source['ac_resistance_ohm_m']*((1+source['lambda1'])*path+(t1 if j == target else 0))
            else:
                constant += path*(source['conductor_loss_w_m']+source['sheath_loss_w_m'])+(t1*source['conductor_loss_w_m'] if j == target else 0)
        numerator = state['temperature_limit_c']-group.ambient-constant
        if numerator <= 0 or coefficient <= 0:
            raise RatingRefused('INDEPENDENT_HEAT_CHECK_FAILED', '独立允许电流二次式没有正解。')
        hand = sqrt(numerator/coefficient)
        add(rated['entity'],'允许电流（固定收敛损耗参数二次式）',rated['ampacity_a'],hand,'A',1e-3,
            'IEC 60287 热平衡；Rac、λ1、管内平均温度采用最终迭代值，其余回路采用保存负荷')
    return {'basis':('独立傅里叶积分重建分层互热，' if external_coefficients is not None else '独立对数式重建互热，')+'以内部热路及最终损耗参数做手算二次式核对；未替代独立电磁模型或现场试验。',
            'rows':rows,'passed':all(r['passed'] for r in rows)}
