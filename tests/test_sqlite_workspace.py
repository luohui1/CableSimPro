import sqlite3
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app


def test_workspace_connection_is_closed_and_wal_anchor_lives_until_shutdown(tmp_path):
    app=create_app(tmp_path/'workspace.sqlite');store=app.state.workspace_store
    assert store._anchor is None
    with TestClient(app):
        assert store._anchor is not None
        with store.db() as db:
            assert db.execute('PRAGMA journal_mode').fetchone()[0].lower()=='wal'
            assert db.execute('PRAGMA wal_autocheckpoint').fetchone()[0]==1000
        with pytest.raises(sqlite3.ProgrammingError):db.execute('SELECT 1')
    assert store._anchor is None


def test_failed_write_rolls_back_and_next_request_remains_writable(tmp_path):
    app=create_app(tmp_path/'rollback.sqlite')
    with TestClient(app) as client:
        w=client.post('/api/workspaces',json={}).json();store=app.state.workspace_store
        with pytest.raises(RuntimeError):
            with store.db(True) as db:
                store.audit(db,w['id'],1,'incomplete')
                raise RuntimeError('failed write')
        assert client.get('/api/workspaces/'+w['id']).json()==w
        r=client.post('/api/workspaces/'+w['id']+'/edit',json={'expected_revision':1,'changes':[{'path':'installation.depth_m','value':1}]})
        assert r.status_code==200 and r.json()['revision']==2
