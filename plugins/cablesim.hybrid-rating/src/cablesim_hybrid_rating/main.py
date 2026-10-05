"""First-party cablesim.run/2 entry; training is restricted to Slurm CPUs."""
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(ROOT/'plugins/cablesim.iec60287/src'))
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/src'))
import json
import os
import platform
from cablesim_hybrid_rating.features import digest


def run_case(request,case,job):
    try:
        capability=request['capability'];p=case.get('parameters',{})
        if capability in ('training-sample','physics-comparison'):
            if request['phase']=='run' and not os.environ.get('SLURM_JOB_ID'):
                raise ValueError('ENVIRONMENT_MISSING：有限元标签必须提交Slurm；本机不求解。')
            from cablesim_hybrid_rating.labels import calculate,Settings
            if request['phase']=='check':
                Settings.model_validate(p)
                return {'case_id':case['case_id'],'status':'succeeded','results':[],'artifacts':[]}
            payload=calculate(case['input'],p);kind='x-cablesim.dataset-sample'
            if capability=='physics-comparison':
                from cablesim_hybrid_rating.comparison import present
                payload=present(payload,case['input'],p);kind='x-cablesim.physics-comparison'
            results=[{'key':'ampacity','type':'quantity','entity':p['controls']['rated_circuit'],
                      'status':'available' if payload['valid'] else 'unavailable','unit':'A',
                      **({'value':payload['hybrid']['fem']['ampacity_a'] if capability=='training-sample' else payload['methods'][1]['ampacity_a']} if payload['valid'] else {'reason':payload['reason']})}]
        elif capability=='train-model':
            if not os.environ.get('SLURM_JOB_ID'):raise ValueError('ENVIRONMENT_MISSING：训练必须提交Slurm CPU。')
            from cablesim_hybrid_rating.training import train
            if request['phase']=='check':
                return {'case_id':case['case_id'],'status':'succeeded','results':[],'artifacts':[]}
            payload=train(case['input'],p);kind='x-cablesim.hybrid-model'
            results=[{'key':'x-cablesim.training-samples','type':'quantity','entity':'section/training',
                      'status':'available','unit':'1','value':payload['dataset']['valid_samples']}]
        elif capability=='steady-rating':
            from cablesim_hybrid_rating.inference import predict
            payload=predict(case['input'],p,ROOT)
            if request['phase']=='check':
                return {'case_id':case['case_id'],'status':'succeeded','results':[],'artifacts':[],
                        'evidence':{'model_sha256':payload['model_sha256']}}
            kind='x-cablesim.hybrid-prediction'
            results=[{'key':key,'type':'quantity','entity':payload['rated_circuit'],'status':'available',
                      'unit':unit,'value':payload[key]} for key,unit in [('ampacity','A'),('conductor_temperature','K')]]
        else:raise ValueError('capability：未知混合模型能力。')
        name='output/'+case['case_id']+'.json'
        (job/name).write_text(json.dumps(payload,ensure_ascii=False,allow_nan=False),encoding='utf-8')
        return {'case_id':case['case_id'],'status':'succeeded','results':results,
                'artifacts':[{'type':kind,'path':name}],
                'evidence':{'input_sha256':digest(case['input']),'authority':'reference_only'},
                'warnings':[{'code':'REFERENCE_ONLY','message':'混合模型仅参考，工程使用须通过独立实测验收及人工批准。'}]}
    except Exception as exc:
        return {'case_id':case['case_id'],'status':'failed','results':[],'artifacts':[],
                'error':{'code':getattr(exc,'code',type(exc).__name__),'message':str(exc)}}


def main():
    job=Path.cwd();request=json.loads((job/'input/request.json').read_text('utf-8'))
    if request.get('protocol')!='cablesim.run/2' or request.get('phase') not in ('check','run'):
        raise SystemExit('unsupported protocol or phase')
    (job/'output').mkdir(exist_ok=True)
    cases=[run_case(request,case,job) for case in request['cases']]
    response={'protocol':'cablesim.run/2','cases':cases,
        'environment':{'python':platform.python_version(),'platform':platform.platform(),
            'slurm_job_id':os.environ.get('SLURM_JOB_ID')}}
    (job/'output/result.json').write_text(json.dumps(response,ensure_ascii=False,allow_nan=False),encoding='utf-8')


def resident_warmup():
    from cablesim_hybrid_rating.inference import predict


def resident_main():
    main()


if __name__=='__main__':main()
