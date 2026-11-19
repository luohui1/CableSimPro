"""Isolated v2 entry. Never reads the project DB or embeds coefficient tables."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[4]))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import json
import platform
from pydantic import ValidationError
from backend.plugin_host.registry import PluginHostError
from cablesim_gb50217_correction.correction import calculate, CorrectionError, ARTIFACT, BASELINE, FACTOR
from cablesim_gb50217_correction.outdoor import calculate_outdoor
from cablesim_sdk.parameter_units import decode_request
from cablesim_sdk.result_answers import attach_witnesses
from cablesim_sdk.ampacity import AmpacityBasis


def main():
    manifest=Path(__file__).resolve().parents[2]/'plugin.json'
    request=decode_request(json.loads(Path('input/request.json').read_text('utf-8')),manifest)
    handler,method_version={'steady-rating':(calculate,'1.1.0'),
                            'outdoor-unshaded-rating':(calculate_outdoor,'1.0.0')}[request['capability']]
    cases=[]
    for case in request['cases']:
        try:
            trace=handler(case['input'],case.get('parameters',{}))
            if request['phase']=='check':
                cases.append(dict(case_id=case['case_id'],status='succeeded',results=[],artifacts=[]))
                continue
            path='output/'+case['case_id']+'.correction.json'
            Path(path).write_text(json.dumps(trace,ensure_ascii=False,allow_nan=False),'utf-8')
            results=[]
            circuits=case['input']['circuits']
            rating_basis=AmpacityBasis(kind='single_circuit' if len(circuits)==1 else 'common_balanced',
                display_name='单回路能力' if len(circuits)==1 else '全回路共同能力',
                varied_circuits=[c['id'] for c in circuits]).model_dump()
            for circuit in case['input']['circuits']:
                for key,value,unit,title in [('ampacity',trace['corrected_current_a'],'A','校正后允许电流'),(BASELINE,trace['baseline']['baseline_current_a'],'A','基准载流量'),(FACTOR,trace['total_factor'],'1','总校正系数')]:
                    results.append(dict(key=key,type='quantity',entity=circuit['id'],status='available',value=value,unit=unit,case='rating-simultaneous',title=title,
                        **({'rating_basis':rating_basis} if key=='ampacity' else {})))
            cases.append(dict(case_id=case['case_id'],status='succeeded',results=results,
                artifacts=[dict(type=ARTIFACT,path=path)],evidence=dict(headline=trace['headline'],basis_release_digests=list(dict.fromkeys(r['release_digest'] for r in trace['coefficients'])))))
        except CorrectionError as exc:
            cases.append(dict(case_id=case['case_id'],status='not_applicable',error=dict(code=exc.code,message=str(exc),field=exc.field)))
        except ValidationError as exc:
            first=exc.errors()[0]; field=('/parameters/' if exc.title in ('Parameters','OutdoorParameters') else '/input/')+'/'.join(str(v).replace('~','~0').replace('/','~1') for v in first['loc'])
            cases.append(dict(case_id=case['case_id'],status='failed',error=dict(code='INPUT_INVALID',message='请补齐或修正该字段；数值必须使用契约规定的 SI 单位。',field=field)))
        except PluginHostError as exc:
            cases.append(dict(case_id=case['case_id'],status='failed',error=dict(code=exc.code,message=exc.message,field='/parameters/baseline_source')))
    result=dict(protocol='cablesim.run/2',cases=cases,environment=dict(python=platform.python_version(),packages={},method=method_version))
    attach_witnesses(request,result,manifest)
    Path('output/result.json').write_text(json.dumps(result,ensure_ascii=False,allow_nan=False),'utf-8')


if __name__=='__main__':main()
