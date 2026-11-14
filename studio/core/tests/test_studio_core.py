"""Real use of the studio core: library cables, composed scenes, the runner and the service.

The reference values are the published CIGRE TB 880 cases (controlled fixtures, kept
outside the repository) and the regression value the CableSimPro release recorded for
the public Qifan structure.
"""
from copy import deepcopy
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

from cablesim_sdk.parameter_units import translate
from cablesim_iec60287.domain import prepare
from cablesim_iec60287.group import rate_group
from studio_core import CoreError, REPO, library, methods, runner, scene, study

FIXTURES = Path(os.environ.get('CABLESIM_TB880_FIXTURES', str(REPO / '.data/tb880/fixtures')))
TB880 = ['tb880-case-0-1', 'tb880-case-0-1-exact-radical', 'tb880-case-0-1-single-point-bonding',
         'tb880-case-0-1-eddy-gp31', 'tb880-case-0-2', 'tb880-case-0-2-eddy-gp31']


def scene_for(model_id, layout=None, **changes):
    cable = library.get(model_id)
    installation = {**scene.default_installation(cable), **({'layout': layout} if layout else {})}
    conditions = scene.default_conditions(cable)
    for key, value in changes.items():
        (installation if key in installation else conditions)[key] = value
    return {'name': '测试工程', 'cable': cable, 'installation': installation, 'conditions': conditions}


def test_public_qifan_structure_reproduces_the_recorded_release_value():
    """Same published scenario as the CableSimPro release seed: 0.8 m, 25 °C, 1.0 K·m/W, 600 A."""
    reference = json.loads((REPO / 'backend/kernel/model_series_data/qifan_yjlw03.json').read_text('utf-8'))
    record = study.rate(scene_for('public.qifan.yjlw03-110kv-800', depth_m=.8, currents_a=[600.0]))
    summary = record['summary']
    assert summary['ampacity']['value_a'] == pytest.approx(reference['verification']['reference_ampacity_a'], abs=1e-6)
    assert summary['ampacity']['basis'] == 'single_circuit'
    assert summary['verification']['passed']
    # Corrugated sheath with an engineer-given gap resistivity is never presented as deliverable.
    assert record['method_card']['tier']['tier'] == 'reference'
    assert record['plugin_version'] == runner.manifest('cablesim.iec60287')[0]['version']


@pytest.mark.parametrize('model,layout', [
    ('system.yjq02-110kv-800', 'trefoil'), ('system.yjq02-110kv-800', 'flat'), ('system.cu-xlpe-al-400', 'ducts'),
    ('system.cu-xlpe-al-400', 'backfill'), ('huayuan.yjv22-15kv-240', 'three_core_buried_horizontal')])
def test_isolated_run_equals_the_algorithm_called_in_process(model, layout):
    """The runner adds a process boundary and a unit decode; neither may move a number."""
    record = study.rate(scene_for(model, layout, currents_a=[320.0]))
    case = record['result']['cases'][0]
    assert case['status'] == 'succeeded'
    spec = runner.capability('cablesim.iec60287', 'steady-rating')
    public = runner.normalize_parameters(spec, {'parameters': record['parameters']})
    direct = rate_group(prepare(record['document'], translate(spec['parameter_schema'], public, to_runtime=True)))
    trace = case['artifacts'][study.TRACE]
    assert [r['ampacity_a'] for r in trace['circuit_ratings']] == [r['ampacity_a'] for r in direct['circuit_ratings']]
    for mine, theirs in zip(trace['operating']['cable_states'], direct['operating']['cable_states']):
        for key in ('conductor_temperature_c', 'sheath_temperature_c', 'total_loss_w_m', 't1_k_m_w', 't4_self_soil_k_m_w'):
            assert mine[key] == theirs[key]
    assert record['summary']['ampacity']['value_a'] == min(
        [direct['simultaneous_rating']['ampacity_a']] if direct.get('simultaneous_rating')
        else [r['ampacity_a'] for r in direct['circuit_ratings']])


def tb880_scene(fixture):
    """inputSi only: the expected blocks never reach the solver."""
    x, adapter = fixture['inputSi'], fixture['adapter']

    def field(*keys):
        found = [x[key] for key in keys if key in x]
        assert len(found) == 1, keys
        return found[0]
    ducted = 'ductOuterDiameterM' in x
    materials = [
        {'id': 'material/cu', 'label': '导体', 'category': 'conductor',
         'temperature_coefficient_20': x['conductorTemperatureCoefficientPerK']},
        {'id': 'material/semi-inner', 'label': '导体屏蔽', 'category': 'semiconductor',
         'thermal_resistivity': field('innerSemiconductingThermalResistivityKMPW', 'innerSemiconductingThermalResistivityKmPerW')},
        {'id': 'material/xlpe', 'label': '绝缘', 'category': 'insulation',
         'thermal_resistivity': field('insulationThermalResistivityKMPW', 'insulationThermalResistivityKmPerW'),
         'relative_permittivity': field('insulationRelativePermittivity', 'relativePermittivity'),
         'loss_tangent': x['dielectricLossTangent']},
        {'id': 'material/semi-outer', 'label': '绝缘屏蔽', 'category': 'semiconductor',
         'thermal_resistivity': field('outerSemiconductingThermalResistivityKMPW', 'outerSemiconductingThermalResistivityKmPerW')},
        {'id': 'material/sheath', 'label': '金属护套', 'category': 'metal',
         'electrical_resistivity_20': field('metallicSheathResistivity20OhmM', 'metallicSheathResistivity20COhmM'),
         'temperature_coefficient_20': x['metallicSheathTemperatureCoefficientPerK']},
        {'id': 'material/oversheath', 'label': '外护套', 'category': 'polymer',
         'thermal_resistivity': field('outerSheathThermalResistivityKMPW', 'outerSheathThermalResistivityKmPerW')},
    ]
    layers = [{'role': role, 'material': material, 'thickness': x[key], **({'form': 'smooth'} if role == 'metallic_sheath' else {})}
              for role, material, key in [
                  ('conductor_screen', 'material/semi-inner', 'innerSemiconductingThicknessM'),
                  ('insulation', 'material/xlpe', 'insulationThicknessM'),
                  ('insulation_screen', 'material/semi-outer', 'outerSemiconductingThicknessM'),
                  ('metallic_sheath', 'material/sheath', 'metallicSheathThicknessM'),
                  ('oversheath', 'material/oversheath', 'outerSheathThicknessM')]]
    payload = {'materials': materials, 'cable_type': {
        'id': 'cable_type/ct1', 'label': fixture['caseId'], 'construction': 'single_core',
        'rating': {'u0': x['phaseToGroundVoltageV'], 'u': x['lineToLineVoltageV'],
                   'max_conductor_temperature': {'normal': field('maxConductorTemperatureC', 'conductorOperatingTemperatureC') + 273.15}},
        'cores': [{'id': 'core/1', 'x': 0.0, 'z': 0.0, 'layers': [], 'conductor': {
            'material': 'material/cu', 'form': 'stranded_round_compacted', 'nominal_area': 630e-6,
            'diameter': x['conductorDiameterM'],
            'r20': field('conductorResistance20OhmPerM', 'conductorResistance20COhmPerM')}}],
        'common_layers': layers}}
    cable = {'id': 'validation.' + fixture['caseId'], 'version': 'fixture', 'name': fixture['caseId'], 'state': 'validation',
             'source': 'CIGRE TB 880 受控验证输入', 'content_sha256': library.fingerprint(payload), 'payload': payload,
             'method_defaults': deepcopy(library.METHOD_DEFAULTS), 'method_parameters': {}}
    overrides = {
        'ks': field('skinEffectCoefficient', 'skinEffectCoefficientKs'),
        'kp': field('proximityEffectCoefficient', 'proximityEffectCoefficientKp'),
        'reference_basis': 'tb880_reference',
        't4_form': 'exact' if adapter['externalThermalResistanceModel'] == 'iec_exact_radical_u' else 'simplified',
        'eddy': 'ignored' if adapter['eddyCurrentLossModel'] == 'ignored' else 'trefoil',
        'solver': {'initial_sheath_temperature_c': x['initialMetallicSheathTemperatureC'], 'current_tolerance_a': 1e-8,
                   'max_iterations': 100}}
    duct = None
    if ducted:
        duct = {'inner_diameter_m': x['ductInnerDiameterM'], 'outer_diameter_m': x['ductOuterDiameterM'],
                'thermal_resistivity': field('ductThermalResistivityKMPW', 'ductThermalResistivityKmPerW')}
        overrides['duct'] = {'u': x['ductAirGapCoefficientU'], 'v': x['ductAirGapCoefficientV'],
                             'y_per_k': x['ductAirGapCoefficientYPerK'],
                             'initial_mean_air_temperature_c': x['initialDuctAirGapMeanTemperatureC']}
    return {'name': fixture['caseId'], 'cable': cable, 'parameters': overrides,
            'installation': {'layout': 'ducts' if ducted else 'trefoil', 'depth_m': field('burialDepthM', 'burialDepthToCableAxisM'),
                             'spacing_m': None, 'duct': duct, 'backfill': None, 'bonding': adapter['metallicSheathBonding']},
            'conditions': {'soil_thermal_resistivity': field('soilThermalResistivityKMPW', 'soilThermalResistivityKmPerW'),
                           'ambient_temperature_c': x['ambientTemperatureC'], 'frequency_hz': x['frequencyHz'],
                           'system_voltage_v': x['lineToLineVoltageV'], 'currents_a': [250.0]}}


@pytest.mark.skipif(not FIXTURES.is_dir(), reason='受控 TB 880 夹具未提供；设置 CABLESIM_TB880_FIXTURES')
@pytest.mark.parametrize('name', TB880)
def test_tb880_published_cases_through_the_studio_path(name):
    """Library-shaped cable → composed scene → isolated run must land on the published current."""
    fixture = json.loads((FIXTURES / f'{name}.json').read_text('utf-8'))
    record = study.rate(tb880_scene(fixture))
    summary = record['summary']
    assert summary['status'] == 'succeeded', summary.get('error')
    assert summary['ampacity']['value_a'] == pytest.approx(fixture['expected']['ampacityA'], abs=.001)
    state = summary['rated']['cables'][0]
    expected = fixture.get('expectedFixed', fixture['expected'])
    for mine, key in [(state['thermal_k_m_w']['t1'], 'thermalResistanceT1KMPW'), (state['thermal_k_m_w']['t3'], 'thermalResistanceT3KMPW'),
                      (state['losses_w_m']['dielectric'], 'dielectricLossWPerM')]:
        assert mine == pytest.approx(expected[key if key in expected else key.replace('KMPW', 'KmPerW')], rel=1e-6)
    assert summary['verification']['passed']
    # A replay of the published convention is evidence for the method, not an IEC 2023 engineering result.
    assert '不能作为 IEC 2023' in record['result']['cases'][0]['artifacts'][study.TRACE]['result_scope']


def test_tiers_follow_the_computed_configuration_not_the_result():
    def tier(model, layout, **changes):
        composed = study.preview(scene_for(model, layout, **changes))
        return composed['tier']['tier']
    assert tier('system.yjq02-110kv-800', 'trefoil') == 'deliverable'
    assert tier('system.cu-xlpe-al-400', 'ducts') == 'deliverable'
    assert tier('system.yjq02-110kv-800', 'flat') == 'deliverable'
    assert tier('system.cu-xlpe-al-400', 'backfill') == 'reference'
    assert tier('system.cu-xlpe-al-400', 'double_trefoil') == 'reference'
    assert tier('public.qifan.yjlw03-110kv-800', 'trefoil') == 'reference'
    assert tier('huayuan.yjv22-15kv-240', 'three_core_buried_single') == 'reference'


def test_soil_resistivity_sweep_lowers_the_rating_point_by_point():
    record = study.sweep(scene_for('system.yjq02-110kv-800', 'trefoil', currents_a=[600.0]),
                         'soil_thermal_resistivity', [1.0, 1.2, 1.4, 1.6, 1.8, 2.0])
    points = record['sweep']['points']
    assert [p['value'] for p in points] == [1.0, 1.2, 1.4, 1.6, 1.8, 2.0]
    assert all(p['status'] == 'succeeded' for p in points)
    ratings = [p['ampacity_a'] for p in points]
    assert ratings == sorted(ratings, reverse=True) and len(set(ratings)) == 6
    # The first point is the same input as a single check: one request or six, same number.
    single = study.rate(scene_for('system.yjq02-110kv-800', 'trefoil', currents_a=[600.0]))
    assert ratings[0] == single['summary']['ampacity']['value_a']
    assert [p['hottest_conductor_c'] for p in points] == sorted(p['hottest_conductor_c'] for p in points)


def test_selection_takes_the_smallest_public_size_that_carries_the_target():
    series = [e for e in library.entries() if e['family'].startswith('YJV22-8.7/15 kV 三芯（华远')]
    assert len(series) == 10
    record = study.select(scene_for('huayuan.yjv22-15kv-35', 'three_core_buried_single'), series, 300.0)
    rows = {row['model_id']: row for row in record['selection']['candidates']}
    chosen = rows[record['selection']['chosen']]
    assert chosen['ampacity_a'] >= 300.0 and chosen['meets_target'] and chosen['conductor_at_target_c'] <= 90.0
    smaller = sorted((row for row in rows.values() if row['area_mm2'] < chosen['area_mm2']), key=lambda row: row['area_mm2'])
    assert smaller and all(row['ampacity_a'] < 300.0 and not row['meets_target'] for row in smaller)
    assert [row['ampacity_a'] for row in smaller] == sorted(row['ampacity_a'] for row in smaller)
    # An undersized candidate reports the real over-temperature at the target load, not an estimate;
    # the smallest has no steady state there at all, and still gets its own rating.
    assert smaller[-1]['conductor_at_target_c'] > 90.0
    assert smaller[0]['at_target_error']['code'] == 'THERMAL_RUNAWAY' and smaller[0]['ampacity_a'] > 0
    assert 'conductor_at_target_c' not in smaller[0]
    assert len(record['request']['cases']) == 20 and record['kind'] == 'selection'
    # The chosen size's rating is the same number a single check of that cable gives.
    single = study.rate(scene_for(chosen['model_id'], 'three_core_buried_single'))
    assert chosen['ampacity_a'] == single['summary']['ampacity']['value_a']


def test_unanswerable_inputs_are_refused_with_the_field_to_fix():
    with pytest.raises(CoreError) as refused:
        study.rate(scene_for('system.yjq02-110kv-800', 'ducts'))  # 83.8 mm cable, 64 mm template duct
    assert refused.value.path == '/installation/duct/inner_diameter_m'
    record = study.rate(scene_for('system.cu-xlpe-al-400', 'double_trefoil'))
    assert record['summary']['status'] == 'failed'
    assert record['summary']['error']['code'] == 'MULTICIRCUIT_ELECTRICAL_MODEL_REQUIRED'
    assert record['result']['cases'][0]['results'] == []  # no number accompanies a refusal


def test_a_modified_sealed_source_stops_the_run(tmp_path, monkeypatch):
    plugins = tmp_path / 'plugins'
    shutil.copytree(REPO / 'plugins/cablesim.iec60287', plugins / 'cablesim.iec60287',
                    ignore=shutil.ignore_patterns('__pycache__', 'tests'))
    target = plugins / 'cablesim.iec60287/src/cablesim_iec60287/soil.py'
    target.write_text(target.read_text('utf-8') + '\n# edited after sealing\n', 'utf-8')
    monkeypatch.setattr(runner, 'PLUGINS', plugins)
    with pytest.raises(CoreError) as refused:
        study.rate(scene_for('system.yjq02-110kv-800', 'trefoil'))
    assert refused.value.code == 'SEAL_MISMATCH' and 'soil.py' in refused.value.message


def test_service_answers_the_host_over_stdio():
    env = {**os.environ, 'PYTHONPATH': os.pathsep.join([str(REPO), str(REPO / 'studio/core')]), 'PYTHONIOENCODING': 'utf-8'}
    scene_input = scene_for('system.yjq02-110kv-800', 'trefoil', currents_a=[600.0])
    requests = [{'id': 1, 'method': 'methods.list'}, {'id': 2, 'method': 'study.rate', 'params': {'scene': scene_input}},
                {'id': 3, 'method': 'study.rate', 'params': {'scene': {**scene_input, 'installation': {
                    **scene_input['installation'], 'depth_m': -1}}}}]
    done = subprocess.run([sys.executable, '-m', 'studio_core'], env=env, capture_output=True, timeout=120,
                          input='\n'.join(json.dumps(r, ensure_ascii=False) for r in requests).encode('utf-8'))
    replies = {r['id']: r for r in map(json.loads, done.stdout.decode('utf-8').splitlines())}
    assert replies[1]['result'][0]['plugin_version'] == runner.manifest(methods.IEC)[0]['version']
    assert replies[2]['result']['summary']['ampacity']['value_a'] == study.rate(scene_input)['summary']['ampacity']['value_a']
    assert replies[3]['error'] == {'code': 'INPUT_INVALID', 'message': '中心埋深：须大于 0。', 'path': '/installation/depth_m'}
