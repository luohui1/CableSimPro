"""Resident previews retain run isolation and stop their controlled process tree."""
import json
from pathlib import Path
import subprocess
import sys

import pytest

from backend.plugin_host.executor import minimal_environment
from backend.plugin_host.resident import ResidentRunner
from backend.plugin_host.registry import PluginHostError


def entry(tmp_path, body):
    path=tmp_path/'plugin.py'
    path.write_text('import json,os,time\nfrom pathlib import Path\nCOUNT=0\n'
        'def resident_warmup():\n    pass\n'
        'def resident_main():\n    global COUNT\n    COUNT+=1\n'+body,'utf-8')
    return path


def run(runner, path, job, timeout=4):
    job.mkdir();(job/'input').mkdir();(job/'output').mkdir()
    (job/'input/request.json').write_text(json.dumps({'id':job.name}),'utf-8')
    return runner([sys.executable,'-I',str(path)],cwd=job,
                  env=minimal_environment(job),timeout=timeout,stderr_limit=8000)


def test_resident_jobs_share_only_opted_in_state_and_reload_changed_entry(tmp_path):
    path=entry(tmp_path,"    request=json.loads(Path('input/request.json').read_text())\n"
        "    Path('output/result.json').write_text(json.dumps({'id':request['id'],'count':COUNT,'cwd':str(Path.cwd()),'home':os.environ['HOME']}))\n")
    runner=ResidentRunner(tmp_path/'workers')
    try:
        results=[]
        for name in ['a','b']:
            job=tmp_path/name;proc=run(runner,path,job)
            result=json.loads((job/'output/result.json').read_text())
            assert proc.returncode==0 and result['id']==name
            assert Path(result['cwd'])==job and Path(result['home'])==job
            results.append((proc,result))
        assert [r['count'] for _,r in results]==[1,2]
        assert results[0][0].profiling['worker_pid']==results[1][0].profiling['worker_pid']
        path.write_text(path.read_text()+'\n# changed release\n','utf-8')
        proc=run(runner,path,tmp_path/'c')
        assert json.loads((tmp_path/'c/output/result.json').read_text())['count']==1
        assert proc.profiling['worker_pid']!=results[0][0].profiling['worker_pid']
    finally:runner.close()
    assert not list((tmp_path/'workers').iterdir())


def test_resident_timeout_closes_worker_before_removing_mailbox(tmp_path):
    path=entry(tmp_path,'    while True: time.sleep(.1)\n')
    runner=ResidentRunner(tmp_path/'workers')
    try:
        with pytest.raises(subprocess.TimeoutExpired):run(runner,path,tmp_path/'job',timeout=.25)
    finally:runner.close()
    assert not list((tmp_path/'workers').iterdir())


def test_resident_startup_error_is_explicit(tmp_path):
    path=entry(tmp_path,'    pass\n')
    path.write_text(path.read_text().replace('def resident_warmup():\n    pass','def resident_warmup():\n    raise RuntimeError("synthetic startup failure")'),'utf-8')
    runner=ResidentRunner(tmp_path/'workers')
    try:
        with pytest.raises(PluginHostError,match='synthetic startup failure'):run(runner,path,tmp_path/'job')
    finally:runner.close()
    assert not list((tmp_path/'workers').iterdir())


def test_warmup_loads_no_engineering_job_and_next_job_uses_the_same_worker(tmp_path):
    path=entry(tmp_path,"    Path('output/result.json').write_text(json.dumps({'count':COUNT}))\n")
    runner=ResidentRunner(tmp_path/'workers')
    try:
        assert runner.warmup(path,env=minimal_environment(tmp_path),timeout=4)
        worker=next(iter(runner.workers.values()))
        assert not (worker.mailbox/'input').exists() and not (worker.mailbox/'output').exists()
        pid=json.loads((worker.mailbox/'ready.json').read_text())['pid']
        proc=run(runner,path,tmp_path/'job')
        assert proc.profiling['startup_ms']==0 and proc.profiling['worker_pid']==pid
        assert json.loads((tmp_path/'job/output/result.json').read_text())['count']==1
    finally:runner.close()
