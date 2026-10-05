"""Execute one frozen method request in Slurm and retain its complete RunResult."""
from dataclasses import asdict
import gzip
from hashlib import sha256
import os
from pathlib import Path
from functools import partial
import sys
from threading import Event
import time

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from backend.kernel.batch_files import atomic,digest,encoded,read
from backend.plugin_host import Executor
from backend.plugin_host.manifest import Manifest
from backend.plugin_host.registry import Registry
from backend.plugin_host.process import run_process


def main():
    if not os.environ.get('SLURM_JOB_ID'):
        raise RuntimeError('研究求解必须在 Slurm 计算节点执行。')
    directory=Path(sys.argv[1]).resolve();runtime=directory/'runtime'
    plan=read(directory/'plan.json');manifest=read(runtime/'runtime-manifest.json')
    if digest(plan)!=read(directory/'integrity.json')['plan_sha256'] or digest(manifest)!=plan['runtime_sha256']:
        raise RuntimeError('Frozen research plan/runtime integrity mismatch')
    for name,expected in manifest['files'].items():
        path=(runtime/name).resolve()
        if not path.is_relative_to(runtime) or sha256(path.read_bytes()).hexdigest()!=expected:
            raise RuntimeError('Runtime digest mismatch: '+name)
    index=int(sys.argv[sys.argv.index('--index')+1]) if '--index' in sys.argv else None
    if plan.get('case_array') and (index is None or not 0<=index<len(plan['cases'])):raise RuntimeError('Array case index missing or invalid')
    selected=[plan['cases'][index]] if plan.get('case_array') else plan['cases']
    suffix=selected[0]['case_id'] if plan.get('case_array') else ''
    output=directory/'raw'/suffix;output.mkdir(parents=True,exist_ok=True)
    jobs=directory/'scratch'/suffix;jobs.mkdir(parents=True,exist_ok=True)
    status={'job_id':os.environ['SLURM_JOB_ID'],'node':os.environ.get('SLURM_JOB_NODELIST'),
            'plan_sha256':digest(plan),'runtime_sha256':plan['runtime_sha256']}
    started=time.monotonic()
    try:
        executor=Executor(Registry(runtime/'plugins',discover=False),jobs_root=jobs,
                          process_runner=partial(run_process,stop_event=Event()))
        result=executor.run(plan['plugin_id'],plan['capability'],selected,
                            plan['timeout_s'],phase=plan['phase'],
                            expected_manifest=Manifest.model_validate(plan['plugin_manifest']),
                            reuse_artifacts=plan.get('reuse_artifacts'))
        result.environment['compute_node']={'job_id':status['job_id'],'node':status['node'],
                                           'license_source':'hpc-installation'}
        result.environment['host_execution']['process_tree_cleanup_enforced']=True
        packed=gzip.compress(encoded(asdict(result)),mtime=0)
        (output/'run-result.json.gz').write_bytes(packed)
        status.update(state='completed',result_sha256=sha256(packed).hexdigest())
        returncode=0
    except Exception as exc:
        status.update(state='failed',error={'code':getattr(exc,'code',type(exc).__name__),'message':str(exc)})
        returncode=1
    status['wall_seconds']=time.monotonic()-started
    atomic(output/'status.json',status)
    return returncode


if __name__=='__main__':raise SystemExit(main())
