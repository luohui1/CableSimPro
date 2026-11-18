"""Run an installed release, preserve engineering data and supervise companion processes."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener
from uuid import uuid4
import webbrowser

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.release_support import (InstallLock, ROOT, atomic_json, config, environment, installation,
                                    manifest, native_runtime_policy, python_path, run_installed, utf8_output)


def create_release_app():
    """Serve the built SPA; API paths and missing assets must retain their real 404."""
    from backend.main import create_app
    from starlette.exceptions import HTTPException
    from starlette.responses import JSONResponse
    from starlette.staticfiles import StaticFiles

    pending = Path(os.environ["CABLESIM_DB"]).resolve().parent / "release-pending.json"

    class StartupGate:
        """An uncommitted release cannot accept engineering writes before rollback ends."""

        def __init__(self, app):
            self.app = app

        async def __call__(self, scope, receive, send):
            path = scope.get("path", "")
            health = scope.get("method") in {"GET", "HEAD"} and path in {"/api/health", "/api/release-info"}
            if scope["type"] == "http" and (path == "/api" or path.startswith("/api/")) and not health:
                try:
                    pending.stat()
                    starting = True
                except FileNotFoundError:
                    starting = False
                except OSError:
                    starting = True  # Cannot authenticate release readiness: fail closed.
                if starting:
                    response = JSONResponse({"detail": {"code": "RELEASE_STARTING", "message":
                        "发行版本正在启动并核验数据，请等待启动检查完成后重试。"}},
                        status_code=503, headers={"Retry-After": "1"})
                    await response(scope, receive, send)
                    return
            await self.app(scope, receive, send)

    class Frontend(StaticFiles):
        async def get_response(self, path, scope):
            path = path.replace("\\", "/")
            if path in {"api", "gallery"} or path.startswith(("api/", "gallery/")):
                raise HTTPException(404)
            try:
                return await super().get_response(path, scope)
            except HTTPException as error:
                suffix = Path(path).suffix.lower()
                assets = {".js", ".mjs", ".css", ".map", ".json", ".svg", ".png", ".jpg", ".jpeg",
                          ".webp", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".wasm", ".mp4", ".txt", ".pdf"}
                if error.status_code != 404 or suffix in assets or path.startswith("assets/"):
                    raise
                return await super().get_response("index.html", scope)

    value = manifest(ROOT, check_files=False)
    app = create_app(os.environ["CABLESIM_DB"])
    app.add_middleware(StartupGate)
    app.router.routes = [route for route in app.routes if getattr(route, "path", None) != "/"]

    @app.get("/api/release-info", response_model=dict[str, str])
    def release_info():
        return {"build_id": value["build_id"], "git_commit": value["git_commit"]}

    # create_app already installs an unknown-API catch-all. Keep this appended
    # release endpoint before it rather than accidentally returning its 404.
    route = app.router.routes.pop()
    position = next(index for index, item in enumerate(app.router.routes)
                    if getattr(item, "path", None) == "/api/{path:path}")
    app.router.routes.insert(position, route)
    app.mount("/", Frontend(directory=str(ROOT / "frontend/dist"), html=True), name="frontend")
    return app


@contextmanager
def database_owner(database: Path):
    from backend.kernel.ownership import OwnerLock
    owner = OwnerLock(database)
    try:
        owner.acquire()
        yield
    finally:
        owner.close()


def read_state(directory: Path) -> dict:
    path = directory / "release-state.json"
    return json.loads(path.read_text("utf-8")) if path.is_file() else {}


def recover_pending(directory: Path) -> None:
    """An interrupted pre-health upgrade is recovered before another host is started."""
    pending = directory / "release-pending.json"
    if not pending.is_file():
        return
    record = json.loads(pending.read_text("utf-8"))
    state = read_state(directory)
    if state.get("active", {}).get("build_id") == record["build_id"]:
        pending.unlink()
        return
    if record.get("backup"):
        from backend.kernel.database_ops import apply_restore
        with database_owner(directory / "engineering.sqlite"):
            apply_restore(directory / "engineering.sqlite", Path(record["backup"]), record["sha256"])
        print("已恢复未完成升级之前的工程库快照。", flush=True)
    elif (directory / "engineering.sqlite").exists():
        # No earlier snapshot exists for a failed first boot. Preserve every byte
        # and refuse to silently treat a partial initial DB as a healthy product DB.
        atomic_json(directory / "release-initialization-failed.json", {
            "build_id": record["build_id"], "database": str(directory / "engineering.sqlite"),
            "reason": "首次启动未通过健康检查；工程库已保留，须检查并恢复后再启动。"})
    pending.unlink()


def prepare_upgrade(directory: Path, bundle: dict) -> dict | None:
    """Use the existing read-only version gate before any schema write."""
    from backend.kernel.database_ops import check_existing, pending_path, snapshot
    database = directory / "engineering.sqlite"
    if (directory / "release-initialization-failed.json").exists():
        raise RuntimeError("首次启动未完成，已保留工程库与 release-initialization-failed.json；"
                           "请检查日志和数据库，完成恢复后再移除该失败标记。")
    previous = read_state(directory)
    with database_owner(database):
        check_existing(database)
        if previous.get("active", {}).get("build_id") == bundle["build_id"]:
            return None
        if pending_path(database).exists():
            raise RuntimeError("工程库有待重启恢复请求；请先用当前版本完成或取消恢复，再升级。")
        record = {"build_id": bundle["build_id"], "previous": previous.get("active")}
        if database.exists():
            name = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex + ".sqlite"
            backup = directory / "release-snapshots" / name
            receipt = snapshot(database, backup)
            record.update(backup=str(backup), sha256=receipt["sha256"])
            print("升级前工程库已通过 SQLite 在线备份与 SHA256 校验：" + str(backup), flush=True)
        atomic_json(directory / "release-pending.json", record)
        return record


def initialize_examples(directory: Path, settings: dict) -> None:
    database = directory / "engineering.sqlite"
    # seed_release deliberately replaces changed demo identities. That behavior
    # remains unchanged for run_demo, and is NEVER applied to an existing product DB.
    if database.exists() or not settings["initialization"]["seed_examples"]:
        return
    spec = importlib.util.spec_from_file_location("release_seed", ROOT / "frontend/scripts/seed-engineering-demo.py")
    seed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(seed)
    seed.seed_release(database)


def activate(directory: Path, bundle: dict, pending: dict | None) -> None:
    previous = read_state(directory)
    active = {"build_id": bundle["build_id"], "app_dir": str(ROOT), "git_commit": bundle["git_commit"]}
    state = {**previous, "active": active}
    if pending:
        state["previous"] = ({**pending["previous"], "backup": pending.get("backup"),
                               "sha256": pending.get("sha256")} if pending.get("previous") else None)
    atomic_json(directory / "release-state.json", state)
    (directory / "release-pending.json").unlink(missing_ok=True)


def rollback(directory: Path) -> Path:
    """Explicitly restore both the previous immutable program and its database snapshot."""
    from backend.kernel.database_ops import apply_restore, pending_path
    state = read_state(directory)
    previous = state.get("previous")
    if not previous or not previous.get("backup"):
        raise RuntimeError("没有可回退的已运行版本和升级前快照。")
    app = installation(directory, previous["build_id"])
    # Retain read/rollback compatibility with earlier 64-character directories;
    # all newly installed releases use the shorter, fully authenticated identity.
    if not app.exists():
        older_layout = directory / "programs" / previous["build_id"]
        if older_layout.is_dir():
            app = older_layout
    bundle = manifest(app)
    if bundle["build_id"] != previous["build_id"]:
        raise RuntimeError("回退程序目录与记录的完整发行身份不一致；工程库未改动。")
    if not python_path(app).is_file():
        raise RuntimeError("上一发行环境缺失；工程库未改动。")
    with database_owner(directory / "engineering.sqlite"):
        if (directory / "release-pending.json").exists():
            raise RuntimeError("有尚未完成的发行升级；请先正常启动完成恢复，再执行版本回退。")
        if pending_path(directory / "engineering.sqlite").exists():
            raise RuntimeError("工程库有已排队的恢复请求；请先完成或取消该请求，再执行版本回退。")
        result = apply_restore(directory / "engineering.sqlite", previous["backup"], previous["sha256"])
    atomic_json(directory / "release-state.json", {
        "active": {"build_id": bundle["build_id"], "app_dir": str(app), "git_commit": bundle["git_commit"]},
        "previous": None,
        "rollback_safety_snapshot": result["safety_snapshot"],
    })
    # The rescued post-upgrade data are preserved for manual recovery. Do not
    # offer a second automatic rollback without a recorded matching digest.
    return app


def spawn(command: list[str], *, cwd: Path, env: dict) -> subprocess.Popen:
    options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
    return subprocess.Popen(command, cwd=cwd, env=env, **options)


_windows_job = None


def own_windows_tree() -> None:
    """Own descendants in a kill-on-close job even after their immediate parent exits."""
    global _windows_job
    if os.name != "nt" or _windows_job is not None:
        return
    import ctypes
    from ctypes import wintypes
    from backend.plugin_host.process import ExtendedLimits, checked, kernel_api
    api = kernel_api()
    api.GetCurrentProcess.argtypes, api.GetCurrentProcess.restype = [], wintypes.HANDLE
    api.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    api.AssignProcessToJobObject.restype = wintypes.BOOL
    job = checked(api.CreateJobObjectW(None, None))
    try:
        limits = ExtendedLimits()
        limits.basic.flags = 0x2000
        checked(api.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)))
        checked(api.AssignProcessToJobObject(job, api.GetCurrentProcess()))
    except BaseException:
        api.CloseHandle(job)
        raise
    # The non-inherited handle remains alive until launcher exit, when the OS
    # closes it and also terminates any orphaned grandchildren.
    _windows_job = job


def stop_process(process: subprocess.Popen) -> None:
    """Terminate the whole owned process group, including companion child processes."""
    if os.name == "nt":
        if process.poll() is None:
            try:
                process.send_signal(signal.CTRL_BREAK_EVENT)
                process.wait(timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    if process.poll() is None:
        process.wait(timeout=10)


def companions(settings: dict, env: dict) -> list[tuple[subprocess.Popen, bool, str]]:
    substitutions = {"{python}": str(python_path(ROOT)), "{app_dir}": str(ROOT), "{data_dir}": str(settings["data_dir"])}

    def expand(value):
        for token, replacement in substitutions.items():
            value = value.replace(token, replacement)
        return value

    result = []
    try:
        for item in settings["processes"]:
            cwd = Path(expand(item.get("cwd", ".")))
            if not cwd.is_absolute():
                cwd = settings["path"].parent / cwd
            command = [expand(arg) for arg in item["command"]]
            process_env = {**env, **{key: expand(value) for key, value in item.get("env", {}).items()}}
            result.append((spawn(command, cwd=cwd, env=process_env), item.get("required", True), item["name"]))
        return result
    except BaseException:
        for process, _, _ in reversed(result):
            stop_process(process)
        raise


def check_server_port(host: str, port: int) -> None:
    """Reject a live listener before preparing an upgrade or touching the DB."""
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    with socket.socket(family) as probe:
        if os.name == "nt":
            # Windows SO_REUSEADDR can also admit an occupied listening port.
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            # Match Uvicorn's bind policy after graceful shutdown: completed
            # requests can leave server-side TIME_WAIT on this same port.
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind((host, port))


def serve(settings: dict, bundle: dict, no_browser: bool) -> int:
    directory = settings["data_dir"]
    server = settings["server"]
    env = environment(settings, ROOT)
    os.environ.update(env)
    own_windows_tree()
    check_server_port(server["host"], server["port"])
    recover_pending(directory)
    pending = prepare_upgrade(directory, bundle)
    processes = []
    healthy = False
    previous_handlers = {}

    def interrupted(_signum, _frame):
        raise KeyboardInterrupt

    for signum in (signal.SIGINT, signal.SIGTERM, *((signal.SIGBREAK,) if os.name == "nt" else ())):
        previous_handlers[signum] = signal.signal(signum, interrupted)
    try:
        initialize_examples(directory, settings)
        process = spawn([str(python_path(ROOT)), "-m", "uvicorn", "scripts.run_release:create_release_app", "--factory",
                         "--host", server["host"], "--port", str(server["port"])], cwd=ROOT, env=env)
        processes.append((process, True, "CableSimPro"))
        processes.extend(companions(settings, env))
        browser_host = "127.0.0.1" if server["host"] in {"0.0.0.0", "localhost"} else (
            "[::1]" if server["host"] in {"::", "::1"} else server["host"])
        url = f"http://{browser_host}:{server['port']}"
        opener = build_opener(ProxyHandler({}))
        deadline = time.monotonic() + server["startup_timeout_seconds"]
        ready = False
        while time.monotonic() < deadline:
            failed = next((name for child, required, name in processes if required and child.poll() is not None), None)
            if failed:
                raise RuntimeError("必需进程在健康检查前退出：" + failed)
            try:
                with opener.open(url + "/api/health", timeout=1) as response:
                    ok = json.load(response).get("status") == "ok"
                with opener.open(url + "/api/release-info", timeout=1) as response:
                    ok = ok and json.load(response).get("build_id") == bundle["build_id"]
                with opener.open(url + "/", timeout=1) as response:
                    ok = ok and response.status == 200 and b'id="root"' in response.read()
                if ok:
                    ready = True
                    break
            except (URLError, TimeoutError, OSError, ValueError):
                pass
            time.sleep(.2)
        if not ready:
            raise RuntimeError("发行服务未在配置时间内通过 API 与前端健康检查。")
        activate(directory, bundle, pending)
        healthy = True
        print(json.dumps({"status": "ready", "url": url + "/", "build_id": bundle["build_id"],
                          "data_dir": str(directory)}, ensure_ascii=False), flush=True)
        if server["open_browser"] and not no_browser:
            webbrowser.open(url + "/")
        while True:
            for child, required, name in processes:
                if required and child.poll() is not None:
                    if child is process:
                        return child.returncode or 0
                    raise RuntimeError("必需伴随进程已退出：" + name)
            time.sleep(.2)
    except KeyboardInterrupt:
        return 0
    finally:
        for child, _, _ in reversed(processes):
            stop_process(child)
        # Only pre-health startup may roll back. After healthy, the app can
        # accept user writes and must never discard them because a process exits.
        if not healthy and pending:
            recover_pending(directory)
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)


def main() -> int:
    utf8_output()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--rollback", action="store_true", help="Restore the previous release and its pre-upgrade database snapshot")
    args = parser.parse_args()
    settings = config(args.config)
    bundle = manifest(ROOT)
    native_runtime_policy(ROOT)
    app = installation(settings["data_dir"], bundle["build_id"])
    if not app.exists() and ROOT == settings["data_dir"] / "programs" / bundle["build_id"]:
        app = ROOT  # A retained older-layout program can still be restarted.
    python = python_path(app)
    if not python.is_file():
        raise RuntimeError("发行环境尚未安装；请先运行 scripts/install_release.py。")
    if manifest(app, check_files=False)["build_id"] != bundle["build_id"]:
        raise RuntimeError("安装目录与请求的完整发行身份不一致；已拒绝启动。")
    if app != ROOT or Path(sys.prefix).resolve() != (app / ".venv").resolve():
        command = [str(python), str(app / "scripts/run_release.py"), "--config", str(settings["path"])]
        command.extend(flag for flag, enabled in (("--no-browser", args.no_browser), ("--rollback", args.rollback)) if enabled)
        return run_installed(command, app=app, env=environment(settings, app))
    with InstallLock(settings["data_dir"] / "release.lock"):
        if args.rollback:
            previous = rollback(settings["data_dir"])
        else:
            return serve(settings, bundle, args.no_browser)
    command = [str(python_path(previous)), str(previous / "scripts/run_release.py"), "--config", str(settings["path"])]
    if args.no_browser:
        command.append("--no-browser")
    return run_installed(command, app=previous, env=environment(settings, previous))


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(0)
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print("发行启动失败：" + str(error), file=sys.stderr)
        raise SystemExit(1)
