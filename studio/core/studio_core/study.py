"""Check, sweep and selection built on the same composed input and the same runner.

Every number returned here was produced by the plugin; this module only builds the
cases, reads the saved artifacts back and compares values with the engineer's targets.
"""
from copy import deepcopy

from . import CoreError
from . import layouts, library, methods, runner, scene

TRACE = 'x-cablesim.iec60287-trace'
SWEEPS = {
    'soil_thermal_resistivity': {'label': '土壤热阻率', 'unit': 'K·m/W', 'part': 'conditions'},
    'ambient_temperature_c': {'label': '环境温度', 'unit': '°C', 'part': 'conditions'},
    'depth_m': {'label': '中心埋深', 'unit': 'm', 'part': 'installation'},
    'spacing_m': {'label': '中心距', 'unit': 'm', 'part': 'installation'},
    'current_a': {'label': '负荷电流', 'unit': 'A', 'part': 'conditions'},
}


def parameters(cable, circuit_count, overrides=None):
    """Method parameters: the library's declared defaults, then the engineer's overrides."""
    p = deepcopy(cable['method_defaults'])
    p.update(deepcopy(cable.get('method_parameters') or {}))
    p['operation'] = 'both'
    p['rating_mode'] = 'both' if circuit_count > 1 else 'individual'
    for key, value in (overrides or {}).items():
        if isinstance(value, dict) and isinstance(p.get(key), dict):
            p[key] = {**p[key], **value}
        elif value is not None:
            p[key] = value
    return p


def _state(state, positions):
    x, z = positions.get(state['entity'], (None, None))
    row = {
        'id': state['entity'], 'circuit': state['circuit'], 'phase': state['phase'], 'x': x, 'z': z,
        'current_a': state['current_a'], 'conductor_c': state['conductor_temperature_c'],
        'limit_c': state['temperature_limit_c'], 'margin_k': state['margin_k'],
        'sheath_c': state['sheath_temperature_c'], 'surface_c': state['surface_temperature_c'],
        'losses_w_m': {'conductor': state['conductor_loss_w_m'], 'sheath': state['sheath_loss_w_m'],
                       'dielectric': state['dielectric_loss_w_m'], 'total': state['total_loss_w_m']},
        'thermal_k_m_w': {'t1': state['t1_k_m_w'], 't3': state['t3_k_m_w'], 't4_air': state['t4_air_gap_k_m_w'],
                          't4_wall': state['t4_wall_k_m_w'], 't4_soil': state['t4_self_soil_k_m_w']},
        'mutual_rise_k': state['mutual_temperature_rise_k'], 'external_rise_k': state['external_temperature_rise_k'],
        'lambda1': state['lambda1'], 'ac_resistance_ohm_m': state['ac_resistance_ohm_m'],
        'ac_extra_factor': state.get('ac_extra_factor'), 'capacitance_f_m': state['capacitance_f_m'],
    }
    if state['t4_wall_k_m_w']:
        row['duct_inner_c'], row['duct_outer_c'] = state['duct_inner_temperature_c'], state['duct_outer_temperature_c']
    if 't2_k_m_w' in state:  # three-core branch: bedding resistance and armour loss
        row['thermal_k_m_w']['t2'] = state['t2_k_m_w']
        row['losses_w_m']['armour'] = state['armour_loss_w_m']
        row['lambda2'] = state['lambda2']
        row['armour_c'] = state.get('armour_temperature_c')
    return row


def summarize(case, document):
    """One case read back into the shape the screens and the calculation sheet use."""
    if case['status'] != 'succeeded':
        return {'status': case['status'], 'error': case['error']}
    trace = case['artifacts'][TRACE]
    section = document['sections'][0]
    positions = {p['cable']: (p['x'], p['z']) for p in section['placements']}
    labels = {c['id']: c['label'] for c in document['circuits']}
    loads = document['load_cases'][0]['currents']
    individual = [{'id': r['entity'], 'label': labels[r['entity']], 'ampacity_a': r['ampacity_a'],
                   'limiting_cable': r.get('limiting_cable'), 'load_a': loads.get(r['entity']),
                   'margin_a': None if r['ampacity_a'] is None or loads.get(r['entity']) is None
                   else r['ampacity_a'] - loads[r['entity']],
                   'error': r.get('error'), 'held_currents_a': r.get('held_currents_a', {})}
                  for r in trace['circuit_ratings']]
    common = trace.get('simultaneous_rating')
    if common and common.get('ampacity_a') is not None:
        headline = {'value_a': common['ampacity_a'], 'basis': 'common', 'basis_name': '全回路共同能力',
                    'meaning': '全部回路同时带相同的平衡电流，最先到温限的电缆决定共同电流。',
                    'limiting_cable': common['limiting_cable'], 'limiting_circuit': common['limiting_circuit']}
        rated = common['cable_states']
    else:
        available = [r for r in trace['circuit_ratings'] if r['ampacity_a'] is not None]
        chosen = min(available, key=lambda r: r['ampacity_a'], default=None)
        single = len(trace['circuit_ratings']) == 1
        headline = None if chosen is None else {
            'value_a': chosen['ampacity_a'], 'basis': 'single_circuit' if single else 'individual',
            'basis_name': '单回路能力' if single else '逐回路条件上限',
            'meaning': '同回路各相共同变化，最先到温限的电缆决定上限。' if single
            else '其他回路保持保存负荷时本回路的上限；各回路上限不能同时使用。',
            'limiting_cable': chosen['limiting_cable'], 'limiting_circuit': chosen['entity']}
        rated = chosen['cable_states'] if chosen else []
    operating = trace['operating']
    states = [_state(s, positions) for s in operating['cable_states']]
    hottest = max(states, key=lambda s: s['conductor_c'], default=None)
    return {
        'status': 'succeeded', 'headline_text': case['evidence'].get('headline'), 'ampacity': headline,
        'circuits': individual,
        'operating': {'cables': states, 'hottest_cable': hottest['id'] if hottest else None,
                      'within_limit': all(s['margin_k'] >= 0 for s in states) if states else None,
                      'iterations': operating.get('iterations'), 'residual_k': operating.get('residual_k'),
                      'error': operating.get('error')},
        'rated': {'cables': [_state(s, positions) for s in rated]},
        'ambient_c': section['medium']['surface_temperature'] - 273.15,
        'heat_contributions': trace.get('heat_contributions', []),
        'verification': trace.get('verification'),
        'soil': {k: trace['soil'][k] for k in ('source', 'common_correction_k_m_w', 'contact_trefoil', 'geometric_factor',
                                              'equivalent_radius_m') if k in trace.get('soil', {})},
        'warnings': case['warnings'],
        'input_sha256': case['evidence'].get('prepared_input_sha256'),
    }


def _context(scene_input):
    cable = scene_input['cable']
    composed = scene.compose(scene_input.get('name') or '未命名工程', cable, scene_input['installation'], scene_input['conditions'])
    p = parameters(cable, composed['circuit_count'], scene_input.get('parameters'))
    return cable, composed, p


def _record(kind, run, cases, extra):
    """Everything a run record needs to be re-read without the project: request, result, identities."""
    return {'kind': kind, 'plugin_id': run['plugin_id'], 'plugin_version': run['plugin_version'],
            'capability': run['capability'], 'method_version': run['method_version'],
            'manifest_sha256': run['manifest_sha256'], 'request_sha256': run['request_sha256'],
            'core_run_id': run['run_id'], 'environment': run['environment'],
            'request': {'cases': cases}, 'result': {'cases': run['cases']}, **extra}


def preview(scene_input):
    """Composed document, tier and method parameters without running anything."""
    cable, composed, p = _context(scene_input)
    return {**composed, 'parameters': p, 'tier': methods.tier(composed['document'], p),
            'layouts': layouts.options(cable['payload']['cable_type']['construction'])}


def rate(scene_input):
    cable, composed, p = _context(scene_input)
    cases = [{'case_id': 'main', 'input': composed['document'], 'parameters': p}]
    run = runner.run(methods.IEC, methods.STEADY, cases)
    case = run['cases'][0]
    summary = summarize(case, composed['document'])
    trace = case['artifacts'].get(TRACE)
    return _record('rating', run, cases, {
        'summary': summary, 'method_card': methods.card(composed['document'], p, run, trace),
        'document': composed['document'], 'parameters': p, 'outer_diameter_m': composed['outer_diameter_m']})


def _vary(scene_input, variable, value):
    changed = deepcopy(scene_input)
    if variable == 'current_a':
        changed['conditions']['currents_a'] = [value]
    else:
        changed[SWEEPS[variable]['part']][variable] = value
    return changed


def sweep(scene_input, variable, values):
    if variable not in SWEEPS:
        raise CoreError('SWEEP_INVALID', f'不支持扫描 {variable}；可选：' + '、'.join(v['label'] for v in SWEEPS.values()), '/variable')
    if not isinstance(values, list) or not 2 <= len(values) <= 50 or any(
            isinstance(v, bool) or not isinstance(v, (int, float)) for v in values):
        raise CoreError('SWEEP_INVALID', '扫描需要 2 到 50 个数值。', '/values')
    cable, base, p = _context(scene_input)
    cases, documents, points = [], {}, []
    for index, value in enumerate(values):
        case_id = f'point-{index}'
        varied = _vary(scene_input, variable, value)
        try:
            composed = scene.compose(scene_input.get('name') or '未命名工程', cable, varied['installation'], varied['conditions'])
        except CoreError as error:
            points.append({'case_id': case_id, 'value': value, 'status': 'failed', 'error': error.as_dict()})
            continue
        documents[case_id] = composed['document']
        cases.append({'case_id': case_id, 'input': composed['document'], 'parameters': p})
        points.append({'case_id': case_id, 'value': value})
    if not cases:
        raise CoreError('SWEEP_INVALID', '所有扫描点都无法组成有效输入：' + points[0]['error']['message'], '/values')
    run = runner.run(methods.IEC, methods.STEADY, cases)
    by_id = {case['case_id']: case for case in run['cases']}
    for point in points:
        case = by_id.get(point['case_id'])
        if case is None:
            continue
        summary = summarize(case, documents[point['case_id']])
        point['status'] = summary['status']
        if summary['status'] != 'succeeded':
            point['error'] = summary['error']
            continue
        hottest = max(summary['operating']['cables'], key=lambda s: s['conductor_c'], default=None)
        point.update(ampacity_a=summary['ampacity']['value_a'] if summary['ampacity'] else None,
                     limiting_cable=summary['ampacity']['limiting_cable'] if summary['ampacity'] else None,
                     hottest_conductor_c=hottest['conductor_c'] if hottest else None,
                     within_limit=summary['operating']['within_limit'], operating_error=summary['operating']['error'])
    first = next((case for case in run['cases'] if case['status'] == 'succeeded'), None)
    return _record('sweep', run, cases, {
        'sweep': {'variable': variable, **SWEEPS[variable], 'points': points},
        'method_card': methods.card(base['document'], p, run, first['artifacts'].get(TRACE) if first else None),
        'document': base['document'], 'parameters': p, 'outer_diameter_m': base['outer_diameter_m']})


def select(scene_input, candidate_ids, target_current_a):
    """Rate each candidate in the same installation and conditions at the target load."""
    if isinstance(target_current_a, bool) or not isinstance(target_current_a, (int, float)) or target_current_a <= 0:
        raise CoreError('SELECTION_INVALID', '请给出正的目标电流，单位 A。', '/target_current_a')
    if not isinstance(candidate_ids, list) or not 1 <= len(candidate_ids) <= 30 or len(set(candidate_ids)) != len(candidate_ids):
        raise CoreError('SELECTION_INVALID', '请选择 1 到 30 个不重复的候选型号。', '/candidates')
    construction = scene_input['cable']['payload']['cable_type']['construction']
    cases, documents, rows, parameter_sets = [], {}, [], {}
    for index, model_id in enumerate(candidate_ids):
        candidate = library.get(model_id)
        row = {'case_id': f'candidate-{index}', 'model_id': model_id, 'name': candidate['name'],
               'area_mm2': candidate['summary']['area_mm2'], 'content_sha256': candidate['content_sha256']}
        rows.append(row)
        if candidate['payload']['cable_type']['construction'] != construction:
            row.update(status='not_applicable', error={'code': 'CONSTRUCTION_MISMATCH', 'message': '芯数与当前敷设方式不匹配，未计算。'})
            continue
        # Two cases per candidate in the same request: the unloaded one yields the rating even when
        # the target load has no steady state; the loaded one yields the temperature at the target.
        try:
            composed = {}
            for suffix, current in (('', target_current_a), ('-rating', 0.0)):
                changed = deepcopy(scene_input)
                changed['conditions']['currents_a'] = [current]
                composed[suffix] = scene.compose(scene_input.get('name') or '未命名工程', candidate,
                                                 changed['installation'], changed['conditions'])
        except CoreError as error:
            row.update(status='not_applicable', error=error.as_dict())
            continue
        p = parameters(candidate, composed['']['circuit_count'], scene_input.get('parameters'))
        parameter_sets[row['case_id']] = p
        for suffix, item in composed.items():
            documents[row['case_id'] + suffix] = item['document']
            cases.append({'case_id': row['case_id'] + suffix, 'input': item['document'], 'parameters': p})
    if not cases:
        raise CoreError('SELECTION_INVALID', '没有候选型号能放进当前敷设：' + rows[0]['error']['message'], '/candidates')
    run = runner.run(methods.IEC, methods.STEADY, cases)
    by_id = {case['case_id']: case for case in run['cases']}
    for row in rows:
        case = by_id.get(row['case_id'] + '-rating')
        if case is None:
            continue
        summary = summarize(case, documents[row['case_id'] + '-rating'])
        row['status'] = summary['status']
        if summary['status'] != 'succeeded':
            row['error'] = summary['error']
            continue
        ampacity = summary['ampacity']['value_a'] if summary['ampacity'] else None
        row.update(ampacity_a=ampacity, basis_name=summary['ampacity']['basis_name'] if summary['ampacity'] else None,
                   meets_target=None if ampacity is None else ampacity >= target_current_a,
                   margin_a=None if ampacity is None else ampacity - target_current_a,
                   tier=methods.tier(documents[row['case_id']], parameter_sets[row['case_id']])['tier'])
        loaded = summarize(by_id[row['case_id']], documents[row['case_id']])
        if loaded['status'] != 'succeeded':
            row['at_target_error'] = loaded['error']
        elif loaded['operating']['error']:
            row['at_target_error'] = loaded['operating']['error']
        else:
            row['conductor_at_target_c'] = max(s['conductor_c'] for s in loaded['operating']['cables'])
    passing = sorted((row for row in rows if row.get('meets_target')), key=lambda row: (row['area_mm2'], row['ampacity_a']))
    chosen = passing[0] if passing else None
    first_id = chosen['case_id'] if chosen else next(
        (row['case_id'] for row in rows if row.get('status') == 'succeeded'), None)
    first = by_id.get(first_id) if first_id and by_id.get(first_id, {}).get('status') == 'succeeded' else by_id.get(
        (first_id or '') + '-rating')
    return _record('selection', run, cases, {
        'selection': {'target_current_a': target_current_a, 'candidates': rows,
                      'chosen': chosen['model_id'] if chosen else None,
                      'rule': '满足目标电流的候选中取导体截面最小者；截面相同取允许电流较小者。',
                      'reason': None if chosen else '没有候选在当前敷设与工况下达到目标电流。'},
        'method_card': methods.card(documents[first_id], parameter_sets[first_id], run, first['artifacts'].get(TRACE))
        if first and first['status'] == 'succeeded' else None,
        'document': documents.get(first_id), 'parameters': parameter_sets.get(first_id)})
