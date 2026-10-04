"""GetDP reconstruction of the tutorial04 homogenized winding branch."""
from pathlib import Path
from dataclasses import asdict
from copy import deepcopy
import json
import sys
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT),str(ROOT/'plugins/cablesim.comsol-bridge/tests')]
from backend.plugin_host import Executor
from tutorial_problem import inductive


def main():
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--branch',choices=['milliken','series','plain'],default='milliken');args=parser.parse_args()
    out=ROOT/'.data/simulation/submarine-inductive';out.mkdir(parents=True,exist_ok=True)
    jobs=ROOT/'.tmp/simulation-seventh-inductive';jobs.mkdir(parents=True,exist_ok=True)
    records=[]
    for h,segments in [(.002,64),(.0015,128),(.0015,160)]:
        problem,controls=inductive(args.branch!='plain',h);controls['minimum_circle_segments']=segments
        if args.branch=='milliken':
            for r in problem['geometry']:
                if r['uid'].endswith('/conductor'):r['material']['conductivity_s_m']=0.
            for e in problem['excitations']:
                if e['regions'][0].endswith('/conductor'):e['kind']='impressed_current_rms_a'
            problem['assumptions'][-2]='Tutorial04 N=1 homogenized winding: uniform impressed RMS current, no strand-scale eddy current; conductor heat 3*I_rms^2/(Scup*Acon) computed independently from supplied wire data.'
        request={'case_id':args.branch,'input':problem,'parameters':{'mesh':controls}}
        key=('' if args.branch=='milliken' else args.branch+'-')+f'{h:g}-{segments}';input_path=out/(key+'-input.json')
        same_input=input_path.exists() and json.loads(input_path.read_text('utf-8'))==request
        input_path.write_text(json.dumps(request,indent=2),'utf-8')
        print(json.dumps({'start':key}),flush=True)
        saved=out/(key+'-run.json')
        if same_input and saved.exists() and json.loads(saved.read_text('utf-8'))['cases'][0]['status']=='succeeded':
            run=json.loads(saved.read_text('utf-8'))
        else:run=asdict(Executor(jobs_root=jobs).run('cablesim.simulation','getdp-eddy',[request]))
        (out/(key+'-run.json')).write_text(json.dumps(run,separators=(',',':')),'utf-8')
        case=run['cases'][0]
        if case['status']!='succeeded':raise RuntimeError(case['error'])
        bundle=case['artifacts']['x-cablesim.simulation-bundle'];obs=bundle['observations']
        totals={kind:sum(r['value'] for r in obs if r['quantity'] in ('joule_loss_w_m','magnetic_loss_w_m') and (r['entity'].endswith('/screen') if kind=='screen' else r['entity'].startswith('armor-') if kind=='armor' else r['entity']=='fiber-steel')) for kind in ('screen','armor','fiber')}
        totals['conductor']=3*655**2/(59.6e6*500e-6) if args.branch=='milliken' else sum(r['value'] for r in obs if r['quantity']=='joule_loss_w_m' and r['entity'].endswith('/conductor'))
        totals['mean_port_resistance']=((totals['conductor'] if args.branch=='milliken' else 0)+sum(r['value'] for r in obs if r['quantity']=='total_loss_w_m'))/(3*655**2)
        record={'mesh_size_m':h,'circle_segments':segments,'nodes':len(bundle['mesh']['points']),'totals_w_m':totals,
                'winding_heat_input':{'current_rms_a':655.,'wire_conductivity_s_m':59.6e6,'wire_area_m2':500e-6,'turns':1,'source':'COMSOL tutorial04 p37 homogenized multiturn settings'} if args.branch=='milliken' else None,
                'run':{k:run[k] for k in ('run_id','plugin_id','plugin_version','method_version','request_sha256')},
                'artifact_sha256':case['artifact_digests']['x-cablesim.simulation-bundle']}
        records.append(record);(out/(key+'-summary.json')).write_text(json.dumps(record,indent=2),'utf-8')
        print(json.dumps(record),flush=True)
    (out/('open-'+args.branch+'.json')).write_text(json.dumps({'mesh_sequence':records,'engineering_approval':False},indent=2),'utf-8')


if __name__=='__main__':main()
