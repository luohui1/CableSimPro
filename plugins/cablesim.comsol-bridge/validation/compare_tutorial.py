"""Rebuild documented tutorial04 magnetic submodels with either solver."""
from pathlib import Path
import argparse,json,sys
ROOT=Path(__file__).resolve().parents[3]
for directory in [ROOT,ROOT/'plugins/cablesim.simulation/src',ROOT/'plugins/cablesim.comsol-bridge/src']:
    sys.path.insert(0,str(directory))
from tutorial_problem import inductive
from cablesim_sdk.simulation import validate


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--solver',choices=['getdp','comsol'],required=True);args=parser.parse_args()
    for series in [False,True]:
        value,controls=inductive(series,.0015)
        if args.solver=='getdp':controls['minimum_circle_segments']=128
        problem,mesh_controls=validate(value,controls);value=problem.model_dump(mode='json')
        work=ROOT/f'.tmp/comsol-tutorials/{args.solver}-{series}'
        if args.solver=='comsol':
            from cablesim_comsol_bridge.adapter import solve
            mesh,result,observations=solve(value,mesh_controls.model_dump(mode='json'),work)
            totals={kind:sum(r['joule_loss_w_m']+r['magnetic_loss_w_m'] for r in result['regions'] if (r['entity'].endswith('/'+kind) if kind!='armor' else r['entity'].startswith('armor-'))) for kind in ['conductor','screen','armor']}
        else:
            from cablesim_simulation.problem_mesh import build
            from cablesim_simulation.getdp_adapter import solve
            from cablesim_simulation.external import observations as observe
            mesh=build(problem,mesh_controls);result=solve(value,mesh,work);observations=observe(value,mesh,result)
            totals={kind:sum(r['value'] for r in observations if r['quantity'] in ['joule_loss_w_m','magnetic_loss_w_m'] and (r['entity'].endswith('/'+kind) if kind!='armor' else r['entity'].startswith('armor-'))) for kind in ['conductor','screen','armor']}
        output=ROOT/f'.data/simulation/comsol-tutorials/replay-{args.solver}-{series}.json';output.parent.mkdir(parents=True,exist_ok=True)
        output.write_text(json.dumps({'input':value,'controls':controls,'solver':result['solver'],'mesh_sha256':mesh['sha256'],'nodes':len(mesh['points']),'totals_w_m':totals,'observations':observations},indent=2),'utf-8')
        print(json.dumps({'solver':args.solver,'series':series,'totals':totals}),flush=True)


if __name__=='__main__':main()
