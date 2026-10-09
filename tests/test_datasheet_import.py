"""Document import/review/approval, failure isolation and exact source grounding."""
import json,time
from hashlib import sha256
from uuid import uuid4
import fitz,httpx,pytest
from fastapi.testclient import TestClient
from backend.main import create_app

def pdf_bytes(blank=False):
 doc=fitz.open();page=doc.new_page(width=500,height=500)
 if not blank:
  page.insert_text((30,40),'YJV 8.7/15 kV')
  xs=[30,90,200,310];ys=[70,100,130,160]
  for x in xs:page.draw_line((x,70),(x,160))
  for y in ys:page.draw_line((30,y),(310,y))
  for y,texts in [(90,['Size','Conductor diameter mm','Overall diameter mm']), (120,['300','20.6','86.1']), (150,['400','23.8','93.6'])]:
   for x,text in zip([33,93,203],texts):page.insert_text((x,y),text,fontsize=7)
 raw=doc.tobytes();doc.close();return raw

@pytest.fixture
def client(tmp_path):
 app=create_app(tmp_path/'test.sqlite')
 with TestClient(app) as client:yield client

def upload(client,raw=None):
 response=client.post('/api/documents',files={'file':('manufacturer.pdf',raw or pdf_bytes(),'application/pdf')})
 assert response.status_code==201,response.text
 return response.json()

def scope(method='rules'):
 return {'method':method,'model':{'designation':'YJV','specification':'300','identity_note':'8.7/15 kV, copper 3-core PVC'},'selections':[{'page':1}]}

def extract(client,did,request=None):
 request=request or {**scope(),'request_id':str(uuid4())}
 response=client.post(f'/api/documents/{did}/extractions',json=request)
 assert response.status_code==202,response.text
 url=response.headers['location'];result=response.json()
 for _ in range(250):
  result=client.get(url).json()
  if result['status'] not in ('accepted','running'):return result,request
  time.sleep(.04)
 raise AssertionError('Extraction timed out')

def test_original_page_and_rules_are_exact_and_idempotent(client):
 original=pdf_bytes();doc=upload(client,original);did=doc['id']
 assert upload(client,original)['id']==did
 assert doc['sha256']==sha256(original).hexdigest()
 assert client.get(f'/api/documents/{did}/file').content==original
 page=client.get(f'/api/documents/{did}/pages/1').json()
 assert page['text_source']=='original' and '300' in page['text']
 assert client.get(f'/api/documents/{did}/pages/1/image').content.startswith(b'\x89PNG')
 result,request=extract(client,did)
 assert result['status']=='succeeded',result
 from backend.kernel.workspace import fingerprint
 assert fingerprint(result['result'])==result['result_sha256']
 rows={c['field']:c for c in result['result']['candidates']}
 assert rows['conductor_diameter']['value_si']==pytest.approx(.0206)
 assert rows['outer_diameter']['value_si']==pytest.approx(.0861)
 assert all(c['quote'] not in ('23.8','93.6') for c in rows.values())
 assert extract(client,did,request)[0]['id']==result['id']
 request['model']['specification']='400'
 assert client.post(f'/api/documents/{did}/extractions',json=request).status_code==409

def seed_model(client):
 payload={'name':'YJV-8.7/15 kV 3×300','version':'1','sources':{'catalogue':{'kind':'manufacturer','reference':'Test base version','reviewed':True}},'specification':{'manufacturer':'Test','designation':'YJV','u0_v':8700,'voltage_v':15000,'cores':3,'area_m2':.0003,'conductor':'copper_bare','values':{'outer_diameter':{'value':.08,'unit':'m','basis':'manufacturer','source':'catalogue'}},'missing':['conductor_diameter','insulation_thickness','filler']}}
 response=client.post('/api/domain-cable-models',json=payload);assert response.status_code==201,response.text;return response.json()

def test_individual_human_review_and_approval_create_new_draft_only(client):
 doc=upload(client);did=doc['id'];run,_=extract(client,did);eid=run['id'];base=seed_model(client)
 proposal={'request_id':str(uuid4()),'extraction_id':eid,'expected_review_revision':1,'target_model_id':base['id'],'expected_model_sha256':base['digest'],'version':'2'}
 assert client.post(f'/api/documents/{did}/proposals',json=proposal).status_code==409
 decisions=[{'candidate_id':c['id'],'action':'modify' if c['field']=='outer_diameter' else 'accept','reason':'Checked numeric cell against original','value':87,'unit':'mm'} if c['field']=='outer_diameter' else {'candidate_id':c['id'],'action':'accept','reason':'Checked against original'} for c in run['result']['candidates']]
 review={'request_id':str(uuid4()),'reviewer':'Engineer','expected_revision':0,'decisions':decisions}
 response=client.post(f'/api/documents/{did}/extractions/{eid}/reviews',json=review);assert response.status_code==200,response.text
 assert response.json()['revision']==1
 assert client.post(f'/api/documents/{did}/extractions/{eid}/reviews',json=review).json()==response.json()
 review['request_id']=str(uuid4());assert client.post(f'/api/documents/{did}/extractions/{eid}/reviews',json=review).status_code==409
 response=client.post(f'/api/documents/{did}/proposals',json=proposal);assert response.status_code==201,response.text;p=response.json()
 assert len(client.get('/api/domain-cable-models').json())==1
 approval={'request_id':str(uuid4()),'proposal_sha256':p['sha256'],'approver':'Engineer','human_approved':True}
 url=f"/api/documents/{did}/proposals/{p['id']}/approval"
 response=client.post(url,json=approval);assert response.status_code==200,response.text
 assert client.post(url,json=approval).json()['new_model_id']==response.json()['new_model_id']
 versions=client.get('/api/domain-cable-models').json();assert len(versions)==2
 unchanged=next(v for v in versions if v['id']==base['id']);new=next(v for v in versions if v['id']!=base['id'])
 assert unchanged['digest']==base['digest'] and new['state']=='incomplete'
 assert new['payload']['specification']['values']['outer_diameter']['value']==pytest.approx(.087)
 assert any(doc['sha256'] in s['reference'] and 'bbox_pt' in s['reference'] for s in new['payload']['sources'].values())
 source=json.loads(new['payload']['sources']['source_document']['reference'])
 assert source['document_id']==did and source['original_sha256']==doc['sha256']
 assert source['selections']==[{'page':1}]
 relations=client.get(f"/api/index/objects/cable_version/{new['id']}/relations")
 assert relations.status_code==200,relations.text
 links=[row for row in relations.json()['uses'] if row['role']=='source_document']
 assert links and all(row['target']['id']==did for row in links)
 assert all(row['freshness']=='current' and '1' in row['reason'] for row in links)

@pytest.mark.parametrize('value',[1,'true',False])
def test_confirmation_is_literal_human_boolean(client,value):
 response=client.post('/api/documents/unknown/proposals/unknown/approval',json={'request_id':str(uuid4()),'proposal_sha256':'a'*64,'approver':'Human','human_approved':value})
 assert response.status_code==422

def test_corrupt_and_out_of_bounds_inputs_preserve_original(client):
 doc=upload(client)
 assert client.post('/api/documents',files={'file':('bad.pdf',b'%PDF-invalid')}).status_code==422
 assert len(client.get('/api/documents').json())==1
 assert client.get(f"/api/documents/{doc['id']}/pages/99").status_code==422
 blank_raw=pdf_bytes(True);blank=upload(client,blank_raw);run,_=extract(client,blank['id'])
 assert run['status']=='failed' and run['error']['code']=='OCR_NO_TEXT'
 assert client.get(f"/api/documents/{blank['id']}/file").content==blank_raw

def test_provider_requires_scoped_disclosure_and_does_not_leak_key(client,monkeypatch):
 raw=pdf_bytes();doc=upload(client,raw);did=doc['id'];request={**scope('llm'),'request_id':str(uuid4())}
 assert client.post(f'/api/documents/{did}/extractions',json=request).status_code==409
 for key,value in {'CABLESIM_DATASHEET_BASE_URL':'https://manufacturer-provider.example/v1','CABLESIM_DATASHEET_MODEL':'test-model','CABLESIM_DATASHEET_API_KEY':'test-secret-key'}.items():monkeypatch.setenv(key,value)
 disclosure=client.post(f'/api/documents/{did}/disclosures',json=scope('llm'));assert disclosure.status_code==200,disclosure.text
 d=disclosure.json();assert d['available'] and 'test-secret-key' not in disclosure.text
 request.update(disclosure_id=d['id'],disclosure_sha256=d['disclosure_sha256'],outbound_confirmed=True)
 client.app.state.documents.transport=httpx.MockTransport(lambda req:httpx.Response(429,json={'error':{'secret':'test-secret-key'}}))
 run,_=extract(client,did,request);assert run['status']=='failed' and run['error']['code']=='PROVIDER_HTTP_ERROR'
 assert 'test-secret-key' not in json.dumps(run) and run['result'] is None
 assert client.get(f'/api/documents/{did}/file').content==raw

def test_comparison_rejects_different_model_scope(client):
 doc=upload(client);a,_=extract(client,doc['id']);b,_=extract(client,doc['id'])
 response=client.post(f"/api/documents/{doc['id']}/comparisons",json={'extraction_ids':[a['id'],b['id']]})
 assert response.status_code==200 and all(r['agrees'] for r in response.json()['rows'])

def test_key_rotation_requires_new_disclosure(client,monkeypatch):
 doc=upload(client)
 for key,value in {'CABLESIM_DATASHEET_BASE_URL':'https://example.com/v1','CABLESIM_DATASHEET_MODEL':'configured-model','CABLESIM_DATASHEET_API_KEY':'original-key'}.items():monkeypatch.setenv(key,value)
 d=client.post(f"/api/documents/{doc['id']}/disclosures",json=scope('llm')).json()
 assert '_credential_fingerprint' not in d
 monkeypatch.setenv('CABLESIM_DATASHEET_API_KEY','rotated-key')
 request={**scope('llm'),'request_id':str(uuid4()),'disclosure_id':d['id'],'disclosure_sha256':d['disclosure_sha256'],'outbound_confirmed':True}
 response=client.post(f"/api/documents/{doc['id']}/extractions",json=request)
 assert response.status_code==409 and response.json()['detail']['code']=='OUTBOUND_DISCLOSURE_CHANGED'
