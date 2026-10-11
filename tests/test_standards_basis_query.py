"""Capability admission, release pins, read-only cache and real process queries."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
from pathlib import Path
import shutil

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.kernel.workspace import fingerprint
from backend.plugin_host.executor import Executor
from backend.plugin_host.manifest import Manifest
from backend.plugin_host.query_router import make_router
from backend.plugin_host.registry import Registry

ROOT=Path(__file__).resolve().parents[1]


def test_old_manifest_serialization_remains_identical():
    for path in [ROOT/'plugins/cablesim.standards-basis/plugin.json']:
        raw=json.loads(path.read_text('utf-8'))
        old=deepcopy(raw)
        for cap in old['capabilities']:cap.pop('read_only',None)
        before=Manifest.model_validate(old).model_dump(mode='json',by_alias=True)
        assert all('read_only' not in c for c in before['capabilities'])
        explicit=deepcopy(old)
        for cap in explicit['capabilities']:cap['read_only']=False
        after=Manifest.model_validate(explicit).model_dump(mode='json',by_alias=True)
        for cap in after['capabilities']:cap.pop('read_only')
        assert before==after


def test_actual_route_executor_cache_release_admission_and_read_only(tmp_path):
    class ObservedExecutor(Executor):
        count=0
        def run(self,*args,**kwargs):
            self.count+=1
            return super().run(*args,**kwargs)
    executor=ObservedExecutor(jobs_root=tmp_path)
    app=FastAPI();app.include_router(make_router(executor))
    plugin=Registry(plugin_id='cablesim.standards-basis').get('cablesim.standards-basis')
    pin=fingerprint(plugin.manifest.model_dump(mode='json',by_alias=True))
    body={'release_digest':pin,'input':{'schema_version':'cablesim.standards-query/1','operation':'catalog'}}
    endpoint='/api/plugin-queries/cablesim.standards-basis/lookup'
    with TestClient(app) as client:
        with ThreadPoolExecutor(max_workers=2) as pool:
            replies=list(pool.map(lambda _:client.post(endpoint,json=body),range(2)))
        assert all(r.status_code==200 for r in replies)
        assert executor.count==1 and replies[0].json()==replies[1].json()
        answer=replies[0].json()['artifacts']['x-cablesim.standards-basis']
        assert answer['status']=='catalogued' and len(answer['tables'])>=33
        bad=deepcopy(body);bad['release_digest']='0'*64
        assert client.post(endpoint,json=bad).status_code==409
        invalid=deepcopy(body);invalid['input']['conditions']={}
        assert client.post(endpoint,json=invalid).status_code==422
        copied=tmp_path/'plugins/cablesim.standards-basis'
        shutil.copytree(ROOT/'plugins/cablesim.standards-basis',copied)
        original=json.loads((copied/'plugin.json').read_text('utf-8'))
        original['capabilities'][0]['read_only']=False
        (copied/'plugin.json').write_text(json.dumps(original),'utf-8')
        other_app=FastAPI();other_app.include_router(make_router(Executor(Registry(copied.parent))))
        rejected=TestClient(other_app).post(endpoint,json=body)
        assert rejected.status_code==403
        assert not list(tmp_path.glob('**/*.sqlite'))
