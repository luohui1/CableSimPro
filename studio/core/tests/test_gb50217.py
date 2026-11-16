"""The GB 50217 correction against the hand products of the plugin's own test (tests/test_gb50217_correction.py).

That test multiplies a synthetic 400 A baseline by coefficients read by hand from GB 50217—2018 Annex D:
400 × 1.09 = 436 A, 400 × 1.05 × 0.93 = 390.6 A, 400 × 0.96 × 0.85 = 326.4 A, 400 × 1.09 × 0.98 = 427.28 A, and the
formula of D.0.2, √((90 − 27) / (90 − 25)). The same products come out of the core here: the baseline is handed in and the
sealed method runs through the core's runner, which seals-checks it and reads its basis lookups.
"""
from copy import deepcopy
from math import sqrt

import pytest

from studio_core import CoreError, correction, library, methods, scene

CABLE = {**library.get('huayuan.yjv22-15kv-240'), 'id': 'huayuan.yjv22-15kv-240', 'version': '1'}
DIAMETER = scene.outer_diameter(CABLE)
BASELINE = {'current_a': 400.0, 'ambient_c': 25.0, 'soil_thermal_resistivity': 1.0, 'depth_m': 0.7, 'confirmed': True, 'page': 1,
            'source': '手算核验用的合成基准：单根、同温限及埋深；不是厂家额定值', 'sha256': '0' * 63 + '1'}


def actual(*, layout='three_core_buried_single', ambient=25.0, rho=1.0, spacing=None, voltage=10000.0, depth=0.7):
    return {'name': 'GB 50217', 'cable': CABLE,
            'installation': {'layout': layout, 'depth_m': depth, 'spacing_m': spacing, 'duct': None, 'backfill': None, 'bonding': 'both_ends'},
            'conditions': {'soil_thermal_resistivity': rho, 'ambient_temperature_c': ambient, 'frequency_hz': 50.0, 'system_voltage_v': voltage,
                           'currents_a': [300.0]}}


def factors(result):
    return [item['factor'] for item in result['correction']['coefficients']]


def test_ambient_temperature_and_three_cables_side_by_side_are_the_hand_product():
    # D.0.1 soil 30 °C at a 90 °C limit = 0.96 (page 72); D.0.4 three cables, 0.1 m clear = 0.85 (page 73): 400 × 0.96 × 0.85.
    result = correction.apply(actual(layout='three_core_buried_horizontal', ambient=30.0, spacing=DIAMETER + 0.1), BASELINE)
    assert factors(result) == [0.96, 0.85]
    assert result['correction']['corrected_current_a'] == pytest.approx(326.4, abs=1e-10)
    coefficients = result['correction']['coefficients']
    assert [(item['record']['clause'], item['record']['printed_page']) for item in coefficients] == [('D.0.1', 72), ('D.0.4', 73)]
    assert all(len(item['record']['source_sha256']) == 64 and item['release_digest'] == correction.release_digest() for item in coefficients)
    # The run is the sealed method's, identified like any other run of the core.
    assert (result['plugin_id'], result['capability']) == ('cablesim.gb50217-correction', 'steady-rating')
    assert result['correction']['baseline']['baseline_current_a'] == 400.0 and result['correction']['baseline']['baseline_reviewed'] is True


def test_another_ambient_temperature_is_the_standard_formula_not_an_interpolation():
    result = correction.apply(actual(ambient=27.0), BASELINE)
    assert result['correction']['total_factor'] == pytest.approx(sqrt(63 / 65), abs=1e-12)
    assert result['correction']['coefficients'][0]['record']['clause'] == 'D.0.2'
    assert result['correction']['coefficients'][0]['formula_inputs'] == {'theta_m_k': 363.15, 'theta_1_k': 298.15, 'theta_2_k': pytest.approx(300.15)}
    assert result['correction']['corrected_current_a'] == pytest.approx(400 * sqrt(63 / 65), abs=1e-9)


def aired(document, temperature_k, spacing_ratio=None):
    """The same cables hung in air: the layout the studio's templates do not have, put into the document by hand."""
    section = document['sections'][0]
    section['kind'], section['medium'] = 'air', {'material': section['medium']['material'], 'air_temperature': temperature_k}
    for index, placement in enumerate(section['placements']):
        placement['x'], placement['z'] = (index * spacing_ratio * DIAMETER if spacing_ratio else 0.0), 0.0
    return document


def pvc(document):
    """The 1 kV, 70 °C PVC cable of GB 50217 table C.0.1-2."""
    document['cable_types'][0]['rating']['max_conductor_temperature'] = {'normal': 343.15, 'short_circuit': 433.15}
    insulation = {layer['material'] for core in document['cable_types'][0]['cores'] for layer in core['layers'] if layer['role'] == 'insulation'}
    for material in document['materials']:
        if material['id'] in insulation:
            material['standard_kind'] = 'PVC'
    return document


@pytest.mark.parametrize('name, build, kind, expected, parts', [
    # D.0.1, 90 °C, air 30 °C against the 40 °C baseline (page 72): 400 × 1.09.
    ('air 30 °C', lambda: aired(scene.compose('x', CABLE, actual(ambient=30.0)['installation'], actual(ambient=30.0)['conditions'])['document'], 303.15),
     'manufacturer', 436.0, [1.09]),
    # D.0.1 air 30 °C and D.0.5 three cables at centre spacing S = 2d (page 74): 400 × 1.09 × 0.98.
    ('air 30 °C, three cables at 2d',
     lambda: aired(scene.compose('x', CABLE, actual(layout='three_core_buried_horizontal', spacing=2 * DIAMETER)['installation'],
                                            actual(layout='three_core_buried_horizontal')['conditions'])['document'], 303.15, 2.0),
     'manufacturer', 427.28, [1.09, 0.98]),
    # C.0.1-2 (1 kV PVC, 70 °C, 1.2 K·m/W): D.0.1 soil 20 °C = 1.05 and D.0.3 at 1.5 K·m/W = 0.93 (pages 72–73): 400 × 1.05 × 0.93.
    ('PVC 1 kV in soil of 1.5', lambda: pvc(scene.compose('x', CABLE, actual(ambient=20.0, rho=1.5, voltage=1000.0)['installation'],
                                                                    actual(ambient=20.0, rho=1.5, voltage=1000.0)['conditions'])['document']),
     'gb_c012', 390.6, [1.05, 0.93]),
])
def test_the_air_and_pvc_cases_of_the_plugin_test(name, build, kind, expected, parts):
    baseline = {**BASELINE, 'kind': kind, **({'soil_thermal_resistivity': 1.2} if kind == 'gb_c012' else {})}
    result = correction.apply_document(build(), {**baseline, 'ambient_c': 25.0 if kind == 'gb_c012' else 40.0})
    assert factors(result) == parts, name
    assert result['correction']['corrected_current_a'] == pytest.approx(expected, abs=1e-10), name


def test_what_the_table_does_not_hold_is_refused_and_never_interpolated():
    def refused(scene_input, **baseline):
        with pytest.raises(CoreError) as error:
            correction.apply(scene_input, {**BASELINE, **baseline})
        return error.value

    # 0.15 m clear is between the table's 0.1 m and 0.2 m.
    between = refused(actual(layout='three_core_buried_horizontal', spacing=DIAMETER + 0.15))
    assert (between.code, between.path) == ('CORRECTION_TABLE_NOT_COVERED', '/input/sections/0/placements')
    # The annex stops at 10 kV; the cable's own 15 kV rating does not stand in for the system voltage.
    assert refused(actual(voltage=15000.0)).path == '/input/circuits/0/system/voltage'
    # A manufacturer's baseline is only corrected for the soil it was given in, and only from the annex's own base temperature.
    assert refused(actual(rho=1.5)).path == '/parameters/baseline_soil_rho'
    assert refused(actual(), ambient_c=20.0).path == '/parameters/baseline_ambient_k'
    assert refused(actual(depth=1.0)).path == '/parameters/baseline_depth_m'
    # Nobody's confirmation is assumed.
    assert refused(actual(), confirmed=False).code == 'BASELINE_UNCONFIRMED'


def test_the_method_has_a_card_and_is_a_reference():
    cards = {card['id']: card for card in methods.catalogue()}
    card = cards['gb50217.correction']
    assert (card['plugin'], card['capability'], card['validation_level']) == ('cablesim.gb50217-correction', 'steady-rating', 'analytic-benchmark')
    assert card['limitations'] and card['inputs'] and card['answers']
    held = correction.apply(actual(ambient=30.0), BASELINE)['method_card']
    assert held['tier']['tier'] == 'reference' and any('手算核对' in line for line in held['tier']['basis'])
    assert held['validation']['cases'] == ['tests/test_gb50217_correction.py']
    assert held['standards'] == ['GB 50217—2018 D.0.1 · 第 72 页'] and held['scope'][0].startswith('仅 10 kV 及以下')
    assert 'iec60287.steady' in cards and deepcopy(cards['iec60287.steady'])['plugin'] == 'cablesim.iec60287'
