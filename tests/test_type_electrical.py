"""Independent printed TB 880 intermediates, decimal hand values and real-source gaps."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from backend.domain.models import DomainDocument, FactoryMeasurement
from backend.main import create_app
from backend.plugin_host import Executor
from backend.kernel.scenarios import make_router, system_models

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('type_electrical', ROOT/'plugins/cablesim.type-electrical/src/cablesim_type_electrical/main.py')
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)
spec2 = importlib.util.spec_from_file_location('standard_dimensions', ROOT/'plugins/cablesim.standard-check/src/cablesim_standard_check/main.py')
standard = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(standard)
PUBLIC = json.loads((ROOT/'tests/fixtures/standard_check_cases.json').read_text('utf-8'))


def params(**values):
    return {'cable_type_id': 'cable_type/public', **values, 'sources': {key: '独立手算条件；非厂家试验结果' for key in values}}


def row(result, key):
    return next(r for r in result['rows'] if r['id'].endswith(':'+key))


def tb_document():
    """TB 880 case 0-1, original supplied PDF pp. 62-75, SHA in .data/tb880/README.md.
    Validation values only; never used as product defaults. The 2023 C expression differs.
    """
    document = deepcopy(PUBLIC[2]['input'])
    document['materials'] += [{'id': 'material/semi', 'category': 'semiconductor', 'label': '验证半导电材料'}, {'id': 'material/al', 'category': 'metal', 'label': '验证铝护套', 'standard_kind': 'aluminium'}]
    xlpe = next(m for m in document['materials'] if m['id'] == 'material/xlpe')
    xlpe.update(relative_permittivity=2.5, loss_tangent=.001)
    cable = document['cable_types'][0]
    cable['id'] = 'cable_type/public'
    cable['cores'][0]['conductor'].update(form='stranded_round_compacted', nominal_area=.000630, diameter=.0303, r20=2.83e-5, r20_basis='design')
    cable['cores'][0]['layers'] = []
    cable['common_layers'] = [{'role': 'conductor_screen', 'material': 'material/semi', 'thickness': .0015}, {'role': 'insulation', 'material': 'material/xlpe', 'thickness': .0155}, {'role': 'insulation_screen', 'material': 'material/semi', 'thickness': .0013}, {'role': 'metallic_sheath', 'material': 'material/al', 'form': 'smooth', 'thickness': .0008}, {'role': 'oversheath', 'material': 'material/pvc', 'thickness': .0035}]
    return document


def test_tb880_printed_resistance_intermediates_not_thermal_rating():
    document = tb_document()
    p = params(temperature_k=363.15, frequency_hz=50, ks=1, kp=1, spacing_m=.0755, phase_voltage_v=76210.2355330306)
    p.update(r20_length_basis='finished_cable', arrangement='trefoil')
    result = plugin.calculate(document, p, 'electrical')
    assert row(result, 'dc')['value'] == pytest.approx(3.608533e-5, rel=1e-6)
    assert row(result, 'ys')['value'] == pytest.approx(.06012412684, rel=1e-6)
    assert row(result, 'yp')['value'] == pytest.approx(.03510006481, rel=1e-6)
    assert row(result, 'ac')['value'] == pytest.approx(3.952152638e-5, rel=1e-6)
    # IEC 2023 uses 2π ε0, not the earlier 1/18 coefficient printed by TB 880.
    assert row(result, 'capacitance')['value'] != pytest.approx(2.11076622e-10, rel=1e-5, abs=0)
    assert row(result, 'positive-sequence')['status'] == 'uncovered'
    assert row(result, 'zero-sequence')['value'] is None


def test_missing_short_circuit_conditions_name_fields_without_fabricating_curve():
    document = tb_document()
    before = deepcopy(document)
    result = plugin.calculate(document, params(), 'short-circuit')
    conductor = row(result, 'conductor-adiabatic')
    assert conductor['status'] == 'missing'
    assert {'duration_s', 'initial_temperature_k', 'final_temperature_k'} <= set(conductor['missing_parameters'])
    assert conductor['value'] is None
    assert '待补' in result['headline']
    assert document == before


def test_live_controlled_tb880_fixture_agrees_with_printed_intermediates():
    filename = ROOT/'.data/tb880/fixtures/tb880-case-0-1.json'
    if not filename.exists():
        pytest.skip('受控 TB880 正文摘录不随仓库分发')
    fixture = json.loads(filename.read_text('utf-8'))
    si = fixture['inputSi']
    document = tb_document()
    p = params(temperature_k=si['maxConductorTemperatureC']+273.15, frequency_hz=si['frequencyHz'], ks=si['skinEffectCoefficient'], kp=si['proximityEffectCoefficient'], spacing_m=si['conductorAxisSpacingM'])
    p['r20_length_basis'] = 'finished_cable'
    result = plugin.calculate(document, p, 'electrical')
    assert row(result, 'ac')['value'] == pytest.approx(fixture['expected']['conductorAcResistanceOperatingTemperatureOhmPerM'], rel=fixture['acceptance']['intermediateRelativeTolerance'])


def test_capacitance_charging_and_dielectric_loss_independent_hand_values():
    p = params(frequency_hz=50, phase_voltage_v=76210.2355330306)
    result = plugin.calculate(tb_document(), p, 'electrical')
    assert row(result, 'capacitance')['value'] == pytest.approx(2.113644901699e-10, rel=1e-12, abs=0)
    assert row(result, 'charging')['value'] == pytest.approx(.005060520668172476, rel=1e-12)
    assert row(result, 'dielectric')['value'] == pytest.approx(.38566347204119383, rel=1e-12)


def test_system_xlpe_dielectric_bands_create_new_versions_without_changing_hv():
    for model in system_models():
        u0=model['payload']['cable_type']['rating']['u0']
        tangent=next(m['loss_tangent'] for m in model['payload']['materials'] if m['category']=='insulation')
        assert tangent == (.004 if u0<=18000 else .001)
        if u0==12000:
            assert model['version'] in ('1.0.1','1.0.2')
            assert 'Table 3' in model['dielectric_reference']
        if u0==64000:
            assert model['content_sha256']=='d0367ba83a9f2fbe3b4e18a968ca52d7cc56cc551c7659440bd58ac1fc8fee9f'


def test_geometric_inductance_is_only_the_explicit_balanced_conductor_term():
    p = params(frequency_hz=50, spacing_m=.0944148)
    p['arrangement'] = 'trefoil'
    result = plugin.calculate(tb_document(), p, 'electrical')
    # s / (0.779 * dc / 2) = 8; L = 2e-7 ln(8), X = 2πfL.
    assert row(result, 'geometric-inductance')['value'] == pytest.approx(4.1588830833596715e-7, rel=1e-12, abs=0)
    assert row(result, 'geometric-reactance')['value'] == pytest.approx(.0001306551654182161, rel=1e-12)
    assert row(result, 'positive-sequence')['value'] is None


@pytest.mark.parametrize('case', PUBLIC, ids=lambda c: c['case_id'])
def test_three_real_types_with_independent_short_circuit_hand_values(case):
    p = params(duration_s=1, initial_temperature_k=363.15, final_temperature_k=523.15)
    result = plugin.calculate(case['input'], p, 'short-circuit')
    # Independent 45-digit decimal hand calculation, Cu K=226, beta=234.5,
    # ln(484.5/324.5)=0.400912...; conditions are not factory measurements.
    area = case['input']['cable_types'][0]['cores'][0]['conductor']['nominal_area']*1e6
    expected = 34340.04159876265 if area < 300 else 114466.80532920884
    expected_factor = 1.0133930067841814 if area < 300 else 1.0072962270426333
    assert row(result, 'conductor-adiabatic')['value'] == pytest.approx(expected, abs=1e-6)
    assert row(result, 'conductor-factor')['value'] == pytest.approx(expected_factor, abs=1e-12)
    assert row(result, 'conductor-nonadiabatic')['value'] == pytest.approx(expected*expected_factor, abs=1e-6)
    assert row(result, 'metal-adiabatic')['value'] is None
    electrical = plugin.calculate(case['input'], params(temperature_k=363.15, frequency_hz=50), 'electrical')
    assert row(electrical, 'r20')['value'] is None
    assert row(electrical, 'ac')['value'] is None


def test_three_core_length_basis_cannot_double_apply_the_lay_factor():
    document = deepcopy(PUBLIC[0]['input'])
    for core in document['cable_types'][0]['cores']:
        core['conductor'].update(r20=.0000754, r20_basis='design', form='stranded_round_compacted')
    p = params(temperature_k=293.15, frequency_hz=50, ks=1, kp=1, spacing_m=.05, core_lay_factor=1.02)
    p['r20_length_basis'] = 'finished_cable'
    assert row(plugin.calculate(document, p, 'electrical'), 'dc')['value'] == pytest.approx(.0000754)
    p['r20_length_basis'] = 'straight_core'
    assert row(plugin.calculate(document, p, 'electrical'), 'dc')['value'] == pytest.approx(.0000754*1.02)
    p.pop('core_lay_factor')
    assert row(plugin.calculate(document, p, 'electrical'), 'ac')['value'] is None


def test_proximity_out_of_range_has_no_approximate_ac_result():
    document = tb_document()
    document['cable_types'][0]['cores'][0]['conductor']['r20'] = .000001
    p = params(temperature_k=293.15, frequency_hz=50, ks=1, kp=1, spacing_m=.0755)
    p['r20_length_basis'] = 'finished_cable'
    result = plugin.calculate(document, p, 'electrical')
    assert row(result, 'yp')['status'] == 'not_applicable'
    assert row(result, 'ac')['value'] is None


def test_unsourced_values_and_unspecified_voltage_never_become_results():
    p = params(temperature_k=363.15, frequency_hz=50, ks=1, kp=1, spacing_m=.0755)
    p['r20_length_basis'] = 'finished_cable'
    p['sources'].pop('kp')
    result = plugin.calculate(tb_document(), p, 'electrical')
    assert row(result, 'ac')['value'] is None
    assert row(result, 'charging')['value'] is None


@pytest.mark.parametrize('values,field', [({'duration_s': 0}, 'duration_s'), ({'initial_temperature_k':363.15,'final_temperature_k':300}, 'final_temperature_k'), ({'temperature_k':90}, 'temperature_k'), ({'frequency_hz':True}, 'frequency_hz'), ({'frequency_hz':50,'spacing_m':.001}, 'spacing_m')])
def test_bad_units_ranges_and_conditions_point_to_fields(values, field):
    with pytest.raises(ValueError, match=field):
        plugin.calculate(tb_document(), params(**values), 'short-circuit' if 'duration_s' in values or 'initial_temperature_k' in values else 'electrical')


def reported(document, core, quantity, value, role='conductor', report='试验报告 VALIDATION-001 / 样品 A'):
    return {'id':'measurement/'+uuid4().hex,'cable_type':document['cable_types'][0]['id'], 'core':core,'role':role,'quantity':quantity,'value':value,'unit':'ohm/m' if quantity=='r20' else 'm2' if quantity=='screen_area' else 'm','basis':'measurement','source':{'kind':'measurement','reference':report,'reviewed':False}}


def test_factory_measurement_changes_verdict_preserves_design_and_trace():
    document = deepcopy(PUBLIC[0]['input'])
    core = document['cable_types'][0]['cores'][0]
    core['conductor'].update(r20=.00007, r20_basis='design')
    document['measurements'] = [reported(document, core['id'], 'r20', .0000755), reported(document, core['id'], 'minimum_thickness', .00394, 'insulation')]
    DomainDocument.model_validate(document)
    result = standard.check(document, {'cable_type_id':document['cable_types'][0]['id']})
    r20 = next(r for r in result['rows'] if r['id'].endswith(':r20'))
    minimum = next(r for r in result['rows'] if r['id'].endswith(':insulation-minimum'))
    assert r20['actual'] == pytest.approx(.0755) and r20['verdict'] == 'failed'
    assert r20['design_actual'] == pytest.approx(.07)
    assert r20['basis'] == 'measurement' and 'VALIDATION-001' in r20['input_source']['reference']
    assert minimum['actual'] == pytest.approx(3.94) and minimum['verdict'] == 'failed'
    assert core['conductor']['r20'] == .00007
    document['measurements'][0]['value'] = .000075
    assert next(r for r in standard.check(document, {'cable_type_id':document['cable_types'][0]['id']})['rows'] if r['id'].endswith(':r20'))['verdict'] == 'passed'


def test_measurement_requires_correct_units_source_and_unique_target():
    document = deepcopy(PUBLIC[0]['input'])
    m = reported(document, document['cable_types'][0]['cores'][0]['id'], 'r20', .000075)
    with pytest.raises(ValueError, match='报告'):
        FactoryMeasurement.model_validate({**m, 'source':{'kind':'measurement','reference':' '}})
    with pytest.raises(ValueError, match='单位'):
        FactoryMeasurement.model_validate({**m, 'unit':'m'})
    with pytest.raises(ValueError, match='声明上限'):
        FactoryMeasurement.model_validate({**reported(document, m['core'], 'screen_area', .000025, 'metallic_screen'), 'basis':'manufacturer_limit'})
    document['measurements'] = [m, {**m,'id':'measurement/another'}]
    with pytest.raises(ValueError, match='重复'):
        DomainDocument.model_validate(document)


def test_measurement_uniformity_only_pairs_the_same_sample():
    document = deepcopy(PUBLIC[0]['input'])
    cid = document['cable_types'][0]['cores'][0]['id']
    document['measurements'] = [reported(document,cid,'minimum_thickness',.004,'insulation'),reported(document,cid,'maximum_thickness',.0045,'insulation',report='另一试样')]
    p = {'cable_type_id':document['cable_types'][0]['id']}
    assert next(r for r in standard.check(document,p)['rows'] if r['id'].endswith(':insulation-uniformity'))['actual'] is None
    document['measurements'][1]['source'] = deepcopy(document['measurements'][0]['source'])
    row = next(r for r in standard.check(document,p)['rows'] if r['id'].endswith(':insulation-uniformity'))
    assert row['actual'] == pytest.approx(1/9)
    assert row['verdict'] == 'passed'
    document['measurements'][0]['value'] = .006
    with pytest.raises(ValueError, match='最薄点'):
        DomainDocument.model_validate(document)
    with pytest.raises(ValueError, match='最薄点'):
        standard.check(document, p)


def test_independent_lead_sheath_hand_calculation():
    document = tb_document()
    document['materials'].append({'id':'material/lead','category':'metal','label':'手算铅套','standard_kind':'lead'})
    sheath = document['cable_types'][0]['common_layers'][3]
    sheath.update(material='material/lead',thickness=.001)
    document['measurements'] = [reported(document,None,'screen_area',.0001,'metallic_sheath')]
    p = params(duration_s=4,metal_initial_temperature_k=273.15,metal_final_temperature_k=503.15,contact_factor=.7,inner_thermal_resistivity=4,outer_thermal_resistivity=4,inner_volumetric_heat_capacity=4e6,outer_volumetric_heat_capacity=4e6)
    result = plugin.calculate(document,p,'short-circuit')
    assert row(result,'metallic_sheath-adiabatic')['value'] == pytest.approx(1706.7369528732804,abs=1e-8)
    assert row(result,'metallic_sheath-factor')['formula_inputs']['M_s_minus_half'] == pytest.approx(1400/2900)
    assert row(result,'metallic_sheath-factor')['value'] == pytest.approx(1.5285124277338144,abs=1e-10)
    assert row(result,'parallel-fault-sharing')['status'] == 'uncovered'


def test_smooth_aluminium_design_area_and_short_circuit_match_decimal_hand_calculation():
    from decimal import Decimal, localcontext
    document = tb_document()
    cable = document['cable_types'][0]
    cable['cores'][0]['conductor'].update(diameter=.025, nominal_area=.0004)
    for layer, thickness in zip(cable['common_layers'], [.0006,.0055,.0007,.0008,.0025]):
        layer['thickness'] = thickness
    document['measurements'] = []
    parameters = params(duration_s=1, metal_initial_temperature_k=343.15, metal_final_temperature_k=473.15)
    result = plugin.calculate(document, parameters, 'short-circuit')
    actual = row(result, 'metallic_sheath-adiabatic')
    with localcontext() as context:
        context.prec = 45
        area = Decimal('3.141592653589793238462643383279502884197169399') * (Decimal('40.2')**2-Decimal('38.6')**2)/4
        current = 148 * area * (Decimal(428)/Decimal(298)).ln().sqrt()
    assert actual['formula_inputs']['S_mm2'] == pytest.approx(float(area), rel=1e-12)
    assert actual['value'] == pytest.approx(float(current), rel=1e-12)
    assert actual['input_source']['kind'] == 'derived' and '非实测' in actual['input_source']['reference']
    assert document['measurements'] == []
    cable['common_layers'][3]['form'] = 'corrugated'
    assert row(plugin.calculate(document, parameters, 'short-circuit'), 'metallic_sheath-adiabatic')['value'] is None


def test_isolated_wires_use_per_wire_area_not_total_screen_area():
    document = tb_document()
    screen = {'role':'metallic_screen','material':'material/cu','form':'wires','thickness':.001,'wire_diameter':.001,'wire_count':50,'screen_inner_diameter':.0669}
    document['cable_types'][0]['common_layers'][3] = screen
    p = params(duration_s=1,metal_initial_temperature_k=363.15,metal_final_temperature_k=523.15,inner_thermal_resistivity=3.5,inner_volumetric_heat_capacity=2.4e6)
    p['wire_contact'] = 'fully_embedded'
    a = plugin.calculate(document,p,'short-circuit')
    screen['wire_count'] = 100
    b = plugin.calculate(document,p,'short-circuit')
    assert row(a,'metallic_screen-factor')['value'] == pytest.approx(row(b,'metallic_screen-factor')['value'],rel=1e-12)
    assert row(b,'metallic_screen-nonadiabatic')['value'] == pytest.approx(2*row(a,'metallic_screen-nonadiabatic')['value'],rel=1e-12)
    p['wire_contact'] = 'air_spaces'
    assert row(plugin.calculate(document,p,'short-circuit'),'metallic_screen-nonadiabatic')['value'] is None


def test_shared_electrical_topology_is_captured_without_inventing_impedance():
    document = tb_document()
    circuit = document['circuits'][0]
    circuit['electrical_topology'] = {'phase_sequence':'ACB','reference_angle_rad':.2,'source':{'kind':'user','reference':'手算接线图','reviewed':False}}
    circuit['bonding']['source'] = {'kind':'user','reference':'单点接地设计图','reviewed':False}
    p = params()
    p['circuit_id'] = circuit['id']
    result = plugin.calculate(document,p,'electrical')
    assert result['electrical_topology']['electrical_topology']['phase_sequence'] == 'ACB'
    assert row(result,'zero-sequence')['value'] is None
    assert '已复用' in row(result,'zero-sequence')['reason']


def test_isolated_capabilities_and_no_residual_jobs(tmp_path):
    engine = Executor(jobs_root=tmp_path)
    document = deepcopy(PUBLIC[0]['input'])
    for capability in ('electrical','short-circuit'):
        cases = [{'case_id':'case','input':document if capability=='short-circuit' else tb_document(),'parameters':params(duration_s=1,initial_temperature_k=363.15,final_temperature_k=523.15) if capability=='short-circuit' else params()}]
        assert engine.check('cablesim.type-electrical',capability,cases).cases[0].status == 'succeeded'
        result = engine.run('cablesim.type-electrical',capability,cases)
        assert result.cases[0].artifacts['x-cablesim.type-'+capability]['schema'] == 'cablesim.type-analysis/1'
        artifact=result.cases[0].artifacts['x-cablesim.type-'+capability]
        assert result.cases[0].evidence['headline']==artifact['headline']
        assert '允许短路电流' in artifact['headline'] if capability=='short-circuit' else '直流电阻' in artifact['headline']
        witness=result.cases[0].artifacts['x-cablesim.headline-witness']
        assert witness['quantities'] and all(q['unit'] in ('A','Ω/m') for q in witness['quantities'])
        for q in witness['quantities']:
            assert any(r['value']==q['value'] and r['target']['core_id']==q['entity'] for r in artifact['rows'])
    assert not list(tmp_path.iterdir())


def test_host_frozen_results_and_idempotent_short_circuit_request(tmp_path):
    app = create_app(tmp_path/'workspace.sqlite')
    app.include_router(make_router(app.state.workspace_store))
    fallback = next(r for r in app.router.routes if getattr(r,'path','')=='/api/{path:path}')
    app.router.routes.remove(fallback);app.router.routes.append(fallback)
    with TestClient(app) as client:
        model = next(m for m in system_models() if m['id']=='system.yjq02-110kv-800')
        w = client.post('/api/design/type-workspaces',json={'model_id':model['id'],'content_sha256':model['content_sha256']}).json()
        root = '/api/workspaces/'+w['id']
        method = next(m for m in client.get('/api/methods').json() if m['method']['plugin_id']=='cablesim.type-electrical')
        p = params(duration_s=1,initial_temperature_k=363.15,final_temperature_k=523.15)
        p['cable_type_id'] = w['domain']['cable_types'][0]['id']
        s = client.post(root+'/studies',json={'title':'短路手算','input_source':'domain','method':{**method['method'],'capability':'short-circuit'},'parameters':p,'expected_revision':w['revision']}).json()
        sr = root+'/studies/'+s['id']
        preflight = client.get(sr+'/preflight',params={'expected_revision':w['revision'],'expected_study_revision':s['revision']}).json()
        assert preflight['ready']
        request = {'request_id':str(uuid4()),'expected_revision':w['revision'],'expected_study_revision':s['revision'],'lock_digest':preflight['lock_digest'],'scope_acknowledged':True}
        first = client.post(sr+'/runs',json=request).json()
        assert first['status']=='succeeded'
        assert client.post(sr+'/runs',json=request).json()['id']==first['id']
        original = deepcopy(first['output'])
        document = deepcopy(w['domain'])
        document['measurements'] = [reported(document,document['cable_types'][0]['cores'][0]['id'],'r20',.000022)]
        assert client.put(root+'/domain',json={'document':document,'expected_revision':w['revision']}).status_code==200
        history = client.get(sr+'/runs/'+first['id'],params={'view':'full'}).json()
        assert history['freshness']=='historical' and history['output']==original


def test_duration_curve_matches_independent_decimal_hand_values_and_keeps_gaps():
    from decimal import Decimal, localcontext
    document = PUBLIC[0]['input']
    p = params(duration_s=1, initial_temperature_k=363.15, final_temperature_k=523.15,
               interest_times_s=[.25, 4, .25])
    result = plugin.calculate(document, p, 'short-circuit')
    curve = result['curve']
    assert curve['range_s'] == [.1, 5] and curve['axis'] == 'log'
    assert curve['highlighted_times_s'] == [.25, 1, 4]
    assert curve['times_s'] == sorted(set(curve['times_s']))
    for t in (.25, 4):
        index = curve['times_s'].index(t)
        with localcontext() as ctx:
            ctx.prec = 45
            duration = Decimal(str(t))
            current = Decimal(226)*240*((Decimal('484.5')/Decimal('324.5')).ln()/duration).sqrt()
            correction = (1+Decimal('.41')*(duration/240).sqrt()+Decimal('.12')*duration/240).sqrt()
        ad = next(s for s in curve['series'] if s['row_id'].endswith('conductor-adiabatic'))
        non = next(s for s in curve['series'] if s['row_id'].endswith('conductor-nonadiabatic'))
        assert ad['values_a'][index] == pytest.approx(float(current), abs=1e-7)
        assert non['values_a'][index] == pytest.approx(float(current*correction), abs=1e-7)
        assert any(s['values_a'][index] is None for s in curve['series'] if s['target']['role'] != 'conductor')
    missing = plugin.calculate(document, params(duration_s=1), 'short-circuit')['curve']
    assert missing['status'] == 'missing'
    assert all(v is None for s in missing['series'] for v in s['values_a'])


@pytest.mark.parametrize('points', [[.09], [5.1], [True], [1]*21, ['one']])
def test_duration_curve_rejects_invalid_interest_points(points):
    with pytest.raises((ValueError, TypeError)):
        plugin.calculate(PUBLIC[0]['input'], params(interest_times_s=points), 'short-circuit')
