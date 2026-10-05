"""Versioned workspace persistence and migration; computations use saved studies."""
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
import time
from typing import Any, Literal
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import Field, model_validator
from ..schemas import Scenario, StrictModel

def stamp():
    return datetime.now(timezone.utc).isoformat()


def fingerprint(scenario):
    return sha256(json.dumps(scenario, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


class Create(StrictModel):
    scenario: Scenario = Field(default_factory=Scenario)


class Revision(StrictModel):
    expected_revision: int = Field(ge=1)


class Change(StrictModel):
    path: str
    value: Any


class Edit(Revision):
    changes: list[Change] = Field(min_length=1, max_length=45)
    label: str = Field(default='属性编辑', min_length=1, max_length=100)

    @model_validator(mode='after')
    def unique_paths(self):
        if len({c.path for c in self.changes}) != len(self.changes):
            raise ValueError('同一请求不能重复修改同一字段。')
        return self


class Lock(Revision):
    path: str
    locked: bool


class WorkspaceStore:
    def __init__(self, path):
        self.path = Path(path)
        # Router/service construction may open the library before lifespan starts.
        from .database_ops import check_existing
        check_existing(self.path)

    @contextmanager
    def db(self, write=False):
        with sqlite3.connect(self.path, timeout=20) as db:
            db.row_factory = sqlite3.Row
            if write:
                db.execute('BEGIN IMMEDIATE')
            yield db

    def initialize(self):
        from .database_ops import prepare_startup, SCHEMA_VERSION
        prepare_startup(self.path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
            CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, revision INTEGER, cursor INTEGER, state TEXT, created TEXT, updated TEXT);
            CREATE TABLE IF NOT EXISTS workspace_history (workspace TEXT, position INTEGER, state TEXT, label TEXT, PRIMARY KEY(workspace,position));
            CREATE TABLE IF NOT EXISTS workspace_audit (id TEXT PRIMARY KEY, workspace TEXT, revision INTEGER, event TEXT, details TEXT, created TEXT);
            CREATE TABLE IF NOT EXISTS workspace_proposals (id TEXT PRIMARY KEY, workspace TEXT, base_revision INTEGER, status TEXT, payload TEXT, created TEXT, expires REAL);
            CREATE TABLE IF NOT EXISTS workspace_runs (id TEXT PRIMARY KEY, workspace TEXT, revision INTEGER, input_hash TEXT, output TEXT, events TEXT, created TEXT);
            CREATE TABLE IF NOT EXISTS workspace_revisions (
              workspace TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL,
              digest TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(workspace,revision));
            ''')
            # Only current states are knowable at upgrade time. Never invent old revisions.
            for row in db.execute('SELECT id,revision,state FROM workspaces').fetchall():
                self.archive(db, row['id'], row['revision'], json.loads(row['state']))
            db.execute(f'PRAGMA user_version={SCHEMA_VERSION}')

    @staticmethod
    def archive(db, wid, revision, state):
        db.execute('INSERT OR IGNORE INTO workspace_revisions VALUES (?,?,?,?,?)',
                   (wid, revision, json.dumps(state, ensure_ascii=False, allow_nan=False), fingerprint(state), stamp()))

    def load(self, db, wid, expected=None, *, allow_domain=False):
        row = db.execute('SELECT * FROM workspaces WHERE id=?', (wid,)).fetchone()
        if row is None:
            raise HTTPException(404, '工程不存在。')
        if expected is not None and row['revision'] != expected:
            raise HTTPException(409, '工程版本已变化；请刷新后重试，未覆盖任何修改。')
        state = json.loads(row['state'])
        if expected is not None and 'domain' in state and not allow_domain:
            raise HTTPException(409, '工程已转换为领域文档；v0 写入和计算入口只读。请使用领域与研究接口。')
        return dict(row), state

    def audit(self, db, wid, revision, event, details=''):
        db.execute('INSERT INTO workspace_audit VALUES (?,?,?,?,?,?)', (str(uuid4()), wid, revision, event, details, stamp()))

    @staticmethod
    def assert_mutable(db, wid):
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='engineering_type_releases'").fetchone() and db.execute('SELECT 1 FROM engineering_type_releases WHERE workspace=?', (wid,)).fetchone():
            raise HTTPException(409, '已发布型号版本已冻结，请基于该版本建立新方案。')

    def commit(self, db, row, state, label):
        self.assert_mutable(db, row['id'])
        Scenario.model_validate(state['scenario'])
        rev, pos, wid = row['revision'] + 1, row['cursor'] + 1, row['id']
        encoded = json.dumps(state, ensure_ascii=False)
        db.execute('DELETE FROM workspace_history WHERE workspace=? AND position>?', (wid, row['cursor']))
        db.execute('INSERT INTO workspace_history VALUES (?,?,?,?)', (wid, pos, encoded, label))
        db.execute('UPDATE workspaces SET revision=?,cursor=?,state=?,updated=? WHERE id=?', (rev, pos, encoded, stamp(), wid))
        self.audit(db, wid, rev, label)
        self.archive(db, wid, rev, state)
        return rev

    def snapshot(self, wid, connection=None):
        with (nullcontext(connection) if connection is not None else self.db()) as db:
            row, state = self.load(db, wid)
            maximum = db.execute('SELECT MAX(position) FROM workspace_history WHERE workspace=?', (wid,)).fetchone()[0]
            audit = [dict(r) for r in db.execute('SELECT * FROM workspace_audit WHERE workspace=? ORDER BY rowid DESC LIMIT 100', (wid,))]
            runs = [dict(r) for r in db.execute('SELECT id,revision,input_hash,created FROM workspace_runs WHERE workspace=? ORDER BY rowid DESC LIMIT 30', (wid,))]
            previous = db.execute('SELECT state FROM workspace_history WHERE workspace=? AND position=?', (wid, row['cursor'] - 1)).fetchone()
            can_undo = previous is not None and ('domain' not in state or 'domain' in json.loads(previous['state']))
            type_lifecycle = None
            if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='type_plans'").fetchone():
                plan = db.execute('SELECT family,name,status,base_reference FROM type_plans WHERE workspace=?', (wid,)).fetchone()
                if plan:
                    type_lifecycle = {**dict(plan), 'base_reference': json.loads(plan['base_reference'])}
                    if plan['status'] == 'published':
                        can_undo = False
        frozen = type_lifecycle and type_lifecycle['status'] == 'published'
        return {'id': wid, 'revision': row['revision'], **state, 'type_lifecycle': type_lifecycle, 'can_undo': can_undo, 'can_redo': row['cursor'] < maximum and not frozen, 'audit': audit, 'runs': runs, 'updated_at': row['updated']}

    def create(self, scenario):
        wid, now = str(uuid4()), stamp()
        state = json.dumps({'scenario': scenario.model_dump(), 'locks': ['cable.max_temperature_c'], 'sources': []}, ensure_ascii=False)
        with self.db(True) as db:
            db.execute('INSERT INTO workspaces VALUES (?,?,?,?,?,?)', (wid, 1, 0, state, now, now))
            db.execute('INSERT INTO workspace_history VALUES (?,?,?,?)', (wid, 0, state, '建立工程'))
            self.audit(db, wid, 1, '建立工程', '演示参数；温度上限默认锁定')
            self.archive(db, wid, 1, json.loads(state))
        return self.snapshot(wid)

    @staticmethod
    def protect(state, changes):
        locked = {c['path'] for c in changes} & set(state['locks'])
        if locked:
            raise HTTPException(422, '不能修改锁定参数：' + ', '.join(sorted(locked)))


    def edit(self, wid: str, body: Edit):
        """Explicit legacy-input edits for migration, without agent or execution."""
        with self.db(True) as db:
            row, state = self.load(db, wid, body.expected_revision)
            candidate = json.loads(json.dumps(state['scenario']))
            diff = []
            for change in body.changes:
                parts = change.path.split('.')
                target = candidate
                try:
                    for key in parts[:-1]:
                        target = target[key]
                    before = target[parts[-1]]
                except (KeyError, TypeError):
                    raise HTTPException(422, '参数路径不存在：' + change.path) from None
                if before != change.value:
                    target[parts[-1]] = change.value
                    diff.append({'path':change.path, 'before':before, 'value':change.value})
            self.protect(state, diff)
            try:
                checked = Scenario.model_validate(candidate)
            except ValueError as error:
                raise HTTPException(422, str(error)) from None
            if diff:
                state['scenario'] = checked.model_dump()
                self.commit(db, row, state, body.label)
        return self.snapshot(wid)


def make_router(store: WorkspaceStore):
    router = APIRouter(prefix='/api/workspaces')
    @router.get('')
    def listing():
        with store.db() as db:
            return [{'id': r['id'], 'revision': r['revision'], 'name': (state.get('domain') or state['scenario'])['name'], 'updated_at': r['updated']}
                    for r in db.execute('SELECT * FROM workspaces ORDER BY updated DESC') for state in [json.loads(r['state'])]]

    @router.post('', status_code=201)
    def create(body: Create):
        return store.create(body.scenario)

    @router.get('/{wid}')
    def get(wid: str):
        return store.snapshot(wid)

    @router.get('/{wid}/session')
    def restore_session(wid: str):
        """Read-only, transaction-consistent projection for both interaction modes.

        Reopening is not approval, execution, or a change of engineering revision.
        Expired/stale proposals remain inspectable but cannot be approved.
        """
        with store.db() as db:
            db.execute('BEGIN')
            workspace = store.snapshot(wid, db)
            record = db.execute(
                "SELECT * FROM workspace_proposals WHERE workspace=? AND status='pending' ORDER BY rowid DESC LIMIT 1",
                (wid,),
            ).fetchone()
            proposal = None
            if record is not None:
                proposal = {
                    **json.loads(record['payload']), 'id': record['id'],
                    'base_revision': record['base_revision'], 'status': record['status'],
                    'expired': record['expires'] < time.time(),
                    'expires_at': record['expires'],
                }
            run = db.execute('SELECT * FROM workspace_runs WHERE workspace=? ORDER BY rowid DESC LIMIT 1', (wid,)).fetchone()
            output = None if run is None else {
                **json.loads(run['output']), 'events': json.loads(run['events']), 'run_id': run['id'],
            }
            return {'workspace': workspace, 'proposal': proposal, 'output': output,
                    'output_revision': None if run is None else run['revision']}

    @router.post('/{wid}/edit')
    def edit(wid: str, body: Edit):
        return store.edit(wid, body)

    @router.post('/{wid}/lock')
    def lock(wid: str, body: Lock):
        with store.db(True) as db:
            row, state = store.load(db, wid, body.expected_revision, allow_domain=True)
            paths = set(state['locks'])
            if 'domain' in state:
                from ..domain.guards import validate_lock
                if body.locked or body.path not in paths:
                    validate_lock(state, body.path)
            else:
                target = state['scenario']
                try:
                    for key in body.path.split('.'):
                        target = target[key]
                except (KeyError, TypeError):
                    raise HTTPException(422, '不支持的参数路径。') from None
            paths.add(body.path) if body.locked else paths.discard(body.path)
            state['locks'] = sorted(paths)
            store.commit(db, row, state, ('锁定 ' if body.locked else '解锁 ') + body.path)
        return store.snapshot(wid)

    @router.post('/{wid}/history/{direction}')
    def history(wid: str, direction: Literal['undo', 'redo'], body: Revision):
        with store.db(True) as db:
            row, current = store.load(db, wid, body.expected_revision, allow_domain=True)
            store.assert_mutable(db, wid)
            pos = row['cursor'] + (-1 if direction == 'undo' else 1)
            target = db.execute('SELECT * FROM workspace_history WHERE workspace=? AND position=?', (wid, pos)).fetchone()
            if target is None:
                raise HTTPException(409, '没有可恢复的历史版本。')
            if 'domain' in current and 'domain' not in json.loads(target['state']):
                raise HTTPException(409, '不能通过撤销退回 v0 工程；转换前版本仍可只读查看。')
            db.execute('UPDATE workspaces SET revision=?,cursor=?,state=?,updated=? WHERE id=?', (row['revision'] + 1, pos, target['state'], stamp(), wid))
            store.audit(db, wid, row['revision'] + 1, '撤销' if direction == 'undo' else '重做', target['label'])
            store.archive(db, wid, row['revision'] + 1, json.loads(target['state']))
        return store.snapshot(wid)

    @router.get('/{wid}/runs/{rid}')
    def get_run(wid: str, rid: str):
        with store.db() as db:
            store.load(db, wid)
            run = db.execute('SELECT * FROM workspace_runs WHERE workspace=? AND id=?', (wid, rid)).fetchone()
            if run is None:
                raise HTTPException(404, '计算记录不存在。')
        return {**dict(run), 'output': json.loads(run['output']), 'events': json.loads(run['events'])}

    return router

