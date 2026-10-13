"""Pack an accepted Slurm rerun; never compute or relabel historical results.

Only the final rating is refreshed. The retained convergence levels remain
explicit historical validation, with their original inputs, versions and bytes.
Run after native acceptance, not in CI. CI verifies the resulting saved evidence.
"""
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import argparse
import json
import lzma
from pathlib import Path
import sqlite3
import sys
import tarfile
from uuid import uuid5, NAMESPACE_URL

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from backend.kernel.batch_files import atomic, encoded, read
from backend.kernel.hpc_evidence import archive_path, checksum, verify_archives
from backend.kernel.batch_convergence import verdict


def refresh(database, receipt_folder, stage):
    """Stage first; publication requires reviewing the complete receipt."""
    index, old_identity = verify_archives()
    identity = read(receipt_folder/'identity.json')
    run = read(receipt_folder/'run-summary.json')
    assert run['id'] == identity['run'] and run['status'] == 'succeeded'
    assert run['integrity'] == 'verified' and run['execution']['backend'] == 'slurm'
    execution = run['execution']
    assert execution['actual_cpu_seconds']/3600 <= 6
    stage.mkdir(parents=True, exist_ok=False)
    db = sqlite3.connect(database); db.row_factory = sqlite3.Row
    try:
        columns = [r['name'] for r in db.execute('PRAGMA table_info(study_runs)') if r['name'] != 'output']
        row = dict(db.execute('SELECT '+','.join(columns)+',CAST(output AS BLOB) AS output_bytes FROM study_runs WHERE id=?', (run['id'],)).fetchone())
        # Keep the full output as UTF-8 bytes. Decoding its few Chinese labels
        # would widen every base64 character to a two-byte Python string.
        output_bytes = row.pop('output_bytes'); row['output'] = None
        snapshot = json.loads(row['snapshot'])
        original = json.loads(db.execute('SELECT snapshot FROM study_runs WHERE id=?', (index['receipt']['run'],)).fetchone()[0])
        assert snapshot['cases'][0]['input'] == original['cases'][0]['input']
        assert snapshot['cases'][0]['parameters'] == original['cases'][0]['parameters']
        assert row['input_digest'] == sha256(row['snapshot'].encode()).hexdigest()
        assert row['output_digest'] == sha256(output_bytes).hexdigest()
        # Read scalar metadata in SQLite; do not decode the large binary field.
        field = json.loads(db.execute('SELECT json_extract(output,\'$.cases[0].artifacts."x-cablesim.temperature-field"\') FROM study_runs WHERE id=?', (run['id'],)).fetchone()[0])
        case_id = snapshot['cases'][0]['case_id']; p = snapshot['cases'][0]['parameters']
        new_observation = dict(run_id=run['id'], case_id=case_id, kind='rating', hotspot_k=field['hotspot']['temperature_k'],
            nodes=field['convergence']['full_mesh_nodes'], mesh_size_m=p['mesh']['size_m'], bounds_m=p['domain_options']['bounds_m'],
            output_digest=row['output_digest'], artifact_digest=run['output']['cases'][0]['artifact_digests']['x-cablesim.temperature-field'],
            sequence=row['sequence'], created=row['created'], study_name=snapshot['definition']['title'], change_k=None,
            outer_boundary=p['outer_boundary'])
        previous = dict(db.execute('SELECT * FROM hpc_convergence WHERE id=?', (index['receipt']['convergence'],)).fetchone())
        old_workflow = json.loads(previous['state'])
        assert verdict(old_workflow['rows'], .1)['status'] == 'converged'
        native_checks = {}
        for path in (receipt_folder/'hpc').glob('*/execution.json'):
            plan=read(path.parent/'plan.json')
            if plan.get('phase')!='check' or plan.get('research_context',{}).get('study_id')!=row['study']:continue
            check=read(path)
            assert check['slurm_states']==['COMPLETED'] and check['actual_cpu_seconds']>0
            native_checks[check['plan_id']]=check
        assert native_checks, 'Retain the real native preflight and its accounting.'
        check_hours=sum(c['actual_cpu_seconds'] for c in native_checks.values())/3600
        fresh_hours=execution['actual_cpu_seconds']/3600+check_hours
        assert fresh_hours<=identity['frozen_budget_core_hours']<=6
        delta = abs(new_observation['hotspot_k'] - old_workflow['rows'][-1]['hotspot_k'])
        assert delta < .1, 'Same saved final grid did not reproduce; do not inherit convergence.'
        new_observation['change_k'] = delta
        wf = deepcopy(old_workflow)
        workflow_id = str(uuid5(NAMESPACE_URL, 'cablesim:accepted-rating:'+run['id']))
        wf.update(id=workflow_id, study=row['study'], definition=snapshot['definition'], rating_run_id=run['id'],
            rows=old_workflow['rows'][:-1]+[new_observation], status='completed', owner=row['owner_epoch'],
            created=row['created'], updated=row['finished'], finished=row['finished'], reason='保存收敛网格的当前方法复核完成；前五级为原始版本的验证证据。',
            run_executions={**old_workflow['run_executions'],run['id']:execution},
            preflight_executions={**old_workflow['preflight_executions'],**native_checks},
            per_step_upper_core_hours=identity['frozen_budget_core_hours'],
            study_revision=snapshot['study_revision'],
            actual_core_hours=old_workflow['actual_core_hours']+fresh_hours,
            validation_history=dict(convergence_id=old_workflow['id'], rows=old_workflow['rows'],
                run_executions=old_workflow['run_executions'], preflight_executions=old_workflow['preflight_executions'],
                actual_core_hours=old_workflow['actual_core_hours'], status=old_workflow['status'],reason=old_workflow['reason']),
            current_grid_recheck=dict(source_run_id=index['receipt']['run'], source_evidence_snapshot=old_identity,
                same_input=True,same_parameters=True,maximum_temperature_change_k=delta,
                current_method=snapshot['definition']['method'],historical_validation_method=index['receipt']['method'],
                frozen_budget_core_hours=identity['frozen_budget_core_hours'],actual_core_hours=fresh_hours,
                preflight_executions=native_checks))
        wf['request']={**wf['request'],'request_id':str(uuid5(NAMESPACE_URL,'cablesim:accepted-rating-request:'+run['id'])),
            'continue_from':old_workflow['id'],
            'max_core_hours':old_workflow['actual_core_hours']+identity['frozen_budget_core_hours']}
        wf['verdict']=verdict(wf['rows'],.1)
        workflow_row=dict(id=workflow_id,request_id=wf['request']['request_id'],request_digest=sha256(encoded(wf['request'])).hexdigest(),state=json.dumps(wf,ensure_ascii=False,allow_nan=False))
        small = []
        study = dict(db.execute('SELECT * FROM studies WHERE id=?',(row['study'],)).fetchone())
        small.append(('studies/recheck/record.json','studies',study))
        for version in db.execute('SELECT * FROM study_versions WHERE study=? ORDER BY revision',(row['study'],)):
            small.append(('studies/recheck/versions/'+str(version['revision'])+'.json','study_versions',dict(version)))
        new_row = {**row,'snapshot':'','output':None}
        small += [('runs/recheck/record.json','study_runs',new_row),('convergence/recheck.json','hpc_convergence',workflow_row)]
        additions={index['archives'][0]['path']:[],index['archives'][1]['path']:[]}
        for name,table,value in small:
            additions[index['archives'][0]['path']].append((dict(name=name,kind='record',table=table),encoded(value)))
        additions[index['archives'][0]['path']].append((dict(name='runs/recheck/snapshot.json',kind='payload',column='snapshot',run_id=row['id']),row['snapshot'].encode()))
        additions[index['archives'][0]['path']].append((dict(name='runs/recheck/output.json',kind='payload',column='output',run_id=row['id']),output_bytes))
        # Every historical member is streamed byte-for-byte into the new archive.
        # Leave the largest historical archive untouched; XZ dictionary is 8 MiB.
        members = list(index['members']); archives=[]
        for archive in index['archives']:
            extra=additions.get(archive['path'],[])
            if not extra:
                archives.append(archive); continue
            target=stage/Path(archive['path']).name
            with lzma.open(target,'wb',preset=6) as zipped, tarfile.open(fileobj=zipped,mode='w|') as output:
                with lzma.open(archive_path(archive),'rb') as source,tarfile.open(fileobj=source,mode='r|') as saved:
                    for member in saved:output.addfile(member,saved.extractfile(member))
                for metadata,raw in extra:
                    member=tarfile.TarInfo(metadata['name']);member.size=len(raw);member.mtime=0
                    output.addfile(member,BytesIO(raw))
                    members.append({**metadata,'archive':archive['path'],'size':len(raw),'sha256':sha256(raw).hexdigest()})
            assert target.stat().st_size<=100*1024*1024,'Rebalance archives; do not enlarge importer memory.'
            archives.append({**archive,'size':target.stat().st_size,'sha256':checksum(target)})
        receipt={**index['receipt'],'study':row['study'],'run':row['id'],'convergence':workflow_id,
            'job_id':execution['job_id'],'core_hours':execution['actual_cpu_seconds']/3600,
            'wall_seconds':int(execution['actual_cpu_seconds']/6),'method':snapshot['definition']['method'],
            'input_digest':row['input_digest'],'output_digest':row['output_digest'],
            'workflow_core_hours':wf['actual_core_hours'],'delivery':None,
            'historical_delivery':index['receipt']['delivery'],'historical_run':index['receipt']['run'],
            'historical_receipt':index['receipt'],'current_grid_recheck':wf['current_grid_recheck'],
            'scope':'当前版本同输入、同最终网格的超算复核；收敛级别保留原版本真实证据，不冒充新计算。当前计算书由研究线程生成，原计算书保留为历史。'}
        candidate={**index,'archives':archives,'members':members,'receipt':receipt,
            'executions':{**index['executions'],row['id']:{'plugin_id':'cablesim.simulation','capability':'iec-thermal-field','execution':execution}}}
        atomic(stage/'engineering-evidence-index.json',candidate)
        (stage/'engineering-evidence.sha256').write_text(checksum(stage/'engineering-evidence-index.json')+'\n','ascii')
        atomic(stage/'review.json',dict(source_snapshot=old_identity,receipt=receipt,workflow=workflow_row,
            old_members_preserved=len(index['members']),new_members=len(members)-len(index['members'])))
        print(json.dumps({'stage':str(stage),'job':execution['job_id'],'same_grid_change_k':delta,'archives':archives},ensure_ascii=False))
    finally:db.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',type=Path,required=True)
    parser.add_argument('--receipt-folder',type=Path,required=True)
    parser.add_argument('--stage',type=Path,required=True)
    args=parser.parse_args();refresh(args.database,args.receipt_folder,args.stage)
