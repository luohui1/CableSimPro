"""IEC60949 AMD1 §4 resistance sharing, with explicit component conditions."""
from math import isfinite, sqrt, log
from cablesim_type_electrical.short_basis import record, attach


def fault_sharing(parameters, rows, add):
    p=parameters
    needed=[key for key in ('bonding_model','return_path','screen_fault_current_a','metal_capacity_basis') if not p.get(key) or not p.get('sources',{}).get(key)]
    if not p.get('duration_s') or not p.get('sources',{}).get('duration_s'):needed.append('duration_s')
    components=p.get('parallel_components',[])
    ref=record(p,'sc-parallel-metal-current/r1/parallel_metal_short_circuit_rule')
    if not components: needed.append('parallel_components')
    if needed or not ref:
        row=add('parallel-fault-sharing','金属回路故障分流校核',None,'A','4 amendment',2,source='iec60949_amendment',reason='需工程输入：接地连接、故障回流路径、故障电流，以及每个并联部件的电阻、初温、终温和来源；不默认各组件同温。')
        row.update(missing_parameters=needed,input_category='system');attach(row,[ref]);return
    if p['bonding_model']!='both_ends' or p['return_path']!='metallic_only':
        row=add('parallel-fault-sharing','金属回路故障分流校核',None,'A','4 amendment',2,source='iec60949_amendment',status='missing',reason='需工程输入：单端或交叉互联及大地分流的实际线路网络；本分支只覆盖已确认两端连续金属回流的电阻分配。')
        row.update(missing_parameters=['bonding_model','return_path'],input_category='system');attach(row,[ref]);return
    available={r['id']:r for r in rows if r['id'].endswith('-adiabatic') and r['target']['role'] in ('metallic_screen','metallic_sheath','armour')}
    seen=set(); conductance=[]
    for component in components:
        keys={'row_id','resistance_ohm','initial_temperature_k','final_temperature_k','source'}
        if set(component)!=keys or component['row_id'] not in available or component['row_id'] in seen or not isinstance(component['source'],str) or not component['source'].strip():
            raise ValueError('并联金属组件：每项必须选择独立部件，填写电阻、初末温度和来源，不能重复或漏字段。')
        for key in ('resistance_ohm','initial_temperature_k','final_temperature_k'):
            if isinstance(component[key],bool) or not isinstance(component[key],(int,float)) or not isfinite(component[key]) or component[key]<=0:
                raise ValueError('并联金属组件：电阻单位 Ω、温度单位 K，须为有限正值。')
        if not 223.15<=component['initial_temperature_k']<component['final_temperature_k']<=773.15:
            raise ValueError('并联金属组件：初末温度须在允许范围内且终温高于初温。')
        seen.add(component['row_id']);conductance.append(1/component['resistance_ohm'])
    if seen!=set(available):
        raise ValueError('并联金属组件：请列出全部回流部件；不能通过省略一个屏蔽或铠装部件降低故障电流。')
    total=sum(conductance);details=[]
    for component,g in zip(components,conductance):
        row=available[component['row_id']]; inputs=row['formula_inputs'];share=g/total
        factor=1 if p['metal_capacity_basis']=='adiabatic' else next(r['value'] for r in rows if r['id']==row['id'].replace('-adiabatic','-factor'))
        current=p['screen_fault_current_a']*share
        capacity=inputs['K']*inputs['S_mm2']*sqrt(log((component['final_temperature_k']-273.15+inputs['beta_K'])/(component['initial_temperature_k']-273.15+inputs['beta_K']))/p['duration_s'])*factor if factor is not None and inputs['K'] is not None and inputs['S_mm2'] is not None and p.get('duration_s') else None
        details.append({**component,'share':share,'fault_current_a':current,'capacity_a':capacity,'margin_a':capacity-current if capacity is not None else None})
        check=next(r for r in rows if r['id']==row['id'].replace('-adiabatic','-fault-check'))
        check.update(value=capacity-current if capacity is not None else None,status='available' if capacity is not None and capacity>=current else 'failed' if capacity is not None else 'missing',missing_parameters=[],satisfied=capacity>=current if capacity is not None else None,
            formula_inputs=details[-1],reason='按已声明电阻及各自初末温度分流；余量为组件容量减该组件故障电流。',basis_references=check['basis_references']+[ref])
    margin=min(d['margin_a'] for d in details) if all(d['margin_a'] is not None for d in details) else None
    row=add('parallel-fault-sharing','金属回路故障分流校核',margin,'A','4 amendment',2,source='iec60949_amendment',status='available' if margin is not None and margin>=0 else 'failed' if margin is not None else 'missing',
        formula='I_i=I_fault(1/R_i)/Σ(1/R_j)；逐部件校核 I_i≤I_allow,i',inputs={'components':details,'fault_current_a':p['screen_fault_current_a']},reason='显示最小组件余量；未将各组件容量相加。')
    row.update(satisfied=margin>=0 if margin is not None else None,input_category='system');attach(row,[ref])
