"""Type branches and human publication over immutable research evidence.

Draft facts remain workspace documents. Published payloads extend assembly assets;
this service formats saved outputs and never performs engineering calculations.
"""
from copy import deepcopy
from html import escape
import json
import os
import re
from secrets import compare_digest
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException
from pydantic import Field, field_validator

from ..domain.models import CableType, DomainDocument
from ..foundation.contracts import AssetRelease, SourceReference
from ..schemas import StrictModel
from ..workbench import fingerprint, stamp
from .rating_table import is_rating_table, rating_rows


CHANNELS = {'geometry': 'x-cablesim.cad-model', 'electrical': 'x-cablesim.type-electrical',
            'short_circuit': 'x-cablesim.type-short-circuit', 'standards': 'x-cablesim.standard-check'}
CHAPTERS = ['封面', '型号与执行标准', '结构尺寸表', '电气参数', '载流量表', '短路容量',
            '标准核对结论与偏离表', '修订记录']


def clean_name(text):
    text = re.sub(r'\s*[·（(]\s*(?:资料核对|合成验收数据|(?:典型)?结构演示|演示)[^·）)]*[）)]?', '', text)
    return text.strip(' ·') or '型号'


class Branch(StrictModel):
    expected_revision: int = Field(ge=1)
    request_id: UUID
    name: str = Field(min_length=1, max_length=80)
    document: DomainDocument | None = None

    @field_validator('name')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('请输入方案名称。')
        return value.strip()


class Adopt(StrictModel):
    expected_revision: int = Field(ge=1)
    request_id: UUID


class Submit(Adopt):
    specification_digest: str = Field(pattern=r'^[a-f0-9]{64}$')
    acknowledge_checks: bool = Field(strict=True)


class Approval(StrictModel):
    request_id: UUID
    submission_id: UUID
    specification_digest: str = Field(pattern=r'^[a-f0-9]{64}$')
    reviewer: str = Field(min_length=1, max_length=120)
    human_confirmed: Literal[True]

    @field_validator('reviewer')
    @classmethod
    def reviewer_name(cls, value):
        if not value.strip():
            raise ValueError('请填写批准人。')
        return value.strip()

    @field_validator('human_confirmed', mode='before')
    @classmethod
    def human(cls, value):
        if value is not True:
            raise ValueError('必须由人工明确确认。')
        return value


class Publish(StrictModel):
    request_id: UUID
    submission_id: UUID
    specification_digest: str = Field(pattern=r'^[a-f0-9]{64}$')


class Types:
    def __init__(self, research, assets):
        self.research, self.store, self.assets = research, research.store, assets

    def initialize(self):
        with self.store.db(True) as db:
            for sql in (
                '''CREATE TABLE IF NOT EXISTS type_families (
                  id TEXT PRIMARY KEY, name TEXT NOT NULL, base_reference TEXT NOT NULL,
                  base_document TEXT NOT NULL, head INTEGER NOT NULL DEFAULT 0)''',
                '''CREATE TABLE IF NOT EXISTS type_plans (
                  workspace TEXT PRIMARY KEY, family TEXT NOT NULL, name TEXT NOT NULL,
                  base_reference TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL,
                  adopted_revision INTEGER, adopted_digest TEXT)''',
                '''CREATE TABLE IF NOT EXISTS type_submissions (
                  id TEXT PRIMARY KEY, workspace TEXT NOT NULL, payload TEXT NOT NULL,
                  digest TEXT NOT NULL, status TEXT NOT NULL, receipt TEXT, created TEXT NOT NULL,
                  asset TEXT)''',
                '''CREATE TABLE IF NOT EXISTS type_requests (
                  workspace TEXT NOT NULL, request_id TEXT NOT NULL, request_digest TEXT NOT NULL,
                  result TEXT NOT NULL, PRIMARY KEY(workspace,request_id))''',
                '''CREATE TABLE IF NOT EXISTS engineering_type_releases (
                  asset TEXT PRIMARY KEY, family TEXT NOT NULL, sequence INTEGER NOT NULL,
                  workspace TEXT NOT NULL UNIQUE, submission TEXT NOT NULL UNIQUE,
                  payload TEXT NOT NULL, digest TEXT NOT NULL, receipt TEXT NOT NULL,
                  UNIQUE(family,sequence))'''):
                db.execute(sql)

    def _type(self, db, wid, expected=None):
        row, state = self.store.load(db, wid, expected, allow_domain=True)
        if not state.get('domain') or state.get('study_cable_reference') or len(state['domain']['cable_types']) != 1:
            raise HTTPException(422, '需要独立的单型号文档。')
        return row, state

    @staticmethod
    def _base(state):
        base = state.get('type_origin_reference')
        if not base or not base.get('id') or not base.get('version') or not base.get('content_sha256'):
            raise HTTPException(422, '方案须基于带内容摘要的明确型号版本。')
        return base

    @classmethod
    def _family_id(cls, state):
        base, cable = cls._base(state), state['domain']['cable_types'][0]
        if base.get('source') == 'published_type':
            return base['id']
        # Imported manufacturer documents can originate from the same UI scaffold.
        # Construction/rating/conductor identity keeps different types independent.
        return 'type/'+fingerprint({'origin': base['id'], 'type': cable['id'],
            'construction': cable['construction'], 'u0': cable['rating']['u0'],
            'u': cable['rating'].get('u'), 'cores': [(c['conductor'].get('nominal_area') or c['conductor']['area'],c['conductor']['material']) for c in cable['cores']]})[:24]

    def _register(self, db, wid, state):
        plan = db.execute('SELECT * FROM type_plans WHERE workspace=?', (wid,)).fetchone()
        if plan:
            return dict(plan)
        base = self._base(state)
        fid = self._family_id(state)
        db.execute('INSERT OR IGNORE INTO type_families VALUES (?,?,?,?,0)',
                   (fid, clean_name(state['domain']['cable_types'][0]['label']),
                    json.dumps(base, ensure_ascii=False), json.dumps(state['domain'], ensure_ascii=False)))
        db.execute('INSERT INTO type_plans VALUES (?,?,?,?,?,?,?,?)',
                   (wid, fid, '基准方案', json.dumps(base, ensure_ascii=False), 'draft', stamp(), None, None))
        return dict(db.execute('SELECT * FROM type_plans WHERE workspace=?', (wid,)).fetchone())

    @staticmethod
    def _replay(db, wid, body):
        row = db.execute('SELECT * FROM type_requests WHERE workspace=? AND request_id=?', (wid, str(body.request_id))).fetchone()
        if row:
            if row['request_digest'] != fingerprint(body.model_dump(mode='json')):
                raise HTTPException(409, '请求标识已用于其他操作。')
            return json.loads(row['result'])

    @staticmethod
    def _remember(db, wid, body, result):
        db.execute('INSERT INTO type_requests VALUES (?,?,?,?)',
                   (wid, str(body.request_id), fingerprint(body.model_dump(mode='json')), json.dumps(result, ensure_ascii=False)))

    def branch(self, wid, body):
        with self.store.db(True) as db:
            previous = self._replay(db, wid, body)
            if previous:
                return previous
            row, state = self._type(db, wid, body.expected_revision)
            plan = self._register(db, wid, state)
            source = db.execute('SELECT a.id,a.asset_id,a.version,a.content_sha256,t.payload,t.digest,t.receipt FROM engineering_type_releases t JOIN engineering_assets a ON a.id=t.asset WHERE t.workspace=?', (wid,)).fetchone()
            if source:
                frozen = json.loads(source['payload'])
                self.assets._detail(db, self.assets._load(db, source['id']))
                self._receipt(source['receipt'])
                if fingerprint(frozen) != source['digest'] or fingerprint(frozen['document']) != fingerprint(state['domain']):
                    raise HTTPException(409, '已发布型号与冻结记录不一致。')
            base = ({'id': source['asset_id'], 'version': source['version'], 'content_sha256': source['content_sha256'],
                     'name': clean_name(state['domain']['cable_types'][0]['label']), 'source': 'published_type'} if source else json.loads(plan['base_reference']))
            cloned = deepcopy(state)
            cloned.pop('type_release', None)
            cloned['type_origin_reference'] = base
            cloned['type_plan_source'] = {'workspace': wid, 'revision': row['revision'], 'document_sha256': fingerprint(state['domain'])}
            if body.document:
                cloned['domain'] = body.document.model_dump(mode='json')
                if cloned['domain']['cable_types'][0]['id'] != state['domain']['cable_types'][0]['id']:
                    raise HTTPException(422, '方案须保留同一型号标识。')
            new_id, now = str(uuid4()), stamp()
            encoded = json.dumps(cloned, ensure_ascii=False, allow_nan=False)
            db.execute('INSERT INTO workspaces VALUES (?,?,?,?,?,?)', (new_id, 1, 0, encoded, now, now))
            db.execute('INSERT INTO workspace_history VALUES (?,?,?,?)', (new_id, 0, encoded, '建立型号方案'))
            self.store.archive(db, new_id, 1, cloned)
            db.execute('INSERT INTO type_plans VALUES (?,?,?,?,?,?,?,?)',
                       (new_id, plan['family'], body.name, json.dumps(base, ensure_ascii=False), 'draft', now, None, None))
            self.store.audit(db, new_id, 1, '建立型号方案', json.dumps(cloned['type_plan_source']))
            result = {'workspace_id': new_id, 'family_id': plan['family'], 'base_reference': base, 'name': body.name}
            self._remember(db, wid, body, result)
            return result

    def adopt(self, wid, body):
        with self.store.db(True) as db:
            previous = self._replay(db, wid, body)
            if previous:
                return previous
            row, state = self._type(db, wid, body.expected_revision)
            self.store.assert_mutable(db, wid)
            plan = self._register(db, wid, state)
            if plan['status'] == 'version_draft':
                raise HTTPException(409, '此方案已采纳为版本草稿。')
            db.execute("UPDATE type_plans SET status='version_draft',adopted_revision=?,adopted_digest=? WHERE workspace=?",
                       (row['revision'], fingerprint(state['domain']), wid))
            self.store.audit(db, wid, row['revision'], '采纳为新版本草稿', plan['name'])
            result = {'workspace_id': wid, 'status': 'version_draft', 'adopted_revision': row['revision']}
            self._remember(db, wid, body, result)
            return result

    def evidence(self, wid):
        with self.store.db() as db:
            row, state = self._type(db, wid)
            ids = [r['id'] for r in db.execute('SELECT id FROM study_runs WHERE workspace=? ORDER BY sequence DESC LIMIT 100', (wid,))]
            versions = {r['revision']:json.loads(r['state']).get('domain') for r in db.execute('SELECT revision,state FROM workspace_revisions WHERE workspace=?', (wid,))}
        channels, failures, seen_methods = {}, [], set()
        for rid in ids:
            run = self.research.get_run(wid, rid)
            method = run.get('snapshot', {}).get('definition', {}).get('method', {})
            method_key = (method.get('plugin_id'), method.get('capability'), run.get('snapshot', {}).get('module'))
            if run.get('integrity') != 'verified':
                failures.append({'id': rid, 'message': '运行完整性校验失败。', 'blocking': True})
                continue
            if run.get('status') not in ('succeeded', 'partial'):
                if method_key in seen_methods:
                    continue
                seen_methods.add(method_key)
                reason = (run.get('error') or {}).get('message') or next(((c.get('error') or {}).get('message') for c in (run.get('output') or {}).get('cases', []) if c.get('error')), '运行未完成。')
                failures.append({'id': rid, 'message': reason, 'blocking': True})
                if is_rating_table(run) and 'rating' not in channels:
                    rows = rating_rows(run)
                    for result in rows:
                        result['value_a'] = None
                        result['reason'] = result['reason'] or reason
                    channels['rating'] = {'run': run, 'rows': rows}
                continue
            seen_methods.add(method_key)
            version_document = versions.get(run['snapshot']['workspace_revision'])
            if not version_document or not self._matches_type(run, version_document):
                failures.append({'id': rid, 'message': '运行的型号输入与当前版本不同。', 'blocking': True})
                continue
            for case in (run.get('output') or {}).get('cases', []):
                for channel, artifact_key in CHANNELS.items():
                    if artifact_key in case.get('artifacts', {}) and channel not in channels:
                        channels[channel] = {'run': run, 'artifact': deepcopy(case['artifacts'][artifact_key]), 'case_id': case['case_id']}
            if run['snapshot']['definition']['driver']['kind'] == 'batch' and is_rating_table(run) and 'rating' not in channels:
                channels['rating'] = {'run': run, 'rows': rating_rows(run)}
        return row, state, channels, failures

    @staticmethod
    def _matches_type(run, document):
        target = CableType.model_validate(document['cable_types'][0]).model_dump(mode='json')
        rating = is_rating_table(run)
        if rating:
            for core in target['cores']:
                observed = next((m for m in document.get('measurements', []) if m['cable_type']==target['id']
                                 and m.get('core')==core['id'] and m['quantity']=='r20' and m['basis']=='measurement'), None)
                if observed:
                    core['conductor'].update(r20=observed['value'], r20_basis='measurement')
        inputs = run['snapshot'].get('cases', [])
        def normalized(value):
            try:
                return fingerprint(CableType.model_validate(value).model_dump(mode='json'))
            except ValueError:
                return None
        expected = fingerprint(target)
        return bool(inputs) and all(any(normalized(c)==expected for c in case.get('input',{}).get('cable_types',[])) for case in inputs)

    @staticmethod
    def _source(channel, data):
        run = data['run']
        return {'channel': channel, 'run_id': run['id'], 'study_id': run['study'],
                'input_digest': run['input_digest'], 'output_digest': run['output_digest'],
                'workspace_revision': run['snapshot']['workspace_revision'],
                'study_revision': run['snapshot']['study_revision'], 'method': run['snapshot']['definition']['method'],
                'freshness': run['freshness'], 'status': run['status']}

    def specification(self, wid):
        row, state, channels, checks = self.evidence(wid)
        d, t = state['domain'], state['domain']['cable_types'][0]
        sources = [self._source(key, data) for key, data in channels.items()]
        for key in ('geometry', 'electrical', 'rating', 'short_circuit', 'standards'):
            item = channels.get(key)
            if not item:
                checks.append({'id': key+'/missing', 'channel': key, 'message': dict(geometry='结构推导', electrical='电气参数', rating='载流量表', short_circuit='短路容量', standards='标准核对')[key]+'尚无保存运行。', 'blocking': True})
                continue
            if item['run']['freshness'] != 'current':
                checks.append({'id': key+'/historical', 'channel': key, 'message': '所引运行为历史结果，请更新'+key+'。', 'blocking': True})
            if item['run']['status'] not in ('succeeded', 'partial'):
                checks.append({'id': key+'/failed', 'channel': key, 'message': '所引运行未完成，请更新'+key+'。', 'blocking': True})
            artifact = item.get('artifact', {})
            if key in ('electrical', 'short_circuit', 'standards'):
                for result in artifact.get('rows', []):
                    unavailable = result.get('verdict') in ('uncovered', 'missing', 'fail', 'failed') if key == 'standards' else result.get('status') not in ('available',)
                    if unavailable:
                        checks.append({'id': key+'/'+result['id'], 'channel': key, 'message': result.get('title', result['id'])+'：'+str(result.get('reason') or result.get('verdict') or result.get('status'))+'。', 'blocking': True})
            if key == 'geometry' and artifact.get('mass_kg_per_km') is None:
                checks.append({'id': 'geometry/mass', 'channel': key, 'message': '单位长度用料缺少完整材料密度或构造输入。', 'blocking': True})
            if key == 'rating':
                for result in item['rows']:
                    if result['value_a'] is None:
                        checks.append({'id': 'rating/'+result['case_id'], 'channel': key, 'message': result['name']+'：'+str(result['reason'] or result['status'])+'。', 'blocking': result['status'] != '超出范围'})
        data = {key: {k: deepcopy(v) for k, v in item.items() if k != 'run'} for key, item in channels.items()}
        with self.store.db() as db:
            history = self._revisions(db, wid)
            requirement_reviews = self._requirement_reviews(db, wid)
            submitted = db.execute('SELECT * FROM type_submissions WHERE workspace=? ORDER BY rowid DESC LIMIT 1', (wid,)).fetchone()
            published = db.execute('SELECT * FROM engineering_type_releases WHERE workspace=?', (wid,)).fetchone()
        payload = {'schema': 'cablesim.type-specification/1', 'renderer': 'type-specification/1',
                   'workspace_id': wid, 'revision': row['revision'], 'name': clean_name(t['label']),
                   'purpose': 'demo' if '演示' in t['label'] or '合成验收数据' in t['label'] or any(s.get('kind')=='demo' for s in d.get('provenance',{}).values()) else 'engineering',
                   'base_reference': self._base(state), 'document': deepcopy(d), 'chapters': CHAPTERS,
                   'sources': sources, 'results': data, 'checks': checks, 'revisions': history,
                   'requirement_reviews': requirement_reviews}
        digest = fingerprint(payload)
        lifecycle = {'status': 'draft', 'submission_id': None, 'approval': None, 'stale': False}
        if submitted:
            lifecycle = {'status': submitted['status'], 'submission_id': submitted['id'],
                         'approval': self._receipt(submitted['receipt']) if submitted['receipt'] else None,
                         'stale': submitted['digest'] != digest}
        if published:
            frozen = json.loads(published['payload'])
            if fingerprint(frozen) != published['digest']:
                raise HTTPException(409, '已发布规格书完整性异常。')
            payload, digest = frozen, published['digest']
            lifecycle = {'status': 'published', 'submission_id': published['submission'], 'approval': self._receipt(published['receipt']), 'asset_id': published['asset'], 'stale': False}
        return {'payload': payload, 'digest': digest, 'lifecycle': lifecycle, 'ready': not any(c['blocking'] for c in payload['checks']), 'html': render_specification(payload, digest, lifecycle)}

    def _validate_sources(self, db, wid, payload):
        row, state = self._type(db, wid, payload['revision'])
        if fingerprint(state['domain']) != fingerprint(payload['document']):
            raise HTTPException(409, '型号输入已变化，请重新生成规格书。')
        if self._revisions(db, wid) != payload['revisions'] or self._requirement_reviews(db, wid) != payload['requirement_reviews']:
            raise HTTPException(409, '修订记录或要求批准状态已变化，请重新提交。')
        for source in payload['sources']:
            saved = db.execute('SELECT * FROM study_runs WHERE workspace=? AND id=?', (wid, source['run_id'])).fetchone()
            if not saved or saved['input_digest'] != source['input_digest'] or saved['output_digest'] != source['output_digest']:
                raise HTTPException(409, '运行来源已变化。')
            if saved['status'] not in ('succeeded', 'partial'):
                raise HTTPException(409, '源运行未完成，不能用于审核发布。')
            snapshot = json.loads(saved['snapshot'])
            if fingerprint(snapshot) != saved['input_digest'] or fingerprint(json.loads(saved['output'])) != saved['output_digest']:
                raise HTTPException(409, '运行来源完整性异常。')
            study = self.research.definition(db, wid, saved['study'])
            selected = self.research.module_definition(study['definition'], snapshot.get('module'))
            if study['revision'] != source['study_revision'] or self.research.lock(db, wid, row['revision'], selected['method']) != snapshot['lock']:
                raise HTTPException(409, '研究或方法版本已变化，请重新提交。')
            self.research.resolve(selected['method'])
        return row

    @staticmethod
    def _revisions(db, wid):
        return [dict(r) for r in db.execute('SELECT revision,event,details,created FROM workspace_audit WHERE workspace=? ORDER BY rowid', (wid,))
                if r['event'] not in ('提交规格书审核', '人工批准规格书', '发布型号版本')]

    @staticmethod
    def _requirement_reviews(db, wid):
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='requirement_reviews'").fetchone():
            return []
        result = []
        for row in db.execute('SELECT id,revision,receipt,digest FROM requirement_reviews WHERE workspace=? ORDER BY revision', (wid,)):
            receipt = json.loads(row['receipt'])
            if fingerprint(receipt) != row['digest']:
                raise HTTPException(409, '要求批准记录完整性异常。')
            result.append({'id':row['id'], 'revision':row['revision'], 'digest':row['digest'], 'receipt':receipt})
        return result

    def submit(self, wid, body):
        with self.store.db() as db:
            previous = self._replay(db, wid, body)
            if previous:
                return previous
        spec = self.specification(wid)
        if spec['digest'] != body.specification_digest:
            raise HTTPException(409, '规格书内容已变化，请查看最新清单。')
        if spec['payload']['checks'] and not body.acknowledge_checks:
            raise HTTPException(422, {'message': '请核对提交前清单。', 'checks': spec['payload']['checks']})
        with self.store.db(True) as db:
            previous = self._replay(db, wid, body)
            if previous:
                return previous
            self.store.assert_mutable(db, wid)
            row, state = self._type(db, wid, body.expected_revision)
            self._validate_sources(db, wid, spec['payload'])
            plan = self._register(db, wid, state)
            if plan['status'] != 'version_draft':
                raise HTTPException(422, '请先采纳方案为新版本草稿。')
            sid = str(uuid4())
            db.execute('INSERT INTO type_submissions VALUES (?,?,?,?,?,?,?,?)',
                       (sid, wid, json.dumps(spec['payload'], ensure_ascii=False), spec['digest'], 'submitted', None, stamp(), None))
            self.store.audit(db, wid, row['revision'], '提交规格书审核', sid)
            result = {'submission_id': sid, 'digest': spec['digest'], 'status': 'submitted', 'checks': spec['payload']['checks']}
            self._remember(db, wid, body, result)
            return result

    @staticmethod
    def _human(actor, credential):
        # An actor string is not authority. The separately provisioned operator
        # credential is never returned by API or registered as an AI/plugin tool.
        if actor != 'human':
            raise HTTPException(403, '此操作限本机人工确认；AI 和插件仅可提交审核。')
        expected = os.environ.get('CABLESIM_TYPE_APPROVER_TOKEN', '')
        if not expected:
            raise HTTPException(503, '人工审核凭据尚未配置。')
        if not credential or not credential.startswith('Bearer ') or not compare_digest(credential[7:], expected):
            raise HTTPException(403, '人工审核凭据无效。')

    def _submission(self, db, wid, sid, digest):
        row = db.execute('SELECT * FROM type_submissions WHERE workspace=? AND id=?', (wid, str(sid))).fetchone()
        if not row:
            raise HTTPException(404, '审核提交不存在。')
        payload = json.loads(row['payload'])
        if fingerprint(payload) != row['digest'] or row['digest'] != digest:
            raise HTTPException(409, '审核内容摘要不一致。')
        return row, payload

    @staticmethod
    def _receipt(encoded):
        try:
            receipt = json.loads(encoded)
            digest = receipt['receipt_digest']
            if fingerprint({k:v for k,v in receipt.items() if k != 'receipt_digest'}) != digest:
                raise ValueError('digest')
            return receipt
        except (ValueError, KeyError, TypeError):
            raise HTTPException(409, '人工批准记录完整性异常。') from None

    def approve(self, wid, body, actor, credential=None):
        self._human(actor, credential)
        with self.store.db(True) as db:
            previous = self._replay(db, wid, body)
            if previous:
                return previous
            submission, payload = self._submission(db, wid, body.submission_id, body.specification_digest)
            if submission['status'] != 'submitted':
                raise HTTPException(409, '当前提交不处于待审核状态。')
            self._validate_sources(db, wid, payload)
            if any(c['blocking'] for c in payload['checks']):
                raise HTTPException(422, {'message': '请解决提交清单中的缺项后重新提交。', 'checks': payload['checks']})
            receipt = {'id': str(uuid4()), 'reviewer': body.reviewer, 'approved_at': stamp(),
                       'decision': 'approved', 'authority': 'local_manual_confirmation',
                       'submission_id': submission['id'], 'specification_digest': submission['digest'],
                       'workspace_revision': payload['revision'], 'sources': payload['sources']}
            receipt['receipt_digest'] = fingerprint(receipt)
            db.execute("UPDATE type_submissions SET status='approved',receipt=? WHERE id=?", (json.dumps(receipt, ensure_ascii=False), submission['id']))
            self.store.audit(db, wid, payload['revision'], '人工批准规格书', json.dumps(receipt, ensure_ascii=False))
            self._remember(db, wid, body, receipt)
            return receipt

    def publish(self, wid, body, actor, credential=None):
        self._human(actor, credential)
        with self.store.db(True) as db:
            previous = self._replay(db, wid, body)
            if previous:
                return previous
            submission, payload = self._submission(db, wid, body.submission_id, body.specification_digest)
            if submission['status'] != 'approved' or not submission['receipt']:
                raise HTTPException(409, '须先取得当前内容的人工批准。')
            self._validate_sources(db, wid, payload)
            receipt = self._receipt(submission['receipt'])
            if receipt['specification_digest'] != submission['digest'] or any(c['blocking'] for c in payload['checks']):
                raise HTTPException(409, '人工批准不属于可发布的当前内容。')
            plan = db.execute('SELECT * FROM type_plans WHERE workspace=?', (wid,)).fetchone()
            family = db.execute('SELECT * FROM type_families WHERE id=?', (plan['family'],)).fetchone()
            base = json.loads(plan['base_reference'])
            latest = db.execute('SELECT a.* FROM engineering_type_releases t JOIN engineering_assets a ON a.id=t.asset WHERE t.family=? ORDER BY t.sequence DESC LIMIT 1', (plan['family'],)).fetchone()
            if latest and (base.get('id'), base.get('version'), base.get('content_sha256')) != (latest['asset_id'], latest['version'], latest['content_sha256']):
                raise HTTPException(409, '型号库已有后续版本，请基于最新发布版本建立草稿。')
            version = next_version(base['version'])
            asset = self.assets._insert(db, AssetRelease(asset_id=plan['family'], version=version, kind='assembly', name=payload['name'],
                  sources=(SourceReference(kind='project_input', reference='规格书 '+submission['id']+' sha256:'+submission['digest'], reviewed=True),)), '人工批准的型号规格书', managed_type=True)
            db.execute('INSERT INTO engineering_type_releases VALUES (?,?,?,?,?,?,?,?)',
                       (asset, plan['family'], family['head']+1, wid, submission['id'], submission['payload'], submission['digest'], submission['receipt']))
            digest = self.assets._load(db, asset)['content_sha256']
            for action, status in (('review', 'reviewed'), ('publish', 'published')):
                db.execute('UPDATE engineering_assets SET status=?,revision=revision+1,reviewed_sha256=?,updated=? WHERE id=?', (status, digest, stamp(), asset))
                self.assets._event(db, self.assets._load(db, asset), action, '批准人 '+receipt['reviewer']+'；'+receipt['approved_at'])
            db.execute('UPDATE type_families SET head=head+1 WHERE id=?', (plan['family'],))
            db.execute("UPDATE type_plans SET status='published' WHERE workspace=?", (wid,))
            db.execute("UPDATE type_submissions SET status='published',asset=? WHERE id=?", (asset, submission['id']))
            self.store.audit(db, wid, payload['revision'], '发布型号版本', asset)
            result = {'status': 'published', 'asset_id': asset, 'asset_reference': {'id': plan['family'], 'version': version, 'content_sha256': digest}, 'approval': receipt}
            self._remember(db, wid, body, result)
            return result

    def comparison(self, wid):
        with self.store.db() as db:
            _, state = self._type(db, wid)
            current = db.execute('SELECT * FROM type_plans WHERE workspace=?', (wid,)).fetchone()
            base = self._base(state)
            fid = current['family'] if current else self._family_id(state)
            family = db.execute('SELECT * FROM type_families WHERE id=?', (fid,)).fetchone()
            plans = [dict(p) for p in db.execute('SELECT * FROM type_plans WHERE family=? ORDER BY created', (fid,))]
        if not any(p['workspace'] == wid for p in plans):
            plans.insert(0, {'workspace': wid, 'family': fid, 'name': '基准方案', 'status': 'draft', 'base_reference': json.dumps(base)})
        items = []
        for plan in plans:
            row, state, channels, failures = self.evidence(plan['workspace'])
            values = {}
            for channel, item in channels.items():
                source = self._source(channel, item)
                artifact = item.get('artifact', {})
                if channel == 'geometry':
                    values['outer_diameter'] = metric(artifact.get('outer_diameter_m'), 'm', source)
                    values['mass'] = metric(artifact.get('mass_kg_per_km'), 'kg/km', source)
                    copper = [r for r in artifact.get('layers', []) if r.get('role') == 'conductor']
                    conductor = state['domain']['cable_types'][0]['cores'][0]['conductor']
                    material = next((m for m in state['domain']['materials'] if m['id'] == conductor['material']), {})
                    is_copper = material.get('standard_kind') in ('copper', 'copper_bare', 'copper_coated') or material.get('label', '').lower() in ('copper', '铜', 'cu')
                    cu_mass = copper[0].get('mass_kg_per_km') if copper and is_copper else None
                    values['copper_mass'] = metric(cu_mass, 'kg/km', source)
                elif channel == 'rating':
                    for r in item['rows']:
                        condition = {k:v for k,v in r['condition'].items() if k not in ('case_id','name','source','actual_spacing_m')}
                        condition = {k:float(format(v,'.12g')) if isinstance(v,float) else v for k,v in condition.items()}
                        # Explicit spacing stays in the key; automatic touching
                        # spacing follows the variant OD and is recorded per cell.
                        key = 'rating/'+fingerprint(condition)[:24]
                        values[key] = metric(r['value_a'], 'A', {**source, 'condition': r['condition'], 'case_id': r['case_id']}, r['name'], r['reason'])
                elif channel == 'short_circuit':
                    conductors = [r for r in artifact.get('rows', []) if r['id'].endswith('conductor-adiabatic')]
                    merged = bool(conductors) and all((r['status'],r.get('value'),r.get('unit'),r.get('formula_inputs')) == (conductors[0]['status'],conductors[0].get('value'),conductors[0].get('unit'),conductors[0].get('formula_inputs')) for r in conductors)
                    for r in conductors[:1] if merged else conductors:
                        if r['id'].endswith('conductor-adiabatic'):
                            key = 'short_circuit/conductor' if merged else 'short_circuit/'+r['target']['core_id']
                            values[key] = metric(r.get('value') if r['status']=='available' else None, r.get('unit'), {**source, 'conditions': item['run']['snapshot']['definition']['parameters']}, '导体短路容量（每芯）' if merged else r['title'], r.get('reason'))
                elif channel == 'standards':
                    rows = artifact.get('rows', [])
                    values['standards'] = metric(sum(r.get('verdict') == 'passed' for r in rows), '项', source, '标准核对通过')
                    values['standards']['total'] = len(rows)
            for key, unit in (('outer_diameter','m'),('mass','kg/km'),('copper_mass','kg/km')):
                values.setdefault(key, metric(None, unit, None))
            items.append({**plan, 'base_reference': json.loads(plan['base_reference']), 'revision': row['revision'],
                          'document': state['domain'], 'values': values, 'sources': [self._source(k,v) for k,v in channels.items()], 'issues': failures})
        return {'family_id': fid, 'name': family['name'] if family else clean_name(base.get('name', '型号')), 'items': items}

    def library(self):
        with self.store.db() as db:
            rows = db.execute('SELECT a.*,t.workspace,t.family,t.submission,t.receipt,t.payload,t.digest FROM engineering_type_releases t JOIN engineering_assets a ON a.id=t.asset WHERE a.status=\'published\' ORDER BY a.created DESC').fetchall()
            result = []
            for row in rows:
                payload = json.loads(row['payload'])
                if fingerprint(payload) != row['digest']:
                    raise HTTPException(409, '型号库版本内容完整性异常。')
                self.assets._detail(db, self.assets._load(db, row['id']))
                result.append({**self.assets._summary(row), 'workspace_id':row['workspace'],
                               'purpose':payload['purpose'], 'specification_digest':row['digest'],
                               'definition_endpoint':'/api/types/'+row['workspace']+'/specification',
                               'approval':self._receipt(row['receipt'])})
        return {'items': result}


def metric(value, unit, source, title=None, reason=None):
    return {'value': value, 'unit': unit, 'source': source, 'title': title, 'reason': reason,
            'state': 'missing' if value is None else 'historical' if source and source['freshness'] != 'current' else 'current'}


def next_version(version):
    match = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9.-]+)?', version)
    return f'{match[1]}.{match[2]}.{int(match[3])+1}' if match else '1.0.0'


def render_specification(payload, digest, lifecycle):
    """Only format input snapshots and exact stored outputs; no physics here."""
    e = lambda v: escape(str(v if v is not None else '—'))
    def table(headings, rows):
        return '<table><thead><tr>'+''.join('<th>'+e(h)+'</th>' for h in headings)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+e(v)+'</td>' for v in row)+'</tr>' for row in rows)+'</tbody></table>'
    t, results = payload['document']['cable_types'][0], payload['results']
    structure = [[c['id'], 'conductor', c['conductor']['diameter']*1000, c['conductor']['nominal_area']*1e6, c['conductor']['material']] for c in t['cores']]
    structure += [[c['id'], l['role'], l['thickness']*1000, '—', l['material']] for c in t['cores'] for l in c['layers']]
    structure += [['共同层', l['role'], l['thickness']*1000, '—', l['material']] for l in t['common_layers']]
    standards = results.get('standards', {}).get('artifact', {}).get('rows', [])
    bodies = [
        '<h1>'+e(payload['name'])+'</h1>'+('<p>演示</p>' if payload['purpose']=='demo' else '')+'<p>修订 r'+e(payload['revision'])+' · '+e({'draft':'草稿','submitted':'待人工审核','approved':'已批准','published':'已发布'}.get(lifecycle['status'],lifecycle['status']))+'</p><p>基于 '+e(payload['base_reference']['version'])+'</p>',
        table(['型号', 'U₀ / V', 'U / V', '芯数'], [[payload['name'], t['rating']['u0'], t['rating'].get('u'), len(t['cores'])]])+table(['执行标准', '条款'], sorted({(r.get('standard',''),r.get('clause','')) for r in standards})),
        table(['对象', '结构层', '径向尺寸 / mm', '导体面积 / mm²', '材料'], structure)+table(['结果', '保存值 / SI'], [[k,v] for k,v in results.get('geometry',{}).get('artifact',{}).items() if k in ('outer_diameter_m','mass_kg_per_km')]),
        table(['参数', '保存值', '单位', '状态', '标准 / 条款'], [[r['title'],r.get('value'),r.get('unit'),r['status'],r.get('standard','')+' '+r.get('clause','')] for r in results.get('electrical',{}).get('artifact',{}).get('rows',[])]),
        table(['工况', '允许电流 / A', '状态', '原因'], [[r['name'],r['value_a'],r['status'],r['reason']] for r in results.get('rating',{}).get('rows',[])]),
        table(['组件', '保存值', '单位', '状态', '标准 / 条款'], [[r['title'],r.get('value'),r.get('unit'),r['status'],r.get('standard','')+' '+r.get('clause','')] for r in results.get('short_circuit',{}).get('artifact',{}).get('rows',[])]),
        table(['要求', '标准 / 条款', '要求值', '当前值', '单位', '判定', '偏离 / 缺项'], [[r['title'],r.get('standard','')+' '+r.get('clause',''),r.get('limit'),r.get('actual'),r.get('unit'),{'passed':'满足','failed':'不满足','missing':'缺项','uncovered':'范围外'}.get(r.get('verdict'),r.get('verdict')),r.get('reason')] for r in standards])+table(['提交前校核'], [[c['message']] for c in payload['checks']]),
        table(['修订', '事件', '时间'], [[r['revision'],r['event'],r['created']] for r in payload['revisions']])
    ]
    source = '<details><summary>运行、输入摘要与方法版本</summary><pre>'+e(json.dumps({'digest':digest,'sources':payload['sources'],'approval':lifecycle.get('approval')},ensure_ascii=False,indent=2))+'</pre></details>'
    return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>'+e(payload['name'])+' · 规格书</title><link rel="stylesheet" href="/design/tokens.css"><style>body{font:var(--text-body)/1.6 var(--font-ui);color:var(--text);max-width:1100px;margin:auto;padding:var(--space-8)}h1,h2{font-weight:var(--weight-strong)}section{margin-bottom:var(--space-8)}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{padding:var(--space-2);border:1px solid var(--border);text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media print{section{break-inside:avoid}details{display:none}}</style>'+''.join('<section id="chapter-'+str(i+1)+'"><h2>'+str(i+1)+'. '+e(name)+'</h2>'+body+'</section>' for i,(name,body) in enumerate(zip(CHAPTERS,bodies)))+source+'</html>'


def make_router(service):
    router = APIRouter(prefix='/api/types', tags=['Type versions'])
    @router.get('/library')
    def library():
        return service.library()
    @router.get('/{wid}/comparison')
    def comparison(wid: str):
        return service.comparison(wid)
    @router.post('/{wid}/plans', status_code=201)
    def branch(wid: str, body: Branch):
        return service.branch(wid, body)
    @router.post('/{wid}/adopt')
    def adopt(wid: str, body: Adopt):
        return service.adopt(wid, body)
    @router.get('/{wid}/specification')
    def specification(wid: str):
        return service.specification(wid)
    @router.post('/{wid}/submissions', status_code=201)
    def submit(wid: str, body: Submit):
        return service.submit(wid, body)
    @router.post('/{wid}/approve')
    def approve(wid: str, body: Approval, x_cablesim_actor: str | None = Header(default=None), authorization: str | None = Header(default=None)):
        return service.approve(wid, body, x_cablesim_actor, authorization)
    @router.post('/{wid}/publish')
    def publish(wid: str, body: Publish, x_cablesim_actor: str | None = Header(default=None), authorization: str | None = Header(default=None)):
        return service.publish(wid, body, x_cablesim_actor, authorization)
    return router
