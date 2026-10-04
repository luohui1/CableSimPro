from hashlib import sha256
import json
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.foundation.reproduction_library import make_router


def publish(root,items):
    raw=json.dumps({'schema':'cablesim.reproduction-library/1','created_at':'2026-10-03','items':items}).encode()
    key=sha256(raw).hexdigest();(root/'snapshots').mkdir(exist_ok=True)
    (root/'snapshots'/(key+'.json')).write_bytes(raw)
    (root/'index.json').write_text(json.dumps({'current':key,'history':[{'id':key,'created_at':'2026-10-03'}]}))
    return key


def test_catalog_detail_export_empty_and_tamper_are_distinct(tmp_path):
    app=FastAPI();app.include_router(make_router(tmp_path));client=TestClient(app)
    assert client.get('/api/foundation/reproductions').json()['items']==[]
    key=publish(tmp_path,[{'id':'E19','kind':'paper','status':'partial','title':'Actual input example','rows':[{'reference':2,'calculated':3}]}])
    listed=client.get('/api/foundation/reproductions').json()
    assert listed['items'][0]['status']=='partial' and 'rows' not in listed['items'][0]
    response=client.get('/api/foundation/reproductions/E19/export')
    assert response.status_code==200 and response.json()['rows'][0]['calculated']==3
    assert 'attachment;' in response.headers['content-disposition']
    assert client.get('/api/foundation/reproductions/absent').status_code==404
    assert client.get('/api/foundation/reproductions?snapshot=../../secret').status_code==422
    (tmp_path/'snapshots'/(key+'.json')).write_text('{}')
    response=client.get('/api/foundation/reproductions')
    assert response.status_code==422 and '完整性' in response.json()['detail']
