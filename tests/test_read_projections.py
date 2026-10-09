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


@pytest.mark.skipif(os.name!='nt',reason='Windows overlapped directory I/O ownership')
def test_source_notifications_survive_request_worker_exit(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from backend.kernel.source_watch import SourceWatch
    (tmp_path/'backend').mkdir()
    source=tmp_path/'backend'/'source.py'
    source.write_text('before',encoding='utf-8')
    with ThreadPoolExecutor(max_workers=1) as request_worker:
        watch=request_worker.submit(SourceWatch,tmp_path).result()
        before=request_worker.submit(watch.snapshot).result()
    try:
        assert before is not None and watch.snapshot()==before
        source.write_text('after',encoding='utf-8')
        assert watch.snapshot()!=before
        assert watch.healthy
    finally:watch.close()


def test_latest_run_summary_matches_history_and_readers_do_not_wait_for_writer(client):
    w, s = study(client)
    root, body = request(client, w, s)
    saved = client.post(root+'/runs', json=body).json()
    service = client.app.state.research
    # An index/report writer may be updating a different transaction. A reader
    # sees the committed input snapshot immediately, not uncommitted edits.
    with service.store.db(True) as writer:
        writer.execute('UPDATE workspaces SET revision=revision+1 WHERE id=?', (w['id'],))
        observed = service.study_detail(w['id'], s['id'])
        workspace = service.store.snapshot(w['id'])
        assert workspace['revision'] == w['revision']
        assert observed['workspace_revision'] == w['revision']
        writer.rollback()
    history = client.get(root+'/runs?view=summary').json()['items'][-1]
    detail = client.get(root).json()
    assert detail['latest_run']['id'] == saved['id']
    assert detail['latest_run'] == history
    assert detail['version_status'] == history['version_status']
    with service.store.read_snapshot() as reader:
        import sqlite3
        with pytest.raises(sqlite3.OperationalError, match='readonly'):
            reader.execute('UPDATE workspaces SET revision=99')


@pytest.mark.parametrize('header,expected', [('gzip',True),('br, gzip;q=0.5',True),('gzip;q=0',False),('identity',False),('gzip;q=bad',False)])
def test_read_response_gzip_negotiation(header, expected):
    from backend.kernel.read_responses import accepts_gzip
    assert accepts_gzip(header) is expected


def test_compressed_read_preserves_payload_and_changes_with_new_content():
    from gzip import decompress
    from types import SimpleNamespace
    from backend.kernel.read_responses import ReadResponses
    cache = ReadResponses(SimpleNamespace())
    first = b'{"source":"saved-A","values":'+b'[1,2,3],'*1000+b'[]}'
    second = first.replace(b'saved-A',b'saved-B')
    assert decompress(cache.gzip(first)) == first
    assert cache.gzip(first) is cache.gzip(first)
    assert decompress(cache.gzip(second)) == second
    assert cache.gzip(second) != cache.gzip(first)


def test_http_compressed_and_identity_reads_are_the_same_verified_contract(client):
    compressed=client.get('/api/input-contracts',headers={'Accept-Encoding':'gzip'})
    raw=client.get('/api/input-contracts',headers={'Accept-Encoding':'identity'})
    assert compressed.status_code == raw.status_code == 200
    assert compressed.headers['content-encoding'] == 'gzip'
    assert 'content-encoding' not in raw.headers
    assert compressed.content == raw.content
    assert compressed.headers['etag'] == raw.headers['etag']
    assert compressed.headers['vary'] == 'Accept-Encoding'


@pytest.mark.parametrize('output', [None, {'cases': [{'case_id': 'saved', 'artifacts': {
    'x-cablesim.field-shard/0': {'binary': 'full-mesh'},
    'x-cablesim.temperature-field': {'mesh': 'display'},
    'x-cablesim.iec60287-trace': {'source': 'saved'},
}}]}])
def test_detail_omits_lossless_field_shards_but_full_keeps_evidence(output):
    from types import SimpleNamespace
    from backend.kernel.run_details import detail
    original = {'study': 's', 'integrity': 'verified', 'output': output,
                'output_digest': 'original-evidence', 'snapshot': {'cases': []}}
    evidence = deepcopy(original)
    research = SimpleNamespace(get_run=lambda *_: original)
    projected = detail(research, 'w', 's', 'r')
    assert projected['output_digest'] == original['output_digest']
    if output is None:
        assert projected['output'] is None
    else:
        assert set(projected['output']['cases'][0]['artifacts']) == {
            'x-cablesim.temperature-field', 'x-cablesim.iec60287-trace'}
    assert original == evidence
    assert detail(research, 'w', 's', 'r', 'full') == evidence


def test_sharded_detail_uses_verified_display_reader_before_loading_arrays(monkeypatch):
    import sqlite3
    from types import SimpleNamespace
    from contextlib import nullcontext
    from backend.kernel import batch_field_projection
    from backend.kernel.run_details import detail
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    db.execute('CREATE TABLE study_runs(workspace TEXT,id TEXT,output TEXT,request_id TEXT,request_digest TEXT,owner_epoch TEXT,execution_nonce TEXT)')
    db.execute('INSERT INTO study_runs VALUES(?,?,?,?,?,?,?)', ('w', 'r', '{"x-cablesim.field-shard/0":{}}', 'request', 'digest', 'epoch', 'nonce'))
    calls = []
    def display(research, wid, rid):
        calls.append((wid, rid))
        return {'study': 's', 'snapshot': {'cases': []}, 'output': None, 'integrity': 'verified'}
    research = SimpleNamespace(store=SimpleNamespace(db=lambda: nullcontext(db)),
                               get_run=lambda *_: pytest.fail('Detail loaded lossless arrays'))
    monkeypatch.setattr(batch_field_projection, 'read_display', display)
    result = detail(research, 'w', 's', 'r')
    assert result['integrity'] == 'verified'
    assert (result['request_id'], result['request_digest'], result['owner_epoch'], result['execution_nonce']) == ('request', 'digest', 'epoch', 'nonce')
    assert calls == [('w', 'r')]
    db.close()


@pytest.mark.parametrize('fails', [False, True])
def test_catalog_concurrent_miss_has_one_loader_and_shared_outcome(monkeypatch, fails):
    from concurrent.futures import Future, ThreadPoolExecutor
    from threading import Event
    from types import SimpleNamespace
    from backend.kernel import read_responses
    from backend.kernel.read_responses import ReadResponses
    cache = ReadResponses(SimpleNamespace())
    entered, release, joined = Event(), Event(), Event()
    class Pending(Future):
        def result(self, timeout=None):
            joined.set()
            return super().result(timeout)
    monkeypatch.setattr(read_responses, 'Future', Pending)
    monkeypatch.setattr(cache, 'initialize', lambda _: None)
    monkeypatch.setattr(cache, 'generation', lambda _: (None, 1))
    monkeypatch.setattr(cache, 'input_identity', lambda _: ())
    calls = []
    def load():
        calls.append(1); entered.set()
        assert release.wait(5)
        if fails: raise ValueError('invalid release')
        return b'[]'
    with ThreadPoolExecutor(max_workers=2) as workers:
        first = workers.submit(cache.build, ('catalog',), None, load, False)
        assert entered.wait(5)
        second = workers.submit(cache.build, ('catalog',), None, load, False)
        assert joined.wait(5)
        release.set()
        for result in (first, second):
            if fails:
                with pytest.raises(ValueError, match='invalid release'): result.result()
            else: assert result.result() == b'[]'
    assert calls == [1]
    assert not cache.inflight


def test_metadata_startup_does_not_eagerly_validate_all_history(client,monkeypatch):
    research=client.app.state.research
    monkeypatch.setattr(research,'list_studies',lambda *_a,**_k:pytest.fail('Startup must not load historical study results'))
    monkeypatch.setattr(research,'list_runs',lambda *_a,**_k:pytest.fail('Startup must not load historical runs'))
    research.warm_reads()
    assert client.get('/api/input-contracts').status_code==200
    assert client.get('/api/methods').status_code==200


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
        assert client.get('/api/methods').json()[0]['method']['version']=='9.0.0'
        manifest['description'] += ' changed seal'
        manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
        third = client.get('/api/input-contracts')
        assert third.status_code == 200, third.text
        assert third.json()[0]['method']['release_digest'] != second.json()[0]['method']['release_digest']
        assert client.get('/api/methods').json()[0]['method']['release_digest']==third.json()[0]['method']['release_digest']
        assert len(builds) == 3
        unrelated = tmp_path/'backend/harness/catalog_note.py'
        unrelated.parent.mkdir(exist_ok=True)
        unrelated.write_text('# not part of any plugin source closure\n',encoding='utf-8')
        assert client.get('/api/input-contracts').json()==third.json()
        assert len(builds)==3
        source = tmp_path/'plugins/cablesim.thermal-network'/manifest['files'][0]['path']
        raw, before = source.read_bytes(), source.stat()
        source.write_bytes(raw+b'\n# drift\n')
        os.utime(source, ns=(before.st_atime_ns,before.st_mtime_ns))
        failed = client.get('/api/input-contracts')
        assert failed.status_code == 409 and len(builds) == 3
        source.write_bytes(raw)
        assert client.get('/api/input-contracts').status_code==200
        shared = tmp_path/'backend/schemas.py'
        before = shared.stat()
        shared.write_bytes(shared.read_bytes()+b'\n# shared source drift\n')
        os.utime(shared,ns=(before.st_atime_ns,before.st_mtime_ns))
        assert client.get('/api/input-contracts').status_code==409


def test_method_catalog_is_reused_and_does_not_block_database_reads(client):
    # The catalog is a source-only cached read; the first request may initialize the cache.
    first = client.get('/api/methods')
    assert first.status_code == 200 and first.json()
    assert client.get('/api/methods').content == first.content
    w, s = study(client)
    root = f"/api/workspaces/{w['id']}/studies/{s['id']}"
    assert client.get(root).status_code == 200
    assert client.get(root + '/runs?view=summary').status_code == 200


def test_first_catalog_requests_use_background_receipts(tmp_path, monkeypatch):
    """Once managed warm-up completes, reads reuse its receipts in under 300 ms."""
    from backend.kernel import input_contracts
    from time import perf_counter
    from threading import Event
    from backend.kernel.research import Research
    warmed = Event()
    original = Research.warm_catalogs
    def warm(self, stop):
        original(self, stop)
        warmed.set()
    monkeypatch.setattr(Research, 'warm_catalogs', warm)
    # Package publication in another thread must not masquerade as cache eviction.
    # Source invalidation itself is covered by the adjacent drift regression.
    root = Path(__file__).resolve().parents[1]
    for name in ('backend','cablesim_sdk','plugins/cablesim.thermal-network'):
        shutil.copytree(root/name, tmp_path/name, ignore=shutil.ignore_patterns('__pycache__','*.pyc','tests'))
    app = create_app(tmp_path/'first-read.sqlite')
    app.state.research.executor = VerifiedExecutor(registry=Registry(tmp_path/'plugins'), jobs_root=tmp_path/'jobs')
    with TestClient(app) as client:
        assert warmed.wait(20), 'Managed catalogue warm-up did not complete'
        research = client.app.state.research
        assert research.catalog_read_responses.get(('methods',), False)
        assert research.catalog_read_responses.get(('input-contracts',), False)
        before = research.catalog_read_responses.generation(False)
        for index in range(research.read_responses.MAX_ENTRIES+1):
            research.read_responses.build(('projection',index),list[dict],lambda:[],True)
        assert research.catalog_read_responses.get(('methods',),False), (before, research.catalog_read_responses.generation(False), research.catalog_read_responses.watch.healthy)
        assert research.catalog_read_responses.get(('input-contracts',),False)
        def unexpected(*args, **kwargs):
            raise AssertionError('Catalog rebuilt on first HTTP request')
        monkeypatch.setattr(research, 'methods', unexpected)
        monkeypatch.setattr(input_contracts, 'verified_contracts', unexpected)
        for path in ('/api/input-contracts', '/api/methods'):
            start = perf_counter()
            response = client.get(path)
            elapsed = perf_counter()-start
            assert response.status_code == 200, response.text
            assert elapsed < .3, (path, elapsed)


def test_comparison_preserves_saved_headlines_inputs_and_limiting_objects():
    from backend.kernel.drivers import compare
    original = {'id':'a','snapshot':{'definition':{'method':{'version':'1'},'crosschecks':[]},
        'input_contract':{'parameter_schema':{'properties':{'ks':{'x-unit':{'si':'1'}}}}},
        'cases':[{'input':{'soil':1},'parameters':{'ks':.8}}]},
        'headlines':[{'key':'ampacity','title':'共同能力','value':350,'display_value':350,'display_unit':'A'}],
        'output':{'cases':[{'case_id':'case-0','status':'succeeded',
            'results':[{'type':'quantity','status':'available','key':'ampacity','entity':'c1','unit':'A','value':350}],
            'artifacts':{'trace':{'circuit_ratings':[{'entity':'c1','limiting_cable':'cable-1'}]}}}]}}
    other = deepcopy(original);other['id']='b'
    other['snapshot']['cases'][0]['input']['soil']=1.2
    other['output']['cases'][0]['results'][0]['value']=330
    other['headlines'][0]['value']=other['headlines'][0]['display_value']=330
    saved = deepcopy([original,other])
    result = compare([original,other])
    assert result['sources'][0]['headlines'] == original['headlines']
    assert result['sources'][1]['snapshot'] == other['snapshot']
    assert result['sources'][0]['limiting_objects']==[{'case_id':'case-0','entity':'c1','limiting_cable':'cable-1'}]
    assert result['differences'][0]['same_input'] is False
    assert result['differences'][0]['quantities'][0]['difference']==-20
    assert [original,other]==saved


def test_headlines_follow_the_recommended_candidate_and_driver_condition():
    from backend.kernel.headlines import project
    unit = {'si':'A','display':'A','scale':1,'offset':0}
    driver = {'kind':'selection','target_key':'ampacity','target_unit':'A','target_entity':'circuit/c1',
              'target_entities':[],'rating_basis':'simultaneous','candidate_ids':['a','b']}
    snapshot = {'definition':{'driver':driver},'headline_contract':[{
        'key':'ampacity','title':'允许电流','unit':unit,'aggregate':'minimum','condition':'rating',
        'artifact':'x-cablesim.headline-witness','source_artifact':'x-cablesim.iec60287-trace'}],
        'candidate_snapshots':[{'state':'engineering_input','digest':str(i)*64,
            'payload':{'name':str(i),'cable_type':{'cores':[{'conductor':{'nominal_area':area}}]}}}
            for i,area in enumerate((.00015,.00024))]}
    cases = [{'case_id':f'case-{i}','status':'succeeded','artifact_digests':{'x-cablesim.headline-witness':str(i)*64},
        'artifacts':{'x-cablesim.headline-witness':{'quantities':[{'key':'ampacity','value':value,'unit':'A',
            'entity':'circuit/c1','condition':'rating-simultaneous','artifact_type':'x-cablesim.iec60287-trace',
            'artifact_sha256':str(i)*64}]}}} for i,value in enumerate((212.9,406.1))]
    output = {'cases':cases,'assessment':[
        {'case_id':'case-0','value':212.9,'status':'not_satisfied','margin':-87.1,'rating_basis':'simultaneous'},
        {'case_id':'case-1','value':406.1,'status':'satisfied','margin':106.1,'rating_basis':'simultaneous'}]}
    statuses = {case['case_id']:{'x-cablesim.headline-witness':{'status':'verified'}} for case in cases}
    answer = project(snapshot,output,statuses)
    assert len(answer)==1 and answer[0]['value']==406.1 and answer[0]['case_id']=='case-1'
    assert answer[0]['condition']=='rating-simultaneous'
    for kind in ('sweep','batch','crosscheck'):
        snapshot['definition']['driver']={**driver,'kind':kind}
        assert project(snapshot,output,statuses)==[]
    snapshot['definition']['driver']=driver
    output['assessment'][1]['status']='not_satisfied'
    assert project(snapshot,output,statuses)==[]


def test_run_detail_reads_inputs_on_demand_without_rewriting_evidence(client):
    w,s=study(client)
    root,body=request(client,w,s)
    original=client.post(root+'/runs',json=body).json()
    url=root+'/runs/'+original['id']
    response=client.get(url)
    assert response.status_code==200,response.text
    detail=response.json()
    assert detail['snapshot_view']=='inputs-on-demand'
    case=detail['snapshot']['cases'][0]
    assert 'input' not in case and detail['input_digest']==original['input_digest']
    assert client.get(url+'?view=full').json()==original
    saved=client.get(case['input_ref']['url']).json()
    assert saved['input']==original['snapshot']['cases'][0]['input']
    assert saved['input_digest']==case['input_ref']['sha256']
    assert saved['run_input_digest']==original['input_digest']
    assert client.get(url+'/cases/missing/input').status_code==404
    with client.app.state.workspace_store.db(True) as db:
        snapshot=deepcopy(original['snapshot'])
        snapshot['cases'][0]['input']['name']='篡改后的输入'
        db.execute('UPDATE study_runs SET snapshot=? WHERE id=?',(json.dumps(snapshot),original['id']))
    assert client.get(url).json()['integrity']=='corrupt'
    assert client.get(case['input_ref']['url']).status_code==409
