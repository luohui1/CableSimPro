"""Saved-report formatting: no solver, DB mutation, or fabricated live results."""
from copy import deepcopy
import base64
import re

import fitz
import pytest

from backend.kernel.workspace import fingerprint
from backend.kernel.study_pdf import render_pdf, chapters, engineering_value
from backend.kernel.report import pdf_downloads


@pytest.fixture
def run():
    document={'schema_version':'cablesim.domain/1','name':'测试工程','materials':[{'id':'soil','label':'v0 soil','thermal_resistivity':1}],
        'cable_types':[{'cores':[{'conductor':{'nominal_area':.0003}}]}],
        'circuits':[{'id':'c1','label':'v0 circuit','bonding':{'kind':'both_ends'},'cables':[{'id':'cable1','phase':'L1L2L3'}]}],
        'sections':[{'kind':'ground','label':'三芯排管','placements':[{'x':0,'z':-1.2}],'medium':{'material':'soil','surface_temperature':None},'enclosures':[]}],
        'load_cases':[{'currents':{'c1':400}}]}
    candidates=[{'state':'engineering_input','digest':str(i)*64,'payload':{'name':f'试验型号 3×{area}','version':'1.0','cable_type':{'cores':[{'conductor':{'nominal_area':area*1e-6}}]}}} for i,area in enumerate([400,300],1)]
    definition={'title':'测试询价','method':{'plugin_id':'cablesim.iec60287','capability':'steady-rating','version':'0.9.0','release_digest':'a'*64},
        'driver':{'kind':'selection','candidate_ids':['a','b'],'minimum':400,'rating_basis':'individual'},'input_sources':{'/condition':{'reference':'内部私有来源摘要','reviewed':False}}}
    snapshot={'definition':definition,'candidate_snapshots':candidates,'workspace_revision':3,'study_revision':2,'workspace_state':{'domain':document},
        'cases':[{'case_id':f'case-{i}','input':document} for i in range(2)]}
    output={'assessment':[{'case_id':'case-0','status':'satisfied','value':423.47,'margin':23.47},
        {'case_id':'case-1','status':'not_applicable','value':None,'margin':None,'reason':{'message':'缺少真实尺寸'}}],
        'cases':[{'case_id':'case-0','status':'succeeded','results':[],'artifacts':{'x-cablesim.iec60287-trace':{'sources':['IEC 60287-1-1:2023 4.2.1'],
            'operating':{'cable_states':[{'entity':'cable1','current_a':400,'conductor_temperature_c':85.06,'margin_k':4.94,'total_loss_w_m':31.707}]}}}},
            {'case_id':'case-1','status':'not_applicable','results':[],'error':{'message':'缺少真实尺寸'}}]}
    return {'id':'test-run','snapshot':snapshot,'output':output,'input_digest':fingerprint(snapshot),'output_digest':fingerprint(output),
        'freshness':'historical','integrity':'verified','status':'partial','created':'2026-10-05T00:00:00+00:00'}


def pdf_text(data):
    with fitz.open(stream=data,filetype='pdf') as doc:
        assert len(doc)>=4
        assert all(any(font[1]=='ttf' for font in page.get_fonts()) for page in doc)
        return '\n'.join(page.get_text() for page in doc)


def test_customer_book_has_real_selection_precision_and_no_internal_sources(run):
    before=deepcopy(run);text=pdf_text(render_pdf([run],generated_at='2026-10-05T01:02:03+00:00'))
    for phrase in ['测试工程','测试询价','研究修订 2','2026-10-05 01:02:03','编制','审核','批准','推荐 试验型号 3×400','423 A','23 A','缺少真实尺寸','历史运行复现','IEC 60287-1-1:2023','85.1','31.71','未输出 °C']:
        assert phrase in text
    assert 'v0 ' not in text and '内部私有来源摘要' not in text and not re.search('[a-f0-9]{64}',text)
    assert run==before


def test_internal_book_appends_source_summary(run):
    text=pdf_text(render_pdf([run],'internal'))
    assert '附录：来源摘要' in text and '内部私有来源摘要' in text and 'test-run' in text
    assert 'aaaa aaaa' in text.replace(' ','') or 'a'*16 in text


@pytest.mark.parametrize('audience',['customer','internal'])
@pytest.mark.parametrize('label',['当前版本','基于旧版本方法 0.9.0（cablesim.iec60287）；当前安装版本 0.10.0'])
def test_cover_displays_run_version_status(run,audience,label):
    run['version_status']={'display_name':label}
    before=deepcopy(run)
    with fitz.open(stream=render_pdf([run],audience),filetype='pdf') as document:
        cover=''.join(document[0].get_text().split())
        assert '版本状态' in cover
        assert ''.join(label.split()) in cover
        assert '编制与审核签字' in cover
    assert run==before


def test_corrupt_run_cannot_be_printed(run):
    run['output']['assessment'][0]['value']=999
    with pytest.raises(ValueError,match='完整性'):render_pdf([run])


def test_no_recommendation_for_unverified_candidates_and_no_current_claim(run):
    for c in run['snapshot']['candidate_snapshots']:c['state']='unreviewed'
    text=''.join(chapters([run],'customer'))
    assert '未取得可推荐候选' in text and '推荐 试验型号' not in text
    assert '不能作为当前版本' in text


def test_small_engineering_tolerance_is_not_rounded_into_a_different_value():
    assert engineering_value('diameter_rounding',{'value':.00005,'unit':'m'})==('0.05','mm')


def test_embedded_editions_are_distinct_valid_pdf_bytes(run):
    html=pdf_downloads([run]);matches=re.findall(r'data-report-pdf="([^"]+)"[^>]+href="data:application/pdf;base64,([^"]+)"',html)
    assert [m[0] for m in matches]==['customer','internal']
    texts=[pdf_text(base64.b64decode(data,validate=True)) for _,data in matches]
    assert '内部私有来源摘要' not in texts[0] and '内部私有来源摘要' in texts[1]
