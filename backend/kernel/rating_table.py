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


