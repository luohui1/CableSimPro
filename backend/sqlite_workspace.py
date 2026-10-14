"""Predictable SQLite lifecycle for the local engineering workspace.

Request connections remain short-lived, but one idle anchor connection stays open for
the application lifetime. In WAL mode SQLite checkpoints and removes WAL/SHM when
the last connection closes; making every request the possible last connection puts
that filesystem work directly on the UI request path, especially on Windows.
"""
from contextlib import contextmanager
from hashlib import sha256
import json
import sqlite3
from uuid import uuid4

from .kernel.workspace import WorkspaceStore as BaseWorkspaceStore


class WorkspaceStore(BaseWorkspaceStore):
    """Workspace store with explicit rollback/close and a process-lifetime WAL anchor."""

    BUSY_TIMEOUT_SECONDS = 20
    # SQLite's default WAL auto-checkpoint threshold. Automatic checkpoints are
    # PASSIVE; using a much smaller value needlessly increases checkpoint frequency.
    WAL_AUTOCHECKPOINT_PAGES = 1000
    CHANGE_LIMIT = 4096

    def __init__(self, path):
        super().__init__(path)
        self._anchor: sqlite3.Connection | None = None

    @staticmethod
    def _quoted(value):
        return '"'+value.replace('"','""')+'"'

    @staticmethod
    def _schema_identity(db):
        # SQLite backup may change the internal schema cookie without changing
        # any DDL. Persist the actual structure, not that connection-cache cookie.
        rows=[tuple(row) for row in db.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name')]
        return sha256(json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

    def _change_journal(self, db, *, check_triggers=False):
        """Native engineering records also cover AssetRepository connections.

        No Python callback, connection-local update hook, result body, or commit
        guess is involved. Trigger writes have exactly the business transaction's
        savepoint/commit/rollback semantics, including external ordinary SQL.
        """
        schema=self._schema_identity(db)
        state=None
        try:
            state=db.execute('SELECT schema_version FROM _workspace_change_state WHERE singleton=1').fetchone()
            if state and state[0]==schema and not check_triggers:return
        except sqlite3.OperationalError:pass
        db.execute('CREATE TABLE IF NOT EXISTS _workspace_change_state ('
            'singleton INTEGER PRIMARY KEY CHECK(singleton=1),namespace TEXT NOT NULL,epoch INTEGER NOT NULL,schema_version INTEGER NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS _workspace_changes ('
            'epoch INTEGER PRIMARY KEY,source_table TEXT NOT NULL,operation TEXT NOT NULL,old_key TEXT,new_key TEXT)')
        db.execute('INSERT OR IGNORE INTO _workspace_change_state VALUES(1,?,0,-1)',(str(uuid4()),))
        tables=db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' "
            "AND name NOT IN ('_workspace_change_state','_workspace_changes')").fetchall()
        for row in tables:
            table=row[0];quoted=self._quoted(table)
            if table.startswith('agent_'):
                # Task bookkeeping is permitted during a read-only conversation.
                # Keep it out of the engineering journal; the index compares its
                # small task/proposal identities (including event sequence) in full.
                for operation in ('insert','update','delete'):
                    name='_workspace_change_'+sha256(table.encode()).hexdigest()[:20]+'_'+operation
                    if db.execute("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?",(name,)).fetchone():
                        db.execute('DROP TRIGGER '+self._quoted(name))
                continue
            columns=db.execute('PRAGMA table_info('+quoted+')').fetchall()
            # Physical primary keys plus stable business IDs. The index may use
            # id rather than study_runs.sequence, or proposal_id rather than the
            # plan's compound PK. Foreign IDs allow consumers to refresh parents.
            keys=[c[1] for c in columns if c[5] or c[1] in ('id','proposal_id','task_id','workspace','study','document')]
            def encoded(prefix):
                if not keys:return 'NULL'
                values=[prefix+'.'+self._quoted(key) for key in keys]
                safe=' AND '.join('typeof('+v+") IN ('null','text','integer','real')" for v in values)
                pairs=','.join("'"+key.replace("'","''")+"',"+v for key,v in zip(keys,values))
                return 'CASE WHEN '+safe+' THEN json_object('+pairs+') ELSE NULL END'
            for operation in ('INSERT','UPDATE','DELETE'):
                name='_workspace_change_'+sha256(table.encode()).hexdigest()[:20]+'_'+operation.lower()
                old=encoded('OLD') if operation!='INSERT' else 'NULL'
                new=encoded('NEW') if operation!='DELETE' else 'NULL'
                sql='CREATE TRIGGER '+self._quoted(name)+' AFTER '+operation+' ON '+quoted
                if operation=='UPDATE':
                    # Null-safe and storage-type aware, including BLOBs. Binary
                    # comparison must also observe a case-only text edit on a
                    # column with a case-insensitive declared collation.
                    changed=['(OLD.'+self._quoted(c[1])+' IS NOT NEW.'+self._quoted(c[1])+' COLLATE BINARY OR '
                        'typeof(OLD.'+self._quoted(c[1])+')<>typeof(NEW.'+self._quoted(c[1])+'))' for c in columns]
                    sql+=' WHEN '+' OR '.join(changed)
                sql+=' BEGIN '
                sql+='UPDATE _workspace_change_state SET epoch=epoch+1 WHERE singleton=1; '
                sql+='INSERT INTO _workspace_changes SELECT epoch,\''+table.replace("'","''")+"','"+operation+"',"+old+','+new+' FROM _workspace_change_state WHERE singleton=1; END'
                found=db.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?",(name,)).fetchone()
                if found and found[0]!=sql:db.execute('DROP TRIGGER '+self._quoted(name));found=None
                if not found:db.execute(sql)
        # DDL/new tables may have written before their triggers existed, and
        # dropped/replaced triggers may have missed external writes. This explicit
        # barrier prevents interpreting that history as a complete row journal.
        current_schema=self._schema_identity(db)
        if state and state[0]==current_schema:return
        db.execute('UPDATE _workspace_change_state SET epoch=epoch+1 WHERE singleton=1')
        db.execute("INSERT INTO _workspace_changes SELECT epoch,'*','SCHEMA',NULL,NULL FROM _workspace_change_state WHERE singleton=1")
        db.execute('UPDATE _workspace_change_state SET schema_version=? WHERE singleton=1',
            (current_schema,))

    @staticmethod
    def _journal_position(db):
        try:
            row=db.execute('SELECT namespace,epoch FROM _workspace_change_state WHERE singleton=1').fetchone()
            return tuple(row) if row else None
        except sqlite3.OperationalError:return None

    def changes_since(self, db, cursor=None):
        """Read a bounded committed journal in the caller's SQLite read snapshot.

        A fresh process/index, legacy DB, DDL, missing entries, or pruned history
        yields complete=False. Consumers must compare source identities in full.
        """
        try:
            state=db.execute('SELECT namespace,epoch,schema_version FROM _workspace_change_state WHERE singleton=1').fetchone()
            schema=db.execute('PRAGMA schema_version').fetchone()[0]
            if not state:return {'complete':False,'reason':'missing','cursor':None,'tables':{}}
            current={'namespace':state[0],'epoch':state[1],'schema_version':schema}
            result={'complete':False,'reason':'baseline','cursor':current,'tables':{}}
            if state[2]!=self._schema_identity(db):result['reason']='schema_changed';return result
            if not cursor or cursor.get('namespace')!=state[0]:return result
            # Also catch drop/recreate cycles with identical final DDL. A fresh
            # process starts with a full baseline regardless of the copied cookie.
            if cursor.get('schema_version')!=schema:result['reason']='schema_changed';return result
            difference=state[1]-cursor['epoch']
            if not 0<=difference<=self.CHANGE_LIMIT:result['reason']='history_gap';return result
            rows=db.execute('SELECT epoch,source_table,operation,old_key,new_key FROM _workspace_changes '
                'WHERE epoch>? AND epoch<=? ORDER BY epoch LIMIT ?',
                (cursor['epoch'],state[1],self.CHANGE_LIMIT+1)).fetchall()
            if len(rows)!=difference or any(row[0]!=cursor['epoch']+i+1 for i,row in enumerate(rows)):
                result['reason']='history_gap';return result
            for row in rows:
                if row[1]=='*':result['reason']='schema_barrier';return result
                old=json.loads(row[3]) if row[3] else None
                new=json.loads(row[4]) if row[4] else None
                if row[2] not in ('INSERT','UPDATE','DELETE') or any(
                    value is not None and (not isinstance(value,dict) or any(
                        item is not None and not isinstance(item,(str,int,float)) for item in value.values()))
                    for value in (old,new)):
                    result['reason']='invalid_record';result['tables']={};return result
                result['tables'].setdefault(row[1],[]).append({'operation':row[2],'old':old,'new':new})
            result.update(complete=True,reason='committed_rows')
            return result
        except (sqlite3.OperationalError,ValueError,TypeError,KeyError):
            return {'complete':False,'reason':'unavailable','cursor':None,'tables':{}}

    def _configure(self, db: sqlite3.Connection) -> sqlite3.Connection:
        db.row_factory = sqlite3.Row
        db.execute(f"PRAGMA busy_timeout={self.BUSY_TIMEOUT_SECONDS * 1000}")
        db.execute(f"PRAGMA wal_autocheckpoint={self.WAL_AUTOCHECKPOINT_PAGES}")
        return db

    def initialize(self):
        # Let the base store establish WAL mode and the schema first. Then keep one
        # idle connection open so ordinary request cleanup never becomes SQLite's
        # last-connection WAL checkpoint/unlink path.
        super().initialize()
        # Upgrade notification trigger definitions once during startup, before
        # read-only request guards. Subsequent empty transactions perform no DDL.
        with self.db(True) as db:self._change_journal(db,check_triggers=True)
        if self._anchor is None:
            self._anchor = self._configure(sqlite3.connect(self.path, timeout=self.BUSY_TIMEOUT_SECONDS))

    def close(self):
        anchor, self._anchor = self._anchor, None
        if anchor is not None:
            anchor.close()

    @contextmanager
    def db(self, write: bool = False):
        db = self._configure(sqlite3.connect(self.path, timeout=self.BUSY_TIMEOUT_SECONDS))
        try:
            if write:
                db.execute("BEGIN IMMEDIATE")
                journal_before=self._journal_position(db)
                self._change_journal(db)
            yield db
            # Initializers use executescript, which commits its preceding
            # transaction. Install coverage for their newly created tables in a
            # final explicit transaction as well; ordinary writes stay atomic.
            if write and not db.in_transaction:
                db.execute('BEGIN IMMEDIATE')
                # executescript/explicit commit ended the original transaction.
                # Do not attribute another connection's intervening records to
                # this final initialization transaction.
                journal_before=self._journal_position(db)
            if db.in_transaction:
                if write:
                    self._change_journal(db)
                    # A savepoint rollback may increase total_changes without
                    # leaving any committed notification; compare journal state.
                    if self._journal_position(db)!=journal_before:
                        db.execute('DELETE FROM _workspace_changes WHERE epoch<(SELECT epoch-? FROM _workspace_change_state WHERE singleton=1)',
                            (self.CHANGE_LIMIT,))
                db.commit()
        except BaseException:
            if db.in_transaction:
                db.rollback()
            raise
        finally:
            db.close()
