"""Run/resume saved batch plans and export the same artifact format on both backends."""
import argparse
from pathlib import Path
import json
import sys
if __package__ in (None,''):sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.kernel.batch_files import read
from backend.kernel.batch_runtime import local_run,export_dataset
from backend.kernel.batch_slurm import SlurmBackend


def indices(value,count):
    if value is None:return list(range(count))
    parts=value.split(':')
    if len(parts)==2:
        return list(range(int(parts[0] or 0),int(parts[1] or count)))
    return [int(i) for i in value.split(',')]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['local','submit','poll','collect','export'])
    parser.add_argument('directory',type=Path)
    parser.add_argument('--indices')
    parser.add_argument('--indices-file',type=Path)
    parser.add_argument('--workers',type=int)
    parser.add_argument('--retry',action='store_true')
    parser.add_argument('--retry-id')
    parser.add_argument('--token')
    parser.add_argument('--profile',type=Path,default=Path('.data/hpc/config.json'))
    parser.add_argument('--ledger',type=Path,default=Path('.data/hpc/budget.sqlite'))
    args=parser.parse_args()
    if args.action=='export':result={'export':str(export_dataset(args.directory))}
    elif args.action=='local':
        plan=read(args.directory/'plan.json')
        selected=read(args.indices_file) if args.indices_file else indices(args.indices,len(plan['samples']))
        result=local_run(args.directory,selected,args.workers,args.retry)
    else:
        remote=SlurmBackend(args.profile,args.ledger)
        if args.action=='submit':
            plan=read(args.directory/'plan.json')
            result=remote.submit(args.directory,indices(args.indices,len(plan['samples'])),args.retry,args.retry_id)
        else:
            if not args.token:parser.error('--token is required for an existing submission')
            result=getattr(remote,args.action)(args.directory,args.token)
    print(json.dumps(result,ensure_ascii=False,allow_nan=False))


if __name__=='__main__':main()
