"""Separate exterior, probe patch, conductor mesh and remote-growth studies."""
from copy import deepcopy
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/src'))
from cablesim_simulation.problem import validate
from cablesim_simulation.problem_mesh import build
from cablesim_simulation.getdp_adapter import solve
from cablesim_simulation.report import digest


def main():
    fixture=json.loads((ROOT/'plugins/cablesim.simulation/src/cases/eddy-lunca.json').read_text('utf-8'))
    variants=[(s,.02,.0005,.1) for s in [1,2,4,8,16,32]]
    variants += [(16,.01,.0005,.1),(32,.01,.0005,.1),(32,.005,.0005,.1),(32,.01,.001,.1),(32,.01,.00025,.1),(32,.01,.0005,.05)]
    sequence=[];output=ROOT/'.data/simulation/external-verification/raw-field-convergence.json';output.parent.mkdir(parents=True,exist_ok=True)
    for scale,patch,h,growth in variants:
        value=deepcopy(fixture['input']);parameters=deepcopy(fixture['parameters']['mesh'])
        value['geometry'][0]['values']=[v*scale for v in value['geometry'][0]['values']]
        value['geometry'][1]['values']=[-10*scale,-10*scale,10*scale,0]
        parameters.update(size_m=h,far_size_m=.4,transition_m=4,probe_cell_size_m=patch,max_nodes=120000,field_order=2,
                          exterior_growth_start_m=8,exterior_growth_rate=growth)
        p,c=validate(value,parameters);mesh=build(p,c)
        result=solve(p.model_dump(mode='json'),mesh,ROOT/f'.tmp/simulation-raw-field/{scale}-{patch}-{h}-{growth}')
        sequence.append({'extent_m':20*scale,'probe_cell_radius_m':patch,'probe_cells':mesh['probe_cells'],'controls':parameters,
                         'nodes':len(mesh['points']),'mesh_sha256':mesh['sha256'],'problem_sha256':digest(value),
                         'probe':result['probes'][0],'solver':result['solver']})
        output.write_text(json.dumps({'status':'in_progress','sequence':sequence},indent=2),'utf-8')
        print(json.dumps({'extent_m':20*scale,'patch':patch,'h':h,'growth':growth,'b_rms_t':result['probes'][0]['b_rms_t']}),flush=True)
    domain=sequence[:6];same=len({r['probe_cells'][0]['cell_sha256'] for r in domain})==1
    changes=[abs(b['probe']['b_rms_t']-a['probe']['b_rms_t']) for a,b in zip(domain,domain[1:])]
    report={'schema':'cablesim.reproduction-report/1','kind':'raw-point-exterior-convergence','sequence':sequence,
            'fixed_probe_cell_verified':same,'domain_consecutive_changes_t':changes,'threshold_t':2e-9,
            'threshold_source':'Predeclared 2 nT last-domain-step criterion; local sensitivities remain separate',
            'status':'domain_converged' if same and changes[-1]<2e-9 else 'not_converged','engineering_approval':False}
    output.write_text(json.dumps(report,indent=2),'utf-8')


if __name__=='__main__':main()
