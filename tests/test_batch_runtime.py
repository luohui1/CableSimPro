"""Saved inputs, provenance, resume and failure-inclusive exports."""
from hashlib import sha256
import json
from pathlib import Path
import sys
from uuid import uuid4
import pytest

from backend.kernel.batch_files import atomic,digest,locked
from backend.kernel.batch_inputs import materialize
from backend.kernel.batch_runtime import export_dataset,rows,Execution
from backend.kernel.batch_worker import error_state,verify_row
from backend.plugin_host.dependencies import host_dependencies


def test_host_dependency_symbol_names_are_portable():
    root=Path(__file__).resolve().parents[1]
    records=host_dependencies(root/'plugins/cablesim.simulation')
    assert 'backend/plugin_host/Executor.py' not in {r['path'] for r in records}
    assert records==sorted(records,key=lambda r:r['path'])
    assert all((root/r['path']).resolve().relative_to(root).as_posix()==r['path'] for r in records)


def test_native_failures_are_distinguished():
    assert error_state({'code':'EnvironmentMissing','message':'missing'})=='environment_missing'
    assert error_state({'code':'TIMEOUT','message':'limit'})=='timed_out'
    assert error_state({'code':'ValueError','message':'温变电阻不收敛'})=='nonconverged'
    assert error_state({'code':'PLUGIN_CRASHED','message':'exit'})=='crashed'


def export_fixture(tmp_path):
    batch_id=str(uuid4())
    plan={'id':batch_id,'source':{'study_id':str(uuid4()),'study_revision':1},
        'method':{'plugin_id':'cablesim.example','version':'1.0.0','capability':'test','release_digest':'a'*64},
        'parameter_space':{'axes':[{'name':'depth','label':'埋深','unit':'m'}]},
        'sampling_engine':'fixture','runtime_sha256':'b'*64,'execution':{},
        'base_case':{'input':{'depth':1.}},'base_case_sha256':digest({'input':{'depth':1.}}),
        'samples':[{'case_id':f'sample-{i:06d}'} for i in range(3)]}
    atomic(tmp_path/'plan.json',plan);atomic(tmp_path/'integrity.json',{'plan_sha256':digest(plan)})
    for i in range(3):
        sample={'parameters':{'depth':{'value':i+1.,'unit':'m'}},'case':{'input':{'depth':i+1.}}}
        plan['samples'][i]['sample_sha256']=digest(sample)
        atomic(tmp_path/'inputs'/f'sample-{i:06d}.json',sample)
        if i<2:
            row={'schema_version':'cablesim.dataset-row/1','dataset_id':batch_id,'sample_id':f'sample-{i:06d}','index':i,
                'case_sha256':digest(sample['case']),'method':plan['method'],
                'status':'succeeded' if i==0 else 'nonconverged','valid':i==0,'parameters':sample['parameters'],
                'results':[{'case':'rating','key':'ampacity','entity':'c1','unit':'A','status':'available','value':500.}],
                'error':None if i==0 else {'code':'MESH_NOT_CONVERGED','message':'=formula-like text'}}
            row['row_sha256']=digest(row);atomic(tmp_path/'samples'/f'sample-{i:06d}.json',row)
    atomic(tmp_path/'plan.json',plan);atomic(tmp_path/'integrity.json',{'plan_sha256':digest(plan)})
    return plan


def test_export_excludes_failed_numeric_payload_and_preserves_pending(tmp_path):
    export_fixture(tmp_path)
    target=export_dataset(tmp_path)
    metadata=json.loads((target/'metadata.json').read_text())
    assert metadata['sample_count']==3 and metadata['valid_count']==1
    assert metadata['failure_rate']==.5
    assert len((target/'valid.csv').read_text(encoding='utf-8-sig').splitlines())==2
    import csv
    with (target/'samples.csv').open(encoding='utf-8-sig',newline='') as stream:
        data=list(csv.DictReader(stream))
    quantity=metadata['quantity_columns'][0]['column']
    assert data[0][quantity]=='500.0' and data[1][quantity]=='' and data[2][quantity]==''
    assert data[1]['error_message'].startswith("'=")
    assert export_dataset(tmp_path)==target
    assert all(sha256((target/name).read_bytes()).hexdigest()==record['sha256'] for name,record in metadata['files'].items())


def test_changed_result_never_silently_enters_export(tmp_path):
    export_fixture(tmp_path)
    path=tmp_path/'samples/sample-000000.json';row=json.loads(path.read_text())
    row['results'][0]['value']=999.
    atomic(path,row)
    with pytest.raises(ValueError,match='INTEGRITY'):export_dataset(tmp_path)


def test_sample_lock_prevents_duplicate_ownership(tmp_path):
    with locked(tmp_path/'sample.lock'):
        with pytest.raises(BlockingIOError):
            with locked(tmp_path/'sample.lock'):pass


def test_missing_worker_output_is_preserved_as_failure(tmp_path):
    from backend.kernel.batch_worker import failed_sample
    export_fixture(tmp_path)
    row=failed_sample(tmp_path,2,'slurm','SLURM_TIMEOUT','wall limit',{'CPUTimeRAW':'60'})
    assert row['status']=='timed_out' and not row['valid'] and row['results']==[]
    assert verify_row(row,tmp_path)==row
    assert failed_sample(tmp_path,0,'slurm','SLURM_TIMEOUT','wall limit')['valid']
    target=export_dataset(tmp_path)
    (target/'valid.csv').write_text('corrupt','utf-8')
    with pytest.raises(ValueError,match='EXPORT_FILE_INTEGRITY_FAILED'):export_dataset(tmp_path)
