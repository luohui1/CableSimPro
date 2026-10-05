"""Formal/compatible routes, typed OpenAPI and safe current-result delivery."""
from copy import deepcopy
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.plugin_host import Executor


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path/'host.sqlite')
    app.state.research.executor = Executor()
    with TestClient(app) as client:
        yield client


def test_six_formal_routes_have_models_and_compatible_aliases(client):
    api = client.get('/openapi.json').json()
    pairs = [('get','/input-contracts'), ('get','/examples/iec'), ('get','/examples/cable'),
             ('post','/workspaces/{wid}/geometry-preview'), ('get','/workspaces/{wid}/deliveries/{did}/file')]
    for verb, suffix in pairs:
        formal, old = '/api'+suffix, '/api/design'+suffix
        assert formal in api['paths'] and old in api['paths']
        assert api['paths'][old][verb]['deprecated'] is True
        assert api['paths'][formal][verb]['responses']['200']['content']
    assert api['paths']['/api/workspaces/{wid}/deliveries/current']['post']['responses']['201']['content']
    for suffix in ('/input-contracts','/examples/iec','/examples/cable'):
        formal=client.get('/api'+suffix);old=client.get('/api/design'+suffix)
        assert formal.status_code==old.status_code==200, formal.text
        assert formal.json()==old.json()
    contracts=client.get('/api/input-contracts').json()
    simulation=[c for c in contracts if c['method']['plugin_id']=='cablesim.simulation']
    assert {c['tasks'][0] for c in simulation}=={'transient-temperature','sheath-losses','electrothermal-steady'}
    assert all(info.get('description') for c in simulation for info in c['parameter_schema']['properties'].values())


def test_preview_refuses_stale_wrong_capability_and_keeps_saved_input(client):
    model=client.get('/api/design/cable-models').json()[0]
    w=client.post('/api/design/study-workspaces',json={'model_id':model['id'],'content_sha256':model['content_sha256']}).json()
    method={**next(m['method'] for m in client.get('/api/methods').json() if m['method']['plugin_id']=='cablesim.iec60287'), 'capability':'steady-rating'}
    body={'document':w['domain'],'method':method,'parameters':{},'expected_revision':w['revision']+1}
    root='/api/workspaces/'+w['id']
    response=client.post(root+'/geometry-preview',json=body)
    assert response.status_code==409 and response.json()['detail']['code']=='WORKSPACE_REVISION_CONFLICT'
    body['expected_revision']=w['revision']
    response=client.post(root+'/geometry-preview',json=body)
    assert response.status_code==422 and response.json()['detail']['code']=='GEOMETRY_CAPABILITY_REQUIRED'
    assert client.get(root).json()==w


def test_duplicate_preview_admission_reuses_one_successful_execution(client,monkeypatch):
    from backend.plugin_host.executor import CaseResult, RunResult
    model=client.get('/api/design/cable-models').json()[0]
    w=client.post('/api/design/study-workspaces',json={'model_id':model['id'],'content_sha256':model['content_sha256']}).json()
    method={**next(m['method'] for m in client.get('/api/methods').json() if m['method']['plugin_id']=='cablesim.cable-geometry'),'capability':'concentric-model'}
    calls=[]
    def execute(self,plugin,capability,cases,**kwargs):
        calls.append(cases)
        return RunResult('unit-preview',plugin,method['version'],capability,'unit','1'*64,{},[
            CaseResult('preview','succeeded',[],{'x-cablesim.cad-model':{'unit_test_admission_only':True}}, {'x-cablesim.cad-model':'2'*64},[])])
    monkeypatch.setattr(Executor,'run',execute)
    body={'expected_revision':w['revision'],'document':w['domain'],'method':method,'parameters':{'length_m':.1}}
    first=client.post('/api/workspaces/'+w['id']+'/geometry-preview',json=body)
    assert first.status_code==200,first.text
    second=client.post('/api/design/workspaces/'+w['id']+'/geometry-preview',json={**body,'reuse_from':first.json()['request_sha256']})
    assert second.json()==first.json() and len(calls)==1
    assert client.get('/api/workspaces/'+w['id']).json()==w


def test_current_delivery_download_integrity_idempotency_and_history(client):
    w=client.post('/api/workspaces',json={}).json();root='/api/workspaces/'+w['id']
    sample=client.get('/api/examples/iec').json()['input']
    method={**next(m['method'] for m in client.get('/api/methods').json() if m['method']['plugin_id']=='cablesim.iec60287'), 'capability':'reference-rating'}
    config={'expected_revision':1,'title':'Public hand fixture','input_source':'study','method_input':sample,'method':method}
    study=client.post(root+'/studies',json=config).json();sroot=root+'/studies/'+study['id']
    check=client.get(sroot+'/preflight',params={'expected_revision':1,'expected_study_revision':1}).json()
    run=client.post(sroot+'/runs',json={'request_id':str(uuid4()),'expected_revision':1,'expected_study_revision':1,'scope_acknowledged':True,'lock_digest':check['lock_digest']}).json()
    assert run['status']=='succeeded',run.get('error')
    request={'run_ids':[run['id']],'request_id':str(uuid4())}
    response=client.post(root+'/deliveries/current',json=request);assert response.status_code==201,response.text
    delivery=response.json()
    assert client.post('/api/design/workspaces/'+w['id']+'/deliveries',json=request).json()['id']==delivery['id']
    file=client.get(root+'/deliveries/'+delivery['id']+'/file')
    assert file.text==delivery['html'] and 'attachment' in file.headers['content-disposition']
    assert file.headers['x-artifact-sha256']==delivery['digest']
    changed=deepcopy(config);changed.update(expected_study_revision=1,title='Changed')
    assert client.put(sroot,json=changed).status_code==200
    assert client.post(root+'/deliveries/current',json={'run_ids':[run['id']]}).status_code==409
    assert client.get(root+'/deliveries/'+delivery['id']+'/file').status_code==200
    with client.app.state.workspace_store.db(True) as db:
        db.execute('UPDATE deliveries SET html=? WHERE id=?',('tampered',delivery['id']))
    assert client.get(root+'/deliveries/'+delivery['id']+'/file').status_code==409
