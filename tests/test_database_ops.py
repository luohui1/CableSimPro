"""Real WAL backup, restart restore, incompatible schema and failed restore gates."""
from contextlib import closing
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.kernel.database_ops import SCHEMA_VERSION, snapshot, restore_offline, validate
from backend.sqlite_workspace import WorkspaceStore
from backend.schemas import Scenario


def contents(path):
    with closing(sqlite3.connect(path)) as db:return '\n'.join(db.iterdump())


def test_online_wal_snapshot_modify_restore_and_api_idempotency(tmp_path):
    path=tmp_path/'library.sqlite';app=create_app(path)
    with TestClient(app) as client:
        w=client.post('/api/workspaces',json={}).json()
        with app.state.workspace_store.db(True) as db:
            db.execute('CREATE TABLE original_fixture (payload BLOB)')
            db.execute('INSERT INTO original_fixture VALUES (?)',(b'%PDF-saved original',))
        before=contents(path)
        request={'request_id':str(uuid4())}
        response=client.post('/api/database/backups',json=request)
        assert response.status_code==201,response.text
        backup=response.json()
        assert client.post('/api/database/backups',json=request).json()==backup
        assert len(client.get('/api/database/backups').json())==1
        download=client.get(backup['download_url'])
        assert sha256(download.content).hexdigest()==backup['sha256']
        assert backup['schema_version']==SCHEMA_VERSION
        with app.state.workspace_store.db(True) as db:db.execute("UPDATE workspaces SET revision=revision+1")
        changed=contents(path)
        restore={'request_id':str(uuid4()),'backup_id':backup['id'],'sha256':backup['sha256'],'confirm_replace':True}
        response=client.post('/api/database/restores',json=restore)
        assert response.status_code==202,response.text
        assert response.json()['status']=='pending_restart'
        assert client.post('/api/database/restores',json=restore).json()==response.json()
        assert contents(path)==changed
    with TestClient(create_app(path)) as client:
        assert contents(path)==before
        assert client.get('/api/workspaces/'+w['id']).json()['revision']==1
        receipt=client.get('/api/database/restores/current').json()
        assert receipt['status']=='restored'
        assert contents(receipt['safety_snapshot'])==changed
        # A lost response/repeated click after restart must not restore again.
        assert client.post('/api/database/restores',json=restore).json()['status']=='restored'
        assert client.get('/api/database/version').json()['database_schema_version']==SCHEMA_VERSION


@pytest.mark.parametrize('version',[SCHEMA_VERSION+1,1000])
def test_newer_library_is_rejected_before_startup_writes(tmp_path,version):
    path=tmp_path/'future.sqlite'
    with closing(sqlite3.connect(path)) as db:
        db.execute('CREATE TABLE future_data (value TEXT)');db.execute(f'PRAGMA user_version={version}')
    before=path.read_bytes()
    with pytest.raises(HTTPException) as error:
        with TestClient(create_app(path)):pass
    assert error.value.detail['code']=='DATABASE_VERSION_TOO_NEW'
    assert path.read_bytes()==before


def test_unversioned_library_upgrade_preserves_workspace(tmp_path):
    path=tmp_path/'old.sqlite';store=WorkspaceStore(path);store.initialize();w=store.create(Scenario())
    with store.db(True) as db:db.execute('PRAGMA user_version=0')
    store.close()
    with TestClient(create_app(path)) as client:
        assert client.get('/api/workspaces/'+w['id']).json()['scenario']==w['scenario']
        assert client.get('/api/database/version').json()['database_schema_version']==SCHEMA_VERSION


def test_restore_refuses_active_host_corruption_and_missing_confirmation(tmp_path):
    path=tmp_path/'library.sqlite'
    with TestClient(create_app(path)) as client:
        client.post('/api/workspaces',json={})
        b=client.post('/api/database/backups',json={'request_id':str(uuid4())}).json()
        source=Path(str(path)+'.snapshots')/(b['id']+'.sqlite')
        with pytest.raises(HTTPException) as error:restore_offline(path,source,b['sha256'])
        assert error.value.detail['code']=='DATABASE_IN_USE'
        body={'request_id':str(uuid4()),'backup_id':b['id'],'sha256':b['sha256'],'confirm_replace':False}
        assert client.post('/api/database/restores',json=body).status_code==422
        source.write_bytes(source.read_bytes()+b'changed')
        body['confirm_replace']=True
        assert client.post('/api/database/restores',json=body).json()['detail']['code']=='DATABASE_SNAPSHOT_CORRUPT'
        assert client.get('/api/database/restores/current').json()['status']=='none'


def test_cli_roundtrip_and_no_overwrite(tmp_path):
    path=tmp_path/'library.sqlite';store=WorkspaceStore(path);store.initialize();w=store.create(Scenario());store.close()
    destination=tmp_path/'saved.sqlite';script=Path(__file__).resolve().parents[1]/'scripts/workspace_db.py'
    def cli(*args):return subprocess.run([sys.executable,str(script),*args],capture_output=True,text=True,encoding='utf-8')
    result=cli('backup','--database',str(path),'--output',str(destination))
    assert result.returncode==0,result.stderr
    saved=json.loads(result.stdout);before=contents(path)
    assert cli('backup','--database',str(path),'--output',str(destination)).returncode==2
    with closing(sqlite3.connect(path)) as db:db.execute('DELETE FROM workspaces');db.commit()
    result=cli('restore','--database',str(path),'--source',str(destination),'--sha256',saved['sha256'],'--confirm-replace')
    assert result.returncode==0,result.stderr
    assert contents(path)==before


def test_snapshot_refuses_unrelated_sqlite(tmp_path):
    path=tmp_path/'foreign.sqlite'
    with closing(sqlite3.connect(path)) as db:db.execute('CREATE TABLE unrelated(x)')
    with pytest.raises(HTTPException) as error:validate(path)
    assert error.value.detail['code']=='DATABASE_SNAPSHOT_INVALID'


def test_failed_backup_io_keeps_saved_library_and_allows_retry(tmp_path,monkeypatch):
    from backend.kernel import database_ops
    path=tmp_path/'library.sqlite'
    with TestClient(create_app(path)) as client:
        client.post('/api/workspaces',json={});before=contents(path)
        request={'request_id':str(uuid4())};original=database_ops.atomic_json
        monkeypatch.setattr(database_ops,'atomic_json',lambda *args:(_ for _ in ()).throw(OSError('disk full')))
        response=client.post('/api/database/backups',json=request)
        assert response.status_code==503 and response.json()['detail']['code']=='DATABASE_IO_ERROR'
        assert contents(path)==before
        monkeypatch.setattr(database_ops,'atomic_json',original)
        assert client.post('/api/database/backups',json=request).status_code==201


def test_restore_conflict_cancel_and_corruption_at_restart(tmp_path):
    path=tmp_path/'library.sqlite'
    with TestClient(create_app(path)) as client:
        client.post('/api/workspaces',json={})
        b=client.post('/api/database/backups',json={'request_id':str(uuid4())}).json()
        body={'request_id':str(uuid4()),'backup_id':b['id'],'sha256':b['sha256'],'confirm_replace':True}
        assert client.post('/api/database/restores',json=body).status_code==202
        assert client.post('/api/database/restores',json={**body,'request_id':str(uuid4())}).status_code==409
        assert client.delete('/api/database/restores/current',params={'request_id':str(uuid4())}).status_code==409
        assert client.delete('/api/database/restores/current',params={'request_id':body['request_id']}).status_code==204
        assert client.get('/api/database/restores/current').json()['status']=='none'
        assert client.post('/api/database/restores',json=body).status_code==202
    before=contents(path)
    source=Path(str(path)+'.snapshots')/(b['id']+'.sqlite');source.write_bytes(source.read_bytes()+b'bad')
    with pytest.raises(HTTPException) as error:
        with TestClient(create_app(path)):pass
    assert error.value.detail['code']=='DATABASE_SNAPSHOT_CORRUPT'
    assert contents(path)==before
