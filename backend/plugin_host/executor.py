"""Generic cablesim.run/2 executor. No plugin-specific branches.

Job directory layout (CableSimPro-Plugins/SPEC.md, execution protocol):
  input/request.json   written by the host, read-only for the plugin
  output/              the only place the plugin may write; must contain result.json

The plugin runs as `python -I <entry>` with the job directory as cwd and a minimal
environment (no API keys, proxies, PYTHONPATH or database paths). This is process-level
fault isolation, not an OS sandbox. The returned result is checked against the
capability's declared outputs before anything is handed back to the caller.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
import json
from math import isfinite
import os
import platform
import re
from pathlib import Path
import shutil
import subprocess
import sys
import sysconfig
import tempfile
from uuid import uuid4

from .manifest import CUSTOM, KEY_UNITS
from .registry import PluginHostError, Registry
from .process import run_process

PROTOCOL = 'cablesim.run/2'
MAX_RESULT_BYTES = 16 * 1024 * 1024
MAX_OUTPUT_FILES = 200
STDERR_LIMIT = 8000
STATUSES = {'succeeded', 'failed', 'not_applicable'}


def current_platform():
    # On Windows a restricted environment may omit PROCESSOR_ARCHITECTURE.
    # Native extensions must match this Python interpreter, including emulation.
    machine = sysconfig.get_platform().removeprefix('win-') if sys.platform == 'win32' else platform.machine().lower()
    architecture = {'amd64': 'x64', 'x86_64': 'x64', 'aarch64': 'arm64'}.get(machine, machine)
    return platform.system().lower() + '-' + architecture


@dataclass
class CaseResult:
    case_id: str
    status: str
    results: list[dict] = field(default_factory=list)
    artifacts: dict[str, dict] = field(default_factory=dict)  # artifact type -> parsed JSON content
    artifact_digests: dict[str, str] = field(default_factory=dict)
    warnings: list[dict] = field(default_factory=list)
    error: dict | None = None
    evidence: dict = field(default_factory=dict)

    def value(self, key: str, entity: str) -> float:
        for r in self.results:
            if r['key'] == key and r['entity'] == entity and r['status'] == 'available':
                return r['value']
        raise KeyError((key, entity))


@dataclass
class RunResult:
    run_id: str
    plugin_id: str
    plugin_version: str
    capability: str
    method_version: str
    request_sha256: str
    environment: dict
    cases: list[CaseResult]


def minimal_environment(job: Path) -> dict[str, str]:
    env = {k: os.environ[k] for k in ('PATH', 'SYSTEMROOT', 'WINDIR') if k in os.environ}
    env.update(HOME=str(job), USERPROFILE=str(job), TMP=str(job), TEMP=str(job), TMPDIR=str(job),
               PYTHONIOENCODING='utf-8', PYTHONDONTWRITEBYTECODE='1', OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1')
    return env


def violation(message: str) -> PluginHostError:
    return PluginHostError('OUTPUT_CONTRACT_VIOLATION', message, 502)


class Executor:
    def __init__(self, registry: Registry | None = None, jobs_root: Path | None = None, verify: bool = True):
        self.registry = registry or Registry(discover=False)
        self.jobs_root = jobs_root
        self.verify = verify

    def check(self, plugin_id: str, capability_id: str, cases: list[dict], *, expected_manifest=None) -> RunResult:
        return self.run(plugin_id, capability_id, cases, phase='check', expected_manifest=expected_manifest)

    def run(self, plugin_id: str, capability_id: str, cases: list[dict], timeout_s: int | None = None, *, phase: str = 'run', expected_manifest=None) -> RunResult:
        plugin = Registry(self.registry.root, plugin_id=plugin_id).get(plugin_id)
        manifest = plugin.manifest
        if expected_manifest is not None and manifest != expected_manifest:
            raise PluginHostError('RELEASE_CHANGED', '方法发行在准备后发生变化，请重新选择版本并预检。', 409)
        if current_platform() not in manifest.platforms:
            raise PluginHostError('PLATFORM_UNSUPPORTED', f'{plugin_id} 未声明支持当前平台 {current_platform()}。', 409)
        try:
            capability = manifest.capability(capability_id)
        except KeyError:
            raise PluginHostError('CAPABILITY_UNKNOWN', f'{plugin_id} 没有能力 {capability_id}', 404) from None
        if phase not in ('check', 'run'):
            raise PluginHostError('PHASE_INVALID', '未知执行阶段。')
        if self.verify:
            plugin.verify()
        ids = [c['case_id'] for c in cases]
        if not cases or len(cases) > 100 or len(set(ids)) != len(ids) or any(not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', i) for i in ids):
            raise PluginHostError('CASES_INVALID', '请求至少包含一个工况，且 case_id 唯一。')
        run_id = str(uuid4())
        request = {'protocol': PROTOCOL, 'phase': phase, 'run_id': run_id, 'capability': capability_id,
                   'input_schema': capability.input_schema, 'cases': cases,
                   'limits': {'timeout_s': manifest.resources.timeout_s, 'memory_mb': manifest.resources.memory_mb}}
        raw = json.dumps(request, ensure_ascii=False, allow_nan=False, sort_keys=True).encode('utf-8')
        job = Path(tempfile.mkdtemp(prefix='csp-job-', dir=self.jobs_root))
        clean_job = True
        try:
            (job / 'input').mkdir()
            (job / 'output').mkdir()
            (job / 'input/request.json').write_bytes(raw)
            limit = min(timeout_s or manifest.resources.timeout_s, manifest.resources.timeout_s)
            try:
                proc = run_process([sys.executable, '-I', str(plugin.entry)], cwd=job, env=minimal_environment(job),
                                   timeout=limit, stderr_limit=STDERR_LIMIT)
            except subprocess.TimeoutExpired:
                raise PluginHostError('TIMEOUT', f'{plugin_id} 超过 {limit} s 时间上限，进程已终止。', 504) from None
            except OSError as exc:
                raise PluginHostError('PROCESS_LAUNCH_FAILED', f'无法受控启动工作进程：{exc}', 503) from None
            result_path = job / 'output/result.json'
            if proc.returncode != 0 or not result_path.is_file():
                detail = proc.stderr.decode('utf-8', 'replace')[-STDERR_LIMIT:].strip()
                raise PluginHostError('PLUGIN_CRASHED', f'{plugin_id} 退出码 {proc.returncode}，未写出有效结果。{detail}', 502)
            accepted = self._accept(job, plugin_id, manifest.version, capability, run_id, raw, result_path, ids, phase)
            accepted.environment['host_execution'] = {
                'platform': current_platform(), 'isolation': 'process', 'os_sandbox': False,
                'timeout_enforced': True, 'memory_limit_enforced': False, 'network_isolation_enforced': False,
                'parent_death_enforced': os.name == 'nt', 'process_tree_cleanup_enforced': os.name == 'nt',
                'declared_limits': manifest.resources.model_dump(mode='json')}
            return accepted
        except PluginHostError as exc:
            if exc.code == 'PROCESS_TERMINATION_UNCONFIRMED':
                clean_job = False
                raise PluginHostError(exc.code, f'{exc.message} 作业目录：{job}', exc.status) from None
            raise
        finally:
            if clean_job:
                shutil.rmtree(job, ignore_errors=True)

    def _accept(self, job, plugin_id, version, capability, run_id, raw, result_path, ids, phase='run') -> RunResult:
        if result_path.stat().st_size > MAX_RESULT_BYTES:
            raise violation('result.json 超过大小上限')
        outputs = list((job / 'output').rglob('*'))
        if len(outputs) > MAX_OUTPUT_FILES:
            raise violation('输出文件数量超过上限')
        try:
            payload = json.loads(result_path.read_text('utf-8'), parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c)))
        except ValueError as exc:
            raise violation(f'result.json 不是有效 JSON：{exc}') from None
        if not isinstance(payload, dict) or payload.get('protocol') != PROTOCOL or not isinstance(payload.get('cases'), list):
            raise violation('result.json 协议或结构不符')
        if any(not isinstance(c, dict) or not isinstance(c.get('case_id'), str) for c in payload['cases']):
            raise violation('每个工况必须是对象并带有字符串 case_id')
        environment = payload.get('environment', {})
        if not isinstance(environment, dict):
            raise violation('environment 必须是对象')
        by_id = {c['case_id']: c for c in payload['cases']}
        if sorted(by_id) != sorted(ids) or len(payload['cases']) != len(ids):
            raise violation('返回的工况与请求不一致')
        declared = {(o.key, o.type): o for o in capability.outputs}
        artifact_types = {a.type: a for a in capability.artifacts}
        cases = []
        for case_id in ids:
            case = by_id[case_id]
            status = case.get('status')
            if not isinstance(status, str) or status not in STATUSES:
                raise violation(f'{case_id}: 未知状态 {status}')
            for name in ('results', 'artifacts', 'warnings'):
                items = case.get(name, [])
                if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
                    raise violation(f'{case_id}: {name} 必须是对象数组')
            results, artifact_refs, warnings = (case.get(name, []) for name in ('results', 'artifacts', 'warnings'))
            evidence = case.get('evidence', {})
            if not isinstance(evidence, dict):
                raise violation(f'{case_id}: evidence 必须是对象')
            if any(not isinstance(w.get(k), str) or not w[k].strip() for w in warnings for k in ('code', 'message')):
                raise violation(f'{case_id}: 警告必须带非空字符串 code 与 message')
            if status != 'succeeded':
                error = case.get('error')
                if not isinstance(error, dict) or any(not isinstance(error.get(k), str) or not error[k].strip() for k in ('code', 'message')):
                    raise violation(f'{case_id}: 失败必须带 code 与 message')
                if results or artifact_refs:
                    raise violation(f'{case_id}: 失败工况不得返回数值结果或工件')
                cases.append(CaseResult(case_id, status, warnings=warnings, evidence=evidence,
                                        error={'code': error['code'], 'message': error['message']}))
                continue
            if phase == 'check':
                if results or artifact_refs:
                    raise violation('预检不得返回计算结果或工件')
                cases.append(CaseResult(case_id, status, warnings=warnings, evidence=evidence))
                continue
            seen = set()
            for r in results:
                if any(not isinstance(r.get(k), str) or not r[k].strip() for k in ('key', 'type', 'entity', 'unit')):
                    raise violation(f'{case_id}: 输出键、类型、实体与单位必须是非空字符串')
                if 'case' in r and (not isinstance(r['case'], str) or not r['case'].strip()):
                    raise violation(f'{case_id}: 输出工况必须是非空字符串，未指定时省略该字段')
                key, rtype = r.get('key'), r.get('type')
                if (key, rtype) not in declared:
                    raise violation(f'{case_id}: 未声明的输出 {key}/{rtype}')
                ident = (key, rtype, r.get('entity'), r.get('case'))
                if not r.get('entity') or ident in seen:
                    raise violation(f'{case_id}: 输出实体缺失或重复 {ident}')
                seen.add(ident)
                expected_unit = KEY_UNITS.get(key)
                if expected_unit is None and not CUSTOM.match(key) or expected_unit is not None and r['unit'] != expected_unit:
                    raise violation(f'{case_id}: {key} 单位应为 {expected_unit}，收到 {r["unit"]}')
                if r.get('status') == 'available':
                    value = r.get('value')
                    if not isinstance(value, (int, float)) or isinstance(value, bool) or abs(value) > sys.float_info.max or not isfinite(value):
                        raise violation(f'{case_id}: {key} 不是有限数值')
                elif r.get('status') == 'unavailable':
                    reason = r.get('reason')
                    if 'value' in r or not isinstance(reason, dict) or any(not isinstance(reason.get(k), str) or not reason[k].strip() for k in ('code', 'message')):
                        raise violation(f'{case_id}: 不可用结果不得带数值，且必须给出原因代码与说明')
                else:
                    raise violation(f'{case_id}: 结果状态非法')
            present = {(r['key'], r['type']) for r in results}
            missing = [k for k, o in declared.items() if o.required and k not in present]
            if missing:
                raise violation(f'{case_id}: 缺少必需输出 {missing}')
            artifacts, digests = {}, {}
            for a in artifact_refs:
                if any(not isinstance(a.get(k), str) or not a[k].strip() for k in ('type', 'path')):
                    raise violation(f'{case_id}: 工件类型与路径必须是非空字符串')
                atype, rel = a.get('type'), a.get('path', '')
                if atype not in artifact_types or atype in artifacts:
                    raise violation(f'{case_id}: 未声明或重复的工件类型 {atype}')
                target = (job / rel).resolve()
                if not rel.startswith('output/') or not target.is_relative_to((job / 'output').resolve()) or not target.is_file():
                    raise violation(f'{case_id}: 工件路径越界或不存在 {rel}')
                if target.stat().st_size > MAX_RESULT_BYTES:
                    raise violation(f'{case_id}: 工件超过大小上限')
                data = target.read_bytes()
                try:
                    artifacts[atype] = json.loads(data, parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c)))
                except ValueError:
                    raise violation(f'{case_id}: 工件 {atype} 不是 JSON') from None
                digests[atype] = sha256(data).hexdigest()
            missing = [t for t, spec in artifact_types.items() if spec.required and t not in artifacts]
            if missing:
                raise violation(f'{case_id}: 缺少必需工件 {missing}')
            cases.append(CaseResult(case_id, status, results, artifacts, digests, warnings, evidence=evidence))
        return RunResult(run_id, plugin_id, version, capability.id, capability.method_version,
                         sha256(raw).hexdigest(), environment, cases)
