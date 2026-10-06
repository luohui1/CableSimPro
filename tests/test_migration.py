"""Archived v0 project bytes remain readable after removal of the v0 executor."""
from copy import deepcopy
import json
import sqlite3
import pytest
from fastapi.testclient import TestClient
from backend.domain.migration import convert_record
from backend.main import create_app
from backend.schemas import Scenario


def test_archived_project_and_workspace_migrate_without_inventing_facts(tmp_path):
    original = Scenario().model_dump(mode='json')
    original['cable']['r20_ohm_km'] = .0754
    archive = {'id':'old-project', 'scenario':deepcopy(original)}
    converted = convert_record(archive)
    assert archive['scenario'] == original
    assert converted['document']['circuits'][0]['label'] == '回路 1'
    db_path = tmp_path/'engineering.sqlite'
    payload = json.dumps(original, ensure_ascii=False)
    with sqlite3.connect(db_path) as db:
        db.execute('CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,payload TEXT,created_at TEXT,updated_at TEXT)')
        db.execute('INSERT INTO projects VALUES(?,?,?,?,?)',('old-project',original['name'],payload,'saved','saved'))
    with TestClient(create_app(db_path)) as client:
        created = client.post('/api/workspaces',json={'scenario':archive['scenario']}).json()
        root = '/api/workspaces/'+created['id']
        preview = client.get(root+'/domain/conversion').json()
        assert preview['document'] == converted['document']
        saved = client.post(root+'/domain/conversion',json={'expected_revision':1})
        assert saved.status_code == 200, saved.text
        domain = saved.json()['document']
        assert domain['cable_types'][0]['cores'][0]['conductor']['r20'] == pytest.approx(.0000754,rel=1e-14)
        assert domain['circuits'][0]['bonding']['kind'] == 'unspecified'
        assert domain['circuits'][0]['label'] == '回路 1'
        assert client.get(root+'/revisions/1').json()['state']['scenario'] == original
        assert client.post('/api/calculate',json=original).status_code == 404
        with sqlite3.connect(db_path) as db:
            assert db.execute('SELECT payload FROM projects WHERE id=?',('old-project',)).fetchone()[0] == payload
