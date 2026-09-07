"""v0.4 contract/security/document/selection/field tests. Provider calls use mocks only."""
import io
import json
from pathlib import Path
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfWriter

from backend.main import create_app
from backend.providers import ProviderConfig, Providers
from backend.field_analysis import poisson,compute_fields
from backend.schemas import Scenario


@pytest.fixture
def app(tmp_path,monkeypatch):
    for name in ('OPENAI_API_KEY','CABLESIM_OCR_API_KEY','MISTRAL_API_KEY','CABLESIM_AGENT_MODEL','CABLESIM_PROVIDER_HOSTS'):
        monkeypatch.delenv(name,raising=False)
    return create_app(tmp_path/'project.sqlite')


@pytest.fixture
def client(app):
    with TestClient(app) as c:yield c


def workspace(c):return c.post('/api/workspaces',json={}).json()


def upload(c,text='截面积: 300 mm²\nR20: 0.0601 Ω/km',name='product.txt'):
    r=c.post('/api/library',files={'file':(name,text.encode(),'text/plain')},data={'company':'示例企业'})
    assert r.status_code==201,r.text
    return r.json()


def reviewed(c,doc,text=None):
    r=c.post(f"/api/library/{doc['id']}/review",json={'expected_version':doc['version'],'page':1,'text':text or doc['pages'][0]['text'],'confirmed':True})
    assert r.status_code==200,r.text
    return r.json()


def configure(c,service='ocr',protocol=None):
    return c.put('/api/integrations/'+service,json={'protocol':protocol or ('mistral_ocr' if service=='ocr' else 'openai_responses'),
        'base_url':'https://api.mistral.ai/v1' if service=='ocr' else 'https://api.openai.com/v1',
        'model':'test-model','api_key':'TEST-SECRET-DO-NOT-LEAK'})


def image_upload(c):
    b=io.BytesIO();Image.new('RGB',(30,30),'white').save(b,'PNG')
    r=c.post('/api/library',files={'file':('scan.png',b.getvalue(),'image/png')})
    assert r.status_code==201,r.text
    return r.json()


def test_keys_in_memory_never_in_status_config_or_project(client,app):
    r=configure(client);assert r.status_code==200,r.text
    assert 'TEST-SECRET' not in r.text
    assert r.json()['providers']['ocr']['key_storage']=='memory'
    cfg=app.state.providers.config_path.read_text()
    assert 'TEST-SECRET' not in cfg and 'api_key' not in cfg
    assert 'TEST-SECRET' not in client.get('/api/integrations').text
    assert 'TEST-SECRET' not in client.post('/api/workspaces',json={}).text
    other=Providers(app.state.providers.directory)
    assert not other.public()['providers']['ocr']['key_present']


@pytest.mark.parametrize('url',['http://api.openai.com/v1','https://127.0.0.1/v1','https://169.254.169.254/v1',
    'https://api.openai.com.evil.test/v1','https://user:secret@api.openai.com/v1','https://api.openai.com/v1?api_key=leak',
    'https://api.openai.com:8443/v1','https://localhost/v1'])
def test_provider_url_restrictions(client,url):
    assert client.put('/api/integrations/agent',json={'protocol':'openai_responses','base_url':url,'model':'m'}).status_code==422


def test_custom_provider_explicit_server_allowlist(client,monkeypatch):
    body={'protocol':'custom_ocr','base_url':'https://ocr.example.org/v1','model':'m'}
    assert client.put('/api/integrations/ocr',json=body).status_code==422
    monkeypatch.setenv('CABLESIM_PROVIDER_HOSTS','ocr.example.org')
    assert client.put('/api/integrations/ocr',json=body).status_code==200


def test_clear_keys_and_environment_policy(client,app,monkeypatch):
    configure(client)
    r=client.put('/api/integrations/ocr',json={'protocol':'mistral_ocr','base_url':'https://api.mistral.ai/v1','model':'m','clear_key':True})
    assert not r.json()['providers']['ocr']['key_present']
    monkeypatch.setenv('CABLESIM_OCR_API_KEY','ENV-SECRET')
    assert client.get('/api/integrations').json()['providers']['ocr']['key_storage']=='environment'


def test_foreign_origins_and_dns_rebinding_rejected(client):
    assert client.post('/api/workspaces',json={},headers={'Origin':'https://attacker.test'}).status_code==403
    assert client.get('/api/integrations',headers={'Host':'attacker.test'}).status_code==403
    assert client.post('/api/workspaces',json={},headers={'Origin':'http://localhost:5173'}).status_code==201


def test_native_text_source_search_and_versioned_review(client):
    doc=upload(client)
    assert doc['status']=='needs_review'
    assert len(doc['pages'][0]['parameters'])==2
    hits=client.get('/api/library/search',params={'q':'R20'}).json()['hits']
    assert hits[0]['id']==doc['id'] and hits[0]['page']==1
    after=reviewed(client,doc)
    assert after['status']=='reviewed' and after['version']==2
    assert client.post(f"/api/library/{doc['id']}/review",json={'expected_version':1,'page':1,'text':'changed','confirmed':True}).status_code==409
    download=client.get(f"/api/library/{doc['id']}/file")
    assert download.headers['content-disposition'].startswith('attachment')
    assert download.headers['x-content-type-options']=='nosniff'


def test_native_pdf_reads_page_text_without_ocr(client):
    from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
    writer=PdfWriter();page=writer.add_blank_page(width=300,height=300)
    font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
    page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
    stream=DecodedStreamObject();stream.set_data(b'BT /F1 12 Tf 20 270 Td (Conductor area: 300 mm2) Tj ET')
    page[NameObject('/Contents')]=writer._add_object(stream)
    b=io.BytesIO();writer.write(b)
    r=client.post('/api/library',files={'file':('native.pdf',b.getvalue(),'application/pdf')})
    assert r.status_code==201,r.text
    assert '300 mm2' in r.json()['pages'][0]['text']
    assert r.json()['pages'][0]['method']=='pdf-text-layer'


def test_blank_pdf_marks_needs_ocr(client):
    writer=PdfWriter();writer.add_blank_page(200,200);b=io.BytesIO();writer.write(b)
    r=client.post('/api/library',files={'file':('blank.pdf',b.getvalue(),'application/pdf')})
    assert r.status_code==201,r.text
    assert r.json()['status']=='needs_ocr'


@pytest.mark.parametrize('name,data',[('file.html',b'<script>alert(1)</script>'),('fake.pdf',b'not pdf'),('bad.png',b'not png'),('bad.txt',b'\xff\xfe')])
def test_reject_unsafe_and_invalid_upload(client,name,data):
    assert client.post('/api/library',files={'file':(name,data)}).status_code in (415,422)


def test_reject_encrypted_pdf(client):
    writer=PdfWriter();writer.add_blank_page(100,100);writer.encrypt('secret');b=io.BytesIO();writer.write(b)
    assert client.post('/api/library',files={'file':('secret.pdf',b.getvalue())}).status_code==422


def test_ocr_requires_key_consent_and_valid_pages(client):
    doc=image_upload(client);route=f"/api/library/{doc['id']}/ocr"
    assert doc['status']=='needs_ocr'
    assert client.post(route,json={'expected_version':1,'pages':[1]}).status_code==403
    assert client.post(route,json={'expected_version':1,'pages':[1],'consent':True}).status_code==503
    assert client.post(route,json={'expected_version':1,'pages':[2],'consent':True}).status_code==422
    assert client.post(route,json={'expected_version':1,'pages':[1,1],'consent':True}).status_code==422


@pytest.mark.parametrize('protocol',['mistral_ocr','custom_ocr'])
def test_ocr_contract_pages_are_real_and_review_required(client,app,monkeypatch,protocol):
    configure(client,protocol=protocol);doc=image_upload(client);seen=[]
    async def mock(name,endpoint,payload,method='POST'):
        seen.append(payload)
        return {'pages':[{'index':0,'markdown':'R20: 0.0601 Ω/km'}]} if protocol=='mistral_ocr' else {'pages':[{'page':1,'text':'R20: 0.0601 Ω/km'}]}
    monkeypatch.setattr(app.state.providers,'request',mock)
    r=client.post(f"/api/library/{doc['id']}/ocr",json={'expected_version':1,'pages':[1],'consent':True})
    assert r.status_code==200,r.text
    doc=r.json();assert doc['version']==2 and doc['status']=='needs_review'
    assert doc['pages'][0]['text']=='R20: 0.0601 Ω/km' and not doc['pages'][0]['reviewed']
    assert seen[0]['pages']==([0] if protocol=='mistral_ocr' else [1])


@pytest.mark.parametrize('raw',[{'pages':[]},{'pages':[{'page':2,'text':'x'}]}, {'pages':[{'page':1,'text':'x'},{'page':1,'text':'y'}]}, {'pages':[{'page':1,'text':'x'*30001}]}])
def test_bad_ocr_never_overwrites_library(client,app,monkeypatch,raw):
    configure(client,protocol='custom_ocr');doc=image_upload(client)
    async def mock(*a,**k):return raw
    monkeypatch.setattr(app.state.providers,'request',mock)
    r=client.post(f"/api/library/{doc['id']}/ocr",json={'expected_version':1,'pages':[1],'consent':True})
    assert r.status_code==502,r.text
    assert client.get(f"/api/library/{doc['id']}").json()['version']==1


def test_library_proposal_cannot_skip_review_or_forge_quote(client):
    w=workspace(client);doc=upload(client);route=f"/api/library/{doc['id']}/propose"
    body={'expected_revision':1,'workspace_id':w['id'],'document_version':1,'page':1}
    assert client.post(route,json=body).status_code==422
    doc=reviewed(client,doc);body['document_version']=doc['version']
    assert client.post(route,json={**body,'excerpt':'截面积: 999 mm²'}).status_code==422
    r=client.post(route,json=body);assert r.status_code==200,r.text
    p=r.json();assert len(p['changes'])==2
    current=client.get('/api/workspaces/'+w['id']).json();assert current['revision']==1
    after=client.post(f"/api/workspaces/{w['id']}/proposals/{p['id']}/approve",json={'expected_revision':1}).json()['workspace']
    assert after['scenario']['cable']['area_mm2']==300
    assert after['sources'][0]['file_sha256']==doc['digest']
    assert after['sources'][0]['document_version']==2


def test_library_conflicts_require_single_model_excerpt(client):
    w=workspace(client);doc=reviewed(client,upload(client,'截面积: 300 mm²\n截面积: 400 mm²'))
    body={'expected_revision':1,'workspace_id':w['id'],'document_version':doc['version'],'page':1}
    assert client.post(f"/api/library/{doc['id']}/propose",json=body).status_code==422
    assert client.post(f"/api/library/{doc['id']}/propose",json={**body,'excerpt':'截面积: 300 mm²'}).status_code==200


def test_retrieval_answer_without_fake_ai(client):
    upload(client)
    r=client.post('/api/library/ask',json={'question':'R20 参数'}).json()
    assert r['mode']=='retrieval' and r['citations'][0]['citation']=='S1'
    assert '未启用大模型' in r['answer']
    assert not client.post('/api/library/ask',json={'question':'absentfoobar'}).json()['citations']
    assert client.post('/api/library/ask',json={'question':'R20','mode':'agent'}).status_code==403


def test_agent_document_answer_citation_guard(client,app,monkeypatch):
    upload(client);configure(client,'agent')
    async def fake(*a,**kw):return {'output':[{'type':'message','content':[{'type':'output_text','text':'资料 R20 为 0.0601 Ω/km [S1]。'}]}]}
    monkeypatch.setattr(app.state.providers,'request',fake)
    r=client.post('/api/library/ask',json={'question':'R20','mode':'agent','consent':True})
    assert r.status_code==200 and '[S1]' in r.json()['answer']
    async def bad(*a,**kw):return {'output':[{'type':'message','content':[{'type':'output_text','text':'错误引用 [S99]'}]}]}
    monkeypatch.setattr(app.state.providers,'request',bad)
    assert client.post('/api/library/ask',json={'question':'R20','mode':'agent','consent':True}).status_code==502


@pytest.mark.parametrize('protocol',['openai_responses','openai_chat'])
def test_configured_agent_plan_still_requires_approval(client,app,monkeypatch,protocol):
    w=workspace(client);configure(client,'agent',protocol)
    args={'action':'calculate','changes':[{'path':'cable.area_mm2','value':400}],'parameter':None,'values':[],'questions':[]}
    async def fake(name,endpoint,payload,**kw):
        if protocol=='openai_responses':return {'output':[{'type':'function_call','name':'propose_study','arguments':json.dumps(args)}]}
        return {'choices':[{'message':{'tool_calls':[{'function':{'name':'propose_study','arguments':json.dumps(args)}}]}}]}
    monkeypatch.setattr(app.state.providers,'request',fake)
    route=f"/api/workspaces/{w['id']}/plan"
    assert client.post(route,json={'expected_revision':1,'message':'change area','mode':'openai'}).status_code==403
    r=client.post(route,json={'expected_revision':1,'message':'change area','mode':'openai','consent':True})
    assert r.status_code==200,r.text
    assert r.json()['changes'][0]['after']==400
    assert client.get('/api/workspaces/'+w['id']).json()['revision']==1


def design(c,w,**kw):
    return c.post(f"/api/design/{w['id']}/selection",json={'expected_revision':w['revision'],'target_current_a':500,**kw})


def test_catalog_default_no_demo_silent_inclusion(client):
    w=workspace(client);r=design(client,w).json()
    assert r['candidates']==[] and r['feasible_count']==0
    products=client.get('/api/design/catalog').json()
    assert len(products)==12 and all(p['state']=='demo' for p in products)


def test_selection_feasibility_reserve_order_and_locked_soil(client):
    w=workspace(client);r=design(client,w,include_demo=True,conductor='copper').json()
    assert r['required_ampacity_a']==pytest.approx(550)
    good=[p for p in r['candidates'] if p['feasible']]
    assert good and good[0]['area_mm2']==300
    for row in good:
        assert row['ampacity_a']>=550
        assert row['scenario']['installation']==w['scenario']['installation']
        assert row['scenario']['cable']['max_temperature_c']<=90
        assert row['scenario']['operating_current_a']==500
    p=client.post(f"/api/design/{w['id']}/selection/{r['id']}/propose",json={'expected_revision':1,'product_id':good[0]['product_id']}).json()
    assert p['ready']
    assert client.get('/api/workspaces/'+w['id']).json()['revision']==1
    assert client.post(f"/api/workspaces/{w['id']}/proposals/{p['id']}/approve",json={'expected_revision':1}).status_code==200


def test_selection_infeasible_and_stale_rejected(client):
    w=workspace(client);r=design(client,w,include_demo=True,max_diameter_mm=10).json()
    assert r['feasible_count']==0
    assert client.post(f"/api/design/{w['id']}/selection/{r['id']}/propose",json={'expected_revision':1,'product_id':r['candidates'][0]['product_id']}).status_code==422
    r=design(client,w,include_demo=True).json()
    client.post('/api/workspaces/'+w['id']+'/edit',json={'expected_revision':1,'changes':[{'path':'installation.depth_m','value':1}]})
    assert client.post(f"/api/design/{w['id']}/selection/{r['id']}/propose",json={'expected_revision':2,'product_id':r['candidates'][0]['product_id']}).status_code==409


def test_selection_lock_respected_no_cheating(client):
    w=workspace(client)
    w=client.post('/api/workspaces/'+w['id']+'/lock',json={'expected_revision':1,'path':'cable.area_mm2','locked':True}).json()
    r=design(client,w,include_demo=True).json()
    assert r['feasible_count']==0
    assert any('将改变锁定参数' in p['reasons'] for p in r['candidates'])


def test_catalog_review_and_cost_ranking_never_invent_prices(client):
    w=workspace(client)
    body={'name':'企业模板 630','cable':{**w['scenario']['cable'],'area_mm2':630,'r20_ohm_km':.028},'rated_u0_kv':12,'price_per_m':100}
    assert client.post('/api/design/catalog',json=body).status_code==422
    assert client.post('/api/design/catalog',json={**body,'confirmed':True}).status_code==201
    r=design(client,w,rank_by='cost').json()
    assert r['feasible_count']==1 and r['candidates'][0]['cost']==300000
    r=design(client,w,rank_by='cost',currency='USD').json()
    assert r['feasible_count']==0


def test_no_external_source_proof_when_catalog_reference_forged(client):
    w=workspace(client)
    r=client.post('/api/design/catalog',json={'name':'invalid','cable':w['scenario']['cable'],'rated_u0_kv':12,
        'confirmed':True,'source_id':'fake','workspace_id':w['id']})
    assert r.status_code==422


def test_poisson_manufactured_quadratic_and_energy_balance():
    n=25;xs=ys=np.linspace(0,1,n);xx,yy=np.meshgrid(xs,ys)
    exact=xx*(1-xx)+yy*(1-yy)
    sol,d=poisson(exact,np.full_like(exact,4),1/(n-1),1/(n-1),1)
    assert np.max(abs(exact-sol))<1e-12
    assert d['energy_error_w_m']<1e-10


def test_thermal_fd_grid_refinement_and_boundary():
    s=Scenario();out=compute_fields(s,'thermal_fd',129);d=out['diagnostics']
    assert d['energy_error_w_m']<1e-7
    assert d['linear_residual']<1e-6
    assert d['reference_rmse_k']<d['coarse_reference_rmse_k']
    assert np.max(abs(np.array(out['values'][0],dtype=float)-s.installation.ambient_temperature_c))<1e-10
    assert any(v is None for row in out['values'] for v in row)


def test_electric_integral_and_voltage_scaling():
    s=Scenario();out=compute_fields(s,'electric');d=out['diagnostics']
    assert d['voltage_integral_kv']==pytest.approx(s.cable.u0_kv,rel=1e-6)
    assert d['max_field_kv_mm_rms']>d['min_field_kv_mm_rms']
    s.cable.u0_kv=6;second=compute_fields(s,'electric')
    assert second['diagnostics']['max_field_kv_mm_rms']==pytest.approx(d['max_field_kv_mm_rms']/2)


def test_magnetic_zero_and_current_scaling():
    s=Scenario();s.operating_current_a=0
    assert compute_fields(s,'magnetic')['range']==[0,0]
    s.operating_current_a=100;one=compute_fields(s,'magnetic')
    s.operating_current_a=200;two=compute_fields(s,'magnetic')
    assert two['range'][1]==pytest.approx(one['range'][1]*2)


@pytest.mark.parametrize('kind',['thermal_fd','electric','magnetic'])
def test_field_api_snapshot_and_stale_revision(client,kind):
    w=workspace(client);r=client.post(f"/api/design/{w['id']}/fields",json={'expected_revision':1,'kind':kind})
    assert r.status_code==200,r.text
    assert r.json()['input']==w['scenario'] and len(r.json()['values'])==65
    assert client.post(f"/api/design/{w['id']}/fields",json={'expected_revision':99,'kind':kind}).status_code==409


def test_database_library_catalog_studies_survive_restart(tmp_path):
    path=tmp_path/'persist.sqlite'
    with TestClient(create_app(path)) as c:
        doc=reviewed(c,upload(c));w=workspace(c);r=design(c,w,include_demo=True).json()
    with TestClient(create_app(path)) as c:
        assert c.get('/api/library/'+doc['id']).json()['pages'][0]['reviewed']
        assert c.get(f"/api/design/{w['id']}/selection/{r['id']}").json()['feasible_count']>0


def test_invalid_secret_validation_never_reflects_key(client):
    r=client.put('/api/integrations/ocr',json={'protocol':'mistral_ocr','base_url':'https://api.mistral.ai/v1','model':'m','api_key':'SECRET'*1000})
    assert r.status_code==422 and 'SECRET' not in r.text


def test_document_history_keeps_original_ocr_and_corrected_text(client):
    doc=upload(client,'R20: 0.0601 Ω/km')
    corrected=reviewed(client,doc,'R20: 0.061 Ω/km')
    old=client.get(f"/api/library/{doc['id']}/versions/1").json()
    assert old['pages'][0]['text']=='R20: 0.0601 Ω/km'
    assert corrected['pages'][0]['text']=='R20: 0.061 Ω/km'
