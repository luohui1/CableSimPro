"""Presentation of immutable type rating batches; no solver or mutable model reads."""
from copy import deepcopy
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
        document = inputs[saved['case_id']]
        condition = deepcopy(saved['metadata']['condition'])
        # Old archived conditions keep their original individual interpretation.
        requested = condition.get('rating_basis', run['snapshot']['definition']['driver'].get('rating_basis','individual'))
        multiple = len(document['circuits']) > 1
        case = 'rating-simultaneous' if multiple and requested == 'simultaneous' else 'rating'
        entities = {c['id'] for c in document['circuits']} if case == 'rating-simultaneous' else {document['circuits'][0]['id']}
        candidates = [r for r in out.get('results', []) if r['key'] == 'ampacity' and r.get('unit') == 'A'
                      and r.get('case','rating') == case and r['entity'] in entities]
        available = [r for r in candidates if r['status']=='available']
        result = min(available,key=lambda r:r['value']) if {r['entity'] for r in available} == entities else None
        reason = (out.get('error') or {}).get('message') or next(((r.get('reason') or {}).get('message') for r in candidates if r.get('reason')), None)
        if result is None and not reason and out.get('status')=='succeeded':
            reason = '未返回完整的多回路共同负荷结果；不采用逐回路条件上限。' if case=='rating-simultaneous' else '未返回所选回路的条件上限。'
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
        section = document['sections'][0]
        condition['rating_basis'] = requested
        condition['rating_basis_name'] = '单回路能力' if not multiple else '全回路等负荷允许电流' if requested=='simultaneous' else '首回路条件上限（其他回路保持保存负荷）'
        condition['circuit_count'] = len(document['circuits'])
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
        three_core = document['cable_types'][0]['construction'] == 'three_core'
        if section['kind'] == 'air':
            condition['layout'] = 'air'
        elif section['enclosures'] and all(e['type'] == 'duct' for e in section['enclosures']):
            condition['layout'] = 'three_core_ducts_horizontal' if three_core else 'ducts'
        elif three_core:
            condition['layout'] = 'three_core_buried_single' if len(places) == 1 else 'three_core_buried_horizontal'
        elif len(distances) == 3:
            condition['layout'] = 'trefoil' if max(distances)-min(distances)<1e-8 else 'flat'
        records.append({'case_id': saved['case_id'], 'name': saved['label'], 'condition': condition,
                        'value_a': None if result is None else result['value'], 'status': status, 'reason': reason,
                        'artifact_digests': out.get('artifact_digests', {})})
    return records


