"""A manufacturer's cells become immutable candidate facts, not approvals.

Complete medium-voltage tables use the existing constructor and sealed model
completion. Other families retain incomplete specifications until their stated
dimensions and materials suffice; nothing is inferred from a neighbouring size.
"""
from copy import deepcopy
import json
import math
from typing import Literal

from pydantic import Field, ValidationError, field_validator, model_validator

from backend.schemas import StrictModel
from .candidates import CableModelVersion
from . import factory_tables as tables
from .catalogue_core import CoreError, designation, structure


def _finite_rating_number(value):
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


class DeclaredParameter(StrictModel):
    value: float | str
    reference: str = Field(min_length=1, max_length=2000)
    unit: str | None = None

    @model_validator(mode='after')
    def valid(self):
        if not self.reference.strip() or isinstance(self.value, float) and not math.isfinite(self.value):
            raise ValueError('参数必须有有限值及非空出处。')
        return self


class DeclaredMaterialProperty(DeclaredParameter):
    value: float = Field(strict=True, allow_inf_nan=False)


class SeriesDeclaration(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    manufacturer: str = Field(min_length=1, max_length=120)
    designation: str = Field(min_length=1, max_length=40)
    cores: int = Field(ge=1, le=16, strict=True)
    u0_v: float = Field(gt=0, le=500000, allow_inf_nan=False)
    u_v: float = Field(gt=0, le=1000000, allow_inf_nan=False)
    um_v: float | None = Field(default=None, gt=0, le=1000000, allow_inf_nan=False)
    origin: Literal['factory', 'public', 'demo'] = 'factory'
    standards: list[str] = Field(default_factory=list, max_length=32)
    common: dict[str, float] = Field(default_factory=dict, max_length=64)
    common_basis: dict[str, str] = Field(default_factory=dict, max_length=64)
    modelling: dict[str, DeclaredParameter] = Field(default_factory=dict, max_length=64)
    source: dict = Field(default_factory=dict)
    reference: dict = Field(default_factory=dict)
    resistance_basis: Literal['stated', 'standard_limit'] = 'stated'
    conductor: Literal['copper', 'aluminium'] | None = None
    insulation: Literal['XLPE', 'PVC'] | None = None
    metal_sheath: Literal['lead', 'corrugated_aluminium', 'smooth_aluminium'] | None = None
    oversheath: Literal['PVC', 'PE'] | None = None
    armour_material: str | None = None
    outer_diameter_precision_mm: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    material_properties: dict[str, dict[str, DeclaredMaterialProperty]] = Field(default_factory=dict)

    @field_validator('modelling', mode='before')
    @classmethod
    def declared_rating_numbers(cls, value):
        if isinstance(value, dict):
            for key in ('normal_temperature_k', 'short_circuit_temperature_k', 'conductor_class'):
                parameter = value.get(key)
                number = parameter.get('value') if isinstance(parameter, dict) else getattr(parameter, 'value', None)
                if key in value and not _finite_rating_number(number):
                    raise ValueError(key + '：须为有限数值，不接受字符串或布尔值。')
        return value

    @field_validator('cores', mode='before')
    @classmethod
    def supported_cores(cls, value):
        if type(value) is not int or not 1 <= value <= 16:
            raise ValueError('结构表芯数须为 1 至 16 的整数；多芯草稿保留未声明的尺寸和坐标，不补造几何。')
        return value

    @model_validator(mode='after')
    def stated(self):
        from .published_guidance import validate_published_guidance
        validate_published_guidance(self.reference)
        for key in ('name', 'manufacturer', 'designation'):
            value = getattr(self, key).strip()
            if not value:
                raise ValueError('系列名称、厂家和型号不能为空。')
            setattr(self, key, value)
        if self.u0_v > self.u_v or self.um_v is not None and self.um_v < self.u_v:
            raise ValueError('额定电压须满足 U0 ≤ U ≤ Um。')
        if self.u_v > 35000 and self.cores != 1:
            raise ValueError('高压结构表仅覆盖单芯型号。')
        for key, value in self.common.items():
            if key not in tables.FIELDS or not math.isfinite(value) or value <= 0:
                raise ValueError('系列通用尺寸存在未知字段或无效数值：' + key)
            if not self.common_basis.get(key, '').strip():
                raise ValueError('系列通用尺寸必须逐项填写出处：' + tables.FIELDS[key][0])
        allowed = set(structure.MODELLING) | {'normal_temperature_k', 'short_circuit_temperature_k', 'conductor_class'}
        if set(self.modelling) - allowed:
            raise ValueError('未知计算参数：' + sorted(set(self.modelling) - allowed)[0])
        return self


def parts_of(series):
    try:
        parts = designation.parse(series['designation'])
    except CoreError:
        if not all(series.get(key) for key in ('conductor', 'insulation', 'oversheath')):
            tables.fail('SERIES_MATERIALS_MISSING', '此型号写法不能唯一识别材料，请明确声明导体、绝缘及外护套材料。')
        parts = {'conductor': series['conductor'], 'insulation': series['insulation'],
                 'sheath': series['oversheath'], 'metal_sheath': series.get('metal_sheath'),
                 'screen': None, 'armour': None, 'model': series['designation']}
    for key, target in [('conductor', 'conductor'), ('insulation', 'insulation'), ('oversheath', 'sheath'), ('metal_sheath', 'metal_sheath')]:
        if series.get(key) is not None:
            if parts.get(target) and parts[target] != series[key]:
                tables.fail('SERIES_DECLARATION_CONFLICT', f'材料声明与型号写法不一致：{key}。')
            parts[target] = series[key]
    if parts.get('u0_v') and (parts['u0_v'], parts['u_v']) != (series['u0_v'], series['u_v']):
        tables.fail('SERIES_VOLTAGE_CONFLICT', '型号中电压与系列声明不同。')
    if parts.get('cores') and parts['cores'] != series['cores']:
        tables.fail('SERIES_CORES_CONFLICT', '型号中芯数与系列声明不同。')
    return parts


def source_record(upload, sheet, row, key, series, mapping, origin='table'):
    from openpyxl.utils import get_column_letter
    source = {'kind': 'manufacturer' if origin == 'table' else 'user', 'file': upload['file'],
              'file_sha256': upload['sha256'], 'sheet': sheet, 'row': row,
              'column': get_column_letter(mapping[key] + 1) if origin == 'table' and key in mapping else None,
              'field': key, 'origin': origin, 'catalogue': deepcopy(series.get('source') or {}),
              'reference': series.get('common_basis', {}).get(key) if origin == 'series' else None,
              'method': tables.IMPORT_METHOD, 'confidence': 'reference', 'reviewed': False}
    if key in tables.SOURCE_ONLY_FIELDS:
        source['usage'] = 'catalogue_result'
        source['conditions'] = deepcopy(series.get('reference', {}).get('conditions', {}))
    if series.get('origin') == 'demo':
        source['kind'] = 'demo'
    return source


def candidate_source(record):
    return {'kind': record['kind'], 'reviewed': False, 'reference': json.dumps(record, ensure_ascii=False, sort_keys=True)}


def numeric_facts(upload, sheet, row, series, mapping):
    merged = {**series.get('common', {}), **row['values']}
    facts = []
    for key, value in merged.items():
        label, unit, scale, _ = tables.FIELDS[key]
        scale = .001 if unit == 'kg/km' else scale
        origin = 'table' if key in row['values'] else 'series'
        facts.append({'key': key, 'label': label, 'value': value * scale, 'unit': tables.SI_UNITS[unit],
                      'display_value': value, 'display_unit': unit, 'source': source_record(upload, sheet, row['row_number'], key, series, mapping, origin),
                      'method': tables.IMPORT_METHOD, 'confidence': 'reference'})
        if key in tables.SOURCE_ONLY_FIELDS:
            facts[-1]['usage'] = 'catalogue_result'
        if key in row.get('_standard_values', {}):
            reference = row['_standard_values'][key]
            facts[-1]['source'].update(kind='standard', origin='standard', column=None, reference=reference)
            facts[-1]['method'] = {'name': '标准依据库', 'version': reference['plugin_version'],
                                  'release_digest': reference.get('release_digest')}
    return facts, merged


def _incomplete_payload(series, parts, name, facts, missing):
    aliases = {'screen_tape_thickness': 'metallic_screen_tape_thickness',
               'screen_tape_width': 'metallic_screen_tape_width', 'binder_thickness': 'binder_tape_thickness'}
    values, sources = {}, {}
    for item in facts:
        sources[item['key']] = candidate_source(item['source'])
        if item['key'] == 'area' or item['key'] in tables.SOURCE_ONLY_FIELDS:
            continue
        key = aliases.get(item['key'], item['key'])
        values[key] = {'value': item['value'], 'unit': item['unit'], 'source': item['key'],
                       'basis': 'manufacturer' if item['source']['origin'] == 'table' else 'standard_limit' if item['source']['origin'] == 'standard' else 'engineer_given'}
    if not values:
        return None
    return {'name': name, 'version': '1', 'confirmed': False, 'materials': [],
            'specification': {'manufacturer': series['manufacturer'], 'designation': series['designation'],
                'u0_v': series['u0_v'], 'voltage_v': series['u_v'], 'um_v': series.get('um_v'), 'cores': series['cores'],
                'area_m2': next(item['value'] for item in facts if item['key'] == 'area'),
                'conductor': 'copper_bare' if parts['conductor'] == 'copper' else 'aluminium',
                'values': values, 'missing': missing or ['尚未形成完整工程结构，请补齐层结构与材料物性。']}, 'sources': sources}


def _full_sources(payload, facts, series, derivation):
    """Attach cell identities to exact model paths; derived values keep the constructor receipt."""
    sources = {item['key']: candidate_source(item['source']) for item in facts}
    source_by_key = dict(sources)
    base = {'kind': 'derived', 'reviewed': False, 'reference': json.dumps({
        'method': derivation, 'series': series, 'message': '按已声明结构和方法形成；来源核对不等于产品批准。'}, ensure_ascii=False)}
    sources['/cable_type'] = base
    sources['/materials'] = {'kind': 'standard', 'reviewed': False,
        'reference': json.dumps({'thermal': structure.THERMAL, 'dielectric': structure.DIELECTRIC,
                                'modelling': series['modelling'], 'method': derivation}, ensure_ascii=False)}
    roles = {'conductor_screen': 'conductor_screen_thickness', 'insulation': 'insulation_thickness',
             'insulation_screen': 'insulation_screen_thickness', 'oversheath': 'oversheath_thickness',
             'bedding': 'bedding_thickness', 'metallic_sheath': 'metallic_sheath_thickness', 'buffer': 'buffer_thickness'}
    for index, core in enumerate(payload['cable_type']['cores']):
        for key, field in [('area', 'nominal_area'), ('conductor_diameter', 'diameter'), ('r20', 'r20')]:
            if key in source_by_key:
                sources[f'/cable_type/cores/{index}/conductor/{field}'] = source_by_key[key]
        for layer_index, layer in enumerate(core['layers']):
            if roles.get(layer['role']) in source_by_key:
                sources[f'/cable_type/cores/{index}/layers/{layer_index}/thickness'] = source_by_key[roles[layer['role']]]
    for index, layer in enumerate(payload['cable_type']['common_layers']):
        if roles.get(layer['role']) in source_by_key:
            sources[f'/cable_type/common_layers/{index}/thickness'] = source_by_key[roles[layer['role']]]
    return sources


MATERIAL_MAPPING_METHOD = {'name': '明示材料物性映射', 'version': '1.0.0'}
RATING_MAPPING_METHOD = {'name': '明示额定条件映射', 'version': '1.0.0'}


def _declared_ratings(payload, modelling):
    """Retain stated limits without rewriting an already constructed model.

    A permissible temperature is not an operating temperature or a fault
    duration. No study inputs are created here. Existing different values
    cannot be replaced after the constructor has derived its results.
    """
    from backend.domain.guards import pointer

    cable = payload['cable_type']
    limits = cable['rating']['max_conductor_temperature']
    plans, issues = [], []
    for key, field in (('normal_temperature_k', 'normal'), ('short_circuit_temperature_k', 'short_circuit'),
                       ('conductor_class', 'conductor_class')):
        if key not in modelling:
            continue
        declared = modelling[key]
        value = declared.get('value')
        unit = '1' if key == 'conductor_class' else 'K'
        reason = None
        if not _finite_rating_number(value) or value <= 0:
            reason = '须为有限正数，不接受字符串或布尔值。'
        elif declared.get('unit') != unit or not declared.get('reference', '').strip():
            reason = '须有明确出处及匹配的 SI 单位 ' + unit + '。'
        elif key == 'conductor_class' and value not in (1, 2, 5, 6):
            reason = '导体类别只能明确声明为 1、2、5 或 6。'
        if reason:
            issues.append({'column': '', 'field': 'modelling.' + key, 'code': 'TABLE_RATING_INVALID',
                           'message': key + '：' + reason})
            continue
        if key == 'conductor_class':
            value = int(value)
            targets = [(core['conductor'], pointer('cable_type', 'cores', core['id'], 'conductor', field))
                       for core in cable['cores']]
        else:
            targets = [(limits, pointer('cable_type', 'rating', 'max_conductor_temperature', field))]
        if any(target.get(field) is not None and target[field] != value for target, _ in targets):
            issues.append({'column': '', 'field': 'modelling.' + key, 'code': 'TABLE_RATING_CONFLICT',
                           'message': '明示额定条件与已有构造值冲突；须按新条件重新构造，'
                                      '不能覆盖后沿用旧派生结果或原导体类别的标准查询：' + key})
            continue
        plans.append((key, field, value, declared, targets))
    if issues:
        return {}, [], issues
    if not plans:
        return {}, [], []
    resulting_limits = {**limits, **{field: value for _, field, value, _, _ in plans if field != 'conductor_class'}}
    if (resulting_limits.get('normal') is not None and resulting_limits.get('short_circuit') is not None
            and resulting_limits['short_circuit'] < resulting_limits['normal']):
        return {}, [], [{'column': '', 'field': 'modelling.short_circuit_temperature_k',
                         'code': 'TABLE_RATING_INVALID', 'message': '短路许可温限不能低于正常运行许可温限。'}]
    sources, receipt = {}, []
    for key, field, value, declared, targets in plans:
        for target, path in targets:
            target[field] = value
            sources[path] = candidate_source({'kind': 'user', 'method': RATING_MAPPING_METHOD,
                'confidence': 'reference', 'reviewed': False, 'field': key, 'evidence': deepcopy(declared),
                'usage': 'declared_conductor_class' if field == 'conductor_class' else 'permitted_temperature_limit'})
        receipt.append({'field': key, 'paths': [path for _, path in targets], 'value': value, 'unit': declared['unit']})
    return sources, receipt, []


def _material_properties(payload, declared):
    """Map explicit role-scoped properties without changing other uses or results.

    The constructor may share a material between a conductor and its screen.
    A declaration for one role must not become a statement about the other.
    Conflicting nonempty constructor values require a new construction, since
    its derived quantities have already used those values. This adapter never
    recomputes them, and validates the whole declaration before changing a row.
    """
    from backend.domain.guards import pointer
    from backend.domain.models import Material
    from .stated_single_core import PROPERTY_UNITS

    if not declared:
        return {}, [], []
    slots = []
    for core in payload['cable_type']['cores']:
        path = pointer('cable_type', 'cores', core['id'])
        slots.append(('conductor', core['conductor'], path + '/conductor/material'))
        slots.extend((layer['role'], layer, path + pointer('layers', layer['role'], 'material'))
                     for layer in core['layers'])
    slots.extend((layer['role'], layer, pointer('cable_type', 'common_layers', layer['role'], 'material'))
                 for layer in payload['cable_type']['common_layers'])
    materials = {material['id']: material for material in payload['materials']}
    reserved = set(materials)
    issues, plans = [], []

    def invalid(field, message):
        issues.append({'column': '', 'field': 'material_properties.' + field,
                       'code': 'TABLE_MATERIAL_INVALID', 'message': message})

    for role, properties in declared.items():
        targets = [(slot, path) for use, slot, path in slots if use == role]
        identities = {slot['material'] for slot, _ in targets}
        if len(identities) != 1 or not identities <= materials.keys():
            invalid(role, '明示材料物性须对应当前结构中唯一的材料用途；此用途不存在或对应多个材料：' + role)
            continue
        if not properties:
            continue
        original_id = next(iter(identities))
        original = materials[original_id]
        material = deepcopy(original)
        before = len(issues)
        for key, prop in properties.items():
            field = role + '.' + key
            if key not in PROPERTY_UNITS:
                invalid(field, '未覆盖的材料物性，未忽略此声明：' + field)
            elif not prop.get('reference', '').strip() or prop.get('unit') not in PROPERTY_UNITS[key]:
                invalid(field, '材料物性须有明确出处及匹配的 SI 单位：' + field)
            elif type(prop.get('value')) not in (int, float) or not math.isfinite(prop['value']):
                invalid(field, '材料物性须为有限数值，不接受字符串或布尔值：' + field)
            elif original.get(key) is not None and original[key] != prop['value']:
                invalid(field, '明示物性与已有构造值冲突；须按新物性重新构造，不能覆盖后沿用旧派生结果：' + field)
            else:
                material[key] = prop['value']
        try:
            Material.model_validate(material)
        except ValidationError as error:
            for problem in error.errors(include_input=False, include_url=False):
                field = role + '.' + str(problem['loc'][-1])
                invalid(field, '材料物性不符合领域约束：' + field + '；' + problem['msg'])
        if len(issues) != before:
            continue
        if any(use != role and slot['material'] == original_id for use, slot, _ in slots):
            identifier = 'material/import-' + role.replace('_', '-')
            suffix = 2
            while identifier in reserved:
                identifier = 'material/import-' + role.replace('_', '-') + '-' + str(suffix)
                suffix += 1
            material['id'] = identifier
            reserved.add(identifier)
        plans.append((role, original_id, material, targets, properties))
    if issues:
        return {}, [], issues

    sources, receipt = {}, []
    for role, original_id, material, targets, properties in plans:
        mapping = {'role': role, 'from_material': original_id, 'to_material': material['id'],
                   'properties': sorted(properties)}
        receipt.append(mapping)
        if material['id'] == original_id:
            materials[original_id].update(material)
        else:
            payload['materials'].append(material)
            for slot, path in targets:
                slot['material'] = material['id']
                sources[path] = candidate_source({'kind': 'derived', 'method': MATERIAL_MAPPING_METHOD,
                    'confidence': 'reference', 'reviewed': False, 'evidence': mapping})
        for key, prop in properties.items():
            sources[pointer('materials', material['id'], key)] = candidate_source({
                'kind': 'user', 'method': MATERIAL_MAPPING_METHOD, 'confidence': 'reference',
                'reviewed': False, 'role': role, 'property': key, 'evidence': deepcopy(prop)})
    return sources, receipt, []


def _validation_issues(item, error, mapping):
    """Translate canonical model failures back to the source row and cell.

    Incomplete published specifications use field-level limits as well as
    model-level unit checks. Both must remain reviewable row errors; a single
    malformed specification must never discard the other manufacturer's rows.
    """
    from openpyxl.utils import get_column_letter
    aliases = {'area_m2': 'area', 'nominal_area': 'area',
               'metallic_screen_tape_thickness': 'screen_tape_thickness',
               'metallic_screen_tape_width': 'screen_tape_width',
               'binder_tape_thickness': 'binder_thickness'}
    facts = {fact['key']: fact for fact in item['values']}
    issues = []
    for problem in error.errors(include_input=False, include_url=False):
        location = problem['loc']
        message = problem['msg'].removeprefix('Value error, ')
        field = aliases.get(str(location[-1]), str(location[-1])) if location else ''
        if field not in facts:
            # PublishedSpecification's cross-field validators name the source
            # field before the Chinese colon rather than in the Pydantic loc.
            prefix = message.split('：', 1)[0]
            field = aliases.get(prefix, prefix)
        if field not in facts:
            source = item['payload'].get('sources', {}).get('/' + '/'.join(map(str, location)))
            if source:
                try:
                    reference = json.loads(source.get('reference') or '{}')
                    field = reference.get('field') or reference.get('evidence', {}).get('field', '')
                except (ValueError, TypeError, AttributeError):
                    field = ''
        fact = facts.get(field)
        label = fact['label'] if fact else '型号结构'
        bounds = {'less_than_equal': ('le', '不大于'), 'less_than': ('lt', '小于'),
                  'greater_than_equal': ('ge', '不小于'), 'greater_than': ('gt', '大于')}
        if fact and problem['type'] in bounds:
            key, relation = bounds[problem['type']]
            scale = .001 if fact['display_unit'] == 'kg/km' else tables.FIELDS[field][2]
            limit = problem['ctx'][key] / scale
            message = f'{label}须{relation} {limit:g} {fact["display_unit"]}；原表值为 {fact["display_value"]:g} {fact["display_unit"]}。'
        elif problem['type'] == 'value_error':
            for key in sorted({**aliases, **tables.FIELDS}, key=len, reverse=True):
                target = aliases.get(key, key)
                if target in tables.FIELDS:
                    message = message.replace(key, tables.FIELDS[target][0])
            message = f'{label}校验未通过：{message}'
        else:
            message = f'{label}不符合型号数据约束，请核对原始资料的数值、单位和结构。'
        column = (f'{get_column_letter(mapping[field] + 1)}{item["row_number"]}'
                  if fact and fact['source'].get('origin') == 'table' and field in mapping else '')
        issues.append({'column': column, 'field': field if fact else 'structure',
                       'code': 'TABLE_MODEL_INVALID', 'message': message})
    return issues


def build_rows(upload, sheet, rows, series, mapping):
    parts = parts_of(series)
    rows = deepcopy(rows)
    if series.get('resistance_basis') == 'standard_limit':
        from .catalogue_core import basis
        queries = {str(index): {'schema_version': 'cablesim.standards-query/1', 'standard': 'GB/T 3956', 'edition': '2008',
            'locator': '表 2', 'quantity': 'resistance_20_max', 'conditions': {
                'area_m2': row['values']['area'] * 1e-6, 'conductor_class': 2,
                'conductor_material': parts['conductor'], **({'coating': 'plain'} if parts['conductor'] == 'copper' else {})}}
            for index, row in enumerate(rows) if not row['issues'] and 'area' in row['values']
            and 'r20' not in row['values'] and 'r20' not in series.get('common', {})}
        references, _missing = basis.resolve(queries) if queries else ({}, [])
        for index, reference in references.items():
            rows[int(index)]['values']['r20'] = reference['record']['value']
            rows[int(index)]['_standard_values'] = {'r20': reference}
    result, buildable, indices, seen = [], [], [], {}
    # Using a nominal-resistance standard limit must be a separate explicit
    # choice. The importer never calls Studio's missing-R20 fallback.
    required = ['area', 'conductor_diameter', 'insulation_thickness', 'oversheath_thickness', 'outer_diameter', 'r20']
    if series['u_v'] > 3000:
        required += ['conductor_screen_thickness', 'insulation_screen_thickness']
    if parts.get('metal_sheath'):
        required += ['metallic_sheath_thickness']
        if parts['metal_sheath'] == 'corrugated_aluminium':
            required += ['corrugation_depth', 'corrugation_pitch']
    elif series['u_v'] > 3000:
        required += ['screen_tape_thickness']
    if parts.get('armour'):
        required += ['bedding_thickness', 'armour_tape_thickness' if parts['armour']['kind'] == 'steel_tape' else 'armour_wire_diameter']
    for row in rows:
        facts, values = numeric_facts(upload, sheet, row, series, mapping)
        area = values.get('area')
        key = f'{series["cores"]}×{area:g}' if area else ''
        name = f'{series["designation"]}-{series["u0_v"]/1000:g}/{series["u_v"]/1000:g} kV {key}'
        issues = deepcopy(row['issues'])
        if area in seen:
            issues.append({'column': 'area', 'field': 'area', 'message': f'截面与第 {seen[area]} 行重复；请拆分为另一系列或删除重复规格。'})
        elif area is not None:
            seen[area] = row['row_number']
        missing = [tables.FIELDS[field][0] for field in required if field not in values]
        item = {'row_number': row['row_number'], 'name': name, 'key': key, 'area_m2': area * 1e-6 if area else None,
                'values': facts, 'issues': issues, 'missing': missing, 'status': 'error' if issues else 'incomplete',
                'payload': None, 'derivation': {'kind': 'stated', 'method': tables.IMPORT_METHOD}, 'closure': None}
        result.append(item)
        if issues:
            continue
        payload = _incomplete_payload(series, parts, name, facts, missing)
        if payload is None:
            item['issues'].append({'column': '', 'field': 'structure', 'message': '只有截面，缺少可保存的结构值。'})
            item['status'] = 'error'
            continue
        item['payload'] = payload
        if series['cores'] == 1 and (parts.get('metal_sheath') or series['u_v'] <= 3000):
            from .stated_single_core import build
            stated = build(series, parts, name, [fact for fact in facts if fact['key'] not in tables.SOURCE_ONLY_FIELDS])
            item['missing'] = list(dict.fromkeys(missing + stated['missing']))
            item['issues'].extend(stated['issues'])
            item['closure'], item['derivation'], item['warnings'] = stated['closure'], stated['derivation'], stated['warnings']
            if item['issues']:
                item['status'] = 'error'
            elif stated['payload'] is not None and not item['missing']:
                stated['payload']['sources'].update({fact['key']: candidate_source(fact['source'])
                    for fact in facts if fact['key'] in tables.SOURCE_ONLY_FIELDS})
                item.update(payload=stated['payload'], status='ready')
            else:
                payload['specification']['missing'] = item['missing'] or ['完整结构尚未形成，请核对声明。']
            continue
        if missing:
            continue
        if parts.get('metal_sheath') or series['u_v'] <= 3000 or series['cores'] not in (1, 3):
            # Preserve HV/LV actual cells even when the installed constructor
            # does not cover the family. A structured draft remains editable.
            item['missing'].append('当前结构构造器未覆盖此系列；须补齐并核对完整分层结构和材料后计算。')
            payload['specification']['missing'] = list(item['missing'])
            continue
        needed = {'conductor_form', 'filler_rho', 'diameter_rounding', 'screen_radial_factor'}
        if structure.covered_by_completion(series, parts):
            needed |= set(structure.MODELLING)
        absent = needed - set(series.get('modelling', {}))
        if absent:
            item['missing'].extend('计算用参数：' + structure.MODELLING[field][0] for field in sorted(absent))
            payload['specification']['missing'] = list(item['missing'])
            continue
        buildable.append({key: value for key, value in values.items() if key in structure.FIELDS})
        indices.append(len(result) - 1)
    if buildable:
        build_series = {**series, 'modelling': {k: v for k, v in series['modelling'].items() if k in structure.MODELLING}}
        built = structure.build(build_series, buildable)
        for source_index, row in zip(indices, built['rows']):
            item = result[source_index]
            if not row['ok']:
                error = row['error']
                field = (error.get('path') or '').rsplit('/', 1)[-1]
                item['issues'].append({'column': field, 'field': field, 'message': error['message']})
                item['status'] = 'error'
                continue
            payload = deepcopy(row['entry']['payload'])
            if any(f['key'] == 'r20' and f['source']['origin'] == 'standard' for f in item['values']):
                for core in payload['cable_type']['cores']:
                    core['conductor']['r20_basis'] = 'design'
            rating_sources, rating_mapping, issues = _declared_ratings(payload, series.get('modelling', {}))
            if issues:
                item['issues'].extend(issues)
                item.update(status='error', payload=None)
                continue
            sources, material_mapping, issues = _material_properties(payload, series.get('material_properties', {}))
            if issues:
                item['issues'].extend(issues)
                item.update(status='error', payload=None)
                continue
            derivation = deepcopy(row['derivation'])
            if rating_mapping:
                derivation['rating_mapping'] = {'method': RATING_MAPPING_METHOD, 'items': rating_mapping}
            if material_mapping:
                derivation['material_mapping'] = {'method': MATERIAL_MAPPING_METHOD, 'items': material_mapping}
            item.update(status='ready', missing=[], closure=row['closure'], derivation=derivation)
            item['warnings'] = row['warnings']
            item['payload'] = {'name': item['name'], 'version': '1', 'confirmed': False, **payload,
                               'sources': {**_full_sources(payload, item['values'], series, derivation), **rating_sources, **sources}}
    for item in result:
        if item['payload']:
            try:
                item['payload'] = CableModelVersion.model_validate(item['payload']).model_dump(mode='json')
            except ValidationError as error:
                item['issues'].extend(_validation_issues(item, error, mapping))
                item.update(status='error', payload=None)
        facts = {fact['key']: fact for fact in item['values']}
        for issue in item['issues']:
            field = issue.get('field')
            fact = facts.get(field)
            if field in mapping and (fact is None or fact['source'].get('origin') == 'table'):
                from openpyxl.utils import get_column_letter
                issue['column'] = f'{get_column_letter(mapping[field] + 1)}{item["row_number"]}'
    return result
