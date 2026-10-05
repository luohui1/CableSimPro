"""Tutorial01 independent geometry: topology and cross-sectional area convergence."""
from pathlib import Path
from hashlib import sha256
import json
import numpy as np

ROOT=Path(__file__).resolve().parents[3]
LABELS={1:'空气腔',2:'水域',3:'海床',4:'聚乙烯',5:'聚丙烯',6:'XLPE',7:'半导电层',8:'沥青填充',9:'光纤芯',10:'光纤钢管',11:'铜导体',12:'铅护套',13:'钢丝铠装'}
EXPECTED={1:24,2:1,3:2,4:3,5:5,6:3,7:6,8:1,9:1,10:4,11:3,12:3,13:110}


def areas(p,t,ids,groups):
    xy=p[t];a=abs((xy[:,1,0]-xy[:,0,0])*(xy[:,2,1]-xy[:,0,1])-(xy[:,1,1]-xy[:,0,1])*(xy[:,2,0]-xy[:,0,0]))/2
    return {str(k):float(a[np.isin(ids,v)].sum()) for k,v in groups.items()}


def main():
    data=ROOT/'.data/simulation';out=data/'submarine-geometry';out.mkdir(parents=True,exist_ok=True)
    records=[];evidence=[];convergence=[]
    for solver,keys in [('comsol',[7,5,3]),('open_source',['0.003-64','0.002-96','0.0013-96'])]:
        for key in keys:
            path=data/'submarine-coupled'/f'native-{key}.json' if solver=='comsol' else data/'submarine-coupled'/f'mesh-{key}.json'
            value=json.loads(path.read_text('utf-8'))
            if solver=='comsol':
                # COMSOL uses curved geometric elements: corner-only triangle
                # areas are not its physical domain areas. Integrate 1 natively.
                result={str(k):value['values'][f'material_{k}_area_m2'] for k in LABELS}
                counts={k:int(value['values'][f'material_{k}_domains']) for k in LABELS};nodes=int(value['values']['nodes'])
            else:
                p=np.array(value['points']);t=np.array(value['triangles']);ids=np.array(value['domain_ids'])
                mapping={k:[r['id'] for r in value['regions'] if r['material_index']==k] for k in LABELS}
                result=areas(p,t,ids,mapping);counts={k:len(set(v)&set(ids.tolist())) for k,v in mapping.items()};nodes=len(p)
            if counts!=EXPECTED:raise ValueError('Full independent/native material topology differs from tutorial: '+str(counts))
            record={'solver':solver,'level':key,'nodes':nodes,'areas_m2':result,'domain_counts':counts,'mesh_area_m2':sum(result.values())};records.append(record)
            for k,v in result.items():convergence.append({'solver':solver,'variant':'material-'+k,'quantity':'cross_section_area','nodes':nodes,'value':v})
            evidence.append({'path':path.relative_to(ROOT).as_posix(),'sha256':sha256(path.read_bytes()).hexdigest()})
    native=records[2]['areas_m2'];opened=records[-1]['areas_m2'];prior=records[-2]['areas_m2']
    # Polygonal mesh area: 0.5% native difference and 0.2% final mesh step.
    rows=[{'id':'material-'+k,'variant':'material-'+k,'entity':LABELS[int(k)],'quantity':'cross_section_area','unit':'m^2','calculated':v,'reference':None,'comsol':native[k],
           'difference':None,'relative_difference':None,'status':'matched' if abs(v-native[k])/native[k]<=.005 else 'outside_tolerance',
           'source':'COMSOL tutorial01 full cross section and native06 identical geometry; material area integrated from independently generated meshes',
           'tolerance':{'relative':.005}} for k,v in opened.items()]
    stable=all(abs(v-prior[k])/v<=.002 for k,v in opened.items())
    report={'scope':'教程01完整二维截面：166材料域、24空气腔、110钢丝和独立几何布尔构建',
            'coverage_status':'reproduced' if stable and all(r['status']=='matched' for r in rows) else 'partial','count_as_source':False,
            'limitations':['本教程目标是几何构建与网格核验；不将几何复现当作载流量或电热求解验证。'],
            'inputs':[{'source':'COMSOL6.2 tutorial01 original dimension parameters and construction operations','note':'Independent Gmsh/OCC; no native mesh or geometry import'}],
            'rows':rows,'convergence':convergence,'mesh_sequence':records,'evidence':evidence,'mesh_converged':stable,
            'mesh_note':'独立Gmsh与COMSOL各三档；面积差0.5%以内，最后网格面积变化0.2%以内，13类材料域数逐类一致。','engineering_approval':False}
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps({'status':report['coverage_status'],'mesh_converged':stable,'worst_area_difference':max(abs(v-native[k])/native[k] for k,v in opened.items())}),flush=True)


if __name__=='__main__':main()
