"""Freeze code/numeric fixtures, submit native pytest to Slurm, collect accounting.

Default: complete plugin-tests. Pass --resume DIRECTORY to reconnect without a
new allocation, or --test PATH repeatedly to choose targeted regression files.
No standards, papers, SSH files, or existing simulation results are uploaded.
"""
import argparse
from hashlib import sha256
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import time
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from backend.kernel.batch_files import atomic,digest,read
from backend.kernel.batch_slurm import SlurmBackend


def prepare(tests,wall_seconds=14400,memory_mb=6144):
    identifier=str(uuid4());directory=ROOT/'.data/hpc/native-tests'/identifier
    staging=ROOT/'.tmp';staging.mkdir(exist_ok=True)
    with TemporaryDirectory(prefix='native-runtime-',dir=staging) as scratch:
        candidate=Path(scratch)
        prepare_runtime(candidate,identifier,tests,wall_seconds,memory_mb)
        directory.parent.mkdir(parents=True,exist_ok=True)
        if directory.exists():raise ValueError('Native evidence identity already exists')
        candidate.rename(directory)
    return directory


def prepare_runtime(directory,identifier,tests,wall_seconds,memory_mb):
    runtime=directory/'runtime';runtime.mkdir(parents=True)
    paths=[ROOT/'pytest.ini']
    # The datasheet scoring regression imports the checked-in evaluation module.
    paths.append(ROOT/'scripts/evaluate_datasheets.py')
    for folder in ('backend','cablesim_sdk','tests','plugin-tests'):
        paths.extend((ROOT/folder).rglob('*.py'))
    for folder in ('src','tests','validation'):
        for plugin in (ROOT/'plugins').glob('cablesim.*'):
            paths.extend(p for p in (plugin/folder).rglob('*') if p.is_file() and p.suffix in ('.py','.json','.geo','.pro','.sif'))
    paths.extend((ROOT/'plugins').glob('*/plugin.json'))
    for manifest in (ROOT/'plugins').glob('*/plugin.json'):
        paths.extend(manifest.parent/item['path'] for item in read(manifest).get('files',[]))
    paths.extend((ROOT/'plugins/releases').glob('*.json'))
    paths.append(ROOT/'plugins/registry.json')
    records={}
    for path in sorted(set(paths)):
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT):raise ValueError('Unsafe source')
        name=path.relative_to(ROOT);target=runtime/name;target.parent.mkdir(parents=True,exist_ok=True)
        content=path.read_bytes();target.write_bytes(content);records[name.as_posix()]=sha256(content).hexdigest()
    manifest={'schema_version':'cablesim.native-test-runtime/1','files':records}
    atomic(runtime/'runtime-manifest.json',manifest)
    from backend.plugin_host.registry import Registry
    for plugin_manifest in (runtime/'plugins').glob('*/plugin.json'):
        Registry(runtime/'plugins',plugin_id=plugin_manifest.parent.name).get(plugin_manifest.parent.name).verify()
    plan={'schema_version':'cablesim.native-test-plan/1','id':identifier,'samples':[{'case_id':'native-tests'}],
          'test_arguments':tests or ['plugin-tests'],'runtime_sha256':digest(manifest),
          'execution':{'backend':'slurm','slurm_parallelism':1,'slurm_wall_seconds':wall_seconds,
                       'sample_timeout_s':wall_seconds-120,'slurm_memory_mb':memory_mb}}
    atomic(directory/'plan.json',plan);atomic(directory/'integrity.json',{'plan_sha256':digest(plan)})
    return directory


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resume',type=Path);parser.add_argument('--test',action='append',default=[])
    parser.add_argument('--profile',type=Path,default=ROOT/'.data/hpc/config.json')
    parser.add_argument('--wall-seconds',type=int,default=14400)
    parser.add_argument('--memory-mb',type=int,default=6144)
    args=parser.parse_args()
    if not 180<=args.wall_seconds<=14400 or not 512<=args.memory_mb<=65536:
        parser.error('Explicit native resource limits must be 180..14400 s and 512..65536 MiB')
    for value in args.test:
        path=value.split('::')[0]
        if not path.startswith(('plugin-tests/','tests/','plugins/')) or '..' in Path(path).parts or not (ROOT/path).is_file():
            parser.error('--test must name an existing repository test file')
    directory=args.resume.resolve() if args.resume else prepare(args.test,args.wall_seconds,args.memory_mb)
    remote=SlurmBackend(args.profile,ROOT/'.data/hpc/budget.sqlite')
    print('Evidence: '+str(directory),flush=True)
    submission=remote.submit(directory,[0]);print('Slurm '+str(submission.get('job_id')),flush=True)
    if not submission.get('job_id'):raise RuntimeError(submission)
    while not remote.poll(directory,submission['token']).get('terminal'):time.sleep(15)
    result=remote.collect(directory,submission['token'])
    print({k:result['status'].get(k) for k in ('state','returncode','wall_seconds','job_id')},flush=True)
    print('Actual CPU seconds: '+str(result['accounting']['actual_cpu_seconds']),flush=True)
    return 0 if result['status'].get('state')=='passed' else 1


if __name__=='__main__':raise SystemExit(main())
