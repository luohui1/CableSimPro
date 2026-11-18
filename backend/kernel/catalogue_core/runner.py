"""cablesim.run/2 runner: one isolated process per request, results checked before use.

Job directory (plugins/SPEC execution protocol):
  input/request.json   written here, read by the plugin
  output/result.json   written by the plugin, together with its artifacts

The plugin starts as `python -I <entry>` with the job directory as cwd and a minimal
environment. Its sealed files and locked shared sources are hashed before every run;
a mismatch is a refusal, never a warning.
"""
from functools import lru_cache
from hashlib import sha256
import json
from math import isfinite
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from time import perf_counter
from uuid import uuid4

from jsonschema import Draft202012Validator

from backend.plugin_host.manifest import Manifest
from cablesim_sdk.parameter_units import translate
from . import CoreError, PLUGINS, REPO

PROTOCOL = 'cablesim.run/2'
STATUSES = {'succeeded', 'failed', 'not_applicable'}
MAX_RESULT_BYTES = 16 * 1024 * 1024
STDERR_LIMIT = 4000


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    return sha256(canonical(value)).hexdigest()


def plugin_root(plugin_id):
    if not re.fullmatch(r'[a-z][a-z0-9.-]{2,80}', plugin_id):
        raise CoreError('PLUGIN_UNKNOWN', f'未知的方法插件：{plugin_id}')
    root = PLUGINS / plugin_id
    if not (root / 'plugin.json').is_file():
        raise CoreError('PLUGIN_UNKNOWN', f'未安装方法插件：{plugin_id}')
    return root


@lru_cache(maxsize=16)
def _manifest(path, mtime_ns):
    raw = Path(path).read_bytes()
    return json.loads(raw), sha256(raw).hexdigest()


def manifest(plugin_id):
    """Parsed manifest and the digest of its bytes."""
    path = plugin_root(plugin_id) / 'plugin.json'
    return _manifest(str(path), path.stat().st_mtime_ns)


def capability(plugin_id, capability_id):
    data, _ = manifest(plugin_id)
    found = next((c for c in data['capabilities'] if c['id'] == capability_id), None)
    if found is None:
        raise CoreError('CAPABILITY_UNKNOWN', f'{plugin_id} 没有能力 {capability_id}')
    return found


def verify(plugin_id):
    """Hash the sealed plugin files and the shared sources they were sealed against."""
    root = plugin_root(plugin_id)
    data, _ = manifest(plugin_id)
    checks = [(root / item['path'], item) for item in data.get('files', [])]
    lock = root / 'src/host-dependencies.json'
    if lock.is_file():
        checks += [(REPO / item['path'], item) for item in json.loads(lock.read_text('utf-8'))]
    for path, item in checks:
        if not path.is_file():
            raise CoreError('SEAL_MISMATCH', f'{plugin_id} 的封签文件缺失：{item["path"]}。未运行。')
        raw = path.read_bytes()
        if len(raw) != item['size_bytes'] or sha256(raw).hexdigest() != item['sha256']:
            raise CoreError('SEAL_MISMATCH', f'{plugin_id} 的封签文件已被改动：{item["path"]}。未运行。')
    return {'plugin_id': plugin_id, 'version': data['version'], 'files': len(checks)}


def _pointer(parts):
    return ''.join('/' + str(part).replace('~', '~0').replace('/', '~1') for part in parts)


def normalize_parameters(spec, case):
    """Public SI parameters, checked against the sealed parameter schema."""
    schema = spec.get('parameter_schema')
    parameters = case.get('parameters', {})
    if not schema:
        return parameters
    try:
        normalized = translate(schema, parameters)
    except (ValueError, KeyError, TypeError) as error:
        raise CoreError('INPUT_INVALID', str(error), '/parameters') from None
    errors = sorted(Draft202012Validator(schema).iter_errors(normalized), key=lambda e: str(list(e.path)))
    if errors:
        error = errors[0]
        path = '/parameters' + _pointer(error.absolute_path)
        if error.validator == 'required':
            missing = [name for name in error.validator_value if name not in error.instance]
            if missing:
                path += _pointer(missing[:1])
        raise CoreError('INPUT_INVALID', f'{path}：参数不符合方法契约（{error.validator}）。', path)
    return normalized


def check_domain_input(document):
    """Wire checks shared by every domain method: finite numbers and resolvable materials."""
    if not isinstance(document, dict) or document.get('schema_version') != 'cablesim.domain/1':
        raise CoreError('INPUT_INVALID', '输入必须是 cablesim.domain/1 的 SI 文档。', '/input/schema_version')
    pending = [((), document)]
    while pending:
        path, value = pending.pop()
        if isinstance(value, float) and not isfinite(value):
            raise CoreError('INPUT_INVALID', '请输入有限数值，并核对 SI 单位。', '/input' + _pointer(path))
        if isinstance(value, dict):
            pending.extend(((*path, key), item) for key, item in value.items())
        elif isinstance(value, list):
            pending.extend(((*path, index), item) for index, item in enumerate(value))
    materials = {item['id'] for item in document.get('materials', [])}
    for i, cable in enumerate(document.get('cable_types', [])):
        refs = [(('cable_types', i, 'common_layers', j, 'material'), layer['material'])
                for j, layer in enumerate(cable.get('common_layers', []))]
        for j, core in enumerate(cable.get('cores', [])):
            refs.append((('cable_types', i, 'cores', j, 'conductor', 'material'), core['conductor']['material']))
            refs += [(('cable_types', i, 'cores', j, 'layers', k, 'material'), layer['material'])
                     for k, layer in enumerate(core.get('layers', []))]
        for path, reference in refs:
            if reference not in materials:
                raise CoreError('INPUT_INVALID', '材料引用不存在，请选择文档中的材料。', '/input' + _pointer(path))


def minimal_environment(job):
    env = {key: os.environ[key] for key in ('PATH', 'SYSTEMROOT', 'WINDIR') if key in os.environ}
    env.update(HOME=str(job), USERPROFILE=str(job), TMP=str(job), TEMP=str(job), TMPDIR=str(job),
               PYTHONIOENCODING='utf-8', PYTHONDONTWRITEBYTECODE='1',
               OMP_NUM_THREADS='1', MKL_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1')
    return env


def _violation(message):
    return CoreError('OUTPUT_CONTRACT_VIOLATION', message)


def _load(path):
    def refuse(constant):
        raise ValueError(constant)
    return json.loads(path.read_text('utf-8'), parse_constant=refuse)


def run(plugin_id, capability_id, cases, *, phase='run', jobs_root=None):
    """Execute one request and return the accepted result with its identities."""
    started = perf_counter()
    root = plugin_root(plugin_id)
    data, manifest_sha = manifest(plugin_id)
    spec = capability(plugin_id, capability_id)
    if phase not in ('run', 'check'):
        raise CoreError('PHASE_INVALID', '未知执行阶段。')
    if spec.get('kind') != 'method' or not data.get('runtime'):
        raise CoreError('CAPABILITY_NOT_RUNNABLE', f'{plugin_id}/{capability_id} 不是可执行的计算方法。')
    ids = [case.get('case_id') for case in cases]
    if not cases or len(cases) > 100 or len(set(ids)) != len(ids) or any(
            not isinstance(i, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', i) for i in ids):
        raise CoreError('CASES_INVALID', '请求至少包含一个工况，最多 100 个，且 case_id 唯一。')
    seal = verify(plugin_id)
    # Keep the exact file receipt distinct from the normalized release identity
    # used by the existing API and sealed standard-reference consumers.
    manifest_bytes = (root / 'plugin.json').read_bytes()
    if sha256(manifest_bytes).hexdigest() != manifest_sha:
        raise CoreError('RELEASE_CHANGED', f'{plugin_id} 的清单在准备期间改变；请重新读取后运行。')
    try:
        release_digest = digest(Manifest.model_validate_json(manifest_bytes).model_dump(mode='json', by_alias=True))
    except ValueError:
        raise CoreError('PLUGIN_MANIFEST_INVALID', f'{plugin_id} 的清单不符合现行发行契约；未运行。') from None
    rejected, accepted = {}, []
    for case in cases:
        try:
            parameters = normalize_parameters(spec, case)
            if spec['input_schema'] == 'cablesim.domain/1':
                check_domain_input(case['input'])
            accepted.append({'case_id': case['case_id'], 'input': case['input'], 'parameters': parameters})
        except CoreError as error:
            rejected[case['case_id']] = {'case_id': case['case_id'], 'status': 'failed', 'results': [], 'artifacts': {},
                                         'artifact_digests': {}, 'warnings': [], 'evidence': {}, 'error': error.as_dict()}
    run_id = str(uuid4())
    identity = {'run_id': run_id, 'plugin_id': plugin_id, 'plugin_version': data['version'], 'capability': capability_id,
                'method_version': spec['method_version'], 'manifest_sha256': manifest_sha, 'sealed_files': seal['files'],
                'release_digest': release_digest, 'phase': phase}
    if not accepted:
        return {**identity, 'request_sha256': digest(cases), 'environment': {'executed': False},
                'cases': [rejected[i] for i in ids]}
    request = {'protocol': PROTOCOL, 'phase': phase, 'run_id': run_id, 'capability': capability_id,
               'input_schema': spec['input_schema'], 'cases': accepted,
               'limits': {'timeout_s': data['resources']['timeout_s'], 'memory_mb': data['resources']['memory_mb']}}
    raw = json.dumps(request, ensure_ascii=False, allow_nan=False, sort_keys=True).encode('utf-8')
    base = Path(jobs_root) if jobs_root else None
    if base:
        base.mkdir(parents=True, exist_ok=True)
    job = Path(tempfile.mkdtemp(prefix='studio-job-', dir=base))
    try:
        (job / 'input').mkdir()
        (job / 'output').mkdir()
        (job / 'input/request.json').write_bytes(raw)
        interpreter = os.environ.get('CABLE_STUDIO_PYTHON') or sys.executable
        launched = perf_counter()
        try:
            process = subprocess.run(
                [interpreter, '-I', str(root / data['runtime']['entry'])], cwd=job, env=minimal_environment(job),
                timeout=data['resources']['timeout_s'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except subprocess.TimeoutExpired:
            raise CoreError('TIMEOUT', f'{plugin_id} 超过 {data["resources"]["timeout_s"]} s 时间上限，进程已终止。') from None
        except OSError as error:
            raise CoreError('PROCESS_LAUNCH_FAILED', f'无法启动计算进程：{error}') from None
        process_ms = (perf_counter() - launched) * 1000
        result_path = job / 'output/result.json'
        if process.returncode != 0 or not result_path.is_file():
            detail = process.stderr.decode('utf-8', 'replace')[-STDERR_LIMIT:].strip()
            raise CoreError('PLUGIN_CRASHED', f'{plugin_id} 退出码 {process.returncode}，未写出有效结果。{detail}')
        done = _accept(job, spec, [case['case_id'] for case in accepted], phase)
        by_id = {**rejected, **{case['case_id']: case for case in done['cases']}}
        return {**identity, 'request_sha256': sha256(raw).hexdigest(),
                'environment': {**done['environment'], 'executed': True, 'isolation': 'process',
                                'process_ms': process_ms, 'total_ms': (perf_counter() - started) * 1000},
                'cases': [by_id[i] for i in ids]}
    finally:
        shutil.rmtree(job, ignore_errors=True)


def _accept(job, spec, ids, phase):
    result_path = job / 'output/result.json'
    if result_path.stat().st_size > MAX_RESULT_BYTES:
        raise _violation('result.json 超过大小上限')
    try:
        payload = _load(result_path)
    except ValueError as error:
        raise _violation(f'result.json 不是有效 JSON：{error}') from None
    if not isinstance(payload, dict) or payload.get('protocol') != PROTOCOL or not isinstance(payload.get('cases'), list):
        raise _violation('result.json 协议或结构不符')
    by_id = {case.get('case_id'): case for case in payload['cases'] if isinstance(case, dict)}
    if sorted(by_id, key=str) != sorted(ids) or len(payload['cases']) != len(ids):
        raise _violation('返回的工况与请求不一致')
    declared = {(output['key'], output['type']): output for output in spec['outputs']}
    artifact_types = {artifact['type']: artifact for artifact in spec['artifacts']}
    cases = []
    for case_id in ids:
        case = by_id[case_id]
        status = case.get('status')
        if status not in STATUSES:
            raise _violation(f'{case_id}: 未知状态 {status}')
        results, refs = case.get('results', []), case.get('artifacts', [])
        warnings, evidence = case.get('warnings', []), case.get('evidence', {})
        if any(not isinstance(group, list) for group in (results, refs, warnings)) or not isinstance(evidence, dict):
            raise _violation(f'{case_id}: results/artifacts/warnings 必须是数组，evidence 必须是对象')
        if status != 'succeeded':
            error = case.get('error')
            if not isinstance(error, dict) or any(not isinstance(error.get(k), str) or not error[k].strip() for k in ('code', 'message')):
                raise _violation(f'{case_id}: 失败必须带 code 与 message')
            if results or refs:
                raise _violation(f'{case_id}: 失败工况不得返回数值结果或工件')
            cases.append({'case_id': case_id, 'status': status, 'results': [], 'artifacts': {}, 'artifact_digests': {},
                          'warnings': warnings, 'evidence': evidence,
                          'error': {k: error[k] for k in ('code', 'message', 'path', 'field', 'issues') if k in error}})
            continue
        if phase == 'check':
            if results or refs:
                raise _violation('预检不得返回计算结果或工件')
            cases.append({'case_id': case_id, 'status': status, 'results': [], 'artifacts': {}, 'artifact_digests': {},
                          'warnings': warnings, 'evidence': evidence})
            continue
        seen = set()
        for row in results:
            if any(not isinstance(row.get(k), str) or not row[k].strip() for k in ('key', 'type', 'entity', 'unit')):
                raise _violation(f'{case_id}: 输出键、类型、实体与单位必须是非空字符串')
            if (row['key'], row['type']) not in declared:
                raise _violation(f'{case_id}: 未声明的输出 {row["key"]}/{row["type"]}')
            ident = (row['key'], row['type'], row['entity'], row.get('case'))
            if ident in seen:
                raise _violation(f'{case_id}: 输出重复 {ident}')
            seen.add(ident)
            if row.get('status') == 'available':
                value = row.get('value')
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value):
                    raise _violation(f'{case_id}: {row["key"]} 不是有限数值')
            elif row.get('status') == 'unavailable':
                reason = row.get('reason')
                if 'value' in row or not isinstance(reason, dict) or not reason.get('code') or not reason.get('message'):
                    raise _violation(f'{case_id}: 不可用结果不得带数值，且必须给出原因')
            else:
                raise _violation(f'{case_id}: 结果状态非法')
        present = {(row['key'], row['type']) for row in results}
        missing = [key for key, output in declared.items() if output['required'] and key not in present]
        if missing:
            raise _violation(f'{case_id}: 缺少必需输出 {missing}')
        artifacts, digests = {}, {}
        for ref in refs:
            kind, rel = ref.get('type'), ref.get('path', '')
            if kind not in artifact_types or kind in artifacts:
                raise _violation(f'{case_id}: 未声明或重复的工件类型 {kind}')
            target = (job / rel).resolve()
            if not rel.startswith('output/') or not target.is_relative_to((job / 'output').resolve()) or not target.is_file():
                raise _violation(f'{case_id}: 工件路径越界或不存在 {rel}')
            if target.stat().st_size > MAX_RESULT_BYTES:
                raise _violation(f'{case_id}: 工件超过大小上限')
            try:
                artifacts[kind] = _load(target)
            except ValueError:
                raise _violation(f'{case_id}: 工件 {kind} 不是 JSON') from None
            digests[kind] = sha256(target.read_bytes()).hexdigest()
        missing = [kind for kind, artifact in artifact_types.items() if artifact['required'] and kind not in artifacts]
        if missing:
            raise _violation(f'{case_id}: 缺少必需工件 {missing}')
        cases.append({'case_id': case_id, 'status': status, 'results': results, 'artifacts': artifacts,
                      'artifact_digests': digests, 'warnings': warnings, 'evidence': evidence})
    environment = payload.get('environment', {})
    return {'cases': cases, 'environment': environment if isinstance(environment, dict) else {}}
