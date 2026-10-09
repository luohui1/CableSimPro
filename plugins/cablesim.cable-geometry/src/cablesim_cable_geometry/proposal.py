"""Analytic layout proposal. No OCCT, solver, material defaults or approvals."""
from math import sqrt, pi, isfinite


def propose(values):
    area, thickness = values['area_m2'], values['thickness_m']
    if values['form'] == 'solid_round':
        diameter = 2*sqrt(area/pi)
        formula = 'd = 2√(A/π)；等截面积理想实心圆，不适用于绞合或紧压导体'
    else:
        diameter = values.get('diameter_m')
        if not isinstance(diameter, (int, float)) or isinstance(diameter, bool) or not isfinite(diameter) or diameter <= 0:
            raise ValueError('/diameter_m：非实心导体须提供实际设计外径，不能由标称截面猜测。')
        if area > pi*diameter**2/4 + 1e-12:
            raise ValueError('/diameter_m：外径包络小于所声明截面积，请核对 mm / mm² 单位。')
        formula = '工程师给定的圆形导体包络'
    n = 1 if values['construction'] == 'single_core' else 3
    centers = [(0., 0.)]
    if n == 3:
        gap = values.get('gap_m')
        if gap is None:
            raise ValueError('/gap_m：三芯布局须明确芯间净距；相切时显式填 0 mm。')
        distance = diameter + 2*thickness + gap
        centers = [(0., distance/sqrt(3)), (-distance/2, -distance/(2*sqrt(3))), (distance/2, -distance/(2*sqrt(3)))]
    changes, rows = [], []
    for i, (x, z) in enumerate(centers):
        root = f'/cable_types/0/cores/{i}'
        for field, value in [('conductor/diameter', diameter), ('conductor/form', values['form']), ('x', x), ('z', z)]:
            changes.append({'path': root+'/'+field, 'value': value})
        rows.append({'label': f'芯 {i+1} · 导体外径', 'value': diameter, 'unit': 'm',
                     'basis': 'derived' if values['form'] == 'solid_round' else 'user', 'formula': formula})
    if n == 3:
        rows.append({'label': '芯中心距', 'value': distance, 'unit': 'm', 'basis': 'derived', 'formula': 's = d + 2t + g；品字形圆心由 s 推导'})
    return {'schema': 'cablesim.core-layout-proposal/1', 'changes': changes, 'rows': rows,
            'limitations': ['仅理想圆形芯和明确间隙的品字形排布；不生成制造公差、股线或成缆绞合。']}
