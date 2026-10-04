"""报告状态不能把缺数值、不同统计量或超差伪装成复现成功。"""
from pathlib import Path
import sys
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'plugins/cablesim.simulation/src'))
from cablesim_simulation.report import comparison,blocked


def summary():
    return {'cables':[{'entity':'cable/a','conductor_max_temperature_k':350.,'conductor_mean_temperature_k':349.,'interface_nodal_mean_k':{}}],
            'rating':None,'nodes':10,'elements':12,'mesh_size_m':.1,'energy_relative_residual':1e-10,'physical_residual_inf_w_m':1e-10}


def target(reference=351.):
    return {'id':'temperature','quantity':'conductor_max_temperature_k','entity':'cable/a','unit':'K','reference':reference,
            'tolerance':{'absolute':.5,'source':'预先选定的测试门槛'},'source':{'table':1,'pdf_page':2}}


def test_outside_tolerance_is_preserved_and_temperature_has_no_kelvin_percentage():
    report = comparison(summary(),{}, {'citation':{'title':'合成报告测试'},'targets':[target()]})
    assert report['status'] == 'outside_tolerance'
    row = report['rows'][0]
    assert row['calculated'] == 350 and row['difference'] == -1
    assert row['relative_difference'] is None


@pytest.mark.parametrize('change,expected', [({'reference':None},'missing_reference'),
    ({'tolerance':None},'not_assessed'),({'comparison_allowed':False},'not_comparable'),
    ({'entity':'cable/unknown'},'not_comparable')])
def test_unavailable_and_incomparable_states(change,expected):
    row = target(); row.update(change)
    report = comparison(summary(),{}, {'targets':[row]})
    assert report['rows'][0]['status'] == expected
    assert report['status'] != 'matched'


def test_missing_input_report_has_no_fabricated_run():
    report = blocked({'citation':{'doi':'test'},'scope':'缺参数测试','missing_inputs':[{'path':'R20','impact':'无法求电流损耗'}]})
    assert report['status'] == 'blocked_missing_input'
    assert report['rows'] == [] and report['run'] is None and report['numerical_evidence'] is None
