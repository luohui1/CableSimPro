"""Physics invariants, OCR/provider contracts, source provenance and selection safety."""
import asyncio
from io import BytesIO
import json
from math import log,pi,sqrt
import os
import numpy as np
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfWriter
from backend.main import create_app
from backend.physics import Cable,Vertical,VerticalNetwork,electric_study,vertical_study
from backend.library import Library,extract_fields
from backend import integrations


@pytest.fixture
def client(tmp_path,monkeypatch):
    for k in ('OPENAI_API_KEY','CABLESIM_AGENT_API_KEY','CABLESIM_AGENT_MODEL','CABLESIM_OCR_API_KEY','CABLESIM_OCR_PROVIDER'):
        monkeypatch.delenv(k,raising=False)
    with TestClient(create_app(tmp_path/'design.sqlite')) as c:yield c


def workspace(c):return c.post('/api/workspaces',json={}).json()
def image():
    data=BytesIO();Image.new('RGB',(32,32),'white').save(data,format='PNG');return data.getvalue()
def upload(c,text='截面积: 300 mm²\nR20: 0.0601 Ω/km\n绝缘厚度: 5.5 mm'):
    return c.post('/api/design/documents',files={'file':('product.txt',text.encode(),'text/plain')},data={'company':'Example Cable'}).json()


def test_vertical_zero_current_uniform_no_dielectric():
    c=Cable(tan_delta=0);v=Vertical(ambient_bottom_c=25,ambient_top_c=25)
    state=VerticalNetwork(c,v).state(0)
    assert max(abs(np.array(state['conductor_c'])-25))<1e-8
    assert state['single_cable_loss_w']==0


def test_vertical_constant_h_analytical_limit_without_radiation():
    c=Cable(tan_delta=0,screen_loss_factor=0);v=Vertical(ambient_bottom_c=25,ambient_top_c=25,emissivity=0)
    n=VerticalNetwork(c,v);resistance=sum(n.t)+1/(pi*n.diameter*v.h_w_m2k)
    expected=sqrt((c.max_temperature_c-25)/(n.r*(1+n.alpha*(c.max_temperature_c-20))*resistance))
    rating,state=n.rating()
    assert rating==pytest.approx(expected,rel=1e-7)
    assert max(state['conductor_c'])-min(state['conductor_c'])<1e-8


def test_vertical_balance_refinement_and_hotspot():
    c=Cable();a=vertical_study(c,Vertical(cells=20),350);b=vertical_study(c,Vertical(cells=80),350)
    s=b['operating'];assert s['balance_error_w']<1e-4
    assert s['hotspot_height_m']>15
    assert a['ampacity_a']==pytest.approx(b['ampacity_a'],rel=.008)
    assert s['max_temperature_c']<90


def test_vertical_cooling_and_temperature_monotonicity():
    c=Cable()
    ratings=[VerticalNetwork(c,v).rating()[0] for v in (Vertical(h_w_m2k=4),Vertical(h_w_m2k=12),Vertical(h_w_m2k=12,ambient_top_c=55))]
    assert ratings[0]<ratings[1] and ratings[2]<ratings[1]


def test_vertical_very_large_current_not_fabricated():
    r=vertical_study(Cable(),Vertical(),3000)
    assert r['operating'] is None and r['operating_error']


def test_electric_boundary_integral_and_peak():
    c=Cable();r=electric_study(c)
    assert r['potential_rms_kv'][0]==pytest.approx(c.u0_kv)
    assert abs(r['potential_rms_kv'][-1])<1e-12
    assert np.trapezoid(r['electric_rms_kv_mm'],r['radius_mm'])==pytest.approx(c.u0_kv,rel=1e-5)
    assert r['electric_peak_kv_mm'][0]==pytest.approx(r['max_electric_rms_kv_mm']*sqrt(2))
    assert all(x>y for x,y in zip(r['electric_rms_kv_mm'],r['electric_rms_kv_mm'][1:]))


def test_electric_voltage_scales_field_not_capacitance():
    a=electric_study(Cable(u0_kv=6));b=electric_study(Cable(u0_kv=12))
    assert b['max_electric_rms_kv_mm']==pytest.approx(2*a['max_electric_rms_kv_mm'])
    assert a['capacitance_nf_km']==b['capacitance_nf_km']


def test_text_upload_search_and_field_quote(client):
    d=upload(client);assert d['status']=='ready'
    found=client.get('/api/design/search',params={'q':'R20'}).json();assert found[0]['page']==1 and '.0601' in found[0]['quote']
    fields=client.get(f"/api/design/documents/{d['id']}/fields").json()
    assert len(fields['fields'])==3
    assert all(f['quote'] in d['pages'][0]['text'] for f in fields['fields'])
    duplicate=upload(client);assert duplicate['id']==d['id']


def test_markdown_table_extraction_and_conflicts():
    r=extract_fields([{'page':2,'text':'| 截面积 | 300 | mm² |\n| R20 | 0.0601 | Ω/km |'}])
    assert len(r['fields'])==2 and r['fields'][0]['page']==2
    r=extract_fields([{'page':1,'text':'截面积 300 mm²\n截面积 400 mm²'}]);assert r['conflicts']==['area_mm2'] and not r['fields']


@pytest.mark.parametrize('name,data',[('evil.svg',b'<script/>'),('fake.pdf',b'not pdf'),('fake.png',b'not image'),('nul.txt',b'hello\0world'),('huge.txt',b'x'*200001)])
def test_invalid_uploads(client,name,data):
    assert client.post('/api/design/documents',files={'file':(name,data)}).status_code==422


def test_image_waits_for_key_without_fabricating_text(client):
    d=client.post('/api/design/documents',files={'file':('scan.png',image())},data={'auto_ocr':'true'}).json()
    assert d['status']=='needs_ocr' and d['pages'][0]['text']=='' and 'processing_error' in d
    assert client.post(f"/api/design/documents/{d['id']}/ocr",json={'consent':True}).status_code==503


def test_scanned_pdf_queued_not_misreported_ready(client):
    data=BytesIO();writer=PdfWriter();writer.add_blank_page(width=300,height=400);writer.write(data)
    d=client.post('/api/design/documents',files={'file':('scan.pdf',data.getvalue())}).json()
    assert d['status']=='needs_ocr' and not d['pages'][0]['text']


def test_real_text_pdf_uses_local_extraction(client):
    from reportlab.pdfgen.canvas import Canvas
    data=BytesIO();c=Canvas(data);c.drawString(40,800,'Conductor area: 300 mm2');c.drawString(40,780,'R20: 0.0601 ohm/km');c.save()
    d=client.post('/api/design/documents',files={'file':('digital.pdf',data.getvalue())}).json()
    assert d['status']=='ready' and d['pages'][0]['method']=='pdf-text'
    assert len(client.get(f"/api/design/documents/{d['id']}/fields").json()['fields'])==2


def test_gateway_ocr_contract_and_no_repeat(client,monkeypatch):
    monkeypatch.setenv('CABLESIM_OCR_PROVIDER','gateway');monkeypatch.setenv('CABLESIM_OCR_API_KEY','test-secret');monkeypatch.setenv('CABLESIM_OCR_URL','https://gateway.example/ocr')
    calls=[]
    async def fake(url,key,payload):
        calls.append(payload);assert key=='test-secret'
        return {'pages':[{'page':1,'text':'R20: 0.0601 Ω/km'}]}
    monkeypatch.setattr(integrations,'request_json',fake)
    d=client.post('/api/design/documents',files={'file':('scan.png',image())}).json();url=f"/api/design/documents/{d['id']}/ocr"
    assert client.post(url,json={'consent':False}).status_code==403 and not calls
    r=client.post(url,json={'consent':True});assert r.status_code==200 and r.json()['pages'][0]['method']=='cloud-ocr'
    assert calls[0]['mime_type']=='image/png' and calls[0]['pages']==[1]
    assert client.post(url,json={'consent':True,'pages':[1]}).status_code==409
    assert 'test-secret' not in str(client.get('/api/design/integrations').json())


def test_mistral_maps_zero_based_pages(monkeypatch):
    monkeypatch.setenv('CABLESIM_OCR_PROVIDER','mistral');monkeypatch.setenv('CABLESIM_OCR_API_KEY','x')
    async def fake(url,key,payload):
        assert payload['pages']==[1] and payload['document']['type']=='document_url'
        return {'pages':[{'index':1,'markdown':'parsed'}]}
    monkeypatch.setattr(integrations,'request_json',fake)
    assert asyncio.run(integrations.ocr_bytes(b'pdf','application/pdf',[2],True))=={2:'parsed'}


def test_wrong_ocr_pages_do_not_overwrite(client,monkeypatch):
    monkeypatch.setenv('CABLESIM_OCR_PROVIDER','mistral');monkeypatch.setenv('CABLESIM_OCR_API_KEY','x')
    async def fake(*args):return {'pages':[{'index':3,'markdown':'wrong page'}]}
    monkeypatch.setattr(integrations,'request_json',fake)
    d=upload(client);url=f"/api/design/documents/{d['id']}/ocr"
    assert client.post(url,json={'consent':True,'pages':[1],'force':True}).status_code==502
    assert client.get('/api/design/documents/'+d['id']).json()['pages']==d['pages']


def test_catalog_requires_confirmation_and_exact_evidence(client):
    w=workspace(client);d=upload(client);e=client.get(f"/api/design/documents/{d['id']}/fields").json()['fields']
    cable=w['scenario']['cable'];cable.update({f['field']:f['value'] for f in e})
    body={'name':'Product 300','manufacturer':'Example','cable':cable,'source_id':d['id'],'evidence':e,'confirmed':False}
    assert client.post('/api/design/catalog',json=body).status_code==403
    body['confirmed']=True;body['cable']['area_mm2']=400
    assert client.post('/api/design/catalog',json=body).status_code==422
    body['cable']['area_mm2']=300;r=client.post('/api/design/catalog',json=body)
    assert r.status_code==201 and r.json()['status']=='reviewed_partial'


def test_selection_empty_without_demo_and_monotonic_target(client):
    w=workspace(client);url=f"/api/design/workspaces/{w['id']}/select"
    b={'expected_revision':1,'target_a':500}
    assert not client.post(url,json=b).json()['output']['rows']
    b.update(include_demo=True,conductor='copper');r=client.post(url,json=b);assert r.status_code==200
    x=r.json()['output'];assert x['recommended_id'] and all(r['ampacity_a']>=550 for r in x['rows'] if r['passed'])
    b['target_a']=3000;y=client.post(url,json=b).json()['output'];assert y['recommended_id'] is None
    assert client.get(f"/api/workspaces/{w['id']}").json()['revision']==1


def test_selection_locks_and_voltage(client):
    w=workspace(client);url=f"/api/workspaces/{w['id']}/lock"
    w=client.post(url,json={'expected_revision':1,'path':'cable.u0_kv','locked':True}).json()
    assert client.post(f"/api/design/workspaces/{w['id']}/select",json={'expected_revision':2,'target_a':500,'required_u0_kv':18,'include_demo':True}).status_code==422


def test_candidate_is_only_proposal(client):
    w=workspace(client)
    p=client.post(f"/api/design/workspaces/{w['id']}/candidate",json={'expected_revision':1,'catalog_id':'demo-copper-400'}).json()
    assert p['ready'] and client.get(f"/api/workspaces/{w['id']}").json()['scenario']['cable']['area_mm2']==240
    r=client.post(f"/api/workspaces/{w['id']}/proposals/{p['id']}/approve",json={'expected_revision':1}).json()
    assert r['workspace']['scenario']['cable']['area_mm2']==400


def test_field_runs_have_snapshots_and_conflicts(client):
    w=workspace(client);url=f"/api/design/workspaces/{w['id']}/fields/electric"
    r=client.post(url,json={'expected_revision':1}).json()
    client.post(f"/api/workspaces/{w['id']}/edit",json={'expected_revision':1,'changes':[{'path':'cable.area_mm2','value':400}]})
    assert client.post(url,json={'expected_revision':1}).status_code==409
    record=client.get(f"/api/design/workspaces/{w['id']}/runs/{r['id']}").json()
    assert record['input']['scenario']['cable']['area_mm2']==240
    assert client.get(f"/api/design/workspaces/{w['id']}/runs/{r['id']}/report").status_code==200


def test_research_local_is_search_not_llm(client):
    w=workspace(client);upload(client)
    r=client.post(f"/api/design/workspaces/{w['id']}/agent",json={'expected_revision':1,'message':'检索资料: R20'}).json()
    assert r['mode']=='local' and r['citations'] and r['comparison'] is None


@pytest.mark.parametrize('protocol',['responses','chat_completions'])
def test_cloud_provider_tool_contract_and_sources(client,monkeypatch,protocol):
    w=workspace(client);d=upload(client)
    monkeypatch.setenv('CABLESIM_AGENT_API_KEY','secret');monkeypatch.setenv('CABLESIM_AGENT_MODEL','model-test');monkeypatch.setenv('CABLESIM_AGENT_PROTOCOL',protocol)
    calls=[]
    async def fake(url,key,payload):
        calls.append(payload)
        if len(calls)==1:
            if protocol=='responses':return {'status':'completed','output':[{'type':'function_call','name':'search_documents','arguments':'{"query":"R20"}'}]}
            return {'choices':[{'finish_reason':'tool_calls','message':{'tool_calls':[{'function':{'name':'search_documents','arguments':'{"query":"R20"}'}}]}}]}
        assert '0.0601' in json.dumps(payload,ensure_ascii=False)
        if protocol=='responses':return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'资料中 R20 为 0.0601 Ω/km，需核对。'}]}]}
        return {'choices':[{'finish_reason':'stop','message':{'content':'资料需核对'}}]}
    monkeypatch.setattr(integrations,'request_json',fake)
    body={'expected_revision':1,'message':'查资料','mode':'cloud','consent':False}
    assert client.post(f"/api/design/workspaces/{w['id']}/agent",json=body).status_code==403 and not calls
    body['consent']=True;r=client.post(f"/api/design/workspaces/{w['id']}/agent",json=body)
    assert r.status_code==200 and len(calls)==2 and r.json()['citations'][0]['document_id']==d['id']
    assert client.get(f"/api/workspaces/{w['id']}").json()['revision']==1


def test_model_cannot_call_arbitrary_tools(client,monkeypatch):
    w=workspace(client);monkeypatch.setenv('CABLESIM_AGENT_API_KEY','s');monkeypatch.setenv('CABLESIM_AGENT_MODEL','m')
    async def fake(*args):return {'output':[{'type':'function_call','name':'run_shell','arguments':'{}'}]}
    monkeypatch.setattr(integrations,'request_json',fake)
    assert client.post(f"/api/design/workspaces/{w['id']}/agent",json={'expected_revision':1,'message':'x','mode':'cloud','consent':True}).status_code==502


def test_document_update_cas(tmp_path):
    lib=Library(tmp_path/'docs.sqlite');lib.initialize();d=lib.add(b'R20: 0.1 ohm/km','data.txt','x')
    lib.update_pages(d['id'],d['pages'],d['revision'])
    with pytest.raises(HTTPException) as exc:lib.update_pages(d['id'],d['pages'],d['revision'])
    assert exc.value.status_code==409


@pytest.mark.parametrize('url',['http://external.example/api','https://user:key@host.test/x','https://api.test/x?key=y','ftp://api.test'])
def test_reject_unsafe_server_endpoints(url):
    with pytest.raises(HTTPException):integrations.endpoint(url)


def test_axial_flow_can_cool_upper_node_at_small_load():
    n=VerticalNetwork(Cable(tan_delta=0),Vertical())
    state=n.state(2)
    assert state['balance_error_w']<1e-4
    assert state['conductor_c'][-1]<state['ambient_c'][-1]


def test_review_cannot_certify_newer_unseen_text(client):
    d=upload(client);url=f"/api/design/documents/{d['id']}/review"
    body={'expected_revision':d['revision'],'page':1,'confirmed':True}
    assert client.post(url,json=body).status_code==200
    assert client.post(url,json=body).status_code==409
