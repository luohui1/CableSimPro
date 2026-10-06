"""Summary compatibility, immutable evidence checks and sealed catalog invalidation."""
from copy import deepcopy
import json
import os
from pathlib import Path
import shutil
import gc
import pytest
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.main import create_app
from backend.kernel.workspace import fingerprint
from backend.kernel.verified_executor import VerifiedExecutor
from backend.plugin_host.registry import Registry
from test_research import client, study, request


@pytest.mark.skipif(os.name != 'nt', reason='Windows directory notification lifecycle')
def test_directory_notification_buffers_are_cancelled_before_collection(tmp_path):
    from backend.kernel.source_watch import SourceWatch, native_api
    from ctypes import wintypes
    import ctypes
    api, _, _ = native_api()
    api.GetCurrentProcess.argtypes=[];api.GetCurrentProcess.restype=wintypes.HANDLE
    api.GetProcessHandleCount.argtypes=[wintypes.HANDLE,ctypes.POINTER(wintypes.DWORD)]
    api.GetProcessHandleCount.restype=wintypes.BOOL
    def handles():
        count=wintypes.DWORD()
        assert api.GetProcessHandleCount(api.GetCurrentProcess(),ctypes.byref(count))
        return count.value
    before=handles()
    for index in range(30):
        watch=SourceWatch(tmp_path)
        assert watch.snapshot() is not None
        del watch
        gc.collect()
        (tmp_path/'changed.txt').write_text(str(index),encoding='utf-8')
    assert handles() <= before + 2


def test_run_summary_default_compatibility_pagination_and_live_state(client, monkeypatch):
    w, s = study(client)
    root, body = request(client, w, s)
    first = client.post(root+'/runs', json=body)
    assert first.status_code == 200, first.text
    saved = first.json()
    full = client.get(root+'/runs').json()
    response = client.get(root+'/runs?view=summary')
    assert response.status_code == 200, response.text
    value = response.json()['items'][0]
    assert set(value) == {'id','workspace','study','sequence','status','created','finished',
                          'freshness','integrity','version_status','snapshot','method','error','headlines'}
    for field in ('id','sequence','status','created','finished','freshness','integrity','version_status'):
        assert value[field] == saved[field]
    assert value['snapshot'] == {'module': saved['snapshot'].get('module')}
    assert value['method'] == saved['snapshot']['definition']['method']
    assert 'output' not in value and len(response.content) < 30000
    assert client.get(root+'/runs?view=full').json() == full
    assert client.get(root+'/runs').json() == full
    assert client.get(root+'/runs?view=other').status_code == 422
    assert client.get(root.replace(s['id'], str(uuid4()))+'/runs?view=summary').status_code == 404
    second = client.post(root+'/runs', json={**body, 'request_id':str(uuid4())}).json()
    page = client.get(root+'/runs?view=summary&limit=1').json()
    assert page['items'][0]['id'] == saved['id']
    assert page['next_cursor'] == saved['sequence']
    page = client.get(root+f'/runs?view=summary&after={page["next_cursor"]}').json()
    assert [row['id'] for row in page['items']] == [second['id']]
    assert page['next_cursor'] is None
    assert client.get(root+f'/runs?view=summary&after={second["sequence"]}').json() == {'items':[], 'next_cursor':None}

    # A changed study invalidates currentness even when the run receipt is warm.
    payload = {**s['definition'], 'parameters':{**s['definition']['parameters'], 'ks':0.8},
               'expected_revision':w['revision'], 'expected_study_revision':s['revision']}
    assert client.put(root, json=payload).status_code == 200
    assert client.get(root+'/runs?view=summary').json()['items'][0]['freshness'] == 'historical'
    with client.app.state.workspace_store.db(True) as db:
        db.execute('UPDATE study_runs SET status=?,error=? WHERE id=?',
                   ('failed', json.dumps({'code':'TEST_FAILURE','message':'x'*900,'internal':{'large':'y'*900}}), saved['id']))
    summary = client.get(root+'/runs?view=summary').json()['items'][0]
    assert summary['status'] == 'failed' and set(summary['error']) == {'code','message'}
    assert len(summary['error']['message']) == 512


def test_study_reads_use_warm_projection_but_detect_changed_raw_evidence(client, monkeypatch):
    w, s = study(client)
    root, body = request(client, w, s)
    saved = client.post(root+'/runs', json=body).json()
    research = client.app.state.research
    assert client.get(root).json()['latest_run_id'] == saved['id']
    with research.store.db() as db:
        original = dict(db.execute('SELECT snapshot,output FROM study_runs WHERE id=?',(saved['id'],)).fetchone())
    from backend.kernel import read_models
    loads = read_models.json.loads
    raw_evidence = (*original.values(), *(value.encode('utf-8') for value in original.values()))
    def no_repeated_large_decode(value, *args, **kwargs):
        assert value not in raw_evidence, 'A warm study/summary read decoded the complete run again'
        return loads(value, *args, **kwargs)
    monkeypatch.setattr(read_models.json, 'loads', no_repeated_large_decode)
    monkeypatch.setattr(research, 'get_run', lambda *a, **kw: (_ for _ in ()).throw(AssertionError('Study read loaded full run')))
    assert client.get(root).status_code == 200
    assert client.get(f'/api/workspaces/{w["id"]}/studies').status_code == 200
    assert client.get(root+'/runs?view=summary').status_code == 200
    monkeypatch.setattr(read_models.json, 'loads', loads)
    # Same declared digest, changed actual bytes must not reuse an integrity receipt.
    with research.store.db(True) as db:
        db.execute('UPDATE study_runs SET output=? WHERE id=?', (json.dumps({'cases':[]}), saved['id']))
    summary = client.get(root+'/runs?view=summary').json()['items'][0]
    assert summary['integrity'] == 'corrupt' and summary['freshness'] == 'unknown'
    assert summary['method'] is None and summary['version_status'] is None
    assert client.get(root).json()['version_status'] is None
    with research.store.db(True) as db:
        snapshot = loads(original['snapshot'])
        snapshot['definition']['method']['version'] = '0.0.0'
        db.execute('UPDATE study_runs SET output=?,snapshot=?,input_digest=? WHERE id=?',
                   (original['output'], json.dumps(snapshot), fingerprint(snapshot), saved['id']))
    summary = client.get(root+'/runs?view=summary').json()['items'][0]
    assert summary['integrity'] == 'verified' and summary['version_status']['status'] == 'stale'
    assert summary['method']['version'] == '0.0.0'


def test_study_model_reference_is_saved_identity_and_standalone_is_unbound(client):
    from backend.kernel.scenarios import system_models, METHOD_DEFAULTS
    model = system_models()[0]
    w = client.post('/api/design/study-workspaces', json={'model_id':model['id'],'content_sha256':model['content_sha256']}).json()
    pin = next(row['method'] for row in client.get('/api/methods').json() if row['method']['plugin_id']=='cablesim.iec60287')
    config = {'expected_revision':w['revision'],'title':'显示引用型号','method':{**pin,'capability':'steady-rating'},
              'input_source':'domain','parameters':deepcopy(METHOD_DEFAULTS['cablesim.iec60287'])}
    s = client.post(f'/api/workspaces/{w["id"]}/studies',json=config).json()
    root = f'/api/workspaces/{w["id"]}/studies'
    for response in (client.get(root).json()[0], client.get(root+'/'+s['id']).json()):
        assert response['model_reference'] == {key:model[key] for key in ('id','name','version','content_sha256')}
        assert response['workspace_revision'] == w['revision']
        assert response['version_status']['status'] == 'empty'
    standalone = client.post(root, json={**config,'title':'独立输入','input_source':'study','method_input':w['domain']}).json()
    assert client.get(root+'/'+standalone['id']).json()['model_reference'] is None
    schema = client.get('/openapi.json').json()
    operation = schema['paths']['/api/workspaces/{wid}/studies/{sid}/runs']['get']
    view = next(item for item in operation['parameters'] if item['name']=='view')
    assert view['schema']['default']=='full' and view['schema']['enum']==['full','summary']
    assert 'RunSummaryPage' in schema['components']['schemas']
    assert schema['components']['schemas']['StudyResponse']['properties']['model_reference']['readOnly'] is True


def test_contract_catalog_reuses_schema_and_invalidates_on_seal_or_source_change(tmp_path, monkeypatch):
    from backend.kernel import input_contracts
    root = Path(__file__).resolve().parents[1]
    ignore = shutil.ignore_patterns('__pycache__','*.pyc','tests')
    for name in ('backend','cablesim_sdk','plugins/cablesim.thermal-network'):
        shutil.copytree(root/name, tmp_path/name, ignore=ignore)
    app = create_app(tmp_path/'catalog.sqlite')
    app.state.research.executor = VerifiedExecutor(registry=Registry(tmp_path/'plugins'), jobs_root=tmp_path/'jobs')
    builds = []
    build = input_contracts.verified_contracts
    def counted(*args, **kwargs):
        builds.append(1)
        return build(*args, **kwargs)
    monkeypatch.setattr(input_contracts, 'verified_contracts', counted)
    with TestClient(app) as client:
        first = client.get('/api/input-contracts')
        assert first.status_code == 200, first.text
        assert client.get('/api/input-contracts').json() == first.json()
        assert len(builds) == 1
        altered = input_contracts.contracts(app.state.research)
        altered[0]['parameter_schema']['properties'].clear()
        assert client.get('/api/design/input-contracts').json() == first.json()
        manifest_path = tmp_path/'plugins/cablesim.thermal-network/plugin.json'
        manifest = json.loads(manifest_path.read_text('utf-8'))
        manifest['version'] = '9.0.0'
        manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
        second = client.get('/api/input-contracts')
        assert second.status_code == 200, second.text
        assert second.json()[0]['method']['version'] == '9.0.0' and len(builds) == 2
        manifest['description'] += ' changed seal'
        manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
        third = client.get('/api/input-contracts')
        assert third.status_code == 200, third.text
        assert third.json()[0]['method']['release_digest'] != second.json()[0]['method']['release_digest']
        assert len(builds) == 3
        source = tmp_path/'plugins/cablesim.thermal-network'/manifest['files'][0]['path']
        raw, before = source.read_bytes(), source.stat()
        source.write_bytes(raw+b'\n# drift\n')
        os.utime(source, ns=(before.st_atime_ns,before.st_mtime_ns))
        failed = client.get('/api/input-contracts')
        assert failed.status_code == 409 and len(builds) == 3


def test_method_catalog_is_reused_and_does_not_block_database_reads(client):
    # The catalog is a source-only cached read; the first request may initialize the cache.
    first = client.get('/api/methods')
    assert first.status_code == 200 and first.json()
    assert client.get('/api/methods').content == first.content
    w, s = study(client)
    root = f"/api/workspaces/{w['id']}/studies/{s['id']}"
    assert client.get(root).status_code == 200
    assert client.get(root + '/runs?view=summary').status_code == 200
