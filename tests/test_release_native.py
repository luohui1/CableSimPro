"""Check actual Linux ELF dependencies, licenses and strict redistribution gates."""
from hashlib import sha256
import json
from pathlib import Path
import sys

import pytest

from scripts import release_native


@pytest.mark.skipif(sys.platform != "linux", reason="Linux system dependency collection")
def test_actual_graphics_dependency_closure_has_licenses_and_public_glibc_abi():
    libraries, system = release_native.dependency_closure()
    assert set(release_native.ROOT_LIBRARIES) <= libraries.keys()
    assert set(libraries) <= release_native.GRAPHICS_PACKAGES.keys()
    assert set(libraries).isdisjoint(release_native.SYSTEM_LIBRARIES)
    assert "libc.so.6" in system and "ld-linux-x86-64.so.2" in system
    assert not any("mesa" in name.lower() or "nvidia" in name.lower() for name in libraries)
    for name, record in libraries.items():
        assert record["source"].is_file()
        release_native.elf_x86_64(record["source"])
        assert set(record["needed"]) <= libraries.keys() | system.keys()
        assert all(version.split(".")[0] == "2" for version in record["glibc_versions"])
        licenses = release_native.license_sources(release_native.GRAPHICS_PACKAGES[name])
        assert any(Path(relative).name == "copyright" for relative in licenses)
        assert all(path.is_file() and path.read_bytes().strip() for path in licenses.values())


@pytest.mark.skipif(sys.platform != "linux", reason="Linux system dependency collection")
def test_real_collection_is_complete_or_refuses_missing_package_provenance(tmp_path):
    # Some managed containers expose system .so files and copyright notices but
    # omit the corresponding dpkg database. That must fail rather than invent a
    # package version; the Ubuntu release CI uses real apt-installed packages.
    libraries, _ = release_native.dependency_closure()
    try:
        for name, record in libraries.items():
            release_native.package_record(name, record["source"])
    except RuntimeError as error:
        if "无法从 dpkg 证明" not in str(error):
            raise
        with pytest.raises(RuntimeError, match="无法从 dpkg 证明"):
            release_native.bundle_native_runtime(tmp_path)
        assert not (tmp_path / "runtime").exists()
        return

    manifest = release_native.bundle_native_runtime(tmp_path)
    assert json.loads((tmp_path / release_native.METADATA).read_text("utf-8")) == manifest
    assert manifest["build_distribution"]["id"] in {"debian", "ubuntu"}
    assert manifest["minimum_glibc"]
    assert {item["soname"] for item in manifest["libraries"]} == set(libraries)
    assert not any(path.is_symlink() for path in (tmp_path / "runtime").rglob("*"))
    for library in manifest["libraries"]:
        path = tmp_path / library["path"]
        assert path.is_file() and path.stat().st_size == library["size_bytes"]
        assert sha256(path.read_bytes()).hexdigest() == library["sha256"]
        assert library["package_version"] and library["package_md5"]
        assert all((tmp_path / license_path).is_file() for license_path in library["license_paths"])
    for license_record in manifest["licenses"]:
        assert sha256((tmp_path / license_record["path"]).read_bytes()).hexdigest() == license_record["sha256"]
    # Every copied library must resolve against the private directory; the
    # stronger installed-CAD /proc/self/maps check belongs to the release gate.
    assert all(Path(item["path"]).name not in release_native.SYSTEM_LIBRARIES
               for item in manifest["libraries"])


@pytest.mark.parametrize("line", [
    "libXrender.so.1 => not found",
    "libc.so.6 => not found",
    "libnvidia-glcore.so.570 => /usr/lib/libnvidia-glcore.so.570 (0x1234)",
    "unrecognized dependency output",
])
def test_missing_core_or_graphics_libraries_and_unknown_drivers_are_never_ignored(line):
    with pytest.raises(RuntimeError):
        release_native.parse_ldd(line)


def test_missing_license_is_a_build_error():
    with pytest.raises(RuntimeError, match="版权声明"):
        release_native.license_sources("cablesim-uninstalled-native-test-package")


def test_windows_does_not_collect_or_create_linux_files(tmp_path, monkeypatch):
    monkeypatch.setattr(release_native.sys, "platform", "win32")
    assert release_native.bundle_native_runtime(tmp_path) is None
    assert not list(tmp_path.iterdir())


def _fake_native_inputs(tmp_path, monkeypatch):
    # Exercise ownership on all platforms without requiring a dpkg database.
    library = tmp_path / "fake-libGL.so.1"
    library.write_bytes(b"native-contents")
    notice = tmp_path / "native-copyright"
    notice.write_text("redistribution notice", encoding="utf-8")
    monkeypatch.setattr(release_native.sys, "platform", "linux")
    monkeypatch.setattr(release_native.platform, "machine", lambda: "x86_64")
    monkeypatch.setattr(release_native.platform, "freedesktop_os_release",
                        lambda: {"ID": "ubuntu", "VERSION_ID": "24.04"})
    monkeypatch.setattr(release_native.os, "confstr", lambda _: "glibc 2.38", raising=False)
    monkeypatch.setattr(release_native, "dependency_closure",
                        lambda: ({"libGL.so.1": {"source": library,
                                  "needed": [], "glibc_versions": ["2.38"]}}, {}))
    monkeypatch.setattr(release_native, "package_record", lambda name, path: {
        "package": "libgl1", "package_version": "1", "architecture": "amd64",
        "source_package": "libgl1", "source_version": "1", "package_md5": "f" * 32})
    monkeypatch.setattr(release_native, "license_sources",
                        lambda _: {"runtime/licenses/libgl1/copyright": notice})


@pytest.mark.parametrize("fail", [False, True])
def test_native_step_coexists_with_bundled_python_and_never_deletes_it(tmp_path, monkeypatch, fail):
    _fake_native_inputs(tmp_path, monkeypatch)
    python = tmp_path / "runtime/python/bin/python3"
    python.parent.mkdir(parents=True)
    python.write_bytes(b"bundled CPython sentinel")
    metadata = tmp_path / "runtime/python-runtime.json"
    metadata.write_text('{"python":"3.12"}', encoding="utf-8")
    if fail:
        original = release_native.shutil.copyfile

        def fail_during_license_copy(source, destination, *args, **kwargs):
            if "licenses" in Path(destination).parts:
                raise OSError("injected native-license failure")
            return original(source, destination, *args, **kwargs)

        monkeypatch.setattr(release_native.shutil, "copyfile", fail_during_license_copy)
        with pytest.raises(OSError, match="injected native-license failure"):
            release_native.bundle_native_runtime(tmp_path)
        for owned in release_native.NATIVE_OUTPUTS:
            assert not (tmp_path / owned).exists()
    else:
        report = release_native.bundle_native_runtime(tmp_path)
        assert report["libraries"][0]["soname"] == "libGL.so.1"
        assert (tmp_path / release_native.METADATA).is_file()
        assert (tmp_path / "runtime/linux-libs/libGL.so.1").read_bytes() == b"native-contents"
    assert python.read_bytes() == b"bundled CPython sentinel"
    assert metadata.read_text(encoding="utf-8") == '{"python":"3.12"}'


@pytest.mark.parametrize("occupied", release_native.NATIVE_OUTPUTS)
def test_native_step_refuses_existing_own_output_without_mutating_python(tmp_path, monkeypatch, occupied):
    _fake_native_inputs(tmp_path, monkeypatch)
    python = tmp_path / "runtime/python/bin/python3"
    python.parent.mkdir(parents=True)
    python.write_bytes(b"python remains")
    own_path = tmp_path / occupied
    own_path.parent.mkdir(parents=True, exist_ok=True)
    if occupied in ("runtime/linux-libs", "runtime/licenses"):
        own_path.mkdir()
        (own_path / "keep").write_text("original")
    else:
        own_path.write_text("original")
    with pytest.raises(RuntimeError, match="原生运行库文件已存在"):
        release_native.bundle_native_runtime(tmp_path)
    assert own_path.exists()
    assert python.read_bytes() == b"python remains"
