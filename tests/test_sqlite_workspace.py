import asyncio
import sqlite3
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.main import create_app


def test_workspace_connection_is_closed_and_wal_anchor_lives_until_shutdown(tmp_path):
    app = create_app(tmp_path / "workspace.sqlite")
    store = app.state.workspace_store
    assert store._anchor is None
    with TestClient(app):
        # The anchor is owned by the application's lifespan thread. Do not execute
        # SQL on it from the TestClient caller thread: Python sqlite3 intentionally
        # rejects cross-thread connection use. Its presence is the lifecycle fact
        # under test; request connections below verify the configured database.
        assert store._anchor is not None
        with store.db() as db:
            journal_mode = db.execute("PRAGMA journal_mode").fetchone()[0]
            checkpoint_pages = db.execute("PRAGMA wal_autocheckpoint").fetchone()[0]
        # Request connections are still closed deterministically.
        with pytest.raises(sqlite3.ProgrammingError):
            db.execute("SELECT 1")
        assert journal_mode.lower() == "wal"
        # SQLite's normal 1000-page PASSIVE checkpoint threshold is retained; the
        # idle anchor prevents request teardown from becoming last-connection WAL
        # checkpoint/unlink work.
        assert checkpoint_pages == store.WAL_AUTOCHECKPOINT_PAGES == 1000
    # Lifespan shutdown releases the anchor; no process-global connection leaks.
    assert store._anchor is None


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


def test_runtime_writer_wait_does_not_freeze_unrelated_api(tmp_path):
    """A SQLite writer wait may delay that task, but must not freeze the ASGI loop."""
    db_path = tmp_path / "runtime-lock.sqlite"

    async def exercise():
        app = create_app(db_path)
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                created = await client.post("/api/workspaces", json={})
                assert created.status_code == 201
                wid = created.json()["id"]

                blocker = sqlite3.connect(db_path, timeout=1)
                blocker.execute("BEGIN IMMEDIATE")
                request = asyncio.create_task(client.post(
                    f"/api/runtime/{wid}/invoke",
                    json={
                        "capability": "task.plan",
                        "request_id": str(uuid4()),
                        "expected_revision": 1,
                        "arguments": {
                            "message": "计算载流量",
                            "mode": "local",
                            "consent": False,
                        },
                    },
                ))
                # Give runtime registration time to reach BEGIN IMMEDIATE. The held
                # writer lock should keep that request pending in a worker thread.
                await asyncio.sleep(0.10)
                assert not request.done()
                try:
                    # Before the writer lock is released, an unrelated request must
                    # still be serviced. With synchronous DB waiting on the ASGI
                    # thread this call stalls behind the busy timeout instead.
                    health = await asyncio.wait_for(client.get("/api/health"), timeout=1.0)
                    assert health.status_code == 200
                finally:
                    blocker.rollback()
                    blocker.close()
                response = await asyncio.wait_for(request, timeout=4.0)
                assert response.status_code == 200
                assert response.json()["result"]["result"]["ready"]

    asyncio.run(exercise())
