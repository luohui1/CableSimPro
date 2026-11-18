"""Pin, verify and unpack the Node.js runtime that runs the Agent sidecar.

Same contract as ``release_python_runtime``: only ``bundle_runtime`` downloads, on the release
builder, and only the URL and SHA256 pinned in ``node_runtime.lock.json``. Only the interpreter
binary and its licence enter the payload: no npm, npx, corepack or headers, so the installed
product can neither install nor update JavaScript packages, and it never searches PATH for Node.
Everything installation and launch need (``installed_node``, ``isolated_environment``) is stdlib-only.
"""
from __future__ import annotations

from hashlib import sha256
import json
import mmap
import os
from pathlib import Path
import platform
import re
import shutil
import struct
import subprocess
import sys
import tarfile
from tempfile import TemporaryDirectory
from urllib.request import urlopen
import zipfile

LOCK = Path(__file__).with_name("node_runtime.lock.json")
METADATA = "runtime/node-runtime.json"
FORMAT = "cablesim.node-runtime/1"
MAX_ARCHIVE_BYTES = 160 * 1024 * 1024
MAX_EXECUTABLE_BYTES = 320 * 1024 * 1024
# The sidecar talks to the platform over loopback and to nothing else; it needs only what Node itself
# needs to start. Provider keys, proxies and a developer's NODE_OPTIONS never reach it.
ALLOWED_ENVIRONMENT = frozenset({
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE",
    "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "LANG", "LC_ALL", "LC_CTYPE", "TZ",
    "USERNAME", "USER", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS",
})


def digest(path: Path) -> str:
    value = sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def isolated_environment(inherited: dict[str, str] | None = None, extra: dict[str, str] | None = None) -> dict[str, str]:
    """An allow-list, not a block-list: unknown variables (any provider's key) are dropped."""
    source = os.environ if inherited is None else inherited
    environment = {key: value for key, value in source.items() if key.upper() in ALLOWED_ENVIRONMENT}
    environment["NODE_ENV"] = "production"
    environment.update(extra or {})
    return environment


def runtime_path(root: Path, platform_name: str | None = None) -> Path:
    name = platform_name or sys.platform
    if name not in {"linux", "win32"}:
        raise RuntimeError("Unsupported release Node.js platform: " + name)
    return root / "runtime/node" / ("node.exe" if name == "win32" else "bin/node")


def required_symbol_versions(executable: Path) -> dict[str, str]:
    """Highest GLIBC / GLIBCXX symbol versions the ELF binary asks of the host (recorded, not trusted)."""
    found: dict[str, tuple[int, ...]] = {}
    with executable.open("rb") as stream, mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as data:
        for match in re.finditer(rb"(GLIBCXX|GLIBC)_(\d+(?:\.\d+)+)(?![\d.])", data):
            version = tuple(int(part) for part in match[2].split(b"."))
            name = match[1].decode()
            if version > found.get(name, ()):
                found[name] = version
    return {name: ".".join(map(str, version)) for name, version in sorted(found.items())}


def _obtain(pin: dict, cache: Path) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / (pin["sha256"] + "." + pin["archive"].replace(".", "-"))
    if not path.exists():
        with TemporaryDirectory(prefix="node-download-", dir=cache) as scratch:
            temporary = Path(scratch) / "runtime.archive"
            size = 0
            with urlopen(pin["url"], timeout=60) as response, temporary.open("xb") as stream:
                while block := response.read(1024 * 1024):
                    size += len(block)
                    if size > MAX_ARCHIVE_BYTES:
                        raise RuntimeError("Node.js runtime download exceeds size limit")
                    stream.write(block)
            if digest(temporary) != pin["sha256"]:
                raise RuntimeError("Node.js runtime download does not match the pinned SHA256")
            os.replace(temporary, path)
    if path.is_symlink() or not path.is_file() or digest(path) != pin["sha256"]:
        raise RuntimeError("Node.js runtime cache does not match the pinned SHA256")
    return path


def extract_runtime(archive: Path, pin: dict, destination: Path) -> None:
    """Take exactly the interpreter and LICENSE by name; nothing else is ever read from the archive."""
    if destination.exists():
        raise RuntimeError("Node.js staging destination already exists")
    prefix = pin["root"] + "/"
    wanted = {prefix + pin["executable"]: pin["executable"], prefix + "LICENSE": "LICENSE"}
    destination.mkdir(parents=True)
    try:
        if pin["archive"] == "zip":
            with zipfile.ZipFile(archive) as bundle:
                for member, relative in wanted.items():
                    try:
                        info = bundle.getinfo(member)
                    except KeyError:
                        raise RuntimeError("Node.js archive lacks " + member) from None
                    if info.is_dir() or not 0 < info.file_size <= MAX_EXECUTABLE_BYTES:
                        raise RuntimeError("Unexpected Node.js archive member: " + member)
                    output = destination.joinpath(*relative.split("/"))
                    output.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.open(info) as source, output.open("xb") as target:
                        shutil.copyfileobj(source, target, length=1024 * 1024)
        else:
            with tarfile.open(archive, "r:gz") as bundle:
                for member, relative in wanted.items():
                    try:
                        info = bundle.getmember(member)
                    except KeyError:
                        raise RuntimeError("Node.js archive lacks " + member) from None
                    if not info.isfile() or not 0 < info.size <= MAX_EXECUTABLE_BYTES:
                        raise RuntimeError("Unexpected Node.js archive member: " + member)
                    output = destination.joinpath(*relative.split("/"))
                    output.parent.mkdir(parents=True, exist_ok=True)
                    source = bundle.extractfile(info)
                    if source is None:
                        raise RuntimeError("Missing Node.js archive bytes: " + member)
                    with source, output.open("xb") as target:
                        shutil.copyfileobj(source, target, length=1024 * 1024)
                    output.chmod(0o755 if info.mode & 0o111 else 0o644)
    except BaseException:
        shutil.rmtree(destination, ignore_errors=True)
        raise


def inspect_runtime(executable: Path) -> dict:
    """Run the real binary: the version, platform and the TypeScript support the sidecar's entry file needs."""
    probe = ("JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch,"
             "typescript:process.features.typescript,openssl:process.versions.openssl})")
    response = subprocess.run([str(executable), "-p", probe], check=True, capture_output=True, text=True,
                              encoding="utf-8", timeout=60, env=isolated_environment())
    return json.loads(response.stdout)


def bundle_runtime(root: Path, *, cache: Path, archive: Path | None = None) -> dict:
    lock = json.loads(LOCK.read_text("utf-8"))
    if (lock.get("format") != "cablesim.node-runtime-lock/1" or sys.platform not in lock.get("targets", {})
            or struct.calcsize("P") != 8):
        raise RuntimeError("No pinned Node.js runtime for this builder")
    pin = lock["targets"][sys.platform]
    machine = platform.machine().lower()
    if ("x86_64" if machine in {"x86_64", "amd64"} else machine) != pin["architecture"]:
        raise RuntimeError("The pinned Node.js runtime is for " + pin["architecture"] + ", not " + machine)
    source = archive or _obtain(pin, cache)
    if source.is_symlink() or digest(source) != pin["sha256"]:
        raise RuntimeError("Node.js runtime archive does not match the pinned SHA256")
    prefix = root / "runtime/node"
    extract_runtime(source, pin, prefix)
    executable = runtime_path(root)
    observed = inspect_runtime(executable)
    if (observed["version"] != lock["version"] or observed["platform"] != sys.platform or observed["arch"] != "x64"
            or not observed["typescript"]):
        raise RuntimeError("Bundled Node.js does not match its pin or cannot run TypeScript entry files: " + json.dumps(observed))
    symbols = required_symbol_versions(executable) if sys.platform == "linux" else {}
    metadata = {"format": FORMAT, "distribution": lock["distribution"], "version": lock["version"],
                "platform": sys.platform, "architecture": pin["architecture"], "url": pin["url"],
                "sha256": pin["sha256"], "metadata_source": lock["metadata_source"],
                "executable": executable.relative_to(root).as_posix(),
                "executable_sha256": digest(executable), "license_files": ["runtime/node/LICENSE"],
                "contents": "interpreter and LICENSE only; npm, npx, corepack and headers are not distributed",
                "type_stripping": observed["typescript"], "openssl": observed["openssl"],
                "required_symbol_versions": symbols,
                **({"minimum_glibc": ".".join(symbols["GLIBC"].split(".")[:2])} if "GLIBC" in symbols else {})}
    (root / METADATA).write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return metadata


def installed_node(root: Path) -> Path:
    """Select only the interpreter copied into this installation; PATH is never consulted."""
    metadata = json.loads((root / METADATA).read_text("utf-8"))
    executable = runtime_path(root)
    if (metadata.get("format") != FORMAT or metadata.get("platform") != sys.platform
            or metadata.get("executable") != executable.relative_to(root).as_posix()
            or executable.is_symlink() or not executable.is_file()):
        raise RuntimeError("Installed bundled Node.js runtime is missing or invalid")
    if os.name != "nt" and not os.access(executable, os.X_OK):
        # ZIP extraction does not restore mode bits; a program directory owned by someone else is already runnable.
        executable.chmod(0o755)
    return executable
