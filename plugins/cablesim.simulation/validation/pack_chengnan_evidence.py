"""Stage accepted Chengnan evidence, preserving saved bytes; never solve in CI."""
import argparse
from hashlib import sha256
from io import BytesIO
import json
import lzma
from pathlib import Path
import sqlite3
import sys
import tarfile

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from backend.kernel.batch_files import atomic, encoded
from backend.kernel.hpc_evidence import checksum, evidence_index
from backend.kernel.batch_convergence import verdict


def pack(database, folder, stage):
    index, original_identity=evidence_index()
    accepted=json.loads((folder/'final-chapter.json').read_text('utf-8-sig'))
    book=json.loads((folder/'book-receipt.json').read_text('utf-8-sig'))
    workflow_id=accepted['convergence']['id']; rid=accepted['fem']['run_id']
    assert rid==book['fem'] and accepted['fem']['eligible_current_report']
    assert accepted['execution']['backend']=='slurm' and accepted['execution']['job_id']
    assert accepted['convergence']['verdict']['status']=='converged'
    assert not index.get('supplementary_receipts'),'Review or replace the current Chengnan evidence explicitly'
    stage.mkdir(parents=True,exist_ok=False)
    db=sqlite3.connect(database.resolve().as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    wid=accepted['fem']['study']
    records=[];payloads=[];executions={}
    def record(group,table,name,row):records.append((group,dict(name=name,kind='record',table=table),encoded(dict(row))))
    try:
        wfrow=db.execute('SELECT * FROM hpc_convergence WHERE id=?',(workflow_id,)).fetchone()
        wf=json.loads(wfrow['state']);wid=wf['workspace']
        assert wf['rating_run_id']==rid and verdict(wf['rows'],.1)['status']=='converged'
        parent=wf.get('request',{}).get('continue_from')
        workflows=[wfrow]
        if parent:workflows.append(db.execute('SELECT * FROM hpc_convergence WHERE id=?',(parent,)).fetchone())
        runs={r['run_id']:2 if r['kind']=='domain' else 1 if r['kind']=='mesh' else 0 for r in wf['rows']}
        runs[book['iec']]=0
        studies=set()
        for run_id,group in runs.items():
            columns=[r['name'] for r in db.execute('PRAGMA table_info(study_runs)') if r['name']!='output']
            row=dict(db.execute('SELECT rowid AS blob_id,'+','.join(columns)+' FROM study_runs WHERE id=?',(run_id,)).fetchone())
            studies.add(row['study']);blob_id=row.pop('blob_id')
            assert row['status']=='succeeded'
            snapshot=json.loads(row['snapshot'])
            assert snapshot['cases'][0]['input']==json.loads(db.execute('SELECT snapshot FROM study_runs WHERE id=?',(book['iec'],)).fetchone()[0])['cases'][0]['input']
            for column in ('snapshot','output'):
                size=db.execute('SELECT length(CAST('+column+' AS BLOB)) FROM study_runs WHERE id=?',(run_id,)).fetchone()[0]
                assert 0<size<=100*1024*1024,'Do not widen importer memory limits'
                payloads.append((group,dict(name='runs/chengnan/'+run_id+'/'+column+'.json',kind='payload',column=column,run_id=run_id),blob_id,size,row['input_digest' if column=='snapshot' else 'output_digest']))
                row[column]='' if column=='snapshot' else None
            record(group,'study_runs','runs/chengnan/'+run_id+'/record.json',row)
            execution=wf.get('run_executions',{}).get(run_id) or (wf.get('validation_history') or {}).get('run_executions',{}).get(run_id)
            if execution:
                assert execution['actual_cpu_seconds']>0 and execution['slurm_states']==['COMPLETED']
                executions[run_id]={'plugin_id':'cablesim.simulation','capability':'iec-thermal-field','execution':execution}
        for row in workflows:
            record(0,'hpc_convergence','convergence/chengnan/'+row['id']+'.json',row)
            value=json.loads(row['state']);studies.update((value['study'],value['source_study']))
        record(0,'workspaces','workspace/chengnan/record.json',db.execute('SELECT * FROM workspaces WHERE id=?',(wid,)).fetchone())
        for table,key in (('workspace_revisions','revision'),('workspace_history','position')):
            for row in db.execute('SELECT * FROM '+table+' WHERE workspace=? ORDER BY '+key,(wid,)):
                record(0,table,'workspace/chengnan/'+table+'/'+str(row[key])+'.json',row)
        for sid in sorted(studies):
            record(0,'studies','studies/chengnan/'+sid+'/record.json',db.execute('SELECT * FROM studies WHERE id=?',(sid,)).fetchone())
            for row in db.execute('SELECT * FROM study_versions WHERE study=? ORDER BY revision',(sid,)):
                record(0,'study_versions','studies/chengnan/'+sid+'/versions/'+str(row['revision'])+'.json',row)
        delivery=book['job'].get('delivery_id') or book['job'].get('delivery')
        if isinstance(delivery,dict):delivery=delivery['id']
        if not delivery:
            delivery=db.execute('SELECT id FROM deliveries WHERE workspace=? ORDER BY created DESC LIMIT 1',(wid,)).fetchone()[0]
        delivery_row=db.execute('SELECT * FROM deliveries WHERE id=?',(delivery,)).fetchone()
        assert rid in delivery_row['sources'] and book['iec'] in delivery_row['sources'],'Book must cite these saved runs'
        record(0,'deliveries','delivery/chengnan/record.json',delivery_row)
        for row in db.execute('SELECT * FROM delivery_requests WHERE workspace=? AND delivery=?',(wid,delivery)):
            record(0,'delivery_requests','delivery/chengnan/'+row['request_id']+'.json',row)
        archives=[];members=[]
        for group,name in enumerate(('study','mesh','domain')):
            target=stage/(name+'-evidence.tar.xz');logical='validation/engineering-evidence/chengnan/'+target.name
            with lzma.open(target,'wb',preset=6) as compressed,tarfile.open(fileobj=compressed,mode='w|') as bundle:
                for _,metadata,raw in (r for r in records if r[0]==group):
                    assert len(raw)<=8*1024*1024
                    member=tarfile.TarInfo(metadata['name']);member.size=len(raw)
                    bundle.addfile(member,BytesIO(raw));members.append({**metadata,'archive':logical,'size':len(raw),'sha256':sha256(raw).hexdigest()})
                for _,metadata,blob_id,size,expected in (r for r in payloads if r[0]==group):
                    digest=sha256()
                    class Reader:
                        def read(self,n):
                            data=blob.read(n);digest.update(data);return data
                    with db.blobopen('study_runs',metadata['column'],blob_id,readonly=True) as blob:
                        member=tarfile.TarInfo(metadata['name']);member.size=size;bundle.addfile(member,Reader())
                    assert digest.hexdigest()==expected,'Saved bytes changed; refuse evidence'
                    members.append({**metadata,'archive':logical,'size':size,'sha256':expected})
            assert target.stat().st_size<=100*1024*1024
            archives.append(dict(path=logical,size=target.stat().st_size,sha256=checksum(target)))
        snapshot=json.loads(db.execute('SELECT snapshot FROM study_runs WHERE id=?',(rid,)).fetchone()[0])
        final=wf['rows'][-1];execution=accepted['execution']
        source_snapshot=json.loads(db.execute('SELECT snapshot FROM study_runs WHERE id=?',(wf['source_run_id'],)).fetchone()[0])
        receipt=dict(workspace=wid,study=wf['study'],run=rid,convergence=wf['id'],iec_run=book['iec'],delivery=delivery,
            job_id=execution['job_id'],partition='dg83',date=execution['finished'],core_hours=execution['core_hours'],
            wall_seconds=int(execution['actual_cpu_seconds']/6),method=snapshot['definition']['method'],input_digest=accepted['fem']['input_digest'],
            output_digest=accepted['fem']['output_digest'],starting_mesh={'size_m':.0022,'far_size_m':.5,'field_order':2},
            final_mesh=final,workflow_core_hours=wf['actual_core_hours'],starting_parameters={**source_snapshot['cases'][0]['parameters'],'mesh':json.loads((folder/'parameters.json').read_text('utf-8'))['mesh']},
            source_study=wf['origin_study'] if 'origin_study' in wf else wf['source_study'],
            scope='超算实算结果；保存单芯接触品字形输入，零面积理想点接触，IEC 波纹平均半径与保存空气环热阻；非厂家实测接触或三维波纹验证，不构成工程批准。')
        # The receipt-level digest binds the full saved snapshot, not only its domain.
        receipt['input_digest']=db.execute('SELECT input_digest FROM study_runs WHERE id=?',(rid,)).fetchone()[0]
        candidate={**index,'archives':index['archives']+archives,'members':index['members']+members,
            'executions':{**index['executions'],**executions},'supplementary_receipts':[receipt]}
        atomic(stage/'engineering-evidence-index.json',candidate)
        (stage/'engineering-evidence.sha256').write_text(checksum(stage/'engineering-evidence-index.json')+'\n','ascii')
        atomic(stage/'review.json',{'original_identity':original_identity,'receipt':receipt,'new_members':len(members),'archives':archives})
        print(json.dumps({'receipt':receipt,'archives':archives},ensure_ascii=False))
    finally:db.close()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--database',type=Path,required=True)
    p.add_argument('--receipt-folder',type=Path,required=True);p.add_argument('--stage',type=Path,required=True)
    a=p.parse_args();pack(a.database,a.receipt_folder,a.stage)
