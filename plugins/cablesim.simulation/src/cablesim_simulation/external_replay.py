"""Replay frozen external-solver cases through the host and emit common reports."""
from copy import deepcopy
from dataclasses import asdict
import argparse
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.plugin_host import Executor
from cablesim_simulation.report import digest
from cablesim_simulation.replay import replace_path


def replay(fixture,output,executor,solver):
    output.mkdir(parents=True,exist_ok=True)
    reference={k:fixture.get(k,[]) for k in ('targets','frozen_inputs','missing_inputs','assumptions')}
    reference.update(citation=fixture['citation'],scope=fixture['scope'])
    variants=[]
    for variant in fixture.get('variants',[{'id':'default','input_changes':[],'target_changes':[]}]):
        value=deepcopy(fixture['input']);ref=deepcopy(reference)
        for change in variant['input_changes']:
            replace_path(value,change['path'],change['value'])
        for change in variant['target_changes']:
            row=next(t for t in ref['targets'] if t['id']==change['id'])
            row.update({k:v for k,v in change.items() if k!='id'})
        levels=[]
        for i,h in enumerate(fixture['mesh_sizes_m']):
            p=deepcopy(fixture['parameters'])
            if 'mesh' in p:
                p['mesh']['size_m']=h
            else:
                base=p['controls']['mesh_size_m']
                p['controls']['mesh_size_m']=h;p['controls']['far_mesh_size_m']*=h/base
            p['reproduction']={**ref,'assumptions':value.get('assumptions',[])}
            case={'case_id':variant['id']+'-'+str(i),'input':value,'parameters':p}
            run=executor.run('cablesim.simulation','getdp-eddy' if solver=='getdp' else 'elmer-heat',[case])
            item=run.cases[0]
            name=case['case_id']+'.json'
            (output/name).write_text(json.dumps(asdict(run),ensure_ascii=False,allow_nan=False,separators=(',',':')),'utf-8')
            if item.status!='succeeded':
                levels.append({'mesh_size_m':h,'status':'solver_failed','error':item.error,'run_file':name})
            else:
                report=item.artifacts['x-cablesim.reproduction-report']
                report.update(mesh_size_m=h,run_file=name,artifact_sha256=item.artifact_digests,
                              run={k:getattr(run,k) for k in ('run_id','plugin_id','plugin_version','method_version','request_sha256')})
                levels.append(report)
            print(json.dumps({'variant':variant['id'],'mesh_size_m':h,'status':levels[-1]['status'],
                              'rows':[(r['id'],r['calculated']) for r in levels[-1].get('rows',[])]},ensure_ascii=False),flush=True)
        changes=[]
        for a,b in zip(levels,levels[1:]):
            ar={r['id']:r['calculated'] for r in a.get('rows',[])}
            changes.append({r['id']:r['calculated']-ar[r['id']] for r in b.get('rows',[]) if r['calculated'] is not None and ar.get(r['id']) is not None})
        variants.append({'id':variant['id'],'finest':levels[-1],'mesh_sequence':levels,'consecutive_changes':changes,'mesh_independence_certified':False})
    status='solver_failed' if any(l['status']=='solver_failed' for v in variants for l in v['mesh_sequence']) else 'matched' if all(v['finest']['status']=='matched' for v in variants) else 'comparison_requires_review'
    report={'schema':'cablesim.reproduction-report/1','kind':'suite','reference':fixture['citation'],'scope':fixture['scope'],
            'fixture_sha256':digest(fixture),'frozen_inputs':fixture.get('frozen_inputs',[]),'variants':variants,'status':status,'engineering_approval':False}
    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,allow_nan=False,indent=2),'utf-8')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fixture',type=Path)
    parser.add_argument('--solver',choices=['getdp','elmer'],required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    fixture=json.loads(args.fixture.read_text('utf-8'))
    jobs=ROOT/'.tmp/simulation-external-jobs';jobs.mkdir(parents=True,exist_ok=True)
    result=replay(fixture,args.output,Executor(jobs_root=jobs),args.solver)
    print(json.dumps({'status':result['status'],'report':str(args.output/'report.json')},ensure_ascii=False))
    if not any(jobs.iterdir()):jobs.rmdir()


if __name__=='__main__':main()
