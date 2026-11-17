"""Print-only contract fixtures: no fixture value is an engineering result."""
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path

import fitz
from fastapi import HTTPException
import pytest

from backend.kernel.formal_contracts import SCHEMA, SIGNATURE_ROLES, canonical_bytes, jsonsha, raw_text
from backend.kernel.formal_pdf import render_pdf


def _model(count=3):
    values = [1.2345678901234567, -0.0, 1.2345678901234567e-105]
    values.extend(1000.1234567890123 + index for index in range(max(0, count - len(values))))
    payload = {'purpose': '排版验证夹具，不是工程计算结果', 'values': values[:count],
               'unit': 'K·m/W', 'method_id': 'cablesim.print-contract-fixture',
               'signatures': {'review': {'name': '审核记录姓名', 'date': '2026-11-17T08:42:03.123456+00:00'}}}
    source = {'payload': payload, 'payload_digest': jsonsha(payload)}
    ref = lambda pointer: {'source_id': 'fixture', 'pointer': pointer}
    cell = lambda value, reference=None: {'value': value, 'raw_text': raw_text(value), 'value_ref': reference, 'unit': None, 'unit_ref': None}
    columns = [{'key': 'item', 'label': '参数', 'role': 'text', 'weight': 2.2},
               {'key': 'value', 'label': '保存原值', 'role': 'value', 'weight': 1.8},
               {'key': 'unit', 'label': '单位', 'role': 'unit', 'weight': .8},
               {'key': 'context', 'label': '依据与说明', 'role': 'text', 'weight': 2.2}]
    rows = [{'id': f'value-{index}', 'cells': {'item': cell('排版验证值'),
            'value': {**cell(value, ref(f'/values/{index}')), 'unit': payload['unit'], 'unit_ref': ref('/unit')},
            'unit': cell(payload['unit'], ref('/unit')), 'context': cell('仅验证完整数值与单位排版。')}}
            for index, value in enumerate(payload['values'])]
    model = {'schema': SCHEMA, 'kind': 'calculation', 'title': '计算书',
             'metadata': {'organization': '电缆工程研究单位', 'number': 'CS-PDF-EXACT', 'revision': 'A',
                          'header': '正式交付文件字体与分页测试', 'footer': '完整精度 · 原始记录可追溯',
                          'issued_on': '2026-11-17', 'logo_data_uri': None},
             'signatures': [{'role': role, 'label': label, 'name': None, 'date': None, 'evidence_ref': None}
                            for role, label in SIGNATURE_ROLES],
             'sources': {'fixture': source},
             'sections': [{'id': 'body', 'role': 'body', 'heading': '保存的工程数值',
                           'paragraphs': [{'text': payload['purpose'], 'source_ref': ref('/purpose'), 'verbatim': True}],
                           'table_ids': ['values']},
                          {'id': 'trace', 'role': 'trace', 'heading': '来源身份', 'paragraphs': [], 'table_ids': ['trace']}],
             'tables': {'values': {'title': '逐值核验表', 'columns': columns, 'rows': rows},
                        'trace': {'title': '完整来源摘要',
                                  'columns': [{'key': 'item', 'label': '记录', 'role': 'text', 'weight': 1},
                                              {'key': 'value', 'label': '原文', 'role': 'text', 'weight': 3}],
                                  'rows': [{'id': 'method', 'cells': {'item': cell('方法标识'), 'value': cell(payload['method_id'], ref('/method_id'))}},
                                           {'id': 'digest', 'cells': {'item': cell('来源摘要'), 'value': cell(source['payload_digest'])}}]}}}
    model['model_digest'] = jsonsha(model)
    return model


def _reset_digest(model):
    for source in model['sources'].values():
        source['payload_digest'] = jsonsha(source['payload'])
    model.pop('model_digest', None)
    model['model_digest'] = jsonsha(model)


def _saved_paragraph(model, text):
    paragraphs = model['sources']['fixture']['payload'].setdefault('paragraphs', [])
    paragraphs.append(text)
    return {'text': text, 'source_ref': {'source_id': 'fixture', 'pointer': '/paragraphs/' + str(len(paragraphs) - 1)},
            'verbatim': True}


def _text(pdf):
    return '\n'.join(page.get_text() for page in pdf)


def _check_bounds(pdf):
    for page in pdf:
        for word in page.get_text('words'):
            assert 25 <= word[0] < word[2] <= page.rect.width - 25, word
            assert 8 <= word[1] < word[3] <= page.rect.height - 8, word


def test_exact_values_signatures_running_information_and_canonical_attachment():
    model = _model()
    model['signatures'][2].update({**model['sources']['fixture']['payload']['signatures']['review'],
                                   'evidence_ref': {'source_id': 'fixture', 'pointer': '/signatures/review'}})
    _reset_digest(model)
    original = deepcopy(model)
    with fitz.open(stream=render_pdf(model), filetype='pdf') as pdf:
        assert set(pdf.embfile_names()) == {'formal-model.json', 'DROID_NOTICE.txt', 'bitstream-vera-license.txt'}
        assert pdf.embfile_get('formal-model.json') == canonical_bytes(model)
        assert json.loads(pdf.embfile_get('formal-model.json')) == model
        assert sha256(pdf.embfile_get('DROID_NOTICE.txt')).hexdigest() == '38751245389e1e23f73e6f5384b5cbe7fa972cc4410c5adc9c04b082a0b9561a'
        assert b'Bitstream' in pdf.embfile_get('bitstream-vera-license.txt')
        text = _text(pdf)
        for value in model['sources']['fixture']['payload']['values']:
            assert raw_text(value) in text
        for value in ['设计', '校核', '审核', '批准', '审核记录姓名', '2026-11-17T08:42:03.123456+00:00']:
            assert value in ''.join(text.split())
        assert '追溯记录' in pdf[-1].get_text()
        trace_page = next(index for index, page in enumerate(pdf) if '追溯记录' in page.get_text())
        assert trace_page >= 2
        assert 'cablesim.' not in '\n'.join(pdf[index].get_text() for index in range(trace_page))
        assert model['sources']['fixture']['payload']['method_id'] in ''.join(text.split())
        for page in pdf:
            page_text = page.get_text()
            for value in ('电缆工程研究单位', 'CS-PDF-EXACT', '正式交付文件字体与分页测试', '完整精度', '原始记录可追溯'):
                assert value in page_text
            assert f'第 {page.number + 1} 页 / 共 {len(pdf)} 页' in page_text
        assert '\x00' not in text and '\ufffd' not in text
        _check_bounds(pdf)
    assert model == original


def test_embedded_cjk_latin_and_controlled_scripts_retain_original_unicode():
    model = _model()
    text = '中文 Ω μ − ≤ ≥ ² ³ ⁰ ⁻ ⁺ ₀ ₁ ₂ ₃ ₄ ₅ ₆ ₇ ₈ ₉ ₘ ₛ ₚ m² K·m/W'
    model['sections'][0]['paragraphs'].append(_saved_paragraph(model, text))
    _reset_digest(model)
    with fitz.open(stream=render_pdf(model), filetype='pdf') as pdf:
        actual = ''.join(_text(pdf).split())
        assert ''.join(text.split()) in actual
        assert '\x00' not in actual and '\ufffd' not in actual
        fonts = {font[0]: font for page in pdf for font in page.get_fonts(full=True)}
        assert any('DroidSansFallback' in font[3].replace('-', '') for font in fonts.values())
        assert any('BitstreamVeraSans' in font[3] for font in fonts.values())
        assert any('CableFormalScripts' in font[3] for font in fonts.values())
        assert all(pdf.extract_font(xref)[3] for xref in fonts)
        _check_bounds(pdf)


def test_long_tables_repeat_headers_and_preserve_all_values_without_clipping():
    model = _model(90)
    with fitz.open(stream=render_pdf(model), filetype='pdf') as pdf:
        text = _text(pdf)
        data_pages = [page.get_text() for page in pdf if '排版验证值' in page.get_text()]
        assert len(data_pages) >= 3
        assert all(all(label in text for label in ('参数', '保存原值', '单位', '依据与说明')) for text in data_pages)
        for value in model['sources']['fixture']['payload']['values']:
            assert text.splitlines().count(raw_text(value)) == 1
        assert text.count('K·m/W') == 90
        _check_bounds(pdf)


def test_long_trace_cell_splits_across_pages_without_truncation():
    model = _model()
    note = '长追溯字段保留完整原文，并允许跨页继续。' * 400 + '完整字段结束标记'
    cell = model['tables']['trace']['rows'][0]['cells']['value']
    model['sources']['fixture']['payload']['method_id'] = note
    cell.update(value=note, raw_text=note)
    _reset_digest(model)
    with fitz.open(stream=render_pdf(model), filetype='pdf') as pdf:
        text = _text(pdf)
        # Line and page boundaries may split this phrase, but not its glyphs.
        assert text.count('长') == 400
        assert text.count('溯') == 400 + text.count('追溯记录') + text.count('原始记录可追溯')
        assert '完整字段结束标记' in text
        assert len(pdf) > 6
        _check_bounds(pdf)


@pytest.mark.parametrize('text', ['NUL\x00字符', '不支持的字符𠮷', '图标🧪'])
def test_unsupported_glyphs_fail_explicitly(text):
    model = _model()
    model['sections'][0]['paragraphs'].append(_saved_paragraph(model, text))
    _reset_digest(model)
    with pytest.raises(HTTPException) as failure:
        render_pdf(model)
    assert failure.value.detail['code'] == 'FORMAL_PDF_GLYPH'


def test_overwide_unit_is_rejected_instead_of_split_or_shrunk():
    model = _model()
    unit = 'm/' + 'K' * 200
    model['sources']['fixture']['payload']['unit'] = unit
    for row in model['tables']['values']['rows']:
        row['cells']['unit'].update(value=unit, raw_text=unit)
        row['cells']['value']['unit'] = unit
    _reset_digest(model)
    with pytest.raises(HTTPException) as failure:
        render_pdf(model)
    assert failure.value.detail['code'] == 'FORMAL_PDF_LAYOUT'


def test_cell_unit_is_visible_when_the_contract_has_no_separate_unit_column():
    model = _model()
    table = model['tables']['values']
    table['columns'] = [column for column in table['columns'] if column['key'] == 'value']
    for row in table['rows']:
        row['cells'] = {'value': row['cells']['value']}
    _reset_digest(model)
    with fitz.open(stream=render_pdf(model), filetype='pdf') as pdf:
        text = _text(pdf)
        for value in model['sources']['fixture']['payload']['values']:
            assert raw_text(value) + ' K·m/W' in text


def test_saved_circle_profiles_remain_vector_and_dimension_is_unrounded():
    model = _model()
    geometry = {'outer_diameter_m': .03333333333333333, 'layers': [
        {'label': '导体', 'section_profile': {'outer': {'kind': 'circle', 'x': 0, 'z': 0, 'radius': .01, 'offset': 0}}},
        {'label': '外护套', 'source_target': {'scope': 'common'}, 'section_profile': {
            'outer': {'kind': 'circle', 'x': 0, 'z': 0, 'radius': .016666666666666666, 'offset': 0}}}]}
    model['sources']['fixture']['payload']['geometry'] = geometry
    model['sections'][0]['figures'] = [{'kind': 'cable_section', 'title': '保存的结构截面',
                                       'geometry_ref': {'source_id': 'fixture', 'pointer': '/geometry'},
                                       'input_ref': {'source_id': 'fixture', 'pointer': ''}}]
    _reset_digest(model)
    with fitz.open(stream=render_pdf(model), filetype='pdf') as pdf:
        text = _text(pdf)
        assert '0.03333333333333333 m' in text
        assert '33.3 mm' not in text
        assert '保存的结构截面' in text and '外护套' in text
        figure_page = next(page for page in pdf if '保存的结构截面' in page.get_text())
        assert len(figure_page.get_drawings()) > 3
        _check_bounds(pdf)
    geometry['layers'][0]['section_profile']['outer']['kind'] = 'unsupported'
    _reset_digest(model)
    with fitz.open(stream=render_pdf(model), filetype='pdf') as pdf:
        assert '截面图未生成' in _text(pdf)


def test_section_heading_moves_with_saved_figure_instead_of_becoming_an_orphan():
    model = _model(17)
    for row in model['tables']['values']['rows']:
        row['cells']['context'].update(value='排版夹具', raw_text='排版夹具')
    model['sources']['fixture']['payload']['geometry'] = {'outer_diameter_m': .02, 'layers': [
        {'label': '导体', 'section_profile': {'outer': {'kind': 'circle', 'x': 0, 'z': 0, 'radius': .01, 'offset': 0}}}]}
    model['sections'].insert(1, {'id': 'geometry', 'role': 'body', 'heading': '结构图所属章节',
        'paragraphs': [], 'table_ids': [], 'figures': [{'kind': 'cable_section', 'title': '同页保存截面',
            'geometry_ref': {'source_id': 'fixture', 'pointer': '/geometry'}}]})
    _reset_digest(model)
    with fitz.open(stream=render_pdf(model), filetype='pdf') as pdf:
        heading_page = next(page.number for page in pdf if '结构图所属章节' in page.get_text())
        drawing_page = next(page.number for page in pdf if '同页保存截面' in page.get_text())
        assert heading_page == drawing_page
        _check_bounds(pdf)


def test_presentation_labels_stay_with_the_first_lines_of_literal_formulas():
    model = _model()
    pairs = [(f'保存公式 · 排版标记{index:02d}', f'冻结公式原文{index:02d}') for index in range(37)]
    paragraphs = []
    for label, formula in pairs:
        paragraphs.extend([{'text': label, 'source_ref': None, 'verbatim': False},
                           _saved_paragraph(model, formula)])
    model['sections'][0]['paragraphs'] = paragraphs
    _reset_digest(model)
    with fitz.open(stream=render_pdf(model), filetype='pdf') as pdf:
        for label, formula in pairs:
            label_page = next(page.number for page in pdf if label in page.get_text())
            formula_page = next(page.number for page in pdf if formula in page.get_text())
            assert label_page == formula_page
        _check_bounds(pdf)


def test_bounded_long_metadata_and_embedded_logo_are_visible():
    from base64 import b64encode
    from PIL import Image
    image = BytesIO()
    Image.new('RGB', (160, 50), '#254b62').save(image, 'PNG')
    model = _model()
    model['metadata'].update(organization='电缆技术单位' * 20, number='文件编号' * 20,
                              revision='修订版次' * 8, header='页眉信息' * 40,
                              footer='页脚说明' * 40,
                              logo_data_uri='data:image/png;base64,' + b64encode(image.getvalue()).decode())
    _reset_digest(model)
    with fitz.open(stream=render_pdf(model), filetype='pdf') as pdf:
        text = ''.join(_text(pdf).split())
        for name in ('organization', 'number', 'revision', 'header', 'footer'):
            assert model['metadata'][name] in text
        assert pdf[0].get_images()
        _check_bounds(pdf)


def test_droid_notice_retains_upstream_apache_text():
    notice = Path(__file__).parents[1] / 'backend/kernel/assets/DROID_NOTICE.txt'
    assert sha256(notice.read_bytes()).hexdigest() == '38751245389e1e23f73e6f5384b5cbe7fa972cc4410c5adc9c04b082a0b9561a'
