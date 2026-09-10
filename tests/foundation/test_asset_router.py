"""Installed application integration; no proxy store or mocked response is used."""
from fastapi.testclient import TestClient
import pytest
from backend.main import create_app
from backend.foundation.contracts import AssetRelease, SourceReference

@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path/'asset-api.sqlite')) as c: yield c


def capture(client):
    w=client.post('/api/workspaces',json={}).json()
    response=client.post(f'/api/foundation/workspaces/{w["id"]}/assets/capture',json={'expected_revision':1,'name':'捕获结构'})
    assert response.status_code==201,response.text
    return w,response.json()


def transition(client,a,action):
    return client.post(f'/api/foundation/assets/{a["id"]}/transition',json={
        'expected_revision':a['revision'],'content_sha256':a['content_sha256'],
        'action':action,'note':'实际 API 核对记录','acknowledge_sources':True})


def test_capture_and_lifecycle_do_not_mutate_workspace(client):
    w=client.post('/api/workspaces',json={}).json();before=client.get(f'/api/workspaces/{w["id"]}').json()
    path=f'/api/foundation/workspaces/{w["id"]}/assets/capture'
    response=client.post(path,json={'expected_revision':1,'name':'捕获结构'})
    assert response.status_code==201,response.text
    a=response.json();assert a['status']=='draft'
    assert a['release']['geometry_recipe']['family']=='single_core_circular'
    assert len(a['release']['geometry_recipe']['layers'])==6
    assert a['release']['sources'][0]['reference'].startswith(f'workspace:{w["id"]}@1#sha256:')
    assert not a['release']['sources'][0]['reviewed']
    for action in ['review','publish','deprecate']:
        response=transition(client,a,action);assert response.status_code==200,response.text;a=response.json()
    assert client.get(f'/api/workspaces/{w["id"]}').json()==before
    assert client.post(path,json={'expected_revision':2,'name':'过期来源'}).status_code==409
    assert client.get('/api/foundation/assets').json()['total']==1


def test_actual_json_export_round_trip_creates_only_a_new_draft(client):
    _,a=capture(client)
    body={'schema_version':'csp-asset/0.1','release':a['release']}
    assert client.post('/api/foundation/assets/import',json=body).status_code==409
    body['release']['asset_id']='new.asset'
    result=client.post('/api/foundation/assets/import',json=body)
    assert result.status_code==201,result.text
    b=result.json();assert b['status']=='draft' and b['release']['sources']==a['release']['sources']
    assert client.get('/api/foundation/assets',params={'q':'捕获结构','limit':1}).json()['total']==2
    assert client.get('/api/foundation/assets',params={'kind':'unsupported'}).status_code==422
    assert client.get('/api/foundation/assets/absent').status_code==404


def test_exact_review_version_and_host_guard_cannot_be_bypassed(client):
    _,a=capture(client)
    response=transition(client,a,'publish');assert response.status_code==409
    response=transition(client,a,'review');assert response.status_code==200
    assert transition(client,a,'publish').status_code==409
    assert client.post('/api/foundation/assets/import',json={},headers={'origin':'https://evil.example'}).status_code==403
    assert client.get('/api/foundation/assets',headers={'host':'evil.example'}).status_code==403
    assert client.get('/api/foundation/assets').headers['cache-control']=='no-store'


def test_edit_wrong_identity_unknown_fields_and_confirmation_rejected(client):
    _,a=capture(client)
    edited=dict(a['release']);edited['version']='2.0.0'
    assert client.put(f'/api/foundation/assets/{a["id"]}',json={'expected_revision':1,'release':edited}).status_code==422
    assert client.post(f'/api/foundation/assets/{a["id"]}/transition',json={
        'expected_revision':1,'content_sha256':a['content_sha256'],'action':'review',
        'note':'没有真正确认','acknowledge_sources':'true'}).status_code==422
    assert client.get(f'/api/foundation/assets/{a["id"]}').json()['revision']==1
