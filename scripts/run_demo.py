"""Build and launch the release demo on one port. Requires Python 3.11+ and Node 22.12+."""
from __future__ import annotations

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen
import venv
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / ".data/release"
CAD_PREPARE = "python frontend/src/features/cad/native/prepare.py --jobs 4"


def run(command: list[str], cwd: Path = ROOT, env: dict | None = None) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, env=env, check=True)


def release_environment() -> dict[str, str]:
    """Never inherit a development/test database or dataset directory."""
    return {**os.environ, "CABLESIM_DB": str(RELEASE / "engineering.sqlite"),
            "CABLESIM_DATASETS_DIR": str(RELEASE / "datasets"),
            "CABLESIM_REPRODUCTION_LIBRARY": str(RELEASE / "library"),
            "CABLESIM_FRONTEND_DIST": str(RELEASE / "frontend"),
            "NODE_ENV": "production",
            "PYTHONUTF8": "1"}


def require_cad_assets() -> None:
    """Check preparation output before building; Vite also verifies hashes."""
    cache = ROOT / "frontend/src/features/cad/node_modules/.cache/cablesim-occt"
    missing = [name for name in ("build.json", "occt-viewer.js", "occt-viewer.wasm",
                                "LICENSE_LGPL_21.txt", "OCCT_LGPL_EXCEPTION.txt")
               if not (cache / name).is_file()]
    if missing:
        raise RuntimeError("OCCT 发布资产缺失：" + ", ".join(missing)
                           + "\n请在仓库根目录运行：\n" + CAD_PREPARE
                           + "\n完成后重新运行 python scripts/run_demo.py。")


def create_release_app():
    """API routes win; only frontend navigation falls back to the SPA entry."""
    from backend.main import create_app
    from starlette.exceptions import HTTPException
    from starlette.staticfiles import StaticFiles

    # Only real asset suffixes are files; ids such as /plugins/cablesim.iec60287 are page routes.
    asset_suffixes = {".js", ".mjs", ".css", ".map", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico",
                      ".woff", ".woff2", ".ttf", ".wasm", ".mp4", ".txt", ".pdf"}

    class Frontend(StaticFiles):
        async def get_response(self, path, scope):
            path = path.replace("\\", "/")
            if path in ("api", "gallery") or path.startswith(("api/", "gallery/")):
                raise HTTPException(404)
            try:
                return await super().get_response(path, scope)
            except HTTPException as error:
                if error.status_code != 404 or Path(path).suffix.lower() in asset_suffixes or path.startswith("assets/"):
                    raise
                return await super().get_response("index.html", scope)

    app = create_app(os.environ.get("CABLESIM_DB", str(RELEASE / "engineering.sqlite")))
    app.router.routes = [route for route in app.routes if getattr(route, "path", None) != "/"]
    app.mount("/", Frontend(directory=os.environ.get("CABLESIM_FRONTEND_DIST", str(RELEASE / "frontend")), html=True), name="frontend")
    return app


def main() -> int:
    started = time.monotonic()
    parser = argparse.ArgumentParser(description="Start the CableSimPro local demo.")
    parser.add_argument("--host", default="127.0.0.1", help="Default: loopback only; no authentication is provided.")
    parser.add_argument("--port", type=int, default=8100)
    parser.add_argument("--skip-install", action="store_true", help="Use current Python and installed frontend dependencies.")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser automatically.")
    args = parser.parse_args()
    if sys.version_info < (3, 11):
        parser.error("Python 3.11 or later is required.")
    if not 1 <= args.port <= 65535:
        parser.error("Port must be between 1 and 65535.")
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print("WARNING: This demo has no authentication. Do not expose it to the public internet.", flush=True)

    # Check the socket before building or seeding. Never open an unrelated service.
    with socket.socket(socket.AF_INET6 if ":" in args.host else socket.AF_INET) as probe:
        probe.bind((args.host, args.port))
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        raise RuntimeError("Node.js/npm is required. Install Node 22.12+ and rerun this command.")
    environment = release_environment()
    python = sys.executable
    run([python, str(ROOT / "frontend/src/features/cad/native/prepare.py"), "--jobs", "4"],
        cwd=ROOT, env=environment)
    require_cad_assets()
    if not args.skip_install:
        env = RELEASE / "venv"
        python_path = env / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        if not python_path.is_file():
            print("Creating an isolated Python environment...", flush=True)
            venv.EnvBuilder(with_pip=True).create(env)
        python = str(python_path)
        requirements = ROOT / "backend/requirements.txt"
        fingerprint = sha256(requirements.read_bytes()).hexdigest()
        installed = env / "requirements.sha256"
        if not installed.is_file() or installed.read_text(encoding="ascii") != fingerprint:
            run([python, "-m", "pip", "install", "-r", str(requirements)], env=environment)
            installed.write_text(fingerprint, encoding="ascii")
        frontend = ROOT / "frontend"
        if not (frontend / "node_modules").is_dir():
            run([npm, "ci", "--no-audit", "--no-fund"], cwd=frontend, env=environment)
        elif subprocess.run([npm, "ls", "--depth=0"], cwd=frontend, env=environment,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
            # npm ci deletes node_modules first and conflicts with a live Vite
            # process holding native libraries on Windows. Repair in place.
            run([npm, "install", "--no-package-lock", "--no-audit", "--no-fund"], cwd=frontend, env=environment)

    run([npm, "run", "build:release", "--", "--outDir", str(RELEASE / "frontend"), "--emptyOutDir", "--logLevel", "warn"], cwd=ROOT / "frontend", env=environment)
    print("Checking release plugin/model versions; changed data is backed up under "
          + str(RELEASE / "backups") + " before replacement.", flush=True)
    run([python, str(ROOT / "frontend/scripts/seed-engineering-demo.py"), "--release",
         "--database", str(RELEASE / "engineering.sqlite")], env=environment)

    browser_host = "127.0.0.1" if args.host == "0.0.0.0" else "[::1]" if args.host in ("::", "::1") else args.host
    url = f"http://{browser_host}:{args.port}"
    print(f"Starting CableSimPro at {url}/\nPress Ctrl+C to stop. Demo data: {RELEASE}", flush=True)
    process = subprocess.Popen([python, "-m", "uvicorn", "scripts.run_demo:create_release_app", "--factory",
                                "--host", args.host, "--port", str(args.port)], cwd=ROOT, env=environment)
    try:
        ready = False
        for _ in range(150):
            if process.poll() is not None:
                return process.returncode or 1
            try:
                with urlopen(url + "/api/health", timeout=0.5) as response:
                    ready = json.load(response).get("status") == "ok"
                if ready:
                    with urlopen(url + "/", timeout=1) as response:
                        ready = response.status == 200 and b'id="root"' in response.read()
                    if ready:
                        break
            except (URLError, TimeoutError, OSError, ValueError):
                pass
            time.sleep(0.1)
        if not ready:
            raise RuntimeError("The server did not become ready. Inspect the Uvicorn messages above.")
        print(f"Homepage ready: {url}/ ({time.monotonic() - started:.2f} s from launch)", flush=True)
        if not args.no_browser:
            opened = webbrowser.open(url + "/")
            print("Browser open requested." if opened else f"Open {url}/ in your browser.", flush=True)
        return process.wait()
    except KeyboardInterrupt:
        return 0
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print(f"Startup failed: {error}", file=sys.stderr)
        raise SystemExit(1)
