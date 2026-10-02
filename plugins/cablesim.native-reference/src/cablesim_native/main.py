"""Native methods under cablesim.run/2; every case owns its artifact directory."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))  # shared, read-only geometry and validation contracts
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import base64
from hashlib import sha256
from importlib import metadata
import json
import os
import platform

from backend.foundation.study import prepare_study
from backend.plugins.buried_contract import BuriedArgs
from backend.plugins.electrothermal_contract import preflight
from cablesim_native.buried import buried_reference, check_mesh_geometry
from cablesim_native.electrothermal import electrothermal_reference
from cablesim_native.line_source import internal_resistance, soil_matrix
from cablesim_native.domain import prepare


def quantities(summary, capability, arguments, binding):
    condition = 'fixed-power' if capability != 'electrothermal' else 'rating' if arguments['mode'] == 'ampacity' else 'operating'
    result = [{'key': 'conductor_temperature', 'type': 'quantity', 'entity': entity, 'case': condition,
               'status': 'available', 'value': temp + 273.15, 'unit': 'K'}
              for entity, temp in zip(binding['cables'], summary['conductor_max_temperatures_c'])]
    if capability == 'electrothermal':
        ampacity = {'key': 'ampacity', 'type': 'quantity', 'entity': binding['circuit'], 'case': 'rating', 'unit': 'A'}
        if summary['ampacity_a'] is None:
            ampacity.update(status='unavailable', reason={'code': 'OPERATING_POINT_ONLY', 'message': '本次仅求运行温度，未反求允许电流。'})
        else:
            ampacity.update(status='available', value=summary['ampacity_a'])
        result.append(ampacity)
        for key, field in (('losses.conductor', 'conductor_losses_w_m'), ('losses.sheath', 'screen_losses_w_m'),
                           ('losses.dielectric', 'dielectric_losses_w_m')):
            result.extend({'key': key, 'type': 'quantity', 'entity': entity, 'case': condition,
                           'status': 'available', 'value': value, 'unit': 'W/m'}
                          for entity, value in zip(binding['cables'], summary[field]))
    return result


def run_case(request, case, job):
    case_id = case['case_id']
    try:
        s, p, binding = prepare(case['input'], case.get('parameters', {}))
        capability = request['capability']
        if capability in ('fixed-power', 'line-source'):
            args = BuriedArgs.model_validate(p).model_dump(mode='json')
        elif capability == 'electrothermal':
            _, checked = preflight(s, p)
            args = checked.model_dump(mode='json')
        else:
            raise ValueError('未知原生参考方法')
        prepared = {'scenario': s.model_dump(mode='json'), 'parameters': args, 'binding': binding}
        evidence = {'prepared_input_sha256': sha256(json.dumps(prepared, sort_keys=True, ensure_ascii=False, allow_nan=False).encode('utf-8')).hexdigest(),
                    'entity_binding': binding}
        if capability != 'line-source':
            check_mesh_geometry(s)
            for package in ('gmsh', 'scikit-fem', 'meshio'):
                metadata.version(package)
        if request['phase'] == 'check':
            return {'case_id': case_id, 'status': 'succeeded', 'results': [], 'artifacts': [], 'evidence': evidence}
        folder = job / 'output' / case_id
        folder.mkdir()
        os.chdir(folder)
        recipe = prepare_study({'id': 'input-snapshot', 'revision': 1, 'scenario': s.model_dump()}).package.geometry_recipe.model_dump(mode='json')
        if capability == 'line-source':
            own, matrix = internal_resistance(recipe, s, args), soil_matrix(s, s.cable.radii_mm()[-1]/1000)
            powers = args['conductor_powers_w_m']
            temps = [s.installation.ambient_temperature_c + powers[i]*own + sum(matrix[i][j]*powers[j] for j in range(3)) for i in range(3)]
            payload = {'files': [], 'summary': {'conductor_max_temperatures_c': temps, 'soil_matrix': matrix, 'internal_resistance': own},
                       'warnings': ['半无限均匀土壤线源加同心圆柱内部热阻；不是有限计算域 FEM。']}
        else:
            handler = buried_reference if capability == 'fixed-power' else electrothermal_reference
            payload = handler(recipe, s.model_dump(mode='json'), args)
        results = quantities(payload['summary'], capability, args, binding)
        payload['entity_binding'] = binding
        files = []
        for name in payload['files']:
            file = folder / name
            if not file.resolve().is_relative_to(folder.resolve()) or file.stat().st_size > 16*1024*1024:
                raise ValueError('原生工件路径或大小越界')
            data = file.read_bytes()
            files.append({'name': name, 'sha256': sha256(data).hexdigest(), 'bytes_base64': base64.b64encode(data).decode('ascii')})
        payload['files'] = files
        artifact = f'output/{case_id}/bundle.json'
        (job / artifact).write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), 'utf-8')
        return {'case_id': case_id, 'status': 'succeeded', 'results': results,
                'artifacts': [{'path': artifact, 'type': 'x-cablesim.native-bundle'}],
                'warnings': [{'code': 'REFERENCE_ONLY', 'message': w} for w in payload['warnings']], 'evidence': evidence}
    except Exception as exc:
        return {'case_id': case_id, 'status': 'failed', 'error': {'code': type(exc).__name__, 'message': str(exc)}}
    finally:
        os.chdir(job)


def main():
    job = Path.cwd()
    request = json.loads((job / 'input/request.json').read_text('utf-8'))
    if request.get('protocol') != 'cablesim.run/2' or request.get('phase') not in ('check', 'run'):
        raise ValueError('不支持的协议')
    result = {'protocol': 'cablesim.run/2', 'cases': [run_case(request, c, job) for c in request['cases']],
              'environment': {'python': platform.python_version(), 'packages': {d.metadata['Name']: d.version for d in metadata.distributions() if d.metadata['Name']}}}
    (job / 'output/result.json').write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), 'utf-8')


if __name__ == '__main__':
    main()
