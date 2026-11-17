"""Two-dimensional rating tables projected only from complete saved API rows.

A missing cross-product cell remains explicitly uncomputed. Rows with the same
rounded area/current are not merged. Unequal physical conditions are never
coalesced by their display rounding. All headers keep their own source facts.
"""
from __future__ import annotations

from copy import deepcopy
import re

from .formal_contracts import canonical_bytes, fail, is_number, jsonsha, raw_text, resolve_pointer
from .formal_presentation import engineering_text, expected_display, cell_text, cell_unit


def label(text):
    return {'value': text, 'raw_text': text, 'value_ref': None, 'unit': None, 'unit_ref': None}


def literal(model, source_id, pointer, unit, contract, field):
    value = resolve_pointer(model['sources'][source_id]['payload'], pointer)
    if not is_number(value):
        fail('FORMAL_MATRIX_CONDITION', '载流量表的规格或前提缺少已保存数值，不使用默认值。')
    return {'value': value, 'raw_text': raw_text(value),
            'value_ref': {'source_id': source_id, 'pointer': pointer}, 'unit': unit,
            'unit_ref': {'contract': contract, 'field': field}}


def _fact(model, name, source_id, pointer, unit, contract, field):
    cell = literal(model, source_id, pointer, unit, contract, field)
    cell['display'] = expected_display(model, cell)
    return {'label': name, 'cell': cell}


def _family(condition):
    layout = condition.get('layout') or ''
    if 'duct' in layout:
        return 'duct', '排管敷设'
    if 'air' in layout:
        return 'air', '空气中敷设'
    if 'buried' in layout or layout in ('flat', 'trefoil', 'horizontal', 'single'):
        return 'buried', '直埋敷设'
    fail('FORMAL_MATRIX_LAYOUT', '保存载流量记录没有可识别的敷设方式，不猜测二维表分组。')


def _case_data(model, source_id, index):
    source = model['sources'][source_id]
    run_id = source['run_source_id']
    run = model['sources'][run_id]['payload']
    row = source['payload']['rows'][index]
    matches = [(i, c) for i, c in enumerate(run['snapshot']['cases']) if c['case_id'] == row['case_id']]
    if len(matches) != 1:
        fail('FORMAL_MATRIX_BINDING', '载流量表格无法唯一定位到保存运行工况。')
    case_index, case = matches[0]
    input_path = '/snapshot/cases/' + str(case_index) + '/input'
    inputs = case['input']
    cables = inputs.get('cable_types', [])
    if len(cables) != 1 or not cables[0].get('cores'):
        fail('FORMAL_MATRIX_SPECIFICATION', '当前二维表要求每个工况对应一个明确的电缆规格。')
    cable = cables[0]
    areas = [core.get('conductor', {}).get('nominal_area') for core in cable['cores']]
    if not all(is_number(a) and a > 0 for a in areas) or len({raw_text(a) for a in areas}) != 1:
        fail('FORMAL_MATRIX_SPECIFICATION', '工况缺少等截面的导体标称面积，不以猜测的规格生成表格。')
    area = literal(model, run_id, input_path + '/cable_types/0/cores/0/conductor/nominal_area',
                   'm2', 'cablesim.domain/1', '/cable_types/0/cores/0/conductor/nominal_area')
    # The full cable identity (not just rounded area) keeps material, insulation,
    # voltage and construction variants distinct, including equal-area designs.
    spec_key = jsonsha(cable)
    condition = row['condition']
    group, group_name = _family(condition)
    root = '/rows/' + str(index) + '/condition/'
    facts = []
    fields = [('ambient_temperature_c', '环境温度', '°C'),
              ('frequency_hz', '频率', 'Hz'),
              ('circuit_count', '回路数', '1')]
    if group != 'air':
        fields[:0] = [('depth_m', '中心埋深', 'm'),
                      ('soil_rho_k_m_w', '土壤热阻率', 'K·m/W')]
    for key, title, unit in fields:
        if condition.get(key) is None:
            fail('FORMAL_MATRIX_CONDITION', '载流量表缺少前提：' + title)
        facts.append(_fact(model, title, source_id, root + key, unit, 'type-rating-table', key))
    if inputs.get('criteria', {}).get('max_conductor_temperature') is not None:
        limit = input_path + '/criteria/max_conductor_temperature'
        field = '/criteria/max_conductor_temperature'
    else:
        limit = input_path + '/cable_types/0/rating/max_conductor_temperature/normal'
        field = '/cable_types/0/rating/max_conductor_temperature/normal'
    try:
        facts.append(_fact(model, '导体最高允许温度', run_id, limit,
                           'K', 'cablesim.domain/1', field))
    except (KeyError, IndexError, TypeError):
        fail('FORMAL_MATRIX_CONDITION', '导体最高允许温度没有保存依据。')
    if condition.get('actual_spacing_m') is not None:
        facts.append(_fact(model, '回路中心间距', source_id, root + 'actual_spacing_m',
                           'm', 'type-rating-table', 'actual_spacing_m'))
    if group == 'duct':
        for key, title, unit in [('duct_inner_m', '管道内径', 'm'),
                                 ('duct_outer_m', '管道外径', 'm'),
                                 ('duct_rho_k_m_w', '管壁热阻率', 'K·m/W')]:
            if condition.get(key) is None:
                fail('FORMAL_MATRIX_CONDITION', '排管前提缺项：' + title)
            facts.append(_fact(model, title, source_id, root + key, unit, 'type-rating-table', key))
    loads = inputs.get('load_cases', [])
    kinds = sorted({item.get('kind') for item in loads if isinstance(item.get('kind'), str)})
    if len(kinds) != 1 or kinds[0] != 'steady':
        fail('FORMAL_MATRIX_LOAD', '该二维允许电流表仅展示已保存稳态负荷工况，不把其他负荷自动等效为稳态。')
    premise = [engineering_text(condition.get('rating_basis_name') or '保存载流量口径'),
               '负荷模型：稳态；负荷率：未单独保存',
               '屏蔽接地：' + engineering_text(condition.get('bonding') or '未保存')]
    # Only physical header facts enter the column identity. The complete input
    # remains bound by each cell. Conflicting duplicates below are rejected.
    identity = {'layout': condition.get('layout'), 'circuits': condition.get('circuit_count'),
                'facts': [(f['label'], f['cell']['raw_text'], f['cell']['unit']) for f in facts],
                'bonding': condition.get('bonding'), 'rating_basis': condition.get('rating_basis'),
                'loads': kinds, 'parameters': case['parameters']}
    name = condition.get('name') or row.get('name') or group_name
    name = engineering_text(name)
    if not re.search('[一-鿿]', name):
        name = group_name
    return {'source_id': source_id, 'index': index, 'group': group, 'group_name': group_name,
            'spec_key': spec_key, 'area': area, 'spec_label': cable.get('label') or '保存规格', 'cable_ref': {'source_id': run_id, 'pointer': input_path + '/cable_types/0'},
            'column_key': jsonsha(identity), 'facts': facts, 'premises': premise, 'name': name,
            'case_ref': {'source_id': run_id, 'pointer': '/snapshot/cases/' + str(case_index)},
            'projection_ref': {'source_id': source_id, 'pointer': '/rows/' + str(index)}}


def matrix_tables(model, source_id):
    """Return bounded-width panels with a specification x condition grid."""
    source = model['sources'][source_id]
    records = [_case_data(model, source_id, i) for i in range(len(source['payload']['rows']))]
    result = []
    for group in dict.fromkeys(item['group'] for item in records):
        selected = [r for r in records if r['group'] == group]
        specs, conditions, grid = {}, {}, {}
        for record in selected:
            specs.setdefault(record['spec_key'], record)
            conditions.setdefault(record['column_key'], record)
            address = (record['spec_key'], record['column_key'])
            if address in grid:
                fail('FORMAL_MATRIX_DUPLICATE', '同一规格与精确条件存在多条载流量记录，请明确选择，不覆盖或取平均值。')
            grid[address] = record
        condition_keys = list(conditions)
        for offset in range(0, len(condition_keys), 3):
            keys = condition_keys[offset:offset + 3]
            columns = [{'key': 'specification', 'label': '规格', 'role': 'text', 'weight': 1.5},
                       {'key': 'area', 'label': '导体标称截面 (mm²)', 'role': 'value', 'weight': 1.0, 'unit_in_header': True}]
            for col, key in enumerate(keys, offset + 1):
                record = conditions[key]
                facts = deepcopy(record['facts'])
                header = '条件' + str(col) + '\n' + record['name']
                header += '\n' + '\n'.join(f['label'] + '：' + cell_text(f['cell']) + (' ' + cell_unit(f['cell']) if cell_unit(f['cell']) != '1' else '') for f in facts)
                header += '\n' + '\n'.join(record['premises'])
                header += '\n允许电流（A）'
                columns.append({'key': key, 'label': header, 'role': 'value', 'weight': 2.0,
                                'unit_in_header': True, 'header_facts': facts, 'condition_ref': record['projection_ref']})
            rows = []
            for row_no, (spec_key, record) in enumerate(specs.items(), 1):
                cells = {'specification': label('规格' + str(row_no) + '\n' + engineering_text(record['spec_label'])), 'area': deepcopy(record['area'])}
                bindings = {}
                for key in keys:
                    saved = grid.get((spec_key, key))
                    if saved is None:
                        cells[key] = label('未计算')
                        continue
                    cells[key] = literal(model, source_id, '/rows/' + str(saved['index']) + '/value_a',
                                         'A', 'type-rating-table', 'value_a')
                    bindings[key] = {'case_ref': saved['case_ref'], 'projection_ref': saved['projection_ref']}
                rows.append({'id': spec_key, 'cells': cells, 'specification_ref': record['cable_ref'], 'bindings': bindings})
            identifier = source_id + ':matrix:' + group + ':' + str(offset // 3)
            result.append((identifier, {'title': selected[0]['group_name'] + '载流量表',
                'columns': columns, 'rows': rows, 'matrix_source': source_id,
                'matrix_group': group, 'matrix_panel': offset // 3,
                'missing_cell_policy': 'uncomputed-not-zero'}))
    return result


def replace_rating_tables(model):
    """Keep prior exact row/condition projections in trace, not in the body."""
    archived = []
    for source_id, source in list(model['sources'].items()):
        if source.get('kind') != 'rating_projection':
            continue
        original = source_id + ':currents'
        section = next((s for s in model['sections'] if original in s['table_ids'] and s['role'] == 'body'), None)
        if section is None:
            continue
        for identifier in list(section['table_ids']):
            if identifier.startswith(source_id + ':') or identifier.startswith(source['run_source_id'] + ':'):
                section['table_ids'].remove(identifier)
                archived.append(identifier)
        for identifier, table in matrix_tables(model, source_id):
            model['tables'][identifier] = table
            section['table_ids'].append(identifier)
    if archived:
        model['sections'].append({'id': 'rating-raw-trace', 'role': 'trace',
            'heading': '载流量原始记录', 'paragraphs': [], 'table_ids': archived})
