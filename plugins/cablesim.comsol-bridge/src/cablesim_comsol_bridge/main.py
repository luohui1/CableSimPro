"""Optional COMSOL method using the existing cablesim.run/2 host protocol."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[4]))
import json
import platform
import shutil
from hashlib import sha256
from pydantic import ValidationError
from backend.foundation.reproduction import comparison
from cablesim_comsol_bridge.adapter import prepare, solve, digest
from cablesim_comsol_bridge.java_model import source
from cablesim_comsol_bridge.runtime import execute


def run_case(request, case, job):
    work=job/'output'/('native-'+case['case_id'])
    try:
        problem, controls = prepare(case['input'], case.get('parameters', {}))
        expected = 'magnetic_harmonic' if request['capability']=='magnetic-reference' else 'steady_heat'
        if request['capability'] not in ('magnetic-reference','thermal-reference') or problem['physics']!=expected:
            raise ValueError('physics：所选 COMSOL 能力与问题物理类型不符。')
        work=job/'output'/('native-'+case['case_id'])
        required=['COMSOL','ACDC' if expected=='magnetic_harmonic' else 'HEATTRANSFER']
        evidence={'input_sha256':digest(case['input']),'problem_sha256':digest(problem),
                  'plugin_manifest_sha256':sha256((Path(__file__).resolve().parents[2]/'plugin.json').read_bytes()).hexdigest()}
        if request['phase']=='check':
            _, solver=execute(source(problem,controls,check=True),work,required,save_model=False)
            return {'case_id':case['case_id'],'status':'succeeded','results':[],'artifacts':[],'evidence':{**evidence,'solver':solver}}
        mesh,result,observations=solve(problem,controls,work)
        evidence.update(mesh_sha256=mesh['sha256'],solver=result['solver'])
        numerical={'nodes':len(mesh['points']),'elements':len(mesh['triangles']),'mesh_sha256':mesh['sha256'],'problem_sha256':digest(problem),'solver':result['solver']}
        report=comparison(observations,case.get('parameters',{}).get('reproduction',{}),numerical)
        report['run']={'run_id':request['run_id'],**evidence}
        report['reference_solver']={**result['solver'],'role':'optional-commercial-reference','observations':observations}
        bundle={'schema':'cablesim.simulation-bundle/2','problem':problem,'mesh':mesh,'result':result,
                'observations':observations,'evidence':evidence,'engineering_approval':False}
        artifacts=[]
        for suffix,kind,payload in [('', 'x-cablesim.simulation-bundle',bundle),('-comparison','x-cablesim.reproduction-report',report)]:
            raw=json.dumps(payload,ensure_ascii=False,allow_nan=False,separators=(',',':'))
            if len(raw.encode())>16*1024*1024:raise ValueError('COMSOL 结果超过宿主单工件 16 MiB 上限；请减少网格节点后另建运行。')
            path='output/'+case['case_id']+suffix+'.json';(job/path).write_text(raw,'utf-8')
            artifacts.append({'type':kind,'path':path})
        values=([{'key':'x-cablesim.joule-loss','entity':r['entity'],'value':r['joule_loss_w_m'],'unit':'W/m'} for r in result['regions']]
                if expected=='magnetic_harmonic' else [{'key':'x-cablesim.maximum-temperature','entity':'field','value':result['final_field']['maximum_k'],'unit':'K'}])
        return {'case_id':case['case_id'],'status':'succeeded','results':[dict(v,type='quantity',status='available') for v in values],
                'artifacts':artifacts,'evidence':evidence,'warnings':[{'code':'COMMERCIAL_REFERENCE','message':'COMSOL 为可选内部对照；本次比较不构成标准认证或工程批准。'}]}
    except ValidationError as exc:
        message='；'.join('.'.join(map(str,e['loc']))+': '+e['msg'] for e in exc.errors()[:20])
        return {'case_id':case['case_id'],'status':'failed','error':{'code':'INPUT_INVALID','message':message}}
    except Exception as exc:
        return {'case_id':case['case_id'],'status':'failed','error':{'code':type(exc).__name__,'message':str(exc)}}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    job=Path.cwd();request=json.loads((job/'input/request.json').read_text('utf-8'))
    if request.get('protocol')!='cablesim.run/2' or request.get('phase') not in ('check','run'):
        raise ValueError('不支持的运行协议。')
    result={'protocol':'cablesim.run/2','cases':[run_case(request,c,job) for c in request['cases']],
            'environment':{'python':platform.python_version(),'platform':platform.platform(),'reference_solver':'COMSOL external; user-owned commercial license'}}
    (job/'output/result.json').write_text(json.dumps(result,ensure_ascii=False,allow_nan=False),'utf-8')


if __name__=='__main__':main()
