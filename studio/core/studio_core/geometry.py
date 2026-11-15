"""CAD orchestration only. The sealed CadQuery plugin owns all geometry."""
from threading import Lock

from . import CoreError, runner

_building = Lock()


def build(entry):
    payload = entry['payload']
    cable = payload['cable_type']
    document = {'schema_version': 'cablesim.domain/1', 'materials': payload['materials'],
                'cable_types': [cable], 'circuits': [], 'sections': []}
    case = {'case_id': 'product', 'input': document,
            'parameters': {'cable_type_id': cable['id'], 'length_m': .18, 'include_exact': True}}
    # Native CAD work is serialized; nothing substitutes for a refused model.
    with _building:
        result = runner.run('cablesim.cable-geometry', 'concentric-model', [case])
    outcome = result['cases'][0]
    if outcome['status'] != 'succeeded':
        error = outcome['error']
        raise CoreError(error['code'], error['message'], error.get('path'))
    model = outcome['artifacts']['x-cablesim.cad-model']
    if model.get('schema') != 'cablesim.cad-model/1' or model.get('step_unit') != 'mm' or not model.get('step_text'):
        raise CoreError('CAD_ARTIFACT_INVALID', '几何插件未交付有效的毫米制 STEP，未显示替代模型。')
    return {'model': model, 'method': {key: result[key] for key in (
        'plugin_id', 'plugin_version', 'capability', 'method_version', 'manifest_sha256', 'request_sha256')},
        'environment': result['environment'], 'artifact_sha256': outcome['artifact_digests']['x-cablesim.cad-model'],
        'warnings': outcome['warnings']}
