"""Shared v2 research requests for real native integration tests."""
import base64
from copy import deepcopy
from uuid import uuid4
import httpx
from backend.domain.migration import convert


def create_study(client,workspace,capability,arguments):
    converted=convert(workspace['scenario'])
    method=next(m['method'] for m in client.get('/api/methods').json() if m['method']['plugin_id']=='cablesim.native-reference')
    response=client.post('/api/workspaces/'+workspace['id']+'/studies',json={
        'expected_revision':workspace['revision'],'title':'native reference',
        'input_source':'study','method_input':converted['document'],
        'method':{**method,'capability':capability},'parameters':{**converted['method_parameters'],**deepcopy(arguments)}})
    assert response.status_code==201,response.text
    study=response.json();root='/api/workspaces/'+workspace['id']+'/studies/'+study['id']
    return study,root


def execute(client,workspace,study,root):
    pre=client.get(root+'/preflight',params={'expected_revision':workspace['revision'],'expected_study_revision':study['revision']})
    assert pre.status_code==200 and pre.json()['ready'],pre.text
    body={'request_id':str(uuid4()),'expected_revision':workspace['revision'],
          'expected_study_revision':study['revision'],'lock_digest':pre.json()['lock_digest'],'scope_acknowledged':True}
    response=client.post(root+'/runs',json=body)
    assert response.status_code==200,response.text
    run=response.json();assert run['status']=='succeeded',run
    return run,body


def run(client,workspace,capability,arguments):
    study,root=create_study(client,workspace,capability,arguments)
    result,body=execute(client,workspace,study,root)
    return result,study,root,body


def bundle(result):
    return result['output']['cases'][0]['artifacts']['x-cablesim.native-bundle']


def reference(result):
    row=result['output']['cases'][0]
    return {'run_id':result['id'],'case_id':row['case_id'],'artifact_type':'x-cablesim.native-bundle',
            'artifact_sha256':row['artifact_digests']['x-cablesim.native-bundle']}


def download(client,workspace,result,name):
    response=client.get('/api/workspaces/'+workspace['id']+'/studies/'+result['study']+'/runs/'+result['id'])
    if response.status_code!=200:return response
    payload=bundle(response.json())
    entry=next(f for f in payload['files'] if f['name']==name)
    return httpx.Response(200,content=base64.b64decode(entry['bytes_base64']),request=response.request)
