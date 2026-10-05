"""Original-table values, independent hand arithmetic, missing data and frozen host runs."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.domain.models import Layer, DomainDocument
from backend.main import create_app
from backend.plugin_host import Executor
from backend.plugin_host.executor import validate_domain_input
from backend.kernel.scenarios import system_models, make_router

ENTRY = Path(__file__).resolve().parents[1] / 'plugins/cablesim.standard-check/src/cablesim_standard_check/main.py'
spec = importlib.util.spec_from_file_location('standard_check', ENTRY)
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


def example(u0=8700, u=15000, three=True, area=240):
    count = 3 if three else 1
    ins = 10.5 if u == 35000 else 16 if u == 110000 else 4.5
    t = {'id': 'cable_type/example', 'label': '手算输入', 'construction': 'three_core' if three else 'single_core',
         'rating': {'u0': u0, 'u': u, 'um': None, 'max_conductor_temperature': {'normal': 363.15}}, 'cores': [], 'common_layers': []}
    for i in range(count):
        t['cores'].append({'id': f'core/c{i}', 'x': (i-1)*.1 if three else 0, 'z': 0,
                          'conductor': {'material': 'material/cu', 'form': 'stranded_round_compacted', 'nominal_area': area*1e-6, 'diameter': .034 if area == 800 else .02, 'conductor_class': 2, 'r20': .000075 if area == 240 else .000022, 'r20_basis': 'measurement'},
                          'layers': [{'role': 'conductor_screen', 'material': 'material/semi', 'thickness': .001, 'minimum_thickness': .0005},
                                     {'role': 'insulation', 'material': 'material/xlpe', 'thickness': ins/1000, 'minimum_thickness': (.9*ins-.1)/1000, 'maximum_thickness': ins/1000},
                                     {'role': 'insulation_screen', 'material': 'material/semi', 'thickness': .001, 'minimum_thickness': .0005},
                                     {'role': 'metallic_screen', 'material': 'material/cu', 'thickness': .0002, 'form': 'tape', 'nominal_tape_thickness': .0001, 'minimum_tape_thickness': .00009, 'tape_width': .02, 'tape_count': 1, 'tape_application': 'helical_overlap', 'overlap': .15, 'minimum_overlap': .05}]})
    t['common_layers'] = [{'role': 'bedding', 'material': 'material/pvc', 'form': 'smooth', 'thickness': .002, 'minimum_thickness': .0015}, {'role': 'oversheath', 'material': 'material/pvc', 'thickness': .0045, 'minimum_thickness': .004}]
    return {'schema_version': 'cablesim.domain/1', 'name': '手算核验', 'materials': [{'id': 'material/cu', 'label': '裸铜', 'category': 'conductor', 'standard_kind': 'copper_bare'}, {'id': 'material/semi', 'label': '半导电', 'category': 'semiconductor'}, {'id': 'material/xlpe', 'label': 'XLPE', 'category': 'insulation', 'standard_kind': 'XLPE'}, {'id': 'material/pvc', 'label': 'PVC', 'category': 'polymer', 'standard_kind': 'PVC'}], 'cable_types': [t], 'provenance': {}}


def run(document):
    validate_domain_input(document)
    return plugin.check(document, {'cable_type_id': document['cable_types'][0]['id']})


def item(result, suffix):
    return next(r for r in result['rows'] if r['id'].endswith(':' + suffix))


@pytest.mark.parametrize('u0,u,expected_df,expected_outer,expected_min', [(8700, 15000, 64.8, 3.3, 3.95), (26000, 35000, 90.7, 4.3, 9.35)])
def test_independent_three_core_hand_calculation(u0, u, expected_df, expected_outer, expected_min):
    document = example(u0, u)
    document['cable_types'][0]['common_layers'][0]['thickness'] = .0018 if u == 15000 else .002
    document['cable_types'][0]['common_layers'][-1]['thickness'] = expected_outer / 1000
    result = run(document)
    # 10 kV: (17.5 + 2×4.5 + 3 + 0.5)×2.16 = 64.8;
    # A.2.4 in part 2 uses fictitious t_B=0.6, hence D_os=66.0,
    # round_0.1(0.035×66+1)=3.3. Part 3 uses table t_B=2.0:
    # D_f=90.7, D_os=94.7, t_os=4.3. Neither uses actual outside diameter.
    assert next(s['D_f_mm'] for s in result['fictitious_diameter_trace'] if 'D_f_mm' in s) == expected_df
    assert item(result, 'oversheath-nominal')['limit'] == expected_outer
    assert item(result, 'oversheath-minimum')['limit'] == (2.44 if u == 15000 else 3.24)
    assert item(result, 'insulation-minimum')['limit'] == expected_min
    assert len([r for r in result['rows'] if r['id'].endswith(':r20')]) == 3
    assert item(result, 'r20')['limit'] == .0754
    assert item(result, 'screen-tape-nominal')['limit'] == .1
    assert result['conclusion'] == 'incomplete'  # Short-circuit screen requirement remains uncovered.
    assert all(r['clause'] and r['standard'] and len(r['source_digest']) == 64 for r in result['rows'])


def test_minimum_thickness_uses_hundredth_rounding_and_not_nominal():
    document = example()
    insulation = document['cable_types'][0]['cores'][0]['layers'][1]
    insulation['minimum_thickness'] = .003946
    assert item(run(document), 'insulation-minimum')['verdict'] == 'passed'
    insulation['minimum_thickness'] = .003944
    assert item(run(document), 'insulation-minimum')['verdict'] == 'failed'
    insulation.pop('minimum_thickness')
    assert item(run(document), 'insulation-minimum')['verdict'] == 'missing'
    assert plugin.rounded(30.05) == 30.1
    assert plugin.rounded(2.449) == 2.4


def test_r20_material_coating_class_and_basis_are_explicit():
    document = example()
    c = document['cable_types'][0]['cores'][0]['conductor']
    c['r20'] = .000076
    assert item(run(document), 'r20')['verdict'] == 'failed'
    document['materials'][0]['standard_kind'] = 'copper_coated'
    assert item(run(document), 'r20')['limit'] == .0762
    assert item(run(document), 'r20')['verdict'] == 'passed'
    c['r20_basis'] = None
    assert item(run(document), 'r20')['actual'] is None
    c['conductor_class'] = 1
    assert item(run(document), 'r20')['verdict'] == 'uncovered'


def test_missing_screen_data_and_double_tape_padding_stop_fictitious_chain():
    document = example()
    document['cable_types'][0]['cores'][0]['layers'][-1].pop('tape_width')
    assert item(run(document), 'oversheath-nominal')['limit'] is None
    document = example()
    document['cable_types'][0]['common_layers'].insert(1, {'role': 'armour', 'material': 'material/cu', 'thickness': .001, 'form': 'tape', 'nominal_tape_thickness': .0005, 'tape_count': 2})
    result = run(document)
    assert item(result, 'oversheath-nominal')['verdict'] == 'uncovered'
    assert item(result, 'oversheath-nominal')['limit'] is None


def test_hv_primary_table_cells_and_missing_part_one():
    document = example(64000, 110000, three=False, area=800)
    t = document['cable_types'][0]
    document['materials'].append({'id': 'material/al', 'label': '铝', 'category': 'metal', 'standard_kind': 'aluminium'})
    t['common_layers'] = [{'role': 'metallic_sheath', 'material': 'material/al', 'form': 'corrugated', 'thickness': .002}, t['common_layers'][-1]]
    result = run(document)
    assert item(result, 'insulation-nominal')['limit'] == 16
    assert item(result, 'oversheath-nominal')['limit'] == 4.5
    assert item(result, 'sheath-nominal')['limit'] == 2
    assert item(result, 'insulation-minimum')['verdict'] == 'uncovered'
    assert item(result, 'oversheath-minimum')['limit'] is None
    document['materials'][-1]['standard_kind'] = 'lead'
    assert item(run(document), 'sheath-nominal')['limit'] == 2.9
    assert item(run(document), 'sheath-nominal')['verdict'] == 'failed'


@pytest.mark.parametrize('branch', ['missing_bedding', 'common_screen', 'extra_core_layer'])
def test_uncovered_layers_never_produce_a_smaller_sheath_limit(branch):
    document = example()
    cable = document['cable_types'][0]
    if branch == 'missing_bedding':
        cable['common_layers'].pop(0)
    elif branch == 'common_screen':
        cable['common_layers'].insert(0, {'role': 'metallic_screen', 'material': 'material/cu', 'thickness': .0002})
    else:
        cable['cores'][0]['layers'].append({'role': 'separator', 'material': 'material/pvc', 'thickness': .001})
    result = run(document)
    assert item(result, 'oversheath-nominal')['limit'] is None
    assert item(result, 'oversheath-nominal')['verdict'] == 'uncovered'


def test_low_voltage_insulation_measurements_are_not_interchanged():
    document = example(600, 1000, three=False)
    ins = document['cable_types'][0]['cores'][0]['layers'][1]
    ins.update(thickness=.0017, minimum_thickness=.00143, mean_thickness=.00165)
    result = run(document)
    assert item(result, 'insulation-nominal')['limit'] == 1.7
    assert item(result, 'insulation-minimum')['limit'] == 1.43
    assert item(result, 'insulation-minimum')['verdict'] == 'passed'
    assert item(result, 'insulation-mean')['actual'] == 1.7
    assert item(result, 'insulation-mean')['verdict'] == 'passed'
    ins['mean_thickness'] = .00164
    assert item(run(document), 'insulation-mean')['verdict'] == 'failed'


@pytest.mark.parametrize('scope,index,thickness,minimum,key,limit', [
    ('core', 1, .005, .00396, 'insulation-minimum', 4.4),
    ('common', 0, .0025, .0017, 'bedding-minimum', 1.8),
    ('common', -1, .005, .003, 'oversheath-minimum', 3.8),
])
def test_thicker_declared_layers_raise_measurement_minimums(scope,index,thickness,minimum,key,limit):
    document = example()
    cable = document['cable_types'][0]
    layers = cable['cores'][0]['layers'] if scope == 'core' else cable['common_layers']
    layers[index].update(thickness=thickness, minimum_thickness=minimum)
    result = run(document)
    assert item(result, key)['limit'] == limit
    assert item(result, key)['verdict'] == 'failed'


@pytest.mark.parametrize('scope,index,thickness,minimum,key,limit', [
    ('core', 1, .0044, .0039, 'insulation-minimum', 3.95),
    ('common', 0, .001, .001, 'bedding-minimum', 1.24),
    ('common', -1, .003, .0023, 'oversheath-minimum', 2.44),
])
def test_under_specified_nominal_does_not_relax_measurement_requirement(scope,index,thickness,minimum,key,limit):
    document = example()
    cable = document['cable_types'][0]
    layers = cable['cores'][0]['layers'] if scope == 'core' else cable['common_layers']
    layers[index].update(thickness=thickness, minimum_thickness=minimum)
    result = run(document)
    assert item(result, key)['limit'] == limit
    assert item(result, key)['verdict'] == 'failed'


def test_missing_screen_retains_dimension_requirement_and_correct_layer_target():
    document = example()
    for core in document['cable_types'][0]['cores']:
        core['layers'].pop()
    result = run(document)
    assert item(result, 'screen-dimensions')['verdict'] == 'missing'
    assert item(result, 'screen-dimensions')['target'] == {'scope': 'core', 'core_id': 'core/c0', 'role': 'metallic_screen'}
    assert item(result, 'screen-area')['target']['role'] == 'metallic_screen'


def test_hv_wire_gap_equation_includes_division_by_n():
    document = example(64000, 110000, three=False, area=800)
    screen = document['cable_types'][0]['cores'][0]['layers'][-1]
    screen.update(form='wires', wire_count=50, wire_diameter=.001, screen_inner_diameter=.07, reverse_binder_thickness=0)
    result = run(document)
    assert item(result, 'screen-wire-gap')['actual'] == pytest.approx((3.141592653589793*71-50)/50)
    assert item(result, 'screen-wire-gap')['verdict'] == 'passed'
    document['cable_types'][0]['rating'].update(u0=26000, u=35000)
    assert item(run(document), 'screen-wire-gap')['verdict'] == 'uncovered'


@pytest.mark.parametrize('field,value', [('thickness', 4.5), ('minimum_thickness', -1), ('wire_count', 1.2)])
def test_invalid_input_points_to_field_and_has_no_output(field, value):
    document = example()
    document['cable_types'][0]['cores'][0]['layers'][1][field] = value
    with pytest.raises(ValueError, match=field):
        run(document)


def test_isolated_protocol_preflight_and_artifact(tmp_path):
    document = example()
    cases = [{'case_id': 'check', 'input': document, 'parameters': {'cable_type_id': 'cable_type/example'}}]
    engine = Executor(jobs_root=tmp_path)
    preflight = engine.check('cablesim.standard-check', 'dimensions', cases)
    assert preflight.cases[0].status == 'succeeded' and not preflight.cases[0].artifacts
    actual = engine.run('cablesim.standard-check', 'dimensions', cases)
    assert actual.cases[0].status == 'succeeded'
    assert actual.cases[0].artifacts['x-cablesim.standard-check']['schema'] == 'cablesim.standard-check/1'
    assert not list(tmp_path.iterdir())


def test_saved_snapshot_is_immutable_and_duplicate_request_reuses_run(tmp_path):
    app = create_app(tmp_path / 'work.sqlite')
    app.include_router(make_router(app.state.workspace_store))
    fallback = next(r for r in app.router.routes if getattr(r, 'path', '') == '/api/{path:path}')
    app.router.routes.remove(fallback)
    app.router.routes.append(fallback)
    with TestClient(app) as client:
        model = next(m for m in system_models() if m['id'] == 'system.yjq02-110kv-800')
        w = client.post('/api/design/type-workspaces', json={'model_id': model['id'], 'content_sha256': model['content_sha256']}).json()
        method = next(m for m in client.get('/api/methods').json() if m['method']['plugin_id'] == 'cablesim.standard-check')
        root = f"/api/workspaces/{w['id']}"
        study = client.post(root + '/studies', json={'title': '标准核对', 'input_source': 'domain', 'method': {**method['method'], 'capability': 'dimensions'}, 'parameters': {'cable_type_id': w['domain']['cable_types'][0]['id']}, 'expected_revision': w['revision']}).json()
        sr = root + '/studies/' + study['id']
        preflight = client.get(sr + '/preflight', params={'expected_revision': w['revision'], 'expected_study_revision': study['revision']}).json()
        assert preflight['ready']
        request = {'request_id': str(uuid4()), 'expected_revision': w['revision'], 'expected_study_revision': study['revision'], 'lock_digest': preflight['lock_digest'], 'scope_acknowledged': True}
        first = client.post(sr + '/runs', json=request)
        assert first.status_code == 200, first.text
        first = first.json()
        assert first['status'] == 'succeeded'
        assert client.post(sr + '/runs', json=request).json()['id'] == first['id']
        previous = deepcopy(first['output'])
        document = deepcopy(w['domain'])
        document['cable_types'][0]['common_layers'][1]['thickness'] += .001
        assert client.put(root + '/domain', json={'document': document, 'expected_revision': w['revision']}).status_code == 200
        saved = client.get(sr + '/runs/' + first['id']).json()
        assert saved['freshness'] == 'historical'
        assert saved['output'] == previous
        assert saved['snapshot']['workspace_revision'] == w['revision']


def test_domain_rejects_inverted_measurements():
    layer = {'role': 'insulation', 'material': 'material/xlpe', 'thickness': .0015, 'minimum_thickness': .002, 'maximum_thickness': .001}
    with pytest.raises(ValueError, match='最薄点'):
        Layer.model_validate(layer)


def test_absent_standard_facts_preserve_named_demo_version_digests():
    expected = {
        'system.cu-xlpe-al-240': 'e9f2eb5f4dd359842dc0e6158e2cca191571284802b9efc021ff4bf19d070b1c',
        'system.cu-xlpe-al-400': 'c105a5e2d7f3905cb5676f18cf008992adf4cd3f84df4dd4efa34cfb62adfc51',
        'system.yjq02-110kv-800': 'd0367ba83a9f2fbe3b4e18a968ca52d7cc56cc551c7659440bd58ac1fc8fee9f',
        'system.cu-xlpe-10kv-240': '44da39f79c1df5d344f862bff0aac1718b36472b91ffa512af279cfd3fe82f07',
    }
    actual = {m['id']: m['content_sha256'] for m in system_models()}
    assert {key: actual[key] for key in expected} == expected


@pytest.mark.parametrize('case', json.loads(Path(__file__).with_name('fixtures').joinpath('standard_check_cases.json').read_text('utf-8')), ids=lambda c: c['case_id'])
def test_real_manufacturer_nominal_values_and_missing_measurements(case):
    document = DomainDocument.model_validate(case['input']).model_dump(mode='json')
    result = plugin.check(document, case['parameters'])
    expected = {'jiangnan-10kv': 4.5, 'jiangnan-35kv': 10.5, 'qifan-110kv': 16}[case['case_id']]
    assert item(result, 'insulation-nominal')['actual'] == expected
    assert item(result, 'insulation-nominal')['limit'] == expected
    assert item(result, 'insulation-nominal')['verdict'] == 'passed'
    assert item(result, 'r20')['actual'] is None
    assert item(result, 'insulation-minimum')['actual'] is None
    assert result['conclusion'] == 'incomplete'
    if case['case_id'] == 'qifan-110kv':
        assert item(result, 'oversheath-nominal')['actual'] == item(result, 'oversheath-nominal')['limit'] == 4.5
    else:
        assert item(result, 'oversheath-nominal')['limit'] is None
