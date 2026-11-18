"""Declared, one-step engineering presentation of immutable saved quantities.

GB/T 8170-2008 clauses 3.2/3.3 specify the rounding operation, not the
project-selected precision. Decimal conversion starts at the saved JSON lexeme;
no intermediate rounding, source mutation or engineering re-evaluation occurs.
"""
from __future__ import annotations

from copy import deepcopy
from collections import Counter
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
import re

from .formal_contracts import is_number, raw_text, referenced_value, resolve_pointer, jsonsha

POLICY_ID = 'cablesim.engineering-display/2'
POLICY = {
    'id': POLICY_ID, 'standard': 'GB/T 8170-2008 3.2, 3.3',
    'rounding': 'ROUND_HALF_EVEN', 'conversion': 'decimal(saved JSON lexeme) * scale + offset',
    'round_once': True, 'source_values_unchanged': True, 'notation': 'plain decimal, never E notation',
    'precisions': {'current_A': '1', 'temperature_degC': '0.1', 'diameter_mm': '0.1',
                   'thickness_mm': '0.01', 'mass_kg_per_km': '1', 'resistance': '4 significant digits',
                   'other_quantities': 'at most 4 significant digits'},
    'units': {'thermal_compounds': 'K (K·m/W, W/(m·K), J/(kg·K), J/(m³·K), W/(m²·K), K/W)',
              'capacitance': 'μF/km', 'inductance': 'mH/km', 'resistivity': 'Ω·mm²/m'},
}
DECLARATION = (
    '显示修约按 GB/T 8170-2008 第 3.2、3.3 条：'
    '从保存原值做十进制单位换算，'
    '仅修约一次，恰好五成双，不连续修约。'
    '本文选定的显示精度：电流 1 A；'
    '温度 0.1 °C；外径及直径 0.1 mm；'
    '厚度 0.01 mm；质量 1 kg/km；'
    '电阻 4 位有效数字，其他工程量最多 4 位有效数字，不用科学记数法。'
    '截面用 mm²，单位长度电阻用 Ω/km，电容用 μF/km，电感用 mH/km，电阻率用 Ω·mm²/m；'
    '热阻率等含温差的复合单位按 IEC 60287 用开尔文表示，如 K·m/W。'
    '温差及温度系数不作绝对温度偏移。'
    '原始 SI 值、换算关系及修约间隔见追溯页。'
    '修约不改变原保存的合格判定。'
)
_LONG_DECIMAL = re.compile(r'\d+\.\d{7,}')
# Visible body numbers: an unrounded value has 7+ decimals AND 5+ significant
# digits. A once-rounded small value (0.0001235, 4 digits) is plain decimal.
_UNROUNDED = re.compile(r'(?<![\d.])(?:[1-9]\d*\.\d{7,}|0\.(?=\d{7,})0*[1-9]\d{4,})')
# Prose is never converted, so any kelvin token sends it to the trace.
_BARE_K = re.compile(r'(?<![A-Za-z])K(?![A-Za-z])')
# Visible body text: K is allowed only inside a declared thermal compound unit
# (joined by a middle dot, or K/W); a bare K would be a raw kelvin value.
_BODY_K = re.compile(r'(?<![A-Za-z·])K(?![A-Za-z·])(?!/W)')
# Declared temperature-difference compounds keep K, written with a middle dot.
THERMAL_UNITS = {
    'K·m/W': 'K·m/W', 'K*m/W': 'K·m/W', 'K.m/W': 'K·m/W', 'm·K/W': 'K·m/W', 'm*K/W': 'K·m/W',
    'K/W': 'K/W',
    'W/(m·K)': 'W/(m·K)', 'W/(m*K)': 'W/(m·K)', 'W/(m.K)': 'W/(m·K)',
    'W/(m²·K)': 'W/(m²·K)', 'W/(m2*K)': 'W/(m²·K)', 'W/(m^2*K)': 'W/(m²·K)',
    'J/(kg·K)': 'J/(kg·K)', 'J/(kg*K)': 'J/(kg·K)', 'J/(kg.K)': 'J/(kg·K)',
    'J/(m³·K)': 'J/(m³·K)', 'J/(m3*K)': 'J/(m³·K)', 'J/(m^3*K)': 'J/(m³·K)',
}
# Per-length quantities whose SI values are tiny: shown in customary units.
SCALED_UNITS = {'F/m': ('μF/km', Decimal('1000000000')), 'H/m': ('mH/km', Decimal('1000000')),
                'Ω·m': ('Ω·mm²/m', Decimal('1000000')), 'ohm*m': ('Ω·mm²/m', Decimal('1000000'))}
_KEEP_ZEROS = ('Ω/km', 'Ω', 'Ω·m', 'Ω·mm²/m')
_CASE = re.compile(r'\bcase-(\d+)\b')
_LAYOUTS = {
    'three_core_buried_single': '三芯直埋单回',
    'three_core_buried_horizontal': '三芯直埋三回水平',
    'three_core_ducts_horizontal': '三芯排管三回水平',
    'three_core_air_single': '三芯空气中单回',
    'both_ends': '两端接地', 'single_point': '单点接地',
    'cross_bonded': '交叉互联',
}
_BASIS_NAMES = {
    'design': '设计值', 'derived': '推导值', 'measurement': '实测值',
    'manufacturer_limit': '厂家声明上限', 'unknown': '未明确',
}


def _hint(model, cell):
    reference = cell.get('value_ref') or {}
    path = reference.get('pointer', '')
    hints = [path.rsplit('/', 1)[-1]]
    source = model.get('sources', {}).get(reference.get('source_id'), {}).get('payload')
    if source is not None:
        try:
            parent = resolve_pointer(source, path.rsplit('/', 1)[0])
            if isinstance(parent, dict):
                hints.extend(str(parent.get(k, '')) for k in ('key', 'id', 'title', 'label', 'property', 'quantity'))
        except (KeyError, IndexError, TypeError, ValueError):
            pass  # Reference integrity is separately mandatory in the contract.
    return ' '.join(hints).lower(), path.lower()


def quantity_role(model, cell):
    """Determine display precision from saved field semantics, never a guessed unit."""
    hint, path = _hint(model, cell)
    if cell.get('unit') in ('K', '°C', '℃') and any(word in hint for word in ('difference', 'margin', 'temperature_rise', 'headroom', 'delta_', 'critical_temperature_rise')):
        return 'temperature_interval'
    if any(word in hint for word in ('thickness', '厚度')):
        return 'thickness'
    if any(word in hint for word in ('diameter', 'radius', 'duct_inner_m', 'duct_outer_m', '外径', '内径', '直径', '半径')):
        return 'diameter'
    if any(word in path for word in ('/layers/', '/common_layers/', '/conductor/')) and cell.get('unit') == 'm':
        return 'dimension'
    return 'quantity'


def unit_label(unit, role='quantity'):
    """Display a declared unit even for a missing value; do not invent a number."""
    if unit in ('K', '°C', '℃'):
        return '°C'
    if unit in ('m2', 'm^2', 'm²', 'mm2', 'mm^2', 'mm²'):
        return 'mm²'
    if unit in ('ohm/m', 'Ω/m', 'ohm/km', 'Ω/km'):
        return 'Ω/km'
    if unit in ('kg/m', 'kg/km'):
        return 'kg/km'
    if unit in ('m', 'mm') and role in ('diameter', 'thickness', 'dimension'):
        return 'mm'
    if unit in THERMAL_UNITS:
        return THERMAL_UNITS[unit]
    if unit in SCALED_UNITS:
        return SCALED_UNITS[unit][0]
    return unit.replace('K', '°C') if isinstance(unit, str) else unit


def number_display(value, unit, role='quantity'):
    """Return exact affine conversion and one declared rounding operation."""
    if not is_number(value) or not isinstance(unit, str):
        raise ValueError('Engineering display requires a saved finite quantity and its declared unit')
    original = Decimal(raw_text(value))
    if not original.is_finite():
        raise ValueError('Non-finite engineering quantity')
    target, scale, offset, interval = unit, Decimal(1), Decimal(0), None
    if unit in ('K', '°C', '℃'):
        target, interval = '°C', Decimal('0.1')
        if unit == 'K' and role != 'temperature_interval':
            offset = Decimal('-273.15')
    elif unit in ('m2', 'm^2', 'm²'):
        target, scale = 'mm²', Decimal('1000000')
    elif unit in ('mm2', 'mm^2', 'mm²'):
        target = 'mm²'
    elif unit in ('ohm/m', 'Ω/m'):
        target, scale = 'Ω/km', Decimal('1000')
    elif unit in ('ohm/km', 'Ω/km'):
        target = 'Ω/km'
    elif unit in ('kg/m', 'kg/km'):
        target, interval = 'kg/km', Decimal('1')
        scale = Decimal('1000') if unit == 'kg/m' else Decimal(1)
    elif unit == 'A':
        interval = Decimal('1')
    elif unit in ('m', 'mm') and role in ('diameter', 'thickness', 'dimension'):
        target, scale = 'mm', Decimal('1000') if unit == 'm' else Decimal(1)
        interval = Decimal('0.01') if role == 'thickness' else Decimal('0.1')
    elif unit in THERMAL_UNITS:
        target = THERMAL_UNITS[unit]
    elif unit in SCALED_UNITS:
        target, scale = SCALED_UNITS[unit]
    # A kelvin interval is one Celsius degree. Never apply an affine offset
    # to thermal resistivity, specific heat or a resistance coefficient.
    if 'K' in target and unit not in ('K', '°C', '℃') and unit not in THERMAL_UNITS:
        target = target.replace('K', '°C')
    with localcontext() as ctx:
        ctx.prec = max(64, len(original.as_tuple().digits) + abs(original.adjusted()) + 32)
        converted = original * scale + offset
        fixed = interval is not None
        if interval is None:
            interval = Decimal(1).scaleb(converted.adjusted() - 3) if converted else Decimal(1)
        rounded = converted.quantize(interval, rounding=ROUND_HALF_EVEN)
        if not rounded:
            rounded = rounded.copy_abs()  # Do not print -0; the original sign is in trace.
        # Plain decimal only: a customer document never shows E notation.
        text = format(rounded, 'f')
        if not fixed and '.' in text and target not in _KEEP_ZEROS:
            text = text.rstrip('0').rstrip('.')
        if len(text) > 80:
            raise ValueError('Displayed number exceeds the readable engineering field width')
    return {'policy': POLICY_ID, 'text': text, 'unit': target, 'scale': str(scale), 'offset': str(offset),
            'quantum': str(interval), 'rounding': 'ROUND_HALF_EVEN',
            'precision': 'fixed_interval' if fixed else '4_significant_digits', 'role': role}


def expected_display(model, cell):
    return number_display(cell['value'], cell['unit'], quantity_role(model, cell))


def cell_text(cell):
    return cell.get('display', {}).get('text', cell.get('display_text', cell['raw_text']))


def cell_unit(cell):
    return cell.get('display', {}).get('unit', cell.get('display_unit', cell.get('unit')))


def engineering_text(text, names=None):
    result = str(text)
    # The saved legacy material name may directly precede Chinese property
    # text. ASCII boundaries preserve unrelated identifiers without treating
    # that Chinese suffix as part of the name. Raw cells/sources stay intact.
    result = re.sub(r'(?<![A-Za-z0-9_.-])v0 soil(?![A-Za-z0-9_.-])',
                    '旧版土壤材料', result, flags=re.I)
    for key, label in sorted({**_LAYOUTS, **(names or {})}.items(), key=lambda item: len(item[0]), reverse=True):
        result = re.sub(r'(?<![\w.-])' + re.escape(key) + r'(?![\w.-])', lambda _: label, result, flags=re.I)
    result = _CASE.sub(lambda m: '工况' + str(int(m[1]) + 1), result)
    # Unstructured prose is not a numeric contract. Do not silently round or
    # reinterpret embedded numbers; retain the exact prose in the trace.
    if _LONG_DECIMAL.search(result) or _BARE_K.search(result) or re.search(r'\bthree_core_[a-z_]+', result):
        return '原始说明见追溯记录'
    return result


def _label(text):
    return {'value': text, 'raw_text': text, 'value_ref': None, 'unit': None, 'unit_ref': None}


def presentation_names(model):
    names = {}
    for source in model['sources'].values():
        if source.get('kind') != 'run':
            continue
        # case-N is local to one run. Never build a global ID -> name map
        # that lets a later run silently relabel an earlier run's case.
        for frozen in source['payload']['snapshot'].get('method_manifests', {}).values():
            if isinstance(frozen, dict) and frozen.get('id') and frozen.get('name'):
                names[frozen['id']] = frozen['name']

    return names


def apply_presentation(model):
    """Attach audited displays; keep every original value and source unchanged."""
    if 'presentation' in model:
        raise ValueError('Engineering presentation must be applied exactly once')
    model['presentation'] = deepcopy(POLICY)
    numeric_rows, prose_rows = [], []
    seen_prose = set()
    names = presentation_names(model)
    source_keys = {key: 'R' + str(i + 1) for i, key in enumerate(model['sources'])}

    def prose(original, translated, reference=None):
        key = (original, str(reference))
        if original != translated and key not in seen_prose:
            seen_prose.add(key)
            original_cell = _label(original)
            original_cell['value_ref'] = reference
            prose_rows.append({'id': str(len(prose_rows)), 'cells': {
                'display': _label(translated), 'original': original_cell}})

    def number(cell, position):
        cell['display'] = expected_display(model, cell)
        original = deepcopy(cell)
        original.pop('display')
        original['display_origin'] = deepcopy(cell['display'])
        display = cell['display']
        source = cell['value_ref']
        relation = f"y = x * {display['scale']} + ({display['offset']}); q = {display['quantum']}"
        numeric_rows.append({'id': str(len(numeric_rows)), 'cells': {
            'position': _label(position), 'original': original,
            'display': _label(display['text'] + ' ' + display['unit']),
            'relation': _label(relation),
            'source': _label(source_keys[source['source_id']] + '\n' + source['pointer'])}})

    table_number = 0
    for section in model['sections']:
        if section['role'] != 'body':
            continue
        if section['id'] == 'overview':
            section['paragraphs'].append({'text': DECLARATION, 'source_ref': None, 'verbatim': False})
        for table_id in section['table_ids']:
            table = model['tables'][table_id]
            table_number += 1
            table['display_number'] = table_number
            table_key = 'T' + str(table_number)
            for column in table['columns']:
                for fact in column.get('header_facts', []):
                    number(fact['cell'], table_key + ':header:' + str(table['columns'].index(column) + 1) + ':' + fact['label'])
                if column['label'] == '原始数值':
                    column['label'] = '工程数值'
            for index, row in enumerate(table['rows']):
                measured = [c for c in row['cells'].values() if c.get('unit') is not None]
                for key, cell in row['cells'].items():
                    if is_number(cell['value']):
                        number(cell, f'{table_key} / {index + 1}:{key}' if len(key) < 24 else f'{table_key} / {index + 1}:C{list(row["cells"]).index(key) + 1}')
                    else:
                        column = next(c for c in table['columns'] if c['key'] == key)
                        if cell['value'] is None and cell.get('unit') is not None:
                            cell['display_unit'] = unit_label(cell['unit'], quantity_role(model, cell))
                        if column.get('role') == 'unit' and len(measured) == 1 and cell['value'] == measured[0].get('unit'):
                            translated = unit_label(measured[0]['unit'], quantity_role(model, measured[0]))
                        else:
                            # Basis enums are meaningful only in the saved
                            # context column, not in user-supplied object names.
                            display_names = {**_BASIS_NAMES, **names} if key == 'context' else names
                            translated = engineering_text(cell['raw_text'], display_names)
                        if translated != cell['raw_text']:
                            cell['display_text'] = translated
                            prose(cell['raw_text'], translated, cell.get('value_ref'))
        for figure in section.get('figures', []):
            geometry = referenced_value(model, figure['geometry_ref'])
            if is_number(geometry.get('outer_diameter_m')):
                ref = {**figure['geometry_ref'], 'pointer': figure['geometry_ref']['pointer'] + '/outer_diameter_m'}
                cell = {**_label(''), 'value': geometry['outer_diameter_m'], 'raw_text': raw_text(geometry['outer_diameter_m']),
                        'unit': 'm', 'value_ref': ref,
                        'unit_ref': {'contract': 'x-cablesim.cad-model', 'field': 'outer_diameter_m'}}
                number(cell, section['id'] + ':figure:diameter')
                figure['diameter_cell'] = cell
    # The explicit ledger is printable as well as machine archived. Distinct
    # originals remain distinct even when they have the same rounded display.
    ledger = {'id': 'presentation-trace', 'role': 'trace', 'heading': '原值与显示换算',
              'paragraphs': [{'text': DECLARATION, 'source_ref': None, 'verbatim': False}], 'table_ids': []}
    if numeric_rows:
        table_id = 'presentation:values'
        model['tables'][table_id] = {'title': '每项显示值的原值、单位及修约',
            'columns': [{'key': key, 'label': title, 'role': role, 'weight': weight} for key, title, role, weight in (
                ('position', '正文位置', 'text', 1.3),
                ('original', '保存原值与单位', 'value', 1.9),
                ('display', '显示值与单位', 'text', 1.1),
                ('relation', '换算与修约', 'text', 1.5),
                ('source', '运行与原始指针', 'text', 2.2))], 'rows': numeric_rows}
        ledger['table_ids'].append(table_id)
    if prose_rows:
        table_id = 'presentation:prose'
        model['tables'][table_id] = {'title': '名称与原始说明对照',
            'columns': [{'key': 'display', 'label': '正文显示', 'role': 'text', 'weight': 1},
                        {'key': 'original', 'label': '完整原文', 'role': 'text', 'weight': 3}], 'rows': prose_rows}
        ledger['table_ids'].append(table_id)
    source_table = 'presentation:sources'
    model['tables'][source_table] = {'title': '换算表的来源索引',
        'columns': [{'key': 'key', 'label': '索引', 'role': 'text', 'weight': .6},
                    {'key': 'source', 'label': '完整来源身份', 'role': 'text', 'weight': 3.4}],
        'rows': [{'id': key, 'cells': {'key': _label(source_keys[key]), 'source': _label(key)}} for key in source_keys]}
    ledger['table_ids'].insert(0, source_table)
    model['sections'].append(ledger)


def prepare_engineering_body(model):
    """Separate developer/raw material from the concise customer-facing body."""
    from .formal_rating_matrix import replace_rating_tables
    replace_rating_tables(model)
    trace = {'id': 'engineering-originals', 'role': 'trace',
             'heading': '保存的方法参数及完整说明', 'paragraphs': [], 'table_ids': []}
    for section in model['sections']:
        if section['role'] != 'body':
            continue
        keep = []
        for paragraph in section.get('paragraphs', []):
            text = paragraph['text']
            if paragraph.get('verbatim'):
                trace['paragraphs'].append(deepcopy(paragraph))
            elif text.startswith(('保存公式', '保存的结论原文', '已保存的适用范围与假设')):
                continue
            else:
                keep.append(paragraph)
        section['paragraphs'] = keep
        if section['id'] == 'overview' and keep:
            keep[0]['text'] = ('本文采用已保存的运行记录，'
                '正文仅作已声明的单位换算与显示修约；'
                '原始值、单位、完整公式和结论保留在追溯部分。'
                '空值不补齐，未计算的表格交叉项不写为零。')
        if section['id'] == 'inputs':
            section['paragraphs'] = [{'text': '关键工程输入与结果使用同一显示规则。完整输入、迭代容差和方法参数见追溯记录。',
                                      'source_ref': None, 'verbatim': False}]
        for table_id in list(section['table_ids']):
            # 3-D model internals (modelled length, volumes, densities) are
            # evidence for the usage figures, not specification content.
            if (table_id.endswith((':parameters', ':model-internals'))
                    or (model['kind'] == 'rating_table' and not model['tables'][table_id].get('matrix_source'))):
                section['table_ids'].remove(table_id)
                trace['table_ids'].append(table_id)
    assumptions = {'id': 'engineering-assumptions', 'role': 'body', 'heading': '适用范围与工况前提',
        'table_ids': [], 'paragraphs': [{'text': '下列为本份工况直接相关的要点；方法的完整适用边界、验证来源与原始结论见追溯记录。',
                                        'source_ref': None, 'verbatim': False}]}
    seen = set()
    for source_id, source in model['sources'].items():
        if source.get('kind') != 'run':
            continue
        payload = source['payload']
        cases = payload['snapshot']['cases']
        three_core = any(c.get('construction') == 'three_core' for case in cases for c in case['input'].get('cable_types', []))
        single_core = any(c.get('construction') != 'three_core' for case in cases for c in case['input'].get('cable_types', []))
        ground = any(s.get('kind') == 'ground' for case in cases for s in case['input'].get('sections', []))
        historical = any('tb' in str(case['parameters'].get('reference_basis', '')).lower() for case in cases)
        per_circuit = any(case['parameters'].get('rating_mode') in ('per_circuit', 'both') for case in cases)
        for index, text in enumerate(payload['output'].get('limitations', [])):
            if not isinstance(text, str) or not text:
                continue
            # Select a relevant saved premise, not a generated engineering claim.
            relevant = ((text.startswith('地下稳态') and ground)
                or (text.startswith('三芯仅') and three_core)
                or (text.startswith('单芯自动') and single_core)
                or (text.startswith('逐回路') and per_circuit)
                or (text.startswith('选择 TB') and historical))
            if not relevant:
                continue
            # Sentence boundaries preserve a complete saved statement. Every
            # omitted continuation remains available verbatim in the trace.
            concise = text.split('。', 1)[0] + '。'
            if concise in seen:
                continue
            seen.add(concise)
            assumptions['paragraphs'].append({'text': concise, 'source_ref': {'source_id': source_id,
                'pointer': '/output/limitations/' + str(index)}, 'verbatim': False})
    first_trace = next(i for i, s in enumerate(model['sections']) if s['role'] == 'trace')
    model['sections'].insert(first_trace, assumptions)
    if trace['table_ids'] or trace['paragraphs']:
        model['sections'].append(trace)


def validate_presentation(model):
    """Re-evaluate displays from raw references, not renderer-supplied metadata."""
    if model.get('presentation') != POLICY:
        raise ValueError('Unknown or altered engineering presentation policy')
    body_tables = {t for s in model['sections'] if s['role'] == 'body' for t in s['table_ids']}
    names = presentation_names(model)
    expected_trace = Counter()
    def covered(cell):
        expected_trace[jsonsha([cell['value_ref'], cell['raw_text'], cell['unit'], expected_display(model, cell)])] += 1
    for table_id, table in model['tables'].items():
        for row in table['rows']:
            measured = [c for c in row['cells'].values() if c.get('unit') is not None]
            for cell in row['cells'].values():
                if table_id in body_tables and is_number(cell['value']):
                    covered(cell)
                    if cell.get('display') != expected_display(model, cell):
                        raise ValueError('Displayed engineering number does not equal declared conversion and one-step rounding')
                elif table_id in body_tables:
                    key = next(k for k, c in row['cells'].items() if c is cell)
                    column = next(c for c in table['columns'] if c['key'] == key)
                    if cell['value'] is None and cell.get('unit') is not None:
                        if cell.get('display_unit') != unit_label(cell['unit'], quantity_role(model, cell)):
                            raise ValueError('Missing quantity has an inconsistent display unit')
                    elif 'display_unit' in cell:
                        raise ValueError('Unit-only display is reserved for missing quantities')
                    translated = (unit_label(measured[0]['unit'], quantity_role(model, measured[0]))
                        if column.get('role') == 'unit' and len(measured) == 1 and cell['value'] == measured[0].get('unit')
                        else engineering_text(cell['raw_text'], {**_BASIS_NAMES, **names} if key == 'context' else names))
                    if cell_text(cell) != translated:
                        raise ValueError('Body prose or a separate unit cell differs from its declared translation')
                elif 'display' in cell or 'display_unit' in cell:
                    raise ValueError('Raw trace cells must not carry a rounded display')
                if 'display_origin' in cell and cell['display_origin'] != expected_display(model, cell):
                    raise ValueError('Trace conversion annotation differs from its saved original value')
                if table_id not in body_tables and 'display_text' in cell:
                    raise ValueError('Raw trace prose must remain verbatim')
        for column in table['columns']:
            for fact in column.get('header_facts', []):
                cell = fact['cell']
                covered(cell)
                if cell.get('display') != expected_display(model, cell):
                    raise ValueError('Matrix header display differs from its frozen numerical premise')
                if raw_text(referenced_value(model, cell['value_ref'])) != cell['raw_text']:
                    raise ValueError('Matrix header has no matching frozen numerical premise')
    from .formal_rating_matrix import matrix_tables
    expected_matrices = {}
    for source_id, source in model['sources'].items():
        if source.get('kind') == 'rating_projection':
            expected_matrices.update(matrix_tables(model, source_id))
    actual_matrices = {t: v for t, v in model['tables'].items() if v.get('matrix_source')}
    if set(actual_matrices) != set(expected_matrices):
        raise ValueError('A rating matrix is missing, duplicated or unrelated to its saved API rows')
    for table_id, table in actual_matrices.items():
        expected = expected_matrices[table_id]
        actual = deepcopy(table)
        actual.pop('display_number', None)
        for row in actual['rows']:
            for cell in row['cells'].values():
                cell.pop('display', None)
                cell.pop('display_text', None)
        if actual != expected:
            raise ValueError('Rating matrix headers, specification rows or cells differ from the saved records')
    visible = []
    for section in model['sections']:
        if section['role'] != 'body':
            continue
        visible.append(section['heading'])
        visible.extend(p['text'] for p in section.get('paragraphs', []))
        for table_id in section['table_ids']:
            table = model['tables'][table_id]
            visible.append(table.get('title', ''))
            visible.extend(c['label'] for c in table['columns'])
            for row in table['rows']:
                for cell in row['cells'].values():
                    visible.extend([cell_text(cell), str(cell_unit(cell) or '')])
        for figure in section.get('figures', []):
            cell = figure.get('diameter_cell')
            if cell is not None:
                covered(cell)
                if cell['raw_text'] != raw_text(referenced_value(model, cell['value_ref'])) or cell['display'] != expected_display(model, cell):
                    raise ValueError('Diagram dimension is not the declared display of its saved diameter')
    if any(_UNROUNDED.search(text) or _BODY_K.search(text) or _CASE.search(text)
           or re.search(r'\bthree_core_[a-z_]+', text) for text in visible):
        raise ValueError('Engineering body contains an unrounded decimal, kelvin unit or internal case/layout identifier')

    observed_trace = Counter()
    source_keys = {key: 'R' + str(i + 1) for i, key in enumerate(model['sources'])}
    for row in model['tables'].get('presentation:values', {}).get('rows', []):
        cell = row['cells']['original']
        display = expected_display(model, cell)
        reference = cell['value_ref']
        relation = f"y = x * {display['scale']} + ({display['offset']}); q = {display['quantum']}"
        if (row['cells']['display']['value'] != display['text'] + ' ' + display['unit']
                or row['cells']['relation']['value'] != relation
                or row['cells']['source']['value'] != source_keys[reference['source_id']] + '\n' + reference['pointer']):
            raise ValueError('Printable trace conversion or source differs from its original value')
        observed_trace[jsonsha([reference, cell['raw_text'], cell['unit'], display])] += 1
    if expected_trace != observed_trace:
        raise ValueError('Printable trace does not cover every body, matrix header and diagram quantity')
