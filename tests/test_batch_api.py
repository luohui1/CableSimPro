"""Lightweight batch configuration validation; native execution runs on Slurm."""
import json
from fastapi.testclient import TestClient
from backend.main import create_app
from test_research import study,request


def configuration(w,s):
    return {'expected_revision':w['revision'],'expected_study_revision':s['revision'],
        'expected_configuration_revision':0,'source_module':None,
        'parameter_space':{'sampling':'latin_hypercube','sample_count':3,'seed':7,'source':'Explicit study sensitivity range',
            'axes':[{'name':'depth','label':'埋深坐标 z','unit':'m','minimum':-.9,'maximum':-.7,'source':'Engineering sensitivity; negative z means depth below ground',
                     'bindings':[{'pointer':f'/input/sections/0/placements/{i}/z','target_unit':'m'} for i in range(3)]}]},
        'execution':{'backend':'local','workers':2,'sample_timeout_s':30,'slurm_wall_seconds':60}}


def test_invalid_axis_and_configuration_conflict_preserve_saved_data(tmp_path):
    with TestClient(create_app(tmp_path/'workspace.sqlite')) as client:
        w,s=study(client);root,_=request(client,w,s);body=configuration(w,s)
        invalid=json.loads(json.dumps(body));invalid['parameter_space']['axes'][0]['unit']='mm'
        assert client.put(root+'/batch-configuration',json=invalid).status_code==422
        invalid=json.loads(json.dumps(body));invalid['parameter_space']['axes'][0]['bindings'][0]['pointer']='/input/missing'
        assert client.put(root+'/batch-configuration',json=invalid).status_code==422
        assert client.put(root+'/batch-configuration',json=body).status_code==200
        assert client.put(root+'/batch-configuration',json=body).status_code==409
        current=client.get(root+'/batch-configuration').json()
        assert current['configuration']['revision']==1
        assert current['configuration']['definition']['parameter_space']['sample_count']==3
        assert client.get(root+'/datasets').json()==[]
