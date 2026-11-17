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
        assert {ref['plugin_version'] for ref in references.values()} == {'0.9.0'}

        def execute(document, parameters):
            result = app.state.research.executor.run('cablesim.standard-check', 'dimensions', [
                {'case_id': 'extra-high', 'input': document, 'parameters': parameters}])
            assert result.cases[0].status == 'succeeded', result.cases[0].error
            assert result.plugin_version == result.method_version == '1.8.0'
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
