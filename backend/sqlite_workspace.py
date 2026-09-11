"""Predictable SQLite connection lifecycle for the local engineering workspace.

The base store owns the schema and domain transactions.  This adapter keeps every
connection short-lived and limits WAL checkpoints to small batches so a large run
history cannot turn the next property edit into a long desktop UI stall.
"""
from contextlib import contextmanager
import sqlite3

from .workbench import WorkspaceStore as BaseWorkspaceStore


class WorkspaceStore(BaseWorkspaceStore):
    """Workspace store with explicit close/rollback and bounded WAL checkpoints."""

    BUSY_TIMEOUT_SECONDS = 20
    WAL_AUTOCHECKPOINT_PAGES = 128

    @contextmanager
    def db(self, write: bool = False):
        db = sqlite3.connect(self.path, timeout=self.BUSY_TIMEOUT_SECONDS)
        try:
            db.row_factory = sqlite3.Row
            db.execute(f"PRAGMA busy_timeout={self.BUSY_TIMEOUT_SECONDS * 1000}")
            db.execute(f"PRAGMA wal_autocheckpoint={self.WAL_AUTOCHECKPOINT_PAGES}")
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
