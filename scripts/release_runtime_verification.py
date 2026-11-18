"""Evidence checks for the real public launchers, not a substitute interpreter."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


ABSENT_COMMANDS = ("python", "python3", "python3.12", "py", "pip", "pip3", "node", "npm")


def public_command(root: Path, configuration: Path) -> list[str]:
    """Call from cwd=root; cmd's script token never needs nested quoting."""
    if os.name == "nt":
        shell = Path(os.environ["SystemRoot"]) / "System32/cmd.exe"
        return [str(shell), "/d", "/c", "start.cmd", "--config", str(configuration), "--no-browser"]
    return ["/bin/sh", str(root / "start.sh"), "--config", str(configuration), "--no-browser"]


def assert_no_system_interpreters(environment: dict[str, str]) -> dict:
    observed = {name: shutil.which(name, path=environment["PATH"]) for name in ABSENT_COMMANDS}
    if any(observed.values()):
        raise RuntimeError("Acceptance child still discovers a system interpreter: " + repr(observed))
    return {"path": environment["PATH"], "commands": observed,
            "scope": "installation and application child PATH; the evidence driver is separate"}


def base_python(root: Path) -> Path:
    metadata = json.loads((root / "runtime/python-runtime.json").read_text("utf-8"))
    relative = "runtime/python/" + ("python.exe" if os.name == "nt" else "bin/python3.12")
    if metadata.get("format") != "cablesim.python-runtime/1" or metadata.get("executable") != relative:
        raise RuntimeError("Release does not declare its expected bundled Python")
    return root / relative


def bundled_node(root: Path) -> Path:
    """The Node.js the release declares for its Agent sidecar; the acceptance PATH never holds another."""
    metadata = json.loads((root / "runtime/node-runtime.json").read_text("utf-8"))
    relative = "runtime/node/" + ("node.exe" if os.name == "nt" else "bin/node")
    if metadata.get("format") != "cablesim.node-runtime/1" or metadata.get("executable") != relative:
        raise RuntimeError("Release does not declare its expected bundled Node.js")
    return root / relative


def bundled_base_is_local(root: Path, reported: str, metadata: dict) -> bool:
    """A venv can report bin/python while the locked launcher is bin/python3.12.

    Both must remain inside the immutable installed runtime; disallow arbitrary
    external interpreters, including symlinks that escape the install prefix.
    """
    locked = base_python(root).resolve()
    actual = Path(reported).resolve()
    prefix = (root / "runtime/python").resolve()
    if not locked.is_file() or not actual.is_file():
        return False
    if os.name == "nt":
        return actual == locked
    major, minor, *_ = metadata["version"].split(".")
    return (actual.parent == prefix / "bin"
            and actual.name in {"python", "python" + major, "python" + major + "." + minor})


def runtime_identity(root: Path, environment: dict[str, str]) -> dict:
    """Observe the actual venv's executable, base, stdlib and native imports."""
    interpreter = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    source = (
        "import json,sys,sysconfig,ssl,sqlite3,ctypes,fastapi,numpy,scipy,reportlab,openpyxl;"
        "print(json.dumps({'executable':sys.executable,'base_executable':sys._base_executable,"
        "'base_prefix':sys.base_prefix,'prefix':sys.prefix,'stdlib':sysconfig.get_path('stdlib'),"
        "'version':list(sys.version_info[:3]),'openssl':ssl.OPENSSL_VERSION,"
        "'sqlite':sqlite3.sqlite_version}))"
    )
    result = subprocess.run([str(interpreter), "-I", "-B", "-c", source], env=environment,
                            cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=90, check=True)
    observed = json.loads(result.stdout)
    prefix = (root / "runtime/python").resolve()
    metadata = json.loads((root / "runtime/python-runtime.json").read_text("utf-8"))
    if (Path(observed["executable"]).resolve() != interpreter.resolve()
            or not bundled_base_is_local(root, observed["base_executable"], metadata)
            or Path(observed["base_prefix"]).resolve() != prefix
            or Path(observed["prefix"]).resolve() != (root / ".venv").resolve()
            or prefix not in Path(observed["stdlib"]).resolve().parents
            or observed["version"] != [int(part) for part in metadata["version"].split(".")]):
        raise RuntimeError("Application venv depends on a Python outside its installed runtime: " + repr(observed))
    observed["upstream"] = metadata
    observed["evidence_driver"] = sys.executable
    observed["uses_evidence_driver"] = Path(sys.executable).resolve() == interpreter.resolve()
    if observed["uses_evidence_driver"]:
        raise RuntimeError("The acceptance driver must not masquerade as the installed application")
    observed["discovery"] = assert_no_system_interpreters(environment)
    return observed
