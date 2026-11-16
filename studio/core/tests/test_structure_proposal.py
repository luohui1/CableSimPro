"""The initial structure a standard gives, through the sealed proposal method and the standard basis.

The 8.7/15 kV three-core copper 240 mm² XLPE cable is the one the published People Cable table lists as 3×240: the
standard's insulation thickness is 4.5 mm (GB/T 12706.2—2020 表 7, PDF page 15), which is what that table prints.
"""
from copy import deepcopy

import pytest

from studio_core import CoreError, catalogue, product, proposal, structure

PEOPLE = catalogue.tables('people_mv_xlpe')
STEEL_TAPE = next(table for table in PEOPLE['tables'] if table['id'] == 'three-core-steel-tape')
PRINTED = dict(zip([column[0] for column in STEEL_TAPE['columns']], next(row for row in STEEL_TAPE['rows'] if row[0] == 240)))
BASE = dict(standard='GB/T 12706.2-2020', u0_v=8700, u_v=15000, cores=3, conductor='copper', area_mm2=240, insulation='XLPE')
SCREENS = dict(screened=True, conductor_screen_thickness_mm=0.8, insulation_screen_thickness_mm=0.7, screen_tape_thickness_mm=0.1, screen_tape_width_mm=40)


def test_the_insulation_comes_with_its_clause_and_its_pages():
    result = proposal.propose(**BASE, armour='none')
    assert result['scope'] == 'insulation' and result['standard'] == 'GB/T 12706.2—2020'
    assert result['values'] == {'insulation_thickness': 4.5}
    # The standard's number is the number the manufacturer's published table prints for this size.
    assert result['values']['insulation_thickness'] == PRINTED['insulation_thickness']
    source = result['dimensions'][0]['source']
    assert {key: source[key] for key in ('kind', 'standard', 'clause', 'printed_page', 'pdf_page')} == {
        'kind': 'standard', 'standard': 'GB/T 12706.2—2020', 'clause': '表 7', 'printed_page': 7, 'pdf_page': 15}
    assert len(source['source_sha256']) == len(source['record_sha256']) == 64
    assert result['basis'] == {'insulation_thickness': 'GB/T 12706.2—2020 表 7（印刷第 7 页，PDF 第 15 页）'}
    # What the standard does not give is said, not filled in.
    missing = {item['field']: item for item in result['missing']}
    assert {'conductor_diameter', 'outer_diameter', 'oversheath_thickness', 'conductor_screen_thickness'} <= set(missing)
    assert 'insulation_thickness' not in missing and '附录' in missing['oversheath_thickness']['reason']
    assert (result['method']['plugin_id'], result['method']['capability'], result['method']['steps']) == ('cablesim.standard-check', 'structure-proposal', 2)


def test_the_whole_structure_with_the_annex_calculation_and_every_source():
    result = proposal.propose(**BASE, armour='steel_tape', **SCREENS)
    assert result['scope'] == 'complete'
    assert result['values'] == {'insulation_thickness': 4.5, 'conductor_screen_thickness': 0.8, 'insulation_screen_thickness': 0.7,
                                'bedding_thickness': 1.8, 'armour_tape_thickness': 0.5, 'oversheath_thickness': 3.4,
                                'screen_tape_thickness': 0.1, 'screen_tape_width': 40}
    by = {item['field']: item['source'] for item in result['dimensions']}
    for field in ('insulation_thickness', 'bedding_thickness', 'armour_tape_thickness', 'oversheath_thickness'):
        # A value of the standard, or one its annex gives, always says which standard, which clause and which pages.
        assert by[field]['standard'] == 'GB/T 12706.2—2020' and by[field]['clause'] and by[field]['printed_page'] and by[field]['pdf_page'], field
    assert [(by[field]['kind'], by[field]['clause'], by[field]['pdf_page']) for field in ('bedding_thickness', 'armour_tape_thickness', 'oversheath_thickness')] == [
        ('standard', '表 9', 17), ('standard', '表 11', 21), ('derived', '14.3', 22)]
    assert by['oversheath_thickness']['calculation'] and all(by[field]['kind'] == 'given' for field in ('conductor_screen_thickness', 'screen_tape_width'))
    assert [item['field'] for item in result['missing']] == ['conductor_diameter', 'outer_diameter']
    assert result['method']['steps'] > 5  # the annex chain asks the standard basis stage by stage


def test_a_standard_that_does_not_fit_the_voltage_and_what_the_standard_does_not_hold_are_refused():
    with pytest.raises(CoreError) as mismatch:
        proposal.propose(**{**BASE, 'standard': 'GB/T 12706.3-2020'}, armour='none')
    assert mismatch.value.code == 'STANDARD_MISMATCH' and 'GB/T 12706.2—2020' in mismatch.value.message
    with pytest.raises(CoreError) as off_table:  # 245 mm² is not a size of the table: no neighbour stands in for it
        proposal.propose(**{**BASE, 'area_mm2': 245}, armour='none')
    assert '不生成近似值' in off_table.value.message
    with pytest.raises(CoreError) as voltage:
        proposal.propose(**{**BASE, 'u0_v': 7000, 'u_v': 12000}, armour='none')
    assert '表外电压' in voltage.value.message
    with pytest.raises(CoreError) as unsaid:  # whether the cores are screened is the engineer's to say
        proposal.propose(**BASE, armour='steel_tape', scope='complete')
    assert '/screened' in unsaid.value.message
    with pytest.raises(CoreError) as single:
        proposal.propose(**{**BASE, 'cores': 1}, armour='steel_tape', **SCREENS)
    assert '单芯' in single.value.message
    with pytest.raises(CoreError) as other:
        proposal.propose(**{**BASE, 'insulation': 'PVC'}, armour='none')
    assert other.value.code == 'INSULATION_UNSUPPORTED'


def test_the_fields_of_a_proposal_are_fields_of_the_structure_table():
    result = proposal.propose(**BASE, armour='steel_tape', **SCREENS)
    assert set(result['values']) <= set(structure.FIELDS)
    assert {item['field']: item['unit'] for item in result['dimensions']}['insulation_thickness'] == structure.FIELDS['insulation_thickness'][1] == 'mm'


def test_the_checks_own_annex_chain_agrees_with_the_proposal_value_by_value(monkeypatch):
    series, rows = catalogue.table_series(PEOPLE, 'three-core-steel-tape')
    series['armour_material'] = 'steel_galvanized'  # the engineer says what the tape is made of; the check needs to know
    printed = next(row for row in rows if row['area'] == 240)
    proposed = proposal.propose(**BASE, armour='steel_tape', **SCREENS)['values']
    built = structure.build(series, [{**printed, **proposed}])['rows'][0]
    assert built['ok']
    item = {**built['entry'], 'id': 'test', 'version': '1'}
    nominal = lambda checked: {row['id'].split(':')[-1]: row for row in checked['rows'] if row['id'].endswith('nominal')}

    # A structure as the library builds it is judged for its insulation and its screen tape; the three layers that follow from the annex's
    # diameter chain are left unjudged (the check only runs that chain for a draft that comes from a complete proposal).
    held = nominal(product.standard_check(item, series['standards']))
    assert {key: row['verdict'] for key, row in held.items() if not key.startswith('insulation') and not key.startswith('screen')} == {
        'bedding-nominal': 'uncovered', 'armour-tape-nominal': 'uncovered', 'oversheath-nominal': 'uncovered'}
    assert {row['verdict'] for key, row in held.items() if key in ('insulation-nominal', 'screen-tape-nominal')} == {'passed'}

    # Put the structure in the form a proposal's draft has, which is what that chain reads (no filler wrapping, a smooth bedding, a single
    # lapped tape, the annex's provenance): the check then works the three thicknesses out from the structure itself, and they are the proposal's.
    ordinary = product.document_of

    def as_drafted(cable):
        document = ordinary(cable)
        cable_type = document['cable_types'][0]
        cable_type['common_layers'] = [dict(layer, **({'form': 'smooth'} if layer['role'] == 'bedding' else {}))
                                       for layer in cable_type['common_layers'] if layer['role'] != 'filler']
        for core in cable_type['cores']:
            for layer in core['layers']:
                if layer['role'] == 'metallic_screen':
                    layer.update(tape_count=1, tape_application='helical_overlap', tape_width=0.04)
        document['provenance']['/cable_types/cable_type~1ct1/annex_basis'] = {'kind': 'derived', 'reference': '按标准生成的初始结构', 'reviewed': False}
        return document

    monkeypatch.setattr(product, 'document_of', as_drafted)
    judged = nominal(product.standard_check(item, series['standards']))
    for key, field in (('bedding-nominal', 'bedding_thickness'), ('armour-tape-nominal', 'armour_tape_thickness'), ('oversheath-nominal', 'oversheath_thickness')):
        assert judged[key]['verdict'] == 'passed', (key, judged[key]['verdict'], judged[key]['reason'])
        assert judged[key]['limit'] == pytest.approx(proposed[field], abs=1e-9), key
