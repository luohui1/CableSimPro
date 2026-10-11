"""One saved candidate, one capacity basis, one operating state for delivery.

No solving or current-library lookup: every value is witnessed by this run.
"""
import math


def _fail(message):
    raise ValueError('计算书摘要一致性校验失败：'+message)


def _same(a, b):
    return isinstance(a,(int,float)) and isinstance(b,(int,float)) and math.isfinite(a) and math.isfinite(b) and math.isclose(a,b,rel_tol=1e-9,abs_tol=1e-7)


def context(run, case_id=None):
    from .report import recommended_case
    definition=run['snapshot']['definition']
    if definition.get('driver',{}).get('kind')!='selection':return None
    assessments=run['output'].get('assessment',[])
    preferred=recommended_case(run)
    nearest=[a for a in assessments if a.get('status')=='not_satisfied' and isinstance(a.get('value'),(int,float)) and math.isfinite(a['value'])]
    selected=next((a for a in assessments if a['case_id']==preferred),None)
    if case_id is not None:selected=next((a for a in assessments if a['case_id']==case_id),None)
    if selected is None and nearest and case_id is None:selected=max(nearest,key=lambda a:(a['value'],a['case_id']))
    if selected is None:return None
    cid=selected['case_id']
    inputs=[c for c in run['snapshot'].get('cases',[]) if c['case_id']==cid]
    outputs=[c for c in run['output'].get('cases',[]) if c['case_id']==cid]
    if len(inputs)!=1 or len(outputs)!=1 or outputs[0]['status']!='succeeded':_fail('候选没有唯一的已保存成功工况。')
    try:candidate=run['snapshot']['candidate_snapshots'][int(cid.rsplit('-',1)[1])]
    except (IndexError,KeyError,ValueError):_fail('候选与工况引用不匹配。')
    output=outputs[0];document=inputs[0]['input']
    expected={'simultaneous':{'common_balanced'},'individual':{'conditional_fixed_load','single_circuit'}}.get(selected.get('rating_basis'))
    if expected is not None and len(document.get('circuits',[]))==1:expected=expected|{'single_circuit'}
    condition={'simultaneous':'rating-simultaneous','individual':definition['driver'].get('target_condition') or 'rating'}.get(selected.get('rating_basis'))
    capacities=[q for q in output.get('results',[]) if q.get('key')=='ampacity' and q.get('status')=='available'
                and (not expected or q.get('rating_basis',{}).get('kind') in expected)
                and (condition is None or q.get('case')==condition)]
    if not capacities or any(q.get('unit')!='A' or not isinstance(q.get('rating_basis'),dict) or not _same(q.get('value'),q.get('value')) for q in capacities):_fail('允许电流缺少有效保存量、单位或口径。')
    kinds={q['rating_basis'].get('kind') for q in capacities}
    if len(kinds)!=1 or not _same(min(q['value'] for q in capacities),selected.get('value')):_fail('候选判定与保存的允许电流或口径不一致。')
    quantity=min(capacities,key=lambda q:q['value']);basis=quantity['rating_basis']
    basis_text(basis)
    if basis.get('kind')=='common_balanced':
        if {q.get('entity') for q in capacities}!=set(basis.get('varied_circuits',[])):_fail('全回路共同能力的回路结果不完整。')
    target=definition['driver']['minimum']
    if not _same(selected.get('margin'),selected['value']-target):_fail('候选电流余量与目标电流不一致。')
    document_cables={c['id'] for circuit in document.get('circuits',[]) for c in circuit['cables']}
    if quantity.get('entity') not in {c['id'] for c in document.get('circuits',[])}|document_cables:_fail('允许电流对象不在该候选输入中。')
    trace=output.get('artifacts',{}).get('x-cablesim.iec60287-trace',{})
    states=trace.get('operating',{}).get('cable_states',[])
    temperatures=[q for q in output.get('results',[]) if q.get('key')=='conductor_temperature' and q.get('case')=='operating' and q.get('status')=='available']
    for q in temperatures:
        state=next((s for s in states if s['entity']==q.get('entity')),None)
        if q.get('unit')!='K' or q.get('entity') not in document_cables or state is None or not _same(q['value']-273.15,state.get('conductor_temperature_c')):_fail('导体温度与该候选保存的运行状态不一致。')
        if not _same(state.get('margin_k'),state.get('temperature_limit_c',float('nan'))-state['conductor_temperature_c']):_fail('温限余量与保存温度、温限不一致。')
    hottest=max(temperatures,key=lambda q:q['value'],default=None)
    state=next((s for s in states if hottest and s['entity']==hottest['entity']),None)
    name=candidate['payload']['name']
    if cid==preferred:
        answer=f'推荐 {name}；目标 {target:g} A，允许电流 {selected["value"]:.1f} A，电流余量 {selected["margin"]:.1f} A。推荐为满足的最小截面，不包含价格比较。'
    else:
        answer=f'无满足 {target:g} A 的候选；最接近：{name}（最接近，不满足），允许电流 {selected["value"]:.1f} A，距目标差 {target-selected["value"]:.1f} A。'
    return dict(case_id=cid,candidate=candidate,assessment=selected,document=document,output=output,
                quantity=quantity,basis=basis,recommended=cid==preferred,answer=answer,
                temperature_c=hottest['value']-273.15 if hottest else None,margin_k=state['margin_k'] if state else None)


def basis_text(basis, names=None):
    labels={'common_balanced':'全回路共同能力，所有回路同时等负荷提升',
            'single_circuit':'单回路能力','conditional_fixed_load':'其他回路固定负荷下的条件上限'}
    kind=basis.get('kind');text=labels.get(kind)
    if text is None:_fail('保存量的载流量口径未覆盖。')
    fixed=basis.get('fixed_currents_a',{})
    if fixed:text+='；固定负荷：'+'、'.join(f'{(names or {}).get(k,k)} {v:g} A' for k,v in fixed.items())
    return text+'。'
