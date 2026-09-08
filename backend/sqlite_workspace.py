"""Predictable SQLite lifecycle for the local engineering workspace.

Request connections remain short-lived, but one idle anchor connection stays open for
the application lifetime. In WAL mode SQLite checkpoints and removes WAL/SHM when
the last connection closes; making every request the possible last connection puts
that filesystem work directly on the UI request path, especially on Windows.
"""
from contextlib import contextmanager
import sqlite3

from .workbench import WorkspaceStore as BaseWorkspaceStore


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
