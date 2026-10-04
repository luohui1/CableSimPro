"""Run primitive-input TB880 reference chains through the signed plugin host."""
from pathlib import Path
from dataclasses import asdict
from hashlib import sha256
import json
import sys
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT))
from backend.plugin_host import Executor


def main():
    out=ROOT/'.data/tb880/complete-references';out.mkdir(parents=True,exist_ok=True)
    jobs=ROOT/'.tmp/simulation-seventh-tb880';jobs.mkdir(parents=True,exist_ok=True)
    expected={2:('submarine',{'ampacity_a':838.3399739336,'conductor_loss_w_m':88.78608438409,'sheath_loss_w_m':14.4576402222,'armour_loss_w_m':37.3481046684}),
              4:('wire-screen',{'ampacity_a':537.4631099368,'conductor_loss_w_m':28.20166532,'sheath_loss_w_m':1.2271183509})}
    for number,(name,references) in expected.items():
        source=Path(__file__).parent/'fixtures'/('tb880-'+name+'.json');value=json.loads(source.read_text('utf-8'))
        run=asdict(Executor(jobs_root=jobs).run('cablesim.iec60287','tb880-reference-rating',[{'case_id':'case-'+str(number),'input':value,'parameters':{}}]))
        (out/f'case-{number}-run.json').write_text(json.dumps(run,ensure_ascii=False,indent=2),'utf-8')
        case=run['cases'][0]
        if case['status']!='succeeded':raise RuntimeError(case['error'])
        result=case['artifacts']['x-cablesim.iec60287-reference']
        rows=[{'id':key,'quantity':key,'unit':'A' if key=='ampacity_a' else 'W/m','calculated':result[key],'reference':ref,'difference':result[key]-ref,
               'relative_difference':(result[key]-ref)/ref,'comsol':None,'status':'matched' if abs(result[key]-ref)<=5e-5 else 'outside_tolerance',
               'source':value['source_reference'],'tolerance':{'absolute':5e-5}} for key,ref in references.items()]
        report={'coverage_status':'reproduced' if all(r['status']=='matched' for r in rows) else 'partial','scope':'原始几何与材料→电阻/电容/热阻→护套和铠装损耗→温度耦合迭代→载流量',
                'rows':rows,'convergence':[],'inputs':[{'source':source.relative_to(ROOT).as_posix(),'note':'全部原始SI参数；不使用参考Rc/Rs/λ/T1–T4作为输入','sha256':sha256(source.read_bytes()).hexdigest()}],
                'limitations':result['limitations'],'mesh_note':'代数和热路迭代，无有限元网格；完整迭代历史保存在封存工件。',
                'runs':[{k:run[k] for k in ('run_id','plugin_id','plugin_version','method_version','request_sha256')}],
                'artifact_sha256':case['artifact_digests']['x-cablesim.iec60287-reference'],'source_sha256':value['source_sha256'],'engineering_approval':False}
        (out/f'case-{number}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
        print(json.dumps({'case':number,'status':report['coverage_status'],'ampacity_a':result['ampacity_a'],'iterations':len(result['history'])}),flush=True)
    rows=[];runs=[];inputs=[];artifacts=[]
    for variant,current,targets in [
        ('trefoil',990.5401450554,[(90.,21.7334261256,12.7998446427,4.3814875547)]*3),
        ('flat',1460.4545417538,[(90.,46.339394097,.4531725789,.2842802473),(85.0252936286,45.7747093487,.6331964226,.2133339555),(84.9130417812,45.7619829087,.4819647423,.1727253769)])]:
        source=Path(__file__).parent/'fixtures'/('tb880-wire-foil-'+variant+'.json');value=json.loads(source.read_text('utf-8'))
        run=asdict(Executor(jobs_root=jobs).run('cablesim.iec60287','tb880-wire-foil-rating',[{'case_id':'case1-'+variant,'input':value,'parameters':{}}]))
        (out/f'case-1-{variant}-run.json').write_text(json.dumps(run,ensure_ascii=False,indent=2),'utf-8');case=run['cases'][0]
        if case['status']!='succeeded':raise RuntimeError(case['error'])
        result=case['artifacts']['x-cablesim.iec60287-reference']
        def add(key,entity,calculated,reference,unit):
            rows.append({'id':variant+'/'+entity+'/'+key,'variant':variant,'entity':entity,'quantity':key,'unit':unit,'calculated':calculated,'reference':reference,
                         'difference':calculated-reference,'relative_difference':None if unit=='K' else (calculated-reference)/reference,'comsol':None,
                         'status':'matched' if abs(calculated-reference)<=5e-5 else 'outside_tolerance','source':value['source_reference'],'tolerance':{'absolute':5e-5}})
        add('ampacity_a','circuit',result['ampacity_a'],current,'A')
        for state,target in zip(result['states'],targets):
            for key,reference,unit in zip(('conductor_temperature_k','conductor_loss_w_m','screen_loss_w_m','foil_loss_w_m'),(target[0]+273.15,*target[1:]),('K','W/m','W/m','W/m')):
                add(key,state['phase'],state[key],reference,unit)
        runs.append({k:run[k] for k in ('run_id','plugin_id','plugin_version','method_version','request_sha256')});artifacts.append(case['artifact_digests']['x-cablesim.iec60287-reference'])
        inputs.append({'source':source.relative_to(ROOT).as_posix(),'sha256':sha256(source.read_bytes()).hexdigest(),'note':'原始SI参数；屏蔽和铝箔并联及三相热耦合完整迭代。'})
        print(json.dumps({'case':1,'variant':variant,'ampacity_a':result['ampacity_a'],'iterations':len(result['history'])}),flush=True)
    report={'coverage_status':'reproduced' if all(r['status']=='matched' for r in rows) else 'partial','scope':'Case1三叶形固接与不换位平排不平衡交叉互联：完整铜丝/铝箔并联电损耗和三相热迭代；两个分支只计一个案例',
            'rows':rows,'convergence':[],'inputs':inputs,'limitations':result['limitations'],'mesh_note':'代数和热路迭代；完整历史在封存工件，无有限元网格。',
            'runs':runs,'artifact_sha256':artifacts,'source_sha256':value['source_sha256'],'engineering_approval':False}
    (out/'case-1.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps({'case':1,'status':report['coverage_status']}),flush=True)


if __name__=='__main__':main()
