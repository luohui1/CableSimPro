"""A factory's structure tables turned into products the methods can work on.

The tables are those a Chinese manufacturer publishes for its 8.7/15 kV XLPE cables (People Cable Group,
tables 1, 2, 3 and 5 of the catalogue: 46 copper sizes), with the catalogue's own rating table to compare with.
"""
from copy import deepcopy

import pytest

from studio_core import CoreError, catalogue, designation, library, product, structure

PEOPLE = catalogue.tables('people_mv_xlpe')


def built(table_id, model=None):
    series, rows = catalogue.table_series(PEOPLE, table_id, model)
    return series, rows, structure.build(series, rows)


def cable(item):
    return {**item['entry'], 'id': 'test', 'version': '1'}


@pytest.mark.parametrize('text, expected', [
    ('YJV22-8.7/15 3×240', {'model': 'YJV22', 'conductor': 'copper', 'sheath': 'PVC', 'u0_v': 8700, 'u_v': 15000, 'cores': 3, 'area_mm2': 240}),
    ('ZC-YJLV22-8.7/15kV 3*120', {'model': 'YJLV22', 'prefixes': ['ZC'], 'conductor': 'aluminium', 'cores': 3, 'area_mm2': 120}),
    ('WDZA-YJY23-26/35 3×300', {'model': 'YJY23', 'prefixes': ['WDZA'], 'sheath': 'PE', 'u0_v': 26000, 'u_v': 35000}),
    ('YJV 8.7/10(8.7/15)kV 1×400', {'model': 'YJV', 'armour': None, 'u0_v': 8700, 'u_v': 10000, 'cores': 1, 'area_mm2': 400}),
    ('YJLW03-64/110 1×800', {'model': 'YJLW03', 'metal_sheath': 'corrugated_aluminium', 'sheath': 'PE', 'u_v': 110000}),
    ('YJV32', {'model': 'YJV32', 'u0_v': None, 'cores': None}),
])
def test_designations_are_read_as_written(text, expected):
    parts = designation.parse(text)
    assert {key: parts[key] for key in expected} == expected


def test_a_designation_says_what_the_cable_is():
    parts = designation.parse('YJV22-8.7/15 3×240')
    assert parts['armour']['kind'] == 'steel_tape'
    assert designation.describe(parts) == '铜芯交联聚乙烯绝缘双钢带铠装聚氯乙烯护套电力电缆'
    assert designation.name(parts) == 'YJV22-8.7/15 kV 3×240'
    with pytest.raises(CoreError) as refused:
        designation.parse('BV 2.5')
    assert refused.value.code == 'DESIGNATION_UNKNOWN'


def test_every_published_size_builds_and_fits_inside_its_outer_diameter():
    count = 0
    for table in PEOPLE['tables']:
        series, rows, result = built(table['id'])
        assert all(item['ok'] for item in result['rows']), [item for item in result['rows'] if not item['ok']]
        for item, row in zip(result['rows'], rows):
            closure = item['closure']
            # What the layers leave over is the unlisted wrapping: never negative beyond the tolerance, never large.
            assert -closure['tolerance_mm'] / 2 <= closure['residual_mm'] < 2.0
            assert item['entry']['summary']['outer_diameter_m'] * 1000 == pytest.approx(row['outer_diameter'], abs=closure['tolerance_mm'])
            assert item['entry']['summary']['area_mm2'] == row['area'] and item['name'].endswith(f"{table['cores']}×{row['area']:g}")
            count += 1
    assert count == 46


def test_the_family_the_sealed_completion_covers_goes_through_it():
    _, _, armoured = built('three-core-steel-tape')
    _, _, single = built('single-core')
    assert {item['derivation']['kind'] for item in armoured['rows']} == {'plugin'}
    assert armoured['rows'][0]['derivation']['plugin_id'] == 'cablesim.iec60287'
    # Outside the completion's scope the structure is built as stated, without the quantities a rating method derives.
    assert {item['derivation']['kind'] for item in single['rows']} == {'stated'}
    screen = next(layer for layer in single['rows'][0]['entry']['payload']['cable_type']['common_layers'] if layer['role'] == 'metallic_screen')
    assert 'longitudinal_r20' not in screen


def test_the_import_reproduces_the_series_already_in_the_library():
    import json
    data = json.loads((library.SERIES / 'huayuan_yjv22.json').read_text('utf-8'))
    rename = {'metallic_screen_tape_width': 'screen_tape_width', 'metallic_screen_tape_thickness': 'screen_tape_thickness',
              'binder_tape_thickness': 'binder_thickness'}
    common = {rename.get(key, key): value for key, (value, _) in data['common_manufacturer_values'].items() if rename.get(key, key) in structure.FIELDS}
    keys = [column for column, _ in data['columns']]
    series = {'name': 'YJV22-8.7/15 kV 三芯（华远公开表）', 'manufacturer': data['manufacturer'], 'designation': 'YJV22', 'cores': 3,
              'u0_v': 8700, 'u_v': 15000, 'standards': [], 'common': common, 'modelling': data['engineering_scenario']['parameters']['values']}
    result = structure.build(series, [dict(zip(keys, row)) for row in data['rows']])
    for item in result['rows']:
        stored = library.get(f"huayuan.yjv22-15kv-{item['area_mm2']:g}")
        assert item['entry']['content_sha256'] == stored['content_sha256']


def test_a_suspicious_row_is_pointed_out_not_corrected():
    _, _, result = built('single-core')
    flagged = {item['key']: item['warnings'] for item in result['rows'] if item['warnings']}
    # The catalogue prints 36 mm for both 1×185 and 1×240; the smaller one leaves 1.5 mm unexplained.
    assert list(flagged) == ['1×185'] and flagged['1×185'][0]['code'] == 'CLOSURE_OUTLIER'
    assert next(item for item in result['rows'] if item['key'] == '1×185')['closure']['declared_mm'] == pytest.approx(36)


def test_a_missing_dimension_stops_the_row_and_names_the_field():
    series, rows = catalogue.table_series(PEOPLE, 'single-core')
    del series['common']['insulation_screen_thickness']
    result = structure.build(series, rows[:2])
    assert [item['ok'] for item in result['rows']] == [False, False]
    assert result['rows'][0]['error']['code'] == 'STRUCTURE_INCOMPLETE' and '绝缘屏蔽厚度' in result['rows'][0]['error']['message']


def test_layers_that_do_not_fit_the_outer_diameter_are_refused():
    series, rows = catalogue.table_series(PEOPLE, 'single-core')
    rows = deepcopy(rows[:3])
    rows[1]['oversheath_thickness'] = 3.2  # typed 3.2 for 1.7
    result = structure.build(series, rows)
    assert [item['ok'] for item in result['rows']] == [True, False, True]
    assert result['rows'][1]['error']['code'] == 'RADIAL_DIMENSIONS_CONFLICT'


def test_a_whole_series_is_checked_against_its_standards_in_one_run():
    series, rows, result = built('three-core-steel-tape')
    cables = {item['key']: cable(item) for item in result['rows'] if item['area_mm2'] in (25, 240, 400)}
    thin = deepcopy(cables['3×240'])
    for core in thin['payload']['cable_type']['cores']:
        next(layer for layer in core['layers'] if layer['role'] == 'insulation')['thickness'] = .0040
    cables['3×240 thin'] = thin
    checks = product.standard_check_batch({key: (item, series['standards']) for key, item in cables.items()})
    for key in ('3×25', '3×240', '3×400'):
        verdicts = {row_id.split(':')[-1]: row['verdict'] for row_id, row in checks[key]['by_id'].items() if 'cores.0.' in row_id}
        assert verdicts['r20'] == 'passed' and verdicts['insulation-nominal'] == 'passed' and verdicts['screen-tape-nominal'] == 'passed'
        assert 'failed' not in checks[key]['summary']['count']
    failed = [row for row in checks['3×240 thin']['rows'] if row['verdict'] == 'failed']
    assert len(failed) == 3 and {(row['standard'], row['clause']) for row in failed} == {('GB/T 12706.2—2020', '表 7')}
    # One run for the batch gives what a run per product gives.
    alone = product.standard_check(cables['3×240'], series['standards'])
    assert [(row['id'], row['verdict'], row['limit']) for row in alone['rows']] == [(row['id'], row['verdict'], row['limit']) for row in checks['3×240']['rows']]


def test_three_core_electrical_values_agree_with_the_rating_method():
    series, rows, result = built('three-core-steel-tape')
    item = cable(next(row for row in result['rows'] if row['key'] == '3×240'))
    values, sources = product.standard_conditions(item)
    assert set(values) == set(sources) and values['core_lay_factor'] > 1
    electrical = product.electrical(item, values, sources)
    rows_by = {key.split(':')[-1]: value for key, value in electrical['by_id'].items() if key.startswith('core/1:')}
    assert rows_by['ac']['status'] == 'available'
    table = product.rating_table(item, [condition for condition in product.rating_conditions(item) if condition['id'] == 'three_core_buried_single@1'])
    rated = table['rows'][0]
    # Two sealed methods, one answer: the AC resistance at 90 °C of the parameter table and the one the rating used.
    assert rows_by['ac']['value'] == pytest.approx(rated['ac_resistance_ohm_m'], rel=.01)
    assert rows_by['ac']['value'] * 1000 == pytest.approx(.0988, rel=.03)  # 0.0754 Ω/km at 20 °C raised to 90 °C, plus skin and proximity


def test_buried_ratings_stay_below_the_catalogue_by_a_few_percent():
    listed = {row[0]: row[3] for row in PEOPLE['ratings']['three_core']['rows']}
    for table_id, low in (('three-core', -.07), ('three-core-steel-tape', -.115)):
        series, rows, result = built(table_id)
        cables = {item['area_mm2']: cable(item) for item in result['rows'] if item['area_mm2'] in (25, 95, 240, 400)}
        conditions = lambda item: [condition for condition in product.rating_conditions(item) if condition['id'] == 'three_core_buried_single@1']
        tables = product.rating_table_batch({area: (item, conditions(item)) for area, item in cables.items()})
        for area, table in tables.items():
            row = table['rows'][0]
            assert row['status'] == 'succeeded' and row['verification_passed']
            # The catalogue prints one number for every armour type and does not state the depth; 0.7 m is used here.
            assert low < row['ampacity_a'] / listed[area] - 1 < 0


def test_a_structure_the_rating_method_does_not_cover_is_refused_by_the_method():
    series, rows, result = built('single-core')
    item = cable(next(row for row in result['rows'] if row['key'] == '1×240'))
    table = product.rating_table(item, product.rating_conditions(item)[:1])
    refused = table['rows'][0]
    # A copper tape screen is not the tubular metal sheath the single-core branch was verified for: no number, and no tier.
    assert refused['status'] == 'not_applicable' and '金属护套' in refused['error']['message'] and 'ampacity_a' not in refused and 'tier' not in refused
    # What does not depend on the laying is still answered.
    values, sources = product.short_circuit_conditions(item)
    short = product.short_circuit(item, values, sources)
    assert short['by_id']['core/1:conductor-adiabatic']['value'] / 1000 == pytest.approx(34.3, rel=.01)
