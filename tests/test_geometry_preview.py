"""Draft CAD previews respect locks and never become saved engineering runs."""
from copy import deepcopy
import importlib.util
from pathlib import Path
from fastapi.testclient import TestClient
import pytest


def test_draft_preview_is_pinned_readonly_and_respects_locks(tmp_path,monkeypatch):
    pytest.importorskip('cadquery')
    monkeypatch.setenv('CABLESIM_DESIGN_DB',str(tmp_path/'preview.sqlite'))
    source=Path(__file__).resolve().parents[1]/'design/workbench/serve.py'
    spec=importlib.util.spec_from_file_location('cad_preview_test_server',source)
    server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)
    with TestClient(server.app) as client:
        css=client.get('/design/workbench/workbench.css')
        assert css.status_code==200 and css.headers['cache-control']=='no-store'
        fresh=client.get('/design/workbench/workbench.css',headers={'If-None-Match':css.headers['etag'],'If-Modified-Since':css.headers['last-modified']})
        assert fresh.status_code==200 and '#workspace:has(>.type-work-area)' in fresh.text
        w=client.post('/api/workspaces',json={}).json()
        root='/api/workspaces/'+w['id']
        converted=client.post(root+'/domain/conversion',json={'expected_revision':w['revision']}).json()
        before=client.get(root).json()
        saved=client.get(root+'/domain').json()
        document=deepcopy(saved['document'])
        insulation=next(l for l in document['cable_types'][0]['common_layers'] if l['role']=='insulation')
        insulation['thickness']+=.0005
        plugin=next(m for m in client.get('/api/methods').json() if m['method']['plugin_id']=='cablesim.cable-geometry')
        body={'expected_revision':converted['revision'],'document':document,
              'method':{**plugin['method'],'capability':'concentric-model'},
              'parameters':{'cable_type_id':document['cable_types'][0]['id'],'length_m':.18}}
        response=client.post('/api/design/workspaces/'+w['id']+'/geometry-preview',json=body)
        assert response.status_code==200,response.text
        preview=response.json();model=preview['artifacts']['x-cablesim.cad-model']
        assert preview['effect']=='preview'
        assert preview['input_sha256']==model['input_sha256']
        assert preview['method']==plugin['method']
        assert len(preview['request_sha256'])==64
        changed_input=deepcopy(body)
        changed_input['reuse_from']=preview['request_sha256']
        changed_input['document']['cable_types'][0]['common_layers'][1]['thickness']+=.0002
        reused=client.post('/api/design/workspaces/'+w['id']+'/geometry-preview',json=changed_input)
        assert reused.status_code==200,reused.text
        stats=reused.json()['artifacts']['x-cablesim.cad-model']['build_stats']
        assert stats['reused_layers']==2 and stats['generated_layers']==4
        after=client.get(root).json()
        assert after['revision']==before['revision'] and after['audit']==before['audit']
        assert client.get(root+'/domain').json()==saved
        assert client.get(root+'/studies').json()==[] and after['runs']==[]
        changed=deepcopy(body);changed['expected_revision']+=1
        assert client.post('/api/design/workspaces/'+w['id']+'/geometry-preview',json=changed).status_code==409
        changed=deepcopy(body);changed['method']['release_digest']='0'*64
        assert client.post('/api/design/workspaces/'+w['id']+'/geometry-preview',json=changed).status_code==409
        changed=deepcopy(body)
        changed['document']['cable_types'][0]['rating']['max_conductor_temperature']['normal']+=1
        rejected=client.post('/api/design/workspaces/'+w['id']+'/geometry-preview',json=changed)
        assert rejected.status_code==422 and '保护' in rejected.text
