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
    assert len(simulation)==16
    assert {c['tasks'][0] for c in simulation if c['tasks']}=={'transient-temperature','sheath-losses','electrothermal-steady','iec-fem-comparison','iec-thermal-field','getdp-eddy','elmer-heat'}
    comparison=next(c for c in simulation if c['tasks']==['iec-fem-comparison'])
    assert comparison['method']['capability']=='iec-fem-comparison'
    assert {'section_id','load_id','iec','controls','bounds_m','source'}<=set(comparison['parameter_schema']['required'])
    # Frozen and feedback comparisons have mutually exclusive acknowledgements.
    assert {'frozen_coefficients_acknowledged','feedback'}<=set(comparison['parameter_schema']['properties'])
    thermal=next(c for c in simulation if c['tasks']==['iec-thermal-field'])
    assert thermal['method']['capability']=='iec-thermal-field'
    assert {'domain_options','iec','mesh'}<=set(thermal['parameter_schema']['required'])
    assert 'material_thermal_resistivity' in thermal['parameter_schema']['properties']
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
    assert client.get(root+'/deliveries').json()==[]
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
    listing=client.get(root+'/deliveries');assert listing.status_code==200,listing.text
    entry=listing.json()[0]
    assert entry['id']==delivery['id'] and entry['version']==1 and entry['kind']=='calculation'
    assert entry['sources'][0]['run_id']==run['id'] and entry['created']==delivery['created']
    assert client.get(entry['download_url']).text==delivery['html']
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
    assert client.get(root+'/deliveries').status_code==409


def test_exact_simulation_problem_contract_and_import_validation(client):
    from cablesim_sdk.simulation import Problem
    contract=client.get('/api/simulation/problem-contract')
    assert contract.status_code==200,contract.text
    assert contract.json()['schema']==Problem.model_json_schema()
    contracts=client.get('/api/input-contracts').json()
    entry=next(c for c in contracts if c['method']['capability']=='elmer-heat')
    assert entry['input_sources']==['study']  # Domain adapters require different parameter contracts.
    w=client.post('/api/workspaces',json={}).json();root='/api/workspaces/'+w['id']
    problem={'schema_version':'cablesim.simulation-problem/1','physics':'steady_heat',
      'geometry':[{'uid':'square','kind':'rectangle','values':[0,0,1,1],'material':{'k_w_m_k':1,'source':'Synthetic SI validation'}}],
      'boundaries':[{'uid':'outer','selector':'outer','values':[],'kind':'temperature','value':293.15}],
      'excitations':[{'regions':['square'],'kind':'heat_w_m','value':[1],'source':'Synthetic 1 W/m source'}],
      'provenance':{'kind':'test'},'assumptions':['2D, fixed thermal properties']}
    from jsonschema import Draft202012Validator
    for schema in (contract.json()['schema'],entry['standalone_schema']):
        Draft202012Validator(schema).validate(problem)
        malformed=deepcopy(problem);malformed['geometry'][0]['values'][0]='0'
        assert not Draft202012Validator(schema).is_valid(malformed)
    body={'expected_revision':1,'title':'Explicit reproduction','input_source':'study','method_input':problem,'method':entry['method'],'parameters':{'mesh':{'size_m':.1,'far_size_m':.2,'transition_m':.3}}}
    response=client.post(root+'/studies',json=body);assert response.status_code==201,response.text
    assert response.json()['definition']['method_input']==problem
    bad=deepcopy(body);bad['method_input']['geometry'][0]['values'][0]='0'
    response=client.post(root+'/studies',json=bad)
    assert response.status_code==422 and response.json()['detail']['path']=='/method_input/geometry/0/values/0'
    bad=deepcopy(body);bad['method']['capability']='getdp-eddy'
    response=client.post(root+'/studies',json=bad)
    assert response.status_code==422 and response.json()['detail']['code']=='SIMULATION_PHYSICS_MISMATCH'
