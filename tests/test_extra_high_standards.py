"""Official 220 kV table cells and real sealed API/Executor consumers.

The matrices below were read from the national standard's official preview,
printed pages 5–9 / preview pages 9–13. The process fixture is an explicit test design,
not a manufacturer cable or a claim that all product tests have passed.
"""
from copy import deepcopy
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.domain.models import DomainDocument
from backend.kernel.scenarios import system_models
from backend.kernel.type_versions import structure_context
from test_standard_check import example, item, plugin
from test_standards_basis import library_module


PAGE_SHA256 = 'd2590b0f121ff8eedd5a42664d533ca42c4937e7d68be46829573c3939364207'
AREA = [400, 500, 630, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500]
WIRES = [53, 53, 53, 53, 170, 170, 170, 170, 265, 265, 265, 265]
R20 = [.0470, .0366, .0283, .0221, .0176, .0151, .0129, .0113, .0101, .0090, .0083, .0072]
INSULATION = [27, 27, 26, 25, 24, 24, 24, 24, 24, 24, 24, 24]
LEAD = [2.7, 2.7, 2.8, 2.8, 2.8, 2.9, 3.0, 3.1, 3.1, 3.2, 3.3, 3.4]
ALUMINIUM = [2.4, 2.4, 2.4, 2.4, 2.6, 2.6, 2.6, 2.6, 2.8, 2.8, 2.8, 2.8]
COVERINGS_SHA256 = '54dcdae0bd1374affddd1b8ff5a64d6d77809e0080e68c4f9eff042e9f318291'
MANUFACTURING_LIMITS = [
    ('aluminium-sheath-purity', 'metallic_sheath', 'aluminium_sheath_purity', .995,
     'ehv-rule-6.6.1-purity/r1/value', 99.5, '%'),
    ('aluminium-strip-elongation', 'metallic_sheath', 'aluminium_strip_elongation', .16,
     'ehv-rule-6.6.1-elongation/r1/value', 16.0, '%'),
    ('oversheath-semiconductor-ratio', 'oversheath', 'oversheath_semiconductor_ratio', .20,
     'ehv-rule-6.7.3-ratio/r1/value', .20, '1'),
]


def manufacturing_field(role, name):
    return '/cable_types/cable_type~1example/common_layers/' + role + '/engineering/' + name


def manufacturing_input(document, role, name, value, unit='1'):
    document['provenance'][manufacturing_field(role, name)] = {
        'kind': 'user' if isinstance(value, bool) else 'measurement', 'reviewed': False,
        'reference': json.dumps({'schema': 'cablesim.manufacturing-input/1', 'unit': unit,
            'value': value, 'reference': '独立边界测试输入；不是厂家实测、材料认证或标准值填充'})}


def manufacturing_design(values=(.997, .18, .15)):
    document = design()
    for (_, role, name, *_), value in zip(MANUFACTURING_LIMITS, values):
        manufacturing_input(document, role, name, value)
    manufacturing_input(document, 'oversheath', 'bonded_extruded_oversheath_layer', True)
    return document


def request(area=2200, quantity='insulation_nominal', **conditions):
    return {'schema_version': 'cablesim.standards-query/1',
            'standard': 'GB/T 18890.2', 'edition': '2015',
            'locator': '表 3' if quantity == 'insulation_nominal' else '表 2',
            'quantity': quantity, 'conditions': {'area_m2': area / 1e6,
                'u0_v': 127000, 'u_v': 220000, 'conductor_material': 'copper',
                **({'insulation': 'XLPE'} if quantity == 'insulation_nominal' else {}), **conditions}}


def test_all_official_cells_and_scope_have_two_independent_routes():
    library = library_module.BasisLibrary()
    for area, wires, r20, insulation in zip(AREA, WIRES, R20, INSULATION):
        for quantity, expected in [('wire_count_min', wires), ('resistance_20_max', r20),
                                   ('insulation_nominal', insulation)]:
            answer = library.query(request(area, quantity))
            assert answer['status'] == 'resolved' and answer['approval'] == 'not_granted'
            record = answer['records'][0]
            assert record['value'] == expected
            assert record['source_sha256'] == PAGE_SHA256
            assert record['source_format'] == 'official_preview_image'
            assert record['source_url'].startswith('https://openstd.samr.gov.cn/')
            assert (record['printed_page'], record['pdf_page']) == (5, 9)
            assert '官方预览 第 9 页' in record['citation'] and 'PDF' not in record['citation']
            assert {source['preview_page'] for source in record['context_sources']} == {6, 8}
            evidence = library.verification['tables'][record['verification']['evidence_id']]
            assert {method['id'] for method in evidence['methods']} == {
                'official-preview-visual', 'tesseract-column-ocr'}
            assert evidence['comparison']['status'] == 'equal'
            assert evidence['comparison']['differences'] == []
    tables = {table['id']: table for table in library.data['tables']}
    assert tables['ehv-表2']['record_count'] == 24
    assert tables['ehv-表3']['record_count'] == 4
    assert tables['ehv-表4']['record_count'] == 24
    assert any(gap['standard'] == 'GB/T 18890.1' and '第 12 章型式试验' in gap['locators']
               for gap in library.data['not_covered'])


def manufacturing_request(locator, quantity, *, area=2200, **conditions):
    query = request(area)
    return {**query, 'locator': locator, 'quantity': quantity,
            'conditions': {**query['conditions'], **conditions}}


def test_official_metal_sheath_cells_and_manufacturing_limits_are_exact_and_scoped():
    library = library_module.BasisLibrary()
    for area, lead, aluminium in zip(AREA, LEAD, ALUMINIUM):
        for material, expected in [('lead', lead), ('corrugated_aluminium', aluminium)]:
            answer = library.query(manufacturing_request('表 4', 'metal_sheath_nominal', area=area,
                                                        sheath_material=material))
            record = answer['records'][0]
            assert answer['status'] == 'resolved' and answer['approval'] == 'not_granted'
            assert record['value'] == expected and record['source_sha256'] == COVERINGS_SHA256
            assert (record['printed_page'], record['pdf_page']) == (8, 12)
    cells = [
        ('6.3.2', 'conductor_screen_nominal_reference', 2.0, 'approximate', {'screen_construction': 'tape_plus_extruded'}),
        ('6.3.2', 'conductor_screen_min', .8, 'minimum', {'measurement_role': 'extruded_conductor_screen'}),
        ('6.3.3', 'insulation_screen_nominal_reference', 1.0, 'approximate', {}),
        ('6.3.3', 'insulation_screen_min', .5, 'minimum', {'measurement_role': 'extruded_insulation_screen'}),
        ('6.5.2', 'screen_wire_nominal_min', 1.0, 'minimum', {'screen_kind': 'copper_wire'}),
        ('6.5.2', 'screen_wire_gap_max', 4.0, 'maximum', {'screen_kind': 'copper_wire'}),
        ('6.6.1', 'aluminium_sheath_purity_min', 99.50, 'minimum', {'sheath_material': 'corrugated_aluminium'}),
        ('6.6.1', 'aluminium_strip_elongation_min', 16.0, 'minimum', {'sheath_material': 'corrugated_aluminium'}),
        ('6.7.2', 'oversheath_nominal', 5.0, 'nominal', {'sheath_compound': 'ST7'}),
        ('6.7.2', 'oversheath_mean_min', 5.0, 'minimum', {'sheath_compound': 'ST2', 'metal_sheath_form': 'smooth', 'nominal_thickness_m': .005}),
        ('6.7.2', 'nonmetal_sheath_min', 4.2, 'minimum', {'sheath_compound': 'ST7'}),
        ('6.7.3', 'oversheath_semiconductor_ratio_max', .20, 'maximum', {'sheath_compound': 'ST7', 'screen_construction': 'bonded_extruded_oversheath_layer'}),
    ]
    for locator, quantity, expected, criterion, conditions in cells:
        answer = library.query(manufacturing_request(locator, quantity, **conditions))
        assert answer['status'] == 'resolved', answer
        record = answer['records'][0]
        assert record['value'] == expected and record['criterion'] == criterion
        evidence = library.verification['tables'][record['verification']['evidence_id']]
        assert {method['id'] for method in evidence['methods']} == {'official-preview-visual', 'tesseract-page-ocr'}
        assert evidence['comparison']['differences'] == []
        assert library.query(manufacturing_request(locator, quantity, area=1100, **conditions))['status'] == 'not_covered'
    assert library.query(manufacturing_request('6.7.2', 'oversheath_mean_min', sheath_compound='ST2',
        metal_sheath_form='corrugated', nominal_thickness_m=.005))['status'] == 'not_covered'
    assert library.query(manufacturing_request('6.7.2', 'oversheath_mean_min', sheath_compound='ST2',
        metal_sheath_form='smooth', nominal_thickness_m=.006))['status'] == 'not_covered'
    assert library.query(manufacturing_request('6.7.2', 'nonmetal_sheath_min', sheath_compound='ST1'))['status'] == 'not_covered'


@pytest.mark.parametrize('change', [
    {'area_m2': 300e-6}, {'area_m2': 1100e-6}, {'area_m2': 3000e-6},
    {'conductor_material': 'aluminium'}, {'insulation': 'EPR'},
    {'u0_v': 64000, 'u_v': 110000},
])
def test_220kv_does_not_interpolate_or_substitute_material_voltage(change):
    assert library_module.BasisLibrary().query(request(**change))['status'] == 'not_covered'


def test_220kv_requires_scope_conditions_and_exact_edition():
    library = library_module.BasisLibrary()
    missing = request()
    missing['conditions'].pop('conductor_material')
    with pytest.raises(library_module.BasisError) as error:
        library.query(missing)
    assert error.value.code == 'CONDITIONS_REQUIRED'
    assert library.query({**request(), 'edition': '2024'})['status'] == 'not_covered'


def design():
    document = example(127000, 220000, False, 2200)
    cable = document['cable_types'][0]
    cable['label'] = '明示 220 kV 判据边界测试输入，非厂家样本'
    conductor = cable['cores'][0]['conductor']
    conductor.update(form='segmental', conductor_class=None, diameter=.06,
                     r20=8.3e-6, r20_basis='design', wire_count=265)
    cable['cores'][0]['layers'][1]['thickness'] = .024
    cable['cores'][0]['layers'][0]['thickness'] = .002
    cable['common_layers'].insert(1, {'role': 'metallic_sheath', 'material': 'material/al',
                                    'form': 'corrugated', 'thickness': .0028})
    cable['common_layers'][-1].update(thickness=.005, minimum_thickness=.0042)
    document['materials'].append({'id': 'material/al', 'label': '测试用铝套声明',
                                  'category': 'metal', 'standard_kind': 'aluminium'})
    for path, value, unit in [
        ('/cores/core~1c0/layers/conductor_screen/engineering/extruded_minimum_thickness', .0008, 'm'),
        ('/common_layers/oversheath/engineering/sheath_compound', 'ST7', '1'),
    ]:
        document['provenance']['/cable_types/cable_type~1example' + path] = {
            'kind': 'user', 'reviewed': False,
            'reference': json.dumps({'schema': 'cablesim.manufacturing-input/1', 'unit': unit,
                'value': value, 'reference': '明确的单元测试输入，非厂家数据或真实测量'})}
    document.update(circuits=[], sections=[], load_cases=[])
    structure_context(document)
    document['provenance']['/execution_standards'] = {
        'kind': 'standard', 'reviewed': True,
        'reference': json.dumps({'schema': 'cablesim.execution-standards/1', 'items': [
            {'standard': 'GB/T 18890.2—2015', 'source_digest': PAGE_SHA256}]})}
    return DomainDocument.model_validate(document).model_dump(mode='json')


def test_real_requirement_basis_and_executor_use_220kv_tables_without_pass_claim(tmp_path):
    app = create_app(tmp_path / 'extra-high.sqlite')
    with TestClient(app) as client:
        model = next(m for m in system_models() if m['id'] == 'system.cu-xlpe-al-240')
        created = client.post('/api/design/type-workspaces', json={
            'model_id': model['id'], 'content_sha256': model['content_sha256']})
        assert created.status_code == 201, created.text
        workspace = created.json()
        document = design()
        saved = client.put(f"/api/workspaces/{workspace['id']}/domain", json={
            'expected_revision': workspace['revision'], 'document': document})
        assert saved.status_code == 200, saved.text
        answer = client.post(f"/api/design/type-workspaces/{workspace['id']}/requirements/basis", json={
            'request_id': str(uuid4()), 'expected_revision': saved.json()['revision']})
        assert answer.status_code == 200, answer.text
        parameters = {'cable_type_id': document['cable_types'][0]['id'], **answer.json()['parameters']}
        references = parameters['basis_references']
        assert len(references) == 8
        assert {ref['record']['standard'] for ref in references.values()} == {'GB/T 18890.2'}
        assert {ref['record']['table'] for ref in references.values()} == {'表 2', '表 3', '表 4', ''}
        assert {ref['plugin_version'] for ref in references.values()} == {'0.9.1'}

        def execute(document, parameters):
            result = app.state.research.executor.run('cablesim.standard-check', 'dimensions', [
                {'case_id': 'extra-high', 'input': document, 'parameters': parameters}])
            assert result.cases[0].status == 'succeeded', result.cases[0].error
            assert (result.plugin_version, result.method_version) == ('1.8.6', '1.8.5')
            return result.cases[0].artifacts['x-cablesim.standard-check']

        checked = execute(document, parameters)
        for key, expected in [('r20', .0083), ('conductor-wire-count', 265), ('insulation-nominal', 24)]:
            row = item(checked, key)
            assert row['limit'] == expected and row['verdict'] == 'passed'
            assert row['citation'].endswith('第 5 页（官方预览 第 9 页）')
        for key, expected in [('conductor-screen-minimum', .8), ('insulation-screen-minimum', .5),
                              ('sheath-nominal', 2.8), ('oversheath-nominal', 5), ('oversheath-minimum', 4.2)]:
            row = item(checked, key)
            assert row['limit'] == expected and row['verdict'] == 'passed'
        excluded = next(row for row in checked['not_applicable'] if row['id'].endswith(':oversheath-mean'))
        assert '无平均厚度要求' in excluded['reason']
        assert item(checked, 'conductor-screen-minimum')['engineering_sources']
        for key in ('insulation-minimum', 'ehv-type-tests', 'ehv-prequalification-tests'):
            row = item(checked, key)
            assert row['verdict'] == 'uncovered' and row['limit'] is None
            assert '缺少' in row['reason'] and '18890.1' in row['reason']
        assert checked['conclusion'] == 'incomplete'
        changed = deepcopy(document)
        changed['cable_types'][0]['cores'][0]['conductor'].update(r20=8.31e-6, wire_count=264)
        changed['cable_types'][0]['cores'][0]['layers'][1]['thickness'] = .0239
        from cablesim_standard_check.basis import digest
        failed = execute(changed, {**parameters, 'basis_cable_sha256': digest(changed['cable_types'][0])})
        assert failed['counts']['failed'] == 3 and failed['conclusion'] == 'not_satisfied'
        assert item(failed, 'insulation-minimum')['limit'] is None


def test_missing_220kv_input_is_named_without_inventing_a_standard_or_class():
    document = design()
    document['materials'][0]['standard_kind'] = None
    checked = plugin.check(document, {'cable_type_id': document['cable_types'][0]['id']})
    for key in ('r20', 'conductor-wire-count', 'insulation-nominal'):
        row = item(checked, key)
        assert row['verdict'] == 'missing'
        assert row['basis_missing_fields'][0]['label'] == '导体材料标准类别'
        assert row['limit'] is None
    document = design()
    document['cable_types'][0]['cores'][0]['conductor']['wire_count'] = None
    checked = plugin.check(document, {'cable_type_id': document['cable_types'][0]['id']})
    assert item(checked, 'conductor-wire-count')['actual'] is None
    assert document['cable_types'][0]['cores'][0]['conductor']['conductor_class'] is None


def test_live_220kv_manufacturing_limits_use_exact_records_and_independent_inputs(tmp_path):
    app = create_app(tmp_path / 'manufacturing.sqlite')
    with TestClient(app) as client:
        model = next(m for m in system_models() if m['id'] == 'system.cu-xlpe-al-240')
        created = client.post('/api/design/type-workspaces', json={
            'model_id': model['id'], 'content_sha256': model['content_sha256']})
        assert created.status_code == 201, created.text
        workspace = created.json()
        document = manufacturing_design()
        saved = client.put(f"/api/workspaces/{workspace['id']}/domain", json={
            'expected_revision': workspace['revision'], 'document': document})
        assert saved.status_code == 200, saved.text
        answer = client.post(f"/api/design/type-workspaces/{workspace['id']}/requirements/basis", json={
            'request_id': str(uuid4()), 'expected_revision': saved.json()['revision']})
        assert answer.status_code == 200, answer.text
        parameters = {'cable_type_id': document['cable_types'][0]['id'], **answer.json()['parameters']}
        assert len(parameters['basis_references']) == 11
        missing = deepcopy(document)
        for _, role, name, *_ in MANUFACTURING_LIMITS:
            missing['provenance'].pop(manufacturing_field(role, name))
        cases = [('above', document), ('boundary', manufacturing_design((.995, .16, .20))),
                 ('failed', manufacturing_design((.994, .159, .201))), ('missing', missing)]
        for key, role, name, limit, *_ in MANUFACTURING_LIMITS:
            borrowed = deepcopy(document)
            path = manufacturing_field(role, name)
            receipt = json.loads(borrowed['provenance'][path]['reference'])
            receipt.update(value=limit, reference='GB/T18890.2—2015标准限值，不是制造测量记录')
            borrowed['provenance'][path].update(kind='standard', reference=json.dumps(receipt))
            cases.append(('standard-source-' + key, borrowed))
        borrowed = deepcopy(document)
        path = manufacturing_field('oversheath', 'bonded_extruded_oversheath_layer')
        borrowed['provenance'][path]['kind'] = 'standard'
        cases.append(('standard-construction', borrowed))
        result = app.state.research.executor.run('cablesim.standard-check', 'dimensions', [
            {'case_id': name, 'input': value, 'parameters': parameters} for name, value in cases])
        assert (result.plugin_version, result.method_version) == ('1.8.6', '1.8.5')
        assert len(result.cases) == len(cases)
        outputs = {output.case_id: output for output in result.cases}
        for case_name, inputs in cases[:4]:
            output = outputs[case_name]
            assert output.status == 'succeeded', output.error
            checked = output.artifacts['x-cablesim.standard-check']
            for key, role, name, limit, record_id, original_value, original_unit in MANUFACTURING_LIMITS:
                row = item(checked, key)
                if case_name == 'missing':
                    assert row['verdict'] == 'missing' and row['actual'] is None and row['limit'] is None
                    assert manufacturing_field(role, name) in {spec['field'] for spec in row['basis_missing_fields']}
                    continue
                assert row['verdict'] == ('failed' if case_name == 'failed' else 'passed')
                assert row['limit'] == pytest.approx(limit) and row['unit'] == '1'
                assert row['basis'] == 'measurement'
                reference = row['basis_reference']
                assert reference['record_id'] == record_id
                assert reference['record']['value'] == original_value
                assert reference['record']['quantity']['unit'] == original_unit
                assert reference['plugin_version'] == '0.9.1'
                assert reference['record']['verification']['status'] == 'verified'
                actual_source = inputs['provenance'][manufacturing_field(role, name)]
                assert row['engineering_sources'][manufacturing_field(role, name)] == actual_source
                assert row['actual'] == json.loads(actual_source['reference'])['value']
                assert row['input_source']['reviewed'] is False
            assert item(checked, 'ehv-coverings')['verdict'] == 'uncovered'
            assert 'GB/T3880.1' in item(checked, 'ehv-coverings')['reason']
            assert item(checked, 'ehv-type-tests')['verdict'] == 'uncovered'
            assert checked['conclusion'] == ('not_satisfied' if case_name == 'failed' else 'incomplete')
        for case_name, _ in cases[4:]:
            output = outputs[case_name]
            assert output.status == 'not_applicable' and not output.artifacts
            assert output.error['code'] == 'STANDARD_INPUT_INVALID'
            assert '标准来源不能' in output.error['message']
        from cablesim_standard_check.basis import BasisIntegrityError, digest
        passed = plugin.check(document, parameters)
        for key, *_ in MANUFACTURING_LIMITS:
            changed = deepcopy(parameters)
            reference = changed['basis_references'][item(passed, key)['id']]
            reference['record']['value'] = 0
            reference['record_sha256'] = digest({k: v for k, v in reference['record'].items()
                                                if k not in ('record_sha256', 'citation')})
            with pytest.raises(BasisIntegrityError, match='封签'):
                plugin.check(document, changed)


@pytest.mark.parametrize('change,keys,verdict', [
    ('material_missing', [0, 1], 'missing'), ('lead', [0, 1], 'uncovered'),
    ('form_missing', [0, 1], 'missing'), ('smooth', [0, 1], 'uncovered'),
    ('construction_missing', [2], 'missing'), ('other_construction', [2], 'uncovered'),
    ('outer_missing', [2], 'missing'),
    ('compound_missing', [2], 'missing'), ('other_compound', [2], 'uncovered'),
    ('insulation', [0, 1, 2], 'uncovered'), ('conductor', [0, 1, 2], 'uncovered'),
    ('area', [0, 1, 2], 'uncovered'),
])
def test_220kv_manufacturing_scope_never_infers_missing_conditions(change, keys, verdict):
    from cablesim_standard_check.basis import digest
    document = manufacturing_design()
    cable = document['cable_types'][0]
    sheath = next(layer for layer in cable['common_layers'] if layer['role'] == 'metallic_sheath')
    material = next(value for value in document['materials'] if value['id'] == sheath['material'])
    if change in ('material_missing', 'lead'):
        material['standard_kind'] = None if change == 'material_missing' else 'lead'
    elif change in ('form_missing', 'smooth'):
        sheath['form'] = None if change == 'form_missing' else 'smooth'
    elif change == 'construction_missing':
        document['provenance'].pop(manufacturing_field('oversheath', 'bonded_extruded_oversheath_layer'))
    elif change == 'other_construction':
        manufacturing_input(document, 'oversheath', 'bonded_extruded_oversheath_layer', False)
    elif change == 'outer_missing':
        cable['common_layers'] = [layer for layer in cable['common_layers'] if layer['role'] != 'oversheath']
    elif change == 'compound_missing':
        document['provenance'].pop(manufacturing_field('oversheath', 'sheath_compound'))
    elif change == 'other_compound':
        manufacturing_input(document, 'oversheath', 'sheath_compound', 'ST1')
    elif change == 'insulation':
        next(value for value in document['materials'] if value['id'] == 'material/xlpe')['standard_kind'] = 'EPR'
    elif change == 'conductor':
        document['materials'][0]['standard_kind'] = 'aluminium'
    else:
        cable['cores'][0]['conductor']['nominal_area'] = 1100e-6
    checked = plugin.check(document, {'cable_type_id': cable['id'],
        'basis_cable_sha256': digest(cable), 'basis_references': {}})
    for index in keys:
        row = item(checked, MANUFACTURING_LIMITS[index][0])
        assert row['verdict'] == verdict and row['limit'] is None
        if change == 'area':
            assert library_module.BasisLibrary().query(row['basis_query'])['status'] == 'not_covered'
        else:
            assert row['basis_query'] is None


def test_220kv_manufacturing_queries_cover_st2_and_alloy_without_claiming_full_compliance():
    document = manufacturing_design()
    next(value for value in document['materials'] if value['id'] == 'material/al')['standard_kind'] = 'aluminium_alloy'
    manufacturing_input(document, 'oversheath', 'sheath_compound', 'ST2')
    checked = plugin.check(document, {'cable_type_id': document['cable_types'][0]['id']})
    for key, _, _, _, record_id, *_ in MANUFACTURING_LIMITS:
        row = item(checked, key)
        answer = library_module.BasisLibrary().query(row['basis_query'])
        assert answer['status'] == 'resolved' and answer['records'][0]['id'] == record_id
        assert row['limit'] is None  # A query alone is not an installed receipt or a verdict.


@pytest.mark.parametrize('index,value,unit,reference', [
    (0, 99.5, '1', '百分数未换算'), (0, True, '1', '布尔值不是纯度'),
    (1, 16, '%', '来源单位仍为百分数'), (2, 1.01, '1', '厚度比超过整体'),
    (2, .15, '1', ''),
])
def test_220kv_manufacturing_requires_finite_si_values_and_a_source(index, value, unit, reference):
    document = manufacturing_design()
    _, role, name, *_ = MANUFACTURING_LIMITS[index]
    path = manufacturing_field(role, name)
    receipt = json.loads(document['provenance'][path]['reference'])
    receipt.update(value=value, unit=unit, reference=reference)
    document['provenance'][path]['reference'] = json.dumps(receipt)
    with pytest.raises(ValueError, match='单位和出处|适用范围'):
        plugin.check(document, {'cable_type_id': document['cable_types'][0]['id']})


def test_live_220kv_standard_proposal_reuses_table3_with_stated_diameter(tmp_path):
    with TestClient(create_app(tmp_path / 'proposal.sqlite')) as client:
        values = {'schema_version': 'cablesim.cable-design-request/1', 'construction': 'single_core',
                  'voltage': '127000/220000', 'conductor': 'copper_bare', 'area_m2': 2200e-6,
                  'form': 'unspecified', 'diameter_m': .06}
        response = client.post('/api/types/creation-proposals', json={'request_id': str(uuid4()), 'input': values})
        assert response.status_code == 200, response.text
        proposal = response.json()
        row = proposal['rows'][0]
        assert row['value'] == pytest.approx(.024)
        assert (row['source']['record']['standard'], row['source']['record']['table']) == ('GB/T 18890.2', '表 3')
        conductor = proposal['document']['cable_types'][0]['cores'][0]['conductor']
        assert conductor['diameter'] == .06 and conductor['form'] == 'unspecified'
        assert conductor.get('r20') is None and conductor.get('wire_count') is None
        for change, phrase in [({'generation_mode': 'complete'}, '完整高压结构'),
                               ({'form': 'solid_round'}, '不能按实心'),
                               ({'conductor': 'aluminium'}, '铝'),
                               ({'area_m2': 1100e-6}, '未收录')]:
            rejected = client.post('/api/types/creation-proposals', json={
                'request_id': str(uuid4()), 'input': {**values, **change}})
            assert rejected.status_code == 422, rejected.text
            assert phrase in rejected.text
        assert client.get('/api/types/library').json()['items'] == []
