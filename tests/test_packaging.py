from pathlib import Path
import subprocess
import sys

import pytest

from scripts.build_release import copy_sources


def put(root: Path, relative: str, text: str = "demo") -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_bundle_includes_app_but_excludes_private_runtime_files(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    tracked = (
        "backend/main.py", "backend/__init__.py", "cablesim_sdk/__init__.py",
        "plugin-spec/schemas/plugin-manifest.schema.json",
        "plugins/cablesim.thermal-network/plugin.json",
        "plugins/cablesim.thermal-network/src/cablesim_thermal_network/main.py",
    )
    for name in tracked:
        put(source, name)
    subprocess.run(["git", "init", "--quiet", str(source)], check=True)
    subprocess.run(["git", "add", "--", *tracked], cwd=source, check=True)
    supporting = (
        "scripts/release_support.py", "scripts/install_release.py", "scripts/run_release.py",
        "scripts/workspace_db.py", "scripts/release_python.sh", "scripts/release.toml",
        "scripts/start_release.sh", "scripts/start_release.cmd",
        "scripts/release_python_runtime.py", "scripts/python_runtime.lock.json",
        "scripts/release_node_runtime.py", "scripts/node_runtime.lock.json",
        "frontend/scripts/seed-engineering-demo.py", "frontend/scripts/engineering_resources.py",
        "design/tokens.css", "docs/architecture/release-installation.md",
        "docs/architecture/database-operations.md",
    )
    for name in supporting:
        put(source, name)
    # These realistic local files must never enter the immutable program payload.
    for name in (".data/cablesim.sqlite", "backend/.env", "backend/projects.sqlite",
                 "backend/__pycache__/main.pyc", "plugins/node_modules/example/index.js",
                 "backend/private_customer_report.pdf", "frontend/.env.local"):
        put(source, name, "private")
    destination = tmp_path / "payload"
    destination.mkdir()
    copy_sources(source, destination)
    names = {path.relative_to(destination).as_posix() for path in destination.rglob("*") if path.is_file()}
    assert set(tracked) <= names
    assert {"scripts/install_release.py", "scripts/run_release.py", "scripts/release_python.sh",
            "frontend/scripts/seed-engineering-demo.py", "design/tokens.css",
            "release.toml", "start.sh", "start.cmd",
            "scripts/release_python_runtime.py", "scripts/python_runtime.lock.json",
            "scripts/release_node_runtime.py", "scripts/node_runtime.lock.json"} <= names
    assert not any(".sqlite" in name or ".env" in name or "node_modules" in name
                   or "__pycache__" in name or "private_customer_report" in name for name in names)


def test_launcher_help_is_available_without_installation():
    root = Path(__file__).resolve().parents[1]
    response = subprocess.run([sys.executable, str(root / "scripts/run_demo.py"), "--help"], text=True, capture_output=True, check=False)
    assert response.returncode == 0
    assert "--skip-install" in response.stdout


@pytest.mark.parametrize(("script", "option"), (
    ("build_release.py", "--frontend-dist"),
    ("install_release.py", "--no-start"),
    ("run_release.py", "--rollback"),
))
def test_release_entrypoint_help_needs_only_standard_library(script, option):
    root = Path(__file__).resolve().parents[1]
    response = subprocess.run([sys.executable, "-S", str(root / "scripts" / script), "--help"],
                              text=True, capture_output=True, check=False)
    assert response.returncode == 0, response.stderr
    assert option in response.stdout


def test_release_manifest_preserves_posix_case_distinct_payloads(tmp_path):
    from scripts.build_release import payload_files
    put(tmp_path, "runtime/python/share/terminfo/a/ansi", "lower")
    put(tmp_path, "runtime/python/share/terminfo/A/apple", "upper")
    put(tmp_path, "runtime/python/LICENSE", "license")
    put(tmp_path, "release.toml", "user-editable")
    files = payload_files(tmp_path, platform_name="linux")
    assert len(files) == 3
    assert files["runtime/python/share/terminfo/a/ansi"]["size_bytes"] == 5
    assert files["runtime/python/share/terminfo/A/apple"]["size_bytes"] == 5
    assert "release.toml" not in files


def test_release_manifest_rejects_windows_parent_alias(tmp_path):
    from scripts.build_release import payload_files
    put(tmp_path, "runtime/python/Lib/a.py")
    put(tmp_path, "runtime/python/lib/b.py")
    with pytest.raises(RuntimeError, match="Windows release path aliases"):
        payload_files(tmp_path, platform_name="win32")


def test_release_manifest_shared_parents_are_not_duplicates(tmp_path):
    from scripts.build_release import payload_files
    for name in ("LICENSE", "LICENSE.APACHE", "LICENSE.BSD", "METADATA"):
        put(tmp_path, "runtime/python/Lib/site-packages/packaging.dist-info/" + name)
    assert len(payload_files(tmp_path, platform_name="win32")) == 4
    assert len(payload_files(tmp_path, platform_name="linux")) == 4
