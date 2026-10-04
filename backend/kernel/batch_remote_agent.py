"""Small standard-library Slurm endpoint, installed through the administrator SSH profile."""
import argparse
from contextlib import contextmanager
from datetime import datetime,timezone
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tarfile
from uuid import UUID,uuid4


def now():return datetime.now(timezone.utc).isoformat()
def read(path):return json.loads(Path(path).read_text('utf-8'))
def atomic(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.'+uuid4().hex+'.part')
    with temporary.open('w',encoding='utf-8') as stream:
        json.dump(value,stream,ensure_ascii=False,sort_keys=True,allow_nan=False);stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,path)


@contextmanager
def lock(path):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('a+b') as stream:
        fcntl.flock(stream,fcntl.LOCK_EX)
        yield


def command(arguments):
    result=subprocess.run(arguments,capture_output=True,text=True,timeout=45)
    if result.returncode:raise RuntimeError(result.stderr[-3000:] or result.stdout[-3000:])
    return result.stdout


def validate_root(value):
    path=Path(value).resolve()
    if not path.is_relative_to(Path.home()/'cablesim/jobs') or str(UUID(path.name))!=path.name:
        raise ValueError('Batch directory must be a UUID under ~/cablesim/jobs')
    return path


def unpack(root,archive_path,expected):
    archive_path=Path(archive_path)
    if sha256(archive_path.read_bytes()).hexdigest()!=expected:raise ValueError('ARCHIVE_DIGEST_MISMATCH')
    with lock(root/'stage.lock'):
        marker=root/'staged.json'
        if marker.exists():
            value=read(marker)
            if value['archive_sha256']!=expected:raise ValueError('Immutable staged batch has different source')
            return value
        with tarfile.open(archive_path,'r:gz') as archive:
            members=archive.getmembers()
            for item in members:
                p=Path(item.name)
                allowed=(item.name in ('plan.json','integrity.json') or
                    item.name.startswith(('runtime/backend/','runtime/plugins/','runtime/plugin-tests/','runtime/tests/','inputs/')) or
                    item.name in ('runtime/runtime-manifest.json','runtime/pytest.ini'))
                if not allowed or p.is_absolute() or '..' in p.parts or not item.isfile() or item.size>100*1024*1024:
                    raise ValueError('UNSAFE_ARCHIVE_MEMBER: '+item.name)
            for item in members:
                destination=root/item.name;destination.parent.mkdir(parents=True,exist_ok=True)
                with archive.extractfile(item) as source,destination.open('wb') as target:
                    import shutil
                    shutil.copyfileobj(source,target)
        value={'archive_sha256':expected,'staged_at':now()};atomic(marker,value);return value


def discover_job(name,created):
    # Query both live and historical allocation records after an interrupted SSH reply.
    live=command(['squeue','--noheader','--name',name,'--format','%F'])
    ids={line.strip() for line in live.splitlines() if line.strip().isdigit()}
    history=command(['sacct','-X','-n','-P','--starttime',created[:19].replace('T','T'),
                     '--name',name,'--format','JobID,JobName%80'])
    for line in history.splitlines():
        fields=line.split('|')
        if len(fields)>=2 and fields[1]==name:
            match=re.match(r'^(\d+)',fields[0])
            if match:ids.add(match.group(1))
    if len(ids)>1:raise RuntimeError('SUBMISSION_AMBIGUOUS: multiple allocation IDs for one submission token')
    return next(iter(ids),None)


def submit(root,request_path):
    request=read(request_path);token=str(UUID(request['token']))
    folder=root/'submissions'/token;folder.mkdir(parents=True,exist_ok=True)
    name='csp-'+UUID(token).hex[:24]
    with lock(folder/'submit.lock'):
        record=folder/'submission.json'
        if record.exists():
            saved=read(record)
            if saved['request']!=request:raise ValueError('SUBMISSION_TOKEN_CONFLICT')
            if saved.get('job_id') or saved['state']=='rejected':return saved
            found=discover_job(name,saved['created'])
            if found:
                saved.update(job_id=found,state='submitted');atomic(record,saved)
            else:
                saved.update(state='submission_unknown',message='Submission intent exists; accounting has not confirmed an allocation. No resubmission.')
            return saved
        plan=read(root/'plan.json');indices=request['indices'];resources=plan['execution']
        if not indices or len(indices)!=len(set(indices)) or any(type(i)is not int or not 0<=i<len(plan['samples']) for i in indices):
            raise ValueError('Invalid array indices')
        groups=request.get('task_groups',[[i] for i in indices])
        if not groups or any(not group for group in groups) or sorted(i for group in groups for i in group)!=sorted(indices):
            raise ValueError('Invalid task-group partition')
        task_wall=max(map(len,groups))*resources['slurm_wall_seconds']
        accounting_cpus=max(1,-(-resources['slurm_memory_mb']//6500))
        if len(groups)*task_wall*accounting_cpus>2000*3600:raise ValueError('SINGLE_BUDGET_EXCEEDED')
        profile=request['profile'];python=profile['python']
        for key in ('python','getdp','elmer'):
            if not re.fullmatch(r'/[A-Za-z0-9_./-]+',profile[key]) or '..' in Path(profile[key]).parts:
                raise ValueError('Invalid administrator executable path')
        modules=profile.get('modules',[])
        if any(not re.fullmatch(r'[A-Za-z0-9_.+/-]+',m) for m in modules):raise ValueError('Invalid module')
        if profile['partition']!='dg83':raise ValueError('Unapproved partition')
        if profile.get('comsol') and profile['comsol']!='/data/app/comsol/62/multiphysics/bin/comsol':raise ValueError('Invalid COMSOL installation')
        config={k:profile[k] for k in ('getdp','elmer','elmer_build','comsol','library_paths') if k in profile}
        config['comsol_lock']=str(Path.home()/'cablesim/comsol.lock')
        atomic(root/'runtime/.data/cablesim-solvers.json',config)
        atomic(folder/'indices.json',indices)
        atomic(folder/'groups.json',groups)
        agent_bytes=Path(__file__).read_bytes()
        (folder/'agent.py').write_bytes(agent_bytes)
        script='#!/bin/bash\nset -euo pipefail\n'
        if modules:script+='module load '+' '.join(shlex.quote(m) for m in modules)+'\n'
        script+='export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 PYTHONDONTWRITEBYTECODE=1\n'
        arguments=[python,'-I',str(folder/'agent.py'),'run-group',str(root),token]
        script+='exec '+' '.join(shlex.quote(a) for a in arguments)+'\n'
        (folder/'worker.sh').write_text(script,encoding='utf-8')
        saved={'token':token,'state':'submitting','created':now(),'request':request,'job_id':None,'job_name':name,
               'agent_sha256':sha256(agent_bytes).hexdigest(),'task_count':len(groups),'task_wall_seconds':task_wall}
        atomic(record,saved)
        h,rest=divmod(task_wall,3600);m,s=divmod(rest,60)
        args=['sbatch','--parsable','--job-name',name,'--comment',token,'--partition','dg83',
              '--nodes','1','--ntasks','1','--cpus-per-task','1','--no-requeue',
              '--mem',str(resources['slurm_memory_mb'])+'M','--time',f'{h:02d}:{m:02d}:{s:02d}',
              '--array',f'0-{len(groups)-1}%{min(len(groups),resources["slurm_parallelism"])}',
              '--output',str(folder/'slurm-%A_%a.log'),str(folder/'worker.sh')]
        result=subprocess.run(args,capture_output=True,text=True,timeout=45)
        if result.returncode:
            saved.update(state='rejected',message=result.stderr[-3000:])
        else:
            job=result.stdout.strip().split(';')[0]
            if not job.isdigit():raise RuntimeError('SUBMISSION_UNKNOWN: sbatch returned an unrecognized identifier')
            saved.update(state='submitted',job_id=job)
        atomic(record,saved);return saved


def accounting(root,token):
    saved=read(root/'submissions'/str(UUID(token))/'submission.json')
    job=saved.get('job_id')
    if not job:return saved
    fields=['JobID','State','AllocCPUS','ElapsedRaw','CPUTimeRAW','MaxRSS','NodeList','ExitCode']
    raw=command(['sacct','--array','-n','-P','-j',job,'--format',','.join(fields)])
    records=[]
    for line in raw.splitlines():
        values=line.split('|')
        if len(values)>=len(fields):records.append(dict(zip(fields,values)))
    # Only array allocation rows contribute CPUTime; .batch/.extern are step evidence.
    allocations=[r for r in records if re.fullmatch(re.escape(job)+r'_\d+',r['JobID'])]
    terminal_states={'COMPLETED','FAILED','CANCELLED','TIMEOUT','OUT_OF_MEMORY','NODE_FAIL','PREEMPTED','BOOT_FAIL','DEADLINE'}
    expected=saved.get('task_count',len(saved['request']['indices']))
    terminal=len(allocations)==expected and all(r['State'].split()[0].rstrip('+') in terminal_states for r in allocations)
    actual=sum(int(r['CPUTimeRAW'] or 0) for r in allocations)
    value={**saved,'accounting':records,'actual_cpu_seconds':actual,'terminal':terminal,'accounted_samples':len(allocations),'updated':now()}
    atomic(root/'submissions'/token/'accounting.json',value)
    return value


def run_group(root,token):
    import signal
    folder=root/'submissions'/str(UUID(token));saved=read(folder/'submission.json')
    group=read(folder/'groups.json')[int(os.environ['SLURM_ARRAY_TASK_ID'])]
    plan=read(root/'plan.json');failures=[]
    for index in group:
        if plan.get('schema_version')=='cablesim.native-test-plan/1':
            arguments=[saved['request']['profile']['python'],'-I',str(root/'runtime/backend/kernel/hpc_test_worker.py'),str(root)]
        else:
            arguments=[saved['request']['profile']['python'],'-I',str(root/'runtime/backend/kernel/batch_worker.py'),
                       str(root),'--backend','slurm','--index',str(index)]
        if saved['request'].get('retry'):arguments.append('--retry')
        with subprocess.Popen(arguments,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True) as process:
            try:
                out,error=process.communicate(timeout=plan['execution']['sample_timeout_s']+90)
                if process.returncode:failures.append({'index':index,'code':'WORKER_CRASHED','message':error.decode('utf-8','replace')[-4000:]})
            except subprocess.TimeoutExpired:
                import psutil
                parent=psutil.Process(process.pid);children=parent.children(recursive=True)
                for child in reversed(children):
                    try:child.kill()
                    except psutil.NoSuchProcess:pass
                try:os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                process.communicate()
                failures.append({'index':index,'code':'WORKER_TIMEOUT','message':'Sample worker exceeded its saved timeout; no result synthesized.'})
    result={'indices':group,'failures':failures,'job_id':os.environ.get('SLURM_JOB_ID'),'updated':now()}
    atomic(folder/('group-'+os.environ['SLURM_ARRAY_TASK_ID']+'.json'),result)
    return result


def collect(root,destination):
    with tarfile.open(destination,'w:gz') as archive:
        for name in ('samples','raw','attempts','submissions','worker-errors'):
            for path in sorted((root/name).rglob('*')):
                if path.is_file() and path.suffix not in ('.lock','.part') and '__pycache__' not in path.parts:
                    archive.add(path,arcname=path.relative_to(root).as_posix(),recursive=False)
    path=Path(destination)
    return {'path':str(path),'sha256':sha256(path.read_bytes()).hexdigest(),'size_bytes':path.stat().st_size}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['stage','submit','accounting','collect','run-group'])
    parser.add_argument('root');parser.add_argument('value');parser.add_argument('--sha256')
    args=parser.parse_args();root=validate_root(args.root);root.mkdir(parents=True,exist_ok=True)
    try:
        if args.action=='stage':result=unpack(root,args.value,args.sha256)
        elif args.action=='submit':result=submit(root,args.value)
        elif args.action=='accounting':result=accounting(root,args.value)
        elif args.action=='run-group':result=run_group(root,args.value)
        else:result=collect(root,args.value)
        print(json.dumps({'ok':True,'result':result},ensure_ascii=False))
        if args.action=='run-group' and result.get('failures'):raise SystemExit(1)
    except Exception as exc:
        print(json.dumps({'ok':False,'code':type(exc).__name__,'message':str(exc)},ensure_ascii=False));raise SystemExit(1)


if __name__=='__main__':main()
