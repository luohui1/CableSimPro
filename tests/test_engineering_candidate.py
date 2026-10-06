"""Source-preserving host integration of the plugin's prepared-model artifact."""
from importlib.util import spec_from_file_location,module_from_spec
from pathlib import Path
from uuid import uuid4
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.plugin_host import Executor
from backend.kernel.scenarios import METHOD_DEFAULTS

def fixture():
    path=Path(__file__).resolve().parents[1]/'plugins/cablesim.iec60287/tests/test_engineering.py'
    spec=spec_from_file_location('engineering_hand_fixture',path);module=module_from_spec(spec);spec.loader.exec_module(module)
    payload=module.specification();payload['specification'].update(manufacturer='公开手算输入',missing=['core_lay_length','filler_rho'])
    return payload,module.parameters()

def test_new_inquiry_completion_snapshot_report_and_replay(tmp_path):
    with TestClient(create_app(tmp_path/'inquiry.sqlite')) as client:
        client.app.state.research.executor=Executor()
        payload,parameters=fixture();item=client.post('/api/domain-cable-models',json=payload).json()
        entry=next(m for m in client.get('/api/methods').json() if m['method']['plugin_id']=='cablesim.iec60287')
        completion={'method':{**entry['method'],'capability':'model-completion'},'parameters':parameters}
        chosen={'model_id':'candidate:'+item['id'],'content_sha256':item['digest'],'three_core_layout':'three_core_ducts_horizontal','target_current_a':250}
        bad=client.post('/api/design/study-workspaces',json={**chosen,'candidate_completion':{**completion,'parameters':{'values':{}}}})
        assert bad.status_code==422
        assert bad.json()['detail']['code']=='INPUT_INVALID'
        assert bad.json()['detail']['path']=='/parameters/values/conductor_form'
        response=client.post('/api/design/study-workspaces',json={**chosen,'candidate_completion':completion})
        assert response.status_code==201,response.text
        w=response.json();d=w['domain'];rating={**entry['method'],'capability':'steady-rating'}
        config={'title':'工程给定参数选型','task':'target','method':rating,'input_source':'domain',
            'parameters':{**METHOD_DEFAULTS['cablesim.iec60287'],'target_current_a':250,'target_circuit_id':d['circuits'][0]['id'],'solver':{**METHOD_DEFAULTS['cablesim.iec60287']['solver'],'max_iterations':300}},
            'driver':{'kind':'selection','candidate_ids':[item['id']],'minimum':250,'target_entities':[c['id'] for c in d['circuits']]},
            'candidate_completions':{item['id']:completion},'expected_revision':w['revision']}
        response=client.post(f'/api/workspaces/{w["id"]}/studies',json=config);assert response.status_code==201,response.text
        s=response.json();root=f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
        pre=client.get(root+'/preflight',params={'expected_revision':w['revision'],'expected_study_revision':s['revision']}).json()
        body={'request_id':str(uuid4()),'expected_revision':w['revision'],'expected_study_revision':s['revision'],'lock_digest':pre['lock_digest'],'scope_acknowledged':True}
        response=client.post(root+'/runs',json=body);assert response.status_code==200,response.text
        run=response.json();assert run['output']['assessment'][0]['status']=='satisfied',run['output']['assessment']
        prepared=run['snapshot']['candidate_snapshots'][0]
        assert prepared['state']=='engineering_input' and prepared['origin']['digest']==item['digest']
        assert prepared['engineering_parameters']==parameters
        assert len(prepared['preparation']['artifact_sha256'])==64
        assert client.post(root+'/runs',json=body).json()['id']==run['id']
        saved=next(i for i in client.get('/api/domain-cable-models').json() if i['id']==item['id'])
        assert saved==item and saved['state']=='incomplete'
        book=client.post(f'/api/workspaces/{w["id"]}/deliveries',json={'run_ids':[run['id']]}).json()['html']
        assert 'data-result="selection"' in book and 'data-section="engineering-parameters"' in book
        assert prepared['preparation']['artifact_sha256'] in book and '2.152' in book


def test_equal_capacity_versions_have_one_stable_report_recommendation():
    from backend.kernel.report import recommended_case,selection_answer
    candidates=[{'state':'reviewed','digest':digest*64,'payload':{'name':'同名型号','version':str(i),
        'cable_type':{'cores':[{'conductor':{'nominal_area':.0003}}]},'sources':{}}} for i,digest in enumerate(('b','a'))]
    run={'snapshot':{'candidate_snapshots':candidates,'definition':{'driver':{'kind':'selection','minimum':350},
        'method':{'plugin_id':'report-test','version':'1'}}},'output':{'assessment':[
        {'case_id':'case-'+str(i),'status':'satisfied','value':380,'margin':30,'reason':None} for i in range(2)]}}
    assert recommended_case(run)=='case-1'
    assert 'data-result="selection"' in selection_answer(run)
