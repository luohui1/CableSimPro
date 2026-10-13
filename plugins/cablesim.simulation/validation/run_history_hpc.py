"""Freeze only this method's sealed numerical closure, submit to dg83, recover.

Other teams' unfinished plugin packages are not required by this calculation.
Every uploaded byte is pinned by runtime-manifest.json. The simulation package
and its shared numerical source closure are verified before staging. --resume
reuses the saved allocation identity rather than resubmitting on disconnect.
"""
import argparse
from hashlib import sha256
from pathlib import Path
import sys
import time
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from backend.kernel.batch_files import atomic,read,digest
from backend.kernel.batch_slurm import SlurmBackend,allocation_estimate
from backend.plugin_host.registry import Registry


def prepare(folder,wall_seconds):
    plugin=Registry(plugin_id='cablesim.simulation').get('cablesim.simulation');plugin.verify()
    directory=folder/str(uuid4());runtime=directory/'runtime';runtime.mkdir(parents=True)
    paths=[ROOT/'pytest.ini',ROOT/'plugin-tests/conftest.py',ROOT/'plugin-tests/test_three_core_thermal.py',
           ROOT/'plugins/cablesim.simulation/validation/verify_history.py',
           ROOT/'plugins/cablesim.iec60287/tests/test_three_core.py',ROOT/'plugins/cablesim.simulation/plugin.json']
    paths.extend(plugin.directory/row.path for row in plugin.manifest.files)
    # Shared source files are already checksummed in this plugin's sealed lock.
    paths.extend(ROOT/row['path'] for row in read(plugin.directory/'src/host-dependencies.json'))
    paths.extend((ROOT/'backend').rglob('*.py'))
    paths.extend((ROOT/'cablesim_sdk').rglob('*.py'))
    records={}
    for path in sorted(set(paths)):
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT):raise ValueError('非法冻结来源。')
        name=path.relative_to(ROOT);target=runtime/name;target.parent.mkdir(parents=True,exist_ok=True)
        content=path.read_bytes();target.write_bytes(content);records[name.as_posix()]=sha256(content).hexdigest()
    manifest={'schema_version':'cablesim.native-test-runtime/1','files':records}
    atomic(runtime/'runtime-manifest.json',manifest)
    Registry(runtime/'plugins',plugin_id='cablesim.simulation').get('cablesim.simulation').verify()
    plan={'schema_version':'cablesim.native-test-plan/1','id':directory.name,'samples':[{'case_id':'native-tests'}],
          'test_arguments':['plugins/cablesim.simulation/validation/verify_history.py','plugin-tests/test_three_core_thermal.py'],
          'reference_kind':'method_validation_parameters','runtime_sha256':digest(manifest),
          'execution':{'backend':'slurm','slurm_parallelism':1,'slurm_wall_seconds':wall_seconds,
                       'sample_timeout_s':wall_seconds-120,'slurm_memory_mb':6144}}
    atomic(directory/'plan.json',plan);atomic(directory/'integrity.json',{'plan_sha256':digest(plan)})
    return directory


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resume',type=Path);parser.add_argument('--wall-seconds',type=int,default=3600)
    args=parser.parse_args()
    if not 180<=args.wall_seconds<=3600:parser.error('方法验证墙钟上限须为 180–3600 秒。')
    folder=ROOT/'.data/simulation/history-method';folder.mkdir(parents=True,exist_ok=True)
    configuration=read(ROOT/'.data/hpc/config.json')
    # This method needs gmsh/scikit-fem only. Elmer build metadata is a
    # dictionary, not an executable path, and is not part of this allocation.
    configuration={k:v for k,v in configuration.items() if k not in ('elmer','elmer_build','getdp','comsol')}
    configuration={**configuration,'budget_core_hours':30.,'total_budget_core_hours':20000.}
    remote=SlurmBackend(configuration,ROOT/'.data/hpc/budget.sqlite')
    directory=args.resume.resolve() if args.resume else prepare(folder,args.wall_seconds)
    if not directory.is_relative_to(folder.resolve()):raise ValueError('恢复目录不属于本方法验证。')
    plan=read(directory/'plan.json')
    estimate=allocation_estimate(plan['execution'],1,configuration)
    spent=sum(read(p).get('actual_cpu_seconds',0.) for p in folder.glob('*/receipt.json'))/3600
    if spent+estimate['upper_core_hours']>30:raise ValueError('本轮已用加冻结上限超过 30 核时，停止。')
    atomic(directory/'budget.json',dict(round_limit_core_hours=30.,prior_core_hours=spent,estimate=estimate))
    print('Evidence: '+str(directory),flush=True)
    submission=remote.submit(directory,[0]);print('Slurm '+str(submission.get('job_id')),flush=True)
    if not submission.get('job_id'):raise RuntimeError(submission)
    while not remote.poll(directory,submission['token']).get('terminal'):time.sleep(15)
    result=remote.collect(directory,submission['token']);status=result['status']
    atomic(directory/'receipt.json',dict(job_id=status.get('job_id'),state=status.get('state'),
        wall_seconds=status.get('wall_seconds'),actual_cpu_seconds=result['accounting']['actual_cpu_seconds'],
        reference_kind='method_validation_parameters',engineering_approval=False,evidence=result['evidence']))
    print(read(directory/'receipt.json'),flush=True)
    return 0 if status.get('state')=='passed' else 1


if __name__=='__main__':raise SystemExit(main())
