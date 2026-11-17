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
from urllib.parse import urlencode
from urllib.request import ProxyHandler, Request, build_opener
from uuid import uuid4
import zipfile


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


def offline_probe() -> list[dict]:
    """Actual sockets complement, but do not replace, the CI OS enforcement."""
    observations = []
    for address in ("1.1.1.1", "8.8.8.8"):
        try:
            with socket.create_connection((address, 443), timeout=2):
                connected = True
        except OSError as error:
            connected = False
            reason = type(error).__name__
        observations.append({"address": address, "port": 443, "connected": connected,
                             "result": "外网连接成功" if connected else reason})
    require(not any(item["connected"] for item in observations), "外网仍可连接，拒绝声称离线验证通过。")
    return observations


def installed_offline_probe(interpreter: Path, environment: dict) -> list[dict]:
    """Exercise the installed interpreter as well as the gate's own Python."""
    script = """import json, socket
observations = []
for address in ('1.1.1.1', '8.8.8.8'):
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
    require(len(observations) == 2 and not any(item["connected"] for item in observations),
            "已安装 Python 仍可连接外网，离线验证失败。")
    return observations


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
            -Direction Outbound -Action Block -Program $program -Profile Any `
            -RemoteAddress '0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255','::/0' | Out-Null
    }
    $rules = @(Get-NetFirewallRule -Group $settings.group | ForEach-Object {
        $application = $_ | Get-NetFirewallApplicationFilter
        $addresses = $_ | Get-NetFirewallAddressFilter
        [pscustomobject]@{name=$_.DisplayName; program=$application.Program;
            enabled=$_.Enabled.ToString(); action=$_.Action.ToString(); direction=$_.Direction.ToString();
            remote_addresses=@($addresses.RemoteAddress)}
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
} else { throw 'Unknown firewall action' }
''', encoding="utf-8")

    def apply(action):
        response = subprocess.run([powershell, "-NoProfile", "-NonInteractive", "-File", str(script),
                                   "-Action", action, "-Configuration", str(configuration)],
                                  capture_output=True, encoding="utf-8", errors="replace", timeout=90)
        with (gate.output / "firewall.log").open("a", encoding="utf-8") as log:
            log.write(action + "\n" + response.stdout + response.stderr + "\n")
        require(response.returncode == 0, "Windows 防火墙操作失败；查看 firewall.log。")
        return response.stdout

    try:
        rules = json.loads(apply("enable").lstrip("\ufeff"))
        require(len(rules) == len(programs) and all(rule["enabled"] == "True"
                and rule["action"] == "Block" and rule["direction"] == "Outbound" for rule in rules),
                "未启用全部应用 Python 的外网阻断规则。")
        gate.artifact("windows-firewall-rules.json", {"scope": "gate Python, installed host and method Python; no companion programs",
                                                    "programs": programs, "rules": rules})
        yield
    finally:
        apply("disable")


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

    def api(self, method: str, path: str, body=None, *, binary=False):
        with self.step(method + " " + path.split("?")[0]) as row:
            data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
            request = Request(self.base_url + path, data=data, method=method,
                              headers={"Content-Type": "application/json"})
            try:
                with self.http.open(request, timeout=self.timeout) as response:
                    raw = response.read()
                    row["http_status"] = response.status
            except HTTPError as error:
                raise RuntimeError(f"HTTP {error.code}: {error.read().decode('utf-8', errors='replace')[:6000]}") from error
            return raw if binary else json.loads(raw)

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
        deadline = time.monotonic() + self.timeout
        with self.step("安装包启动与健康检查"):
            while time.monotonic() < deadline:
                require(process.poll() is None, "发行启动进程提前退出；查看 startup.log。")
                try:
                    with self.http.open(self.base_url + "/api/health", timeout=1) as response:
                        if json.load(response).get("status") == "ok":
                            break
                except (URLError, TimeoutError, OSError, ValueError):
                    pass
                time.sleep(.25)
            else:
                raise RuntimeError("发行启动超过等待时限；查看 startup.log。")
            with self.http.open(self.base_url + "/", timeout=5) as response:
                require(response.status == 200 and b'id="root"' in response.read(), "已构建前端没有正常提供。")
        self.artifact("health.json", self.api("GET", "/api/health"))
        release = self.api("GET", "/api/release-info")
        require(release["build_id"] == self.result["build_id"], "健康服务不是刚安装的发行版本。")
        self.artifact("running-release.json", release)

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
        # Until the formal Excel API is added, retain an exact data comparison;
        # this CSV is evidence and is not represented as a server Excel export.
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
        self.result["formal_documents"] = "后续正式版式阶段待验收；当前验证发行包的既有 PDF 和载流量数据接口。"


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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="New evidence directory; no generated files are committed.")
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--require-offline", choices=("linux-network-namespace", "windows-firewall"))
    args = parser.parse_args()
    require(args.timeout_seconds > 0, "等待时限须为正数。")
    output = args.output.resolve()
    require(not output.exists(), "验收输出目录已存在，拒绝覆盖。")
    output.mkdir(parents=True)
    gate = InstallationGate(output, args.timeout_seconds)
    process = None
    started = time.monotonic()
    try:
        if not args.require_offline:
            gate.result["offline"] = {"status": "云端无法验证", "reason": "此次运行没有启用操作系统禁网。"}
        with TemporaryDirectory(prefix="cablesim-install-") as directory:
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
            installed = temporary / "data/programs" / manifest["build_id"]
            interpreter = installed / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            guard = windows_firewall(temporary, interpreter, gate) if args.require_offline == "windows-firewall" else nullcontext()
            with guard:
                if args.require_offline:
                    with gate.step("操作系统禁网及实际外网连接探测"):
                        gate.result["offline"] = {"enforcement": args.require_offline, "probes": offline_probe()}
                with gate.step("无 Node、离线依赖安装"):
                    with (output / "installation.log").open("wb") as log:
                        subprocess.run([sys.executable, str(root / "scripts/install_release.py"), "--config", str(configuration), "--no-start"],
                                       cwd=temporary, env=environment, stdout=log, stderr=subprocess.STDOUT,
                                       timeout=args.timeout_seconds, check=True)
                receipt = json.loads((temporary / "data/installations" / (manifest["build_id"] + ".json")).read_text("utf-8"))
                require(Path(receipt["app_dir"]).resolve() == installed.resolve() and interpreter.is_file(),
                        "安装回执未指向预期的发行环境。")
                if args.require_offline:
                    gate.result["offline"]["installed_before_start_probes"] = installed_offline_probe(interpreter, environment)
                with (output / "startup.log").open("wb") as log:
                    process = subprocess.Popen([str(interpreter), str(installed / "scripts/run_release.py"), "--config", str(configuration), "--no-browser"],
                                               cwd=temporary, env=environment, stdout=log, stderr=subprocess.STDOUT,
                                               start_new_session=os.name != "nt",
                                               creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0)
                    try:
                        gate.wait_ready(process)
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
