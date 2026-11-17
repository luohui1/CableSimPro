"""Build exact, read-only engineering delivery models from saved evidence.

No solver, current parameter defaults, unit conversion, rounding or inferred
signatures is permitted here. Each visible engineering number is a literal
projection of a frozen source; renderers receive the same model and archive.
"""
from __future__ import annotations

from copy import deepcopy
import json
import re

from .formal_contracts import (SCHEMA, SIGNATURE_ROLES, TITLES, canonical_bytes,
                               fail, is_number, jsonsha, raw_text,
                               resolve_pointer, validate_model_refs)
from .formal_units import domain_unit, numeric_leaves, parameter_unit, token
from .rating_table import is_rating_table, rating_rows
from .workspace import fingerprint


_RUN_FIELDS = ('id', 'workspace', 'study', 'sequence', 'input_digest', 'output_digest',
               'status', 'created', 'finished')
_CHANNELS = {'geometry': 'x-cablesim.cad-model', 'electrical': 'x-cablesim.type-electrical',
             'short_circuit': 'x-cablesim.type-short-circuit', 'standards': 'x-cablesim.standard-check'}
_HEADINGS = {'geometry': '结构尺寸与材料用量', 'electrical': '电气参数', 'rating': '载流量表',
             'short_circuit': '短路容量', 'standards': '标准核对与偏离'}
_LABELS = {'ampacity': '允许电流', 'conductor_temperature': '导体温度',
           'sheath_temperature': '金属屏蔽温度', 'surface_temperature': '表面温度',
           'losses.conductor': '导体损耗', 'losses.sheath': '金属屏蔽损耗',
           'losses.dielectric': '介质损耗', 'losses.total': '总损耗',
           'loss_factor.sheath': '屏蔽损耗因数', 'ac_resistance': '交流电阻',
           'capacitance': '每相电容', 'thermal_resistance.insulation': '绝缘热阻',
           'thermal_resistance.oversheath': '外护套热阻', 'thermal_resistance.external': '外部热阻',
           'x-cablesim.iec60287.loss_factor.armour': '铠装损耗因数',
           'x-cablesim.iec60287.losses.armour': '铠装损耗',
           'x-cablesim.iec60287.thermal_resistance.bedding': '内衬层热阻',
           'x-cablesim.iec60287.thermal_resistance.duct_air': '管内空气热阻',
           'x-cablesim.iec60287.thermal_resistance.duct_wall': '管壁热阻',
           'x-cablesim.iec60287.temperature_rise.mutual': '互热温升',
           'x-cablesim.iec60287.current': '运行电流',
           'x-cablesim.outer-diameter': '结构外径', 'x-cablesim.envelope-volume': '包络体积',
           'x-cablesim.material-volume': '材料体积', 'x-cablesim.mass-per-length': '每单位长度质量',
           'x-cablesim.standard-failed-count': '保存的标准不满足项数',
           'x-cablesim.type-analysis.available-count': '保存的可用结果项数', 'x-cablesim.r20': '导体直流电阻'}
_STATUS = {'available': '已计算', 'missing': '缺项', 'uncovered': '未覆盖',
           'not_applicable': '不适用', 'passed': '满足', 'failed': '未通过',
           'succeeded': '成功', 'partial': '部分完成', 'not_run': '未运行',
           'draft': '编制草稿', 'submitted': '待人工审核', 'approved': '已批准', 'published': '已发布'}
_CONDITIONS = {'rating': '逐回路允许电流工况', 'rating-simultaneous': '全回路共同负荷工况',
               'operating': '保存的运行负荷工况'}
_PATH_LABELS = {'materials': '材料', 'cable_types': '型号', 'cores': '线芯', 'conductor': '导体',
                'layers': '结构层', 'common_layers': '共同层', 'circuits': '回路', 'cables': '电缆',
                'sections': '敷设截面', 'placements': '位置', 'medium': '环境', 'load_cases': '负荷',
                'currents': '电流', 'base_current': '基准电流', 'max_conductor_temperature': '导体温限',
                'enclosures': '管道', 'measurements': '测量', 'position': '位置', 'normal': '持续工况',
                'short_circuit': '短路工况'}
_GEOMETRY_UNITS = {'outer_diameter_m': ('结构外径', 'm'), 'inner_diameter_m': ('结构内径', 'm'), 'length_m': ('建模长度', 'm'),
                   'mass_kg_per_km': ('理论用料质量', 'kg/km'), 'inner_radius_m': ('内半径', 'm'),
                   'outer_radius_m': ('外半径', 'm'), 'material_volume_m3': ('模型材料体积', 'm³'),
                   'envelope_volume_m3': ('模型包络体积', 'm³'), 'density_kg_m3': ('材料密度', 'kg/m³'),
                   'material_volume_m3_per_km': ('每公里材料体积', 'm³/km')}
_RATING_UNITS = {'value_a': ('允许电流', 'A'), 'depth_m': ('中心埋深', 'm'),
                 'soil_rho_k_m_w': ('土壤热阻率', 'K·m/W'), 'ambient_temperature_c': ('环境温度', '°C'),
                 'actual_spacing_m': ('实际中心间距', 'm'), 'spacing_m': ('声明中心间距', 'm'),
                 'frequency_hz': ('频率', 'Hz'), 'duct_inner_m': ('排管内径', 'm'),
                 'duct_outer_m': ('排管外径', 'm'), 'duct_rho_k_m_w': ('管壁热阻率', 'K·m/W')}
_STANDARD_VALUES = {'actual': '实际值', 'actual_unrounded': '未舍入实际值', 'design_actual': '设计值',
                    'limit': '要求限值', 'margin': '保存余量'}
_PLUGIN_ID = re.compile(r'(?:x-)?cablesim\.[A-Za-z0-9_.-]+')
_KEY_INPUT_FIELDS = frozenset({'nominal_area', 'r20', 'longitudinal_r20', 'voltage', 'u0', 'u', 'um',
    'frequency', 'x', 'z', 'surface_temperature', 'air_temperature', 'thermal_resistivity',
    'dry_thermal_resistivity', 'critical_temperature_rise', 'duration', 'period', 'wind_speed',
    'solar_irradiance', 'relative_permittivity', 'loss_tangent', 'density', 'relative_permeability'})


def _ref(source_id, path):
    return {'source_id': source_id, 'pointer': path}


def _cell(value, reference=None, unit=None, unit_ref=None):
    return {'value': value, 'raw_text': raw_text(value), 'value_ref': reference,
            'unit': unit, 'unit_ref': unit_ref}


class _Model:
    def __init__(self, request):
        self.value = {'schema': SCHEMA, 'kind': request['kind'], 'title': TITLES[request['kind']],
                      'metadata': deepcopy(request['document']), 'source_identity': {}, 'state': {},
                      'signatures': [{'role': role, 'label': label, 'name': None, 'date': None,
                                      'evidence_ref': None} for role, label in SIGNATURE_ROLES],
                      'sections': [], 'tables': {}, 'sources': {},
                      'coverage': {'policy': 'complete-frozen-payloads', 'unresolved_input_units': [],
                                   'archived_arrays': [], 'archived_results': [], 'additional_inputs': []}}
        self.names = {}
        self.input_seen = set()
        self.citations = {}
        self.deferred = []
        self.formulas_seen = set()

    def source(self, identifier, kind, payload, api_url=None, **extra):
        frozen = deepcopy(payload)
        try:
            digest = jsonsha(frozen)
        except (ValueError, TypeError, OverflowError):
            fail('FORMAL_SOURCE_INTEGRITY', '保存来源不是有限、完整的 JSON 数据。', 409)
        item = {'kind': kind, 'api_url': api_url, 'payload': frozen,
                'payload_digest': digest, **extra}
        previous = self.value['sources'].get(identifier)
        if previous is not None and previous != item:
            fail('FORMAL_SOURCE_CONFLICT', '同一来源身份出现不同冻结内容。', 409)
        self.value['sources'][identifier] = item
        return identifier

    def at(self, source, path):
        return resolve_pointer(self.value['sources'][source]['payload'], path)

    def literal(self, source, path, unit=None, unit_ref=None):
        return _cell(self.at(source, path), _ref(source, path), unit, unit_ref)

    def text(self, value):
        if value is None:
            return ''
        result = str(value)
        for identifier in sorted(self.names, key=len, reverse=True):
            result = result.replace(identifier, self.names[identifier])
        return _PLUGIN_ID.sub('保存的计算方法', result)

    def label(self, value):
        return _cell(self.text(value))

    def body_literal(self, source, path):
        """Keep technical identifiers in trace while preserving their original."""
        value = self.at(source, path)
        if isinstance(value, str) and _PLUGIN_ID.search(value):
            self.deferred.append({'text': value, 'source_ref': _ref(source, path), 'verbatim': True})
            return self.label(value)
        return self.literal(source, path)

    def section(self, identifier, heading, role='body', paragraphs=(), **extra):
        result = {'id': identifier, 'role': role, 'heading': heading,
                  'paragraphs': [{'text': str(item), 'source_ref': None, 'verbatim': False}
                                 for item in paragraphs], 'table_ids': [], **extra}
        self.value['sections'].append(result)
        return result

    def table(self, section, identifier, title, rows, *, columns=None):
        if not rows:
            return
        if identifier in self.value['tables']:
            fail('FORMAL_TABLE_ID', '交付表身份重复。')
        if columns is None:
            columns = [{'key': 'item', 'label': '对象与参数', 'role': 'text', 'weight': 2.2},
                       {'key': 'value', 'label': '原始数值', 'role': 'value', 'weight': 1.8},
                       {'key': 'unit', 'label': '单位', 'role': 'unit', 'weight': .8},
                       {'key': 'context', 'label': '工况、状态或依据', 'role': 'text', 'weight': 2.2}]
        self.value['tables'][identifier] = {'title': title, 'columns': columns, 'rows': rows}
        section['table_ids'].append(identifier)

    def row(self, identifier, label, source, path, unit=None, unit_ref=None, context=''):
        unit_value_ref = unit_ref if isinstance(unit_ref, dict) and 'source_id' in unit_ref else None
        return {'id': identifier, 'cells': {'item': self.label(label),
                'value': self.literal(source, path, unit, unit_ref),
                'unit': _cell(unit, unit_value_ref), 'context': self.label(context)}}

    def pair(self, identifier, label, cell):
        return {'id': identifier, 'cells': {'item': _cell(label), 'value': cell}}

    def pairs(self, section, identifier, title, rows):
        self.table(section, identifier, title, rows, columns=[
            {'key': 'item', 'label': '项目', 'role': 'text', 'weight': 1.2},
            {'key': 'value', 'label': '保存记录', 'role': 'text', 'weight': 4.8}])

    def citation(self, source, path, context):
        value = self.at(source, path)
        if isinstance(value, str) and value:
            # One visible copy of identical source text. Every original remains
            # in its own unchanged input/output source payload.
            self.citations.setdefault(value, (source, path, context))


def _run_projection(run):
    return {'record': {key: deepcopy(run.get(key)) for key in _RUN_FIELDS},
            'snapshot': deepcopy(run['snapshot']), 'output': deepcopy(run['output'])}


def _manifest(run, pin):
    manifest = run['snapshot'].get('method_manifests', {}).get(pin.get('release_digest'))
    if (not isinstance(manifest, dict) or jsonsha(manifest) != pin.get('release_digest')
            or manifest.get('id') != pin.get('plugin_id') or manifest.get('version') != pin.get('version')):
        fail('FORMAL_METHOD_EVIDENCE', '缺少与保存发行摘要一致的完整方法清单，不能补取当前方法。', 409)
    matches = [(index, cap) for index, cap in enumerate(manifest.get('capabilities', []))
               if cap.get('id') == pin.get('capability')]
    if len(matches) != 1 or not matches[0][1].get('method_version'):
        fail('FORMAL_METHOD_EVIDENCE', '保存的方法能力或算法版本不完整。', 409)
    return manifest, *matches[0]


def _verify_run(research, wid, run, pin):
    if (run.get('workspace') != wid or run.get('id') != pin['run_id']
            or run.get('integrity') != 'verified' or run.get('status') not in ('succeeded', 'partial')
            or not isinstance(run.get('snapshot'), dict) or not isinstance(run.get('output'), dict)):
        fail('FORMAL_RUN_UNAVAILABLE', '源运行未完整保存或不属于所选工程。', 409)
    if any(run.get(key) != pin[key] for key in ('input_digest', 'output_digest')):
        fail('FORMAL_SOURCE_CHANGED', '来源摘要已变化，请重新读取并选择运行。', 409)
    try:
        intact = jsonsha(run['snapshot']) == run['input_digest'] and jsonsha(run['output']) == run['output_digest']
    except (ValueError, TypeError, OverflowError):
        intact = False
    if not intact:
        fail('FORMAL_SOURCE_INTEGRITY', '完整保存输入或输出与运行摘要不一致。', 409)
    snapshot = run['snapshot']
    if not snapshot.get('cases') or any('input' not in case or 'parameters' not in case for case in snapshot['cases']):
        fail('FORMAL_FULL_SOURCE_REQUIRED', '需要包含全部工况输入的完整保存记录。', 409)
    for method in [snapshot['definition']['method'], *[entry['method'] for entry in snapshot['definition'].get('crosschecks', [])]]:
        _manifest(run, method)
    from .study_pdf import validate_sources
    try:
        validate_sources([run])
    except ValueError as error:
        fail('FORMAL_SOURCE_INTEGRITY', str(error), 409)
    from .convergence import has_temperature_field
    convergence = None
    if has_temperature_field(run):
        from .fem_evidence import proof
        convergence = proof(research, run)
        if convergence.get('status') != 'converged':
            fail('FORMAL_FEM_UNCONVERGED', '温度场缺少真实网格与计算域收敛证明，不能纳入正式文件。')
    for case in run['output'].get('cases', []):
        comparison = case.get('artifacts', {}).get('x-cablesim.iec-fem-comparison')
        if comparison is not None:
            status = run.get('artifact_status', {}).get(case['case_id'], {}).get('x-cablesim.iec-fem-comparison', {})
            if status.get('status') != 'verified':
                fail('FORMAL_COMPARISON_INTEGRITY', 'IEC/FEM 比较工件来源未通过校验。', 409)
            if comparison.get('valid') is not True:
                fail('FORMAL_COMPARISON_INVALID', 'IEC/FEM 比较未通过已保存的网格与域收敛检查。')
    return convergence


def _entities(document):
    result = {}
    for section in ('materials', 'cable_types', 'circuits', 'sections', 'load_cases'):
        for index, item in enumerate(document.get(section, [])):
            if not isinstance(item, dict):
                continue
            name = item.get('label') or item.get('name') or _PATH_LABELS.get(section, '对象') + ' ' + str(index + 1)
            if item.get('id'):
                result[item['id']] = name
            for number, child in enumerate(item.get('cables', [])):
                result[child['id']] = name + ' · ' + {'L1': 'A 相', 'L2': 'B 相', 'L3': 'C 相', 'L1L2L3': '三相'}.get(child.get('phase'), '电缆 ' + str(number + 1))
            for number, child in enumerate(item.get('cores', [])):
                result[child['id']] = '线芯 ' + str(number + 1)
    return result


def _input_label(document, path, title):
    pieces = path[1:].split('/')[:-1]
    labels = []
    names = _entities(document)
    for part in pieces:
        part = part.replace('~1', '/').replace('~0', '~')
        if part.isdigit():
            labels.append(str(int(part) + 1))
        elif part in _PATH_LABELS:
            labels.append(_PATH_LABELS[part])
        elif part in names:
            labels.append(names[part])
    return ' · '.join([*labels, title])


def _input_tables(model, section, run, *, include_domain=True):
    source = 'run:' + run['id']
    schema = run['snapshot'].get('input_contract', {}).get('parameter_schema', {})
    for index, case in enumerate(run['snapshot']['cases']):
        case_path = '/snapshot/cases/' + str(index)
        for kind in ('input', 'parameters'):
            if kind == 'input' and not include_domain:
                continue
            value = case[kind]
            identity = (kind, jsonsha(value), jsonsha(schema) if kind == 'parameters' else '')
            if identity in model.input_seen:
                continue
            model.input_seen.add(identity)
            rows = []
            for path, _number in numeric_leaves(value):
                absolute = case_path + '/' + kind + path
                if kind == 'input':
                    evidence = (domain_unit(value, path, source, case_path + '/input')
                                if value.get('schema_version') == 'cablesim.domain/1' else None)
                else:
                    evidence = parameter_unit(schema, value, path, source)
                if evidence is None:
                    model.value['coverage']['unresolved_input_units'].append(_ref(source, absolute))
                    continue
                if kind == 'input':
                    parts = [piece.replace('~1', '/').replace('~0', '~') for piece in path[1:].split('/')]
                    if parts[-1] not in _KEY_INPUT_FIELDS and not set(parts).intersection(
                            {'currents', 'base_current', 'max_conductor_temperature', 'measurements'}):
                        model.value['coverage']['additional_inputs'].append(_ref(source, absolute))
                        continue
                    # Identical saved objects/loads are common across all five
                    # specification runs and rating cases. Only omit a repeated
                    # input after comparing that entire frozen object exactly.
                    group = '/'.join(path.split('/')[:3]) if len(parts) > 1 else path
                    try:
                        object_value = resolve_pointer(value, group)
                    except (KeyError, IndexError, TypeError, ValueError):
                        object_value = value
                    fact_identity = ('domain-fact', parts[0], jsonsha(object_value),
                                     '/'.join(parts[2:]), canonical_bytes(_number), evidence['unit'])
                    if fact_identity in model.input_seen:
                        model.value['coverage']['additional_inputs'].append(_ref(source, absolute))
                        continue
                    model.input_seen.add(fact_identity)
                label = _input_label(value, path, evidence['title']) if kind == 'input' else evidence.get('title') or '保存方法参数'
                rows.append(model.row(source + absolute, label, source, absolute,
                    evidence['unit'], evidence['unit_ref'], '工况 ' + str(index + 1)))
            title = ('保存的工程输入' if kind == 'input' else '保存的方法参数') + ' · ' + model.text(run['snapshot']['definition']['title'])
            model.table(section, source + ':' + str(index) + ':' + kind, title, rows)
        for field in ('provenance',):
            for key, value in case['input'].get(field, {}).items():
                if isinstance(value, dict) and isinstance(value.get('reference'), str):
                    model.citation(source, case_path + '/input/' + field + '/' + token(key) + '/reference', '工程输入来源')
        for key, value in case['parameters'].get('sources', {}).items():
            path = case_path + '/parameters/sources/' + token(key)
            if isinstance(value, str):
                model.citation(source, path, '参数来源')
            elif isinstance(value, dict) and isinstance(value.get('reference'), str):
                model.citation(source, path + '/reference', '参数来源')
    for key, value in run['snapshot']['definition'].get('input_sources', {}).items():
        if isinstance(value, dict) and isinstance(value.get('reference'), str):
            model.citation(source, '/snapshot/definition/input_sources/' + token(key) + '/reference', '研究输入来源')


def _quantity_tables(model, section, run, keys=None):
    source = 'run:' + run['id']
    inputs = {case['case_id']: case['input'] for case in run['snapshot']['cases']}
    headlines = {item.get('key'): item.get('title') for item in run['snapshot'].get('headline_contract', [])}
    rows = []
    for case_index, case in enumerate(run['output'].get('cases', [])):
        names = _entities(inputs.get(case['case_id'], {}))
        for index, result in enumerate(case.get('results', [])):
            path = '/output/cases/' + str(case_index) + '/results/' + str(index)
            if result.get('type', 'quantity') != 'quantity':
                model.value['coverage']['archived_results'].append(_ref(source, path))
                continue
            if keys is not None and result.get('key') not in keys:
                model.value['coverage']['archived_results'].append(_ref(source, path))
                continue
            if 'value' not in result:
                # An explicit unavailable declaration is retained as text, not zero.
                if result.get('status') == 'available':
                    fail('FORMAL_RESULT_MISSING', '可用结果缺少保存数值。', 409)
                result_cell = _cell(None)
            else:
                result_cell = model.literal(source, path + '/value', result.get('unit'),
                    _ref(source, path + '/unit') if 'unit' in result else None)
            unit = result.get('unit')
            if is_number(result_cell['value']) and not isinstance(unit, str):
                model.value['coverage']['unresolved_input_units'].append(_ref(source, path + '/value'))
                continue
            label = _LABELS.get(result.get('key')) or headlines.get(result.get('key')) or '保存结果项'
            entity = names.get(result.get('entity')) or '保存对象'
            condition = _CONDITIONS.get(result.get('case'), result.get('case', ''))
            basis = result.get('rating_basis') or {}
            context = '；'.join(filter(None, [str(case.get('case_id', '')), condition,
                basis.get('display_name') or basis.get('kind', ''),
                _STATUS.get(result.get('status'), result.get('status', '')),
                (result.get('reason') or {}).get('message') if isinstance(result.get('reason'), dict) else result.get('reason')]))
            rows.append({'id': source + path, 'cells': {'item': model.label(entity + ' · ' + label),
                         'value': result_cell, 'unit': _cell(unit, _ref(source, path + '/unit') if 'unit' in result else None),
                         'context': model.label(context)}})
        for name, artifact in case.get('artifacts', {}).items():
            if name == 'x-cablesim.temperature-field' or name.startswith('x-cablesim.field-'):
                model.value['coverage']['archived_arrays'].append(_ref(source,
                    '/output/cases/' + str(case_index) + '/artifacts/' + token(name)))
    model.table(section, source + ':quantities', '运行返回的工程量', rows)


def _artifact_tables(model, section, run, *, material_basis=True):
    source = 'run:' + run['id']
    for case_index, case in enumerate(run['output'].get('cases', [])):
        for artifact_name, artifact in case.get('artifacts', {}).items():
            base = '/output/cases/' + str(case_index) + '/artifacts/' + token(artifact_name)
            if artifact_name in ('x-cablesim.type-electrical', 'x-cablesim.type-short-circuit', 'x-cablesim.standard-check'):
                rows = []
                for row_index, item in enumerate(artifact.get('rows', [])):
                    path = base + '/rows/' + str(row_index)
                    fields = _STANDARD_VALUES if artifact_name == 'x-cablesim.standard-check' else {'value': '计算值'}
                    status = item.get('verdict', item.get('status', ''))
                    context = '；'.join(filter(None, [_STATUS.get(status, status), item.get('basis'),
                        item.get('reason'), item.get('citation') or ' '.join(filter(None, [item.get('standard'), item.get('clause')]))]))
                    nonempty = [field for field in fields if item.get(field) is not None]
                    for field, suffix in fields.items():
                        if field not in item:
                            continue
                        if item[field] is None and (nonempty or field != next(iter(fields))):
                            continue
                        if is_number(item[field]) and not isinstance(item.get('unit'), str):
                            fail('FORMAL_RESULT_UNIT', '工程结果缺少保存单位，不能填充推测单位。')
                        rows.append(model.row(source + path + '/' + field,
                            (item.get('title') or '保存结果项') + (' · ' + suffix if len(fields) > 1 else ''),
                            source, path + '/' + field, item.get('unit'),
                            _ref(source, path + '/unit') if 'unit' in item else None, context))
                    for key in ('citation', 'source_url'):
                        if isinstance(item.get(key), str) and item[key]:
                            model.citation(source, path + '/' + key, item.get('title') or '工程结果依据')
                    reference = item.get('input_source')
                    if isinstance(reference, dict) and isinstance(reference.get('reference'), str):
                        model.citation(source, path + '/input_source/reference', item.get('title') or '工程结果输入来源')
                    formula = item.get('formula')
                    if isinstance(formula, str) and formula and formula not in model.formulas_seen:
                        model.formulas_seen.add(formula)
                        paragraph = {'text': formula, 'source_ref': _ref(source, path + '/formula'), 'verbatim': True}
                        if _PLUGIN_ID.search(formula):
                            model.deferred.append(paragraph)
                        else:
                            section['paragraphs'].extend([{'text': '保存公式 · ' + model.text(item.get('title') or '计算条目'),
                                'source_ref': None, 'verbatim': False}, paragraph])
                model.table(section, source + base, '保存的条目与原始结果', rows)
            elif artifact_name == 'x-cablesim.cad-model':
                rows = []
                for part, values in [('', [artifact]), ('/layers', artifact.get('layers', [])),
                                     ('/material_usage', artifact.get('material_usage', []))]:
                    for index, item in enumerate(values):
                        path = base + part + ('/' + str(index) if part else '')
                        label = item.get('label') or ('结构总体' if not part else '结构层')
                        for key, (quantity, unit) in _GEOMETRY_UNITS.items():
                            if key not in item:
                                continue
                            selected = ({'outer_diameter_m', 'length_m', 'mass_kg_per_km'} if not part else
                                        {'inner_diameter_m', 'outer_diameter_m', 'material_volume_m3', 'density_kg_m3', 'mass_kg_per_km'}
                                        if part == '/layers' else
                                        {'material_volume_m3_per_km', 'density_kg_m3', 'mass_kg_per_km'})
                            if key not in selected:
                                continue
                            unit_ref = {'contract': 'x-cablesim.cad-model', 'field': key}
                            rows.append(model.row(source + path + '/' + key, label + ' · ' + quantity,
                                source, path + '/' + key, unit, unit_ref,
                                item.get('quantity_basis') or '保存的结构与用料结果'))
                        if isinstance(item.get('density_source'), dict) and isinstance(item['density_source'].get('reference'), str):
                            model.citation(source, path + '/density_source/reference', label + '密度来源')
                model.table(section, source + base, '结构尺寸、原始体积与用料', rows)
                input_index = next((i for i, item in enumerate(run['snapshot']['cases']) if item['case_id'] == case['case_id']), None)
                if input_index is not None:
                    section.setdefault('figures', []).append({'kind': 'cable_section', 'title': '保存的结构截面',
                        'geometry_ref': _ref(source, base), 'input_ref': _ref(source, '/snapshot/cases/' + str(input_index) + '/input')})
            # Material basis rows are already fixed with the run. Reading them
            # must never query today's standards library or recompute differences.
        basis = case.get('evidence', {}).get('material_basis', {}).get('rows', []) if material_basis else []
        rows = []
        for index, item in enumerate(basis):
            path = '/output/cases/' + str(case_index) + '/evidence/material_basis/rows/' + str(index)
            for field, suffix in (('value', '采用值'), ('reference_value', '依据值'), ('difference', '保存差值')):
                if field in item and isinstance(item.get('unit'), str):
                    rows.append(model.row(source + path + '/' + field,
                        (item.get('label') or '材料常数') + ' · ' + suffix, source, path + '/' + field,
                        item['unit'], _ref(source, path + '/unit'), item.get('status_label') or item.get('status', '')))
            if isinstance(item.get('citation'), str):
                model.citation(source, path + '/citation', item.get('label') or '材料依据')
        model.table(section, source + ':material-basis:' + str(case_index), '保存的材料常数与依据值', rows)


def _rating_tables(model, section, run):
    if not is_rating_table(run):
        fail('FORMAL_NOT_RATING_TABLE', '所选运行不是已保存的型号载流量表。')
    projected = rating_rows(run)
    source = model.source('rating:' + run['id'], 'rating_projection',
        {'run_id': run['id'], 'input_digest': run['input_digest'], 'output_digest': run['output_digest'], 'rows': projected},
        f"/api/design/workspaces/{run['workspace']}/rating-table-runs/{run['id']}?view=rows",
        run_source_id='run:' + run['id'], projection='rows-and-run-digests')
    currents, conditions = [], []
    for index, item in enumerate(projected):
        path = '/rows/' + str(index)
        if item.get('value_a') is None:
            fail('FORMAL_RATING_INCOMPLETE', '载流量表存在没有保存允许电流的工况：' + str(item.get('reason') or item.get('status')))
        context = '；'.join(filter(None, [item['condition'].get('rating_basis_name'), item.get('status'), item.get('reason')]))
        currents.append(model.row(source + path, item['name'], source, path + '/value_a', 'A',
            {'contract': 'type-rating-table', 'field': 'value_a'}, context))
        for key, (label, unit) in _RATING_UNITS.items():
            if key != 'value_a' and key in item['condition']:
                conditions.append(model.row(source + path + ':' + key, item['name'] + ' · ' + label,
                    source, path + '/condition/' + key, unit,
                    {'contract': 'type-rating-table', 'field': key}, context))
        if isinstance(item['condition'].get('source'), str):
            model.citation(source, path + '/condition/source', item['name'] + '条件来源')
    model.table(section, source + ':currents', '载流量与共同负荷口径', currents)
    model.table(section, source + ':conditions', '保存工况的 API 原始条件投影', conditions)


def _assessments(model, section, run):
    """Only saved selection/crosscheck statements; never derive a new comparison."""
    source = 'run:' + run['id']
    driver = run['snapshot']['definition']['driver']
    rows = []
    if run['output'].get('assessment'):
        unit = driver.get('target_unit')
        if not isinstance(unit, str):
            fail('FORMAL_ASSESSMENT_UNIT', '保存选型判定未声明目标量单位。')
        for index, item in enumerate(run['output']['assessment']):
            path = '/output/assessment/' + str(index)
            context = '；'.join(filter(None, [item.get('status'), item.get('rating_basis_name'),
                (item.get('reason') or {}).get('message')]))
            for field, title in (('value', '保存目标量'), ('margin', '保存余量')):
                if field in item:
                    rows.append(model.row(source + path + '/' + field, item['case_id'] + ' · ' + title,
                        source, path + '/' + field, unit, _ref(source, '/snapshot/definition/driver/target_unit'), context))
        if driver.get('minimum') is not None:
            rows.append(model.row(source + ':target', '保存的选型目标阈值', source,
                '/snapshot/definition/driver/minimum', unit, _ref(source, '/snapshot/definition/driver/target_unit')))
    model.table(section, source + ':assessment', '保存的选型判定', rows)
    rows = []
    for index, item in enumerate(run['output'].get('crosscheck', {}).get('quantities', [])):
        path = '/output/crosscheck/quantities/' + str(index)
        if not isinstance(item.get('unit'), str):
            fail('FORMAL_CROSSCHECK_UNIT', '保存交叉核对结果缺少单位。')
        label = _LABELS.get(item.get('key')) or '保存的交叉核对量'
        context = item.get('condition', '')
        for field, title in (('baseline', '保存基准值'), ('value', '保存对照值'), ('difference', '保存差值')):
            if field in item:
                rows.append(model.row(source + path + '/' + field, label + ' · ' + title,
                    source, path + '/' + field, item['unit'], _ref(source, path + '/unit'), context))
    model.table(section, source + ':crosscheck', '保存的交叉核对', rows)


def _stored_text(model, section, run):
    source = 'run:' + run['id']
    candidates = [('/output/summary', run['output'].get('summary'))]
    for index, case in enumerate(run['output'].get('cases', [])):
        for name, artifact in case.get('artifacts', {}).items():
            if isinstance(artifact, dict):
                candidates.append(('/output/cases/' + str(index) + '/artifacts/' + token(name) + '/conclusion', artifact.get('conclusion')))
    for path, text in candidates:
        if isinstance(text, str) and text:
            item = {'text': text, 'source_ref': _ref(source, path), 'verbatim': True}
            if _PLUGIN_ID.search(text):
                model.deferred.append(item)
            else:
                section['paragraphs'].append({'text': '保存的结论原文', 'source_ref': None, 'verbatim': False})
                section['paragraphs'].append(item)
    if model.value['kind'] in ('calculation', 'research_report'):
        paragraphs = []
        for index, text in enumerate(run['output'].get('limitations', [])):
            if isinstance(text, str) and text:
                paragraph = {'text': text, 'source_ref': _ref(source, '/output/limitations/' + str(index)), 'verbatim': True}
                if _PLUGIN_ID.search(text):
                    model.deferred.append(paragraph)
                else:
                    paragraphs.append(paragraph)
        if paragraphs:
            section['paragraphs'].append({'text': '已保存的适用范围与假设', 'source_ref': None, 'verbatim': False})
            section['paragraphs'].extend(paragraphs)


def _case_statuses(model, section, run):
    """A partial run must not hide its failed or unavailable saved cases."""
    rows = []
    source = 'run:' + run['id']
    for index, case in enumerate(run['output'].get('cases', [])):
        if case.get('status') == 'succeeded':
            continue
        path = '/output/cases/' + str(index)
        for field, label in (('case_id', '工况标识'), ('status', '保存状态')):
            if field in case:
                rows.append(model.pair(source + path + '/' + field, label,
                                       model.body_literal(source, path + '/' + field)))
        for field in ('error', 'reason'):
            message = case.get(field)
            if isinstance(message, str):
                rows.append(model.pair(source + path + '/' + field, '保存原因',
                                       model.body_literal(source, path + '/' + field)))
            elif isinstance(message, dict) and isinstance(message.get('message'), str):
                rows.append(model.pair(source + path + '/' + field, '保存原因',
                                       model.body_literal(source, path + '/' + field + '/message')))
    model.pairs(section, source + ':case-statuses', '未完成工况原始状态', rows)


def _signatures(model, types, db, wid, specification, source):
    lifecycle, payload = specification['lifecycle'], specification['payload']
    receipt = lifecycle.get('approval')
    if not receipt or lifecycle.get('stale') or lifecycle.get('status') not in ('approved', 'published'):
        return
    digest = receipt.get('receipt_digest')
    if jsonsha({key: value for key, value in receipt.items() if key != 'receipt_digest'}) != digest:
        fail('FORMAL_APPROVAL_INTEGRITY', '批准回执摘要不一致。', 409)
    sid = lifecycle.get('submission_id')
    row, submitted = types._submission(db, wid, sid, specification['digest'])
    if (row['status'] not in ('approved', 'published') or not row['receipt']
            or types._receipt(row['receipt']) != receipt or submitted != payload
            or receipt.get('decision') != 'approved' or receipt.get('authority') != 'local_manual_confirmation'
            or receipt.get('submission_id') != sid or receipt.get('specification_digest') != specification['digest']
            or receipt.get('workspace_revision') != payload['revision']
            or receipt.get('sources') != payload['sources']
            or receipt.get('release_exclusions', []) != payload.get('release_exclusions', [])
            or not receipt.get('reviewer') or not receipt.get('approved_at')):
        fail('FORMAL_APPROVAL_SCOPE', '批准记录不属于本份规格书及其完整来源范围。', 409)
    model.value['signatures'][-1].update(name=receipt['reviewer'], date=receipt['approved_at'],
        evidence_ref=_ref(source, '/lifecycle/approval'))


def _product_identity(model, section, specification, run, source):
    run_source = 'run:' + run['id']
    document = run['snapshot']['cases'][0]['input']
    cable = document.get('cable_types', [{}])[0]
    rows = []
    for path, value in numeric_leaves(cable.get('rating', {}), '/cable_types/0/rating'):
        if path.rsplit('/', 1)[-1] in ('u0', 'u', 'um'):
            unit = domain_unit(document, path, run_source, '/snapshot/cases/0/input')
            if unit:
                rows.append(model.row('product:' + path, unit['title'], run_source,
                    '/snapshot/cases/0/input' + path, unit['unit'], unit['unit_ref']))
    for index, core in enumerate(cable.get('cores', [])):
        if 'nominal_area' in core.get('conductor', {}):
            path = '/cable_types/0/cores/' + str(index) + '/conductor/nominal_area'
            unit = domain_unit(document, path, run_source, '/snapshot/cases/0/input')
            rows.append(model.row('product:area:' + str(index), '线芯 ' + str(index + 1) + ' · 导体标称截面',
                run_source, '/snapshot/cases/0/input' + path, unit['unit'], unit['unit_ref']))
    model.table(section, 'product:identity', '型号与额定参数', rows)
    from .type_specification import approved_standards
    approved = approved_standards(specification['payload'])
    rows, seen = [], set()
    for index, item in enumerate(specification['payload']['results']['standards']['artifact'].get('rows', [])):
        standard = item.get('standard')
        if not isinstance(standard, str) or standard in seen:
            continue
        seen.add(standard)
        path = '/payload/results/standards/artifact/rows/' + str(index) + '/standard'
        rows.append(model.pair('standard:' + str(index),
            '已有要求批准的执行标准' if standard in approved else '标准核对依据（未作为已批准执行标准声明）',
            model.body_literal(source, path)))
    model.pairs(section, 'product:standards', '标准依据与批准范围', rows)


def _trace(model, runs, workspace_source, specification_source=None):
    section = model.section('trace', '追溯记录', 'trace', paragraphs=[
        '本文件保留完整精度的保存值。完整输入、输出、方法清单与数组位于文件内的来源记录；正文未采用当前方法默认值，也未重新计算。',
        '未声明单位的字段只保留原始来源，不推测单位。验证等级是方法已保存的验证声明，不等同于工程审核或产品认证。'])
    section['paragraphs'].extend(model.deferred)
    model.pairs(section, 'trace:workspace', '工程与文件来源', [
        model.pair('workspace', '工程 ID', model.literal(workspace_source, '/id')),
        model.pair('revision', '请求固定的工程修订', model.literal(workspace_source, '/revision'))])
    if specification_source:
        model.pairs(section, 'trace:specification', '规格书提交与修订', [
            model.pair('specification-digest', '规格书内容摘要', model.literal(specification_source, '/digest')),
            model.pair('specification-state', '原规格书状态', model.literal(specification_source, '/lifecycle/status'))])
    for run in runs:
        source = 'run:' + run['id']
        rows = [model.pair(source + ':' + key, label, model.literal(source, '/record/' + key)) for key, label in
                [('id', '运行 ID'), ('workspace', '来源工程 ID'), ('study', '研究 ID'), ('sequence', '保存运行序号'),
                 ('status', '保存运行状态'), ('input_digest', '完整输入 SHA-256'), ('output_digest', '完整输出 SHA-256'),
                 ('created', '创建时间（原记录）'), ('finished', '完成时间（原记录）')]]
        rows.append(model.pair(source + ':url', '完整运行 API', _cell(model.value['sources'][source]['api_url'])))
        rows.append(model.pair(source + ':payload', '文件内冻结投影 SHA-256', _cell(model.value['sources'][source]['payload_digest'])))
        for key, label in [('method_version', '输出声明算法版本'), ('validation/level', '输出声明可信分档')]:
            try:
                value = model.literal(source, '/output/' + key)
            except KeyError:
                value = _cell(None)
            rows.append(model.pair(source + ':output:' + key, label, value))
        pins = [('/snapshot/definition/method', run['snapshot']['definition']['method'])]
        pins.extend(('/snapshot/definition/crosschecks/' + str(i) + '/method', item['method'])
                    for i, item in enumerate(run['snapshot']['definition'].get('crosschecks', [])))
        for number, (path, pin) in enumerate(pins):
            manifest, cap_index, capability = _manifest(run, pin)
            manifest_path = '/snapshot/method_manifests/' + token(pin['release_digest'])
            fields = [('方法名称', manifest_path + '/name'), ('能力名称', manifest_path + '/capabilities/' + str(cap_index) + '/title'),
                      ('冻结契约算法版本', manifest_path + '/capabilities/' + str(cap_index) + '/method_version'),
                      ('发行版本', path + '/version'), ('发行摘要', path + '/release_digest'),
                      ('原方法标识', path + '/plugin_id'), ('原能力标识', path + '/capability')]
            for label, field in fields:
                rows.append(model.pair(source + ':method:' + str(number) + ':' + field, label, model.literal(source, field)))
        for index, execution in enumerate(run['output'].get('executions', [])):
            if isinstance(execution.get('validation'), dict) and 'level' in execution['validation']:
                rows.append(model.pair(source + ':validation:' + str(index), '执行记录可信分档',
                    model.literal(source, '/output/executions/' + str(index) + '/validation/level')))
        model.pairs(section, source + ':trace', model.text(run['snapshot']['definition']['title']) + ' · 运行追溯', rows)
        convergence_source = 'convergence:' + run['id']
        if convergence_source in model.value['sources']:
            evidence = model.value['sources'][convergence_source]['payload']
            proof_rows = [model.pair(convergence_source + ':' + field, label,
                          model.literal(convergence_source, '/' + field))
                          for field, label in [('id', '已保存收敛流程'), ('status', '收敛证明状态'), ('reason', '保存判定原因')]
                          if field in evidence and not isinstance(evidence[field], (list, dict))]
            proof_rows.append(model.pair(convergence_source + ':digest', '完整收敛证明 SHA-256',
                _cell(model.value['sources'][convergence_source]['payload_digest'])))
            model.pairs(section, convergence_source + ':trace', '温度场收敛依据', proof_rows)
        for index, text in enumerate(run['output'].get('limitations', [])):
            if isinstance(text, str) and model.value['kind'] not in ('calculation', 'research_report'):
                section['paragraphs'].append({'text': text, 'source_ref': _ref(source, '/output/limitations/' + str(index)), 'verbatim': True})
    if model.citations:
        rows = []
        for index, (text, (source, path, context)) in enumerate(model.citations.items()):
            rows.append(model.pair('citation:' + str(index), model.text(context), model.literal(source, path)))
        model.pairs(section, 'trace:data-sources', '数据来源与标准依据原文', rows)
    if model.value['coverage']['unresolved_input_units']:
        section['paragraphs'].append({'text': '部分原始来源字段未声明工程单位，未列为正文工程量；完整字段与数值保留于来源快照，coverage 记录其精确位置。',
                                      'source_ref': None, 'verbatim': False})


def build_model(research, types, request: dict) -> dict:
    """Read one pinned project, returning a deterministic, renderer-only model."""
    model = _Model(request)
    selection = request['source']
    wid, revision = selection['workspace_id'], selection['expected_revision']
    specification = None
    specification_source = None
    # Pin the database snapshot used for receipts and raw-source comparison.
    # The existing public readers still authenticate their full saved records;
    # comparison with this snapshot rejects a concurrent change mid-read.
    with research.store.read_snapshot() as db:
        row, _state = research.store.load(db, wid)
        if row['revision'] != revision:
            fail('FORMAL_REVISION_CHANGED', '工程修订已变化，请重新预览。', 409)
        workspace_source = model.source('workspace:' + wid, 'workspace', {'id': wid, 'revision': row['revision']},
                                       '/api/workspaces/' + wid)
        if request['kind'] == 'specification':
            specification = types.specification(wid, 'internal')
            payload = specification['payload']
            if (payload.get('workspace_id') != wid or payload.get('revision') != revision
                    or specification['digest'] != selection['specification_digest']
                    or fingerprint(payload) != specification['digest']):
                fail('FORMAL_SPECIFICATION_CHANGED', '规格书内容、工程或修订与固定摘要不符。', 409)
            lifecycle = {key: deepcopy(specification['lifecycle'].get(key))
                         for key in ('status', 'submission_id', 'approval', 'stale')}
            specification_source = model.source('specification:' + wid, 'specification',
                {'payload': payload, 'digest': specification['digest'], 'lifecycle': lifecycle},
                '/api/types/' + wid + '/specification?audience=internal&view=full')
            pins = [{key: source[key] for key in ('run_id', 'input_digest', 'output_digest')} for source in payload['sources']]
            channels = {source['channel']: source['run_id'] for source in payload['sources']}
            if not all(channel in channels and channel in payload['results'] for channel in (*_CHANNELS, 'rating')):
                fail('FORMAL_SPECIFICATION_INCOMPLETE', '规格书缺少完整保存的结构、电气、载流量、短路或标准通道。')
        else:
            pins = deepcopy(selection['runs'])
            channels = {}
        runs = []
        for pin in pins:
            saved = db.execute('SELECT * FROM study_runs WHERE workspace=? AND id=?', (wid, pin['run_id'])).fetchone()
            if not saved:
                fail('FORMAL_RUN_UNAVAILABLE', '源运行不存在或不属于本工程。', 404)
            run = research.get_run(wid, pin['run_id'])
            proof = _verify_run(research, wid, run, pin)
            original = dict(saved)
            original['snapshot'] = json.loads(saved['snapshot'])
            original['output'] = json.loads(saved['output'])
            if _run_projection(original) != _run_projection(run):
                fail('FORMAL_SOURCE_CHANGED', '读取期间来源记录改变，未生成文件。', 409)
            source = model.source('run:' + run['id'], 'run', _run_projection(run),
                f"/api/workspaces/{wid}/studies/{run['study']}/runs/{run['id']}?view=full")
            manifest, _index, _capability = _manifest(run, run['snapshot']['definition']['method'])
            model.names[manifest['id']] = manifest.get('name') or '保存方法'
            if proof is not None:
                model.source('convergence:' + run['id'], 'convergence_proof', proof,
                             run_source_id=source)
            runs.append(run)
        model.value['source_identity'] = {'workspace_id': wid, 'revision': revision, 'pins': pins}
        if specification:
            model.value['source_identity']['specification_digest'] = specification['digest']
            model.value['state'] = {'status': specification['lifecycle']['status'],
                                   'label': _STATUS.get(specification['lifecycle']['status'], '保存规格书'),
                                   'stale': bool(specification['lifecycle'].get('stale')),
                                   'purpose': specification['payload'].get('purpose')}
            _signatures(model, types, db, wid, specification, specification_source)
        else:
            demonstration = any(item.get('kind') == 'demo'
                for run in runs for case in run['snapshot']['cases']
                for item in case['input'].get('provenance', {}).values() if isinstance(item, dict))
            model.value['state'] = {'status': 'saved_record', 'label': '保存运行复现', 'stale': False,
                                   'purpose': 'demo' if demonstration else 'engineering'}
        model.value['state']['runs'] = [{'run_id': run['id'], 'freshness': run.get('freshness'),
                                         'status': run['status']} for run in runs]
        overview = model.section('overview', '文件范围与保存状态', paragraphs=[
            '本文数值为已保存运行的原始值，采用该记录明确声明的单位；空值和缺项保持原状态。',
            '签栏仅填写与本文件范围一致的已有记录；没有独立签核记录的角色留空。'])
        if model.value['state']['purpose'] == 'demo':
            overview['paragraphs'].append({'text': '演示设计数据，用于核对文档与计算流程，不代表厂家产品承诺。',
                'source_ref': _ref(specification_source, '/payload/purpose') if specification else None, 'verbatim': False})
        if specification:
            model.pairs(overview, 'product:name', '型号', [model.pair('name', '保存型号名称',
                        model.body_literal(specification_source, '/payload/name'))])
            by_id = {run['id']: run for run in runs}
            product = model.section('product', '型号与标准依据')
            _product_identity(model, product, specification, by_id[channels['geometry']], specification_source)
            for channel in ('geometry', 'electrical', 'rating', 'short_circuit', 'standards'):
                run = by_id[channels[channel]]
                section = model.section('specification:' + channel, _HEADINGS[channel])
                if channel == 'rating':
                    if specification['payload']['results'][channel].get('rows') != rating_rows(run):
                        fail('FORMAL_SPECIFICATION_BINDING', '规格书载流量投影不匹配保存运行。', 409)
                    _rating_tables(model, section, run)
                else:
                    artifact = specification['payload']['results'][channel].get('artifact')
                    matches = [case.get('artifacts', {}).get(_CHANNELS[channel]) for case in run['output']['cases']]
                    if artifact is None or not any(artifact == item for item in matches):
                        fail('FORMAL_SPECIFICATION_BINDING', '规格书工程条目不匹配保存运行。', 409)
                selected_keys = ({'ampacity', 'conductor_temperature'} if channel == 'rating' else
                                 set() if channel == 'geometry' else None)
                _quantity_tables(model, section, run, selected_keys)
                _artifact_tables(model, section, run, material_basis=channel != 'rating')
                _stored_text(model, section, run)
                _case_statuses(model, section, run)
            revisions = model.section('revisions', '文档修订记录')
            rows = []
            for index, item in enumerate(specification['payload'].get('revisions', [])):
                for key, label in (('version', '文件版本'), ('summary', '修订说明'), ('author', '修订作者（不等同设计签核）'), ('created', '记录时间')):
                    if key in item:
                        rows.append(model.pair('revision:' + str(index) + ':' + key, label,
                            model.body_literal(specification_source, '/payload/revisions/' + str(index) + '/' + key)))
            model.pairs(revisions, 'revisions', '保存的文档修订', rows)
            if not rows:
                revisions['paragraphs'].append({'text': '尚无已提交的文档修订记录。', 'source_ref': None, 'verbatim': False})
        else:
            for index, run in enumerate(runs):
                section = model.section('run:' + run['id'], model.text(run['snapshot']['definition']['title']))
                if request['kind'] == 'rating_table':
                    _rating_tables(model, section, run)
                selected_keys = {'ampacity', 'conductor_temperature'} if request['kind'] == 'rating_table' else None
                _quantity_tables(model, section, run, selected_keys)
                _artifact_tables(model, section, run, material_basis=request['kind'] != 'rating_table')
                _assessments(model, section, run)
                _stored_text(model, section, run)
                _case_statuses(model, section, run)
        inputs = model.section('inputs', '关键输入与方法条件', paragraphs=[
            '这里使用运行中保存的原始工程量；温度单位为记录声明的 K 或 °C，坐标保留原方向。完整来源中的其他字段仍全部保留。'])
        for run in runs:
            _input_tables(model, inputs, run)
        _trace(model, runs, workspace_source, specification_source)
        # One last uncached revision read rejects edits that committed while
        # this snapshot was being composed. API export also rebuilds the whole
        # model after rendering to reject later source or approval changes.
        with research.store.read_snapshot() as final_db:
            if research.store.load(final_db, wid)[0]['revision'] != revision:
                fail('FORMAL_REVISION_CHANGED', '生成期间工程修订已变化。', 409)
    validate_model_refs(model.value)
    model.value['source_digest'] = jsonsha(model.value['sources'])
    model.value['model_digest'] = jsonsha(model.value)
    return model.value
