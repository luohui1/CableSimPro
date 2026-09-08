"""The interaction mode is not a new engineering state or a write permission."""
import json
import sqlite3
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app

@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / 'sessions.sqlite')) as c:
        yield c

def workspace(c):
    r=c.post('/api/workspaces',json={})
    assert r.status_code==201
    return r.json()

def plan(c,w):
    r=c.post(f"/api/workspaces/{w['id']}/plan",json={'expected_revision':w['revision'],'message':'截面积改为 400 mm²，重新计算'})
    assert r.status_code==200
    return r.json()

def session(c,w):
    r=c.get(f"/api/workspaces/{w['id']}/session")
    assert r.status_code==200
    return r.json()

def test_empty_session_is_read_only(client):
    w=workspace(client)
    first=session(client,w)
    assert first=={'workspace':w,'proposal':None,'output':None,'output_revision':None}
    assert session(client,w)==first

def test_pending_proposal_restores_original_snapshot_without_execution(client):
    w=workspace(client);p=plan(client,w);r=session(client,w)
    assert r['workspace']['revision']==1
    assert r['workspace']['scenario']['cable']['area_mm2']==240
    assert r['proposal']['id']==p['id'] and not r['proposal']['expired']
    assert r['proposal']['scenario']['cable']['area_mm2']==400
    assert r['output'] is None and r['workspace']['runs']==[]

def test_approved_plan_restores_same_run_and_version(client):
    w=workspace(client);p=plan(client,w)
    approved=client.post(f"/api/workspaces/{w['id']}/proposals/{p['id']}/approve",json={'expected_revision':1}).json()
    restored=session(client,w)
    assert restored['proposal'] is None
    assert restored['workspace']==approved['workspace']
    assert restored['output']==approved['output']
    assert restored['output_revision']==2

def test_rejection_does_not_resurrect_on_reload(client):
    w=workspace(client);p=plan(client,w)
    client.post(f"/api/workspaces/{w['id']}/proposals/{p['id']}/reject",json={'expected_revision':1})
    r=session(client,w)
    assert r['proposal'] is None and r['workspace']['revision']==1 and r['output'] is None

def test_latest_run_is_not_rewritten_for_new_input(client):
    w=workspace(client)
    original=client.post(f"/api/workspaces/{w['id']}/calculate",json={'expected_revision':1}).json()
    client.post(f"/api/workspaces/{w['id']}/edit",json={'expected_revision':1,'changes':[{'path':'operating_current_a','value':500}]})
    restored=session(client,w)
    assert restored['output']==original['output'] and restored['output_revision']==1
    assert restored['workspace']['revision']==2
    assert restored['workspace']['scenario']['operating_current_a']==500
    assert restored['output']['result']['input']['operating_current_a']!=500

def test_stale_plan_is_inspectable_not_approvable(client):
    w=workspace(client);p=plan(client,w)
    client.post(f"/api/workspaces/{w['id']}/edit",json={'expected_revision':1,'changes':[{'path':'installation.depth_m','value':1.2}]})
    r=session(client,w)
    assert r['proposal']['base_revision']==1 and r['workspace']['revision']==2
    assert client.post(f"/api/workspaces/{w['id']}/proposals/{p['id']}/approve",json={'expected_revision':2}).status_code==409

def test_expired_proposal_survives_restart_as_expired(tmp_path):
    path=tmp_path/'restart.sqlite'
    with TestClient(create_app(path)) as c:
        w=workspace(c);p=plan(c,w)
    with sqlite3.connect(path) as db:
        db.execute('UPDATE workspace_proposals SET expires=0 WHERE id=?',(p['id'],))
    with TestClient(create_app(path)) as c:
        r=session(c,w)
        assert r['proposal']['expired'] and r['output'] is None
        assert c.post(f"/api/workspaces/{w['id']}/proposals/{p['id']}/approve",json={'expected_revision':1}).status_code==409

def test_session_scoped_to_workspace_and_no_key_leak(client,monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','not-a-real-key-do-not-return')
    a=workspace(client);b=workspace(client);plan(client,a)
    r=session(client,b)
    assert r['proposal'] is None and r['workspace']['id']==b['id']
    assert 'not-a-real-key-do-not-return' not in json.dumps(r)
    assert client.get('/api/workspaces/not-a-project/session').status_code==404
