"""Public extracted facts keep basis/source and import without approving a type."""
from hashlib import sha256
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.kernel.model_series import bundled_series, payloads, import_yjv22


def test_bundled_public_values_and_units_are_distinct_from_engineering_assumptions():
    values=list(payloads())
    assert [round(p['specification']['area_m2']*1e6) for p in values]==[35,50,70,95,120,150,185,240,300,400]
    for p in values:
        assert not p['confirmed'] and p['cable_type'] is None and p['specification']['missing']
        assert p['version']=='1.0.0'
        assert '四、结构尺寸' in p['sources']['factory']['reference']
        assert p['specification']['values']['r20']['basis']=='standard_limit'
        insulation=p['specification']['values']['insulation_thickness']
        assert insulation['value']==pytest.approx(.0045,abs=1e-15)
        assert {k:v for k,v in insulation.items() if k!='value'}=={'unit':'m','basis':'manufacturer','source':'factory'}
        assert not any(s['reviewed'] for s in p['sources'].values())
    p=values[-2]['specification']['values']
    assert p['outer_diameter']['value']==pytest.approx(.0861)
    assert p['conductor_diameter']['value']==pytest.approx(.0206)
    assert p['r20']['value']==pytest.approx(.0000601)
    data,_=bundled_series()
    assert data['engineering_scenario']['parameters']['values']['core_lay_length']['value']==2.152
    assert '非本型号实测' in data['engineering_scenario']['parameters']['values']['core_lay_length']['reference']


def test_public_snapshot_agrees_with_published_rows_when_controlled_source_is_present():
    source=Path(__file__).resolve().parents[1]/'.data/customer-selection/sources/Huayuan-YJV22.html'
    if not source.exists():pytest.skip('受控厂家原件不随仓库分发')
    from bs4 import BeautifulSoup
    data,_=bundled_series();raw=source.read_bytes()
    assert sha256(raw).hexdigest()==data['sources']['factory']['sha256']
    # GBK HTML includes other unrelated tables: require the full 13-cell structure row.
    rows=[[td.get_text(strip=True) for td in tr.find_all('td')] for tr in BeautifulSoup(raw.decode('gbk'),'html.parser').find_all('tr')]
    for row in data['rows']:
        area,count,wire,dc,bedding,width,gauge,outer_sheath,diameter,_=row
        actual=next(r for r in rows if len(r)==13 and r[0]==f'3×{area}' and '/' in r[1])
        assert [float(actual[i]) for i in (2,3,4,5,8,10,11)]==[dc,.8,4.5,.7,bedding,outer_sheath,diameter]
        assert actual[1]==f'{count}/{wire:.2f}'
        assert actual[9]==f'{width}×{gauge:.2f}'


def test_api_import_retries_do_not_duplicate_or_approve(tmp_path):
    with TestClient(create_app(tmp_path/'series.sqlite')) as client:
        def api(path,method='GET',body=None):
            response=client.request(method,path,json=body)
            assert response.is_success,response.text
            return response.json()
        method=next(m['method'] for m in api('/api/methods') if m['method']['plugin_id']=='cablesim.iec60287')
        first=import_yjv22(api,method);again=import_yjv22(api,method)
        assert [c['id'] for c in first['candidates']]==[c['id'] for c in again['candidates']]
        assert len(api('/api/domain-cable-models'))==10
        assert all(c['state']=='incomplete' for c in first['candidates'])
        assert all(c['method']['capability']=='model-completion' for c in first['candidate_completions'].values())
