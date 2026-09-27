"""cablesim.run/2 entry point of the IEC 60287 plugin (started as `python -I main.py`)."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # -I drops cwd/PYTHONPATH; add our own src only

import json
import platform

from pydantic import ValidationError

from cablesim_iec60287.inputs import Rating
from cablesim_iec60287.method import METHOD_VERSION, RatingRefused, rate

PROTOCOL = 'cablesim.run/2'
PHASES = ('A', 'B', 'C')


def steady_rating(case: dict, out: Path) -> dict:
    rating = Rating.model_validate(case['input'])
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
    (out / Path(artifact).name).write_text(json.dumps(result.as_dict(), ensure_ascii=False, allow_nan=False), 'utf-8')
    return {'results': results, 'artifacts': [{'path': artifact, 'type': 'x-cablesim.iec60287-trace'}],
            'warnings': [{'code': 'SCOPE', 'message': m} for m in result.limitations],
            'evidence': {'iterations': result.iterations, 'decisions': result.decisions}}


CAPABILITIES = {'steady-rating': steady_rating}


def run_case(handler, case: dict, out: Path) -> dict:
    base = {'case_id': case['case_id']}
    try:
        return {**base, 'status': 'succeeded', **handler(case, out)}
    except ValidationError as exc:
        return {**base, 'status': 'failed', 'error': {'code': 'INPUT_INVALID', 'message': '；'.join(e['msg'] for e in exc.errors())}}
    except RatingRefused as exc:
        return {**base, 'status': 'failed', 'error': {'code': exc.code, 'message': str(exc)}}


def main() -> int:
    job = Path.cwd()
    request = json.loads((job / 'input/request.json').read_text('utf-8'))
    if request.get('protocol') != PROTOCOL or request.get('phase') != 'run':
        raise SystemExit('unsupported protocol or phase')
    handler = CAPABILITIES[request['capability']]
    out = job / 'output'
    cases = [run_case(handler, case, out) for case in request['cases']]
    result = {'protocol': PROTOCOL, 'cases': cases,
              'environment': {'python': platform.python_version(), 'method': METHOD_VERSION}}
    (out / 'result.json').write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), 'utf-8')
    return 0


if __name__ == '__main__':
    sys.exit(main())
