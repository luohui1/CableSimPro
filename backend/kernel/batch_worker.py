"""Same isolated per-sample entry point for local pools and Slurm arrays."""
from pathlib import Path
import sys

if __package__ in (None,''):
    sys.path.insert(0,str(Path(__file__).resolve().parents[2]))

import argparse
from dataclasses import asdict
import gzip
from hashlib import sha256
import os
import socket
import threading
import time

from backend.kernel.batch_budget import utc_now
from backend.kernel.batch_files import atomic, digest, encoded, locked, read
from backend.plugin_host import Executor
from backend.plugin_host.manifest import Manifest
from backend.plugin_host.registry import Registry, PluginHostError
from backend.plugin_host.process import run_process


def error_state(error):
    code=str(error.get('code',''))
    message=str(error.get('message',''))
    if code in ('TIMEOUT','TimeoutExpired') or '超时' in message:return 'timed_out'
    if code in ('EnvironmentMissing','PLATFORM_UNSUPPORTED') or '环境缺失' in message or '缺少数值' in message:return 'environment_missing'
    if '不收敛' in message or 'did not converge' in message or code=='MESH_NOT_CONVERGED':return 'nonconverged'
    if code in ('PLUGIN_CRASHED','PROCESS_LAUNCH_FAILED'):return 'crashed'
    return 'failed'


def failure_reason(row):
    """A stable category supplements, but never replaces, the original failure."""
    if row.get('valid') or row.get('status') in ('pending','running'):
        return None
    error=row.get('error') or {}
    message=str(error.get('message',''))
    if '未夹住温限' in message:
        return 'ampacity_unbracketed_within_declared_current_range'
    return str(error.get('code') or row.get('status') or 'unknown_failure')


def verify_row(row, directory=None):
    content={k:v for k,v in row.items() if k!='row_sha256'}
    if row.get('row_sha256')!=digest(content):raise ValueError('RESULT_INTEGRITY_FAILED')
    if directory is not None and row.get('raw_result'):
        base=Path(directory).resolve();path=(base/row['raw_result']).resolve()
        if not path.is_relative_to(base/'raw') or sha256(path.read_bytes()).hexdigest()!=row['raw_sha256']:
            raise ValueError('RAW_RESULT_INTEGRITY_FAILED')
    return row


class MemoryProbe:
    def __init__(self):
        self.peak=0;self.stop=threading.Event();self.error=None
        self.thread=threading.Thread(target=self.observe,daemon=True)

    def observe(self):
        try:
            import psutil
            parent=psutil.Process()
            while not self.stop.is_set():
                total=0
                for process in [parent,*parent.children(recursive=True)]:
                    try:total+=process.memory_info().rss
                    except (psutil.NoSuchProcess,psutil.AccessDenied):pass
                self.peak=max(self.peak,total)
                self.stop.wait(.02)
        except Exception as exc:self.error=str(exc)


def failed_sample(directory,index,backend,code,message,evidence=None):
    """Seal infrastructure failures without inventing any solver quantities.

    Call only after the owner process or Slurm allocation is known to have ended.
    """
    directory=Path(directory);plan=read(directory/'plan.json');descriptor=plan['samples'][index]
    sample=read(directory/'inputs'/(descriptor['case_id']+'.json'))
    if digest(sample)!=descriptor['sample_sha256']:raise ValueError('SAMPLE_INTEGRITY_FAILED')
    target=directory/'samples'/(descriptor['case_id']+'.json')
    with locked(directory/'locks'/(descriptor['case_id']+'.lock')):
        previous=read(target) if target.exists() else {}
        if previous.get('status') not in (None,'pending','running','interrupted'):return verify_row(previous,directory)
        row={**previous,'schema_version':'cablesim.dataset-row/1','dataset_id':plan['id'],
             'sample_id':descriptor['case_id'],'index':index,'attempt':previous.get('attempt',1),
             'parameters':sample['parameters'],'input_sha256':digest(sample['case']['input']),
             'case_sha256':digest(sample['case']),'method':plan['method'],'runtime_sha256':plan['runtime_sha256'],
             'backend':backend,'status':'timed_out' if 'TIMEOUT' in code else 'interrupted' if 'INTERRUPTED' in code else 'failed',
             'valid':False,'finished':utc_now(),'results':[],'error':{'code':code,'message':message},
             'infrastructure_evidence':evidence,'authority':'reference_only','engineering_approval':False}
        row.pop('row_sha256',None);row['row_sha256']=digest(row)
        atomic(directory/'attempts'/descriptor['case_id']/(str(row['attempt'])+'-infrastructure.json'),row)
        atomic(target,row);return row


def execute_sample(directory,index,backend='local',retry=False):
    directory=Path(directory).resolve()
    plan=read(directory/'plan.json')
    if digest(plan)!=read(directory/'integrity.json')['plan_sha256']:
        raise ValueError('PLAN_INTEGRITY_FAILED')
    if type(index) is not int or not 0<=index<len(plan['samples']):raise ValueError('sample index out of range')
    descriptor=plan['samples'][index];sample_id=descriptor['case_id']
    sample=read(directory/'inputs'/(sample_id+'.json'))
    if digest(sample)!=descriptor['sample_sha256']:raise ValueError('SAMPLE_INTEGRITY_FAILED')
    result_path=directory/'samples'/(sample_id+'.json')
    with locked(directory/'locks'/(sample_id+'.lock')):
        previous=read(result_path) if result_path.is_file() else None
        if previous and previous['status'] not in ('running','interrupted') and not retry:
            return verify_row(previous,directory)
        if previous and previous['status']=='succeeded':
            return verify_row(previous,directory)  # never recompute a completed sample
        if previous and previous['status'] in ('running','interrupted') and not retry:
            previous.update(status='interrupted',valid=False,error={'code':'OWNER_INTERRUPTED',
                'message':'此前执行已失去所有者；已保存输入和结果，请明确重试该样本。'})
            atomic(result_path,previous)
            return previous
        attempt=1 if previous is None else previous['attempt']+1
        row={'schema_version':'cablesim.dataset-row/1','dataset_id':plan['id'],
            'sample_id':sample_id,'index':index,'attempt':attempt,'parameters':sample['parameters'],
            'input_sha256':digest(sample['case']['input']),'case_sha256':digest(sample['case']),
            'method':plan['method'],'runtime_sha256':plan['runtime_sha256'],
            'status':'running','valid':False,'started':utc_now(),'finished':None,'results':[],
            'backend':backend,'host':socket.gethostname(),'slurm':{k:os.environ[k] for k in
                ('SLURM_JOB_ID','SLURM_ARRAY_JOB_ID','SLURM_ARRAY_TASK_ID','SLURM_CPUS_PER_TASK','SLURM_JOB_NODELIST') if k in os.environ},
            'authority':'reference_only','engineering_approval':False}
        row['license_source']='hpc-installation' if os.environ.get('SLURM_JOB_ID') else 'local-installation'
        atomic(result_path,row)
        started=time.perf_counter();probe=MemoryProbe();probe.thread.start()
        try:
            runtime=Path(__file__).resolve().parents[2]
            frozen=read(runtime/'runtime-manifest.json')
            if digest(frozen)!=plan['runtime_sha256']:raise ValueError('RUNTIME_MANIFEST_INTEGRITY_FAILED')
            for relative,expected in frozen['files'].items():
                path=(runtime/relative).resolve()
                if not path.is_relative_to(runtime) or sha256(path.read_bytes()).hexdigest()!=expected:
                    raise ValueError('RUNTIME_FILE_INTEGRITY_FAILED: '+relative)
            jobs=directory/'scratch'/sample_id
            jobs.mkdir(parents=True,exist_ok=True)
            # Supplying an event also selects process-tree cleanup on Linux.
            stop=threading.Event()
            def controlled(arguments,**kwargs):return run_process(arguments,stop_event=stop,**kwargs)
            executor=Executor(Registry(runtime/'plugins',discover=False),jobs_root=jobs,process_runner=controlled)
            result=executor.run(plan['method']['plugin_id'],plan['method']['capability'],[sample['case']],
                timeout_s=plan['execution']['sample_timeout_s'],
                expected_manifest=Manifest.model_validate(plan['plugin_manifest']))
            raw=asdict(result);case=raw['cases'][0]
            payload=case['artifacts'].get('x-cablesim.dataset-sample')
            row.update(run_id=result.run_id,method_version=result.method_version,environment=result.environment,
                request_sha256=result.request_sha256,artifact_digests=case['artifact_digests'],warnings=case['warnings'],
                results=case['results'],error=case['error'],evidence=case['evidence'])
            if case['status']!='succeeded':
                row['status']=error_state(case['error']);row['valid']=False
            elif payload:
                row.update(status=payload['status'],valid=payload['valid'],solver=payload['solver'],
                    mesh=payload['mesh'],convergence=payload['convergence'],error=payload['reason'])
            else:
                row.update(status='succeeded',valid=True,convergence={'solver_status':'completed','mesh_status':'not_assessed'})
                bundle=case['artifacts'].get('x-cablesim.simulation-bundle',{})
                row['solver']=bundle.get('result',{}).get('solver') or bundle.get('solver') or {'name':'see execution environment'}
                mesh=bundle.get('mesh',{})
                row['mesh']={k:v for k,v in mesh.items() if not isinstance(v,(list,dict))}
                if isinstance(mesh.get('points'),list):row['mesh']['nodes']=len(mesh['points'])
                if isinstance(mesh.get('triangles'),list):row['mesh']['elements']=len(mesh['triangles'])
            raw_name=f'{sample_id}-attempt-{attempt}.json.gz'
            target=directory/'raw'/raw_name;target.parent.mkdir(parents=True,exist_ok=True)
            packed=gzip.compress(encoded(raw),mtime=0)
            with target.open('xb') as stream:stream.write(packed);stream.flush();os.fsync(stream.fileno())
            row.update(raw_result='raw/'+raw_name,raw_sha256=sha256(packed).hexdigest())
        except Exception as exc:
            error={'code':getattr(exc,'code',type(exc).__name__),'message':str(exc)}
            row.update(status=error_state(error),valid=False,error=error,results=[])
        finally:
            probe.stop.set();probe.thread.join(timeout=2)
            row.update(finished=utc_now(),wall_seconds=time.perf_counter()-started,
                peak_rss_bytes=probe.peak or None,memory_measurement='sampled process-tree RSS sum; 20 ms interval',
                memory_error=probe.error)
            row['row_sha256']=digest(row)
            atomic(directory/'attempts'/sample_id/(str(attempt)+'.json'),row)
            atomic(result_path,row)
        return row


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path)
    parser.add_argument('--index',type=int)
    parser.add_argument('--index-file',type=Path)
    parser.add_argument('--backend',choices=['local','slurm'],default='local')
    parser.add_argument('--retry',action='store_true')
    args=parser.parse_args()
    index=args.index
    if args.index_file:
        index=read(args.index_file)[int(os.environ['SLURM_ARRAY_TASK_ID'])]
    if index is None:parser.error('one sample index is required')
    result=execute_sample(args.directory,index,args.backend,args.retry)
    print(encoded({'sample_id':result['sample_id'],'status':result['status'],'valid':result['valid']}).decode())


if __name__=='__main__':main()
