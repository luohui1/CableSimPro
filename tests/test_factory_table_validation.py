"""Real public cells with explicit invalid edits exercise the import boundary.

The edited copy is an error-injection fixture, never manufacturer data or a
computed engineering result. Unchanged rows retain their original values.
"""
from copy import deepcopy
import csv
import struct
from hashlib import sha256
from io import StringIO
from uuid import uuid4

from fastapi.testclient import TestClient
from openpyxl.utils import get_column_letter
import pytest

from backend.kernel.public_catalogues import sample_bytes, sample_manifest
from backend.kernel.factory_tables import mapped_rows, read
from backend.main import create_app


def biff_table(*, formula):
    """A real BIFF8 stream tests the legacy reader, not an xlrd mock.

    The formula intentionally has a plausible stale cached diameter of 82 mm.
    This parser fixture is not a manufacturer document or engineering evidence.
    """
    def record(code, payload):
        return struct.pack('<HH', code, len(payload)) + payload

    def bof(kind):
        return record(0x0809, struct.pack('<HHHHII', 0x0600, kind, 0x0DBB, 1997, 0, 6))

    def label(column, value):
        return record(0x0204, struct.pack('<HHHHB', 0, column, 0, len(value), 0) + value.encode('ascii'))

    def number(column, value):
        return record(0x0203, struct.pack('<HHHd', 1, column, 0, value))

    def boundsheet(offset):
        return record(0x0085, struct.pack('<IBBBB', offset, 0, 0, 5, 0) + b'Cable')

    end = record(0x000A, b'')
    globals_length = len(bof(5) + boundsheet(0) + end)
    diameter = (record(0x0006, struct.pack('<HHHdHIH', 1, 1, 0, 82., 0, 0, 7)
                       + b'\x1e\x01\x00\x1e\x01\x00\x03') if formula else number(1, 82))
    return (bof(5) + boundsheet(globals_length) + end + bof(0x10)
            + label(0, 'Area') + label(1, 'Diameter') + number(0, 240) + diameter + end)


@pytest.mark.parametrize('formula', [False, True])
def test_legacy_xls_does_not_turn_a_formula_cache_into_source_data(tmp_path, formula):
    import xlrd

    content = biff_table(formula=formula)
    # Both cases look identical through xlrd's normal cell API, which is why
    # checking the value returned by that API cannot protect the import.
    book = xlrd.open_workbook(file_contents=content)
    assert book.sheet_by_index(0).cell_value(1, 1) == 82
    with TestClient(create_app(tmp_path / 'xls.sqlite')) as client:
        response = client.post('/api/type-library/imports/upload', files={'file': ('source.xls', content)})
        if formula:
            assert response.status_code == 422, response.text
            assert response.json()['detail']['code'] == 'TABLE_XLS_FORMULA'
            assert 'B2' in response.json()['detail']['message'] and '缓存值' in response.text
            assert client.get('/api/type-library/series').json() == {'items': []}
        else:
            assert response.status_code == 201, response.text
            assert response.json()['sheets'][0]['rows'] == 2


def test_text_comma_is_not_guessed_as_decimal_or_thousands_separator():
    source = read('ambiguous.csv', b'Area,Diameter\n"1,000",82\n240,82\n')
    rows, skipped = mapped_rows(source, 'ambiguous', 2, {'area': 0, 'outer_diameter': 1})
    assert skipped == []
    assert rows[0]['raw']['area'] == '1,000'
    assert 'area' not in rows[0]['values']
    assert rows[0]['issues'][0]['column'] == 'A2'
    assert rows[1]['values']['area'] == 240 and rows[1]['issues'] == []


def public_table_request(client, *, corrupt=False):
    sample = next(item for item in sample_manifest() if item['id'] == 'people-mv')
    declaration = deepcopy(next(item for item in sample['declarations'] if item['table'] == 'three-core'))
    grid = list(csv.reader(StringIO(sample_bytes('people-mv', 'csv', 'three-core').decode('utf-8-sig'))))[:4]
    mapping = declaration['mapping']
    if corrupt:
        grid[1][mapping['area']] = '20000'
        grid[2][mapping['outer_diameter']] = '2000'
    buffer = StringIO()
    csv.writer(buffer).writerows(grid)
    content = buffer.getvalue().encode('utf-8-sig')
    response = client.post('/api/type-library/imports/upload', files={'file': ('public-errors.csv', content)})
    assert response.status_code == 201, response.text
    uploaded = response.json()
    series = declaration['series']
    series.update(name='公开样本逐行错误定位 · ' + str(uuid4()), common={}, common_basis={}, modelling={},
                  resistance_basis='stated', standards=[])
    if corrupt:
        series.update(origin='demo', manufacturer='公开样本错误注入副本（非厂家产品）')
        series['reference']['test_only'] = '仅前两行分别注入超限截面和外径；不作为厂家数据或工程结果。'
    return {'upload_id': uploaded['upload_id'], 'sheet': uploaded['sheets'][0]['name'],
            'first_data_row': 2, 'mapping': mapping, 'series': series}, content, grid


def test_model_validation_failure_marks_exact_cells_and_keeps_valid_rows(tmp_path):
    with TestClient(create_app(tmp_path / 'validation.sqlite')) as client:
        request, content, grid = public_table_request(client, corrupt=True)
        response = client.post('/api/type-library/imports/preview', json=request)
        assert response.status_code == 200, response.text
        preview = response.json()
        assert (preview['error_count'], preview['valid_count'], preview['incomplete_count']) == (2, 1, 1)
        for index, field in [(0, 'area'), (1, 'outer_diameter')]:
            row = preview['rows'][index]
            assert row['status'] == 'error' and row['payload'] is None
            expected_cell = f'{get_column_letter(request["mapping"][field] + 1)}{index + 2}'
            issue = next(item for item in row['issues'] if item['field'] == field)
            assert issue['column'] == expected_cell and issue['code'] == 'TABLE_MODEL_INVALID'
            assert 'ValidationError' not in issue['message'] and 'traceback' not in issue['message'].lower()
            fact = next(item for item in row['values'] if item['key'] == field)
            assert fact['display_value'] == float(grid[index + 1][request['mapping'][field]])
            assert fact['source']['row'] == index + 2 and fact['source']['file_sha256'] == sha256(content).hexdigest()
        assert '10000 mm²' in preview['rows'][0]['issues'][0]['message']
        assert '20000 mm²' in preview['rows'][0]['issues'][0]['message']

        body = {'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'],
                'request_id': str(uuid4()), 'human_confirmed': True}
        denied = client.post('/api/type-library/imports/commit', json=body, headers={'X-CableSim-Actor': 'human'})
        assert denied.status_code == 422, denied.text
        assert client.get('/api/type-library/series').json() == {'items': []}
        saved = client.post('/api/type-library/imports/commit', json={**body, 'skip_errors': True},
                            headers={'X-CableSim-Actor': 'human'})
        assert saved.status_code == 201, saved.text
        receipt = saved.json()
        assert receipt['created'] == 1 and receipt['skipped_rows'] == [2, 3]
        actual = client.get('/api/type-library/specs/' + receipt['specs'][0]['id']).json()
        assert actual['values'] == preview['rows'][2]['values']
        assert actual['spec']['state'] == 'draft'
        assert len(client.get('/api/domain-cable-models').json()) == 1


@pytest.mark.parametrize('cores', [0, 17, True])
def test_unsupported_core_count_is_rejected_at_preview_field(tmp_path, cores):
    with TestClient(create_app(tmp_path / f'cores-{cores}.sqlite')) as client:
        request, _, _ = public_table_request(client)
        request['series']['cores'] = cores
        response = client.post('/api/type-library/imports/preview', json=request)
        assert response.status_code == 422, response.text
        problem = next(item for item in response.json()['detail'] if item['loc'] == ['body', 'series', 'cores'])
        assert '1 至 16 的整数' in problem['msg'] and '不补造几何' in problem['msg']
        assert client.get('/api/type-library/series').json() == {'items': []}
        assert client.get('/api/domain-cable-models').json() == []


@pytest.mark.parametrize('cores', [2, 5, 16])
def test_multi_core_incomplete_table_opens_as_draft_and_refuses_calculation(tmp_path, cores):
    """Use the existing labelled LV interface fixture, not invented factory data."""
    with TestClient(create_app(tmp_path / f'multi-{cores}.sqlite')) as client:
        response = client.post('/api/type-library/imports/upload', files={
            'file': ('schema-fixture.csv', '标称截面,电缆近似外径\n35,26\n'.encode('utf-8-sig'))})
        assert response.status_code == 201, response.text
        upload = response.json()
        response = client.post('/api/type-library/imports/preview', json={
            'upload_id': upload['upload_id'], 'sheet': upload['sheets'][0]['name'], 'first_data_row': 2,
            'mapping': {'area': 0, 'outer_diameter': 1},
            'series': {'name': f'{cores}芯低压缺项接口试验', 'manufacturer': '接口试验（非厂家产品）',
                       'designation': 'YJV', 'cores': cores, 'u0_v': 600, 'u_v': 1000, 'origin': 'demo',
                       'source': {'reference': '沿用四芯缺项接口夹具；只验证资料保存，非厂家实物或工程计算。'}}})
        assert response.status_code == 200, response.text
        preview = response.json()
        assert preview['error_count'] == 0 and preview['incomplete_count'] == 1
        assert preview['rows'][0]['payload']['specification']['cores'] == cores
        saved = client.post('/api/type-library/imports/commit', json={
            'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'],
            'request_id': str(uuid4()), 'human_confirmed': True}, headers={'X-CableSim-Actor': 'human'})
        assert saved.status_code == 201, saved.text
        receipt = saved.json()
        spec = client.get('/api/type-library/specs/' + receipt['specs'][0]['id']).json()['spec']
        workspace = client.get('/api/workspaces/' + spec['workspace_id'])
        assert workspace.status_code == 200, workspace.text
        document = workspace.json()['domain']
        assert document['schema_version'] == 'cablesim.type-draft/2'
        cable = document['cable_types'][0]
        assert cable['construction'] == 'multi_core' and len(cable['cores']) == cores
        assert len({core['id'] for core in cable['cores']}) == cores
        assert cable['rating']['max_conductor_temperature'] == {}
        for core in cable['cores']:
            assert core['x'] is None and core['z'] is None
            assert core['conductor']['nominal_area'] == pytest.approx(35e-6)
            assert core['conductor']['diameter'] is None and core['conductor']['form'] == 'unspecified'
            assert core['layers'][0]['thickness'] is None
        batch = client.post('/api/type-library/series/' + receipt['series_id'] + '/batch', json={
            'request_id': str(uuid4()), 'operation': 'calculate', 'spec_ids': [spec['id']],
            'expected_versions': {spec['id']: spec['version']},
            'expected_revisions': {spec['id']: spec['workspace_revision']},
            'human_confirmed': True, 'scope_acknowledged': True}, headers={'X-CableSim-Actor': 'human'})
        assert batch.status_code == 200, batch.text
        refusal = batch.json()['items'][0]
        assert refusal['status'] == 'failed' and refusal['detail']['code'] == 'TYPE_DATA_INCOMPLETE'
        assert 'run_id' not in refusal and '结构或材料数据缺项' in refusal['message']
        assert client.get('/api/type-library/specs/' + spec['id']).json()['spec']['results'] == []
