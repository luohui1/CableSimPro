"""A real 220 kV manufacturer table, kept incomplete rather than reconstructed.

The optional original-PDF audit is independent of the importer and the kernels.
CI supplies the original explicitly; an absent source never becomes a fake pass.
"""
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


DATA = json.loads((Path(__file__).parent / 'fixtures/tai_i_220kv_catalogue.json').read_text('utf-8'))
CSV_BYTES = (Path(__file__).parent / 'fixtures' / DATA['table_file']).read_bytes()
CSV_ROWS = list(csv.reader(StringIO(CSV_BYTES.decode('utf-8-sig'))))
ROWS = [[row[0], *(float(value) for value in row[1:])] for row in CSV_ROWS[1:]]
HUMAN = {'X-CableSim-Actor': 'human'}
SI = {'area': ('m2', 1e-6), 'conductor_diameter': ('m', .001),
      'insulation_thickness': ('m', .001), 'metallic_sheath_thickness': ('m', .001),
      'oversheath_thickness': ('m', .001), 'outer_diameter': ('m', .001),
      'r20': ('ohm/m', .001), 'weight': ('kg/m', .001)}


def test_tai_i_original_pdf_matches_every_transcribed_cell():
    """Set CABLESIM_TAI_I_ORIGINAL to the downloaded, hash-pinned original."""
    original = os.environ.get('CABLESIM_TAI_I_ORIGINAL')
    if not original:
        pytest.skip('台一官方原PDF未显式提供；不以转录数据代替原文审计。')
    import pdfplumber
    raw = Path(original).read_bytes()
    assert len(raw) == 6940265
    assert sha256(raw).hexdigest() == '72b21e5d15f5d50a5b30a01c822ca3771bd0cc190cbfa4edd47bf23a948c9cdd'
    with pdfplumber.open(BytesIO(raw)) as pdf:
        assert len(pdf.pages) == 33
        page = pdf.pages[5]
        # On the two-page spread this is the upper-right 220 kV table. The
        # lower-right 110 kV heading must not redefine its voltage or limits.
        assert 'YJLW02(03)' in page.crop((635, 100, 1142, 360)).extract_text()
        candidates = [table for table in page.find_tables()
                      if table.bbox[0] > 630 and table.bbox[1] < 125 and table.bbox[3] < 360]
        assert len(candidates) == 1
        table = candidates[0].extract()
    assert len(table) == 15 and all(len(row) == 10 for row in table)
    assert table[2] == ['kV', 'mm2', 'mm', 'mm', 'mm', 'mm', 'mm', 'mm', 'Ω/km', 'kg/km']
    assert 'Maximum' in table[0][8] and '20℃' in table[0][8]
    assert 'approx.' in table[0][2] and 'approx.' in table[0][7] and 'approx.' in table[0][9]
    assert table[3][0] == '127/220\n(252)' and all(row[0] is None for row in table[4:])
    assert CSV_ROWS[0] == DATA['headers'] and len(ROWS) == 12
    for original_row, declared in zip(table[3:], ROWS, strict=True):
        assert declared[0] == '127/220 (252)'
        for original_value, number in zip(original_row[1:], declared[1:], strict=True):
            assert re.fullmatch(r'\d+(?:,\d{3})*(?:\.\d+)?', original_value), original_value
            assert Decimal(original_value.replace(',', '')) == Decimal(str(number))
    # Preserve the manufacturer's published limit even where another standard
    # uses a different value; this audit verifies transcription, not compliance.
    assert table[-1][8] == '0.0073'


def _table_bytes(format):
    rows = [DATA['headers'], *ROWS]
    if format == 'xlsx':
        book = Workbook()
        book.active.title = '台一220kV'
        for row in rows:
            book.active.append(row)
        stream = BytesIO()
        book.save(stream)
        book.close()
        return stream.getvalue(), '台一220kV'
    return CSV_BYTES, 'tai-i-220kv'


@pytest.mark.parametrize('format', ['xlsx', 'csv'])
def test_tai_i_220kv_original_table_upload_preview_and_commit(tmp_path, format):
    raw, sheet = _table_bytes(format)
    database = tmp_path / 'types.sqlite'
    with TestClient(create_app(database)) as client:
        uploaded = client.post('/api/type-library/imports/upload', files={'file': ('tai-i-220kv.' + format, raw)})
        assert uploaded.status_code == 201, uploaded.text
        upload = uploaded.json()
        assert upload['sha256'] == sha256(raw).hexdigest()
        assert any(value['name'] == sheet for value in upload['sheets'])
        declaration = {**deepcopy(DATA['declaration']), 'source': deepcopy(DATA['source'])}
        response = client.post('/api/type-library/imports/preview', json={
            'upload_id': upload['upload_id'], 'sheet': sheet, 'first_data_row': 2,
            'mapping': DATA['mapping'], 'series': declaration})
        assert response.status_code == 200, response.text
        preview = response.json()
        assert (preview['valid_count'], preview['error_count'], preview['incomplete_count']) == (12, 0, 12)
        assert preview['execution_standards']['items'] == []
        assert {item['declared'] for item in preview['execution_standards']['missing']} == set(declaration['standards'])
        for source_row, item in zip(ROWS, preview['rows'], strict=True):
            assert item['status'] == 'incomplete' and item['closure'] is None
            assert item['payload']['materials'] == [] and item['payload']['confirmed'] is False
            assert item['payload']['specification']['um_v'] == 252000
            assert {'导体屏蔽厚度', '绝缘屏蔽厚度', '金属套波纹深度', '金属套波纹节距'} <= set(item['missing'])
            values = {value['key']: value for value in item['values']}
            assert set(values) == set(DATA['mapping']) and 'ampacity' not in values
            for key, column in DATA['mapping'].items():
                value = values[key]
                unit, scale = SI[key]
                assert value['display_value'] == source_row[column]
                assert value['value'] == pytest.approx(source_row[column] * scale, rel=1e-12)
                assert value['unit'] == unit
                assert value['confidence'] == 'reference'
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
        committed = client.post('/api/type-library/imports/commit', json=body, headers=HUMAN)
        assert committed.status_code == 201, committed.text
        result = committed.json()
        assert result['created'] == 12 and result['state'] == 'draft'
        assert client.post('/api/type-library/imports/commit', json=body, headers=HUMAN).json() == result
        saved = client.get('/api/type-library/series/' + result['series_id']).json()
        assert saved['declaration'] == preview['series']
        assert saved['declaration']['um_v'] == 252000
        assert [spec['values'] for spec in saved['specs']] == [row['values'] for row in preview['rows']]
        models = {item['id']: item for item in client.get('/api/domain-cable-models').json()}
        for spec, original in zip(saved['specs'], preview['rows'], strict=True):
            assert spec['state'] == 'draft' and spec['results'] == [] and spec['submission'] is None
            assert models[spec['model_id']]['payload'] == original['payload']
            assert models[spec['model_id']]['payload']['specification']['um_v'] == 252000
            workspace = client.get('/api/workspaces/' + spec['workspace_id']).json()
            assert workspace['type_origin_reference']['declared_specification'] == original['payload']['specification']
            document = workspace['domain']
            cable = document['cable_types'][0]
            assert cable['construction'] == 'single_core'
            assert (cable['rating']['u0'], cable['rating']['u'], cable['rating']['um']) == (127000, 220000, 252000)
            assert cable['rating']['max_conductor_temperature'] == {}
            assert all(not source['reviewed'] for source in document['provenance'].values())
            assert all(material.get('density') is None for material in document['materials'])
        # The last manufacturer's limit remains 0.0073 Ω/km in both the
        # immutable candidate and its old-platform type workspace declaration.
        r20 = next(value for value in saved['specs'][-1]['values'] if value['key'] == 'r20')
        assert r20['value'] == pytest.approx(.0000073, rel=1e-12)
    with sqlite3.connect(database) as db:
        assert bytes(db.execute('SELECT original FROM type_table_uploads').fetchone()[0]) == raw
        assert db.execute('SELECT count(*) FROM type_submissions').fetchone()[0] == 0
    # The original voltage and insulation-outer-diameter columns have not been
    # discarded merely because the current structural vocabulary cannot map them.
    if format == 'xlsx':
        book = load_workbook(BytesIO(raw), data_only=False)
        assert list(book.active.values) == [tuple(DATA['headers']), *(tuple(row) for row in ROWS)]
        book.close()
    else:
        source_rows = list(csv.reader(StringIO(raw.decode('utf-8-sig'))))
        assert source_rows == CSV_ROWS
