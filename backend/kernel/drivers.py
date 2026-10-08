"""Bounded numeric experiments and typed comparisons; no physics or plugin IDs."""
from copy import deepcopy
import re


def replace_number(value, pointer, replacement):
    if not pointer.startswith('/') or re.search(r'~(?![01])', pointer):
        raise ValueError('扫描路径必须是 JSON Pointer')
    parts = [p.replace('~1', '/').replace('~0', '~') for p in pointer[1:].split('/')]
    target = value
    stable = []
    for index, part in enumerate(parts):
        if isinstance(target, list) and not re.fullmatch(r'0|[1-9][0-9]*', part):
            raise ValueError('数组索引必须是无前导零的非负整数')
        key = int(part) if isinstance(target, list) else part
        current = target[key]
        stable.append((current.get('id') or current.get('cable') or current.get('role') or part)
                      if isinstance(target, list) and isinstance(current, dict) else part)
        if index < len(parts) - 1:
            target = current
        else:
            if isinstance(current, bool) or not isinstance(current, (int, float)):
                raise ValueError('仅允许扫描已有数值字段，不添加字段或修改对象身份')
            target[key] = replacement
    return '/' + '/'.join(str(p).replace('~', '~0').replace('/', '~1') for p in stable)


def cases_for(definition, source):
    if definition['driver']['kind'] == 'batch':
        return [{'case_id': c['case_id'], 'input': deepcopy(c['input']),
                 'parameters': {**deepcopy(definition['parameters']), **deepcopy(c['parameters'])}}
                for c in definition['driver']['cases']]
    samples = definition['driver']['samples'] or [{'label': 'single', 'changes': {}}]
    cases = []
    for i, sample in enumerate(samples):
        case = {'case_id': f'case-{i}', 'input': deepcopy(source),
                'parameters': deepcopy(definition['parameters'])}
        for pointer, value in sample['changes'].items():
            stable = replace_number(case, pointer, value)
            if stable.startswith('/input/') and case['input'].get('schema_version') == 'cablesim.domain/1':
                sample_source = deepcopy(definition.get('input_sources', {}).get('/driver/samples') or
                                  {'kind': 'user', 'reference': '研究显式采样值', 'reviewed': False})
                sample_source['reference'] = '研究采样 · '+sample['label']+'；'+(sample_source.get('reference') or '显式数值变更')
                sample_source['reviewed'] = False
                case['input']['provenance'][stable[len('/input'):]] = sample_source
        cases.append(case)
    return cases


def default_result(definition, cases):
    driver = definition['driver']
    if driver['kind'] != 'sweep':
        return None
    condition = driver.get('target_condition')
    if driver['target_key'] == 'ampacity':
        condition = 'rating-simultaneous' if driver.get('rating_basis') == 'simultaneous' else 'rating'
    for case in cases:
        for result in case.get('results', []):
            if (result['key'] == driver['target_key'] and result['entity'] == driver['target_entity']
                    and result['unit'] == driver['target_unit'] and (condition is None or result.get('case') == condition)):
                return {key:result[key] for key in ('key','entity','unit','case') if key in result}
    return None


def assess(definition, cases):
    driver = definition['driver']
    if driver['kind'] != 'selection':
        return []
    assessed = []
    for case in cases:
        entities=driver.get('target_entities') or [driver['target_entity']]
        common = driver['target_key']=='ampacity' and driver['target_unit']=='A' and bool(driver.get('candidate_ids')) and any(r.get('case')=='rating-simultaneous' and r['key']=='ampacity' for r in case['results'])
        matches = [r for r in case['results'] if r['key'] == driver['target_key']
                   and r['entity'] in entities and r.get('unit') == driver['target_unit']
                   and r['type'] == 'quantity'
                   and (r.get('case') == 'rating-simultaneous' if common or driver.get('rating_basis') == 'simultaneous' else r.get('case') != 'rating-simultaneous')
                   and (common or driver.get('target_condition') is None or r.get('case') == driver['target_condition'])]
        value, reason = None, None
        if case['status'] != 'succeeded':
            reason = case.get('error') or {'code': 'CASE_FAILED', 'message': '该候选未完成计算。'}
        elif not matches or set(r['entity'] for r in matches)!=set(entities):
            reason = {'code': 'TARGET_MISSING', 'message': '方法未输出指定物理量、实体、单位与工况的结果。'}
        elif len(matches) != len(entities):
            reason = {'code': 'TARGET_AMBIGUOUS', 'message': '匹配到多个工况，请指定 target_condition。'}
        elif any(r['status'] != 'available' for r in matches):
            reason = next(r for r in matches if r['status']!='available').get('reason') or {'code': 'TARGET_UNAVAILABLE', 'message': '目标结果不可用。'}
        else:
            value = min(r['value'] for r in matches)
        record={'case_id': case['case_id'], 'value': value,
                'meets_target': None if value is None else value >= driver['minimum'], 'reason': reason}
        if driver['target_key']=='ampacity' and driver['target_unit']=='A':
            record['rating_basis'] = 'simultaneous' if common else driver.get('rating_basis', 'individual')
            record['rating_basis_name'] = '全回路等负荷允许电流' if record['rating_basis']=='simultaneous' else '逐回路条件允许电流（其他回路保持保存负荷）'
        if driver.get('candidate_ids') or driver.get('target_entities'):
            status=('not_satisfied' if reason and reason.get('code')=='NO_POSITIVE_RATING' else
                    'failed' if reason and case['status']!='succeeded' and case.get('evidence',{}).get('stage')!='preflight' else
                    'not_applicable' if reason else 'satisfied' if value>=driver['minimum'] else 'not_satisfied')
            record.update(margin=None if value is None else value-driver['minimum'],
                          status=status)
            if status=='not_satisfied' and value is not None:
                record['reason']={'code':'AMPACITY_BELOW_TARGET','message':f"允许电流 {value:.1f} A < 目标 {driver['minimum']:g} A。"}
        # Describe a failed temperature constraint using saved plugin goals only.
        # No temperature is estimated from the current or the cross-section.
        goals = [g for a in case.get('artifacts', {}).values() if isinstance(a, dict)
                 for g in a.get('goal_checks', []) if g.get('key') == 'conductor_temperature'
                 and g.get('condition') == 'operating' and g.get('unit') == 'K'
                 and isinstance(g.get('actual'), (int, float))
                 and isinstance(g.get('target'), (int, float))]
        hot = max(goals, key=lambda g: g['actual']-g['target'], default=None)
        if hot and record.get('status') == 'not_satisfied' and hot['actual'] > hot['target']:
            currents = {s['current_a'] for a in case.get('artifacts', {}).values() if isinstance(a, dict)
                        and isinstance(a.get('operating'), dict) for s in a['operating'].get('cable_states', [])
                        if s.get('entity') == hot['entity'] and isinstance(s.get('current_a'), (float,int))
                        and not isinstance(s['current_a'],bool)}
            current = hot.get('current_a') if isinstance(hot.get('current_a'), (float,int)) and not isinstance(hot.get('current_a'),bool) else next(iter(currents)) if len(currents)==1 else None
            operating = f'{current:g} A 下' if current is not None else '保存负荷下'
            record['reason'] = {'code': 'CONDUCTOR_OVER_TEMPERATURE',
                'message': f"该截面在{operating}导体温度 {hot['actual']-273.15:.1f} °C，超过 {hot['target']-273.15:g} °C。",
                'entity': hot['entity'], 'actual_k': hot['actual'], 'limit_k': hot['target']}
        assessed.append(record)
    return assessed


def compare(runs):
    """Absolute differences only: never percentages on absolute temperature."""
    def quantities(run):
        return {(c['case_id'], r.get('case', 'unspecified'), r['key'], r['entity'], r.get('unit')): r['value']
                for c in run['output']['cases'] if c['status'] == 'succeeded'
                for r in c['results'] if r['type'] == 'quantity' and r['status'] == 'available'}
    baseline = quantities(runs[0])
    differences = []
    for run in runs[1:]:
        values = quantities(run)
        other_checks = run['snapshot']['definition'].get('crosschecks', [])
        base_checks = runs[0]['snapshot']['definition'].get('crosschecks', [])
        differences.append({'run_id': run['id'], 'baseline_run_id': runs[0]['id'],
                            'same_input': [c['input'] for c in run['snapshot']['cases']] == [c['input'] for c in runs[0]['snapshot']['cases']],
                            'same_parameters': ([c['parameters'] for c in run['snapshot']['cases']] == [c['parameters'] for c in runs[0]['snapshot']['cases']]
                                                and [c['parameters'] for c in other_checks] == [c['parameters'] for c in base_checks]),
                            'same_method': (run['snapshot']['definition']['method'] == runs[0]['snapshot']['definition']['method']
                                            and [c['method'] for c in other_checks] == [c['method'] for c in base_checks]),
                            'unmatched': [list(k) for k in sorted(set(values) ^ set(baseline))],
                            'quantities': [{'case_id': k[0], 'condition': k[1], 'key': k[2], 'entity': k[3], 'unit': k[4],
                                            'baseline': baseline[k], 'value': values[k], 'difference': values[k] - baseline[k]}
                                           for k in sorted(set(values) & set(baseline))]})
    return {'kind': 'method-comparison', 'interpretation': '绝对数值对照；不同输入、边界或方法不代表优化收益。',
            'sources': [{'run_id': r['id'], 'snapshot': r['snapshot'],
                         'headlines': r.get('headlines', []),
                         'limiting_objects': [dict(row, case_id=case['case_id'])
                            for case in r['output']['cases'] if case['status']=='succeeded'
                            for artifact in case.get('artifacts',{}).values() if isinstance(artifact,dict)
                            for row in artifact.get('circuit_ratings',[]) if isinstance(row,dict)]}
                        for r in runs], 'differences': differences}


def crosscheck_differences(cases):
    base = {(c['case_id'], r.get('case', 'unspecified'), r['key'], r['entity'], r.get('unit')): r['value']
            for c in cases if not c['case_id'].startswith('crosscheck-') and c['status'] == 'succeeded'
            for r in c['results'] if r['type'] == 'quantity' and r['status'] == 'available'}
    differences = []
    for case in cases:
        if not case['case_id'].startswith('crosscheck-') or case['status'] != 'succeeded':
            continue
        original_id = case['case_id'].split('-', 2)[2]
        for r in case['results']:
            key = (original_id, r.get('case', 'unspecified'), r['key'], r['entity'], r.get('unit'))
            if key in base and r['type'] == 'quantity' and r['status'] == 'available':
                differences.append({'method': case['method'], 'key': r['key'], 'entity': r['entity'],
                                    'condition': r.get('case', 'unspecified'), 'unit': r['unit'],
                                    'baseline': base[key], 'value': r['value'], 'difference': r['value']-base[key]})
    return {'quantities': differences, 'engineering_acceptance': False,
            'statement': '仅比较同物理量、实体、单位与工况；不同边界的差异不是认证或正确性裁决。'}
