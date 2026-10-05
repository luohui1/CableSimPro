"""Frozen runtime packaging, local process pools, and portable dataset exports."""
from concurrent.futures import ProcessPoolExecutor, as_completed
from copy import deepcopy
import csv
from hashlib import sha256
import io
import multiprocessing
import os
from pathlib import Path
import shutil
import sys
import tarfile
import threading
import time
from uuid import UUID

from pydantic import Field
from typing import Literal
from ..schemas import StrictModel
from .batch_budget import utc_now
from .batch_files import atomic, digest, encoded, locked, read
from .batch_inputs import ParameterSpace, materialize
from .batch_worker import verify_row,failed_sample,failure_reason
from ..plugin_host.process import run_process
from ..plugin_host.registry import Registry

ROOT=Path(__file__).resolve().parents[2]


def local_allowed():
    if os.environ.get('SLURM_JOB_ID'):return True  # pool already inside a paid compute allocation
    configuration=ROOT/'.data/hpc/config.json'
    return configuration.is_file() and read(configuration).get('allow_local_fallback') is True


class Execution(StrictModel):
    backend: Literal['local','slurm']='slurm'
    workers: int=Field(default=8,ge=1,le=32,strict=True)
    sample_timeout_s: int=Field(default=300,ge=1,le=3600,strict=True)
    slurm_parallelism: int=Field(default=32,ge=1,le=128,strict=True)
    slurm_wall_seconds: int=Field(default=360,ge=30,le=3600,strict=True)
    slurm_memory_mb: int=Field(default=2048,ge=512,le=8192,strict=True)
    slurm_cpus_per_task: int=Field(default=1,ge=1,le=32,strict=True)


def freeze_runtime(directory, plugin_id, repository=ROOT):
    runtime=Path(directory)/'runtime';runtime.mkdir(parents=True,exist_ok=False)
    repository=Path(repository).resolve()
    plugin=Registry(repository/'plugins',plugin_id=plugin_id).get(plugin_id)
    plugin.verify()
    paths=list((repository/'backend').rglob('*.py'))
    paths.extend((repository/'cablesim_sdk').rglob('*.py'))
    paths += [plugin.directory/'plugin.json',*(plugin.directory/f.path for f in plugin.manifest.files)]
    dependencies=plugin.directory/'src/host-dependencies.json'
    if dependencies.is_file():
        paths.extend(repository/item['path'] for item in read(dependencies))
    records={}
    for path in sorted(set(paths)):
        relative=path.relative_to(repository)
        if path.is_symlink() or not path.resolve().is_relative_to(repository):raise ValueError('Unsafe runtime source path')
        # Runtime sources and declared first-party assets only. Never traverse .data,
        # documents, standards, papers, user SSH files, or the whole repository.
        data=path.read_bytes();target=runtime/relative
        target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
        records[relative.as_posix()]=sha256(data).hexdigest()
    manifest={'schema_version':'cablesim.batch-runtime/1','files':records}
    atomic(runtime/'runtime-manifest.json',manifest)
    config=repository/'.data/cablesim-solvers.json'
    if config.is_file():
        selected={k:v for k,v in read(config).items() if k in ('getdp','elmer','elmer_build','comsol')}
        atomic(runtime/'.data/cablesim-solvers.json',selected)
    return digest(manifest),plugin.manifest.model_dump(mode='json',by_alias=True)


def create_plan(directory, *, batch_id, base_case, method, source, space, execution, repository=ROOT):
    UUID(batch_id)
    space=ParameterSpace.model_validate(space);execution=Execution.model_validate(execution)
    if execution.slurm_wall_seconds<=execution.sample_timeout_s:
        raise ValueError('execution.slurm_wall_seconds: 须大于单样本超时，预留结果封存时间。')
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    if (directory/'plan.json').exists():raise FileExistsError('Dataset plan is immutable')
    samples=materialize(base_case,space)
    runtime_sha,manifest=freeze_runtime(directory,method['plugin_id'],repository)
    if digest(manifest)!=method['release_digest'] or manifest['version']!=method['version']:
        raise ValueError('RELEASE_CHANGED: 请重新选择方法版本并保存研究。')
    descriptors=[]
    for sample in samples:
        case_id=sample['case']['case_id']
        atomic(directory/'inputs'/(case_id+'.json'),sample)
        descriptors.append({'case_id':case_id,'sample_sha256':digest(sample)})
    plan={'schema_version':'cablesim.dataset-plan/1','id':batch_id,'created':utc_now(),
        'source':deepcopy(source),'base_case_sha256':digest(base_case),'base_case':deepcopy(base_case),
        'parameter_space':space.model_dump(mode='json'),'sampling_engine':'Python random MT19937; stratified independent permutations/1',
        'method':method,'plugin_manifest':manifest,'runtime_sha256':runtime_sha,
        'execution':execution.model_dump(mode='json'),'samples':descriptors,
        'authority':'reference_only','engineering_approval':False}
    atomic(directory/'plan.json',plan)
    atomic(directory/'integrity.json',{'plan_sha256':digest(plan)})
    atomic(directory/'execution.json',{'state':'prepared','updated':utc_now(),'error':None})
    return plan


def _local_sample(arguments):
    directory,index,retry=arguments
    directory=Path(directory);plan=read(directory/'plan.json')
    sample_id=plan['samples'][index]['case_id']
    stop=threading.Event();finished=threading.Event()
    def cancellation():
        while not finished.wait(.1):
            if (directory/'cancel.json').exists():stop.set();return
    watcher=threading.Thread(target=cancellation,daemon=True);watcher.start()
    command=[sys.executable,'-I',str(directory/'runtime/backend/kernel/batch_worker.py'),str(directory),'--index',str(index)]
    if retry:command.append('--retry')
    work=directory/'pool'/sample_id;work.mkdir(parents=True,exist_ok=True)
    env=os.environ.copy();env.update(OMP_NUM_THREADS='1',OPENBLAS_NUM_THREADS='1',MKL_NUM_THREADS='1',PYTHONDONTWRITEBYTECODE='1')
    try:
        result=run_process(command,cwd=work,env=env,timeout=plan['execution']['sample_timeout_s']+90,
                           stderr_limit=8000,stop_event=stop)
        if result.returncode:
            raise RuntimeError(result.stderr.decode('utf-8','replace')[-4000:] or f'Worker exited {result.returncode}')
        return read(directory/'samples'/(sample_id+'.json'))
    finally:
        finished.set();watcher.join(timeout=1)


def local_run(directory, indices=None, workers=None, retry=False):
    if not local_allowed():raise ValueError('本机批量计算已禁用；请使用 Slurm 后端。离线兜底须由管理员显式启用。')
    directory=Path(directory).resolve();plan=read(directory/'plan.json')
    count=workers or plan['execution']['workers']
    if type(count)is not int or not 1<=count<=min(32,os.cpu_count() or 1):raise ValueError('workers: 超过本机可用逻辑核数或32进程上限。')
    indices=list(range(len(plan['samples']))) if indices is None else list(indices)
    if len(set(indices))!=len(indices) or any(type(i)is not int or not 0<=i<len(plan['samples']) for i in indices):
        raise ValueError('indices: 样本索引须唯一且位于保存范围内。')
    with locked(directory/'locks/coordinator.lock'):
        if (directory/'cancel.json').exists():raise ValueError('批量任务已取消；请通过明确的恢复操作清除取消状态。')
        started=time.perf_counter();errors=[]
        atomic(directory/'execution.json',{'state':'running','backend':'local','workers':count,'updated':utc_now(),'error':None})
        context=multiprocessing.get_context('spawn')
        with ProcessPoolExecutor(max_workers=count,mp_context=context) as pool:
            pending={pool.submit(_local_sample,(str(directory),i,retry)):i for i in indices}
            for future in as_completed(pending):
                index=pending[future]
                try:future.result()
                except Exception as exc:
                    errors.append({'index':index,'message':str(exc)})
                    atomic(directory/'worker-errors'/(plan['samples'][index]['case_id']+'.json'),
                           {'code':'LOCAL_WORKER_INTERRUPTED','message':str(exc),'index':index,'updated':utc_now()})
                    failed_sample(directory,index,'local','LOCAL_WORKER_INTERRUPTED',str(exc))
        state='cancelled' if (directory/'cancel.json').exists() else 'interrupted' if errors else 'completed'
        summary={'state':state,'backend':'local','workers':count,'indices':indices,'updated':utc_now(),
                 'wall_seconds':time.perf_counter()-started,'errors':errors}
        atomic(directory/'execution.json',summary)
        return summary


def rows(directory):
    directory=Path(directory);plan=read(directory/'plan.json');output=[]
    for index,descriptor in enumerate(plan['samples']):
        path=directory/'samples'/(descriptor['case_id']+'.json')
        if path.is_file():
            row=read(path)
            if row['status'] not in ('running','interrupted'):
                verify_row(row,directory)
            if row['dataset_id']!=plan['id'] or row['sample_id']!=descriptor['case_id'] or row['index']!=index:
                raise ValueError('ROW_BINDING_INVALID')
            sample=read(directory/'inputs'/(descriptor['case_id']+'.json'))
            if row.get('case_sha256')!=digest(sample['case']) or row.get('method')!=plan['method']:
                raise ValueError('ROW_INPUT_METHOD_INVALID')
        else:
            sample=read(directory/'inputs'/(descriptor['case_id']+'.json'))
            row={'sample_id':descriptor['case_id'],'index':index,'status':'pending','valid':False,
                 'parameters':sample['parameters'],'results':[],'error':None}
        output.append(row)
    return output


def export_dataset(directory):
    directory=Path(directory);plan=read(directory/'plan.json');items=rows(directory)
    if digest(plan)!=read(directory/'integrity.json')['plan_sha256']:raise ValueError('PLAN_INTEGRITY_FAILED')
    content_digest=digest({'export_format':'csv-json/2','plan':digest(plan),'rows':items})
    target=directory/'exports'/content_digest
    if (target/'metadata.json').is_file():
        metadata=read(target/'metadata.json')
        if metadata.get('content_sha256')!=content_digest:raise ValueError('EXPORT_METADATA_INVALID')
        for name,record in metadata['files'].items():
            path=(target/name).resolve()
            if path.parent!=target.resolve() or sha256(path.read_bytes()).hexdigest()!=record['sha256']:
                raise ValueError('EXPORT_FILE_INTEGRITY_FAILED')
        return target
    target.mkdir(parents=True,exist_ok=True)
    axes=[a['name'] for a in plan['parameter_space']['axes']]
    quantities=sorted({(r.get('case','unspecified'),r['key'],r['entity'],r['unit']) for row in items
        if row['valid'] for r in row.get('results',[]) if r['status']=='available'})
    names=['sample_id','status','valid','backend','input_sha256','method_plugin','plugin_version','method_version',
           'mesh_nodes','mesh_elements','wall_seconds','peak_rss_bytes','error_code','error_message']
    names += [f'parameter.{name}' for name in axes]
    names += ['result.'+'.'.join(q) for q in quantities]
    def table(selected):
        stream=io.StringIO(newline='');writer=csv.writer(stream);writer.writerow(names)
        for row in selected:
            error=row.get('error') or {};mesh=row.get('mesh') or {}
            values=[row['sample_id'],row['status'],row['valid'],row.get('backend',''),row.get('input_sha256',''),
                plan['method']['plugin_id'],plan['method']['version'],row.get('method_version',''),
                mesh.get('nodes',''),mesh.get('elements',''),row.get('wall_seconds',''),row.get('peak_rss_bytes',''),
                error.get('code',''),error.get('message','')]
            values += [row['parameters'][name]['value'] for name in axes]
            result={(r.get('case','unspecified'),r['key'],r['entity'],r['unit']):r['value'] for r in row.get('results',[])
                    if row['valid'] and r['status']=='available'}
            values += [result.get(q,'') for q in quantities]
            writer.writerow(["'"+v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v for v in values])
        return stream.getvalue().encode('utf-8-sig')
    payloads={'samples.csv':table(items),'valid.csv':table([r for r in items if r['valid']]),
              'samples.jsonl':b''.join(encoded(r)+b'\n' for r in items)}
    counts={state:sum(r['status']==state for r in items) for state in sorted({r['status'] for r in items})}
    valid=sum(r['valid'] for r in items)
    completed=sum(r['status'] not in ('pending','running') for r in items)
    failures=sum(not r['valid'] and r['status'] not in ('pending','running') for r in items)
    reasons=[failure_reason(row) for row in items]
    reason_counts={reason:reasons.count(reason) for reason in sorted(set(reasons)-{None})}
    metadata={'schema_version':'cablesim.dataset/1','dataset_id':plan['id'],'generated_at':utc_now(),
        'content_sha256':content_digest,'plan_sha256':digest(plan),'source':plan['source'],
        'parameter_space':plan['parameter_space'],'sampling_engine':plan['sampling_engine'],
        'base_case':plan['base_case'],'base_case_sha256':plan['base_case_sha256'],
        'sampling_subset':plan.get('sampling_subset'),
        'sample_count':len(items),'valid_count':valid,'completed_count':completed,'failure_count':failures,
        'failure_rate':failures/completed if completed else None,'status_counts':counts,
        'failure_reason_counts':reason_counts,
        'failure_classification':'Supplementary categories; original status/code/message and raw evidence are retained in samples.jsonl',
        'method':plan['method'],'runtime_sha256':plan['runtime_sha256'],'execution':plan['execution'],
        'remote_accounting':[read(p) for p in sorted((directory/'submissions').glob('*/accounting.json'))],
        'quantity_columns':[{'column':'result.'+'.'.join(q),'condition':q[0],'key':q[1],'entity':q[2],'unit':q[3]} for q in quantities],
        'parameter_columns':[{'column':'parameter.'+a['name'],'unit':a['unit'],'label':a['label']} for a in plan['parameter_space']['axes']],
        'files':{name:{'sha256':sha256(data).hexdigest(),'size_bytes':len(data)} for name,data in payloads.items()},
        'authority':'reference_only','engineering_approval':False,
        'label_semantics':'FEM simulation quantities from the declared method; not measured truth or an IEC baseline',
        'validity':'valid.csv excludes pending, failed, interrupted and nonconverged samples; numerical convergence is not physical certification',
        'csv_text_policy':'Leading formula markers in text cells are prefixed with an apostrophe; JSONL retains original text.'}
    for name,data in payloads.items():(target/name).write_bytes(data)
    atomic(target/'metadata.json',metadata)
    atomic(directory/'latest-export.json',{'path':target.relative_to(directory).as_posix(),'sha256':digest(metadata)})
    return target


def transport_archive(directory, destination):
    """Only the frozen code, compute inputs and plan; no historical user documents."""
    directory=Path(directory);destination=Path(destination)
    with tarfile.open(destination,'w:gz') as archive:
        for name in ('plan.json','integrity.json','runtime','inputs'):
            source=directory/name
            paths=sorted(source.rglob('*')) if source.is_dir() else [source]
            for path in paths:
                if path.is_file() and '__pycache__' not in path.parts:
                    relative=path.relative_to(directory)
                    if relative.as_posix()=='runtime/.data/cablesim-solvers.json':continue
                    if path.is_symlink():raise ValueError('No symbolic links in a remote package')
                    archive.add(path,arcname=relative.as_posix(),recursive=False)
    return {'sha256':sha256(destination.read_bytes()).hexdigest(),'size_bytes':destination.stat().st_size}
