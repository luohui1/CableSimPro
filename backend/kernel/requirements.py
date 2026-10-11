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
from .workspace import fingerprint, stamp


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


class ResolveBasis(StrictModel):
    request_id: UUID
    expected_revision: int = Field(ge=1)


def lookup_references(research, queries):
    """Execute plugin-authored queries; the host neither derives nor fills limits."""
    registry = research.registry()
    plugin = registry.plugins.get('cablesim.standards-basis')
    if plugin is None:
        raise HTTPException(503, {'code':'BASIS_UNAVAILABLE','message':'未安装标准依据库，无法按固定标准版本生成结构；请先安装已核验的依据发行。'})
    result = research.executor.run(plugin.manifest.id,'lookup',[
        {'case_id': key,'input': query,'parameters':{}} for key,query in queries.items()],expected_manifest=plugin.manifest)
    references, missing = {}, []
    for case in result.cases:
        if case.status != 'succeeded':
            raise HTTPException(422,case.error or '标准依据查询失败，请核对条件并重试。')
        answer = case.artifacts['x-cablesim.standards-basis']
        if answer['status'] != 'resolved':
            missing.append({'key':case.case_id,'query':queries[case.case_id], 'reason':answer.get('reason','本库暂未收录 · 下一轮')})
            continue
        record = answer['records'][0]
        references[case.case_id] = {'schema':'cablesim.standard-basis-ref/1','plugin_id':answer['plugin_id'],
            'plugin_version':answer['plugin_version'],'data_sha256':answer['data_sha256'], 'query_sha256':answer['query_sha256'],
            'query':queries[case.case_id], 'record_id':record['id'],'record_sha256':record['record_sha256'],
            'standard':record['standard'],'edition':record['edition'],'locator':record['table'] or record['clause'],
            'printed_page':record['printed_page'],'pdf_page':record['pdf_page'],'source_sha256':record['source_sha256'],
            'record':record,'request_sha256':result.request_sha256,'release_digest':research.pin(plugin)['release_digest'],
            'artifact_digest':case.artifact_digests['x-cablesim.standards-basis']}
    return references, missing


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
            db.execute('''CREATE TABLE IF NOT EXISTS requirement_basis_queries (
              workspace TEXT NOT NULL, request_id TEXT NOT NULL, revision INTEGER NOT NULL,
              payload TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(workspace,request_id))''')

    def resolve_basis(self, wid, body):
        """Persist read-only Executor receipts, never approve or edit engineering facts."""
        from .type_versions import declared_execution_standards
        from ..plugin_host.registry import PluginHostError
        with self.store.db() as db:
            row, state = self.store.load(db, wid, body.expected_revision, allow_domain=True)
            old = db.execute('SELECT * FROM requirement_basis_queries WHERE workspace=? AND request_id=?',(wid,str(body.request_id))).fetchone()
            if old:
                if old['revision'] != body.expected_revision: raise HTTPException(409,'此依据请求已用于其他输入版本。')
                payload=json.loads(old['payload'])
                if fingerprint(payload)!=old['digest']: raise HTTPException(409,'依据查询记录摘要不一致。')
                return payload
        document=state.get('domain')
        if not document or not document.get('cable_types'): raise HTTPException(422,'请先补齐型号结构和执行标准。')
        registry=self.research.registry()
        try:
            method=registry.plugins['cablesim.standard-check']; basis=registry.plugins['cablesim.standards-basis']
            planned=self.research.executor.run(method.manifest.id,'dimensions',[{'case_id':'plan','input':document,'parameters':{'cable_type_id':document['cable_types'][0]['id']}}],expected_manifest=method.manifest)
            case=planned.cases[0]
            if case.status!='succeeded': raise HTTPException(422,case.error or '当前型号不能建立要求目录。')
            artifact=case.artifacts['x-cablesim.standard-check']
            declarations={re.sub(r'\s+','',item['standard']).replace('—','-').replace(':','-') for item in declared_execution_standards(document)}
            plans={r['id']:r['basis_query'] for r in artifact['rows'] if r.get('basis_query') and re.sub(r'\s+','',r['basis_query']['standard']+'-'+r['basis_query']['edition']) in declarations}
            queries={fingerprint(q):q for q in plans.values()}
            ids={key:'basis-'+str(i) for i,key in enumerate(queries)}
            result=self.research.executor.run(basis.manifest.id,'lookup',[{'case_id':ids[key],'input':q,'parameters':{}} for key,q in queries.items()],expected_manifest=basis.manifest) if queries else None
        except (KeyError, PluginHostError) as error:
            raise HTTPException(503,{'code':'BASIS_UNAVAILABLE','message':'标准依据查询不可用，请检查已安装的准确版本后重试。'}) from error
        resolved={}; missing=[]
        for output in result.cases if result else []:
            if output.status!='succeeded': raise HTTPException(422,output.error or '标准依据查询失败，请核对适用条件。')
            answer=output.artifacts['x-cablesim.standards-basis']
            key=next(k for k,v in ids.items() if v==output.case_id); query=queries[key]
            if answer['status']!='resolved': missing.append({'query':query,'reason':answer.get('reason','此条件本库暂未收录 · 下一轮')});continue
            record=answer['records'][0]
            ref={'schema':'cablesim.standard-basis-ref/1','plugin_id':answer['plugin_id'],'plugin_version':answer['plugin_version'],
                 'data_sha256':answer['data_sha256'],'query_sha256':answer['query_sha256'],'query':query,'record_id':record['id'],
                 'record_sha256':record['record_sha256'],'standard':record['standard'],'edition':record['edition'],'locator':record['table'] or record['clause'],
                 'printed_page':record['printed_page'],'pdf_page':record['pdf_page'],'source_sha256':record['source_sha256'],'record':record,
                 'workspace_revision':body.expected_revision,'input_digest':planned.request_sha256,'request_sha256':result.request_sha256,
                 'release_digest':self.research.pin(basis)['release_digest'],'artifact_digest':output.artifact_digests['x-cablesim.standards-basis']}
            resolved[key]=ref
        payload={'parameters':{'basis_references':{rid:resolved[fingerprint(q)] for rid,q in plans.items() if fingerprint(q) in resolved},'basis_cable_sha256':artifact['basis_cable_sha256']},
                 'workspace_revision':body.expected_revision,'missing':missing,'unbound_standard_count':len(artifact['rows'])-len(plans)}
        with self.store.db(True) as db:
            self.store.load(db,wid,body.expected_revision,allow_domain=True)
            db.execute('INSERT OR IGNORE INTO requirement_basis_queries VALUES (?,?,?,?,?)',(wid,str(body.request_id),body.expected_revision,json.dumps(payload,ensure_ascii=False),fingerprint(payload)))
            saved=db.execute('SELECT payload,digest FROM requirement_basis_queries WHERE workspace=? AND request_id=?',(wid,str(body.request_id))).fetchone()
            payload=json.loads(saved['payload'])
            if fingerprint(payload)!=saved['digest']:raise HTTPException(409,'依据查询记录摘要不一致。')
        return payload

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
            'printed_page', 'pdf_page', 'comparison', 'limit', 'unit', 'formula', 'formula_inputs', 'basis_reference', 'citation', 'criterion')}
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
            _, state = self.store.load(db, wid)
            bindings = state.get('type_resource_bindings', {}).get('standard', {})
        catalog = self.catalog(wid, run, case, artifact, reviews)
        saved_bindings = run.get('snapshot', {}).get('workspace_state', {}).get('type_resource_bindings', {}).get('standard', {})
        # A resource reference is distinct from approving a requirement. Never rewrite receipts.
        for item in catalog['items']:
            definition = item['definition']
            key = fingerprint({'standard': definition['standard'], 'source_digest': definition.get('source_digest')})
            item['resource_reference'] = bindings.get(key)
            item['snapshot_resource_reference'] = saved_bindings.get(key)
        return catalog

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

    @router.post('/{wid}/requirements/basis')
    def resolve(wid: str, body: ResolveBasis):
        return service.resolve_basis(wid, body)

    @router.post('/{wid}/requirements/reviews', status_code=201)
    def review(wid: str, body: ReviewRequirements):
        return service.review(wid, body)

    return router
