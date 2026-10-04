"""真实子进程求解、解析对照、网格收敛与零热源平移。"""
import json
from math import log
from pathlib import Path
import pytest
from backend.plugin_host import Executor

PACKAGE = Path(__file__).resolve().parents[1]/'plugins/cablesim.simulation'


def test_insulated_wire_public_benchmark(tmp_path):
    fixture = json.loads((PACKAGE/'src/cases/insulated-wire.json').read_text('utf-8'))
    cases = [{'case_id': f'mesh-{i}', 'input': fixture['input'], 'parameters': {'mesh_size_m': h}}
             for i, h in enumerate(fixture['mesh_sizes_m'])]
    host = Executor(jobs_root=tmp_path)
    preflight = host.check('cablesim.simulation', 'insulated-wire', cases)
    assert all(c.status == 'succeeded' and not c.results and not c.artifacts for c in preflight.cases)
    result = host.run('cablesim.simulation', 'insulated-wire', cases)
    expected = 20/42 + 20*log(1.5)/22 + 20/404  # 独立积分：外对流、绝缘、芯内导热
    rows = []
    for case in result.cases:
        assert case.status == 'succeeded', case.error
        bundle = case.artifacts['x-cablesim.simulation-bundle']
        row = bundle['summary']
        assert row['exact_centre_rise_k'] == pytest.approx(expected, abs=1e-12)
        assert row['energy_relative_residual'] < 1e-7
        assert case.results[0]['value'] == pytest.approx(row['centre_rise_k']+293.15)
        assert bundle['field']['temperature_unit'] == 'K'
        rows.append(row)
    assert abs(rows[-1]['centre_rise_k']/expected-1) < .005
    assert all(b['l2_error_k_m'] < a['l2_error_k_m'] for a, b in zip(rows, rows[1:]))


def test_zero_heat_and_missing_material_are_distinct(tmp_path):
    value = json.loads((PACKAGE/'src/cases/insulated-wire.json').read_text('utf-8'))['input']
    zero = dict(value, source_w_m3=0, ambient_k=310)
    missing = dict(value)
    del missing['core_k_w_m_k']
    run = Executor(jobs_root=tmp_path).run('cablesim.simulation', 'insulated-wire', [
        {'case_id': 'zero', 'input': zero, 'parameters': {'mesh_size_m': .3}},
        {'case_id': 'missing', 'input': missing, 'parameters': {'mesh_size_m': .3}}])
    good, bad = run.cases
    assert good.status == 'succeeded', good.error
    assert good.results[0]['value'] == pytest.approx(310)
    assert set(good.artifacts['x-cablesim.simulation-bundle']['field']['temperature']) == {310.0}
    assert bad.status == 'failed' and not bad.results and not bad.artifacts
