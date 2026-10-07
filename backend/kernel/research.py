"""Saved studies and snapshot execution. SQLite transactions never include a solver.

JSON artifacts are sealed in the same transaction as results, avoiding a split commit
between a file store and SQLite. The original worker-file digests remain provenance;
the canonical stored payload has its own integrity digest.
"""
from dataclasses import asdict
from copy import deepcopy
from hashlib import sha256
import json
import os
import platform
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from collections import OrderedDict
from threading import RLock
from contextlib import nullcontext

from fastapi import HTTPException
from pydantic import ValidationError

from .. import __version__
from ..plugin_host import Executor, PluginHostError
from ..plugin_host.registry import Registry
from ..plugin_host.executor import CaseResult, current_platform
from .workspace import fingerprint, stamp
from .contracts import LossArtifactReference, StudyConfiguration, StudyDefinition
from .drivers import assess, cases_for, compare, crosscheck_differences


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


class Research:
    def __init__(self, store, executor=None):
        self.store = store
        self.resident_runner = None
        if executor is None:
            from .hpc_executor import HpcExecutor
            from .verified_executor import VerifiedExecutor
            from ..plugin_host.resident import ResidentRunner
            from pathlib import Path
            self.resident_runner=ResidentRunner(Path(__file__).resolve().parents[2]/'.tmp/study-workers')
            executor=HpcExecutor(VerifiedExecutor(process_runner=self.resident_runner))
        self.executor = executor
        self.owner_epoch = str(uuid4())
        self.prepared_candidates = {}
        self.run_read_cache = OrderedDict()
        self.run_read_lock = RLock()
        self.contract_read_cache = OrderedDict()
        self.contract_read_lock = RLock()
        from .read_responses import ReadResponses
        self.read_responses = ReadResponses(self)
        self.background = ThreadPoolExecutor(max_workers=2, thread_name_prefix='study-run')

    def close(self):
        self.background.shutdown(wait=False)
        self.read_responses.close()
        if self.resident_runner is not None:
            self.resident_runner.close()
        seals=getattr(getattr(self.executor,'local',self.executor),'seals',None)
        if seals is not None:seals.close()

    def warm_reads(self):
        """Validate a small existing library at startup; never run a method."""
        from .responses import StudyResponse, RunSummaryPage
        import logging
        with self.store.db() as db:
            count=db.execute('SELECT COUNT(*) FROM studies').fetchone()[0]
            if count == 0 or count > 64:return
            rows=db.execute('SELECT workspace,id FROM studies ORDER BY rowid').fetchall()
        tasks=[]
        for wid in dict.fromkeys(row['workspace'] for row in rows):
            tasks.append((('studies',wid),list[StudyResponse],lambda wid=wid:self.list_studies(wid)))
        for row in rows:
            wid,sid=row['workspace'],row['id']
            tasks.extend([
                (('study',wid,sid),StudyResponse,lambda wid=wid,sid=sid:self.study_detail(wid,sid)),
                (('runs',wid,sid,0,50),RunSummaryPage,lambda wid=wid,sid=sid:self.list_runs(wid,sid,view='summary')),
            ])
        for key,model,load in tasks:
            try:self.read_responses.build(key,model,load,True)
            except (HTTPException,PluginHostError,ValueError,TypeError,KeyError):
                logging.getLogger(__name__).debug('Read cache warm-up skipped for %s',key,exc_info=True)

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
            from .study_history import initialize
            initialize(db)
            # Called only after the application has acquired its exclusive owner lock.
            db.execute("UPDATE study_runs SET status='interrupted',finished=?,error=? "
                       "WHERE owner_epoch<>? AND status IN ('accepted','running','validating')",
                       (stamp(), encode({'code': 'HOST_RESTART', 'message': '旧执行未能确认完成；不会自动重算。'}), self.owner_epoch))

    def methods(self):
        from ..plugin_host.presentation import resources
        return [{'method': self.pin(p), 'name': p.manifest.name, 'description': p.manifest.description,
                 'presentation': p.manifest.presentation.model_dump(mode='json') if p.manifest.presentation else None,
                 'resources': resources(p),
                 'platforms': p.manifest.platforms, 'platform_supported': current_platform() in p.manifest.platforms,
                 'execution_policy': {'backend':'slurm' if hasattr(self.executor,'required') and self.executor.required(p.manifest.id) else 'local',
                                      'isolation': 'process', 'os_sandbox': False, 'timeout_enforced': True,
                                      'memory_limit_enforced': False, 'network_isolation_enforced': False,
                                      'parent_death_enforced': os.name == 'nt', 'process_tree_cleanup_enforced': os.name == 'nt'},
                 'capabilities': [c.model_dump(mode='json', by_alias=True, exclude_none=True) for c in p.manifest.capabilities]}
                for p in self.registry().plugins.values()]

    def registry(self, plugin_id=None):
        try:
            return Registry(self.executor.registry.root,plugin_id=plugin_id)
        except (ValueError,OSError) as exc:
            raise PluginHostError('PLUGIN_MANIFEST_INVALID','插件清单不可读或格式错误；请完成安装/封签后重试。'+str(exc),409) from None

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
            registries[plugin_id] = self.registry(plugin_id)
        plugin = registries[plugin_id].get(plugin_id)
        if self.pin(plugin) != {k: method[k] for k in ('plugin_id', 'version', 'release_digest')}:
            raise HTTPException(409, '方法发行已变化，请明确选择新版本并保存研究。')
        verified = cache.setdefault('verified', {})
        if plugin.manifest.id not in verified:
            try:
                verifier=getattr(self.executor,'verify_release',None)
                verifier(plugin) if verifier else plugin.verify()
                verified[plugin.manifest.id] = None
            except PluginHostError as exc:
                verified[plugin.manifest.id] = exc
            except (ValueError,OSError) as exc:
                verified[plugin.manifest.id] = PluginHostError('PLUGIN_SEAL_INVALID',f'{plugin_id}：源码或封签无法验证，请完成安装/封签后重试。{exc}',409)
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
        definition = json.loads(version['definition'])
        revision = db.execute('SELECT revision FROM workspaces WHERE id=?', (wid,)).fetchone()['revision']
        from .study_history import state
        return {**dict(row), **state(db,sid), 'definition': definition, 'created': version['created'],
                'lock': self.lock(db, wid, revision, definition['method'])}

    def save(self, wid, body, sid=None, *, connection=None):
        definition = StudyDefinition.model_validate(body.model_dump(exclude={'expected_revision', 'expected_study_revision'}))
        prior = None
        if sid is not None:
            with (nullcontext(connection) if connection is not None else self.store.db()) as db:
                prior = StudyDefinition.model_validate(self.definition(db,wid,sid,body.expected_study_revision)['definition'])
        def verify_changed(config, previous):
            if previous is not None and config.model_dump()==previous.model_dump():
                return  # Preserve an unchanged historical pin while editing another module.
            _,capability=self.resolve(config.method.model_dump())
            from .method_adoption import normalize_configuration
            normalized=config.model_dump(mode='json')
            normalize_configuration(self,normalized)
            config.parameters=normalized['parameters']
            config.method_input=normalized['method_input']
            from .contracts import Driver, CrosscheckMethod, CandidateCompletion
            config.driver=Driver.model_validate(normalized['driver'])
            config.crosschecks=[CrosscheckMethod.model_validate(item) for item in normalized['crosschecks']]
            config.candidate_completions={key:CandidateCompletion.model_validate(item) for key,item in normalized['candidate_completions'].items()}
            if config.input_source=='study' and capability.input_schema=='cablesim.simulation-problem/1':
                from .simulation_contract import validate_input, StandaloneParameters
                validate_input(config.method_input,config.method.capability)
                try:
                    StandaloneParameters.model_validate_json(json.dumps(config.parameters),strict=True)
                except ValidationError as exc:
                    from cablesim_sdk.validation import validation_error
                    raise HTTPException(422,validation_error(exc,'SIMULATION_PARAMETERS_INVALID',prefix=('parameters',))) from None
            from .study_tasks import validate_task
            validate_task(config, capability)
            if config.driver.kind=='selection' and capability.analysis=='crosscheck':
                raise HTTPException(422,'交叉校核参考不参与工程候选选型，请选择载流量方法。')
            for completion in config.candidate_completions.values():
                self.resolve(completion.method.model_dump())
            for item in config.crosschecks:
                self.resolve(item.method.model_dump())
        primary = StudyConfiguration.model_validate(definition.model_dump(exclude={'modules'}))
        previous = StudyConfiguration.model_validate(prior.model_dump(exclude={'modules'})) if prior else None
        verify_changed(primary,previous)
        for field in StudyConfiguration.model_fields:
            setattr(definition,field,getattr(primary,field))
        for name,config in definition.modules.items():
            verify_changed(config,prior.modules.get(name) if prior else None)
        value = definition.model_dump(mode='json')
        encoded = encode(value)
        with (nullcontext(connection) if connection is not None else self.store.db(True)) as db:
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
            from .study_history import record
            record(db,sid,revision)
            self.store.audit(db, wid, body.expected_revision, '保存研究', sid)
            return self.definition(db, wid, sid)

    def list_studies(self, wid):
        from .read_models import model_reference
        with self.store.db() as db:
            revision, model = model_reference(db, wid)
            ids = [r[0] for r in db.execute('SELECT id FROM studies WHERE workspace=? ORDER BY rowid', (wid,))]
            cache = {}
            return [self._study_detail(db, wid, sid, revision, model, cache) for sid in ids]

    def study_detail(self, wid, sid, cache=None):
        from .read_models import model_reference
        with self.store.db() as db:
            revision, model = model_reference(db, wid)
            return self._study_detail(db, wid, sid, revision, model, {} if cache is None else cache)

    def _study_detail(self, db, wid, sid, revision, model, cache):
        from .read_models import run_facts, RUN_COLUMNS
        from .version_status import inspect
        value = self.definition(db, wid, sid)
        latest = db.execute('SELECT '+RUN_COLUMNS+' FROM study_runs WHERE workspace=? AND study=? ORDER BY sequence DESC LIMIT 1', (wid, sid)).fetchone()
        value['latest_run_id'] = latest['id'] if latest else None
        value['version_status'] = {'status': 'empty', 'reasons': [], 'display_name': '尚无运行'}
        if latest:
            facts = run_facts(self, latest)
            value['version_status'] = inspect(self, facts['snapshot'], cache) if facts['integrity'] == 'verified' else None
        value['workspace_revision'] = revision
        value['model_reference'] = model if value['definition'].get('input_source') == 'domain' else None
        return value

    def lock(self, db, wid, revision, method):
        value = {'schema':'cablesim.method-lock/2', 'workspace_id':wid,
                 'workspace_revision':revision, 'method':method}
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
        if source.get('artifact_status',{}).get(reference['case_id'],{}).get(reference['artifact_type'],{}).get('status') != 'verified':
            raise HTTPException(422, {'code':'LOSS_ARTIFACT_UNVERIFIED','message':'外部损耗的输入、生产插件或原始场绑定未通过校验，请重新生成该损耗运行。'})
        artifact = row.get('artifacts', {}).get(reference['artifact_type'])
        if not isinstance(artifact, dict) or artifact.get('schema') != 'cablesim.loss-coefficients/1':
            raise HTTPException(422, '外部损耗工件须符合 cablesim.loss-coefficients/1。')
        if artifact.get('domain_input_sha256') != fingerprint(case['input']):
            raise HTTPException(422, '损耗工件的领域输入摘要不同，不能带入当前研究。')
        case['parameters']['external_loss_artifact'] = deepcopy(artifact)
        case['parameters']['external_loss_artifact']['resolved_source'] = {
            **reference, 'method': row.get('method') or source['snapshot']['definition']['method'],
            'source_input_digest': source['input_digest'], 'source_output_digest': source['output_digest']}

    def bind_native_artifact(self,wid,case):
        """Resolve a sealed upstream artifact; never accept caller-supplied bytes."""
        parameters=case['parameters']
        if 'source_bundle' in parameters or 'source_metadata' in parameters:
            raise HTTPException(422,'原生来源工件只能引用本工程已封存运行，不能提供正文或路径。')
        reference=parameters.get('native_source_reference')
        if reference is None:return
        from .contracts import NativeArtifactReference
        try:
            ref=NativeArtifactReference.model_validate(reference).model_dump(mode='json')
        except ValidationError as error:
            raise HTTPException(422,str(error)) from None
        source=self.get_run(wid,ref['run_id'])
        if source['status'] not in ('succeeded','partial') or source['integrity']!='verified':
            raise HTTPException(409,'来源运行未成功或工件完整性校验失败。')
        row=next((r for r in source['output']['cases'] if r['case_id']==ref['case_id'] and r['status']=='succeeded'),None)
        inputs=next((c['input'] for c in source['snapshot']['cases'] if c['case_id']==ref['case_id']),None)
        if row is None or fingerprint(inputs)!=fingerprint(case['input']):
            raise HTTPException(409,'原生来源工件与当前领域输入不同，请使用相同型号和工况重新生成来源。')
        if row.get('artifact_digests',{}).get(ref['artifact_type'])!=ref['artifact_sha256']:
            raise HTTPException(409,'原生来源工件哈希不一致。')
        parameters['source_bundle']=deepcopy(row['artifacts'][ref['artifact_type']])
        parameters['source_metadata']={**ref,'method':row.get('method') or source['snapshot']['definition']['method'],
                                       'input_sha256':fingerprint(inputs),'source_output_digest':source['output_digest'],
                                       'workspace_revision':source['snapshot']['workspace_revision'],
                                       'parameters':deepcopy(next(c['parameters'] for c in source['snapshot']['cases'] if c['case_id']==ref['case_id']))}

    def complete_candidate(self,item,completion,prepared_result=None):
        """A plugin prepares source-bound input facts; host never derives physics."""
        plugin,capability=self.resolve(completion['method'])
        if capability.analysis!='model_preparation':raise HTTPException(422,'候选补参数须选择模型准备能力。')
        inputs={'schema_version':'cablesim.product-specification/1',**deepcopy(item['payload'])}
        case={'case_id':'candidate','input':inputs,'parameters':deepcopy(completion['parameters'])}
        identity=fingerprint({'method':completion['method'],'input':inputs,'parameters':completion['parameters']})
        if prepared_result is not None and prepared_result.status!='succeeded':return None,prepared_result.error
        if identity not in self.prepared_candidates:
            result=self.executor.run(plugin.manifest.id,capability.id,[case],expected_manifest=plugin.manifest).cases[0]
            if result.status!='succeeded':return None,result.error
            self.prepared_candidates[identity]=result
            if len(self.prepared_candidates)>256:self.prepared_candidates.pop(next(iter(self.prepared_candidates)))
        result=self.prepared_candidates[identity]
        if result.status!='succeeded':return None,result.error
        artifact=result.artifacts.get('x-cablesim.engineering-model')
        if not isinstance(artifact,dict) or artifact.get('schema')!='cablesim.engineering-model/1':
            raise HTTPException(422,'模型准备插件没有返回声明的工程模型工件。')
        from .candidates import CableModelVersion
        payload={k:deepcopy(artifact[k]) for k in ('name','version','cable_type','materials','sources')}
        payload=CableModelVersion.model_validate(payload).model_dump(mode='json')
        return {**item,'state':'engineering_input','payload':payload,'digest':fingerprint(payload),
                'origin':deepcopy(item),'engineering_parameters':deepcopy(artifact['engineering_parameters']),
                'derived':deepcopy(artifact['derived']),'dependencies':artifact['dependencies'],
                'preparation':{'method':completion['method'],'input_digest':identity,
                               'seal_verification':result.evidence.get('seal_verification'),
                               'artifact_sha256':result.artifact_digests['x-cablesim.engineering-model']}},None

    def prepare_candidates(self,db,definition):
        """Group uncached model preparation by the exact pinned capability."""
        from .candidates import read, matches
        if len(self.prepared_candidates)>256:self.prepared_candidates.clear()
        groups={};prepared={}
        for cid in definition['driver']['candidate_ids']:
            completion=definition.get('candidate_completions',{}).get(cid)
            item=read(db,cid)
            if not matches(item,definition['driver'].get('candidate_filters',{})):
                raise HTTPException(422,'候选不在保存的电压、材料或截面范围内：'+cid)
            if not completion or item['state']!='incomplete':continue
            inputs={'schema_version':'cablesim.product-specification/1',**deepcopy(item['payload'])}
            identity=fingerprint({'method':completion['method'],'input':inputs,'parameters':completion['parameters']})
            if identity in self.prepared_candidates:continue
            group=groups.setdefault(fingerprint(completion['method']),{'method':completion['method'],'cases':[],'identities':[],'ids':[]})
            group['ids'].append(cid)
            group['identities'].append(identity)
            group['cases'].append({'case_id':f'candidate-{len(group["cases"])}','input':inputs,'parameters':deepcopy(completion['parameters'])})
        for group in groups.values():
            plugin,capability=self.resolve(group['method'])
            if capability.analysis!='model_preparation':raise HTTPException(422,'候选补参数须选择模型准备能力。')
            results=self.executor.run(plugin.manifest.id,capability.id,group['cases'],expected_manifest=plugin.manifest)
            indexed={result.case_id:result for result in results.cases}
            for cid,identity,case in zip(group['ids'],group['identities'],group['cases']):
                result=indexed[case['case_id']]
                prepared[cid]=result
                if result.status=='succeeded':self.prepared_candidates[identity]=result
        return prepared

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
            raise HTTPException(422, '旧工况研究仅可读取历史结果；请先转换领域文档，再保存新研究。')
        lock = self.lock(db, wid, row['revision'], definition['method'])
        try:
            cases = cases_for(definition, inputs)
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise HTTPException(422, '扫描路径无效：' + str(exc)) from None
        for case in cases:
            self.bind_loss_artifact(wid, case)
            self.bind_native_artifact(wid, case)
        if source == 'domain':
            from ..domain.guards import check_locks
            for case in cases:
                check_locks(state, case['input'], case['parameters'])
                for item in definition['crosschecks']:
                    check_locks(state, case['input'], item['parameters'])
        candidates = []
        if definition['driver']['candidate_ids']:
            if source!='domain':raise HTTPException(422,'型号候选须使用保存的领域输入。')
            preparation_results=self.prepare_candidates(db,definition)
            cases = []
            for index, cid in enumerate(definition['driver']['candidate_ids']):
                if source == 'domain':
                    from .candidates import apply, initialize, read, matches
                    initialize(db)
                    item=read(db,cid)
                    if not matches(item,definition['driver'].get('candidate_filters',{})):
                        raise HTTPException(422,'候选不在保存的电压、材料或截面范围内：'+cid)
                    completion=definition.get('candidate_completions',{}).get(cid)
                    preparation_error=None
                    if completion and item['state']=='incomplete':
                        prepared,preparation_error=self.complete_candidate(item,completion,preparation_results.get(cid))
                        if prepared is not None:item=prepared
                    if item['state']=='incomplete':
                        spec=item['payload']['specification']
                        cases.append({'case_id':f'case-{index}',
                            'input':{'schema_version':'cablesim.product-specification/1','specification':deepcopy(spec)},
                            'parameters':deepcopy(definition['parameters']),
                            'preflight_error':preparation_error or {'code':'CANDIDATE_DATA_MISSING',
                                'message':'请补齐'+ '、'.join(spec['missing'])+'后计算。'}})
                        candidates.append(item)
                        continue
                    if item['state'] not in ('reviewed','engineering_input') and not definition['driver'].get('allow_demo_candidates'):
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
                raise HTTPException(422,'型号候选须使用保存的领域输入。')
        primary_plugin, primary_capability = self.resolve(definition['method'])
        if 'rating_mode' in primary_capability.parameter_schema.properties and definition['driver'].get('target_key') == 'ampacity' and (
                definition['driver']['kind'] in ('selection', 'sweep') and definition['driver'].get('rating_basis') == 'simultaneous'
                or definition['driver']['kind'] == 'selection' and definition['driver'].get('candidate_ids')):
            for case in cases:
                case['parameters']['rating_mode'] = 'both'
        result = {'workspace_id': wid, 'workspace_revision': row['revision'], 'study_id': sid,
                'study_revision': study['revision'], 'definition': definition, 'workspace_state': state,
                'lock': lock, 'cases': cases, 'candidate_snapshots': candidates, 'host_version': __version__,
                'planned_environment': {'python': platform.python_version(), 'platform': platform.system()}}
        result['headline_contract'] = [value.model_dump(mode='json') for value in primary_capability.headlines]
        result['artifact_source_contracts'] = {}
        for method in [definition['method'], *(item['method'] for item in definition['crosschecks'])]:
            plugin, capability = self.resolve(method)
            result['artifact_source_contracts'][fingerprint(method)] = {
                'manifest_sha256': sha256((plugin.directory/'plugin.json').read_bytes()).hexdigest(),
                'temperature_field_binding': capability.temperature_field_binding.model_dump(mode='json') if capability.temperature_field_binding else None}
        from .automatic_convergence import expand
        result['cases'], automatic = expand(definition, cases)
        if automatic is not None:
            result['automatic_convergence'] = automatic
        if module is not None:
            result.update(module=module, study_definition=study['definition'])
        if hasattr(self.executor,'required') and self.executor.required(definition['method']['plugin_id'],definition['method']['capability']):
            result['planned_environment']={'backend':'slurm','partition':'dg83','platform':'linux-x64',
                'runtime':'frozen source; actual software versions and node recorded after execution'}
        return result

    def resume_remote(self,wid,sid,rid):
        """Collect the original single-case Slurm allocation; never create a new solve."""
        run=self.get_run(wid,rid)
        if run['study']!=sid:raise HTTPException(404,'运行不属于此研究。')
        if run['status'] not in ('failed','interrupted'):
            return run
        snapshot=run['snapshot'];definition=snapshot['definition']
        if (len(snapshot['cases'])!=1 and not snapshot.get('automatic_convergence')) or definition['crosschecks'] or not hasattr(self.executor,'saved'):
            raise HTTPException(422,'此恢复入口只回收单工况超算运行；扫描或批量请使用数据集恢复接口。')
        method=definition['method']
        directory,plan=self.executor.saved(rid,method['plugin_id'],method['capability'])
        if plan['cases']!=snapshot['cases'] or fingerprint(plan['plugin_manifest'])!=method['release_digest']:
            raise HTTPException(409,'原超算计划与封存研究输入不同，未替换输入或另行提交。')
        nonce=str(uuid4())
        with self.store.db(True) as db:
            claimed=db.execute("UPDATE study_runs SET status='validating',owner_epoch=?,execution_nonce=?,error=NULL "
                "WHERE id=? AND workspace=? AND status IN ('failed','interrupted')",
                (self.owner_epoch,nonce,rid,wid)).rowcount
        if not claimed:return self.get_run(wid,rid)
        try:
            from ..plugin_host.manifest import Manifest
            manifest=Manifest.model_validate(plan['plugin_manifest']);capability=manifest.capability(method['capability'])
            output=asdict(self.executor.collect(directory))
            output['executions']=[{'method':method,'environment':output['environment'],
                'request_sha256':output['request_sha256'],'executed':True,
                'validation':capability.validation.model_dump(mode='json'),'limitations':capability.limitations}]
            from .drivers import default_result
            output['default_result']=default_result(definition,output['cases'])
            output['assessment']=assess(definition,output['cases'])
            output['crosscheck']=crosscheck_differences(output['cases'])
            output['validation']=capability.validation.model_dump(mode='json');output['limitations']=capability.limitations
            output['environment_digest']=fingerprint([output['environment']])
            statuses={case['status'] for case in output['cases']}
            status='succeeded' if statuses=={'succeeded'} else 'partial' if 'succeeded' in statuses else 'failed'
            with self.store.db(True) as db:
                db.execute("UPDATE study_runs SET status=?,output=?,output_digest=?,finished=? WHERE id=? AND owner_epoch=? "
                           "AND execution_nonce=? AND status='validating'",
                    (status,encode(output),fingerprint(output),stamp(),rid,self.owner_epoch,nonce))
        except Exception as exc:
            with self.store.db(True) as db:
                db.execute("UPDATE study_runs SET status='interrupted',error=?,finished=? WHERE id=? AND owner_epoch=? "
                    "AND execution_nonce=? AND status='validating'",
                    (encode({'code':getattr(exc,'code',type(exc).__name__),'message':str(exc)}),stamp(),rid,self.owner_epoch,nonce))
        return self.get_run(wid,rid)

    def check_cases(self, plugin, capability, cases):
        from ..domain.models import DomainDocument
        checked, valid = {}, []
        for case in cases:
            if case.get('preflight_error'):
                checked[case['case_id']]=CaseResult(case['case_id'],'failed',error=deepcopy(case['preflight_error']))
                continue
            try:
                if capability is not None and plugin is not None and plugin.manifest.presentation is not None:
                    from ..plugin_host.parameter_contracts import validate_case
                    validate_case(capability,case)
                if case['input'].get('schema_version') == 'cablesim.domain/1':
                    DomainDocument.model_validate(case['input'])
                elif case['input'].get('schema_version')=='cablesim.simulation-problem/1':
                    from .simulation_contract import validate_input
                    validate_input(case['input'],getattr(capability,'id',None))
            except HTTPException as exc:
                checked[case['case_id']]=CaseResult(case['case_id'],'failed',error=exc.detail)
            except PluginHostError as exc:
                checked[case['case_id']]=CaseResult(case['case_id'],'failed',error={
                    'code':exc.code,'message':str(exc),'path':getattr(exc,'path',None)})
            except ValidationError as exc:
                from cablesim_sdk.validation import validation_error
                checked[case['case_id']] = CaseResult(case['case_id'], 'failed',
                                                     error=validation_error(exc, 'DOMAIN_INVALID'))
            else:
                valid.append(case)
        if valid:
            result = self.executor.check(plugin.manifest.id, capability.id, valid, expected_manifest=plugin.manifest)
            checked.update({c.case_id: c for c in result.cases})
        for result in checked.values():
            if result.error and not result.error.get('path'):
                result.error['path'] = '/parameters'
        return [checked[c['case_id']] for c in cases]

    def preflight(self, wid, sid, revision, study_revision, module=None):
        from .verified_executor import verification_scope
        with verification_scope():
            return self._preflight(wid,sid,revision,study_revision,module)

    def _preflight(self, wid, sid, revision, study_revision, module=None):
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

    def execute(self, wid, sid, body, *, asynchronous=False, checked_preflight=None):
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
        check = checked_preflight if checked_preflight is not None else self.preflight(wid, sid, body.expected_revision, body.expected_study_revision, body.module)
        with self.store.db() as db:
            saved_definition=self.module_definition(self.definition(db,wid,sid)['definition'],body.module)
        selection=saved_definition['driver']['kind']=='selection' and bool(saved_definition['driver']['candidate_ids'])
        if asynchronous is None:
            from .study_tasks import SIMULATION_TASKS
            method=saved_definition['method']
            asynchronous = saved_definition.get('task') in SIMULATION_TASKS or (hasattr(self.executor,'required') and self.executor.required(method['plugin_id'],method['capability']))
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
        if asynchronous:
            self.background.submit(self.finish_run, wid, rid, snapshot, check, nonce)
            return self.get_run(wid, rid)
        return self.finish_run(wid, rid, snapshot, check, nonce)

    def finish_run(self, wid, rid, snapshot, check, nonce):
        sid = snapshot['study_id']
        try:
            method = snapshot['definition']['method']
            plugin, capability = self.resolve(method)
            with self.store.db(True) as db:
                claimed = db.execute("UPDATE study_runs SET status='running' WHERE id=? AND owner_epoch=? "
                                     "AND execution_nonce=? AND status='accepted'", (rid, self.owner_epoch, nonce)).rowcount
            if not claimed:
                return self.get_run(wid, rid)
            selected = snapshot['definition']['driver'].get('selected_case_ids') if snapshot['definition']['driver']['kind'] == 'batch' else None
            output = self.run_checked(plugin, capability, snapshot['cases'], check['cases'], selected_case_ids=selected,execution_identity=rid)
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
                    additional = self.run_checked(other, other_capability, cases, checks,execution_identity=rid)
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
            from .drivers import default_result
            output['default_result'] = default_result(snapshot['definition'], output['cases'])
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

    def run_checked(self, plugin, capability, cases, checks, *, selected_case_ids=None,execution_identity=None):
        accepted = {c['case_id'] for c in checks if c['status'] == 'succeeded' and (selected_case_ids is None or c['case_id'] in selected_case_ids)}
        executor=self.executor.for_operation(execution_identity) if execution_identity is not None and hasattr(self.executor,'for_operation') else self.executor
        result = asdict(executor.run(plugin.manifest.id, capability.id,
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
        from .version_status import inspect
        value['version_status'] = inspect(self, snapshot, cache)
        current = current and value['version_status']['status'] == 'current'
        value['freshness'] = 'current' if current else 'historical'
        value['integrity'] = 'verified'
        value['method_availability'] = availability
        if hasattr(self.executor,'execution_status'):
            method=snapshot['definition']['method']
            value['execution']=self.executor.execution_status(rid,method['plugin_id'],method['capability'])
            if value['execution'] and value['status'] in ('succeeded','partial','failed','interrupted'):
                value['execution']={**value['execution'],'state':value['status']}
        value['artifact_status'] = self.artifact_status(value)
        from .convergence import has_temperature_field, temperature_convergence
        if has_temperature_field(value):
            value['convergence'] = temperature_convergence(value)
        return value

    @staticmethod
    def artifact_status(run):
        """Validate known presentation contracts without altering sealed output."""
        from cablesim_sdk.simulation_artifacts import TemperatureField,TemperatureHistory,ArtifactSource
        from cablesim_sdk.reproduction import digest
        statuses = {}
        for case in (run.get('output') or {}).get('cases',[]):
            if 'x-cablesim.headline-witness' in case.get('artifacts',{}):
                from .answer_witnesses import status
                statuses.setdefault(case['case_id'],{})['x-cablesim.headline-witness']=status(run,case)
            comparison=case.get('artifacts',{}).get('x-cablesim.iec-fem-comparison')
            if comparison is not None:
                try:
                    from cablesim_sdk.iec_fem import ComparisonArtifact,ComparisonParameters
                    result=ComparisonArtifact.model_validate(comparison)
                    original_id=case['case_id'].split('-',2)[-1] if case['case_id'].startswith('crosscheck-') else case['case_id']
                    saved_case=next(c for c in run['snapshot']['cases'] if c['case_id']==original_id)
                    inputs=saved_case['input']
                    saved_parameters=saved_case['parameters']
                    if case['case_id'].startswith('crosscheck-'):
                        index=int(case['case_id'].split('-',2)[1])
                        if index<1:raise ValueError('对照方法序号无效。')
                        saved_parameters=run['snapshot']['definition']['crosschecks'][index-1]['parameters']
                    parameters=ComparisonParameters.model_validate(saved_parameters).model_dump(mode='json')
                    bundle=case['artifacts'].get('x-cablesim.simulation-bundle',{})
                    method=case.get('method') or run['snapshot']['definition']['method']
                    hashes=case.get('artifact_digests',{})
                    if (result.source.case_id!=original_id or result.source.input_sha256!=digest(inputs)
                        or result.source.plugin_id!=method['plugin_id'] or result.source.plugin_version!=method['version']
                        or result.source.capability!=method['capability'] or not hashes.get('x-cablesim.iec-fem-comparison')
                        or result.source.bundle_sha256!=hashes.get('x-cablesim.simulation-bundle')
                        or result.parameters_sha256!=digest(parameters)
                        or bundle.get('prepared_input',{}).get('parameters')!=parameters
                        or result.section_id!=parameters['section_id'] or result.load_id!=parameters['load_id']
                        or result.rated_circuit!=parameters['controls']['rated_circuit']):
                        raise ValueError('比较工件与保存输入、方法或原始计算证据不匹配。')
                    state={'status':'verified','reason':None}
                except (ValueError,KeyError,TypeError,IndexError,StopIteration) as exc:
                    state={'status':'unavailable','reason':str(exc)}
                statuses.setdefault(case['case_id'],{})['x-cablesim.iec-fem-comparison']=state
            for kind,source_key,schema_key,schema in (
                ('x-cablesim.loss-coefficients','producer','schema','cablesim.loss-coefficients/1'),
                ('x-cablesim.sheath-losses','source','schema_version','cablesim.sheath-losses/1')):
                artifact=case.get('artifacts',{}).get(kind)
                if artifact is None:continue
                try:
                    if artifact.get(schema_key)!=schema:raise ValueError('schema：未知护套工件版本。')
                    binding=ArtifactSource.model_validate(artifact[source_key])
                    original_id=case['case_id'].split('-',2)[-1] if case['case_id'].startswith('crosscheck-') else case['case_id']
                    inputs=next(c['input'] for c in run['snapshot']['cases'] if c['case_id']==original_id)
                    method=case.get('method') or run['snapshot']['definition']['method']
                    if (binding.case_id!=original_id or binding.input_sha256!=digest(inputs)
                        or binding.plugin_id!=method['plugin_id'] or binding.plugin_version!=method['version']
                        or binding.capability!=method['capability']):
                        raise ValueError('source：护套工件与保存输入、工况或插件版本不一致。')
                    hashes=case.get('artifact_digests',{})
                    if not isinstance(case.get('artifacts',{}).get('x-cablesim.simulation-bundle'),dict) or not hashes.get(kind) or binding.bundle_sha256!=hashes.get('x-cablesim.simulation-bundle'):
                        raise ValueError('source.bundle_sha256：护套工件未绑定同次封存原始场。')
                    if kind=='x-cablesim.loss-coefficients' and (artifact['domain_input_sha256']!=fingerprint(inputs) or artifact['topology_sha256']!=digest(artifact['topology'])):
                        raise ValueError('domain/topology：护套损耗的输入或接地拓扑摘要不同。')
                    state={'status':'verified','reason':None}
                except (ValueError,KeyError,TypeError,StopIteration) as exc:
                    state={'status':'unavailable','reason':str(exc)}
                statuses.setdefault(case['case_id'],{})[kind]=state
            history=case.get('artifacts',{}).get('x-cablesim.temperature-history')
            if history is not None:
                try:
                    curve=TemperatureHistory.model_validate(history)
                    original_id=case['case_id'].split('-',2)[-1] if case['case_id'].startswith('crosscheck-') else case['case_id']
                    inputs=next(c['input'] for c in run['snapshot']['cases'] if c['case_id']==original_id)
                    method=case.get('method') or run['snapshot']['definition']['method']
                    if (curve.source.case_id!=original_id or curve.source.input_sha256!=digest(inputs)
                        or curve.source.plugin_id!=method['plugin_id'] or curve.source.plugin_version!=method['version']
                        or curve.source.capability!=method['capability']):
                        raise ValueError('source：温度历史与保存输入、工况或插件版本不一致。')
                    hashes=case.get('artifact_digests',{})
                    if not isinstance(case.get('artifacts',{}).get('x-cablesim.simulation-bundle'),dict) or not hashes.get('x-cablesim.temperature-history') or curve.source.bundle_sha256!=hashes.get('x-cablesim.simulation-bundle'):
                        raise ValueError('source.bundle_sha256：温度历史未绑定同次封存原始场。')
                    state={'status':'verified','reason':None}
                except (ValueError,KeyError,TypeError,StopIteration) as exc:
                    state={'status':'unavailable','reason':str(exc)}
                statuses.setdefault(case['case_id'],{})['x-cablesim.temperature-history']=state
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
                if not digests.get('x-cablesim.temperature-field'):
                    raise ValueError('温度场缺少封存摘要。')
                if field.source.binding == 'iec-trace':
                    source_contract=run['snapshot'].get('artifact_source_contracts',{}).get(fingerprint(method),{})
                    declaration=source_contract.get('temperature_field_binding')
                    trace=case.get('artifacts',{}).get('x-cablesim.iec60287-trace')
                    if not declaration or declaration.get('binding')!='iec-trace' or field.source.manifest_sha256!=source_contract.get('manifest_sha256'):
                        raise ValueError('解析土壤场来源没有匹配本次封存清单的声明。')
                    if not isinstance(trace,dict) or field.source.trace_sha256!=digests.get('x-cablesim.iec60287-trace'):
                        raise ValueError('source.trace_sha256：温度场没有绑定同工况IEC轨迹。')
                    identity=field.source.model_dump(exclude={'binding','bundle_sha256','trace_sha256'})
                    if trace.get('source')!=identity or trace.get('soil_view',{}).get('status')!='available':
                        raise ValueError('解析土壤场与IEC轨迹执行身份或可用状态不一致。')
                    view=field.analytical_soil_view
                    if view.condition!=declaration['condition'] or view.model!=declaration['model'] or view.surface_check_tolerance_k!=declaration['tolerance_k']:
                        raise ValueError('解析土壤场模型、自检阈值或工况不匹配清单。')
                    states={row['entity']:row for row in trace['operating']['cable_states']}
                    for check in view.surface_checks:
                        if abs(check.reference_temperature_k-(states[check.entity]['duct_outer_temperature_c']+273.15))>1e-9:
                            raise ValueError('表面自检参考温度不是本次IEC外部温升。')
                    if [row.model_dump() for row in view.surface_checks]!=trace['soil_view']['surface_checks']:
                        raise ValueError('表面自检与IEC轨迹不一致。')
                    statuses.setdefault(case['case_id'],{})['x-cablesim.iec60287-trace']={'status':'verified','reason':None}
                elif not isinstance(case.get('artifacts',{}).get('x-cablesim.simulation-bundle'),dict) or field.source.bundle_sha256 != digests.get('x-cablesim.simulation-bundle'):
                    raise ValueError('source.bundle_sha256：温度场没有绑定同次封存的原始场工件。')
                if field.mesh.sha256 != digest({k:artifact['mesh'][k] for k in ('points','triangles','domain_ids','regions')}):
                    raise ValueError('mesh.sha256：网格摘要与节点、连接和区域不一致。')
                state = {'status':'verified','reason':None}
            except (ValueError,KeyError,TypeError,StopIteration) as exc:
                state = {'status':'unavailable','reason':str(exc)}
            statuses.setdefault(case['case_id'],{})['x-cablesim.temperature-field'] = state
        return statuses

    def list_runs(self, wid, sid, after=0, limit=50, *, view='full'):
        if view == 'summary':
            from .read_models import summary, RUN_COLUMNS
            from .verified_executor import verification_scope
            with self.store.db() as db:
                db.execute('BEGIN')
                study = self.definition(db, wid, sid)
                revision = db.execute('SELECT revision FROM workspaces WHERE id=?', (wid,)).fetchone()['revision']
                rows = db.execute('SELECT '+RUN_COLUMNS+' FROM study_runs WHERE workspace=? AND study=? AND sequence>? ORDER BY sequence LIMIT ?',
                                  (wid, sid, after, limit + 1)).fetchall()
            page, cache = rows[:limit], {}
            with verification_scope():
                items = [summary(self, row, revision, study, cache) for row in page]
            return {'items': items, 'next_cursor': page[-1]['sequence'] if len(rows) > limit else None}
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
        for run in runs:
            for case in run['output']['cases']:
                comparison=case.get('artifacts',{}).get('x-cablesim.iec-fem-comparison')
                if comparison is None:continue
                status=run['artifact_status'].get(case['case_id'],{}).get('x-cablesim.iec-fem-comparison',{})
                if status.get('status')!='verified':
                    raise HTTPException(409,'IEC/FEM 比较工件来源校验失败，不能纳入计算书。')
                if not comparison['valid']:
                    raise HTTPException(422,'IEC/FEM 比较未通过网格与计算域收敛，不能纳入计算书。')
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
        from .version_status import cover_status
        result['version_status'] = cover_status([self.get_run(wid, s['run_id']) for s in result['sources']])
        return result
