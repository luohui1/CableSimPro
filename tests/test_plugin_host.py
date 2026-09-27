"""Generic plugin host (cablesim.plugin/2 minimal protocol): real subprocess runs and fail-closed checks.

Fault plugins are written to a temporary plugins/ root and sealed with the same tool the
maintainers use, so the only thing each test changes is the behaviour under test.
"""
from __future__ import annotations

import json
from pathlib import Path
import textwrap

import pytest

from backend.plugin_host import Executor, PluginHostError, Registry
from backend.plugin_host.registry import seal
from backend.schemas import Scenario

SYNTHETIC_IEC = {  # invented 12/20 kV-class cable, not manufacturer data
    'frequency_hz': 50, 'phase_voltage_v': 12000, 'max_conductor_temperature_c': 90,
    'conductor': {'diameter_m': 0.0185, 'r20_ohm_m': 7.54e-5, 'alpha20_per_k': 0.00393, 'ks': 1, 'kp': 1},
    'insulation': {'inner_screen_thickness_m': 0.0006, 'thickness_m': 0.0055, 'outer_screen_thickness_m': 0.0007,
                   'relative_permittivity': 2.5, 'tan_delta': 0.001, 'inner_screen_rho_k_m_w': 2.5,
                   'rho_k_m_w': 3.5, 'outer_screen_rho_k_m_w': 2.5},
    'sheath': {'thickness_m': 0.0008, 'resistivity20_ohm_m': 2.84e-8, 'alpha20_per_k': 0.00403},
    'oversheath': {'thickness_m': 0.0025, 'rho_k_m_w': 3.5},
    'installation': {'environment': 'direct_buried', 'depth_m': 0.8, 'soil_rho_k_m_w': 1.0,
                     'ambient_temperature_c': 20, 't4_form': 'simplified', 'duct': None},
    'bonding': {'scheme': 'both_ends', 'eddy': 'ignored'},
    'solver': {'initial_sheath_temperature_c': 70},
}


@pytest.fixture(scope='module')
def host():
    return Executor()


def test_first_party_plugins_are_discovered_and_sealed():
    registry = Registry()
    assert {'cablesim.thermal-network', 'cablesim.iec60287'} <= set(registry.plugins)
    for plugin in registry.plugins.values():
        plugin.verify()


def test_iec60287_runs_through_the_host_with_typed_results(host):
    from cablesim_iec60287 import Rating, rate
    direct = rate(Rating.model_validate(SYNTHETIC_IEC))
    run = host.run('cablesim.iec60287', 'steady-rating', [{'case_id': 'base', 'input': SYNTHETIC_IEC}])
    case = run.cases[0]
    assert case.status == 'succeeded'
    # Same number in-process and through the executor: the transport adds nothing.
    assert case.value('ampacity', 'circuit/c1') == direct.ampacity_a
    assert case.value('conductor_temperature', 'cable/c1-B') == pytest.approx(363.15)
    trace = case.artifacts['x-cablesim.iec60287-trace']
    assert trace['method_version'] == '0.1.0' and trace['iterations'] == direct.iterations
    assert len(case.artifact_digests['x-cablesim.iec60287-trace']) == 64
    assert run.method_version.endswith('/0.1.0') and len(run.request_sha256) == 64


def test_refusal_is_a_failed_case_with_its_code_not_a_number(host):
    refused = json.loads(json.dumps(SYNTHETIC_IEC))
    refused['installation']['depth_m'] = 0.03
    invalid = json.loads(json.dumps(SYNTHETIC_IEC))
    del invalid['conductor']['ks']
    run = host.run('cablesim.iec60287', 'steady-rating',
                   [{'case_id': 'ok', 'input': SYNTHETIC_IEC}, {'case_id': 'shallow', 'input': refused},
                    {'case_id': 'no-ks', 'input': invalid}])
    ok, shallow, no_ks = run.cases
    assert ok.status == 'succeeded'
    assert shallow.status == 'failed' and shallow.error['code'] == 'DEPTH_TOO_SMALL' and shallow.results == []
    assert no_ks.status == 'failed' and no_ks.error['code'] == 'INPUT_INVALID'


def test_thermal_network_unstable_operating_point_is_reported_unavailable(host):
    s = Scenario().model_dump(mode='json')
    s['operating_current_a'] = 3000
    case = host.run('cablesim.thermal-network', 'steady-rating', [{'case_id': 'hot', 'input': s}]).cases[0]
    assert case.status == 'succeeded'
    temps = [r for r in case.results if r['key'] == 'conductor_temperature']
    assert {r['status'] for r in temps} == {'unavailable'}
    assert all('value' not in r and r['reason']['code'] for r in temps)
    assert case.value('ampacity', 'circuit/c1') > 0


@pytest.mark.parametrize('plugin,capability,code', [
    ('cablesim.nothing', 'steady-rating', 'PLUGIN_UNKNOWN'),
    ('cablesim.iec60287', 'transient', 'CAPABILITY_UNKNOWN'),
])
def test_unknown_plugin_or_capability(host, plugin, capability, code):
    with pytest.raises(PluginHostError) as error:
        host.run(plugin, capability, [{'case_id': 'a', 'input': {}}])
    assert error.value.code == code


def test_duplicate_or_empty_cases_rejected(host):
    for cases in ([], [{'case_id': 'a', 'input': {}}, {'case_id': 'a', 'input': {}}]):
        with pytest.raises(PluginHostError) as error:
            host.run('cablesim.iec60287', 'steady-rating', cases)
        assert error.value.code == 'CASES_INVALID'


# ---- deliberately broken plugins -------------------------------------------------------------

MANIFEST = {
    'schema': 'cablesim.plugin/2', 'id': 'acme.fault', 'version': '1.0.0', 'name': 'fault',
    'publisher': {'id': 'acme', 'name': 'Acme'}, 'host_api': {'major': 2, 'min_minor': 0},
    'license': {'spdx': 'MIT', 'review_required': False}, 'platforms': ['linux-x64'],
    'runtime': {'kind': 'python', 'python': '>=3.11', 'entry': 'src/main.py'},
    'permissions': ['study.run'], 'dependencies': [],
    'resources': {'timeout_s': 5, 'memory_mb': 64, 'network': 'none'},
    'capabilities': [{'kind': 'method', 'id': 'run', 'title': 't', 'method_version': 'f/1', 'analysis': 'steady_state',
                      'input_schema': 'none', 'validation': {'level': 'unverified'}, 'limitations': ['test only'],
                      'outputs': [{'key': 'ampacity', 'type': 'quantity', 'per': 'circuit', 'required': True}]}],
    'files': [],
}
PRELUDE = 'import json, pathlib, sys, time\nout = pathlib.Path("output")\n'


def fault_host(tmp_path: Path, body: str, manifest_patch: dict | None = None) -> Executor:
    root = tmp_path / 'plugins'
    package = root / 'acme.fault'
    (package / 'src').mkdir(parents=True)
    (package / 'src/main.py').write_text(PRELUDE + textwrap.dedent(body), 'utf-8')
    manifest = {**MANIFEST, **(manifest_patch or {}), 'files': seal(package)}
    (package / 'plugin.json').write_text(json.dumps(manifest), 'utf-8')
    return Executor(Registry(root), jobs_root=tmp_path)


def result(cases) -> str:
    return 'out.joinpath("result.json").write_text(json.dumps({"protocol": "cablesim.run/2", "cases": %s}))\n' % cases


GOOD = '[{"case_id": "a", "status": "succeeded", "results": [{"key": "ampacity", "type": "quantity", "entity": "circuit/c1", "status": "available", "value": 500.0, "unit": "A"}]}]'


def run_fault(tmp_path, body, **patch):
    return fault_host(tmp_path, body, patch or None).run('acme.fault', 'run', [{'case_id': 'a', 'input': {}}])


def test_minimal_well_behaved_plugin_is_accepted(tmp_path):
    case = run_fault(tmp_path, result(GOOD)).cases[0]
    assert case.value('ampacity', 'circuit/c1') == 500.0


@pytest.mark.parametrize('name,body,code', [
    ('crash', 'raise RuntimeError("boom")\n', 'PLUGIN_CRASHED'),
    ('no result', 'pass\n', 'PLUGIN_CRASHED'),
    ('nonzero exit after writing', result(GOOD) + 'sys.exit(3)\n', 'PLUGIN_CRASHED'),
    ('hang', 'time.sleep(30)\n', 'TIMEOUT'),
    ('not json', 'out.joinpath("result.json").write_text("{")\n', 'OUTPUT_CONTRACT_VIOLATION'),
    ('NaN', result(GOOD.replace('500.0', 'float("nan")')), 'OUTPUT_CONTRACT_VIOLATION'),
    ('wrong unit', result(GOOD.replace('"A"', '"kA"')), 'OUTPUT_CONTRACT_VIOLATION'),
    ('undeclared key', result(GOOD.replace('"ampacity"', '"losses.total"')), 'OUTPUT_CONTRACT_VIOLATION'),
    ('missing required', result('[{"case_id": "a", "status": "succeeded", "results": []}]'), 'OUTPUT_CONTRACT_VIOLATION'),
    ('wrong case id', result(GOOD.replace('"case_id": "a"', '"case_id": "b"')), 'OUTPUT_CONTRACT_VIOLATION'),
    ('failed with number', result('[{"case_id": "a", "status": "failed", "error": {"code": "X", "message": "m"}, "results": [{"key": "ampacity"}]}]'), 'OUTPUT_CONTRACT_VIOLATION'),
    ('failed without code', result('[{"case_id": "a", "status": "failed", "error": {}}]'), 'OUTPUT_CONTRACT_VIOLATION'),
    ('unavailable with value', result(GOOD.replace('"status": "available", "value": 500.0', '"status": "unavailable", "value": 0, "reason": {"code": "R"}')), 'OUTPUT_CONTRACT_VIOLATION'),
    ('unavailable without reason', result(GOOD.replace('"status": "available", "value": 500.0, "unit": "A"', '"status": "unavailable"')), 'OUTPUT_CONTRACT_VIOLATION'),
])
def test_faulty_plugins_fail_closed(tmp_path, name, body, code):
    with pytest.raises(PluginHostError) as error:
        run_fault(tmp_path, body)
    assert error.value.code == code, name


def test_artifact_outside_output_or_undeclared_is_rejected(tmp_path):
    patch = {'permissions': ['study.run', 'artifact.write'],
             'capabilities': [{**MANIFEST['capabilities'][0], 'artifacts': [{'type': 'x-acme.trace', 'required': False}]}]}
    escape = GOOD.replace('"results"', '"artifacts": [{"type": "x-acme.trace", "path": "input/request.json"}], "results"')
    with pytest.raises(PluginHostError) as error:
        fault_host(tmp_path / 'a', result(escape), patch).run('acme.fault', 'run', [{'case_id': 'a', 'input': {}}])
    assert error.value.code == 'OUTPUT_CONTRACT_VIOLATION'
    undeclared = GOOD.replace('"results"', '"artifacts": [{"type": "x-acme.other", "path": "output/result.json"}], "results"')
    with pytest.raises(PluginHostError) as error:
        fault_host(tmp_path / 'b', result(undeclared), patch).run('acme.fault', 'run', [{'case_id': 'a', 'input': {}}])
    assert error.value.code == 'OUTPUT_CONTRACT_VIOLATION'


def test_plugin_gets_a_minimal_environment_and_its_own_job_directory(tmp_path, monkeypatch):
    monkeypatch.setenv('CABLESIM_SECRET_FOR_TEST', 'leak')
    body = ('import os\nassert "CABLESIM_SECRET_FOR_TEST" not in os.environ\n'
            'assert pathlib.Path("input/request.json").is_file()\n'
            'assert json.loads(pathlib.Path("input/request.json").read_text())["protocol"] == "cablesim.run/2"\n') + result(GOOD)
    assert run_fault(tmp_path, body).cases[0].status == 'succeeded'
    assert not any(tmp_path.glob('csp-job-*')), 'job directory must be removed afterwards'


def test_tampered_package_is_refused_before_it_runs(tmp_path):
    host = fault_host(tmp_path, result(GOOD))
    main = tmp_path / 'plugins/acme.fault/src/main.py'
    main.write_text(main.read_text('utf-8') + '# changed\n', 'utf-8')
    with pytest.raises(PluginHostError) as error:
        host.run('acme.fault', 'run', [{'case_id': 'a', 'input': {}}])
    assert error.value.code == 'PACKAGE_DIGEST_MISMATCH'
    (tmp_path / 'plugins/acme.fault/src/extra.py').write_text('x = 1\n', 'utf-8')
    with pytest.raises(PluginHostError) as error:
        Executor(Registry(tmp_path / 'plugins')).run('acme.fault', 'run', [{'case_id': 'a', 'input': {}}])
    assert error.value.code == 'PACKAGE_FILES_MISMATCH'


@pytest.mark.parametrize('patch,message', [
    ({'id': 'other.fault'}, '前缀'),
    ({'host_api': {'major': 3, 'min_minor': 0}}, '宿主插件 API'),
    ({'runtime': {'kind': 'executable', 'python': '', 'entry': 'src/main.py'}}, 'python'),
    ({'capabilities': [{**MANIFEST['capabilities'][0], 'outputs': [{'key': 'hotspot', 'type': 'quantity', 'per': 'cable', 'required': True}]}]}, '未登记的结果键'),
    ({'capabilities': [{**MANIFEST['capabilities'][0], 'validation': {'level': 'reference-benchmark', 'cases': []}}]}, '算例'),
])
def test_invalid_manifests_are_rejected_at_discovery(tmp_path, patch, message):
    with pytest.raises(Exception, match=message):
        fault_host(tmp_path, result(GOOD), patch)
