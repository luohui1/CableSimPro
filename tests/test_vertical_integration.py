"""Independent domain mathematics, selection scope and provenance regressions."""
from math import pi,sqrt
import numpy as np
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.schemas import Cable
from backend.vertical import Vertical,VerticalNetwork,vertical_study
from backend.library import extract_parameters

@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path/'integrated.sqlite')) as c:yield c

def workspace(c):return c.post('/api/workspaces',json={}).json()

def test_vertical_zero_current_uniform_no_dielectric():
    state=VerticalNetwork(Cable(tan_delta=0),Vertical(ambient_bottom_c=25,ambient_top_c=25,cells=20)).state(0)
    assert max(abs(np.array(state['conductor_c'])-25))<1e-8
    assert state['single_cable_loss_w']==0

@pytest.mark.parametrize('screen,dielectric',[(0,0),(.15,.0004)])
def test_uniform_air_exact_closed_form_including_all_losses(screen,dielectric):
    c=Cable(tan_delta=dielectric,screen_loss_factor=screen)
    v=Vertical(ambient_bottom_c=25,ambient_top_c=25,emissivity=0,cells=20)
    n=VerticalNetwork(c,v);external=1/(pi*n.diameter*v.h_w_m2k)
    thermal=sum(n.t)+screen*n.t[-1]+(1+screen)*external
    dielectric_r=n.t[1]+n.t[2]+external
    expected=sqrt((c.max_temperature_c-25-n.wd*dielectric_r)/(n.r*(1+n.alpha*(c.max_temperature_c-20))*thermal))
    rated,state=n.rating()
    assert rated==pytest.approx(expected,rel=1e-7)
    assert np.ptp(state['conductor_c'])<1e-8
    assert state['balance_error_w']<1e-5

def test_axial_balance_refinement_hotspot():
    a=vertical_study(Cable(),Vertical(cells=20),350)
    b=vertical_study(Cable(),Vertical(cells=80),350)
    assert a['ampacity_a']==pytest.approx(b['ampacity_a'],rel=.008)
    assert b['operating']['balance_error_w']<1e-4
    assert b['operating']['hotspot_height_m']>15
    assert b['operating']['max_node_residual_w_m']<1e-6

def test_air_heat_transfer_monotonic_and_overload_rejection():
    low=VerticalNetwork(Cable(),Vertical(cells=20,h_w_m2k=4)).rating()[0]
    high=VerticalNetwork(Cable(),Vertical(cells=20,h_w_m2k=12)).rating()[0]
    assert high>low
    r=vertical_study(Cable(),Vertical(cells=20),3000)
    assert r['operating'] is None and r['operating_error']

def test_vertical_snapshot_hash_includes_air_boundaries(client):
    w=workspace(client);url=f"/api/design/{w['id']}/vertical"
    a=client.post(url,json={'expected_revision':1,'configuration':Vertical(cells=20).model_dump()}).json()
    b=client.post(url,json={'expected_revision':1,'configuration':Vertical(cells=20,h_w_m2k=10).model_dump()}).json()
    assert a['input_sha256']!=b['input_sha256']
    assert a['domain']=='vertical_air' and a['mesh_check']['coarse_cells']==10
    saved=client.get(f"/api/design/{w['id']}/fields/{a['id']}").json()
    assert saved==a
    assert client.post(url,json={'expected_revision':99,'configuration':{}}).status_code==409

@pytest.mark.parametrize('extra',[{'domain':'vertical_air'},{'domain':'buried','vertical':{}},{'domain':'vertical_air','vertical':{'h_w_m2k':0}}])
def test_design_cannot_mix_or_invent_air_boundaries(client,extra):
    w=workspace(client)
    r=client.post(f"/api/design/{w['id']}/selection",json={'expected_revision':1,'target_current_a':500,**extra})
    assert r.status_code==422

def product(c,w,price=25):
    return c.post('/api/design/catalog',json={'name':'Reviewed 240','cable':w['scenario']['cable'],
        'rated_u0_kv':12,'confirmed':True,'price_per_m':price,'currency':'CNY'}).json()

def request_selection(c,w,**kwargs):
    body={'expected_revision':w['revision'],'target_current_a':500,'reserve_percent':10,'domain':'vertical_air',
          'vertical':Vertical(cells=20).model_dump(),**kwargs}
    r=c.post(f"/api/design/{w['id']}/selection",json=body)
    assert r.status_code==200,r.text
    return r.json()

def test_vertical_selection_single_cable_units_and_approval_without_buried_run(client):
    w=workspace(client);p=product(client,w)
    study=request_selection(client,w,rank_by='cost')
    row=study['candidates'][0]
    assert study['feasible_count']==1 and row['feasible']
    assert row['cost']==20*25 and row['loss_basis']=='single_isolated_cable'
    assert row['circuit_loss_kw'] is None and row['loss_kw']>0
    proposal=client.post(f"/api/design/{w['id']}/selection/{study['id']}/propose",json={'expected_revision':1,'product_id':p['id']}).json()
    assert proposal['action']=='import' and proposal['source']['research_domain']=='vertical_air'
    approved=client.post(f"/api/workspaces/{w['id']}/proposals/{proposal['id']}/approve",json={'expected_revision':1}).json()
    assert approved['output'] is None and not approved['workspace']['runs']
    assert approved['workspace']['scenario']['installation']==w['scenario']['installation']

def test_vertical_selection_ignores_unused_soil_properties(client):
    w=workspace(client);product(client,w)
    a=request_selection(client,w)
    w=client.post(f"/api/workspaces/{w['id']}/edit",json={'expected_revision':1,'changes':[{'path':'installation.soil_rho_k_m_w','value':3.8},{'path':'installation.depth_m','value':1.5}]}).json()
    b=request_selection(client,w)
    assert a['candidates'][0]['ampacity_a']==b['candidates'][0]['ampacity_a']

def test_vertical_selection_no_feasible_is_not_relaxed(client):
    w=workspace(client);product(client,w)
    s=request_selection(client,w,target_current_a=3000)
    assert s['feasible_count']==0 and s['candidates'][0]['reasons']
    assert client.get(f"/api/workspaces/{w['id']}").json()['revision']==1

def test_markdown_ocr_labeled_value_unit_quotes_are_exact():
    text='| 导体截面积 | 300 | mm² |\n| **R20** | 0.0601 | Ω/km |\nU₀: 12 kV'
    params,conflicts=extract_parameters(text)
    assert not conflicts and len(params)==3
    assert {p['path'] for p in params}=={'cable.area_mm2','cable.r20_ohm_km','cable.u0_kv'}
    for p in params:assert text[p['start']:p['end']]==p['quote']

def test_multiple_voltage_values_do_not_guess_product():
    params,conflicts=extract_parameters('U0: 12 kV\nU0: 18 kV')
    assert conflicts==['cable.u0_kv'] and not params

def test_invalid_key_does_not_partially_change_provider_settings(client):
    before=client.get('/api/integrations').json()
    r=client.put('/api/integrations/ocr',json={'protocol':'mistral_ocr','base_url':'https://api.mistral.ai/v1','model':'changed','api_key':'do-not-reflect\nsecret'})
    assert r.status_code==422 and 'do-not-reflect' not in r.text
    assert client.get('/api/integrations').json()==before
