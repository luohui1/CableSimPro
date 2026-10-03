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


def assess(definition, cases):
    driver = definition['driver']
    if driver['kind'] != 'selection':
        return []
    assessed = []
    for case in cases:
        matches = [r for r in case['results'] if r['key'] == driver['target_key']
                   and r['entity'] == driver['target_entity'] and r.get('unit') == driver['target_unit']
                   and r['type'] == 'quantity'
                   and (driver.get('target_condition') is None or r.get('case') == driver['target_condition'])]
        value, reason = None, None
        if case['status'] != 'succeeded':
            reason = case.get('error') or {'code': 'CASE_FAILED', 'message': '该候选未完成计算。'}
        elif not matches:
            reason = {'code': 'TARGET_MISSING', 'message': '方法未输出指定物理量、实体、单位与工况的结果。'}
        elif len(matches) != 1:
            reason = {'code': 'TARGET_AMBIGUOUS', 'message': '匹配到多个工况，请指定 target_condition。'}
        elif matches[0]['status'] != 'available':
            reason = matches[0].get('reason') or {'code': 'TARGET_UNAVAILABLE', 'message': '目标结果不可用。'}
        else:
            value = matches[0]['value']
        assessed.append({'case_id': case['case_id'], 'value': value,
                         'meets_target': None if value is None else value >= driver['minimum'],
                         'reason': reason})
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
            'sources': [{'run_id': r['id'], 'snapshot': r['snapshot']} for r in runs], 'differences': differences}


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
