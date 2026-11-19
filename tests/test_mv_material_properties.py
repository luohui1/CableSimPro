"""Real catalogue import retains explicitly selected material references.

These declarations select existing sealed literature/standard records for a
test draft. They are not new manufacturer facts or changes to the release seed.
The unmodified public workbook and real sealed MV constructor remain in use.
"""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from backend.domain.guards import pointer
from backend.kernel.factory_tables import mapped_rows, read
from backend.kernel.public_catalogues import sample_bytes, sample_manifest
from backend.kernel.type_import_models import SeriesDeclaration, build_rows
from backend.kernel.workspace import fingerprint
from backend.main import create_app


ROOT = Path(__file__).resolve().parents[1]
HUMAN = {'X-CableSim-Actor': 'human'}


def reference(filename, identifier):
    plugin = ROOT / 'plugins/cablesim.standards-basis'
    path = plugin / 'src/cablesim_standards_basis' / filename
    record = next(item for item in json.loads(path.read_text('utf-8')) if item['id'] == identifier)
    manifest = json.loads((plugin / 'plugin.json').read_text('utf-8'))
    evidence = {key: deepcopy(record[key]) for key in (
        'id', 'standard', 'edition', 'clause', 'table', 'printed_page', 'pdf_page',
        'source_file', 'source_sha256', 'conditions', 'semantic', 'criterion', 'limitations')}
    evidence.update(record_sha256=fingerprint(record), data_sha256=sha256(path.read_bytes()).hexdigest(),
                    plugin_id=manifest['id'], plugin_version=manifest['version'], confidence='reference',
                    scope='回归输入明确选择此参考值及原有适用条件；不是人民电缆实测或发布种子事实。')
    return {'value': record['value'], 'unit': record['quantity']['unit'],
            'reference': json.dumps(evidence, ensure_ascii=False, sort_keys=True)}


@pytest.fixture(scope='module')
def heat_capacity():
    return reference('records-thermal-capacity.json', 'nielsen-Table1/r5/capacity')


@pytest.fixture(scope='module')
def conductor_density():
    return reference('records-thermal-capacity-model.json', 'huang-TableA1/r1/density')


@pytest.fixture(scope='module')
def public_input():
    sample = next(item for item in sample_manifest() if item['id'] == 'people-mv')
    declaration = deepcopy(next(item for item in sample['declarations'] if item['table'] == 'three-core'))
    declaration.pop('table')
    upload = read('people.xlsx', sample_bytes('people-mv'))
    rows, skipped = mapped_rows(upload, declaration['sheet'], declaration['first_data_row'], declaration['mapping'])
    assert skipped == [{'row': 17, 'text': '注：导体外径仅供参考。'}] and len(rows) == 11
    return upload, rows, declaration


def build_first(public_input, properties):
    upload, rows, declaration = public_input
    series = {**deepcopy(declaration['series']), 'material_properties': deepcopy(properties)}
    series = SeriesDeclaration.model_validate(series).model_dump(mode='json')
    return build_rows(upload, declaration['sheet'], rows[:1], series, declaration['mapping'])[0]


def uploaded_request(client):
    response = client.post('/api/type-library/imports/upload',
                           files={'file': ('people.xlsx', sample_bytes('people-mv'))})
    assert response.status_code == 201, response.text
    upload = response.json()
    declaration = deepcopy(next(item for item in upload['declarations'] if item['table'] == 'three-core'))
    declaration.pop('table')
    return {'upload_id': upload['upload_id'], **declaration}


def preview(client, request):
    response = client.post('/api/type-library/imports/preview', json=request)
    assert response.status_code == 200, response.text
    return response.json()


def commit_body(value):
    return {'preview_id': value['preview_id'], 'preview_digest': value['preview_digest'],
            'request_id': str(uuid4()), 'human_confirmed': True}


def assert_declared_source(source, declaration, role, property_name):
    assert source['kind'] == 'user' and source['reviewed'] is False
    record = json.loads(source['reference'])
    assert record['method'] == {'name': '明示材料物性映射', 'version': '1.0.0'}
    assert record['confidence'] == 'reference' and record['reviewed'] is False
    assert (record['role'], record['property']) == (role, property_name)
    assert record['evidence'] == declaration


def test_real_eleven_specifications_keep_explicit_properties_and_role_sources_on_import(
        tmp_path, heat_capacity, conductor_density):
    with TestClient(create_app(tmp_path / 'materials.sqlite')) as client:
        request = uploaded_request(client)
        baseline = preview(client, request)
        assert baseline['valid_count'] == 11 and baseline['error_count'] == baseline['incomplete_count'] == 0
        # The unchanged public declaration still supplies neither material value.
        assert not request['series'].get('material_properties')
        for row in baseline['rows']:
            assert 'material_mapping' not in row['derivation']
            assert all(material['density'] is None and material['volumetric_heat_capacity'] is None
                       for material in row['payload']['materials'])
            assert not any(path.endswith(('/density', '/volumetric_heat_capacity'))
                           for path in row['payload']['sources'])
        request['series']['material_properties'] = {
            'insulation': {'volumetric_heat_capacity': heat_capacity},
            'conductor': {'density': conductor_density},
        }
        value = preview(client, request)
        assert value['valid_count'] == 11 and value['error_count'] == value['incomplete_count'] == 0
        assert value['sha256'] == baseline['sha256'] == sha256(sample_bytes('people-mv')).hexdigest()
        for original, row in zip(baseline['rows'], value['rows']):
            before, after = original['payload'], row['payload']
            assert after['confirmed'] is False
            assert row['closure'] == original['closure']
            assert row['derivation']['plugin_id'] == original['derivation']['plugin_id'] == 'cablesim.iec60287'
            assert row['derivation']['plugin_version'] == original['derivation']['plugin_version']
            assert row['derivation']['manifest_sha256'] == original['derivation']['manifest_sha256']
            materials = {item['id']: item for item in after['materials']}
            old_materials = {item['id']: item for item in before['materials']}
            conductor_id = after['cable_type']['cores'][0]['conductor']['material']
            assert conductor_id != 'material/cu'
            assert materials[conductor_id] == {**old_materials['material/cu'], 'id': conductor_id,
                                                'density': conductor_density['value']}
            assert len(materials) == len(old_materials) + 1
            for identifier, material in old_materials.items():
                expected = {**material, 'volumetric_heat_capacity': heat_capacity['value']} if identifier == 'material/xlpe' else material
                assert materials[identifier] == expected
            expected_cable = deepcopy(before['cable_type'])
            for core in expected_cable['cores']:
                core['conductor']['material'] = conductor_id
            assert after['cable_type'] == expected_cable  # Including unchanged screen resistance and all unknowns.
            assert_declared_source(after['sources'][pointer('materials', 'material/xlpe', 'volumetric_heat_capacity')],
                                   heat_capacity, 'insulation', 'volumetric_heat_capacity')
            assert_declared_source(after['sources'][pointer('materials', conductor_id, 'density')],
                                   conductor_density, 'conductor', 'density')
            for core in after['cable_type']['cores']:
                source = after['sources'][pointer('cable_type', 'cores', core['id'], 'conductor', 'material')]
                assert source['kind'] == 'derived' and source['reviewed'] is False
            assert [fact for fact in row['values'] if fact['source']['origin'] != 'standard'] == [
                fact for fact in original['values'] if fact['source']['origin'] != 'standard']

        body = commit_body(value)
        assert client.post('/api/type-library/imports/commit', json=body,
                           headers={'X-CableSim-Actor': 'agent'}).status_code in (403, 409)
        saved = client.post('/api/type-library/imports/commit', json=body, headers=HUMAN)
        assert saved.status_code == 201, saved.text
        receipt = saved.json()
        assert receipt['created'] == 11 and receipt['state'] == 'draft'
        for spec, row in zip(receipt['specs'], value['rows']):
            response = client.get('/api/workspaces/' + spec['workspace_id'])
            assert response.status_code == 200, response.text
            document = response.json()['domain']
            assert document['materials'] == row['payload']['materials']
            assert document['cable_types'] == [row['payload']['cable_type']]
            for path, source in row['payload']['sources'].items():
                if path.startswith('/materials/'):
                    assert document['provenance'][path] == source
            core = document['cable_types'][0]['cores'][0]
            link = pointer('cable_types', document['cable_types'][0]['id'], 'cores', core['id'], 'conductor', 'material')
            assert document['provenance'][link]['reviewed'] is False
            detail = client.get('/api/type-library/specs/' + spec['id']).json()['spec']
            assert detail['state'] == 'draft' and detail['submission'] is None and detail['results'] == []


def test_same_existing_value_adds_exact_source_without_changing_material_or_structure(public_input):
    declared = reference('records-electrical.json', 'iec60287-1-1-table3/r15/tan_delta')
    baseline = build_first(public_input, {})
    result = build_first(public_input, {'insulation': {'loss_tangent': declared}})
    assert baseline['status'] == result['status'] == 'ready'
    assert result['payload']['materials'] == baseline['payload']['materials']
    assert result['payload']['cable_type'] == baseline['payload']['cable_type']
    assert_declared_source(result['payload']['sources'][pointer('materials', 'material/xlpe', 'loss_tangent')],
                           declared, 'insulation', 'loss_tangent')


def test_conflict_refuses_entire_series_without_saving_other_valid_declarations(tmp_path, heat_capacity):
    # The high-voltage record is an explicit conflict input, never a replacement
    # for this 8.7/15 kV series or evidence of its material conditions.
    conflicting = reference('records-electrical.json', 'iec60287-1-1-table3/r16/tan_delta')
    with TestClient(create_app(tmp_path / 'conflict.sqlite')) as client:
        request = uploaded_request(client)
        request['series']['material_properties'] = {'insulation': {
            'volumetric_heat_capacity': heat_capacity, 'loss_tangent': conflicting}}
        value = preview(client, request)
        assert value['error_count'] == 11 and value['valid_count'] == 0
        for row in value['rows']:
            assert row['status'] == 'error' and row['payload'] is None
            assert any(issue['field'] == 'material_properties.insulation.loss_tangent'
                       and '重新构造' in issue['message'] for issue in row['issues'])
        for skip in (False, True):
            response = client.post('/api/type-library/imports/commit', headers=HUMAN,
                                   json={**commit_body(value), 'skip_errors': skip})
            assert response.status_code == 422, response.text
        assert client.get('/api/type-library/series').json() == {'items': []}
        assert client.get('/api/workspaces').json() == []
        assert client.get('/api/domain-cable-models').json() == []


@pytest.mark.parametrize('change', ['wrong_unit', 'missing_unit', 'negative', 'zero', 'unknown_property', 'unknown_role'])
def test_invalid_declared_material_property_is_a_row_error(public_input, heat_capacity, change):
    prop = deepcopy(heat_capacity)
    role, key = 'insulation', 'volumetric_heat_capacity'
    if change == 'wrong_unit':
        prop['unit'] = 'kg/m3'
    elif change == 'missing_unit':
        prop.pop('unit')
    elif change in ('negative', 'zero'):
        prop['value'] = -1 if change == 'negative' else 0
    elif change == 'unknown_property':
        key = 'unrecognized_heat_capacity'
    else:
        role = 'metallic_sheath'  # The original three-core YJV has no metallic sheath.
    result = build_first(public_input, {role: {key: prop}})
    assert result['status'] == 'error' and result['payload'] is None
    assert any(issue['code'] == 'TABLE_MATERIAL_INVALID' and issue['field'].startswith('material_properties.' + role)
               for issue in result['issues'])


@pytest.mark.parametrize('value', [True, False, '2400000', float('inf'), float('nan')])
def test_material_numbers_are_not_coerced_or_accepted_without_finite_values(public_input, heat_capacity, value):
    series = deepcopy(public_input[2]['series'])
    series['material_properties'] = {'insulation': {'volumetric_heat_capacity': {**heat_capacity, 'value': value}}}
    with pytest.raises(ValidationError):
        SeriesDeclaration.model_validate(series)


def test_material_property_without_source_is_refused(public_input, heat_capacity):
    series = deepcopy(public_input[2]['series'])
    series['material_properties'] = {'insulation': {'volumetric_heat_capacity': {**heat_capacity, 'reference': '   '}}}
    with pytest.raises(ValidationError):
        SeriesDeclaration.model_validate(series)
