"""Fresh 100-case Slurm throughput from the saved 2000-case design."""
from pathlib import Path
import argparse,sys,time,json,shutil
ROOT=Path(__file__).resolve().parents[3];sys.path[:0]=[str(ROOT),str(Path(__file__).parent)]
from benchmark_batches import subset
from backend.kernel.batch_files import read,atomic
from backend.kernel.batch_runtime import rows,export_dataset
from backend.kernel.batch_slurm import SlurmBackend


def main():
    parser=argparse.ArgumentParser();parser.add_argument('parent',type=Path);args=parser.parse_args()
    output=ROOT/'.data/simulation/performance/throughput';index=output/'slurm-plan.json'
    if index.exists():directory=Path(read(index)['directory'])
    else:
        directory=subset(args.parent.resolve(),8,output/'slurm')
        atomic(index,{'directory':str(directory)})
    remote=SlurmBackend(ROOT/'.data/hpc/config.json',ROOT/'.data/hpc/budget.sqlite')
    started=time.perf_counter();submission=remote.submit(directory,range(100))
    if not submission.get('job_id'):raise RuntimeError(submission)
    print(json.dumps({k:submission[k] for k in ('job_id','token','task_count')}),flush=True)
    while True:
        accounting=remote.poll(directory,submission['token'])
        if accounting.get('terminal'):break
        time.sleep(20)
    remote.collect(directory,submission['token']);export_dataset(directory)
    values=rows(directory);allocation=[r for r in accounting['accounting'] if '.' not in r['JobID'] and '_' in r['JobID']]
    elapsed=max(int(r['ElapsedRaw']) for r in allocation)
    record={'backend':'slurm','workers':submission['task_count'],'sample_count':100,
        'wall_seconds':elapsed,'end_to_end_seconds':time.perf_counter()-started,
        'wall_definition':'Maximum Slurm array-allocation ElapsedRaw; includes worker startup and grouped serial execution, excludes staging/queue/collection',
        'valid':sum(r['valid'] for r in values),'statuses':{s:sum(r['status']==s for r in values) for s in {r['status'] for r in values}},
        'samples_per_second':100/elapsed,'valid_samples_per_second':sum(r['valid'] for r in values)/elapsed,
        'peak_task_rss_bytes':max(r.get('peak_rss_bytes') or 0 for r in values),
        'actual_cpu_seconds':accounting['actual_cpu_seconds'],'job_id':submission['job_id'],'directory':str(directory)}
    atomic(output/'slurm.json',record);print(json.dumps(record),flush=True)


if __name__=='__main__':main()
