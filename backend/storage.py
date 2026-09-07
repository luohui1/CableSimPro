"""Small local SQLite project store. No multi-user authentication is provided."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from uuid import uuid4

from .schemas import Scenario


class ProjectStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path) as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")

    def list(self) -> list[dict]:
        with sqlite3.connect(self.path) as db:
            db.row_factory = sqlite3.Row
            rows = db.execute("SELECT id,name,created_at,updated_at FROM projects ORDER BY updated_at DESC").fetchall()
        return [dict(row) for row in rows]

    def get(self, project_id: str) -> dict | None:
        with sqlite3.connect(self.path) as db:
            db.row_factory = sqlite3.Row
            row = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if row is None:
            return None
        result = dict(row)
        result["scenario"] = json.loads(result.pop("payload"))
        return result

    def save(self, scenario: Scenario, project_id: str | None = None) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        payload = scenario.model_dump_json()
        with sqlite3.connect(self.path) as db:
            if project_id is None:
                project_id = str(uuid4())
                db.execute("INSERT INTO projects VALUES (?,?,?,?,?)", (project_id, scenario.name, payload, now, now))
            else:
                cursor = db.execute("UPDATE projects SET name=?,payload=?,updated_at=? WHERE id=?", (scenario.name, payload, now, project_id))
                if cursor.rowcount == 0:
                    raise KeyError(project_id)
        result = self.get(project_id)
        assert result is not None
        return result

    def delete(self, project_id: str) -> bool:
        with sqlite3.connect(self.path) as db:
            return db.execute("DELETE FROM projects WHERE id=?", (project_id,)).rowcount > 0
