"""Human requirement reviews, independent of model revisions and solver outputs.

The host records definitions supplied by a verified artifact. It does not derive
limits or compliance. Review receipts are immutable, scoped and idempotent.
"""
import json
import re
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import Field, field_validator

from ..schemas import StrictModel
from ..workbench import fingerprint, stamp


class ReviewRequirements(StrictModel):
    request_id: UUID
    run_id: UUID
    row_ids: list[str] = Field(min_length=1, max_length=500)
    expected_workspace_revision: int = Field(ge=1)
    expected_requirements_revision: int = Field(ge=0)
    reviewer: str = Field(min_length=1, max_length=120)
    human_confirmed: Literal[True]

    @field_validator('human_confirmed', mode='before')
    @classmethod
    def explicit_human_decision(cls, value):
        if value is not True:
            raise ValueError('必须由人工明确确认批准所选要求。')
        return value

    @field_validator('reviewer')
    @classmethod
    def nonblank_reviewer(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('请填写审批人。')
        return value

    @field_validator('row_ids')
    @classmethod
    def distinct_rows(cls, value):
        if len(set(value)) != len(value):
            raise ValueError('所选要求不能重复。')
        return value


class Requirements:
    def __init__(self, research):
        self.research, self.store = research, research.store
        with self.store.db(True) as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS requirement_reviews (
              id TEXT PRIMARY KEY, workspace TEXT NOT NULL, revision INTEGER NOT NULL,
              request_id TEXT NOT NULL, request_digest TEXT NOT NULL,
              receipt TEXT NOT NULL, digest TEXT NOT NULL,
              UNIQUE(workspace,request_id), UNIQUE(workspace,revision),
              FOREIGN KEY(workspace) REFERENCES workspaces(id));
            ''')

    def source(self, wid, rid):
        run = self.research.get_run(wid, str(rid))
        if run['status'] != 'succeeded' or run.get('integrity') != 'verified':
            raise HTTPException(409, '要求来源运行尚未完成或完整性未验证。')
        if run['method_availability']['status'] == 'available':
            _, capability = self.research.resolve(run['snapshot']['definition']['method'])
            if capability.analysis != 'standard_check':
                raise HTTPException(422, '此运行不是标准要求判定能力。')
        case = next((c for c in run['output']['cases'] if c['status'] == 'succeeded' and
                     'x-cablesim.standard-check' in c['artifacts']), None)
        artifact = case['artifacts']['x-cablesim.standard-check'] if case else None
        if not artifact or artifact.get('schema') != 'cablesim.standard-check/1':
            raise HTTPException(422, '运行未提供支持的要求目录工件。')
        try:
            if not isinstance(artifact['rows'], list) or len(artifact['rows']) > 500:
                raise ValueError('rows')
            for row in artifact['rows']:
                self.proposal(row, run['snapshot']['definition']['method'])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(422, '要求目录工件缺少对象、条款或版本定义，不能导入或批准。') from None
        return run, case, artifact

    @staticmethod
    def proposal(row, method):
        # Identity follows the object ID and rule, rather than an array index.
        rule = row['id'].rsplit(':', 1)[-1]
        identity = {'rule': rule, 'target': row['target'], 'standard': row['standard'], 'clause': row['clause']}
        definition = {key: row.get(key) for key in (
            'title', 'target', 'standard', 'clause', 'source_digest', 'source_status',
            'printed_page', 'pdf_page', 'comparison', 'limit', 'unit', 'formula', 'formula_inputs')}
        definition.update(rule=rule, method=method)
        bindable = (row.get('source_status') == 'original-verified' and row.get('limit') is not None and row.get('verdict') != 'uncovered'
                    and bool(re.fullmatch(r'[0-9a-f]{64}', row.get('source_digest') or ''))
                    and bool(row['standard'].strip()) and bool(row['clause'].strip()) and bool(row['target'].get('role')))
        return {'id': 'requirement/' + fingerprint(identity), 'row_id': row['id'],
                'definition': definition, 'definition_digest': fingerprint({k: v for k, v in definition.items() if k != 'title'}), 'bindable': bindable}

    def history(self, db, wid):
        self.store.load(db, wid)
        rows = db.execute('SELECT * FROM requirement_reviews WHERE workspace=? ORDER BY revision', (wid,)).fetchall()
        reviews = []
        for row in rows:
            try:
                receipt = json.loads(row['receipt'])
            except (ValueError, TypeError):
                raise HTTPException(409, '要求审批记录完整性异常，不能展示为已批准。') from None
            if fingerprint(receipt) != row['digest']:
                raise HTTPException(409, '要求审批记录完整性异常，不能展示为已批准。')
            reviews.append({**receipt, 'digest': row['digest']})
        return reviews

    def catalog(self, wid, run, case, artifact, reviews):
        latest = {item['id']: (item, review) for review in reviews for item in review['items']}
        proposals = []
        for row in artifact['rows']:
            proposal = self.proposal(row, run['snapshot']['definition']['method'])
            previous = latest.get(proposal['id'])
            state = 'unbound' if not proposal['bindable'] else 'approved' if previous and previous[0]['definition_digest'] == proposal['definition_digest'] else 'conflict' if previous else 'proposed'
            approval = ({'id': previous[1]['id'], 'digest': previous[1]['digest'], 'reviewer': previous[1]['reviewer'],
                         'created': previous[1]['created'], 'definition': previous[0]['definition']} if previous else None)
            proposals.append({**proposal, 'state': state, 'approval': approval})
        approved = [p for p in proposals if p['state'] == 'approved']
        references = sorted({p['approval']['id'] + ':' + p['approval']['digest'] for p in approved})
        return {'revision': reviews[-1]['revision'] if reviews else 0, 'run_id': run['id'],
                'source_current': run['freshness'] == 'current', 'case_id': case['case_id'], 'items': proposals,
                'approved_count': len(approved), 'approved_digest': fingerprint(approved) if approved else None,
                'review_references': references, 'reviews': reviews}

    def read(self, wid, rid):
        run, case, artifact = self.source(wid, rid)
        with self.store.db() as db:
            reviews = self.history(db, wid)
        return self.catalog(wid, run, case, artifact, reviews)

    def review(self, wid, body):
        request = body.model_dump(mode='json')
        digest = fingerprint(request)
        # Retrying an explicitly confirmed decision only returns its first receipt.
        with self.store.db() as db:
            self.store.load(db, wid)
            previous = db.execute('SELECT * FROM requirement_reviews WHERE workspace=? AND request_id=?', (wid, str(body.request_id))).fetchone()
            if previous:
                if previous['request_digest'] != digest:
                    raise HTTPException(409, '批准请求标识已用于其他选择，未写入新的审批。')
                self.history(db, wid)
                return json.loads(previous['receipt'])
        run, case, artifact = self.source(wid, body.run_id)
        if run['freshness'] != 'current':
            raise HTTPException(409, '历史要求目录不能批准；请保存输入并更新要求。')
        proposals = {r['id']: self.proposal(r, run['snapshot']['definition']['method']) for r in artifact['rows']}
        chosen = []
        for row_id in body.row_ids:
            item = proposals.get(row_id)
            if item is None:
                raise HTTPException(422, '所选要求不属于该来源运行。')
            if not item['bindable']:
                raise HTTPException(422, '来源缺失、要求未定义或判定能力未覆盖的条目不能批准。')
            chosen.append(item)
        with self.store.db(True) as db:
            row, _ = self.store.load(db, wid, body.expected_workspace_revision, allow_domain=True)
            # A second caller can have committed the same request while source was read.
            previous = db.execute('SELECT * FROM requirement_reviews WHERE workspace=? AND request_id=?', (wid, str(body.request_id))).fetchone()
            reviews = self.history(db, wid)
            if previous:
                if previous['request_digest'] != digest:
                    raise HTTPException(409, '批准请求标识已用于其他选择。')
                return json.loads(previous['receipt'])
            revision = reviews[-1]['revision'] if reviews else 0
            if revision != body.expected_requirements_revision:
                raise HTTPException(409, '要求审批版本已变化，请刷新记录后重试。')
            study = self.research.definition(db, wid, run['study'])
            if (row['revision'] != run['snapshot']['workspace_revision'] or study['revision'] != run['snapshot']['study_revision'] or
                    self.research.lock(db, wid, row['revision'], run['snapshot']['definition']['method']) != run['snapshot']['lock']):
                raise HTTPException(409, '来源输入或研究已变化，未批准历史要求。')
            receipt = {'id': str(uuid4()), 'workspace_id': wid, 'revision': revision + 1,
                       'reviewer': body.reviewer, 'decision': 'approved', 'created': stamp(), 'items': chosen,
                       'source': {'run_id': run['id'], 'case_id': case['case_id'], 'artifact_type': 'x-cablesim.standard-check',
                                  'workspace_revision': row['revision'], 'input_digest': run['input_digest'],
                                  'output_digest': run['output_digest'], 'method': run['snapshot']['definition']['method']}}
            db.execute('INSERT INTO requirement_reviews VALUES (?,?,?,?,?,?,?)',
                       (receipt['id'], wid, revision + 1, str(body.request_id), digest,
                        json.dumps(receipt, ensure_ascii=False, allow_nan=False), fingerprint(receipt)))
            self.store.audit(db, wid, row['revision'], '人工批准所选要求', json.dumps({'review_id': receipt['id'], 'reviewer': body.reviewer, 'count': len(chosen)}, ensure_ascii=False))
        return receipt


def make_router(research):
    service = Requirements(research)
    router = APIRouter(prefix='/api/design/type-workspaces')

    @router.get('/{wid}/requirements')
    def read(wid: str, run_id: UUID):
        return service.read(wid, run_id)

    @router.post('/{wid}/requirements/reviews', status_code=201)
    def review(wid: str, body: ReviewRequirements):
        return service.review(wid, body)

    return router
