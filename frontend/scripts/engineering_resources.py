"""Offline, sourced reference resources; never patch a design's physical values.

Extracts from the controlled local PDFs, not full standard texts. Publication of
these reference definitions is authorized by the resource-library seed task; it
does not approve a cable design or its requirements. Values are conditional
standard references, not manufacturer measurements or default inputs.
"""
from copy import deepcopy
import json
from uuid import uuid4

from backend.foundation.contracts import AssetRelease, content_hash


RULES = {
    'gb-lv': ('GB/T 12706.1—2020', '2020.0.0',
              '额定电压1 kV和3 kV挤包绝缘电力电缆；修改采用IEC 60502-1:2004。',
              'GBT12706.1-2020 额定电压1 kV(Um=1.2 kV)到35 kV(Um=40.5 kV)挤包绝缘电力电缆及附件 第1部分：额定电压1 kV(Um=1.2 kV)和3 kV(Um=3.6 kV)电缆.pdf',
              '9c398e261e5b88d24db5f0ca5a698402bc25eab6e4da0de063ebd4cd7790f6f1'),
    'gb-mv': ('GB/T 12706.2—2020', '2020.0.0',
              '额定电压6 kV到30 kV挤包绝缘电力电缆；修改采用IEC 60502-2:2014。',
              'GBT12706.2-2020 额定电压1 kV(Um=1.2 kV)到35 kV(Um=40.5 kV)挤包绝缘电力电缆及附件 第2部分：额定电压6 kV(Um=7.2kV)到30 kV(Um=36 kV)电缆.pdf',
              '3b5fa321c213d4aaac7e04a293b9026626f43cc5b15209b26b713172e56f748d'),
    'gb-hv': ('GB/T 11017.2—2024', '2024.0.0',
              '额定电压66 kV和110 kV交联聚乙烯绝缘电力电缆及附件，第2部分：电缆。',
              'GBT+11017.2-2024.pdf',
              '5a9ecebbedf59c0b99d44c4b3520147d8bd08208ff2b7b6f338cdbbe5628b89b'),
    'gb-conductor': ('GB/T 3956—2008', '2008.0.0',
                     '绝缘电缆导体的类别、标称截面和最大直流电阻；等同采用IEC 60228:2004，不替代IEC 60228:2023。',
                     'GB-T 3956-2008 电缆的导体.pdf',
                     'b9a118e1282b4eeee6ec6ae4653e8c80e0a42beee0df5bf84360c4876a856939'),
    'iec-conductor': ('IEC 60228:2023', '2023.0.0',
                      '绝缘电缆导体，第4版；导体类别、标称截面、直流电阻与导体尺寸。',
                      'IEC 60228-2023.pdf',
                      'd50b9d8338bdd224b0ffef2714d2e58722b2408e624c161d3503ae2c3374605e'),
    'iec-loss': ('IEC 60287-1-1:2023', '2023.0.0',
                 '第3版；100%负载率的稳态载流量和损耗计算；交流所有电压、直流不超过5 kV。',
                 'iec60287-1-1{ed3.0.CMV}en.pdf',
                 'b300bb2bea52ce64e24c8137193559d7ee4cc04013ec4122357a2625e868a327'),
    'iec-thermal': ('IEC 60287-2-1:2023', '2023.0.0',
                    '第3版；稳态热阻计算，含土壤部分干燥；交流所有电压、直流不超过5 kV。',
                    'iec60287-2-1{ed3.0.CMV}en.pdf',
                    'a273d784ccf13b73915557c22ce3642c6c1bef94be6034ebd8237e8a7d997f52'),
}


def metal(rho, alpha, condition):
    return [('electrical_resistivity_20', rho, 'ohm.m', 'iec-loss', '1', 35, 83, condition),
            ('temperature_coefficient_20', alpha, 'K^-1', 'iec-loss', '1', 35, 83, condition)]


def thermal(rho, condition):
    return [('thermal_resistivity', rho, 'K.m/W', 'iec-thermal', '1', 33, 89, condition)]


def dielectric(epsilon, tangent, condition):
    # Table 3 is for MV/HV power-frequency insulation at maximum permitted
    # temperature. It is not an LV or formula-specific manufacturer guarantee.
    condition += '；中高压工频，最高允许温度的安全参考值'
    return [('relative_permittivity', epsilon, '1', 'iec-loss', '3', 37, 85, condition),
            ('loss_tangent', tangent, '1', 'iec-loss', '3', 37, 85, condition)]


MATERIALS = {
    'copper-conductor': ('铜 · 导体标准参考', metal(1.7241e-8, .00393, '导体铜，20 °C；表注来源IEC 60028')),
    'aluminium-conductor': ('铝 · 导体标准参考', metal(2.8264e-8, .00403, '导体铝，20 °C；表注来源IEC 60889')),
    'aluminium-sheath': ('铝 · 护套与铠装标准参考', metal(2.84e-8, .00403, '护套与铠装铝，20 °C')),
    'lead-sheath': ('铅或铅合金 · 护套标准参考', metal(21.4e-8, .004, '护套与铠装铅或铅合金，20 °C')),
    'steel-armour': ('钢 · 铠装标准参考', metal(13.8e-8, .0045, '护套与铠装钢，20 °C；未指定镀锌工艺')),
    'copper-screen': ('铜 · 屏蔽材料待补', []),
    'xlpe-mv': ('XLPE · 未填充中压绝缘参考', thermal(3.5, 'XLPE绝缘') + dielectric(2.5, .004, '未填充XLPE，≤18/30 (36) kV')),
    'xlpe-hv': ('XLPE · 未填充高压绝缘参考', thermal(3.5, 'XLPE绝缘') + dielectric(2.5, .001, '未填充XLPE，>18/30 (36) kV')),
    'xlpe-filled-hv': ('XLPE · 填充高压绝缘参考', thermal(3.5, 'XLPE绝缘') + dielectric(3., .005, '填充XLPE，>18/30 (36) kV')),
    'epr-lv': ('EPR · 不超过3 kV绝缘参考', thermal(3.5, 'EPR绝缘，≤3 kV')),
    'epr-mv': ('EPR · 中压绝缘参考', thermal(5., 'EPR绝缘，>3 kV') + dielectric(3., .020, 'EPR，≤18/30 (36) kV')),
    'epr-hv': ('EPR · 高压绝缘参考', thermal(5., 'EPR绝缘，>3 kV') + dielectric(3., .005, 'EPR，>18/30 (36) kV')),
    'semiconductor-pe': ('半导电XLPE / PE · 标准参考', thermal(2.5, '半导电XLPE和PE；载流量模型按表1脚注a及4.1.3选择')),
    'semiconductor-epr': ('半导电EPR · 标准参考', thermal(3.5, '半导电EPR；载流量模型按表1脚注a及4.1.3选择')),
    'pe-covering': ('PE · 保护护层标准参考', thermal(3.5, '保护护层PE')),
    'pvc-covering-mv': ('PVC · 不超过35 kV保护护层参考', thermal(5., '保护护层PVC，≤35 kV')),
    'pvc-covering-hv': ('PVC · 超过35 kV保护护层参考', thermal(6., '保护护层PVC，>35 kV')),
    'pvc-insulation-lv': ('PVC · 不超过3 kV绝缘参考', thermal(5., 'PVC绝缘，≤3 kV')),
    'pvc-insulation-mv': ('PVC · 超过3 kV绝缘参考', thermal(6., 'PVC绝缘，>3 kV')),
    'pvc-reference': ('PVC · 分用途标准参考', [
        ('thermal_resistivity_insulation_le3kv', 5., 'K.m/W', 'iec-thermal', '1', 33, 89, 'PVC绝缘，≤3 kV'),
        ('thermal_resistivity_insulation_gt3kv', 6., 'K.m/W', 'iec-thermal', '1', 33, 89, 'PVC绝缘，>3 kV'),
        ('thermal_resistivity_covering_le35kv', 5., 'K.m/W', 'iec-thermal', '1', 33, 89, '保护护层PVC，≤35 kV'),
        ('thermal_resistivity_covering_gt35kv', 6., 'K.m/W', 'iec-thermal', '1', 33, 89, '保护护层PVC，>35 kV')]),
    'corrugated-covering': ('PVC / 沥青 · 波纹铝护套覆盖参考', thermal(6., '波纹铝护套上的PVC或沥青覆盖层')),
}


def reference(value):
    return {'kind': 'standard', 'reviewed': True,
            'reference': json.dumps(value, ensure_ascii=False, separators=(',', ':'))}


def definitions():
    """Represent additional units in immutable source JSON, without abusing Quantity.

    AssetRelease.Quantity does not support ohm.m, K^-1 or dimensionless values.
    These values remain typed reference records in sources; only the supported
    thermal quantity is also a native parameter. No shared contract is changed.
    """
    releases = []
    rules = {}
    for key, (name, version, scope, filename, digest) in RULES.items():
        release = AssetRelease.model_validate({
            'asset_id': 'standard/'+key, 'version': version, 'kind': 'rule', 'name': name,
            'sources': [reference({'schema': 'cablesim.reference-data/1', 'standard': name,
                                  'edition': name.rsplit(':', 1)[-1] if ':' in name else name.rsplit('—', 1)[-1],
                                  'source_digest': digest, 'file': filename, 'pdf_page': 1,
                                  'scope': scope, 'rights': 'not_assessed/not_registered'})]})
        rules[key] = release
        releases.append(release)
    for key, (name, properties) in MATERIALS.items():
        sources, parameters = [], []
        for prop, value, unit, rule, table, printed, page, condition in properties:
            standard = rules[rule]
            sources.append(reference({'schema': 'cablesim.reference-data/1', 'property': prop,
                                      'value': value, 'unit': unit, 'basis': 'standard_reference',
                                      'standard': standard.name, 'table': table,
                                      'printed_page': printed, 'pdf_page': page,
                                      'source_digest': RULES[rule][4], 'condition': condition}))
            if prop == 'thermal_resistivity':
                parameters.append({'name': prop, 'quantity': {'value': value, 'unit': unit,
                                                             'dimension': 'thermal_resistivity'}})
        missing = ['density']
        if not properties:
            missing += ['electrical_resistivity_20', 'temperature_coefficient_20']
        if key == 'epr-lv':
            missing += ['relative_permittivity', 'loss_tangent']
        absence = {'schema': 'cablesim.reference-data/1', 'missing': missing,
                   'reason': '核验表未提供该用途的值；不从其他用途、配方或厂家值补默认。'}
        if key == 'copper-screen':
            absence.update(standard=rules['iec-loss'].name, table='1', printed_page=35, pdf_page=83,
                           source_digest=RULES['iec-loss'][4], reason='表1护套与铠装组无铜行；导体铜行不冒充屏蔽材料数据。')
        sources.append(reference(absence))
        dependencies = [rules[rule].reference().model_dump(mode='json') for rule in sorted({p[3] for p in properties})]
        releases.append(AssetRelease.model_validate({'asset_id': 'material/'+key, 'version': '1.0.0',
                         'kind': 'material', 'name': name, 'parameters': parameters,
                         'sources': sources, 'dependencies': dependencies}))
    return releases


def identity():
    return content_hash([release.model_dump(mode='json') for release in definitions()])


def publish_resources(api):
    """Idempotent normal draft -> review -> publish with CAS, never SQL promotion."""
    result = {}
    for release in definitions():
        offset, existing = 0, None
        while True:
            page = api('/api/foundation/assets?kind='+release.kind+'&limit=100&offset='+str(offset))
            existing = next((item for item in page['items'] if (item['asset_id'], item['version']) ==
                             (release.asset_id, release.version)), None)
            offset += len(page['items'])
            if existing or offset >= page['total']:
                break
            if not page['items']:
                raise RuntimeError('资源分页未返回预期数据，停止导入。')
        saved = api('/api/foundation/assets/'+existing['id']) if existing else api(
            '/api/foundation/assets/import', 'POST', {'release': release.model_dump(mode='json')})
        if saved['content_sha256'] != content_hash(release):
            raise RuntimeError('资源版本内容冲突，未覆盖：'+release.asset_id+'@'+release.version)
        for state, action in (('draft', 'review'), ('reviewed', 'publish')):
            if saved['status'] != state:
                continue
            saved = api('/api/foundation/assets/'+saved['id']+'/transition', 'POST', {
                'expected_revision': saved['revision'], 'content_sha256': saved['content_sha256'],
                'action': action, 'note': '本轮授权核对并发布标准摘录参考定义；保留条件、页码及缺项，不批准型号。',
                'acknowledge_sources': True})
        if saved['status'] != 'published' or saved['issues']:
            raise RuntimeError('资源版本不可新引用：'+release.asset_id)
        result[release.asset_id] = {k: saved[k] for k in ('id', 'asset_id', 'version', 'name', 'content_sha256')}
    return result


# Explicit identities in the two bundled source designs. No label matching,
# chemical-name inference, numeric fingerprint inference or property replacement.
DEMO_MATERIALS = {
    'mv': {'material/cu': 'copper-conductor', 'material/semi': 'semiconductor-pe',
           'material/xlpe': 'xlpe-mv', 'material/pvc': 'pvc-reference',
           'material/steel': 'steel-armour'},
    'hv': {'material/cu': 'copper-conductor', 'material/semi': 'semiconductor-pe',
           'material/insulation-qifan': 'xlpe-hv', 'material/al-qifan': 'aluminium-sheath',
           'material/bitumen-qifan': 'corrugated-covering', 'material/pe-qifan': 'pe-covering'},
}


def bind_demo_resources(api, wid, source_design):
    """Save reviewed source identities, then use the unchanged unique-match gate."""
    workspace = api('/api/workspaces/'+wid)
    document = deepcopy(workspace['domain'])
    provenance = document.setdefault('provenance', {})
    for index, material in enumerate(document['materials']):
        key = DEMO_MATERIALS[source_design].get(material['id'])
        if key:
            location = '/materials/'+str(index)
            # An explicit prior resource choice is retained, even if different.
            try:
                previous = json.loads(provenance.get(location, {}).get('reference', '{}'))
            except (TypeError, ValueError):
                previous = {}
            if isinstance(previous, dict) and previous.get('asset_id'):
                continue
            provenance[location] = {'kind': 'asset', 'reviewed': True, 'reference': json.dumps({
                'asset_id': 'material/'+key, 'source_design': source_design,
                'scope': '已核对的随附源设计材料身份；不覆盖型号物性，不选择最新版本。'}, ensure_ascii=False)}
    declaration = {'schema': 'cablesim.execution-standards/1', 'items': [
        {'standard': RULES[key][0], 'source_digest': RULES[key][4]}
        for key in (('gb-mv', 'gb-conductor') if source_design == 'mv' else ('gb-hv', 'gb-conductor'))]}
    provenance.setdefault('/execution_standards', {'kind': 'standard', 'reviewed': True,
                                                  'reference': json.dumps(declaration, ensure_ascii=False)})
    if document != workspace['domain']:
        api('/api/workspaces/'+wid+'/domain', 'PUT', {'expected_revision': workspace['revision'], 'document': document})
    view = api('/api/types/'+wid+'/resources')
    # Do not create a replay/event for an already migrated seed.
    if any(t['state'] == 'unbound' and t['unique_match'] for t in view['targets']):
        view = api('/api/types/'+wid+'/resources/migrate', 'POST', {
            'expected_revision': view['revision'], 'request_id': str(uuid4())})
    return view
