"""Review an existing type-rating definition without owning a rating algorithm."""
from copy import deepcopy

from fastapi import HTTPException

from backend.kernel.contracts import CreateStudy
from backend.kernel.rating_conditions import RatingTableDefinition, table_definition
from backend.plugin_host.parameter_contracts import validate_case

from .external_parameters import review_points


COMMON = ('case_id', 'name', 'layout', 'depth_m', 'soil_rho_k_m_w',
          'ambient_temperature_c', 'frequency_hz', 'bonding', 'rating_basis', 'source')
SPACED = ('flat', 'air', 'ducts', 'three_core_buried_horizontal', 'three_core_ducts_horizontal')
DUCTED = ('ducts', 'three_core_ducts_horizontal')
DUCT_FIELDS = ('duct_inner_m', 'duct_outer_m', 'duct_rho_k_m_w')
LABELS = {
    'layout': ('敷设排列', None), 'depth_m': ('埋深', 'm'),
    'soil_rho_k_m_w': ('土壤热阻率', 'K·m/W'),
    'ambient_temperature_c': ('环境温度', '°C'), 'frequency_hz': ('频率', 'Hz'),
    'spacing_m': ('排列间距', 'm'), 'bonding': ('护层接地', None),
    'rating_basis': ('载流量口径', None), 'source': ('条件来源', None),
    'duct_inner_m': ('管内径', 'm'), 'duct_outer_m': ('管外径', 'm'),
    'duct_rho_k_m_w': ('管材热阻率', 'K·m/W'),
}
VALUES = {'trefoil': '单芯品字形', 'flat': '单芯水平', 'ducts': '单芯排管', 'air': '空气水平',
          'three_core_buried_single': '三芯单回直埋', 'three_core_buried_horizontal': '三芯水平直埋',
          'three_core_ducts_horizontal': '三芯水平排管', 'both_ends': '两端接地',
          'single_point': '单点接地', 'unspecified': '未指定',
          'simultaneous': '共同等负荷', 'individual': '单回路变化、其余保持负荷'}


def schema():
    result = RatingTableDefinition.model_json_schema()
    result['properties'].pop('expected_revision')
    result['properties']['title'] = {'type': 'string', 'minLength': 1, 'maxLength': 120}
    result['required'] = ['rows', 'parameters']
    row = result['$defs']['RatingRow']
    row['required'] = list(COMMON)
    row['allOf'] = [
        {'if': {'properties': {'layout': {'enum': list(SPACED)}}},
         'then': {'required': ['spacing_m'], 'properties': {'spacing_m': {'type': 'number', 'exclusiveMinimum': 0}}}},
        {'if': {'properties': {'layout': {'enum': list(DUCTED)}}}, 'then': {'required': list(DUCT_FIELDS)}},
    ]
    def explicit(value):
        if isinstance(value, dict):
            value.pop('default', None)
            for child in value.values(): explicit(child)
        elif isinstance(value, list):
            for child in value: explicit(child)
    explicit(result)
    return result


def prepare(actions, task, state, arguments):
    # The public schema requires explicit engineering conditions. Check again at
    # this boundary so calling the helper cannot activate the editor's defaults.
    for index, row in enumerate(arguments['rows']):
        required = [*COMMON, *(['spacing_m'] if row.get('layout') in SPACED else []),
                    *(DUCT_FIELDS if row.get('layout') in DUCTED else [])]
        missing = [key for key in required if key not in row or row[key] is None]
        if missing:
            raise HTTPException(422, {'code': 'RATING_INPUT_REQUIRED', 'message': '载流量表工况须明确填写：' + '、'.join(missing),
                                      'path': '/rows/' + str(index) + '/' + missing[0]})
    request = RatingTableDefinition.model_validate({
        **{key: value for key, value in arguments.items() if key != 'title'},
        'expected_revision': task['workspace_revision'],
    })
    entry = next((row for row in actions.research.methods() if row['method']['plugin_id'] == 'cablesim.iec60287'), None)
    if not entry or not any(cap['id'] == 'steady-rating' for cap in entry['capabilities']):
        raise HTTPException(422, {'code': 'RATING_METHOD_UNAVAILABLE', 'message': 'IEC 60287 稳态方法未安装或不可用。'})
    method = {**entry['method'], 'capability': 'steady-rating'}
    definition = table_definition({**deepcopy(state), 'revision': task['workspace_revision']}, request, method)
    if arguments.get('title'): definition['title'] = arguments['title']
    saved = CreateStudy.model_validate({**definition, 'expected_revision': task['workspace_revision']})
    from .external_execution import require_local
    _, capability = require_local(actions.research, saved.model_dump(mode='json'))
    for case in definition['driver']['cases']:
        validate_case(capability, {'input': case['input'], 'parameters': {**request.parameters, **case['parameters']}})
    changes = [
        {'path': '/title', 'label': '研究名称', 'before': None, 'after': saved.title, 'unit': None},
        {'path': '/method', 'label': '计算方法与版本', 'before': None,
         'after': entry['name'] + ' ' + method['version'] + ' · ' + capability.title + '（方法 ' + capability.method_version + '）', 'unit': None},
    ]
    for index, row in enumerate(request.rows):
        values = row.model_dump()
        applicable = [key for key in LABELS if key not in DUCT_FIELDS or row.layout in DUCTED]
        for key in applicable:
            if key == 'spacing_m' and key not in arguments['rows'][index]: continue
            value = values[key]
            changes.append({'path': '/rows/' + str(index) + '/' + key, 'label': row.name + ' · ' + LABELS[key][0],
                            'before': None, 'after': VALUES.get(value, value) if isinstance(value, str) else value,
                            'unit': LABELS[key][1]})
    for point in review_points(request.parameters, capability, definition['method_input']):
        changes.append({'path': point['path'], 'label': point['label'], 'before': None,
                        'after': point['value'], 'unit': point['unit']})
    changes.append({'path': '/selected_case_ids', 'label': '所选工况', 'before': None,
                    'after': '、'.join(row.name for row in request.rows if request.selected_case_ids is None or row.case_id in request.selected_case_ids), 'unit': None})
    return saved.model_dump(mode='json', exclude={'expected_revision'}), changes, capability.limitations
