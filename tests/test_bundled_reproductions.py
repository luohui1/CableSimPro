"""Saved evidence integrity and release import; CI never invokes native solvers."""
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import re
import shutil

from fastapi.testclient import TestClient
import pytest

from backend.foundation.reproduction_library import BUNDLED_EVIDENCE, bundled_evidence


def seed_module():
    path=Path(__file__).resolve().parents[1]/'frontend/scripts/seed-engineering-demo.py'
    spec=importlib.util.spec_from_file_location('bundled_release_seed',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def test_saved_evidence_digest_schema_and_table_only_diagnostics(tmp_path):
    value,raw,snapshot=bundled_evidence()
    assert sha256(raw).hexdigest()==snapshot and len(raw)<1024*1024
    assert (BUNDLED_EVIDENCE.parent/'validation/evidence.sha256').read_text('ascii').strip()==snapshot
    assert len(value['items'])==63
    item=next(i for i in value['items'] if i['id']=='B02-2')
    assert len(item['sensitivity']['rows'])==13
    assert item['sensitivity']['classification']=='basis_difference'
    assert not any(re.search(r'[+−-]\d+\.\d+\s*(?:A|%)',line) for line in item['limitations'])
    assert any('物性范围' in line for line in item['limitations'])
    assert any('停在预检' in line for line in item['limitations'])
    for name in ('reproduction-evidence.json','reproduction-evidence-index.json','reproduction-evidence-schema.json'):
        shutil.copyfile(BUNDLED_EVIDENCE/name,tmp_path/name)
    target=tmp_path/'reproduction-evidence.json';target.write_bytes(raw+b' ')
    with pytest.raises(ValueError,match='摘要'):bundled_evidence(tmp_path)
    broken={**value,'items':[{'id':'invalid'}]};bad=json.dumps(broken).encode()
    target.write_bytes(bad)
    (tmp_path/'reproduction-evidence-index.json').write_text(json.dumps({'kind':'saved_evidence','snapshot_id':sha256(bad).hexdigest()}))
    with pytest.raises(ValueError,match='Schema'):bundled_evidence(tmp_path)


def test_release_seed_import_exposes_saved_evidence_without_development_paths(tmp_path,monkeypatch):
    seed=seed_module();value,raw,snapshot=bundled_evidence()
    for key in ('CABLESIM_REPRODUCTION_LIBRARY','CABLESIM_DB'):
        monkeypatch.setenv(key,str(tmp_path/'must-not-be-read'))
    target=tmp_path/'release/library'
    database=target.parent/'engineering.sqlite'
    seed.seed_release(database)
    receipt=json.loads(database.with_suffix('.seed.json').read_text('utf-8'))
    imported=receipt['reproduction_library']
    assert imported=={'snapshot_id':snapshot,'targets':63,'kind':'saved_evidence'}
    assert seed.release_identity()['reproduction_snapshot']==snapshot
    from backend.main import create_app
    with monkeypatch.context() as release_environment:
        release_environment.setenv('CABLESIM_REPRODUCTION_LIBRARY',str(target))
        with TestClient(create_app(database)) as client:
            catalog_response=client.get('/api/foundation/reproductions')
            assert catalog_response.status_code==200
            catalog=catalog_response.json()
            assert len(catalog['items'])==63 and catalog['snapshot_id']==snapshot
            detail_response=client.get('/api/foundation/reproductions/B02-2')
            assert detail_response.status_code==200
            detail=detail_response.json()
            assert detail['sensitivity']['rows']==next(i for i in value['items'] if i['id']=='B02-2')['sensitivity']['rows']
    before=(target/'index.json').read_bytes()
    with pytest.raises(RuntimeError,match='已更新'):
        seed.import_release_reproductions(target,'0'*64)
    assert (target/'index.json').read_bytes()==before
    seed.import_release_reproductions(target,snapshot)
    assert len(json.loads((target/'index.json').read_bytes())['history'])==1
