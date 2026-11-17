"""Prepare the existing verified OCCT frontend assets on Linux or Windows.

This is a release build tool, never part of application startup. It delegates
the native compilation and asset verification to the CAD module's existing
scripts without changing their source or their checksums.
"""
from __future__ import annotations

import argparse
from hashlib import file_digest
import importlib.util
import json
from pathlib import Path, PurePosixPath
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "frontend/src/features/cad/native"
LOCK = Path(__file__).with_name("release_toolchains.json")


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return file_digest(stream, "sha256").hexdigest()


def archive_path(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name:
        raise ValueError("Unsafe toolchain archive path: " + name)
    return path


def download(record: dict, cache: Path) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / (record["sha256"] + record["suffix"])
    if archive.is_file() and digest(archive) == record["sha256"]:
        return archive
    with tempfile.NamedTemporaryFile(dir=cache, suffix=".part", delete=False) as stream:
        partial = Path(stream.name)
    try:
        print("Downloading pinned release toolchain: " + record["url"], flush=True)
        with urllib.request.urlopen(record["url"], timeout=120) as source, partial.open("wb") as target:
            shutil.copyfileobj(source, target, 1024 * 1024)
        if digest(partial) != record["sha256"]:
            raise ValueError("Release toolchain SHA256 mismatch: " + record["url"])
        partial.replace(archive)
    finally:
        partial.unlink(missing_ok=True)
    return archive


def install(name: str, record: dict, cache: Path, home: Path, prepare) -> Path:
    destination = home / name
    receipt = home / (name + ".json")
    if receipt.is_file() and destination.is_dir():
        saved = json.loads(receipt.read_text("utf-8"))
        if saved.get("sha256") == record["sha256"] and saved.get("files") == prepare.tree_hashes(destination):
            return destination
    archive = download(record, cache)
    home.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=home, prefix=name + "-") as directory:
        scratch = Path(directory)
        extracted = scratch / "extracted"
        extracted.mkdir()
        if record["suffix"] == ".zip":
            with zipfile.ZipFile(archive) as bundle:
                for member in bundle.infolist():
                    archive_path(member.filename)
                bundle.extractall(extracted)
        else:
            with tarfile.open(archive) as bundle:
                for member in bundle.getmembers():
                    archive_path(member.name)
                bundle.extractall(extracted, filter="data")
        source = extracted / record["root"] if record["root"] else extracted
        staged = scratch / "installed"
        prefix = record.get("prefix", "")
        if prefix:
            staged.mkdir()
            source.rename(staged / prefix)
        else:
            source.rename(staged)
        for executable in record.get("executables", []):
            (staged / executable).chmod(0o755)
        prepare.normalize_version(name, staged)
        if destination.exists():
            shutil.rmtree(destination)
        staged.rename(destination)
    receipt.write_text(json.dumps({"sha256": record["sha256"], "files": prepare.tree_hashes(destination)}), encoding="utf-8")
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--download-cache", type=Path, default=ROOT / ".data/release-toolchains/downloads")
    args = parser.parse_args()
    if not 1 <= args.jobs <= 32:
        parser.error("jobs must be 1–32")
    node = shutil.which("node")
    if not node:
        parser.error("Node.js is required on the release builder")
    verify = [node, str(NATIVE.parent / "prepare-runtime.mjs")]
    if subprocess.run([*verify, "--check-only"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        subprocess.run(verify, check=True)
        return 0
    if sys.platform == "win32":
        subprocess.run([sys.executable, str(NATIVE / "prepare.py"), "--jobs", str(args.jobs)], check=True)
        return 0
    if sys.platform != "linux" or platform.machine().lower() not in ("x86_64", "amd64"):
        parser.error("Release source builds support Linux x86_64 and Windows x64")
    # prepare.py imports its adjacent build.py. Keep the original CAD modules
    # intact so prepare-runtime.mjs verifies the very same source identities.
    sys.path.insert(0, str(NATIVE))
    spec = importlib.util.spec_from_file_location("release_cad_prepare", NATIVE / "prepare.py")
    prepare = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(prepare)
    lock = json.loads(LOCK.read_text("utf-8"))
    if lock["pins"] != prepare.PINS:
        raise ValueError("Release toolchains differ from CAD runtime.lock.json; update the pinned archives")
    home = ROOT / ".data/occt-toolchain/bootstrap-linux"
    installed = {name: install(name, record, args.download_cache.resolve(), home, prepare)
                 for name, record in lock["linux-x86_64"].items()}
    sdk = ROOT / ".data/occt-toolchain/occt"
    receipt = sdk / "cablesim-build.json"
    bridge_only = False
    if receipt.is_file():
        saved = json.loads(receipt.read_text("utf-8"))
        bridge_only = saved.get("pins") == prepare.PINS and saved.get("files") == prepare.sdk_files(sdk)
    command = [sys.executable, str(NATIVE / "build.py"), "--emsdk", str(installed["emscripten"]),
               "--cmake", str(installed["cmake"] / "bin/cmake"), "--ninja", str(installed["ninja"] / "ninja"),
               "--jobs", str(args.jobs)]
    if bridge_only:
        command.append("--bridge-only")
    else:
        command.extend(["--source", str(prepare.source_checkout(home))])
    subprocess.run(command, check=True)
    subprocess.run(verify, check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
