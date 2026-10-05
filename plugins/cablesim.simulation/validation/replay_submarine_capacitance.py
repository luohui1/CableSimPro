"""Six terminal fields on an independently constructed submarine cross section."""
from pathlib import Path
from dataclasses import asdict
from hashlib import sha256
import json
import sys
import numpy as np

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT),str(ROOT/'plugins/cablesim.simulation/src')]
from backend.plugin_host import Executor
from submarine_geometry import build


def quantities(y,omega):
    effective=y[:3,:3]-y[:3,3:]@np.linalg.solve(y[3:,3:],y[3:,:3])
    return {f'{label}-C{i+1}{j+1}':float(matrix[i,j].imag/omega)
            for label,matrix in [('grounded',y),('floating',effective)] for i in range(3) for j in range(i,3)}


def main():
    out=ROOT/'.data/simulation/capacitive-independent';out.mkdir(parents=True,exist_ok=True)
    jobs=ROOT/'.tmp/simulation-seventh-capacitance';jobs.mkdir(parents=True,exist_ok=True);records=[];convergence=[];evidence=[]
    # Declared before comparing: 0.2% or 0.01 pF/m for tiny mutual entries;
    # final open mesh step must also satisfy this absolute/relative bound.
    relative_tolerance=.002;absolute_tolerance=1e-14
    props={1:(1e-14,1),3:(1.,28),4:(1e-18,2.25),5:(1e-18,2.36),6:(1e-18,2.5),7:(2.,2.25),8:(3.2e-9,3.16),9:(1e-14,3.75),10:(5.,1),11:(59.6e6,1),12:(4.55e6,1),13:(5.,1)}
    omega=2*np.pi*50
    native={}
    for level in [7,5,3]:
        path=ROOT/'.data/simulation/full-fields'/f'02_capacitive_effects-{level}.json'
        d=json.loads(path.read_text('utf-8'));raw=np.array(d['admittance_columns']);y=(raw[:,::2]+1j*raw[:,1::2]).T
        native=quantities(y,omega)
        convergence.extend({'variant':'six-terminal','solver':'comsol','quantity':k,'nodes':len(d['points'][0]),'value':v} for k,v in native.items())
        evidence.append({'path':path.relative_to(ROOT).as_posix(),'sha256':sha256(path.read_bytes()).hexdigest(),'source_model_sha256':d['source_model_sha256']})
    for size,segments in [(.003,64),(.002,96),(.0013,128)]:
        mesh=build(size,segments,thermal=False)
        discrete={k:mesh[k] for k in ('points','triangles','domain_ids')}
        discrete.update(length_unit='m',source={'reference':mesh['geometry_source'],'sha256':mesh['sha256']})
        regions={r['construction_label']:r['id'] for r in mesh['regions']}
        terminals=[regions[f'phase/{i}/{kind}'] for kind in ('conductor','screen') for i in (1,2,3)]
        value={'schema_version':'cablesim.terminal-field/1','mesh':discrete,'frequency_hz':50.,
               'materials':{str(r['id']):{'conductivity_s_m':props[r['material_index']][0],'relative_permittivity':props[r['material_index']][1],
                   'source':'COMSOL02 original material and ec current-conservation overrides; independent domain association'} for r in mesh['regions']},
               'terminals':[{'id':'terminal/'+str(i+1),'domain_ids':[d]} for i,d in enumerate(terminals)],
               'floating_terminals':['terminal/4','terminal/5','terminal/6'],
               'ground_nodes':sorted({int(v) for edge in mesh['boundary_edges'] for v in edge[:2]}),
               'boundary_source':'Tutorial02 ground on radius 5*Dcab/2; independently constructed six 1V bases'}
        request={'case_id':'six-terminal','input':value,'parameters':{}}
        key=f'{size:g}-{segments}';(out/(key+'-input.json')).write_text(json.dumps(request,separators=(',',':')),'utf-8')
        print(json.dumps({'start':key,'nodes':len(mesh['points'])}),flush=True)
        run=asdict(Executor(jobs_root=jobs).run('cablesim.simulation','terminal-field',[request]))
        (out/(key+'-run.json')).write_text(json.dumps(run,separators=(',',':')),'utf-8')
        case=run['cases'][0]
        if case['status']!='succeeded':raise RuntimeError(case['error'])
        result=case['artifacts']['x-cablesim.simulation-bundle']['result']
        y=np.array(result['admittance_real_s_m'])+1j*np.array(result['admittance_imag_s_m']);values=quantities(y,omega)
        rows=[{'id':k,'quantity':k,'unit':'F/m','calculated':v,'comsol':native[k],
               'reference':1.4e-10 if k in ('grounded-C11','grounded-C22','grounded-C33') else None,
               'reference_approximate':True,'difference':v-1.4e-10 if k in ('grounded-C11','grounded-C22','grounded-C33') else None,
               'comsol_difference':v-native[k],'relative_difference':None,
               'status':'matched' if abs(v-native[k])<=max(absolute_tolerance,relative_tolerance*abs(native[k])) else 'outside_tolerance',
               'source':'COMSOL02 tutorial approximate 0.14uF/km; native independent six-terminal solve',
               'tolerance':{'absolute':absolute_tolerance,'relative':relative_tolerance}} for k,v in values.items()]
        record={'size_m':size,'circle_segments':segments,'nodes':len(mesh['points']),'rows':rows,'quantities':values,
                'run':{k:run[k] for k in ('run_id','plugin_id','plugin_version','method_version','request_sha256')},'mesh_sha256':mesh['sha256'],
                'artifact_sha256':case['artifact_digests']['x-cablesim.simulation-bundle']}
        records.append(record);convergence.extend({'variant':'six-terminal','solver':'open_source','quantity':k,'nodes':len(mesh['points']),'value':v} for k,v in values.items())
        print(json.dumps({'nodes':len(mesh['points']),'quantities':values}),flush=True)
    stable=all(abs(v-records[-2]['quantities'][k])<=max(absolute_tolerance,relative_tolerance*abs(v)) for k,v in records[-1]['quantities'].items())
    report={'coverage_status':'reproduced' if stable and all(r['status']=='matched' for r in rows) else 'partial',
            'scope':'完整独立几何、三相六端子充电场与浮置护套互电容矩阵',
            'limitations':['限定教程02二维截面及其材料参数；原文0.14μF/km为舍入参考。'],
            'inputs':[{'source':'COMSOL6.2 tutorial01 dimensions and tutorial02 material/electrode definitions','note':'No native mesh or fields imported into the open solve'}],
            'mesh_note':'独立Gmsh三档网格及圆周离散；COMSOL三档独立网格；容差0.2%或0.01pF/m',
            'rows':rows,'convergence':convergence,'mesh_sequence':records,'evidence':evidence,'runs':[r['run'] for r in records],
            'mesh_converged':stable,'engineering_approval':False}
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps({'status':report['coverage_status'],'mesh_converged':stable}),flush=True)


if __name__=='__main__':main()
