"""Two actual Chint LV table rows, imported through the ordinary human API.

The original manual calls their diameter and mass reference values. This test
does not turn a catalogue excerpt into measured properties or a complete cable.
The CSV is a small source excerpt; an optional real-PDF audit independently
checks its coordinates and digest without reading importer output.
"""
import csv
from hashlib import sha256
from io import BytesIO, StringIO
import json
import os
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from openpyxl import Workbook
import pytest

from backend.main import create_app


FIXTURES = Path(__file__).parent / 'fixtures'
SOURCE_SHA = '166c89615a4f1453659b6978a9d04c5312f0d710a3d1023c665c3be337179f80'
HUMAN = {'X-CableSim-Actor': 'human'}
EXPECTED = ((10, 8.7, 141), (16, 9.7, 199))
MAPPING = {'area': 0, 'outer_diameter': 1, 'weight': 2}


def source_fixture():
    return json.loads((FIXTURES / 'chint_lv_yjv_source.json').read_text('utf-8'))


def table_bytes(format):
    raw = (FIXTURES / 'chint_lv_yjv.csv').read_bytes()
    if format == 'csv':
        return raw
    workbook = Workbook()
    workbook.active.title = '表9 YJV 单芯'
    for row in csv.reader(StringIO(raw.decode('utf-8'))):
        workbook.active.append(row)
    target = BytesIO()
    workbook.save(target)
    workbook.close()
    return target.getvalue()


def test_chint_excerpt_against_the_actual_official_pdf():
    """Run with CABLESIM_CHINT_ORIGINAL; the copyrighted PDF is not bundled."""
    path = Path(os.environ.get('CABLESIM_CHINT_ORIGINAL', ''))
    if not path.is_file():
        pytest.skip('正泰原始PDF不随仓库分发；设置 CABLESIM_CHINT_ORIGINAL 核验官方原件。')
    import fitz
    metadata = source_fixture()
    source = metadata['source']
    raw = path.read_bytes()
    assert len(raw) == source['size_bytes'] == 20096093
    assert sha256(raw).hexdigest() == source['sha256'] == SOURCE_SHA
    rows = list(csv.reader((FIXTURES / 'chint_lv_yjv.csv').read_text('utf-8').splitlines()))
    assert tuple(tuple(float(value) for value in row) for row in rows[1:]) == EXPECTED
    with fitz.open(stream=raw, filetype='pdf') as pdf:
        page = pdf[source['pdf_page'] - 1]
        words = page.get_text('words')
        for expected, excerpt in zip(EXPECTED, source['excerpts'], strict=True):
            for index, key in enumerate(MAPPING):
                cell = excerpt['cells'][key]
                left, top, right, bottom = cell['rect_pt']
                matches = [word[4] for word in words if
                           left - .02 <= word[0] <= right and top - .02 <= word[1] <= bottom
                           and word[2] <= right + .02 and word[3] <= bottom + .02]
                assert matches == [cell['raw_text']], (excerpt['specification'], key, matches)
                value = float(matches[0].split('×')[-1])
                assert value == expected[index] == cell['value']
        assert source['table'] == '表9 0.6/1 kV 单芯'
        assert source['printed_page'] == 14
        assert 'GB/T3956-2008' == source['original_standards'][1]['declaration']


@pytest.mark.parametrize('format', ['csv', 'xlsx'])
def test_real_chint_lv_table_upload_mapping_preview_commit_and_refusal(tmp_path, monkeypatch, format):
    monkeypatch.setenv('CABLESIM_DATASETS_DIR', str(tmp_path / 'datasets'))
    monkeypatch.setenv('CABLESIM_REPRODUCTION_LIBRARY', str(tmp_path / 'library'))
    metadata = source_fixture()
    raw = table_bytes(format)
    original_source = metadata['source']
    declaration = {key: metadata[key] for key in ('manufacturer', 'designation', 'cores', 'u0_v', 'u_v')}
    declaration.update(name='正泰 YJV 0.6/1 kV 表9两规格 · ' + format, origin='public',
                       source={**original_source, 'transcription': metadata['transcription']},
                       reference={'original_standards': [item['declaration'] for item in original_source['original_standards']],
                                  'usage': original_source['usage'], 'limitations': original_source['limitations']},
                       resistance_basis='stated')
    with TestClient(create_app(tmp_path / 'library.sqlite')) as client:
        uploaded = client.post('/api/type-library/imports/upload', files={
            'file': ('chint-lv-yjv.' + format, raw)})
        assert uploaded.status_code == 201, uploaded.text
        upload = uploaded.json()
        assert upload['sha256'] == sha256(raw).hexdigest()
        mapping = {'name': '正泰表9列映射 · ' + format, 'mapping': MAPPING}
        response = client.post('/api/type-library/mappings', json=mapping, headers=HUMAN)
        assert response.status_code == 200, response.text
        saved = next(item for item in client.get('/api/type-library/mappings').json()
                     if item['name'] == mapping['name'])
        response = client.post('/api/type-library/imports/preview', json={
            'upload_id': upload['upload_id'], 'sheet': upload['sheets'][0]['name'],
            'first_data_row': 2, 'mapping': saved['mapping'], 'series': declaration})
        assert response.status_code == 200, response.text
        preview = response.json()
        assert (preview['valid_count'], preview['error_count'], preview['incomplete_count']) == (2, 0, 2)
        assert preview['execution_standards']['items'] == []
        assert preview['series']['source']['original_standards'] == original_source['original_standards']
        for row_number, (row, expected) in enumerate(zip(preview['rows'], EXPECTED, strict=True), 2):
            assert row['status'] == 'incomplete' and row['missing']
            assert [value['key'] for value in row['values']] == list(MAPPING)
            for index, fact in enumerate(row['values']):
                assert fact['display_value'] == expected[index]
                scale = 1e-6 if fact['key'] == 'area' else .001
                assert fact['value'] == pytest.approx(expected[index] * scale)
                assert fact['method']['name'] == '厂家结构表导入' and fact['method']['version']
                assert fact['confidence'] == 'reference'
                source = fact['source']
                assert source['catalogue'] == declaration['source']
                assert source['file_sha256'] == sha256(raw).hexdigest()
                assert (source['row'], source['column']) == (row_number, 'ABC'[index])
                assert source['sheet'] == preview['sheet'] and source['reviewed'] is False
            assert row['payload']['materials'] == []
            assert 'r20' not in row['payload']['specification']['values']
        commit = {'preview_id': preview['preview_id'], 'preview_digest': preview['preview_digest'],
                  'request_id': str(uuid4()), 'human_confirmed': True}
        assert client.post('/api/type-library/imports/commit', json=commit,
                           headers={'X-CableSim-Actor': 'agent'}).status_code == 403
        response = client.post('/api/type-library/imports/commit', json=commit, headers=HUMAN)
        assert response.status_code == 201, response.text
        receipt = response.json()
        assert receipt['created'] == 2 and receipt['state'] == 'draft'
        detail = client.get('/api/type-library/series/' + receipt['series_id']).json()
        assert detail['series']['source'] == declaration['source']
        assert len(detail['specs']) == 2
        for spec, imported in zip(detail['specs'], preview['rows'], strict=True):
            saved = client.get('/api/type-library/specs/' + spec['id']).json()
            assert saved['values'] == imported['values'] and saved['missing'] == imported['missing']
            assert saved['spec']['state'] == 'draft' and saved['results'] == []
            workspace = client.get('/api/workspaces/' + spec['workspace_id']).json()
            cable = workspace['domain']['cable_types'][0]
            conductor = cable['cores'][0]['conductor']
            assert (cable['rating']['u0'], cable['rating']['u']) == (600, 1000)
            assert conductor['diameter'] is None and conductor.get('r20') is None
            assert cable['rating']['max_conductor_temperature'] == {}
            assert workspace['domain']['schema_version'] == 'cablesim.type-draft/1'
        response = client.post('/api/type-library/series/' + receipt['series_id'] + '/batch', json={
            'request_id': str(uuid4()), 'operation': 'calculate',
            'spec_ids': [spec['id'] for spec in detail['specs']],
            'expected_versions': {spec['id']: spec['version'] for spec in detail['specs']},
            'expected_revisions': {spec['id']: spec['workspace_revision'] for spec in detail['specs']},
            'human_confirmed': True, 'scope_acknowledged': True}, headers=HUMAN)
        assert response.status_code == 200, response.text
        assert response.json()['status'] == 'failed'
        for item in response.json()['items']:
            assert item['status'] == 'failed' and item['detail']['code'] == 'TYPE_DATA_INCOMPLETE'
            assert 'run_id' not in item
        for spec in detail['specs']:
            assert client.get('/api/type-library/specs/' + spec['id']).json()['results'] == []
