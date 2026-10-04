"""Saved study -> real process pool inside Slurm -> history -> exported dataset."""
import io,json,time,zipfile
from fastapi.testclient import TestClient
from backend.main import create_app
from test_research import study,request
from test_batch_api import configuration


def test_saved_batch_executes_once_preserves_history_and_exports(tmp_path):
    with TestClient(create_app(tmp_path/'workspace.sqlite')) as client:
        w,s=study(client);root,body=request(client,w,s)
        config=configuration(w,s);config['execution']['workers']=1
        saved=client.put(root+'/batch-configuration',json=config)
        assert saved.status_code==200,saved.text
        body['configuration_revision']=saved.json()['revision']
        check=client.post(root+'/batch-preflight',json=body)
        assert check.status_code==200,check.text
        submitted=client.post(root+'/datasets',json=body)
        assert submitted.status_code==202,submitted.text
        batch=submitted.json();identifier=batch['id']
        assert client.post(root+'/datasets',json=body).json()['id']==identifier
        deadline=time.monotonic()+90
        while batch['status'] in ('preparing','queued','running') and time.monotonic()<deadline:
            time.sleep(.2);batch=client.get(root+'/datasets/'+identifier).json()
        assert batch['status']=='completed',batch
        assert batch['valid_count']==3 and batch['sample_count']==3
        assert len({r['input_sha256'] for r in batch['samples']})==3
        assert all(r['attempt']==1 for r in batch['samples'])
        exported=client.post(root+'/datasets/'+identifier+'/export')
        assert exported.status_code==200,exported.text
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            metadata=json.loads(archive.read('metadata.json'))
            assert metadata['valid_count']==3 and metadata['failure_rate']==0
            assert len(archive.read('valid.csv').decode('utf-8-sig').splitlines())==4
            assert metadata['authority']=='reference_only'
        changed=client.post(f'/api/workspaces/{w["id"]}/edit',json={'expected_revision':w['revision'],
            'changes':[{'path':'installation.depth_m','value':1.1}]})
        assert changed.status_code==200,changed.text
        replay=client.post(root+'/datasets',json=body)
        assert replay.status_code==202 and replay.json()['historical']
        assert replay.json()['id']==identifier
        conflict=client.post(root+'/datasets',json={**body,'configuration_revision':2})
        assert conflict.status_code==409
