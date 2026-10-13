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


def test_accepted_engineering_archives_preserve_full_sealed_run_identity():
    from backend.kernel.hpc_evidence import evidence_index, scoped_index
    value, snapshot = evidence_index()
    receipt = value['receipt']
    assert receipt['job_id']=='811855' and receipt['core_hours']==pytest.approx(13710/3600)
    assert receipt['historical_receipt']['job_id']=='809850'
    assert receipt['current_grid_recheck']['same_input'] and receipt['current_grid_recheck']['same_parameters']
    assert receipt['current_grid_recheck']['maximum_temperature_change_k']==0
    assert receipt['starting_mesh']['far_size_m']==.5 and receipt['starting_mesh']['field_order']==2
    assert receipt['final_mesh']['size_m']==.00055
    members=[entry for entry in value['members'] if entry.get('run_id')==receipt['run']]
    assert {entry['column']:entry['sha256'] for entry in members}=={
        'snapshot':receipt['input_digest'],'output':'61f14f0378dd18147b4074c65edec335ccf82be8680f3919d6c674924b1e3046'}
    historical=[entry for entry in value['members'] if entry.get('run_id')==receipt['historical_run']]
    assert {entry['column']:entry['sha256'] for entry in historical}=={
        'snapshot':'66a01118fdaddd3d87f8ca247d9286ccc90888ad3245aad739389f10c06731f9',
        'output':'e5db2325b1b7508fbea917b0e80e6d6ccea4b1540809939d8362447880f9607e'}
    primary=scoped_index(value,'primary')
    assert len(snapshot)==64 and len([entry for entry in primary['members'] if entry.get('column')=='output'])==8
    supplementary=scoped_index(value,'chengnan')
    accepted=supplementary['receipt']
    assert accepted['job_id']=='817014'
    outputs=[entry for entry in supplementary['members'] if entry.get('column')=='output']
    assert len(outputs)==7
    saved=next(entry for entry in outputs if entry['run_id']==accepted['run'])
    assert saved['sha256']==accepted['output_digest']=='2e873724fda340ce927370550c00924d8d58b69e213f2dc51a5c46f966a15425'


@pytest.mark.parametrize('scope',['primary','chengnan'])
def test_local_engineering_archives_match_sealed_index(scope):
    from backend.kernel.hpc_evidence import evidence_availability, verify_archives
    status = evidence_availability(scope=scope)
    if not status['available']: pytest.skip(status['message'])
    assert verify_archives(scope=scope)[1] == status['snapshot_id']


def test_missing_or_damaged_deployment_evidence_is_explicit(tmp_path, monkeypatch):
    from backend.kernel.hpc_evidence import evidence_availability, verify_archives
    monkeypatch.setenv('CABLESIM_ENGINEERING_EVIDENCE',str(tmp_path))
    status = evidence_availability(verify=True)
    assert not status['available'] and not status['verified'] and len(status['missing'])==3
    assert status['snapshot_id'] in status['message']
    assert all(item['file'] in status['message'] and item['destination'] in status['message'] for item in status['missing'])
    with pytest.raises(FileNotFoundError,match='证据包缺失'): verify_archives()
    # Manufacture a damaged deployment file only; no numerical results are faked.
    (tmp_path/status['missing'][0]['file']).write_bytes(b'corrupt archive')
    with pytest.raises(ValueError,match='长度或摘要不一致'): verify_archives()


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
    from backend.kernel.hpc_evidence import evidence_availability
    status=evidence_availability()
    if not status['available']: pytest.skip(status['message'])
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
            fem=next(row['saved_evidence'] for row in receipt['studies'] if row.get('saved_evidence'))
            restored=client.get(f'/api/hpc/workspaces/{fem["workspace"]}/fields/{fem["run"]}/view')
            assert restored.status_code==200,restored.text[:300]
            run=restored.json()
            assert run['integrity']=='verified' and run['execution']['saved_evidence']
            assert run['execution']['job_id']==fem['job_id']=='811855'
            assert run['snapshot']['cases'][0]['input']['load_cases'][0]['currents']=={'circuit/c1':400.,'circuit/template2':400.,'circuit/template3':400.}
            assert run['output_digest']==fem['output_digest']
            chapter=client.get(f'/api/hpc/workspaces/{fem["workspace"]}/chapters/{fem["run"]}?iec_run_id={fem["iec_run"]}&convergence_id={fem["convergence"]}')
            assert chapter.status_code==200,chapter.text[:300]
            proof=chapter.json()
            assert proof['convergence']['verdict']['mesh_passed'] and proof['convergence']['verdict']['domain_passed']
            rating=next(row for row in proof['rows'] if row['key']=='ampacity' and row['case']=='rating-simultaneous')
            assert rating['fem']==pytest.approx(359.6451671186804)
            assert rating['iec']==pytest.approx(362.2382462024689)
            assert fem['delivery'] is None
            pdf=client.get(f'/api/workspaces/{fem["workspace"]}/deliveries/{fem["historical_delivery"]}/pdf')
            assert pdf.status_code==200 and pdf.content.startswith(b'%PDF-')
            if receipt['identity']['chengnan_engineering_evidence_imported']:
                single=next(row['saved_evidence'] for row in receipt['studies'] if row.get('saved_evidence',{}).get('job_id')=='817014')
                restored=client.get(f'/api/hpc/workspaces/{single["workspace"]}/fields/{single["run"]}/view')
                assert restored.status_code==200,restored.text[:300]
                saved=restored.json()
                assert saved['integrity']=='verified' and saved['execution']['job_id']=='817014'
                assert saved['output_digest']==single['output_digest']
                response=client.get(f'/api/hpc/workspaces/{single["workspace"]}/chapters/{single["run"]}?iec_run_id={single["iec_run"]}&convergence_id={single["convergence"]}')
                assert response.status_code==200,response.text[:300]
                accepted=response.json()
                assert accepted['fem']['eligible_current_report']
                assert accepted['convergence']['verdict']['mesh_passed'] and accepted['convergence']['verdict']['domain_passed']
                rating=next(row for row in accepted['rows'] if row['key']=='ampacity' and row['case']=='rating')
                assert rating['fem']==pytest.approx(746.5381575809546,abs=.001)
                assert rating['iec']==pytest.approx(748.3219742774963,abs=.001)
                pdf=client.get(f'/api/workspaces/{single["workspace"]}/deliveries/{single["delivery"]}/pdf')
                assert pdf.status_code==200 and pdf.content.startswith(b'%PDF-')
    before=(target/'index.json').read_bytes()
    with pytest.raises(RuntimeError,match='已更新'):
        seed.import_release_reproductions(target,'0'*64)
    assert (target/'index.json').read_bytes()==before
    seed.import_release_reproductions(target,snapshot)
    assert len(json.loads((target/'index.json').read_bytes())['history'])==1
