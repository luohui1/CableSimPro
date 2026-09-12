"""Actual application APIs, persistent consent/locks and delegated host behavior."""
import json
from pathlib import Path
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.plugins.service import safe_environment

@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path/'plugins.sqlite')) as c:yield c


def project(c):return c.post('/api/workspaces',json={}).json()

def plan(c,p='cablesim.gmsh'):
    r=c.post('/api/plugins/install-plan',json={'plugin_id':p,'version':'0.1.2'});assert r.status_code==200,r.text;return r.json()

def approval(p):return {k:p[k] for k in ('plugin_id','version','state_revision','plan_sha256')}|{'approved':True,'license_acknowledged':True,'grants':{m['plugin_id']:m['permissions'] for m in p['plugins']}}

def install(c,p='cablesim.gmsh'):
    r=c.post('/api/plugins/install',json=approval(plan(c,p)));assert r.status_code==200,r.text;return r.json()

def enable(c,w,p='cablesim.gmsh',enabled=True):
    lock=c.get(f'/api/plugins/workspaces/{w["id"]}/lock').json()
    return c.post(f'/api/plugins/workspaces/{w["id"]}/enable',json={'plugin_id':p,'expected_revision':w['revision'],'lock_revision':lock['lock']['lock_revision'],'enabled':enabled,'approved':True})

def invocation(c,w,p='cablesim.ampacity-core',command='analysis.buried',args=None):
    lock=c.get(f'/api/plugins/workspaces/{w["id"]}/lock').json()
    return {'plugin_id':p,'command':command,'request_id':str(uuid4()),'expected_revision':w['revision'],'lock_sha256':lock['lock_sha256'],'arguments':args or {},'confirmed':True}

def test_browse_and_plan_have_no_side_effects(client):
    w=project(client);s=client.app.state.workspace_store
    with s.db() as db:before=db.total_changes
    baseline=client.get(f'/api/workspaces/{w["id"]}').json()
    a=client.get('/api/plugins/catalog').json();plan(client)
    assert len(a['items'])==17 and a['security']['remote_installation'] is False
    assert client.get('/api/plugins/catalog').json()['state_revision']==0
    assert client.get(f'/api/workspaces/{w["id"]}').json()==baseline
    with s.db() as db:
        for table in ['plugin_audit','plugin_installed','plugin_project_pins','plugin_jobs']:
            assert db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]==0
    assert client.get('/api/plugins/spec').status_code==200

@pytest.mark.parametrize('wrong',['permissions','hash','consent','license','boolean'])
def test_install_fail_closed(client,wrong):
    data=approval(plan(client))
    if wrong=='permissions':data['grants']={}
    if wrong=='hash':data['plan_sha256']='0'*64
    if wrong=='consent':data['approved']=False
    if wrong=='license':data['license_acknowledged']=False
    if wrong=='boolean':data['approved']=1
    assert client.post('/api/plugins/install',json=data).status_code in (403,409,422)
    assert client.get('/api/plugins/catalog').json()['state_revision']==0


def test_plan_cas_and_exact_closure(client):
    first=approval(plan(client,'cablesim.pyvista'));install(client,'cablesim.cadquery')
    assert client.post('/api/plugins/install',json=first).status_code==409
    install(client,'cablesim.pyvista')
    ids={i['manifest']['plugin_id'] for i in client.get('/api/plugins/catalog').json()['items'] if i['installed']}
    assert {'cablesim.gmsh','cablesim.meshio','cablesim.thermal2d','cablesim.pyvista'}<=ids


def test_roadmap_unknown_and_origin_rejected(client):
    for p in ['cablesim.dolfinx','cablesim.missing']:
        assert client.post('/api/plugins/install-plan',json={'plugin_id':p,'version':'0.1.2'}).status_code in (404,409)
    assert client.post('/api/plugins/install-plan',json={},headers={'origin':'https://attacker.invalid'}).status_code==403


def test_enable_and_dependencies_do_not_change_engineering_revision(client):
    w=project(client);baseline=client.get(f'/api/workspaces/{w["id"]}').json()
    assert enable(client,w).status_code==409
    install(client,'cablesim.pyvista');r=enable(client,w,'cablesim.pyvista');assert r.status_code==200,r.text
    assert len(r.json()['lock']['plugins'])==7
    assert enable(client,w,'cablesim.gmsh',False).status_code==409
    assert client.get(f'/api/workspaces/{w["id"]}').json()==baseline
    assert enable(client,w,'cablesim.pyvista',False).status_code==200
    installed=client.get('/api/plugins/catalog').json()
    assert client.post('/api/plugins/uninstall',json={'plugin_id':'cablesim.gmsh','state_revision':installed['state_revision'],'approved':True}).status_code==409


def test_core_compute_is_real_and_idempotent(client):
    w=project(client);body=invocation(client,w);path=f'/api/plugins/workspaces/{w["id"]}/invoke'
    r=client.post(path,json=body);assert r.status_code==200,r.text
    out=r.json();actual=client.post('/api/calculate',json=w['scenario']).json()
    assert out['result']['result']['output']['result']['summary']==actual['summary']
    assert out['promoted_to_current_ampacity'] is False
    replay=client.post(path,json=body);assert replay.status_code==200 and replay.json()['replayed']
    assert len(client.get(f'/api/workspaces/{w["id"]}').json()['runs'])==1
    body['arguments']={'wrong':True};assert client.post(path,json=body).status_code==422
    body['arguments']={};body['expected_revision']=2;assert client.post(path,json=body).status_code==409


def test_source_rules_and_locks_before_worker(client,monkeypatch):
    w=project(client);p='cablesim.thermal2d';install(client,p);assert enable(client,w,p).status_code==200
    monkeypatch.setattr(client.app.state.plugins.catalog,'environment',lambda m:{'metadata_ready':True,'versions':{},'missing':[]})
    b=invocation(client,w,p,'skfem.radial-thermal',{'source_job_id':str(uuid4()),'heat_w_m':20,'surface_temperature_c':30,'conductor_k_w_m_k':380,'metal_screen_k_w_m_k':380})
    r=client.post(f'/api/plugins/workspaces/{w["id"]}/invoke',json=b)
    assert r.status_code==409 and r.json()['detail']['code']=='SOURCE_JOB'
    b['lock_sha256']='0'*64
    assert client.post(f'/api/plugins/workspaces/{w["id"]}/invoke',json=b).status_code==409


def test_missing_runtime_and_invalid_args(client,monkeypatch):
    w=project(client);install(client);assert enable(client,w).status_code==200
    monkeypatch.setattr(client.app.state.plugins.catalog,'environment',lambda m:{'metadata_ready':False,'versions':{},'missing':['gmsh==4.15.2']})
    b=invocation(client,w,'cablesim.gmsh','gmsh.cable-section')
    r=client.post(f'/api/plugins/workspaces/{w["id"]}/invoke',json=b)
    assert r.status_code==409 and r.json()['detail']['code']=='RUNTIME_MISSING'
    b['arguments']={'resolution':0};assert client.post(f'/api/plugins/workspaces/{w["id"]}/invoke',json=b).status_code==422


def test_environment_excludes_secrets(tmp_path,monkeypatch):
    for key in ['OPENAI_API_KEY','CABLESIM_DB','HTTPS_PROXY','PYTHONPATH','MY_RANDOM_SECRET']:monkeypatch.setenv(key,'SECRET-SENTINEL')
    env=safe_environment(tmp_path)
    assert 'SECRET-SENTINEL' not in env.values()
    assert env['HOME']==str(tmp_path)


def test_install_persists_and_jobs_interrupted_not_reexecuted(tmp_path):
    path=tmp_path/'durable.sqlite'
    with TestClient(create_app(path)) as c:
        w=project(c);install(c);assert enable(c,w).status_code==200
        lock=c.get(f'/api/plugins/workspaces/{w["id"]}/lock').json()
        store=c.app.state.workspace_store
        with store.db(True) as db:db.execute('INSERT INTO plugin_jobs VALUES (?,?,?,?,?,?,?,?,?,?)',(w['id'],str(uuid4()),'cablesim.gmsh','gmsh.cable-section','hash','running','{}',None,'now',None))
    with TestClient(create_app(path)) as c:
        assert c.get(f'/api/plugins/workspaces/{w["id"]}/lock').json()==lock
        assert c.get(f'/api/plugins/workspaces/{w["id"]}/jobs').json()['items'][0]['status']=='interrupted'


def test_enabling_new_release_does_not_replace_existing_project_pin(client):
    w=project(client);install(client);assert enable(client,w).status_code==200
    with client.app.state.workspace_store.db(True) as db:
        row=db.execute('SELECT pin FROM plugin_project_pins WHERE workspace=? AND plugin_id=?',(w['id'],'cablesim.gmsh')).fetchone()
        pin=json.loads(row['pin']);pin['version']='0.1.0';pin['release_sha256']='0'*64
        db.execute('UPDATE plugin_project_pins SET pin=? WHERE workspace=? AND plugin_id=?',(json.dumps(pin),w['id'],'cablesim.gmsh'))
    before=client.get(f'/api/plugins/workspaces/{w["id"]}/lock').json()
    response=enable(client,w)
    assert response.status_code==409 and response.json()['detail']['code']=='PIN_MIGRATION_REQUIRED'
    assert client.get(f'/api/plugins/workspaces/{w["id"]}/lock').json()==before
