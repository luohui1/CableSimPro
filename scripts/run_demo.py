"""Cross-platform local launcher. Python 3.11+; Node is only needed to build source."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen
import venv
import webbrowser

ROOT = Path(__file__).resolve().parents[1]


def run(command: list[str], cwd: Path = ROOT) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Start the CableSimPro local demo.")
    parser.add_argument("--host", default="127.0.0.1", help="Default: loopback only; no authentication is provided.")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--rebuild", action="store_true", help="Rebuild the frontend even if a dist bundle exists.")
    parser.add_argument("--skip-install", action="store_true", help="Use the current Python environment without installing dependencies.")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser automatically.")
    args = parser.parse_args()
    if sys.version_info < (3, 11):
        parser.error("Python 3.11 or later is required.")
    if not 1 <= args.port <= 65535:
        parser.error("Port must be between 1 and 65535.")
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print("WARNING: This demo has no authentication. Do not expose it to the public internet.", flush=True)

    python = sys.executable
    if not args.skip_install:
        env = ROOT / ".venv"
        python_path = env / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        if not python_path.is_file():
            print("Creating an isolated Python environment...", flush=True)
            venv.EnvBuilder(with_pip=True).create(env)
        python = str(python_path)
        run([python, "-m", "pip", "install", "-r", str(ROOT / "backend/requirements.txt")])

    frontend = ROOT / "frontend"
    if args.rebuild or not (frontend / "dist/index.html").is_file():
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
        if npm is None:
            raise RuntimeError("Node.js 22.12+ and npm are required to build source. Alternatively use the CI demo ZIP with its prebuilt frontend/dist.")
        run([npm, "ci" if (frontend / "package-lock.json").is_file() else "install", "--no-audit", "--no-fund"], cwd=frontend)
        run([npm, "run", "build"], cwd=frontend)

    browser_host = "127.0.0.1" if args.host == "0.0.0.0" else "[::1]" if args.host in ("::", "::1") else args.host
    url = f"http://{browser_host}:{args.port}"
    # Detect an existing responding service rather than opening an unrelated process.
    try:
        with urlopen(url + "/api/health", timeout=0.5):
            raise RuntimeError(f"A service is already responding at {url}; stop it or select a different --port.")
    except (URLError, TimeoutError, OSError):
        pass

    print(f"Starting CableSimPro at {url}\nPress Ctrl+C to stop. Projects are stored in .data/.", flush=True)
    process = subprocess.Popen([python, "-m", "uvicorn", "backend.main:app", "--host", args.host, "--port", str(args.port)], cwd=ROOT)
    try:
        ready = False
        for _ in range(150):
            if process.poll() is not None:
                return process.returncode or 1
            try:
                with urlopen(url + "/api/health", timeout=0.5) as response:
                    ready = json.load(response).get("status") == "ok"
                if ready:
                    break
            except (URLError, TimeoutError, OSError, ValueError):
                pass
            time.sleep(0.1)
        if not ready:
            raise RuntimeError("The server did not become ready. Inspect the Uvicorn messages above.")
        if not args.no_browser:
            webbrowser.open(url)
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
