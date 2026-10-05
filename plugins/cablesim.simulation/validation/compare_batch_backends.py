"""Compare actual local and Slurm replicas with matching saved case identities."""
import argparse,gzip,json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT))
from backend.kernel.batch_files import read,atomic
from backend.kernel.batch_worker import verify_row


def compare(directory,token,temperature_tolerance=1e-4):
    directory=Path(directory);replica=directory/'replicas'/token;records=[]
    for path in sorted((replica/'samples').glob('*.json')):
        original=directory/'samples'/path.name
        if not original.exists():continue
        a=verify_row(read(original),directory);b=verify_row(read(path),replica)
        if a['backend']==b['backend']:continue
        if any(a[k]!=b[k] for k in ('case_sha256','method','runtime_sha256')):raise ValueError('Different input or method identity')
        def payload(base,row):
            return json.loads(gzip.decompress((base/row['raw_result']).read_bytes()))['cases'][0]['artifacts']['x-cablesim.dataset-sample']
        left=payload(directory,a);right=payload(replica,b)
        temperatures=[]
        for condition in ('operating','rating'):
            x={r['entity']:r for r in left[condition]['cables']};y={r['entity']:r for r in right[condition]['cables']}
            if set(x)!=set(y):raise ValueError('Different cable identities')
            temperatures.extend(abs(x[k]['conductor_max_temperature_k']-y[k]['conductor_max_temperature_k']) for k in x)
        delta=abs(left['rating']['rating']['ampacity_a']-right['rating']['rating']['ampacity_a'])
        records.append({'sample_id':a['sample_id'],'local_status':a['status'],'slurm_status':b['status'],
            'maximum_temperature_difference_k':max(temperatures),'ampacity_difference_a':delta,
            'local_nodes':left['mesh']['nodes'],'slurm_nodes':right['mesh']['nodes'],
            'same_mesh_sha256':left['mesh']['mesh_sha256']==right['mesh']['mesh_sha256'],
            'case_sha256':a['case_sha256'],'local_run_id':a['run_id'],'slurm_run_id':b['run_id']})
    result={'schema_version':'cablesim.backend-comparison/1','samples':records,'sample_count':len(records),
        'maximum_temperature_difference_k':max((r['maximum_temperature_difference_k'] for r in records),default=None),
        'maximum_ampacity_difference_a':max((r['ampacity_difference_a'] for r in records),default=None),
        'status_agreement':all(r['local_status']==r['slurm_status'] for r in records),
        'tolerance':{'temperature_absolute_k':temperature_tolerance,'ampacity_absolute_a':.05,
                     'basis':'10 times the declared 1e-5 K iterative tolerance; 1000 times smaller than the 0.1 K mesh gate; current equals declared bisection tolerance'},'engineering_approval':False}
    result['matched']=bool(records) and result['status_agreement'] and result['maximum_temperature_difference_k']<=temperature_tolerance and result['maximum_ampacity_difference_a']<=.05
    atomic(directory/'backend-comparison.json',result)
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path);parser.add_argument('token');args=parser.parse_args()
    result=compare(args.directory,args.token);print(json.dumps({k:v for k,v in result.items() if k!='samples'},ensure_ascii=False))
