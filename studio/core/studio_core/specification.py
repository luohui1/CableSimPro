"""Render a kept product snapshot. All physical results come from the snapshot, never this renderer.

Imports and font registration happen before the stdio reader starts (Windows pipe/C-extension rule).
"""
from html import escape
from math import hypot
from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Flowable, Paragraph, SimpleDocTemplate, Table, TableStyle

FONT = 'STSong-Light'
for candidate in (Path('C:/Windows/Fonts/msyh.ttc'), Path('C:/Windows/Fonts/simsun.ttc'),
                  Path('/usr/share/fonts/truetype/arphic/uming.ttc')):
    if candidate.exists():
        try:
            pdfmetrics.registerFont(TTFont('StudioCJK', str(candidate), subfontIndex=0))
            FONT = 'StudioCJK'
            break
        except Exception:  # a platform font may use outlines unsupported by ReportLab
            pass
if FONT == 'STSong-Light':
    pdfmetrics.registerFont(UnicodeCIDFont(FONT))

INK = colors.HexColor('#20201E')
COPPER = colors.HexColor('#A74D22')
LINE = colors.HexColor('#D9D8D4')
GROUND = colors.HexColor('#F3F3F0')
REVIEW = {'draft': '草稿', 'submitted': '待审核', 'reviewed': '已审核', 'published': '已发布'}
VERDICT = {'passed': '通过', 'failed': '不通过', 'missing': '缺输入 / 需实测', 'uncovered': '未覆盖'}
VALUE_STATUS = {'available': '可用', 'uncovered': '未覆盖', 'missing': '缺输入', 'failed': '失败', 'not_applicable': '不适用', 'unsupported': '方法不支持'}
KINDS = {'electrical': '电气参数', 'short_circuit': '短路容量', 'rating': '载流量表', 'check': '标准核对'}
CONDITIONS = {'temperature_k': '导体温度 K', 'frequency_hz': '频率 Hz', 'phase_voltage_v': '相电压 V',
              'duration_s': '短路持续时间 s', 'initial_temperature_k': '短路前温度 K', 'final_temperature_k': '短路允许温度 K',
              'spacing_m': '线芯中心距 m', 'r20_length_basis': '电阻长度口径', 'arrangement': '排列',
              'core_lay_factor': '成缆系数', 'ks': '集肤效应系数 ks', 'kp': '邻近效应系数 kp'}
WIDTH = A4[0] - 84
STYLES = getSampleStyleSheet()
STYLES.add(ParagraphStyle('StudioBody', fontName=FONT, fontSize=9, leading=14, textColor=INK, wordWrap='CJK', spaceAfter=5))
STYLES.add(ParagraphStyle('StudioCell', parent=STYLES['StudioBody'], fontSize=8, leading=12, spaceAfter=0))
STYLES.add(ParagraphStyle('StudioTitle', parent=STYLES['StudioBody'], fontSize=22, leading=30, spaceAfter=12))
STYLES.add(ParagraphStyle('StudioHeading', parent=STYLES['StudioBody'], fontSize=12, leading=19, spaceBefore=16, spaceAfter=7, keepWithNext=True))
STYLES.add(ParagraphStyle('StudioNote', parent=STYLES['StudioBody'], fontSize=8, leading=12, textColor=colors.HexColor('#595953')))


def text(value, style='StudioBody'):
    markup = escape(str(value if value is not None else '未提供'))
    # CJK fonts do not consistently contain Unicode subscript glyphs. Typeset
    # the saved engineering symbols with ordinary glyphs at subscript position.
    markup = re.sub('[₀₁₂₃₄₅₆₇₈₉ₛₚ]+', lambda match: '<sub>' + match.group().translate(
        str.maketrans('₀₁₂₃₄₅₆₇₈₉ₛₚ', '0123456789sp')) + '</sub>', markup)
    return Paragraph(markup.replace('\n', '<br/>'), STYLES[style])


def number(value, digits=6):
    return f'{value:.{digits}g}' if isinstance(value, (int, float)) else '未提供'


def measured(value, unit):
    conversions = {'ohm/m': (1000, 'Ω/km'), 'Ω/m': (1000, 'Ω/km'), 'F/m': (1e9, 'μF/km'),
                   'H/m': (1e6, 'mH/km'), 'W/m': (1000, 'W/km'), 'A/m': (1000, 'A/km')}
    scale, shown = conversions.get(unit, (1, unit))
    return number(value * scale) if isinstance(value, (int, float)) else '无结果', shown


def table(headers, rows, weights):
    widths = [WIDTH * weight / sum(weights) for weight in weights]
    cells = [[text(value, 'StudioCell') for value in row] for row in [headers, *rows]]
    result = Table(cells, colWidths=widths, repeatRows=1, hAlign='LEFT')
    result.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), GROUND), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LINEBELOW', (0, 0), (-1, 0), .7, LINE), ('LINEBELOW', (0, 1), (-1, -1), .3, LINE),
        ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    return result


def structure_source(row):
    origin = {'table': '结构表', 'series': '系列声明', 'standard': '标准规定'}.get(row['origin'], row['origin'])
    revision = row.get('revision')
    basis = row.get('basis') or (revision or {}).get('previous_basis')
    source = origin + ('；' + basis if basis else '')
    if revision:
        source = (f"工程师修改；上版值 {number(revision['previous'])} {row['unit']}；{revision['by']} · {revision['at']}；"
                  f"{revision['note']}；原始依据：{source}")
    return source


class CrossSection(Flowable):
    """Dimensionally scaled circles from the stored geometry, including the three real core positions."""
    def __init__(self, entry):
        super().__init__()
        self.entry, self.width, self.height = entry, WIDTH, 160

    def draw(self):
        cable = self.entry['payload']['cable_type']
        cores = cable['cores']
        core_radius = lambda core: core['conductor']['diameter'] / 2 + sum(layer['thickness'] for layer in core['layers'])
        inner = max(hypot(core['x'], core['z']) + core_radius(core) for core in cores)
        outer = inner + sum(layer['thickness'] for layer in cable['common_layers'])
        scale = 67 / outer
        canvas = self.canv
        center_x, center_y = 95, 79
        palette = {'conductor_screen': '#565652', 'insulation': '#E2DECE', 'insulation_screen': '#565652',
                   'metallic_screen': '#C4885E', 'metallic_sheath': '#A7A8A5', 'bedding': '#D4D1C7',
                   'armour': '#9EAAA9', 'oversheath': '#303735', 'filler': '#EEEAE1'}

        def ring(x, y, radius, color):
            canvas.setFillColor(colors.HexColor(color))
            canvas.setStrokeColor(colors.white)
            canvas.setLineWidth(.25)
            canvas.circle(center_x + x * scale, center_y + y * scale, radius * scale, fill=1, stroke=1)

        radius = outer
        for layer in reversed(cable['common_layers']):
            ring(0, 0, radius, palette.get(layer['role'], '#D4D1C7'))
            radius -= layer['thickness']
        ring(0, 0, inner, '#EEEAE1')
        for core in cores:
            radius = core_radius(core)
            for layer in reversed(core['layers']):
                ring(core['x'], core['z'], radius, palette.get(layer['role'], '#D4D1C7'))
                radius -= layer['thickness']
            ring(core['x'], core['z'], radius, '#BF8054')
        canvas.setFillColor(INK)
        canvas.setFont(FONT, 9)
        canvas.drawString(190, 102, '断面结构示意（按保存尺寸比例绘制）')
        canvas.drawString(190, 80, f"标称截面 {number(self.entry['summary']['area_mm2'])} mm²")
        canvas.drawString(190, 59, f"计算结构外径 {number(self.entry['summary']['outer_diameter_m'] * 1000)} mm")
        canvas.setFont(FONT, 8)
        canvas.drawString(190, 37, '颜色仅用于区分结构层；不表示制造公差或实测结果。')


def render(snapshot, snapshot_sha256, path):
    view, declaration = snapshot['view'], snapshot['declaration']
    version, entry, results = view['version'], view['entry'], view['results']
    review = REVIEW[version['review']]
    origin = {'factory': '本厂结构表', 'public': '公开厂家资料', 'demo': '结构演示'}.get(view['series']['origin'], view['series']['origin'])
    story = [text('产品技术规格书', 'StudioTitle'), text(view['spec']['name']),
             text(f"第 {version['number']} 版 · {review} · {origin}"),
             text('本文件记录指定版本的结构与计算结果。公开资料及参考方法结果须经本厂核实后确定保证值。', 'StudioNote')]
    story.append(table(['项目', '声明 / 记录'], [
        ['制造商', declaration['manufacturer'] or '未声明'],
        ['型号及额定电压', f"{declaration['designation']}  {number(declaration['u0_v'] / 1000)} / {number(declaration['u_v'] / 1000)} kV"],
        ['执行标准', '、'.join(declaration['standards']) or '未声明'],
        ['编制 / 导出', f"{snapshot['by']} · {snapshot['created']}"],
        ['审核', f"{version.get('reviewed_by') or '未审核'} · {version.get('reviewed') or '无审核时间'}"],
        ['发布', f"{version.get('published_by') or '未发布'} · {version.get('published') or '无发布时间'}"],
    ], [1, 3]))
    story.append(CrossSection(entry))
    story.append(text('需关注的事项', 'StudioHeading'))
    issues = [item['message'] for item in view['warnings']]
    for kind, label in KINDS.items():
        result = results.get(kind)
        if not result:
            issues.append(f'{label}：本版本尚未计算。')
        elif not result.get('current', False):
            issues.append(f'{label}：结果输入身份已变化，结果不用于本文件的数值表。')
        elif result.get('error'):
            issues.append(f"{label}：{result['error']['message']}")
    check = results.get('check', {})
    if check.get('summary', {}).get('count', {}).get('failed', 0):
        issues.append('标准核对有不通过项，见逐条核对表；不得将本文件解释为合规证明。')
    if any(row.get('status') != 'succeeded' for row in results.get('rating', {}).get('rows', [])):
        issues.append('部分载流量条件被方法拒算，表中保留拒算原因，不补入估计值。')
    for sheet in snapshot.get('rating_tables', []):
        refused = sum(1 for row in sheet['rows'] if row['status'] != 'succeeded')
        if refused:
            issues.append(f"载流量表“{sheet['title']}”有 {refused} 个条件被方法拒算，表中保留拒算原因，不补入估计值。")
    story.extend(text('• ' + item) for item in issues)
    if not issues:
        story.append(text('未发现计算失败；标准核对中的缺实测值和未覆盖项仍须单独确认。'))

    story.append(text('结构尺寸与来源', 'StudioHeading'))
    structure = view['structure']
    if structure:
        story.append(table(['项目', '数值', '单位', '来源 / 依据'], [[row['label'], number(row['value']), row['unit'],
            structure_source(row)]
            for row in structure], [2, 1, 1, 4]))
    else:
        story.append(text(view['derivation']['note']))
    closure = view.get('closure')
    if closure:
        story.append(text(f"外径闭合：表列 {number(closure['declared_mm'])} mm；已列结构 {number(closure['listed_mm'])} mm；"
                          f"余量 {number(closure['residual_mm'])} mm；允许差 {number(closure['tolerance_mm'])} mm；"
                          f"余量位置 {closure.get('placed_in') or '无'}。", 'StudioNote'))

    for kind in ('electrical', 'short_circuit'):
        story.append(text(KINDS[kind], 'StudioHeading'))
        result = results.get(kind, {})
        if result.get('current') and result.get('rows'):
            rows = []
            for row in result['rows']:
                value, unit = measured(row.get('value'), row.get('unit', ''))
                rows.append([row.get('title') or row.get('label') or row['id'], value, unit,
                             row.get('reason') or row.get('source') or VALUE_STATUS.get(row.get('status'), '状态未说明')])
            story.append(table(['参数', '结果', '单位', '说明 / 依据'], rows, [3, 1, 1, 3]))
            conditions = result.get('conditions', {})
            for key, value in conditions.get('values', {}).items():
                shown = number(value) if isinstance(value, (int, float)) else {
                    'finished_cable': '成品电缆长度', 'trefoil': '品字形'}.get(str(value), value)
                story.append(text(f"{CONDITIONS.get(key, key)} = {shown}；{conditions.get('sources', {}).get(key, '未声明来源')}", 'StudioNote'))
        else:
            story.append(text(result.get('error', {}).get('message', '本版本无当前有效结果。')))

    story.append(text('载流量表与计算条件', 'StudioHeading'))
    rating = results.get('rating', {})
    conditions = {row['id']: row for row in rating.get('conditions', [])}
    if rating.get('current') and rating.get('rows'):
        rows = []
        for row in rating['rows']:
            condition = conditions.get(row['id'], {})
            rows.append([f"{row.get('layout_label', condition.get('layout', row['id']))}\n{row.get('circuits', '未声明')} 回路",
                         f"{number(condition.get('depth_m'))} m / {number(condition.get('ambient_temperature_c'))} °C",
                         number(condition.get('soil_thermal_resistivity')),
                         f"{row['ampacity_a']:.1f}" if row.get('ampacity_a') is not None and row['status'] == 'succeeded' else '拒算',
                         row.get('error', {}).get('message') or (row.get('tier', {}).get('label', '') + '；' + (row.get('basis_name') or ''))])
        story.append(table(['敷设 / 回路', '中心埋深 / 环温', '土壤热阻率\nK·m/W', '载流量 A', '适用性 / 说明'], rows, [2, 1.6, 1.1, 1, 2.8]))
        story.append(text('三芯排管采用三回水平模板；表内回路口径逐行注明。这里的基准条件不替代具体工程的敷设条件。', 'StudioNote'))
    else:
        story.append(text(rating.get('error', {}).get('message', '本版本无当前有效结果。')))

    # Tables the engineer asked for, each number of which is a record of a run (see host/rating-tables.ts).
    for sheet in snapshot.get('rating_tables', []):
        story.append(text(f"载流量表 · {sheet['title']}", 'StudioHeading'))
        rows = []
        for row in sheet['rows']:
            spacing = f"；中心距 {number(row['spacing_m'])} m" if row.get('spacing_m') else ''
            rows.append([f"{row['label']}\n{row['layout_label']} · {row['circuits'] or '未声明'} 回路{spacing}",
                         f"{number(row['depth_m'])} m / {number(row['ambient_temperature_c'])} °C", number(row['soil_thermal_resistivity']),
                         f"{row['ampacity_a']:.1f}" if row.get('ampacity_a') is not None and row['status'] == 'succeeded' else '拒算',
                         row['error']['message'] if row.get('error') else f"{row.get('tier_label') or ''}；{row.get('basis_name') or ''}",
                         f"{row['run']['run']}\n输入 {row['run']['inputs_sha256'][:12]}"])
        story.append(table(['条件 / 敷设', '中心埋深 / 环温', '土壤热阻率\nK·m/W', '载流量 A', '适用性 / 说明', '运行记录'], rows, [2.6, 1.4, 1, 1, 2.2, 1.8]))
        method = sheet['rows'][0]['run']
        story.append(text(f"计算工程 {sheet['project']}：表内每个数对应该工程里的一条运行记录（右列），记录保存当时的输入、方法版本和请求摘要。"
                          f"{method['plugin_id']} {method['plugin_version']}；方法 {method['method_version']}；编制 {sheet['by']} · {sheet['created']}。", 'StudioNote'))
        if version.get('reviewed') and sheet['created'] > version['reviewed']:
            story.append(text(f"本表在版本审核（{version['reviewed']}）之后追加，审核不覆盖这张表。", 'StudioNote'))

    story.append(text('标准核对逐条记录', 'StudioHeading'))
    if check.get('current') and check.get('rows'):
        ranking = {'failed': 0, 'missing': 1, 'uncovered': 2, 'passed': 3}
        rows = sorted(check['rows'], key=lambda row: ranking.get(row['verdict'], 2))
        story.append(table(['核对项目 / 结论', '要求 / 实际', '标准出处与说明'], [[
            f"{row['title']}{' · ' + row.get('target', {}).get('core_id') if row.get('target', {}).get('core_id') else ''}\n{VERDICT.get(row['verdict'], row['verdict'])}",
            f"要求 {row.get('comparison') or ''} {number(row.get('limit'))} / 实际 {number(row.get('actual'))} {row.get('unit', '')}",
            f"{row['standard']} {row['clause']}；PDF 第 {row.get('pdf_page') or '未注明'} 页\n{row.get('reason') or ''}"] for row in rows], [2, 1.5, 3.5]))
    else:
        story.append(text(check.get('error', {}).get('message', '本版本无当前有效核对结果。')))

    story.append(text('版本、方法与来源追溯', 'StudioHeading'))
    story.append(text(f"版本说明：{version['note']}；建立人 {version['created_by']}；建立时间 {version['created']}。"))
    typed = view['derivation'] if view['derivation'].get('entry') == 'manual' else None
    source = declaration.get('source') or {}
    if typed:
        # What a person typed is not the file the series was imported from: the version says who typed it, when and where.
        how = typed.get('entered_how', '人工填写')
        story.append(text(f"录入方式：{how}；填写人 {typed.get('entered_by', '未记录')}；填写时间 {typed.get('entered_at', '未记录')}。", 'StudioNote'))
        proposal = typed.get('proposal')
        if proposal:
            method = proposal['method']
            story.append(text(f"取用的标准提案 {proposal['id']}：{proposal['standard']}；字段 {'、'.join(proposal['fields'])}；"
                              f"{method['plugin_id']} {method['plugin_version']}；方法 {method['method_version']}；请求摘要 {method['request_sha256']}。", 'StudioNote'))
        story.append(text(f"资料：{how}；Cable Studio 型号库 · {typed.get('entered_by', '未记录')} · {typed.get('entered_at', '未记录')}；所在系列：{view['series']['name']}"))
    else:
        story.append(text(f"资料：{source.get('title') or entry['source']}；{source.get('location', '')}"))
        story.append(text('资料 SHA-256：' + source.get('sha256', '未提供'), 'StudioNote'))
    story.append(text('结构 SHA-256：' + version['content_sha256'], 'StudioNote'))
    story.append(text('快照 SHA-256：' + snapshot_sha256, 'StudioNote'))
    for kind, result in results.items():
        method = result.get('method')
        if method:
            story.append(text(f"{KINDS.get(kind, kind)}：{method['plugin_id']} / {method['plugin_version']}；"
                              f"方法 {method['method_version']}；运行 {method['run_id']}；计算时间 {result.get('created', '')}。", 'StudioNote'))
            story.append(text('方法封签：' + method['manifest_sha256'] + '\n请求摘要：' + method['request_sha256'], 'StudioNote'))

    def page(canvas, doc):
        canvas.setTitle(view['spec']['name'] + ' 产品技术规格书')
        canvas.setAuthor('Cable Studio')
        canvas.setFont(FONT, 8)
        canvas.setFillColor(COPPER)
        canvas.drawString(42, A4[1] - 31, 'Cable Studio / 产品技术规格书')
        canvas.setFillColor(INK)
        canvas.drawRightString(A4[0] - 42, A4[1] - 31, f"第 {version['number']} 版 · {review} · {origin}")
        canvas.setStrokeColor(LINE)
        canvas.line(42, 35, A4[0] - 42, 35)
        canvas.setFont(FONT, 7)
        canvas.drawString(42, 22, snapshot['id'])
        canvas.drawRightString(A4[0] - 42, 22, f'第 {doc.page} 页')

    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=42, rightMargin=42, topMargin=53, bottomMargin=48)
    doc.build(story, onFirstPage=page, onLaterPages=page)
    return {'pages_written': True}
