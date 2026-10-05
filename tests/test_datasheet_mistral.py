"""Scoped Mistral OCR and hybrid grounding; mock transport is not evaluation evidence."""
import json
import httpx,pytest
from test_datasheet_grounding import parser,table
from test_datasheet_import import pdf_bytes,scope,extract
from backend.main import create_app
from fastapi.testclient import TestClient

def test_invalid_provider_url_remains_typed_and_unavailable(monkeypatch):
 from backend.kernel.datasheet_provider import configuration
 monkeypatch.setenv('CABLESIM_DATASHEET_BASE_URL','not-a-url');monkeypatch.setenv('CABLESIM_DATASHEET_API_KEY','private-token')
 value=configuration()
 assert value['service']=='未配置' and value['endpoint']=='' and value['available'] is False

def test_mistral_defaults_are_pinned_and_private_key_never_disclosed(monkeypatch,tmp_path):
 monkeypatch.delenv('CABLESIM_DATASHEET_BASE_URL',raising=False);monkeypatch.delenv('CABLESIM_DATASHEET_MODEL',raising=False);monkeypatch.setenv('MISTRAL_API_KEY','private-token')
 with TestClient(create_app(tmp_path/'test.sqlite')) as client:
  did=client.post('/api/documents',files={'file':('blank.pdf',pdf_bytes(True))}).json()['id']
  response=client.post(f'/api/documents/{did}/disclosures',json=scope('hybrid'))
  assert response.status_code==200,response.text
  value=response.json();assert value['ocr_model']=='mistral-ocr-4-1' and value['provider_model']=='mistral-medium-2604'
  assert value['ocr_endpoint']=='https://api.mistral.ai/v1/ocr' and value['content_kind']=='selected_text_and_images'
  assert 'private-token' not in response.text and '_credential_fingerprint' not in response.text

def test_missing_ocr_blocks_fail_closed_without_second_external_request(monkeypatch,tmp_path):
 from uuid import uuid4
 monkeypatch.delenv('CABLESIM_DATASHEET_BASE_URL',raising=False);monkeypatch.setenv('MISTRAL_API_KEY','private-token')
 with TestClient(create_app(tmp_path/'test.sqlite')) as client:
  original=pdf_bytes(True);did=client.post('/api/documents',files={'file':('blank.pdf',original)}).json()['id'];s=scope('ocr')
  disclosure=client.post(f'/api/documents/{did}/disclosures',json=s).json();calls=[]
  def reply(req):calls.append(req.url.path);return httpx.Response(200,json={'model':'mistral-ocr-4-1','pages':[{'blocks':[]}],'usage_info':{'pages_processed':1}})
  client.app.state.documents.transport=httpx.MockTransport(reply)
  result,_=extract(client,did,{**s,'request_id':str(uuid4()),'disclosure_id':disclosure['id'],'disclosure_sha256':disclosure['disclosure_sha256'],'outbound_confirmed':True})
  assert result['error']['code']=='OCR_EVIDENCE_MISSING' and calls==['/v1/ocr']
  assert client.get(f'/api/documents/{did}/file').content==original

def test_hybrid_prompt_only_targets_missing_or_ambiguous_fields():
 t=table(50,86.1);page={'page':1,'width_pt':500,'height_pt':500,'text':'YJV','words':[c for row in t['rows'] for c in row],'tables':[t]}
 model={'designation':'YJV','specification':'300','identity_note':'upper unique'}
 result=parser.provider_request([page],model,strategy='hybrid')
 assert 'outer_diameter' not in result['target_fields'] and 'conductor_diameter' not in result['target_fields']
 assert 'r20' in result['target_fields']
 page.update(text='YJV HIDDEN_NATIVE_LAYER',png_base64='public-test-image',region_pt=[0,0,500,500])
 result=parser.provider_request([page],model,ocr=True,strategy='ocr')
 assert 'HIDDEN_NATIVE_LAYER' not in result['prompt'] and result['images'][0]['png_base64']=='public-test-image'
 weight,unit=parser.convert('weight',66.1,'kg/100m')  # Nexans PDF2:66.1kg per100m=0.661kg/m.
 assert weight==pytest.approx(.661) and unit=='kg/m'

def test_ocr_requires_exact_row_unit_and_records_separate_evidence():
 model={'designation':'YJV','specification':'300','identity_note':'test only'}
 html='<table><tr><th>Size YJV</th><th>Overall diameter mm</th></tr><tr><td>300</td><td>86.1</td></tr><tr><td>400</td><td>93.6</td></tr></table>'
 evidence={'page':1,'region_pt':[100,100,300,300],'width_pt':500,'height_pt':500,'recognized':{'dimensions':{'width':260,'height':260},'blocks':[{'type':'table','content':html,'top_left_x':0,'top_left_y':0,'bottom_right_x':260,'bottom_right_y':260,'confidence_scores':{'minimum_content_confidence_score':.99}}]}}
 pages=parser.ocr_pages([evidence],model)
 item={'field':'outer_diameter','raw_value':86.1,'raw_unit':'mm','page':1,'quote':'86.1','bbox_pt':[100,100,300,300]}
 result=parser.provider_response(pages,model,json.dumps({'candidates':[item]}))
 assert result['candidates'][0]['value_si']==pytest.approx(.0861)
 assert result['candidates'][0]['evidence_source']=='ocr' and not result['candidates'][0]['ambiguities']
 item.update(raw_value=93.6,quote='93.6');assert not parser.provider_response(pages,model,json.dumps({'candidates':[item]}))['candidates']
 item.update(raw_value=86.1,quote='86.1',raw_unit='cm');assert not parser.provider_response(pages,model,json.dumps({'candidates':[item]}))['candidates']

def test_hallucinated_original_quote_is_discarded():
 model={'designation':'YJV','specification':'300','identity_note':'grounding'};t=table(50,86.1)
 page={'page':1,'width_pt':500,'height_pt':500,'text':'YJV','words':[c for row in t['rows'] for c in row],'tables':[t]}
 item={'field':'outer_diameter','raw_value':888,'raw_unit':'mm','page':1,'quote':'888','bbox_pt':[180,80,270,100]}
 result=parser.provider_response([page],model,json.dumps({'candidates':[item]}))
 assert result['candidates']==[] and result['issues'][0]['code']=='PROVIDER_UNGROUNDED_CANDIDATE'
 page['text']='YJV22 only'
 item.update(raw_value=86.1,quote='86.1')
 assert parser.provider_response([page],model,json.dumps({'candidates':[item]}))['issues'][0]['code']=='MODEL_NOT_FOUND'
 assert parser.extract([page],model)['candidates']==[]

def test_ocr_success_is_preserved_when_llm_is_rate_limited(monkeypatch,tmp_path):
 from uuid import uuid4
 monkeypatch.delenv('CABLESIM_DATASHEET_BASE_URL',raising=False);monkeypatch.setenv('MISTRAL_API_KEY','private-token')
 with TestClient(create_app(tmp_path/'test.sqlite')) as client:
  raw=pdf_bytes(True);did=client.post('/api/documents',files={'file':('blank.pdf',raw)}).json()['id'];s=scope('ocr');d=client.post(f'/api/documents/{did}/disclosures',json=s).json()
  def reply(req):
   if req.url.path.endswith('/ocr'):return httpx.Response(200,json={'model':'mistral-ocr-4-1','usage_info':{'pages_processed':1},'pages':[{'dimensions':{'width':650,'height':650},'blocks':[{'type':'text','content':'YJV','top_left_x':0,'top_left_y':0,'bottom_right_x':100,'bottom_right_y':100}]}]})
   return httpx.Response(429,json={'message':'rate limit exceeded'})
  client.app.state.documents.transport=httpx.MockTransport(reply)
  result,_=extract(client,did,{**s,'request_id':str(uuid4()),'disclosure_id':d['id'],'disclosure_sha256':d['disclosure_sha256'],'outbound_confirmed':True})
  assert result['status']=='failed' and result['error']['code']=='PROVIDER_HTTP_ERROR'
  assert result['result']['ocr_evidence'][0]['recognized']['blocks'][0]['content']=='YJV'
  assert result['result']['provider_calls'][0]['pages']==1 and result['result']['candidates']==[]
  assert client.get(f'/api/documents/{did}/file').content==raw
  assert client.post(f"/api/documents/{did}/extractions/{result['id']}/reviews",json={'expected_revision':0,'request_id':str(uuid4()),'reviewer':'Engineer','decisions':[{'candidate_id':'none','action':'accept','reason':'must refuse partial run'}]}).status_code==409
