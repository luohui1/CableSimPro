"""Shared, stdlib-only release configuration and immutable payload checks."""
from __future__ import annotations

from hashlib import sha256
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import signal
import struct
import subprocess
import sys
import tomllib
from urllib.parse import urlsplit
from uuid import uuid4
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "release-manifest.json"
FORMAT = "cablesim.release/1"


def utf8_output() -> None:
    """Keep Chinese diagnostics readable in Windows terminals and redirected CI logs."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def digest(path: Path) -> str:
    value = sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid4().hex + ".partial")
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def architecture() -> str:
    machine = platform.machine().lower()
    return "x86_64" if machine in {"x86_64", "amd64"} else machine


def target() -> dict:
    return {"platform": sys.platform, "architecture": architecture(),
            "python": list(sys.version_info[:2]), "pointer_bits": struct.calcsize("P") * 8}


def safe_relative(value: str) -> Path:
    path = PurePosixPath(value)
    if (not value or path.is_absolute() or ".." in path.parts or "\\" in value
            or ":" in value or str(path) != value):
        raise RuntimeError("发行清单包含不安全的相对路径。")
    return Path(*path.parts)


def manifest(root: Path, *, check_files: bool = True) -> dict:
    value = json.loads((root / MANIFEST).read_text("utf-8"))
    if value.get("format") != FORMAT or not isinstance(value.get("files"), dict):
        raise RuntimeError("发行清单格式不支持。")
    expected = value.get("build_id")
    contents = {key: item for key, item in value.items() if key != "build_id"}
    actual = sha256(json.dumps(contents, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if expected != actual:
        raise RuntimeError("发行清单摘要不一致，请重新取得完整发行包。")
    if value.get("target") != target():
        raise RuntimeError("发行包与当前系统/架构/Python版本不匹配：需要 "
                           + json.dumps(value.get("target"), ensure_ascii=False))
    for name, record in value["files"].items():
        relative = safe_relative(name)
        path = root / relative
        if root.resolve() not in path.resolve().parents:
            raise RuntimeError("发行文件路径不在发行目录内：" + name)
        if not isinstance(record, dict) or not re.fullmatch(r"[0-9a-f]{64}", record.get("sha256", "")):
            raise RuntimeError("发行文件摘要格式不支持。")
        if check_files and (path.is_symlink() or not path.is_file()
                            or path.stat().st_size != record["size_bytes"] or digest(path) != record["sha256"]):
            raise RuntimeError("发行文件缺失或摘要不一致：" + name)
    return value


def config(path: Path) -> dict:
    path = path.expanduser().resolve()
    with path.open("rb") as stream:
        value = tomllib.load(stream)
    allowed = {"server", "storage", "initialization", "model", "processes"}
    if set(value) - allowed:
        raise RuntimeError("运行配置包含未知配置组。")
    defaults = {
        "server": {"host": "127.0.0.1", "port": 8100, "open_browser": True,
                   "startup_timeout_seconds": 300, "trusted_hosts": []},
        "storage": {"data_dir": "../CableSimPro-data"},
        "initialization": {"seed_examples": True},
        "model": {"base_url": "", "model": "", "api_key_env": "CABLESIM_LLM_API_KEY"},
    }
    for section, fields in defaults.items():
        supplied = value.get(section, {})
        if not isinstance(supplied, dict) or set(supplied) - set(fields):
            raise RuntimeError("运行配置字段不支持：" + section)
        value[section] = {**fields, **supplied}
    server = value["server"]
    if (type(server["port"]) is not int or not 1 <= server["port"] <= 65535
            or type(server["startup_timeout_seconds"]) is not int
            or not 5 <= server["startup_timeout_seconds"] <= 1800):
        raise RuntimeError("端口应为 1–65535；启动超时应为 5–1800 秒。")
    try:
        if server["host"] != "localhost":
            ipaddress.ip_address(server["host"])
    except (TypeError, ValueError):
        raise RuntimeError("监听 host 须为 IP 地址或 localhost。") from None
    for field, setting in (("open_browser", server), ("seed_examples", value["initialization"])):
        if type(setting[field]) is not bool:
            raise RuntimeError(field + " 须为布尔值。")
    if (not isinstance(server["trusted_hosts"], list)
            or any(not isinstance(item, str) or not item.strip() or "/" in item or "," in item
                   for item in server["trusted_hosts"])):
        raise RuntimeError("trusted_hosts 须为明确主机名数组。")
    model = value["model"]
    if any(not isinstance(item, str) for item in model.values()):
        raise RuntimeError("模型配置须为字符串。")
    if model["base_url"]:
        parsed = urlsplit(model["base_url"])
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username
                or parsed.password or parsed.query or parsed.fragment):
            raise RuntimeError("模型地址须为不含凭据、查询或片段的 HTTP(S) API 基址。")
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", model["api_key_env"]):
        raise RuntimeError("api_key_env 须为环境变量名，不填写密钥。")
    raw_directory = value["storage"]["data_dir"]
    if not isinstance(raw_directory, str) or not raw_directory.strip():
        raise RuntimeError("data_dir 须为非空目录路径。")
    directory = Path(raw_directory).expanduser()
    directory = (directory if directory.is_absolute() else path.parent / directory).resolve()
    processes = value.setdefault("processes", [])
    names = set()
    if not isinstance(processes, list):
        raise RuntimeError("processes 须为配置表数组。")
    for item in processes:
        if (not isinstance(item, dict) or set(item) - {"name", "command", "cwd", "required", "env"}
                or not isinstance(item.get("name"), str) or not item["name"] or item["name"] in names):
            raise RuntimeError("伴随进程须有唯一名称，且只能使用声明字段。")
        names.add(item["name"])
        if (not isinstance(item.get("command"), list) or not item["command"]
                or any(not isinstance(arg, str) or not arg for arg in item["command"])):
            raise RuntimeError("伴随进程 command 须为非空参数数组。")
        if (type(item.get("required", True)) is not bool or not isinstance(item.get("cwd", "."), str)
                or not isinstance(item.get("env", {}), dict)
                or any(not isinstance(k, str) or not isinstance(v, str) for k, v in item.get("env", {}).items())):
            raise RuntimeError("伴随进程 cwd/required/env 格式错误。")
    value["path"] = path
    value["data_dir"] = directory
    return value


def python_path(app: Path) -> Path:
    return app / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def installation(directory: Path, build_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{64}", build_id):
        raise RuntimeError("无效发行编号。")
    return directory / "programs" / build_id[:16]


def windows_long_paths_enabled() -> bool | None:
    """Observe Windows policy; never require administrator access or change it."""
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\FileSystem") as key:
            value, _ = winreg.QueryValueEx(key, "LongPathsEnabled")
            return value == 1
    except OSError:
        return None


def windows_path_policy(app: Path, wheels: Path, *, long_paths_enabled: bool | None) -> dict:
    """Check real wheel destinations before extracting into a default MAX_PATH system."""
    prefix = app / ".venv"
    site = prefix / "Lib/site-packages"
    longest = str(prefix / "Scripts/python.exe")
    for wheel in sorted(wheels.glob("*.whl")):
        candidates = [app / "wheelhouse" / wheel.name]
        with zipfile.ZipFile(wheel) as archive:
            for name in archive.namelist():
                if name.endswith("/"):
                    continue
                parts = safe_relative(name).parts
                destination = site / Path(*parts)
                if len(parts) >= 3 and parts[0].endswith(".data"):
                    schemes = {"purelib": site, "platlib": site, "scripts": prefix / "Scripts", "data": prefix,
                               "headers": prefix / "Include/site/python3.12" / parts[0]}
                    destination = schemes.get(parts[1], site) / Path(*parts[2:])
                candidates.append(destination)
                if destination.suffix == ".py":
                    from importlib.util import cache_from_source
                    candidates.append(Path(cache_from_source(str(destination))))
        for destination in candidates:
            if len(str(destination)) > len(longest):
                longest = str(destination)
    # Leave room for pip's atomic replacement names as well as Windows' NUL.
    result = {"long_paths_enabled": long_paths_enabled, "longest_destination_characters": len(longest),
              "temporary_path_reserve_characters": 16, "legacy_path_limit_characters": 259}
    if long_paths_enabled is not True and len(longest) + 16 > 259:
        raise RuntimeError("安装路径预计超过 Windows 默认长度限制（目标最长 " + str(len(longest))
                           + " 字符；LongPathsEnabled=" + str(long_paths_enabled)
                           + "）。请把 storage.data_dir 改为 D:/CableSimPro-data 等较短路径后重试；无需修改系统策略。")
    return result


def native_runtime_policy(root: Path) -> dict | None:
    path = root / "runtime/native-manifest.json"
    if sys.platform != "linux" or not path.is_file():
        return None
    value = json.loads(path.read_text("utf-8"))
    required = value.get("minimum_glibc", "")
    if value.get("format") != "cablesim.native-runtime/1" or not re.fullmatch(r"\d+\.\d+", required):
        raise RuntimeError("随包 Linux 原生运行库的版本清单不合法。")
    try:
        observed = os.confstr("CS_GNU_LIBC_VERSION") or ""
    except (ValueError, OSError):
        observed = ""
    current = observed.split()[-1] if observed.startswith("glibc ") else ""
    if not re.fullmatch(r"\d+\.\d+", current):
        raise RuntimeError("此 Linux 发行包需要 glibc；当前系统无法核实兼容的 glibc 版本。")
    if tuple(map(int, current.split("."))) < tuple(map(int, required.split("."))):
        raise RuntimeError(f"此发行包需要 glibc >= {required}，当前为 {current}；请使用面向当前系统构建的发行包。")
    return {"minimum_glibc": required, "current_glibc": current}


def environment(value: dict, app: Path) -> dict[str, str]:
    """Bind every runtime path; never inherit a developer/test database or donor."""
    directory = value["data_dir"]
    trusted_hosts = list(value["server"]["trusted_hosts"])
    if value["server"]["host"] not in {"0.0.0.0", "::"}:
        trusted_hosts.append(value["server"]["host"])
    env = {**os.environ, "CABLESIM_DB": str(directory / "engineering.sqlite"),
           "CABLESIM_DATASETS_DIR": str(directory / "datasets"),
           "CABLESIM_REPRODUCTION_LIBRARY": str(directory / "library"),
           "CABLESIM_ENGINEERING_EVIDENCE": str(directory / "engineering-evidence"),
           "CABLESIM_FRONTEND_DIST": str(app / "frontend/dist"),
           "CABLESIM_PLUGIN_PYTHON": str(python_path(app)),
           "CABLESIM_TRUSTED_HOSTS": ",".join(trusted_hosts),
           "CABLESIM_LLM_BASE_URL": value["model"]["base_url"],
           "CABLESIM_LLM_MODEL": value["model"]["model"],
           "CABLESIM_LLM_API_KEY": os.environ.get(value["model"]["api_key_env"], ""),
           "PIP_NO_INDEX": "1", "PIP_DISABLE_PIP_VERSION_CHECK": "1",
           "PYTHONUTF8": "1", "PYTHONDONTWRITEBYTECODE": "1", "NODE_ENV": "production"}
    libraries = app / "runtime/linux-libs"
    if sys.platform == "linux" and libraries.is_dir():
        previous = env.get("LD_LIBRARY_PATH", "")
        env["LD_LIBRARY_PATH"] = str(libraries) + (os.pathsep + previous if previous else "")
        shim = app / "scripts/release_python.sh"
        if shim.is_file():
            env["CABLESIM_PLUGIN_PYTHON"] = str(shim)
    # Keep inherited proxy/CA/identity settings. The runtime never installs or
    # downloads anything; users may explicitly configure an intranet model.
    return env


class InstallLock:
    """Serialize release installation/launchers, separately from the host DB lock."""

    def __init__(self, path: Path):
        self.path, self.stream = path, None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.stream = self.path.open("a+b")
        self.stream.seek(0, 2)
        if not self.stream.tell():
            self.stream.write(b"0")
            self.stream.flush()
        self.stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.stream.close()
            self.stream = None
            raise RuntimeError("该发行数据目录正在安装或运行；请先停止现有进程。") from None
        return self

    def __exit__(self, *_):
        if self.stream:
            self.stream.close()
            self.stream = None


def run_installed(command: list[str], *, app: Path, env: dict) -> int:
    """Replace the Unix wrapper; forward termination to the Windows launcher."""
    if os.name != "nt":
        os.chdir(app)
        os.execve(command[0], command, env)
        raise AssertionError("execve returned")
    process = subprocess.Popen(command, cwd=app, env=env, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    previous = {}

    def stop(_signum, _frame):
        raise KeyboardInterrupt

    for signum in (signal.SIGINT, signal.SIGTERM):
        previous[signum] = signal.signal(signum, stop)
    try:
        return process.wait()
    except KeyboardInterrupt:
        if process.poll() is None:
            try:
                process.send_signal(signal.CTRL_BREAK_EVENT)
                process.wait(timeout=30)
            except (OSError, subprocess.TimeoutExpired):
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], check=False,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return 0
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
