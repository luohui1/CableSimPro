"""Pin, verify and relocate CPython; never discover a user-installed interpreter.

Only ``bundle_runtime`` downloads, on the release builder. Installation helpers
are stdlib-only and use immutable files already in the release manifest.
"""
from __future__ import annotations

from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import shutil
import struct
import subprocess
import sys
import tarfile
from tempfile import TemporaryDirectory
from urllib.request import urlopen

LOCK = Path(__file__).with_name("python_runtime.lock.json")
METADATA = "runtime/python-runtime.json"
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
MAX_EXPANDED_BYTES = 1024 * 1024 * 1024
MAX_MEMBERS = 32768


def digest(path: Path) -> str:
    value = sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def clean_python_environment(inherited: dict[str, str] | None = None) -> dict[str, str]:
    """Do not bind the release to another venv or an inherited Python home."""
    inherited = dict(os.environ if inherited is None else inherited)
    for key in list(inherited):
        if key.upper().startswith("PYTHON") or key.upper() in {
            "VIRTUAL_ENV", "VIRTUAL_ENV_PROMPT", "__PYVENV_LAUNCHER__",
        }:
            inherited.pop(key)
    return {**inherited, "PYTHONUTF8": "1", "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONNOUSERSITE": "1", "PIP_CONFIG_FILE": os.devnull,
            "PIP_DISABLE_PIP_VERSION_CHECK": "1"}


def runtime_path(root: Path, platform_name: str | None = None) -> Path:
    name = platform_name or sys.platform
    if name not in {"linux", "win32"}:
        raise RuntimeError("Unsupported release Python platform: " + name)
    return root / "runtime/python" / ("python.exe" if name == "win32" else "bin/python3.12")


def _member_name(raw: str) -> str:
    path = PurePosixPath(raw.rstrip("/"))
    if (not raw or path.is_absolute() or ".." in path.parts or "\\" in raw
            or ":" in raw or "\x00" in raw or str(path) != raw.rstrip("/")
            or not path.parts or path.parts[0] != "python"):
        raise RuntimeError("Unsafe Python archive member: " + repr(raw))
    return str(path)


def extract_runtime(archive: Path, destination: Path) -> None:
    """Materialize in-archive links as ordinary files; never create host links.

    A flat copy is deliberate: ZIP extraction on Windows does not preserve
    symlinks, and the release's immutable manifest disallows symlinks.
    Validate the complete graph before creating any destination file.
    """
    if destination.exists():
        raise RuntimeError("Python staging destination already exists")
    with tarfile.open(archive, "r:gz") as source:
        members: dict[str, tarfile.TarInfo] = {}
        folded: set[str] = set()
        for member in source:
            name = _member_name(member.name)
            if name.casefold() in folded or len(members) >= MAX_MEMBERS:
                raise RuntimeError("Duplicate or excessive Python archive members")
            if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                raise RuntimeError("Unsupported Python archive member: " + name)
            members[name] = member
            folded.add(name.casefold())

        def resolve(name: str) -> tarfile.TarInfo:
            seen: set[str] = set()
            while True:
                if name in seen or name not in members:
                    raise RuntimeError("Cyclic or missing Python archive link: " + name)
                seen.add(name)
                member = members[name]
                if member.isfile():
                    return member
                if not (member.issym() or member.islnk()):
                    raise RuntimeError("Python archive link is not a regular file: " + name)
                link = member.linkname
                if not link or link.startswith("/") or "\\" in link or ":" in link or "\x00" in link:
                    raise RuntimeError("Unsafe Python archive link: " + name)
                parent = posixpath.dirname(name) if member.issym() else ""
                name = _member_name(posixpath.normpath(posixpath.join(parent, link)))

        files: list[tuple[str, tarfile.TarInfo]] = []
        total = 0
        for name, member in members.items():
            for parent in PurePosixPath(name).parents:
                parent_member = members.get(str(parent))
                if parent_member is not None and not parent_member.isdir():
                    raise RuntimeError("Non-directory Python archive parent: " + str(parent))
            if member.isdir():
                continue
            original = resolve(name)
            total += original.size
            if original.size < 0 or total > MAX_EXPANDED_BYTES:
                raise RuntimeError("Python runtime archive exceeds expanded size limit")
            files.append((name, original))
        if not files:
            raise RuntimeError("Python runtime archive is empty")
        destination.mkdir(parents=True)
        try:
            for name, original in files:
                relative = PurePosixPath(name).relative_to("python")
                output = destination.joinpath(*relative.parts)
                output.parent.mkdir(parents=True, exist_ok=True)
                stream = source.extractfile(original)
                if stream is None:
                    raise RuntimeError("Missing Python archive bytes: " + name)
                with stream, output.open("xb") as target:
                    shutil.copyfileobj(stream, target, length=1024 * 1024)
                if output.stat().st_size != original.size:
                    raise RuntimeError("Truncated Python archive member: " + name)
                output.chmod(0o755 if original.mode & 0o111 else 0o644)
        except BaseException:
            shutil.rmtree(destination)
            raise


def _obtain(pin: dict, cache: Path) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / (pin["sha256"] + ".tar.gz")
    if not path.exists():
        with TemporaryDirectory(prefix="python-download-", dir=cache) as scratch:
            temporary = Path(scratch) / "runtime.tar.gz"
            size = 0
            with urlopen(pin["url"], timeout=60) as response, temporary.open("xb") as stream:
                while block := response.read(1024 * 1024):
                    size += len(block)
                    if size > MAX_ARCHIVE_BYTES:
                        raise RuntimeError("Python runtime download exceeds size limit")
                    stream.write(block)
            if digest(temporary) != pin["sha256"]:
                raise RuntimeError("Python runtime download does not match the pinned SHA256")
            os.replace(temporary, path)
    if path.is_symlink() or not path.is_file() or digest(path) != pin["sha256"]:
        raise RuntimeError("Python runtime cache does not match the pinned SHA256")
    return path


def prune_bytecode(prefix: Path) -> None:
    """Distribute sources, not path/mtime-dependent caches rebuilt on first use.

    Isolated plugin Python ignores PYTHONDONTWRITEBYTECODE. Upstream or pip
    bytecode can therefore change after relocation even if every source is
    untouched. Remove only regenerable caches before computing the immutable
    manifest; never weaken source, executable, DLL or license verification.
    """
    from importlib.util import source_from_cache

    candidates = sorted(path for path in prefix.rglob('*')
                        if path.is_file() and path.suffix in {'.pyc', '.pyo'})
    for path in candidates:
        if path.parent.name == '__pycache__':
            try:
                source = Path(source_from_cache(str(path)))
            except ValueError as error:
                raise RuntimeError('Unrecognized runtime bytecode cache: ' + str(path)) from error
        else:
            source = path.with_suffix('.py')
        if not source.is_file() or source.is_symlink():
            raise RuntimeError('Cannot remove a source-less Python module: ' + str(path))
    for path in candidates:
        path.unlink()
    for directory in sorted(prefix.rglob('__pycache__'), reverse=True):
        if directory.is_dir() and not any(directory.iterdir()):
            directory.rmdir()


def inspect_runtime(interpreter: Path) -> dict:
    """Run the real interpreter; verify stdlib, SQLite, TLS, pip and venv imports."""
    probe = (
        "import json,sys,sysconfig,struct,ssl,sqlite3,ctypes,venv,ensurepip,pip;"
        "print(json.dumps({'version':list(sys.version_info[:3]),"
        "'implementation':sys.implementation.name,'platform':sys.platform,"
        "'bits':struct.calcsize('P')*8,'executable':sys.executable,"
        "'base_prefix':sys.base_prefix,'prefix':sys.prefix,"
        "'stdlib':sysconfig.get_path('stdlib'),'ssl':ssl.OPENSSL_VERSION,"
        "'sqlite':sqlite3.sqlite_version,'pip':pip.__version__}))"
    )
    response = subprocess.run([str(interpreter), "-I", "-B", "-c", probe], check=True,
                              capture_output=True, text=True, encoding="utf-8", timeout=60,
                              env=clean_python_environment())
    return json.loads(response.stdout)


def bundle_runtime(root: Path, *, cache: Path, archive: Path | None = None) -> dict:
    lock = json.loads(LOCK.read_text("utf-8"))
    if (lock.get("format") != "cablesim.python-runtime-lock/1"
            or sys.platform not in lock.get("targets", {}) or struct.calcsize("P") != 8):
        raise RuntimeError("No pinned Python runtime for this builder")
    pin = lock["targets"][sys.platform]
    source = archive or _obtain(pin, cache)
    if source.is_symlink() or digest(source) != pin["sha256"]:
        raise RuntimeError("Python runtime archive does not match the pinned SHA256")
    prefix = root / "runtime/python"
    extract_runtime(source, prefix)
    prune_bytecode(prefix)
    executable = runtime_path(root)
    observed = inspect_runtime(executable)
    if (observed["version"] != [int(part) for part in lock["version"].split(".")]
            or observed["implementation"] != "cpython" or observed["platform"] != sys.platform
            or observed["bits"] != 64 or Path(observed["base_prefix"]).resolve() != prefix.resolve()
            or prefix.resolve() not in Path(observed["stdlib"]).resolve().parents):
        raise RuntimeError("Bundled Python identity or stdlib is not self-contained")
    licenses = sorted(path.relative_to(root).as_posix() for path in prefix.rglob("*")
                      if path.is_file() and any(word in path.name.lower()
                                               for word in ("license", "licence", "copying", "copyright")))
    if not licenses:
        raise RuntimeError("Upstream Python runtime contains no license notices")
    if sys.platform == "win32" and not (prefix / "vcruntime140.dll").is_file():
        raise RuntimeError("Windows Python runtime must include its app-local vcruntime140.dll")
    metadata = {"format": "cablesim.python-runtime/1", "distribution": lock["distribution"],
                "version": lock["version"], "build": lock["build"], "platform": sys.platform,
                "architecture": pin["architecture"], "url": pin["url"], "sha256": pin["sha256"],
                "metadata_source": lock["metadata_source"],
                "bytecode_policy": "regenerable caches omitted; all source and native runtime files hash-checked",
                "executable": executable.relative_to(root).as_posix(), "license_files": licenses,
                "stdlib_checks": {key: observed[key] for key in ("ssl", "sqlite", "pip")}}
    (root / METADATA).write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return metadata


def installed_base_python(root: Path) -> Path:
    """Select only the immutable runtime copied into this installation."""
    metadata = json.loads((root / METADATA).read_text("utf-8"))
    interpreter = runtime_path(root)
    if (metadata.get("format") != "cablesim.python-runtime/1"
            or metadata.get("platform") != sys.platform
            or metadata.get("executable") != interpreter.relative_to(root).as_posix()
            or interpreter.is_symlink() or not interpreter.is_file()):
        raise RuntimeError("Installed bundled Python runtime is missing or invalid")
    if os.name != "nt":
        # Python's zipfile extractor and some desktop extractors omit mode bits.
        interpreter.chmod(0o755)
    return interpreter


def create_environment(root: Path, environment: dict[str, str]) -> None:
    """Pin pyvenv.cfg to the installed base, never the downloaded/extracted ZIP."""
    interpreter = installed_base_python(root)
    subprocess.run([str(interpreter), "-I", "-B", "-m", "venv", "--copies", str(root / ".venv")],
                   env=clean_python_environment(environment), cwd=root, check=True)
