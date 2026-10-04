"""Render saved typed results only; importing a solver here is a design violation."""
from html import escape
import json

RENDERER = 'cablesim.study-html/10'


def formatted(value, digits=1):
    if value is None:
        return '未输出'
    return f'{value:,.{digits}f}'.replace(',', ' ') if abs(value) >= 10000 else f'{value:.{digits}f}'


def task_answer(run):
    definition = run['snapshot']['definition']
    if definition['driver']['kind']=='selection' and definition['driver']['candidate_ids']:
        return selection_answer(run)
    if definition['driver']['kind'] == 'sweep':
        return '<p class="answer">参数扫描：以下为逐点保存的真实结果；失败点不补值。</p>'
    case = next((c for c in run['output']['cases'] if not c['case_id'].startswith('crosscheck-') and c['status'] == 'succeeded'), None)
    if case is None:
        return '<p class="answer">当前任务未取得可用结果。</p>'
    armour=case.get('artifacts',{}).get('x-cablesim.iec60287-armour')
    if armour:
        return '<p class="answer">'+escape('三芯钢丝铠装SL热路：允许电流 '+formatted(armour['ampacity_a'],3)+' A，λ₂='+formatted(armour['lambda2'],8)+'；同一工作点输入，限定范围。')+'</p>'
    artifact = next((v for v in case.get('artifacts', {}).values() if isinstance(v, dict) and 'goal_checks' in v), {})
    all_checks = artifact.get('goal_checks', [])
    checks = {key: min((g for g in all_checks if g['key'] == key),key=lambda g:g.get('margin') if g.get('margin') is not None else float('inf'),default=None)
              for key in ('ampacity','conductor_temperature')}
    current, temperature = checks.get('ampacity'), checks.get('conductor_temperature')
    task = definition.get('task') or 'rating'
    if artifact.get('schema') == 'cablesim.iec60287.group-trace/1':
        state = artifact['operating']
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
    method = definition['method']
    label = {'cablesim.thermal-network': '热网络法', 'cablesim.iec60287': 'IEC 60287 解析法'}.get(method['plugin_id'], method['plugin_id'])
    return '<p class="answer">'+escape(text+' '+label+' · '+method['version']+'。')+'</p>'


def shared_input_summary(run):
    case = next(iter(run['snapshot'].get('cases', [])), {})
    document = case.get('input', {})
    if document.get('schema_version') != 'cablesim.domain/1':
        return ''
    cable, section, circuit = document['cable_types'][0], document['sections'][0], document['circuits'][0]
    soil = next(m for m in document['materials'] if m['id'] == section['medium']['material'])
    binding = run['snapshot'].get('workspace_state', {}).get('study_cable_reference') or {}
    loads = document['load_cases'][0]['currents']
    depth = -sum(p['z'] for p in section['placements'])/len(section['placements'])
    return '<h3>本次引用的共享输入</h3>'+table(['对象', '采用值', '来源'], [
        ['电缆型号', cable['label']+' · '+str(binding.get('version') or '研究本地输入'), binding.get('source') or '保存的领域电缆'],
        ['平均中心埋深', formatted(depth, 3)+' m', '保存的截面坐标'],
        ['土壤热阻率', formatted(soil.get('thermal_resistivity'), 2)+' K·m/W', '保存的介质材料'],
        *[[c['label']+'负荷', ' / '.join(i['phase']+' '+formatted(loads.get(i['id'],loads.get(c['id'])))+' A' for i in c['cables']), '保存的负荷工况；逐根值优先'] for c in document['circuits']],
        ['地表温度', formatted(section['medium']['surface_temperature']-273.15)+' °C', '保存的介质边界'],
    ])


def table(headers, rows):
    def cell(value):
        return escape('未输出' if value is None else str(value))
    return '<table><thead><tr>' + ''.join('<th>'+cell(v)+'</th>' for v in headers) + '</tr></thead><tbody>' + ''.join('<tr>'+''.join('<td>'+cell(v)+'</td>' for v in row)+'</tr>' for row in rows) + '</tbody></table>'


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
        if status=='satisfied' and candidate['state'] in ('reviewed','user_reviewed'):qualified.append((area,margin,record[0],item['value']))
    qualified.sort();rows.sort(key=lambda r:(r[0],r[1],r[2][0]))
    demo=definition['driver'].get('allow_demo_candidates',False)
    conclusion=('数值满足的候选须完成型号核对后确定推荐。' if demo else '推荐 '+qualified[0][2]+'，允许 '+formatted(qualified[0][3])+' A，余量 '+formatted(qualified[0][1]/definition['driver']['minimum']*100)+'%（满足的最小截面 '+formatted(qualified[0][0],0)+' mm²）。' if qualified else '当前条件下没有合格型号。' if any(v.get('status')=='not_satisfied' for v in run['output'].get('assessment',[])) else '本次候选均不适用，尚无选型结论。')
    method=definition['method']
    references=sorted({(s['kind'],s['reference']) for c in candidates for s in c['payload'].get('sources',{}).values()})
    evidence='<h3>型号来源依据</h3>'+table(['来源类型','出处与原文SHA256'],references) if references else ''
    return '<p class="answer">'+escape(conclusion)+'</p><p>'+escape('目标电流 '+formatted(definition['driver']['minimum'])+' A；'+method['plugin_id']+' '+method['version'])+'</p>'+table(['型号','截面/mm²','允许电流/A','余量/A','判定','限制原因','型号版本','内容SHA256'],[r[2] for r in rows])+evidence


def artifact_sections(case):
    """Render saved artifacts by their declared type, without invoking a method."""
    artifacts = case.get('artifacts') or {}
    trace = artifacts.get('x-cablesim.iec60287-trace')
    network = artifacts.get('x-cablesim.thermal-network-rating')
    parts = []
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
            ['回路','允许电流 / A','限制电缆','不可用原因'], [[r['label'],formatted(r['ampacity_a'],3),r['limiting_cable'],r.get('error',{}).get('message') or '—'] for r in trace['circuit_ratings']]))
        parts.append('<h3>保存负荷下的逐电缆温度与损耗</h3>'+table(
            ['电缆','电流 / A','导体 / °C','温限余量 / K','总损耗 / W/m','互热温升 / K'],
            [[s['entity'],formatted(s['current_a']),formatted(s['conductor_temperature_c']),formatted(s['margin_k']),
              formatted(s['total_loss_w_m'],3),formatted(s['mutual_temperature_rise_k'],3)] for s in trace['operating']['cable_states']]))
        three_core = [s for s in trace['operating']['cable_states'] if s.get('cores')]
        if three_core:
            parts.append('<h3>三芯热路与电损耗系数</h3>'+table(
                ['电缆','每芯 Rc / Ω/m','每芯 T1','整缆 T2','整缆 T3 / K·m/W','λ1','λ2'],
                [[s['entity'],f"{s['ac_resistance_ohm_m']:.8e}",formatted(s['t1_k_m_w'],6),formatted(s['t2_k_m_w'],6),
                  formatted(s['t3_k_m_w'],6),formatted(s['lambda1'],8),formatted(s['lambda2'],8)] for s in three_core]))
            parts.append('<h3>逐芯损耗明细</h3>'+table(
                ['电缆','芯','导体 / °C','导体 / W/m','屏蔽 / W/m','介质 / W/m'],
                [[s['entity'],core['core'],formatted(core['temperature_c']),formatted(core['conductor_loss_w_m'],6),
                  formatted(core['screen_loss_w_m'],6),formatted(core['dielectric_loss_w_m'],6)]
                 for s in three_core for core in s['cores']]))
        parts.append('<h3>互热贡献明细（保存负荷）</h3>'+table(
            ['受热电缆','热源电缆','热阻 / K·m/W','源损耗 / W/m','温升贡献 / K','回填修正 / K·m/W'],
            [[r['target'],r['source'],formatted(r['resistance_k_m_w'],6),formatted(r['source_loss_w_m'],3),
              formatted(r['temperature_rise_k'],4),formatted(r['backfill_correction_k_m_w'],6)] for r in trace['heat_contributions']]))
        parts.append('<h3>排管三段热阻（保存负荷）</h3>'+table(
            ['电缆','管内 T4′','管壁 T4″','管外自热 T4‴ / K·m/W'],
            [[s['entity'],formatted(s['t4_air_gap_k_m_w'],6),formatted(s['t4_wall_k_m_w'],6),formatted(s['t4_self_soil_k_m_w'],6)] for s in trace['operating']['cable_states']]))
        verification = trace['verification']
        parts.append('<h3>手算核对表</h3><p>'+escape(verification['basis'])+'</p>'+table(
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
    if trace or network:
        parts.append('<p>铠装损耗未计算：所选方法不支持铠装电缆。分项对应指定工况，不以额定损耗代替运行损耗。</p>')
    armour=artifacts.get('x-cablesim.iec60287-armour')
    if armour:
        parts.append('<h3>铠装损耗与温度迭代</h3>'+table(['允许电流/A','λ₂','铠装温度/°C','铠装损耗/W/m'],[[formatted(armour['ampacity_a'],6),formatted(armour['lambda2'],9),formatted(armour['armour_temperature_k']-273.15,6),formatted(armour['armour_loss_w_m'],6)]])+'<p>'+escape('；'.join(armour['clauses']))+'</p><ul>'+''.join('<li>'+escape(s)+'</li>' for s in armour['limitations'])+'</ul>')
    return ''.join(parts)


def render(runs):
    from .rating_table import is_rating_table, rating_section
    ratings = [r for r in runs if is_rating_table(r)]
    if ratings:
        geometry = [r for r in runs if any('x-cablesim.cad-model' in c.get('artifacts', {}) for c in r['output']['cases'])]
        if len(ratings) == 1 and len(runs) == len(geometry)+1 and len(geometry) <= 1:
            rating = ratings[0]
            chapter = rating_section(rating)
            if geometry:
                return model_specification(geometry[0]).replace('</html>', chapter+'</html>')
            document = rating['snapshot']['workspace_state']['domain']
            cable = document['cable_types'][0]
            content = '<h1>'+escape(cable['label'])+' · 规格书草稿</h1><p>未审核、未发布；结构与材料采用当前保存输入，外径与用料未纳入。</p>'
            content += table(['额定电压/kV','芯数','标称截面/mm²'], [[str(cable['rating']['u0']/1000)+' / '+str(cable['rating']['u']/1000),len(cable['cores']),cable['cores'][0]['conductor']['nominal_area']*1e6]])
            return ('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>CableSimPro 型号规格书草稿</title><style>body{font:14px/1.6 system-ui;max-width:1100px;margin:32px auto;padding:16px}h1{font-size:22px}h2{font-size:16px}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}</style>'+content+chapter+'</html>')
    if (len(runs) == 1 and len(runs[0]['output']['cases']) == 1
            and runs[0]['output']['cases'][0]['status'] == 'succeeded'
            and 'x-cablesim.cad-model' in runs[0]['output']['cases'][0].get('artifacts', {})):
        return model_specification(runs[0])
    blocks = []
    for run in runs:
        rows = []
        for case in run['output']['cases']:
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
                      + ('<h3>温度场收敛证据</h3>'+table(['工况','网格/m','节点','热点/°C','变化/K'],[[v['case_id'],v['mesh_size_m'],v['nodes'],formatted(v['hotspot_k']-273.15,3),formatted(v['change_k'],4)] for v in run['convergence']['rows']]) if run.get('convergence') else '')
                      + '<table><thead><tr><th>采样 / 工况</th><th>对象</th><th>物理量</th><th>值</th><th>单位</th></tr></thead><tbody>'
                      + ''.join(rows) + '</tbody></table><h3>输入来源</h3>'
                      + table(['字段 / 输入包', '来源类型', '引用及版本', '核对状态'],
                              [[path, source.get('kind'), source.get('reference'), '已核对' if source.get('reviewed') else '未核对']
                               for path, source in run['snapshot']['definition'].get('input_sources', {}).items()])
                      + ''.join('<h3>采样 '+escape(case['case_id'])+'</h3>'+artifact_sections(case) for case in run['output']['cases'] if case['status']=='succeeded')
                      + '<h3>适用范围与证据</h3><pre>'
                      + escape(json.dumps({k: run['output'].get(k) for k in ('limitations', 'validation', 'executions', 'environment_digest', 'assessment', 'crosscheck')}, ensure_ascii=False, indent=2))
                      + '</pre><details><summary>原始输入快照与完整精度结果</summary><pre>'
                      + escape(json.dumps({'snapshot': run['snapshot'], 'output': run['output']}, ensure_ascii=False, indent=2)) + '</pre></details></section>')
    return ('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>CableSimPro 研究计算书</title>'
            '<style>body{font:14px system-ui;max-width:1100px;margin:32px auto;padding:16px}table{border-collapse:collapse;width:100%}'
            'td,th{border:1px solid #ccc;padding:8px;text-align:left}th{background:#f5f5f3;font-weight:500}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.answer{font-size:20px;line-height:1.6;border-bottom:1px solid #ddd;padding-bottom:20px}section{break-before:page}details{margin-top:24px}h2{margin-top:36px}h3{margin-top:24px}</style>'
            '<h1>CableSimPro 研究计算书</h1><p>来源为指定运行的已保存结果；导出未重新计算。验证等级仅适用于声明范围，不构成设计签审认证。</p>'
            + ''.join(blocks) + '</html>')


def model_specification(run):
    """A draft specification from an immutable geometry run, with gaps intact."""
    case = next(c for c in run['output']['cases'] if c['status'] == 'succeeded' and 'x-cablesim.cad-model' in c.get('artifacts', {}))
    model = case['artifacts']['x-cablesim.cad-model']
    document = next(c['input'] for c in run['snapshot']['cases'] if c['case_id'] == case['case_id'])
    cable_id = run['snapshot']['definition'].get('parameters', {}).get('cable_type_id')
    cable = next((c for c in document['cable_types'] if c['id'] == cable_id), document['cable_types'][0])
    materials = {m['id']: m for m in document['materials']}
    roles = {'conductor': '导体', 'conductor_screen': '导体屏蔽', 'insulation': '绝缘',
             'insulation_screen': '绝缘屏蔽', 'metallic_screen': '金属屏蔽', 'metallic_sheath': '金属护套',
             'bedding': '垫层', 'binder': '包带', 'armour': '铠装', 'oversheath': '外护套'}
    source_layers = [{'role': 'conductor', **cable['cores'][0]['conductor']},
                     *cable['cores'][0]['layers'], *cable['common_layers']]
    layer_rows = []
    for i, layer in enumerate(source_layers):
        result = model['layers'][i] if i < len(model['layers']) else {}
        size = layer.get('diameter') if i == 0 else layer.get('thickness')
        layer_rows.append([roles.get(layer['role'], layer['role']), materials[layer['material']]['label'],
                           formatted(None if size is None else size*1000, 2),
                           formatted(None if result.get('outer_radius_m') is None else result['outer_radius_m']*2000),
                           formatted(result.get('mass_kg_per_km')), '；'.join(result.get('quantity_missing') or []) or result.get('representation') or '插件结果'])
    method = run['snapshot']['definition']['method']
    content = ('<h1>'+escape(cable['label'])+' · 规格书草稿</h1>'
               '<p>未审核、未发布。结构与物性采用保存输入；外径与用料仅引用指定几何运行，生成时未重新计算。</p>'
               + table(['项目', '值'], [['额定电压', formatted(cable['rating']['u0']/1000)+' / '+formatted(cable['rating']['u']/1000)+' kV'],
                                        ['标称导体截面', formatted(cable['cores'][0]['conductor']['nominal_area']*1e6, 0)+' mm²'],
                                        ['成品外径 · 插件推导', formatted(None if model.get('outer_diameter_m') is None else model['outer_diameter_m']*1000)+' mm'],
                                        ['理论单位长度用料', formatted(model.get('mass_kg_per_km'))+' kg/km'],
                                        ['推导方法与版本', '电缆实体建模 · '+method['version']],
                                        ['结构标准核对', '未接入；无产品标准符合性结论']])
               + '<h2>结构与用料</h2>'+table(['层次', '材料', '输入直径 / 厚度 · mm', '推导外径 · mm', '理论用料 · kg/km', '依据或缺项'], layer_rows)
               + '<h2>方法范围与近似</h2><ul>'+''.join('<li>'+escape(str(v))+'</li>' for v in [model.get('geometry_approximation'), model.get('display_approximation'), *run['output'].get('limitations', [])] if v)+'</ul>'
               + '<h2>保存输入的来源</h2>'+table(['对象 / 字段', '来源', '核对状态'], [[p, s.get('reference'), '已核对' if s.get('reviewed') else '未核对'] for p, s in document.get('provenance', {}).items()])
               + '<details><summary>运行与完整精度记录</summary><pre>'+escape(json.dumps({'run': run['id'], 'method': method, 'snapshot': run['snapshot'], 'output': run['output']}, ensure_ascii=False, indent=2))+'</pre></details>')
    return ('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>CableSimPro 型号规格书草稿</title>'
            '<style>body{font:14px/1.6 system-ui;max-width:1100px;margin:32px auto;padding:16px;color:#181818;background:#fff}h1{font-size:22px}h2{font-size:16px;margin-top:28px}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}th{background:#f4f4f4;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}details{margin-top:24px}</style>'+content+'</html>')
