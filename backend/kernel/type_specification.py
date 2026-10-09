"""One specification renderer for type publication and saved-run deliveries."""
from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP
from html import escape
from pathlib import Path
import re

from .workspace import fingerprint
from .rating_table import is_rating_table, rating_rows


CHAPTERS = [
    '封面', '型号与执行标准', '结构尺寸表', '电气参数', '载流量表', '短路容量',
    '标准核对结论与偏离表', '修订记录',
]
CUSTOMER_CHAPTERS = [*CHAPTERS[:6], '标准核对表', '文档修订记录与来源']
SECTIONS = ('cover', 'standards', 'structure', 'electrical', 'rating', 'short-circuit', 'checks', 'revisions')
CHANNELS = {
    'geometry': 'x-cablesim.cad-model', 'electrical': 'x-cablesim.type-electrical',
    'short_circuit': 'x-cablesim.type-short-circuit', 'standards': 'x-cablesim.standard-check',
}
LAYOUT_NAMES = {'trefoil': '直埋 · 品字', 'flat': '直埋 · 水平', 'ducts': '排管 · 品字', 'air': '空气',
                'three_core_buried_single':'三芯直埋 · 单回', 'three_core_buried_horizontal':'三芯直埋 · 三回水平',
                'three_core_ducts_horizontal':'三芯排管 · 三回水平'}
LAYER_NAMES = {'conductor':'导体', 'conductor_screen':'导体屏蔽', 'insulation':'绝缘',
               'insulation_screen':'绝缘屏蔽', 'metallic_screen':'金属屏蔽', 'metallic_sheath':'金属护套',
               'bedding':'内衬层', 'separator':'隔离层', 'filler':'填充层', 'binder':'绑扎层',
               'armour':'铠装层', 'oversheath':'外护套'}
CHANNEL_NAMES = {'geometry':'结构推导', 'electrical':'电气参数', 'rating':'载流量表',
                 'short_circuit':'短路容量', 'standards':'标准核对'}
MATERIAL_NAMES = {'copper_bare':'铜', 'copper_coated':'镀层铜', 'aluminium':'铝', 'lead':'铅',
                  'XLPE':'交联聚乙烯', 'PVC':'聚氯乙烯', 'EPR':'乙丙橡胶', 'HEPR':'硬乙丙橡胶',
                  '铝护套':'铝', '铅护套':'铅'}
FORM_NAMES = {'solid_round':'实心圆形', 'stranded_round':'圆绞合', 'stranded_round_compacted':'紧压',
              'segmental':'分割', 'hollow':'中空', 'sectoral':'扇形'}
STATUS_NAMES = {'draft':'草稿', 'submitted':'待人工审核', 'approved':'已批准', 'published':'已发布',
                'available':'已计算', 'missing':'缺项', 'uncovered':'未覆盖', 'not_applicable':'范围外',
                'failed':'失败', 'succeeded':'成功', 'partial':'部分完成', 'current':'当前', 'historical':'历史'}
METHOD_NAMES = {'cablesim.cable-geometry':'电缆结构与用料推导', 'cablesim.standard-check':'标准核对',
                'cablesim.type-electrical':'电气与短路计算', 'cablesim.iec60287':'IEC 60287 载流量计算'}
STYLES = '''
body{font:var(--text-body)/1.6 var(--font-ui);color:var(--text);max-width:1100px;margin:auto;padding:var(--space-8)}
h1,h2,h3{font-weight:var(--weight-strong)}h1{margin-top:var(--space-8)}section{margin-bottom:var(--space-8)}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
td,th{padding:var(--space-3);border-bottom:1px solid var(--border);text-align:left;overflow-wrap:anywhere}
th{background:var(--hover)}thead{display:table-header-group}tr{break-inside:avoid}
.spec-cover{padding-block:var(--space-8)}.spec-model{font-size:var(--text-heading)}
.spec-note{padding:var(--space-3) 0;color:var(--text-secondary)}
@media print{h2,h3{break-after:avoid}details{display:block}}
'''


def clean_name(text):
    text = re.sub(r'[（(][^）)]*演示[^）)]*[）)]', '', text)
    text = re.sub(r'\s*[·（(]\s*(?:资料核对|合成验收数据|(?:典型)?结构演示|演示)[^·）)]*[）)]?', '', text)
    return text.strip(' ·') or '型号'


def readable_version(value):
    return str(value or '待提供').replace('+engineering', '（工程版）')


def text(value):
    return escape(str(value if value is not None else '—'))


def number(value, digits=1, factor=1, *, trim=False):
    if value is None:
        return '未提供'
    amount = Decimal(str(value)) * Decimal(str(factor))
    result = format(amount.quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP), 'f')
    return result.rstrip('0').rstrip('.') if trim and '.' in result else result


def table(headings, rows, empty='未计算（尚无有效保存结果）。', widths=None):
    rows = list(rows)
    if not rows:
        return '<p class="spec-note">' + text(empty) + '</p>'
    sizing = ' data-widths="' + ','.join(map(str, widths)) + '"' if widths else ''
    headings = ''.join('<th>' + text(value) + '</th>' for value in headings)
    body = ''.join(
        '<tr>' + ''.join('<td>' + text(value) + '</td>' for value in row) + '</tr>'
        for row in rows
    )
    return '<table' + sizing + '><thead><tr>' + headings + '</tr></thead><tbody>' + body + '</tbody></table>'


def voltage(cable):
    rating = cable['rating']
    return number(rating.get('u0'), 3, .001, trim=True) + '/' + number(rating.get('u'), 3, .001, trim=True) + ' kV'


def material_name(materials, identity, conductor=None):
    material = next((item for item in materials if item['id'] == identity), {})
    label = clean_name(material.get('label', '材料未提供'))
    label = MATERIAL_NAMES.get(material.get('standard_kind'), MATERIAL_NAMES.get(label, label))
    if conductor:
        kind = conductor.get('conductor_class')
        form = FORM_NAMES.get(conductor.get('form'), '构造待提供')
        label += '（' + (f'第 {kind} 类' if kind else '类别待提供') + ' · ' + form + '）'
    return label


def structure_rows(cable, materials, combine_identical=False):
    rows = []
    cores = cable['cores']
    shared = combine_identical and len(cores)>1 and all(
        core['conductor']==cores[0]['conductor'] and core['layers']==cores[0]['layers'] for core in cores[1:])
    for index, core in enumerate(cores[:1] if shared else cores, 1):
        conductor = core['conductor']
        label = f'芯 1–{len(cores)}' if shared else f'芯 {index}'
        rows.append([label, '导体', material_name(materials, conductor['material'], conductor),
                     '直径 ' + number(conductor.get('diameter'), 1, 1000), number(conductor.get('nominal_area'), 1, 1e6, trim=True)])
        rows.extend([label, LAYER_NAMES.get(layer['role'], '结构层'), material_name(materials, layer['material']),
                     '厚度 ' + number(layer['thickness'], 1, 1000), '—'] for layer in core['layers'])
    rows.extend(['共同层', LAYER_NAMES.get(layer['role'], '结构层'), material_name(materials, layer['material']),
                 '厚度 ' + number(layer['thickness'], 1, 1000), '—'] for layer in cable['common_layers'])
    return rows


def artifact_rows(results, channel):
    return results.get(channel, {}).get('artifact', {}).get('rows', [])


def quantity(value, unit, short_circuit=False):
    units = {'Ω/m':(1000,'Ω/km',5), 'F/m':(1e9,'μF/km',4), 'H/m':(1e6,'mH/km',4),
             'W/m':(1000,'W/km',2), 'A/m':(1000,'A/km',3), 'm':(1000,'mm',1),
             'm²':(1e6,'mm²',1), 'kg/km':(1,'kg/km',0), 'V':(.001,'kV',3), '1':(1,'—',3)}
    scale, label, digits = (.001,'kA',1) if short_circuit and unit == 'A' else units.get(unit, (1,unit or '',3))
    return number(value, digits, scale, trim=label not in ('mm','kg/km','kA')), label


def human_note(value):
    result = str(value or '')
    names = {**STATUS_NAMES, **CHANNEL_NAMES, **METHOD_NAMES, 't_n': '标称厚度'}
    for key in sorted(names, key=len, reverse=True):
        label = names[key]
        result = re.sub(r'(?<![A-Za-z_])' + re.escape(key) + r'(?![A-Za-z_])', label, result)
    return re.sub(r'。\s*。', '。', result)


def missing_reason(payload, channel):
    checks = [human_note(item['message']).rstrip('。') for item in payload.get('checks', []) if item.get('channel') == channel]
    return '未计算（' + ('；'.join(dict.fromkeys(checks)) if checks else '尚无有效保存结果，请完成' + CHANNEL_NAMES[channel]) + '）。'


def parameter_table(rows, empty, short_circuit=False):
    return table(
        ['参数 / 组件', '数值', '单位', '结果与依据'],
        [[row['title'], *quantity(row.get('value'), row.get('unit'), short_circuit),
          '；'.join(filter(None, [STATUS_NAMES.get(row['status'], row['status']), row.get('standard'),
                                 row.get('clause'), human_note(row.get('reason'))]))] for row in rows],
        empty, [2.1, 1.1, 1, 3.8],
    )


def geometry_tables(payload, audience='internal'):
    from .type_specification_drawing import section_svg
    cable = payload['document']['cable_types'][0]
    geometry = payload['results'].get('geometry', {}).get('artifact', {})
    rows = structure_rows(cable, payload['document']['materials'], audience=='customer')
    pins = payload.get('resource_bindings', {}).get('material', {})
    cores = cable['cores']
    shared = audience == 'customer' and len(cores)>1 and all(
        core['conductor']==cores[0]['conductor'] and core['layers']==cores[0]['layers'] for core in cores[1:])
    identities = [identity for core in (cores[:1] if shared else cores)
                  for identity in [core['conductor']['material'], *[layer['material'] for layer in core['layers']]]]
    identities.extend(layer['material'] for layer in cable['common_layers'])
    for row, identity in zip(rows, identities):
        # Bind by input identity; equal display names do not imply equal resource versions.
        pin = pins.get(identity, {})
        row[2] += ' · '+readable_version(pin['version']) if pin else ' · 未绑定资源'
    single = len(cable['cores']) == 1
    body = section_svg(payload)+'<h3>分层结构与材料版本</h3>'+table(['结构层', '材料', '尺寸 / mm', '截面 / mm²'] if single else ['对象', '结构层', '材料', '尺寸 / mm', '截面 / mm²'],
                 [row[1:] for row in rows] if single else rows,
                 widths=[1.2,2.8,1.3,1.2] if single else [.8,1.2,2.8,1.3,1.2])
    body += '<h3>外径与理论用料</h3>'
    if not geometry:
        return body + '<p class="spec-note">' + text(missing_reason(payload, 'geometry')) + '</p>'
    body += table(['指标', '数值', '数据性质'], [
        ['成品外径', number(geometry.get('outer_diameter_m'), 1, 1000) + ' mm', '结构推导'],
        ['单位长度用料', number(geometry.get('mass_kg_per_km'), 0) + ' kg/km' if geometry.get('mass_kg_per_km') is not None
         else '未计算（缺少完整密度或构造输入）', '理论用料，非成品实测重量']], widths=[2,2,3])
    body += table(
        ['结构层', '内径 → 外径 / mm', '体积 / m³/km', '用料 / kg/km', '推导依据 / 缺项'],
        [[row.get('label') or LAYER_NAMES.get(row['role'], '结构层'),
          number(row.get('inner_radius_m'), 2, 2000)+' → '+number(row.get('outer_radius_m'), 2, 2000),
          number(row.get('material_volume_m3'), 3, 1000/geometry['length_m']) if geometry.get('length_m',0)>0 else '未提供', number(row.get('mass_kg_per_km'), 0),
          human_note('；'.join(row.get('quantity_missing') or []) or row.get('quantity_basis') or '保存的实体积分')]
         for row in geometry.get('layers', [])],
        '未计算（尚无分层用料结果）。', [1.2,1.5,1.1,1.1,2.8],
    )
    body += '<p class="spec-note">用料按保存模型长度折算到 1 km；推导尺寸与理论用料不替代制造公差、实测尺寸或称重。</p>'
    return body


def check_tables(standards, checks, document=None):
    verdicts = {'passed': '满足', 'failed': '不满足', 'missing': '缺项', 'uncovered': '未覆盖'}
    def value(row, key):
        if row.get(key) is None:
            return '未提供' if key == 'actual' else '—'
        if key == 'actual' and row.get('unit') == '1' and document:
            return standard_declaration(row, document)
        digits = 4 if row.get('unit') == 'Ω/km' else 2
        return number(row[key], digits, trim=True)+(' '+row['unit'] if row.get('unit') not in (None,'1') else '')
    body = table(
        ['要求与条款', '要求值', '实际值', '余量', '判定 / 缺项'],
        [[row['title']+'\n'+row.get('standard', '')+' '+row.get('clause', '')+
          (f" · 印刷页 {row['printed_page']}" if row.get('printed_page') is not None else ''),
          {'>=':'≥ ', '<=':'≤ ', '=':'= '}.get(row.get('comparison'),'')+value(row,'limit'), value(row,'actual'), value(row,'margin'),
          verdicts.get(row.get('verdict'), row.get('verdict'))+'\n'+(human_note(row.get('reason')) or '—')]
         for row in standards], '未计算（尚无标准核对结果）。', [2.8,1.1,1.1,1,2.5])
    if checks is not None:
        body += '<h3>发布前待完成事项</h3>' + table(['校核事项'], [[human_note(check['message'])] for check in checks], '当前未发现阻止发布的计算校核项；批准状态仍以签署记录为准。')
    return body


def rating_tables(item, empty, audience='internal'):
    rows = item.get('rows', [])
    body = table(['敷设工况','允许电流 / A','负荷口径'],
        [[row['name'],number(row.get('value_a'),0),row.get('condition',{}).get('rating_basis_name') or '见保存工况'] for row in rows],
        empty,[2,1.3,3.7]) if audience=='customer' else table(
        ['工况', '排列', '允许电流 / A', '状态与说明'],
        [[row['name'], LAYOUT_NAMES.get(row.get('condition', {}).get('layout'), '排列未提供'),
          number(row.get('value_a'), 0), '；'.join(filter(None, [row['status'], human_note(row.get('reason'))]))]
         for row in rows], empty, [1.8,1.5,1.4,3.3],
    )
    if rows:
        bonding = {'both_ends':'两端接地', 'single_point':'单点接地', 'unspecified':'未提供'}
        conditions = []
        sources = {}
        for row in rows:
            condition = row.get('condition', {})
            detail = '；'.join([f"环境温度 {number(condition.get('ambient_temperature_c'), 1)} °C",
                f"中心埋深 {number(condition.get('depth_m'), 3, trim=True)} m",
                f"土壤热阻率 {number(condition.get('soil_rho_k_m_w'), 3, trim=True)} K·m/W",
                *([f"实际中心距 {number(condition['actual_spacing_m'], 3, trim=True)} m"] if condition.get('actual_spacing_m') is not None else []),
                *([f"管内径 / 外径 {number(condition.get('duct_inner_m'),1,1000)} / {number(condition.get('duct_outer_m'),1,1000)} mm",
                   f"管材热阻率 {number(condition.get('duct_rho_k_m_w'),3,trim=True)} K·m/W"] if condition.get('layout') in ('ducts','three_core_ducts_horizontal') else []),
                bonding.get(condition.get('bonding'), '接地方式未提供')])
            conditions.append([row['name'], detail])
            sources.setdefault(condition.get('source') or '来源待提供',[]).append(row['name'])
        body += '<h3>对应敷设与环境条件</h3>' + table(['工况','保存条件'], conditions, widths=[1.5,6.5])
        body += ''.join('<p>条件来源'+('（'+text('、'.join(names))+'）' if len(sources)>1 else '')+'：'+text(source)+'</p>'
                        for source,names in sources.items())
    parameters = item.get('parameters', {})
    if audience == 'internal' and parameters.get('source'):
        body += '<p>方法条件来源：' + text(parameters['source']) + '</p>'
    if parameters.get('reference_basis') == 'tb880_reference':
        body += '<p>TB 880 旧版验证复现；不作为 IEC 2023 工程结论。</p>'
    return body


def chapter_names(audience):
    return CUSTOMER_CHAPTERS if audience == 'customer' else CHAPTERS


def document_revisions(payload):
    # Old frozen payloads keep their audit bytes, but system saves are not document revisions.
    return [row for row in payload.get('revisions', []) if all(key in row for key in ('version','summary','author','created'))]


def combined_core_rows(rows, core_ids):
    """Combine only identical unrounded declarations covering every saved core."""
    expected=set(core_ids)
    if len(expected)<2:return rows
    groups={}
    keys=('value','actual','limit','margin','comparison','unit','status','verdict','reason','standard','clause','printed_page','pdf_page','source_status','formula',
          'formula_inputs','source_digest','basis','input_source')
    for row in rows:
        target=row.get('target',{})
        if target.get('scope')!='core' or target.get('core_id') not in expected:continue
        title=re.sub(r'^芯\s*\d+\s*·\s*','',row['title'])
        key=fingerprint({'title':title,'role':target.get('role'),**{k:row.get(k) for k in keys}})
        groups.setdefault(key,[]).append(row)
    merged={};hidden=set()
    for group in groups.values():
        if len(group)==len(expected) and {row['target']['core_id'] for row in group}==expected:
            merged[id(group[0])]={**group[0],'title':f'各芯 · '+re.sub(r'^芯\s*\d+\s*·\s*','',group[0]['title'])}
            hidden.update(id(row) for row in group[1:])
    return [merged.get(id(row),row) for row in rows if id(row) not in hidden]


def calculation_conditions(rows, short_circuit=False):
    """Show physical conditions from the same saved formula inputs as the values."""
    def inputs(suffix):
        return next((row.get('formula_inputs', {}) for row in rows if row['id'].endswith(':'+suffix)), {})
    def temperature(value):
        return number(Decimal(str(value))-Decimal('273.15'), 1)+' °C'
    conditions = []
    if short_circuit:
        conductor = inputs('conductor-adiabatic')
        if conductor.get('t_s') is not None:
            conditions.append('短路持续时间 '+number(conductor['t_s'],3,trim=True)+' s')
        components = [('导体',conductor), ('金属组件', next((row.get('formula_inputs', {}) for row in rows
            if row['id'].endswith('-adiabatic') and not row['id'].endswith(':conductor-adiabatic')), {}))]
        for label, values in components:
            for key, name in (('theta_i_K','初始温度'), ('theta_f_K','最终温度')):
                if values.get(key) is not None:
                    conditions.append(label+name+' '+temperature(values[key]))
    else:
        dc, charging, geometric = inputs('dc'), inputs('charging'), inputs('geometric-inductance')
        if dc.get('temperature_k') is not None:
            conditions.append('导体工作温度 '+temperature(dc['temperature_k']))
        for values, key, label, factor, unit, digits in (
            (charging,'f_hz','频率',1,'Hz',1), (charging,'U_phase_V','运行相电压',.001,'kV',3),
            (geometric,'s_m','相间中心距',1000,'mm',1)):
            if values.get(key) is not None:
                conditions.append(label+' '+number(values[key],digits,factor,trim=unit!='mm')+' '+unit)
    return '<p class="spec-conditions">'+text('；'.join(conditions))+'。</p>' if conditions else ''


def inapplicable_list(payload):
    rows = payload['results'].get('standards', {}).get('artifact', {}).get('not_applicable', [])
    if not rows:
        return ''
    return '<details data-specification-inapplicable><summary>不适用</summary><h3>不适用条款</h3>' + ''.join(
        '<p>' + text(row['title']) + '：' + text(row.get('reason')) + '</p>' for row in rows) + '</details>'


def standard_declaration(row, document):
    """Show verified material/structure facts instead of internal boolean sentinels."""
    key=row['id'].rsplit(':',1)[-1]
    layers=document['cable_types'][0]['common_layers']
    armour=next((index for index,layer in enumerate(layers) if layer['role']=='armour'),None)
    if key=='armour-material' and armour is not None:
        return material_name(document['materials'],layers[armour]['material'])
    if key=='armour-underlayer' and armour is not None and armour>0:
        under=layers[armour-1]
        return ('绕包' if under.get('form')=='tape' else '挤包')+LAYER_NAMES.get(under['role'],'保护层')
    return number(row.get('actual'),6,trim=True)


def chapter_bodies(payload, lifecycle, audience='internal'):
    cable, results = payload['document']['cable_types'][0], payload['results']
    internal = audience == 'internal'
    standards = artifact_rows(results, 'standards')
    core_ids=[core['id'] for core in cable['cores']]
    groups = {}
    for row in standards:
        if row.get('standard'):
            groups.setdefault(row['standard'], []).append(row.get('clause', ''))
    standard_rows = [[name, '；'.join(dict.fromkeys(filter(None, clauses)))] for name, clauses in groups.items()]
    cover = '<h1>产品规格书</h1><p class="spec-model">' + text(payload['name']) + '</p>'
    if payload['purpose'] == 'demo':
        cover += '<p class="spec-note">演示设计数据 · 用于核对文档与计算流程，不代表厂家产品承诺。</p>'
    revisions = document_revisions(payload)
    revision = revisions[-1] if revisions else {}
    latest = revision.get('created', '')[:10] or '待编制'
    geometry = results.get('geometry', {}).get('artifact', {})
    execution_standards = approved_standards(payload)
    area = ' / '.join(number(core['conductor']['nominal_area'],1,1e6,trim=True) for core in cable['cores'])+' mm²'
    cover += table(['型号摘要', '规格', '文件项目', '内容'], [
        ['额定电压 U0/U', voltage(cable), '文件版本', revision.get('version') or '编制草稿'],
        ['芯数 × 截面', str(len(cable['cores']))+' × '+area, '基准版本', readable_version(payload['base_reference']['version'])],
        ['成品外径（推导）', number(geometry.get('outer_diameter_m'),1,1000)+' mm' if geometry else '未计算',
         '文件状态', STATUS_NAMES.get(lifecycle['status'], '待核对')],
        ['执行标准', '；'.join(execution_standards) or '未声明（在要求与标准里批准）', '编制日期', latest],
        ['编制单位', '待填写', '编制人', revision.get('author') or '待填写']], widths=[1.4,2.5,1.1,1.6])
    cover += '<h3>编制与审核签字</h3>' + table(['职责','签字','日期'],
        [['编制','________________','________________'],['审核','________________','________________'],['批准','________________','________________']], widths=[1,2.5,2.5])
    cover += '<p class="spec-note">签字栏供人工填写；电子批准及发布状态以系统记录为准。</p>'
    if not internal and lifecycle['status'] != 'published':
        cover += '<p class="spec-note">客户版编制草稿 · 未批准发布。</p>'
    version_status = lifecycle.get('version_status', {})
    if version_status.get('status') == 'stale':
        reasons = list(dict.fromkeys(human_note(reason.get('message')) for reason in version_status.get('reasons', []) if reason.get('message')))
        cover += '<p class="spec-note" data-version-status="stale">历史结果 · '+text('；'.join(reasons) or '来源版本已变化')+'；请重算后生成当前规格书。</p>'
    return [
        cover,
        table(['产品项目','规格'], [['额定电压 U0/U',voltage(cable)], ['芯数',len(cable['cores'])],
              ['导体标称截面',' / '.join(number(core['conductor']['nominal_area'],1,1e6,trim=True) for core in cable['cores'])+' mm²']], widths=[1.5,4.5])
        + table(['核对依据（不代替执行标准批准）','相关条款'], standard_rows, missing_reason(payload,'standards'), [1.7,4.3]),
        geometry_tables(payload, audience),
        calculation_conditions(artifact_rows(results,'electrical')) + parameter_table(artifact_rows(results,'electrical') if internal else combined_core_rows(artifact_rows(results,'electrical'),core_ids),missing_reason(payload,'electrical')),
        rating_tables(results.get('rating', {}), missing_reason(payload,'rating'), audience),
        calculation_conditions(artifact_rows(results,'short_circuit'), True) + parameter_table(artifact_rows(results,'short_circuit') if internal else combined_core_rows(artifact_rows(results,'short_circuit'),core_ids),missing_reason(payload,'short_circuit'),True),
        check_tables(standards, payload['checks'], payload['document']) + inapplicable_list(payload) if internal else
            '<p class="spec-conditions">判定与余量逐项引用保存的插件结果；缺项和未覆盖不视为满足。本表不替代完整产品认证。</p>' +
            check_tables(combined_core_rows(standards,core_ids), None, payload['document']),
        table(['文件版本', '变更摘要', '编制人', '日期（UTC）'],
              [[row['version'], row['summary'], row['author'], row['created'][:10]] for row in revisions],
              '尚未提交文档评审。', [1.2,3.4,1.2,1.5]) + customer_sources(payload),
    ]


def approved_standards(payload):
    from .requirements import Requirements
    source = next((row for row in payload.get('sources', []) if row.get('channel') == 'standards'), {})
    if source.get('freshness') != 'current' or not source.get('method'):
        return []
    approved = {}
    for review in payload.get('requirement_reviews', []):
        receipt = review.get('receipt', {})
        if receipt.get('decision') == 'approved':
            for item in receipt.get('items', []):
                approved[item['id']] = item['definition_digest']
    names = []
    for row in artifact_rows(payload['results'], 'standards'):
        # 缺对象、条款或版本定义的行不能成为可绑定要求，只是不计入执行标准，不让整份规格书失败
        try:
            proposal = Requirements.proposal(row, source['method'])
        except KeyError:
            continue
        if proposal['bindable'] and approved.get(proposal['id']) == proposal['definition_digest'] and row['standard'] not in names:
            names.append(row['standard'])
    return names


def customer_sources(payload):
    """Human-readable provenance; immutable IDs stay in the host audit record."""
    base = payload.get('base_reference', {})
    rows = [['基准型号', clean_name(base.get('name') or payload['name']), readable_version(base.get('version'))]]
    plan = payload.get('plan_reference')
    if plan:
        rows.append(['引用方案', clean_name(plan['name']), '新版本草稿' if plan['status'] == 'version_draft' else '方案草稿'])
    creation = payload.get('creation_source', {})
    origin = creation.get('origin')
    if origin:
        source = creation.get('source', {})
        rows.append([{'library':'库引用','published':'发布型号引用','standard':'标准结构提案','import':'批准的资料','blank':'空白设计'}.get(origin,'设计来源'),
                     clean_name(source.get('name') or payload['name']), readable_version(source.get('version'))])
        for reference in source.get('references', []):
            if reference.get('page') is not None:
                rows.append(['资料页码', reference.get('title') or '批准的资料原件', '第 '+str(reference['page'])+' 页'])
        for fact in source.get('rows', []):
            citation = fact.get('source', {})
            if citation.get('standard') and citation.get('clause'):
                rows.append(['标准提案依据', citation['standard']+' '+citation['clause'],
                             '印刷页 '+str(citation['printed_page']) if citation.get('printed_page') is not None else 'PDF 页 '+str(citation['pdf_page']) if citation.get('pdf_page') is not None else '标准值'])
    for source in payload.get('sources', []):
        method = source.get('method', {})
        rows.append([CHANNEL_NAMES.get(source.get('channel'), '保存结果'),
                     METHOD_NAMES.get(method.get('plugin_id'), '计算方法'),
                     readable_version(method.get('version'))+' · '+STATUS_NAMES.get(source.get('freshness'),'待核对')])
    for role in ('material','standard'):
        for pin in payload.get('resource_bindings', {}).get(role, {}).values():
            rows.append(['材料资源' if role == 'material' else '标准资源', pin['name'], readable_version(pin['version'])])
    body = '<h3>来源与版本</h3>'+table(['来源类别','名称 / 方法','版本与时效'], rows, widths=[1.2,3.4,1.5])
    source = payload.get('document', {}).get('provenance', {})
    notes = list(dict.fromkeys(value.get('note') for value in source.values() if value.get('note')))
    # Free-text engineering provenance is retained, while opaque audit keys are omitted.
    body += ''.join('<p>'+text(human_note(note))+'</p>' for note in notes
                    if not re.search(r'[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f-]{27,}', str(note)))
    return body


def source_evidence(payload, digest):
    body = '<h2>来源与运行依据</h2><p>规格书摘要：' + text(digest) + '</p>'
    for source in payload['sources']:
        method = source.get('method', {})
        name = CHANNEL_NAMES.get(source.get('channel'), METHOD_NAMES.get(method.get('plugin_id'), '保存的计算方法'))
        body += '<h3>' + text(name) + '</h3>' + table(['追溯项目','保存记录'], [
            ['方法与版本',METHOD_NAMES.get(method.get('plugin_id'), '计算插件') + ' · ' + str(method.get('version') or '待提供')],
            ['状态与时效',STATUS_NAMES.get(source.get('status'), '待核对') + ' · ' + STATUS_NAMES.get(source.get('freshness'), '待核对')],
            ['运行编号',source.get('run_id')], ['输入摘要',source.get('input_digest')],
            ['输出摘要',source.get('output_digest')], ['方法发行摘要',method.get('release_digest')]], widths=[1.3,4.7])
    if not payload['sources']:
        body += '<p>尚无保存的计算来源。</p>'
    return body


def render_specification(payload, digest, lifecycle, audience='internal'):
    """Format immutable inputs and literal saved outputs; never run a method."""
    sections = ''.join(
        f'<section id="chapter-{index + 1}" data-specification-section="{marker}">'
        + (f'<h2>{index + 1}. {text(name)}</h2>' if index else '') + body + '</section>'
        for index, (name, marker, body) in enumerate(zip(chapter_names(audience), SECTIONS, chapter_bodies(payload, lifecycle, audience)))
    )
    details = '<details data-specification-evidence><summary>来源与运行依据</summary>' + source_evidence(payload, digest) + '</details>' if audience == 'internal' else ''
    tokens = Path(__file__).resolve().parents[2].joinpath('design', 'tokens.css').read_text('utf-8')
    return (
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>'
        + text(payload['name']) + ' · 规格书</title><style>' + tokens + STYLES + '</style>'
        + sections + details + '</html>'
    )


def payload_from_runs(runs):
    """Adapt the existing geometry/rating delivery branch to the same eight chapters."""
    results, sources, document, cable_id = {}, [], None, None
    for run in runs:
        for case in run['output']['cases']:
            if case['status'] != 'succeeded':
                continue
            for channel, artifact_key in CHANNELS.items():
                if artifact_key in case.get('artifacts', {}):
                    results[channel] = {'artifact': case['artifacts'][artifact_key], 'case_id': case['case_id']}
                    if document is None:
                        document = next(item['input'] for item in run['snapshot']['cases'] if item['case_id'] == case['case_id'])
                        cable_id = run['snapshot']['definition'].get('parameters', {}).get('cable_type_id')
        if is_rating_table(run):
            results['rating'] = {
                'rows': rating_rows(run),
                'parameters': deepcopy(run['snapshot']['definition']['parameters']),
            }
            if document is None:
                document = run['snapshot']['workspace_state']['domain']
        sources.append({
            'run_id': run['id'], 'input_digest': run['input_digest'], 'output_digest': run['output_digest'],
            'method': run['snapshot']['definition']['method'], 'status': run['status'], 'freshness': run['freshness'],
        })
    document = deepcopy(document)
    cable = next((item for item in document['cable_types'] if item['id'] == cable_id), document['cable_types'][0])
    document['cable_types'] = [cable]
    state = runs[0]['snapshot']['workspace_state']
    base = state.get('type_origin_reference') or {'version': '保存运行'}
    geometry = results.get('geometry', {}).get('artifact', {})
    limitations = [geometry.get('geometry_approximation'), geometry.get('display_approximation')]
    limitations.extend(item for run in runs for item in run['output'].get('limitations', []))
    checks = [{'message': item} for item in limitations if item]
    return {
        'schema': 'cablesim.type-specification/1', 'renderer': 'type-specification/1',
        'name': clean_name(cable['label']), 'purpose': 'demo' if any(
            source.get('kind') == 'demo' for source in document.get('provenance', {}).values()
        ) else 'engineering',
        'revision': runs[0]['snapshot']['workspace_revision'], 'base_reference': base,
        'document': document, 'results': results, 'sources': sources, 'checks': checks,
        'revisions': [], 'chapters': CHAPTERS, 'run_evidence': runs,
    }


def render_run_specification(runs):
    from .version_status import cover_status
    payload = payload_from_runs(runs)
    return render_specification(payload, fingerprint(payload), {'status': 'draft', 'approval': None, 'version_status': cover_status(runs)})
