"""The distinct 110 kV original table remains sourced and incomplete on import."""
from copy import deepcopy
import csv
from decimal import Decimal
from hashlib import sha256
from io import BytesIO, StringIO
import json
import os
from pathlib import Path
import re
import sqlite3
from uuid import uuid4

from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook
import pytest

from backend.main import create_app


DATA = json.loads((Path(__file__).parent / 'fixtures/tai_i_110kv_catalogue.json').read_text('utf-8'))
CSV_BYTES = (Path(__file__).parent / 'fixtures' / DATA['table_file']).read_bytes()
CSV_ROWS = list(csv.reader(StringIO(CSV_BYTES.decode('utf-8-sig'))))
ROWS = [[row[0], *(float(value) for value in row[1:])] for row in CSV_ROWS[1:]]
HUMAN = {'X-CableSim-Actor': 'human'}
SI = {'area': ('m2', 1e-6), 'conductor_diameter': ('m', .001),
      'insulation_thickness': ('m', .001), 'metallic_sheath_thickness': ('m', .001),
      'oversheath_thickness': ('m', .001), 'outer_diameter': ('m', .001),
      'r20': ('ohm/m', .001), 'weight': ('kg/m', .001)}


def test_tai_i_110kv_original_pdf_matches_its_distinct_table_and_conditions():
    original = os.environ.get('CABLESIM_TAI_I_ORIGINAL')
    if not original:
        pytest.skip('台一官方原PDF未显式提供；不以转录数据代替原文审计。')
    import pdfplumber
    raw = Path(original).read_bytes()
    assert len(raw) == DATA['source']['size_bytes'] == 6940265
    assert sha256(raw).hexdigest() == DATA['source']['sha256'] == '72b21e5d15f5d50a5b30a01c822ca3771bd0cc190cbfa4edd47bf23a948c9cdd'
    with pdfplumber.open(BytesIO(raw)) as pdf:
        assert len(pdf.pages) == 33
        # The preceding spread has a 220 kV table above the 110 kV heading.
        # The 110 kV numerical table is on the next page's lower-left side.
        description = pdf.pages[5].crop((635, 360, 1142, 790)).extract_text()
        for text in ('110 kV', '64/110kV', '126kV', '90℃',
                     'GB 11017', 'IEC 60840', 'Q/WLZ 04.03', 'YJLW02', 'PVC'):
            assert text in description
        assert '大于0℃' in description and '大于15D' in description
        assert '≧0℃' in description and '≧15D' in description
        page = pdf.pages[6]
        assert 'YJLW02(03)' in page.crop((40, 490, 560, 790)).extract_text()
        candidates = [table for table in page.find_tables()
                      if 40 < table.bbox[0] < 45 and 510 < table.bbox[1] < 515
                      and 550 < table.bbox[2] < 560 and 780 < table.bbox[3] < 790]
        assert len(candidates) == 1
        table = candidates[0].extract()
    assert len(table) == 14 and all(len(row) == 10 for row in table)
    assert table[2] == ['kV', 'mm2', 'mm', 'mm', 'mm', 'mm', 'mm', 'mm', 'Ω/km', 'kg/km']
    assert 'Maximum' in table[0][8] and '20℃' in table[0][8]
    assert all('approx.' in table[0][column] for column in (2, 7, 9))
    # This exact extraction has one entirely empty row, not a missing value
    # within a specification. Do not filter rows just because an area is absent.
    assert [index for index, row in enumerate(table) if all(value in (None, '') for value in row)] == [9]
    assert all(value in (None, '') for value in table[9])
    original_rows = table[3:9] + table[10:]
    assert len(original_rows) == len(ROWS) == 10
    assert original_rows[0][0] == '64/110\n(126)'
    assert all(row[0] is None for row in original_rows[1:])
    assert CSV_ROWS[0] == DATA['headers']
    assert [row[1] for row in ROWS] == [240, 300, 400, 500, 630, 800, 1000, 1200, 1400, 1600]
    for original_row, declared in zip(original_rows, ROWS, strict=True):
        assert declared[0] == '64/110 (126)'
        for original_value, number in zip(original_row[1:], declared[1:], strict=True):
            assert re.fullmatch(r'\d+(?:,\d{3})*(?:\.\d+)?', original_value), original_value
            assert Decimal(original_value.replace(',', '')) == Decimal(str(number))
    # 800 mm² is 0.0211 here, independently of the 220 kV table's 0.0221.
    assert original_rows[5][8] == '0.0211'


def _table_bytes(format, rows=None):
    grid = [DATA['headers'], *(ROWS if rows is None else rows)]
    if format == 'xlsx':
        book = Workbook()
        book.active.title = '台一110kV'
        for row in grid:
            book.active.append(row)
        stream = BytesIO()
        book.save(stream)
        book.close()
        return stream.getvalue(), '台一110kV'
    if rows is None:
        return CSV_BYTES, 'tai-i-110kv'
    stream = StringIO()
    csv.writer(stream, lineterminator='\n').writerows(grid)
    return stream.getvalue().encode('utf-8'), 'tai-i-110kv-error'


@pytest.mark.parametrize('format', ['csv', 'xlsx'])
def test_tai_i_110kv_original_table_upload_preview_commit_and_bad_cell(tmp_path, format):
    raw, sheet = _table_bytes(format)
    database = tmp_path / 'types.sqlite'
    declaration = {**deepcopy(DATA['declaration']), 'source': deepcopy(DATA['source'])}
    with TestClient(create_app(database)) as client:
        # A corrupt source cell has an exact row/column error and cannot
        # create the remaining nine specifications without explicit skip selection.
        changed = deepcopy(ROWS)
        changed[0][8] = 'not-a-number'
        bad_raw, _ = _table_bytes(format, changed)
        uploaded = client.post('/api/type-library/imports/upload', files={
            'file': ('tai-i-110kv-error.' + format, bad_raw)})
        assert uploaded.status_code == 201, uploaded.text
        bad_upload = uploaded.json()
        response = client.post('/api/type-library/imports/preview', json={
            'upload_id': bad_upload['upload_id'], 'sheet': bad_upload['sheets'][0]['name'],
            'first_data_row': 2, 'mapping': DATA['mapping'], 'series': declaration})
        assert response.status_code == 200, response.text
        bad = response.json()
        assert (bad['valid_count'], bad['error_count']) == (9, 1)
        assert bad['rows'][0]['row_number'] == 2 and bad['rows'][0]['status'] == 'error'
        assert any(issue['column'] == 'I2' and issue['field'] == 'r20' for issue in bad['rows'][0]['issues'])
        response = client.post('/api/type-library/imports/commit', headers=HUMAN, json={
            'preview_id': bad['preview_id'], 'preview_digest': bad['preview_digest'],
            'request_id': str(uuid4()), 'human_confirmed': True})
        assert response.status_code == 422 and response.json()['detail']['code'] == 'TABLE_ROWS_INVALID'
        assert client.get('/api/type-library/series').json() == {'items': []}
        assert client.get('/api/domain-cable-models').json() == []

        uploaded = client.post('/api/type-library/imports/upload', files={'file': ('tai-i-110kv.' + format, raw)})
        assert uploaded.status_code == 201, uploaded.text
        upload = uploaded.json()
        assert upload['sha256'] == sha256(raw).hexdigest()
        assert any(value['name'] == sheet for value in upload['sheets'])
        response = client.post('/api/type-library/imports/preview', json={
            'upload_id': upload['upload_id'], 'sheet': sheet, 'first_data_row': 2,
            'mapping': DATA['mapping'], 'series': declaration})
        assert response.status_code == 200, response.text
        preview = response.json()
        assert (preview['valid_count'], preview['error_count'], preview['incomplete_count']) == (10, 0, 10)
        assert preview['execution_standards']['items'] == []
        assert {item['declared'] for item in preview['execution_standards']['missing']} == set(declaration['standards'])
        for source_row, item in zip(ROWS, preview['rows'], strict=True):
            assert item['status'] == 'incomplete' and item['closure'] is None
            assert item['payload']['materials'] == [] and item['payload']['confirmed'] is False
            assert item['payload']['specification']['um_v'] == 126000
            assert {'导体屏蔽厚度', '绝缘屏蔽厚度', '金属套波纹深度', '金属套波纹节距'} <= set(item['missing'])
            values = {value['key']: value for value in item['values']}
            assert set(values) == set(DATA['mapping']) and 'ampacity' not in values
            for key, column in DATA['mapping'].items():
                value = values[key]
                unit, scale = SI[key]
                assert value['display_value'] == source_row[column]
                assert value['value'] == pytest.approx(source_row[column] * scale, rel=1e-12)
                assert value['unit'] == unit and value['confidence'] == 'reference'
                assert value['method'] == {'name': '厂家结构表导入', 'version': '1.1.0'}
                source = value['source']
                assert source['file_sha256'] == sha256(raw).hexdigest()
                assert source['sheet'] == sheet and source['row'] == item['row_number']
                assert source['column'] == chr(ord('A') + column)
                assert source['catalogue'] == DATA['source']
                assert source['kind'] == 'manufacturer' and source['reviewed'] is False
        body = {'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'],
                'request_id': str(uuid4()), 'human_confirmed': True}
        denied = client.post('/api/type-library/imports/commit', json=body, headers={'X-CableSim-Actor': 'agent'})
        assert denied.status_code in (403, 409)
        assert client.get('/api/type-library/series').json() == {'items': []}
        response = client.post('/api/type-library/imports/commit', json=body, headers=HUMAN)
        assert response.status_code == 201, response.text
        result = response.json()
        assert result['created'] == 10 and result['state'] == 'draft'
        assert client.post('/api/type-library/imports/commit', json=body, headers=HUMAN).json() == result
        saved = client.get('/api/type-library/series/' + result['series_id']).json()
        assert saved['declaration'] == preview['series']
        assert [spec['values'] for spec in saved['specs']] == [row['values'] for row in preview['rows']]
        # The saved per-value sources must still distinguish published maxima
        # and approximate dimensions/weight from measurements at readback.
        meanings = {
            'r20': {'quantity': '厂家原刊最大20℃导体直流电阻限值，不是该规格的制造实测值。', 'unit': 'Ω/km'},
            'weight': {'quantity': '厂家近似总重，不是制造实测质量或材料密度。', 'unit': 'kg/km'},
            'outer_diameter': {'quantity': '厂家近似成品外径，不是制造实测尺寸或制造公差。', 'unit': 'mm'},
            'conductor_diameter': {'quantity': '厂家近似导体外径，不是制造实测尺寸或制造公差。', 'unit': 'mm'},
        }
        for spec in saved['specs']:
            for value in spec['values']:
                if value['key'] in meanings:
                    assert value['source']['catalogue']['column_meanings'][value['key']] == meanings[value['key']]
        models = {item['id']: item for item in client.get('/api/domain-cable-models').json()}
        assert len(models) == 10
        for spec, original in zip(saved['specs'], preview['rows'], strict=True):
            assert spec['state'] == 'draft' and spec['results'] == [] and spec['submission'] is None
            assert models[spec['model_id']]['payload'] == original['payload']
            workspace = client.get('/api/workspaces/' + spec['workspace_id']).json()
            assert workspace['type_origin_reference']['declared_specification'] == original['payload']['specification']
            document = workspace['domain']
            cable = document['cable_types'][0]
            assert cable['construction'] == 'single_core'
            assert (cable['rating']['u0'], cable['rating']['u'], cable['rating']['um']) == (64000, 110000, 126000)
            assert cable['rating']['max_conductor_temperature'] == {}
            assert all(not source['reviewed'] for source in document['provenance'].values())
            assert all(material.get('density') is None for material in document['materials'])
        r20 = next(value for value in saved['specs'][5]['values'] if value['key'] == 'r20')
        assert r20['value'] == pytest.approx(.0000211, rel=1e-12)
    with sqlite3.connect(database) as db:
        originals = [bytes(row[0]) for row in db.execute('SELECT original FROM type_table_uploads')]
        assert len(originals) == 2 and raw in originals and bad_raw in originals
        assert db.execute('SELECT count(*) FROM type_submissions').fetchone()[0] == 0
        assert db.execute('SELECT count(*) FROM study_runs').fetchone()[0] == 0
    # The voltage and insulation outer diameter remain in the original upload,
    # even though neither is mapped to a numeric structural column.
    if format == 'xlsx':
        book = load_workbook(BytesIO(raw), data_only=False)
        assert list(book.active.values) == [tuple(DATA['headers']), *(tuple(row) for row in ROWS)]
        book.close()
    else:
        assert list(csv.reader(StringIO(raw.decode('utf-8-sig')))) == CSV_ROWS
