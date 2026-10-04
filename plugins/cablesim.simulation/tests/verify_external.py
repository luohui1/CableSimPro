"""Independent shared-mesh, time-step and exterior-domain verification artifacts."""
from copy import deepcopy
from dataclasses import asdict
import json
from pathlib import Path
import sys
import numpy as np
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/src'))
from backend.plugin_host import Executor
from cablesim_simulation.problem import validate
from cablesim_simulation.problem_mesh import build,from_thermal
from cablesim_simulation.elmer_adapter import solve as elmer
from cablesim_simulation.external import observations
from cablesim_simulation.thermal import ThermalSystem
from cablesim_simulation.report import digest


def fixture(name):return json.loads((ROOT/f'plugins/cablesim.simulation/src/cases/{name}.json').read_text('utf-8'))


def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False,indent=2),'utf-8')


def slab_exact(x,t,schedule):
    n=np.arange(1,2000,2,dtype=float)
    coeff=4*1e5*.02**2/(.2*np.pi**3*n**3)*np.sin(n*np.pi*x/.02)
    temperature=293.15;prior=0
    for at,factor in schedule:
        if t>at:
            temperature+=(factor-prior)*float(np.sum(coeff*(1-np.exp(-.2/2e6*(n*np.pi/.02)**2*(t-at)))))
        prior=factor
    return temperature


def heat_checks(work,output):
    cross=[]
    original=fixture('thermal-jorgens')
    for name,k in [('dry',.47),('wet',2.1)]:
        for h in [.008,.004,.002]:
            d=deepcopy(original);d['input']['environment']['background']['k_w_m_k']=k
            d['parameters']['controls']['mesh_size_m']=h;d['parameters']['controls']['far_mesh_size_m']=.2*h/.004
            p,m,model,cfg=from_thermal(d['input'],d['parameters'])
            run=elmer(p,m,work/f'cross-{name}-{h}')
            prepared=(np.asarray(m['points']),np.asarray(m['triangles']),np.asarray(m['domain_ids']),[r['thermal_region'] for r in m['regions']])
            summary,field=ThermalSystem(model,cfg,prepared).solve()
            delta=np.asarray(run['snapshots'][0]['temperature_k'])-np.asarray(field['temperature'])
            row={'variant':name,'mesh_size_m':h,'nodes':len(m['points']),'elements':len(m['triangles']),
                 'mesh_sha256':m['sha256'],'problem_sha256':digest(p),'maximum_absolute_difference_k':float(np.max(np.abs(delta))),
                 'rms_difference_k':float(np.sqrt(np.mean(delta**2))),'tolerance':{'absolute':1e-7,'source':'Predeclared independent linear P1 solver parity threshold'},
                 'status':'matched' if np.max(np.abs(delta))<1e-7 else 'outside_tolerance','elmer':run['solver'],'skfem_energy_relative_residual':summary['energy_relative_residual']}
            cross.append(row);print(json.dumps({k:v for k,v in row.items() if k!='elmer'},ensure_ascii=False),flush=True)
    cross_variants=[]
    for name in ('dry','wet'):
        sequence=[]
        for c in [x for x in cross if x['variant']==name]:
            delta=c['maximum_absolute_difference_k']
            sequence.append({'schema':'cablesim.reproduction-report/1','kind':'case','reference':original['citation'],
                             'mesh_size_m':c['mesh_size_m'],'status':c['status'],'engineering_approval':False,
                             'numerical_evidence':c,'rows':[{'id':'maximum-node-difference','quantity':'solver_difference_inf_k','entity':'field','unit':'K',
                                'reference':0,'calculated':delta,'difference':delta,'absolute_difference':delta,'relative_difference':None,
                                'tolerance':c['tolerance'],'source':'Independent Elmer/scikit-fem on identical P1 mesh','status':c['status'],'reason':None}]})
        cross_variants.append({'id':name,'finest':sequence[-1],'mesh_sequence':sequence,'mesh_independence_certified':False})
    save(output/'thermal-crosscheck.json',{'schema':'cablesim.reproduction-report/1','kind':'suite','reference':original['citation'],
         'scope':'E03 weak thermal subproblem, identical nodes/cells/materials/boundaries, independent Elmer and scikit-fem assembly/solve.',
         'status':'matched' if all(r['status']=='matched' for r in cross) else 'outside_tolerance','variants':cross_variants,'comparisons':cross,'engineering_approval':False})
    transient=[]
    for history in ('step','cycle'):
        for variable,values in [('mesh',[.002,.001,.0005]),('time',[20,10,5])]:
            for value in values:
                d=fixture('heat-step-cycle')
                if history=='step':d['input']['excitations'][0]['schedule']=[[0,1]]
                if variable=='mesh':d['parameters']['mesh']['size_m']=value
                else:d['input']['time'].update(step_s=value,steps=int(4000/value))
                p,c=validate(d['input'],d['parameters']['mesh']);m=build(p,c)
                run=elmer(p.model_dump(mode='json'),m,work/f'{history}-{variable}-{value}')
                values_at=observations(p.model_dump(mode='json'),m,run)
                points=[o for o in values_at if o['quantity']=='probe_temperature_k']
                rows=[{'time_s':o['time_s'],'reference':slab_exact(.01,o['time_s'],p.excitations[0].schedule),
                       'calculated':o['value'],'difference':o['value']-slab_exact(.01,o['time_s'],p.excitations[0].schedule),'unit':'K'} for o in points]
                for row in rows:
                    row.update(id='temperature-'+str(row['time_s']),quantity='probe_temperature_k',entity='field',probe_index=0,
                               absolute_difference=abs(row['difference']),relative_difference=None,
                               tolerance={'absolute':.5,'source':'Predeclared Fourier verification threshold across all grids'},
                               source='Independent Fourier sine-series and linear step superposition',
                               status='matched' if abs(row['difference'])<.5 else 'outside_tolerance',reason=None)
                error=max(abs(r['difference']) for r in rows)
                case={'schema':'cablesim.reproduction-report/1','kind':'case','history':history,'study':variable,'mesh_size_m':c.size_m,'time_step_s':p.time.step_s,
                      'nodes':len(m['points']),'elements':len(m['triangles']),'mesh_sha256':m['sha256'],
                      'maximum_absolute_error_k':error,'final':rows[-1],'rows':rows,'solver':run['solver'],
                      'tolerance':{'absolute':.5,'source':'Predeclared verification threshold across coarse and fine spatial/temporal grids'},
                      'status':'matched' if error<.5 else 'outside_tolerance','engineering_approval':False}
                transient.append(case)
                print(json.dumps({k:v for k,v in case.items() if k not in ('rows','solver')},ensure_ascii=False),flush=True)
    variants=[]
    for history in ('step','cycle'):
        for study in ('mesh','time'):
            sequence=[c for c in transient if c['history']==history and c['study']==study]
            variants.append({'id':history+'-'+study,'refinement_variable':'mesh_size_m' if study=='mesh' else 'time_step_s',
                             'finest':sequence[-1],'mesh_sequence':sequence,'mesh_independence_certified':False})
    save(output/'transient-verification.json',{'schema':'cablesim.reproduction-report/1','kind':'suite',
         'reference':{'id':'V02','kind':'analytic-benchmark','source':'Fourier-series solution of slab diffusion with superposed step sources'},
         'scope':'Elmer BDF1 step/cycle, independent analytical reference; synthetic benchmark, not IEC60853.',
         'status':'matched' if all(r['status']=='matched' for r in transient) else 'outside_tolerance','variants':variants,'engineering_approval':False})


def domain_checks(work,output):
    executor=Executor(jobs_root=work)
    all_cases=[]
    for name in ['eddy-lunca','eddy-twin','eddy-induced']:
        d=fixture(name);base=deepcopy(d['input']);base_bounds=base['geometry'][0]['values']
        sequence=[]
        for scale in [1,2,4]:
            value=deepcopy(base);p=deepcopy(d['parameters'])
            value['geometry'][0]['values']=[v*scale for v in base_bounds]
            if name=='eddy-lunca':value['geometry'][1]['values']=[-10*scale,-10*scale,10*scale,0]
            p['mesh']['far_size_m']*=scale;p['mesh']['transition_m']*=scale
            p['reproduction']={k:d[k] for k in ('citation','scope','targets','frozen_inputs')}
            case={'case_id':name+'-'+str(scale),'input':value,'parameters':p}
            run=executor.run('cablesim.simulation','getdp-eddy',[case])
            got=run.cases[0]
            if got.status!='succeeded':raise RuntimeError(got.error)
            report=got.artifacts['x-cablesim.reproduction-report']
            sequence.append({'extent_scale':scale,'far_mesh_size_m':p['mesh']['far_size_m'],'transition_m':p['mesh']['transition_m'],
                             'nodes':report['numerical_evidence']['nodes'],'mesh_sha256':report['numerical_evidence']['mesh_sha256'],
                             'rows':report['rows'],'solver':report['numerical_evidence']['solver'],'run_id':run.run_id,
                             'field_probes':got.artifacts['x-cablesim.simulation-bundle']['result']['probes']})
            print(json.dumps({'case':name,'extent_scale':scale,'rows':[(r['id'],r['calculated']) for r in report['rows']]},ensure_ascii=False),flush=True)
        all_cases.append({'id':name,'finest':sequence[-1],'mesh_sequence':sequence,'sequence':sequence,'mesh_independence_certified':False,
                          'scope':'Exterior truncation scan; keep near-region size gradient fixed as outer extent grows.'})
    save(output/'domain-convergence.json',{'schema':'cablesim.reproduction-report/1','kind':'suite','reference':{'kind':'numerical-domain-sensitivity'},
         'status':'not_assessed','variants':all_cases,'engineering_approval':False})


def main():
    work=ROOT/'.tmp/simulation-external-verification';work.mkdir(parents=True,exist_ok=True)
    output=ROOT/'.data/simulation/external-verification'
    if len(sys.argv)==1 or sys.argv[1]=='heat':heat_checks(work,output)
    if len(sys.argv)==1 or sys.argv[1]=='domain':domain_checks(work,output)


if __name__=='__main__':main()
