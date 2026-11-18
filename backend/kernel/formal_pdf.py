"""Lay out frozen formal-delivery models; never query or calculate engineering data.

All engineering text comes from literal contract cells. The only derived numbers
are page / figure indices and coordinates used to draw saved circular profiles.
The complete canonical model is attached, including every frozen source payload.
"""
from __future__ import annotations

from functools import lru_cache
from io import BytesIO
import math
from pathlib import Path
import re
from threading import RLock

import reportlab
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import BaseDocTemplate, CondPageBreak, Flowable, Frame, Image, KeepTogether, LongTable, PageBreak, PageTemplate, Spacer, TableStyle
from reportlab.platypus.doctemplate import LayoutError

from .formal_contracts import TITLES, canonical_bytes, decode_logo, fail, is_number, raw_text, referenced_value, validate_model_refs
from .formal_presentation import cell_text, cell_unit


_LOCK = RLock()
_CJK = 'CableFormalChinese'
_LATIN = 'CableFormalLatin'
_SCRIPTS = 'CableFormalScripts'
_INK = colors.HexColor('#243447')
_MUTED = colors.HexColor('#526271')
_RULE = colors.HexColor('#c3cbd1')
_SHADE = colors.HexColor('#eef2f5')
_MARGIN = 40
_PADDING = 7
_CELL_SIZE = 9
_SUPERSCRIPTS = dict(zip('⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁱⁿ', '0123456789+-=()in'))
_SUBSCRIPTS = dict(zip('₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ', '0123456789+-=()aehijklmnoprstuvx'))
_OPEN = set('（([{《〈「『【〔')
_CLOSE = set('，。！？；：、）)]}》〉」』】〕,.!?;:')


def _register_fonts() -> None:
    if _CJK in pdfmetrics.getRegisteredFontNames():
        return
    import fitz
    data = fitz.Font('cjk').buffer
    pdfmetrics.registerFont(TTFont(_CJK, BytesIO(data)))
    pdfmetrics.registerFont(TTFont(_LATIN, str(Path(reportlab.__file__).parent / 'fonts' / 'Vera.ttf')))
    # Controlled super/subscript fallback. Keep the original Unicode codepoint
    # in the PDF's ToUnicode map while drawing a scaled, raised/lowered base
    # glyph. No font binary is changed on disk, and no unit text is rewritten.
    scripts = TTFont(_SCRIPTS, BytesIO(data))
    scripts.face.name = b'CableFormalScripts'
    scripts.face.familyName = b'Cable Formal Scripts'
    scripts.face.fullName = b'Cable Formal Scripts'
    for symbol, base in {**_SUPERSCRIPTS, **_SUBSCRIPTS}.items():
        scripts.face.charToGlyph[ord(symbol)] = scripts.face.charToGlyph[ord(base)]
        scripts.face.charWidths[ord(symbol)] = scripts.face.charWidths[ord(base)]
    pdfmetrics.registerFont(scripts)


@lru_cache(maxsize=8192)
def _glyph(character: str) -> tuple[str, float, float]:
    if character in _SUPERSCRIPTS:
        return _SCRIPTS, .72, .30
    if character in _SUBSCRIPTS:
        return _SCRIPTS, .72, -.18
    code = ord(character)
    if code < 32 or code == 127:
        fail('FORMAL_PDF_GLYPH', f'正式 PDF 不接受控制字符 U+{code:04X}。')
    candidates = (_LATIN, _CJK) if code < 127 else (_CJK, _LATIN)
    for name in candidates:
        if pdfmetrics.getFont(name).face.charToGlyph.get(code, 0):
            return name, 1.0, 0.0
    fail('FORMAL_PDF_GLYPH', f'正式 PDF 内嵌字体不支持字符 U+{code:04X}（{character}）；请使用受支持的文字，不会替换为方框或空字。')


def _width(text: str, size: float) -> float:
    total = 0.0
    for char in text:
        font, scale, _rise = _glyph(char)
        total += pdfmetrics.stringWidth(char, font, size * scale)
    return total


def _draw_line(surface, text: str, x: float, y: float, size: float, color=_INK) -> None:
    output = surface.beginText(x, y)
    output.setFillColor(color)
    previous, run = None, ''
    for character in text:
        settings = _glyph(character)
        if settings != previous and run:
            output.textOut(run)
            run = ''
        if settings != previous:
            font, scale, rise = settings
            output.setFont(font, size * scale)
            output.setRise(size * rise)
            previous = settings
        run += character
    if run:
        output.textOut(run)
    surface.drawText(output)


def _wrap(text: str, width: float, size: float, atomic: bool) -> list[str]:
    """Wrap complete text, retaining numeric/unit atoms and all visible glyphs."""
    lines = []
    for paragraph in text.split('\n'):
        if atomic:
            if _width(paragraph, size) > width + .01:
                fail('FORMAL_PDF_LAYOUT', '完整数值或单位超过可用列宽；请减少表列，不会舍入、缩略或拆开单位。')
            lines.append(paragraph)
            continue
        if not paragraph:
            lines.append('')
            continue
        # Latin words / identifiers prefer natural boundaries. Long exact
        # hashes and JSON Pointers can wrap without inserting spaces or hyphens.
        unit_letters = r'A-Za-z0-9_\u0370-\u03ff\u2070-\u209f²³¹°µ'
        tokens = re.findall(r'[' + unit_letters + r']+(?:[./:·*^+-][' + unit_letters + r']+)*| +|.', paragraph)
        paragraph_lines = []
        current, length = [], 0.0
        for token in tokens:
            token_width = _width(token, size)
            if token_width > width + .01:
                pieces = list(token)
            else:
                pieces = [token]
            for piece in pieces:
                piece_width = _width(piece, size)
                if piece_width > width + .01:
                    fail('FORMAL_PDF_LAYOUT', '可用列宽小于一个完整字形，无法无裁切排版。')
                if current and length + piece_width > width + .01:
                    # Do not strand opening punctuation at a line end or
                    # closing punctuation at a line start when a pair fits.
                    carry = []
                    if ((current[-1] in _OPEN or (piece[0] in _CLOSE and len(current) > 1))
                            and _width(current[-1] + piece, size) <= width):
                        carry = [current.pop()]
                    if current:
                        paragraph_lines.append(current)
                    current, length = carry, _width(''.join(carry), size)
                if not current and piece.isspace():
                    continue
                current.append(piece)
                length += piece_width
        if current or not paragraph_lines:
            paragraph_lines.append(current)
        # Avoid a final one-character line in ordinary prose and labels. Move
        # complete atoms, so this never bisects an inline engineering unit.
        if len(paragraph_lines) > 1:
            previous, last = paragraph_lines[-2:]
            while len(previous) > 1 and _width(''.join(last).strip(' '), size) < size * 3:
                atom = previous[-1]
                if _width(atom + ''.join(last), size) > width:
                    break
                last.insert(0, previous.pop())
        lines.extend(''.join(line).strip(' ') for line in paragraph_lines)
    return lines


class _Literal(Flowable):
    """Exact Unicode text with measured glyph runs and two-line page splits."""

    def __init__(self, text: str, *, size=10, color=_INK, atomic=False,
                 align='left', before=0, after=0, keep=False, lines=None):
        super().__init__()
        self.text = text
        self.size, self.leading, self.color = size, size * 1.48, color
        self.atomic, self.align = atomic, align
        self.spaceBefore, self.spaceAfter, self.keepWithNext = before, after, int(keep)
        self._fixed_lines = lines
        self._lines = []

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        self._lines = self._fixed_lines if self._fixed_lines is not None else _wrap(self.text, availWidth, self.size, self.atomic)
        self.height = max(1, len(self._lines)) * self.leading
        return self.width, self.height

    def split(self, availWidth, availHeight):
        # Tables can pass the outer column width after measuring this flowable
        # inside cell padding. Keep the measured content width: widening here
        # can turn a required split into one unsplit part and break row layout.
        if self.width > 0:
            availWidth = min(availWidth, self.width)
        self.wrap(availWidth, availHeight)
        count = int(availHeight // self.leading)
        if count >= len(self._lines):
            return [self]
        if count < 2:
            return []
        if len(self._lines) - count == 1:
            count -= 1
        if count < 2:
            return []
        def part(lines, first):
            return _Literal('\n'.join(lines), size=self.size, color=self.color,
                            atomic=self.atomic, align=self.align,
                            before=self.spaceBefore if first else 0,
                            after=0 if first else self.spaceAfter,
                            keep=False if first else self.keepWithNext, lines=lines)
        return [part(self._lines[:count], True), part(self._lines[count:], False)]

    def draw(self):
        for index, text in enumerate(self._lines):
            length = _width(text, self.size)
            x = self.width - length if self.align == 'right' else (self.width - length) / 2 if self.align == 'center' else 0
            _draw_line(self.canv, text, x, self.height - index * self.leading - self.size, self.size, self.color)


def _table_style(*, header=True) -> TableStyle:
    rules = [
        ('FONTNAME', (0, 0), (-1, -1), _LATIN),
        ('FONTSIZE', (0, 0), (-1, -1), _CELL_SIZE),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('GRID', (0, 0), (-1, -1), .35, _RULE),
        ('LEFTPADDING', (0, 0), (-1, -1), _PADDING),
        ('RIGHTPADDING', (0, 0), (-1, -1), _PADDING),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]
    if header:
        rules.extend([('BACKGROUND', (0, 0), (-1, 0), _SHADE),
                      ('LINEBELOW', (0, 0), (-1, 0), .7, _MUTED)])
    return TableStyle(rules)


def _cell_text(cell: dict, columns: list[dict]) -> str:
    text = cell_text(cell)
    if cell_unit(cell) and not any(column.get('role') == 'unit' for column in columns):
        text += ' ' + cell_unit(cell)
    return text


def _column_widths(table: dict, width: float) -> list[float]:
    columns = table['columns']
    weights = [column.get('weight', 1) for column in columns]
    if any(not isinstance(weight, (int, float)) or not math.isfinite(weight) or weight <= 0 for weight in weights):
        fail('FORMAL_PDF_LAYOUT', '表格列宽权重必须为有限正数。')
    minimums = []
    for column in columns:
        minimum = 28.0
        for row in table['rows']:
            cell = row['cells'][column['key']]
            if is_number(cell['value']) or column.get('role') == 'unit':
                minimum = max(minimum, max((_width(line, _CELL_SIZE) for line in _cell_text(cell, columns).split('\n')), default=0))
        minimums.append(minimum + 2 * _PADDING)
    if sum(minimums) > width + .01:
        fail('FORMAL_PDF_LAYOUT', '表格完整数值与单位无法放入 A4 页面；请改为参数、数值、单位长表，不会缩小或截断工程值。')
    result, remaining = {}, set(range(len(columns)))
    while remaining:
        free = width - sum(result.values())
        total = sum(weights[index] for index in remaining)
        constrained = [index for index in remaining if free * weights[index] / total < minimums[index]]
        if not constrained:
            result.update({index: free * weights[index] / total for index in remaining})
            break
        for index in constrained:
            result[index] = minimums[index]
            remaining.remove(index)
    return [result[index] for index in range(len(columns))]


def _model_table(table: dict, width: float) -> list[Flowable]:
    columns = table['columns']
    rows = [[_Literal(column['label'], size=_CELL_SIZE) for column in columns]]
    for row in table['rows']:
        cells = []
        for column in columns:
            cell = row['cells'][column['key']]
            numeric = is_number(cell['value'])
            cells.append(_Literal(_cell_text(cell, columns), size=_CELL_SIZE,
                                  atomic=numeric or column.get('role') == 'unit',
                                  align='right' if numeric else 'left'))
        rows.append(cells)
    widths = _column_widths(table, width)
    table_flow = LongTable(rows, colWidths=widths, repeatRows=1,
                           splitByRow=1, splitInRow=1, hAlign='LEFT', spaceAfter=13)
    table_flow.setStyle(_table_style())
    result = []
    if table.get('title'):
        # Keep the caption with the beginning of a table, not its entire
        # splittable body. keepWithNext on a long table wastes a whole page.
        caption = _Literal(('T' + str(table['display_number']) + '  ' if table.get('display_number') else '') + table['title'], size=10.5, before=8, after=6)
        opening = caption.wrap(width, 1000)[1] + caption.getSpaceBefore() + caption.getSpaceAfter()
        for index, row in enumerate(rows[:2]):
            heights = [cell.wrap(column_width - 2 * _PADDING, 1000)[1]
                       for cell, column_width in zip(row, widths)]
            # Three lines keep a short row whole; longer cells can split into
            # at least two lines without stranding a one-line remainder.
            if index:
                heights = [min(height, 3 * cell.leading) for height, cell in zip(heights, row)]
            opening += max(heights) + 12  # Actual top and bottom cell padding.
        result.extend([CondPageBreak(opening), caption])
    result.append(table_flow)
    return result


class _SavedCircles(Flowable):
    def __init__(self, ordered, extent, width, labels=None):
        super().__init__()
        self.ordered, self.extent = ordered, extent
        self.width, self.height = width, 236
        self.labels = labels or []
        self.diagram_width = width * .48 if self.labels else width
        if self.labels:
            self.height = max(self.height, 24 + sum(item.height + 4 for item in self.labels))

    def draw(self):
        surface = self.canv
        scale = min(self.diagram_width - 28, self.height - 32) / (2 * self.extent)
        cx, cy = self.diagram_width / 2, self.height / 2
        surface.setStrokeColor(_RULE)
        surface.setLineWidth(.45)
        surface.rect(0, 0, self.width, self.height, stroke=1, fill=0)
        shades = ('#d4dce3', '#f2f4f6', '#aabac7', '#e4e9ed', '#bdcbd5', '#f8f9fa')
        for index, row in self.ordered:
            profile = row['section_profile']['outer']
            surface.setFillColor(colors.HexColor(shades[index % len(shades)]))
            surface.setStrokeColor(_MUTED)
            surface.circle(cx + profile['x'] * scale, cy + profile['z'] * scale,
                           (profile['radius'] + profile['offset']) * scale, fill=1, stroke=1)
        y = self.height - 12
        for index, label in enumerate(self.labels):
            y -= label.height
            surface.setFillColor(colors.HexColor(shades[index % len(shades)]))
            surface.rect(self.diagram_width + 8, y + label.height - 9, 7, 7, fill=1, stroke=1)
            label.drawOn(surface, self.diagram_width + 22, y)
            y -= 4


def _figure(figure: dict, model: dict, width: float, prefix=None) -> list[Flowable]:
    if figure.get('kind') != 'cable_section':
        fail('FORMAL_PDF_LAYOUT', '不支持的正式文件图形类型；不会以猜测图替代。')
    from .type_specification_drawing import section_layout
    geometry = referenced_value(model, figure['geometry_ref'])
    # The shared helper checks finite saved circle profiles, including off-axis
    # cores. It does not rebuild geometry or infer unsupported contours.
    layout = section_layout({'results': {'geometry': {'artifact': geometry}}}, width)
    title = _Literal(figure['title'], size=11, before=10, after=6, keep=True)
    opening = [prefix] if prefix is not None else []
    if layout is None or not math.isfinite(layout[3]):
        return [KeepTogether([*opening, title, _Literal('截面图未生成：保存轮廓缺失或超出当前图纸范围（圆形、最多 32 层）；请引用已验证的工程图。', after=10)])]
    _geometry, rows, _height, extent, _left, _scale, _cx, _cy, ordered = layout
    labels = [_Literal(str(index + 1) + '. ' + (row.get('label') or '未记录层名称'), size=9)
              for index, row in enumerate(rows)]
    for label in labels:
        label.wrap(width * .52 - 34, 1000)
    beside = 24 + sum(label.height + 4 for label in labels) <= 360
    diagram = _SavedCircles(ordered, extent, width, labels if beside else None)
    diameter = geometry.get('outer_diameter_m')
    caption = ('保存外径：' + raw_text(diameter) + ' m') if is_number(diameter) and math.isfinite(diameter) else '保存的几何记录未提供外径。'
    if figure.get('diameter_cell'):
        caption = '外径：' + cell_text(figure['diameter_cell']) + ' ' + cell_unit(figure['diameter_cell'])
    result = [KeepTogether([*opening, title, diagram, _Literal(caption, size=9, before=6, after=8)])]
    if beside:
        return result
    labels = [[_Literal('图层', size=9), _Literal('保存的结构层名称', size=9)]]
    for index, row in enumerate(rows):
        labels.append([_Literal(str(index + 1), size=9), _Literal(row.get('label') or '未记录层名称', size=9)])
    legend = LongTable(labels, colWidths=[48, width - 48], repeatRows=1, splitByRow=1, splitInRow=1, hAlign='LEFT', spaceAfter=12)
    legend.setStyle(_table_style())
    result.append(legend)
    return result


def _cover(model: dict, width: float) -> list[Flowable]:
    metadata = model['metadata']
    result = []
    logo = decode_logo(metadata.get('logo_data_uri'))
    if logo:
        mark = Image(BytesIO(logo))
        factor = min(108 / mark.imageWidth, 52 / mark.imageHeight)
        mark.drawWidth, mark.drawHeight = mark.imageWidth * factor, mark.imageHeight * factor
        mark.hAlign = 'LEFT'
        result.extend([mark, Spacer(1, 12)])
    result.extend([_Literal(metadata['organization'], size=13, after=12, keep=True),
                   _Literal(model.get('title') or TITLES[model['kind']], size=26, after=20, keep=True)])
    fields = [('文件编号', metadata['number']), ('版次', metadata['revision']),
              ('签发日期', metadata.get('issued_on') or '')]
    if model.get('subtitle'):
        fields.insert(0, ('工程 / 研究', model['subtitle']))
    information = LongTable([[_Literal(key, size=10), _Literal(value, size=10)] for key, value in fields],
                            colWidths=[88, width - 88], hAlign='LEFT', spaceAfter=20,
                            splitByRow=1, splitInRow=1)
    information.setStyle(_table_style(header=False))
    information.setStyle(TableStyle([('BACKGROUND', (0, 0), (0, -1), _SHADE)]))
    result.append(information)
    result.append(_Literal('编制与审核签栏', size=13, before=8, after=8, keep=True))
    signatures = model['signatures']
    cells = [[_Literal(item['label'], size=10) for item in signatures],
             [_Literal('签字：' + (item.get('name') or ''), size=10) for item in signatures],
             [_Literal('日期：' + (item.get('date') or ''), size=8) for item in signatures]]
    sign_table = LongTable(cells, colWidths=[width / 4] * 4, minRowHeights=[27, 43, 34], hAlign='LEFT', spaceAfter=8)
    sign_table.setStyle(_table_style())
    result.append(KeepTogether([sign_table, _Literal('签栏来自保存的记录；未取得对应签署记录的栏位留空。', size=8, color=_MUTED)]))
    result.append(PageBreak())
    return result


def _running_parts(metadata: dict, width: float):
    organization = _Literal(metadata['organization'], size=8.2)
    identity = _Literal('编号：' + metadata['number'] + '  版次：' + metadata['revision'], size=8.2, align='right')
    left_width, right_width = width * .45 - 7, width * .55 - 7
    top_height = max(organization.wrap(left_width, 1000)[1], identity.wrap(right_width, 1000)[1])
    header = _Literal(metadata.get('header') or '', size=8.2, color=_MUTED)
    header_height = header.wrap(width, 1000)[1] if metadata.get('header') else 0
    footer = _Literal(metadata.get('footer') or '', size=8, color=_MUTED)
    footer_height = footer.wrap(width, 1000)[1] if metadata.get('footer') else 0
    top_margin = 20 + top_height + (header_height + 5 if header_height else 0) + 16
    bottom_margin = 24 + footer_height + (7 if footer_height else 0) + 18

    def draw(surface, page_number, total):
        page_width, page_height = A4
        y = page_height - 20 - top_height
        organization.drawOn(surface, _MARGIN, page_height - 20 - organization.height)
        identity.drawOn(surface, page_width - _MARGIN - right_width, page_height - 20 - identity.height)
        if header_height:
            header.drawOn(surface, _MARGIN, y - 5 - header_height)
        surface.setStrokeColor(_RULE)
        surface.setLineWidth(.6)
        surface.line(_MARGIN, page_height - top_margin + 9, page_width - _MARGIN, page_height - top_margin + 9)
        surface.line(_MARGIN, bottom_margin - 8, page_width - _MARGIN, bottom_margin - 8)
        if footer_height:
            footer.drawOn(surface, _MARGIN, 24 + 7)
        _draw_line(surface, f'第 {page_number} 页 / 共 {total} 页', page_width - _MARGIN - _width(f'第 {page_number} 页 / 共 {total} 页', 8), 17, 8, _MUTED)
    return top_margin, bottom_margin, draw


def render_pdf(model: dict) -> bytes:
    """Create a self-contained PDF from the exact, integrity-checked model."""
    validate_model_refs(model)
    with _LOCK:
        _register_fonts()
        try:
            return _render_pdf(model)
        except LayoutError as error:
            fail('FORMAL_PDF_LAYOUT', '文件无法在不裁切的前提下完成分页，请缩小单份交付范围。' + str(error))


def _render_pdf(model: dict) -> bytes:
    output = BytesIO()
    width = A4[0] - 2 * _MARGIN
    metadata = model['metadata']
    top, bottom, draw_running = _running_parts(metadata, width)
    document = BaseDocTemplate(output, pagesize=A4, leftMargin=_MARGIN, rightMargin=_MARGIN,
                               topMargin=top, bottomMargin=bottom,
                               title=model.get('title') or TITLES[model['kind']],
                               author=metadata['organization'], creator='CableSimPro',
                               initialFontName=_LATIN, initialFontSize=10)
    document.addPageTemplates(PageTemplate(id='formal', frames=[Frame(
        _MARGIN, bottom, width, A4[1] - top - bottom,
        leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)]))

    class NumberedCanvas(canvas.Canvas):
        def __init__(self, *args, **kwargs):
            kwargs.update(initialFontName=_LATIN, initialFontSize=10, invariant=1)
            super().__init__(*args, **kwargs)
            self._saved_pages = []

        def showPage(self):
            if len(self._saved_pages) >= 1000:
                fail('FORMAL_PDF_LAYOUT', '正式文件超过 1000 页，请减少所选运行；不会截断追溯记录。')
            self._saved_pages.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._saved_pages)
            for state in self._saved_pages:
                self.__dict__.update(state)
                draw_running(self, self._pageNumber, total)
                super().showPage()
            super().save()

    story = _cover(model, width)
    in_trace = False
    for section in model['sections']:
        if section['role'] == 'trace' and not in_trace:
            story.extend([PageBreak(), _Literal('追溯记录', size=21, after=14, keep=True)])
            in_trace = True
        heading = section.get('heading') or ''
        paragraphs = section.get('paragraphs', [])
        figures = section.get('figures', [])
        heading_flow = _Literal(heading, size=14, before=10, after=8) if heading and heading != '追溯记录' else None
        figure_heading = heading_flow if figures and not paragraphs else None
        if heading_flow is not None and figure_heading is None:
            story.extend([CondPageBreak(92), heading_flow])
        for index, paragraph in enumerate(paragraphs):
            flow = _Literal(paragraph['text'], size=10, after=8)
            if (not paragraph.get('verbatim') and index + 1 < len(paragraphs)
                    and paragraphs[index + 1].get('verbatim')):
                # A presentation label followed by literal saved text (formula,
                # conclusion, assumptions) must share at least the first lines.
                # Do not KeepTogether the complete source paragraph: it may
                # legitimately occupy several pages.
                flow.wrap(width, 1000)
                following = _Literal(paragraphs[index + 1]['text'], size=10)
                following.wrap(width, 1000)
                story.append(CondPageBreak(min(flow.height, 3 * flow.leading)
                                          + min(following.height, 2 * following.leading) + 8))
            story.append(flow)
        for index, figure in enumerate(figures):
            story.extend(_figure(figure, model, width, prefix=figure_heading if index == 0 else None))
        for table_id in section['table_ids']:
            story.extend(_model_table(model['tables'][table_id], width))
    document.build(story, canvasmaker=NumberedCanvas)
    import fitz
    with fitz.open(stream=output.getvalue(), filetype='pdf') as result:
        result.set_metadata({'title': model.get('title') or TITLES[model['kind']],
                             'author': metadata['organization'], 'subject': metadata['number'],
                             'creator': 'CableSimPro', 'producer': 'CableSimPro'})
        result.embfile_add('formal-model.json', canonical_bytes(model), filename='formal-model.json',
                           desc='完整冻结交付模型、原始值、签署记录依据及来源快照；未重新计算。')
        # A PDF distributes its embedded font subsets. Keep the unmodified
        # source notices with the exported file as well as the runtime package.
        # Droid upstream: ArtifexSoftware/mupdf 1.24.10 resources/fonts/droid/NOTICE.
        for name, path in (
            ('DROID_NOTICE.txt', Path(__file__).with_name('assets') / 'DROID_NOTICE.txt'),
            ('bitstream-vera-license.txt', Path(reportlab.__file__).parent / 'fonts' / 'bitstream-vera-license.txt'),
        ):
            result.embfile_add(name, path.read_bytes(), filename=name, desc='Embedded font license and copyright notice')
        return result.tobytes(garbage=3, deflate=True)
