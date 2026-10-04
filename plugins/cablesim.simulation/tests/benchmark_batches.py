"""Real 100-sample throughput at 1/4/8/16 local processes from one frozen design."""
from copy import deepcopy
from pathlib import Path
from statistics import median
import argparse,json,shutil,sys
from uuid import uuid4
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT))
from backend.kernel.batch_runtime import local_run,rows
from backend.kernel.batch_files import read,atomic,digest
from backend.kernel.batch_worker import MemoryProbe


def subset(parent,workers,out):
    source=read(parent/'plan.json');plan=deepcopy(source);plan['id']=str(uuid4())
    plan['samples']=plan['samples'][:100];plan['execution']['workers']=workers
    plan['sampling_subset']={'parent_dataset_id':source['id'],'parent_plan_sha256':digest(source),
                             'indices':list(range(100)),'parent_sample_count':len(source['samples'])}
    directory=out/f'local-{workers}'/plan['id'];directory.mkdir(parents=True)
    shutil.copytree(parent/'runtime',directory/'runtime',ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    (directory/'inputs').mkdir()
    for entry in plan['samples']:shutil.copyfile(parent/'inputs'/(entry['case_id']+'.json'),directory/'inputs'/(entry['case_id']+'.json'))
    atomic(directory/'plan.json',plan);atomic(directory/'integrity.json',{'plan_sha256':digest(plan)})
    return directory


def main():
    parser=argparse.ArgumentParser();parser.add_argument('parent',type=Path)
    parser.add_argument('--workers',nargs='+',type=int,default=[1,4,8,16]);args=parser.parse_args()
    parent=args.parent.resolve();out=ROOT/'.data/simulation/performance/throughput';out.mkdir(parents=True,exist_ok=True)
    records=[]
    for workers in args.workers:
        directory=parent if workers==1 else subset(parent,workers,out)
        existing=[p for p in (directory/'samples').glob('*.json') if int(p.stem.split('-')[1])<100]
        if existing:raise RuntimeError('Benchmark samples already exist; use a new saved plan, never report cached retrieval as throughput.')
        probe=MemoryProbe();probe.thread.start()
        try:result=local_run(directory,range(100),workers=workers)
        finally:probe.stop.set();probe.thread.join(timeout=2)
        samples=rows(directory)[:100]
        record={'backend':'local','workers':workers,'sample_count':100,'wall_seconds':result['wall_seconds'],
            'samples_per_second':100/result['wall_seconds'],'valid':sum(r['valid'] for r in samples),
            'statuses':{s:sum(r['status']==s for r in samples) for s in sorted({r['status'] for r in samples})},
            'median_sample_seconds':median(r['wall_seconds'] for r in samples),'peak_rss_bytes':probe.peak,
            'memory_measurement':'20ms sampled sum of coordinator and all descendant RSS, including shared-page double counting',
            'directory':str(directory),'source_dataset_id':read(parent/'plan.json')['id']}
        atomic(out/f'local-{workers}.json',record);records.append(record);print(json.dumps(record,ensure_ascii=False),flush=True)
    atomic(out/'local.json',records)


if __name__=='__main__':main()
