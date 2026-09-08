import sqlite3
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app


def test_workspace_connection_is_closed_and_wal_anchor_lives_until_shutdown(tmp_path):
    app = create_app(tmp_path / "workspace.sqlite")
    anchor = None
    with TestClient(app):
        store = app.state.workspace_store
        anchor = store._anchor
        assert anchor is not None
        with store.db() as db:
            checkpoint_pages = db.execute("PRAGMA wal_autocheckpoint").fetchone()[0]
        # Request connections are still closed deterministically.
        with pytest.raises(sqlite3.ProgrammingError):
            db.execute("SELECT 1")
        # SQLite's normal 1000-page PASSIVE checkpoint threshold is retained; the
        # idle anchor prevents request teardown from becoming last-connection WAL
        # checkpoint/unlink work.
        assert checkpoint_pages == store.WAL_AUTOCHECKPOINT_PAGES == 1000
        assert anchor.execute("SELECT 1").fetchone()[0] == 1
    assert anchor is not None
    with pytest.raises(sqlite3.ProgrammingError):
        anchor.execute("SELECT 1")


def invoke(client, workspace_id, capability, arguments=None):
    return client.post(
        f"/api/runtime/{workspace_id}/invoke",
        json={
            "capability": capability,
            "request_id": str(uuid4()),
            "expected_revision": 1,
            "arguments": arguments or {},
        },
    )


def test_calculate_plan_then_edit_remains_writable_across_checkpoints(tmp_path):
    app = create_app(tmp_path / "checkpoint.sqlite")
    with TestClient(app) as client:
        # A calculation is stored both as a run and a runtime task. Repeating the
        # real desktop sequence crosses many request connection boundaries while
        # the application-level WAL anchor remains open.
        for index in range(12):
            workspace = client.post("/api/workspaces", json={}).json()
            wid = workspace["id"]
            calculation = invoke(client, wid, "analysis.buried")
            assert calculation.status_code == 200
            proposal = invoke(
                client,
                wid,
                "task.plan",
                {
                    "message": "截面积改为 400 mm²，重新计算",
                    "mode": "local",
                    "consent": False,
                },
            )
            assert proposal.status_code == 200
            assert proposal.json()["result"]["ready"]
            edit = client.post(
                f"/api/workspaces/{wid}/edit",
                json={
                    "expected_revision": 1,
                    "changes": [
                        {"path": "cable.insulation_mm", "value": 6 + index / 100}
                    ],
                    "label": "绝缘厚度",
                },
            )
            assert edit.status_code == 200
            assert edit.json()["revision"] == 2
