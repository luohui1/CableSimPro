"""Render saved typed results only; importing a solver here is a design violation."""
from html import escape
import json

RENDERER = 'cablesim.study-html/22'


def formatted(value, digits=1):
    if value is None:
        return '未输出'
    return f'{value:,.{digits}f}'.replace(',', ' ') if abs(value) >= 10000 else f'{value:.{digits}f}'


def task_answer(run):
    definition = run['snapshot']['definition']
    if definition['driver']['kind']=='selection' and definition['driver']['candidate_ids']:
        return selection_answer(run)
    if definition['driver']['kind'] == 'sweep':
        return sweep_answer(run)
    preferred = recommended_case(run)
    case = next((c for c in run['output']['cases'] if (not preferred or c['case_id']==preferred) and not c['case_id'].startswith('crosscheck-') and c['status'] == 'succeeded'), None)
    if case is None:
        return '<p class="answer">当前任务未取得可用结果。</p>'
    task = definition.get('task')
    correction=case.get('artifacts',{}).get('x-cablesim.gb50217-correction')
    if correction:
        return '<p class="answer">'+escape(correction['headline'])+'</p>'
    if task == 'iec-fem-comparison':
        comparison=case.get('artifacts',{}).get('x-cablesim.iec-fem-comparison')
        return '<p class="answer">'+escape(comparison['conclusion'] if comparison else '比较工件缺失，无法判断。')+'</p>'
    if task in ('transient-temperature', 'sheath-losses', 'electrothermal-steady'):
        label = {'transient-temperature':'暂态温升', 'sheath-losses':'护套损耗', 'electrothermal-steady':'电热耦合'}[task]
        return '<p class="answer">'+escape(label+'：结果来自保存的超算运行；温度、损耗与迭代证据见本章，来源工件摘要见运行记录。')+'</p>'
    armour=case.get('artifacts',{}).get('x-cablesim.iec60287-armour')
    if armour:
        return '<p class="answer">'+escape('三芯钢丝铠装SL热路：允许电流 '+formatted(armour['ampacity_a'],3)+' A，λ₂='+formatted(armour['lambda2'],8)+'；同一工作点输入，限定范围。')+'</p>'
    artifact = next((v for v in case.get('artifacts', {}).values() if isinstance(v, dict) and 'goal_checks' in v), {})
    if artifact.get('crossing_derating'):
        row=artifact['crossing_derating'][0]
        return '<p class="answer">'+escape(f"交叉热源降额：{row['baseline_current_a']:.1f} A → {row['derated_current_a']:.1f} A，系数 {row['derating_factor']:.4f}；{row['clause']}。")+'</p>'
    all_checks = artifact.get('goal_checks', [])
    checks = {key: min((g for g in all_checks if g['key'] == key),key=lambda g:g.get('margin') if g.get('margin') is not None else float('inf'),default=None)
              for key in ('ampacity','conductor_temperature')}
    current, temperature = checks.get('ampacity'), checks.get('conductor_temperature')
    task = definition.get('task') or 'rating'
    if artifact.get('schema') == 'cablesim.iec60287.group-trace/1':
        state = artifact['operating']
        if not state['cable_states']:
            common=artifact.get('simultaneous_rating',{})
            return '<p class="answer">'+escape('全回路等负荷允许电流 '+formatted(common.get('ampacity_a'))+' A；目标负荷下无有效稳态温度解，目标负荷不满足。')+'</p>'
        hot = next(s for s in state['cable_states'] if s['entity'] == state['hottest_cable'])
        passed = all(g['verdict'] == 'satisfied' for g in all_checks if g['key'] == ('conductor_temperature' if task == 'operating' else 'ampacity'))
        relevant = [g for g in all_checks if g['key'] == ('conductor_temperature' if task == 'operating' else 'ampacity')]
        verdict = '无法判断' if any(g['verdict'] == 'unavailable' for g in relevant) else '满足' if passed else '不满足'
        text = (f"保存负荷下最热电缆 {hot['entity']}，导体 {formatted(hot['conductor_temperature_c'])} °C；"
                f"全线路温限{'满足' if all(s['margin_k'] >= 0 for s in state['cable_states']) else '不满足'}，最小温度余量 {formatted(min(s['margin_k'] for s in state['cable_states']))} K。")
        if task != 'operating':
            text += ' '+('目标电流校核'+verdict+'；' if task == 'target' else '')+'；'.join(r['label']+'允许电流 '+formatted(r['ampacity_a'])+' A' for r in artifact['circuit_ratings'])+'。'+artifact['rating_basis']
    elif task == 'operating' and temperature and temperature.get('actual') is not None:
        text = (f"{formatted(temperature.get('current_a'))} A 时最高导体温度 {formatted(temperature['actual']-273.15)} °C"
                f"（{temperature.get('phase') or '未输出'} 相），温限 {formatted(temperature['target']-273.15)} °C，余量 {formatted(temperature['margin'])} K。")
    elif task == 'target' and current:
        verdict = {'satisfied': '满足', 'not_satisfied': '不满足', 'unavailable': '无法判断'}[current['verdict']]
        margin = (f"裕度 {formatted(current['margin_percent'])} %" if current.get('margin_percent') is not None
                  else f"余量 {formatted(current['margin'])} A")
        text = f"目标 {formatted(current['target'])} A：{verdict}，允许电流 {formatted(current['actual'])} A，{margin}。"
    elif current:
        text = f"允许电流 {formatted(current['actual'])} A；限制相 {artifact.get('summary', {}).get('limiting_phase') or '方法未输出'}。"
    else:
        text = '此历史运行未输出所选任务的目标答复，保留原始物理量。'
    if artifact.get('corrugated_sheaths'):
        text += ' 结论依赖声明的波谷接触、缓冲/间隙物性及几何参考参数，详见皱纹护套参数节。'
        if any(s.get('kind') == 'user' for s in definition.get('input_sources', {}).values()):
            text += ' 工程师给定参考参数不是厂家实测值，本计算结果不是厂家额定载流量。'
    method = definition['method']
    label = {'cablesim.thermal-network': '交叉校核参考', 'cablesim.iec60287': 'IEC 60287 解析法'}.get(method['plugin_id'], method['plugin_id'])
    return '<p class="answer">'+escape(text+' '+label+' · '+method['version']+'。')+'</p>'


def shared_input_summary(run):
    from .report_selection import context
    chosen=context(run)
    preferred=chosen['case_id'] if chosen else recommended_case(run)
    case = next((c for c in run['snapshot'].get('cases',[]) if c['case_id']==preferred),next(iter(run['snapshot'].get('cases', [])), {}))
    document = case.get('input', {})
    if document.get('schema_version') != 'cablesim.domain/1':
        return ''
    cable, section, circuit = document['cable_types'][0], document['sections'][0], document['circuits'][0]
    soil = next((m for m in document['materials'] if m['id'] == section['medium'].get('material')), {})
    binding = run['snapshot'].get('workspace_state', {}).get('study_cable_reference') or {}
    loads = document['load_cases'][0]['currents']
    depth = -sum(p['z'] for p in section['placements'])/len(section['placements'])
    return '<h3 data-section="shared-input">本次引用的共享输入</h3>'+table(['对象', '采用值', '来源'], [
        ['电缆型号', cable['label']+' · '+str(binding.get('version') or '研究本地输入'), binding.get('source') or '保存的领域电缆'],
        ['平均中心埋深', formatted(depth, 3)+' m', '保存的截面坐标'],
        ['土壤热阻率', formatted(soil.get('thermal_resistivity'), 2)+' K·m/W', '保存的介质材料'],
        *[[c['label']+'负荷', ' / '.join(i['phase']+' '+formatted(loads.get(i['id'],loads.get(c['id'])))+' A' for i in c['cables']), '保存的负荷工况；逐根值优先'] for c in document['circuits']],
        ['环境温度', formatted((section['medium'].get('surface_temperature') or section['medium'].get('air_temperature') or 273.15)-273.15)+' °C', '保存的介质边界'],
    ])


def table(headers, rows):
    def cell(value):
        return escape('未输出' if value is None else str(value))
    return '<table><thead><tr>' + ''.join('<th>'+cell(v)+'</th>' for v in headers) + '</tr></thead><tbody>' + ''.join('<tr>'+''.join('<td>'+cell(v)+'</td>' for v in row)+'</tr>' for row in rows) + '</tbody></table>'


def recommended_case(run):
    if run.get('convergence',{}).get('reference_case_id'):
        return run['convergence']['reference_case_id']
    definition=run['snapshot']['definition'];candidates=run['snapshot'].get('candidate_snapshots',[])
    if definition['driver']['kind']!='selection' or definition['driver'].get('allow_demo_candidates') or not candidates:return None
    qualified=[]
    for row in run['output'].get('assessment',[]):
        item=candidates[int(row['case_id'].split('-')[-1])]
        cable=item['payload'].get('cable_type')
        if cable and row.get('status')=='satisfied' and item['state'] in ('reviewed','user_reviewed','engineering_input'):
            qualified.append((cable['cores'][0]['conductor']['nominal_area'],row['margin'],item['payload']['name'],item['digest'],row['case_id']))
    return min(qualified)[-1] if qualified else None


def selection_answer(run):
    definition=run['snapshot']['definition'];candidates=run['snapshot']['candidate_snapshots'];rows=[];qualified=[]
    for item in run['output'].get('assessment',[]):
        index=int(item['case_id'].split('-')[-1]);candidate=candidates[index];payload=candidate['payload'];cable=payload.get('cable_type')
        area=cable['cores'][0]['conductor']['nominal_area']*1e6 if cable else payload['specification']['area_m2']*1e6 if payload.get('specification') else payload['cable']['area_mm2']
        status=item.get('status') or ('不适用' if item['value'] is None else 'satisfied' if item['meets_target'] else 'not_satisfied')
        label={'satisfied':'满足','not_satisfied':'不满足','not_applicable':'不适用','failed':'计算失败'}.get(status,status)
        margin=item.get('margin',None if item['value'] is None else item['value']-definition['driver']['minimum'])
        record=[payload.get('name') or cable['label'],formatted(area,0),formatted(item['value']),formatted(margin),label,(item.get('reason') or {}).get('message') or '温限约束',payload.get('version','兼容型号'),candidate['digest']]
        rows.append(({'satisfied':0,'not_satisfied':1,'not_applicable':2,'failed':3}.get(status,4),area,record))
        if status=='satisfied' and candidate['state'] in ('reviewed','user_reviewed','engineering_input'):qualified.append((area,margin,record[0],item['value'],candidate))
    qualified.sort(key=lambda r:(r[0],r[1],r[2],r[4]['digest']));rows.sort(key=lambda r:(r[0],r[1],r[2][0]))
    demo=definition['driver'].get('allow_demo_candidates',False)
    conclusion=('数值满足的候选须完成型号核对后确定推荐。' if demo else '推荐 '+qualified[0][2]+'，允许 '+formatted(qualified[0][3])+' A，余量 '+formatted(qualified[0][1]/definition['driver']['minimum']*100)+'%（满足的最小截面 '+formatted(qualified[0][0],0)+' mm²）。' if qualified else '当前条件下没有合格型号。' if any(v.get('status')=='not_satisfied' for v in run['output'].get('assessment',[])) else '本次候选均不适用，尚无选型结论。')
    method=definition['method']
    if qualified and qualified[0][4].get('engineering_parameters'):
        conclusion+=' 结论依赖工程师给定参数：'+'、'.join(qualified[0][4]['dependencies'])+'。'
    from .report_selection import context, basis_text
    chosen=context(run)
    if chosen:
        from .study_pdf import _names
        conclusion=chosen['answer']+' 选型口径：'+basis_text(chosen['basis'],_names(chosen['document']))
    references=sorted({(s['kind'],s['reference']) for c in candidates for s in c['payload'].get('sources',{}).values()})
    evidence='<h3>型号来源依据</h3>'+table(['来源类型','出处与原文SHA256'],references) if references else ''
    engineering=[];present=[qualified[0][4]] if qualified and not demo else candidates
    for candidate in present:
        for key,given in candidate.get('engineering_parameters',{}).get('values',{}).items():
            engineering.append([candidate['payload']['name'],key,given['value'],given['unit'],'工程师给定',given['reference']])
    preparation=[[c['payload']['name'],c['origin']['digest'],c['preparation']['artifact_sha256'],json.dumps(c['preparation']['method'],ensure_ascii=False)] for c in present if c.get('preparation')]
    parameters=('<section data-section="engineering-parameters"><h3>工程师给定参数</h3>'+table(['型号','字段','采用值','SI单位','来源类型','出处'],engineering)+'<h3>标准推导及来源工件</h3>'+table(['型号','原始厂家记录SHA256','补全工件SHA256','补全插件与版本'],preparation)+table(['型号','推导值'],[[c['payload']['name'],json.dumps(c['derived'],ensure_ascii=False)] for c in present if c.get('derived')])+'</section>') if engineering else ''
    return '<p class="answer" data-result="selection">'+escape(conclusion)+'</p><p>'+escape('目标电流 '+formatted(definition['driver']['minimum'])+' A；'+method['plugin_id']+' '+method['version'])+'</p>'+table(['型号','截面/mm²','允许电流/A','余量/A','判定','限制原因','型号版本','内容SHA256'],[r[2] for r in rows])+parameters+evidence


def artifact_sections(case):
    """Render saved artifacts by their declared type, without invoking a method."""
    artifacts = case.get('artifacts') or {}
    trace = artifacts.get('x-cablesim.iec60287-trace')
    network = artifacts.get('x-cablesim.thermal-network-rating')
    parts = []
    correction=artifacts.get('x-cablesim.gb50217-correction')
    if correction:
        parts.append('<section data-section="gb-correction"><h3>GB 50217 载流量校正</h3>'+table(
            ['基准载流量 / A','总校正系数','校正后允许电流 / A'],[[formatted(correction['baseline']['baseline_current_a']),formatted(correction['total_factor'],4),formatted(correction['corrected_current_a'])]])+
            table(['校正项目','系数','表号与行列条件','出处'],[[r['label'],formatted(r['factor'],4),r['record']['table']+' · '+r['condition_text'],r['record']['citation']] for r in correction['coefficients']])+
            '<p>'+escape(correction['baseline']['baseline_source']+' · 第 '+str(correction['baseline']['baseline_page'])+' 页；基准条件由工程师核对。')+'</p><p>'+escape(correction['scope'])+'</p></section>')
    from .material_basis import saved_rows
    constants = saved_rows(case)
    if constants:
        parts.append('<h3>材料常数与标准出处</h3>'+table(['材料常数','采用值 / 单位','标准出处与核对'],[
            [row['label'],str(row['value'])+' '+row['unit'],row.get('citation','')+' · '+row['status_label']+
             (f"；依据值 {row['reference_value']} {row['unit']}；差 {row['difference']:.4g}" if row['status']=='different' else '')+
             ('；'+row['note'] if row.get('note') else '')] for row in constants]))
    comparison = artifacts.get('x-cablesim.iec-fem-comparison')
    if comparison:
        from cablesim_sdk.iec_fem import ComparisonArtifact
        checked = ComparisonArtifact.model_validate(comparison)
        basis={'uniform_soil_counterfactual':'均匀土壤对照','iec_saved_condition':'保存工况',
               'saved_geometry_frozen_iec_coefficients':'保存几何；冻结损耗与管内热阻',
               'saved_geometry_native_losses_temperature_dependent_duct_air':'保存几何；原生电磁损耗与温变管内热阻'}
        assumptions={'homogeneous_soil':'均匀土壤','rectangular_backfill_equivalence':'回填区精确几何','resolved_duct_air_flow':'管内空气流动已求解'}
        parts.append('<section data-section="iec-fem-comparison"><h3>IEC 与有限元对比</h3>'+table(
            ['方法','允许电流/A','保存负荷峰温/°C','口径'],
            [[name,formatted(value.ampacity_a,3),formatted(value.operating_temperature_k-273.15 if value.operating_temperature_k is not None else None,3),basis.get(value.basis,value.basis)]
             for name,value in [('IEC',checked.iec),('FEM',checked.fem)]])+
            table(['核验','状态','温度差/K','允许电流差/A'],
                [[name,'已收敛' if checked.convergence[key+'_status']=='converged' else '未收敛',formatted(checked.convergence[key]['maximum_temperature_change_k'],5),formatted(checked.convergence[key]['ampacity_change_a'],5)]
                 for key,name in [('mesh','网格细化'),('domain','计算域扩大')]])+
            table(['假设','满足','原因'],[[assumptions.get(r['assumption'],r['assumption']),'是' if r['satisfied'] else '否',r['reason']] for r in checked.assumption_checks])+
            '<p>'+escape('；'.join(checked.clauses))+'</p><p>'+escape('；'.join(checked.limitations))+'</p></section>')
        if checked.decomposition:
            attribution = checked.decomposition
            if attribution.get('status') == 'available':
                parts.append('<section data-section="iec-fem-attribution"><h3>偏差来源</h3>'+table(
                    ['因素','贡献/百分点'],
                    [[r['label'],formatted(r['percentage_points'],4)] for r in attribution['contributions']]+
                    [['均匀基线残差',formatted(attribution['baseline_residual_percentage_points'],4)],
                     ['更新后总偏差',formatted(attribution['updated_gap_percent'],4)]])+
                    '<p>'+escape(attribution['meaning'])+'</p></section>')
            else:
                parts.append('<p>'+escape(attribution.get('reason','偏差分解不可用。'))+'</p>')
    history = artifacts.get('x-cablesim.temperature-history')
    if history:
        parts.append('<section data-section="transient-temperature"><h3>暂态温升</h3>'+table(
            ['电缆','峰值/°C','峰值时刻/s','温限状态','到温限时间/s','时间步括区/s'],
            [[c['entity'], formatted(c['peak_temperature_k']-273.15,3), formatted(c['peak_time_s'],3), c['limit_status'],
              (c.get('limit_crossing') or {}).get('time_s'), (c.get('limit_crossing') or {}).get('bracket_s')] for c in history['curves']])+
            '<p>'+escape('完整温度曲线与逐步统计保存在 x-cablesim.temperature-history；未到温限仅指本次保存时长。')+'</p></section>')
    losses = artifacts.get('x-cablesim.loss-coefficients')
    if losses:
        parts.append('<section data-section="sheath-losses"><h3>护套损耗与IEC外部系数</h3>'+table(
            ['电缆','导体损耗/W/m','护套损耗/W/m','λ1','λ2'],
            [[r['entity'], formatted(r['conductor_loss_w_m'],6), formatted(r['sheath_loss_w_m'],6), formatted(r['lambda1'],9), formatted(r.get('lambda2',0),9)] for r in losses['rows']])+
            table(['领域输入SHA256','工件SHA256','原始场SHA256'],[[losses['domain_input_sha256'],case.get('artifact_digests',{}).get('x-cablesim.loss-coefficients'),losses['producer']['bundle_sha256']]])+'</section>')
    bundle = artifacts.get('x-cablesim.simulation-bundle') or {}
    iterations = bundle.get('result',{}).get('iterations',[])
    if iterations:
        parts.append('<section data-section="electrothermal-steady"><h3>双向电热耦合</h3>'+table(
            ['轮次','温度更新/K','功率相对更新/1','能量相对残差/1','场间传递相对残差/1'],
            [[i+1, r.get('temperature_update_inf_k'), r.get('power_relative_update'),r.get('energy_relative_residual'),r.get('transfer_relative_error')] for i,r in enumerate(iterations)])+'</section>')
    goals = (network or trace or {}).get('goal_checks', [])
    if goals:
        labels = {'satisfied': '满足', 'not_satisfied': '不满足', 'unavailable': '无法判断'}
        def number(value, unit, margin=False):
            if value is None:
                return '未输出'
            return f'{value-273.15:.1f} °C' if unit == 'K' and not margin else f'{value:.1f} {unit}'
        parts.append('<h3>研究目标与插件校核</h3>'+table(['对象', '目标', '实际值', '目标值', '余量', '判定', '来源 / 规则'], [
            [g.get('entity') or '研究', '运行导体温度' if g['key'] == 'conductor_temperature' else '允许电流',
             number(g.get('actual'), g['unit']), number(g.get('target'), g['unit']),
             number(g.get('margin'), g['unit'], True), labels[g['verdict']], g['source']+' · '+g['rule_version']]
            for g in goals]))
    if trace and trace.get('schema') == 'cablesim.iec60287.group-trace/1':
        parts.append('<h3>各回路允许电流</h3><p>'+escape(trace['rating_basis'])+'</p>'+table(
            ['回路','允许电流 / A','口径','限制电缆','不可用原因'], [[r['label'],formatted(r['ampacity_a'],3),r.get('rating_basis',{}).get('display_name','历史口径见上文'),r['limiting_cable'],r.get('error',{}).get('message') or '—'] for r in trace['circuit_ratings']]))
        simultaneous = trace.get('simultaneous_rating')
        if simultaneous:
            parts.append('<h3 data-section="simultaneous-rating">全回路等负荷允许电流</h3><p>'+escape(trace['rating_modes']['simultaneous']['meaning'])+'</p>'+table(
                ['共同允许电流/A','限制回路','限制电缆','不可用原因'],[[formatted(simultaneous['ampacity_a'],6),simultaneous.get('limiting_circuit'),simultaneous['limiting_cable'],simultaneous.get('error',{}).get('message') or '—']]))
        if trace.get('external_loss_source'):
            source = trace['external_loss_source']
            parts.append('<h3 data-section="external-loss-source">IEC外部损耗来源</h3>'+table(['来源运行','工况','工件SHA256','来源输入SHA256','来源输出SHA256'],[[source['run_id'],source['case_id'],source['artifact_sha256'],source['source_input_digest'],source['source_output_digest']]]))
        if trace.get('corrugated_sheaths'):
            waves=trace['corrugated_sheaths']
            parts.append('<h3 data-section="corrugated-sheath">皱纹护套与工程参考参数</h3>'+table(
                ['电缆','波谷内径 / mm','波峰外径 / mm','平均直径 / mm','节距 / mm','R20 / Ω/m','缓冲与间隙热阻 / K·m/W'],
                [[w['entity'],formatted(w['trough_inner_diameter_m']*1000,3),formatted(w['crest_outer_diameter_m']*1000,3),formatted(w['mean_diameter_m']*1000,3),formatted(w['pitch_m']*1000,3),f"{w['sheath_r20_ohm_m']:.8e}",formatted(w['buffer_and_gap_resistance_k_m_w'],6)] for w in waves]))
            parts.append('<p>结论依赖下列工程参考参数；平均直径热路不表示波谷局部接触、放电或缓冲层烧蚀验证。</p>'+table(
                ['几何出处','间隙有效热阻率出处','条款'], sorted({(w['geometry_source'],w['gap_source'],'；'.join(w['clauses'])) for w in waves})))
        parts.append('<h3>保存负荷下的逐电缆温度与损耗</h3>'+table(
            ['电缆','电流 / A','导体 / °C','温限余量 / K','总损耗 / W/m','互热温升 / K'],
            [[s['entity'],formatted(s['current_a']),formatted(s['conductor_temperature_c']),formatted(s['margin_k']),
              formatted(s['total_loss_w_m'],3),formatted(s['mutual_temperature_rise_k'],3)] for s in trace['operating']['cable_states']]))
        three_core = [s for s in trace['operating']['cable_states'] if s.get('cores')]
        if three_core:
            parts.append('<h3 data-section="three-core-thermal">三芯热路与电损耗系数</h3>'+table(
                ['电缆','每芯 Rc / Ω/m','每芯 T1','整缆 T2','整缆 T3 / K·m/W','λ1','λ2'],
                [[s['entity'],f"{s['ac_resistance_ohm_m']:.8e}",formatted(s['t1_k_m_w'],6),formatted(s['t2_k_m_w'],6),
                  formatted(s['t3_k_m_w'],6),formatted(s['lambda1'],8),formatted(s['lambda2'],8)] for s in three_core]))
            parts.append('<h3 data-section="core-losses">逐芯损耗明细</h3>'+table(
                ['电缆','芯','导体 / °C','导体 / W/m','屏蔽 / W/m','介质 / W/m'],
                [[s['entity'],core['core'],formatted(core['temperature_c']),formatted(core['conductor_loss_w_m'],6),
                  formatted(core['screen_loss_w_m'],6),formatted(core['dielectric_loss_w_m'],6)]
                 for s in three_core for core in s['cores']]))
        parts.append('<h3 data-section="mutual-heating">互热贡献明细（保存负荷）</h3>'+table(
            ['受热电缆','热源电缆','热阻 / K·m/W','源损耗 / W/m','温升贡献 / K','回填修正 / K·m/W'],
            [[r['target'],r['source'],formatted(r['resistance_k_m_w'],6),formatted(r['source_loss_w_m'],3),
              formatted(r['temperature_rise_k'],4),formatted(r['backfill_correction_k_m_w'],6)] for r in trace['heat_contributions']]))
        parts.append('<h3>排管三段热阻（保存负荷）</h3>'+table(
            ['电缆','管内 T4′','管壁 T4″','管外自热 T4‴ / K·m/W'],
            [[s['entity'],formatted(s['t4_air_gap_k_m_w'],6),formatted(s['t4_wall_k_m_w'],6),formatted(s['t4_self_soil_k_m_w'],6)] for s in trace['operating']['cable_states']]))
        verification = trace['verification']
        parts.append('<h3 data-section="hand-check">手算核对表</h3><p>'+escape(verification['basis'])+'</p>'+table(
            ['对象','核对项目','插件值','手算值','差值','单位','容差','判定','依据'],
            [[r['entity'],r['item'],formatted(r['computed'],6),formatted(r['reference'],6),f"{r['difference']:.3e}",
              r['unit'],r['tolerance'],'通过' if r['passed'] else '未通过',r['source']] for r in verification['rows']]))
        parts.append('<h3>标准与电损耗口径</h3><p>'+escape(trace['electrical_basis'])+'</p><ul>'+''.join('<li>'+escape(s)+'</li>' for s in trace['sources'])+'</ul>')
    elif trace:
        parts.append('<h3>额定工况：IEC 计算过程</h3>' + table(['项目', '值'], [
            ['收敛', trace.get('converged')], ['迭代次数', trace.get('iterations')],
            ['绝缘热阻 T1 / K·m/W', trace.get('t1_k_m_w')],
            ['外护套热阻 T3 / K·m/W', trace.get('t3_k_m_w')]]))
        parts.append(table(['轮次', '电流 / A', '护套温度 / °C', '外部热阻 T4 / K·m/W', '导体损耗 / W/m', '护套损耗 / W/m'],
                           [[r.get(k) for k in ('index', 'current_a', 'sheath_temperature_c', 't4_k_m_w', 'conductor_loss_w_m', 'sheath_loss_w_m')]
                            for r in trace.get('history', [])]))
    if network:
        for condition, label in [('rating', '额定工况'), ('operating', '运行工况')]:
            state = network.get(condition)
            parts.append('<h3>'+label+'</h3>')
            if state is None:
                parts.append('<p>不可用：'+escape(network.get('operating_error') or '方法未输出此工况')+'</p>')
                continue
            parts.append('<p>电流 '+formatted(state['current_a'])+' A；热网络方程残差 '+f"{state['residual_k']:.2e}"+' K。</p>')
            parts.append(table(['相序', '导体温度 / °C', '表面温度 / °C', '导体损耗 / W/m', '屏蔽损耗 / W/m', '介质损耗 / W/m', '总损耗 / W/m'],
                               [[i+1, formatted(state['temperatures_c'][i]), formatted(state['surface_temperatures_c'][i]), formatted(state['conductor_losses_w_m'][i]),
                                 formatted(state['screen_losses_w_m'][i]), formatted(state['dielectric_loss_w_m']), formatted(state['total_losses_w_m'][i])]
                                for i in range(len(state['temperatures_c']))]))
        thermal = network.get('thermal', {})
        parts.append('<h3>内部热阻 / K·m/W</h3>' + table(['层序', '热阻'], [[i+1,v] for i,v in enumerate(thermal.get('layer_resistances_k_m_w', []))]))
        parts.append('<h3>外部土壤与互热矩阵 / K·m/W</h3>' + table(['相序', '热源 1', '热源 2', '热源 3'], [[i+1,*row] for i,row in enumerate(thermal.get('soil_matrix_k_m_w', []))]))
        parts.append('<h3>工件警告</h3><ul>'+''.join('<li>'+escape(w)+'</li>' for w in network.get('warnings', []))+'</ul>')
    if network or (trace and trace.get('schema')!='cablesim.iec60287.group-trace/1'):
        parts.append('<p>铠装损耗未计算：所选方法不支持铠装电缆。分项对应指定工况，不以额定损耗代替运行损耗。</p>')
    armour=artifacts.get('x-cablesim.iec60287-armour')
    if armour:
        parts.append('<h3>铠装损耗与温度迭代</h3>'+table(['允许电流/A','λ₂','铠装温度/°C','铠装损耗/W/m'],[[formatted(armour['ampacity_a'],6),formatted(armour['lambda2'],9),formatted(armour['armour_temperature_k']-273.15,6),formatted(armour['armour_loss_w_m'],6)]])+'<p>'+escape('；'.join(armour['clauses']))+'</p><ul>'+''.join('<li>'+escape(s)+'</li>' for s in armour['limitations'])+'</ul>')
    return ''.join(parts)


def sweep_answer(run):
    driver = run['snapshot']['definition']['driver']
    if driver['target_key'] != 'ampacity' or driver['target_unit'] != 'A':
        return '<p class="answer">参数扫描：以下为逐点保存的真实结果；失败点不补值。</p>'
    common = driver.get('rating_basis') == 'simultaneous'
    condition = 'rating-simultaneous' if common else 'rating'
    meaning = ('全回路等负荷允许电流：所有回路同时采用相同平衡电流。' if common else
               '逐回路条件允许电流：其他回路保持保存负荷，任一电缆到达温限即限制该值，各上限不能同时使用。')
    rows = []
    for i, sample in enumerate(driver['samples']):
        case = next((c for c in run['output']['cases'] if c['case_id'] == f'case-{i}'), None)
        matches = [q for q in (case or {}).get('results', []) if q.get('type') == 'quantity'
                   and q.get('key') == 'ampacity' and q.get('entity') == driver['target_entity']
                   and q.get('case') == condition and q.get('unit') == 'A']
        value = matches[0].get('value') if case and case['status'] == 'succeeded' and len(matches) == 1 and matches[0]['status'] == 'available' else None
        rows.append([sample['label'], formatted(value, 3), driver['target_entity'], condition])
    return '<p class="answer" data-section="sweep-basis">'+meaning+'</p>'+table(['采样','允许电流 / A','回路','结果口径'], rows)


def render(runs, *, attachments=None):
    from .report_reads import checkpoint
    checkpoint('html')
    from .report_reads import archive_runs
    from .version_status import cover_status
    from .rating_table import is_rating_table
    from .type_specification import render_run_specification
    ratings = [r for r in runs if is_rating_table(r)]
    if attachments and ratings:
        raise ValueError('此附图接口用于研究计算书；规格书由型号交付流程生成。')
    if ratings:
        geometry = [r for r in runs if any('x-cablesim.cad-model' in c.get('artifacts', {}) for c in r['output']['cases'])]
        if len(ratings) == 1 and len(runs) == len(geometry)+1 and len(geometry) <= 1:
            return render_run_specification(runs)
    if (len(runs) == 1 and len(runs[0]['output']['cases']) == 1
            and runs[0]['output']['cases'][0]['status'] == 'succeeded'
            and 'x-cablesim.cad-model' in runs[0]['output']['cases'][0].get('artifacts', {})):
        return render_run_specification(runs)
    blocks = []
    for run in runs:
        from .report_selection import context
        chosen=context(run)
        preferred=chosen['case_id'] if chosen else recommended_case(run)
        rows = []
        for case in run['output']['cases']:
            if preferred and case['case_id']!=preferred:continue
            if case['status'] != 'succeeded':
                rows.append('<tr><td colspan="5">' + escape(json.dumps(case['error'], ensure_ascii=False)) + '</td></tr>')
            for r in case['results']:
                value = r.get('value') if r['status'] == 'available' else r.get('reason')
                unit = r.get('unit', '')
                if r['type'] == 'quantity' and isinstance(value, (int, float)) and not isinstance(value, bool):
                    temperature = unit == 'K' and r['key'] in ('conductor_temperature', 'surface_temperature')
                    value = formatted(value-273.15 if temperature else value) if temperature or unit in ('A', 'W/m') else f'{value:.4g}'
                    if temperature:
                        unit = '°C'
                rows.append('<tr>' + ''.join('<td>' + escape(str(v)) + '</td>' for v in
                            (case['case_id'] + ' · ' + str(r.get('case') or 'unspecified'), r['entity'], r['key'], value, unit)) + '</tr>')
        blocks.append(f'<section><h2>{escape(run["snapshot"]["definition"]["title"])}</h2>'
                      f'<p>Run {escape(run["id"])} · {escape(run["status"])} · {escape(run["freshness"])}</p>'
                      + task_answer(run)
                      + shared_input_summary(run)
                      + ('<h3 data-section="temperature-convergence">温度场收敛证据</h3><p>'+escape(run['convergence']['reason'])+'</p>'+table(['工况','网格/m','节点','峰值/°C','变化/K'],[[v['case_id'],v['mesh_size_m'],v['nodes'],formatted(v['hotspot_k']-273.15 if v['hotspot_k'] is not None else None,3),formatted(v['change_k'],4)] for v in run['convergence']['rows']]) if run.get('convergence') else '')
                      + '<table><thead><tr><th>采样 / 工况</th><th>对象</th><th>物理量</th><th>值</th><th>单位</th></tr></thead><tbody>'
                      + ''.join(rows) + '</tbody></table><h3>输入来源</h3>'
                      + table(['字段 / 输入包', '来源类型', '引用及版本', '核对状态'],
                              [[path, source.get('kind'), source.get('reference'), '已核对' if source.get('reviewed') else '未核对']
                               for path, source in run['snapshot']['definition'].get('input_sources', {}).items()])
                      + ''.join('<h3>采样 '+escape(case['case_id'])+'</h3>'+artifact_sections(case) for case in run['output']['cases'] if case['status']=='succeeded' and (not preferred or case['case_id']==preferred))
                      + '<h3>适用范围与证据</h3><pre>'
                      + escape(json.dumps({k: run['output'].get(k) for k in ('limitations', 'validation', 'executions', 'environment_digest', 'assessment', 'crosscheck')}, ensure_ascii=False, indent=2))
                      + '</pre><details><summary>原始输入快照与完整精度结果</summary><pre>'
                      + escape(json.dumps(archive_runs([run])[0], ensure_ascii=False, separators=(',', ':'))) + '</pre></details></section>')
    return ('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>CableSimPro 研究计算书</title>'
            '<style>body{font:14px system-ui;max-width:1100px;margin:32px auto;padding:16px}table{border-collapse:collapse;width:100%}'
            'td,th{overflow-wrap:anywhere;font-variant-numeric:tabular-nums;border:1px solid #ccc;padding:8px;text-align:left}th{background:#f5f5f3;font-weight:500}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.answer{font-size:20px;line-height:1.6;border-bottom:1px solid #ddd;padding-bottom:20px}section{break-before:page}details{margin-top:24px}h2{margin-top:36px}h3{margin-top:24px}</style>'
            '<h1>CableSimPro 研究计算书</h1><p>来源为指定运行的已保存结果；导出未重新计算。验证等级仅适用于声明范围，不构成设计签审认证。</p>'
            + ('<p data-version-status="stale">'+escape(cover_status(runs)['display_name'])+'</p>' if cover_status(runs)['status']=='stale' else '')
            + pdf_downloads(runs, attachments=attachments) + ''.join(blocks) + attachment_html(attachments) + '</html>')


def attachment_html(attachments):
    if not attachments: return ''
    from .report_attachments import chapter_html
    parts = chapter_html(attachments)
    images = attachments.get('section_images', []) + attachments.get('field_images', []) + attachments.get('cad_images', []) + ([attachments['fem_chapter']] if attachments.get('fem_chapter') else [])
    body = ''.join('<section data-report-attachment="saved">'+part+'<img style="max-width:100%" alt="保存结果图" src="data:image/png;base64,'+image['png_base64']+'"></section>' for part, image in zip(parts, images))
    return body + '<script type="application/json" data-report-attachments>'+json.dumps(attachments,ensure_ascii=False).replace('<','\\u003c')+'</script>'


def pdf_downloads(runs, *, attachments=None):
    """Both editions are frozen into the same integrity-checked HTML delivery.

    Standalone exported HTML supports these download links. A sandboxed app
    preview must delegate download to its parent; data-report-pdf identifies
    the edition without introducing another run or mutable source endpoint.
    """
    from base64 import b64encode
    from datetime import datetime, timezone
    from .study_pdf import render_editions
    generated_at=datetime.now(timezone.utc).isoformat(timespec='seconds')
    editions=render_editions(runs,generated_at=generated_at,attachments=attachments)
    links=[]
    for audience,label in [('customer','客户版'),('internal','内部审核版')]:
        payload=b64encode(editions[audience]).decode('ascii')
        links.append(f'<a data-report-pdf="{audience}" download="研究计算书-{label}.pdf" href="data:application/pdf;base64,{payload}">下载{label} PDF</a>')
    return '<nav aria-label="计算书 PDF 下载">'+'　'.join(links)+'</nav>'
