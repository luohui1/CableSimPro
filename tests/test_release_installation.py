"""Real host routing, SQLite upgrade safety and immutable offline package validation."""
from contextlib import closing
import errno
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
from threading import Thread
import time
from uuid import uuid4
import zipfile

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


def test_pending_release_rejects_engineering_access_until_activation_and_reopens_on_restart(tmp_path, monkeypatch):
    root = tmp_path / "program"
    bundle = package(root)
    monkeypatch.setattr(run_release, "ROOT", root)
    directory = tmp_path / "data"
    directory.mkdir()
    monkeypatch.setenv("CABLESIM_DB", str(directory / "engineering.sqlite"))
    monkeypatch.setenv("CABLESIM_DATASETS_DIR", str(directory / "datasets"))
    monkeypatch.setenv("CABLESIM_REPRODUCTION_LIBRARY", str(directory / "library"))
    pending = {"build_id": bundle["build_id"], "previous": None}
    release_support.atomic_json(directory / "release-pending.json", pending)
    with TestClient(run_release.create_release_app()) as client:
        assert client.get("/api/health").json()["status"] == "ok"
        assert client.get("/api/release-info").json()["build_id"] == bundle["build_id"]
        assert 'id="root"' in client.get("/").text
        for response in (client.get("/api/workspaces"), client.post("/api/workspaces", json={})):
            assert response.status_code == 503
            assert response.json()["detail"]["code"] == "RELEASE_STARTING"
            assert response.headers["Retry-After"] == "1"
        with client.app.state.workspace_store.db() as database:
            assert database.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0] == 0
        run_release.activate(directory, bundle, pending)
        assert not (directory / "release-pending.json").exists()
        saved = client.post("/api/workspaces", json={})
        assert saved.status_code == 201, saved.text
        identifier = saved.json()["id"]
        assert [row["id"] for row in client.get("/api/workspaces").json()] == [identifier]
    # A normal restart of the activated release has no pending rollback window.
    with TestClient(run_release.create_release_app()) as client:
        assert [row["id"] for row in client.get("/api/workspaces").json()] == [identifier]
        assert client.post("/api/workspaces", json={}).status_code == 201


def loopback_address(host):
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    with socket.socket(family) as probe:
        try:
            probe.bind((host, 0))
        except OSError as error:
            if family == socket.AF_INET6 and error.errno in {
                errno.EAFNOSUPPORT, errno.EADDRNOTAVAIL, errno.EPROTONOSUPPORT, 10047, 10049,
            }:
                pytest.skip("IPv6 loopback is unavailable on this host")
            raise
        return family, probe.getsockname()[1]


@pytest.mark.parametrize("host", ["127.0.0.1", "::1"])
def test_release_server_restarts_immediately_after_requests(tmp_path, monkeypatch, host):
    """Real Uvicorn + release app; the server closes first to leave TIME_WAIT."""
    import uvicorn

    family, port = loopback_address(host)
    root = tmp_path / "program"
    package(root)
    monkeypatch.setattr(run_release, "ROOT", root)
    directory = tmp_path / "data"
    directory.mkdir()
    monkeypatch.setenv("CABLESIM_DB", str(directory / "engineering.sqlite"))
    monkeypatch.setenv("CABLESIM_DATASETS_DIR", str(directory / "datasets"))
    monkeypatch.setenv("CABLESIM_REPRODUCTION_LIBRARY", str(directory / "library"))
    for _ in range(2):
        # This is the production preflight, immediately after the previous stop.
        # A plain bind fails on POSIX while the served connections are TIME_WAIT.
        run_release.check_server_port(host, port)
        server = uvicorn.Server(uvicorn.Config(run_release.create_release_app(),
            host=host, port=port, log_level="error", access_log=False))
        thread = Thread(target=server.run, daemon=True)
        thread.start()
        try:
            deadline = time.monotonic() + 15
            while not server.started and thread.is_alive() and time.monotonic() < deadline:
                time.sleep(.01)
            assert server.started and thread.is_alive(), "release HTTP server did not start"
            for _ in range(8):
                with socket.socket(family) as connection:
                    connection.settimeout(5)
                    connection.connect((host, port))
                    connection.sendall(b"GET /api/health HTTP/1.1\r\nHost: localhost\r\n"
                                       b"Connection: close\r\n\r\n")
                    chunks = []
                    # Read the server's FIN before closing the client: otherwise
                    # TIME_WAIT can be on the client and the regression is missed.
                    while chunk := connection.recv(65536):
                        chunks.append(chunk)
                headers, separator, body = b"".join(chunks).partition(b"\r\n\r\n")
                assert separator and headers.startswith(b"HTTP/1.1 200 ")
                assert json.loads(body)["status"] == "ok"
        finally:
            server.should_exit = True
            thread.join(timeout=15)
            assert not thread.is_alive(), "release server did not stop gracefully"


@pytest.mark.parametrize("host", ["127.0.0.1", "::1"])
def test_release_port_probe_rejects_live_listener(host):
    family, port = loopback_address(host)
    with socket.socket(family) as listener:
        # Uvicorn enables reuse too; Windows preflight must still be exclusive.
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((host, port))
        listener.listen()
        with pytest.raises(OSError):
            run_release.check_server_port(host, port)


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


@pytest.mark.parametrize("conflict", ["release", "database"])
def test_rollback_refuses_queued_release_or_database_restore_without_changing_data(tmp_path, monkeypatch, conflict):
    from backend.kernel.database_ops import pending_path, snapshot
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
    state_path = directory / "release-state.json"
    release_support.atomic_json(state_path, {
        "active": {"build_id": "f" * 64, "app_dir": "next", "git_commit": "next"},
        "previous": {"build_id": bundle["build_id"], "app_dir": str(app), "git_commit": "first",
                     "backup": str(saved), "sha256": receipt["sha256"]}})
    if conflict == "release":
        pending = directory / "release-pending.json"
        release_support.atomic_json(pending, {"build_id": "c" * 64, "backup": str(saved), "sha256": receipt["sha256"]})
    else:
        from backend.main import create_app
        with TestClient(create_app(database)) as client:
            backup = client.post("/api/database/backups", json={"request_id": str(uuid4())})
            assert backup.status_code == 201, backup.text
            backup = backup.json()
            queued = client.post("/api/database/restores", json={"request_id": str(uuid4()),
                "backup_id": backup["id"], "sha256": backup["sha256"], "confirm_replace": True})
            assert queued.status_code == 202, queued.text
        pending = pending_path(database)
    database_before, state_before, pending_before = database.read_bytes(), state_path.read_bytes(), pending.read_bytes()
    with pytest.raises(RuntimeError, match="恢复"):
        run_release.rollback(directory)
    assert database.read_bytes() == database_before
    assert state_path.read_bytes() == state_before
    assert pending.read_bytes() == pending_before
    assert not list(Path(str(database) + ".snapshots").glob("before-restore-*.sqlite"))


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


def test_short_installation_directory_cannot_reuse_a_different_full_release_identity(tmp_path, monkeypatch):
    root = tmp_path / "bundle"
    bundle = package(root)
    directory = tmp_path / "data"
    app = release_support.installation(directory, bundle["build_id"])
    assert app.name == bundle["build_id"][:16]
    different = package(app, identity="different-complete-release")
    assert different["build_id"] != bundle["build_id"]
    with pytest.raises(RuntimeError, match="身份冲突"):
        install_release.install(root, {"data_dir": directory})
    assert release_support.manifest(app)["build_id"] == different["build_id"]
    python = release_support.python_path(app)
    python.parent.mkdir(parents=True)
    python.touch()
    configuration = tmp_path / "config.toml"
    configuration.write_text('[storage]\ndata_dir=' + json.dumps(str(directory)) + '\n', encoding="utf-8")
    monkeypatch.setattr(run_release, "ROOT", root)
    monkeypatch.setattr(sys, "argv", ["run_release.py", "--config", str(configuration)])
    with pytest.raises(RuntimeError, match="完整发行身份"):
        run_release.main()


def test_windows_path_preflight_uses_wheel_members_and_observed_policy(tmp_path):
    wheels = tmp_path / "wheelhouse"
    wheels.mkdir()
    with zipfile.ZipFile(wheels / "path_probe-1-py3-none-any.whl", "w") as archive:
        archive.writestr("package/" + "nested/" * 12 + "header.hpp", b"a real archive member")
        archive.writestr("package/module.py", b"value = 1\n")
    short = release_support.windows_path_policy(Path("C:/cs/programs/1234567890123456"), wheels, long_paths_enabled=False)
    assert short["longest_destination_characters"] + 16 <= 259
    long = Path("C:/Users") / ("long-project-" * 14) / "programs/1234567890123456"
    for enabled in (False, None):
        with pytest.raises(RuntimeError, match="较短路径"):
            release_support.windows_path_policy(long, wheels, long_paths_enabled=enabled)
    observed = release_support.windows_path_policy(long, wheels, long_paths_enabled=True)
    assert observed["long_paths_enabled"] is True
    assert observed["longest_destination_characters"] > 259


@pytest.mark.skipif(sys.platform != "linux", reason="Linux native loader and POSIX plugin interpreter")
def test_release_plugin_interpreter_restores_native_paths_after_environment_filtering(tmp_path, monkeypatch):
    app = tmp_path / "program"
    libraries = app / "runtime/linux-libs"
    libraries.mkdir(parents=True)
    shim = app / "scripts/release_python.sh"
    shim.parent.mkdir()
    shutil.copyfile(Path(release_support.__file__).with_name("release_python.sh"), shim)
    shim.chmod(0o755)
    python = release_support.python_path(app)
    python.parent.mkdir(parents=True)
    python.symlink_to(sys.executable)
    configuration = tmp_path / "release.toml"
    configuration.write_text('[storage]\ndata_dir="data"\n', encoding="utf-8")
    settings = release_support.config(configuration)
    monkeypatch.setenv("LD_LIBRARY_PATH", "/existing/library/path")
    environment = release_support.environment(settings, app)
    assert environment["LD_LIBRARY_PATH"] == str(libraries) + ":/existing/library/path"
    assert environment["CABLESIM_PLUGIN_PYTHON"] == str(shim)
    # The real plugin host intentionally strips LD_LIBRARY_PATH. The selected
    # executable must reestablish the fixed release path before Python starts.
    result = subprocess.run([str(shim), "-I", "-c", "import os;print(os.environ['LD_LIBRARY_PATH'])"],
                            env={"PATH": os.environ["PATH"]}, capture_output=True, text=True, check=True)
    assert result.stdout.strip() == str(libraries)


@pytest.mark.skipif(sys.platform != "linux", reason="Linux glibc compatibility contract")
def test_native_runtime_declared_glibc_requirement_is_checked_before_install(tmp_path):
    root = tmp_path / "bundle"
    package(root)
    (root / "runtime").mkdir()
    release_support.atomic_json(root / "runtime/native-manifest.json", {
        "format": "cablesim.native-runtime/1", "minimum_glibc": "999.0"})
    with pytest.raises(RuntimeError, match="glibc >= 999.0"):
        release_support.native_runtime_policy(root)


def test_shipped_default_keeps_data_outside_a_deep_extracted_archive(tmp_path):
    extracted = tmp_path / 'Downloads/CableSimPro-Windows/CableSimPro'
    extracted.mkdir(parents=True)
    configuration = extracted / 'release.toml'
    configuration.write_text(Path(release_support.__file__).with_name('release.toml').read_text('utf-8'), encoding='utf-8')
    assert release_support.config(configuration)['data_dir'] == (Path.home() / 'CableSimPro-data').resolve()
    configuration.write_text('', encoding='utf-8')
    assert release_support.config(configuration)['data_dir'] == (Path.home() / 'CableSimPro-data').resolve()
    configuration.write_text('[storage]\ndata_dir="../CableSimPro-data"\n', encoding='utf-8')
    assert release_support.config(configuration)['data_dir'] == extracted.parent / 'CableSimPro-data'


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
