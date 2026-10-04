"""通过宿主执行器重放公开基准；工件写入忽略的 .data/simulation/。"""
from dataclasses import asdict
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from backend.plugin_host import Executor


def main():
    fixture_path = Path(__file__).resolve().parents[1]/'src/cases/insulated-wire.json'
    fixture = json.loads(fixture_path.read_text('utf-8'))
    destination = ROOT/'.data/simulation/insulated-wire'
    destination.mkdir(parents=True, exist_ok=True)
    scratch = ROOT/'.tmp/simulation-reproduction'
    scratch.mkdir(parents=True, exist_ok=True)
    cases = [{'case_id': 'mesh-'+str(i), 'input': fixture['input'], 'parameters': {'mesh_size_m': h}}
             for i, h in enumerate(fixture['mesh_sizes_m'])]
    run = Executor(jobs_root=scratch).run('cablesim.simulation', 'insulated-wire', cases)
    rows = []
    for case in run.cases:
        if case.status != 'succeeded':
            raise RuntimeError(str(case.error))
        artifact = case.artifacts['x-cablesim.simulation-bundle']
        row = dict(artifact['summary'])
        row['centre_error_k'] = row['centre_rise_k']-row['exact_centre_rise_k']
        row['centre_relative_error'] = row['centre_error_k']/row['exact_centre_rise_k']
        rows.append(row)
    criteria = fixture['acceptance']
    passed = (abs(rows[-1]['centre_relative_error']) <= criteria['finest_centre_relative_error_max']
              and rows[-1]['energy_relative_residual'] <= criteria['finest_energy_relative_residual_max']
              and all(b['l2_error_k_m'] < a['l2_error_k_m'] for a, b in zip(rows, rows[1:])))
    manifest = Path(__file__).resolve().parents[1]/'plugin.json'
    report = {'reference': fixture['reference'], 'fixture_sha256': sha256(fixture_path.read_bytes()).hexdigest(),
              'source_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip(),
              'manifest_sha256': sha256(manifest.read_bytes()).hexdigest(),
              'uncommitted_plugin': bool(subprocess.check_output(['git', 'status', '--porcelain', '--',
                                          'plugins/cablesim.simulation'], cwd=ROOT).strip()),
              'acceptance': criteria, 'passed': passed, 'rows': rows, 'run': asdict(run)}
    (destination/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), 'utf-8')
    lines = ['mesh_size_m,nodes,elements,centre_rise_k,exact_centre_rise_k,centre_error_k,centre_relative_error,l2_error_k_m,energy_relative_residual']
    keys = lines[0].split(',')
    lines.extend(','.join(str(row[key]) for key in keys) for row in rows)
    (destination/'convergence.csv').write_text('\n'.join(lines)+'\n', 'utf-8')
    print(json.dumps({'passed': passed, 'rows': rows, 'report': str(destination/'report.json')}, ensure_ascii=False))
    if not any(scratch.iterdir()):
        scratch.rmdir()
    if not passed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
