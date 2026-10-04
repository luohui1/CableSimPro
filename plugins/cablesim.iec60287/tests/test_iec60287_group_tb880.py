"""Controlled TB 880 reference replay through the production group solver.

The edition/conventions are explicit: published old capacitor/radius formulas
are not relabelled as IEC 2023 results. Reference values remain in .data/.
"""
from copy import deepcopy
import json
from math import sqrt
from pathlib import Path

import pytest

from test_iec60287_group import document, parameters
from cablesim_iec60287.domain import prepare
from cablesim_iec60287.group import _loss_details, _loss_factors, _resistance, rate_group
from test_iec60287_tb880 import CASES, FIXTURES
from backend.domain.models import DomainDocument

GROUP_CASES = CASES+['tb880-case-0-3','tb880-case-0-3-ssb','tb880-case-0-3-eddies']


def fixture_document(fixture, *, reference=True):
    """Map inputSi only; the expected blocks never affect solver inputs."""
    x,a = fixture['inputSi'],fixture['adapter']
    flat = a.get('cableArrangement') == 'flat_spaced_in_individual_ducts'
    d = document('flat' if flat else 'trefoil')
    p = parameters()
    def field(*keys):
        found = [x[k] for k in keys if k in x]
        assert len(found) == 1, keys
        return found[0]
    if reference:
        p['reference_basis'] = 'tb880_reference'
        p['t4_form'] = 'exact' if a['externalThermalResistanceModel'] == 'iec_exact_radical_u' else 'simplified'
    else:
        p['reference_basis'],p['t4_form'] = 'iec2023','exact'
    p['eddy'] = {'ignored':'ignored','trefoil_both_ends_gp31':'trefoil','trefoil_single_point':'trefoil',
                'flat_single_point':'trefoil','flat_both_ends_gp31':'trefoil'}[a['eddyCurrentLossModel']]
    p['solver'].update(initial_sheath_temperature_c=x['initialMetallicSheathTemperatureC'], current_tolerance_a=1e-8,max_iterations=100)
    cable = d['cable_types'][0]
    cable['label'] = fixture['caseId']+'（受控验证输入）'
    cable['rating']['u0'] = x['phaseToGroundVoltageV']
    cable['rating']['u'],cable['rating']['um'] = x['lineToLineVoltageV'],None
    cable['rating']['max_conductor_temperature']['normal'] = field('maxConductorTemperatureC','conductorOperatingTemperatureC')+273.15
    d['criteria']['max_conductor_temperature'] = cable['rating']['max_conductor_temperature']['normal']
    core = cable['cores'][0]['conductor']
    core.update(diameter=x['conductorDiameterM'],nominal_area=630e-6,
                r20=field('conductorResistance20OhmPerM','conductorResistance20COhmPerM'))
    layers = cable['common_layers']
    for layer,key in zip(layers,['innerSemiconductingThicknessM','insulationThicknessM','outerSemiconductingThicknessM','metallicSheathThicknessM','outerSheathThicknessM']):
        layer['thickness'] = x[key]
    mats = {m['id']:m for m in d['materials']}
    mats[core['material']]['temperature_coefficient_20'] = x['conductorTemperatureCoefficientPerK']
    for layer,keys in zip(layers,[('innerSemiconductingThermalResistivityKMPW','innerSemiconductingThermalResistivityKmPerW'),
                                ('insulationThermalResistivityKMPW','insulationThermalResistivityKmPerW'),
                                ('outerSemiconductingThermalResistivityKMPW','outerSemiconductingThermalResistivityKmPerW'),
                                None,('outerSheathThermalResistivityKMPW','outerSheathThermalResistivityKmPerW')]):
        if keys:
            mats[layer['material']]['thermal_resistivity'] = field(*keys)
    mats[layers[1]['material']].update(relative_permittivity=field('insulationRelativePermittivity','relativePermittivity'),loss_tangent=x['dielectricLossTangent'])
    mats[layers[3]['material']].update(electrical_resistivity_20=field('metallicSheathResistivity20OhmM','metallicSheathResistivity20COhmM'),
                                     temperature_coefficient_20=x['metallicSheathTemperatureCoefficientPerK'])
    p['ks'],p['kp'] = field('skinEffectCoefficient','skinEffectCoefficientKs'),field('proximityEffectCoefficient','proximityEffectCoefficientKp')
    circuit,section = d['circuits'][0],d['sections'][0]
    circuit['bonding']['kind'] = a['metallicSheathBonding']
    circuit['system']['frequency'] = x['frequencyHz']
    circuit['system']['voltage'] = x['lineToLineVoltageV']
    section['medium']['surface_temperature'] = x['ambientTemperatureC']+273.15
    mats[section['medium']['material']]['thermal_resistivity'] = field('soilThermalResistivityKMPW','soilThermalResistivityKmPerW')
    depth = field('burialDepthM','burialDepthToCableAxisM')
    diameter = field('cableOverallDiameterM','overallCableDiameterM')
    ducted = 'ductOuterDiameterM' in x
    spacing = x['phaseSpacingM'] if flat else x['ductOuterDiameterM'] if ducted else diameter
    coords = [(spacing, -depth),(0,-depth),(-spacing,-depth)] if flat else [(0,-depth+spacing/sqrt(3)),(spacing/2,-depth-spacing/(2*sqrt(3))),(-spacing/2,-depth-spacing/(2*sqrt(3)))]
    for q,point in zip(section['placements'],coords):
        q.update(x=point[0],z=point[1],enclosure=None)
    if ducted:
        material = deepcopy(mats[layers[-1]['material']])
        material.update(id='material/tb880-duct',label='管材（TB880验证值）',thermal_resistivity=field('ductThermalResistivityKMPW','ductThermalResistivityKmPerW'))
        d['materials'].append(material)
        section['enclosures'] = []
        for i,q in enumerate(section['placements']):
            uid = f'enclosure/tb880-{i}'
            q['enclosure'] = uid
            section['enclosures'].append({'id':uid,'type':'duct',
                'material':material['id'],'inner_diameter':x['ductInnerDiameterM'],'outer_diameter':x['ductOuterDiameterM'],
                'x':q['x'],'z':q['z'],'contains':[q['cable']]})
        p['duct'].update(u=x['ductAirGapCoefficientU'],v=x['ductAirGapCoefficientV'],y_per_k=x['ductAirGapCoefficientYPerK'],initial_mean_air_temperature_c=x['initialDuctAirGapMeanTemperatureC'])
    if flat:
        material = deepcopy(mats[section['medium']['material']])
        material.update(id='material/tb880-concrete',label='混凝土（TB880验证值）',thermal_resistivity=x['concreteThermalResistivityKmPerW'])
        d['materials'].append(material)
        section['backfill'] = {'id':'region/tb880-concrete','x':0,'z':-x['ductBankDepthToCentreM'],'width':x['ductBankLongSideM'],
                               'height':x['ductBankShortSideM'],'material':material['id'],'label':'TB880矩形包封验证'}
    d['name'] = fixture['caseId']+' 受控验证'
    d['provenance'] = {'/':{'kind':'derived','reference':
        f"validation：TB 880 2022 {fixture['caseId']}，PDF/印刷页 {fixture['source']['pageRange']}；SHA256 {fixture['source']['pdfSha256']}；受控摘录，非产品主数据",'reviewed':False}}
    return DomainDocument.model_validate(d).model_dump(mode='json'),p


def test_flat_circulating_loss_matches_published_tb880_first_iteration():
    if not Path(FIXTURES).is_dir():
        pytest.skip('受控 TB880 夹具目录未指定')
    fixture = json.loads((Path(FIXTURES)/'tb880-case-0-3.json').read_text('utf-8'))
    x = fixture['inputSi']
    d = document('flat')
    cable = d['cable_types'][0]
    cable['rating']['u0'] = x['phaseToGroundVoltageV']
    conductor = cable['cores'][0]['conductor']
    conductor.update(diameter=x['conductorDiameterM'],r20=x['conductorResistance20COhmPerM'])
    for layer,key in zip(cable['common_layers'],['innerSemiconductingThicknessM','insulationThicknessM','outerSemiconductingThicknessM','metallicSheathThicknessM','outerSheathThicknessM']):
        layer['thickness'] = x[key]
    for p,position in zip(d['sections'][0]['placements'],[x['phaseSpacingM'],0,-x['phaseSpacingM']]):
        p.update(x=position,z=-x['burialDepthToCableAxisM'])
    g = prepare(d,parameters())
    resistances = [_resistance(c,90,x['phaseSpacingM']) for c in g.cables]
    values = _loss_factors(g,resistances,[x['initialMetallicSheathTemperatureC']]*3)
    roles = ['outer_leading','middle','outer_lagging']
    for actual,role in zip(values,roles):
        expected = fixture['expectedFirstIterationByPhase'][role]['sheathCirculatingCurrentLossFactor']
        assert actual == pytest.approx(expected,rel=fixture['acceptance']['intermediateRelativeTolerance'])


@pytest.mark.parametrize('name',GROUP_CASES)
def test_group_reference_replay_matches_published_current_and_intermediates(name):
    if not Path(FIXTURES).is_dir():
        pytest.skip('受控 TB880 夹具目录未指定')
    fixture = json.loads((Path(FIXTURES)/(name+'.json')).read_text('utf-8'))
    d,p = fixture_document(fixture)
    group = prepare(d,p)
    result = rate_group(group)
    rated = result['circuit_ratings'][0]
    assert rated['ampacity_a'] == pytest.approx(fixture['expected']['ampacityA'],abs=.001)
    assert result['reference_basis'] == 'tb880_reference'
    assert '不能作为 IEC 2023' in result['result_scope']
    assert result['verification']['passed']
    state = rated['cable_states'][0]
    expected = fixture.get('expectedFixed',fixture['expected'])
    for field,key in [('t1_k_m_w','thermalResistanceT1KMPW'),('t3_k_m_w','thermalResistanceT3KMPW'),('dielectric_loss_w_m','dielectricLossWPerM')]:
        reference_key = key if key in expected else key.replace('KMPW','KmPerW')
        assert state[field] == pytest.approx(expected[reference_key],rel=1e-6)
    if name.startswith('tb880-case-0-3'):
        assert group.soil['equivalent_radius_m'] == pytest.approx(expected['ductBankEquivalentRadiusM'],rel=1e-6)
        assert state['t4_wall_k_m_w'] == pytest.approx(expected['thermalResistanceT4DuctWallKmPerW'],rel=1e-6)
        phase = 1 if fixture['expected']['ratingPhaseRole'] == 'middle' else 2
        assert rated['limiting_cable'] == d['circuits'][0]['cables'][phase]['id']


@pytest.mark.parametrize('name',['tb880-case-0-3-ssb','tb880-case-0-3-eddies'])
def test_flat_eddy_components_match_the_published_first_iteration(name):
    if not Path(FIXTURES).is_dir():
        pytest.skip('受控 TB880 夹具目录未指定')
    f = json.loads((Path(FIXTURES)/(name+'.json')).read_text('utf-8'))
    d,p = fixture_document(f)
    g = prepare(d,p)
    resistances = [_resistance(c,90,f['inputSi']['phaseSpacingM']) for c in g.cables]
    rows = _loss_details(g,resistances,[80]*3)
    for row,role in zip(rows,['outer_leading','middle','outer_lagging']):
        expected = f['expectedFirstIterationByPhase'][role]
        assert row['eddy_raw'] == pytest.approx(expected['sheathEddyCurrentLossFactorRaw'],rel=1e-6)
        assert (row['eddy_factor_f'] or 1) == pytest.approx(expected['sheathEddyCurrentReductionFactor'],rel=1e-6)
        if f['adapter']['metallicSheathBonding'] == 'single_point':
            assert row['circulating'] == 0


def test_2023_and_published_tb880_conventions_are_not_silently_mixed():
    if not Path(FIXTURES).is_dir():
        pytest.skip('受控 TB880 夹具目录未指定')
    fixture = json.loads((Path(FIXTURES)/'tb880-case-0-3.json').read_text('utf-8'))
    old_d,old_p = fixture_document(fixture)
    new_d,new_p = fixture_document(fixture,reference=False)
    old,new = prepare(old_d,old_p),prepare(new_d,new_p)
    assert old.soil['geometric_factor'] is None
    assert new.soil['geometric_factor'] is not None
    assert old.soil['equivalent_radius_m'] != pytest.approx(new.soil['equivalent_radius_m'],rel=.01)
    old_result,new_result = rate_group(old),rate_group(new)
    assert old_result['reference_basis'] == 'tb880_reference'
    assert new_result['reference_basis'] == 'iec2023'
    assert new_result['verification']['passed']
