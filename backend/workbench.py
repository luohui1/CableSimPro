"""Versioned local engineering workspace; human and agent edits share server CAS.
SQLite persists state; LangGraph orchestrates bounded planning and solver tools.
No shell tools or arbitrary field paths. Not an authenticated cloud service.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
import time
from typing import Literal, TypedDict
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from langgraph.graph import StateGraph, START, END
from pydantic import Field
from . import agent
from .engine import calculate, ModelError
from .schemas import Scenario, StrictModel


def stamp():
    return datetime.now(timezone.utc).isoformat()


def fingerprint(scenario):
    return sha256(json.dumps(scenario, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


class Create(StrictModel):
    scenario: Scenario = Field(default_factory=Scenario)


class Revision(StrictModel):
    expected_revision: int = Field(ge=1)


class Edit(Revision):
    changes: list[agent.Change] = Field(min_length=1, max_length=45)
    label: str = Field(default='属性编辑', min_length=1, max_length=100)


class Lock(Revision):
    path: str
    locked: bool


class Task(Revision):
    message: str = Field(min_length=1, max_length=3000)
    mode: Literal['local', 'openai'] = 'local'
    consent: bool = False


class Evidence(Revision):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=18000)
    page: int = Field(default=1, ge=1, le=10000)


class Flow(TypedDict, total=False):
    request: agent.PlanRequest
    plan: dict
    events: list
    candidate: dict
    action: str
    parameter: str | None
    values: list
    output: dict


async def planning(state: Flow):
    proposal = await agent.plan(state['request'])
    proposal.pop('ticket', None)
    return {'plan': proposal, 'events': [{'tool': 'plan_task', 'status': 'completed', 'detail': '生成操作意图；尚未改变工程'}]}


def check_plan(state: Flow):
    return {'events': state['events'] + [{'tool': 'validate_proposal', 'status': 'completed', 'detail': '复用输入、单位和几何校验；等待人工审查'}]}


_builder = StateGraph(Flow)
_builder.add_node('plan_task', planning)
_builder.add_node('validate_proposal', check_plan)
_builder.add_edge(START, 'plan_task')
_builder.add_edge('plan_task', 'validate_proposal')
_builder.add_edge('validate_proposal', END)
PLANNER = _builder.compile()


def solve(state: Flow):
    scenario = Scenario.model_validate(state['candidate'])
    action = state['action']
    if action == 'calculate':
        result = calculate(scenario)
        summary = result['summary']
        statement = f"允许载流量 {summary['ampacity_a']:.1f} A，限制相 {summary['limiting_phase']}。"
        if summary['operating_max_temperature_c'] is not None:
            statement += f"运行最高温度 {summary['operating_max_temperature_c']:.1f} °C。"
        else:
            statement += '运行电流无稳定解，不输出运行温度。'
        output = {'result': result, 'statement': statement, 'sweep': None}
    elif action == 'sweep':
        points = []
        for value in state['values']:
            candidate, _ = agent.patch(scenario, [agent.Change(path=f"installation.{state['parameter']}", value=value)])
            points.append({'value': value, 'ampacity_a': calculate(candidate, include_field=False)['summary']['ampacity_a'], 'error': None})
        output = {'result': None, 'sweep': {'parameter': state['parameter'], 'points': points}, 'statement': f'已求解 {len(points)} 个独立工况；不改变当前敷设条件。'}
    else:
        output = {'result': None, 'sweep': None, 'statement': '模型范围：单回路三根相同无铠装单芯电缆，均匀土壤直埋、稳态平衡负荷。交流附加与屏蔽损耗系数为输入假设。不是完整 IEC 60287 或有限元；模板与理想电阻需厂家数据校核。'}
    return {'output': output, 'events': [{'tool': 'validate_snapshot', 'status': 'completed', 'detail': '输入快照和工程版本一致'}, {'tool': action, 'status': 'completed', 'detail': '确定性工程工具完成；未由语言模型生成计算数值'}]}


_builder = StateGraph(Flow)
_builder.add_node('engineering_tool', solve)
_builder.add_edge(START, 'engineering_tool')
_builder.add_edge('engineering_tool', END)
SOLVER = _builder.compile()


class WorkspaceStore:
    def __init__(self, path):
        self.path = Path(path)

    @contextmanager
    def db(self, write=False):
        with sqlite3.connect(self.path, timeout=20) as db:
            db.row_factory = sqlite3.Row
            if write:
                db.execute('BEGIN IMMEDIATE')
            yield db

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
            CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, revision INTEGER, cursor INTEGER, state TEXT, created TEXT, updated TEXT);
            CREATE TABLE IF NOT EXISTS workspace_history (workspace TEXT, position INTEGER, state TEXT, label TEXT, PRIMARY KEY(workspace,position));
            CREATE TABLE IF NOT EXISTS workspace_audit (id TEXT PRIMARY KEY, workspace TEXT, revision INTEGER, event TEXT, details TEXT, created TEXT);
            CREATE TABLE IF NOT EXISTS workspace_proposals (id TEXT PRIMARY KEY, workspace TEXT, base_revision INTEGER, status TEXT, payload TEXT, created TEXT, expires REAL);
            CREATE TABLE IF NOT EXISTS workspace_runs (id TEXT PRIMARY KEY, workspace TEXT, revision INTEGER, input_hash TEXT, output TEXT, events TEXT, created TEXT);
            ''')

    def load(self, db, wid, expected=None):
        row = db.execute('SELECT * FROM workspaces WHERE id=?', (wid,)).fetchone()
        if row is None:
            raise HTTPException(404, '工程不存在。')
        if expected is not None and row['revision'] != expected:
            raise HTTPException(409, '工程版本已变化；请刷新后重试，未覆盖任何修改。')
        return dict(row), json.loads(row['state'])

    def audit(self, db, wid, revision, event, details=''):
        db.execute('INSERT INTO workspace_audit VALUES (?,?,?,?,?,?)', (str(uuid4()), wid, revision, event, details, stamp()))

    def commit(self, db, row, state, label):
        Scenario.model_validate(state['scenario'])
        rev, pos, wid = row['revision'] + 1, row['cursor'] + 1, row['id']
        encoded = json.dumps(state, ensure_ascii=False)
        db.execute('DELETE FROM workspace_history WHERE workspace=? AND position>?', (wid, row['cursor']))
        db.execute('INSERT INTO workspace_history VALUES (?,?,?,?)', (wid, pos, encoded, label))
        db.execute('UPDATE workspaces SET revision=?,cursor=?,state=?,updated=? WHERE id=?', (rev, pos, encoded, stamp(), wid))
        self.audit(db, wid, rev, label)
        return rev

    def snapshot(self, wid):
        with self.db() as db:
            row, state = self.load(db, wid)
            maximum = db.execute('SELECT MAX(position) FROM workspace_history WHERE workspace=?', (wid,)).fetchone()[0]
            audit = [dict(r) for r in db.execute('SELECT * FROM workspace_audit WHERE workspace=? ORDER BY rowid DESC LIMIT 100', (wid,))]
            runs = [dict(r) for r in db.execute('SELECT id,revision,input_hash,created FROM workspace_runs WHERE workspace=? ORDER BY rowid DESC LIMIT 30', (wid,))]
        return {'id': wid, 'revision': row['revision'], **state, 'can_undo': row['cursor'] > 0, 'can_redo': row['cursor'] < maximum, 'audit': audit, 'runs': runs, 'updated_at': row['updated']}

    def create(self, scenario):
        wid, now = str(uuid4()), stamp()
        state = json.dumps({'scenario': scenario.model_dump(), 'locks': ['cable.max_temperature_c'], 'sources': []}, ensure_ascii=False)
        with self.db(True) as db:
            db.execute('INSERT INTO workspaces VALUES (?,?,?,?,?,?)', (wid, 1, 0, state, now, now))
            db.execute('INSERT INTO workspace_history VALUES (?,?,?,?)', (wid, 0, state, '建立工程'))
            self.audit(db, wid, 1, '建立工程', '演示参数；温度上限默认锁定')
        return self.snapshot(wid)

    @staticmethod
    def protect(state, changes):
        locked = {c['path'] for c in changes} & set(state['locks'])
        if locked:
            raise HTTPException(422, '不能修改锁定参数：' + ', '.join(sorted(locked)))

    def stage(self, wid, revision, proposal):
        with self.db(True) as db:
            _, state = self.load(db, wid, revision)
            self.protect(state, proposal.get('changes', []))
            if proposal.get('action') == 'sweep' and 'installation.' + proposal['parameter'] in state['locks']:
                raise HTTPException(422, '扫描参数已锁定；不能在研究中改变它。')
            pid = str(uuid4())
            db.execute('INSERT INTO workspace_proposals VALUES (?,?,?,?,?,?,?)', (pid, wid, revision, 'pending', json.dumps(proposal, ensure_ascii=False), stamp(), time.time() + 1800))
            self.audit(db, wid, revision, '生成待审批提案', proposal.get('message', '')[:300])
        return {**proposal, 'id': pid, 'base_revision': revision, 'status': 'pending'}


def make_router(store: WorkspaceStore):
    router = APIRouter(prefix='/api/workspaces')

    @router.get('')
    def listing():
        with store.db() as db:
            return [{'id': r['id'], 'revision': r['revision'], 'name': json.loads(r['state'])['scenario']['name'], 'updated_at': r['updated']} for r in db.execute('SELECT * FROM workspaces ORDER BY updated DESC')]

    @router.post('', status_code=201)
    def create(body: Create):
        return store.create(body.scenario)

    @router.get('/{wid}')
    def get(wid: str):
        return store.snapshot(wid)

    @router.post('/{wid}/edit')
    def edit(wid: str, body: Edit):
        with store.db(True) as db:
            row, state = store.load(db, wid, body.expected_revision)
            try:
                scenario, diff = agent.patch(Scenario.model_validate(state['scenario']), body.changes)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from None
            store.protect(state, diff)
            if diff:
                state['scenario'] = scenario.model_dump()
                store.commit(db, row, state, body.label)
        return store.snapshot(wid)

    @router.post('/{wid}/lock')
    def lock(wid: str, body: Lock):
        if body.path not in agent.PATHS:
            raise HTTPException(422, '不支持的参数路径。')
        with store.db(True) as db:
            row, state = store.load(db, wid, body.expected_revision)
            paths = set(state['locks'])
            paths.add(body.path) if body.locked else paths.discard(body.path)
            state['locks'] = sorted(paths)
            store.commit(db, row, state, ('锁定 ' if body.locked else '解锁 ') + body.path)
        return store.snapshot(wid)

    @router.post('/{wid}/history/{direction}')
    def history(wid: str, direction: Literal['undo', 'redo'], body: Revision):
        with store.db(True) as db:
            row, _ = store.load(db, wid, body.expected_revision)
            pos = row['cursor'] + (-1 if direction == 'undo' else 1)
            target = db.execute('SELECT * FROM workspace_history WHERE workspace=? AND position=?', (wid, pos)).fetchone()
            if target is None:
                raise HTTPException(409, '没有可恢复的历史版本。')
            db.execute('UPDATE workspaces SET revision=?,cursor=?,state=?,updated=? WHERE id=?', (row['revision'] + 1, pos, target['state'], stamp(), wid))
            store.audit(db, wid, row['revision'] + 1, '撤销' if direction == 'undo' else '重做', target['label'])
        return store.snapshot(wid)

    @router.post('/{wid}/plan')
    async def plan(wid: str, body: Task):
        with store.db() as db:
            _, state = store.load(db, wid, body.expected_revision)
        flow = await PLANNER.ainvoke({'request': agent.PlanRequest(scenario=state['scenario'], message=body.message, mode=body.mode, consent=body.consent)})
        proposal = {**flow['plan'], 'message': body.message, 'events': flow['events']}
        if not proposal['ready']:
            return proposal
        return store.stage(wid, body.expected_revision, proposal)

    @router.post('/{wid}/evidence')
    def evidence(wid: str, body: Evidence):
        import re
        patterns = [('cable.area_mm2', r'(?:截面积|area)\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*(?:mm²|mm2|平方毫米)'),
                    ('cable.r20_ohm_km', r'(?:R20|R₂₀)\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*(?:Ω/km|ohm/km)'),
                    ('cable.insulation_mm', r'(?:绝缘厚度|insulation thickness)\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*mm'),
                    ('cable.jacket_mm', r'(?:护套厚度|jacket thickness)\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*mm')]
        changes, excerpts = [], []
        for path, expression in patterns:
            matches = list(re.finditer(expression, body.text, re.I))
            if len({m[1] for m in matches}) > 1:
                raise HTTPException(422, '资料有多个冲突值，请只粘贴目标产品的参数。')
            if matches:
                changes.append(agent.Change(path=path, value=float(matches[0][1])))
                excerpts.append({'path': path, 'quote': matches[0][0], 'value': float(matches[0][1])})
        if not changes:
            raise HTTPException(422, '没有识别到带标签和单位的参数。支持截面积 mm²、R20 Ω/km、绝缘厚度 mm、护套厚度 mm；未猜测缺失值。')
        with store.db() as db:
            _, state = store.load(db, wid, body.expected_revision)
        try:
            candidate, diff = agent.patch(Scenario.model_validate(state['scenario']), changes)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        source = {'id': str(uuid4()), 'title': body.title, 'page': body.page, 'text_sha256': sha256(body.text.encode()).hexdigest(), 'excerpts': excerpts, 'created_at': stamp(), 'status': 'user-reviewed-excerpt-not-manufacturer-verified'}
        return store.stage(wid, body.expected_revision, {'ready': True, 'action': 'import', 'scenario': candidate.model_dump(), 'changes': diff, 'source': source, 'mode': 'local-extractor', 'questions': [], 'message': '资料参数导入', 'assumptions': ['仅识别明确标签与单位；未识别字段保留当前值。', '来源为用户提供的节选，页码由用户声明；没有验证原文真实性。'], 'events': []})

    @router.post('/{wid}/proposals/{pid}/{decision}')
    def review(wid: str, pid: str, decision: Literal['approve', 'reject'], body: Revision):
        output = None
        with store.db(True) as db:
            row, state = store.load(db, wid, body.expected_revision)
            record = db.execute('SELECT * FROM workspace_proposals WHERE workspace=? AND id=?', (wid, pid)).fetchone()
            if record is None:
                raise HTTPException(404, '提案不存在。')
            if record['status'] != 'pending':
                raise HTTPException(409, '提案已处理，不能重复审批。')
            if decision == 'reject':
                db.execute("UPDATE workspace_proposals SET status='rejected' WHERE id=?", (pid,))
                store.audit(db, wid, row['revision'], '拒绝提案', pid)
            else:
                if record['base_revision'] != row['revision'] or record['expires'] < time.time():
                    raise HTTPException(409, '提案过期或工程版本变化，请重新规划。')
                proposal = json.loads(record['payload'])
                store.protect(state, proposal['changes'])
                candidate = Scenario.model_validate(proposal['scenario'])
                if proposal['action'] != 'import':
                    try:
                        flow = SOLVER.invoke({'candidate': candidate.model_dump(), 'action': proposal['action'], 'parameter': proposal.get('parameter'), 'values': proposal.get('values', [])})
                    except (ModelError, ValueError) as exc:
                        raise HTTPException(422, str(exc)) from None
                    output = flow['output']
                state['scenario'] = candidate.model_dump()
                if proposal.get('source'):
                    state['sources'].append(proposal['source'])
                revision = store.commit(db, row, state, '批准提案 · ' + proposal['action'])
                if output:
                    rid = str(uuid4())
                    db.execute('INSERT INTO workspace_runs VALUES (?,?,?,?,?,?,?)', (rid, wid, revision, fingerprint(state['scenario']), json.dumps(output, ensure_ascii=False), json.dumps(flow['events'], ensure_ascii=False), stamp()))
                    output = {**output, 'run_id': rid, 'events': flow['events']}
                db.execute("UPDATE workspace_proposals SET status='approved' WHERE id=?", (pid,))
        return {'workspace': store.snapshot(wid), 'output': output}

    @router.post('/{wid}/calculate')
    def calculate_now(wid: str, body: Revision):
        with store.db(True) as db:
            row, state = store.load(db, wid, body.expected_revision)
            try:
                flow = SOLVER.invoke({'candidate': state['scenario'], 'action': 'calculate'})
            except (ModelError, ValueError) as exc:
                raise HTTPException(422, str(exc)) from None
            rid = str(uuid4())
            db.execute('INSERT INTO workspace_runs VALUES (?,?,?,?,?,?,?)', (rid, wid, row['revision'], fingerprint(state['scenario']), json.dumps(flow['output'], ensure_ascii=False), json.dumps(flow['events'], ensure_ascii=False), stamp()))
            store.audit(db, wid, row['revision'], '计算完成', rid)
        return {'workspace': store.snapshot(wid), 'output': {**flow['output'], 'run_id': rid, 'events': flow['events']}}

    @router.get('/{wid}/runs/{rid}')
    def get_run(wid: str, rid: str):
        with store.db() as db:
            store.load(db, wid)
            run = db.execute('SELECT * FROM workspace_runs WHERE workspace=? AND id=?', (wid, rid)).fetchone()
            if run is None:
                raise HTTPException(404, '计算记录不存在。')
        return {**dict(run), 'output': json.loads(run['output']), 'events': json.loads(run['events'])}

    return router
