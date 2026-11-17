"""Real host routing, SQLite upgrade safety and immutable offline package validation."""
from contextlib import closing
from hashlib import sha256
import json
import os
from pathlib import Path
import socket
import sqlite3
import sys
import time

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from scripts import install_release, release_support, run_release


def package(root, identity="first"):
    """Minimal immutable payload for launcher route/upgrade tests; no fake calculations."""
    (root / "frontend/dist/assets").mkdir(parents=True)
    (root / "frontend/dist/index.html").write_text('<div id="root">' + identity + '</div>', encoding="utf-8")
    (root / "frontend/dist/assets/app.js").write_text('export const release = true;', encoding="utf-8")
    files = {path.relative_to(root).as_posix(): {"size_bytes": path.stat().st_size,
                                               "sha256": release_support.digest(path)}
             for path in root.rglob("*") if path.is_file()}
    value = {"format": release_support.FORMAT, "target": release_support.target(), "git_commit": identity, "files": files}
    value["build_id"] = sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    release_support.atomic_json(root / release_support.MANIFEST, value)
    return value


def host_database(directory, monkeypatch):
    database = directory / "engineering.sqlite"
    monkeypatch.setenv("CABLESIM_DB", str(database))
    monkeypatch.setenv("CABLESIM_DATASETS_DIR", str(directory / "datasets"))
    monkeypatch.setenv("CABLESIM_REPRODUCTION_LIBRARY", str(directory / "library"))
    from backend.main import create_app
    with TestClient(create_app(database)) as client:
        assert client.get("/api/health").status_code == 200
    with closing(sqlite3.connect(database)) as db, db:
        db.execute("CREATE TABLE customer_records (name TEXT PRIMARY KEY, value TEXT)")
        db.execute("INSERT INTO customer_records VALUES ('订单', '保留的工程数据')")
    return database


def test_installed_frontend_release_identity_and_api_fallback(tmp_path, monkeypatch):
    root = tmp_path / "program"
    bundle = package(root)
    monkeypatch.setattr(run_release, "ROOT", root)
    directory = tmp_path / "data"
    directory.mkdir()
    monkeypatch.setenv("CABLESIM_DB", str(directory / "engineering.sqlite"))
    monkeypatch.setenv("CABLESIM_DATASETS_DIR", str(directory / "datasets"))
    monkeypatch.setenv("CABLESIM_REPRODUCTION_LIBRARY", str(directory / "library"))
    with TestClient(run_release.create_release_app()) as client:
        assert client.get("/api/release-info").json() == {"build_id": bundle["build_id"], "git_commit": "first"}
        assert client.get("/api/health").json()["status"] == "ok"
        assert client.get("/api/workspaces").json() == []
        for path in ("/", "/types/a/specification", "/plugins/cablesim.iec60287"):
            assert 'id="root"' in client.get(path).text
        assert client.get("/assets/app.js").status_code == 200
        for path in ("/api/missing", "/api", "/assets/missing.js", "/missing.css", "/gallery"):
            response = client.get(path)
            assert response.status_code == 404 and 'id="root"' not in response.text


def test_upgrade_backup_contains_wal_and_failure_restores_real_database(tmp_path, monkeypatch):
    from backend.kernel.database_ops import validate
    database = host_database(tmp_path, monkeypatch)
    state = {"active": {"build_id": "a" * 64, "app_dir": "previous", "git_commit": "previous"}}
    release_support.atomic_json(tmp_path / "release-state.json", state)
    # Keep committed values in WAL while the online backup is made.
    with closing(sqlite3.connect(database)) as writer:
        writer.execute("PRAGMA journal_mode=WAL")
        writer.execute("PRAGMA wal_autocheckpoint=0")
        writer.execute("INSERT INTO customer_records VALUES ('已提交WAL', '不能丢失')")
        writer.commit()
        assert Path(str(database) + "-wal").stat().st_size > 0
        pending = run_release.prepare_upgrade(tmp_path, {"build_id": "b" * 64})
        validate(pending["backup"], pending["sha256"])
        with closing(sqlite3.connect(pending["backup"])) as saved:
            assert dict(saved.execute("SELECT name,value FROM customer_records")) == {
                "订单": "保留的工程数据", "已提交WAL": "不能丢失"}
    with closing(sqlite3.connect(database)) as changed, changed:
        changed.execute("UPDATE customer_records SET value='未通过启动的变更'")
        changed.execute("CREATE TABLE interrupted_migration (value TEXT)")
    run_release.recover_pending(tmp_path)
    with closing(sqlite3.connect(database)) as restored:
        assert dict(restored.execute("SELECT name,value FROM customer_records")) == {
            "订单": "保留的工程数据", "已提交WAL": "不能丢失"}
        assert restored.execute("SELECT name FROM sqlite_master WHERE name='interrupted_migration'").fetchone() is None
    assert run_release.read_state(tmp_path) == state
    assert not (tmp_path / "release-pending.json").exists()
    assert list(Path(str(database) + ".snapshots").glob("before-restore-*.sqlite"))


def test_future_schema_and_live_owner_block_upgrade_before_any_write(tmp_path, monkeypatch):
    from backend.kernel.database_ops import SCHEMA_VERSION
    from backend.kernel.ownership import OwnerLock
    database = host_database(tmp_path, monkeypatch)
    with closing(sqlite3.connect(database)) as db, db:
        db.execute(f"PRAGMA user_version={SCHEMA_VERSION + 1}")
    before = database.read_bytes()
    with pytest.raises(HTTPException) as error:
        run_release.prepare_upgrade(tmp_path, {"build_id": "a" * 64})
    assert error.value.detail["code"] == "DATABASE_VERSION_TOO_NEW"
    assert database.read_bytes() == before
    assert not (tmp_path / "release-snapshots").exists()
    assert not (tmp_path / "release-pending.json").exists()
    owner = OwnerLock(database)
    owner.acquire()
    try:
        with pytest.raises(RuntimeError, match="另一个"):
            run_release.prepare_upgrade(tmp_path, {"build_id": "a" * 64})
    finally:
        owner.close()
    assert database.read_bytes() == before


def test_existing_product_database_is_never_reseeded(tmp_path, monkeypatch):
    database = host_database(tmp_path, monkeypatch)
    before = database.read_bytes()
    # No seed marker is present. Product upgrades must still preserve this DB.
    run_release.initialize_examples(tmp_path, {"initialization": {"seed_examples": True}})
    assert database.read_bytes() == before
    assert not database.with_suffix(".seed.json").exists()


def test_health_activation_preserves_later_user_writes_after_interruption(tmp_path, monkeypatch):
    database = host_database(tmp_path, monkeypatch)
    bundle = {"build_id": "b" * 64, "git_commit": "next"}
    pending = run_release.prepare_upgrade(tmp_path, bundle)
    run_release.activate(tmp_path, bundle, pending)
    # Model a crash between state activation and pending-file removal.
    release_support.atomic_json(tmp_path / "release-pending.json", pending)
    with closing(sqlite3.connect(database)) as db, db:
        db.execute("INSERT INTO customer_records VALUES ('启动后保存', '必须保留')")
    run_release.recover_pending(tmp_path)
    with closing(sqlite3.connect(database)) as db:
        assert db.execute("SELECT value FROM customer_records WHERE name='启动后保存'").fetchone()[0] == "必须保留"


def test_failed_initialization_preserves_database_and_cannot_claim_a_healthy_restart(tmp_path, monkeypatch):
    database = host_database(tmp_path, monkeypatch)
    release_support.atomic_json(tmp_path / "release-pending.json", {"build_id": "a" * 64, "previous": None})
    before = database.read_bytes()
    run_release.recover_pending(tmp_path)
    assert database.read_bytes() == before
    assert (tmp_path / "release-initialization-failed.json").is_file()
    with pytest.raises(RuntimeError, match="首次启动未完成"):
        run_release.prepare_upgrade(tmp_path, {"build_id": "a" * 64})


def test_explicit_rollback_restores_previous_program_and_keeps_newer_data_snapshot(tmp_path, monkeypatch):
    from backend.kernel.database_ops import snapshot
    directory = tmp_path / "data"
    directory.mkdir()
    database = host_database(directory, monkeypatch)
    source = tmp_path / "previous-program"
    bundle = package(source)
    app = release_support.installation(directory, bundle["build_id"])
    app.parent.mkdir(parents=True)
    source.rename(app)
    python = release_support.python_path(app)
    python.parent.mkdir(parents=True)
    python.touch()
    saved = directory / "release-snapshots/before-upgrade.sqlite"
    receipt = snapshot(database, saved)
    with closing(sqlite3.connect(database)) as db, db:
        db.execute("INSERT INTO customer_records VALUES ('升级后工作', '回退前应备份')")
    release_support.atomic_json(directory / "release-state.json", {
        "active": {"build_id": "f" * 64, "app_dir": "next", "git_commit": "next"},
        "previous": {"build_id": bundle["build_id"], "app_dir": str(app), "git_commit": "first",
                     "backup": str(saved), "sha256": receipt["sha256"]}})
    assert run_release.rollback(directory) == app
    state = run_release.read_state(directory)
    assert state["active"]["build_id"] == bundle["build_id"]
    with closing(sqlite3.connect(database)) as db:
        assert db.execute("SELECT value FROM customer_records WHERE name='升级后工作'").fetchone() is None
    with closing(sqlite3.connect(state["rollback_safety_snapshot"])) as db:
        assert db.execute("SELECT value FROM customer_records WHERE name='升级后工作'").fetchone()[0] == "回退前应备份"


@pytest.mark.skipif(os.name == "nt", reason="POSIX process group lifecycle; Windows uses the owned Job Object")
def test_stop_reclaims_companion_descendants_after_parent_exit(tmp_path):
    ready = tmp_path / "ready"
    child_code = ("import socket,time;from pathlib import Path;"
                  "s=socket.socket();s.bind(('127.0.0.1',0));s.listen();"
                  f"Path({str(ready)!r}).write_text(str(s.getsockname()[1]));time.sleep(60)")
    parent_code = "import subprocess,sys;subprocess.Popen([sys.executable,'-c'," + repr(child_code) + "])"
    process = run_release.spawn([sys.executable, "-c", parent_code], cwd=tmp_path, env=os.environ.copy())
    try:
        process.wait(timeout=10)
        deadline = time.monotonic() + 10
        while not ready.is_file() and time.monotonic() < deadline:
            time.sleep(.05)
        assert ready.is_file()
        port = int(ready.read_text())
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            pass
        run_release.stop_process(process)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            with socket.socket() as probe:
                if probe.connect_ex(("127.0.0.1", port)) != 0:
                    break
            time.sleep(.05)
        else:
            pytest.fail("companion descendant kept its listening socket after shutdown")
    finally:
        run_release.stop_process(process)


def test_edited_or_wrong_platform_bundle_never_creates_install_directory(tmp_path):
    root = tmp_path / "bundle"
    package(root)
    (root / "frontend/dist/assets/app.js").write_text("damaged", encoding="utf-8")
    directory = tmp_path / "user-data"
    with pytest.raises(RuntimeError, match="摘要"):
        install_release.install(root, {"data_dir": directory})
    assert not directory.exists()


def test_config_resolves_paths_and_keeps_keys_only_in_environment(tmp_path, monkeypatch):
    config_path = tmp_path / "config/release.toml"
    config_path.parent.mkdir()
    config_path.write_text('[server]\nport=8310\n[storage]\ndata_dir="../工程数据"\n'
                           '[model]\nbase_url="http://127.0.0.1:9000/v1"\nmodel="local-model"\n'
                           'api_key_env="LOCAL_MODEL_SECRET"\n', encoding="utf-8")
    monkeypatch.setenv("LOCAL_MODEL_SECRET", "secret-not-written-to-config")
    monkeypatch.setenv("CABLESIM_DB", "/unrelated/developer.sqlite")
    settings = release_support.config(config_path)
    env = release_support.environment(settings, tmp_path / "app")
    assert settings["data_dir"] == (tmp_path / "工程数据").resolve()
    assert Path(env["CABLESIM_DB"]) == settings["data_dir"] / "engineering.sqlite"
    assert env["CABLESIM_LLM_API_KEY"] == "secret-not-written-to-config"
    assert "secret-not-written-to-config" not in config_path.read_text("utf-8")
    assert env["PIP_NO_INDEX"] == "1"
    config_path.write_text('[model]\nbase_url="https://user:secret@example.test/v1"\n', encoding="utf-8")
    with pytest.raises(RuntimeError, match="凭据"):
        release_support.config(config_path)
