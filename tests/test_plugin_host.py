"""Generic plugin host (cablesim.plugin/2 minimal protocol): real subprocess runs and fail-closed checks.

Fault plugins are written to a temporary plugins/ root and sealed with the same tool the
maintainers use, so the only thing each test changes is the behaviour under test.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import textwrap
import time

import pytest

from backend.plugin_host import Executor, PluginHostError, Registry
from backend.plugin_host.registry import seal
from backend.plugin_host.executor import current_platform
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
        assert plugin.manifest.description
        assert plugin.manifest.icon == 'assets/icon.svg'
        assert plugin.manifest.host_api.min_minor == 1


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
    assert all(r['unit'] == 'K' and r['case'] == 'operating' for r in temps)
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
    'license': {'spdx': 'MIT', 'review_required': False}, 'platforms': [current_platform()],
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


def test_unrelated_broken_plugin_does_not_block_a_selected_method(tmp_path):
    host = fault_host(tmp_path, result(GOOD))
    broken = host.registry.root / 'other.broken'
    broken.mkdir()
    (broken / 'plugin.json').write_text('{', 'utf-8')
    assert host.run('acme.fault', 'run', [{'case_id': 'a', 'input': {}}]).cases[0].status == 'succeeded'


def test_unsupported_platform_is_rejected_before_process_start(tmp_path):
    with pytest.raises(PluginHostError) as error:
        run_fault(tmp_path, 'raise AssertionError("must not execute")', platforms=['unsupported-cpu'])
    assert error.value.code == 'PLATFORM_UNSUPPORTED'


def test_interpreter_platform_survives_a_minimal_windows_environment(monkeypatch):
    import backend.plugin_host.executor as executor
    monkeypatch.setattr(executor.sys, 'platform', 'win32')
    monkeypatch.setattr(executor.sysconfig, 'get_platform', lambda: 'win-amd64')
    monkeypatch.setattr(executor.platform, 'system', lambda: 'Windows')
    monkeypatch.setattr(executor.platform, 'machine', lambda: '')
    assert executor.current_platform() == 'windows-x64'


def test_host_contract_change_invalidates_the_plugin_seal(tmp_path):
    import shutil
    from backend.plugin_host.dependencies import host_dependencies
    source = Registry().get('cablesim.native-reference').directory
    directory = tmp_path / 'plugins' / source.name
    shutil.copytree(source, directory)
    for record in host_dependencies(source):
        target = tmp_path / record['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source.parent.parent / record['path'], target)
    plugin = Registry(tmp_path / 'plugins').get(source.name)
    plugin.verify()
    target = tmp_path / 'backend/schemas.py'
    target.write_bytes(target.read_bytes() + b'\n# modified host contract\n')
    with pytest.raises(PluginHostError) as error:
        plugin.verify()
    assert error.value.code == 'HOST_DEPENDENCIES_MISMATCH'


def test_release_change_after_resolution_cannot_execute_a_different_method(tmp_path):
    host = fault_host(tmp_path, result(GOOD))
    expected = host.registry.get('acme.fault').manifest
    path = tmp_path / 'plugins/acme.fault/plugin.json'
    manifest = json.loads(path.read_text('utf-8'))
    manifest['version'] = '1.0.1'
    path.write_text(json.dumps(manifest), 'utf-8')
    with pytest.raises(PluginHostError) as error:
        host.run('acme.fault', 'run', [{'case_id': 'a', 'input': {}}], expected_manifest=expected)
    assert error.value.code == 'RELEASE_CHANGED'


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
    ('array envelope', 'out.joinpath("result.json").write_text("[]")\n', 'OUTPUT_CONTRACT_VIOLATION'),
    ('array case id', result(GOOD.replace('"case_id": "a"', '"case_id": []')), 'OUTPUT_CONTRACT_VIOLATION'),
    ('object results', result('[{"case_id": "a", "status": "succeeded", "results": {"value": 1}}]'), 'OUTPUT_CONTRACT_VIOLATION'),
    ('scalar result', result('[{"case_id": "a", "status": "succeeded", "results": [1]}]'), 'OUTPUT_CONTRACT_VIOLATION'),
    ('array key', result(GOOD.replace('"key": "ampacity"', '"key": []')), 'OUTPUT_CONTRACT_VIOLATION'),
    ('numeric entity', result(GOOD.replace('"circuit/c1"', '7')), 'OUTPUT_CONTRACT_VIOLATION'),
    ('null condition', result(GOOD.replace('"value":', '"case": None, "value":')), 'OUTPUT_CONTRACT_VIOLATION'),
    ('array condition', result(GOOD.replace('"value":', '"case": [], "value":')), 'OUTPUT_CONTRACT_VIOLATION'),
    ('blank condition', result(GOOD.replace('"value":', '"case": " ", "value":')), 'OUTPUT_CONTRACT_VIOLATION'),
    ('overflow integer', result(GOOD.replace('500.0', '10**400')), 'OUTPUT_CONTRACT_VIOLATION'),
    ('scalar failure', result('[{"case_id": "a", "status": "failed", "error": "broken"}]'), 'OUTPUT_CONTRACT_VIOLATION'),
    ('numeric failure code', result('[{"case_id": "a", "status": "failed", "error": {"code": 1, "message": "broken"}}]'), 'OUTPUT_CONTRACT_VIOLATION'),
    ('scalar unavailable reason', result(GOOD.replace('"status": "available", "value": 500.0', '"status": "unavailable", "reason": "broken"')), 'OUTPUT_CONTRACT_VIOLATION'),
    ('unavailable missing unit', result(GOOD.replace('"status": "available", "value": 500.0, "unit": "A"', '"status": "unavailable", "reason": {"code": "R", "message": "unavailable"}')), 'OUTPUT_CONTRACT_VIOLATION'),
    ('scalar artifact', result(GOOD.replace('"results":', '"artifacts": [1], "results":')), 'OUTPUT_CONTRACT_VIOLATION'),
    ('scalar warning', result(GOOD.replace('"results":', '"warnings": ["warning"], "results":')), 'OUTPUT_CONTRACT_VIOLATION'),
    ('array evidence', result(GOOD.replace('"results":', '"evidence": [1], "results":')), 'OUTPUT_CONTRACT_VIOLATION'),
])
def test_faulty_plugins_fail_closed(tmp_path, name, body, code):
    with pytest.raises(PluginHostError) as error:
        run_fault(tmp_path, body)
    assert error.value.code == code, name
    assert not any(tmp_path.glob('csp-job-*')), 'failed job directories must also be removed'


@pytest.mark.parametrize('status', ['succeeded', 'failed'])
def test_preflight_retains_plugin_evidence_and_warnings(tmp_path, status):
    cases = [{'case_id': 'a', 'status': status, 'evidence': {'prepared_input_sha256': 'a' * 64},
              'warnings': [{'code': 'SCOPE', 'message': 'reference only'}]}]
    if status == 'failed':
        cases[0]['error'] = {'code': 'UNSUPPORTED', 'message': 'outside scope'}
    host = fault_host(tmp_path, result(repr(cases)))
    case = host.check('acme.fault', 'run', [{'case_id': 'a', 'input': {}}]).cases[0]
    assert case.evidence == cases[0]['evidence']
    assert case.warnings == cases[0]['warnings']


@pytest.mark.skipif(os.name != 'nt', reason='Windows Job Object lifecycle')
@pytest.mark.parametrize('mode', ['timeout', 'host-exit'])
def test_worker_descendants_exit_with_their_host_or_timeout(tmp_path, mode):
    import ctypes
    from ctypes import wintypes
    ready = tmp_path / 'ready.json'
    body = ("import os, subprocess\n"
            "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
            f"pathlib.Path({str(ready)!r}).write_text(json.dumps([os.getpid(), child.pid]))\n"
            "time.sleep(60)\n")
    host = fault_host(tmp_path, body, {'resources': {'timeout_s': 30, 'memory_mb': 64, 'network': 'none'}})
    repository = Path(__file__).resolve().parents[1]
    launcher = (f"import sys\nsys.path.insert(0, {str(repository)!r})\n"
                "from pathlib import Path\nfrom backend.plugin_host import Executor, Registry, PluginHostError\n"
                f"host = Executor(Registry(Path({str(host.registry.root)!r})), jobs_root=Path({str(tmp_path)!r}))\n"
                "try:\n"
                f"    host.run('acme.fault', 'run', [{{'case_id': 'a', 'input': {{}}}}], timeout_s={3 if mode == 'timeout' else 30})\n"
                "except PluginHostError as error:\n    assert error.code == 'TIMEOUT', str(error)\n")
    parent = subprocess.Popen([sys.executable, '-c', launcher], stdin=subprocess.DEVNULL,
                              stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
    api = ctypes.WinDLL('kernel32', use_last_error=True)
    api.OpenProcess.argtypes, api.OpenProcess.restype = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE
    api.WaitForSingleObject.argtypes, api.WaitForSingleObject.restype = [wintypes.HANDLE, wintypes.DWORD], wintypes.DWORD
    api.TerminateProcess.argtypes, api.TerminateProcess.restype = [wintypes.HANDLE, wintypes.UINT], wintypes.BOOL
    api.CloseHandle.argtypes, api.CloseHandle.restype = [wintypes.HANDLE], wintypes.BOOL
    handles = []
    try:
        deadline = time.monotonic() + 15
        while not ready.exists():
            assert parent.poll() is None, parent.communicate()[1].decode('utf-8', 'replace')
            assert time.monotonic() < deadline, 'worker did not start'
            time.sleep(.02)
        for pid in json.loads(ready.read_text('utf-8')):
            handle = api.OpenProcess(0x100001, False, pid)  # observe and clean only our exact live process handles
            assert handle, ctypes.WinError(ctypes.get_last_error())
            handles.append(handle)
        if mode == 'host-exit':
            parent.kill()
        parent.wait(timeout=10)
        if mode == 'timeout':
            assert parent.returncode == 0, parent.communicate()[1].decode('utf-8', 'replace')
        assert all(api.WaitForSingleObject(handle, 5000) == 0 for handle in handles)
        if mode == 'timeout':
            assert not any(tmp_path.glob('csp-job-*'))
    finally:
        if parent.poll() is None:
            parent.kill()
            parent.wait(timeout=5)
        parent.communicate()
        for handle in handles:
            if api.WaitForSingleObject(handle, 0) == 0x102:
                api.TerminateProcess(handle, 1)
                api.WaitForSingleObject(handle, 5000)
            api.CloseHandle(handle)


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
    ({'host_api': {'major': 2, 'min_minor': 2}}, '宿主插件 API'),
    ({'host_api': {'major': 2, 'min_minor': 1}}, '简介与图标'),
    ({'description': 'A method', 'icon': 'assets/icon.svg'}, 'API 2.1'),
    ({'host_api': {'major': 2, 'min_minor': 1}, 'description': ' ', 'icon': 'assets/icon.svg'}, '单行文本'),
    ({'host_api': {'major': 2, 'min_minor': 1}, 'description': 'A method', 'icon': 'assets/icon.svg'}, '图标必须'),
    ({'runtime': {'kind': 'executable', 'python': '', 'entry': 'src/main.py'}}, 'python'),
    ({'capabilities': [{**MANIFEST['capabilities'][0], 'outputs': [{'key': 'hotspot', 'type': 'quantity', 'per': 'cable', 'required': True}]}]}, '未登记的结果键'),
    ({'capabilities': [{**MANIFEST['capabilities'][0], 'validation': {'level': 'reference-benchmark', 'cases': []}}]}, '算例'),
])
def test_invalid_manifests_are_rejected_at_discovery(tmp_path, patch, message):
    with pytest.raises(Exception, match=message):
        fault_host(tmp_path, result(GOOD), patch)


def test_icon_tampering_is_refused_before_execution(tmp_path):
    import shutil
    source = Registry().get('cablesim.iec60287').directory
    directory = tmp_path / 'plugins' / source.name
    shutil.copytree(source, directory)
    icon = directory / 'assets/icon.svg'
    icon.write_bytes(icon.read_bytes() + b'\n')
    plugin = Registry(tmp_path / 'plugins').get('cablesim.iec60287')
    with pytest.raises(PluginHostError) as error:
        plugin.verify()
    assert error.value.code == 'PACKAGE_DIGEST_MISMATCH'
