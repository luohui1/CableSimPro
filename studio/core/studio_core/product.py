"""What a product specification answers on its own, without a project: electrical parameters,
short-circuit capacity, conformity with the product standard, and its rating table.

Each function runs a sealed method in a separate process and takes a whole batch: a series of fifty sizes is
one run of each method, not fifty. Methods that need limits or constants from a standard author their queries
in a first run; the basis library answers them; a second run uses the answers.
"""
from math import hypot, pi, sqrt
import re

from . import CoreError, basis, methods, runner, scene, study

ELECTRICAL = 'cablesim.type-electrical'
CHECK = 'cablesim.standard-check'
IDENTITY = ('run_id', 'plugin_id', 'plugin_version', 'capability', 'method_version', 'manifest_sha256', 'request_sha256')


def document_of(cable):
    """A domain document for one product. The methods here read the cable type and its materials only."""
    return scene.compose(cable['name'][:100], cable, scene.default_installation(cable), scene.default_conditions(cable))['document']


def _failure(case):
    error = case.get('error') or {}
    return {'code': error.get('code', 'METHOD_FAILED'), 'message': error.get('message', '方法没有给出结果。'),
            **({'path': error['path']} if error.get('path') else {})}


def _run(plugin, capability, cases):
    """One run of a method over many cases: its identity, and each case by the caller's key."""
    keys = list(cases)
    run = runner.run(plugin, capability, [{'case_id': f'case-{index}', **cases[key]} for index, key in enumerate(keys)])
    return {key: run[key] for key in IDENTITY}, {keys[int(case['case_id'].split('-')[1])]: case for case in run['cases']}


def _rows(artifact):
    return {row['id'].split(':', 1)[-1] if row['id'].startswith('common:') else row['id']: row for row in artifact['rows']}


def _single(results):
    result = results['one']
    if 'error' in result:
        raise CoreError(result['error']['code'], result['error']['message'], result['error'].get('path'))
    return result


def standard_conditions(cable, frequency_hz=50.0):
    """The conditions a specification sheet states its electrical values for, each with where it comes from.

    Conductor at its maximum operating temperature, power frequency, phase voltage U0; single cores touching in
    trefoil; three cores as they lie in the cable, with the laying-up factor that follows from the declared lay.
    """
    cable_type = cable['payload']['cable_type']
    rating = cable_type['rating']
    values = {'temperature_k': rating['max_conductor_temperature']['normal'], 'frequency_hz': frequency_hz, 'ks': 1.0, 'kp': 1.0,
              'phase_voltage_v': rating['u0'], 'r20_length_basis': 'finished_cable'}
    sources = {'temperature_k': '导体最高连续工作温度（型号额定值）', 'frequency_hz': '工频', 'phase_voltage_v': '额定相电压 U0（型号额定值）',
               'ks': 'IEC 60287-1-1:2023 表 2：圆绞导体、挤包绝缘，ks = 1', 'kp': 'IEC 60287-1-1:2023 表 2：圆绞导体、挤包绝缘，kp = 1',
               'r20_length_basis': '20 °C 直流电阻按每米成品电缆计（GB/T 3956 的口径）'}
    if cable_type['construction'] == 'three_core':
        cores = cable_type['cores']
        values['spacing_m'] = hypot(cores[0]['x'] - cores[1]['x'], cores[0]['z'] - cores[1]['z'])
        sources['spacing_m'] = '结构：成缆后相邻线芯的中心距'
        lay = cable_type.get('core_lay_length')
        if lay:
            radius = hypot(cores[0]['x'], cores[0]['z'])
            values['core_lay_factor'] = sqrt(1 + (2 * pi * radius / lay) ** 2)
            sources['core_lay_factor'] = f'由声明的成缆节距 {lay:g} m 与线芯中心所在圆半径 {radius * 1000:.2f} mm 按螺旋线长度得出'
    else:
        values.update(spacing_m=scene.outer_diameter(cable), arrangement='trefoil')
        sources.update(spacing_m='品字形紧贴：中心距等于电缆外径', arrangement='品字形紧贴敷设（规格书口径）')
    return values, sources


def short_circuit_conditions(cable, duration_s=1.0):
    limits = cable['payload']['cable_type']['rating']['max_conductor_temperature']
    values = {'duration_s': duration_s, 'initial_temperature_k': limits['normal'], 'final_temperature_k': limits.get('short_circuit', 523.15)}
    sources = {'duration_s': f'短路持续时间 {duration_s:g} s（规格书口径）', 'initial_temperature_k': '短路前导体处于最高连续工作温度',
               'final_temperature_k': 'XLPE 绝缘导体短路允许最高温度 250 °C（GB/T 12706.2—2020）'}
    return values, sources


RESISTIVITIES = (1.0, 1.2, 1.5, 2.0, 2.5, 3.0)


def rating_conditions(cable, depth_m=.7, ambient_c=25.0, frequency_hz=50.0):
    """The laying conditions a specification sheet tabulates: buried at the usual depth over a range of soils."""
    cable_type = cable['payload']['cable_type']
    conditions = lambda rho: {'soil_thermal_resistivity': rho, 'ambient_temperature_c': ambient_c, 'frequency_hz': frequency_hz,
                              'system_voltage_v': cable_type['rating'].get('u')}
    laying = lambda layout, **extra: {'layout': layout, 'depth_m': depth_m, 'spacing_m': None, 'duct': None, 'backfill': None,
                                     'bonding': 'both_ends', **extra}
    layouts = (['three_core_buried_single', 'three_core_ducts_horizontal'] if cable_type['construction'] == 'three_core'
               else ['trefoil', 'flat', 'ducts'])
    return [{'id': f'{layout}@{rho:g}', 'layout': layout, 'depth_m': depth_m, 'ambient_temperature_c': ambient_c, 'soil_thermal_resistivity': rho,
             'installation': laying(layout), 'conditions': conditions(rho)} for layout in layouts for rho in RESISTIVITIES]


def electrical_batch(items):
    """AC resistance, capacitance, charging current, dielectric loss and geometric inductance.

    `items` maps a key to (cable, values, sources): the method's SI inputs and where each one comes from.
    A value without a source is not used by the method.
    """
    cases = {}
    for key, (cable, values, sources) in items.items():
        document = document_of(cable)
        cases[key] = {'input': document, 'parameters': {'cable_type_id': document['cable_types'][0]['id'], **values, 'sources': sources}}
    identity, by = _run(ELECTRICAL, 'electrical', cases)
    results = {}
    for key, case in by.items():
        if case['status'] != 'succeeded':
            results[key] = {'error': _failure(case)}
            continue
        artifact = case['artifacts']['x-cablesim.type-electrical']
        results[key] = {'method': identity, 'rows': artifact['rows'], 'by_id': _rows(artifact), 'warnings': case['warnings'],
                        'conditions': {'values': items[key][1], 'sources': items[key][2]}}
    return results


def short_circuit_batch(items):
    """Permissible short-circuit current of the conductor and the metallic components (IEC 60949)."""
    cases = {}
    for key, (cable, values, sources) in items.items():
        document = document_of(cable)
        cases[key] = {'input': document, 'parameters': {'cable_type_id': document['cable_types'][0]['id'], **values, 'sources': sources}}
    planned = {key: {'input': case['input'], 'parameters': {**case['parameters'], 'basis_references': {}, 'parallel_components': []}}
               for key, case in cases.items()}
    _, plans = _run(ELECTRICAL, 'short-circuit', planned)
    results, queries = {}, {}
    for index, (key, case) in enumerate(plans.items()):
        if case['status'] != 'succeeded':
            results[key] = {'error': _failure(case)}
            continue
        for name, query in case['artifacts']['x-cablesim.type-short-circuit']['basis_queries'].items():
            queries[(key, name)] = query
    names = {f'q{index}': pair for index, pair in enumerate(queries)}
    references, missing = basis.resolve({name: queries[pair] for name, pair in names.items()}) if queries else ({}, [])
    final = {}
    for key, case in cases.items():
        if key in results:
            continue
        answered = {pair[1]: references[name] for name, pair in names.items() if pair[0] == key and name in references}
        final[key] = {'input': case['input'], 'parameters': {**case['parameters'], 'basis_references': answered}}
    if final:
        identity, by = _run(ELECTRICAL, 'short-circuit', final)
        for key, case in by.items():
            if case['status'] != 'succeeded':
                results[key] = {'error': _failure(case)}
                continue
            artifact = case['artifacts']['x-cablesim.type-short-circuit']
            results[key] = {'method': identity, 'rows': artifact['rows'], 'by_id': _rows(artifact), 'warnings': case['warnings'],
                            'basis_missing': [{**item, 'key': names[item['key']][1]} for item in missing if names[item['key']][0] == key],
                            'conditions': {'values': items[key][1], 'sources': items[key][2]}}
    return results


def _edition(text):
    return re.sub(r'\s+', '', text).replace('—', '-').replace(':', '-')


def standard_check_batch(items):
    """Conformity of each structure with its declared product standards, requirement by requirement.

    `items` maps a key to (cable, standards); the standards are the editions the product declares, written as in
    the standard ("GB/T 12706.2-2020"). Only requirements of declared editions are judged; the others are
    reported as not declared.
    """
    state = {}
    for key, (cable, standards) in items.items():
        document = document_of(cable)
        state[key] = {'document': document, 'cable_type_id': document['cable_types'][0]['id'], 'declared': {_edition(item) for item in standards},
                      'auxiliary': {}, 'artifact': None, 'pending': True}
    results = {}
    bound = lambda key, query: _edition(query['standard'] + '-' + query['edition']) in state[key]['declared']

    def stage(keys):
        cases = {}
        for key in keys:
            item = state[key]
            parameters = {'cable_type_id': item['cable_type_id']}
            if item['artifact'] is not None:
                parameters.update(basis_references=item['auxiliary'], basis_cable_sha256=item['artifact']['basis_cable_sha256'])
            cases[key] = {'input': item['document'], 'parameters': parameters}
        _, by = _run(CHECK, 'dimensions', cases)
        for key, case in by.items():
            if case['status'] != 'succeeded':
                results[key] = {'error': _failure(case)}
                state[key]['pending'] = False
            else:
                state[key]['artifact'] = case['artifacts']['x-cablesim.standard-check']

    # Some limits depend on intermediate diameters the method computes in stages; it asks, the library answers, it asks again.
    stage(list(state))
    for _ in range(24):
        asked = {}
        for key, item in state.items():
            if not item['pending']:
                continue
            pending = {name: query for name, query in item['artifact'].get('basis_auxiliary_queries', {}).items()
                       if bound(key, query) and name not in item['auxiliary']}
            if not pending:
                item['pending'] = False
            for name, query in pending.items():
                asked[(key, name)] = query
        if not asked:
            break
        names = {f'q{index}': pair for index, pair in enumerate(asked)}
        answered, absent = basis.resolve({name: asked[pair] for name, pair in names.items()})
        for name, reference in answered.items():
            state[names[name][0]]['auxiliary'][names[name][1]] = reference
        for item in absent:
            state[names[item['key']][0]]['auxiliary'][names[item['key']][1]] = {'uncovered': True, 'query': item['query']}
        stage(sorted({pair[0] for pair in asked}))
    else:
        raise CoreError('BASIS_INCOMPLETE', '标准依据查询没有收敛，请核对型号条件。')
    plans, undeclared = {}, {}
    for key, item in state.items():
        if key in results:
            continue
        rows = [row for row in item['artifact']['rows'] if row.get('basis_query')]
        for row in rows:
            if bound(key, row['basis_query']):
                plans[(key, row['id'])] = row['basis_query']
        undeclared[key] = sorted({row['basis_query']['standard'] + '—' + row['basis_query']['edition'] for row in rows if not bound(key, row['basis_query'])})
    names = {f'q{index}': pair for index, pair in enumerate(plans)}
    answered, missing = basis.resolve({name: plans[pair] for name, pair in names.items()}) if plans else ({}, [])
    final = {}
    for key, item in state.items():
        if key in results:
            continue
        references = {pair[1]: answered[name] for name, pair in names.items() if pair[0] == key and name in answered}
        final[key] = {'input': item['document'], 'parameters': {'cable_type_id': item['cable_type_id'], 'basis_references': {**item['auxiliary'], **references},
                                                                'basis_cable_sha256': item['artifact']['basis_cable_sha256']}}
    if final:
        identity, by = _run(CHECK, 'dimensions', final)
        for key, case in by.items():
            if case['status'] != 'succeeded':
                results[key] = {'error': _failure(case)}
                continue
            artifact = case['artifacts']['x-cablesim.standard-check']
            count = {}
            for row in artifact['rows']:
                count[row['verdict']] = count.get(row['verdict'], 0) + 1
            results[key] = {'method': identity, 'rows': artifact['rows'], 'by_id': {row['id']: row for row in artifact['rows']},
                            'summary': {'headline': artifact.get('headline'), 'count': count}, 'standards': sorted(items[key][1]),
                            'basis_missing': [{**item, 'key': names[item['key']][1]} for item in missing if names[item['key']][0] == key],
                            'undeclared_standards': undeclared[key], 'warnings': case['warnings']}
    return results


def rating_table_batch(items, overrides=None):
    """Permissible continuous current of each product under its list of laying conditions, in one run of the method.

    `items` maps a key to (cable, conditions); each condition is {'id', 'installation', 'conditions'} as a project
    states them. A condition the method does not cover comes back with the method's own refusal; nothing is
    interpolated from the neighbours.
    """
    cases, tables, documents = {}, {}, {}
    for key, (cable, conditions) in items.items():
        tables[key] = {'method': None, 'rows': []}
        for item in conditions:
            row = {'id': item['id']}
            tables[key]['rows'].append(row)
            try:
                composed = scene.compose(cable['name'][:100], cable, item['installation'], {**item['conditions'], 'currents_a': [0.0]})
            except CoreError as error:
                row.update(status='failed', error=error.as_dict())
                continue
            p = study.parameters(cable, composed['circuit_count'], overrides)
            documents[(key, item['id'])] = composed['document']
            row.update(layout_label=composed['layout_label'], circuits=composed['circuit_count'], tier=methods.tier(composed['document'], p))
            cases[(key, item['id'])] = {'input': composed['document'], 'parameters': p}
    if not cases:
        return tables
    identity, by = _run(methods.IEC, methods.STEADY, cases)
    for (key, condition), case in by.items():
        row = next(row for row in tables[key]['rows'] if row['id'] == condition)
        tables[key]['method'] = identity
        summary = study.summarize(case, documents[(key, condition)])
        row['status'] = summary['status']
        if summary['status'] != 'succeeded':
            row['error'] = summary['error']
            del row['tier']  # the tier describes a result; there is none
            continue
        ampacity = summary['ampacity']
        rated = max(summary['rated']['cables'], key=lambda state: state['conductor_c'], default=None)
        row.update(ampacity_a=ampacity['value_a'] if ampacity else None, basis_name=ampacity['basis_name'] if ampacity else None,
                   verification_passed=(summary['verification'] or {}).get('passed'), input_sha256=summary['input_sha256'],
                   ac_resistance_ohm_m=rated['ac_resistance_ohm_m'] if rated else None,
                   warnings=[warning['message'] for warning in summary['warnings']])
    return tables


KINDS = ('check', 'electrical', 'short_circuit', 'rating')


def compute(items, kinds):
    """What the library keeps for each product version: one batch per kind, each product under the conditions
    a specification sheet states. `items` are {'key', 'cable', 'standards'}; a kind that fails for one product
    is recorded for that product and does not stop the others."""
    unknown = [kind for kind in kinds if kind not in KINDS]
    if unknown:
        raise CoreError('COMPUTE_INVALID', f'没有这一类计算：{unknown[0]}。', '/kinds')
    cables = {item['key']: item['cable'] for item in items}
    results = {key: {} for key in cables}
    batches = {
        'check': lambda: standard_check_batch({item['key']: (item['cable'], item['standards']) for item in items}),
        'electrical': lambda: electrical_batch({key: (cable, *standard_conditions(cable)) for key, cable in cables.items()}),
        'short_circuit': lambda: short_circuit_batch({key: (cable, *short_circuit_conditions(cable)) for key, cable in cables.items()}),
        'rating': lambda: rating_table_batch({key: (cable, rating_conditions(cable)) for key, cable in cables.items()}),
    }
    for kind in kinds:
        try:
            batch = batches[kind]()
        except CoreError as error:
            batch = {key: {'error': error.as_dict()} for key in cables}
        for key, result in batch.items():
            result.pop('by_id', None)  # an index for callers in this process; the rows are what is kept
            if kind == 'rating':
                result['conditions'] = [{name: condition[name] for name in ('id', 'layout', 'depth_m', 'ambient_temperature_c', 'soil_thermal_resistivity')}
                                        for condition in rating_conditions(cables[key])]
            results[key][kind] = result
    return results


def electrical(cable, values, sources):
    return _single(electrical_batch({'one': (cable, values, sources)}))


def short_circuit(cable, values, sources):
    return _single(short_circuit_batch({'one': (cable, values, sources)}))


def standard_check(cable, standards):
    return _single(standard_check_batch({'one': (cable, standards)}))


def rating_table(cable, conditions, overrides=None):
    return rating_table_batch({'one': (cable, conditions)}, overrides)['one']
