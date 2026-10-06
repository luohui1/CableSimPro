"""cablesim.run/2 entry point of the thermal-network plugin.

The host starts `python -I main.py` with the job directory as cwd. This program reads
input/request.json and writes output/result.json plus the artifacts it declares. It never
touches the project database and knows nothing about the host.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[4]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # -I drops cwd/PYTHONPATH; add our own src only

import json
from hashlib import sha256
import platform
from math import isfinite

import numpy as np
from pydantic import ValidationError

from backend.schemas import Scenario
from cablesim_thermal_network.domain import prepare
from cablesim_thermal_network.network import MODEL_VERSION, ModelError, PHASES, ThermalNetwork, calculate

PROTOCOL = 'cablesim.run/2'


def kelvin(celsius: float) -> float:
    return celsius + 273.15


def goal_checks(case, scenario, result):
    """Evaluate the saved research goals, not product-standard compliance."""
    target = case.get('parameters', {}).get('target_current_a', scenario.operating_current_a)
    if isinstance(target, bool) or not isinstance(target, (int, float)) or not isfinite(target) or target < 0:
        raise ValueError('目标电流必须是非负有限数值。')
    limit = kelvin(scenario.cable.max_temperature_c)
    operating = result['operating']
    circuit = case['input'].get('circuits', [{}])[0]
    phases = [c['phase'] for c in circuit.get('cables', [])] or list(PHASES)
    hottest = None if operating is None else int(np.argmax(operating['temperatures_c']))
    actual = None if hottest is None else kelvin(operating['temperatures_c'][hottest])
    ampacity = result['summary']['ampacity_a']
    return [
        {'id': 'research.current', 'rule_version': 'thermal-network-goals/1', 'key': 'ampacity',
         'condition': 'rating', 'actual': ampacity, 'target': float(target), 'unit': 'A',
         'margin': ampacity-target, 'verdict': 'satisfied' if ampacity >= target else 'not_satisfied',
         'margin_percent': None if target == 0 else (ampacity-target)/target*100,
         'source': '研究目标电流' if 'target_current_a' in case.get('parameters', {}) else '共享负荷工况'},
        {'id': 'research.temperature', 'rule_version': 'thermal-network-goals/1', 'key': 'conductor_temperature',
         'condition': 'operating', 'actual': actual, 'target': limit, 'unit': 'K',
         'margin': None if actual is None else limit-actual,
         'verdict': 'unavailable' if actual is None else 'satisfied' if actual <= limit else 'not_satisfied',
         'phase': None if hottest is None else phases[hottest], 'current_a': scenario.operating_current_a,
         'source': '共享负荷与导体温限', 'reason': result.get('operating_error') if actual is None else None},
    ]


def steady_rating(case: dict, out: Path) -> dict:
    scenario = prepare(case['input'], case.get('parameters', {}))
    include_field = bool(case.get('parameters', {}).get('include_field', False))
    result = calculate(scenario, include_field=include_field)
    result['goal_checks'] = goal_checks(case, scenario, result)
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


CAPABILITIES = {'steady-rating': steady_rating}


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
    from cablesim_sdk.parameter_units import decode_request
    request = decode_request(request, Path(__file__).resolve().parents[2]/'plugin.json')
    if request.get('protocol') != PROTOCOL or request.get('phase') not in ('run', 'check'):
        raise SystemExit('unsupported protocol or phase')
    handler = CAPABILITIES[request['capability']]
    if request['phase'] == 'check':
        def handler(case, out):
            prepare(case['input'], case.get('parameters', {}))
            return {'results': [], 'artifacts': []}
    out = job / 'output'
    cases = [run_case(handler, case, out) for case in request['cases']]
    result = {'protocol': PROTOCOL, 'cases': cases,
              'environment': {'python': platform.python_version(), 'packages': {'numpy': np.__version__},
                              'method': MODEL_VERSION}}
    from cablesim_sdk.result_answers import attach_witnesses
    attach_witnesses(request,result,Path(__file__).resolve().parents[2]/'plugin.json')
    (out / 'result.json').write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), 'utf-8')
    return 0


if __name__ == '__main__':
    sys.exit(main())
