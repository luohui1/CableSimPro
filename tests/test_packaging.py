import json
from pathlib import Path
import subprocess
import sys
import zipfile

import pytest

from scripts.package_demo import build_archive


def put(root: Path, relative: str, text: str = "demo") -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_packaging_requires_a_built_frontend(tmp_path):
    with pytest.raises(RuntimeError, match="Build frontend/dist"):
        build_archive(tmp_path)


def test_bundle_includes_app_but_excludes_private_runtime_files(tmp_path):
    put(tmp_path, "frontend/dist/index.html", "<h1>demo</h1>")
    put(tmp_path, "frontend/src/App.tsx")
    put(tmp_path, "backend/main.py")
    put(tmp_path, "scripts/run_demo.py")
    put(tmp_path, "README.md")
    put(tmp_path, ".data/cablesim.sqlite", "private")
    put(tmp_path, "backend/.env", "secret")
    put(tmp_path, "backend/projects.sqlite", "private")
    put(tmp_path, "backend/__pycache__/main.pyc", "cache")
    put(tmp_path, "frontend/node_modules/example/index.js", "dependency")
    put(tmp_path, "frontend/test-results/screenshot.png", "test output")
    archive_path = build_archive(tmp_path)
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        assert "CableSimPro/frontend/dist/index.html" in names
        assert "CableSimPro/backend/main.py" in names
        assert "CableSimPro/scripts/run_demo.py" in names
        assert not any(".sqlite" in name or ".env" in name or "node_modules" in name or "__pycache__" in name or "test-results" in name for name in names)
        info = json.loads(archive.read("CableSimPro/BUILD_INFO.json"))
        assert info["includes_prebuilt_frontend"] is True


def test_launcher_help_is_available_without_installation():
    root = Path(__file__).resolve().parents[1]
    response = subprocess.run([sys.executable, str(root / "scripts/run_demo.py"), "--help"], text=True, capture_output=True, check=False)
    assert response.returncode == 0
    assert "--skip-install" in response.stdout
    assert "--rebuild" in response.stdout
