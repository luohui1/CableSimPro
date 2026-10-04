"""Run B01/GetDP/Elmer with identical frozen inputs locally and on Slurm.

Profiles and the CPU-hour ledger remain local administrator files. This driver
uploads only the batch runtime and numeric cases, never reference documents.
"""
import argparse
from pathlib import Path
import sys,time
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT))
from backend.kernel.batch_files import atomic,digest,read
from backend.kernel.batch_runtime import create_plan,local_run,export_dataset
from backend.kernel.batch_slurm import SlurmBackend
from backend.plugin_host.registry import Registry


def plans(output):
    index=output/'plans.json'
    if index.exists():return read(index)
    plugin=Registry(ROOT/'plugins',plugin_id='cablesim.simulation').get('cablesim.simulation')
    manifest=plugin.manifest.model_dump(mode='json',by_alias=True);result=[]
    for name,capability,sizes,pointer in [
        ('insulated-wire','insulated-wire',[.3,.15,.075],'/parameters/mesh_size_m'),
        ('eddy-induced','getdp-eddy',[.001,.0005,.00025],'/parameters/mesh/size_m'),
        ('heat-step-cycle','elmer-heat',[.002,.001,.0005],'/parameters/mesh/size_m')]:
        fixture=read(ROOT/f'plugins/cablesim.simulation/src/cases/{name}.json')
        case={'case_id':name,'input':fixture['input'],'parameters':fixture.get('parameters',{'mesh_size_m':sizes[0]})}
        space={'sampling':'grid','sample_count':3,'seed':0,'source':'Public/analytic cross-platform regression, three declared meshes',
            'axes':[{'name':'mesh','label':'网格','unit':'1','source':fixture.get('scope',fixture.get('reference',{}).get('title',name)),
                     'choices':[{'label':str(h)+' m','changes':{pointer:h,**({'/parameters/mesh/far_size_m':h} if name=='heat-step-cycle' else {})}} for h in sizes]}]}
        method={'plugin_id':plugin.manifest.id,'capability':capability,'version':plugin.manifest.version,'release_digest':digest(manifest)}
        identifier=str(uuid4());directory=output/name/identifier
        create_plan(directory,batch_id=identifier,base_case=case,method=method,
            source={'description':'Identical public/analytic verification case; no controlled full text',
                    'reference':fixture.get('citation',fixture.get('reference'))},space=space,
            execution={'workers':1,'sample_timeout_s':600,'slurm_wall_seconds':660,'slurm_parallelism':1})
        result.append({'name':name,'directory':str(directory)})
    atomic(index,result);return result


def main():
    parser=argparse.ArgumentParser();parser.add_argument('backend',choices=['local','slurm']);args=parser.parse_args()
    output=ROOT/'.data/simulation/hpc-verification';output.mkdir(parents=True,exist_ok=True)
    profile=read(ROOT/'.data/hpc/config.json');profile['maximum_pending_tasks']=1
    remote=SlurmBackend(profile,ROOT/'.data/hpc/budget.sqlite')
    for item in plans(output):
        directory=Path(item['directory'])
        if args.backend=='local':
            local_run(directory,workers=1);export_dataset(directory)
        else:
            submission=remote.submit(directory,range(3))
            if not submission.get('job_id'):raise RuntimeError(submission)
            token=submission['token']
            print(item['name'],submission['job_id'],flush=True)
            while True:
                accounting=remote.poll(directory,token)
                if accounting.get('terminal'):break
                time.sleep(20)
            # Collection is deliberately separate: local replicas must run first.
            atomic(directory/'remote-ready.json',{'token':token,'accounting':accounting})
            print(item['name'],{k:accounting[k] for k in ('job_id','terminal','actual_cpu_seconds')},flush=True)


if __name__=='__main__':main()
