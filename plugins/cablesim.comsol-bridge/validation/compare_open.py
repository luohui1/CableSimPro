from pathlib import Path
from copy import deepcopy
import sys,json
root=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(root));sys.path.insert(0,str(root/'plugins/cablesim.simulation/src'))
from cablesim_simulation.problem import validate
from cablesim_simulation.problem_mesh import build
from cablesim_simulation.getdp_adapter import solve
from cablesim_simulation.external import observations,comparison
for name in ['eddy-twin','eddy-induced','eddy-lunca']:
 f=json.loads((root/f'plugins/cablesim.simulation/src/cases/{name}.json').read_text('utf-8'));levels=[]
 for h in [.001,.0005,.00025]:
  controls=deepcopy(f['parameters']['mesh']);controls.update(size_m=h,field_order=2)
  if name=='eddy-lunca':controls['probe_cell_size_m']=.02
  p,c=validate(f['input'],controls);mesh=build(p,c);problem=p.model_dump(mode='json')
  r=solve(problem,mesh,root/f'.tmp/comsol-bridge/open-{name}-{h}')
  obs=observations(problem,mesh,r);rep=comparison(obs,f,{'solver':r['solver'],'nodes':len(mesh['points']),'mesh_sha256':mesh['sha256'],'controls':controls})
  rep['observations']=obs;levels.append(rep)
  path=root/f'.data/simulation/comsol-comparison/{name}/open-quadratic.json';path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps({'schema':'cablesim.reproduction-report/1','mesh_sequence':levels,'engineering_approval':False},indent=2),'utf-8')
  print(json.dumps({'case':name,'h':h,'rows':[(v['id'],v['calculated']) for v in rep['rows']]}),flush=True)
