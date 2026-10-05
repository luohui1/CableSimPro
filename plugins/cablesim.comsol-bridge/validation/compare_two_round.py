"""Native commercial field reference for Jablonski2019 Table1, three cases."""
from copy import deepcopy
from dataclasses import asdict
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT),str(ROOT/'plugins/cablesim.simulation/src'),str(ROOT/'plugins/cablesim.simulation/validation')]
from backend.plugin_host import Executor
from replay import replace_path


def main():
    fixture=json.loads((ROOT/'plugins/cablesim.simulation/src/cases/eddy-two-round.json').read_text('utf-8'))
    output=ROOT/'.data/simulation/comsol-comparison/eddy-two-round';output.mkdir(parents=True,exist_ok=True)
    jobs=ROOT/'.tmp/simulation-sixth-native/paper';jobs.mkdir(parents=True,exist_ok=True);executor=Executor(jobs_root=jobs)
    variants=[]
    for variant in fixture['variants']:
        value=deepcopy(fixture['input']);ref={k:deepcopy(fixture[k]) for k in ('citation','scope','targets','frozen_inputs')}
        for change in variant['input_changes']:replace_path(value,change['path'],change['value'])
        for change in variant['target_changes']:next(r for r in ref['targets'] if r['id']==change['id']).update({k:v for k,v in change.items() if k!='id'})
        sequence=[]
        for i,h in enumerate(fixture['mesh_sizes_m']):
            parameters=deepcopy(fixture['parameters']);parameters['mesh']['size_m']=h;parameters['reproduction']=ref
            # Native curved P2 elements have their own mesh generation. Keep
            # the same geometry/near/far sizes; record these explicit changes.
            for key in ('minimum_circle_segments','exterior_growth_start_m','exterior_growth_rate'):
                parameters['mesh'].pop(key,None)
            run=executor.run('cablesim.comsol-bridge','magnetic-reference',[{'case_id':variant['id']+'-'+str(i),'input':value,'parameters':parameters}]);case=run.cases[0]
            (output/(variant['id']+'-'+str(i)+'.json')).write_text(json.dumps(asdict(run),ensure_ascii=False,separators=(',',':'),allow_nan=False),'utf-8')
            if case.status!='succeeded':raise RuntimeError(case.error)
            report=case.artifacts['x-cablesim.reproduction-report'];report.update(mesh_size_m=h,run_id=run.run_id)
            sequence.append(report)
            print(json.dumps({'variant':variant['id'],'h':h,'status':report['status']}),flush=True)
        variants.append({'id':variant['id'],'mesh_sequence':sequence,'finest':sequence[-1]})
        (output/'report.json').write_text(json.dumps({'schema':'cablesim.reproduction-report/1','kind':'suite','reference':fixture['citation'],'variants':variants,'engineering_approval':False},ensure_ascii=False,indent=2),'utf-8')


if __name__=='__main__':main()
