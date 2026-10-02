"""cablesim.run/2 entry point of the thermal-network plugin.

The host starts `python -I main.py` with the job directory as cwd. This program reads
input/request.json and writes output/result.json plus the artifacts it declares. It never
touches the project database and knows nothing about the host.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # -I drops cwd/PYTHONPATH; add our own src only

import json
from hashlib import sha256
import platform

import numpy as np
from pydantic import ValidationError

from cablesim_thermal_network.inputs import Scenario
from cablesim_thermal_network.domain import prepare
from cablesim_thermal_network.network import MODEL_VERSION, ModelError, PHASES, ThermalNetwork, calculate

PROTOCOL = 'cablesim.run/2'


def kelvin(celsius: float) -> float:
    return celsius + 273.15


def steady_rating(case: dict, out: Path) -> dict:
    scenario = prepare(case['input'], case.get('parameters', {}))
    include_field = bool(case.get('parameters', {}).get('include_field', False))
    result = calculate(scenario, include_field=include_field)
    artifact = f"output/{case['case_id']}.rating.json"
    (out / Path(artifact).name).write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), 'utf-8')
    results = [{'key': 'ampacity', 'type': 'quantity', 'entity': 'circuit/c1', 'status': 'available',
                'value': result['summary']['ampacity_a'], 'unit': 'A'}]
    operating = result['operating']
    for i, phase in enumerate(PHASES):
        entity = f'cable/c1-{phase}'
        if operating is None:
            results.append({'key': 'conductor_temperature', 'type': 'quantity', 'entity': entity, 'status': 'unavailable', 'unit': 'K',
                            'reason': {'code': 'OPERATING_POINT_UNSTABLE', 'message': result['operating_error']}})
        else:
            results.append({'key': 'conductor_temperature', 'type': 'quantity', 'entity': entity, 'status': 'available',
                            'value': kelvin(operating['temperatures_c'][i]), 'unit': 'K'})
        results.append({'key': 'losses.dielectric', 'type': 'quantity', 'entity': entity, 'status': 'available',
                        'value': result['thermal']['dielectric_loss_w_m'], 'unit': 'W/m'})
    return {'results': results, 'artifacts': [{'path': artifact, 'type': 'x-cablesim.thermal-network-rating'}],
            'warnings': [{'code': 'SIMPLIFIED_METHOD', 'message': w} for w in result['warnings'][:1]]}


def network_properties(case: dict, out: Path) -> dict:
    scenario = prepare(case['input'], case.get('parameters', {}))
    current = case.get('parameters', {}).get('current_a')
    net = ThermalNetwork(scenario)
    properties = {'radii_m': net.radii.tolist(), 'positions_m': net.positions.tolist(),
                  'layer_resistances_k_m_w': net.t.tolist(), 'soil_matrix_k_m_w': net.g.tolist(),
                  'r20_ohm_m': net.r20, 'r20_ac_ohm_m': net.r20ac, 'alpha_per_k': net.alpha,
                  'dielectric_loss_w_m': net.wd, 'current_a': current, 'total_losses_w_m': None}
    if current is not None:
        properties['total_losses_w_m'] = net.state(float(current))['total_losses_w_m']
    artifact = f"output/{case['case_id']}.properties.json"
    (out / Path(artifact).name).write_text(json.dumps(properties, allow_nan=False), 'utf-8')
    results = [{'key': 'losses.dielectric', 'type': 'quantity', 'entity': f'cable/c1-{p}', 'status': 'available',
                'value': net.wd, 'unit': 'W/m'} for p in PHASES]
    return {'results': results, 'artifacts': [{'path': artifact, 'type': 'x-cablesim.thermal-network-properties'}],
            'warnings': []}


def reference_study(case, out, *, vertical=False):
    from cablesim_thermal_network.vertical import Vertical, vertical_study
    from cablesim_thermal_network.fields import compute_fields
    scenario = prepare(case['input'], case.get('parameters', {}))
    params = case.get('parameters', {})
    if vertical:
        result = vertical_study(scenario.cable, Vertical.model_validate(params['configuration']), params['current'])
        key, value, unit, atype = 'ampacity', result['ampacity_a'], 'A', 'x-cablesim.vertical'
    else:
        if params['resolution'] not in (65, 129):
            raise ValueError('不支持的场网格分辨率')
        result = compute_fields(scenario, params['kind'], params['resolution'])
        key, value, unit, atype = 'x-cablesim.field-maximum', result['range'][1], result['unit'], 'x-cablesim.field'
    artifact = f"output/{case['case_id']}.reference.json"
    (out / Path(artifact).name).write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), 'utf-8')
    return {'results': [{'key': key, 'type': 'quantity', 'entity': 'circuit/c1', 'status': 'available', 'value': value, 'unit': unit}],
            'artifacts': [{'path': artifact, 'type': atype}]}


def vertical_rating(case, out):
    return reference_study(case, out, vertical=True)


CAPABILITIES = {'steady-rating': steady_rating, 'network-properties': network_properties,
                'vertical-rating': vertical_rating, 'field-analysis': reference_study}


def run_case(handler, case: dict, out: Path) -> dict:
    base = {'case_id': case['case_id']}
    try:
        result = handler(case, out)
        for r in result.get('results', []):
            r['case'] = 'rating' if r['key'] == 'ampacity' else 'operating'
        if case['input'].get('schema_version') == 'cablesim.domain/1':
            circuit = case['input']['circuits'][0]
            entities = {'circuit/c1': circuit['id'], **{f'cable/c1-{p}': c['id'] for p,c in zip('ABC',circuit['cables'])}}
            for r in result.get('results', []):
                r['entity'] = entities.get(r['entity'], r['entity'])
        prepared = prepare(case['input'], case.get('parameters', {})).model_dump(mode='json')
        result['evidence'] = {'prepared_input_sha256': sha256(json.dumps(prepared, sort_keys=True, ensure_ascii=False, allow_nan=False).encode('utf-8')).hexdigest()}
        return {**base, 'status': 'succeeded', **result}
    except ValidationError as exc:
        message = '；'.join(e['msg'] for e in exc.errors())
        return {**base, 'status': 'failed', 'error': {'code': 'INPUT_INVALID', 'message': message}}
    except ModelError as exc:
        return {**base, 'status': 'failed', 'error': {'code': 'MODEL_ERROR', 'message': str(exc)}}
    except (ValueError, KeyError, TypeError) as exc:
        return {**base, 'status': 'not_applicable', 'error': {'code': 'DOMAIN_NOT_SUPPORTED', 'message': str(exc)}}


def main() -> int:
    job = Path.cwd()
    request = json.loads((job / 'input/request.json').read_text('utf-8'))
    if request.get('protocol') != PROTOCOL or request.get('phase') not in ('run', 'check'):
        raise SystemExit('unsupported protocol or phase')
    handler = CAPABILITIES[request['capability']]
    if request['phase'] == 'check':
        def handler(case, out):
            prepare(case['input'], case.get('parameters', {}))
            if request['capability'] == 'vertical-rating':
                from cablesim_thermal_network.vertical import Vertical
                Vertical.model_validate(case['parameters']['configuration'])
                if not 0 <= case['parameters']['current'] <= 5000:
                    raise ValueError('竖向电流必须在 0–5000 A 范围内')
            if request['capability'] == 'field-analysis':
                if case['parameters'].get('kind') not in ('thermal_fd', 'electric', 'magnetic') or case['parameters'].get('resolution') not in (65,129):
                    raise ValueError('场类型或分辨率不支持')
            return {'results': [], 'artifacts': []}
    out = job / 'output'
    cases = [run_case(handler, case, out) for case in request['cases']]
    result = {'protocol': PROTOCOL, 'cases': cases,
              'environment': {'python': platform.python_version(), 'packages': {'numpy': np.__version__},
                              'method': MODEL_VERSION}}
    (out / 'result.json').write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), 'utf-8')
    return 0


if __name__ == '__main__':
    sys.exit(main())
