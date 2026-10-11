"""Frozen provenance is separate from, and cannot overwrite, solver values."""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from backend.kernel.material_basis import compare_constant, freeze_basis
from backend.plugin_host.executor import Executor
from cablesim_iec60287.constants import material_constants


def test_exact_difference_uncovered_and_unverified_are_distinct():
    constant={'label':'外护套热阻率','value':6.,'unit':'K·m/W'}
    receipt={'answer':{'status':'resolved','records':[{'value':5.,'quantity':{'unit':'K·m/W'},
        'verification':{'status':'verified'},'citation':'IEC 60287-2-1:2023 表 1 · 第 33 页'}]}}
    before=deepcopy(constant)
    row=compare_constant(constant,receipt)
    assert row['status']=='different' and row['difference']==1 and row['value']==6
    assert constant==before
    assert compare_constant(constant)['status']=='not_covered'
    receipt['answer']['records'][0]['value']=6
    assert compare_constant(constant,receipt)['status']=='verified'
    receipt['answer']['records'][0]['verification']['status']='blocked'
    assert compare_constant(constant,receipt)['status']=='unverified'


def test_real_basis_query_freezes_pvc_footnote_copper_and_coefficient_receipts():
    document={'schema_version':'cablesim.domain/1','materials':[
        {'id':'cu','standard_kind':'copper_bare','electrical_resistivity_20':1.7241e-8,'temperature_coefficient_20':.00393},
        {'id':'xlpe','standard_kind':'XLPE','thermal_resistivity':3.5},
        {'id':'pvc','standard_kind':'PVC','thermal_resistivity':6.},
        {'id':'unknown','standard_kind':None,'thermal_resistivity':6.}],
        'cable_types':[{'id':'t','label':'YJV22 3×300','rating':{'u':15000},'cores':[
            {'conductor':{'material':'cu','form':'stranded_round_compacted'},'layers':[{'role':'insulation','material':'xlpe'}]}],
            'common_layers':[{'role':'oversheath','material':'pvc'},{'role':'filler','material':'unknown'}]}],
        'circuits':[{'cable_type':'t'}],'sections':[]}
    constants=material_constants({'input':document},SimpleNamespace(parameters={'ks':1.,'kp':1.}))
    output={'cases':[{'case_id':'real-query','status':'succeeded','evidence':{'material_constants':constants}}]}
    original=deepcopy(output)
    freeze_basis(Executor(),output)
    rows=output['cases'][0]['evidence']['material_basis']['rows']
    assert len(rows)==7
    assert [r['status'] for r in rows]==['verified']*6+['not_covered']
    sheath=next(r for r in rows if '外护套' in r['label'])
    assert sheath['reference_value']==6 and '表注' in sheath['note']
    record=sheath['basis']['answer']['records'][0]
    assert (record['printed_page'],record['pdf_page'])==(33,89)
    assert len(sheath['basis']['release_digest'])==64
    assert len(sheath['basis']['artifact_sha256'])==64
    assert output['cases'][0]['evidence']['material_constants']==original['cases'][0]['evidence']['material_constants']
    # Different explicit electrical coefficient stays intact and is reported.
    changed=deepcopy(original);changed['cases'][0]['evidence']['material_constants'][3]['value']=.8
    freeze_basis(Executor(),changed)
    assert changed['cases'][0]['evidence']['material_basis']['rows'][3]['status']=='different'
    assert changed['cases'][0]['evidence']['material_basis']['rows'][3]['value']==.8


def test_report_uses_saved_basis_without_new_queries(monkeypatch):
    from backend.kernel.report import artifact_sections
    row=compare_constant({'label':'未知填料热阻率','value':7.,'unit':'K·m/W'})
    case={'evidence':{'material_basis':{'rows':[row]}},'artifacts':{}}
    monkeypatch.setattr(Executor,'run',lambda *a,**k: pytest.fail('reports must not query current standards'))
    html=artifact_sections(case)
    assert '材料常数与标准出处' in html and '本库暂未收录' in html and '7.0 K·m/W' in html
