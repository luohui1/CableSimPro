"""Prepare a CI evidence interpreter from the release ZIP, never setup-python.

The builder may execute this stdlib-only preparation step. The later isolated
installation gate executes this bundle's interpreter, and installs a *different*
fresh copy through the public launcher. Inspection dependencies are a hash-locked
subset of the shipped wheels, installed offline before OS network isolation.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

if __package__:
    from .release_python_runtime import clean_python_environment, create_environment, installed_base_python
    from .verify_installation import extract_release
else:
    from release_python_runtime import clean_python_environment, create_environment, installed_base_python
    from verify_installation import extract_release


INSPECTION_PACKAGES = {"pymupdf", "pymupdfb", "openpyxl", "et-xmlfile", "pillow"}


def prepare(archive: Path, directory: Path) -> Path:
    if directory.exists():
        raise RuntimeError("Evidence environment already exists; use a fresh directory")
    directory.mkdir(parents=True)
    root = extract_release(archive, directory)
    base = installed_base_python(root)
    environment = clean_python_environment()
    environment["PIP_NO_INDEX"] = "1"
    create_environment(root, environment)
    python = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    locks = []
    for line in (root / "requirements.lock").read_text("utf-8").splitlines():
        name = re.sub(r"[-_.]+", "-", line.split("==")[0]).lower()
        if name in INSPECTION_PACKAGES:
            locks.append(line)
    present = {re.sub(r"[-_.]+", "-", line.split("==")[0]).lower() for line in locks}
    if not {"pymupdf", "openpyxl", "pillow", "et-xmlfile"} <= present:
        raise RuntimeError("The release lacks hash-locked evidence inspection dependencies")
    lock = directory / "inspection.lock"
    lock.write_text("\n".join(locks) + "\n", encoding="utf-8")
    subprocess.run([str(python), "-I", "-B", "-m", "pip", "install", "--no-index", "--no-cache-dir",
                    "--disable-pip-version-check", "--require-hashes", "--find-links", str(root / "wheelhouse"),
                    "-r", str(lock)], env=environment, check=True)
    subprocess.run([str(python), "-I", "-B", "-c", "import fitz,openpyxl,PIL,ssl,sqlite3"],
                   env=environment, check=True)
    (directory / "verifier.json").write_text(json.dumps({"python": str(python), "base_python": str(base),
        "archive": str(archive), "runtime": json.loads((root / "runtime/python-runtime.json").read_text("utf-8")),
        "scope": "evidence tools only; application installation is a separate fresh extraction"}, indent=2), encoding="utf-8")
    return python


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    print(prepare(args.archive.resolve(), args.directory.resolve()), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
