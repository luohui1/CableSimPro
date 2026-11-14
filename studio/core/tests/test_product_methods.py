"""What a product answers on its own, computed by the sealed methods and compared with real references.

Electrical parameters and short-circuit capacity are compared with a manufacturer's published catalogue
(Bahra CU/XLPE/LC/PVC 3.6/6 kV single core). Conformity with the product standard is checked on a published
Chinese structure table (Huayuan YJV22-8.7/15 kV 3×240) against GB/T 12706.2-2020 and GB/T 3956-2008.
"""
from copy import deepcopy

import pytest

from studio_core import catalogue, library, product

DATA = catalogue.series('bahra_mv_lead_sheathed')
STANDARDS = ['GB/T 12706.2-2020', 'GB/T 3956-2008']


def entry(area):
    row = next(item for item in DATA['items'] if item['area'] == area)
    return row, catalogue.single_core_entry(DATA, row)


@pytest.mark.parametrize('area', [25, 240, 630])
def test_electrical_parameters_agree_with_the_catalogue(area):
    row, cable = entry(area)
    values = {'temperature_k': 363.15, 'frequency_hz': 60.0, 'ks': 1.0, 'kp': 1.0, 'spacing_m': row['outer_diameter'] / 1000,
              'phase_voltage_v': 3600.0, 'r20_length_basis': 'finished_cable', 'arrangement': 'trefoil'}
    result = product.electrical(cable, values, {key: '目录给出的条件：90 °C、60 Hz、品字形紧贴' for key in values})
    rows = {key.split(':')[-1]: value for key, value in result['by_id'].items()}
    assert result['method']['plugin_id'] == 'cablesim.type-electrical'
    # Skin and proximity effect matter at large sizes: the DC value alone would be 17 % low at 630 mm².
    assert rows['ac']['value'] * 1000 == pytest.approx(row['r_ac_90'], rel=.015)
    # The catalogue does not state the permittivity; with the IEC reference value 2.5 the capacitance comes out higher.
    assert 1.0 < rows['capacitance']['value'] * 1e9 / row['capacitance'] < 1.10
    assert rows['geometric-inductance']['value'] * 1e6 == pytest.approx(row['inductance'], rel=.05)
    # Sequence impedances need the bonding and return path; without them the method says so instead of giving a number.
    assert result['by_id']['positive-sequence']['status'] == 'missing'


@pytest.mark.parametrize('area', [240, 630])
def test_short_circuit_capacity_agrees_with_the_catalogue(area):
    row, cable = entry(area)
    values = {'duration_s': 1.0, 'initial_temperature_k': 363.15, 'final_temperature_k': 523.15,
              'metal_initial_temperature_k': 353.15, 'metal_final_temperature_k': 443.15, 'metal_capacity_basis': 'adiabatic'}
    result = product.short_circuit(cable, values, {key: '导体 90→250 °C；铅套按 80→170 °C（目录未给）；1 s' for key in values})
    rows = {key.split(':')[-1]: value for key, value in result['by_id'].items()}
    assert result['basis_missing'] == []
    assert rows['conductor-adiabatic']['value'] / 1000 == pytest.approx(row['short_circuit_conductor'], rel=.002)
    assert rows['metallic_sheath-adiabatic']['value'] / 1000 == pytest.approx(row['short_circuit_sheath'], rel=.06)
    # The constants come from the standard through the basis library, with the record that was used.
    assert rows['conductor-adiabatic']['basis_references'][0]['standard'].startswith('IEC 60949')


def test_material_without_a_declared_kind_gets_no_short_circuit_value():
    row, cable = entry(240)
    for material in cable['payload']['materials']:
        material.pop('standard_kind', None)
    values = {'duration_s': 1.0, 'initial_temperature_k': 363.15, 'final_temperature_k': 523.15}
    result = product.short_circuit(cable, values, {key: '条件' for key in values})
    conductor = next(value for key, value in result['by_id'].items() if key.endswith('conductor-adiabatic'))
    assert conductor['status'] == 'missing' and conductor['value'] is None


def test_conformity_is_judged_requirement_by_requirement_with_its_clause():
    cable = library.get('huayuan.yjv22-15kv-240')
    result = product.standard_check(cable, STANDARDS)
    rows = {key.split(':')[-1]: value for key, value in result['by_id'].items() if 'cores.0.' in key}
    assert rows['r20']['verdict'] == 'passed' and rows['r20']['limit'] == pytest.approx(.0754)
    assert (rows['r20']['standard'], rows['r20']['clause'], rows['r20']['pdf_page']) == ('GB/T 3956—2008', '表 2', 7)
    nominal = rows['insulation-nominal']
    assert nominal['verdict'] == 'passed' and nominal['limit'] == pytest.approx(4.5)
    assert (nominal['standard'], nominal['clause'], nominal['pdf_page']) == ('GB/T 12706.2—2020', '表 7', 15)
    # The limit travels with the record it was read from: which library version, which page of which source.
    assert nominal['basis_reference']['plugin_id'] == 'cablesim.standards-basis' and nominal['basis_reference']['pdf_page'] == 15
    # A measured minimum thickness is not in a structure table: the requirement stays open, with its limit, not passed.
    assert rows['insulation-minimum']['verdict'] == 'missing' and rows['insulation-minimum']['limit'] == pytest.approx(3.95)
    assert result['undeclared_standards'] == [] and result['basis_missing'] == []


def test_a_thinner_insulation_fails_the_declared_standard():
    cable = deepcopy(library.get('huayuan.yjv22-15kv-240'))
    for core in cable['payload']['cable_type']['cores']:
        next(layer for layer in core['layers'] if layer['role'] == 'insulation')['thickness'] = .0040
    result = product.standard_check(cable, STANDARDS)
    rows = [value for key, value in result['by_id'].items() if key.endswith(':insulation-nominal')]
    assert len(rows) == 3
    for row in rows:
        assert row['verdict'] == 'failed'
        assert row['actual'] == pytest.approx(4.0) and row['limit'] == pytest.approx(4.5)
        assert row['margin'] == pytest.approx(-.5)
        assert (row['standard'], row['clause']) == ('GB/T 12706.2—2020', '表 7')


def test_requirements_of_an_undeclared_standard_are_not_judged():
    cable = library.get('huayuan.yjv22-15kv-240')
    result = product.standard_check(cable, ['GB/T 3956-2008'])
    assert any('12706.2' in name for name in result['undeclared_standards'])
    assert all(row['verdict'] != 'passed' for key, row in result['by_id'].items() if key.endswith(':insulation-nominal'))
