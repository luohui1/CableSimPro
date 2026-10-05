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
from time import perf_counter, sleep
from uuid import uuid4

from ..domain.models import FactoryMeasurement
from .manifest import CUSTOM, KEY_UNITS
from .registry import PluginHostError, Registry
from .process import run_process
from .runtime import resolve_python

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
    env = {k: os.environ[k] for k in ('PATH', 'SYSTEMROOT', 'WINDIR','SLURM_JOB_ID','SLURM_ARRAY_JOB_ID','SLURM_ARRAY_TASK_ID','SLURM_CPUS_PER_TASK','SLURM_JOB_NODELIST') if k in os.environ}
    env.update(HOME=str(job), USERPROFILE=str(job), TMP=str(job), TEMP=str(job), TMPDIR=str(job),
               PYTHONIOENCODING='utf-8', PYTHONDONTWRITEBYTECODE='1', OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1')
    return env


def violation(message: str) -> PluginHostError:
    return PluginHostError('OUTPUT_CONTRACT_VIOLATION', message, 502)


def validate_domain_input(document):
    """Shared wire checks; research also validates the complete domain model.

    Direct CAD calls may contain only structural facts, so this boundary does
    not fill in circuits, ratings or operating conditions that were not supplied.
    """
    if not isinstance(document, dict) or document.get('schema_version') != 'cablesim.domain/1':
        raise ValueError('schema_version：请选择 cablesim.domain/1 的 SI 输入。')
    pending = [('', document)]
    while pending:
        path, value = pending.pop()
        if isinstance(value, float) and not isfinite(value):
            raise ValueError(path + '：请输入有限数值，并核对 SI 单位。')
        if isinstance(value, dict):
            pending.extend((path + '.' + key if path else key, item) for key, item in value.items())
        elif isinstance(value, list):
            pending.extend((path + '.' + str(i), item) for i, item in enumerate(value))
    materials = {item['id'] for item in document.get('materials', [])}
    for i, cable in enumerate(document.get('cable_types', [])):
        refs = []
        for j, core in enumerate(cable.get('cores', [])):
            root = f'cable_types.{i}.cores.{j}'
            refs.append((root + '.conductor.material', core['conductor']['material']))
            refs.extend((root + f'.layers.{k}.material', layer['material'])
                        for k, layer in enumerate(core.get('layers', [])))
        refs.extend((f'cable_types.{i}.common_layers.{j}.material', layer['material'])
                    for j, layer in enumerate(cable.get('common_layers', [])))
        for path, reference in refs:
            if reference not in materials:
                raise ValueError(path + '：材料引用不存在，请选择文档中的材料。')
    for i, observation in enumerate(document.get('measurements', [])):
        try:
            FactoryMeasurement.model_validate(observation)
        except ValueError as exc:
            raise ValueError(f'measurements.{i}：{exc}') from None


class Executor:
    def __init__(self, registry: Registry | None = None, jobs_root: Path | None = None, verify: bool = True, process_runner=None):
        self.registry = registry or Registry(discover=False)
        self.jobs_root = jobs_root
        self.verify = verify
        self.process_runner = process_runner or run_process

    def check(self, plugin_id: str, capability_id: str, cases: list[dict], *, expected_manifest=None) -> RunResult:
        return self.run(plugin_id, capability_id, cases, phase='check', expected_manifest=expected_manifest)

    def run(self, plugin_id: str, capability_id: str, cases: list[dict], timeout_s: int | None = None, *, phase: str = 'run', expected_manifest=None, reuse_artifacts: dict | None = None) -> RunResult:
        execution_started = perf_counter()
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
        interpreter, runtime_environment = resolve_python(plugin)
        ids = [c['case_id'] for c in cases]
        if not cases or len(cases) > 100 or len(set(ids)) != len(ids) or any(not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', i) for i in ids):
            raise PluginHostError('CASES_INVALID', '请求至少包含一个工况，且 case_id 唯一。')
        if capability.input_schema == 'cablesim.domain/1':
            for case in cases:
                try:
                    validate_domain_input(case['input'])
                except (ValueError, KeyError, TypeError) as exc:
                    raise PluginHostError('INPUT_CONTRACT_VIOLATION', f"{case['case_id']}：{exc}", 422) from None
        run_id = str(uuid4())
        reuse_raw = None
        if reuse_artifacts is not None:
            reuse_raw=json.dumps(reuse_artifacts,ensure_ascii=False,allow_nan=False,sort_keys=True).encode('utf-8')
            cases=[{**case,'parameters':{**case.get('parameters',{}),'_artifact_reuse_sha256':sha256(reuse_raw).hexdigest()}} for case in cases]
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
            if reuse_raw is not None:
                (job / 'input/reuse-artifacts.json').write_bytes(reuse_raw)
            limit = min(timeout_s or manifest.resources.timeout_s, manifest.resources.timeout_s)
            process_started = perf_counter()
            process_environment=minimal_environment(job)
            process_environment['CABLESIM_WORKER_RELEASE']=sha256(manifest.model_dump_json().encode()).hexdigest()
            try:
                proc = self.process_runner([interpreter, '-I', str(plugin.entry)], cwd=job, env=process_environment,
                                   timeout=limit, stderr_limit=STDERR_LIMIT)
            except subprocess.TimeoutExpired:
                raise PluginHostError('TIMEOUT', f'{plugin_id} 超过 {limit} s 时间上限，进程已终止。', 504) from None
            except OSError as exc:
                raise PluginHostError('PROCESS_LAUNCH_FAILED', f'无法受控启动工作进程：{exc}', 503) from None
            result_path = job / 'output/result.json'
            process_ms = (perf_counter()-process_started)*1000
            if proc.returncode != 0 or not result_path.is_file():
                detail = proc.stderr.decode('utf-8', 'replace')[-STDERR_LIMIT:].strip()
                raise PluginHostError('PLUGIN_CRASHED', f'{plugin_id} 退出码 {proc.returncode}，未写出有效结果。{detail}', 502)
            accept_started = perf_counter()
            accepted = self._accept(job, plugin_id, manifest.version, capability, run_id, raw, result_path, ids, phase)
            accepted.environment['host_profiling'] = {
                'prepare_ms':(process_started-execution_started)*1000,
                'process_ms':process_ms,'accept_ms':(perf_counter()-accept_started)*1000,
                'total_ms':(perf_counter()-execution_started)*1000}
            if hasattr(proc,'profiling'):accepted.environment['resident_profiling']=proc.profiling
            accepted.environment['host_execution'] = {
                'runtime': runtime_environment,
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
                # Windows may briefly retain an I/O handle after the confirmed tree exit.
                allowed_root = Path(self.jobs_root or tempfile.gettempdir()).resolve()
                if job.resolve().parent != allowed_root or not job.name.startswith('csp-job-'):
                    raise PluginHostError('JOB_CLEANUP_FAILED', f'作业目录越出临时根目录，已保留：{job}', 503)
                for attempt in range(7):
                    try:
                        shutil.rmtree(job)
                        break
                    except FileNotFoundError:
                        break
                    except PermissionError as error:
                        if os.name != 'nt' or getattr(error, 'winerror', None) not in (5, 32) or attempt == 6:
                            raise PluginHostError('JOB_CLEANUP_FAILED', f'工作进程已退出，但临时目录清理失败，已保留：{job}；{error}', 503) from None
                        sleep(.1)

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
                for name in ('path', 'field'):
                    if name in error and (not isinstance(error[name], str) or not error[name].strip()):
                        raise violation(f'{case_id}: error.{name} 必须为非空字段路径')
                if 'issues' in error and (not isinstance(error['issues'], list) or any(not isinstance(i, dict) or any(not isinstance(i.get(k), str) or not i[k].strip() for k in ('path','message','code')) for i in error['issues'])):
                    raise violation(f'{case_id}: error.issues 必须带 path/message/code')
                cases.append(CaseResult(case_id, status, warnings=warnings, evidence=evidence,
                                        error={k: error[k] for k in ('code','message','path','field','issues') if k in error}))
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
                if 'rating_basis' in r:
                    from cablesim_sdk.ampacity import AmpacityBasis
                    if key != 'ampacity':
                        raise violation(f'{case_id}: rating_basis 仅用于载流量')
                    try:
                        AmpacityBasis.model_validate(r['rating_basis'], strict=True)
                    except ValueError as exc:
                        raise violation(f'{case_id}: 载流量口径或固定负荷无效') from exc
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
