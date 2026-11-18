"""Present saved preflight diagnostics without supplying or changing engineering inputs."""
from copy import deepcopy
import re
from urllib.parse import urlencode

from fastapi import HTTPException

from .fields import DOMAIN_FIELDS, parts, schema_at


# Display aliases used by the existing workbench for historical method errors.
# These identify fields only: no unit suffix inference, input conversion or defaults.
LEGACY_FIELDS = {
    'r20_ohm_m': 'r20', 'diameter_m': 'diameter', 'thickness_m': 'thickness',
    'outer_diameter_m': 'outer_diameter', 'inner_diameter_m': 'inner_diameter',
    'alpha20_per_k': 'temperature_coefficient_20', 'tan_delta': 'loss_tangent',
    'rho_k_m_w': 'thermal_resistivity', 'soil_rho_k_m_w': 'thermal_resistivity',
    'resistivity20_ohm_m': 'electrical_resistivity_20',
}
REASONS = {
    'missing': '必填项未填写', 'float_type': '未填写或不是有效数值',
    'float_parsing': '不是有效数值', 'int_type': '未填写或不是有效整数',
    'int_parsing': '不是有效整数', 'finite_number': '必须填写有限数值',
    'string_type': '必须填写文本', 'string_too_short': '文本未填写或长度不足',
    'string_too_long': '文本超过允许长度', 'list_type': '必须填写列表',
    'dict_type': '必须填写完整对象', 'bool_type': '必须明确选择是或否',
    'literal_error': '取值不在方法允许的选项中', 'enum': '取值不在方法允许的选项中',
    'greater_than': '数值未达到方法要求的下限', 'greater_than_equal': '数值低于方法允许的下限',
    'less_than': '数值未低于方法要求的上限', 'less_than_equal': '数值超过方法允许的上限',
    'extra_forbidden': '此字段不属于当前方法的输入契约',
}
SCHEMA_REASONS = {
    'required': '必填项未填写', 'type': '取值类型不符合方法契约',
    'minimum': '数值低于方法允许的下限', 'exclusiveMinimum': '数值未达到方法要求的下限',
    'maximum': '数值超过方法允许的上限', 'exclusiveMaximum': '数值未低于方法要求的上限',
    'enum': '取值不在方法允许的选项中', 'minLength': '文本未填写或长度不足',
    'maxLength': '文本超过允许长度', 'minItems': '列表缺少必需条目',
    'additionalProperties': '包含当前方法未声明的字段',
}


def field_metadata(capability, path):
    """Prefer declared schema titles; preserve unknown paths instead of guessing a field."""
    try:
        tokens = parts(path)
    except HTTPException:
        return '输入字段', None, False
    parameter = bool(tokens and tokens[0] == 'parameters')
    schema = capability.parameter_schema if parameter else getattr(capability.input_contract, 'standalone_schema', None)
    if schema:
        pointer = '/' + '/'.join(token.replace('~', '~0').replace('/', '~1') for token in tokens[1:]) if tokens[0] in ('parameters', 'input') else path
        try:
            declared = schema_at(schema.model_dump(mode='json', by_alias=True, exclude_none=True), pointer)
        except (HTTPException, KeyError, IndexError, TypeError, ValueError):
            declared = {}
        if isinstance(declared.get('title'), str) and re.search(r'[\u3400-\u9fff]', declared['title']):
            unit = declared.get('x-unit')
            return declared['title'], unit.get('si') if isinstance(unit, dict) else unit, parameter
    field = LEGACY_FIELDS.get(tokens[-1], tokens[-1]) if tokens else ''
    if field in DOMAIN_FIELDS:
        label, unit = DOMAIN_FIELDS[field]
        if field == 'r20':
            label += '（R20）'
        return label, unit, parameter
    return '方法参数' if parameter else '输入字段', None, parameter


def refusal(research, workspace, study, selected, checked):
    """Keep every rejected case and its original location, including crosschecks."""
    diagnostics, issues, actions = [], [], []
    study_url = '/studies/' + study['id'] + '?' + urlencode({'workspace': workspace})
    for case in [*checked.get('cases', []), *checked.get('crosschecks', [])]:
        if case.get('status') == 'succeeded':
            continue
        error = case.get('error') or {}
        diagnostics.append({'case_id': case.get('case_id'), 'status': case.get('status'), 'error': deepcopy(error)})
        _, capability = research.resolve(case.get('method') or selected['method'])
        raw_issues = error.get('issues') or [error]
        for issue in raw_issues:
            path = issue.get('path') or error.get('path')
            if not path and isinstance(issue.get('loc'), (list, tuple)):
                path = '/' + '/'.join(str(token).replace('~', '~0').replace('/', '~1') for token in issue['loc'])
            path = path or '/input'
            label, unit, parameter = field_metadata(capability, path)
            original = str(issue.get('message') or issue.get('msg') or error.get('message') or '')
            reason = REASONS.get(issue.get('code') or issue.get('type'))
            rule = re.search(r'契约（([A-Za-z]+)）', original)
            if not reason and rule:
                reason = SCHEMA_REASONS.get(rule[1])
            if not reason:
                reason = re.sub(r'^Value error,\s*', '', original) if re.search(r'[\u3400-\u9fff]', original) else '未通过当前方法的输入校验，请核对取值和适用范围'
            location = '方法参数' if parameter else '本研究模型（独立输入）' if selected.get('input_source') == 'study' else '工程模型输入'
            if not parameter and any(token in path for token in ('conductor', 'cable_types', 'insulation', 'sheath')):
                location += ' → 电缆模型'
            elif not parameter and any(token in path for token in ('installation', 'sections', 'load_cases', 'circuits')):
                location += ' → 敷设工况'
            elif not parameter and 'materials' in path:
                location += ' → 材料参数'
            href = study_url + '&' + urlencode({'inspector': 'method' if parameter else 'input', **({'view': 'cable'} if '电缆模型' in location else {})})
            action = f'打开研究“{study["definition"]["title"]}”的工作台，在“{location}”按字段位置补齐或修正“{label}”，并核对口径和来源后重新提出运行。'
            if action not in actions:
                actions.append(action)
            issues.append({'case_id': case.get('case_id'), 'code': issue.get('code') or issue.get('type') or error.get('code'),
                           'path': path, 'label': label, 'unit': unit, 'message': reason,
                           'original_message': original, 'workbench_path': href, 'repair': action})
    descriptions = list(dict.fromkeys(f'{item["label"]}：{item["message"]}（字段 {item["path"]}）' for item in issues))
    message = '研究预检未通过，未创建运行：' + ('；'.join(descriptions[:8]) if descriptions else '当前输入或方法适用范围未通过校验') + '。'
    if len(descriptions) > 8:
        message += f'另有 {len(descriptions) - 8} 项，见完整字段诊断。'
    message += '\n' + '\n'.join(actions[:3] or ['请打开研究工作台，核对输入、方法参数及来源后重新提出运行。'])
    return {'code': 'MISSING_INPUT', 'message': message, 'path': issues[0]['path'] if issues else '/input',
            'issues': issues, 'diagnostics': diagnostics, 'workbench_path': issues[0]['workbench_path'] if issues else study_url,
            'next_actions': actions, 'input_digest': checked.get('input_digest')}
