"""Curated local plugin lifecycle, exact project locks and durable execution.

Only bundled, reviewed handlers are allowed. This is not an untrusted-code sandbox
or a remote package installer. Existing compatibility APIs remain host-owned.
"""
from __future__ import annotations

import asyncio
import importlib.metadata
import json
import os
import re
import subprocess
import sys
from hashlib import sha256
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import Field, ValidationError, field_validator
from starlette.concurrency import run_in_threadpool
from ..foundation.contracts import Contract, Digest, PayloadFile, content_hash
from ..foundation.study import prepare_study
from ..runtime import Invocation
from ..workbench import stamp
from .arguments import ARGUMENTS, SOURCE_FILES
from .catalog import Catalog, PluginError
from .contracts import PluginId, ReleaseVersion, PluginPin, ProjectPluginLock, Permission


class ApprovalContract(Contract):
    @field_validator("approved", "confirmed", mode="before", check_fields=False)
    @classmethod
    def explicit_boolean(cls, value):
        if type(value) is not bool:
            raise ValueError("EXPLICIT_BOOLEAN_REQUIRED")
        return value


class InstallRequest(ApprovalContract):
    plugin_id: PluginId
    version: ReleaseVersion


class InstallApproval(InstallRequest):
    plan_sha256: Digest
    state_revision: int = Field(ge=0, strict=True)
    approved: Literal[True]
    license_acknowledged: bool = Field(strict=True)
    grants: dict[str, tuple[Permission, ...]]


class ProjectApproval(ApprovalContract):
    plugin_id: PluginId
    expected_revision: int = Field(ge=1, strict=True)
    lock_revision: int = Field(ge=0, strict=True)
    enabled: bool = Field(strict=True)
    approved: Literal[True]


class UninstallRequest(ApprovalContract):
    plugin_id: PluginId
    state_revision: int = Field(ge=0, strict=True)
    approved: Literal[True]


class PluginInvocation(ApprovalContract):
    plugin_id: PluginId
    command: str = Field(min_length=1, max_length=100)
    request_id: UUID
    expected_revision: int = Field(ge=1, strict=True)
    lock_sha256: Digest
    arguments: dict = Field(default_factory=dict)
    confirmed: Literal[True]


OUTPUTS = {
    'skfem.buried-reference': {'buried.msh', 'temperature.vtu', 'thermal.json', 'field.json'},
    'cadquery.cable-step': {'cable.step', 'geometry.json'},
    'gmsh.cable-section': {'section.msh', 'mesh.json'},
    'meshio.to-vtu': {'section.vtu'},
    'skfem.radial-thermal': {'temperature.vtu', 'thermal.json', 'field.json'},
    'pyvista.field-summary': {'isotherm.vtp', 'field-summary.json'},
}


def safe_environment(directory: Path) -> dict[str, str]:
    # Allowlist, not a blacklist of known credential names. No inherited provider
    # keys, database paths, proxy variables, PYTHONPATH or startup hooks.
    result = {key: os.environ[key] for key in ('PATH', 'SYSTEMROOT', 'WINDIR') if key in os.environ}
    result.update(HOME=str(directory), USERPROFILE=str(directory), TMP=str(directory), TEMP=str(directory),
                  TMPDIR=str(directory), PYTHONIOENCODING='utf-8', OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1')
    return result


class PluginService:
    def __init__(self, store, runtime, catalog: Catalog | None = None):
        self.store, self.runtime = store, runtime
        self.catalog = catalog or Catalog()
        self.directory = Path(store.path).parent / 'plugin-artifacts'
        self.worker_timeout = 120

    def initialize(self):
        with self.store.db(True) as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS plugin_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL);
            INSERT OR IGNORE INTO plugin_state VALUES (1,0);
            CREATE TABLE IF NOT EXISTS plugin_installed (
              plugin_id TEXT PRIMARY KEY, version TEXT NOT NULL, release_sha256 TEXT NOT NULL, grants TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS plugin_project_state (workspace TEXT PRIMARY KEY, revision INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS plugin_project_pins (
              workspace TEXT NOT NULL, plugin_id TEXT NOT NULL, pin TEXT NOT NULL, PRIMARY KEY(workspace,plugin_id));
            CREATE TABLE IF NOT EXISTS plugin_audit (
              id INTEGER PRIMARY KEY, workspace TEXT, action TEXT NOT NULL, details TEXT NOT NULL, created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS plugin_jobs (
              workspace TEXT NOT NULL, id TEXT NOT NULL, plugin_id TEXT NOT NULL, command TEXT NOT NULL,
              request_hash TEXT NOT NULL, status TEXT NOT NULL, context TEXT NOT NULL,
              output TEXT, created TEXT NOT NULL, finished TEXT, PRIMARY KEY(workspace,id));
            ''')
            # Single application owner per DB. Do not silently restart a previously
            # running native process after the application itself restarts.
            db.execute("UPDATE plugin_jobs SET status='interrupted',finished=? WHERE status='running'", (stamp(),))

    @staticmethod
    def _revision(db):
        return db.execute('SELECT revision FROM plugin_state WHERE id=1').fetchone()[0]

    @staticmethod
    def _lock_revision(db, wid):
        row = db.execute('SELECT revision FROM plugin_project_state WHERE workspace=?', (wid,)).fetchone()
        return row[0] if row else 0

    @staticmethod
    def _audit(db, action, details, wid=None):
        db.execute('INSERT INTO plugin_audit(workspace,action,details,created) VALUES (?,?,?,?)',
                   (wid, action, json.dumps(details, ensure_ascii=False), stamp()))

    @staticmethod
    def _pin(m):
        return PluginPin(plugin_id=m.plugin_id, version=m.version, release_sha256=m.digest(), permissions=m.permissions)

    def _lock(self, db, wid, revision):
        pins = [self._pin(m) for m in self.catalog.manifests if m.distribution == 'core']
        pins.extend(PluginPin.model_validate_json(row[0]) for row in db.execute(
            'SELECT pin FROM plugin_project_pins WHERE workspace=? ORDER BY plugin_id', (wid,)))
        return ProjectPluginLock(project_id=wid, project_revision=revision, lock_revision=self._lock_revision(db, wid),
                                 plugins=tuple(sorted(pins, key=lambda p: p.plugin_id)))

    def project_lock(self, wid):
        with self.store.db() as db:
            db.execute('BEGIN')
            row, _ = self.store.load(db, wid)
            lock = self._lock(db, wid, row['revision'])
        return {'lock': lock.model_dump(mode='json'), 'lock_sha256': lock.digest()}

    def catalog_view(self):
        with self.store.db() as db:
            db.execute('BEGIN')
            revision = self._revision(db)
            installed = {r['plugin_id']: dict(r) for r in db.execute('SELECT * FROM plugin_installed')}
        items = []
        for m in self.catalog.manifests:
            integrity = None
            if m.distribution != 'roadmap':
                try:
                    self.catalog.verify(m)
                    integrity = True
                except PluginError:
                    integrity = False
            current = installed.get(m.plugin_id)
            exact = current is not None and current['version'] == m.version and current['release_sha256'] == m.digest()
            env = self.catalog.environment(m)
            items.append({'manifest': m.model_dump(mode='json'), 'release_sha256': m.digest(),
                          'installed': m.distribution == 'core' or exact,
                          'installed_version': current['version'] if current else None,
                          'integrity_ok': integrity, 'runtime': env,
                          'installable': m.distribution == 'bundled-adapter' and integrity is True,
                          'status': 'roadmap' if m.distribution == 'roadmap' else 'integrity-error' if not integrity
                          else 'host-builtin' if m.distribution == 'core' else 'installed' if exact else 'available'})
        return {'schema_version': 'cablesim.catalog/1', 'catalog_sha256': self.catalog.digest,
                'state_revision': revision, 'mode': 'curated-local', 'items': items,
                'security': {'remote_installation': False, 'untrusted_execution': False, 'os_sandbox': False,
                             'publisher_signature_verified': False, 'public_market_deployed': False}}

    def _plan(self, db, request):
        closure = self.catalog.closure(request.plugin_id, request.version)
        for m in closure:
            self.catalog.verify(m)
            current = db.execute('SELECT * FROM plugin_installed WHERE plugin_id=?', (m.plugin_id,)).fetchone()
            if current and current['version'] == m.version and current['release_sha256'] != m.digest():
                raise PluginError('IMMUTABLE_RELEASE', '同版本已安装字节与目录不同，不能覆盖；请发布新版本。', 409)
        body = {'plugin_id': request.plugin_id, 'version': request.version,
                'state_revision': self._revision(db), 'catalog_sha256': self.catalog.digest,
                'plugins': [self._pin(m).model_dump(mode='json') for m in closure],
                'license_review_required': any(m.license_review_required for m in closure),
                'runtime_requirements': sorted({f'{r.distribution}=={r.version}' for m in closure for r in m.requirements}),
                'action': 'register-bundled-adapters-only', 'downloads_or_executes_code': False}
        return dict(body, plan_sha256=content_hash(body))

    def plan(self, request: InstallRequest):
        with self.store.db() as db:
            db.execute('BEGIN')
            return self._plan(db, request)

    def install(self, request: InstallApproval):
        with self.store.db(True) as db:
            plan = self._plan(db, request)
            if plan['state_revision'] != request.state_revision or plan['plan_sha256'] != request.plan_sha256:
                raise PluginError('STALE_INSTALL_PLAN', '安装计划或目录已变化，请重新审查。', 409)
            wanted = {p['plugin_id']: sorted(p['permissions']) for p in plan['plugins']}
            if {k: sorted(v) for k, v in request.grants.items()} != wanted:
                raise PluginError('PERMISSION_CONSENT', '必须逐项确认完整依赖闭包的准确权限。', 403)
            if plan['license_review_required'] and not request.license_acknowledged:
                raise PluginError('LICENSE_ACK_REQUIRED', '须确认上游许可与分发限制；这不是法律许可授权。', 403)
            for p in plan['plugins']:
                m = self.catalog.get(p['plugin_id'])
                if m.distribution == 'core':
                    continue
                db.execute('INSERT OR REPLACE INTO plugin_installed VALUES (?,?,?,?)',
                           (p['plugin_id'], p['version'], p['release_sha256'], json.dumps(p['permissions'])))
            db.execute('UPDATE plugin_state SET revision=revision+1 WHERE id=1')
            self._audit(db, 'install', plan)
        return self.catalog_view()

    def uninstall(self, request: UninstallRequest):
        m = self.catalog.get(request.plugin_id)
        if m.distribution == 'core':
            raise PluginError('HOST_OWNED', '内建能力由宿主管理，兼容 API 不通过本页卸载。', 409)
        with self.store.db(True) as db:
            if self._revision(db) != request.state_revision:
                raise PluginError('STALE_STATE', '插件状态已改变。', 409)
            if db.execute('SELECT 1 FROM plugin_project_pins WHERE plugin_id=?', (m.plugin_id,)).fetchone():
                raise PluginError('PROJECT_DEPENDENCY', '仍有项目锁定这个插件；先在项目中停用。', 409)
            installed = {row[0] for row in db.execute('SELECT plugin_id FROM plugin_installed')}
            for other in self.catalog.manifests:
                if other.plugin_id in installed and any(d.plugin_id == m.plugin_id for d in other.dependencies):
                    raise PluginError('INSTALLED_DEPENDENCY', '已安装插件仍依赖这个版本。', 409)
            db.execute('DELETE FROM plugin_installed WHERE plugin_id=?', (m.plugin_id,))
            db.execute('UPDATE plugin_state SET revision=revision+1 WHERE id=1')
            self._audit(db, 'uninstall-retain-artifacts', {'plugin_id': m.plugin_id})
        return self.catalog_view()

    def enable(self, wid, request: ProjectApproval):
        m = self.catalog.get(request.plugin_id)
        if m.distribution == 'core':
            raise PluginError('HOST_OWNED', '内建能力无需重复启用。', 409)
        self.catalog.verify(m)
        closure = self.catalog.closure(m.plugin_id, m.version)
        with self.store.db(True) as db:
            self.store.load(db, wid, request.expected_revision)
            if self._lock_revision(db, wid) != request.lock_revision:
                raise PluginError('STALE_LOCK', '项目插件锁已改变。', 409)
            if db.execute("SELECT 1 FROM plugin_jobs WHERE workspace=? AND status='running'", (wid,)).fetchone():
                raise PluginError('JOB_RUNNING', '当前项目有执行任务，暂不能改变插件锁。', 409)
            if request.enabled:
                for item in closure:
                    self.catalog.verify(item)
                    if item.distribution == 'core':
                        continue
                    installed = db.execute('SELECT * FROM plugin_installed WHERE plugin_id=?', (item.plugin_id,)).fetchone()
                    if not installed or installed['version'] != item.version or installed['release_sha256'] != item.digest():
                        raise PluginError('NOT_INSTALLED', '请先审查并安装准确的插件依赖版本。', 409)
                    if sorted(json.loads(installed['grants'])) != sorted(item.permissions):
                        raise PluginError('GRANT_CHANGED', '权限不完整，请重新审查。', 403)
                    previous = db.execute('SELECT pin FROM plugin_project_pins WHERE workspace=? AND plugin_id=?', (wid,item.plugin_id)).fetchone()
                    if previous and PluginPin.model_validate_json(previous['pin']) != self._pin(item):
                        raise PluginError('PIN_MIGRATION_REQUIRED', '项目仍锁定旧发行版；先核对并显式停用，再启用新版本。', 409)
                    db.execute('INSERT OR REPLACE INTO plugin_project_pins VALUES (?,?,?)',
                               (wid, item.plugin_id, self._pin(item).model_dump_json()))
            else:
                for row in db.execute('SELECT plugin_id FROM plugin_project_pins WHERE workspace=?', (wid,)):
                    other = self.catalog.get(row[0])
                    if any(d.plugin_id == m.plugin_id for d in other.dependencies):
                        raise PluginError('PROJECT_DEPENDENCY', '项目内仍有其他插件依赖此项。', 409)
                db.execute('DELETE FROM plugin_project_pins WHERE workspace=? AND plugin_id=?', (wid, m.plugin_id))
            db.execute('INSERT INTO plugin_project_state VALUES (?,1) ON CONFLICT(workspace) DO UPDATE SET revision=revision+1', (wid,))
            self._audit(db, 'enable' if request.enabled else 'disable', {'plugin_id': m.plugin_id}, wid)
        return self.project_lock(wid)

    def _register(self, wid, request, args):
        request_hash = content_hash(request)
        tid = str(request.request_id)
        m = self.catalog.get(request.plugin_id)
        self.catalog.verify(m)
        if not any(c.id == request.command for c in m.commands):
            raise PluginError('COMMAND_NOT_OWNED', '命令不属于这个插件。', 403)
        with self.store.db(True) as db:
            existing = db.execute('SELECT * FROM plugin_jobs WHERE workspace=? AND id=?', (wid, tid)).fetchone()
            if existing:
                if existing['request_hash'] != request_hash:
                    raise PluginError('REQUEST_ID_REUSED', '同一请求标识不能代表不同操作。', 409)
                if existing['status'] == 'running':
                    raise PluginError('JOB_RUNNING', '同一任务正在执行，不重复启动。', 409)
                return None, dict(existing)
            row, state = self.store.load(db, wid, request.expected_revision)
            lock = self._lock(db, wid, row['revision'])
            if request.lock_sha256 != lock.digest():
                raise PluginError('STALE_LOCK', '插件锁或工程版本已变化，请重新检查。', 409)
            pinned = next((p for p in lock.plugins if p.plugin_id == m.plugin_id), None)
            if pinned != self._pin(m):
                raise PluginError('PLUGIN_NOT_ENABLED', '项目没有启用这个准确版本。', 409)
            for dependency in self.catalog.closure(m.plugin_id, m.version):
                self.catalog.verify(dependency)
                if self._pin(dependency) not in lock.plugins:
                    raise PluginError('DEPENDENCY_NOT_ENABLED', '项目缺少准确依赖锁。', 409)
            environment = self.catalog.environment(m)
            if not environment['metadata_ready']:
                raise PluginError('RUNTIME_MISSING', '缺少准确运行环境：' + ', '.join(environment['missing']), 409)
            if request.command == 'skfem.buried-reference' and (state.get('design_basis') or {}).get('environment', 'buried') != 'buried':
                raise PluginError('METHOD_SCOPE', '当前设计依据不是直埋工况，不能运行直埋热研究。', 409)
            snapshot = dict(state, id=wid, revision=row['revision'])
            package = prepare_study(snapshot).package
            context = {'plugin': self._pin(m).model_dump(mode='json'), 'command': request.command,
                       'project_revision': row['revision'], 'lock_sha256': lock.digest(),
                       'source_sha256': package.source_sha256, 'recipe': package.geometry_recipe.model_dump(mode='json'),
                       'scenario': state['scenario'], 'arguments': args,
                       'runtime_versions': environment['versions']}
            if request.command in SOURCE_FILES:
                filename, producer = SOURCE_FILES[request.command]
                source = db.execute('SELECT * FROM plugin_jobs WHERE workspace=? AND id=?', (wid, args['source_job_id'])).fetchone()
                if not source or source['status'] != 'succeeded' or source['command'] != producer:
                    raise PluginError('SOURCE_JOB', '来源必须是本项目成功运行的对应网格或场工件。', 409)
                source_context = json.loads(source['context'])
                if source_context['source_sha256'] != context['source_sha256']:
                    raise PluginError('STALE_SOURCE', '来源几何/材料/工程版本已过期，不能混用旧网格。', 409)
                if source_context['plugin'] not in [p.model_dump(mode='json') for p in lock.plugins]:
                    raise PluginError('SOURCE_RELEASE', '来源插件版本不在当前锁中。', 409)
                output = json.loads(source['output'])
                item = next((a for a in output['artifacts'] if a['path'] == filename), None)
                if item is None:
                    raise PluginError('SOURCE_ARTIFACT', '来源缺少必要工件。', 409)
                context['source_artifact'] = dict(item, job_id=source['id'])
            db.execute('INSERT INTO plugin_jobs VALUES (?,?,?,?,?,?,?,?,?,?)',
                       (wid, tid, m.plugin_id, request.command, request_hash, 'running',
                        json.dumps(context, ensure_ascii=False), None, stamp(), None))
        return context, None

    def _artifact_path(self, wid, tid, item):
        # UUIDs and payload paths are independently validated; never accept a client
        # filesystem path. Hash checked on each download and upstream handoff.
        wid, tid = str(UUID(wid)), str(UUID(tid))
        validated = PayloadFile.model_validate({k: item[k] for k in ('path', 'sha256', 'size_bytes')})
        directory = (self.directory / wid / tid).resolve()
        path = directory / validated.path
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(directory):
            raise PluginError('ARTIFACT_PATH', '工件路径无效。', 409)
        if path.stat().st_size != validated.size_bytes or sha256(path.read_bytes()).hexdigest() != validated.sha256:
            raise PluginError('ARTIFACT_INTEGRITY', '工件字节已改变，不继续处理。', 409)
        return path

    def _worker(self, wid, tid, context):
        directory = self.directory / str(UUID(wid)) / str(UUID(tid))
        directory.mkdir(parents=True, exist_ok=False)
        if 'source_artifact' in context:
            item = context['source_artifact']
            source = self._artifact_path(wid, item['job_id'], item)
            (directory / 'input').mkdir()
            (directory / 'input' / item['path']).write_bytes(source.read_bytes())
        m = self.catalog.get(context['plugin']['plugin_id'])
        payload = {k: context[k] for k in ('command', 'recipe', 'scenario', 'arguments')}
        payload['distributions'] = [r.distribution for r in m.requirements]
        raw = json.dumps(payload, allow_nan=False).encode('utf-8')
        if len(raw) > 2 * 1024 * 1024:
            raise PluginError('INPUT_SIZE', '插件输入超过上限。')
        try:
            # Logs are discarded here: provider credentials never reach this process,
            # and raw native tracebacks are not reflected into the browser.
            run = subprocess.run([sys.executable, '-I', str(self.catalog.root / 'backend/plugins/worker.py')],
                                 input=raw, cwd=directory, env=safe_environment(directory),
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=self.worker_timeout,
                                 check=False)
        except subprocess.TimeoutExpired:
            raise PluginError('WORKER_TIMEOUT', '原生执行超过时间上限，进程已终止。', 504) from None
        response = directory / 'response.json'
        if run.returncode or not response.is_file() or response.stat().st_size > 2 * 1024 * 1024:
            raise PluginError('WORKER_FAILED', '原生适配器失败或运行库无法加载；未产生可信结果。')
        result = json.loads(response.read_text('utf-8'))
        json.dumps(result, allow_nan=False)
        names = result.pop('files')
        if len(names) != len(set(names)) or set(names) != OUTPUTS[context['command']]:
            raise PluginError('OUTPUT_CONTRACT', '插件输出与声明不符。')
        artifacts = []
        for name in names:
            path = directory / name
            if path.is_symlink() or not path.is_file() or path.stat().st_size > 32 * 1024 * 1024:
                raise PluginError('OUTPUT_LIMIT', '插件工件缺失、越界或过大。')
            item = PayloadFile(path=name, sha256=sha256(path.read_bytes()).hexdigest(), size_bytes=path.stat().st_size)
            artifacts.append(item.model_dump(mode='json'))
        if context['command'] == 'skfem.radial-thermal':
            from .field_contract import validate_thermal_projection
            try:
                validate_thermal_projection(json.loads((directory/'field.json').read_text('utf-8')), result['summary'])
            except (ValueError, KeyError, TypeError):
                raise PluginError('FIELD_CONTRACT', '温度场的网格、单位、节点数量或摘要不一致。') from None
        if context['command'] == 'skfem.buried-reference':
            from .buried_contract import validate_buried_projection
            try:
                field = validate_buried_projection(json.loads((directory/'field.json').read_text('utf-8')), result['summary'])
                expected = context['arguments']
                saved = context['scenario']['installation']
                summary = result['summary']
                if (summary['source_powers_w_m'] != expected['conductor_powers_w_m'] or
                    summary['domain_scale'] != expected['domain_scale'] or
                    summary['resolution'] != expected['resolution'] or
                    summary['ambient_temperature_c'] != saved['ambient_temperature_c'] or
                    abs(summary['soil_k_w_m_k']-1/saved['soil_rho_k_m_w']) > 1e-12):
                    raise ValueError('FIELD_INPUT_BINDING')
                from ..schemas import Scenario
                original = Scenario.model_validate(context['scenario'])
                if (field.cable_centers_m != tuple(tuple(p) for p in original.installation.positions_m()) or
                    abs(field.cable_outer_radius_m-original.cable.radii_mm()[-1]/1000) > 1e-12):
                    raise ValueError('FIELD_GEOMETRY_BINDING')
            except (ValueError, KeyError, TypeError):
                raise PluginError('FIELD_CONTRACT', '直埋场工件的分域、边界、热量或温度摘要不一致。') from None
        result['artifacts'] = artifacts
        return result

    def _finish(self, wid, tid, request, context, result):
        with self.store.db(True) as db:
            row, _ = self.store.load(db, wid)
            stale = row['revision'] != request.expected_revision or self._lock(db, wid, row['revision']).digest() != request.lock_sha256
            envelope = {'job_id': tid, 'plugin': context['plugin'], 'command': request.command,
                        'project_revision': request.expected_revision, 'source_sha256': context['source_sha256'],
                        'lock_sha256': request.lock_sha256, 'status': 'stale' if stale else 'succeeded',
                        'result': result, 'artifacts': result.get('artifacts', []),
                        'promoted_to_current_ampacity': False}
            db.execute('UPDATE plugin_jobs SET status=?,output=?,finished=? WHERE workspace=? AND id=?',
                       (envelope['status'], json.dumps(envelope, ensure_ascii=False, allow_nan=False), stamp(), wid, tid))
        return envelope

    async def invoke(self, wid, request: PluginInvocation):
        m = self.catalog.get(request.plugin_id)
        if m.distribution == 'roadmap':
            raise PluginError('NOT_IMPLEMENTED', '此插件尚未实现。', 409)
        try:
            if m.runtime == 'host':
                cap = self.runtime.capabilities.get(request.command)
                if cap is None:
                    raise PluginError('UNKNOWN_COMMAND', '未注册的宿主命令。')
                args = cap.schema.model_validate(request.arguments).model_dump(mode='json')
            else:
                cls = ARGUMENTS.get(request.command)
                if cls is None:
                    raise PluginError('UNKNOWN_COMMAND', '不允许执行未审核入口。')
                args = cls.model_validate(request.arguments).model_dump(mode='json')
        except ValidationError:
            raise PluginError('INVALID_ARGUMENTS', '参数不符合插件命令契约，请核对字段、单位和范围。') from None
        context, saved = await run_in_threadpool(self._register, wid, request, args)
        if saved is not None:
            if saved['status'] in ('succeeded', 'stale'):
                return dict(json.loads(saved['output']), replayed=True)
            raise PluginError('TERMINAL_JOB', '该请求已失败或中断，修正后须使用新请求标识。', 409)
        tid = str(request.request_id)
        try:
            if m.runtime == 'host':
                # Preserve legacy CAS/approval/idempotency; registry does NOT call a
                # second implementation of the solver or directly write scenarios.
                result = await self.runtime.invoke(wid, Invocation(capability=request.command,
                    request_id=request.request_id, expected_revision=request.expected_revision, arguments=args))
            else:
                result = await run_in_threadpool(self._worker, wid, tid, context)
            return await run_in_threadpool(self._finish, wid, tid, request, context, result)
        except Exception as exc:
            code = exc.code if isinstance(exc, PluginError) else 'EXECUTION_FAILED'
            def fail():
                with self.store.db(True) as db:
                    db.execute("UPDATE plugin_jobs SET status='failed',output=?,finished=? WHERE workspace=? AND id=?",
                               (json.dumps({'code': code}), stamp(), wid, tid))
            await run_in_threadpool(fail)
            if isinstance(exc, PluginError):
                raise
            raise PluginError(code, '执行失败；未自动放宽条件或批准工程变更。') from None

    def jobs(self, wid):
        with self.store.db() as db:
            self.store.load(db, wid)
            rows = db.execute('SELECT id,plugin_id,command,status,created,finished,output FROM plugin_jobs WHERE workspace=? ORDER BY rowid DESC LIMIT 100', (wid,))
            return {'items': [dict(row, output=json.loads(row['output']) if row['output'] else None) for row in rows]}

    def artifact(self, wid, tid, name):
        UUID(wid); UUID(tid)
        with self.store.db() as db:
            self.store.load(db, wid)
            row = db.execute('SELECT * FROM plugin_jobs WHERE workspace=? AND id=?', (wid, tid)).fetchone()
            if not row or row['status'] not in ('succeeded', 'stale'):
                raise PluginError('ARTIFACT_NOT_FOUND', '这个工程中没有可读取的成功工件。', 404)
            item = next((a for a in json.loads(row['output'])['artifacts'] if a['path'] == name), None)
            if item is None:
                raise PluginError('ARTIFACT_NOT_FOUND', '工件不存在。', 404)
        return self._artifact_path(wid, tid, item)
