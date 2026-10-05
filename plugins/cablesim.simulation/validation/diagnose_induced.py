"""E18 one-factor sensitivity checks; retains paper inputs without fitting."""
from copy import deepcopy
from pathlib import Path
import json
import sys
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT),str(ROOT/'plugins/cablesim.simulation/src')]
from cablesim_simulation.problem import validate
from cablesim_simulation.problem_mesh import build
from cablesim_simulation.getdp_adapter import solve
from cablesim_simulation.report import digest


def insert_probes(problem,mesh):
    """Split existing triangles at diagnostic points; preserve all interfaces."""
    import numpy as np
    from cablesim_simulation.problem_mesh import package
    points=np.asarray(mesh['points']);cells=np.asarray(mesh['triangles']);ids=np.asarray(mesh['domain_ids'])
    for probe in problem.current_probes:
        point=np.asarray(probe.point_m)
        if np.min(np.linalg.norm(points-point,axis=1))<1e-10:continue
        region=next(r['id'] for r in mesh['regions'] if r['uid']==probe.region)
        candidates=[]
        for j in np.flatnonzero(ids==region):
            xy=points[cells[j]]
            weights=np.linalg.solve((xy[1:]-xy[0]).T,point-xy[0])
            if min(*weights,1-weights.sum())>=-1e-10:candidates.append(int(j))
        if not candidates:raise ValueError('Diagnostic point not inside requested material')
        n=len(points);points=np.vstack([points,point]);extra=[]
        for j in candidates:
            for a,b in zip(cells[j],np.roll(cells[j],-1)):
                u,v=points[b]-points[a],point-points[a]
                if abs(u[0]*v[1]-u[1]*v[0])>1e-22:extra.append([int(a),int(b),n])
        mask=np.ones(len(cells),dtype=bool);mask[candidates]=False
        cells=np.vstack([cells[mask],extra]);ids=np.r_[ids[mask],[region]*len(extra)]
    result=package(points,cells,ids,mesh['regions'],[b.model_dump(mode='json') for b in problem.boundaries])
    result['field_order']=mesh.get('field_order',1);result.pop('sha256');result['sha256']=digest(result)
    return result


def main():
    fixture=json.loads((ROOT/'plugins/cablesim.simulation/src/cases/eddy-induced.json').read_text('utf-8'))
    destination=ROOT/'.data/simulation/eddy-induced-diagnostics';destination.mkdir(parents=True,exist_ok=True)
    work=ROOT/'.tmp/simulation-fifth/induced';work.mkdir(parents=True,exist_ok=True)
    variants=[('baseline',{}),('mesh-1mm',{'h':.001}),('mesh-half-mm',{'h':.0005}),
              ('domain-small',{'domain':.1}),('domain-medium',{'domain':.2}),('domain-large',{'domain':.8}),
              ('domain-larger',{'domain':1.6}),('domain-largest',{'domain':3.2}),
              ('far-fine',{'far':.02}),('frequency-low',{'frequency':198}),('frequency-high',{'frequency':202}),
              ('sigma-low',{'sigma':54e6}),('sigma-high',{'sigma':56e6}),('inside',{'inset':1e-5})]
    rows=[]
    for name,change in variants:
        saved=destination/(name+'.json')
        if '--resume' in sys.argv and saved.is_file():
            row=json.loads(saved.read_text('utf-8'))
            if row['changes']!=change:raise ValueError('Saved diagnostic parameters changed')
            if row.get('status')!='failed':rows.append(row);continue
        p=deepcopy(fixture['input']);m=deepcopy(fixture['parameters']['mesh'])
        m.update(size_m=change.get('h',.00025),far_size_m=change.get('far',.04),field_order=2,minimum_circle_segments=128,max_nodes=120000)
        a=change.get('domain',.4);p['geometry'][0]['values']=[-a,-a,a,a]
        p['frequency_hz']=change.get('frequency',200)
        for r in p['geometry'][1:]:r['material']['conductivity_s_m']=change.get('sigma',55e6)
        if 'inset' in change:
            for probe in p['current_probes']:probe['point_m']=[v*(1-change['inset']/.01) for v in probe['point_m']]
        problem,controls=validate(p,m);mesh=build(problem,controls)
        if 'inset' in change:mesh=insert_probes(problem,mesh)
        try:
            result=solve(problem.model_dump(mode='json'),mesh,work/name)
        except Exception as exc:
            row={'variant':name,'changes':change,'status':'failed','error':str(exc)}
            rows.append(row);saved.write_text(json.dumps(row,ensure_ascii=False,indent=2),'utf-8')
            print(name,row['error'],flush=True);continue
        row={'variant':name,'changes':change,'problem':problem.model_dump(mode='json'),'mesh_controls':m,
             'mesh_sha256':mesh['sha256'],'nodes':len(mesh['points']),'current_density_a_m2':[v['j_rms_a_m2'] for v in result['current_density_probes']],
             'current_constraints':result['current_constraint_errors'],'solver':result['solver']}
        rows.append(row)
        (destination/(name+'.json')).write_text(json.dumps(row,ensure_ascii=False,indent=2,allow_nan=False),'utf-8')
        print(name,row['current_density_a_m2'],flush=True)
    report={'reference':fixture['citation'],'paper_a_m2':[3714e3,650e3,2321e3],'runs':rows,'fitted_parameters':False}
    (destination/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False),'utf-8')


if __name__=='__main__':main()
