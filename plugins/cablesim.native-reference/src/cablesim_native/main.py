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
from backend.plugin_host.buried_contract import BuriedArgs
from backend.plugin_host.electrothermal_contract import preflight
from cablesim_native.buried import buried_reference, check_mesh_geometry
from cablesim_native.electrothermal import electrothermal_reference
from cablesim_native.line_source import internal_resistance, soil_matrix, run_line_source
from cablesim_native.domain import prepare
from backend.plugin_host.native_arguments import ARGUMENTS, SOURCE_FILES
from cablesim_native.adapters import HANDLERS

COMMANDS={'cable-step':'cadquery.cable-step','section-mesh':'gmsh.cable-section',
          'mesh-vtu':'meshio.to-vtu','radial-thermal':'skfem.radial-thermal','field-summary':'pyvista.field-summary'}


def source_file(arguments,capability,folder):
    name,expected=SOURCE_FILES[capability]
    if arguments['source_metadata']['method']['plugin_id']!='cablesim.native-reference' or arguments['source_metadata']['method']['capability']!=expected:
        raise ValueError('原生来源能力不匹配：'+expected)
    files=arguments['source_bundle'].get('files',[])
    item=next((f for f in files if f['name']==name),None)
    if item is None:raise ValueError('来源工件缺少 '+name)
    data=base64.b64decode(item['bytes_base64'],validate=True)
    if len(data)>16*1024*1024 or sha256(data).hexdigest()!=item['sha256']:raise ValueError('来源文件哈希或大小无效')
    if folder is not None:
        (folder/'input').mkdir(exist_ok=True)
        (folder/'input'/name).write_bytes(data)


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
        p.pop('native_source_reference',None)
        if capability in ('fixed-power', 'line-source'):
            args = BuriedArgs.model_validate(p).model_dump(mode='json')
        elif capability == 'electrothermal':
            _, checked = preflight(s, p)
            args = checked.model_dump(mode='json')
        elif capability in ARGUMENTS:
            args=ARGUMENTS[capability].model_validate(p).model_dump(mode='json')
            if capability in SOURCE_FILES:source_file(args,capability,None)
        else:
            raise ValueError('未知原生参考方法')
        prepared = {'scenario': s.model_dump(mode='json'), 'parameters': args, 'binding': binding}
        evidence = {'prepared_input_sha256': sha256(json.dumps(prepared, sort_keys=True, ensure_ascii=False, allow_nan=False).encode('utf-8')).hexdigest(),
                    'entity_binding': binding}
        if capability in ('fixed-power','electrothermal'):
            check_mesh_geometry(s)
            for package in ('gmsh', 'scikit-fem', 'meshio'):
                metadata.version(package)
        for package in {'cable-step':['cadquery','cadquery-ocp'], 'section-mesh':['gmsh'],
                        'mesh-vtu':['meshio'], 'radial-thermal':['scikit-fem','meshio'],
                        'field-summary':['pyvista']}.get(capability,[]):
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
        elif capability=='line-source-crosscheck':
            source_file(args,capability,folder)
            meta=args['source_metadata'];method=meta['method']
            context={'job_id':meta['run_id'],'plugin':{'plugin_id':method['plugin_id'],'version':method['version'],'release_sha256':method['release_digest']},
                     'command':'fixed-power','project_revision':meta['workspace_revision'],
                     'arguments':{k:v for k,v in meta['parameters'].items() if k in BuriedArgs.model_fields}}
            payload=run_line_source(recipe,s.model_dump(mode='json'),context)
        elif capability in COMMANDS:
            if capability in SOURCE_FILES:source_file(args,capability,folder)
            payload=HANDLERS[COMMANDS[capability]](recipe,s.model_dump(mode='json'),args)
        else:
            handler = buried_reference if capability == 'fixed-power' else electrothermal_reference
            payload = handler(recipe, s.model_dump(mode='json'), args)
        results = ([{'key':'x-cablesim.native-artifact-count','type':'quantity','entity':binding['circuit'],'status':'available','value':len(payload['files']),'unit':'1'}]
                   if capability in COMMANDS else [{'key':'x-cablesim.native-difference','type':'quantity','entity':binding['circuit'],'status':'available','value':payload['summary']['maximum_absolute_difference_k'],'unit':'K'}]
                   if capability=='line-source-crosscheck' else quantities(payload['summary'], capability, args, binding))
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
    from cablesim_sdk.parameter_units import decode_request
    request = decode_request(request, Path(__file__).resolve().parents[2]/'plugin.json')
    if request.get('protocol') != 'cablesim.run/2' or request.get('phase') not in ('check', 'run'):
        raise ValueError('不支持的协议')
    result = {'protocol': 'cablesim.run/2', 'cases': [run_case(request, c, job) for c in request['cases']],
              'environment': {'python': platform.python_version(), 'packages': {d.metadata['Name']: d.version for d in metadata.distributions() if d.metadata['Name']}}}
    from cablesim_sdk.result_answers import attach_witnesses
    attach_witnesses(request,result,Path(__file__).resolve().parents[2]/'plugin.json')
    (job / 'output/result.json').write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), 'utf-8')


if __name__ == '__main__':
    main()
