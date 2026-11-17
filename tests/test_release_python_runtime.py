"""Archive security and fixed-runtime installation contracts; native smoke runs in CI."""
from __future__ import annotations

from hashlib import sha256
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

import pytest

from scripts import release_python_runtime as runtime


def archive_at(path: Path, entries: list[tuple[str, str, bytes | str]]) -> Path:
    with tarfile.open(path, "w:gz") as bundle:
        for name, kind, value in entries:
            entry = tarfile.TarInfo(name)
            entry.mode = 0o755 if name.endswith("python3.12") else 0o644
            if kind == "file":
                entry.size = len(value)
                bundle.addfile(entry, io.BytesIO(value))
            elif kind in {"symlink", "hardlink"}:
                entry.type = tarfile.SYMTYPE if kind == "symlink" else tarfile.LNKTYPE
                entry.linkname = value
                bundle.addfile(entry)
            else:
                entry.type = tarfile.DIRTYPE if kind == "directory" else tarfile.FIFOTYPE
                bundle.addfile(entry)
    return path


def test_materializes_only_in_archive_links_and_preserves_executable(tmp_path):
    archive = archive_at(tmp_path / "upstream.tar.gz", [
        ("python/bin/python", "symlink", "python3"),
        ("python/bin/python3", "symlink", "python3.12"),
        ("python/bin/python3.12", "file", b"binary bytes"),
        ("python/COPYING", "hardlink", "python/LICENSE"),
        ("python/LICENSE", "file", b"original license bytes\n"),
    ])
    target = tmp_path / "runtime"
    runtime.extract_runtime(archive, target)
    assert all(not path.is_symlink() for path in target.rglob("*"))
    assert (target / "bin/python").read_bytes() == b"binary bytes"
    assert (target / "COPYING").read_bytes() == b"original license bytes\n"
    assert (target / "bin/python3.12").stat().st_mode & 0o111


@pytest.mark.parametrize("name", ["/python/payload", "python/../escape", "other/payload",
                                      "python/a\\b", "python/C:escape", "python//d"])
def test_rejects_noncanonical_archive_names_before_writing(tmp_path, name):
    archive = archive_at(tmp_path / "bad.tar.gz", [(name, "file", b"no")])
    target = tmp_path / "runtime"
    with pytest.raises(RuntimeError, match="Unsafe"):
        runtime.extract_runtime(archive, target)
    assert not target.exists()


@pytest.mark.parametrize("entries", [
    [("python/a", "symlink", "../../outside")],
    [("python/a", "symlink", "/etc/passwd")],
    [("python/a", "symlink", "a")],
    [("python/a", "symlink", "b"), ("python/b", "symlink", "a")],
    [("python/a", "hardlink", "missing")],
    [("python/a", "symlink", "missing")],
    [("python/a", "fifo", b"")],
    [("python/a", "file", b"1"), ("python/a", "file", b"2")],
    [("python/a", "file", b"1"), ("python/a/b", "file", b"2")],
])
def test_rejects_escaping_cyclic_duplicate_and_special_members(tmp_path, entries):
    archive = archive_at(tmp_path / "bad.tar.gz", entries)
    target = tmp_path / "runtime"
    with pytest.raises(RuntimeError):
        runtime.extract_runtime(archive, target)
    assert not target.exists()


def test_link_expansion_counts_toward_archive_limit(tmp_path, monkeypatch):
    archive = archive_at(tmp_path / "big.tar.gz", [
        ("python/a", "file", b"12345"), ("python/b", "hardlink", "python/a")])
    monkeypatch.setattr(runtime, "MAX_EXPANDED_BYTES", 9)
    with pytest.raises(RuntimeError, match="size limit"):
        runtime.extract_runtime(archive, tmp_path / "runtime")
    assert not (tmp_path / "runtime").exists()


def test_cache_is_hash_checked_and_does_not_fetch_when_complete(tmp_path, monkeypatch):
    raw = b"downloaded archive"
    pin = {"url": "https://example.invalid/runtime", "sha256": sha256(raw).hexdigest()}
    path = tmp_path / (pin["sha256"] + ".tar.gz")
    path.write_bytes(raw)
    monkeypatch.setattr(runtime, "urlopen", lambda *_a, **_k: pytest.fail("Unexpected download"))
    assert runtime._obtain(pin, tmp_path) == path
    path.write_bytes(raw + b"tampered")
    with pytest.raises(RuntimeError, match="SHA256"):
        runtime._obtain(pin, tmp_path)


def test_bad_download_never_becomes_cached_runtime(tmp_path, monkeypatch):
    pin = {"url": "https://example.invalid/runtime", "sha256": "a" * 64}
    monkeypatch.setattr(runtime, "urlopen", lambda *_a, **_k: io.BytesIO(b"bad archive"))
    with pytest.raises(RuntimeError, match="SHA256"):
        runtime._obtain(pin, tmp_path)
    assert list(tmp_path.iterdir()) == []


def test_runtime_environment_does_not_inherit_another_python_or_venv():
    original = {"PATH": "/keep", "PYTHONHOME": "/external", "PYTHONPATH": "/external/site",
                "PYTHONUSERBASE": "/external/user", "VIRTUAL_ENV": "/external/venv",
                "__PYVENV_LAUNCHER__": "/external/launcher", "CUSTOM_MODEL_KEY": "keep-private"}
    result = runtime.clean_python_environment(original)
    assert result["PATH"] == original["PATH"]
    assert result["CUSTOM_MODEL_KEY"] == "keep-private"
    assert not {"PYTHONHOME", "PYTHONPATH", "PYTHONUSERBASE", "VIRTUAL_ENV", "__PYVENV_LAUNCHER__"} & result.keys()
    assert original["PYTHONHOME"] == "/external"
    assert result["PIP_CONFIG_FILE"] == os.devnull


def test_venv_is_created_from_installed_base_not_callers_python(tmp_path, monkeypatch):
    interpreter = runtime.runtime_path(tmp_path)
    interpreter.parent.mkdir(parents=True)
    interpreter.write_bytes(b"command contract only; not an interpreter smoke test")
    (tmp_path / runtime.METADATA).write_text(json.dumps({
        "format": "cablesim.python-runtime/1", "platform": runtime.sys.platform,
        "executable": interpreter.relative_to(tmp_path).as_posix()}))
    commands = []
    monkeypatch.setattr(runtime.subprocess, "run", lambda args, **kwargs: commands.append((args, kwargs)))
    runtime.create_environment(tmp_path, {"PATH": "", "PYTHONHOME": "/wrong"})
    assert commands[0][0] == [str(interpreter), "-I", "-B", "-m", "venv", "--copies", str(tmp_path / ".venv")]
    assert commands[0][1]["check"] is True
    assert "PYTHONHOME" not in commands[0][1]["env"]


def test_missing_runtime_cannot_fall_back_to_system_python(tmp_path):
    (tmp_path / "runtime").mkdir()
    (tmp_path / runtime.METADATA).write_text(json.dumps({"format": "cablesim.python-runtime/1"}))
    with pytest.raises(RuntimeError, match="missing or invalid"):
        runtime.installed_base_python(tmp_path)


@pytest.mark.skipif(os.name == "nt", reason="POSIX wrapper; real Windows wrapper is exercised by the release CI")
def test_posix_launcher_argument_routing_without_python_in_path(tmp_path):
    root = tmp_path / "path with spaces"
    target = runtime.runtime_path(root)
    target.parent.mkdir(parents=True)
    # This shell stub verifies quoting/routing only. CI boots a real distribution.
    target.write_text('#!/bin/sh\nprintf "%s\\000" "$@" > "$CAPTURE"\n')
    script = root / "start.sh"
    script.write_bytes((Path(runtime.__file__).parent / "start_release.sh").read_bytes())
    commands = tmp_path / "commands"
    commands.mkdir()
    (commands / "chmod").symlink_to(shutil.which("chmod"))
    capture = tmp_path / "argv"
    subprocess.run([shutil.which("sh"), str(script), "--config", str(tmp_path / "config space.toml"), "--no-start"],
                   env={"PATH": str(commands), "CAPTURE": str(capture)}, check=True)
    arguments = capture.read_bytes().split(b"\0")[:-1]
    assert arguments[:2] == [b"-I", b"-B"]
    assert arguments[2].decode() == str(root / "scripts/install_release.py")
    assert arguments[-3:] == [b"--config", str(tmp_path / "config space.toml").encode(), b"--no-start"]
    assert shutil.which("python", path=str(commands)) is None


def test_both_wrappers_name_the_bundled_executable():
    scripts = Path(runtime.__file__).parent
    windows = (scripts / "start_release.cmd").read_text()
    linux = (scripts / "start_release.sh").read_text()
    assert '"%~dp0runtime\\python\\python.exe" -I -B' in windows
    assert "py -3.12" not in windows
    assert 'exec "$python" -I -B' in linux
    assert "exec python3.12" not in linux


def test_runtime_pins_are_explicit_platform_assets():
    lock = json.loads(runtime.LOCK.read_text())
    assert set(lock["targets"]) == {"linux", "win32"}
    assert lock["version"].startswith("3.12.")
    for platform_name, pin in lock["targets"].items():
        assert pin["url"].startswith("https://github.com/astral-sh/python-build-standalone/releases/download/")
        assert pin["sha256"] != "0" * 64 and len(bytes.fromhex(pin["sha256"])) == 32
        assert pin["architecture"] == "x86_64"
        assert "runtime/python/" + pin["executable"] == runtime.runtime_path(Path("root"), platform_name).relative_to("root").as_posix()


def test_acceptance_path_cannot_discover_system_interpreters(tmp_path):
    from scripts.release_runtime_verification import assert_no_system_interpreters
    empty = tmp_path / 'empty'
    empty.mkdir()
    assert all(value is None for value in assert_no_system_interpreters({'PATH': str(empty)})['commands'].values())
    executable = empty / ('python.exe' if os.name == 'nt' else 'python')
    executable.write_bytes(b'not executed')
    executable.chmod(0o755)
    with pytest.raises(RuntimeError, match='system interpreter'):
        assert_no_system_interpreters({'PATH': str(empty)})


def test_acceptance_calls_os_wrapper_not_a_python_command(tmp_path):
    from scripts.release_runtime_verification import public_command
    command = public_command(tmp_path / 'space path', tmp_path / 'config space.toml')
    assert command[-3:] == ['--config', str(tmp_path / 'config space.toml'), '--no-browser']
    assert command[0].endswith('cmd.exe' if os.name == 'nt' else '/bin/sh')
    assert ('start.cmd' in command) if os.name == 'nt' else command[1].endswith('/start.sh')
    assert not any(arg.endswith(('python', 'python.exe', 'python3.12')) for arg in command)


def test_runtime_identity_rejects_external_base_before_acceptance(tmp_path, monkeypatch):
    from scripts import release_runtime_verification as verification
    root = tmp_path / 'installation'
    (root / 'runtime').mkdir(parents=True)
    (root / 'runtime/python-runtime.json').write_text(json.dumps({
        'version': '3.12.15', 'format': 'cablesim.python-runtime/1',
        'executable': 'runtime/python/' + ('python.exe' if os.name == 'nt' else 'bin/python3.12')}))
    observed = {'executable': str(root / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')),
        'base_executable': str(tmp_path / 'external/python'), 'base_prefix': str(tmp_path / 'external'),
        'prefix': str(root / '.venv'), 'stdlib': str(tmp_path / 'external/lib/python3.12'), 'version': [3, 12, 15]}
    monkeypatch.setattr(verification.subprocess, 'run', lambda *a, **k: type('Result', (), {'stdout': json.dumps(observed)})())
    with pytest.raises(RuntimeError, match='outside'):
        verification.runtime_identity(root, {'PATH': ''})


def test_posix_case_distinct_files_are_not_duplicate_archive_members(tmp_path):
    archive = archive_at(tmp_path / "upstream.tar.gz", [
        ("python/share/terminfo/a", "directory", b""),
        ("python/share/terminfo/A", "directory", b""),
        ("python/share/terminfo/a/ansi", "file", b"ansi entry"),
        ("python/share/terminfo/A/Apple_Terminal", "file", b"Apple entry"),
    ])
    target = tmp_path / "runtime"
    runtime.extract_runtime(archive, target, case_sensitive=True)
    assert (target / "share/terminfo/a/ansi").read_bytes() == b"ansi entry"
    assert (target / "share/terminfo/A/Apple_Terminal").read_bytes() == b"Apple entry"


@pytest.mark.parametrize("names", [
    ("python/a", "python/A"),
    ("python/Lib/a.py", "python/lib/b.py"),
])
def test_windows_rejects_case_aliases_in_files_and_implicit_parents(tmp_path, names):
    archive = archive_at(tmp_path / "bad.tar.gz", [(name, "file", b"payload") for name in names])
    target = tmp_path / "runtime"
    with pytest.raises(RuntimeError, match="Case-alias"):
        runtime.extract_runtime(archive, target, case_sensitive=False)
    assert not target.exists()
