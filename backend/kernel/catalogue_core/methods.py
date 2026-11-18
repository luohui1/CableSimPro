"""Method cards and trust tiers.

A tier states how far the method is validated for the configuration that was actually
computed. It is decided from the saved input, never from the result, and it says nothing
about the quality of the cable data, which is reported separately.
"""
from cablesim_sdk.domain import CableType
from . import runner

IEC = 'cablesim.iec60287'
STEADY = 'steady-rating'
TIERS = {
    'deliverable': {'label': '可交付', 'meaning': '本敷设形式有公开算例的整链对照，结果可用于交付；输入数据的出处仍须由工程师确认。'},
    'reference': {'label': '参考', 'meaning': '本敷设形式只有手算或解析自洽检查，没有公开算例的整链对照；结果供比较与初判，交付前应另行核对。'},
    'exploratory': {'label': '探索', 'meaning': '方法尚未通过评测基准，结果只用于探索。'},
}
METHODS = [{
    'id': 'iec60287.steady', 'plugin': IEC, 'capability': STEADY, 'title': 'IEC 60287 稳态载流量',
    'family': '标准解析',
    'summary': '按 IEC 60287-1-1 / 2-1:2023 求稳态温度场的解析解：导体、护套、介质损耗经电缆各层热阻与土壤外部热阻散到地表，'
               '反求导体恰好到温限时的电流。',
    'answers': ['允许电流（载流量）', '给定负荷下的导体、护套、表面温度', '各项损耗与各段热阻'],
    'inputs': ['电缆结构与材料（含 20 °C 导体直流电阻）', '敷设位置、埋深、间距与管道尺寸', '土壤热阻率与地表温度',
               '护套接地方式', '集肤 / 邻近效应系数 ks、kp'],
    'cost': '单次约 2 s，本机计算',
}, {
    'id': 'gb50217.correction', 'plugin': 'cablesim.gb50217-correction', 'capability': 'steady-rating', 'title': 'GB 50217 载流量校正',
    'family': '标准校正',
    'summary': '按 GB 50217—2018 附录 D，把一个单根的基准载流量换算到实际的环境温度和并列敷设：系数取自标准依据库，每个都带条款和页码，'
               '校正后的载流量等于基准值乘各系数。这是查表换算，不是热路计算。',
    'answers': ['校正后的允许电流', '环境温度系数、并列或桥架系数及其条款和页码'],
    'inputs': ['单根基准载流量：须有出处，并由工程师确认条件', '基准条件：土壤 25 °C 或空气 40 °C，同一中心埋深，同一土壤热阻率',
               '实际环境温度、并列根数与净距（或中心距）、系统线电压（10 kV 及以下）', '三芯电缆，每回路一根',
               '可选 D.0.6：明确梯架或托盘及出处，保存 1–4 层、每层至少 7 根水平接触且各层排列一致的实际几何'],
    'cost': '单次约 3 s，本机计算',
}, {
    'id': 'gb50217.outdoor', 'plugin': 'cablesim.gb50217-correction', 'capability': 'outdoor-unshaded-rating',
    'title': 'GB 50217 户外无遮阳校正', 'family': '标准校正',
    'summary': '仅将已按实际户外环境温度取得的户内空气单根载流量乘以表 D.0.7 的原值；不再叠加温度、土壤、并列或桥架系数。',
    'answers': ['户外明敷无遮阳的参考允许电流', 'D.0.7 原单元格、条件和完整出处'],
    'inputs': ['一个空气截面、一个三相回路的一根三芯电缆，额定和实际线电压同为 1 kV 或 6 kV',
               '三个芯相同且有来源的表内标称截面；基准温度等于保存的实际空气温度，正常温限相同',
               '明确的基准原件、页码、摘要及人工核对；户外明敷无遮阳和自然通风的明确来源',
               '不填写默认辐照或零风速；单芯、表内空格、量化日照或风速、分组和外部热源明确拒绝'],
    'cost': '单次查表，本机计算；仅标准参考校正，不是厂家保证值',
}]


def catalogue():
    cards = []
    for method in METHODS:
        manifest, _ = runner.manifest(method['plugin'])
        spec = runner.capability(method['plugin'], method['capability'])
        cards.append({**method, 'plugin_version': manifest['version'], 'method_version': spec['method_version'],
                      'validation_level': spec['validation']['level'], 'validation_cases': spec['validation']['cases'],
                      'limitations': spec['limitations'], 'tiers': TIERS})
    return cards


def _sheath_forms(cable):
    layers = [layer for core in cable['cores'] for layer in core['layers']] + cable['common_layers']
    return {layer.get('form') for layer in layers if layer['role'] == 'metallic_sheath'}


def tier(document, parameters):
    """Tier and the evidence behind it for one composed input."""
    cable, section = document['cable_types'][0], document['sections'][0]
    template = (section.get('layout_template') or {}).get('kind')
    weak = []
    if cable['construction'] != 'single_core':
        weak.append('三芯分支：六种直埋 / 排管手算核对，TB 880 算例 2 的热阻与钢丝损耗、算例 10 的钢带损耗只对照了组件，没有整链公开算例。')
    if len(document['circuits']) > 1:
        weak.append('多回路：回路间互热按镜像法叠加，与闭式解析解自洽，没有公开算例的整链对照。')
    if section.get('backfill'):
        weak.append('矩形回填 / 包封：IEC 60287-2-1:2023 表 2 的节点、插值与修正项只做了自洽核对。')
    if 'corrugated' in _sheath_forms(cable):
        weak.append('皱纹金属护套：缓冲层与间隙的有效热阻率是工程师给定的参考值，不是厂家试验值。')
    if 'per_cable_losses' in parameters:
        weak.append('电损耗系数由外部给定，本方法未核对其来源。')
    if weak:
        return {'tier': 'reference', **TIERS['reference'], 'basis': weak}
    ducted = bool(section.get('enclosures'))
    if ducted:
        basis = ['CIGRE TB 880 算例 0-2（接触品字形穿管）整链对照，含 GP31 涡流变体；算例 0-3（平排穿管）整链对照。']
    elif template == 'flat':
        basis = ['整链对照的是 CIGRE TB 880 算例 0-3（平排、穿管、混凝土包封，含单端接地与涡流变体）；'
                 '直埋水平用同一套护套损耗公式和镜像法外部热阻，少了管道与包封两项。本布置没有单独的整链公开算例。']
    else:
        spacing = (section.get('layout_template') or {}).get('spacing')
        touching = spacing is not None and abs(spacing - 2 * CableType.model_validate(cable).radius()) < 1e-9
        basis = ['CIGRE TB 880 算例 0-1（接触品字形直埋）整链对照，含外部热阻精确根式、单端接地、GP31 涡流变体，允许电流差值不大于 6.4e-6 A。'
                 if touching else
                 '整链对照的是 CIGRE TB 880 算例 0-1（接触品字形直埋）；留间隔品字形用同一套损耗公式，外部热阻改用镜像法叠加，'
                 '没有单独的整链公开算例。']
    return {'tier': 'deliverable', **TIERS['deliverable'], 'basis': basis}


def card(document, parameters, run, trace=None):
    """The method card stored with a run: method, scope, assumptions, validation."""
    method = METHODS[0]
    spec = runner.capability(run['plugin_id'], run['capability'])
    level = tier(document, parameters)
    return {
        'method': method['title'], 'family': method['family'], 'summary': method['summary'],
        'plugin': f"{run['plugin_id']} {run['plugin_version']}", 'capability': run['capability'],
        'method_version': run['method_version'], 'manifest_sha256': run['manifest_sha256'],
        'standards': (trace or {}).get('sources', []),
        'scope': spec['limitations'],
        'assumptions': [*(trace or {}).get('decisions', []),
                        *([trace['electrical_basis']] if trace and trace.get('electrical_basis') else []),
                        *([trace['result_scope']] if trace and trace.get('result_scope') else [])],
        'validation': {'level': spec['validation']['level'], 'cases': spec['validation']['cases'],
                       'this_configuration': level['basis']},
        'tier': level,
    }
