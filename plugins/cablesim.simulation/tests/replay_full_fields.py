"""Independent full tutorial 02 electrical / 06 thermal field comparisons."""
from pathlib import Path
from dataclasses import asdict
from hashlib import sha256
import json
import re
import sys
import numpy as np

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT),str(ROOT/'plugins/cablesim.simulation/src')]
from cablesim_simulation.triangular_fields import terminal_admittance,contact_thermal,geometry
from backend.plugin_host import Executor


def entities(value):
    return json.loads(value[value.index('['):])


def replay(mode,levels,host=False):
    inspection=json.loads((ROOT/'.data/simulation/native-model-inspection.json').read_text('utf-8'))
    stem={'02':'02_capacitive_effects','06':'06_thermal_effects'}[mode]
    records=[];convergence=[];evidence=[]
    for level in levels:
        path=ROOT/'.data/simulation/full-fields'/f'{stem}-{level}.json';data=json.loads(path.read_text('utf-8'))
        p=np.asarray(data['points']).T;t=np.asarray(data['triangles']).T;ids=np.asarray(data['domain_ids']);edges=np.asarray(data['edges']).T;edge_ids=np.asarray(data['edge_ids'])
        materials={i:entities(inspection[f'{stem}.material.mat{i}']) for i in range(1,14)}
        if mode=='02':
            active=ids>=3;t=t[active];ids=ids[active];used=np.unique(t);mapping=np.full(len(p),-1,int);mapping[used]=np.arange(len(used));t=mapping[t];p=p[used]
            material_props={1:(1e-14,1),3:(1.,28),4:(1e-18,2.25),5:(1e-18,2.36),6:(1e-18,2.5),7:(2.,2.25),8:(3.2e-9,3.16),9:(1e-14,3.75),10:(5.,1),11:(59.6e6,1),12:(4.55e6,1),13:(5.,1)}
            omega=2*np.pi*data['frequency_hz'];gamma=np.full(len(t),np.nan+0j)
            for mat,(sigma,eps) in material_props.items():gamma[np.isin(ids,materials[mat])]=sigma+1j*omega*8.8541878128e-12*eps
            electrodes=[np.unique(t[ids==d]) for d in (74,119,73,55,101,54)]
            ground=mapping[np.unique(edges[np.isin(edge_ids,[12,13,338,348])])]
            if np.any(ground<0):raise ValueError('Ground edge outside electrical mesh')
            solved=terminal_admittance(p,t,gamma,electrodes,ground)
            raw=np.asarray(data['admittance_columns']);native=(raw[:,0::2]+1j*raw[:,1::2]).T;opened=solved['admittance']
            # Six terminal fields retain all interphase couplings. Floating-screen
            # elimination is an exact linear-network Schur complement, not a fit.
            quantities={};reference={}
            for label,Y,target in [('open',opened,quantities),('native',native,reference)]:
                effective=Y[:3,:3]-Y[:3,3:]@np.linalg.solve(Y[3:,3:],Y[3:,:3])
                for i in range(3):
                    for j in range(i,3):
                        target[f'floating-C{i+1}{j+1}']=float(effective[i,j].imag/omega)
                        target[f'grounded-C{i+1}{j+1}']=float(Y[i,j].imag/omega)
            info={'linear_residual':solved['residual'],'reciprocity':solved['reciprocity'],'admittance_real':opened.real.tolist(),'admittance_imag':opened.imag.tolist(),'native_admittance_real':native.real.tolist(),'native_admittance_imag':native.imag.tolist()}
            unit='F/m'
        else:
            q=np.asarray(data['centroid_heat_w_m3'])[0,0];native_T=np.asarray(data['centroid_temperature_k'])[0,0]
            if not np.isfinite(q).all():raise ValueError('Imported native heat source missing in a domain')
            roundoff=max(0.,float(-q.min()))
            if roundoff>1e-10*max(1.,float(q.max())):raise ValueError('Imported heat contains materially negative dissipation')
            q=np.maximum(q,0.)
            contacts=edges[np.isin(edge_ids,data['contact_edges'])];fixed=np.unique(edges[np.isin(edge_ids,data['temperature_edges'])])
            conductivity_by_material={3:1.,4:.46,5:.25,6:.46,7:10.,8:.17,9:1.38,10:17.5,11:30.1124,12:35.3,13:58.}
            air=np.array([-.00227583562,1.15480022e-4,-7.90252856e-8,4.11702505e-11,-7.43864331e-15]);water=np.array([-.869083936,.00894880345,-1.58366345e-5,7.97543259e-9])
            def conductivity(d,T):
                k=np.full(len(d),np.nan)
                for mat,value in conductivity_by_material.items():k[np.isin(d,materials[mat])]=value
                for mat,coef,lo,hi in [(1,air,200,1600),(2,water,273.15,553.75)]:
                    mask=np.isin(d,materials[mat])
                    if np.any((T[mask]<lo)|(T[mask]>hi)):raise ValueError('Material polynomial outside published range')
                    k[mask]=np.polynomial.polynomial.polyval(T[mask],coef)
                return k
            h=float(np.polynomial.polynomial.polyval(293.15,air)/20e-6)
            solved=contact_thermal(p,t,ids,conductivity,q,contacts,h,fixed,data['ambient_k'])
            quantities={'maximum-temperature':solved['maximum_k']};reference={'maximum-temperature':data['maximum_k'][0][0]}
            area=geometry(p,t)[2];mean=solved['triangle_temperature_k'].mean(axis=1)
            for label,region in [('phase1',74),('phase2',119),('phase3',73),('air-pocket',materials[1][0])]:
                selected=ids==region;quantities[label+'-mean-temperature']=float(area[selected]@mean[selected]/area[selected].sum());reference[label+'-mean-temperature']=float(area[selected]@native_T[selected]/area[selected].sum())
            info={k:v for k,v in solved.items() if k not in ('temperature_k','triangle_temperature_k','triangles','original_nodes','contacts')};info.update(contact_segments=len(contacts),contact_conductance_w_m2k=h,domain_count=len(set(ids.tolist())),air_pocket_domains=len(materials[1]),removed_heat_roundoff_w_m3=roundoff)
            unit='K'
        rows=[{'id':key,'quantity':key,'unit':unit,'calculated':value,'reference':None,'comsol':reference[key],'difference':None,'relative_difference':None,'comsol_difference':value-reference[key],
               'comsol_relative_difference':(value-reference[key])/abs(reference[key]) if mode=='02' and abs(reference[key])>1e-18 else None,
               'source':f'COMSOL 6.2 installed tutorial {stem}; full geometry basis-field replay' if mode=='02' else 'COMSOL 6.2 tutorial06; native electromagnetic heat imported; independent thermal field with thin contact layer',
               'status':'not_assessed'} for key,value in quantities.items()]
        if mode=='02':
            for row in rows:
                if row['id'] in ('grounded-C11','grounded-C22','grounded-C33'):
                    row.update(reference=1.4e-10,reference_approximate=True,difference=row['calculated']-1.4e-10,
                               reason='教程原文约0.14μF/km，为舍入参考值；互电容未在原文列表，另与本机COMSOL六端子基场比较。')
        record={'level':level,'nodes':len(p),'elements':len(t),'rows':rows,'numerical_evidence':info};records.append(record)
        for key,value in quantities.items():
            convergence.extend([{'variant':'full-field','solver':'open_source','quantity':key,'nodes':len(p),'value':value},{'variant':'full-field','solver':'comsol','quantity':key,'nodes':len(p),'value':reference[key]}])
        evidence.append({'path':str(path.relative_to(ROOT)).replace('\\','/'),'sha256':sha256(path.read_bytes()).hexdigest(),'source_model_sha256':data['source_model_sha256'],'native_solver':data['solver']})
        if host:
            provenance={'reference':data['mesh_provenance'],'sha256':sha256(path.read_bytes()).hexdigest()}
            mesh={'length_unit':'m','points':p.tolist(),'triangles':t.tolist(),'domain_ids':ids.tolist(),'source':provenance}
            if mode=='02':
                mats={str(d):{'conductivity_s_m':material_props[mat][0],'relative_permittivity':material_props[mat][1],'source':'COMSOL02 saved material and current-conservation override'} for mat,regions in materials.items() if mat in material_props for d in regions if d in ids}
                value={'schema_version':'cablesim.terminal-field/1','mesh':mesh,'frequency_hz':data['frequency_hz'],'materials':mats,
                       'terminals':[{'id':'terminal/'+str(i+1),'domain_ids':[d]} for i,d in enumerate((74,119,73,55,101,54))],
                       'floating_terminals':['terminal/4','terminal/5','terminal/6'],
                       'ground_nodes':ground.tolist(),'boundary_source':'COMSOL02 ground boundaries12/13/338/348; six independent 1V terminal bases'}
                capability='terminal-field'
            else:
                laws={str(d):{'coefficients_w_m_k':[value],'minimum_temperature_k':273.15,'maximum_temperature_k':373.15,'source':'COMSOL06 original constant material; restricted to this 0..100C replay'} for mat,value in conductivity_by_material.items() for d in materials[mat]}
                for mat,coef,lo,hi in [(1,air,200,1600),(2,water,273.15,553.75)]:
                    for d in materials[mat]:laws[str(d)]={'coefficients_w_m_k':coef.tolist(),'minimum_temperature_k':lo,'maximum_temperature_k':hi,'source':'COMSOL06 saved material polynomial and validity interval'}
                value={'schema_version':'cablesim.contact-thermal-field/1','mesh':mesh,'thermal_conductivity':laws,'heat_w_m3':q.tolist(),'heat_source':{'reference':'Native COMSOL06 mf.Qh at element centroids, exterior domains1/2/7 have no magnetic heat','sha256':provenance['sha256']},
                       'contact_edges':contacts.tolist(),'contact_conductance_w_m2k':[h]*len(contacts),'contact_source':'COMSOL06 20um resistive air layer; saved material input293.15K',
                       'temperature_nodes':fixed.tolist(),'ambient_k':data['ambient_k'],'boundary_source':'COMSOL06 Temperature1 selected exterior boundaries'}
                capability='contact-thermal-field'
            jobs=ROOT/'.tmp/simulation-sixth-discrete';jobs.mkdir(parents=True,exist_ok=True)
            run=Executor(jobs_root=jobs).run('cablesim.simulation',capability,[{'case_id':mode+'-'+str(level),'input':value,'parameters':{}}])
            host_path=path.with_name(stem+'-'+str(level)+'-host.json');host_path.write_text(json.dumps(asdict(run),ensure_ascii=False,separators=(',',':'),allow_nan=False),'utf-8')
            if run.cases[0].status!='succeeded':raise RuntimeError(run.cases[0].error)
            record['run']={key:getattr(run,key) for key in ('run_id','plugin_id','plugin_version','method_version','request_sha256')}
            actual=run.cases[0].artifacts['x-cablesim.simulation-bundle']['result']
            if mode=='02':assert np.allclose(actual['admittance_imag_s_m'],opened.imag,rtol=1e-12,atol=1e-25)
            else:assert abs(actual['maximum_k']-solved['maximum_k'])<1e-8
    output=ROOT/'.data/simulation'/('capacitive-three-phase' if mode=='02' else 'thermal-full');output.mkdir(parents=True,exist_ok=True)
    report={'schema':'cablesim.full-field-comparison/1','coverage_status':'partial','scope':'完整三相六端子场及浮置护套消元互电容矩阵' if mode=='02' else '完整166域热传导及20μm空气接触热阻；采用原生电磁热源，独立开源热场求解',
            'limitations':['网格由COMSOL教程原始几何生成；开源部分独立组装P1场方程，尚不代表独立开源几何重建。']+([] if mode=='02' else ['导入原生电磁热源，本项不宣称完整教程的开源双向电磁-热耦合。','原生模型保留其Rac全局方程及Milliken等效导体约定。']),
            'inputs':[{'source':'COMSOL6.2原始MPH及材料/边界API导出','note':'SI单位；原始模型SHA256、原生执行源码和日志摘要随网格记录保存。'},{'source':'native-model-inspection.json','note':'域/边界实体号、材料、物性多项式及端子电势均来自原生模型。'}],
            'mesh_note':'同一原始几何的逐档COMSOL三角网格；开源P1与原生有限元独立求解。','rows':records[-1]['rows'],'convergence':convergence,'mesh_sequence':records,'evidence':evidence,'runs':[r['run'] for r in records if 'run' in r],'engineering_approval':False}
    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False),'utf-8')
    print(json.dumps({'output':str(output),'levels':[{k:r[k] for k in ('level','nodes','elements')} for r in records],'rows':report['rows'],'diagnostics':records[-1]['numerical_evidence']},ensure_ascii=False),flush=True)


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--mode',choices=['02','06'],required=True);parser.add_argument('--levels',nargs='+',type=int,default=[7,5,3]);parser.add_argument('--host',action='store_true');args=parser.parse_args();replay(args.mode,args.levels,args.host)
