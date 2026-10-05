"""Content-based seal reuse, recorded evidence, resident isolation and batching."""
from copy import deepcopy
import json
import os

import pytest

from backend.kernel.verified_executor import SealCache, VerifiedExecutor
from backend.plugin_host import Registry, Executor, PluginHostError
from backend.plugin_host.resident import ResidentRunner
from test_plugin_host import fault_host, result, GOOD, SYNTHETIC_IEC


def test_seal_hit_rechecks_bytes_even_with_restored_mtime(tmp_path):
    host=fault_host(tmp_path,result(GOOD));plugin=host.registry.get('acme.fault');cache=SealCache()
    first=cache.verify(plugin);second=cache.verify(plugin)
    assert first['status']=='verified' and not first['cache_hit'] and second['cache_hit']
    assert second['release_digest']==first['release_digest'] and second['verified_at']==first['verified_at']
    entry=plugin.entry;old=entry.stat();entry.write_bytes(entry.read_bytes().replace(b'500.0',b'501.0'))
    os.utime(entry,ns=(old.st_atime_ns,old.st_mtime_ns))
    with pytest.raises(PluginHostError) as failure:cache.verify(plugin)
    assert failure.value.code=='PACKAGE_DIGEST_MISMATCH'


def test_new_package_file_cannot_reuse_a_verified_seal(tmp_path):
    host=fault_host(tmp_path,result(GOOD));plugin=host.registry.get('acme.fault');cache=SealCache();cache.verify(plugin)
    (plugin.directory/'src/extra.txt').write_text('not sealed')
    with pytest.raises(PluginHostError) as failure:cache.verify(plugin)
    assert failure.value.code=='PACKAGE_FILES_MISMATCH'


def test_execution_rechecks_bytes_even_inside_request_scope(tmp_path):
    from backend.kernel.verified_executor import verification_scope
    host=fault_host(tmp_path,result(GOOD));plugin=host.registry.get('acme.fault')
    executor=VerifiedExecutor(registry=host.registry,jobs_root=tmp_path)
    with verification_scope():
        executor.verify_release(plugin)
        assert executor.verify_release(plugin)['request_snapshot_reused']
        plugin.entry.write_bytes(plugin.entry.read_bytes().replace(b'500.0',b'501.0'))
        with pytest.raises(PluginHostError) as failure:
            executor.run('acme.fault','run',[{'case_id':'a','input':{}}])
        assert failure.value.code=='PACKAGE_DIGEST_MISMATCH'


def test_release_change_has_separate_receipt(tmp_path):
    host=fault_host(tmp_path,result(GOOD));cache=SealCache();first=cache.verify(host.registry.get('acme.fault'))
    path=host.registry.get('acme.fault').directory/'plugin.json'
    data=json.loads(path.read_text('utf-8'));data['version']='1.0.1';path.write_text(json.dumps(data),'utf-8')
    second=cache.verify(Registry(host.registry.root).get('acme.fault'))
    assert not second['cache_hit'] and second['release_digest']!=first['release_digest']


def test_dependency_bytes_and_new_import_bindings_invalidate_cache(tmp_path):
    from backend.plugin_host.registry import seal
    from backend.plugin_host.dependencies import host_dependencies
    host=fault_host(tmp_path,'import cablesim_sdk.fixture\n'+result(GOOD))
    sdk=tmp_path/'cablesim_sdk';sdk.mkdir()
    (sdk/'__init__.py').write_text('')
    dependency=sdk/'fixture.py';dependency.write_text('from cablesim_sdk import optional\nVALUE=1\n')
    package=host.registry.get('acme.fault').directory
    (package/'src/host-dependencies.json').write_text(json.dumps(host_dependencies(package)))
    manifest=json.loads((package/'plugin.json').read_text());manifest['files']=seal(package)
    (package/'plugin.json').write_text(json.dumps(manifest))
    plugin=Registry(host.registry.root).get('acme.fault');cache=SealCache();cache.verify(plugin)
    # A newly resolvable optional import must force a fresh closure check.
    (sdk/'optional.py').write_text('VALUE=3\n')
    with pytest.raises(PluginHostError):cache.verify(plugin)
    (sdk/'optional.py').unlink()
    before=dependency.stat();dependency.write_text('from cablesim_sdk import optional\nVALUE=2\n')
    os.utime(dependency,ns=(before.st_atime_ns,before.st_mtime_ns))
    with pytest.raises(PluginHostError):cache.verify(plugin)


def test_resident_iec_keeps_results_and_records_cache_hits(tmp_path):
    runner=ResidentRunner(tmp_path/'workers')
    executor=VerifiedExecutor(process_runner=runner,jobs_root=tmp_path)
    cases=[{'case_id':'a','input':deepcopy(SYNTHETIC_IEC)}]
    baseline=Executor(jobs_root=tmp_path).run('cablesim.iec60287','reference-rating',cases)
    try:
        first=executor.run('cablesim.iec60287','reference-rating',cases)
        bad=deepcopy(cases);bad[0]['input']['installation']['depth_m']=-.03
        assert executor.check('cablesim.iec60287','reference-rating',bad).cases[0].status=='failed'
        second=executor.run('cablesim.iec60287','reference-rating',cases)
        assert first.cases[0].results==second.cases[0].results==baseline.cases[0].results
        assert first.cases[0].artifacts==second.cases[0].artifacts==baseline.cases[0].artifacts
        assert first.environment['resident_profiling']['worker_pid']==second.environment['resident_profiling']['worker_pid']
        receipt=second.environment['seal_verification']
        assert receipt['status']=='verified' and receipt['cache_hit'] and len(receipt['release_digest'])==64
        assert second.cases[0].evidence['seal_verification']==receipt
    finally:runner.close()


def test_preflight_batches_nine_uncached_factory_candidates(tmp_path,monkeypatch):
    from fastapi.testclient import TestClient
    from backend.main import create_app
    from backend.kernel.model_series import import_yjv22
    from backend.kernel.scenarios import METHOD_DEFAULTS
    with TestClient(create_app(tmp_path/'batch.sqlite')) as client:
        def api(path,method='GET',body=None):
            response=client.request(method,path,json=body)
            assert response.is_success,response.text
            return response.json()
        pin=next(m['method'] for m in api('/api/methods') if m['method']['plugin_id']=='cablesim.iec60287')
        series=import_yjv22(api,pin);chosen=series['candidates'][-1]
        w=api('/api/design/study-workspaces','POST',{'model_id':'candidate:'+chosen['id'],'content_sha256':chosen['digest'],
              'three_core_layout':'three_core_ducts_horizontal','target_current_a':400,
              'candidate_completion':series['candidate_completions'][chosen['id']]})
        calls=[];executor=client.app.state.research.executor;original=executor.run
        def recorded(plugin,capability,cases,**kwargs):
            calls.append((capability,len(cases),kwargs.get('phase','run')))
            return original(plugin,capability,cases,**kwargs)
        monkeypatch.setattr(executor,'run',recorded)
        s=api(f'/api/workspaces/{w["id"]}/studies','POST',{'title':'Batch completion','expected_revision':w['revision'],
            'method':{**pin,'capability':'steady-rating'},'input_source':'domain','parameters':METHOD_DEFAULTS['cablesim.iec60287'],
            'candidate_completions':series['candidate_completions'],
            'driver':{'kind':'selection','candidate_ids':[c['id'] for c in series['candidates']],'minimum':400,'rating_basis':'simultaneous'}})
        pre=api(f'/api/workspaces/{w["id"]}/studies/{s["id"]}/preflight?expected_revision={w["revision"]}&expected_study_revision={s["revision"]}')
        assert pre['ready'] and len(pre['cases'])==10
        assert [v for v in calls if v[0]=='model-completion']==[('model-completion',9,'run')]
        assert all(c['evidence']['seal_verification']['status']=='verified' for c in pre['cases'])
