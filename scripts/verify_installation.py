"""Install an actual release archive, exercise its HTTP API and retain evidence.

Run this gate inside the CI operating system's network isolation. It never adds
engineering inputs, approves records, or imports a development database. Every
export consumes the installed release seed and real saved calculation runs.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager, nullcontext
import csv
from hashlib import file_digest, sha256
from html.parser import HTMLParser
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import signal
import shutil
import socket
import stat
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlencode, urljoin, urlsplit
from urllib.request import ProxyHandler, Request, build_opener
from uuid import uuid4
import zipfile

if __package__:
    from .verify_formal_delivery import verify_formal_exports
else:
    from verify_formal_delivery import verify_formal_exports


PROBE_ADDRESSES = ("1.1.1.1", "8.8.8.8", "2606:4700:4700::1111")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def extract_release(archive: Path, destination: Path) -> Path:
    """Reject traversal and links before extracting an externally built bundle."""
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            path = PurePosixPath(entry.filename)
            require(not path.is_absolute() and ".." not in path.parts
                    and "\\" not in entry.filename and ":" not in entry.filename,
                    "发行包包含不安全的路径：" + entry.filename)
            require(not stat.S_ISLNK(entry.external_attr >> 16), "发行包不允许符号链接。")
        bundle.extractall(destination)
    root = destination / "CableSimPro"
    require((root / "scripts/install_release.py").is_file(), "发行包缺少安装入口。")
    require((root / "frontend/dist/index.html").is_file(), "发行包缺少已构建的前端。")
    return root


def offline_probe(*, require_blocked: bool = True) -> list[dict]:
    """Actual sockets complement, but do not replace, the CI OS enforcement."""
    observations = []
    for address in PROBE_ADDRESSES:
        try:
            with socket.create_connection((address, 443), timeout=2):
                connected = True
        except OSError as error:
            connected = False
            reason = type(error).__name__
        observations.append({"address": address, "port": 443, "connected": connected,
                             "result": "外网连接成功" if connected else reason})
    if require_blocked:
        require(not any(item["connected"] for item in observations), "外网仍可连接，拒绝声称离线验证通过。")
    return observations


def installed_offline_probe(interpreter: Path, environment: dict, *, require_blocked: bool = True) -> list[dict]:
    """Exercise the installed interpreter as well as the gate's own Python."""
    script = """import json, socket
observations = []
for address in """ + repr(PROBE_ADDRESSES) + """:
    try:
        with socket.create_connection((address, 443), timeout=2):
            connected, result = True, 'connected'
    except OSError as error:
        connected, result = False, type(error).__name__
    observations.append({'address': address, 'port': 443, 'connected': connected, 'result': result})
print(json.dumps(observations))
"""
    response = subprocess.run([str(interpreter), "-c", script], env=environment,
                              capture_output=True, text=True, encoding="utf-8", check=True, timeout=15)
    observations = json.loads(response.stdout)
    require(len(observations) == len(PROBE_ADDRESSES)
            and (not require_blocked or not any(item["connected"] for item in observations)),
            "已安装 Python 仍可连接外网，离线验证失败。")
    return observations


def loopback_probe(interpreter: Path, environment: dict) -> dict:
    """Exchange real bytes between the gate and the declared child Python."""
    script = """import json, socket, sys
with socket.create_connection(('127.0.0.1', int(sys.argv[1])), timeout=5) as client:
    client.sendall(b'cablesim-preflight')
    if client.makefile('rb').read(len(b'loopback-verified')) != b'loopback-verified':
        raise RuntimeError('Loopback response did not match the request.')
print(json.dumps({'python_executable': sys.executable, 'address': '127.0.0.1', 'round_trip': True}))
"""
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        listener.settimeout(10)
        process = subprocess.Popen([str(interpreter), "-c", script, str(listener.getsockname()[1])],
                                   env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, encoding="utf-8", start_new_session=os.name != "nt",
                                   creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0)
        try:
            with listener.accept()[0] as connection:
                connection.settimeout(5)
                require(connection.makefile("rb").read(len(b"cablesim-preflight")) == b"cablesim-preflight",
                        "本机回环探测未收到预期数据。")
                connection.sendall(b"loopback-verified")
            stdout, stderr = process.communicate(timeout=10)
            require(process.returncode == 0, "本机回环探测子进程失败：" + stderr[-1800:])
            observation = json.loads(stdout)
            require(Path(observation["python_executable"]).absolute() == interpreter.absolute()
                    and observation.get("round_trip") is True, "回环探测未使用声明的 Python。")
            return observation
        except Exception as error:
            stop_process(process)
            _stdout, stderr = process.communicate(timeout=5)
            raise RuntimeError(f"双 Python 回环通信失败：{error}；子进程：{stderr[-1800:]}") from error
        finally:
            stop_process(process)


def linux_graphics_probe(interpreter: Path, configuration: Path, installed: Path, inherited: dict) -> dict:
    """Observe the CAD loader under the installed launcher's exact environment."""
    require(sys.platform == "linux", "Linux 图形运行库验收只能在 Linux 执行。")
    metadata = json.loads((installed / "runtime/native-manifest.json").read_text("utf-8"))
    require(metadata.get("format") == "cablesim.native-runtime/1" and metadata.get("libraries"),
            "发行包缺少原生运行库清单。")
    probe = """import ctypes, json, os, platform, sys
from pathlib import Path
import cadquery
ctypes.CDLL('libGL.so.1')
ctypes.CDLL('libXrender.so.1')
libraries = set()
for line in Path('/proc/self/maps').read_text().splitlines():
    fields = line.split(None, 5)
    if len(fields) == 6 and fields[5].startswith('/'):
        path = Path(fields[5]).resolve()
        if '.so' in path.name:
            libraries.add(path)
print(json.dumps({'cadquery_version': cadquery.__version__, 'python_executable': sys.executable,
    'plugin_python': sys.argv[1], 'glibc': platform.libc_ver(),
    'library_search_path': os.environ.get('LD_LIBRARY_PATH'),
    'mapped_libraries': [str(path) for path in sorted(libraries)]}))
"""
    # LD_LIBRARY_PATH is interpreted by the loader when a process starts. Use
    # the shipped environment builder and exec, rather than assigning it late
    # inside an already running CAD process or relying on runner system libs.
    bootstrap = """import os, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from scripts.release_support import config, environment
settings = environment(config(Path(sys.argv[2])), Path(sys.argv[1]))
plugin_python = settings['CABLESIM_PLUGIN_PYTHON']
os.environ.update(settings)
from backend.plugin_host.executor import minimal_environment
worker_environment = minimal_environment(Path(sys.argv[3]))
os.execve(plugin_python, [plugin_python, '-I', '-c', """ + repr(probe) + """, plugin_python], worker_environment)
"""
    with TemporaryDirectory(prefix="cablesim-cad-probe-") as job:
        response = subprocess.run([str(interpreter), "-c", bootstrap, str(installed), str(configuration), job],
                                  cwd=job, env=inherited, capture_output=True, text=True,
                                  encoding="utf-8", errors="replace", timeout=90)
    require(response.returncode == 0, "发行插件 Python 图形运行库探测失败：" + response.stderr[-6000:])
    observation = json.loads(response.stdout)
    private = (installed / "runtime/linux-libs").resolve()
    require(bool(observation.get("cadquery_version")), "发行解释器未导入 CAD 库。")
    require(Path(observation["python_executable"]).absolute() == interpreter.absolute(),
            "图形运行库探测未使用本次安装的 Python。")
    mapped = [Path(path) for path in observation.pop("mapped_libraries")]
    observation["libraries"] = []
    for record in metadata["libraries"]:
        observed = [path for path in mapped if path.name == record["soname"]
                    or path.name.startswith(record["soname"] + ".")]
        for path in observed:
            require(private in path.parents and path == (installed / record["path"]).resolve(),
                    "CAD 加载了发行包以外的图形运行库：" + str(path))
            with path.open("rb") as stream:
                actual = file_digest(stream, "sha256").hexdigest()
            require(actual == record["sha256"] and path.stat().st_size == record["size_bytes"],
                    "已加载图形运行库与原生发行清单不一致：" + str(path))
            observation["libraries"].append({"name": record["soname"], "path": str(path), "sha256": actual,
                "size_bytes": path.stat().st_size, "package": record["package"], "package_version": record["package_version"],
                "license_paths": record["license_paths"]})
        require(all((installed / name).is_file() for name in record["license_paths"]),
                "原生运行库缺少许可文件：" + record["soname"])
    for family in ("libGL.so", "libGLX.so", "libXrender.so", "libX11.so"):
        require(any(item["name"].startswith(family) for item in observation["libraries"]),
                "未观察到所需图形运行库：" + family)
    accounted = {item["path"] for item in observation["libraries"]}
    require(not any(path.name.startswith(("libGL", "libXrender", "libX11", "libxcb", "libXau", "libXdmcp"))
                    and str(path) not in accounted for path in mapped),
            "存在未列入原生发行清单的已加载图形运行库。")
    observation["system_runtime"] = [str(path) for path in mapped
        if path.name.startswith(("libc.so", "ld-linux", "libm.so", "libpthread.so", "libdl.so", "librt.so"))]
    observation["minimum_glibc"] = metadata["minimum_glibc"]
    observation["build_distribution"] = metadata["build_distribution"]
    observation["private_library_directory"] = str(private)
    observation["source"] = "installed plugin Python, real minimal worker environment, /proc/self/maps after CAD and GL/Xrender loads"
    return observation


@contextmanager
def windows_firewall(temporary: Path, interpreter: Path, gate):
    """Block only this gate's Python executables, preserving runner connectivity.

    The acceptance configuration has no companion programs. pip, the host and
    all exercised method workers use the declared Python interpreter paths.
    """
    require(os.name == "nt", "Windows 防火墙验收只能在 Windows 执行。")
    powershell = shutil.which("pwsh") or shutil.which("powershell")
    require(bool(powershell), "缺少用于启用和恢复防火墙规则的 PowerShell。")
    programs = sorted({str(Path(sys.executable).resolve()),
                       str(Path(getattr(sys, "_base_executable", sys.executable)).resolve()),
                       str(interpreter.resolve())})
    group = "CableSimPro-offline-" + uuid4().hex
    configuration = temporary / "firewall.json"
    configuration.write_text(json.dumps({"group": group, "programs": programs,
                              "profiles": str(temporary / "firewall-profiles.json")}), encoding="utf-8")
    script = temporary / "firewall.ps1"
    script.write_text(r'''param([string]$Action, [string]$Configuration)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
if ($null -ne $PSStyle) { $PSStyle.OutputRendering = 'PlainText' }
$settings = Get-Content -LiteralPath $Configuration -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Action -eq 'enable') {
    $profiles = @(Get-NetFirewallProfile | Select-Object Name, @{Name='Enabled';Expression={$_.Enabled.ToString()}})
    ConvertTo-Json -InputObject $profiles | Set-Content -LiteralPath $settings.profiles -Encoding UTF8
    foreach ($profile in $profiles) {
        if ($profile.Enabled -ne 'True') {
            Set-NetFirewallProfile -Profile $profile.Name -Enabled True
        }
    }
    $number = 0
    foreach ($program in $settings.programs) {
        $number += 1
        New-NetFirewallRule -DisplayName ($settings.group + '-' + $number) -Group $settings.group `
            -Direction Outbound -Action Block -Program $program -Profile Any -Enabled True `
            -RemoteAddress Any | Out-Null
    }
    $rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Group $settings.group | ForEach-Object {
        $application = $_ | Get-NetFirewallApplicationFilter
        $addresses = $_ | Get-NetFirewallAddressFilter
        [pscustomobject]@{name=$_.DisplayName; program=$application.Program;
            enabled=$_.Enabled.ToString(); action=$_.Action.ToString(); direction=$_.Direction.ToString();
            profile=$_.Profile.ToString(); remote_addresses=@($addresses.RemoteAddress)}
    })
    ConvertTo-Json -InputObject $rules -Depth 5
} elseif ($Action -eq 'disable') {
    Get-NetFirewallRule -Group $settings.group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    if (Test-Path -LiteralPath $settings.profiles) {
        $profiles = Get-Content -LiteralPath $settings.profiles -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($profile in $profiles) {
            Set-NetFirewallProfile -Profile $profile.Name -Enabled $profile.Enabled
        }
    }
    $remaining = @(Get-NetFirewallRule -PolicyStore ActiveStore -Group $settings.group -ErrorAction SilentlyContinue)
    if ($remaining.Count -ne 0) { throw 'Offline firewall rules remain active after cleanup.' }
    $observed = @(Get-NetFirewallProfile | Select-Object Name, @{Name='Enabled';Expression={$_.Enabled.ToString()}})
    foreach ($profile in $profiles) {
        $actual = @($observed | Where-Object { $_.Name -eq $profile.Name })
        if ($actual.Count -ne 1 -or $actual[0].Enabled -ne $profile.Enabled) {
            throw ('Firewall profile was not restored: ' + $profile.Name)
        }
    }
    ConvertTo-Json -InputObject @{remaining_rule_count=$remaining.Count; restored_profiles=$observed} -Depth 5
} else { throw 'Unknown firewall action' }
''', encoding="utf-8")

    def apply(action):
        try:
            response = subprocess.run([powershell, "-NoProfile", "-NonInteractive", "-File", str(script),
                                       "-Action", action, "-Configuration", str(configuration)],
                                      capture_output=True, encoding="utf-8", errors="replace", timeout=90)
        except subprocess.TimeoutExpired as error:
            with (gate.output / "firewall.log").open("a", encoding="utf-8") as log:
                log.write(action + "\nPowerShell exceeded 90 seconds.\n")
            raise RuntimeError(f"Windows 防火墙 {action} 超过 90 秒；查看 firewall.log。") from error
        with (gate.output / "firewall.log").open("a", encoding="utf-8") as log:
            log.write(action + "\n" + response.stdout + response.stderr + "\n")
        details = (response.stderr.strip() or response.stdout.strip())[-1800:]
        require(response.returncode == 0,
                f"Windows 防火墙 {action} 失败（退出码 {response.returncode}）：{details}；查看 firewall.log。")
        return response.stdout

    failure = None
    try:
        rules = json.loads(apply("enable").lstrip("\ufeff"))
        require(len(rules) == len(programs) and all(rule["enabled"] == "True"
                and rule["action"] == "Block" and rule["direction"] == "Outbound"
                and rule["profile"] == "Any" and rule["remote_addresses"] == ["Any"] for rule in rules)
                and {os.path.normcase(str(Path(rule["program"]).resolve())) for rule in rules}
                == {os.path.normcase(program) for program in programs},
                "未启用全部应用 Python 的外网阻断规则。")
        gate.artifact("windows-firewall-rules.json", {"scope": "gate Python, installed host and method Python; no companion programs",
                                                    "policy_store": "ActiveStore", "programs": programs, "rules": rules})
        yield
    except BaseException as error:
        failure = error
        raise
    finally:
        try:
            cleanup = json.loads(apply("disable").lstrip("\ufeff"))
            gate.artifact("windows-firewall-cleanup.json", cleanup)
        except Exception as cleanup_error:
            if failure is not None:
                raise RuntimeError(f"原始失败：{failure}；防火墙清理也失败：{cleanup_error}") from cleanup_error
            raise


def no_node_environment(directory: Path) -> dict[str, str]:
    """Provide Python/system commands while making Node/npm unavailable."""
    commands = directory / "commands"
    commands.mkdir()
    paths = [str(commands)]
    if os.name == "nt":
        windows = Path(os.environ["SystemRoot"])
        paths.extend([str(windows / "System32"), str(windows),
                      str(windows / "System32/WindowsPowerShell/v1.0")])
    else:
        # Do not inherit /usr/bin wholesale: some runners install Node there.
        for name in ("sh", "bash", "uname", "ldconfig"):
            executable = shutil.which(name)
            if executable:
                (commands / name).symlink_to(executable)
    environment = {**os.environ, "PATH": os.pathsep.join(paths), "PYTHONUTF8": "1",
                   "PIP_NO_INDEX": "1", "PIP_DISABLE_PIP_VERSION_CHECK": "1"}
    for key in ("CABLESIM_DB", "CABLESIM_DATASETS_DIR", "CABLESIM_REPRODUCTION_LIBRARY",
                "CABLESIM_FRONTEND_DIST", "CABLESIM_PLUGIN_PYTHON", "PYTHONPATH"):
        environment.pop(key, None)
    require(shutil.which("node", path=environment["PATH"]) is None, "验收环境仍能找到 Node。")
    require(shutil.which("npm", path=environment["PATH"]) is None, "验收环境仍能找到 npm。")
    return environment


def validate_rating_values(table: dict) -> None:
    """Compare each published table value with the frozen run's actual output."""
    run = table["run"]
    require(run["integrity"] == "verified", "载流量运行完整性未通过。")
    cases = {case["case_id"]: case for case in run["output"]["cases"]}
    inputs = {case["case_id"]: case["input"] for case in run["snapshot"]["cases"]}
    for row in table["rows"]:
        if row["value_a"] is None:
            require(bool(row.get("reason")), "空载流量缺少拒算原因。")
            continue
        document = inputs[row["case_id"]]
        simultaneous = len(document["circuits"]) > 1 and row["condition"]["rating_basis"] == "simultaneous"
        condition = "rating-simultaneous" if simultaneous else "rating"
        entities = {item["id"] for item in document["circuits"]} if simultaneous else {document["circuits"][0]["id"]}
        values = {item["entity"]: item["value"] for item in cases[row["case_id"]]["results"]
                  if item["key"] == "ampacity" and item.get("unit") == "A"
                  and item.get("case", "rating") == condition and item["status"] == "available"
                  and item["entity"] in entities}
        require(set(values) == entities and row["value_a"] == min(values.values()),
                "载流量表的数字与保存运行不一致：" + row["case_id"])


class InstallationGate:
    def __init__(self, output: Path, timeout: int):
        self.output, self.timeout = output, timeout
        self.base_url = ""
        self.http = build_opener(ProxyHandler({}))  # Local API only; never use an external proxy.
        self.result = {"status": "running", "steps": [], "artifacts": [],
                       "transport": "HTTP / installed archive", "node_available": False}

    @contextmanager
    def step(self, title: str):
        row = {"step": title, "status": "running"}
        self.result["steps"].append(row)
        started = time.monotonic()
        try:
            yield row
            row["status"] = "passed"
        except Exception as error:
            row.update(status="failed", error=str(error))
            raise
        finally:
            row["elapsed_s"] = round(time.monotonic() - started, 3)
            print(json.dumps(row, ensure_ascii=False), flush=True)

    def artifact(self, name: str, value) -> Path:
        path = self.output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        data = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8")
        path.write_bytes(data)
        self.result["artifacts"].append({"name": name, "sha256": sha256(data).hexdigest(), "bytes": len(data)})
        return path

    def api(self, method: str, path: str, body=None, *, binary=False, include_headers=False):
        with self.step(method + " " + path.split("?")[0]) as row:
            data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
            request = Request(self.base_url + path, data=data, method=method,
                              headers={"Content-Type": "application/json"})
            try:
                with self.http.open(request, timeout=self.timeout) as response:
                    raw = response.read()
                    row["http_status"] = response.status
                    headers = {key.lower(): value for key, value in response.headers.items()}
            except HTTPError as error:
                raise RuntimeError(f"HTTP {error.code}: {error.read().decode('utf-8', errors='replace')[:6000]}") from error
            content = raw if binary else json.loads(raw)
            return (content, headers) if include_headers else content

    def pdf(self, name: str, raw: bytes, expected: tuple[str, ...]) -> None:
        import fitz

        with self.step("逐页渲染 " + name) as row:
            require(raw.startswith(b"%PDF-"), "接口没有返回 PDF。")
            self.artifact(name, raw)
            with fitz.open(stream=raw, filetype="pdf") as document:
                text = "".join(page.get_text() for page in document)
                compact = "".join(text.split())
                require(all("".join(item.split()) in compact for item in expected), "PDF 缺少所选型号或报告内容。")
                require("\ufffd" not in text, "PDF 包含无法解码的文字。")
                row["pages"] = len(document)
                for number, page in enumerate(document, 1):
                    self.artifact(f"pages/{Path(name).stem}-{number:02}.png",
                                  page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).tobytes("png"))
            self.artifact(name.replace(".pdf", ".txt"), text.encode("utf-8"))

    def wait_ready(self, process: subprocess.Popen) -> None:
        # One public command now performs both installation and startup; keep
        # the former two phase budgets rather than timing out during offline pip.
        deadline = time.monotonic() + 2 * self.timeout
        with self.step("安装包启动、健康检查及升级写保护解除") as row:
            pending_checks = 0
            while time.monotonic() < deadline:
                require(process.poll() is None, "发行启动进程提前退出；查看 startup.log。")
                try:
                    with self.http.open(self.base_url + "/api/health", timeout=1) as response:
                        if json.load(response).get("status") == "ok":
                            # Health remains available while the launcher is
                            # validating an upgrade. An engineering read must
                            # succeed before this gate starts any calculation.
                            with self.http.open(self.base_url + "/api/workspaces", timeout=5) as unlocked:
                                require(unlocked.status == 200 and isinstance(json.load(unlocked), list),
                                        "工程 API 未返回可用的工作区列表。")
                            break
                except HTTPError as error:
                    if error.code != 503:
                        raise
                    pending_checks += 1
                except (URLError, TimeoutError, OSError, ValueError):
                    pass
                time.sleep(.25)
            else:
                raise RuntimeError("发行启动超过等待时限；查看 startup.log。")
            row["engineering_api_status"] = 200
            row["pending_503_retries"] = pending_checks
        self.artifact("health.json", self.api("GET", "/api/health"))
        release = self.api("GET", "/api/release-info")
        require(release["build_id"] == self.result["build_id"], "健康服务不是刚安装的发行版本。")
        self.artifact("running-release.json", release)

    def frontend_assets(self, manifest: dict) -> None:
        """Fetch production entry assets and every shipped WASM over real HTTP."""
        observations = []

        def fetch(path: str, expected_type: set[str], *, keep_body=False) -> bytes:
            relative = unquote(urlsplit(path).path).lstrip("/") or "index.html"
            expected = manifest["files"].get("frontend/dist/" + relative)
            require(expected is not None, "前端引用的文件不在发行清单中：" + path)
            with self.step("前端资源 HTTP GET " + path) as row:
                with self.http.open(self.base_url + path, timeout=self.timeout) as response:
                    media_type = response.headers.get_content_type().lower()
                    require(response.status == 200 and media_type in expected_type,
                            f"前端资源类型不正确：{path} ({media_type})")
                    digest = sha256()
                    size = 0
                    body = bytearray()
                    while chunk := response.read(1024 * 1024):
                        digest.update(chunk)
                        size += len(chunk)
                        if keep_body:
                            body.extend(chunk)
                require(size == expected["size_bytes"] and digest.hexdigest() == expected["sha256"],
                        "HTTP 前端资源与发行清单摘要不一致：" + path)
                row.update(http_status=200, content_type=media_type, bytes=size, sha256=digest.hexdigest())
                observations.append({"path": path, "content_type": media_type, "bytes": size,
                                     "sha256": digest.hexdigest(), "manifest_verified": True})
                return bytes(body)

        raw = fetch("/", {"text/html"}, keep_body=True)
        require(b'id="root"' in raw, "已构建前端没有应用挂载点。")

        class EntryAssets(HTMLParser):
            def __init__(self):
                super().__init__()
                self.references = set()

            def handle_starttag(self, tag, attributes):
                values = dict(attributes)
                if tag == "script" and values.get("src"):
                    self.references.add(values["src"])
                elif tag == "link" and values.get("rel") in {"stylesheet", "modulepreload"} and values.get("href"):
                    self.references.add(values["href"])

        parsed = EntryAssets()
        parsed.feed(raw.decode("utf-8"))
        types = {".js": {"text/javascript", "application/javascript"}, ".mjs": {"text/javascript", "application/javascript"},
                 ".css": {"text/css"}, ".wasm": {"application/wasm"}}
        assets = set()
        for reference in parsed.references:
            url = urlsplit(urljoin(self.base_url + "/", reference))
            require((url.scheme, url.netloc) == ("http", urlsplit(self.base_url).netloc),
                    "前端依赖外部资源，不能作为内网发行包：" + reference)
            path = url.path + ("?" + url.query if url.query else "")
            require(PurePosixPath(url.path).suffix in types, "无法核验前端入口资源类型：" + reference)
            assets.add(path)
        require(any(urlsplit(path).path.endswith((".js", ".mjs")) for path in assets), "前端入口没有实际脚本。")
        require(any(urlsplit(path).path.endswith(".css") for path in assets), "前端入口没有实际样式。")
        wasm = {"/" + quote(name.removeprefix("frontend/dist/"), safe="/")
                for name in manifest["files"] if name.startswith("frontend/dist/") and name.endswith(".wasm")}
        require(bool(wasm), "发行清单没有 WASM 资产。")
        for path in sorted(assets | wasm):
            fetch(path, types[PurePosixPath(urlsplit(path).path).suffix])
        self.artifact("frontend-assets.json", {"assets": observations, "external_resources": [],
                                               "scope": "index entry JS/CSS and every shipped WASM; HTTP bytes, type and SHA-256"})

    def exports(self) -> None:
        selected = []
        workspaces = self.api("GET", "/api/workspaces")
        for summary in workspaces:
            if summary.get("name") != "YJV22-8.7/15 3×300":
                continue
            workspace = self.api("GET", "/api/workspaces/" + summary["id"])
            if not workspace.get("study_cable_reference"):
                selected.append(workspace)
        require(len(selected) == 1, "发布种子缺少唯一的 YJV22-8.7/15 3×300 型号草稿。")
        workspace = selected[0]
        wid = workspace["id"]
        # Resolve the seed's declared standard basis through the normal public
        # generation service. This is an explicit user-equivalent API action;
        # never repair inputs or insert fabricated evidence into the seed.
        generation = self.api("POST", f"/api/types/{wid}/specification/generate", {
            "expected_revision": workspace["revision"], "request_id": str(uuid4()),
            "scope_acknowledged": True})
        self.artifact("specification-generation.json", generation)
        require(generation["status"] == "generated", "规格书生成服务拒绝导出：" + json.dumps(generation, ensure_ascii=False))
        workspace = self.api("GET", "/api/workspaces/" + wid)
        self.artifact("workspace.json", workspace)
        specification = self.api("GET", f"/api/types/{wid}/specification")
        self.artifact("specification.json", specification)
        query = urlencode({"expected_revision": workspace["revision"], "specification_digest": specification["digest"], "audience": "customer"})
        self.pdf("specification.pdf", self.api("GET", f"/api/types/{wid}/specification/file?{query}", binary=True), ("YJV22", "300"))

        studies = self.api("GET", f"/api/workspaces/{wid}/studies")
        tables = [study for study in studies if study["definition"]["driver"]["kind"] == "batch"
                  and study["definition"]["driver"].get("cases") and all(
                      case.get("metadata", {}).get("kind") == "type-rating-table"
                      for case in study["definition"]["driver"]["cases"])]
        require(bool(tables), "发布种子没有载流量表研究；禁止补造验收输入。")
        study = tables[-1]
        prefix = f"/api/workspaces/{wid}/studies/{study['id']}"
        parameters = urlencode({"expected_revision": workspace["revision"], "expected_study_revision": study["revision"]})
        preflight = self.api("GET", prefix + "/preflight?" + parameters)
        require(preflight["ready"], "已保存载流量表预检未通过。")
        run = self.api("POST", prefix + "/runs", {"request_id": str(uuid4()), "expected_revision": workspace["revision"],
                       "expected_study_revision": study["revision"], "scope_acknowledged": True, "lock_digest": preflight["lock_digest"]})
        deadline = time.monotonic() + self.timeout
        while run["status"] in ("accepted", "running", "validating"):
            require(time.monotonic() < deadline, "离线载流量计算超时。")
            time.sleep(.25)
            run = self.api("GET", prefix + "/runs/" + run["id"])
        require(run["status"] in ("succeeded", "partial") and run["integrity"] == "verified", "离线计算未产生通过完整性核验的记录。")
        self.artifact("rating-run.json", run)
        table = self.api("GET", f"/api/design/workspaces/{wid}/rating-table-runs/{run['id']}")
        with self.step("载流量表逐行对照保存运行"):
            validate_rating_values(table)
            require(any(row["value_a"] is not None for row in table["rows"]), "载流量表没有任何已计算结果。")
        self.artifact("ampacity-table.json", table)
        # Retain this independent CSV data comparison alongside the formal API
        # workbook; it remains evidence rather than a server Excel export.
        stream = io.StringIO(newline="")
        writer = csv.writer(stream)
        writer.writerow(["工况", "允许电流 / A", "埋深 / m", "土壤热阻率 / K·m/W", "环境温度 / °C", "状态", "运行记录"])
        for row in table["rows"]:
            condition = row["condition"]
            writer.writerow([row["name"], row["value_a"], condition["depth_m"], condition["soil_rho_k_m_w"],
                             condition["ambient_temperature_c"], row["status"], run["id"]])
        self.artifact("ampacity-values.csv", stream.getvalue().encode("utf-8-sig"))
        # The existing type-table delivery is HTML-only. Exercise the real
        # research PDF endpoint with the separately seeded, single-run study.
        projects = [item for item in workspaces if item.get("name") == "城南线路 · 110 kV 直埋单回"]
        require(len(projects) == 1, "发布种子缺少唯一的直埋单回研究工程。")
        project = projects[0]
        calculation_studies = self.api("GET", f"/api/workspaces/{project['id']}/studies")
        calculation_studies = [item for item in calculation_studies
                               if item["definition"]["method"]["plugin_id"] == "cablesim.iec60287"
                               and item["definition"]["driver"]["kind"] == "single"]
        require(len(calculation_studies) == 1, "发布种子缺少唯一的标准代数直埋校核研究。")
        calculation_study = calculation_studies[0]
        calculation_runs = self.api("GET", f"/api/workspaces/{project['id']}/studies/{calculation_study['id']}/runs")["items"]
        calculation = next((item for item in calculation_runs if item["status"] == "succeeded"
                            and item["integrity"] == "verified" and item["freshness"] == "current"), None)
        require(calculation is not None, "直埋校核缺少通过完整性核验的当前保存运行。")
        self.artifact("calculation-run.json", calculation)
        delivery = self.api("POST", f"/api/workspaces/{project['id']}/deliveries/current",
                            {"run_ids": [calculation["id"]], "request_id": str(uuid4())})
        self.artifact("delivery.json", delivery)
        raw = self.api("GET", f"/api/workspaces/{project['id']}/deliveries/{delivery['id']}/pdf?audience=customer", binary=True)
        self.pdf("calculation.pdf", raw, ("载流量",))
        self.result["engineering_sources"] = {"workspace": wid, "study": study["id"], "run": run["id"],
                                               "specification_sha256": specification["digest"],
                                               "calculation_workspace": project["id"], "calculation_study": calculation_study["id"],
                                               "calculation_run": calculation["id"]}
        verify_formal_exports(self, self.result["engineering_sources"])


def stop_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def firewall_preflight(output: Path, timeout: int) -> int:
    """Fail before expensive builds if Windows cannot enforce the real guard."""
    gate = InstallationGate(output, timeout)
    gate.result.update(transport="Windows firewall preflight / actual Python sockets", preflight_only=True)
    started = time.monotonic()
    try:
        require(os.name == "nt", "Windows 防火墙预检只能在 Windows 执行。")
        with TemporaryDirectory(prefix="cablesim-firewall-") as directory:
            temporary = Path(directory)
            environment = no_node_environment(temporary)
            virtualenv = temporary / "program/.venv"
            with gate.step("创建实际临时 Python 环境用于防火墙预检"):
                with (output / "preflight-python.log").open("wb") as log:
                    subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(virtualenv)],
                                   env=environment, stdout=log, stderr=subprocess.STDOUT,
                                   check=True, timeout=min(timeout, 90))
            interpreter = virtualenv / "Scripts/python.exe"
            require(interpreter.is_file(), "预检没有生成实际的临时 Python。")
            with gate.step("记录加规则前双 Python 的真实外网连通性"):
                baseline = {"gate_python": offline_probe(require_blocked=False),
                    "temporary_python": installed_offline_probe(interpreter, environment, require_blocked=False)}
                gate.artifact("external-baseline.json", baseline)
                require(all(any(probe["connected"] for probe in probes) for probes in baseline.values()),
                        "预检端点在加规则前已全部不可达，无法实证防火墙阻断；查看 external-baseline.json。")
            with windows_firewall(temporary, interpreter, gate):
                with gate.step("有效防火墙下双 Python 外网连接必须失败"):
                    gate.result["offline"] = {"enforcement": "windows-firewall",
                        "probes": offline_probe(),
                        "temporary_python_probes": installed_offline_probe(interpreter, environment)}
                    gate.result["offline"]["previously_connected_endpoints"] = {
                        name: [probe["address"] for probe in probes if probe["connected"]]
                        for name, probes in baseline.items()}
                with gate.step("有效防火墙下实际双 Python 回环通信必须成功"):
                    gate.artifact("loopback.json", loopback_probe(interpreter, environment))
        gate.result["status"] = "passed"
    except Exception as error:
        gate.result.update(status="failed", error=str(error), error_type=type(error).__name__)
    finally:
        gate.result["elapsed_s"] = round(time.monotonic() - started, 3)
        (output / "result.json").write_text(json.dumps(gate.result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": gate.result["status"], "report": str(output / "result.json"),
                      "error": gate.result.get("error")}, ensure_ascii=False), flush=True)
    return 0 if gate.result["status"] == "passed" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--archive", type=Path)
    mode.add_argument("--windows-firewall-preflight", action="store_true",
                      help="Verify the actual Windows guard before building a release; no installation claim.")
    parser.add_argument("--output", type=Path, required=True, help="New evidence directory; no generated files are committed.")
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--require-offline", choices=("linux-network-namespace", "windows-firewall"))
    args = parser.parse_args()
    require(args.timeout_seconds > 0, "等待时限须为正数。")
    output = args.output.resolve()
    require(not output.exists(), "验收输出目录已存在，拒绝覆盖。")
    output.mkdir(parents=True)
    if args.windows_firewall_preflight:
        return firewall_preflight(output, args.timeout_seconds)
    gate = InstallationGate(output, args.timeout_seconds)
    process = None
    started = time.monotonic()
    try:
        if not args.require_offline:
            gate.result["offline"] = {"status": "云端无法验证", "reason": "此次运行没有启用操作系统禁网。"}
        # A fresh short Windows path exercises ordinary MAX_PATH-compatible
        # destinations even when the hosted runner enables long paths globally.
        with TemporaryDirectory(prefix="cs-" if os.name == "nt" else "cablesim-install-",
                                dir=Path.home() if os.name == "nt" else None) as directory:
            temporary = Path(directory)
            with gate.step("从发行压缩包解压到全新目录"):
                archive = args.archive.resolve()
                root = extract_release(archive, temporary)
                with archive.open("rb") as stream:
                    gate.result["archive"] = {"name": archive.name, "sha256": file_digest(stream, "sha256").hexdigest()}
                manifest = json.loads((root / "release-manifest.json").read_text("utf-8"))
                require(isinstance(manifest.get("build_id"), str) and len(manifest["build_id"]) == 64
                        and all(value in "0123456789abcdef" for value in manifest["build_id"]), "发行标识无效。")
                gate.result["build_id"] = manifest["build_id"]
                gate.artifact("release-manifest.json", manifest)
            environment = no_node_environment(temporary)
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                port = listener.getsockname()[1]
            gate.base_url = f"http://127.0.0.1:{port}"
            configuration = root / "acceptance.toml"
            configuration.write_text("[server]\nhost = \"127.0.0.1\"\nport = " + str(port)
                                     + "\nopen_browser = false\nstartup_timeout_seconds = " + str(min(args.timeout_seconds, 1800))
                                     + "\n[storage]\ndata_dir = "
                                     + json.dumps(str(temporary / "data"))
                                     + "\n[initialization]\nseed_examples = true\n[model]\nbase_url = \"\"\nmodel = \"\"\napi_key_env = \"CABLESIM_LLM_API_KEY\"\n", encoding="utf-8")
            release_spec = importlib.util.spec_from_file_location("cablesim_bundle_release_support", root / "scripts/release_support.py")
            release_support = importlib.util.module_from_spec(release_spec)
            release_spec.loader.exec_module(release_support)
            installed = release_support.installation(temporary / "data", manifest["build_id"])
            interpreter = installed / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            if os.name == "nt":
                with gate.step("真实 wheel 路径满足 Windows 默认长度限制"):
                    defaults = release_support.config(root / "release.toml")
                    default_app = release_support.installation(defaults["data_dir"], manifest["build_id"])
                    # This is a conservative path calculation, not a registry
                    # change or a claim that this runner disables long paths.
                    default_policy = release_support.windows_path_policy(default_app, root / "wheelhouse",
                                                                          long_paths_enabled=False)
                    actual_policy = release_support.windows_path_policy(installed, root / "wheelhouse",
                                                                         long_paths_enabled=False)
                    gate.artifact("windows-default-paths.json", {
                        "actual_registry_long_paths_enabled": release_support.windows_long_paths_enabled(),
                        "default_data_dir": str(defaults["data_dir"]), "default_path_policy": default_policy,
                        "acceptance_data_dir": str(temporary / "data"), "acceptance_path_policy": actual_policy,
                        "registry_changed": False})
            guard = windows_firewall(temporary, interpreter, gate) if args.require_offline == "windows-firewall" else nullcontext()
            with guard:
                if args.require_offline:
                    with gate.step("操作系统禁网及实际外网连接探测"):
                        gate.result["offline"] = {"enforcement": args.require_offline, "probes": offline_probe()}
                command = [sys.executable, str(root / "scripts/install_release.py"), "--config", str(configuration), "--no-browser"]
                gate.artifact("installation-command.json", {"argv": command, "default_start": True,
                                                            "node_available": False, "combined_log": "startup.log"})
                with (output / "startup.log").open("wb") as log:
                    process = subprocess.Popen(command,
                                               cwd=temporary, env=environment, stdout=log, stderr=subprocess.STDOUT,
                                               start_new_session=os.name != "nt",
                                               creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0)
                    try:
                        with gate.step("发行包默认一条命令：无 Node、离线安装并启动"):
                            gate.wait_ready(process)
                            receipt = json.loads((temporary / "data/installations" / (manifest["build_id"] + ".json")).read_text("utf-8"))
                            require(Path(receipt["app_dir"]).resolve() == installed.resolve() and interpreter.is_file(),
                                    "安装回执未指向预期的发行环境。")
                            gate.artifact("installation-receipt.json", receipt)
                            if args.require_offline:
                                gate.result["offline"]["installed_after_start_probes"] = installed_offline_probe(interpreter, environment)
                        gate.frontend_assets(manifest)
                        if sys.platform == "linux":
                            with gate.step("实际 CAD 插件进程加载发行包私有图形运行库"):
                                gate.artifact("native-runtime-manifest.json", json.loads(
                                    (installed / "runtime/native-manifest.json").read_text("utf-8")))
                                gate.artifact("linux-graphics-runtime.json", linux_graphics_probe(
                                    interpreter, configuration, installed, environment))
                        gate.exports()
                        if args.require_offline:
                            gate.result["offline"]["after_export_probes"] = offline_probe()
                            gate.result["offline"]["installed_after_export_probes"] = installed_offline_probe(interpreter, environment)
                    finally:
                        stop_process(process)
                        process = None
        gate.result["status"] = "passed"
    except Exception as error:
        gate.result.update(status="failed", error=str(error), error_type=type(error).__name__)
    finally:
        if process is not None:
            stop_process(process)
        gate.result["elapsed_s"] = round(time.monotonic() - started, 3)
        (output / "result.json").write_text(json.dumps(gate.result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": gate.result["status"], "report": str(output / "result.json"), "error": gate.result.get("error")}, ensure_ascii=False), flush=True)
    return 0 if gate.result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
