"""Presentation of immutable type rating batches; no solver or mutable model reads."""
from copy import deepcopy
from html import escape
import json
from math import hypot


def is_rating_table(run):
    driver = run['snapshot']['definition']['driver']
    return driver['kind'] == 'batch' and bool(driver.get('cases')) and all(c.get('metadata', {}).get('kind') == 'type-rating-table' for c in driver['cases'])


def rating_rows(run):
    outputs = {c['case_id']: c for c in (run.get('output') or {}).get('cases', [])}
    inputs = {c['case_id']: c['input'] for c in run['snapshot']['cases']}
    records = []
    for saved in run['snapshot']['definition']['driver']['cases']:
        out = outputs.get(saved['case_id'], {})
        result = next((r for r in out.get('results', []) if r['key'] == 'ampacity' and r.get('unit') == 'A' and r['status'] == 'available'), None)
        reason = (out.get('error') or {}).get('message') or next(((r.get('reason') or {}).get('message') for r in out.get('results', []) if r['key'] == 'ampacity'), None)
        if out.get('status') == 'not_run':
            status = '未运行'
        elif result:
            status = '已计算'
        elif out.get('evidence', {}).get('stage') != 'preflight':
            status = '计算失败'
        elif any(s in (reason or '') for s in ('None', 'required', '缺少', '缺项', "'ks'", "'kp'", "'eddy'")):
            status = '待补数据'
        elif (out.get('error') or {}).get('code') == 'DOMAIN_INVALID':
            status = '输入错误'
        else:
            status = '超出范围'
        document = inputs[saved['case_id']]
        section = document['sections'][0]
        condition = deepcopy(saved['metadata']['condition'])
        places = section['placements']
        materials = {m['id']: m for m in document['materials']}
        # Display actual archived physical inputs even if optional descriptive
        # metadata was edited separately through the generic study API.
        condition.update(depth_m=-sum(p['z'] for p in places)/len(places),
                         soil_rho_k_m_w=materials[section['medium']['material']]['thermal_resistivity'],
                         ambient_temperature_c=section['medium']['surface_temperature']-273.15,
                         bonding=document['circuits'][0]['bonding']['kind'])
        distances = [hypot(a['x']-b['x'], a['z']-b['z']) for i,a in enumerate(places) for b in places[i+1:]]
        condition['actual_spacing_m'] = min(distances) if distances else None
        if section['kind'] == 'air':
            condition['layout'] = 'air'
        elif section['enclosures'] and all(e['type'] == 'duct' for e in section['enclosures']):
            condition['layout'] = 'ducts'
        elif len(distances) == 3:
            condition['layout'] = 'trefoil' if max(distances)-min(distances)<1e-8 else 'flat'
        records.append({'case_id': saved['case_id'], 'name': saved['label'], 'condition': condition,
                        'value_a': None if result is None else result['value'], 'status': status, 'reason': reason,
                        'artifact_digests': out.get('artifact_digests', {})})
    return records


def rating_section(run):
    from .report import table
    method = run['snapshot']['definition']['method']
    reference = run['snapshot']['definition']['parameters'].get('reference_basis') == 'tb880_reference'
    labels = {'trefoil': '直埋 · 品字', 'flat': '直埋 · 水平', 'ducts': '排管 · 品字', 'air': '空气'}
    rows = []
    for r in rating_rows(run):
        c = r['condition']
        rows.append([r['name'], labels[c['layout']], '—' if c['layout'] == 'air' else format(c['depth_m'], '.3g'),
                     '—' if c['layout'] == 'air' else format(c['soil_rho_k_m_w'], '.3g'), format(c['ambient_temperature_c'], '.3g'),
                     '—' if c['actual_spacing_m'] is None else format(c['actual_spacing_m']*1000, '.4g'),
                     '—' if r['value_a'] is None else format(r['value_a'], '.3g'), r['status'], r['reason'] or c['source']])
    scope = 'TB 880 旧版验证复现；不是 IEC 2023 工程结论。' if reference else 'IEC 2023 地下稳态；具体分支以保存工件为准。'
    return ('<h2>载流量表</h2><p>典型工况设计条件；型号、方法及结果均来自指定保存运行。待补数据与范围拒绝不补值。</p><p>'+escape(scope)+'</p>'
            + table(['工况','排列','中心埋深/m','土壤热阻率/K·m/W','环境温度/°C','中心距/mm','允许电流/A','状态','来源或原因'], rows)
            + '<p>'+escape(method['plugin_id']+' '+method['version']+'；'+('CIGRE TB 880:2022 case 0-1 pp.62–75。' if reference else 'IEC 60287-1-1:2023 4.2.1 / 5.1.2；60287-2-1:2023 4.2.4 / 4.2.6。'))+'</p>'
            + '<details><summary>载流量运行与完整精度</summary><pre>'+escape(json.dumps({'run': run['id'], 'method': method, 'snapshot': run['snapshot'], 'output': run['output']}, ensure_ascii=False, indent=2))+'</pre></details>')
