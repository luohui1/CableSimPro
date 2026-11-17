"""Serialization boundaries, not substituted engineering calculations."""
from copy import deepcopy
from io import BytesIO
import json
import math
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from openpyxl import load_workbook
import pytest

from backend.kernel.formal_contracts import SCHEMA, SIGNATURE_ROLES, canonical_bytes, jsonsha, raw_text
from backend.kernel.formal_xlsx import render_xlsx


def serializer_model():
    # One real IEC output value that %.16g changes, plus explicit serialization
    # edge cases. These are codec fixtures, never claimed as a solver result.
    payload = {'values': [748.3219742774963, -0.0, 2 ** 53 + 1], 'unit': 'A', 'text': '=1+2'}
    ref = lambda pointer: {'source_id': 'codec', 'pointer': pointer}
    rows = []
    for index, value in enumerate(payload['values']):
        rows.append({'id': str(index), 'cells': {
            'label': {'value': payload['text'], 'raw_text': payload['text'], 'value_ref': ref('/text')},
            'value': {'value': value, 'raw_text': raw_text(value), 'value_ref': ref('/values/' + str(index)),
                      'unit': 'A', 'unit_ref': ref('/unit')}}})
    model = {'schema': SCHEMA, 'kind': 'calculation', 'title': '计算书',
        'metadata': {'organization': '数值原文核验', 'number': 'CALC-001', 'revision': 'A', 'header': '原文 & 单位', 'footer': '保存记录'},
        'state': {'label': '序列化验证'}, 'source_identity': {},
        'signatures': [{'role': role, 'label': label, 'name': None, 'date': None, 'evidence_ref': None} for role, label in SIGNATURE_ROLES],
        'sources': {'codec': {'kind': 'serialization-test', 'payload': payload, 'payload_digest': jsonsha(payload)}},
        'sections': [{'id': 'body', 'heading': '完整原文', 'role': 'body', 'table_ids': ['values'], 'paragraphs': []},
                     {'id': 'trace', 'heading': '追溯记录', 'role': 'trace', 'table_ids': [], 'paragraphs': []}],
        'tables': {'values': {'title': '原始值', 'columns': [{'key': 'label', 'label': '标签', 'role': 'text'},
                                                       {'key': 'value', 'label': '原始数值', 'role': 'value'}], 'rows': rows}}}
    model['source_digest'] = jsonsha(model['sources'])
    model['model_digest'] = jsonsha(model)
    return model


def test_xlsx_preserves_raw_values_typed_lexemes_units_and_empty_signatures():
    model = serializer_model()
    raw = render_xlsx(model)
    workbook = load_workbook(BytesIO(raw))
    index = workbook['追溯数值']
    assert list(next(index.values)) == ['table_id', 'row_id', 'column_key', 'sheet', 'cell', 'raw_text',
        'numeric_value', 'unit', 'source_id', 'pointer', 'unit_source_id', 'unit_pointer', 'numeric_kind']
    for number, values in enumerate(list(index.values)[1:]):
        source = model['sources']['codec']['payload']['values'][number]
        assert values[5] == raw_text(source)
        target = workbook[values[3]][values[4]]
        assert target.value == raw_text(source) and target.data_type == 's'
        assert workbook[values[3]].cell(target.row, target.column + 1).value == 'A'
        assert values[7] == 'A'
        assert values[6] == (raw_text(source) if number == 2 else source)
        if number == 1:
            assert math.copysign(1, values[6]) < 0
    assert index['M4'].value == 'int-text'
    assert index['G4'].data_type == 's'
    archived = ''.join(row[1] for row in list(workbook['追溯原文'].values)[1:])
    assert archived.encode() == canonical_bytes(model)
    assert json.loads(archived) == model
    for sheet in workbook:
        for row in sheet:
            assert all(cell.data_type != 'f' for cell in row)
    cover = workbook['文件信息']
    for row in cover:
        if row[0].value in {'设计', '校核', '审核', '批准'}:
            assert row[1].value is None and row[2].value is None
    with ZipFile(BytesIO(raw)) as archive:
        path = 'xl/worksheets/sheet' + str(workbook.index(index) + 1) + '.xml'
        root = ET.fromstring(archive.read(path))
        ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        cells = {cell.attrib['r']: cell for cell in root.findall('.//s:c', ns)}
        assert cells['G2'].find('s:v', ns).text == '748.3219742774963'
        assert cells['G3'].find('s:v', ns).text == '-0.0'
    workbook.close()


def test_xlsx_cannot_silently_round_a_model_before_rendering():
    model = deepcopy(serializer_model())
    model['tables']['values']['rows'][0]['cells']['value']['raw_text'] = '748.32'
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as error:
        render_xlsx(model)
    assert error.value.detail['code'] == 'FORMAL_SOURCE_INTEGRITY'


@pytest.mark.parametrize('heading', ['追溯数值', '追溯原文', '文件信息'])
def test_saved_study_title_cannot_rename_reserved_trace_sheets(heading):
    model = serializer_model()
    model['sections'][0]['heading'] = heading
    model.pop('model_digest')
    model['model_digest'] = jsonsha(model)
    workbook = load_workbook(BytesIO(render_xlsx(model)))
    assert workbook['追溯数值']['A1'].value == 'table_id'
    assert workbook['追溯原文']['A1'].value == 'chunk_index'
    assert workbook['文件信息']['A1'].value == '计算书'
    for values in list(workbook['追溯数值'].values)[1:]:
        assert workbook[values[3]][values[4]].value == values[5]
    workbook.close()
