"""GB 50217 D.0.7, one explicitly sourced three-core cable in outdoor air.

The baseline already uses the actual outdoor ambient temperature. Only the
sealed D.0.7 coefficient is applied; no temperature or grouping factor is added.
This is a reference correction, not a solar heat-flow or manufacturer model.
"""
from math import isfinite, ulp
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.plugin_host.executor import Executor
from cablesim_sdk.domain import DomainDocument
from .correction import CorrectionError, _layout_source, _pointer, digest, lookup, query


METHOD_VERSION = '1.0.0'
CAPABILITY = 'outdoor-unshaded-rating'


class OutdoorParameters(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)
    baseline_current_a: float = Field(gt=0)
    baseline_ambient_k: float = Field(gt=0)
    baseline_environment: Literal['indoor_air_at_outdoor_ambient']
    baseline_source: str = Field(min_length=4, max_length=2000)
    baseline_sha256: str = Field(pattern='^[0-9a-f]{64}$')
    baseline_page: int = Field(ge=1)
    baseline_reviewed: bool
    outdoor_exposure_source: str = Field(min_length=4, max_length=2000)
    outdoor_unshaded_confirmed: bool
    basis_release_digest: str = Field(pattern='^[0-9a-f]{64}$')

    @field_validator('baseline_source', 'outdoor_exposure_source')
    @classmethod
    def nonblank_source(cls, value):
        if len(value.strip()) < 4:
            raise ValueError('请保留明确的原件、现场或研究输入出处及版本，不能使用空白出处。')
        return value


def _finite_number(value, field):
    try:
        valid = type(value) in (int, float) and isfinite(value)
    except OverflowError:
        valid = False
    if not valid:
        raise CorrectionError('户外校正须使用明确保存的有限数值，不接受文字、布尔或模型缺省值。', field)
    return value


def _same_float(left, right):
    # Only binary representation noise from SI conversion, never an engineering
    # tolerance, nearest table cell, interpolation or rounding of a section.
    return abs(left - right) <= 4 * max(ulp(left), ulp(right))


def prepare_outdoor(document, parameters):
    p = OutdoorParameters.model_validate(parameters)
    d = DomainDocument.model_validate(document)
    for field, message in (
        ('baseline_reviewed', '请核对同型号、同温限、同实际空气温度的户内空气单根基准；已乘日照或分组系数的值不能作为本基准。'),
        ('outdoor_unshaded_confirmed', '请明确确认保存的电缆在户外明敷且无遮阳；不从名称、温度或辐照数值推断。'),
    ):
        if getattr(p, field) is not True:
            raise CorrectionError(message, '/parameters/' + field, 'CORRECTION_CONFIRMATION_REQUIRED')
    if len(d.sections) != 1 or d.sections[0].kind != 'air':
        raise CorrectionError('本户外分支只覆盖一个明确保存的空气截面。', '/input/sections')
    if len(d.circuits) != 1:
        raise CorrectionError('本户外分支只覆盖一个回路，不叠加并列、桥架或其他分组系数。', '/input/circuits')
    section, circuit = d.sections[0], d.circuits[0]
    raw_section, raw_circuit = document['sections'][0], document['circuits'][0]
    if raw_section.get('enclosures') != [] or section.backfill or section.soil_layers:
        raise CorrectionError('须明确保存无容纳结构的户外明敷；本分支不覆盖桥架、排管、回填或土层。', '/input/sections/0/enclosures')
    if document.get('crossing_heat_sources') or document.get('external_heat_sources'):
        raise CorrectionError('本户外分支不叠加交叉或外部热源。', '/input/sections/0')
    if circuit.system.kind != 'ac_three_phase' or len(circuit.cables) != 1:
        raise CorrectionError('本分支须为一个三相回路的一根完整三芯电缆，不能把单根单芯结果当成回路能力。', '/input/circuits/0/cables')
    cable_index = next(i for i, item in enumerate(d.cable_types) if item.id == circuit.cable_type)
    cable, raw_type = d.cable_types[cable_index], document['cable_types'][cable_index]
    if cable.construction != 'three_core' or len(cable.cores) != 3:
        raise CorrectionError('本次执行范围仅三芯；D.0.7 单芯原值可查询，尚不能作为本回路结果执行。', f'/input/cable_types/{cable_index}/construction')
    instance = circuit.cables[0]
    raw_instance = raw_circuit['cables'][0]
    if instance.phase != 'L1L2L3':
        raise CorrectionError('三芯回路须明确保存完整三相，不使用单相、N 或 PE 的实例。', '/input/circuits/0/cables/0/phase')
    if type(raw_instance.get('parallel_index')) is not int or raw_instance['parallel_index'] != 1:
        raise CorrectionError('须明确保存三芯整体相位及并联序号 1；缺项不能采用模型缺省值。', '/input/circuits/0/cables/0/parallel_index')
    if len(section.placements) != 1 or section.placements[0].cable != instance.id or section.placements[0].enclosure is not None:
        raise CorrectionError('空气截面须且只须放置这根电缆，不得漏放、加组或绑定容纳结构。', '/input/sections/0/placements')
    evidence = []

    def sourced(stable, indexed, value, unit=None):
        if unit is not None:
            _finite_number(value, '/input' + indexed)
        evidence.append(_layout_source(document, stable, indexed, value, unit, context='户外校正'))
        return value

    def value(raw, key, stable, indexed, unit=None):
        if key not in raw or raw[key] is None:
            raise CorrectionError('户外校正所需原始字段缺失；不能借用模型缺省值。', '/input' + _pointer(*indexed, key))
        return sourced(_pointer(*stable, key), _pointer(*indexed, key), raw[key], unit)

    type_path, type_index = ('cable_types', cable.id), ('cable_types', cable_index)
    circuit_path, circuit_index = ('circuits', circuit.id), ('circuits', 0)
    section_path, section_index = ('sections', section.id), ('sections', 0)
    voltage = value(raw_type['rating'], 'u', (*type_path, 'rating'), (*type_index, 'rating'), 'V')
    actual_voltage = value(raw_circuit['system'], 'voltage', (*circuit_path, 'system'), (*circuit_index, 'system'), 'V')
    if voltage not in (1000, 6000) or actual_voltage != voltage:
        raise CorrectionError('本分支要求明确的额定线电压与实际系统线电压同为 1 kV 或 6 kV；不以运行电压替代型号额定值。', '/input' + _pointer(*type_index, 'rating', 'u'))
    frequency = value(raw_circuit['system'], 'frequency', (*circuit_path, 'system'), (*circuit_index, 'system'), 'Hz')
    if frequency <= 0:
        raise CorrectionError('三相交流频率须明确为正值。', '/input/circuits/0/system/frequency')
    areas = [value(core['conductor'], 'nominal_area', (*type_path, 'cores', core['id'], 'conductor'),
                   (*type_index, 'cores', i, 'conductor'), 'm2') for i, core in enumerate(raw_type['cores'])]
    if any(area <= 0 or area != areas[0] for area in areas):
        raise CorrectionError('三个芯的标称截面须明确且完全相同，不取最大值、平均值或近邻规格。', '/input' + _pointer(*type_index, 'cores'))
    ambient = value(raw_section['medium'], 'air_temperature', (*section_path, 'medium'), (*section_index, 'medium'), 'K')
    limit = value(raw_type['rating']['max_conductor_temperature'], 'normal',
                  (*type_path, 'rating', 'max_conductor_temperature'), (*type_index, 'rating', 'max_conductor_temperature'), 'K')
    if ambient <= 0 or ambient >= limit:
        raise CorrectionError('实际空气温度须为正绝对温度且低于正常导体温限。', '/input/sections/0/medium/air_temperature')
    if not _same_float(p.baseline_ambient_k, ambient):
        raise CorrectionError('D.0.7 的户内空气基准必须已按同一实际户外环境温度取得；本分支不再乘温度系数。', '/parameters/baseline_ambient_k', 'CORRECTION_BASELINE_MISMATCH')
    if raw_section['medium'].get('ventilation') != 'natural':
        raise CorrectionError('本分支不接受强制风冷；须明确保存自然通风条件。', '/input/sections/0/medium/ventilation')
    if raw_section['medium'].get('wind_speed') is not None:
        raise CorrectionError('本方法不消费量化风速输入，不能声称已计算该风速的换热作用；不补零风速。', '/input/sections/0/medium/wind_speed')
    if raw_section['medium'].get('solar_irradiance') is not None:
        raise CorrectionError('本方法只按有来源的户外无遮阳分类查表，不消费量化辐照输入；不能声称已计算该太阳热流。', '/input/sections/0/medium/solar_irradiance')
    for stable, indexed, item in (
        ((*type_path, 'construction'), (*type_index, 'construction'), raw_type['construction']),
        ((*circuit_path, 'cable_type'), (*circuit_index, 'cable_type'), raw_circuit['cable_type']),
        ((*circuit_path, 'system', 'kind'), (*circuit_index, 'system', 'kind'), raw_circuit['system']['kind']),
        ((*circuit_path, 'cables', instance.id, 'phase'), (*circuit_index, 'cables', 0, 'phase'), raw_instance['phase']),
        ((*circuit_path, 'cables', instance.id, 'parallel_index'), (*circuit_index, 'cables', 0, 'parallel_index'), raw_instance['parallel_index']),
        ((*section_path, 'kind'), (*section_index, 'kind'), raw_section['kind']),
        ((*section_path, 'enclosures'), (*section_index, 'enclosures'), raw_section['enclosures']),
        ((*section_path, 'medium', 'ventilation'), (*section_index, 'medium', 'ventilation'), raw_section['medium']['ventilation']),
    ):
        sourced(_pointer(*stable), _pointer(*indexed), item)
    for coordinate in ('x', 'z'):
        value(raw_section['placements'][0], coordinate, (*section_path, 'placements', instance.id), (*section_index, 'placements', 0), 'm')
    return p, d, dict(voltage_v=actual_voltage, nominal_voltage_v=voltage, core_count=3,
        area_m2=areas[0], installation_medium='air', ambient_temperature_k=ambient,
        conductor_max_working_temperature_k=limit, cable_count=1,
        current_basis_environment=p.baseline_environment, outdoor_unshaded='yes',
        exposure_source=p.outdoor_exposure_source, source_kind='declared', confidence='reference',
        approval='not_granted', input_sources=evidence, method_version=METHOD_VERSION)


def calculate_outdoor(document, parameters, executor=None):
    p, d, actual = prepare_outdoor(document, parameters)
    conditions = {key: actual[key] for key in ('current_basis_environment', 'outdoor_unshaded', 'core_count', 'area_m2')}
    conditions['u_v'] = actual['nominal_voltage_v']
    area_field = '/input/cable_types/' + str(next(i for i, cable in enumerate(d.cable_types) if cable.id == d.circuits[0].cable_type)) + '/cores/0/conductor/nominal_area'
    receipt = lookup(executor or Executor(), [('户外明敷无遮阳', query('表D.0.7', conditions), area_field)], p.basis_release_digest)[0]
    record, factor = receipt['record'], receipt['record']['value']
    if (record['quantity']['unit'] != '1' or type(factor) not in (int, float)
            or not isfinite(factor) or factor <= 0):
        raise CorrectionError('依据库日照校正系数的单位或数值无效。', area_field, 'BASIS_VALUE_INVALID')
    # The generic query tolerance must not turn a nearby engineering section
    # into a table cell. Permit only floating point noise from SI conversion.
    tabular_area = record['conditions'].get('area_m2', {}).get('eq')
    if type(tabular_area) not in (int, float) or not _same_float(actual['area_m2'], tabular_area):
        raise CorrectionError('实际标称截面未精确命中 D.0.7 单元格，不取近邻规格。', area_field, 'CORRECTION_TABLE_NOT_COVERED')
    receipt['factor'] = factor
    receipt['condition_text'] = (
        f"额定与实际线电压 {actual['voltage_v']:g} V；三芯各 {actual['area_m2'] * 1e6:g} mm²；"
        f"户内空气基准与实际户外环境同为 {actual['ambient_temperature_k'] - 273.15:g} °C；"
        f"正常温限 {actual['conductor_max_working_temperature_k'] - 273.15:g} °C；单回路单根、户外明敷无遮阳")
    corrected = p.baseline_current_a * factor
    if not isfinite(corrected):
        raise CorrectionError('基准与原表系数的乘积超出有限数值范围。', '/parameters/baseline_current_a', 'CORRECTION_RESULT_INVALID')
    return dict(schema='cablesim.gb50217-correction/1', baseline=p.model_dump(mode='json'),
        actual_conditions=actual, coefficients=[receipt], total_factor=factor,
        corrected_current_a=corrected, domain_input_sha256=digest(document),
        clauses=[f"GB 50217—2018 {record['clause']} · 第 {record['printed_page']} 页"],
        scope='仅 1 kV 或 6 kV 的单回路单根三芯电缆；基础值为按实际户外环境温度取得的户内空气单根载流量、同型号及正常温限。只乘 D.0.7，不叠加温度、土壤、并列或桥架系数。单芯、量化辐照、强制风冷与外部热源不在本次执行范围；结果是参考校正，不是厂家保证值或产品批准。',
        headline=f'GB 50217 户外无遮阳校正：允许电流 {corrected:.1f} A，系数 {factor:.4f}；仅按同温度户内空气基准应用 D.0.7。')
