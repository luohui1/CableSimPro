"""Bundle a checked, privately loaded Linux GLVND/X11 dependency closure.

Only Debian/Ubuntu package-owned libraries are redistributed. Unknown native
dependencies, missing licenses, modified package files and GPU vendor drivers
are build errors; glibc and the dynamic loader remain operating-system inputs.
This module is a build tool and never invokes a package manager at installation.
"""
from __future__ import annotations

from hashlib import md5, sha256
import json
import os
from pathlib import Path
import platform
import re
import shutil
import struct
import subprocess
import sys

ROOT_LIBRARIES = ("libGL.so.1", "libXrender.so.1")
# Exact SONAME/package pairs prevent a vendor libGL or an unexpected dependency
# from silently adding proprietary drivers or a new redistribution obligation.
GRAPHICS_PACKAGES = {
    "libGL.so.1": "libgl1", "libGLX.so.0": "libglx0", "libGLdispatch.so.0": "libglvnd0",
    "libXrender.so.1": "libxrender1", "libX11.so.6": "libx11-6", "libxcb.so.1": "libxcb1",
    "libXau.so.6": "libxau6", "libXdmcp.so.6": "libxdmcp6", "libbsd.so.0": "libbsd0",
    "libmd.so.0": "libmd0",
}
SYSTEM_LIBRARIES = frozenset({
    "libc.so.6", "libm.so.6", "libdl.so.2", "libpthread.so.0", "librt.so.1",
    "libutil.so.1", "libresolv.so.2", "libanl.so.1", "ld-linux-x86-64.so.2",
})
METADATA = "runtime/native-manifest.json"
# The bundled Python interpreter and its metadata are owned by another step.
NATIVE_OUTPUTS = ("runtime/linux-libs", METADATA, "runtime/licenses")


def command(arguments: list[str]) -> str:
    env = {key: value for key, value in os.environ.items()
           if key not in {"LD_LIBRARY_PATH", "LD_PRELOAD", "LD_AUDIT"}}
    env.update(LC_ALL="C", LANG="C")
    result = subprocess.run(arguments, capture_output=True, text=True, encoding="utf-8",
                            errors="strict", env=env, timeout=30)
    if result.returncode:
        raise RuntimeError("原生依赖核验失败：" + " ".join(arguments) + "\n"
                           + (result.stderr or result.stdout).strip())
    return result.stdout


def executable(name: str) -> str:
    found = shutil.which(name)
    if not found and name == "ldconfig":
        found = next((str(path) for path in (Path("/usr/sbin/ldconfig"), Path("/sbin/ldconfig"))
                      if path.is_file() and os.access(path, os.X_OK)), None)
    if not found:
        raise RuntimeError("Linux 发行构建缺少系统核验工具：" + name)
    return found


def elf_x86_64(path: Path) -> None:
    with path.open("rb") as stream:
        header = stream.read(20)
    if (len(header) != 20 or header[:6] != b"\x7fELF\x02\x01"
            or struct.unpack_from("<H", header, 18)[0] != 62):
        raise RuntimeError("原生库不是 x86_64 little-endian ELF：" + str(path))


def system_roots() -> dict[str, Path]:
    listing = command([executable("ldconfig"), "-p"])
    found = {}
    for line in listing.splitlines():
        match = re.fullmatch(r"\s*(\S+)\s+\(([^)]+)\)\s+=>\s+(/\S+)\s*", line)
        if not match or match[1] not in ROOT_LIBRARIES or "x86-64" not in match[2]:
            continue
        path = Path(match[3]).resolve(strict=True)
        elf_x86_64(path)
        previous = found.setdefault(match[1], path)
        if previous != path:
            raise RuntimeError("系统存在多个不同的图形库候选：" + match[1])
    missing = set(ROOT_LIBRARIES) - found.keys()
    if missing:
        raise RuntimeError("发行构建机缺少图形运行库：" + ", ".join(sorted(missing))
                           + "；请仅在构建机安装 libgl1 和 libxrender1 后重试。")
    return found


def parse_ldd(text: str) -> dict[str, Path]:
    """Accept every ldd row explicitly; a missing/unknown row is never ignored."""
    resolved = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if re.fullmatch(r"linux-vdso\.so\.1\s+\(0x[0-9a-fA-F]+\)", line):
            continue  # A kernel-provided virtual object, not a distributable file.
        if "not found" in line:
            raise RuntimeError("图形运行依赖缺失：" + line)
        mapped = re.fullmatch(r"(\S+)\s+=>\s+(/\S+)\s+\(0x[0-9a-fA-F]+\)", line)
        loader = re.fullmatch(r"(/\S+)\s+\(0x[0-9a-fA-F]+\)", line)
        if mapped:
            name, path = mapped[1], Path(mapped[2])
        elif loader and Path(loader[1]).name == "ld-linux-x86-64.so.2":
            path = Path(loader[1])
            name = path.name
        else:
            raise RuntimeError("无法完整识别 ldd 输出，拒绝遗漏原生依赖：" + line)
        if name not in GRAPHICS_PACKAGES and name not in SYSTEM_LIBRARIES:
            raise RuntimeError("未经核对的原生依赖（不捆绑 GPU 驱动或未知库）：" + name)
        target = path.resolve(strict=True)
        if name in resolved and resolved[name] != target:
            raise RuntimeError("ldd 将同一依赖解析到多个文件：" + name)
        resolved[name] = target
        elf_x86_64(target)
    if not resolved:
        raise RuntimeError("ldd 没有提供有效依赖；拒绝生成空运行库清单。")
    return resolved


def elf_contract(path: Path, name: str) -> dict:
    reader = executable("readelf")
    dynamic = command([reader, "--dynamic", "--wide", str(path)])
    sonames = re.findall(r"\(SONAME\).*\[([^]]+)\]", dynamic)
    if sonames != [name]:
        raise RuntimeError("原生库 SONAME 与装载名称不一致：" + str(path))
    needed = re.findall(r"\(NEEDED\).*\[([^]]+)\]", dynamic)
    if any(item not in GRAPHICS_PACKAGES and item not in SYSTEM_LIBRARIES for item in needed):
        raise RuntimeError("原生库包含未审核的 DT_NEEDED：" + str(path))
    versions = command([reader, "--version-info", "--wide", str(path)])
    # Definitions are irrelevant: record only imported GLIBC symbol versions.
    needs = versions.split("Version needs section", 1)[-1] if "Version needs section" in versions else ""
    names = sorted(set(re.findall(r"Name:\s+(GLIBC_\S+)", needs)))
    if any(not re.fullmatch(r"GLIBC_\d+(?:\.\d+)+", item) for item in names):
        raise RuntimeError("原生库要求非公开或无法判定最低版本的 GLIBC ABI：" + str(path))
    return {"needed": needed, "glibc_versions": [item.removeprefix("GLIBC_") for item in names]}


def dependency_closure(roots: dict[str, Path] | None = None) -> tuple[dict, dict]:
    pending = dict(roots or system_roots())
    libraries, system = {}, {}
    ldd = executable("ldd")
    while pending:
        name = min(pending)
        path = pending.pop(name).resolve(strict=True)
        if name in libraries:
            if libraries[name]["source"] != path:
                raise RuntimeError("同一 SONAME 解析到不同文件：" + name)
            continue
        if name not in GRAPHICS_PACKAGES:
            raise RuntimeError("未经核对的图形运行库：" + name)
        elf_x86_64(path)
        contract = elf_contract(path, name)
        resolved = parse_ldd(command([ldd, str(path)]))
        if not set(contract["needed"]) <= resolved.keys():
            raise RuntimeError("ldd 未解析全部 DT_NEEDED：" + str(path))
        libraries[name] = {"source": path, **contract}
        for dependency, target in resolved.items():
            if dependency in SYSTEM_LIBRARIES:
                previous = system.setdefault(dependency, target)
            elif dependency in libraries:
                previous = libraries[dependency]["source"]
            else:
                previous = pending.setdefault(dependency, target)
            if previous != target:
                raise RuntimeError("原生依赖解析不一致：" + dependency)
    return libraries, system


def package_record(name: str, path: Path) -> dict:
    """Use the installed package database, including its actual file checksum."""
    query = executable("dpkg-query")
    paths = {str(path)}
    if str(path).startswith("/usr/lib/"):
        paths.add(str(path).removeprefix("/usr"))  # merged-/usr package records
    owners = set()
    for candidate in sorted(paths):
        try:
            output = command([query, "--search", candidate])
        except RuntimeError:
            continue
        for line in output.splitlines():
            package, separator, filename = line.rpartition(": ")
            if separator and filename == candidate and package.split(":")[0] == GRAPHICS_PACKAGES[name]:
                owners.add(package)
    if len(owners) != 1:
        raise RuntimeError("无法从 dpkg 证明原生库的唯一系统包来源：" + str(path)
                           + "；使用已正常安装运行库及其版权文件的 Debian/Ubuntu 构建机。")
    package = owners.pop()
    template = "${binary:Package}\t${Version}\t${Architecture}\t${source:Package}\t${source:Version}\t${db:Status-Status}"
    fields = command([query, "--show", "--showformat=" + template, package]).strip().split("\t")
    if len(fields) != 6 or fields[2] != "amd64" or fields[-1] != "installed":
        raise RuntimeError("原生库系统包未完整安装或架构不符：" + package)
    checksums = Path(command([query, "--control-path", package, "md5sums"]).strip())
    matches = []
    for line in checksums.read_text("utf-8").splitlines():
        checksum, relative = line.split(maxsplit=1)
        if (Path("/") / relative).resolve() == path:
            matches.append(checksum)
    if len(matches) != 1 or md5(path.read_bytes(), usedforsecurity=False).hexdigest() != matches[0]:
        raise RuntimeError("系统包登记的原生库字节不一致，拒绝分发：" + str(path))
    return {"package": fields[0], "package_version": fields[1], "architecture": fields[2],
            "source_package": fields[3], "source_version": fields[4], "package_md5": matches[0]}


def license_sources(package: str) -> dict[str, Path]:
    name = package.split(":")[0]
    copyright_path = Path("/usr/share/doc") / name / "copyright"
    if not copyright_path.is_file():
        raise RuntimeError("系统包缺少可随发行包交付的版权声明：" + package)
    text = copyright_path.read_text("utf-8")
    if not text.strip():
        raise RuntimeError("系统包版权声明为空：" + package)
    sources = {"runtime/licenses/" + name + "/copyright": copyright_path.resolve(strict=True)}
    for reference in set(re.findall(r"/usr/share/common-licenses/([A-Za-z0-9+_.-]+)", text)):
        reference = reference.rstrip(".,")
        source = Path("/usr/share/common-licenses") / reference
        if not source.is_file():
            raise RuntimeError("系统包版权声明引用的许可证全文缺失：" + str(source))
        sources["runtime/licenses/common/" + reference] = source.resolve(strict=True)
    return sources


def bundle_native_runtime(payload: Path) -> dict | None:
    """Copy verified GLVND/X11 files and notices; Windows needs no Linux payload."""
    if sys.platform == "win32":
        return None
    if sys.platform != "linux" or platform.machine().lower() not in {"x86_64", "amd64"}:
        raise RuntimeError("原生发行运行库只支持 Linux x86_64 和 Windows x64。")
    distribution = platform.freedesktop_os_release()
    if distribution.get("ID") not in {"debian", "ubuntu"}:
        raise RuntimeError("Linux 原生库构建须使用可核对 dpkg 包来源的 Debian/Ubuntu。")
    if any((payload / name).exists() or (payload / name).is_symlink() for name in NATIVE_OUTPUTS):
        raise RuntimeError("发行原生运行库文件已存在；拒绝混合不同构建。")
    libraries, system = dependency_closure()
    records, notices = [], {}
    for name, library in sorted(libraries.items()):
        path = library["source"]
        package = package_record(name, path)
        licenses = license_sources(package["package"])
        for relative, source in licenses.items():
            previous = notices.setdefault(relative, source)
            if previous.read_bytes() != source.read_bytes():
                raise RuntimeError("同一许可证名称有不同内容：" + relative)
        records.append({"soname": name, "path": "runtime/linux-libs/" + name,
                        "source_path": str(path), "size_bytes": path.stat().st_size,
                        "sha256": sha256(path.read_bytes()).hexdigest(), **package,
                        "needed": library["needed"], "glibc_versions": library["glibc_versions"],
                        "license_paths": sorted(licenses)})
    requirements = {version for record in records for version in record["glibc_versions"]}
    if not requirements:
        raise RuntimeError("无法确定原生库的最低 GLIBC 版本；拒绝猜测 ABI。")
    minimum = max(requirements, key=lambda value: tuple(map(int, value.split("."))))
    result = {"format": "cablesim.native-runtime/1", "platform": "linux", "architecture": "x86_64",
              "minimum_glibc": minimum, "build_glibc": os.confstr("CS_GNU_LIBC_VERSION"),
              "build_distribution": {key.lower(): distribution.get(key, "")
                                     for key in ("ID", "VERSION_ID", "PRETTY_NAME")},
              "roots": list(ROOT_LIBRARIES), "libraries": records,
              "system_libraries": [{"soname": name, "build_path": str(path)} for name, path in sorted(system.items())],
              "scope": "Private GLVND/X11 loader dependencies for saved geometry; no glibc, loader, GPU vendor driver or display server."}
    try:
        (payload / "runtime/linux-libs").mkdir(parents=True)
        for record in records:
            output = payload / record["path"]
            shutil.copyfile(record["source_path"], output)
            if output.is_symlink() or sha256(output.read_bytes()).hexdigest() != record["sha256"]:
                raise RuntimeError("复制后的原生库摘要不一致：" + record["soname"])
        result["licenses"] = []
        for relative, source in sorted(notices.items()):
            output = payload / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, output)
            result["licenses"].append({"path": relative, "source_path": str(source),
                                       "sha256": sha256(output.read_bytes()).hexdigest(),
                                       "size_bytes": output.stat().st_size})
        (payload / METADATA).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    except BaseException:
        # Roll back only the paths this step owns. In particular, NEVER remove
        # runtime/python or runtime/python-runtime.json from the Python step.
        for name in NATIVE_OUTPUTS:
            output = payload / name
            if output.is_dir() and not output.is_symlink():
                shutil.rmtree(output)
            else:
                output.unlink(missing_ok=True)
        raise
    return result
