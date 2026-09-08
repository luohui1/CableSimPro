from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.schemas import Cable

@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / 'enterprise.sqlite')) as c:
        yield c

def workspace(c): return c.post('/api/workspaces', json={}).json()
def spec(code='MV-240', area=240):
    return {'code':code,'name':'试验用型号 '+code,'manufacturer':'测试企业 / 非真实厂家数据',
            'cable':Cable(area_mm2=area,r20_ohm_km=17.241/area).model_dump(),
            'rated_u0_kv':12,'r20_basis':'manufacturer_maximum','evidence_note':'测试用假设保证值，非真实产品数据'}
def create(c, body=None):
    r=c.post('/api/enterprise/products',json=body or spec());assert r.status_code==201,r.text;return r.json()
def review(c, v, action='review'):
    return c.post(f"/api/enterprise/versions/{v['id']}/{action}",json={'content_sha256':v['content_sha256'],'reviewer':'测试核对人','note':'自动测试的显式确认说明','confirmed':True})
def call(c,w,cap,args=None,reqid=None):
    return c.post(f"/api/runtime/{w['id']}/invoke",json={'expected_revision':w['revision'],'request_id':reqid or str(uuid4()),'capability':cap,'arguments':args or {}})
def approve(c,w,p):
    return c.post(f"/api/workspaces/{w['id']}/proposals/{p['id']}/approve",json={'expected_revision':w['revision']})
def draft_version(c,v,body=None):
    return c.post(f"/api/enterprise/products/{v['product_id']}/versions",json={'expected_head':v['head'],'specification':body or v['specification']})

def test_empty_catalog_never_uses_demo_candidates(client):
    w=workspace(client)
    assert client.get('/api/enterprise/products').json()==[]
    r=call(client,w,'selection.reviewed',{'target_current_a':300,'include_demo':True})
    assert r.status_code==422 and '没有可参与' in r.text

def test_product_payload_is_immutable_while_review_events_are_recorded(client):
    v=create(client);r=review(client,v);assert r.status_code==200,r.text
    approved=r.json()
    assert approved['specification']==v['specification'] and approved['content_sha256']==v['content_sha256']
    assert approved['is_current_reviewed'] and len(approved['events'])==2
    assert review(client,approved).status_code==409

def test_duplicate_code_case_insensitive(client):
    create(client,spec('MV-A'))
    assert client.post('/api/enterprise/products',json=spec('mv-a')).status_code==409

@pytest.mark.parametrize('change',[{'code':' '},{'name':' '},{'manufacturer':' '},{'rated_u0_kv':6},{'source_id':str(uuid4())}])
def test_invalid_specifications_rejected(client,change):
    data=spec();data.update(change)
    assert client.post('/api/enterprise/products',json=data).status_code==422

@pytest.mark.parametrize('basis',['estimated','sample_measurement'])
def test_measurements_and_estimates_are_not_product_guarantees(client,basis):
    data=spec();data['r20_basis']=basis;v=create(client,data)
    assert review(client,v).status_code==422

def test_review_requires_explicit_confirmation_and_correct_hash(client):
    v=create(client)
    for changes in [{'confirmed':False},{'content_sha256':'f'*64},{'reviewer':' '},{'note':'     '}]:
        data={'content_sha256':v['content_sha256'],'reviewer':'甲','note':'已逐项核对输入','confirmed':True};data.update(changes)
        assert client.post(f"/api/enterprise/versions/{v['id']}/review",json=data).status_code in (409,422)

def test_new_version_never_overwrites_previous_and_cas_conflict(client):
    v=review(client,create(client)).json()
    body=deepcopy(v['specification']);body.pop('source_snapshot');body['cable']['r20_ohm_km']=.081
    r=draft_version(client,v,body);assert r.status_code==201,r.text
    second=r.json();assert second['version']==2 and second['state']=='draft'
    assert client.get(f"/api/enterprise/versions/{v['id']}").json()['content_sha256']==v['content_sha256']
    assert draft_version(client,v,body).status_code==409
    assert review(client,second).status_code==200
    assert not client.get(f"/api/enterprise/versions/{v['id']}").json()['is_current_reviewed']

def test_concurrent_version_creations_only_one_wins(client):
    v=create(client);body=spec()
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes=list(pool.map(lambda _:draft_version(client,v,body).status_code,range(2)))
    assert sorted(codes)==[201,409]

def test_binding_requires_approval_and_marks_modified_project_copy(client):
    w=workspace(client);v=review(client,create(client)).json()
    r=call(client,w,'products.propose',{'version_id':v['id']});assert r.status_code==200,r.text
    p=r.json()['result'];assert 'product_binding' not in client.get(f"/api/workspaces/{w['id']}").json()
    w=approve(client,w,p).json()['workspace'];a=client.get(f"/api/enterprise/workspaces/{w['id']}/assessment").json()
    assert a['product_reference']['aligned']
    w=client.post(f"/api/workspaces/{w['id']}/edit",json={'expected_revision':w['revision'],'changes':[{'path':'cable.area_mm2','value':300}]}).json()
    a=call(client,w,'project.assessment').json()['result'];assert not a['product_reference']['aligned']
    assert 'area_mm2' in a['product_reference']['changed_fields']
    assert client.get(f"/api/enterprise/versions/{v['id']}").json()['specification']['cable']['area_mm2']==240

def test_withdraw_after_propose_blocks_approval_atomically(client):
    w=workspace(client);v=review(client,create(client)).json()
    p=call(client,w,'products.propose',{'version_id':v['id']}).json()['result']
    assert review(client,v,'withdraw').status_code==200
    assert approve(client,w,p).status_code==409
    assert client.get(f"/api/workspaces/{w['id']}").json()['revision']==1

def test_latest_withdrawal_does_not_resurrect_older_product(client):
    v=review(client,create(client)).json();second=draft_version(client,v,spec()).json();second=review(client,second).json()
    assert review(client,second,'withdraw').status_code==200
    assert not client.get(f"/api/enterprise/versions/{v['id']}").json()['is_current_reviewed']
    w=workspace(client)
    assert call(client,w,'selection.reviewed',{'target_current_a':100}).status_code==422

def test_model_voltage_and_locks_protect_project(client):
    w=workspace(client);v=review(client,create(client,spec('400',400))).json()
    w=client.post(f"/api/workspaces/{w['id']}/lock",json={'expected_revision':1,'path':'cable.area_mm2','locked':True}).json()
    assert call(client,w,'products.propose',{'version_id':v['id']}).status_code==422

def test_actual_candidate_calculations_snapshots_failure_reasons_and_report(client):
    w=workspace(client)
    for area in [95,240,400]: review(client,create(client,spec(f'MV-{area}',area)))
    r=call(client,w,'selection.reviewed',{'target_current_a':400,'reserve_percent':10});assert r.status_code==200,r.text
    study=r.json()['result'];assert len(study['candidates'])==3
    assert any(c['feasible'] for c in study['candidates']) and any(not c['feasible'] for c in study['candidates'])
    for c in study['candidates']:
        assert c['catalog_snapshot']['product_version']==1
        assert c['ampacity_a'] is not None and c['scenario'] is not None
    report=call(client,w,'selection.report',{'study_id':study['id']}).json()['result']
    assert '不可变输入' in report['html'] and '热约束通过' in report['html'] and report['source_revision']==1
    # Report continues to use the original snapshot after changing the project.
    w=client.post(f"/api/workspaces/{w['id']}/edit",json={'expected_revision':1,'changes':[{'path':'operating_current_a','value':100}]}).json()
    assert call(client,w,'selection.report',{'study_id':study['id']}).json()['result']==report
    other=workspace(client);assert call(client,other,'selection.report',{'study_id':study['id']}).status_code==404

def test_selection_candidate_can_be_applied_but_withdrawn_version_cannot(client):
    w=workspace(client);v=review(client,create(client)).json()
    study=call(client,w,'selection.reviewed',{'target_current_a':250,'reserve_percent':0}).json()['result']
    url=f"/api/design/{w['id']}/selection/{study['id']}/propose"
    p=client.post(url,json={'expected_revision':1,'product_id':v['id']});assert p.status_code==200,p.text
    w=approve(client,w,p.json()).json()['workspace'];assert w['product_binding']['version_id']==v['id']
    study=call(client,w,'selection.reviewed',{'target_current_a':250,'reserve_percent':0}).json()['result']
    review(client,v,'withdraw')
    assert client.post(f"/api/design/{w['id']}/selection/{study['id']}/propose",json={'expected_revision':w['revision'],'product_id':v['id']}).status_code==409

def test_missing_price_does_not_claim_cheapest(client):
    w=workspace(client);review(client,create(client))
    study=call(client,w,'selection.reviewed',{'target_current_a':200,'rank_by':'cost'}).json()['result']
    assert study['feasible_count']==0 and study['candidates'][0]['cost'] is None
    assert any('价格' in r for r in study['candidates'][0]['reasons'])

def test_fork_preserves_sources_locks_basis_but_not_results_and_is_independent(client):
    w=workspace(client);v=review(client,create(client)).json()
    w=approve(client,w,call(client,w,'products.propose',{'version_id':v['id']}).json()['result']).json()['workspace']
    call(client,w,'analysis.buried')
    response=client.post(f"/api/enterprise/workspaces/{w['id']}/fork",json={'expected_revision':w['revision'],'name':'另一方案'})
    assert response.status_code==201,response.text
    child=response.json();assert child['id']!=w['id'] and child['revision']==1 and not child['runs']
    assert child['product_binding']==w['product_binding'] and child['locks']==w['locks']
    assert child['origin']['workspace']==w['id']
    client.post(f"/api/workspaces/{child['id']}/edit",json={'expected_revision':1,'changes':[{'path':'installation.depth_m','value':1.5}]})
    assert client.get(f"/api/workspaces/{w['id']}").json()['scenario']['installation']['depth_m']==.8

def test_wrong_revision_does_not_fork_or_create_product_proposal(client):
    w=workspace(client);v=review(client,create(client)).json();w['revision']=999
    assert call(client,w,'products.propose',{'version_id':v['id']}).status_code==409
    assert client.post(f"/api/enterprise/workspaces/{w['id']}/fork",json={'expected_revision':999,'name':'错误'}).status_code==409

def test_source_reference_checked_and_frozen(client):
    w=workspace(client)
    p=client.post(f"/api/workspaces/{w['id']}/evidence",json={'expected_revision':1,'title':'测试节选','text':'R20: 0.08 Ω/km','page':3}).json()
    w=approve(client,w,p).json()['workspace'];data=spec();data['cable']['r20_ohm_km']=.08
    data.update(source_workspace_id=w['id'],source_id=w['sources'][0]['id'])
    v=create(client,data);assert v['specification']['source_snapshot']['page']==3
    data['code']='CONFLICT';data['cable']['r20_ohm_km']=.07
    assert client.post('/api/enterprise/products',json=data).status_code==422

def test_restart_keeps_product_versions_and_review_events(tmp_path):
    path=tmp_path/'restart.sqlite'
    with TestClient(create_app(path)) as c:v=review(c,create(c)).json()
    with TestClient(create_app(path)) as c:assert c.get(f"/api/enterprise/versions/{v['id']}").json()==v

def test_request_idempotence_does_not_duplicate_study(client):
    w=workspace(client);review(client,create(client));request=str(uuid4());args={'target_current_a':200}
    a=call(client,w,'selection.reviewed',args,request);b=call(client,w,'selection.reviewed',args,request)
    assert a.status_code==200 and a.json()==b.json()
    assert len(client.get(f"/api/design/{w['id']}/selection").json())==1

def test_preexisting_proposal_not_revived_when_newest_product_withdrawn(client):
    w=workspace(client);v=review(client,create(client)).json()
    p=call(client,w,'products.propose',{'version_id':v['id']}).json()['result']
    second=review(client,draft_version(client,v,spec()).json()).json();review(client,second,'withdraw')
    assert approve(client,w,p).status_code==409

def test_run_report_carries_product_snapshot_after_withdrawal(client):
    w=workspace(client);v=review(client,create(client)).json()
    w=approve(client,w,call(client,w,'products.propose',{'version_id':v['id']}).json()['result']).json()['workspace']
    result=call(client,w,'analysis.buried').json()['result']
    assert result['output']['result']['product_reference']['content_sha256']==v['content_sha256']
    args={'run_id':result['output']['run_id']}
    report=call(client,w,'reports.render',args).json()['result'];review(client,v,'withdraw')
    assert call(client,w,'reports.render',args).json()['result']==report
    assert '本次计算引用的型号版本' in report['html']

def test_report_escapes_product_text(client):
    data=spec();data['name']='<script>alert(1)</script>';v=review(client,create(client,data)).json();w=workspace(client)
    study=call(client,w,'selection.reviewed',{'target_current_a':200}).json()['result']
    result=call(client,w,'selection.report',{'study_id':study['id']}).json()['result']
    assert '<script>alert(1)</script>' not in result['html'] and '&lt;script&gt;' in result['html']
