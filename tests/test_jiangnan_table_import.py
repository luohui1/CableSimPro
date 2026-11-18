"""Real Jiangnan 26/35 kV cells reach Types as explicitly incomplete drafts.

The source fixture is the unchanged numeric HTML table excerpt from the
manufacturer's page, independently of the CSV submitted to the application.
No value is borrowed from the old standard-check fixture's derived geometry.
"""
from copy import deepcopy
import csv
from hashlib import sha256
from html.parser import HTMLParser
from io import BytesIO, StringIO
import json
import os
from pathlib import Path
import re
import sqlite3
from uuid import uuid4

from fastapi.testclient import TestClient
from openpyxl import Workbook
import pytest

from backend.main import create_app


FIXTURES = Path(__file__).parent / 'fixtures'
HUMAN = {'X-CableSim-Actor': 'human'}
MAPPING = {'area': 0, 'insulation_thickness': 2, 'outer_diameter': 3, 'weight': 4}
SCALES = {'area': (1e-6, 'm2'), 'insulation_thickness': (.001, 'm'),
          'outer_diameter': (.001, 'm'), 'weight': (.001, 'kg/m')}
METHOD = {'name': '厂家结构表导入', 'version': '1.1.0'}


class OriginalTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.current, self.cell, self.selector = [], None, None, None

    def handle_starttag(self, tag, attributes):
        if tag == 'tr':
            self.current = []
            self.selector = '#tablepress-26yjv22 .' + dict(attributes)['class'].split()[0]
        elif tag in ('td', 'th'):
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ('td', 'th'):
            self.current.append(''.join(self.cell).strip())
            self.cell = None
        elif tag == 'tr':
            self.rows.append((self.selector, self.current))
            self.current = None


def reference():
    metadata = json.loads((FIXTURES / 'jiangnan_yjv22.json').read_text('utf-8'))
    content = (FIXTURES / 'jiangnan_yjv22.csv').read_bytes()
    original = (FIXTURES / 'jiangnan_yjv22_source.html').read_bytes()
    assert sha256(original).hexdigest() == metadata['source']['original_table_sha256'] == \
        '624829fa31c5dba79f34d8af09dbc585a066ea1ddb5a6d1c374e0c28fb2021bf'
    assert sha256(content).hexdigest() == metadata['source']['csv_sha256'] == \
        '02b8a2a1b31eef30e147cae3b4028e7a85f36a85d80e5e8b83f31b41ed1928b9'
    parsed = OriginalTable()
    parsed.feed(original.decode('utf-8'))
    grid = list(csv.reader(StringIO(content.decode('utf-8'))))
    selected = [(selector, row) for selector, row in parsed.rows[1:] if row[1] == '3']
    assert len(parsed.rows) == 21 and len(selected) == 9
    assert [row for _, row in selected] == grid[1:]
    for index, (selector, row) in enumerate(selected):
        assert metadata['source']['rows'][index] == {
            'csv_row': index + 2, 'source_selector': selector,
            'area_mm2': int(row[0]), 'cores': int(row[1])}
    return metadata, content, grid


def declaration(metadata, suffix):
    return {**deepcopy(metadata['declaration']),
            'name': metadata['title'] + ' · ' + suffix,
            'manufacturer': metadata['manufacturer'],
            'source': {**deepcopy(metadata['source']),
                       'transcription_method': metadata['transcription_method'],
                       'confidence': metadata['confidence'], 'reviewed': False,
                       'limitations': metadata['limitations'],
                       'published_standards_text': metadata['published_standards_text']}}


def spreadsheet(metadata, grid):
    book = Workbook()
    book.active.title = '来源说明'
    book.active.append(['原始网页', metadata['source']['url']])
    book.active.append(['原表口径', '标称截面、标称绝缘、近似外径、电缆最大重量；缺项不补造。'])
    book.active.append(['原件摘要', metadata['source']['page_sha256']])
    sheet = book.create_sheet('三芯结构表')
    for row in grid:
        sheet.append(row)
    stream = BytesIO()
    book.save(stream)
    book.close()
    return stream.getvalue()


def test_source_table_keeps_the_published_anomaly_and_quantity_qualifiers():
    metadata, _, grid = reference()
    assert grid[3] == ['95', '3', '10.5', '86.3', '11050']
    assert grid[7] == ['240', '3', '10.5', '112.5', '17210']
    assert '最大重量' in metadata['source']['column_meanings']['weight']['quantity']
    assert '不是实测质量或材料密度' in metadata['source']['column_meanings']['weight']['quantity']
    assert metadata['declaration']['standards'] == []
    assert metadata['declaration']['resistance_basis'] == 'stated'
    assert any('86.3' in note for note in metadata['limitations'])


def test_official_jiangnan_page_matches_retained_table_and_csv(tmp_path):
    """Opt-in original-file audit; the normal test run never downloads sources.

    CABLESIM_JIANGNAN_ORIGINAL must point at the actual downloaded HTML page.
    A changed footer, nonce or other non-table content is recorded separately
    from the original table. Exact table cells, headers and locators must agree.
    """
    original_path = os.environ.get('CABLESIM_JIANGNAN_ORIGINAL')
    if not original_path:
        pytest.skip('未提供江南官方原网页；设 CABLESIM_JIANGNAN_ORIGINAL 后核验，不用转录替代原件。')
    metadata, csv_content, grid = reference()
    path = Path(original_path)
    assert path.is_file() and 0 < path.stat().st_size <= 4 * 1024 * 1024
    original = path.read_bytes()
    tables = re.findall(rb'<table\b[^>]*\bid=["\']tablepress-26yjv22["\'][^>]*>[\s\S]*?</table>', original)
    assert len(tables) == 1, '官方网页必须包含且只包含一个准确定位的原尺寸表。'
    retained = OriginalTable()
    retained.feed((FIXTURES / 'jiangnan_yjv22_source.html').read_text('utf-8'))
    actual = OriginalTable()
    actual.feed(tables[0].decode('utf-8'))
    selected = [(selector, row) for selector, row in actual.rows[1:] if len(row) == 5 and row[1] == '3']
    table_matches = actual.rows == retained.rows
    csv_matches = [row for _, row in selected] == grid[1:]
    report = {'schema': 'cablesim.manufacturer-original-audit/1',
              'method': {'name': '江南原网页结构表独立核验', 'version': '1.0.0'},
              'source_url': metadata['source']['url'], 'original_file': path.name,
              'page_sha256': sha256(original).hexdigest(), 'page_size_bytes': len(original),
              'recorded_page_sha256': metadata['source']['page_sha256'],
              'whole_page_bytes_match': sha256(original).hexdigest() == metadata['source']['page_sha256'],
              'table_sha256': sha256(tables[0] + b'\n').hexdigest(),
              'recorded_table_sha256': metadata['source']['original_table_sha256'],
              'table_headers_cells_and_locators_match': table_matches,
              'csv_sha256': sha256(csv_content).hexdigest(),
              'csv_rows_match': csv_matches, 'three_core_rows': len(selected),
              'numeric_cells_checked': sum(len(row) for _, row in selected),
              'passed': table_matches and csv_matches,
              'rows': [{'source_selector': selector, 'source_cells': row,
                        'csv_row': index + 2, 'csv_cells': grid[index + 1] if index + 1 < len(grid) else None}
                       for index, (selector, row) in enumerate(selected)]}
    output = Path(os.environ.get('CABLESIM_JIANGNAN_AUDIT_OUTPUT', str(tmp_path / 'jiangnan-source-audit.json')))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    assert table_matches, '官方原表与固定原件摘录的表头、数值或行定位不一致：' + str(output)
    assert csv_matches, '官方三芯原表与导入CSV不一致：' + str(output)
    assert report['three_core_rows'] == 9 and report['numeric_cells_checked'] == 45


@pytest.mark.parametrize('format', ['xlsx', 'csv'])
def test_real_jiangnan_rows_upload_map_preview_and_commit_without_filling_gaps(tmp_path, format):
    metadata, csv_content, grid = reference()
    content = spreadsheet(metadata, grid) if format == 'xlsx' else csv_content
    filename = 'jiangnan_yjv22.' + format
    sheet = '三芯结构表' if format == 'xlsx' else 'jiangnan_yjv22'
    database = tmp_path / 'library.sqlite'
    with TestClient(create_app(database)) as client:
        response = client.post('/api/type-library/imports/upload', files={'file': (filename, content)})
        assert response.status_code == 201, response.text
        uploaded = response.json()
        assert uploaded['sha256'] == sha256(content).hexdigest()
        assert sheet in {item['name'] for item in uploaded['sheets']}
        selected = next(item for item in uploaded['sheets'] if item['name'] == sheet)
        assert selected['first_data_row'] == 2 and selected['data_rows'] == 9
        assert '最大重量' in selected['columns'][4]['header']
        if format == 'xlsx':
            assert uploaded['sheets'][0]['name'] == '来源说明'

        mapping = {'name': '江南35kV原表映射', 'mapping': MAPPING,
                   'headers': {key: grid[0][column] for key, column in MAPPING.items()}}
        saved = client.post('/api/type-library/mappings', json=mapping, headers=HUMAN)
        assert saved.status_code == 200, saved.text
        reused = next(item for item in client.get('/api/type-library/mappings').json()
                      if item['name'] == mapping['name'])
        assert reused == mapping
        response = client.post('/api/type-library/imports/preview', json={
            'upload_id': uploaded['upload_id'], 'sheet': sheet, 'first_data_row': 2,
            'mapping': reused['mapping'], 'series': declaration(metadata, format)})
        assert response.status_code == 200, response.text
        preview = response.json()
        assert preview['method'] == METHOD
        assert preview['valid_count'] == preview['incomplete_count'] == 9
        assert preview['error_count'] == 0 and preview['execution_standards']['items'] == []
        assert client.get('/api/type-library/series').json() == {'items': []}

        for row_number, (row, raw) in enumerate(zip(preview['rows'], grid[1:]), 2):
            assert row['row_number'] == row_number and row['status'] == 'incomplete'
            assert row['missing'] and row['issues'] == []
            assert '20 °C 导体直流电阻' in row['missing']
            assert row['closure'] is None and row['payload']['cable_type'] is None
            assert row['payload']['materials'] == []
            assert row['payload']['specification']['um_v'] is None
            facts = {item['key']: item for item in row['values']}
            assert set(facts) == set(MAPPING)
            for key, column in MAPPING.items():
                fact = facts[key]
                scale, unit = SCALES[key]
                assert fact['display_value'] == float(raw[column])
                assert fact['value'] == pytest.approx(float(raw[column]) * scale)
                assert fact['unit'] == unit and fact['method'] == METHOD
                assert fact['confidence'] == 'reference'
                source = fact['source']
                assert source['file'] == filename and source['file_sha256'] == uploaded['sha256']
                assert source['sheet'] == sheet and source['row'] == row_number
                assert source['column'] == chr(ord('A') + column)
                assert source['field'] == key and source['kind'] == 'manufacturer'
                assert source['method'] == METHOD and source['reviewed'] is False
                assert source['catalogue']['url'] == metadata['source']['url']
                assert source['catalogue']['original_table_sha256'] == metadata['source']['original_table_sha256']
                assert source['catalogue']['rows'][row_number - 2]['csv_row'] == row_number
                assert source['catalogue']['column_meanings'][key] == metadata['source']['column_meanings'][key]
                assert json.loads(row['payload']['sources'][key]['reference']) == source

        response = client.post('/api/type-library/imports/commit', headers=HUMAN, json={
            'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'],
            'request_id': str(uuid4()), 'human_confirmed': True})
        assert response.status_code == 201, response.text
        committed = response.json()
        assert committed['created'] == 9 and committed['state'] == 'draft'
        detail = client.get('/api/type-library/series/' + committed['series_id']).json()
        assert detail['series']['source'] == preview['series']['source']
        models = {item['id']: item for item in client.get('/api/domain-cable-models').json()}
        for spec, original in zip(detail['specs'], preview['rows']):
            assert spec['values'] == original['values']
            assert spec['state'] == 'draft' and spec['results'] == [] and spec['submission'] is None
            assert models[spec['model_id']]['payload'] == original['payload']
            workspace = client.get('/api/workspaces/' + spec['workspace_id']).json()
            assert workspace['type_origin_reference']['id'] == spec['model_id']
            assert workspace['type_origin_reference']['declared_specification'] == original['payload']['specification']
            assert workspace['type_origin_reference']['references'] == original['payload']['sources']
            assert workspace['domain']['schema_version'] == 'cablesim.type-draft/1'
            cable = workspace['domain']['cable_types'][0]
            assert (cable['rating']['u0'], cable['rating']['u']) == (26000, 35000)
            assert cable['rating']['um'] is None
            assert cable['rating']['max_conductor_temperature'] == {}
            for core in cable['cores']:
                assert core['x'] is None and core['z'] is None
                assert core['conductor']['diameter'] is None and core['conductor'].get('r20') is None
                assert core['conductor']['nominal_area'] == pytest.approx(original['area_m2'])
                assert core['layers'][0]['thickness'] == pytest.approx(.0105)
            assert all(material.get('density') is None for material in workspace['domain']['materials'])

        response = client.post('/api/type-library/series/' + committed['series_id'] + '/batch',
            headers=HUMAN, json={'request_id': str(uuid4()), 'operation': 'calculate',
                'spec_ids': [item['id'] for item in detail['specs']],
                'expected_versions': {item['id']: item['version'] for item in detail['specs']},
                'expected_revisions': {item['id']: item['workspace_revision'] for item in detail['specs']},
                'human_confirmed': True, 'scope_acknowledged': True})
        assert response.status_code == 200, response.text
        result = response.json()
        assert result['status'] == 'failed' and len(result['items']) == 9
        assert all(item['status'] == 'failed' and item['detail']['code'] == 'TYPE_DATA_INCOMPLETE'
                   and 'run_id' not in item for item in result['items'])
    with sqlite3.connect(database) as db:
        assert db.execute('SELECT original FROM type_table_uploads').fetchone()[0] == content
        assert db.execute('SELECT count(*) FROM domain_cable_models').fetchone()[0] == 9
        assert db.execute('SELECT count(*) FROM type_plans').fetchone()[0] == 9
        assert db.execute('SELECT count(*) FROM type_submissions').fetchone()[0] == 0
        assert db.execute('SELECT count(*) FROM study_runs').fetchone()[0] == 0


def test_jiangnan_transcription_error_points_to_the_actual_cell_and_blocks_import(tmp_path):
    metadata, _, grid = reference()
    changed = deepcopy(grid)
    changed[3][2] = '10,5'
    stream = StringIO()
    csv.writer(stream, lineterminator='\n').writerows(changed)
    with TestClient(create_app(tmp_path / 'error.sqlite')) as client:
        response = client.post('/api/type-library/imports/upload', files={
            'file': ('transcription-error.csv', stream.getvalue().encode('utf-8'))})
        assert response.status_code == 201, response.text
        uploaded = response.json()
        response = client.post('/api/type-library/imports/preview', json={
            'upload_id': uploaded['upload_id'], 'sheet': uploaded['sheets'][0]['name'],
            'first_data_row': 2, 'mapping': MAPPING, 'series': declaration(metadata, '错误行验证')})
        assert response.status_code == 200, response.text
        preview = response.json()
        assert (preview['error_count'], preview['valid_count']) == (1, 8)
        assert preview['rows'][2]['issues'][0]['column'] == 'C4'
        assert preview['rows'][2]['issues'][0]['field'] == 'insulation_thickness'
        response = client.post('/api/type-library/imports/commit', headers=HUMAN, json={
            'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'],
            'request_id': str(uuid4()), 'human_confirmed': True})
        assert response.status_code == 422 and response.json()['detail']['code'] == 'TABLE_ROWS_INVALID'
        assert client.get('/api/type-library/series').json() == {'items': []}
        assert client.get('/api/domain-cable-models').json() == []
