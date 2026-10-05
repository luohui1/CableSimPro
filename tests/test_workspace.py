"""Workspace/session checks share one fixture; calculations are tested by research."""
from concurrent.futures import ThreadPoolExecutor
import json
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path/'workspace.sqlite')) as c:
        yield c


def create(c):
    r=c.post('/api/workspaces',json={})
    assert r.status_code==201
    return r.json()


def edit(c,w,path,value):
    return c.post('/api/workspaces/'+w['id']+'/edit',json={'expected_revision':w['revision'],'changes':[{'path':path,'value':value}]})


def test_create_list_and_restore_session_are_read_only(client):
    w=create(client)
    assert w['revision']==1 and not w['can_undo'] and not w['runs']
    assert client.get('/api/workspaces').json()[0]['id']==w['id']
    session=client.get('/api/workspaces/'+w['id']+'/session').json()
    assert session=={'workspace':w,'proposal':None,'output':None,'output_revision':None}
    assert client.get('/api/workspaces/'+w['id']).json()==w


@pytest.mark.parametrize('path,value',[('__proto__.x',1),('cable.fake',2),('cable.area_mm2',-4),('installation.spacing_m',.02),('installation.depth_m',.05),('cable.insulation_mm',99),('cable.max_temperature_c',100)])
def test_invalid_or_locked_edit_is_atomic(client,path,value):
    w=create(client)
    assert edit(client,w,path,value).status_code==422
    assert client.get('/api/workspaces/'+w['id']).json()==w


def test_cas_and_undo_redo_keep_revision_archive(client):
    w=create(client);changed=edit(client,w,'cable.area_mm2',400).json()
    assert changed['revision']==2 and edit(client,w,'cable.area_mm2',500).status_code==409
    root='/api/workspaces/'+w['id']
    undone=client.post(root+'/history/undo',json={'expected_revision':2}).json()
    assert undone['scenario']['cable']['area_mm2']==240 and undone['revision']==3
    redone=client.post(root+'/history/redo',json={'expected_revision':3}).json()
    assert redone['scenario']['cable']['area_mm2']==400 and redone['revision']==4
    assert client.get(root+'/revisions/2').json()['state']['scenario']['cable']['area_mm2']==400


def test_duplicate_paths_and_concurrent_changes_fail_closed(client):
    w=create(client)
    assert client.post('/api/workspaces/'+w['id']+'/edit',json={'expected_revision':1,'changes':[{'path':'cable.area_mm2','value':300},{'path':'cable.area_mm2','value':400}]}).status_code==422
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses=list(pool.map(lambda a:edit(client,w,'cable.area_mm2',a).status_code,[300,400]))
    assert sorted(statuses)==[200,409]


def test_session_is_scoped_and_does_not_expose_environment(client,monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','private-example-key')
    a,b=create(client),create(client)
    session=client.get('/api/workspaces/'+b['id']+'/session').json()
    assert session['workspace']['id']==b['id'] and a['id']!=b['id']
    assert 'private-example-key' not in json.dumps(session)
