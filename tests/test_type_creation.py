"""Four origins in an isolated database; no demo-library writes or native solve."""
from copy import deepcopy
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.domain.models import DomainDocument


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path/'creation.sqlite')) as client:
        yield client


def request(**values):
    return {'request_id': str(uuid4()), **values}


@pytest.mark.parametrize('construction,count', [('single_core',1),('three_core',3)])
def test_blank_is_explicit_incomplete_and_replayable(client, construction, count):
    body=request(origin='blank',name='缺项设计',construction=construction)
    result=client.post('/api/types',json=body)
    assert result.status_code==201,result.text
    w=result.json()
    assert client.post('/api/types',json=body).json()['id']==w['id']
    assert client.post('/api/types',json={**body,'name':'其他'}).status_code==409
    cable=w['domain']['cable_types'][0]
    assert len(cable['cores'])==count and cable['rating']['u0'] is None
    assert all(c['conductor']['diameter'] is None and c['conductor']['nominal_area'] is None for c in cable['cores'])
    assert w['type_lifecycle']['status']=='draft' and not client.get('/api/types/library').json()['items']
    with pytest.raises(ValueError): DomainDocument.model_validate(w['domain'])
    document=deepcopy(w['domain']);document['cable_types'][0]['cores'][0]['conductor']['nominal_area']=70e-6
    save=request(expected_revision=w['revision'],document=document)
    saved=client.put(f"/api/types/{w['id']}/document",json=save)
    assert saved.status_code==200,saved.text
    assert saved.json()['revision']==w['revision']+1
    assert client.put(f"/api/types/{w['id']}/document",json=save).json()==saved.json()
    invalid=deepcopy(document);invalid['cable_types'][0]['cores'][0]['conductor']['material']='not-defined'
    assert client.put(f"/api/types/{w['id']}/document",json=request(expected_revision=saved.json()['revision'],document=invalid)).status_code==422


@pytest.mark.parametrize('voltage,area,thickness,standard', [('600/1000',70e-6,.0011,'12706.1'),('64000/110000',800e-6,.016,'11017.2')])
def test_sealed_standard_proposal_table_and_human_gate(client, voltage, area, thickness, standard):
    body=request(input={'schema_version':'cablesim.cable-design-request/1','construction':'single_core','voltage':voltage,'conductor':'copper_bare','area_m2':area,'form':'solid_round'})
    response=client.post('/api/types/creation-proposals',json=body)
    assert response.status_code==200,response.text
    proposal=response.json()
    assert client.post('/api/types/creation-proposals',json=body).json()==proposal
    row=proposal['rows'][0]
    assert row['value']==pytest.approx(thickness) and row['basis']=='standard_value'
    assert standard in row['source']['standard'] and row['source']['clause'] and row['source']['pdf_page']>0
    import math
    assert proposal['document']['cable_types'][0]['cores'][0]['conductor']['diameter']==pytest.approx(2*math.sqrt(area/math.pi))
    assert len(proposal['methods'])==2 and not client.get('/api/types/library').json()['items']
    creation=request(origin='standard',name='人工核对草稿',proposal_id=proposal['id'],content_sha256=proposal['content_sha256'],human_confirmed=True)
    assert client.post('/api/types',json=creation,headers={'X-CableSim-Actor':'agent'}).status_code==403
    assert client.post('/api/types',json={**creation,'human_confirmed':False},headers={'X-CableSim-Actor':'human'}).status_code==409
    made=client.post('/api/types',json=creation,headers={'X-CableSim-Actor':'human'})
    assert made.status_code==201,made.text
    assert made.json()['type_creation']['kind']=='standard'


def test_unsupported_proposal_does_not_create(client):
    body=request(input={'schema_version':'cablesim.cable-design-request/1','construction':'three_core','voltage':'64000/110000','conductor':'copper_bare','area_m2':800e-6,'form':'solid_round','gap_m':0})
    result=client.post('/api/types/creation-proposals',json=body)
    assert result.status_code==422,result.text
    assert '未覆盖' in result.text


def test_published_copy_independent_family_and_fixed_version(client, monkeypatch):
    from test_type_versions import workspace, seed_evidence, adopt, submit
    source=workspace(client);seed_evidence(client,source,monkeypatch);adopt(client,source)
    spec,submitted=submit(client,source)
    human={'X-CableSim-Actor':'human'}
    approval=request(submission_id=submitted['submission_id'],specification_digest=spec['digest'],human_confirmed=True)
    assert client.post(f"/api/types/{source['id']}/approve",json=approval,headers=human).status_code==200
    released=client.post(f"/api/types/{source['id']}/publish",json=request(submission_id=submitted['submission_id'],specification_digest=spec['digest']),headers=human)
    assert released.status_code==200,released.text
    fixed=client.get('/api/types/library').json()['items'][0]
    body=request(origin='library',name='独立复制设计',resource_id=fixed['id'],content_sha256=fixed['content_sha256'])
    copied=client.post('/api/types',json=body)
    assert copied.status_code==201,copied.text
    child=copied.json()
    assert child['type_origin_reference']['id']==fixed['id'] and child['type_origin_reference']['version']==fixed['version']
    assert child['type_lifecycle']['family']!=source['type_lifecycle']['family'] if source.get('type_lifecycle') else child['type_lifecycle']['family']=='type/'+child['id']
    assert child['type_lifecycle']['status']=='draft'
    assert client.get(f"/api/workspaces/{child['id']}/studies").json()==[]
    assert client.post('/api/types',json=body).json()['id']==child['id']
    assert client.post('/api/types',json={**body,'request_id':str(uuid4()),'content_sha256':'f'*64}).status_code==409


def test_catalogue_copy_lists_fixed_manufacturer_versions_and_keeps_missing(client):
    from test_datasheet_import import seed_model
    source = seed_model(client)
    options = client.get('/api/types/creation-options').json()['library']
    selected = next(item for item in options if item['id'] == source['id'])
    assert selected['content_sha256'] == source['digest']
    body = request(origin='library', name='库资料复制', resource_id=source['id'], content_sha256=source['digest'])
    response = client.post('/api/types', json=body)
    assert response.status_code == 201, response.text
    copied = response.json()
    assert copied['type_origin_reference']['id'] == source['id']
    assert copied['type_origin_reference']['content_sha256'] == source['digest']
    assert copied['type_lifecycle']['status'] == 'draft'
    assert client.post('/api/types', json=body).json()['id'] == copied['id']
    assert client.post('/api/types', json={**body, 'request_id':str(uuid4()), 'content_sha256':'0'*64}).status_code == 409
    assert client.get(f"/api/workspaces/{copied['id']}/studies").json() == []


def test_only_approved_import_creates_design_with_page_sources(client):
    from test_datasheet_import import upload,extract,seed_model
    doc=upload(client);run,_=extract(client,doc['id']);base=seed_model(client)
    decisions=[{'candidate_id':c['id'],'action':'accept','reason':'人工核对第 1 页'} for c in run['result']['candidates']]
    reviewed=client.post(f"/api/documents/{doc['id']}/extractions/{run['id']}/reviews",json=request(reviewer='Engineer',expected_revision=0,decisions=decisions))
    assert reviewed.status_code==200,reviewed.text
    proposed=client.post(f"/api/documents/{doc['id']}/proposals",json=request(extraction_id=run['id'],expected_review_revision=1,target_model_id=base['id'],expected_model_sha256=base['digest'],version='2'))
    assert proposed.status_code==201,proposed.text
    p=proposed.json();body=request(origin='import',name='资料来源设计',proposal_id=p['id'],content_sha256=p['sha256'])
    assert client.post('/api/types',json=body).status_code==409
    approved=client.post(f"/api/documents/{doc['id']}/proposals/{p['id']}/approval",json=request(proposal_sha256=p['sha256'],approver='Engineer',human_approved=True))
    assert approved.status_code==200,approved.text
    result=client.post('/api/types',json=body)
    assert result.status_code==201,result.text
    w=result.json();cores=w['domain']['cable_types'][0]['cores']
    assert len(cores)==3 and all(c['conductor']['diameter']==pytest.approx(.0206) for c in cores)
    assert all(c['layers'][0]['thickness'] is None for c in cores)
    assert doc['sha256'] in str(w['type_creation']['source']['references'])
    assert "'page': 1" in str(w['type_creation']['source']['references']) or '"page": 1' in str(w['type_creation']['source']['references'])


def seed_browser(database):
    """Private browser contract fixture, never an engineering/demo release.

    Publication uses visibly labelled receipt-only fixtures; document values come
    from the generated test PDF. Standard proposals in the browser use real plugins.
    """
    from test_type_versions import workspace, seed_evidence, adopt, submit
    from test_datasheet_import import upload,extract,seed_model
    with TestClient(create_app(database)) as client, pytest.MonkeyPatch.context() as patch:
        w=workspace(client)
        d=deepcopy(w['domain']);d['name']='隔离目录契约样例';d['cable_types'][0]['label']=d['name']
        updated=client.put(f"/api/workspaces/{w['id']}/domain",json={'expected_revision':w['revision'],'document':d})
        assert updated.status_code==200,updated.text
        w=client.get('/api/workspaces/'+w['id']).json()
        seed_evidence(client,w,patch);adopt(client,w);spec,submission=submit(client,w)
        human={'X-CableSim-Actor':'human'}
        approved=client.post(f"/api/types/{w['id']}/approve",headers=human,json=request(submission_id=submission['submission_id'],specification_digest=spec['digest'],human_confirmed=True))
        assert approved.status_code==200,approved.text
        released=client.post(f"/api/types/{w['id']}/publish",headers=human,json=request(submission_id=submission['submission_id'],specification_digest=spec['digest']))
        assert released.status_code==200,released.text
        doc=upload(client);run,_=extract(client,doc['id']);base=seed_model(client)
        reviewed=client.post(f"/api/documents/{doc['id']}/extractions/{run['id']}/reviews",json=request(reviewer='隔离资料验收',expected_revision=0,decisions=[{'candidate_id':c['id'],'action':'accept','reason':'测试 PDF 第 1 页'} for c in run['result']['candidates']]))
        assert reviewed.status_code==200,reviewed.text
        p=client.post(f"/api/documents/{doc['id']}/proposals",json=request(extraction_id=run['id'],expected_review_revision=1,target_model_id=base['id'],expected_model_sha256=base['digest'],version='2')).json()
        approved=client.post(f"/api/documents/{doc['id']}/proposals/{p['id']}/approval",json=request(proposal_sha256=p['sha256'],approver='隔离资料验收',human_approved=True))
        assert approved.status_code==200,approved.text
