"""cablesim.run/2 entry point of the IEC 60287 plugin (started as `python -I main.py`)."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # -I drops cwd/PYTHONPATH; add our own src only

import json
from hashlib import sha256
import platform
from math import isfinite

from pydantic import ValidationError

from cablesim_iec60287.inputs import Rating
from cablesim_iec60287.domain import prepare
from cablesim_iec60287.method import METHOD_VERSION, RatingRefused, rate
from cablesim_iec60287.comparison import decompose

PROTOCOL = 'cablesim.run/2'
PHASES = ('A', 'B', 'C')


def steady_rating(case: dict, out: Path) -> dict:
    rating = prepare(case['input'], case.get('parameters', {}))
    result = rate(rating)
    last = result.history[-1]
    wd = result.electrical.dielectric_loss_w_m
    cables = [f'cable/c1-{p}' for p in PHASES]
    results = [{'key': 'ampacity', 'type': 'quantity', 'entity': 'circuit/c1', 'status': 'available',
                'value': result.ampacity_a, 'unit': 'A'}]
    # Three equally loaded cables in touching trefoil: one value applies to every phase.
    per_cable = [
        ('conductor_temperature', rating.max_conductor_temperature_c + 273.15, 'K'),
        ('sheath_temperature', last.sheath_temperature_c + 273.15, 'K'),
        ('surface_temperature', last.cable_surface_temperature_c + 273.15, 'K'),
        ('losses.conductor', last.conductor_loss_w_m, 'W/m'),
        ('losses.sheath', last.sheath_loss_w_m, 'W/m'),
        ('losses.dielectric', wd, 'W/m'),
        ('losses.total', last.conductor_loss_w_m + last.sheath_loss_w_m + wd, 'W/m'),
        ('loss_factor.sheath', last.loss.total, '1'),
        ('ac_resistance', result.electrical.r_ac_max_ohm_m, 'Ω/m'),
        ('capacitance', result.electrical.capacitance_f_m, 'F/m'),
        ('thermal_resistance.insulation', result.t1_k_m_w, 'K·m/W'),
        ('thermal_resistance.oversheath', result.t3_k_m_w, 'K·m/W'),
        ('thermal_resistance.external', last.t4_k_m_w, 'K·m/W'),
    ]
    for entity in cables:
        for key, value, unit in per_cable:
            results.append({'key': key, 'type': 'quantity', 'entity': entity, 'status': 'available', 'value': value, 'unit': unit})
    artifact = f"output/{case['case_id']}.trace.json"
    payload = result.as_dict()
    payload['rating_components'] = {
        'schema': 'cablesim.rating-components/1', 'phase': '三相等效',
        'ampacity_a': result.ampacity_a,
        'temperature_headroom_k': rating.max_conductor_temperature_c-rating.installation.ambient_temperature_c,
        'ac_resistance_ohm_m': result.electrical.r_ac_max_ohm_m,
        'lambda1': last.loss.total, 'lambda2': 0.0,
        't1_k_m_w': result.t1_k_m_w, 't2_k_m_w': 0.0,
        'metal_k_m_w': 0.0, 't3_k_m_w': result.t3_k_m_w,
        't4_k_m_w': last.t4_k_m_w,
        'dielectric_rise_k': wd * (0.5 * result.t1_k_m_w + result.t3_k_m_w + last.t4_k_m_w),
        'dielectric_loss_w_m': wd, 'temperature_c': rating.max_conductor_temperature_c,
        'notes': 'T4 为 IEC 品字形外部热阻；λ1 为已收敛护套损耗因子；无铠装，T2/λ2 为零。',
    }
    context = case.get('comparison', {})
    reference = context.get('artifacts', {}).get('x-cablesim.thermal-network-rating', {}).get('rating_components')
    if reference:
        try:
            payload['rating_attribution'] = {**decompose(reference, payload['rating_components']),
                                           'source': context.get('source')}
        except (ValueError, KeyError, TypeError) as exc:
            payload['rating_attribution'] = {'status': 'unavailable', 'reason': str(exc)}
    domain = case['input'].get('schema_version') == 'cablesim.domain/1'
    load = case['input']['load_cases'][0]['currents'][case['input']['circuits'][0]['id']] if domain else None
    target = case.get('parameters', {}).get('target_current_a', load)
    if target is not None and (isinstance(target, bool) or not isinstance(target, (int, float)) or not isfinite(target) or target < 0):
        raise ValueError('目标电流必须是非负有限数值。')
    payload['goal_checks'] = [{
        'id': 'research.current', 'rule_version': 'iec60287-goals/1', 'key': 'ampacity', 'condition': 'rating',
        'actual': result.ampacity_a, 'target': target, 'unit': 'A',
        'margin': None if target is None else result.ampacity_a-target,
        'margin_percent': None if not target else (result.ampacity_a-target)/target*100,
        'verdict': 'unavailable' if target is None else 'satisfied' if result.ampacity_a >= target else 'not_satisfied',
        'source': '研究目标电流' if 'target_current_a' in case.get('parameters', {}) else '共享负荷工况',
        'reason': '尚未填写负荷或目标电流。' if target is None else None,
    }, {'id': 'research.temperature', 'rule_version': 'iec60287-goals/1', 'key': 'conductor_temperature',
        'condition': 'operating', 'actual': None, 'target': rating.max_conductor_temperature_c+273.15,
        'unit': 'K', 'margin': None, 'verdict': 'unavailable', 'source': '共享导体温限',
        'reason': '本 IEC 稳态子集未提供给定电流下的运行温度。'}]
    (out / Path(artifact).name).write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), 'utf-8')
    return {'results': results, 'artifacts': [{'path': artifact, 'type': 'x-cablesim.iec60287-trace'}],
            'warnings': [{'code': 'SCOPE', 'message': m} for m in result.limitations],
            'evidence': {'iterations': result.iterations, 'decisions': result.decisions}}


CAPABILITIES = {'steady-rating': steady_rating}


def run_case(handler, case: dict, out: Path) -> dict:
    base = {'case_id': case['case_id']}
    try:
        result = handler(case, out)
        for r in result.get('results', []):
            r['case'] = 'rating'
        if case['input'].get('schema_version') == 'cablesim.domain/1':
            circuit = case['input']['circuits'][0]
            entities = {'circuit/c1': circuit['id'], **{f'cable/c1-{p}': c['id'] for p,c in zip('ABC',circuit['cables'])}}
            for r in result.get('results', []):
                r['entity'] = entities.get(r['entity'], r['entity'])
        prepared = prepare(case['input'], case.get('parameters', {})).model_dump(mode='json')
        result.setdefault('evidence', {})['prepared_input_sha256'] = sha256(json.dumps(prepared, sort_keys=True, ensure_ascii=False, allow_nan=False).encode('utf-8')).hexdigest()
        return {**base, 'status': 'succeeded', **result}
    except ValidationError as exc:
        return {**base, 'status': 'failed', 'error': {'code': 'INPUT_INVALID', 'message': '；'.join(e['msg'] for e in exc.errors())}}
    except RatingRefused as exc:
        return {**base, 'status': 'failed', 'error': {'code': exc.code, 'message': str(exc)}}
    except (ValueError, KeyError, TypeError, StopIteration) as exc:
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
            return {'results': [], 'artifacts': []}
    out = job / 'output'
    cases = [run_case(handler, case, out) for case in request['cases']]
    result = {'protocol': PROTOCOL, 'cases': cases,
              'environment': {'python': platform.python_version(), 'method': METHOD_VERSION}}
    (out / 'result.json').write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), 'utf-8')
    return 0


if __name__ == '__main__':
    sys.exit(main())
