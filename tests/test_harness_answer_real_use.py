"""Paired actual-provider questions over one immutable release-seed source."""
import os

import pytest

from test_harness_real_use import real_use, projects

pytestmark=pytest.mark.skipif(os.environ.get('CABLESIM_AGENT_REAL_USE')!='1',reason='Explicit real provider / saved evidence acceptance')

QUESTIONS=[
    ('missing','study','检查这个研究还缺哪些输入，说明已检查的范围和我下一步应该做什么。'),
    ('conclusion','study','这个研究的载流量结论是什么？主要依据哪些输入？'),
    ('input_basis','study','解释这个研究的土壤、埋深和负荷输入依据，哪些是厂家数据、哪些是工程假设？'),
    ('temperature','study','这项研究最热导体多少摄氏度，距离温限还有多少？受限对象是谁？'),
    ('project_summary','project','汇总这个工程各研究的载流量结论和限制因素。'),
    ('chengnan_comparison','project','城南这条线 FEM 和 IEC 差多少，可信吗？请说明网格与域收敛、依据和局限。'),
    ('type_release','type','YJV22 8.7/15 kV 3×240 发布还差什么？说明型号审核阻塞和执行标准依据。'),
    ('screen_standard','project','三芯铜带屏蔽截面标准怎么规定？请给出标准版本、条款及原文页码。'),
    ('validation','project','有限元和公开算例差多少？部分复现和偏差超限的算例也要如实说明。'),
    ('inbox','project','帮我理一下待办，按原因分组说明处理顺序和各对象应该去哪处理。'),
]


@pytest.fixture(scope='module')
def answer_context(real_use):
    workspaces,types=projects(real_use)
    project=next(w for w in workspaces if '城南' in w['name'])
    studies=real_use.api('GET',f'/api/workspaces/{project["id"]}/studies')
    study=next(s for s in studies if s['definition']['method']['plugin_id']=='cablesim.iec60287'
        and s['definition']['driver']['kind']=='single')
    design=next(t for t in types if 'YJV22' in t['name'])
    return project,study,design


@pytest.mark.parametrize('name,scope,question',QUESTIONS,ids=[q[0] for q in QUESTIONS])
def test_real_answer_first_draft(real_use,answer_context,name,scope,question):
    phase=os.environ.get('CABLESIM_ANSWER_PHASE','after')
    project,study,design=answer_context
    wid=design['id'] if scope=='type' else project['id']
    before=len(real_use.report['tasks'])
    try:
        record,item=real_use.ask(phase+':'+name,wid,question+' 只读取保存证据，不修改、不批准、不运行、不提交作业。',
            study_id=study['id'] if scope=='study' else None)
    finally:
        if len(real_use.report['tasks'])>before:
            item=real_use.report['tasks'][-1]
            item.update(phase=phase,question=question,
                first_draft_passed=any(e['type']=='answer.accepted' for e in item['audit'])
                    and not any(e['type']=='answer.rejected' for e in item['audit']),
                rejected_drafts=sum(e['type']=='answer.rejected' for e in item['audit']))
            real_use.save()
    assert not record['proposals'],item
    assert record['budget']['model_requests']<=8,item
    assert item['object_refs'] or name=='screen_standard',item
    if phase=='before':return
    if name=='chengnan_comparison':
        assert '746.5' in item['answer'] and '748.3' in item['answer'],item
        assert '收敛' in item['answer'] and any(word in item['answer'] for word in ('网格','域')),item
    elif name=='screen_standard':
        assert '未规定' in item['answer'] and '截面' in item['answer'],item
        assert '查无原文' not in item['answer'] and '页' in item['answer'],item
    elif name=='type_release':
        assert any(word in item['answer'] for word in ('阻塞','未','缺')) and '标准' in item['answer'],item
