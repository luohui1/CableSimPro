"""The comparison diagnostic must close and refuse inconsistent evidence."""
from copy import deepcopy

import pytest

from cablesim_iec60287.comparison import balance, decompose


def components():
    result = {'schema': 'cablesim.rating-components/1', 'temperature_headroom_k': 65,
              'ac_resistance_ohm_m': 6e-5, 'lambda1': .05, 'lambda2': 0,
              't1_k_m_w': .24, 't2_k_m_w': 0, 't3_k_m_w': .07,
              't4_k_m_w': 1.8, 'metal_k_m_w': .00003, 'dielectric_rise_k': .08}
    result['ampacity_a'] = balance(result)
    return result


def test_shapley_closes_across_simultaneous_changes_without_order_dependence():
    base = components()
    other = {**base, 'ac_resistance_ohm_m': 6.4e-5, 'lambda1': .12,
             't3_k_m_w': .08, 't4_k_m_w': 1.75, 'metal_k_m_w': 0, 'dielectric_rise_k': .1}
    other['ampacity_a'] = balance(other)
    before = deepcopy(base)
    result = decompose(base, other)
    assert base == before
    assert result['difference_a'] == pytest.approx(other['ampacity_a']-base['ampacity_a'])
    assert abs(result['closure_error_a']) < 1e-8
    rows = {r['key']: r for r in result['rows']}
    assert rows['ac_resistance_ohm_m']['contribution_a'] < 0
    assert rows['t4_k_m_w']['contribution_a'] > 0
    assert rows['lambda2']['contribution_a'] == 0
    reverse = decompose(other, base)
    assert [r['key'] for r in reverse['rows']] == [r['key'] for r in result['rows']]
    for row in reverse['rows']:
        assert row['contribution_a'] == pytest.approx(-rows[row['key']]['contribution_a'])


@pytest.mark.parametrize('change', [{'ampacity_a': 999}, {'temperature_headroom_k': 70},
                                    {'t4_k_m_w': float('nan')}, {'schema': 'unknown'}])
def test_comparison_refuses_false_or_unmatched_evidence(change):
    with pytest.raises(ValueError):
        decompose({**components(), **change}, components())
