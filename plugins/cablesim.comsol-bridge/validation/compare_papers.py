"""Serial optional commercial reference; source fixtures remain owned by simulation."""
from copy import deepcopy
from dataclasses import asdict
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from backend.plugin_host import Executor


def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False,indent=2),'utf-8')


def main():
    jobs=ROOT/'.tmp/comsol-paper-jobs';jobs.mkdir(parents=True,exist_ok=True)
    executor=Executor(jobs_root=jobs)
    output=ROOT/'.data/simulation/comsol-comparison'
    for name in ['eddy-twin','eddy-induced','eddy-lunca']:
        fixture=json.loads((ROOT/f'plugins/cablesim.simulation/src/cases/{name}.json').read_text('utf-8'))
        levels=[]
        meshes=[(.001,None),(.0005,None)]+([(.0005,.2)] if name=='eddy-lunca' else [])
        for h,far in meshes:
            parameters=deepcopy(fixture['parameters'])
            parameters['mesh']['size_m']=h
            if far is not None:parameters['mesh']['far_size_m']=far
            parameters['reproduction']={k:fixture[k] for k in ['citation','scope','targets','frozen_inputs']}
            case={'case_id':'reference','input':fixture['input'],'parameters':parameters}
            run=executor.run('cablesim.comsol-bridge','magnetic-reference',[case])
            save(output/name/(f'probe-{far}.json' if far is not None else f'native-{h}.json'),asdict(run))
            if run.cases[0].status!='succeeded':
                raise RuntimeError(str(run.cases[0].error))
            report=run.cases[0].artifacts['x-cablesim.reproduction-report']
            levels.append({**report,'mesh_size_m':h,'far_size_m':parameters['mesh']['far_size_m'],'run_id':run.run_id})
            print(json.dumps({'case':name,'h':h,'rows':[(r['id'],r['calculated'],r['status']) for r in report['rows']]},ensure_ascii=False),flush=True)
            save(output/name/'report.json',{'schema':'cablesim.reproduction-report/1','kind':'suite','reference':fixture['citation'],'mesh_sequence':levels,'engineering_approval':False})


if __name__=='__main__':main()
