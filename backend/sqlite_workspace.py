"""Predictable SQLite lifecycle for the local engineering workspace.

Request connections remain short-lived, but one idle anchor connection stays open for
the application lifetime. In WAL mode SQLite checkpoints and removes WAL/SHM when
the last connection closes; making every request the possible last connection puts
that filesystem work directly on the UI request path, especially on Windows.
"""
from contextlib import contextmanager
import json
import sqlite3
import time
from uuid import uuid4

from .workbench import WorkspaceStore as BaseWorkspaceStore, stamp


class WorkspaceStore(BaseWorkspaceStore):
    """Workspace store with explicit rollback/close and a process-lifetime WAL anchor."""

    BUSY_TIMEOUT_SECONDS = 20
    # SQLite's default WAL auto-checkpoint threshold. Automatic checkpoints are
    # PASSIVE; using a much smaller value needlessly increases checkpoint frequency.
    WAL_AUTOCHECKPOINT_PAGES = 1000

    def __init__(self, path):
        super().__init__(path)
        self._anchor: sqlite3.Connection | None = None

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
            yield db
            if db.in_transaction:
                db.commit()
        except BaseException:
            if db.in_transaction:
                db.rollback()
            raise
        finally:
            db.close()

    def stage_and_finish_task(self, wid: str, revision: int, proposal: dict,
                              task_id: str, envelope_base: dict) -> dict:
        """Stage a ready proposal and finish its runtime task in one write transaction.

        The ordinary planner path used to commit the pending proposal and then open a
        second BEGIN IMMEDIATE solely to mark the same runtime task succeeded.  On a
        Windows local filesystem that extra writer hand-off could dominate an
        otherwise sub-millisecond plan.  Keeping both records in one transaction also
        removes the observable state where a proposal exists while its task ledger is
        still marked running.
        """
        with self.db(True) as db:
            _, state = self.load(db, wid, revision)
            self.protect(state, proposal.get('changes', []))
            if (proposal.get('action') == 'sweep' and
                    'installation.' + proposal['parameter'] in state['locks']):
                from fastapi import HTTPException
                raise HTTPException(422, '扫描参数已锁定；不能在研究中改变它。')

            pid = str(uuid4())
            expires_at = time.time() + 1800
            db.execute(
                'INSERT INTO workspace_proposals VALUES (?,?,?,?,?,?,?)',
                (pid, wid, revision, 'pending', json.dumps(proposal, ensure_ascii=False),
                 stamp(), expires_at),
            )
            self.audit(db, wid, revision, '生成待审批提案', proposal.get('message', '')[:300])
            staged = {
                **proposal, 'id': pid, 'base_revision': revision,
                'status': 'pending', 'expired': False, 'expires_at': expires_at,
            }
            envelope = {**envelope_base, 'result': staged}
            cursor = db.execute(
                "UPDATE engineering_tasks SET status='succeeded',output=?,finished=? "
                "WHERE workspace=? AND id=? AND status='running'",
                (json.dumps(envelope, ensure_ascii=False), stamp(), wid, task_id),
            )
            if cursor.rowcount != 1:
                # This should only be possible if the task ledger was concurrently
                # altered. Roll back the proposal too rather than split the records.
                raise RuntimeError('runtime task ledger changed before proposal commit')
        return envelope
