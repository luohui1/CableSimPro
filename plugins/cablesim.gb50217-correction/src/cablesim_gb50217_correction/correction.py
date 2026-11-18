"""GB 50217:2018 Annex D; coefficients are resolved by a sealed basis plugin.

No tables are duplicated here. D.0.2 is an explicit standard formula, not an
interpolation licence. D.0.6 requires an explicitly sourced, saved tray layout;
sunlight, ducts, layered/backfill soil and unequal parallel cables are refused.
"""
from hashlib import sha256
from math import isclose, isfinite, prod, sqrt
import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from backend.plugin_host.executor import Executor
from backend.plugin_host.registry import Registry, PluginHostError
from cablesim_sdk.domain import DomainDocument

ARTIFACT = 'x-cablesim.gb50217-correction'
BASELINE = 'x-cablesim.gb50217.baseline-current'
FACTOR = 'x-cablesim.gb50217.correction-factor'
TRAY_FIELDS = {'tray_kind', 'tray_layout_source', 'tray_layout_confirmed'}


class CorrectionError(ValueError):
    def __init__(self, message, field, code='CORRECTION_NOT_APPLICABLE'):
        super().__init__(message)
        self.field, self.code = field, code


class Parameters(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    baseline_current_a: float = Field(gt=0)
    baseline_ambient_k: float = Field(gt=0)
    baseline_soil_rho: float = Field(gt=0)
    baseline_kind: str = Field(pattern='^(manufacturer|gb_c012)$')
    baseline_source: str = Field(min_length=4, max_length=500)
    baseline_sha256: str = Field(pattern='^[0-9a-f]{64}$')
    baseline_page: int = Field(ge=1)
    baseline_depth_m: float = Field(gt=0)
    baseline_reviewed: bool
    basis_release_digest: str = Field(pattern='^[0-9a-f]{64}$')
    tray_kind: Literal['ladder', 'tray'] | None = None
    tray_layout_source: str | None = Field(default=None, min_length=4, max_length=2000)
    tray_layout_confirmed: bool | None = None
    # The baseline must be a single cable at the saved normal conductor limit.
    # Actual ambient/soil/parallel count/spacing come from the same domain as IEC.

    @field_validator('tray_kind', mode='before')
    @classmethod
    def explicit_tray_kind(cls, value):
        if type(value) is not str or value not in ('ladder', 'tray'):
            raise ValueError('请明确选择原表中的梯架或托盘；不从容纳结构名称推断。')
        return value

    @field_validator('tray_layout_source', mode='before')
    @classmethod
    def explicit_layout_source(cls, value):
        if type(value) is not str or len(value.strip()) < 4:
            raise ValueError('请填写桥架类别与保存布局的实际出处和版本。')
        return value

    @field_validator('tray_layout_confirmed', mode='before')
    @classmethod
    def explicit_layout_confirmation(cls, value):
        if value is not True:
            raise ValueError('须明确确认桥架类别与保存布局；不接受数字或文字代替布尔确认。')
        return value


def digest(value):
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def _pointer(*parts):
    return '/' + '/'.join(str(value).replace('~', '~0').replace('/', '~1') for value in parts)


def _layout_source(document, stable, indexed, value, unit=None, *, context='桥架校正'):
    """Keep the exact source that covers an actually consumed saved field."""
    provenance = document.get('provenance', {})
    candidates = [stable, indexed]
    while any(candidates):
        # Compare both encodings at this distance before considering either
        # ancestor. An indexed field outranks a broad stable parent source.
        for candidate in dict.fromkeys(candidates):
            if not candidate:
                continue
            source = provenance.get(candidate)
            if source is not None:
                if isinstance(source, dict) and isinstance(source.get('reference'), str) and source['reference'].strip():
                    return dict(path=stable, indexed_path=indexed, value=value, unit=unit,
                                source_path=candidate, source=source)
                # An explicitly empty field source cannot borrow a broader one.
                raise CorrectionError(context + '所用保存字段的明确出处为空；不能借用更宽的来源。',
                                      '/input' + indexed, 'CORRECTION_SOURCE_REQUIRED')
        candidates = [path.rsplit('/', 1)[0] for path in candidates]
    raise CorrectionError(context + '所用保存字段缺少明确出处；请在原输入补齐来源。',
                          '/input' + indexed, 'CORRECTION_SOURCE_REQUIRED')


def _tray_layout(document, domain, section, cable, parameters, diameter):
    """D.0.6: one explicitly saved tray enclosure per horizontal layer."""
    if cable.construction != 'three_core':
        raise CorrectionError('本次桥架分支只覆盖每回路一根的同型号三芯电缆。', '/input/cable_types/0/construction')
    if len({c.system.voltage for c in domain.circuits}) != 1:
        raise CorrectionError('桥架各回路须有同一个明确的实际系统线电压。', '/input/circuits')
    if not 1 <= len(section.enclosures) <= 4:
        raise CorrectionError('表 D.0.6 只接受保存的 1 至 4 个实际水平层；一个桥架容纳结构对应一层。', '/input/sections/0/enclosures')
    if any(e.type != 'tray' for e in section.enclosures):
        raise CorrectionError('须保存明确的桥架容纳结构；不把 rack、排管或名称推断为梯架。', '/input/sections/0/enclosures')
    if any(p.enclosure is None for p in section.placements):
        raise CorrectionError('每根电缆都须明确关联保存的桥架层。', '/input/sections/0/placements')
    if section.medium.ventilation == 'forced':
        raise CorrectionError('桥架校正不覆盖强制通风。', '/input/sections/0/medium/ventilation')
    raw_section = document['sections'][0]
    evidence = []

    def sourced(stable, indexed, value, unit=None):
        if unit is not None and (type(value) not in (int, float) or not isfinite(value)):
            raise CorrectionError('桥架校正须使用明确保存的有限数值，不接受文字或布尔数值。',
                                  '/input' + indexed)
        evidence.append(_layout_source(document, stable, indexed, value, unit))

    section_path = ('sections', section.id)
    for field in ('solar_irradiance', 'wind_speed'):
        value = raw_section.get('medium', {}).get(field)
        if type(value) not in (int, float) or not isfinite(value) or value != 0:
            raise CorrectionError('桥架分支须明确保存无日照、无强制风冷的输入；不将缺项视为零。', '/input/sections/0/medium/' + field)
        sourced(_pointer(*section_path, 'medium', field), _pointer('sections', 0, 'medium', field),
                value, 'W/m2' if field == 'solar_irradiance' else 'm/s')
    for field in ('air_temperature',):
        sourced(_pointer(*section_path, 'medium', field), _pointer('sections', 0, 'medium', field),
                raw_section['medium'][field], 'K')
    for i, circuit in enumerate(domain.circuits):
        sourced(_pointer('circuits', circuit.id, 'system', 'voltage'),
                _pointer('circuits', i, 'system', 'voltage'), document['circuits'][i]['system']['voltage'], 'V')
        sourced(_pointer('circuits', circuit.id, 'cable_type'),
                _pointer('circuits', i, 'cable_type'), circuit.cable_type)
    cable_index = next(i for i, value in enumerate(domain.cable_types) if value.id == cable.id)
    raw_type = document['cable_types'][cable_index]
    sourced(_pointer('cable_types', cable.id, 'construction'),
            _pointer('cable_types', cable_index, 'construction'), cable.construction)
    sourced(_pointer('cable_types', cable.id, 'rating', 'max_conductor_temperature', 'normal'),
            _pointer('cable_types', cable_index, 'rating', 'max_conductor_temperature', 'normal'),
            raw_type['rating']['max_conductor_temperature']['normal'], 'K')

    def geometric_value(raw, field, stable, indexed, unit='m'):
        value = raw.get(field)
        if type(value) not in (int, float) or not isfinite(value):
            raise CorrectionError('桥架外径与位置必须来自明确保存的几何值，不采用模型缺省值。',
                                  '/input' + _pointer(*indexed, field))
        sourced(_pointer(*stable, field), _pointer(*indexed, field), value, unit)

    def layer_geometry(layers, stable, indexed):
        for i, layer in enumerate(layers):
            role = layer['role']
            selector = role if sum(item['role'] == role for item in layers) == 1 else i
            geometric_value(layer, 'thickness', (*stable, selector), (*indexed, i))
            if layer.get('form') == 'corrugated':
                geometric_value(layer, 'corrugation_depth', (*stable, selector), (*indexed, i))

    for i, core in enumerate(raw_type['cores']):
        stable = ('cable_types', cable.id, 'cores', core['id'])
        indexed = ('cable_types', cable_index, 'cores', i)
        for field in ('x', 'z'):
            geometric_value(core, field, stable, indexed)
        sourced(_pointer(*stable, 'conductor', 'form'),
                _pointer(*indexed, 'conductor', 'form'), core['conductor']['form'])
        geometric_value(core['conductor'], 'diameter', (*stable, 'conductor'), (*indexed, 'conductor'))
        if core['conductor']['form'] == 'sectoral':
            for field in ('sector_angle_deg', 'sector_rotation_deg'):
                geometric_value(core['conductor'], field, (*stable, 'conductor'), (*indexed, 'conductor'), 'deg')
        layer_geometry(core['layers'], (*stable, 'layers'), (*indexed, 'layers'))
    layer_geometry(raw_type['common_layers'], ('cable_types', cable.id, 'common_layers'),
                   ('cable_types', cable_index, 'common_layers'))
    layers = []
    for ei, enclosure in enumerate(section.enclosures):
        members = sorted((p for p in section.placements if p.enclosure == enclosure.id), key=lambda p: p.x)
        if len(members) < 7 or set(enclosure.contains) != {p.cable for p in members}:
            raise CorrectionError('每个实际桥架层须水平并列不少于 7 根，且成员与保存位置完全一致。', f'/input/sections/0/enclosures/{ei}/contains')
        if any(not isclose(p.z, members[0].z, rel_tol=0, abs_tol=1e-8) for p in members):
            raise CorrectionError('一个桥架容纳结构只表示一个实际水平层，不能用平均高度合并多层。', '/input/sections/0/placements')
        gaps = [right.x-left.x-diameter for left, right in zip(members, members[1:])]
        if any(not isclose(gap, 0, rel_tol=0, abs_tol=1e-8) for gap in gaps):
            raise CorrectionError('表 D.0.6 须逐根接触、无水平间隙；不平均间距、不外推。', '/input/sections/0/placements')
        for member in members:
            pi = next(i for i, value in enumerate(section.placements) if value.cable == member.cable)
            for field in ('x', 'z'):
                geometric_value(raw_section['placements'][pi], field,
                                (*section_path, 'placements', member.cable), ('sections', 0, 'placements', pi))
            sourced(_pointer(*section_path, 'placements', member.cable, 'enclosure'),
                    _pointer('sections', 0, 'placements', pi, 'enclosure'), member.enclosure)
        sourced(_pointer(*section_path, 'enclosures', enclosure.id, 'type'),
                _pointer('sections', 0, 'enclosures', ei, 'type'), enclosure.type)
        layers.append(dict(enclosure_id=enclosure.id, cable_ids=[p.cable for p in members],
                           z_m=members[0].z, x_m=[p.x for p in members],
                           cable_count=len(members), horizontal_gaps_m=gaps))
    layers.sort(key=lambda row: row['z_m'])
    if any(isclose(a['z_m'], b['z_m'], rel_tol=0, abs_tol=1e-8) for a, b in zip(layers, layers[1:])):
        raise CorrectionError('多个桥架结构不能在同一高度冒充多个实际层。', '/input/sections/0/enclosures')
    if any(len(row['x_m']) != len(layers[0]['x_m']) or
           any(not isclose(a, b, rel_tol=0, abs_tol=1e-8) for a, b in zip(row['x_m'], layers[0]['x_m'])) for row in layers[1:]):
        raise CorrectionError('本次受限分支只覆盖各层相同根数和相同横向排列，不用总数或平均值套表。', '/input/sections/0/placements')
    return dict(tray_kind=parameters.tray_kind, layer_count=len(layers),
                horizontal_parallel_cable_count=len(layers[0]['cable_ids']),
                cable_spacing_condition='no_gap', diameter_m=diameter, layers=layers,
                layout_source=parameters.tray_layout_source, layout_confirmed=True,
                source_kind='declared', confidence='reference', approval='not_granted',
                geometry_sources=evidence, method_version='1.1.0',
                limitation='仅按保存水平接触布局核对原表条件；没有推断标准层间距或产生厂家认证。')


def prepare(document, parameters):
    p = Parameters.model_validate(parameters)
    supplied = p.model_fields_set & TRAY_FIELDS
    if supplied and supplied != TRAY_FIELDS:
        missing = sorted(TRAY_FIELDS - supplied)[0]
        raise CorrectionError('桥架类别、实际布局出处和明确确认须同时提供。', '/parameters/' + missing)
    tray = bool(supplied)
    d = DomainDocument.model_validate(document)
    if not p.baseline_reviewed:
        raise CorrectionError('请核对基准载流量、单根敷设条件、正常温限和原件出处，再确认基准已核对。', '/parameters/baseline_reviewed')
    if len(d.sections) != 1:
        raise CorrectionError('本方法只支持一个敷设截面。', '/input/sections')
    section = d.sections[0]
    if section.kind not in ('ground', 'air') or (section.enclosures and not tray) or section.backfill or section.soil_layers:
        raise CorrectionError('仅覆盖均匀土壤直埋或空气单层敷设；排管、桥架、多层与回填未覆盖。', '/input/sections/0')
    if tray and section.kind != 'air':
        raise CorrectionError('表 D.0.6 只用于明确的空气桥架布局，不用于地下或排管。', '/input/sections/0/kind')
    if (section.medium.solar_irradiance or 0) or (section.medium.wind_speed or 0):
        raise CorrectionError('日照或强制风冷不在本次已实现的表格范围内。', '/input/sections/0/medium')
    if document.get('crossing_heat_sources') or document.get('external_heat_sources'):
        raise CorrectionError('存在外部热源，本方法不叠加热源校正。', '/input/sections/0')
    ids = {c.cable_type for c in d.circuits}
    if len(ids) != 1:
        raise CorrectionError('并列电缆必须为相同型号与直径，不对混合型号套表。', '/input/circuits')
    cable = next(t for t in d.cable_types if t.id in ids)
    if not d.circuits or any(c.system.voltage is None for c in d.circuits):
        raise CorrectionError('请填写系统线电压；不能由型号额定电压代替。', '/input/circuits/0/system/voltage')
    voltage = max(c.system.voltage for c in d.circuits)
    if voltage > 10000:
        raise CorrectionError('环境温度校正只覆盖附录 D 的 10 kV 及以下范围。', '/input/circuits/0/system/voltage')
    placements = sorted(section.placements, key=lambda v:v.x)
    expected = {v.id for c in d.circuits for v in c.cables}
    if {v.cable for v in placements} != expected:
        raise CorrectionError('截面须包含全部并列电缆，不能只统计部分回路。', '/input/sections/0/placements')
    if not tray and max(v.z for v in placements)-min(v.z for v in placements)>1e-8:
        raise CorrectionError('表 D.0.4 / D.0.5 仅覆盖同深度、单层水平等间距排列。', '/input/sections/0/placements')
    if section.kind=='ground' and not isclose(-placements[0].z,p.baseline_depth_m,abs_tol=1e-8):
        raise CorrectionError('实际中心埋深与基准不同；附录 D 不提供通用埋深校正，请改用完整计算。', '/parameters/baseline_depth_m')
    ambient = section.medium.surface_temperature if section.kind=='ground' else section.medium.air_temperature
    if not isinstance(ambient,(int,float)):
        raise CorrectionError('请给出恒定环境温度，单位 K。', '/input/sections/0/medium')
    limit = cable.rating.max_conductor_temperature.get('normal')
    if limit is None:
        index = next(i for i, item in enumerate(d.cable_types) if item.id == cable.id)
        raise CorrectionError('请填写电缆正常运行的导体温限。', f'/input/cable_types/{index}/rating/max_conductor_temperature/normal')
    if ambient >= limit:
        field = 'surface_temperature' if section.kind == 'ground' else 'air_temperature'
        raise CorrectionError('实际环境温度必须低于电缆正常导体温限。', '/input/sections/0/medium/' + field)
    if p.baseline_ambient_k >= limit:
        raise CorrectionError('基准环境温度必须低于电缆正常导体温限。', '/parameters/baseline_ambient_k')
    medium = 'soil' if section.kind=='ground' else 'air'
    required_base = 298.15 if medium=='soil' else 313.15
    if not isclose(p.baseline_ambient_k,required_base,abs_tol=1e-8):
        raise CorrectionError('本版只接受表 D.0.1 的基准：空气 40 °C / 土壤 25 °C；不作系数比值外推。', '/parameters/baseline_ambient_k')
    rho = None
    if medium=='soil':
        material = next((m for m in d.materials if m.id==section.medium.material),None)
        rho = material.thermal_resistivity if material else None
        if rho is None:
            raise CorrectionError('土壤热阻率缺失，单位 K·m/W。', '/input/sections/0/medium/material')
        if p.baseline_kind=='gb_c012':
            materials = {m.id:m for m in d.materials}
            insulation = [materials[l.material] for core in cable.cores for l in core.layers if l.role=='insulation']
            if voltage>1000 or not isclose(limit,343.15,abs_tol=1e-8) or not insulation or any(m.standard_kind!='PVC' for m in insulation) or not isclose(p.baseline_soil_rho,1.2,abs_tol=1e-8):
                raise CorrectionError('表 D.0.3 仅用于表 C.0.1-2：1 kV PVC、70 °C 温限、基准热阻率 1.2；当前基准不符。', '/parameters/baseline_kind')
        elif not isclose(rho,p.baseline_soil_rho,abs_tol=1e-8):
            raise CorrectionError('表 D.0.3 不适用于任意厂家基准；实际与基准土壤热阻率不同，请使用完整计算。', '/parameters/baseline_soil_rho')
    elif p.baseline_kind=='gb_c012':
        raise CorrectionError('表 C.0.1-2 为直埋基准，不能用于空气敷设。', '/parameters/baseline_kind')
    count = len(placements)
    if any(len(c.cables)!=1 for c in d.circuits):
        raise CorrectionError('本版每回路须为一根多芯电缆；不把单根校正值冒充并联回路总电流。','/input/circuits/0/cables')
    if count>1 and cable.construction=='single_core' and any(c.system.kind=='ac_three_phase' for c in d.circuits):
        raise CorrectionError('表 D.0.4 / D.0.5 不适用于三相交流单芯电缆。', '/input/cable_types/0/construction')
    diameter = cable.radius()*2
    tray_layout = _tray_layout(document, d, section, cable, p, diameter) if tray else None
    gaps=[b.x-a.x for a,b in zip(placements,placements[1:])]
    if not tray and gaps and any(not isclose(g,gaps[0],abs_tol=1e-8) for g in gaps):
        raise CorrectionError('并列电缆间距不一致，本版不采用平均间距。', '/input/sections/0/placements')
    # Only eliminate floating point noise produced by exact layout dimensions;
    # table cells are never selected by rounding an engineering input.
    spacing = None if tray else gaps[0]-diameter if medium=='soil' and gaps else gaps[0]/diameter if gaps else None
    actual = dict(voltage_v=voltage,conductor_max_working_temperature_k=limit,
        installation_medium=medium,ambient_temperature_k=ambient,soil_rho=rho,
        cable_count=count,spacing=spacing,baseline_depth_m=p.baseline_depth_m)
    if tray_layout is not None:
        actual['tray_layout'] = tray_layout
    return p,d,actual


def lookup(executor, specs, expected_release):
    plugin = Registry(executor.registry.root,plugin_id='cablesim.standards-basis').get('cablesim.standards-basis')
    plugin.verify()
    release = digest(plugin.manifest.model_dump(mode='json',by_alias=True))
    if release != expected_release:
        raise CorrectionError('标准依据库发行已变化；请读取当前方法契约并重新核对依据，不能静默换表。','/parameters/basis_release_digest','BASIS_VERSION_CHANGED')
    result = executor.run(plugin.manifest.id,'lookup',[{'case_id':str(i),'input':q} for i,(_,q,_) in enumerate(specs)],expected_manifest=plugin.manifest)
    receipts=[]
    for (label,query,field),case in zip(specs,result.cases,strict=True):
        if case.status!='succeeded':
            raise CorrectionError('依据库未能解析'+label+'；请核对表内条件或补齐依据。',field,'BASIS_LOOKUP_FAILED')
        answer=case.artifacts['x-cablesim.standards-basis']; records=answer.get('records',[])
        if answer.get('status')!='resolved' or len(records)!=1:
            raise CorrectionError(label+'条件不在已核验的唯一表格单元格内；拒绝插值或外推。',field,'CORRECTION_TABLE_NOT_COVERED')
        r=records[0]
        if r.get('verification',{}).get('status')!='verified' or not r.get('printed_page') or not r.get('source_sha256'):
            raise CorrectionError(label+'缺少已核验数值、页码或原件摘要。',field,'BASIS_EVIDENCE_INCOMPLETE')
        receipts.append(dict(label=label,query=query,record=r,answer=answer,release_digest=release,
            request_sha256=result.request_sha256,artifact_sha256=case.artifact_digests['x-cablesim.standards-basis']))
    return receipts


def query(locator, conditions, quantity='ampacity_correction'):
    return dict(schema_version='cablesim.standards-query/1',standard='GB 50217',edition='2018',locator=locator,quantity=quantity,conditions=conditions)


def calculate(document,parameters,executor=None):
    p,d,actual=prepare(document,parameters)
    base_conditions={k:actual[k] for k in ('voltage_v','conductor_max_working_temperature_k','installation_medium','ambient_temperature_k')}
    # D.0.2 explicitly permits other ambient temperatures; temperature rows not
    # represented by D.0.1 are evaluated only after resolving the saved formula.
    table_temperatures=(293.15,298.15,303.15,308.15) if actual['installation_medium']=='soil' else (303.15,308.15,313.15,318.15)
    table_limits=(333.15,338.15,343.15,353.15,363.15)
    tabular = any(isclose(actual['ambient_temperature_k'],v,abs_tol=1e-8) for v in table_temperatures) and any(isclose(actual['conductor_max_working_temperature_k'],v,abs_tol=1e-8) for v in table_limits)
    specs=[('环境温度',query('表D.0.1',base_conditions) if tabular else query('D.0.2',{'voltage_v':actual['voltage_v']},'ampacity_correction_formula'),'/input/sections/0/medium')]
    if actual['installation_medium']=='soil' and p.baseline_kind=='gb_c012':
        specs.append(('土壤热阻率',query('表D.0.3',{'soil_thermal_resistivity_k_m_w':actual['soil_rho']}),'/input/sections/0/medium/material'))
    tray = actual.get('tray_layout')
    if tray:
        specs.append(('桥架水平接触与层数', query('表D.0.6', {key: tray[key] for key in (
            'tray_kind', 'cable_spacing_condition', 'horizontal_parallel_cable_count', 'layer_count')}),
            '/input/sections/0/enclosures'))
    elif actual['cable_count']>1:
        soil=actual['installation_medium']=='soil'
        values=(.1,.2,.3) if soil else (1.,2.,3.)
        spacing=next((v for v in values if isclose(actual['spacing'],v,abs_tol=1e-8)),actual['spacing'])
        specs.append(('并列根数与间距',query('表D.0.4' if soil else '表D.0.5',
            dict(circuit_kind='other_than_three_phase_ac_single_core',cable_count=actual['cable_count'],
                 **{'spacing_m' if soil else 'spacing_diameter_ratio':spacing})),'/input/sections/0/placements'))
    receipts=lookup(executor or Executor(),specs,p.basis_release_digest)
    condition_text=[f"正常温限 {actual['conductor_max_working_temperature_k']-273.15:g} °C；实际环境 {actual['ambient_temperature_k']-273.15:g} °C，基准 {p.baseline_ambient_k-273.15:g} °C"]
    if actual['installation_medium']=='soil' and p.baseline_kind=='gb_c012':
        condition_text.append(f"土壤热阻率 {actual['soil_rho']:g} K·m/W；C.0.1-2 基准 1.2 K·m/W")
    if tray:
        condition_text.append(f"{'梯架' if tray['tray_kind']=='ladder' else '托盘'}；{tray['layer_count']} 层；每层 {tray['horizontal_parallel_cable_count']} 根；逐根水平接触；布局出处已明确保存")
    elif actual['cable_count']>1:
        condition_text.append(f"并列 {actual['cable_count']} 根；"+(f"净距 {actual['spacing']*1000:g} mm" if actual['installation_medium']=='soil' else f"中心距 / 直径 {actual['spacing']:g}"))
    for i,r in enumerate(receipts):
        r['condition_text']=condition_text[i]
        record=r['record']
        if i==0 and not tabular:
            if record['value']!='K = sqrt((θm - θ2)/(θm - θ1))':
                raise CorrectionError('依据库公式与已核验实现不一致，拒绝计算。','/input/sections/0/medium','BASIS_FORMULA_CHANGED')
            r['factor']=sqrt((actual['conductor_max_working_temperature_k']-actual['ambient_temperature_k'])/(actual['conductor_max_working_temperature_k']-p.baseline_ambient_k))
            r['formula_inputs']=dict(theta_m_k=actual['conductor_max_working_temperature_k'],theta_1_k=p.baseline_ambient_k,theta_2_k=actual['ambient_temperature_k'])
        else:
            if record['quantity']['unit']!='1' or isinstance(record['value'],bool) or not isinstance(record['value'],(int,float)) or not isfinite(record['value']) or record['value']<=0:
                raise CorrectionError('依据库系数单位或值无效。','/parameters/baseline_current_a','BASIS_VALUE_INVALID')
            r['factor']=record['value']
    factor=prod(r['factor'] for r in receipts); corrected=p.baseline_current_a*factor
    scope = ('单根、同型号、同正常温限的空气基准；明确梯架或托盘，1至4层、每层不少于7根同型号三芯电缆，逐根水平接触且各层横向排列相同。D.0.6不与D.0.5重复相乘；不覆盖日照、强制风冷、排管、外部热源。' if tray else
        '单根基准、相同正常导体温限、相同中心埋深；均匀土壤直埋或空气单层等间距，同型号电缆。D.0.3 仅用于 C.0.1-2；不覆盖排管、桥架、多层、日照、交叉热源。')
    return dict(schema='cablesim.gb50217-correction/1',baseline=p.model_dump(exclude_none=True),actual_conditions=actual,
        coefficients=receipts,total_factor=factor,corrected_current_a=corrected,
        clauses=[f"GB 50217—2018 {r['record']['clause']} · 第 {r['record']['printed_page']} 页" for r in receipts],
        scope=scope,
        domain_input_sha256=digest(document),headline=f'按 GB 50217 校正：允许电流 {corrected:.1f} A，总系数 {factor:.4f}；基准出处已由工程师核对。')
