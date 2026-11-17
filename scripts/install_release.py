"""Install a checked offline package without Node, network access or administrator rights."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import venv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.release_support import (InstallLock, MANIFEST, ROOT, atomic_json, config, digest,
                                    environment, installation, manifest, python_path, run_installed, safe_relative, utf8_output)


def install(source: Path, settings: dict) -> Path:
    bundle = manifest(source)
    directory = settings["data_dir"]
    if directory == source or source in directory.parents:
        raise RuntimeError("data_dir 必须位于解压目录之外，以便升级时保留工程和程序历史。")
    app = installation(directory, bundle["build_id"])
    receipt = directory / "installations" / (bundle["build_id"] + ".json")
    with InstallLock(directory / "release.lock"):
        if app.exists():
            manifest(app)
        else:
            app.mkdir(parents=True)
            try:
                for name in bundle["files"]:
                    relative = safe_relative(name)
                    output = app / relative
                    output.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source / relative, output)
                shutil.copy2(source / MANIFEST, app / MANIFEST)
                manifest(app)
            except BaseException:
                shutil.rmtree(app)
                raise
        python = python_path(app)
        if receipt.is_file() and python.is_file():
            saved = json.loads(receipt.read_text("utf-8"))
            if saved.get("requirements_sha256") == digest(app / "requirements.lock"):
                print("发行环境已安装并通过文件完整性检查。", flush=True)
                return app
        print("从随包 wheelhouse 离线安装 Python 依赖（包含 CAD 几何依赖）。", flush=True)
        if not python.is_file():
            venv.EnvBuilder(with_pip=True).create(app / ".venv")
        env = environment(settings, app)
        subprocess.run([str(python), "-m", "pip", "install", "--no-index", "--no-cache-dir",
                        "--disable-pip-version-check", "--require-hashes", "--find-links", str(app / "wheelhouse"),
                        "-r", str(app / "requirements.lock")], cwd=app, env=env, check=True)
        subprocess.run([str(python), "-m", "pip", "check"], cwd=app, env=env, check=True)
        subprocess.run([str(python), "-c", "import fastapi, numpy, scipy, reportlab, openpyxl, cadquery"],
                       cwd=app, env=env, check=True)
        atomic_json(receipt, {"build_id": bundle["build_id"], "app_dir": str(app),
                              "requirements_sha256": digest(app / "requirements.lock"), "offline": True})
        return app


def main() -> int:
    utf8_output()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / "release.toml")
    parser.add_argument("--no-start", action="store_true", help="Install and verify only")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    settings = config(args.config)
    app = install(ROOT, settings)
    print(json.dumps({"status": "installed", "app_dir": str(app), "python": str(python_path(app)),
                      "data_dir": str(settings["data_dir"])}, ensure_ascii=False), flush=True)
    if args.no_start:
        return 0
    command = [str(python_path(app)), str(app / "scripts/run_release.py"), "--config", str(settings["path"])]
    if args.no_browser:
        command.append("--no-browser")
    return run_installed(command, app=app, env=environment(settings, app))


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(0)
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print("发行安装失败：" + str(error), file=sys.stderr)
        raise SystemExit(1)
