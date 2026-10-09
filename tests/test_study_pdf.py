"""Saved-report formatting: no solver, DB mutation, or fabricated live results."""
from copy import deepcopy
import base64
import re

import fitz
import pytest

from backend.kernel.workspace import fingerprint
from backend.kernel.study_pdf import render_pdf, chapters, engineering_value
from backend.kernel.report import pdf_downloads
import json


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
        assert len(doc)>=2
        assert all(any(font[1]=='ttf' for font in page.get_fonts()) for page in doc)
        return '\n'.join(page.get_text() for page in doc)


def test_customer_book_has_real_selection_precision_and_no_internal_sources(run):
    before=deepcopy(run);text=pdf_text(render_pdf([run],generated_at='2026-10-05T01:02:03+00:00'))
    from backend.kernel.study_pdf import local_time
    for phrase in ['测试工程','测试询价','研究修订 2',local_time('2026-10-05T01:02:03+00:00'),'编制','校核','审核','批准','推荐 试验型号 3×400','423 A','23 A','缺少真实尺寸','历史运行复现','IEC 60287-1-1:2023','85.1','31.71']:
        assert phrase in text
    assert 'v0 ' not in text and '内部私有来源摘要' not in text and not re.search('[a-f0-9]{64}',text)
    assert run==before


def test_internal_book_appends_source_summary(run):
    text=pdf_text(render_pdf([run],'internal'))
    assert '附录：来源摘要' in text and '内部私有来源摘要' in text and 'test-run' not in text
    assert 'aaaa aaaa' in text.replace(' ','') or 'a'*16 in text
    with fitz.open(stream=render_pdf([run],'internal'),filetype='pdf') as doc:
        assert json.loads(doc.embfile_get('saved-runs.json')) == [run]


def test_crossing_chapter_uses_saved_capacity_factor_and_source(run):
    from math import pi
    run['snapshot']['definition']['driver']={'kind':'single'}
    run['output']['assessment']=[]
    trace=run['output']['cases'][0]['artifacts']['x-cablesim.iec60287-trace']
    trace['crossing_derating']=[{'baseline_current_a':565.5,'derated_current_a':510.0,
        'derating_factor':510/565.5,'crossing_rise_k':13.06,
        'clause':'IEC 60287-3-3:2007 4.1–4.3','scope':'水平固定热源，正净距。',
        'sources':[{'label':'热力管','depth_m':.6,'net_clearance_m':.3,'angle_rad':pi/2,
            'heat_w_m':50,'source':'工程师给定 · 热管测量记录'}]}]
    run['input_digest']=fingerprint(run['snapshot']);run['output_digest']=fingerprint(run['output'])
    before=deepcopy(run)
    text=pdf_text(render_pdf([run]))
    for phrase in ['交叉热源降额','降额前','降额后','565.5','510','0.9019',
        'IEC 60287-3-3:2007','热力管','热管测量记录']:assert phrase in text
    assert run==before


@pytest.mark.parametrize('audience',['customer','internal'])
@pytest.mark.parametrize('label',['当前版本','基于旧版本方法 0.9.0（cablesim.iec60287）；当前安装版本 0.10.0'])
def test_cover_displays_run_version_status(run,audience,label):
    run['version_status']={'display_name':label}
    before=deepcopy(run)
    with fitz.open(stream=render_pdf([run],audience),filetype='pdf') as document:
        cover=''.join(document[0].get_text().split())
        assert '版本状态' in cover
        assert ''.join(label.replace('cablesim.iec60287','IEC 60287 稳态载流量').split()) in cover
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


@pytest.mark.parametrize('audience',['customer','internal'])
def test_titleblock_summary_and_identity_free_paper(run,audience):
    run['snapshot']['definition']['title']='型号 public-sample+engineering 校核'
    run['output']['cases'][0]['results']=[{'entity':'cable1','key':'conductor_temperature','value':358.21,'unit':'K','status':'available'}]
    run['input_digest']=fingerprint(run['snapshot']);run['output_digest']=fingerprint(run['output'])
    with fitz.open(stream=render_pdf([run],audience),filetype='pdf') as doc:
        cover=doc[0].get_text();full='\n'.join(p.get_text() for p in doc)
        for field in ['工程名称','研究名称','图号 / 文件号','修订','设计','校核','审核','运行编号与摘要','日期','结论摘要','允许电流','最热导体温度','温限余量','423 A','85.1 °C','4.9 K']:assert field in cover
        for internal in ['cable1','cable/cable1','test-run','cablesim.iec60287','+engineering','public-sample']:assert internal not in full
        assert doc.embfile_count() == (1 if audience=='internal' else 0)


def test_results_group_by_object_omit_buried_ducts_and_false_precision(run):
    from backend.kernel.study_pdf import grouped_results,_names
    rows=[{'entity':'cable1','key':key,'value':value,'unit':unit,'status':'available'} for key,value,unit in [
        ('thermal_resistance.insulation',.45678,'K*m/W'),('x-cablesim.iec60287.temperature_rise.mutual',15.5219,'K'),
        ('x-cablesim.iec60287.thermal_resistance.duct_air',.9,'K*m/W')]]
    domain=run['snapshot']['cases'][0]['input']
    html=grouped_results([{'status':'succeeded','results':rows}],_names(domain),domain)
    assert '回路' in html and '相别' in html and '0.457' in html and '15.5' in html
    assert '管内空气' not in html and '15.5219' not in html


def test_paper_sources_keep_field_evidence_without_identity_metadata():
    from backend.kernel.study_pdf import input_sources,paper_text
    document={'materials':[{'id':'soil','label':'土壤','thermal_resistivity':1.0}],
        'provenance':{path:{'kind':'manufacturer','reference':'厂家样本','page':4}
            for path in ['/materials/soil/id','/materials/soil/label',
                '/materials/soil','/materials/soil/thermal_resistivity']}}
    before=deepcopy(document)
    html=input_sources(document,{})
    assert '/thermal_resistivity' in html and '第 4 页' in html and '厂家资料' in html
    assert '/soil/id' not in html and '/soil/label' not in html
    assert '热阻率' in paper_text([], '/materials/soil/thermal_resistivity')
    assert document==before


def test_cover_short_digest_local_minutes_and_distinct_surface_heading(run):
    from backend.kernel.study_pdf import local_time,grouped_results,_names
    run['created']='2026-10-05T05:12:09.045960+00:00'
    with fitz.open(stream=render_pdf([run]),filetype='pdf') as document:
        text=document[0].get_text()
        assert '输入 '+run['input_digest'][:8] in text
        assert '结果 '+run['output_digest'][:8] in text
        assert run['input_digest'][:12] not in text.split('运行编号与摘要',1)[1].split('日期',1)[0]
        full='\n'.join(page.get_text() for page in document)
        assert '.045960' not in full and local_time(run['created']) in full
    keys=['ampacity','x-cablesim.iec60287.current','conductor_temperature','sheath_temperature','surface_temperature']
    rows=[{'entity':'cable1','key':key,'unit':'A' if 'current' in key or key=='ampacity' else 'K','value':320.,'status':'available'} for key in keys]
    domain=run['snapshot']['cases'][0]['input']
    html=grouped_results([{'status':'succeeded','results':rows}],_names(domain),domain)
    assert html.count('<h3>温度与电流</h3>')==1 and '<h3>表面温度</h3>' in html


def test_cover_uses_standards_from_bound_saved_reference(run):
    first=deepcopy(run)
    first['output']['cases'][0]['artifacts']={}
    first['output_digest']=fingerprint(first['output'])
    with fitz.open(stream=render_pdf([first,run]),filetype='pdf') as document:
        cover=document[0].get_text()
        assert 'IEC 60287-1-1:2023' in cover
        assert '保存运行未登记引用标准' not in cover
