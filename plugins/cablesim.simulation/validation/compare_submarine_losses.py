"""Join like-for-like tutorial04 branches; no solver values are substituted."""
from pathlib import Path
from hashlib import sha256
import json

ROOT=Path(__file__).resolve().parents[3]
DATA=ROOT/'.data/simulation'


def main():
    evidence=[];rows=[];convergence=[];runs=[];gates=[]
    def load(path):
        file=DATA/path;raw=file.read_bytes();evidence.append({'path':file.relative_to(ROOT).as_posix(),'sha256':sha256(raw).hexdigest()});return json.loads(raw)
    for flag,label in [(False,'普通2D'),(True,'串联2.5D')]:
        native=load(f'comsol-tutorials/04-native-{flag}.json')
        series=[load(f'comsol-tutorials/04-{tag}-{flag}-0.0015.json') for tag in ('circle','circle128')]
        if flag and (DATA/'submarine-inductive/open-series.json').exists():
            series=load('submarine-inductive/open-series.json')['mesh_sequence'][-2:]
            runs.extend(r['run'] for r in series)
        for kind in ('conductor','screen','armor'):
            key=kind if kind in series[-1]['totals_w_m'] else 'sheath'
            value=series[-1]['totals_w_m'][key];ref=native['totals_w_m'][kind];prior=series[-2]['totals_w_m'][key]
            printed={'conductor':47.,'screen':15. if flag else 13.,'armor':.36 if flag else 7.6}[kind]
            ok=abs(value-ref)/ref<=.005 and abs(value-prior)/value<=.005;gates.append(ok)
            rows.append({'id':label+'/'+kind,'quantity':kind+'_loss','entity':kind,'variant':label,'unit':'W/m','reference':printed,'reference_approximate':True,'calculated':value,'comsol':ref,
                         'difference':value-printed,'relative_difference':None,'status':'matched' if ok else 'outside_tolerance','source':'COMSOL tutorial04 Table1 rounded reference and independent same-branch native solve','tolerance':{'relative':.005}})
            for level in series:convergence.append({'variant':label,'solver':'open_source','quantity':kind+'_loss','nodes':level['nodes'],'value':level['totals_w_m'][key]})
    opened=load('submarine-inductive/open-milliken.json')['mesh_sequence']
    natives=[load('submarine-inductive/native-'+str(n)+'.json') for n in (7,5,3)]
    for kind in ('conductor','screen','armor','fiber','mean_port_resistance'):
        native=lambda r:sum(r['values']['mf.RCoil_'+str(i)+'/1[m]'] for i in (1,2,3))/3 if kind=='mean_port_resistance' else r['values'][kind+'_loss_w_m']
        value=opened[-1]['totals_w_m'][kind];ref=native(natives[-1]);prior=opened[-2]['totals_w_m'][kind]
        ok=abs(value-ref)/ref<=.005 and abs(value-prior)/value<=.005;gates.append(ok)
        printed={'conductor':43.,'screen':16.,'armor':.37,'mean_port_resistance':46e-6}.get(kind)
        rows.append({'id':'均质多匝/'+kind,'variant':'均质多匝','quantity':kind+'_loss' if kind!='mean_port_resistance' else 'ac_resistance_ohm_m','entity':kind,
                     'unit':'W/m' if kind!='mean_port_resistance' else 'ohm/m','reference':printed,'reference_approximate':True,'calculated':value,'comsol':ref,
                     'difference':value-printed if printed is not None else None,'relative_difference':None,'status':'matched' if ok else 'outside_tolerance',
                     'source':'COMSOL tutorial04 p37 N=1,Scup,Acon; original final model Multi coils and series armor, Table1 approximate values','tolerance':{'relative':.005}})
        for level in opened:convergence.append({'variant':'均质多匝','solver':'open_source','quantity':rows[-1]['quantity'],'nodes':level['nodes'],'value':level['totals_w_m'][kind]})
        for level in natives:convergence.append({'variant':'均质多匝','solver':'comsol','quantity':rows[-1]['quantity'],'nodes':level['values']['nodes'],'value':native(level)})
    report={'coverage_status':'reproduced' if all(gates) else 'partial','scope':'教程04普通2D、110钢丝串联2.5D与N=1均质多匝三分支感应损耗',
            'rows':rows,'convergence':convergence,'inputs':[{'source':'tutorial_problem.py and replay_submarine_inductive.py; tutorial04 pp6–12,32,37','note':'No native field imported; RMS655A, explicitly supplied wire conductivity and copper area'}],
            'limitations':['均质多匝为教程的Milliken近似，不解析真实三维分割或绞线。','聚合物极小漏电忽略；导体均质发热单独按给定Scup/Acon计算，其他区域采用GetDP实际损耗。',
                           '普通2D和串联2.5D历史直接求解记录未保存宿主清单版本；原始输入及求解器版本仍保存。'],
            'mesh_note':'h与圆周离散分别记录；三分支与COMSOL差≤0.5%，最终圆周变化≤0.5%；不构成工程批准。',
            'runs':runs+[r['run'] for r in opened],'evidence':evidence,'engineering_approval':False}
    (DATA/'submarine-inductive/report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps({'status':report['coverage_status'],'failed':[r['id'] for r in rows if r['status']!='matched']}),flush=True)


if __name__=='__main__':main()
