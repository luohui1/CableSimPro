"""Print the canonical customer specification with embedded Chinese and stable tables."""
from html import escape
from html.parser import HTMLParser
from io import BytesIO
import re
from threading import Lock

from .type_specification import STATUS_NAMES, chapter_names, chapter_bodies, document_revisions, source_evidence

_font_lock = Lock()


class _Blocks(HTMLParser):
    """Read only the small paragraph/table vocabulary emitted by our renderer."""
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.blocks, self.table, self.row, self.cell, self.block = [], None, None, None, None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == 'table':
            self.table = {'kind':'table', 'rows':[], 'widths':[float(value) for value in attributes.get('data-widths','').split(',') if value]}
        elif self.table is not None:
            if tag == 'tr': self.row = []
            elif tag in ('td','th'): self.cell = []
        elif tag in ('p','h1','h2','h3'):
            self.block = {'kind':tag, 'class':attributes.get('class',''), 'parts':[]}
        if tag == 'br': self.handle_data('\n')

    def handle_data(self, data):
        if self.cell is not None: self.cell.append(data)
        elif self.block is not None: self.block['parts'].append(data)

    def handle_endtag(self, tag):
        if tag in ('td','th') and self.cell is not None:
            self.row.append(''.join(self.cell)); self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.table['rows'].append(self.row); self.row = None
        elif tag == 'table' and self.table is not None:
            self.blocks.append(self.table); self.table = None
        elif self.block is not None and tag == self.block['kind']:
            self.block['text'] = ''.join(self.block.pop('parts'))
            self.blocks.append(self.block); self.block = None


def render_pdf(specification, audience='internal'):
    import fitz
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas
    from reportlab.platypus import SimpleDocTemplate, Paragraph, LongTable, TableStyle, PageBreak, KeepTogether

    font = 'CableChinese'
    with _font_lock:
        if font not in pdfmetrics.getRegisteredFontNames():
            # MuPDF distributes this TrueType CJK face; no Windows-only font path.
            pdfmetrics.registerFont(TTFont(font, BytesIO(fitz.Font('cjk').buffer)))
    payload, lifecycle = specification['payload'], specification['lifecycle']
    width, height = A4
    output = BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4, leftMargin=42, rightMargin=42,
        topMargin=58, bottomMargin=52, title=payload['name']+' · 产品规格书',
        subject=specification['digest'] if audience == 'internal' else '客户版产品规格书', author='', creator='CableSimPro')
    normal = ParagraphStyle('Body', fontName=font, fontSize=10.5, leading=16, wordWrap='CJK', spaceAfter=10)
    styles = {
        'p':normal,
        'h1':ParagraphStyle('Title', parent=normal, fontSize=27, leading=36, spaceBefore=12, spaceAfter=18, keepWithNext=True),
        'h2':ParagraphStyle('Chapter', parent=normal, fontSize=16, leading=23, spaceBefore=18, spaceAfter=12, keepWithNext=True),
        'h3':ParagraphStyle('Section', parent=normal, fontSize=12, leading=18, spaceBefore=14, spaceAfter=8, keepWithNext=True),
        'model':ParagraphStyle('Model', parent=normal, fontSize=16, leading=24, spaceAfter=18),
        'cell':ParagraphStyle('Cell', parent=normal, leading=15, spaceAfter=0),
    }

    def paragraph(value, style):
        value = escape(str(value)).replace('\n','<br/>').replace('₀','<sub>0</sub>')
        # Explicit word boundaries also keep copied hexadecimal digests exact.
        value = re.sub(r'[0-9a-f]{64}', lambda match: '<font name="Courier" size="10">' +
                       ' '.join(match[0][start:start+16] for start in range(0,64,16)) + '</font>', value)
        return Paragraph(value, style)

    def flowables(html):
        result = []
        for block in _Blocks(html).blocks:
            if block['kind'] != 'table':
                style = styles['model'] if block.get('class') == 'spec-model' else styles[block['kind']]
                result.append(paragraph(block['text'], style))
                continue
            rows = block['rows']
            weights = block['widths'] or [1] * len(rows[0])
            if len(weights) != len(rows[0]) or any(weight <= 0 for weight in weights):
                raise ValueError('规格书表格列宽与字段不一致。')
            table = LongTable([[paragraph(cell, styles['cell']) for cell in row] for row in rows],
                colWidths=[document.width*weight/sum(weights) for weight in weights], repeatRows=1,
                splitByRow=1, splitInRow=0, hAlign='LEFT', spaceAfter=14)
            table.setStyle(TableStyle([
                ('VALIGN',(0,0),(-1,-1),'TOP'), ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eeeeee')),
                ('GRID',(0,0),(-1,-1),.25,colors.HexColor('#cccccc')),
                ('LINEBELOW',(0,0),(-1,0),.6,colors.HexColor('#808080')),
                ('LINEBELOW',(0,1),(-1,-1),.35,colors.HexColor('#cccccc')),
                ('LEFTPADDING',(0,0),(-1,-1),7), ('RIGHTPADDING',(0,0),(-1,-1),7),
                ('TOPPADDING',(0,0),(-1,-1),7), ('BOTTOMPADDING',(0,0),(-1,-1),7),
            ]))
            result.append(table)
        return result

    class NumberedCanvas(canvas.Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.saved = []

        def showPage(self):
            if len(self.saved) >= 100:
                raise ValueError('规格书超过 100 页，请缩短异常长字段后重新导出。')
            self.saved.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self.saved)
            for state in self.saved:
                self.__dict__.update(state)
                self.setFont(font,10)
                self.drawString(42,height-31,'产品规格书')
                revisions = document_revisions(payload)
                version = revisions[-1]['version'] if revisions else '编制草稿'
                self.drawRightString(width-42,height-31,version+' · '+STATUS_NAMES.get(lifecycle['status'],'待核对'))
                self.setStrokeColor(colors.HexColor('#a0a0a0')); self.setLineWidth(.45)
                self.line(42,height-40,width-42,height-40); self.line(42,39,width-42,39)
                note = ('演示数据 · ' if payload.get('purpose') == 'demo' else '') + (
                    '已发布' if lifecycle['status'] == 'published' else '未发布 · 使用前须完成审核')
                self.drawString(42,24,note)
                self.drawRightString(width-42,24,f'第 {self._pageNumber} 页 / 共 {total} 页')
                super().showPage()
            super().save()

    story = []
    for index, body in enumerate(chapter_bodies(payload,lifecycle,audience)):
        if index == 1: story.append(PageBreak())
        if index: story.append(paragraph(f'{index+1}. {chapter_names(audience)[index]}',styles['h2']))
        story.extend(flowables(body))
    if audience == 'internal':
        story.append(PageBreak())
        story.extend(flowables(source_evidence(payload,specification['digest'])))
    arranged = []
    for item in story:
        if isinstance(item, LongTable) and item.wrap(document.width,document.height)[1] < document.height-45:
            headings = []
            while arranged and isinstance(arranged[-1], Paragraph) and arranged[-1].getKeepWithNext():
                headings.insert(0,arranged.pop())
            # The heading moves with its table; nesting separate KeepTogethers can orphan it.
            arranged.append(KeepTogether([*headings,item]))
        else:
            arranged.append(item)
    document.build(arranged,canvasmaker=NumberedCanvas)
    return output.getvalue()

