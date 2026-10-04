"""论文护套子模型的真实传输和物理拒算；不需gmsh。"""
import json
from pathlib import Path
import pytest
from backend.plugin_host import Executor

FIXTURE = Path(__file__).resolve().parents[1]/'plugins/cablesim.simulation/src/cases/solid-bonding-flat.json'


def test_published_flat_shield_currents_and_field(tmp_path):
    f = json.loads(FIXTURE.read_text('utf-8'))
    case = {'case_id': 'flat', 'input': f['input'], 'parameters': f['parameters']}
    host = Executor(jobs_root=tmp_path)
    checked = host.check('cablesim.simulation', 'solid-bonding-flat', [case]).cases[0]
    assert checked.status == 'succeeded' and not checked.results and not checked.artifacts
    result = host.run('cablesim.simulation', 'solid-bonding-flat', [case]).cases[0]
    assert result.status == 'succeeded', result.error
    s = result.artifacts['x-cablesim.simulation-bundle']['summary']
    assert s['shield_current_rms_a'] == pytest.approx(f['targets']['table3_fem_shield_rms_a'], rel=.005)
    assert s['shield_current_sum_abs_a'] < 1e-10
    assert s['circuit_residual_v_m'] < 1e-10
    assert s['curve']['b_rms_t'][4] == pytest.approx(f['targets']['section5_flat_centre_fem_b_t'], rel=.01)
    assert all(r['unit'] == 'A' for r in result.results)


def test_paper_missing_shield_and_unapproved_assumptions_rejected(tmp_path):
    f = json.loads(FIXTURE.read_text('utf-8'))
    missing, extra = dict(f['input']), dict(f['input'], bonding='single_point')
    del missing['shield_temperature_c']
    cases = [{'case_id': name, 'input': value, 'parameters': f['parameters']}
             for name, value in [('missing', missing), ('unsupported', extra)]]
    results = Executor(jobs_root=tmp_path).run('cablesim.simulation', 'solid-bonding-flat', cases).cases
    assert all(c.status == 'failed' and not c.results and not c.artifacts for c in results)
