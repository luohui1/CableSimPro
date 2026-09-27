"""Cross-check against CIGRE TB 880 worked examples.

The fixtures hold values transcribed from the licensed TB 880 PDF and are NOT part of
this public repository. Point CABLESIM_TB880_FIXTURES at a directory containing the
`tb880-case-*.json` files (schema cable-calc-core-iec60287-validation-fixture-v1).
Without it these tests are reported as skipped, never as passed.

The adapter builds inputs from `inputSi` and the declared branch identities only; the
`expected` block is used for comparison and nothing else.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from cablesim_iec60287 import Rating, RatingRefused, rate
from cablesim_iec60287.inputs import Solver

FIXTURES = os.environ.get('CABLESIM_TB880_FIXTURES')
CASES = ['tb880-case-0-1', 'tb880-case-0-1-exact-radical', 'tb880-case-0-1-single-point-bonding',
         'tb880-case-0-1-eddy-gp31', 'tb880-case-0-2', 'tb880-case-0-2-eddy-gp31']
pytestmark = pytest.mark.skipif(not FIXTURES or not Path(FIXTURES).is_dir(),
                                reason='CABLESIM_TB880_FIXTURES not set: licensed TB 880 fixtures are kept outside the public repository')

# Branch identities this method can represent. Any other value makes the adapter refuse.
SUPPORTED = {
    'currentType': {'ac'}, 'cableConstruction': {'single_core_concentric'},
    'conductorGeometry': {'circular_compacted_stranded'}, 'metallicCoverGeometry': {'smooth_sheath'},
    'armourStatus': {'unarmoured'}, 'soilDryingConsidered': {False},
    'semiconductingLayerModel': {'separate_cylindrical_layers'},
    'capacitanceInnerDiameterBasis': {'conductor_plus_inner_semiconductor'},
    'reactanceSheathDiameterBasis': {'mean_metallic_sheath_diameter'},
    'skinEffectFormulaBranch': {'circular_x_le_2_8'}, 'proximityEffectFormulaBranch': {'circular_single_core'},
}
ENVIRONMENT = {('direct_buried', 'touching_trefoil'): 'direct_buried', ('buried_duct', 'trefoil_in_touching_ducts'): 'buried_ducts'}
T4_FORM = {'iec_simplified_2u': 'simplified', 'iec_exact_radical_u': 'exact', 'tb880_touching_trefoil_ducts': None}
EDDY = {'ignored': 'ignored', 'trefoil_both_ends_gp31': 'trefoil', 'trefoil_single_point': 'trefoil'}


def load(name: str) -> dict:
    return json.loads((Path(FIXTURES) / f'{name}.json').read_text('utf-8'))


def adapt(fixture: dict, tolerance: float | None = None) -> Rating:
    a, x = fixture['adapter'], fixture['inputSi']
    for key, allowed in SUPPORTED.items():
        if a[key] not in allowed:
            raise AssertionError(f'fixture branch {key}={a[key]} is outside this method')
    assert x['loadedConductorCount'] == 1 and x['thermalResistanceT2KMPW'] == 0 and x['armourLossFactor'] == 0
    assert x['thermalResistanceT1Multiplier'] == 1
    environment = ENVIRONMENT[(a['layingEnvironment'], a['cableArrangement'])]
    duct = None
    if environment == 'buried_ducts':
        duct = {'outer_diameter_m': x['ductOuterDiameterM'], 'inner_diameter_m': x['ductInnerDiameterM'],
                'rho_k_m_w': x['ductThermalResistivityKMPW'], 'u': x['ductAirGapCoefficientU'],
                'v': x['ductAirGapCoefficientV'], 'y_per_k': x['ductAirGapCoefficientYPerK'],
                'initial_mean_air_temperature_c': x['initialDuctAirGapMeanTemperatureC']}
    semicon_inner = x['innerSemiconductingThermalResistivityKMPW']
    return Rating(
        frequency_hz=x['frequencyHz'], phase_voltage_v=x['phaseToGroundVoltageV'],
        max_conductor_temperature_c=x['maxConductorTemperatureC'],
        conductor={'diameter_m': x['conductorDiameterM'], 'r20_ohm_m': x['conductorResistance20OhmPerM'],
                   'alpha20_per_k': x['conductorTemperatureCoefficientPerK'],
                   'ks': x['skinEffectCoefficient'], 'kp': x['proximityEffectCoefficient']},
        insulation={'inner_screen_thickness_m': x['innerSemiconductingThicknessM'], 'thickness_m': x['insulationThicknessM'],
                    'outer_screen_thickness_m': x['outerSemiconductingThicknessM'],
                    'relative_permittivity': x['insulationRelativePermittivity'], 'tan_delta': x['dielectricLossTangent'],
                    'inner_screen_rho_k_m_w': semicon_inner, 'rho_k_m_w': x['insulationThermalResistivityKMPW'],
                    'outer_screen_rho_k_m_w': x['outerSemiconductingThermalResistivityKMPW']},
        sheath={'thickness_m': x['metallicSheathThicknessM'], 'resistivity20_ohm_m': x['metallicSheathResistivity20OhmM'],
                'alpha20_per_k': x['metallicSheathTemperatureCoefficientPerK']},
        oversheath={'thickness_m': x['outerSheathThicknessM'], 'rho_k_m_w': x['outerSheathThermalResistivityKMPW']},
        installation={'environment': environment, 'depth_m': x['burialDepthM'], 'soil_rho_k_m_w': x['soilThermalResistivityKMPW'],
                      'ambient_temperature_c': x['ambientTemperatureC'], 't4_form': T4_FORM[a['externalThermalResistanceModel']],
                      'duct': duct},
        bonding={'scheme': a['metallicSheathBonding'], 'eddy': EDDY[a['eddyCurrentLossModel']]},
        solver=Solver(initial_sheath_temperature_c=x['initialMetallicSheathTemperatureC'],
                      current_tolerance_a=tolerance or x['iterationCurrentToleranceA'], max_iterations=x['maxIterations']),
    )


def computed(fixture: dict, result) -> dict:
    """This method's value for each fixture key it publishes (first-iteration keys use iteration 1)."""
    e, first = result.electrical, result.history[0]
    values = {
        'capacitanceFPerM': e.capacitance_f_m, 'reactanceOhmPerM': e.sheath_reactance_ohm_m,
        'metallicSheathResistance20OhmPerM': e.sheath_r20_ohm_m, 'thermalResistanceT1KMPW': result.t1_k_m_w,
        'thermalResistanceT3KMPW': result.t3_k_m_w, 'thermalResistanceT4KMPW': first.t4_k_m_w,
        'dielectricLossWPerM': e.dielectric_loss_w_m, 'conductorDcResistanceOperatingTemperatureOhmPerM': e.r_dc_max_ohm_m,
        'skinEffectFactor': e.skin_ys, 'proximityEffectFactor': e.proximity_yp,
        'conductorAcResistanceOperatingTemperatureOhmPerM': e.r_ac_max_ohm_m,
        'metallicSheathResistanceFirstIterationOhmPerM': first.loss.sheath_r_ohm_m,
        'sheathLossFactorFirstIteration': first.loss.total, 'ampacityFirstIterationA': first.current_a,
        'conductorLossFirstIterationWPerM': first.conductor_loss_w_m, 'sheathLossFirstIterationWPerM': first.sheath_loss_w_m,
        'metallicSheathTemperatureFirstIterationC': first.next_sheath_temperature_c,
        'outerSheathTemperatureFirstIterationC': first.cable_surface_temperature_c,
        'cableSurfaceTemperatureFirstIterationC': first.cable_surface_temperature_c,
        'thermalResistanceT4AirGapInitialKMPW': first.t4_air_gap_k_m_w,
        'thermalResistanceT4DuctWallKMPW': result.t4_duct_wall_k_m_w,
        'thermalResistanceT4ExternalSoilKMPW': result.t4_external_k_m_w,
        'ductAirGapMeanTemperatureNextC': first.next_duct_air_temperature_c,
    }
    return values


@pytest.mark.parametrize('name', CASES)
def test_every_published_intermediate_matches(name):
    fixture = load(name)
    acc = fixture['acceptance']
    result = rate(adapt(fixture))
    values = computed(fixture, result)
    coarse = set(acc.get('coarsePublishedFields', []))
    unmapped = [k for k in fixture['expected'] if k != 'ampacityA' and k not in values]
    assert unmapped == [], f'expected keys without a computed counterpart: {unmapped}'
    for key, expected in fixture['expected'].items():
        if key == 'ampacityA':
            continue
        rel = acc['coarsePublishedRelativeTolerance'] if key in coarse else acc['intermediateRelativeTolerance']
        assert values[key] == pytest.approx(expected, rel=rel), key
    # Converged rating at the fixture's own tolerance and iteration count.
    assert result.converged
    assert abs(result.ampacity_a - fixture['expected']['ampacityA']) <= acc['ampacityAbsoluteToleranceA']
    assert result.iterations == acc.get('expectedConvergedIterationCount', 4)


@pytest.mark.parametrize('name', CASES)
def test_high_precision_replay_matches_published_rating(name):
    fixture = load(name)
    result = rate(adapt(fixture, tolerance=1e-10))
    assert abs(result.ampacity_a - fixture['expected']['ampacityA']) <= fixture['acceptance']['highPrecisionAbsoluteToleranceA']
    assert result.iterations == fixture['inputSi']['referenceFixedIterationCount']


def test_fixture_geometry_is_the_declared_touching_geometry():
    for name in CASES:
        fixture = load(name)
        result = rate(adapt(fixture))
        x = fixture['inputSi']
        assert result.geometry.overall_m == pytest.approx(x['cableOverallDiameterM'], rel=1e-12)
        assert result.geometry.axis_spacing_m == pytest.approx(x['conductorAxisSpacingM'], rel=1e-12)
        assert result.t3_multiplier == x['oversheathThermalResistanceMultiplier']


def test_unrepresentable_branch_is_refused_by_the_adapter():
    fixture = load('tb880-case-0-1')
    fixture['adapter']['metallicCoverGeometry'] = 'corrugated_sheath'
    with pytest.raises(AssertionError):
        adapt(fixture)
    fixture = load('tb880-case-0-1')
    fixture['inputSi']['skinEffectCoefficient'] = 1.0
    fixture['inputSi']['conductorResistance20OhmPerM'] = 2e-6  # pushes x_s above 2.8
    with pytest.raises(RatingRefused) as refused:
        rate(adapt(fixture))
    assert refused.value.code == 'SKIN_PROXIMITY_OUT_OF_RANGE'
