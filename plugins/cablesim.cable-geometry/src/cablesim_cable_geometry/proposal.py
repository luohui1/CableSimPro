"""Analytic layout proposal. No OCCT, solver, material defaults or approvals."""
from math import sqrt, pi, isfinite


def propose(values):
    version = values.get('schema_version', 'cablesim.core-layout-request/1')
    if version == 'cablesim.core-layout-request/1' and any(values.get(key) is not None for key in ('neutral_area_m2','neutral_diameter_m','neutral_thickness_m','filler_thickness_m','binder_thickness_m')):
        raise ValueError('/schema_version：独立中性线及护层输入须使用第二版布局契约。')
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
    n = 1 if values['construction'] == 'single_core' else 3 if values['construction'] == 'three_core' else 4
    if values['construction'] not in ('single_core','three_core','four_core','three_plus_one') or n==4 and version!='cablesim.core-layout-request/2':
        raise ValueError('/construction：四芯布局须使用第二版契约。')
    diameters, thicknesses = [diameter]*n, [thickness]*n
    if values['construction']=='three_plus_one':
        neutral_area = values.get('neutral_area_m2')
        if neutral_area is None or not 0 < neutral_area < area:
            raise ValueError('/neutral_area_m2：请明确小于相线截面的中性线截面。')
        neutral = 2*sqrt(neutral_area/pi) if values['form']=='solid_round' else values.get('neutral_diameter_m')
        if neutral is None or neutral <= 0 or neutral_area > pi*neutral**2/4+1e-12:
            raise ValueError('/neutral_diameter_m：请核对中性线实际外径与截面。')
        diameters[-1], thicknesses[-1] = neutral, values['neutral_thickness_m']
    centers = [(0., 0.)]
    if n == 3:
        gap = values.get('gap_m')
        if gap is None:
            raise ValueError('/gap_m：三芯布局须明确芯间净距；相切时显式填 0 mm。')
        distance = diameter + 2*thickness + gap
        centers = [(0., distance/sqrt(3)), (-distance/2, -distance/(2*sqrt(3))), (distance/2, -distance/(2*sqrt(3)))]
    if n == 4:
        gap = values.get('gap_m')
        if gap is None or gap < 0:
            raise ValueError('/gap_m：四芯圆形布局须明确芯间最小净距。')
        # Explicit square-centre engineering arrangement. A reduced neutral
        # occupies the fourth vertex; its extra gap remains real filler space.
        distance = max(d+2*t for d,t in zip(diameters,thicknesses))+gap
        centers = [(-distance/2,distance/2),(distance/2,distance/2),(distance/2,-distance/2),(-distance/2,-distance/2)]
    changes, rows = [], []
    for i, (x, z) in enumerate(centers):
        diameter = diameters[i]
        root = f'/cable_types/0/cores/{i}'
        for field, value in [('conductor/diameter', diameter), ('conductor/form', values['form']), ('x', x), ('z', z)]:
            changes.append({'path': root+'/'+field, 'value': value})
        rows.append({'label': f'芯 {i+1} · 导体外径', 'value': diameter, 'unit': 'm',
                     'basis': 'derived' if values['form'] == 'solid_round' else 'user', 'formula': formula})
    if n > 1:
        rows.append({'label': '芯中心距', 'value': distance, 'unit': 'm', 'basis': 'derived', 'formula': 's = max(dᵢ + 2tᵢ) + g；正方形相邻芯中心距；中性线额外间隙归入填充' if n == 4 else 's = d + 2t + g；品字形圆心由 s 推导'})
    if n == 4:
        radius = max(sqrt(x*x+z*z)+d/2+t for (x,z),d,t in zip(centers,diameters,thicknesses))
        filled_radius = radius+values.get('filler_thickness_m',0)
        filler_area = pi*filled_radius**2-sum(pi*(d/2+t)**2 for d,t in zip(diameters,thicknesses))
        binder = values.get('binder_thickness_m',0)
        rows.extend([
            {'label':'圆形缆芯包络外径','value':2*radius,'unit':'m','basis':'derived','formula':'D = 2 max(√(x²+z²)+d/2+t)；明确正方形芯中心排列，不作紧压优化'},
            {'label':'填充截面积','value':filler_area,'unit':'m2','basis':'derived','formula':'Af = π(R+tf)² − Σπ(ri+ti)²；按各芯实际截面几何扣除，tf 由工程师给定'},
            {'label':'包带截面积','value':pi*((filled_radius+binder)**2-filled_radius**2),'unit':'m2','basis':'derived','formula':'Ab = π[(R+tf+tb)²−(R+tf)²]；连续等效包带，不代替搭盖与绞入数据'}])
    return {'schema': 'cablesim.core-layout-proposal/1', 'changes': changes, 'rows': rows,
            'limitations': ['圆形单芯、品字形三芯或正方形四芯中心排列；3+1 的中性线额外间隙计入填充。实体外径不等于附录 A 假设直径。','不生成制造公差、股线、成缆绞合及绕包搭盖；未给定的填充外包或包带厚度保持缺项。']}
