"""统一论文复现报告：缺失、不可比、超差与达标是不同状态。"""
from math import isfinite
from backend.foundation.reproduction import digest


def comparison(summary, field, reference):
    rows = []
    states = {s['entity']:s for s in summary['cables']}
    for target in reference.get('targets',[]):
        required = {'id','quantity','entity','unit','reference','tolerance','source'}
        if not required <= set(target):
            raise ValueError('复现目标必须声明量、实体、单位、参考值、容差和原文定位。')
        value = None
        reason = None
        quantity,entity = target['quantity'],target['entity']
        if quantity in ('conductor_max_temperature_k','conductor_mean_temperature_k') and entity in states:
            value = states[entity][quantity]
        elif quantity == 'interface_nodal_mean_k' and target.get('layer_uid'):
            value = states.get(entity,{}).get('interface_nodal_mean_k',{}).get(target['layer_uid'])
        elif quantity == 'ampacity_a' and summary['rating'] and summary['rating']['circuit'] == entity:
            value = summary['rating']['ampacity_a']
        elif quantity == 'probe_temperature_k' and target.get('point_m'):
            import numpy as np
            from skfem import MeshTri, Basis, ElementTriP1
            try:
                basis = Basis(MeshTri(np.asarray(field['points']).T,np.asarray(field['triangles']).T),ElementTriP1())
                value = float((basis.probes(np.asarray(target['point_m'],dtype=float).reshape(2,1))@np.asarray(field['temperature']))[0])
            except ValueError:
                reason = '观测点不在计算网格内。'
        expected_unit = 'A' if quantity == 'ampacity_a' else 'K'
        if target['unit'] != expected_unit:
            raise ValueError('比较目标必须显式采用SI单位：'+expected_unit)
        ref = target['reference']
        tolerance = target['tolerance']
        if tolerance is not None and (set(tolerance) != {'absolute','source'} or not tolerance['source'] or not isinstance(tolerance['absolute'],(float,int)) or not isfinite(tolerance['absolute']) or tolerance['absolute'] < 0):
            raise ValueError('容差必须含非负有限绝对值及来源，不能运行后补猜。')
        if ref is not None and (isinstance(ref,bool) or not isinstance(ref,(float,int)) or not isfinite(ref)):
            raise ValueError('论文参考值必须为有限实数或null。')
        difference = None if ref is None or value is None else value-ref
        if target.get('comparison_allowed') is False:
            status,reason = 'not_comparable',target.get('comparison_reason','原文和计算统计量不同。')
        elif ref is None:
            status,reason = 'missing_reference','未取得该目标的原文数值。'
        elif value is None:
            status,reason = 'not_comparable',reason or '求解结果没有相同物理量/实体。'
        elif tolerance is None:
            status,reason = 'not_assessed','未预先规定容差。'
        else:
            status = 'matched' if abs(difference) <= tolerance['absolute'] else 'outside_tolerance'
        # 温度只报绝对K差；没有参考环境温度时不生成误导性的相对百分比。
        relative = difference/abs(ref) if difference is not None and ref and expected_unit != 'K' else None
        rows.append({**target,'calculated':value,'difference':difference,'absolute_difference':None if difference is None else abs(difference),
                     'relative_difference':relative,'status':status,'reason':reason})
    statuses = {r['status'] for r in rows}
    if not rows:
        status = 'missing_reference'
    elif 'outside_tolerance' in statuses:
        status = 'outside_tolerance'
    elif statuses == {'matched'}:
        status = 'matched'
    else:
        status = 'incomplete'
    return {'schema':'cablesim.reproduction-report/1','kind':'case','reference':reference.get('citation'),
            'scope':reference.get('scope','数值方法研究；未声明完整论文复现'),
            'status':status,'rows':rows,'missing_inputs':reference.get('missing_inputs',[]),
            'assumptions':reference.get('assumptions',[]),'engineering_approval':False,
            'numerical_evidence':{k:summary[k] for k in ('nodes','elements','mesh_size_m','energy_relative_residual','physical_residual_inf_w_m')}}


def blocked(reference):
    return {'schema':'cablesim.reproduction-report/1','kind':'blocked','reference':reference['citation'],
            'scope':reference.get('scope'),'status':'blocked_missing_input','rows':[],
            'missing_inputs':reference['missing_inputs'],'assumptions':[],
            'engineering_approval':False,'numerical_evidence':None,'run':None}
