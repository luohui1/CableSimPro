"""Formatting contracts only; numerical examples are not substitute solver results.

The real saved-study/API tests and installed-release gate exercise the full
engineering flow. These small inputs isolate exact conversion, half-even ties,
source retention, matrix addressing and intentional corruption rejection.
"""
from copy import deepcopy
from decimal import Decimal

from fastapi import HTTPException
import pytest

from backend.kernel.formal_contracts import canonical_bytes, raw_text, validate_model_refs
from backend.kernel.formal_presentation import (
    apply_presentation, number_display, expected_display, engineering_text,
)
from backend.kernel.formal_rating_matrix import matrix_tables
from scripts.verify_formal_delivery import check_engineering_number
from test_formal_contracts import reference_model


@pytest.mark.parametrize('value,unit,role,text,target', [
    (565.4761493206024, 'A', 'quantity', '565', 'A'),
    (748.3219742774963, 'A', 'quantity', '748', 'A'),
    (748.3219800000001, 'A', 'quantity', '748', 'A'),
    (2723.3999999999996, 'kg/km', 'quantity', '2723', 'kg/km'),
    (2.7234, 'kg/m', 'quantity', '2723', 'kg/km'),
    (338.6719999639408, 'K', 'quantity', '65.5', '°C'),
    (12.345, 'K', 'temperature_interval', '12.3', '°C'),
    (0.0861051177665153, 'm', 'diameter', '86.1', 'mm'),
    (0.001235, 'm', 'thickness', '1.24', 'mm'),
    (0.001225, 'm', 'thickness', '1.22', 'mm'),
    (0.0003, 'm2', 'quantity', '300', 'mm²'),
    (2.9962834e-5, 'ohm/m', 'quantity', '0.02996', 'Ω/km'),
    (1.2345, 'ohm/km', 'quantity', '1.234', 'Ω/km'),
    (1.2355, 'ohm/km', 'quantity', '1.236', 'Ω/km'),
    (0.00393, '1/K', 'quantity', '0.00393', '1/°C'),
    (-0.0001, 'A', 'quantity', '0', 'A'),
    # Thermal compounds keep K as written in IEC 60287, never °C·m/W.
    (1.2, 'K·m/W', 'quantity', '1.2', 'K·m/W'),
    (0.3549, 'K*m/W', 'quantity', '0.3549', 'K·m/W'),
    (2.0e6, 'J/(m³·K)', 'quantity', '2000000', 'J/(m³·K)'),
    # Customary per-length units; a customer document never shows E notation.
    (2.198e-10, 'F/m', 'quantity', '0.2198', 'μF/km'),
    (1.234567891234e-12, 'F/m', 'quantity', '0.001235', 'μF/km'),
    (4.123e-7, 'H/m', 'quantity', '0.4123', 'mH/km'),
    (1.7241e-8, 'Ω·m', 'quantity', '0.01724', 'Ω·mm²/m'),
    (0.0004, '1', 'quantity', '0.0004', '1'),
    (3.2e-9, '1', 'quantity', '0.0000000032', '1'),
])
def test_explicit_engineering_conversion_examples(value, unit, role, text, target):
    original = raw_text(value)
    display = number_display(value, unit, role)
    assert (display['text'], display['unit']) == (text, target)
    assert display['rounding'] == 'ROUND_HALF_EVEN'
    assert 'E' not in display['text']
    assert raw_text(value) == original


@pytest.mark.parametrize('value,unit,text', [
    (9.99995, 'ohm/km', '10.00'), (9.9995e-05, 'ohm/km', '0.0001000'), (999.95, 'A/m', '1000'),
])
def test_rounding_that_carries_a_magnitude_keeps_four_digits_in_producer_and_verifier(value, unit, text):
    # Ω/km keeps trailing zeros; 9.99995 rounded at 0.001 carries to "10.000" and a
    # tiny value would read as unrounded, so both sides round once at the new magnitude.
    display = number_display(value, unit)
    assert display['text'] == text
    cell = {'value': value, 'raw_text': raw_text(value), 'value_ref': {'source_id': 'record', 'pointer': '/value'},
            'unit': unit, 'unit_ref': None, 'display': display}
    assert check_engineering_number(cell, {'record': {'value': value}}) == display


@pytest.mark.parametrize('value,answer', [(2.5, '2'), (3.5, '4'), (-2.5, '-2'),
    (-3.5, '-4'), (2.500001, '3'), (2.499999, '2'), (4.500001, '5')])
def test_rounds_once_not_by_intermediate_decimal_places(value, answer):
    assert number_display(value, 'A')['text'] == answer


def test_global_decimal_precision_does_not_change_output():
    from decimal import localcontext
    with localcontext() as context:
        context.prec = 6
        assert number_display(338.6719999639408, 'K')['text'] == '65.5'


@pytest.mark.parametrize('value', [float('nan'), float('inf'), float('-inf'), True, None, '1.2'])
def test_unsupported_or_non_finite_values_are_not_silently_coerced(value):
    with pytest.raises(ValueError):
        number_display(value, 'A')


def presented():
    model = reference_model()
    before = canonical_bytes(model['sources'])
    apply_presentation(model)
    assert canonical_bytes(model['sources']) == before
    validate_model_refs(model)
    return model


def test_raw_value_unit_and_printable_source_remain_unchanged():
    model = presented()
    body = model['tables']['values']['rows'][0]['cells']['value']
    trace = model['tables']['presentation:values']['rows'][0]['cells']['original']
    assert body['value'] == trace['value']
    assert body['raw_text'] == trace['raw_text']
    assert body['unit'] == trace['unit']
    assert body['value_ref'] == trace['value_ref']
    assert 'display' in body and 'display' not in trace
    payloads = {k: s['payload'] for k, s in model['sources'].items()}
    assert check_engineering_number(body, payloads) == body['display']
    assert check_engineering_number(trace, payloads) == trace['display_origin']


@pytest.mark.parametrize('field,bad', [('text', '999'), ('unit', 'A'), ('offset', '-273.15'),
    ('quantum', '1'), ('rounding', 'ROUND_HALF_UP'), ('role', 'temperature_interval')])
def test_tampering_cannot_change_the_display_or_its_audit_rule(field, bad):
    model = presented()
    cell = model['tables']['values']['rows'][0]['cells']['value']
    cell['display'][field] = bad
    with pytest.raises(HTTPException):
        validate_model_refs(model)
    with pytest.raises(RuntimeError):
        check_engineering_number(cell, {k: s['payload'] for k, s in model['sources'].items()})


@pytest.mark.parametrize('column', ['display', 'relation', 'source'])
def test_printable_trace_cannot_contradict_saved_display(column):
    model = presented()
    cell = model['tables']['presentation:values']['rows'][0]['cells'][column]
    cell['value'] = cell['raw_text'] = 'tampered printable trace'
    with pytest.raises(HTTPException):
        validate_model_refs(model)


def test_missing_printable_trace_is_rejected():
    model = presented()
    model['tables']['presentation:values']['rows'].clear()
    with pytest.raises(HTTPException):
        validate_model_refs(model)


def test_case_names_are_chinese_and_never_leak_layout_ids():
    assert engineering_text('case-0 / case-1') == '工况1 / 工况2'
    assert engineering_text('three_core_buried_single') == '三芯直埋单回'
    assert engineering_text('338.6719999639408 K') == '原始说明见追溯记录'


@pytest.mark.parametrize('column,original,display', [
    ('material', '敷设介质 · v0 soil热阻率 · 采用值', '敷设介质 · 旧版土壤材料热阻率 · 采用值'),
    ('context', '可用；design', '可用；设计值'),
    ('context', '可用；derived', '可用；推导值'),
    ('context', 'measurement', '实测值'),
    ('context', 'manufacturer_limit', '厂家声明上限'),
    ('context', 'unknown', '未明确'),
])
def test_body_names_are_chinese_but_exact_in_source_and_trace(column, original, display):
    model = reference_model()
    source = model['sources']['record']
    source['payload']['material'] = original
    from backend.kernel.formal_contracts import jsonsha
    source['payload_digest'] = jsonsha(source['payload'])
    reference = {'source_id': 'record', 'pointer': '/material'}
    model['tables']['values']['columns'].append({'key': column, 'label': '说明', 'role': 'text'})
    cell = {'value': original, 'raw_text': original, 'value_ref': reference,
            'unit': None, 'unit_ref': None}
    model['tables']['values']['rows'][0]['cells'][column] = cell
    saved_sources = canonical_bytes(model['sources'])

    apply_presentation(model)
    validate_model_refs(model)

    assert cell['display_text'] == display
    assert cell['value'] == cell['raw_text'] == original
    assert canonical_bytes(model['sources']) == saved_sources
    row = next(row for row in model['tables']['presentation:prose']['rows']
               if row['cells']['original']['value_ref'] == reference)
    assert row['cells']['original']['raw_text'] == original
    assert row['cells']['display']['raw_text'] == cell['display_text']
    # A legacy material name can touch Chinese prose, but cannot be a substring
    # replacement inside an unrelated ASCII identifier.
    assert engineering_text('v0 soil') == '旧版土壤材料'
    assert engineering_text('v0 soils / legacy-v0 soil') == 'v0 soils / legacy-v0 soil'
    assert engineering_text('design / derived') == 'design / derived'


def matrix_input():
    # Layout-only fixture. Each value is explicitly a serialization example;
    # the real-study suite verifies independently executed ampacity results.
    cases, rows = [], []
    for area in [0.0003, 0.0004]:
        for depth, rho in [(0.8, 1.0), (1.2, 1.5)]:
            index = len(rows)
            cases.append({'case_id': 'case-' + str(index), 'parameters': {}, 'input': {
                'schema_version': 'cablesim.domain/1',
                'cable_types': [{'label': 'Layout fixture', 'cores': [{'conductor': {'nominal_area': area}}],
                                'rating': {'max_conductor_temperature': {'normal': 363.15}}}],
                'load_cases': [{'kind': 'steady'}]}})
            rows.append({'case_id': cases[-1]['case_id'], 'value_a': 100.5 + index,
                         'condition': {'layout': 'three_core_buried_single', 'name': '直埋单回',
                            'depth_m': depth, 'soil_rho_k_m_w': rho, 'ambient_temperature_c': 20.0,
                            'frequency_hz': 50.0, 'circuit_count': 1, 'bonding': 'both_ends'}})
    return {'sources': {
        'run': {'kind': 'run', 'payload': {'snapshot': {'cases': cases}}},
        'projection': {'kind': 'rating_projection', 'run_source_id': 'run', 'payload': {'rows': rows}},
    }}


def test_matrix_has_two_specification_rows_and_two_exact_condition_columns():
    model = matrix_input()
    tables = dict(matrix_tables(model, 'projection'))
    assert len(tables) == 1
    table = next(iter(tables.values()))
    assert len(table['rows']) == 2
    assert len(table['columns']) == 4
    values = [row['cells'][column['key']]['value'] for row in table['rows'] for column in table['columns'][2:]]
    assert values == [100.5, 101.5, 102.5, 103.5]
    for column in table['columns'][2:]:
        assert '负荷率：未单独保存' in column['label']
        assert '°C' in column['label'] and 'case-' not in column['label']
    for row in table['rows']:
        assert len(row['bindings']) == 2
        assert row['specification_ref']['source_id'] == 'run'


def test_matrix_missing_crossing_is_uncomputed_not_zero():
    model = matrix_input()
    model['sources']['projection']['payload']['rows'].pop()
    table = next(iter(dict(matrix_tables(model, 'projection')).values()))
    cell = table['rows'][1]['cells'][table['columns'][3]['key']]
    assert cell['value'] == '未计算' and cell['value_ref'] is None


def test_matrix_duplicate_crossing_does_not_average_or_overwrite():
    model = matrix_input()
    model['sources']['projection']['payload']['rows'].append(deepcopy(model['sources']['projection']['payload']['rows'][0]))
    with pytest.raises(HTTPException) as error:
        matrix_tables(model, 'projection')
    assert error.value.detail['code'] == 'FORMAL_MATRIX_DUPLICATE'


def test_matrix_conditions_that_round_equal_still_get_distinct_columns():
    model = matrix_input()
    rows = model['sources']['projection']['payload']['rows']
    for i in (1, 3):
        rows[i]['condition'].update(depth_m=0.8000000001, soil_rho_k_m_w=1.0)
    table = next(iter(dict(matrix_tables(model, 'projection')).values()))
    assert len(table['columns']) == 4
    assert table['columns'][2]['key'] != table['columns'][3]['key']


def test_matrix_unknown_temperature_is_an_explicit_failure():
    model = matrix_input()
    del model['sources']['run']['payload']['snapshot']['cases'][0]['input']['cable_types'][0]['rating']
    with pytest.raises(HTTPException) as error:
        matrix_tables(model, 'projection')
    assert error.value.detail['code'] == 'FORMAL_MATRIX_CONDITION'


def test_missing_quantity_keeps_null_and_displays_declared_engineering_unit():
    from backend.kernel.formal_presentation import cell_unit
    model = reference_model()
    cell = model['tables']['values']['rows'][0]['cells']['value']
    # Preserve the real reference structure but make the serialization example
    # explicitly missing, as electrical artifacts can report uncovered fields.
    ref = cell['value_ref']; source = model['sources'][ref['source_id']]['payload']
    from backend.kernel.formal_contracts import resolve_pointer
    parent = resolve_pointer(source, ref['pointer'].rsplit('/', 1)[0])
    parent[ref['pointer'].rsplit('/', 1)[-1]] = None
    cell.update(value=None, raw_text='', unit='Ω/m')
    apply_presentation(model)
    assert cell['value'] is None and cell['raw_text'] == ''
    assert cell['unit'] == 'Ω/m' and cell_unit(cell) == 'Ω/km'
    assert 'display' not in cell  # No synthetic numeric original or conversion.


def test_xlsx_cover_declares_presentation_not_obsolete_no_rounding():
    from io import BytesIO
    from openpyxl import load_workbook
    from backend.kernel.formal_xlsx import render_xlsx
    model = presented()
    workbook = load_workbook(BytesIO(render_xlsx(model)))
    text = '\n'.join(str(cell.value or '') for row in workbook.worksheets[0] for cell in row)
    assert 'GB/T 8170' in text
    assert '不作舍入或单位换算' not in text
