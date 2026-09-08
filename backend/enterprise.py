"""Versioned product definitions and project-specific design studies.

Product payloads are immutable. Review/withdrawal are explicit lifecycle events.
This is a single-user local preview; reviewer labels are declarations, not authenticated signatures.
"""
from copy import deepcopy
from html import escape
import json
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import Field, model_validator
from .schemas import Cable, Scenario, StrictModel
from .workbench import Revision, fingerprint, stamp
from .selection import DesignRequest
from .agent import Change, patch


class ProductSpecification(StrictModel):
    code: str = Field(min_length=1, max_length=80, pattern=r'^[^\x00-\x1f]+$')
    name: str = Field(min_length=1, max_length=120)
    manufacturer: str = Field(min_length=1, max_length=120)
    cable: Cable
    rated_u0_kv: float = Field(ge=1, le=26)
    r20_basis: Literal['manufacturer_maximum', 'sample_measurement', 'estimated'] = 'estimated'
    evidence_note: str = Field(default='', max_length=1500)
    price_per_m: float | None = Field(default=None, ge=0, le=100000)
    currency: Literal['CNY', 'USD', 'EUR'] = 'CNY'
    source_workspace_id: UUID | None = None
    source_id: UUID | None = None

    @model_validator(mode='after')
    def check_product(self):
        self.code = self.code.strip()
        if not self.code or not self.name.strip() or not self.manufacturer.strip():
            raise ValueError('型号编码、名称和企业名称不能只有空白。')
        if self.rated_u0_kv < self.cable.u0_kv:
            raise ValueError('声明额定 U₀ 不能低于电缆定义中的 U₀。')
        if self.r20_basis != 'estimated' and self.cable.r20_ohm_km is None:
            raise ValueError('声明厂家保证值或试样实测值时必须填写 R20。')
        if bool(self.source_id) != bool(self.source_workspace_id):
            raise ValueError('资料引用必须同时指定工程与引用标识。')
        return self


class NewProductVersion(StrictModel):
    expected_head: int = Field(ge=1)
    specification: ProductSpecification


class ProductReview(StrictModel):
    content_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    confirmed: bool = False
    reviewer: str = Field(min_length=1, max_length=80)
    note: str = Field(min_length=5, max_length=1500)


class ProductChoice(StrictModel):
    version_id: UUID


class ForkProject(Revision):
    name: str = Field(min_length=1, max_length=120)


class StudyReference(StrictModel):
    study_id: UUID


# Operating voltage/frequency belong to the installation study, not to model identity.
OPERATING_FIELDS = {'u0_kv', 'frequency_hz', 'max_temperature_c'}


def validate_product_binding(db, binding: dict):
    """Called in the same transaction that approves a project change (no check/write race)."""
    row = db.execute('SELECT * FROM enterprise_product_versions WHERE id=?', (binding['version_id'],)).fetchone()
    if row is None or row['state'] != 'reviewed' or row['content_hash'] != binding['content_sha256']:
        raise HTTPException(409, '引用型号未核对、已停用或内容校验不一致；请重新选择。')
    latest = db.execute("SELECT MAX(version) FROM enterprise_product_versions WHERE product=? AND state='reviewed'", (row['product'],)).fetchone()[0]
    newest_review = db.execute("SELECT MAX(v.version) FROM enterprise_product_versions v WHERE v.product=? AND EXISTS (SELECT 1 FROM enterprise_product_events e WHERE e.version_id=v.id AND e.event='核对型号')", (row['product'],)).fetchone()[0]
    if row['version'] != latest or latest != newest_review:
        raise HTTPException(409, '该型号已有更新的已核对版本，不能批准旧候选；请重新研究。')


class Enterprise:
    def __init__(self, store, designs):
        self.store, self.designs = store, designs

    def initialize(self):
        with self.store.db() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS enterprise_products (
                id TEXT PRIMARY KEY, code TEXT UNIQUE COLLATE NOCASE, head INTEGER NOT NULL, created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS enterprise_product_versions (
                id TEXT PRIMARY KEY, product TEXT NOT NULL, version INTEGER NOT NULL,
                payload TEXT NOT NULL, content_hash TEXT NOT NULL, state TEXT NOT NULL,
                created TEXT NOT NULL, UNIQUE(product, version));
            CREATE TABLE IF NOT EXISTS enterprise_product_events (
                id TEXT PRIMARY KEY, product TEXT NOT NULL, version_id TEXT NOT NULL,
                event TEXT NOT NULL, reviewer TEXT NOT NULL, note TEXT NOT NULL, created TEXT NOT NULL);
            ''')

    def _event(self, db, product, version, event, reviewer='', note=''):
        db.execute('INSERT INTO enterprise_product_events VALUES (?,?,?,?,?,?,?)',
                   (str(uuid4()), product, version, event, reviewer, note, stamp()))

    def _payload(self, db, spec):
        data = spec.model_dump(mode='json')
        source = None
        if spec.source_id:
            _, state = self.store.load(db, str(spec.source_workspace_id))
            source = next((s for s in state['sources'] if s['id'] == str(spec.source_id)), None)
            if source is None:
                raise HTTPException(422, '资料引用不存在或不属于所选工程。')
            if not source.get('excerpts'):
                raise HTTPException(422, '所选引用没有可核对的参数节选。')
            for e in source['excerpts']:
                if e['path'].startswith('cable.') and spec.cable.model_dump().get(e['path'][6:]) != e['value']:
                    raise HTTPException(422, '型号参数与引用原文中的已确认数值不一致。')
        data['source_snapshot'] = deepcopy(source)
        return data

    def _insert_version(self, db, product, number, spec):
        data = self._payload(db, spec)
        vid = str(uuid4())
        db.execute('INSERT INTO enterprise_product_versions VALUES (?,?,?,?,?,?,?)',
                   (vid, product, number, json.dumps(data, ensure_ascii=False), fingerprint(data), 'draft', stamp()))
        self._event(db, product, vid, '建立型号版本')
        return vid

    def create(self, spec):
        import sqlite3
        with self.store.db(True) as db:
            if db.execute('SELECT COUNT(*) FROM enterprise_products').fetchone()[0] >= 200:
                raise HTTPException(422, '本机预览版最多管理 200 个产品。')
            pid = str(uuid4())
            try:
                db.execute('INSERT INTO enterprise_products VALUES (?,?,?,?)', (pid, spec.code, 1, stamp()))
            except sqlite3.IntegrityError:
                raise HTTPException(409, '型号编码已存在，请为已有型号建立新版本。') from None
            vid = self._insert_version(db, pid, 1, spec)
        return self.version(vid)

    def new_version(self, pid, req):
        with self.store.db(True) as db:
            product = db.execute('SELECT * FROM enterprise_products WHERE id=?', (pid,)).fetchone()
            if product is None:
                raise HTTPException(404, '型号不存在。')
            if product['head'] != req.expected_head:
                raise HTTPException(409, '型号版本已变化，请重新读取，不会覆盖别人的修改。')
            if product['code'] != req.specification.code:
                raise HTTPException(422, '已有型号编码不能通过修订改名，请另建型号。')
            number = product['head'] + 1
            vid = self._insert_version(db, pid, number, req.specification)
            db.execute('UPDATE enterprise_products SET head=? WHERE id=?', (number, pid))
        return self.version(vid)

    def _version(self, db, vid):
        row = db.execute('SELECT * FROM enterprise_product_versions WHERE id=?', (vid,)).fetchone()
        if row is None:
            raise HTTPException(404, '型号版本不存在。')
        p = db.execute('SELECT * FROM enterprise_products WHERE id=?', (row['product'],)).fetchone()
        latest = db.execute("SELECT MAX(version) FROM enterprise_product_versions WHERE product=? AND state='reviewed'", (row['product'],)).fetchone()[0]
        # Withdrawal of a newer revision does not silently restore an older product for new selection.
        newest_review = db.execute("SELECT MAX(v.version) FROM enterprise_product_versions v WHERE v.product=? AND EXISTS (SELECT 1 FROM enterprise_product_events e WHERE e.version_id=v.id AND e.event='核对型号')", (row['product'],)).fetchone()[0]
        events = [dict(r) for r in db.execute('SELECT event,reviewer,note,created FROM enterprise_product_events WHERE version_id=? ORDER BY rowid', (vid,))]
        return {'id': row['id'], 'product_id': row['product'], 'version': row['version'], 'head': p['head'],
                'state': row['state'], 'content_sha256': row['content_hash'], 'created_at': row['created'],
                'is_current_reviewed': row['state'] == 'reviewed' and row['version'] == latest and latest == newest_review,
                'specification': json.loads(row['payload']), 'events': events}

    def version(self, vid):
        with self.store.db() as db:
            return self._version(db, vid)

    def versions(self, pid):
        with self.store.db() as db:
            ids = [r[0] for r in db.execute('SELECT id FROM enterprise_product_versions WHERE product=? ORDER BY version DESC', (pid,))]
            if not ids:
                raise HTTPException(404, '型号不存在。')
            return [self._version(db, vid) for vid in ids]

    def list(self):
        with self.store.db() as db:
            ids = [r[0] for r in db.execute('SELECT v.id FROM enterprise_products p JOIN enterprise_product_versions v ON v.product=p.id AND v.version=p.head ORDER BY p.created DESC')]
            return [self._version(db, vid) for vid in ids]

    def transition(self, vid, req, action):
        if not req.confirmed or not req.reviewer.strip() or len(req.note.strip()) < 5:
            raise HTTPException(422, '请填写核对人、说明并明确确认。')
        with self.store.db(True) as db:
            version = self._version(db, vid)
            if version['content_sha256'] != req.content_sha256:
                raise HTTPException(409, '核对内容校验不一致。')
            if action == 'review':
                if version['state'] != 'draft' or version['version'] != version['head']:
                    raise HTTPException(409, '只能核对当前最新草稿；已核对或历史版本不能重复核对。')
                spec = version['specification']
                if spec['r20_basis'] != 'manufacturer_maximum' or spec['cable']['r20_ohm_km'] is None:
                    raise HTTPException(422, '用于正式候选的型号需要厂家保证 R20；估算值或单个试样实测值只能保留为草稿。')
                if len(spec['evidence_note'].strip()) < 5:
                    raise HTTPException(422, '请说明厂家保证值与完整参数的核对依据。')
                state, event = 'reviewed', '核对型号'
            else:
                if version['state'] != 'reviewed':
                    raise HTTPException(409, '只有已核对版本可以停用。')
                state, event = 'withdrawn', '停用型号'
            db.execute('UPDATE enterprise_product_versions SET state=? WHERE id=?', (state, vid))
            self._event(db, version['product_id'], vid, event, req.reviewer.strip(), req.note.strip())
        return self.version(vid)

    def eligible(self):
        with self.store.db() as db:
            ids = [r[0] for r in db.execute("SELECT id FROM enterprise_product_versions WHERE state='reviewed'")]
            return [v for vid in ids if (v := self._version(db, vid))['is_current_reviewed']]

    def propose(self, wid, revision, args):
        version = self.version(str(args.version_id))
        if not version['is_current_reviewed']:
            raise HTTPException(409, '只能引用当前已核对且未停用的型号版本。')
        with self.store.db() as db:
            _, state = self.store.load(db, wid, revision)
        original = Scenario.model_validate(state['scenario'])
        spec = version['specification']
        if spec['rated_u0_kv'] < original.cable.u0_kv:
            raise HTTPException(422, '型号声明的额定 U₀ 低于本工程要求。')
        c = dict(spec['cable'])
        c.update(u0_kv=original.cable.u0_kv, frequency_hz=original.cable.frequency_hz,
                 max_temperature_c=min(c['max_temperature_c'], original.cable.max_temperature_c))
        try:
            candidate, diff = patch(original, [Change(path='cable.' + k, value=v) for k, v in c.items()])
        except ValueError as exc:
            raise HTTPException(422, '型号与当前结构或敷设不兼容：' + str(exc)) from None
        binding = self.binding(version, c)
        return self.store.stage(wid, revision, {'ready': True, 'action': 'import', 'scenario': candidate.model_dump(),
            'changes': diff, 'mode': 'enterprise-product', 'message': '引用企业型号 ' + spec['code'],
            'questions': [], 'events': [], 'product_binding': binding,
            'assumptions': ['引用型号的不可变快照，不修改型号库。工程 U₀、频率与较低温度上限保留。',
                            '核对状态由本机用户声明，不是认证签名或全标准合规判定。',
                            '应用后修改结构会标记为项目修改副本，不会继续冒用原型号核对状态。']})

    @staticmethod
    def binding(version, effective):
        return {'version_id': version['id'], 'product_id': version['product_id'], 'version': version['version'],
                'code': version['specification']['code'], 'name': version['specification']['name'],
                'content_sha256': version['content_sha256'], 'product_snapshot': version['specification'],
                'effective_cable': effective}

    def assessment(self, wid):
        state = self.store.snapshot(wid)
        c = state['scenario']['cable']
        findings = []
        if c['r20_ohm_km'] is None:
            findings.append({'code': 'r20', 'message': 'R20 按截面积估算；尚无厂家保证电阻。', 'target': 'cable'})
        if not state['sources']:
            findings.append({'code': 'source', 'message': '尚无已核对资料引用，当前参数不应标记为厂家认证数据。', 'target': 'library'})
        findings.append({'code': 'loss', 'message': '交流附加与屏蔽损耗系数仍是输入假设；不是已求解的感应损耗。', 'target': 'materials'})
        binding = state.get('product_binding')
        reference = None
        if binding:
            changes = [k for k, v in binding['effective_cable'].items() if k not in OPERATING_FIELDS and c[k] != v]
            version = self.version(binding['version_id'])
            reference = {**binding, 'changed_fields': changes, 'aligned': not changes,
                         'lifecycle': version['state'], 'is_current_reviewed': version['is_current_reviewed']}
            if changes:
                findings.append({'code': 'modified-product', 'message': '电缆结构已偏离引用型号，属于项目修改副本；需重新核对，不能称作原型号。', 'target': 'cable'})
            if not version['is_current_reviewed']:
                findings.append({'code': 'superseded-product', 'message': '引用版本已停用或被新版替代；历史输入保留，不自动升级。', 'target': 'products'})
        domain = (state.get('design_basis') or {}).get('environment', 'buried')
        return {'workspace': wid, 'revision': state['revision'], 'input_sha256': fingerprint(state['scenario']),
                'product_reference': reference, 'findings': findings, 'domain': domain,
                'scope': '单回路直埋／单根隔离竖向；不是完整标准计算或最终工程签审。'}

    def evaluate(self, wid, revision, args):
        versions = self.eligible()
        if not versions:
            raise HTTPException(422, '没有可参与研究的已核对型号。请先建立并核对型号；演示模板不会自动参与。')
        if len(versions) > 40:
            raise HTTPException(422, '本轮企业候选上限为 40 个，请先缩小可用型号库。')
        products = [{'id': v['id'], 'state': 'enterprise_reviewed', **v['specification'],
                     'product_id': v['product_id'], 'product_version': v['version'], 'content_sha256': v['content_sha256']}
                    for v in versions]
        result = self.designs.design(wid, DesignRequest(expected_revision=revision, **args.model_dump()), products_override=products)
        return result

    def study(self, wid, sid):
        with self.store.db() as db:
            self.store.load(db, wid)
            row = db.execute('SELECT payload FROM design_studies WHERE workspace=? AND id=?', (wid, sid)).fetchone()
            if row is None:
                raise HTTPException(404, '选型研究不存在或不属于本工程。')
            return json.loads(row['payload'])

    def report(self, wid, sid):
        study = self.study(wid, sid)
        esc = lambda x: escape(str(x))
        def number(value, unit=''):
            return '未提供' if value is None else f'{value:.3f} {unit}'
        rows = []
        for c in study['candidates']:
            product = c['catalog_snapshot']
            rows.append('<tr>' + ''.join('<td>' + esc(v) + '</td>' for v in [c['name'], product.get('product_version', '—'),
                c['area_mm2'], number(c['ampacity_a'], 'A'), number(c['operating_temperature_c'], '°C'),
                number(c['loss_kw'], 'kW'), number(c['cost'], c['currency']),
                '热约束通过，仍需其他校核' if c['feasible'] else '；'.join(c['reasons'])]) + '</tr>')
        body = f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>电缆选型研究记录</title>
<style>body{{font:15px/1.7 system-ui,sans-serif;color:#17212b;margin:40px}}table{{width:100%;border-collapse:collapse}}td,th{{padding:9px;border:1px solid #bcc5ce;text-align:left}}pre{{white-space:pre-wrap;overflow-wrap:anywhere}}small{{color:#455564}}</style>
<h1>电缆选型研究记录</h1><p>研究编号 {esc(sid)} · 输入版本 {study['base_revision']}</p>
<p>域：{esc(study['domain'])}。目标 {study['constraints']['target_current_a']} A；含预留要求 {study['required_ampacity_a']:.3f} A。</p>
<p>以下结论仅对应保存时的输入、型号版本和方法，不使用后来修改的参数重新计算；型号当前生命周期不改变历史记录。</p>
<table><thead><tr>{''.join('<th>'+x+'</th>' for x in ['型号','版本','截面 / mm²','载流量','导体温度','研究域总损耗','采购估算','判定与原因'])}</tr></thead><tbody>{''.join(rows)}</tbody></table>
<h2>方法边界</h2>{''.join('<p>'+esc(n)+'</p>' for n in study['notes'])}
<h2>不可变输入与候选快照</h2><pre>{esc(json.dumps(study, ensure_ascii=False, indent=2))}</pre>
<small>SHA-256 {fingerprint(study)}。本机研究记录，不是标准符合性证书或最终工程批准。</small></html>'''
        return {'html': body, 'study_id': sid, 'source_revision': study['base_revision'], 'sha256': fingerprint(study)}

    def fork(self, wid, req):
        if not req.name.strip():
            raise HTTPException(422, '方案名称不能为空。')
        with self.store.db(True) as db:
            row, state = self.store.load(db, wid, req.expected_revision)
            child, now = str(uuid4()), stamp()
            state['origin'] = {'workspace': wid, 'revision': row['revision'], 'scenario_sha256': fingerprint(state['scenario'])}
            state['scenario']['name'] = req.name.strip()
            Scenario.model_validate(state['scenario'])
            encoded = json.dumps(state, ensure_ascii=False)
            db.execute('INSERT INTO workspaces VALUES (?,?,?,?,?,?)', (child, 1, 0, encoded, now, now))
            db.execute('INSERT INTO workspace_history VALUES (?,?,?,?)', (child, 0, encoded, '另存方案'))
            self.store.audit(db, child, 1, '另存方案', f'{wid} / rev.{row["revision"]}')
        return self.store.snapshot(child)


def make_router(service):
    router = APIRouter(prefix='/api/enterprise')
    @router.get('/products')
    def products(): return service.list()
    @router.get('/eligible')
    def eligible(): return service.eligible()
    @router.post('/products', status_code=201)
    def create(body: ProductSpecification): return service.create(body)
    @router.get('/products/{pid}/versions')
    def versions(pid: UUID): return service.versions(str(pid))
    @router.post('/products/{pid}/versions', status_code=201)
    def version(pid: UUID, body: NewProductVersion): return service.new_version(str(pid), body)
    @router.get('/versions/{vid}')
    def get_version(vid: UUID): return service.version(str(vid))
    @router.post('/versions/{vid}/{action}')
    def review(vid: UUID, action: Literal['review', 'withdraw'], body: ProductReview):
        return service.transition(str(vid), body, action)
    @router.get('/workspaces/{wid}/assessment')
    def assessment(wid: UUID): return service.assessment(str(wid))
    @router.post('/workspaces/{wid}/fork', status_code=201)
    def fork(wid: UUID, body: ForkProject): return service.fork(str(wid), body)
    return router
