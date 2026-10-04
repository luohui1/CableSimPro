"""Saved studies and snapshot execution. SQLite transactions never include a solver.

JSON artifacts are sealed in the same transaction as results, avoiding a split commit
between a file store and SQLite. The original worker-file digests remain provenance;
the canonical stored payload has its own integrity digest.
"""
from dataclasses import asdict
from copy import deepcopy
import json
import os
import platform
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError

from .. import __version__
from ..plugin_host import Executor, PluginHostError
from ..plugin_host.registry import Registry
from ..plugin_host.executor import CaseResult, current_platform
from ..workbench import fingerprint, stamp
from .contracts import LossArtifactReference, StudyConfiguration, StudyDefinition
from .drivers import assess, cases_for, compare, crosscheck_differences


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


class Research:
    def __init__(self, store, plugins, executor=None):
        self.store, self.plugins = store, plugins
        self.executor = executor or Executor()
        self.owner_epoch = str(uuid4())

    def initialize(self):
        with self.store.db(True) as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS studies (
              id TEXT PRIMARY KEY, workspace TEXT NOT NULL, revision INTEGER NOT NULL,
              FOREIGN KEY(workspace) REFERENCES workspaces(id));
            CREATE TABLE IF NOT EXISTS study_versions (
              study TEXT NOT NULL, revision INTEGER NOT NULL, definition TEXT NOT NULL, created TEXT NOT NULL,
              PRIMARY KEY(study, revision), FOREIGN KEY(study) REFERENCES studies(id));
            CREATE TABLE IF NOT EXISTS study_runs (
              sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
              workspace TEXT NOT NULL, study TEXT NOT NULL, request_id TEXT NOT NULL,
              request_digest TEXT NOT NULL, input_digest TEXT NOT NULL, snapshot TEXT NOT NULL,
              status TEXT NOT NULL, output TEXT, output_digest TEXT, error TEXT,
              owner_epoch TEXT NOT NULL, execution_nonce TEXT NOT NULL,
              created TEXT NOT NULL, finished TEXT, UNIQUE(workspace,request_id),
              FOREIGN KEY(workspace) REFERENCES workspaces(id), FOREIGN KEY(study) REFERENCES studies(id));
            CREATE INDEX IF NOT EXISTS study_runs_page ON study_runs(workspace,study,sequence);
            CREATE TABLE IF NOT EXISTS deliveries (
              id TEXT PRIMARY KEY, workspace TEXT NOT NULL, sources TEXT NOT NULL,
              renderer TEXT NOT NULL, html TEXT NOT NULL, digest TEXT NOT NULL, created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS delivery_requests (
              workspace TEXT NOT NULL, request_id TEXT NOT NULL, run_ids TEXT NOT NULL, delivery TEXT NOT NULL,
              PRIMARY KEY(workspace,request_id));
            ''')
            # Called only after the application has acquired its exclusive owner lock.
            db.execute("UPDATE study_runs SET status='interrupted',finished=?,error=? "
                       "WHERE owner_epoch<>? AND status IN ('accepted','running','validating')",
                       (stamp(), encode({'code': 'HOST_RESTART', 'message': '旧执行未能确认完成；不会自动重算。'}), self.owner_epoch))

    def methods(self):
        return [{'method': self.pin(p), 'name': p.manifest.name, 'description': p.manifest.description,
                 'platforms': p.manifest.platforms, 'platform_supported': current_platform() in p.manifest.platforms,
                 'execution_policy': {'isolation': 'process', 'os_sandbox': False, 'timeout_enforced': True,
                                      'memory_limit_enforced': False, 'network_isolation_enforced': False,
                                      'parent_death_enforced': os.name == 'nt', 'process_tree_cleanup_enforced': os.name == 'nt'},
                 'capabilities': [c.model_dump(mode='json') for c in p.manifest.capabilities]}
                for p in Registry(self.executor.registry.root).plugins.values()]

    @staticmethod
    def pin(plugin):
        manifest = plugin.manifest
        return {'plugin_id': manifest.id, 'version': manifest.version,
                'release_digest': fingerprint(manifest.model_dump(mode='json', by_alias=True))}

    def resolve(self, method, cache=None):
        # Refresh disk metadata: an already-created executor cannot hide a package upgrade.
        # Only callers performing one read request share this cache; executions never do.
        cache = {} if cache is None else cache
        registries = cache.setdefault('registries', {})
        plugin_id = method['plugin_id']
        if plugin_id not in registries:
            registries[plugin_id] = Registry(self.executor.registry.root, plugin_id=plugin_id)
        plugin = registries[plugin_id].get(plugin_id)
        if self.pin(plugin) != {k: method[k] for k in ('plugin_id', 'version', 'release_digest')}:
            raise HTTPException(409, '方法发行已变化，请明确选择新版本并保存研究。')
        verified = cache.setdefault('verified', {})
        if plugin.manifest.id not in verified:
            try:
                plugin.verify()
                verified[plugin.manifest.id] = None
            except (PluginHostError, ValueError, OSError) as exc:
                verified[plugin.manifest.id] = exc
        if verified[plugin.manifest.id] is not None:
            raise verified[plugin.manifest.id]
        try:
            capability = plugin.manifest.capability(method['capability'])
        except KeyError:
            raise HTTPException(422, '方法没有声明该能力。') from None
        return plugin, capability

    def definition(self, db, wid, sid, expected=None):
        row = db.execute('SELECT * FROM studies WHERE workspace=? AND id=?', (wid, sid)).fetchone()
        if row is None:
            raise HTTPException(404, '研究不存在或不属于此工程。')
        if expected is not None and row['revision'] != expected:
            raise HTTPException(409, '研究版本已变化。')
        version = db.execute('SELECT * FROM study_versions WHERE study=? AND revision=?', (sid, row['revision'])).fetchone()
        return {**dict(row), 'definition': json.loads(version['definition']), 'created': version['created']}

    def save(self, wid, body, sid=None):
        definition = StudyDefinition.model_validate(body.model_dump(exclude={'expected_revision', 'expected_study_revision'}))
        prior = None
        if sid is not None:
            with self.store.db() as db:
                prior = StudyDefinition.model_validate(self.definition(db,wid,sid,body.expected_study_revision)['definition'])
        def verify_changed(config, previous):
            if previous is not None and config.model_dump()==previous.model_dump():
                return  # Preserve an unchanged historical pin while editing another module.
            self.resolve(config.method.model_dump())
            for item in config.crosschecks:
                self.resolve(item.method.model_dump())
        primary = StudyConfiguration.model_validate(definition.model_dump(exclude={'modules'}))
        previous = StudyConfiguration.model_validate(prior.model_dump(exclude={'modules'})) if prior else None
        verify_changed(primary,previous)
        for name,config in definition.modules.items():
            verify_changed(config,prior.modules.get(name) if prior else None)
        value = definition.model_dump(mode='json')
        encoded = encode(value)
        with self.store.db(True) as db:
            self.store.load(db, wid, body.expected_revision, allow_domain=True)
            self.store.assert_mutable(db, wid)
            if sid is None:
                sid, revision = str(uuid4()), 1
                db.execute('INSERT INTO studies VALUES (?,?,?)', (sid, wid, revision))
            else:
                current = self.definition(db, wid, sid, body.expected_study_revision)
                revision = current['revision'] + 1
                db.execute('UPDATE studies SET revision=? WHERE id=?', (revision, sid))
            db.execute('INSERT INTO study_versions VALUES (?,?,?,?)', (sid, revision, encoded, stamp()))
            self.store.audit(db, wid, body.expected_revision, '保存研究', sid)
            return self.definition(db, wid, sid)

    def list_studies(self, wid):
        with self.store.db() as db:
            self.store.load(db, wid)
            return [self.definition(db, wid, r[0]) for r in db.execute('SELECT id FROM studies WHERE workspace=? ORDER BY rowid', (wid,))]

    def lock(self, db, wid, revision, method):
        # Preserve the existing v1 lock verbatim, and independently bind the v2 method.
        lock = self.plugins._lock(db, wid, revision)
        value = {'project_lock': lock.model_dump(mode='json'), 'project_lock_digest': lock.digest(), 'method': method}
        return {**value, 'digest': fingerprint(value)}

    @staticmethod
    def module_definition(definition, module=None):
        if module is None:
            return definition
        selected = definition.get('modules', {}).get(module)
        if selected is None:
            raise HTTPException(422, '此研究尚未保存该模块的输入：' + module)
        return selected

    def bind_loss_artifact(self, wid, case):
        if 'external_loss_artifact' in case['parameters']:
            raise HTTPException(422, '外部损耗工件只能由已封存运行引用，不能直接替换工件正文。')
        reference = case['parameters'].get('external_loss_reference')
        if reference is None:
            return
        try:
            reference = LossArtifactReference.model_validate(reference).model_dump(mode='json')
        except ValidationError as exc:
            detail='；'.join('external_loss_reference.'+'.'.join(map(str,e['loc']))+'：'+e['msg'] for e in exc.errors())
            raise HTTPException(422,detail) from None
        try:
            source = self.get_run(wid, reference['run_id'])
        except HTTPException as exc:
            if exc.status_code==404:
                raise HTTPException(422,'external_loss_reference.run_id：来源运行不存在或不属于当前工程，请选择本工程已封存的损耗运行。') from None
            raise
        if source['integrity'] != 'verified' or source['status'] not in ('succeeded','partial'):
            raise HTTPException(422, '外部损耗来源运行未成功或完整性校验失败。')
        rows = [v for v in source['output']['cases'] if v['case_id'] == reference['case_id']]
        if len(rows) != 1 or rows[0]['status'] != 'succeeded':
            raise HTTPException(422, '外部损耗来源工况不可用。')
        row = rows[0]
        digest = row.get('artifact_digests', {}).get(reference['artifact_type'])
        if not digest or digest != reference['artifact_sha256']:
            raise HTTPException(422, 'external_loss_reference.artifact_sha256：与封存工件不一致。')
        artifact = row.get('artifacts', {}).get(reference['artifact_type'])
        if not isinstance(artifact, dict) or artifact.get('schema') != 'cablesim.loss-coefficients/1':
            raise HTTPException(422, '外部损耗工件须符合 cablesim.loss-coefficients/1。')
        if artifact.get('domain_input_sha256') != fingerprint(case['input']):
            raise HTTPException(422, '损耗工件的领域输入摘要不同，不能带入当前研究。')
        case['parameters']['external_loss_artifact'] = deepcopy(artifact)
        case['parameters']['external_loss_artifact']['resolved_source'] = {
            **reference, 'method': row.get('method') or source['snapshot']['definition']['method'],
            'source_input_digest': source['input_digest'], 'source_output_digest': source['output_digest']}

    def prepare(self, db, wid, sid, revision, study_revision, module=None):
        row, state = self.store.load(db, wid, revision, allow_domain=True)
        study = self.definition(db, wid, sid, study_revision)
        definition = self.module_definition(study['definition'], module)
        source = definition['input_source']
        if source == 'study':
            inputs = definition['method_input']
        elif source == 'domain':
            if 'domain' not in state:
                raise HTTPException(422, '工程尚未转换为领域文档。')
            inputs = state['domain']
        else:
            if 'domain' in state:
                raise HTTPException(422, '已转换工程不能用只读 v0 参数发起新研究。')
            inputs = state['scenario']
        lock = self.lock(db, wid, row['revision'], definition['method'])
        try:
            cases = cases_for(definition, inputs)
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise HTTPException(422, '扫描路径无效：' + str(exc)) from None
        for case in cases:
            self.bind_loss_artifact(wid, case)
        if source == 'domain':
            from ..domain.guards import check_locks
            for case in cases:
                check_locks(state, case['input'], case['parameters'])
                for item in definition['crosschecks']:
                    check_locks(state, case['input'], item['parameters'])
        candidates = []
        if definition['driver']['candidate_ids']:
            cases = []
            for index, cid in enumerate(definition['driver']['candidate_ids']):
                if source == 'domain':
                    from .candidates import apply, initialize, read, matches
                    initialize(db)
                    item=read(db,cid)
                    if not matches(item,definition['driver'].get('candidate_filters',{})):
                        raise HTTPException(422,'候选不在保存的电压、材料或截面范围内：'+cid)
                    if item['state']=='incomplete':
                        spec=item['payload']['specification']
                        cases.append({'case_id':f'case-{index}',
                            'input':{'schema_version':'cablesim.product-specification/1','specification':deepcopy(spec)},
                            'parameters':deepcopy(definition['parameters']),
                            'preflight_error':{'code':'CANDIDATE_DATA_MISSING',
                                'message':'请补齐'+ '、'.join(spec['missing'])+'后计算。'}})
                        candidates.append(item)
                        continue
                    if item['state']!='reviewed' and not definition['driver'].get('allow_demo_candidates'):
                        raise HTTPException(422,'候选范围只接受已核对型号；草稿须先由工程师核对：'+cid)
                    candidate=apply(inputs,item)
                    from ..domain.guards import check_locks
                    checked_state=deepcopy(state)
                    # Exact saved model bindings are replaced for this experiment only;
                    # manually locked dimensions and environmental inputs remain locked.
                    binding=checked_state.get('study_cable_reference') or {}
                    checked_state['locks']=[p for p in checked_state.get('locks',[]) if p not in binding.get('locks',[])]
                    checked_state.pop('study_cable_reference',None)
                    check_locks(checked_state,candidate,definition['parameters'])
                    cases.append({'case_id':f'case-{index}','input':candidate,'parameters':deepcopy(definition['parameters'])})
                    candidates.append(item)
                    continue
                if source != 'scenario':
                    raise HTTPException(422,'型号候选须使用保存的领域或兼容工况输入。')
                item = db.execute('SELECT * FROM catalog_entries WHERE id=?', (cid,)).fetchone()
                if item is None:
                    raise HTTPException(422, '型号候选不存在：' + cid)
                payload = json.loads(item['payload'])
                candidate = deepcopy(inputs)
                candidate['cable'] = payload['cable']
                for path in state.get('locks', []):
                    if path.startswith('cable.') and candidate['cable'].get(path[6:]) != inputs['cable'].get(path[6:]):
                        raise HTTPException(422, '型号候选改变锁定参数：' + path)
                cases.append({'case_id': f'case-{index}', 'input': candidate, 'parameters': definition['parameters']})
                candidates.append({'id': cid, 'state': item['state'], 'payload': payload, 'digest': fingerprint(payload)})
        # Experiments must obey the same project locks as edits.
        for sample in definition['driver']['samples']:
            for pointer in sample['changes']:
                if source == 'scenario' and pointer.startswith('/input/'):
                    path = pointer[len('/input/'):].replace('/', '.')
                    if path in state.get('locks', []):
                        raise HTTPException(422, '研究不能扫描锁定参数：' + path)
        result = {'workspace_id': wid, 'workspace_revision': row['revision'], 'study_id': sid,
                'study_revision': study['revision'], 'definition': definition, 'workspace_state': state,
                'lock': lock, 'cases': cases, 'candidate_snapshots': candidates, 'host_version': __version__,
                'planned_environment': {'python': platform.python_version(), 'platform': platform.system()}}
        if module is not None:
            result.update(module=module, study_definition=study['definition'])
        return result

    def check_cases(self, plugin, capability, cases):
        from ..domain.models import DomainDocument
        checked, valid = {}, []
        for case in cases:
            if case.get('preflight_error'):
                checked[case['case_id']]=CaseResult(case['case_id'],'failed',error=case['preflight_error'])
                continue
            try:
                if case['input'].get('schema_version') == 'cablesim.domain/1':
                    DomainDocument.model_validate(case['input'])
            except ValidationError as exc:
                message = '；'.join('.'.join(map(str, e['loc'])) + ': ' + e['msg'] for e in exc.errors()[:20])
                checked[case['case_id']] = CaseResult(case['case_id'], 'failed',
                                                     error={'code': 'DOMAIN_INVALID', 'message': message})
            else:
                valid.append(case)
        if valid:
            result = self.executor.check(plugin.manifest.id, capability.id, valid, expected_manifest=plugin.manifest)
            checked.update({c.case_id: c for c in result.cases})
        return [checked[c['case_id']] for c in cases]

    def preflight(self, wid, sid, revision, study_revision, module=None):
        with self.store.db() as db:
            db.execute('BEGIN')
            snapshot = self.prepare(db, wid, sid, revision, study_revision, module)
        plugin, capability = self.resolve(snapshot['definition']['method'])
        checked = self.check_cases(plugin, capability, snapshot['cases'])
        comparisons = []
        scopes = [{'method': snapshot['definition']['method'], 'limitations': capability.limitations,
                   'validation': capability.validation.model_dump(mode='json')}]
        runnable = {c.case_id for c in checked if c.status == 'succeeded'}
        for index, item in enumerate(snapshot['definition']['crosschecks'], 1):
            other, other_capability = self.resolve(item['method'])
            scopes.append({'method': item['method'], 'limitations': other_capability.limitations,
                           'validation': other_capability.validation.model_dump(mode='json')})
            cases = [{**c, 'parameters': item['parameters']} for c in snapshot['cases']]
            comparison = self.check_cases(other, other_capability, cases)
            runnable &= {c.case_id for c in comparison if c.status == 'succeeded'}
            comparisons.extend({**asdict(c), 'case_id': f'crosscheck-{index}-{c.case_id}', 'method': item['method']}
                               for c in comparison)
        all_checks = [asdict(c) for c in checked] + comparisons
        if snapshot['definition']['driver']['kind'] == 'batch':
            selected = snapshot['definition']['driver'].get('selected_case_ids')
            if selected is not None:
                runnable &= set(selected)
        return {'ready': bool(runnable), 'partial': any(c['status'] != 'succeeded' for c in all_checks),
                'runnable_case_ids': sorted(runnable),
                'cases': [asdict(c) for c in checked], 'crosschecks': comparisons, 'method_scopes': scopes, 'limitations': capability.limitations,
                'validation': capability.validation.model_dump(), 'lock_digest': snapshot['lock']['digest'],
                'input_digest': fingerprint(snapshot)}

    def execute(self, wid, sid, body):
        request = {'study_id': sid, **body.model_dump(mode='json', exclude={'module'} if body.module is None else set())}
        request_digest = fingerprint(request)
        # Cheap replay check comes before reading mutable state or resolving packages.
        with self.store.db() as db:
            old = db.execute('SELECT id,request_digest FROM study_runs WHERE workspace=? AND request_id=?',
                             (wid, str(body.request_id))).fetchone()
            if old:
                if old['request_digest'] != request_digest:
                    raise HTTPException(409, '同一请求标识不能用于不同研究或参数。')
                return self.get_run(wid, old['id'])
        check = self.preflight(wid, sid, body.expected_revision, body.expected_study_revision, body.module)
        with self.store.db() as db:
            saved_definition=self.module_definition(self.definition(db,wid,sid)['definition'],body.module)
        selection=saved_definition['driver']['kind']=='selection' and bool(saved_definition['driver']['candidate_ids'])
        if not check['ready'] and not selection and saved_definition['driver']['kind'] != 'batch':
            raise HTTPException(422, {'message': '没有通过全部方法预检的工况。', 'cases': check['cases'],
                                      'crosschecks': check['crosschecks']})
        with self.store.db(True) as db:
            old = db.execute('SELECT id,request_digest FROM study_runs WHERE workspace=? AND request_id=?',
                             (wid, str(body.request_id))).fetchone()
            if old:
                if old['request_digest'] != request_digest:
                    raise HTTPException(409, '同一请求标识不能用于不同参数。')
                rid, existing = old['id'], True
            else:
                snapshot = self.prepare(db, wid, sid, body.expected_revision, body.expected_study_revision, body.module)
                self.store.assert_mutable(db, wid)
                if snapshot['lock']['digest'] != body.lock_digest or fingerprint(snapshot) != check['input_digest']:
                    raise HTTPException(409, '输入或插件锁已变化，请重新预检。')
                rid, existing = str(uuid4()), False
                nonce = str(uuid4())
                db.execute('INSERT INTO study_runs(id,workspace,study,request_id,request_digest,input_digest,snapshot,status,owner_epoch,execution_nonce,created) '
                           'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                           (rid, wid, sid, str(body.request_id), request_digest, fingerprint(snapshot), encode(snapshot),
                            'accepted', self.owner_epoch, nonce, stamp()))
        if existing:
            return self.get_run(wid, rid)
        try:
            method = snapshot['definition']['method']
            plugin, capability = self.resolve(method)
            with self.store.db(True) as db:
                claimed = db.execute("UPDATE study_runs SET status='running' WHERE id=? AND owner_epoch=? "
                                     "AND execution_nonce=? AND status='accepted'", (rid, self.owner_epoch, nonce)).rowcount
            if not claimed:
                return self.get_run(wid, rid)
            selected = snapshot['definition']['driver'].get('selected_case_ids') if snapshot['definition']['driver']['kind'] == 'batch' else None
            output = self.run_checked(plugin, capability, snapshot['cases'], check['cases'], selected_case_ids=selected)
            output['preflight'] = check
            output['executions'] = [{'method': method, 'environment': output['environment'], 'request_sha256': output['request_sha256'],
                                     'executed':any(c['status']=='succeeded' and (selected is None or c['case_id'] in selected) for c in check['cases']),
                                     'validation': capability.validation.model_dump(mode='json'), 'limitations': capability.limitations}]
            for index, item in enumerate(snapshot['definition']['crosschecks'], 1):
                try:
                    other, other_capability = self.resolve(item['method'])
                    # Pass immutable primary evidence for optional plugin diagnostics.
                    # The host transports it; the comparison plugin owns all math.
                    primary = {c['case_id']: c for c in output['cases'] if not c['case_id'].startswith('crosscheck-')}
                    cases = [{**c, 'parameters': item['parameters'], 'comparison': {
                        'source': {'method': method, 'case_id': c['case_id'],
                                   'input_digest': fingerprint(c['input']),
                                   'artifact_digests': primary.get(c['case_id'], {}).get('artifact_digests', {})},
                        'artifacts': primary.get(c['case_id'], {}).get('artifacts', {})}}
                             for c in snapshot['cases']]
                    prefix = f'crosscheck-{index}-'
                    checks = [{**c, 'case_id': c['case_id'][len(prefix):]} for c in check['crosschecks']
                              if c['case_id'].startswith(prefix)]
                    additional = self.run_checked(other, other_capability, cases, checks)
                except Exception as exc:
                    output['cases'].append({'case_id': f'crosscheck-{index}-case-0', 'method': item['method'],
                                            'status': 'failed', 'results': [], 'artifacts': {},
                                            'error': {'code': getattr(exc, 'code', type(exc).__name__), 'message': str(exc)}})
                    continue
                for c in additional['cases']:
                    entry = dict(c)
                    entry['case_id'] = f'crosscheck-{index}-{c["case_id"]}'
                    entry['method'] = item['method']
                    output['cases'].append(entry)
                output['executions'].append({'method': item['method'], 'environment': additional['environment'], 'request_sha256': additional['request_sha256'],
                                             'validation': other_capability.validation.model_dump(mode='json'), 'limitations': other_capability.limitations})
            output['assessment'] = assess(snapshot['definition'], output['cases'])
            output['crosscheck'] = crosscheck_differences(output['cases'])
            output['validation'] = capability.validation.model_dump(mode='json')
            output['limitations'] = capability.limitations
            output['environment_digest'] = fingerprint([e['environment'] for e in output['executions']])
            statuses = {c['status'] for c in output['cases']}
            status = 'succeeded' if statuses == {'succeeded'} else 'partial' if 'succeeded' in statuses else 'failed'
            with self.store.db(True) as db:
                db.execute("UPDATE study_runs SET status=?,output=?,output_digest=?,finished=? WHERE id=? AND owner_epoch=? "
                           "AND execution_nonce=? AND status='running'",
                           (status, encode(output), fingerprint(output), stamp(), rid, self.owner_epoch, nonce))
        except Exception as exc:
            error = {'code': getattr(exc, 'code', type(exc).__name__), 'message': str(exc)}
            with self.store.db(True) as db:
                db.execute("UPDATE study_runs SET status='failed',error=?,finished=? WHERE id=? AND owner_epoch=? "
                           "AND execution_nonce=? AND status IN ('accepted','running')",
                           (encode(error), stamp(), rid, self.owner_epoch, nonce))
        return self.get_run(wid, rid)

    def run_checked(self, plugin, capability, cases, checks, *, selected_case_ids=None):
        accepted = {c['case_id'] for c in checks if c['status'] == 'succeeded' and (selected_case_ids is None or c['case_id'] in selected_case_ids)}
        result = asdict(self.executor.run(plugin.manifest.id, capability.id,
                                         [c for c in cases if c['case_id'] in accepted], expected_manifest=plugin.manifest)) if accepted else {
                                             'cases':[], 'environment':{}, 'request_sha256':None}
        solved = {c['case_id']: c for c in result['cases']}
        result['cases'] = [solved[c['case_id']] if c['case_id'] in accepted else
                           {**c, 'status': 'not_run', 'results': [], 'artifacts': {},
                            'error': {'code':'CASE_NOT_SELECTED', 'message':'此工况未被选中，未执行计算。'},
                            'evidence': {**c.get('evidence', {}), 'stage': 'selection'}} if c['status']=='succeeded' else
                           {**c, 'evidence': {**c.get('evidence', {}), 'stage': 'preflight'}} for c in checks]
        return result

    def get_run(self, wid, rid, cache=None):
        cache = {} if cache is None else cache
        with self.store.db() as db:
            db.execute('BEGIN')
            row, _ = self.store.load(db, wid)
            record = db.execute('SELECT * FROM study_runs WHERE workspace=? AND id=?', (wid, rid)).fetchone()
            if record is None:
                raise HTTPException(404, '运行不存在或不属于此工程。')
            value = dict(record)
            try:
                for key in ('snapshot', 'output', 'error'):
                    value[key] = json.loads(value[key]) if value[key] else None
            except (ValueError, TypeError):
                return {**value, 'integrity': 'corrupt', 'freshness': 'unknown'}
            snapshot = value['snapshot']
            intact = fingerprint(snapshot) == value['input_digest']
            if value['output'] is not None:
                intact = intact and fingerprint(value['output']) == value['output_digest']
            if not intact:
                return {**value, 'integrity': 'corrupt', 'freshness': 'unknown'}
            study = self.definition(db, wid, value['study'])
            current = row['revision'] == snapshot['workspace_revision']
            try:
                selected = self.module_definition(study['definition'], snapshot.get('module'))
                # Editing another module does not invalidate unchanged physical inputs.
                current = current and StudyConfiguration.model_validate({k:v for k,v in selected.items() if k!='modules'}).model_dump() == StudyConfiguration.model_validate({k:v for k,v in snapshot['definition'].items() if k!='modules'}).model_dump()
                current = current and self.lock(db, wid, row['revision'], selected['method']) == snapshot['lock']
            except HTTPException:
                current = False
        availability = {'status': 'available', 'error': None}
        try:
            self.resolve(snapshot['definition']['method'], cache)
            for item in snapshot['definition']['crosschecks']:
                self.resolve(item['method'], cache)
        except (HTTPException, PluginHostError, ValueError, OSError) as exc:
            current = False
            availability = {'status': 'unavailable', 'error': {
                'code': getattr(exc, 'code', 'METHOD_UNAVAILABLE'), 'message': str(exc)}}
        value['freshness'] = 'current' if current else 'historical'
        value['integrity'] = 'verified'
        value['method_availability'] = availability
        value['artifact_status'] = self.artifact_status(value)
        from .convergence import has_temperature_field, temperature_convergence
        if has_temperature_field(value):
            value['convergence'] = temperature_convergence(value)
        return value

    @staticmethod
    def artifact_status(run):
        """Validate known presentation contracts without altering sealed output."""
        from ..foundation.simulation_artifacts import TemperatureField
        from ..foundation.reproduction import digest
        statuses = {}
        for case in (run.get('output') or {}).get('cases',[]):
            artifact = case.get('artifacts',{}).get('x-cablesim.temperature-field')
            if artifact is None:
                continue
            try:
                field = TemperatureField.model_validate(artifact)
                original_id = case['case_id'].split('-',2)[-1] if case['case_id'].startswith('crosscheck-') else case['case_id']
                inputs = next(c['input'] for c in run['snapshot']['cases'] if c['case_id']==original_id)
                method = case.get('method') or run['snapshot']['definition']['method']
                if (field.source.case_id != original_id or field.source.input_sha256 != digest(inputs)
                        or field.source.plugin_id != method['plugin_id'] or field.source.plugin_version != method['version']
                        or field.source.capability != method['capability']):
                    raise ValueError('source：温度场与本次保存输入、工况或插件版本不一致。')
                digests = case.get('artifact_digests',{})
                if not isinstance(case.get('artifacts',{}).get('x-cablesim.simulation-bundle'),dict) or not digests.get('x-cablesim.temperature-field') or field.source.bundle_sha256 != digests.get('x-cablesim.simulation-bundle'):
                    raise ValueError('source.bundle_sha256：温度场没有绑定同次封存的原始场工件。')
                if field.mesh.sha256 != digest({k:artifact['mesh'][k] for k in ('points','triangles','domain_ids','regions')}):
                    raise ValueError('mesh.sha256：网格摘要与节点、连接和区域不一致。')
                state = {'status':'verified','reason':None}
            except (ValueError,KeyError,TypeError,StopIteration) as exc:
                state = {'status':'unavailable','reason':str(exc)}
            statuses.setdefault(case['case_id'],{})['x-cablesim.temperature-field'] = state
        return statuses

    def list_runs(self, wid, sid, after=0, limit=50):
        with self.store.db() as db:
            self.definition(db, wid, sid)
            rows = db.execute('SELECT id,sequence FROM study_runs WHERE workspace=? AND study=? AND sequence>? ORDER BY sequence LIMIT ?',
                              (wid, sid, after, limit + 1)).fetchall()
        page = rows[:limit]
        cache = {}
        return {'items': [self.get_run(wid, r['id'], cache) for r in page],
                'next_cursor': page[-1]['sequence'] if len(rows) > limit else None}

    def verified_runs(self, wid, ids):
        cache = {}
        values = [self.get_run(wid, str(rid), cache) for rid in ids]
        if any(r['integrity'] != 'verified' or (r['status'] not in ('succeeded', 'partial') and not (r['snapshot']['definition']['driver']['kind'] in ('selection','batch') and (r.get('output') or {}).get('cases'))) for r in values):
            raise HTTPException(409, '源运行未完成或完整性校验失败。')
        return values

    def comparison(self, wid, ids):
        return compare(self.verified_runs(wid, ids))

    def deliver(self, wid, ids, request_id=None, *, current_only=False):
        from .report import RENDERER, render
        encoded_ids = encode([str(rid) for rid in ids])
        if request_id is not None:
            with self.store.db() as db:
                prior = db.execute('SELECT * FROM delivery_requests WHERE workspace=? AND request_id=?', (wid, str(request_id))).fetchone()
            if prior:
                if prior['run_ids'] != encoded_ids:
                    raise HTTPException(409, '同一请求标识不能用于不同源运行。')
                return self.delivery(wid, prior['delivery'])
        runs = self.verified_runs(wid, ids)
        from .convergence import has_temperature_field
        if any(has_temperature_field(r) and r.get('convergence',{}).get('status') != 'converged' for r in runs):
            raise HTTPException(422, '温度场未收敛：须完成至少三档网格及计算域加倍，热点变化小于 0.1 K 后才能纳入计算书。')
        if current_only and any(r['freshness'] != 'current' for r in runs):
            raise HTTPException(409, '计算书只能纳入当前保存输入的运行；请重新计算或重新选择。')
        html = render(runs)
        source = [{'run_id': r['id'], 'input_digest': r['input_digest'], 'output_digest': r['output_digest']} for r in runs]
        did, renderer = str(uuid4()), RENDERER
        digest = fingerprint({'renderer': renderer, 'sources': source, 'html': html})
        with self.store.db(True) as db:
            if current_only:
                row, _ = self.store.load(db, wid)
                for run in runs:
                    snapshot = run['snapshot']
                    study = self.definition(db, wid, run['study'])
                    if (row['revision'] != snapshot['workspace_revision'] or study['revision'] != snapshot['study_revision']
                            or self.lock(db, wid, row['revision'], self.module_definition(study['definition'], snapshot.get('module'))['method']) != snapshot['lock']):
                        raise HTTPException(409, '生成期间输入或研究已改变；请重新计算后生成计算书。')
                    for comparison in snapshot['definition']['crosschecks']:
                        self.resolve(comparison['method'])
            if request_id is not None:
                prior = db.execute('SELECT * FROM delivery_requests WHERE workspace=? AND request_id=?', (wid, str(request_id))).fetchone()
                if prior:
                    if prior['run_ids'] != encoded_ids:
                        raise HTTPException(409, '同一请求标识不能用于不同源运行。')
                    return self.delivery(wid, prior['delivery'])
            db.execute('INSERT INTO deliveries VALUES (?,?,?,?,?,?,?)', (did, wid, encode(source), renderer, html, digest, stamp()))
            if request_id is not None:
                db.execute('INSERT INTO delivery_requests VALUES (?,?,?,?)', (wid, str(request_id), encoded_ids, did))
        return self.delivery(wid, did)

    def delivery(self, wid, did):
        with self.store.db() as db:
            row = db.execute('SELECT * FROM deliveries WHERE workspace=? AND id=?', (wid, did)).fetchone()
        if row is None:
            raise HTTPException(404, '计算书不存在或不属于此工程。')
        result = dict(row)
        try:
            result['sources'] = json.loads(result['sources'])
            digest = fingerprint({k: result[k] for k in ('renderer', 'sources', 'html')})
        except (ValueError, TypeError):
            raise HTTPException(409, '计算书完整性校验失败。') from None
        if digest != result['digest']:
            raise HTTPException(409, '计算书完整性校验失败。')
        return result
