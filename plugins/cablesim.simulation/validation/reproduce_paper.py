"""复现E05平排护套回路解析子模型，与论文表3和中心磁场比较。"""
from dataclasses import asdict
from hashlib import sha256
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from backend.plugin_host import Executor


def main():
    fixture_path = Path(__file__).resolve().parents[1]/'src/cases/solid-bonding-flat.json'
    fixture = json.loads(fixture_path.read_text('utf-8'))
    scratch = ROOT/'.tmp/simulation-paper'
    scratch.mkdir(parents=True, exist_ok=True)
    run = Executor(jobs_root=scratch).run('cablesim.simulation', 'solid-bonding-flat', [
        {'case_id': 'paper-flat', 'input': fixture['input'], 'parameters': fixture['parameters']}])
    case = run.cases[0]
    if case.status != 'succeeded':
        raise RuntimeError(str(case.error))
    summary = case.artifacts['x-cablesim.simulation-bundle']['summary']
    rows = []
    for phase, actual, target, analytic in zip('ABC', summary['shield_current_rms_a'],
            fixture['targets']['table3_fem_shield_rms_a'], fixture['targets']['table3_analytic_shield_rms_a']):
        rows.append({'entity': phase, 'quantity': 'shield_rms_a', 'actual': actual,
                     'paper_fem': target, 'paper_analytic': analytic, 'difference': actual-target,
                     'relative_difference': (actual-target)/target})
    curve = summary['curve']
    centre = curve['b_rms_t'][curve['x_m'].index(0)]
    target = fixture['targets']['section5_flat_centre_fem_b_t']
    field = {'quantity': 'centre_b_rms_t', 'actual': centre, 'paper_fem': target,
             'difference': centre-target, 'relative_difference': (centre-target)/target}
    passed = (all(abs(r['relative_difference']) <= fixture['acceptance']['shield_relative_error_max'] for r in rows)
              and abs(field['relative_difference']) <= fixture['acceptance']['field_relative_error_max'])
    destination = ROOT/'.data/simulation/solid-bonding-flat'
    destination.mkdir(parents=True, exist_ok=True)
    report = {'reference': fixture['reference'], 'fixture_sha256': sha256(fixture_path.read_bytes()).hexdigest(),
              'manifest_sha256': sha256((Path(__file__).resolve().parents[1]/'plugin.json').read_bytes()).hexdigest(),
              'acceptance': fixture['acceptance'], 'passed': passed, 'rows': rows,
              'field_comparison': field, 'run': asdict(run), 'full_em_fem_reproduction': False}
    (destination/'report.json').write_text(json.dumps(report, ensure_ascii=False, allow_nan=False, indent=2), 'utf-8')
    (destination/'magnetic-profile.csv').write_text('x_m,b_rms_t\n'+'\n'.join(
        f'{x},{b}' for x, b in zip(curve['x_m'], curve['b_rms_t']))+'\n', 'utf-8')
    print(json.dumps({'passed': passed, 'rows': rows, 'field_comparison': field}, ensure_ascii=False))
    if not any(scratch.iterdir()):
        scratch.rmdir()
    if not passed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
