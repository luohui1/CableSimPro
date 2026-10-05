"""Multiple reviewed specifications commit atomically after one explicit approval."""
from uuid import uuid4
import json
import pytest
from test_datasheet_import import client,upload,extract,scope


def batch(client):
    doc=upload(client);items=[]
    for area in (300,400):
        request={**scope(),'request_id':str(uuid4())};request['model']['specification']=str(area)
        run,_=extract(client,doc['id'],request)
        review=client.post(f"/api/documents/{doc['id']}/extractions/{run['id']}/reviews",json={'request_id':str(uuid4()),'expected_revision':0,'reviewer':'Fixture human','decisions':[{'candidate_id':c['id'],'action':'accept','reason':'Checked fixture cell'} for c in run['result']['candidates']]})
        assert review.status_code==200,review.text
        items.append({'request_id':str(uuid4()),'extraction_id':run['id'],'expected_review_revision':1,'version':'1','new_model':{'name':f'YJV 3x{area}','manufacturer':'Fixture','designation':'YJV','voltage_v':15000,'u0_v':8700,'cores':3,'area_m2':area*1e-6,'conductor':'copper_bare','identity_reference':'Synthetic fixture page 1'}})
    body={'request_id':str(uuid4()),'items':items}
    response=client.post(f"/api/documents/{doc['id']}/batches",json=body)
    assert response.status_code==201,response.text
    assert client.post(f"/api/documents/{doc['id']}/batches",json=body).json()==response.json()
    assert client.get('/api/domain-cable-models').json()==[]
    return doc,response.json()


@pytest.mark.parametrize('conflict',[False,True])
def test_batch_approval_atomic_and_idempotent(client,conflict):
    doc,proposal=batch(client)
    if conflict:
        added=client.post('/api/domain-cable-models',json=proposal['proposals'][-1]['draft'])
        assert added.status_code==201,added.text
    body={'request_id':str(uuid4()),'proposal_sha256':proposal['sha256'],'approver':'Fixture human','human_approved':True}
    url=f"/api/documents/{doc['id']}/batches/{proposal['id']}/approval"
    response=client.post(url,json=body)
    if conflict:
        assert response.status_code==409,response.text
        assert len(client.get('/api/domain-cable-models').json())==1
        assert client.get(url.removesuffix('/approval')).json()['status']=='proposed'
    else:
        assert response.status_code==200,response.text
        assert client.post(url,json=body).json()==response.json()
        models=client.get('/api/domain-cable-models').json()
        assert len(models)==2 and all(m['state']=='incomplete' and not m['payload']['confirmed'] for m in models)
        for model in models:
            sources=[json.loads(s['reference']) for k,s in model['payload']['sources'].items() if k.startswith('datasheet/')]
            assert sources and all(s['page']==1 and s['original_sha256']==doc['sha256'] for s in sources)
