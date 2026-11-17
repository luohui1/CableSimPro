"""Formal workbooks from the same exact model as PDF, without recalculation.

The printable tables keep JSON numeric text as literal strings. A provenance
index supplies separately typed numeric cells for analysis; their OOXML numeric
lexemes are written explicitly because openpyxl's %.16g formatter loses some
saved IEEE-754 values. The original text remains authoritative after Excel edits.
"""
from __future__ import annotations

from io import BytesIO
import math
import re
import unicodedata
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl import Workbook
from openpyxl.drawing.image import Image as ExcelImage
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.pagebreak import Break
from PIL import Image, ImageDraw

from .formal_contracts import (canonical_bytes, decode_logo, fail, is_number,
                               referenced_value, validate_model_refs)
from .type_specification_drawing import section_layout


_FONT = 'Noto Sans CJK SC'
_INK = '243447'
_MUTED = '526271'
_ACCENT = '187F8C'
_RULE = 'D7DFE5'
_SHADE = 'EEF3F6'
_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
_RAW_SHEET = '追溯原文'
_INDEX_SHEET = '追溯数值'
_INDEX_HEADERS = ('table_id', 'row_id', 'column_key', 'sheet', 'cell', 'raw_text',
                  'numeric_value', 'unit', 'source_id', 'pointer', 'unit_source_id',
                  'unit_pointer', 'numeric_kind')
_MAX_CELL = 30000


def _text(cell, value, *, bold=False, size=10, color=_INK, fill=None):
    text = '' if value is None else str(value)
    if len(text) > _MAX_CELL:
        fail('FORMAL_XLSX_CELL', '可见单元格超过 30000 字符，请减少单条说明；不会静默截断。')
    if any((ord(char) < 32 and char not in '\t\n\r') or
           0xD800 <= ord(char) <= 0xDFFF or ord(char) in (0xFFFE, 0xFFFF) for char in text):
        fail('FORMAL_XLSX_GLYPH', '来源含有 Excel XML 不支持的字符，不会替换或删除来源原文。')
    cell.value = text
    cell.data_type = 's'  # Even '=...', '+...', '-' and '@...' are literal text.
    cell.number_format = '@'
    cell.font = Font(name=_FONT, size=size, bold=bold, color=color)
    cell.alignment = Alignment(vertical='top', wrap_text=True)
    if fill:
        cell.fill = PatternFill('solid', fgColor=fill)
    return cell


def _line_count(text, width):
    maximum = max(1, int(width) - 2)
    return sum(max(1, math.ceil(sum(2 if unicodedata.east_asian_width(char) in 'WF' else 1
                                      for char in line) / maximum))
               for line in str(text).split('\n'))


def _height(texts, widths):
    return max(22, 16 * max((_line_count(text, width) for text, width in zip(texts, widths)), default=1) + 8)


def _row_height(sheet, row, texts, widths):
    height = _height(texts, widths)
    # Excel cannot display rows taller than 409 points. Refuse, don't hide text.
    if height > 400:
        fail('FORMAL_XLSX_LAYOUT', '单行内容超过 Excel 可完整显示的高度；请拆分说明，不会裁切。')
    sheet.row_dimensions[row].height = height


def _merged(sheet, row, text, columns=6, *, title=False, shade=False):
    width = sum(sheet.column_dimensions[get_column_letter(i)].width or 13 for i in range(1, columns + 1))
    height = _height([text], [width])
    span = math.ceil(height / 350)
    sheet.merge_cells(start_row=row, start_column=1, end_row=row + span - 1, end_column=columns)
    _text(sheet.cell(row, 1), text, size=18 if title else 11, bold=title or shade,
          color='FFFFFF' if title else _INK, fill=_INK if title else _SHADE if shade else None)
    for current in range(row, row + span):
        sheet.row_dimensions[current].height = height / span
    if title:
        sheet.row_dimensions[row].height = max(34, sheet.row_dimensions[row].height)
    return row + span


def _setup(sheet, model, widths):
    sheet.sheet_view.showGridLines = False
    for index, width in enumerate(widths, 1):
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.orientation = 'landscape' if sum(widths) > 125 else 'portrait'
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.page_margins.left = sheet.page_margins.right = .3
    sheet.page_margins.top = sheet.page_margins.bottom = .65
    sheet.page_margins.header = sheet.page_margins.footer = .25
    metadata = model['metadata']
    # Excel interprets '&' as a format/page field; escape user-supplied text.
    safe = lambda value: str(value or '').replace('&', '&&')
    def wrap(value):
        lines, line, width = [], '', 0
        for char in value:
            length = 2 if unicodedata.east_asian_width(char) in 'WF' else 1
            if width + length > 100:
                lines.append(line)
                line, width = '', 0
            line += char
            width += length
        return '\n'.join(lines + [line])
    header = '\n'.join(wrap(value) for value in (
        metadata['organization'], metadata.get('header', ''),
        metadata['number'] + ' · ' + metadata['revision']) if value)
    footer = wrap(metadata.get('footer') or model['title'])
    # Excel limits each combined header/footer to 255 characters including
    # formatting codes. Leave room for its font/color/size controls and fields.
    if len(safe(header)) > 220 or len(safe(footer)) + 20 > 220:
        fail('FORMAL_XLSX_HEADER', '单位名称、页眉、编号和版次合计超过 Excel 页眉容量，请缩短元数据；不会截断页眉页脚。')
    sheet.oddHeader.center.text = safe(header)
    sheet.oddFooter.center.text = safe(footer) + '\n第 &P 页 / 共 &N 页'
    sheet.page_margins.top = max(.65, .3 + (header.count('\n') + 1) * 10 / 72)
    sheet.page_margins.bottom = max(.65, .3 + (footer.count('\n') + 2) * 10 / 72)
    for item in (sheet.oddHeader, sheet.oddFooter):
        for part in (item.left, item.center, item.right):
            part.size = 8
            part.font = _FONT
            part.color = _MUTED


def _sheet_name(workbook, heading, trace=False):
    prefix = '追溯·' if trace else ''
    base = prefix + re.sub(r'[\\/*?:\[\]]', ' ', heading).strip(" '")
    base = (base or '工程记录')[:31]
    name, index = base, 2
    while name in workbook.sheetnames:
        suffix = ' ' + str(index)
        name = base[:31 - len(suffix)] + suffix
        index += 1
    return name


def _cover(workbook, model, streams):
    sheet = workbook.active
    sheet.title = '文件信息'
    _setup(sheet, model, [20, 24, 20, 24, 18, 18])
    row = _merged(sheet, 1, model['title'], title=True)
    metadata = model['metadata']
    logo = decode_logo(metadata.get('logo_data_uri'))
    if logo:
        stream = BytesIO(logo)
        streams.append(stream)
        picture = ExcelImage(stream)
        ratio = min(160 / picture.width, 70 / picture.height)
        picture.width, picture.height = picture.width * ratio, picture.height * ratio
        sheet.add_image(picture, 'E3')
        for current in range(3, 7):
            sheet.row_dimensions[current].height = 22
    row = 3
    values = [('单位名称', metadata['organization']), ('文件编号', metadata['number']),
              ('文件版次', metadata['revision']), ('签发日期', metadata.get('issued_on')),
              ('保存状态', model.get('state', {}).get('label', '保存记录')),
              ('页眉', metadata.get('header', '')), ('页脚', metadata.get('footer', ''))]
    for label, value in values:
        _text(sheet.cell(row, 1), label, bold=True, fill=_SHADE)
        sheet.merge_cells(start_row=row, start_column=2, end_row=row, end_column=4)
        _text(sheet.cell(row, 2), value)
        _row_height(sheet, row, [label, value or ''], [20, 68])
        row += 1
    row += 2
    row = _merged(sheet, row, '签署记录', shade=True)
    for column, label in enumerate(('角色', '签署人', '日期'), 1):
        _text(sheet.cell(row, column), label, bold=True, fill=_SHADE)
    row += 1
    for signature in model['signatures']:
        for column, value in enumerate((signature['label'], signature.get('name'), signature.get('date')), 1):
            _text(sheet.cell(row, column), value)
            sheet.cell(row, column).border = Border(bottom=Side(style='thin', color=_RULE))
        _row_height(sheet, row, [signature['label'], signature.get('name') or '', signature.get('date') or ''], [20, 24, 20])
        row += 1
    row += 2
    for paragraph in (
        '签栏来自与本文件范围一致的已有签核记录；没有记录的角色留空。',
        '工程表保留完整原始数值文本及原记录单位，不作舍入或单位换算。',
        '“追溯数值”提供可用于分析的数值副本与来源索引；Excel 的显示精度和另存行为可能改变该副本，核对请用原文列。',
        '“追溯原文”分片保存完整来源模型；拼接 json_chunk 即可还原全部输入快照、输出、方法清单及来源摘要。'):
        row = _merged(sheet, row, paragraph)
    sheet.freeze_panes = 'B3'
    sheet.print_area = f'A1:F{row - 1}'
    return sheet


def _saved_section(sheet, model, figure, row, columns, streams):
    """Draw only stored supported circular contours, never a guessed outline."""
    artifact = referenced_value(model, figure['geometry_ref'])
    layout = section_layout({'results': {'geometry': {'artifact': artifact}}}, width=510)
    row = _merged(sheet, row, figure.get('title') or '保存的结构截面', columns, shade=True)
    if layout is None:
        return _merged(sheet, row, '保存轮廓缺失或超出当前圆形视图范围，请参照完整来源与分层数据。', columns)
    _geometry, _rows, _height, extent, _left, _scale, _cx, _cy, ordered = layout
    picture = Image.new('RGB', (720, 720), 'white')
    pen = ImageDraw.Draw(picture)
    scale = 320 / extent
    shades = ('#d0d0d0', '#ededed', '#b8b8b8', '#f5f5f5')
    for index, item in ordered:
        profile = item['section_profile']['outer']
        cx, cy = 360 + profile['x'] * scale, 360 - profile['z'] * scale
        radius = (profile['radius'] + profile['offset']) * scale
        pen.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=shades[index % 4], outline='#' + _INK, width=2)
    stream = BytesIO()
    picture.save(stream, 'PNG')
    stream.seek(0)
    streams.append(stream)
    image = ExcelImage(stream)
    image.width = image.height = 360
    sheet.add_image(image, f'A{row}')
    sheet.row_breaks.append(Break(id=row - 1))
    for current in range(row, row + 18):
        sheet.row_dimensions[current].height = 16
    row += 18
    row = _merged(sheet, row, '图形只呈现保存的轮廓；精确尺寸、材料和单位以同一来源的分层表为准。', columns)
    sheet.row_breaks.append(Break(id=row - 1))
    return row


def _section(workbook, model, section, numeric_index, streams):
    tables = [model['tables'][identifier] for identifier in section['table_ids']]
    def columns(table):
        result = []
        has_unit = any(column.get('role') == 'unit' for column in table['columns'])
        for column in table['columns']:
            result.append(column)
            if not has_unit and any(row['cells'][column['key']].get('unit') for row in table['rows']):
                result.append({'key': '__unit__' + column['key'], 'label': column['label'] + ' · 单位',
                               'role': 'unit', 'unit_of': column['key']})
        return result
    count = max([2] + [len(columns(table)) for table in tables])
    widths = [18] * count if tables else [36, 80]
    for table in tables:
        for index, column in enumerate(columns(table)):
            width = {'text': 36, 'value': 28, 'unit': 18, 'status': 20}.get(column.get('role'), 28)
            if len(columns(table)) == 2 and column.get('role') == 'text':
                width = 100 if index == 1 else 28
            widths[index] = max(widths[index], width)
    sheet = workbook.create_sheet(_sheet_name(workbook, section['heading'], section['role'] == 'trace'))
    sheet.sheet_properties.tabColor = _MUTED if section['role'] == 'trace' else _ACCENT
    _setup(sheet, model, widths)
    row = _merged(sheet, 1, section['heading'], count, title=True)
    row = _merged(sheet, row, model['metadata']['number'] + ' · ' + model['metadata']['revision'], count)
    for paragraph in section.get('paragraphs', []):
        row = _merged(sheet, row, paragraph['text'], count)
    row += 1
    for figure in section.get('figures', []):
        row = _saved_section(sheet, model, figure, row, count, streams)
    first_header = None
    for table_id in section['table_ids']:
        table = model['tables'][table_id]
        display = columns(table)
        if table.get('title'):
            row = _merged(sheet, row, table['title'], count, shade=True)
        for column, definition in enumerate(display, 1):
            _text(sheet.cell(row, column), definition['label'], bold=True, fill=_SHADE)
        _row_height(sheet, row, [item['label'] for item in display], widths)
        first_header = first_header or row
        row += 1
        for entry in table['rows']:
            texts = []
            for column, definition in enumerate(display, 1):
                if 'unit_of' in definition:
                    unit = entry['cells'][definition['unit_of']].get('unit') or ''
                    _text(sheet.cell(row, column), unit)
                    texts.append(unit)
                    continue
                cell = entry['cells'][definition['key']]
                target = _text(sheet.cell(row, column), cell['raw_text'],
                               fill='F7FAFC' if row % 2 == 0 else None)
                target.border = Border(bottom=Side(style='hair', color=_RULE))
                if is_number(cell['value']):
                    if len(cell['raw_text']) > 80:
                        fail('FORMAL_XLSX_LAYOUT', '完整数值超过可读列宽，不会截断或舍入。')
                    target.alignment = Alignment(horizontal='right', vertical='top', wrap_text=False)
                    # Auto width preserves the full JSON lexeme on screen.
                    widths[column - 1] = max(widths[column - 1], len(cell['raw_text']) + 2)
                    numeric_index.append((table_id, entry['id'], definition['key'], sheet.title, target.coordinate, cell))
                texts.append(cell['raw_text'])
            height = _height(texts, widths)
            span = math.ceil(height / 350)
            if span > 1:
                for column in range(1, len(display) + 1):
                    sheet.merge_cells(start_row=row, start_column=column, end_row=row + span - 1, end_column=column)
            for current in range(row, row + span):
                sheet.row_dimensions[current].height = height / span
            row += span
        row += 2
    for index, width in enumerate(widths, 1):
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.freeze_panes = f'B{(first_header or 1) + 1}'
    sheet.print_title_rows = '1:2'
    sheet.print_area = f'A1:{get_column_letter(count)}{row - 1}'


def _archive(workbook, model, index):
    sheet = workbook.create_sheet(_INDEX_SHEET)
    sheet.sheet_properties.tabColor = _MUTED
    widths = [28, 32, 20, 32, 12, 30, 30, 18, 42, 64, 40, 64, 16]
    _setup(sheet, model, widths)
    for column, header in enumerate(_INDEX_HEADERS, 1):
        _text(sheet.cell(1, column), header, bold=True, fill=_SHADE)
    lexemes = {}
    for row, (table_id, row_id, key, name, address, cell) in enumerate(index, 2):
        reference, unit_ref = cell['value_ref'], cell.get('unit_ref') or {}
        kind = 'int' if isinstance(cell['value'], int) else 'float'
        if kind == 'int' and abs(cell['value']) > 2 ** 53 - 1:
            kind = 'int-text'
        values = (table_id, row_id, key, name, address, cell['raw_text'], cell['raw_text'], cell.get('unit'),
                  reference['source_id'], reference['pointer'], unit_ref.get('source_id'), unit_ref.get('pointer'), kind)
        for column, value in enumerate(values, 1):
            _text(sheet.cell(row, column), value)
        if kind != 'int-text':
            target = sheet.cell(row, 7)
            target.value = cell['value']
            target.number_format = 'General'
            lexemes[target.coordinate] = cell['raw_text']
        _row_height(sheet, row, values, widths)
    sheet.auto_filter.ref = sheet.dimensions
    sheet.freeze_panes = 'F2'
    sheet.print_title_rows = '1:1'
    sheet.print_area = sheet.dimensions
    raw = workbook.create_sheet(_RAW_SHEET)
    _setup(raw, model, [16, 110])
    raw.sheet_properties.tabColor = _MUTED
    for column, header in enumerate(('chunk_index', 'json_chunk'), 1):
        _text(raw.cell(1, column), header, bold=True, fill=_SHADE)
    text = canonical_bytes(model).decode('utf-8')
    for index, offset in enumerate(range(0, len(text), _MAX_CELL), 1):
        raw.cell(index + 1, 1, index)
        _text(raw.cell(index + 1, 2), text[offset:offset + _MAX_CELL])
        raw.row_dimensions[index + 1].height = 30
    raw.freeze_panes = 'B2'
    raw.sheet_state = 'hidden'  # Complete machine archive; visible trace sheets remain printable.
    return workbook.index(sheet) + 1, lexemes


def _exact_numeric_xml(content: bytes, sheet_number: int, lexemes: dict[str, str]) -> bytes:
    target = f'xl/worksheets/sheet{sheet_number}.xml'
    result = BytesIO()
    with ZipFile(BytesIO(content)) as source, ZipFile(result, 'w', ZIP_DEFLATED) as output:
        for item in source.infolist():
            data = source.read(item.filename)
            if item.filename == target:
                document = ET.fromstring(data)
                matched = set()
                for cell in document.iter('{' + _NS + '}c'):
                    address = cell.attrib.get('r')
                    if address in lexemes:
                        value = cell.find('{' + _NS + '}v')
                        if value is None or cell.attrib.get('t') != 'n':
                            fail('FORMAL_XLSX_INTEGRITY', '数值索引不是预期的 Excel 数值单元格。')
                        value.text = lexemes[address]
                        matched.add(address)
                if matched != set(lexemes):
                    fail('FORMAL_XLSX_INTEGRITY', '数值索引写入不完整。')
                data = ET.tostring(document, encoding='utf-8')
            output.writestr(item, data)
    return result.getvalue()


def render_xlsx(model: dict) -> bytes:
    validate_model_refs(model)
    workbook = Workbook()
    workbook.properties.title = model['title']
    workbook.properties.subject = model['metadata']['number']
    workbook.properties.creator = model['metadata']['organization']
    workbook.properties.description = '完整保存记录及精确数值来源；没有独立签核记录的签栏留空。'
    streams, numeric_index = [], []
    _cover(workbook, model, streams)
    for section in model['sections']:
        _section(workbook, model, section, numeric_index, streams)
    sheet_number, lexemes = _archive(workbook, model, numeric_index)
    output = BytesIO()
    try:
        workbook.save(output)
        return _exact_numeric_xml(output.getvalue(), sheet_number, lexemes)
    finally:
        workbook.close()
        for stream in streams:
            stream.close()
