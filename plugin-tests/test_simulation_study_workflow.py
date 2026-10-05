"""Three real research modules from admission to polling and sealed artifacts.

Run only via the Slurm plugin-test runner. Numerical reference assertions stay in
test_research_simulation.py; this test covers saved business identities and books.
"""
import json
from pathlib import Path
import time
from uuid import uuid4
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.kernel.report import artifact_sections
from simulation_fixtures import domain,transient_parameters,electromagnetic_parameters,coupled_parameters


def test_three_simulation_modules_saved_pollable_and_source_bound(tmp_path):
    with TestClient(create_app(tmp_path/'modules.sqlite')) as client:
        w=client.post('/api/workspaces',json={}).json();root='/api/workspaces/'+w['id']
        tasks={t['task']:t for t in client.get('/api/study-tasks').json()}
        modules={}
        for task,inputs,parameters in [('transient-temperature',domain(),transient_parameters(domain())),
                                      ('sheath-losses',domain(True),electromagnetic_parameters(domain(True))),
                                      ('electrothermal-steady',domain(True),coupled_parameters(domain(True)))]:
            modules[task]={'title':tasks[task]['label'],'task':task,'method':tasks[task]['method'],
                           'input_source':'study','method_input':inputs,'parameters':parameters}
        response=client.post(root+'/studies',json={**modules['transient-temperature'],'modules':modules,'expected_revision':1})
        assert response.status_code==201,response.text
        s=response.json();url=root+'/studies/'+s['id'];records=[]
        for task in modules:
            query={'module':task,'expected_revision':1,'expected_study_revision':1}
            check=client.get(url+'/preflight',params=query)
            assert check.status_code==200 and check.json()['ready'],check.text
            request={**query,'request_id':str(uuid4()),'lock_digest':check.json()['lock_digest'],'scope_acknowledged':True}
            response=client.post(url+'/runs',json=request)
            assert response.status_code in (200,202),response.text
            rid=response.json()['id'];poll=url+'/runs/'+rid
            assert client.post(url+'/runs',json=request).json()['id']==rid
            deadline=time.monotonic()+600
            while time.monotonic()<deadline:
                run=client.get(poll).json()
                if run['status'] not in ('accepted','running','validating'):break
                time.sleep(.25)
            assert run['status']=='succeeded' and run['integrity']=='verified',run.get('error') or run.get('output')
            row=run['output']['cases'][0]
            for artifact in tasks[task]['required_artifacts']:
                assert artifact in row['artifacts'] and len(row['artifact_digests'][artifact])==64
            assert 'data-section="'+task+'"' in artifact_sections(row)
            if task=='sheath-losses':
                delivery=client.post(root+'/deliveries/current',json={'run_ids':[rid],'request_id':str(uuid4())})
                assert delivery.status_code==201,delivery.text
                download=client.get(root+'/deliveries/'+delivery.json()['id']+'/file')
                assert download.status_code==200 and row['artifact_digests']['x-cablesim.loss-coefficients'] in download.text
            else:
                # Automatic grids are frozen at admission; book authorization
                # still depends on actual independent mesh/domain differences.
                assert len(run['convergence']['rows']) >= 3
                delivery=client.post(root+'/deliveries/current',json={'run_ids':[rid]})
                assert delivery.status_code == (201 if run['convergence']['status']=='converged' else 422)
            records.append({'task':task,'run_id':rid,'status':run['status'],'input_sha256':run['input_digest'],
                            'output_sha256':run['output_digest'],'artifact_digests':row['artifact_digests']})
        output=Path(__file__).resolve().parents[1]/'artifacts/simulation-study-workflow.json'
        output.parent.mkdir(exist_ok=True);output.write_text(json.dumps(records,indent=2),encoding='utf-8')
