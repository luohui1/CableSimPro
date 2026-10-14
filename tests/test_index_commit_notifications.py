"""Committed native notifications over a real release copy; explicit fault cases."""
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.index.service import Snapshot

pytestmark=pytest.mark.skipif(not os.environ.get('CABLESIM_REAL_USE_DATABASE'),
    reason='Requires an explicitly selected saved release-library source')


@pytest.fixture
def release_copy(tmp_path):
    source=Path(os.environ['CABLESIM_REAL_USE_DATABASE']).resolve()
    database=tmp_path/'notifications.sqlite'
    with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as original,closing(sqlite3.connect(database)) as copied:
        original.backup(copied)
    app=create_app(database)
    with TestClient(app) as client:
        store=app.state.workspace_store
        # Complete coverage after all normal module initializers (including
        # those using separate connections), before measuring the baseline.
        with store.db(True):pass
        index=app.state.research.object_index
        index.snapshot(copy=False)
        yield client,store,index,database


def assert_full(index):
    incremental=index.snapshot(copy=False)
    with index.research.store.db() as db:
        db.execute('BEGIN')
        full=Snapshot(index.research,db,index.reproduction_library.snapshot(),execution_reader=index.execution_reader)
    assert incremental.cards==full.cards
    assert incremental.unresolved==full.unresolved
    ordered=lambda items:sorted(json.dumps(item,sort_keys=True,ensure_ascii=False) for item in items)
    assert ordered(incremental.edges)==ordered(full.edges)
    assert ordered(incremental.todos)==ordered(full.todos)


def test_release_empty_and_same_value_transactions_preserve_notifications(release_copy):
    client,store,index,database=release_copy
    project=client.get('/api/workspaces').json()[0]
    def journal():
        with store.db() as db:
            return ([tuple(row) for row in db.execute('SELECT * FROM _workspace_change_state')],
                [tuple(row) for row in db.execute('SELECT * FROM _workspace_changes ORDER BY epoch')],
                db.execute('SELECT state,revision,updated FROM workspaces WHERE id=?',(project['id'],)).fetchone()[:])
    before=journal()
    # A write-capable scope used for a read must not install or trim anything.
    with store.db(True) as db:
        denied=(sqlite3.SQLITE_INSERT,sqlite3.SQLITE_UPDATE,sqlite3.SQLITE_DELETE,
            sqlite3.SQLITE_CREATE_TABLE,sqlite3.SQLITE_CREATE_TRIGGER,sqlite3.SQLITE_DROP_TRIGGER,sqlite3.SQLITE_ALTER_TABLE)
        db.set_authorizer(lambda action,*args:sqlite3.SQLITE_DENY if action in denied else sqlite3.SQLITE_OK)
        assert db.execute('SELECT id FROM workspaces WHERE id=?',(project['id'],)).fetchone()
    assert journal()==before
    with closing(sqlite3.connect(database)) as external:
        external.execute('UPDATE workspaces SET state=state,revision=revision,updated=updated WHERE id=?',(project['id'],))
        external.commit()
    assert journal()==before
    # total_changes counts rolled-back writes, but a cancelled savepoint leaves
    # no notification and must not cause a pruning DELETE at transaction exit.
    with store.db(True) as db:
        db.execute('SAVEPOINT cancelled')
        store.audit(db,project['id'],project['revision'],'cancelled transaction boundary')
        db.execute('ROLLBACK TO cancelled');db.execute('RELEASE cancelled')
        db.set_authorizer(lambda action,*args:sqlite3.SQLITE_DENY if action in denied else sqlite3.SQLITE_OK)
    assert journal()==before
    assert_full(index)


def test_release_transaction_savepoint_and_failure_publish_no_changes(release_copy):
    client,store,index,_=release_copy
    project=client.get('/api/workspaces').json()[0]
    original=client.get('/api/workspaces/'+project['id']).json()
    with store.db() as db:baseline=store.changes_since(db)['cursor']
    with pytest.raises(RuntimeError,match='injected mid-transaction failure'):
        with store.db(True) as db:
            store.audit(db,project['id'],project['revision'],'rollback fault injection')
            assert store.changes_since(db,baseline)['tables']['workspace_audit']
            # Another connection sees only committed notifications.
            with store.db() as observer:
                assert store.changes_since(observer,baseline)['tables']=={}
            raise RuntimeError('injected mid-transaction failure')
    with store.db() as db:
        result=store.changes_since(db,baseline)
        assert result['complete'] and result['cursor']==baseline and result['tables']=={}
    with store.db(True) as db:
        db.execute('SAVEPOINT cancelled_audit')
        store.audit(db,project['id'],project['revision'],'cancelled savepoint fault injection')
        db.execute('ROLLBACK TO cancelled_audit');db.execute('RELEASE cancelled_audit')
        assert store.changes_since(db,baseline)['tables']=={}
        store.audit(db,project['id'],project['revision'],'committed transaction observation')
    with store.db() as db:
        result=store.changes_since(db,baseline)
        assert result['complete'] and len(result['tables']['workspace_audit'])==1
        assert result['tables']['workspace_audit'][0]['new']['workspace']==project['id']
    saved=client.get('/api/workspaces/'+project['id']).json()
    assert saved['domain']==original['domain'] and saved['revision']==original['revision']
    assert saved['audit'][0]['event']=='committed transaction observation'
    assert not any(item['event'] in ('rollback fault injection','cancelled savepoint fault injection') for item in saved['audit'])
    assert_full(index)


def test_unrecorded_external_write_and_missing_history_force_full_read(release_copy):
    client,store,index,database=release_copy
    project=next(w for w in client.get('/api/workspaces').json() if '城南' in w['name'])
    # Fault injection: an external tool removes instrumentation then writes.
    # No model/result is substituted, and no fake engineering output is saved.
    with closing(sqlite3.connect(database)) as external:
        trigger=external.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='workspaces' "
            "AND name LIKE '_workspace_change_%_update'").fetchone()[0]
        external.execute('DROP TRIGGER '+store._quoted(trigger))
        external.execute("UPDATE workspaces SET state=json_set(state,'$.domain.name',?),revision=revision+1 WHERE id=?",
            (project['name']+' · 外部保存',project['id']))
        external.commit()
    card=next(c for c in index.objects(kind='project',limit=100)['items'] if c['id']==project['id'])
    assert card['name']==project['name']+' · 外部保存'
    assert index.last_build['change_notification']['reason']=='schema_changed'
    assert not index.last_build['source_timings']['study_runs']['committed_rows']
    assert_full(index)
    with store.db(True):pass  # Repair missing coverage with an explicit barrier.
    index.snapshot(copy=False)
    with closing(sqlite3.connect(database)) as external:
        external.execute('UPDATE workspaces SET revision=revision+1 WHERE id=?',(project['id'],))
        epoch=external.execute('SELECT epoch FROM _workspace_change_state').fetchone()[0]
        external.execute('DELETE FROM _workspace_changes WHERE epoch=?',(epoch,))
        external.commit()
    index.snapshot(copy=False)
    assert index.last_build['change_notification']['reason']=='history_gap'
    assert_full(index)
    # A malformed notification must also fall back, even when it is valid JSON
    # with an unexpected shape rather than a missing epoch.
    with closing(sqlite3.connect(database)) as external:
        external.execute('UPDATE workspaces SET revision=revision+1 WHERE id=?',(project['id'],))
        epoch=external.execute('SELECT epoch FROM _workspace_change_state').fetchone()[0]
        external.execute("UPDATE _workspace_changes SET new_key='[]' WHERE epoch=?",(epoch,))
        external.commit()
    index.snapshot(copy=False)
    assert index.last_build['change_notification']['reason']=='invalid_record'
    assert_full(index)


def test_external_replace_keeps_no_silently_deleted_card(release_copy):
    _,store,index,database=release_copy
    old=next(r for r in index.previous['raw']['assets'] if r['status']=='published')
    replacement=str(uuid4())
    with closing(sqlite3.connect(database)) as external:
        columns=[r[1] for r in external.execute('PRAGMA table_info(engineering_assets)') if r[1]!='id']
        names=','.join(store._quoted(name) for name in columns)
        # Actual saved resource data; test SQLite's REPLACE/delete behavior on
        # a second connection with its normal recursive_triggers=OFF setting.
        external.execute('INSERT OR REPLACE INTO engineering_assets(id,'+names+') '
            'SELECT ?,'+names+' FROM engineering_assets WHERE id=?',(replacement,old['id']))
        external.commit()
    current=index.snapshot(copy=False)
    assert ('asset',old['id']) not in current.cards
    assert ('asset',replacement) in current.cards
    assert not index.last_build['source_timings']['engineering_assets']['committed_rows']
    assert_full(index)
    # UPDATE OR REPLACE can hide the same conflicting-row deletion without an
    # INSERT notification. The cardinality check must cover updates as well.
    with closing(sqlite3.connect(database)) as external:
        victim=external.execute('SELECT id,asset_id,version FROM engineering_assets WHERE id<>? LIMIT 1',
            (replacement,)).fetchone()
        external.execute('UPDATE OR REPLACE engineering_assets SET asset_id=?,version=? WHERE id=?',
            (victim[1],victim[2],replacement))
        external.commit()
    current=index.snapshot(copy=False)
    assert ('asset',victim[0]) not in current.cards
    assert ('asset',replacement) in current.cards
    assert not index.last_build['source_timings']['engineering_assets']['committed_rows']
    assert_full(index)
