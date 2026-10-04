"""Compare explicit observations with sourced references; never certify engineering use."""
from math import isfinite
from hashlib import sha256
import json


def digest(value):
    """Shared sorted UTF-8 JSON digest; preserves existing open-solver hashes."""
    return sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,allow_nan=False).encode('utf-8')).hexdigest()


def comparison(observed,reference,numerical):
    rows=[]
    for target in reference.get('targets',[]):
        if not {'id','quantity','entity','unit','reference','tolerance','source'}<=set(target):
            raise ValueError('复现目标字段不完整。')
        matches=[o for o in observed if all(o.get(k)==target.get(k) for k in ('quantity','entity','probe_index','time_s'))]
        value=matches[0]['value'] if len(matches)==1 and matches[0]['unit']==target['unit'] else None
        ref,tol=target['reference'],target['tolerance']
        if ref is not None and (isinstance(ref,bool) or not isinstance(ref,(int,float)) or not isfinite(ref)):
            raise ValueError('参考数值必须有限。')
        if tol is not None and (set(tol)!={'absolute','source'} or not tol['source'] or not isinstance(tol['absolute'],(int,float)) or isinstance(tol['absolute'],bool) or not isfinite(tol['absolute']) or tol['absolute']<0):
            raise ValueError('容差必须有预先声明的来源和非负有限绝对值。')
        delta=None if value is None or ref is None else value-ref
        reason=None
        if target.get('comparison_allowed') is False:
            status,reason='not_comparable',target.get('comparison_reason','统计口径不同。')
        elif ref is None:status='missing_reference'
        elif value is None:status,reason='not_comparable','物理量、单位、测点或时间无法唯一匹配。'
        elif tol is None:status='not_assessed'
        else:status='matched' if abs(delta)<=tol['absolute'] else 'outside_tolerance'
        rows.append({**target,'calculated':value,'difference':delta,'absolute_difference':abs(delta) if delta is not None else None,
                     'relative_difference':delta/abs(ref) if delta is not None and ref and target['unit']!='K' else None,'status':status,'reason':reason})
        solver_reference=reference.get('reference_solver')
        if solver_reference:
            same_input=bool(numerical.get('problem_sha256')) and solver_reference.get('problem_sha256')==numerical['problem_sha256']
            candidates=[o for o in solver_reference.get('observations',[]) if all(o.get(k)==target.get(k) for k in ('quantity','entity','unit','probe_index','time_s'))]
            other=candidates[0].get('value') if same_input and len(candidates)==1 else None
            if other is not None and (isinstance(other,bool) or not isinstance(other,(float,int)) or not isfinite(other)):
                raise ValueError('参考求解器数值必须有限。')
            rows[-1].update(reference_solver=solver_reference.get('name'),reference_solver_value=other,
                            difference_from_reference_solver=value-other if value is not None and other is not None else None,
                            solver_comparison_status='same_problem' if other is not None else 'not_comparable')
    statuses={r['status'] for r in rows}
    status='matched' if statuses=={'matched'} else 'outside_tolerance' if 'outside_tolerance' in statuses else 'incomplete' if rows else 'missing_reference'
    return {'schema':'cablesim.reproduction-report/1','kind':'case','reference':reference.get('citation'),
            'scope':reference.get('scope','External solver numerical study'), 'frozen_inputs':reference.get('frozen_inputs',[]),
            'status':status,'rows':rows,'missing_inputs':reference.get('missing_inputs',[]),'assumptions':reference.get('assumptions',[]),
            'numerical_evidence':numerical,'calculated_solver':numerical.get('solver'),
            'reference_solver':reference.get('reference_solver'),'engineering_approval':False}

