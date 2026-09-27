"""Generic cablesim.run/2 executor. No plugin-specific branches.

Job directory layout (PLUGIN_CONTRACT §5.2):
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
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from uuid import uuid4

from .manifest import CUSTOM, KEY_UNITS
from .registry import PluginHostError, Registry

PROTOCOL = 'cablesim.run/2'
MAX_RESULT_BYTES = 16 * 1024 * 1024
MAX_OUTPUT_FILES = 200
STDERR_LIMIT = 8000
STATUSES = {'succeeded', 'failed', 'not_applicable'}


@dataclass
class CaseResult:
    case_id: str
    status: str
    results: list[dict] = field(default_factory=list)
    artifacts: dict[str, dict] = field(default_factory=dict)  # artifact type -> parsed JSON content
    artifact_digests: dict[str, str] = field(default_factory=dict)
    warnings: list[dict] = field(default_factory=list)
    error: dict | None = None

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
        self.registry = registry or Registry()
        self.jobs_root = jobs_root
        self.verify = verify
        self._verified: set[str] = set()

    def run(self, plugin_id: str, capability_id: str, cases: list[dict], timeout_s: int | None = None) -> RunResult:
        plugin = self.registry.get(plugin_id)
        manifest = plugin.manifest
        try:
            capability = manifest.capability(capability_id)
        except KeyError:
            raise PluginHostError('CAPABILITY_UNKNOWN', f'{plugin_id} 没有能力 {capability_id}', 404) from None
        if self.verify and plugin_id not in self._verified:
            plugin.verify()
            self._verified.add(plugin_id)
        ids = [c['case_id'] for c in cases]
        if not cases or len(set(ids)) != len(ids):
            raise PluginHostError('CASES_INVALID', '请求至少包含一个工况，且 case_id 唯一。')
        run_id = str(uuid4())
        request = {'protocol': PROTOCOL, 'phase': 'run', 'run_id': run_id, 'capability': capability_id,
                   'input_schema': capability.input_schema, 'cases': cases,
                   'limits': {'timeout_s': manifest.resources.timeout_s, 'memory_mb': manifest.resources.memory_mb}}
        raw = json.dumps(request, ensure_ascii=False, allow_nan=False, sort_keys=True).encode('utf-8')
        job = Path(tempfile.mkdtemp(prefix='csp-job-', dir=self.jobs_root))
        try:
            (job / 'input').mkdir()
            (job / 'output').mkdir()
            (job / 'input/request.json').write_bytes(raw)
            limit = min(timeout_s or manifest.resources.timeout_s, manifest.resources.timeout_s)
            try:
                proc = subprocess.run([sys.executable, '-I', str(plugin.entry)], cwd=job, env=minimal_environment(job),
                                      stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                      timeout=limit)
            except subprocess.TimeoutExpired:
                raise PluginHostError('TIMEOUT', f'{plugin_id} 超过 {limit} s 时间上限，进程已终止。', 504) from None
            result_path = job / 'output/result.json'
            if proc.returncode != 0 or not result_path.is_file():
                detail = proc.stderr.decode('utf-8', 'replace')[-STDERR_LIMIT:].strip()
                raise PluginHostError('PLUGIN_CRASHED', f'{plugin_id} 退出码 {proc.returncode}，未写出有效结果。{detail}', 502)
            return self._accept(job, plugin_id, manifest.version, capability, run_id, raw, result_path, ids)
        finally:
            shutil.rmtree(job, ignore_errors=True)

    def _accept(self, job, plugin_id, version, capability, run_id, raw, result_path, ids) -> RunResult:
        if result_path.stat().st_size > MAX_RESULT_BYTES:
            raise violation('result.json 超过大小上限')
        outputs = list((job / 'output').rglob('*'))
        if len(outputs) > MAX_OUTPUT_FILES:
            raise violation('输出文件数量超过上限')
        try:
            payload = json.loads(result_path.read_text('utf-8'), parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c)))
        except ValueError as exc:
            raise violation(f'result.json 不是有效 JSON：{exc}') from None
        if payload.get('protocol') != PROTOCOL or not isinstance(payload.get('cases'), list):
            raise violation('result.json 协议或结构不符')
        by_id = {c.get('case_id'): c for c in payload['cases'] if isinstance(c, dict)}
        if sorted(by_id) != sorted(ids) or len(payload['cases']) != len(ids):
            raise violation('返回的工况与请求不一致')
        declared = {(o.key, o.type): o for o in capability.outputs}
        artifact_types = {a.type: a for a in capability.artifacts}
        cases = []
        for case_id in ids:
            case = by_id[case_id]
            status = case.get('status')
            if status not in STATUSES:
                raise violation(f'{case_id}: 未知状态 {status}')
            if status != 'succeeded':
                error = case.get('error') or {}
                if not error.get('code') or not error.get('message'):
                    raise violation(f'{case_id}: 失败必须带 code 与 message')
                if case.get('results'):
                    raise violation(f'{case_id}: 失败工况不得返回数值结果')
                cases.append(CaseResult(case_id, status, error={'code': error['code'], 'message': error['message']}))
                continue
            results = case.get('results') or []
            seen = set()
            for r in results:
                key, rtype = r.get('key'), r.get('type')
                if (key, rtype) not in declared:
                    raise violation(f'{case_id}: 未声明的输出 {key}/{rtype}')
                ident = (key, rtype, r.get('entity'))
                if not r.get('entity') or ident in seen:
                    raise violation(f'{case_id}: 输出实体缺失或重复 {ident}')
                seen.add(ident)
                if r.get('status') == 'available':
                    value = r.get('value')
                    if not isinstance(value, (int, float)) or isinstance(value, bool) or not isfinite(value):
                        raise violation(f'{case_id}: {key} 不是有限数值')
                    expected_unit = KEY_UNITS.get(key)
                    if expected_unit is None and not CUSTOM.match(key) or expected_unit is not None and r.get('unit') != expected_unit:
                        raise violation(f'{case_id}: {key} 单位应为 {expected_unit}，收到 {r.get("unit")}')
                elif r.get('status') == 'unavailable':
                    reason = r.get('reason') or {}
                    if 'value' in r or not reason.get('code'):
                        raise violation(f'{case_id}: 不可用结果不得带数值，且必须给出原因代码')
                else:
                    raise violation(f'{case_id}: 结果状态非法')
            present = {(r['key'], r['type']) for r in results}
            missing = [k for k, o in declared.items() if o.required and k not in present]
            if missing:
                raise violation(f'{case_id}: 缺少必需输出 {missing}')
            artifacts, digests = {}, {}
            for a in case.get('artifacts') or []:
                atype, rel = a.get('type'), a.get('path', '')
                if atype not in artifact_types or atype in artifacts:
                    raise violation(f'{case_id}: 未声明或重复的工件类型 {atype}')
                target = (job / rel).resolve()
                if not rel.startswith('output/') or not target.is_relative_to((job / 'output').resolve()) or not target.is_file():
                    raise violation(f'{case_id}: 工件路径越界或不存在 {rel}')
                data = target.read_bytes()
                try:
                    artifacts[atype] = json.loads(data)
                except ValueError:
                    raise violation(f'{case_id}: 工件 {atype} 不是 JSON') from None
                digests[atype] = sha256(data).hexdigest()
            missing = [t for t, spec in artifact_types.items() if spec.required and t not in artifacts]
            if missing:
                raise violation(f'{case_id}: 缺少必需工件 {missing}')
            cases.append(CaseResult(case_id, status, results, artifacts, digests, case.get('warnings') or []))
        environment = payload.get('environment') if isinstance(payload.get('environment'), dict) else {}
        return RunResult(run_id, plugin_id, version, capability.id, capability.method_version,
                         sha256(raw).hexdigest(), environment, cases)
