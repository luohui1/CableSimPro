"""GB 50217:2018 Annex D; coefficients are resolved by a sealed basis plugin.

No tables are duplicated here. D.0.2 is an explicit standard formula, not an
interpolation licence. The first release supports D.0.1--D.0.5 only; trays,
sunlight, ducts, layered/backfill soil and unequal parallel cables are refused.
"""
from hashlib import sha256
from math import isclose, prod, sqrt
import json

from pydantic import BaseModel, ConfigDict, Field
from backend.plugin_host.executor import Executor
from backend.plugin_host.registry import Registry, PluginHostError
from cablesim_sdk.domain import DomainDocument

ARTIFACT = 'x-cablesim.gb50217-correction'
BASELINE = 'x-cablesim.gb50217.baseline-current'
FACTOR = 'x-cablesim.gb50217.correction-factor'


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
    # The baseline must be a single cable at the saved normal conductor limit.
    # Actual ambient/soil/parallel count/spacing come from the same domain as IEC.


def digest(value):
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def prepare(document, parameters):
    p = Parameters.model_validate(parameters)
    d = DomainDocument.model_validate(document)
    if not p.baseline_reviewed:
        raise CorrectionError('请核对基准载流量、单根敷设条件、正常温限和原件出处，再确认基准已核对。', '/parameters/baseline_reviewed')
    if len(d.sections) != 1:
        raise CorrectionError('本方法只支持一个敷设截面。', '/input/sections')
    section = d.sections[0]
    if section.kind not in ('ground', 'air') or section.enclosures or section.backfill or section.soil_layers:
        raise CorrectionError('仅覆盖均匀土壤直埋或空气单层敷设；排管、桥架、多层与回填未覆盖。', '/input/sections/0')
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
    if max(v.z for v in placements)-min(v.z for v in placements)>1e-8:
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
    gaps=[b.x-a.x for a,b in zip(placements,placements[1:])]
    if gaps and any(not isclose(g,gaps[0],abs_tol=1e-8) for g in gaps):
        raise CorrectionError('并列电缆间距不一致，本版不采用平均间距。', '/input/sections/0/placements')
    # Only eliminate floating point noise produced by exact layout dimensions;
    # table cells are never selected by rounding an engineering input.
    spacing = gaps[0]-diameter if medium=='soil' and gaps else gaps[0]/diameter if gaps else None
    return p,d,dict(voltage_v=voltage,conductor_max_working_temperature_k=limit,
        installation_medium=medium,ambient_temperature_k=ambient,soil_rho=rho,
        cable_count=count,spacing=spacing,baseline_depth_m=p.baseline_depth_m)


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
    if actual['cable_count']>1:
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
    if actual['cable_count']>1:
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
            if record['quantity']['unit']!='1' or isinstance(record['value'],bool) or not isinstance(record['value'],(int,float)) or record['value']<=0:
                raise CorrectionError('依据库系数单位或值无效。','/parameters/baseline_current_a','BASIS_VALUE_INVALID')
            r['factor']=record['value']
    factor=prod(r['factor'] for r in receipts); corrected=p.baseline_current_a*factor
    return dict(schema='cablesim.gb50217-correction/1',baseline=p.model_dump(),actual_conditions=actual,
        coefficients=receipts,total_factor=factor,corrected_current_a=corrected,
        clauses=[f"GB 50217—2018 {r['record']['clause']} · 第 {r['record']['printed_page']} 页" for r in receipts],
        scope='单根基准、相同正常导体温限、相同中心埋深；均匀土壤直埋或空气单层等间距，同型号电缆。D.0.3 仅用于 C.0.1-2；不覆盖排管、桥架、多层、日照、交叉热源。',
        domain_input_sha256=digest(document),headline=f'按 GB 50217 校正：允许电流 {corrected:.1f} A，总系数 {factor:.4f}；基准出处已由工程师核对。')
