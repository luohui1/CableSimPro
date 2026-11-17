"""Real Qifan reference-layer mapping and explicit missing-data boundaries.

The LV test is a labelled schema fixture. It is not a manufacturer comparison or
an engineering validation of those dimensions; the HV test preserves the stored
public reference's distinction between factory data and engineering assumptions.
"""
from copy import deepcopy
import csv
from io import BytesIO, StringIO
import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from backend.kernel.stated_single_core import METHOD, build
from backend.kernel import factory_tables
from backend.domain.guards import pointer, value_at
from backend.main import create_app


ROOT = Path(__file__).resolve().parents[1]
UNITS = {'temperature_coefficient_20': '1/K', 'thermal_resistivity': 'K.m/W',
         'electrical_resistivity_20': 'ohm.m', 'relative_permittivity': '1', 'loss_tangent': '1'}


def qifan():
    original = json.loads((ROOT / 'backend/kernel/model_series_data/qifan_yjlw03.json').read_text('utf-8'))
    cable = original['model']['cable_type']
    materials = {item['id']: item for item in original['model']['materials']}
    series = {'name': original['name'], 'manufacturer': '起帆（公开转载）', 'designation': 'YJLW03',
              'cores': 1, 'u0_v': 64000, 'u_v': 110000, 'um_v': None,
              'source': original['sources'], 'resistance_basis': 'stated',
              'material_properties': {}, 'modelling': {
                  'conductor_form': {'value': cable['cores'][0]['conductor']['form'], 'unit': '1',
                                     'reference': original['sources']['factory']['reference']},
                  'normal_temperature_k': {'value': cable['rating']['max_conductor_temperature']['normal'], 'unit': 'K',
                                          'reference': '仓库起帆参考模型中明确声明的运行温限；' + original['sources']['factory']['reference']}}}
    parts = {'conductor': 'copper', 'insulation': 'XLPE', 'sheath': 'PE',
             'metal_sheath': 'corrugated_aluminium', 'armour': None}
    roles = {'material/cu': 'conductor', 'material/semi': 'conductor_screen',
             'material/insulation-qifan': 'insulation', 'material/buffer-qifan': 'buffer',
             'material/al-qifan': 'metallic_sheath', 'material/bitumen-qifan': 'separator',
             'material/pe-qifan': 'oversheath'}
    for identifier, role in roles.items():
        reference = original['sources']['buffer_reference' if role == 'buffer' else 'standard']['reference']
        series['material_properties'][role] = {key: {'value': value, 'unit': UNITS[key], 'reference': reference}
            for key, value in materials[identifier].items() if key in UNITS}
    series['material_properties']['insulation_screen'] = deepcopy(series['material_properties']['conductor_screen'])
    facts = []
    def add(key, value, unit, source):
        facts.append({'key': key, 'value': value, 'unit': unit, 'source': deepcopy(source)})
    conductor = cable['cores'][0]['conductor']
    for key, field, unit in [('area', 'nominal_area', 'm2'), ('conductor_diameter', 'diameter', 'm'), ('r20', 'r20', 'ohm/m')]:
        add(key, conductor[field], unit, original['sources']['factory'])
    add('outer_diameter', original['manufacturer_values']['outer_diameter_m'], 'm', original['sources']['factory'])
    for layer in cable['cores'][0]['layers']:
        role = 'buffer' if layer['role'] == 'bedding' else layer['role']
        add(role + '_thickness', layer['thickness'], 'm', original['sources']['installed_dimensions'])
        for key in ('corrugation_depth', 'corrugation_pitch'):
            if key in layer:
                add(key, layer[key], 'm', original['sources']['geometry_reference'])
    return original, series, parts, facts


def test_qifan_real_public_reference_diameter_chain_and_separate_assumptions():
    original, series, parts, facts = qifan()
    result = build(series, parts, series['name'], facts)
    assert result['missing'] == result['issues'] == [], result
    payload = result['payload']
    assert payload and payload['confirmed'] is False
    assert result['derivation']['method'] == METHOD
    assert result['closure']['declared_mm'] == pytest.approx(100.6)
    assert result['closure']['listed_mm'] == pytest.approx(100.6)
    assert result['closure']['residual_mm'] == pytest.approx(0, abs=1e-10)
    assert result['closure']['residual_added_to_model'] is False
    conductor = payload['cable_type']['cores'][0]['conductor']
    assert conductor['diameter'] == .034 and conductor['r20'] == .0000221
    assert conductor['r20_basis'] == 'manufacturer_limit'
    layers = payload['cable_type']['cores'][0]['layers']
    assert [(layer['role'], layer['thickness']) for layer in layers] == [
        (layer['role'], layer['thickness']) for layer in original['model']['cable_type']['cores'][0]['layers']]
    metal = next(layer for layer in layers if layer['role'] == 'metallic_sheath')
    assert metal['form'] == 'corrugated' and metal['corrugation_depth'] == .004 and metal['corrugation_pitch'] == .025
    assert metal['longitudinal_r20'] is None
    reference = payload['sources']['/cable_type/cores/core~1imported/layers/metallic_sheath/corrugation_depth']
    assert reference['kind'] == 'user' and '不是起帆实测' in reference['reference']
    assert all(not source['reviewed'] for source in payload['sources'].values())
    assert any('密度' in warning for warning in result['warnings'])
    assert all(material['density'] is None for material in payload['materials'])


def test_lv_declared_schema_fixture_has_no_inferred_semiconductors_or_metal():
    _, series, parts, facts = qifan()
    series.update(name='LV 结构接口夹具（非厂家产品）', designation='YJV', u0_v=600, u_v=1000)
    series['source'] = {'reference': '测试接口夹具；不用于工程或产品偏差验证。'}
    parts.update(metal_sheath=None, sheath='PVC')
    series['material_properties'] = {role: props for role, props in series['material_properties'].items()
                                     if role in ('conductor', 'insulation', 'oversheath')}
    facts = [fact for fact in facts if fact['key'] in ('area', 'conductor_diameter', 'r20', 'insulation_thickness', 'oversheath_thickness', 'outer_diameter')]
    values = {fact['key']: fact['value'] for fact in facts}
    for fact in facts:
        fact['source'] = {'kind': 'user', 'reference': '测试接口夹具；非工程数值。'}
        if fact['key'] == 'outer_diameter':
            fact['value'] = values['conductor_diameter'] + 2 * (values['insulation_thickness'] + values['oversheath_thickness'])
    result = build(series, parts, series['name'], facts)
    assert result['missing'] == result['issues'] == [], result
    assert [layer['role'] for layer in result['payload']['cable_type']['cores'][0]['layers']] == ['insulation', 'oversheath']
    assert result['payload']['cable_type']['rating']['max_conductor_temperature'] == {'normal': 363.15}
    assert result['payload']['cable_type']['rating']['um'] is None


@pytest.mark.parametrize('case', ['temperature', 'property', 'unit', 'corrugation'])
def test_missing_value_or_unit_never_uses_a_neighbouring_voltage_default(case):
    _, series, parts, facts = qifan()
    if case == 'temperature':
        series['modelling'].pop('normal_temperature_k')
    elif case == 'property':
        series['material_properties']['insulation'].pop('loss_tangent')
    elif case == 'unit':
        series['material_properties']['conductor']['temperature_coefficient_20']['unit'] = None
    else:
        facts = [fact for fact in facts if fact['key'] != 'corrugation_pitch']
    result = build(series, parts, series['name'], facts)
    assert result['payload'] is None and result['missing']
    assert result['closure'] is None


def test_geometry_mismatch_is_reported_without_residual_filler():
    _, series, parts, facts = qifan()
    next(fact for fact in facts if fact['key'] == 'outer_diameter')['value'] += .002
    result = build(series, parts, series['name'], facts)
    assert result['payload'] is None and result['issues'][0]['field'] == 'outer_diameter'
    assert result['closure']['residual_mm'] == pytest.approx(2)
    assert result['closure']['residual_added_to_model'] is False
    series['modelling']['diameter_rounding'] = {'value': .003, 'unit': 'm',
        'reference': '仅本测试显式给定公差，非新增厂家公差。'}
    result = build(series, parts, series['name'], facts)
    assert result['payload'] is not None
    assert result['closure']['listed_mm'] == pytest.approx(100.6)


def test_unmapped_layers_nonfinite_properties_and_armour_are_not_discarded():
    _, series, parts, facts = qifan()
    facts.append({'key': 'binder_thickness', 'value': .001, 'unit': 'm',
                  'source': {'kind': 'user', 'reference': '测试包带，未声明位置。'}})
    result = build(series, parts, series['name'], facts)
    assert result['payload'] is None and any('binder_thickness' in message for message in result['missing'])
    facts.pop()
    series['material_properties']['conductor']['temperature_coefficient_20']['value'] = float('nan')
    result = build(series, parts, series['name'], facts)
    assert result['payload'] is None and result['issues']
    parts['armour'] = {'kind': 'steel_tape'}
    result = build(series, parts, series['name'], facts)
    assert result['payload'] is None and '铠装' in result['missing'][0]


@pytest.fixture(scope='module')
def client(tmp_path_factory):
    with TestClient(create_app(tmp_path_factory.mktemp('single-core-api') / 'library.sqlite')) as client:
        yield client


def import_table(client, series, row, format):
    keys = list(row)
    grid = [[factory_tables.FIELDS[key][0] for key in keys], [row[key] for key in keys]]
    if format == 'xlsx':
        workbook = Workbook()
        workbook.active.title = '结构表'
        for values in grid:
            workbook.active.append(values)
        data = BytesIO()
        workbook.save(data)
        raw = data.getvalue()
    else:
        data = StringIO()
        csv.writer(data).writerows(grid)
        raw = data.getvalue().encode('utf-8-sig')
    uploaded = client.post('/api/type-library/imports/upload', files={'file': ('reference.' + format, raw)})
    assert uploaded.status_code == 201, uploaded.text
    upload = uploaded.json()
    preview = client.post('/api/type-library/imports/preview', json={
        'upload_id': upload['upload_id'], 'sheet': upload['sheets'][0]['name'], 'first_data_row': 2,
        'mapping': {key: index for index, key in enumerate(keys)}, 'series': series})
    assert preview.status_code == 200, preview.text
    preview = preview.json()
    assert preview['error_count'] == 0, preview
    response = client.post('/api/type-library/imports/commit', json={
        'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'],
        'request_id': str(uuid4()), 'human_confirmed': True}, headers={'X-CableSim-Actor': 'human'})
    assert response.status_code == 201, response.text
    committed = response.json()
    workspace = client.get('/api/workspaces/' + committed['specs'][0]['workspace_id'])
    assert workspace.status_code == 200, workspace.text
    return upload, preview, committed, workspace.json()


def qifan_table_declaration():
    original, series, parts, facts = qifan()
    series.update(conductor=parts['conductor'], insulation=parts['insulation'], oversheath=parts['sheath'],
                  metal_sheath=parts['metal_sheath'], origin='public', common={}, common_basis={})
    row = {}
    factory_fields = {'area', 'conductor_diameter', 'r20', 'outer_diameter', 'metallic_sheath_thickness'}
    for fact in facts:
        value = fact['value'] / factory_tables.FIELDS[fact['key']][2]
        if fact['key'] in factory_fields:
            row[fact['key']] = value
        else:
            series['common'][fact['key']] = value
            series['common_basis'][fact['key']] = fact['source']['reference']
    return original, series, row


def test_catalogue_results_do_not_change_a_complete_stated_structure():
    """Boundary fixture only: added performance is not attributed to the Qifan design."""
    from backend.kernel.type_import_models import build_rows
    from backend.kernel.public_catalogues import _data
    _, series, physical = qifan_table_declaration()
    series.update(name='完整结构与目录性能隔离接口夹具', manufacturer='接口测试（非厂家产品）', origin='demo',
                  source={'reference': '完整起帆参考结构加独立 Bahra 目录列，仅验证输入隔离，不构成该结构的性能声明。'})
    data = _data('bahra-mv')
    published = dict(zip((key for key, _ in data['columns']), data['rows'][0]))
    performance = {key: published['rating_ground_trefoil' if key == 'ampacity' else key] for key in (
        'ampacity', 'r_ac_90', 'inductance', 'capacitance', 'short_circuit_conductor', 'short_circuit_sheath',
        'rating_ground_flat', 'rating_air_trefoil', 'rating_air_flat', 'voltage_drop', 'minimum_bending_radius')}
    series['reference'] = {'conditions': data['conditions'], 'source': data['source']}

    def preview(values):
        stream = StringIO()
        writer = csv.writer(stream)
        writer.writerow(values)
        writer.writerow(values.values())
        upload = factory_tables.read('isolation.csv', stream.getvalue().encode('utf-8-sig'))
        mapping = {key: index for index, key in enumerate(values)}
        rows, skipped = factory_tables.mapped_rows(upload, 'isolation', 2, mapping)
        assert not skipped
        return build_rows(upload, 'isolation', rows, series, mapping)[0]

    baseline, actual = preview(physical), preview({**physical, **performance})
    assert baseline['status'] == actual['status'] == 'ready'
    assert actual['missing'] == actual['issues'] == []
    assert actual['payload']['specification'] is None
    assert actual['payload']['cable_type'] == baseline['payload']['cable_type']
    assert actual['payload']['materials'] == baseline['payload']['materials']
    facts = {fact['key']: fact for fact in actual['values']}
    for key, value in performance.items():
        assert facts[key]['display_value'] == value and facts[key]['usage'] == 'catalogue_result'
        source = actual['payload']['sources'][key]
        assert source['kind'] == 'demo' and source['reviewed'] is False
        assert json.loads(source['reference']) == facts[key]['source']
        assert facts[key]['source']['conditions'] == data['conditions']


@pytest.mark.parametrize('format', ['xlsx', 'csv'])
def test_actual_upload_preview_commit_of_qifan_reference_keeps_stable_sources(client, format):
    original, series, row = qifan_table_declaration()
    series['name'] += ' · ' + format
    _, preview, committed, workspace = import_table(client, series, row, format)
    imported = preview['rows'][0]
    assert imported['status'] == 'ready' and imported['missing'] == []
    assert imported['closure']['listed_mm'] == pytest.approx(100.6)
    document = workspace['domain']
    cable = document['cable_types'][0]
    assert cable['rating']['u0'] == 64000 and cable['rating']['u'] == 110000
    assert cable['cores'][0]['conductor']['r20'] == pytest.approx(.0000221, rel=1e-12)
    path = pointer('cable_types', cable['id'], 'cores', cable['cores'][0]['id'], 'layers', 'metallic_sheath', 'corrugation_depth')
    assert value_at(document, path) == .004
    assert document['provenance'][path]['kind'] == 'user'
    assert '不是起帆实测' in document['provenance'][path]['reference']
    material = next(item for item in document['materials'] if item['category'] == 'insulation')
    path = pointer('materials', material['id'], 'loss_tangent')
    assert value_at(document, path) == .001
    assert 'IEC 60287' in document['provenance'][path]['reference']
    assert all(not source['reviewed'] for source in document['provenance'].values())
    detail = client.get('/api/type-library/series/' + committed['series_id']).json()
    assert detail['specs'][0]['workspace_id'] == workspace['id']
    assert detail['specs'][0]['state'] == 'draft' and detail['specs'][0]['results'] == []


def test_220kv_explicit_test_declaration_is_saved_without_110kv_or_material_defaults(client):
    _, series, row = qifan_table_declaration()
    note = '接口试验输入；仅验证 127/220 kV 声明原样保存，不声称这些尺寸或物性适用于任何 220 kV 产品。'
    series.update(name='127/220 kV 单芯接口试验', manufacturer='接口试验（非厂家产品）',
                  u0_v=127000, u_v=220000, um_v=252000, origin='demo', source={'reference': note})
    series['common_basis'] = {key: note for key in series['common']}
    for parameter in series['modelling'].values():
        parameter['reference'] = note
    for properties in series['material_properties'].values():
        for parameter in properties.values():
            parameter['reference'] = note
    _, preview, _, workspace = import_table(client, series, row, 'xlsx')
    assert preview['rows'][0]['status'] == 'ready'
    cable = workspace['domain']['cable_types'][0]
    assert (cable['rating']['u0'], cable['rating']['u'], cable['rating']['um']) == (127000, 220000, 252000)
    assert cable['cores'][0]['layers'][1]['thickness'] == .0162
    assert any(source['kind'] == 'demo' for source in workspace['domain']['provenance'].values())
    assert workspace['type_origin_reference']['declared_specification'] is None


def test_four_core_lv_incomplete_table_saves_without_guessed_coordinates(client):
    series = {'name': '四芯低压缺项接口试验', 'manufacturer': '接口试验（非厂家产品）', 'designation': 'YJV',
              'cores': 4, 'u0_v': 600, 'u_v': 1000, 'origin': 'demo',
              'source': {'reference': '只验证缺项资料保存，不代表厂家实物。'}}
    _, preview, committed, workspace = import_table(client, series, {'area': 35, 'outer_diameter': 26}, 'csv')
    assert preview['rows'][0]['status'] == 'incomplete' and preview['rows'][0]['missing']
    document = workspace['domain']
    assert document['schema_version'] == 'cablesim.type-draft/2'
    cable = document['cable_types'][0]
    assert cable['construction'] == 'multi_core' and len(cable['cores']) == 4
    assert cable['rating']['max_conductor_temperature'] == {}
    for core in cable['cores']:
        assert core['x'] is None and core['z'] is None
        assert core['conductor']['form'] == 'unspecified' and core['conductor']['diameter'] is None
        assert core['conductor']['nominal_area'] == pytest.approx(35e-6)
    assert workspace['type_origin_reference']['declared_specification']['values']['outer_diameter']['value'] == pytest.approx(.026, rel=1e-12)
    assert client.get('/api/type-library/series/' + committed['series_id']).json()['specs'][0]['state'] == 'draft'
