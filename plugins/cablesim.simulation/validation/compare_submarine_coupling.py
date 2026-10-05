"""Compare independent full electric/thermal feedback with the original native model."""
from pathlib import Path
from hashlib import sha256
import json
import numpy as np

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'.data/simulation/submarine-coupled'


def main():
    evidence=[]
    def load(path):
        raw=path.read_bytes();evidence.append({'path':path.relative_to(ROOT).as_posix(),'sha256':sha256(raw).hexdigest()});return json.loads(raw)
    opened=[load(OUT/('summary-'+key+'.json')) for key in ('0.003-64','0.002-96','0.0013-96','0.001-128')]
    native=[load(OUT/('native-'+str(n)+'.json')) for n in (7,5,3)]
    last=opened[-1];ref=native[-1]['values'];rows=[];convergence=[]
    def add(key,label,unit,value,reference,printed=None,tolerance=None):
        rows.append({'id':key,'entity':label,'quantity':key,'unit':unit,'calculated':value,'comsol':reference,'reference':printed,
                     'reference_approximate':printed is not None,'difference':value-printed if printed is not None else None,'relative_difference':None,
                     'status':'not_assessed' if tolerance is None else 'matched' if abs(value-reference)<=tolerance else 'outside_tolerance',
                     'tolerance':{'absolute':tolerance} if tolerance is not None else None,
                     'source':'COMSOL06 original final Multi coils, Scup2 global Rac(T) constraint; independent GetDP/contact FEM',
                     'reason':'原文为约值；同工况精确对照采用重新求解的本机COMSOL。'+('此平均温度为诊断量，保留K差，不单独作工程验收。' if tolerance is None else '')})
    add('maximum-temperature','全场','K',last['maximum_k'],ref['maximum_k'],363.15,.1)
    native_power=3*655**2*ref['Rac(aveop1(T))']
    add('total_loss_w_m','全截面','W/m',last['total_heat_w_m'],native_power,None,.01*native_power)
    for kind,label,printed_t,printed_loss in [('conductor','导体',363.15,58.),('screen','铅护套',356.15,11.),('armor','钢丝铠装',343.15,6.8),('fiber','光纤钢管',None,None)]:
        add(kind+'_mean_temperature',label,'K',last['groups'][kind]['mean_temperature_k'],ref[kind+'_mean_k'],printed_t)
        add(kind+'_loss',label,'W/m',last['groups'][kind]['heat_w_m'],ref[kind+'_loss_w_m'],printed_loss,.01*ref[kind+'_loss_w_m'])
    for r in opened:
        convergence.extend([{'variant':'完整双向电热','solver':'open_source','quantity':'maximum-temperature','nodes':r['nodes'],'value':r['maximum_k']},
                            {'variant':'完整双向电热','solver':'open_source','quantity':'total_loss_w_m','nodes':r['nodes'],'value':r['total_heat_w_m']}])
        for kind in r['groups']:
            convergence.extend([{'variant':'完整双向电热','solver':'open_source','quantity':kind+'_mean_temperature','nodes':r['nodes'],'value':r['groups'][kind]['mean_temperature_k']},
                                {'variant':'完整双向电热','solver':'open_source','quantity':kind+'_loss','nodes':r['nodes'],'value':r['groups'][kind]['heat_w_m']}])
    for r in native:
        v=r['values'];convergence.extend([{'variant':'完整双向电热','solver':'comsol','quantity':'maximum-temperature','nodes':v['nodes'],'value':v['maximum_k']},
                                         {'variant':'完整双向电热','solver':'comsol','quantity':'total_loss_w_m','nodes':v['nodes'],'value':3*655**2*v['Rac(aveop1(T))']}])
        for kind in last['groups']:
            convergence.extend([{'variant':'完整双向电热','solver':'comsol','quantity':kind+'_mean_temperature','nodes':v['nodes'],'value':v[kind+'_mean_k']},
                                {'variant':'完整双向电热','solver':'comsol','quantity':kind+'_loss','nodes':v['nodes'],'value':v[kind+'_loss_w_m']}])
    stable=abs(last['maximum_k']-opened[-2]['maximum_k'])<.1
    passed=stable and all(r['status']!='outside_tolerance' for r in rows)
    report={'coverage_status':'reproduced' if passed else 'partial','scope':'完整166域独立Gmsh几何、GetDP损耗↔温变接触热场双向反馈；保留原生Multi与端口Rac(T)全局约定',
            'rows':rows,'convergence':convergence,'mesh_sequence':opened,'native_mesh_sequence':native,'evidence':evidence,
            'inputs':[{'source':'COMSOL6.2 original tutorial01/06 dimensional/material definitions; tutorial-definition/06_thermal_effects.json','note':'No native mesh or heat imported; all quantities in SI, RMS current655A'},
                      {'source':'open-0.001-128-input.json','note':'σ(T), k(T),20μm contact resistance, fixed thermal boundary and sourced Rac(T) are explicit'}],
            'limitations':['均质绕组模型对应教程最终Multi+Scup2；不是逐股三维Milliken模型。','磁场和热源对应最后磁迭代输入温度；返回热试探温度与之相差不超过1e-4K，历史input温度摘要不是输出温度场摘要。',
                           '平均温度诊断差、有限元阶次和有限固定边界保留；相邻网格变化不是全局误差上界。未执行研究页加倍域交付门禁，不产生工程批准。'],
            'mesh_note':'开源四档、COMSOL三档真实网格；最热点末次变化<0.1K，对COMSOL最热点差<0.1K，分项损耗差<1%；平均温度只列K差。',
            'runs':[r['run'] for r in opened],'maximum_temperature_step_k':abs(last['maximum_k']-opened[-2]['maximum_k']),
            'maximum_native_temperature_difference_k':max(abs(r['calculated']-r['comsol']) for r in rows if r['unit']=='K'),
            'engineering_approval':False}
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
    plot(load(OUT/'open-0.001-128.json'),load(ROOT/'.data/simulation/full-fields/06_thermal_effects-3.json'))
    print(json.dumps({'status':report['coverage_status'],'maximum_temperature_k':last['maximum_k'],'peak_difference_k':last['maximum_k']-ref['maximum_k'],
                      'maximum_temperature_step_k':report['maximum_temperature_step_k'],'largest_diagnostic_temperature_difference_k':report['maximum_native_temperature_difference_k']}),flush=True)


def plot(opened,native):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import matplotlib.tri as tri
    field=opened['cases'][0]['artifacts']['x-cablesim.temperature-field'];mesh=field['mesh']
    p=np.array(mesh['points']);t=np.array(mesh['triangles']);values=np.array(field['temperature_k'])[t].mean(axis=1)-273.15
    pn=np.array(native['points']).T;tn=np.array(native['triangles']).T;vn=np.array(native['centroid_temperature_k'])[0,0]-273.15
    fig,axes=plt.subplots(1,2,figsize=(11.5,5),layout='constrained')
    for ax,points,triangles,temps,title in zip(axes,[p,pn],[t,tn],[values,vn],['Independent Gmsh / GetDP / contact FEM','COMSOL 6.2 original model']):
        vertices=points[triangles]
        selected=np.all(vertices.min(axis=1)<.125,axis=1)&np.all(vertices.max(axis=1)>-.125,axis=1)
        obj=tri.Triangulation(points[:,0]*1000,points[:,1]*1000,triangles[selected])
        artist=ax.tripcolor(obj,facecolors=temps[selected],cmap='inferno',vmin=60,vmax=90,rasterized=True)
        ax.set(xlim=(-115,115),ylim=(-115,115),xlabel='x / mm',ylabel='z / mm',title=title);ax.set_aspect('equal')
    fig.colorbar(artist,ax=axes,label='Temperature / degC',shrink=.86)
    fig.suptitle('Tutorial 06: bidirectional electromagnetic-thermal coupling',fontsize=13)
    fig.savefig(OUT/'temperature-comparison.png',dpi=180);fig.savefig(OUT/'temperature-comparison.svg');plt.close(fig)


if __name__=='__main__':main()
