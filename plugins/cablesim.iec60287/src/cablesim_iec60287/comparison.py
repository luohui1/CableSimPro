"""Exact Shapley decomposition of the two saved final-coefficient balances.

The diagnostic holds converged sheath coefficients and the limiting-phase
mutual-heating weights fixed. It does not claim a fully re-iterated hybrid
physical model, standard acceptance, or a unique causal attribution.
"""
from math import factorial, isclose, isfinite, sqrt

FIELDS = ('ac_resistance_ohm_m', 'lambda1', 'lambda2', 't1_k_m_w',
          't2_k_m_w', 't3_k_m_w', 't4_k_m_w', 'metal_k_m_w', 'dielectric_rise_k')


def balance(v):
    resistance = v['ac_resistance_ohm_m']
    thermal = (v['t1_k_m_w'] + v['t2_k_m_w'] + v['metal_k_m_w']
               + (1 + v['lambda1']) * v['t3_k_m_w']
               + (1 + v['lambda1'] + v['lambda2']) * v['t4_k_m_w'])
    numerator = v['temperature_headroom_k'] - v['dielectric_rise_k']
    if resistance <= 0 or thermal <= 0 or numerator <= 0:
        raise ValueError('分项组合没有有效热平衡，不输出贡献值。')
    return sqrt(numerator / (resistance * thermal))


def decompose(base, other):
    if base.get('schema') != 'cablesim.rating-components/1':
        raise ValueError('基准未输出支持的分项证据。')
    if not all(isfinite(v[k]) for v in (base, other) for k in (*FIELDS, 'ampacity_a', 'temperature_headroom_k')):
        raise ValueError('分项证据有缺项或非有限数值。')
    if not isclose(base['temperature_headroom_k'], other['temperature_headroom_k'], abs_tol=1e-8):
        raise ValueError('两种方法的环境或导体温限不同，不能作同口径分项归因。')
    for v in (base, other):
        if not isclose(balance(v), v['ampacity_a'], rel_tol=1e-8, abs_tol=1e-5):
            raise ValueError('分项热平衡与保存的总结果不一致，拒绝归因。')
    changed = [k for k in FIELDS if base[k] != other[k]]
    n = len(changed)
    currents = {}
    for mask in range(1 << n):
        hybrid = dict(base)
        for j, key in enumerate(changed):
            if mask & (1 << j):
                hybrid[key] = other[key]
        currents[mask] = balance(hybrid)
    rows = []
    for key in FIELDS:
        contribution = 0.0
        if key in changed:
            j = changed.index(key)
            for mask in range(1 << n):
                if mask & (1 << j):
                    continue
                count = mask.bit_count()
                weight = factorial(count) * factorial(n-count-1) / factorial(n)
                contribution += weight * (currents[mask | (1 << j)] - currents[mask])
        rows.append({'key': key, 'baseline': base[key], 'value': other[key],
                     'contribution_a': contribution,
                     'contribution_percent': contribution / base['ampacity_a'] * 100})
    difference = other['ampacity_a'] - base['ampacity_a']
    return {'schema': 'cablesim.rating-attribution/1', 'baseline': base, 'comparison': other,
            'rows': sorted(rows, key=lambda r: -abs(r['contribution_a'])),
            'difference_a': difference, 'closure_error_a': sum(r['contribution_a'] for r in rows) - difference,
            'interpretation': '固定最终系数的 Shapley 分解：逐项替换并平均所有替换顺序；贡献之和等于 IEC 减热网络。'
                              '护套迭代终值与三相互热权重固定，混合组合不重新迭代；贡献是数值分解，不是唯一物理因果或合规判据。'}
