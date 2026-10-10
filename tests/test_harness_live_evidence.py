"""Replay non-secret evidence from session-8100-20261009; no live files/model."""
from copy import deepcopy

import pytest
from fastapi import HTTPException

from backend.harness.evidence import grounded_text

# First rejected draft and its saved project_digest values. This is an archived
# answer-verification sample, not a solver validation or a newly computed result.
DRAFT='''**结论（“城南线路 · 110 kV 直埋单回校核”，IEC 稳态方法，最新保存结果，当前版本）**

- 允许电流（额定工况）：**748.3 A**；额定同时工况 748.3 A，两者基本一致。
- 运行工况按 600 A 负荷计算，最高导体温度 **65.5 °C**，三相一致（65.522 °C，338.672 K）。
- 温限余量：**24.478 K**（三相相同）；载流量余量：**148.32 A**（相对已加 600 A 负荷）。
- 限制对象/最热导体：回路 1 的 **A 相**。

**主要依据的输入**

- 土壤热阻率 1.0 K·m/W；电缆本体各层热阻率：绝缘 3.5、外护套 3.5、半导电层 2.5、缓冲层 5.88、沥青 6.0、PE 3.5 K·m/W。
- 埋深：A 相 0.742 m，B、C 相均为 0.829 m（列表深度为地下负 z 取反，原件保留保存坐标）。
- 已加负荷电流：回路 1 为 600 A。

口径与限制：以上为 IEC 稳态热路计算结果，非有限元结论，数值收敛状态未标注；该结果未做工程批准，仅作为当前保存结论。若需按“最高导体温度 65.522 °C + 余量 24.478 K”反推温度限值，需以本研究的温限输入为据，本次摘要未直接给出该限值。'''


def observations():
    return [{'data':{'studies':[{'study_id':'saved-study','title':'城南线路 · 110 kV 直埋单回校核',
        'latest_run':{'run_id':'saved-run','cases':[{'case_id':'case-0','results':[
            {'key':'ampacity','case':'rating','entity':'circuit/c1','value':748.3219742774963,'unit':'A'},
            {'key':'ampacity','case':'rating-simultaneous','entity':'circuit/c1','value':748.3219802379608,'unit':'A'},
            *[{'key':'conductor_temperature','case':'operating','entity':'cable/c1-'+phase,
                'value':338.6719999639408,'unit':'K'} for phase in ('A','B','C')]],
            'factors':[{'key':'current_margin','condition':'rating','value':148.32197427749634,'unit':'A'},
                *[{'key':'temperature_margin','condition':'operating','entity':'cable/c1-'+phase,
                    'value':24.478000036059186,'unit':'K'} for phase in ('A','B','C')]],
            'input_fields':[
                *[{'path':'/materials/'+name+'/thermal_resistivity','value':value,'unit':'K·m/W'}
                    for name,value in [('soil',1.0),('insulation',3.5),('jacket',3.5),('semicon',2.5),
                        ('buffer-qifan',5.88235294117647),('bitumen-qifan',6.0),('pe-qifan',3.5)]],
                *[{'key':'burial_depth','entity':'cable/c1-'+phase,'value':value,'unit':'m'}
                    for phase,value in [('A',0.7419185629195237),('B',0.8290407185402382),('C',0.8290407185402382)]],
                {'path':'/load_cases/load~1steady/currents/circuit~1c1','value':600.0,'unit':'A'}]}]}}]}}]


def test_live_draft_precision_names_inputs_and_derived_margin_replay_without_false_repair():
    evidence=observations();proof=[]
    assert grounded_text(DRAFT,evidence,proof=proof)==DRAFT
    assert any(p['rule']=='quoted_object_name' and '110 kV' in p['fragment'] for p in proof)
    assert any(p['fragment']=='5.88 K·m/W' and p['sources'] for p in proof)
    assert grounded_text(DRAFT.replace('“城南线路 · 110 kV 直埋单回校核”','城南线路 · 110 kV 直埋单回校核'),evidence)
    # Remove the directly reported margin: both operands must now justify the
    # difference, including integer/scientific notation, across this paragraph.
    derived=deepcopy(evidence)
    derived[0]['data']['studies'][0]['latest_run']['cases'][0]['factors']=[]
    for margin in ('148.32','148.3','148','1.4832e2'):
        text=f'允许电流 748.32 A。载流量余量 {margin} A（相对已加 600 A 负荷）。'
        proof=[];assert grounded_text(text,derived,proof=proof)==text
        assert any(p['rule']=='difference' and len(p['sources'])==2 for p in proof)
    cards=[{'kind':'cable_version','id':str(i),'name':'YJV22-8.7/15 kV 3×'+str(n)}
        for i,n in enumerate((35,50,70,95,120,150,185,240,300,400))]
    evidence.append({'data':{'items':cards}})
    assert grounded_text('、'.join(c['name'] for c in cards),evidence)
    assert grounded_text('规格 3×35、3×50、3×400。IEC 2023 方法。',evidence)
    # Identities cannot supply standalone engineering quantities; wrong values
    # and overprecise numbers remain failures and enter the existing repair loop.
    for text in ('允许电流 999 A。','允许电流 748.32 A。载流量余量 158 A（相对已加 600 A 负荷）。',
                 '允许电流 748.32 A。载流量余量 600 A（相对已加 600 A 负荷）。',
                 '最高导体温度 65.523 °C。','338.671 K。','土壤热阻率 1.1 K·m/W。',
                 '各层热阻率：绝缘 3.51、PE 3.5 K·m/W。',
                 '截面 35 mm²。','规格 3×999。'):
        with pytest.raises(HTTPException):grounded_text(text,evidence)
    with pytest.raises(HTTPException):grounded_text('研究电压 110 kV。',evidence)
