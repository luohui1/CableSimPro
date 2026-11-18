"""The Agent sidecar inside the offline release: what is pinned, what is staged, how it is launched and isolated.

Real archives, the real studio sources and lock, a real stand-in child process and the real release app;
the shipped Node.js itself is exercised by the installation gate (scripts/verify_installation.py).
"""
import io
import json
import os
import re
from pathlib import Path
import socket
import subprocess
import sys
import tarfile
from textwrap import dedent
import time
import zipfile

from fastapi.testclient import TestClient
import pytest

from scripts import install_release, release_agent, release_node_runtime, release_support, run_release
from test_release_installation import package

ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT / "studio"
SECRETS = {"CABLESIM_LLM_API_KEY": "sentinel-llm-key", "CABLE_STUDIO_MODEL_API_KEY": "sentinel-studio-key",
           "OPENAI_API_KEY": "sentinel-openai-key", "LOCAL_MODEL_SECRET": "sentinel-named-key"}


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


# ---- the pinned Node.js runtime -------------------------------------------------------------------------------

def test_node_runtime_lock_pins_one_official_version_for_both_targets():
    lock = json.loads(release_node_runtime.LOCK.read_text("utf-8"))
    assert lock["format"] == "cablesim.node-runtime-lock/1" and set(lock["targets"]) == {"linux", "win32"}
    for name, pin in lock["targets"].items():
        assert pin["url"].startswith("https://nodejs.org/dist/v" + lock["version"] + "/")
        assert pin["root"] in pin["url"] and len(pin["sha256"]) == 64 and set(pin["sha256"]) <= set("0123456789abcdef")
        assert pin["architecture"] == "x86_64"
        assert pin["executable"] == ("node.exe" if name == "win32" else "bin/node")
    # The sidecar's entry file is TypeScript run by Node itself, so the pin must be a release that strips types.
    major, minor, patch = map(int, lock["version"].split("."))
    assert (major, minor) >= (22, 19) and json.loads((STUDIO / "package.json").read_text("utf-8"))["engines"]["node"] == ">=22.19.0"


def test_only_the_interpreter_and_licence_are_taken_from_a_node_archive(tmp_path):
    root = "node-v0.0.0-win-x64"
    members = {root + "/node.exe": b"MZ interpreter", root + "/LICENSE": b"licence", root + "/npm.cmd": b"npm",
               root + "/node_modules/npm/bin/npm-cli.js": b"npm", root + "/README.md": b"readme"}
    archive = tmp_path / "node.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        for name, data in members.items():
            bundle.writestr(name, data)
    pin = {"archive": "zip", "root": root, "executable": "node.exe"}
    target = tmp_path / "runtime/node"
    release_node_runtime.extract_runtime(archive, pin, target)
    assert sorted(path.relative_to(target).as_posix() for path in target.rglob("*") if path.is_file()) == ["LICENSE", "node.exe"]
    assert (target / "node.exe").read_bytes() == b"MZ interpreter"
    with pytest.raises(RuntimeError, match="already exists"):
        release_node_runtime.extract_runtime(archive, pin, target)

    tarball = tmp_path / "node.tar.gz"
    linux_root = "node-v0.0.0-linux-x64"
    with tarfile.open(tarball, "w:gz") as bundle:
        for name, data, mode in ((linux_root + "/bin/node", b"\x7fELF interpreter", 0o755), (linux_root + "/LICENSE", b"licence", 0o644),
                                 (linux_root + "/include/node/node.h", b"header", 0o644)):
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(data), mode
            bundle.addfile(info, io.BytesIO(data))
    linux = tmp_path / "linux/runtime/node"
    release_node_runtime.extract_runtime(tarball, {"archive": "tar.gz", "root": linux_root, "executable": "bin/node"}, linux)
    assert sorted(path.relative_to(linux).as_posix() for path in linux.rglob("*") if path.is_file()) == ["LICENSE", "bin/node"]


def test_an_archive_without_the_interpreter_leaves_no_partial_runtime(tmp_path):
    archive = tmp_path / "node.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("node-v0.0.0-win-x64/LICENSE", b"licence")
    target = tmp_path / "runtime/node"
    with pytest.raises(RuntimeError, match="lacks"):
        release_node_runtime.extract_runtime(archive, {"archive": "zip", "root": "node-v0.0.0-win-x64", "executable": "node.exe"}, target)
    assert not target.exists()


def test_symbol_requirements_of_an_elf_binary_are_read_from_its_version_strings(tmp_path):
    binary = tmp_path / "node"
    binary.write_bytes(b"\x7fELF\0GLIBC_2.2.5\0GLIBC_2.28\0GLIBC_2.9\0GLIBC_PRIVATE\0GLIBCXX_3.4.25\0GLIBCXX_3.4.9\0CXXABI_1.3.11\0")
    assert release_node_runtime.required_symbol_versions(binary) == {"GLIBC": "2.28", "GLIBCXX": "3.4.25"}


def test_the_sidecar_environment_is_an_allow_list_without_credentials_or_proxies():
    inherited = {**SECRETS, "SystemRoot": "C:/Windows", "PATH": "/usr/bin", "TEMP": "/tmp", "NODE_OPTIONS": "--inspect",
                 "HTTPS_PROXY": "http://proxy.invalid:3128", "AWS_SECRET_ACCESS_KEY": "sentinel-aws", "CABLESIM_DB": "/engineering.sqlite"}
    environment = release_node_runtime.isolated_environment(inherited, {"FUSION_PORT": "8111", "NODE_ENV": "development"})
    assert set(environment) == {"SystemRoot", "PATH", "TEMP", "NODE_ENV", "FUSION_PORT"}
    assert environment["NODE_ENV"] == "development" and environment["FUSION_PORT"] == "8111"
    assert release_node_runtime.isolated_environment({"PATH": "/usr/bin"})["NODE_ENV"] == "production"


def test_installed_node_is_only_the_runtime_the_installation_declares(tmp_path):
    executable = release_node_runtime.runtime_path(tmp_path)
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"not really node")
    with pytest.raises(FileNotFoundError):
        release_node_runtime.installed_node(tmp_path)
    metadata = {"format": release_node_runtime.FORMAT, "platform": sys.platform,
                "executable": executable.relative_to(tmp_path).as_posix()}
    (tmp_path / release_node_runtime.METADATA).write_text(json.dumps(metadata), encoding="utf-8")
    assert release_node_runtime.installed_node(tmp_path) == executable
    for change in ({"platform": "darwin"}, {"executable": "runtime/node/other"}, {"format": "other/1"}):
        (tmp_path / release_node_runtime.METADATA).write_text(json.dumps({**metadata, **change}), encoding="utf-8")
        with pytest.raises(RuntimeError, match="missing or invalid"):
            release_node_runtime.installed_node(tmp_path)


# ---- what is staged -------------------------------------------------------------------------------------------

def test_the_sidecar_closure_is_its_own_sources_and_the_packages_it_names():
    files, bare = release_agent.source_closure(STUDIO)
    relative = {path.relative_to(STUDIO).as_posix() for path in files}
    assert {"fusion/server.ts", "fusion/agent.ts", "host/core.ts", "shared/types.ts"} <= relative
    assert not any(name.split("/")[0] in {"ui", "tests", "scripts", "core"} for name in relative)
    declared = json.loads((STUDIO / "package.json").read_text("utf-8"))["dependencies"]
    names = {release_agent.package_name(specifier) for specifier in bare}
    assert {"@earendil-works/pi-ai", "@earendil-works/pi-agent-core", "@earendil-works/pi-coding-agent"} <= names
    assert names <= set(declared) and not names & {"react", "three", "recharts", "motion", "shiki", "@tanstack/react-router"}


def test_directories_the_sidecar_reads_at_run_time_ship_with_it():
    # An import scan cannot see data read by path. Every file of the closure that locates itself on disk must be known:
    # a new one has to be judged (does it read something that must ship?) and added here, or the release is incomplete.
    # server.ts only falls back to a repository path when FUSION_HOME is unset; agent-tools.ts only scrubs the program path.
    files, _ = release_agent.source_closure(STUDIO)
    anchored = {path.relative_to(STUDIO).as_posix() for path in files
                if re.search(r"import\.meta\.(?:url|dirname|filename)", path.read_text("utf-8"))}
    assert anchored == {"fusion/agent.ts", "fusion/server.ts", "host/agent-tools.ts"}
    agent = (STUDIO / "fusion/agent.ts").read_text("utf-8")
    assert re.findall(r"dirname\(fileURLToPath\(import\.meta\.url\)\),\s*'\.\./([\w-]+)'", agent) == ["skills"] == list(release_agent.RUNTIME_DATA)
    tracked = subprocess.check_output(["git", "ls-files", "--", "studio/skills"], cwd=ROOT, text=True).split()
    skills = sorted(path.split("/")[2] for path in tracked if path.endswith("/SKILL.md"))
    assert len(skills) >= 9 and all(path.startswith("studio/skills/") for path in tracked)


def test_source_closure_follows_real_imports_and_ignores_commented_ones(tmp_path):
    (tmp_path / "fusion").mkdir()
    (tmp_path / "fusion/server.ts").write_text(dedent("""\
        // import './only-a-comment.ts'
        /* import x from 'not-a-package'; */
        import { createServer } from 'node:http';
        import { helper } from '../shared/helper.ts';
        import type { Shape } from '@scope/pkg/sub/path';
        const later = () => import('lazy-package');
        """), encoding="utf-8")
    (tmp_path / "shared").mkdir()
    (tmp_path / "shared/helper.ts").write_text("export const helper = 1;\n", encoding="utf-8")
    files, bare = release_agent.source_closure(tmp_path)
    assert [path.relative_to(tmp_path).as_posix() for path in files] == ["fusion/server.ts", "shared/helper.ts"]
    assert bare == {"@scope/pkg/sub/path", "lazy-package"}
    assert {release_agent.package_name(name) for name in bare} == {"@scope/pkg", "lazy-package"}
    (tmp_path / "shared/helper.ts").write_text("import './gone.ts';\n", encoding="utf-8")
    with pytest.raises(RuntimeError, match="does not resolve"):
        release_agent.source_closure(tmp_path)


def test_the_production_lock_keeps_the_pi_packages_and_none_of_the_page_toolchain():
    lock = json.loads((STUDIO / "package-lock.json").read_text("utf-8"))
    package = json.loads((STUDIO / "package.json").read_text("utf-8"))
    _, bare = release_agent.source_closure(STUDIO)
    roots = {name: package["dependencies"][name] for name in sorted({release_agent.package_name(s) for s in bare})}
    derived = release_agent.production_lock(lock, roots, version=package["version"], engines=package["engines"])
    packages = derived["packages"]
    assert packages[""]["dependencies"] == roots and derived["lockfileVersion"] == lock["lockfileVersion"]
    assert {"node_modules/@earendil-works/pi-ai", "node_modules/@earendil-works/pi-coding-agent"} <= set(packages)
    assert not {"node_modules/react", "node_modules/vite", "node_modules/three", "node_modules/typescript"} & set(packages)
    # Every entry is the studio lock's own, with its pinned version, URL and integrity.
    assert all(packages[path] == lock["packages"][path] and packages[path].get("integrity") for path in packages if path)
    assert 50 < len(packages) < len(lock["packages"]) // 2
    # The subset is closed: resolving its own roots against itself reaches exactly its entries.
    assert release_agent.lock_closure(derived, roots) == sorted(path for path in packages if path)
    with pytest.raises(RuntimeError, match="not what studio/package-lock.json pins"):
        release_agent.lock_closure(lock, {"@earendil-works/pi-ai": "0.0.1"})


def test_the_installed_dependency_tree_loses_command_shims_at_every_depth(tmp_path):
    modules = tmp_path / "node_modules"
    for name in (".bin", "a/node_modules/.bin", "a/node_modules/b/node_modules/.bin"):
        shim = modules / name
        shim.mkdir(parents=True)
        (shim / "tool.cmd").write_text("@echo off", encoding="utf-8")
    (modules / "a/index.js").write_text("module.exports = 1;", encoding="utf-8")
    (modules / ".package-lock.json").write_text("{}", encoding="utf-8")
    release_agent.prune_installed_tree(modules)
    assert sorted(path.relative_to(modules).as_posix() for path in modules.rglob("*")) == [
        "a", "a/index.js", "a/node_modules", "a/node_modules/b", "a/node_modules/b/node_modules"]


def test_command_links_npm_makes_on_linux_are_dropped_and_any_other_link_is_refused(tmp_path):
    modules = tmp_path / "node_modules"
    package = modules / "a/node_modules/semver"
    (package / "bin").mkdir(parents=True)
    (package / "bin/semver.js").write_text("#!/usr/bin/env node\n", encoding="utf-8")
    shims = modules / "a/node_modules/.bin"
    shims.mkdir()
    try:
        # The exact shape of the failure npm caused on Linux: a package's own .bin holding a link to its command.
        (shims / "semver").symlink_to("../semver/bin/semver.js")
        (modules / ".bin").symlink_to(shims, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("this host cannot create symbolic links")
    release_agent.prune_installed_tree(modules)
    assert not (modules / ".bin").exists() and not shims.exists() and (package / "bin/semver.js").is_file()
    (package / "bin/alias.js").symlink_to("semver.js")
    with pytest.raises(RuntimeError, match="符号链接.*alias.js"):
        release_agent.prune_installed_tree(modules)


# ---- configuration: one place for the model, a port for the sidecar -----------------------------------------------

def test_the_shipped_configuration_enables_the_sidecar_on_its_own_loopback_port(tmp_path):
    shipped = tmp_path / "release.toml"
    shipped.write_text((ROOT / "scripts/release.toml").read_text("utf-8"), encoding="utf-8")
    settings = release_support.config(shipped)
    assert settings["agent"] == {"enabled": True, "port": 8111} and settings["server"]["port"] == 8100
    shipped.write_text("", encoding="utf-8")
    assert release_support.config(shipped)["agent"] == {"enabled": True, "port": 8111}
    for text, message in (('[agent]\nport = 8100\n', "不能与 server.port 相同"), ('[agent]\nport = 0\n', "1–65535"),
                          ('[agent]\nport = "8111"\n', "1–65535"), ('[agent]\nenabled = "yes"\n', "布尔"),
                          ('[agent]\nhost = "0.0.0.0"\n', "不支持"), ('[server]\nport = 8111\n', "不能与 server.port 相同")):
        shipped.write_text(text, encoding="utf-8")
        with pytest.raises(RuntimeError, match=message):
            release_support.config(shipped)
    shipped.write_text("[agent]\nenabled = false\nport = 9000\n", encoding="utf-8")
    assert release_support.config(shipped)["agent"] == {"enabled": False, "port": 9000}


def model_environment(monkeypatch, toml: str, tmp_path: Path, **variables) -> dict:
    for name in ("CABLESIM_LLM_BASE_URL", "CABLESIM_LLM_MODEL", "CABLESIM_LLM_API_KEY", "CABLE_STUDIO_MODEL_BASE_URL",
                 "CABLE_STUDIO_MODEL_ID", "CABLE_STUDIO_MODEL_API_KEY", "LOCAL_MODEL_SECRET"):
        monkeypatch.delenv(name, raising=False)
    for name, value in variables.items():
        monkeypatch.setenv(name, value)
    configuration = tmp_path / "release.toml"
    configuration.write_text(toml, encoding="utf-8")
    environment = release_support.environment(release_support.config(configuration), tmp_path / "app")
    # The backend resolves exactly what its own process environment holds.
    for name in ("CABLESIM_LLM_BASE_URL", "CABLESIM_LLM_MODEL", "CABLESIM_LLM_API_KEY"):
        monkeypatch.setenv(name, environment[name])
    from backend.harness.model_settings import ModelSettings
    return ModelSettings.environment()


def test_a_model_is_configured_in_one_place_whichever_of_the_three_sources_holds_it(tmp_path, monkeypatch):
    studio = {"CABLE_STUDIO_MODEL_BASE_URL": "https://studio.example/v1", "CABLE_STUDIO_MODEL_ID": "studio-model",
              "CABLE_STUDIO_MODEL_API_KEY": SECRETS["CABLE_STUDIO_MODEL_API_KEY"]}
    # Nothing configured: the platform reports no model and the Agent page says where to set one.
    assert not any(model_environment(monkeypatch, "", tmp_path).values())
    # The demo launcher's variables reach the backend through a release launch unchanged (a blank [model] erases nothing).
    assert model_environment(monkeypatch, "", tmp_path, **studio) == {
        "base_url": "https://studio.example/v1", "model": "studio-model", "api_key": SECRETS["CABLE_STUDIO_MODEL_API_KEY"]}
    # The platform's own CABLESIM_LLM_* variables are no longer blanked by an empty release.toml either.
    original = {"CABLESIM_LLM_BASE_URL": "https://original.example/v1", "CABLESIM_LLM_MODEL": "original-model",
                "CABLESIM_LLM_API_KEY": SECRETS["CABLESIM_LLM_API_KEY"]}
    assert model_environment(monkeypatch, "", tmp_path, **original, **studio)["model"] == "original-model"
    # release.toml names the endpoint, the key comes from the variable it points at: a complete trio.
    named = '[model]\nbase_url = "https://file.example/v1"\nmodel = "file-model"\napi_key_env = "LOCAL_MODEL_SECRET"\n'
    assert model_environment(monkeypatch, named, tmp_path, LOCAL_MODEL_SECRET=SECRETS["LOCAL_MODEL_SECRET"]) == {
        "base_url": "https://file.example/v1", "model": "file-model", "api_key": SECRETS["LOCAL_MODEL_SECRET"]}
    # A file that names the connection never borrows a key from elsewhere: api_key_env unset means no key, so no model.
    assert model_environment(monkeypatch, named, tmp_path, CABLESIM_LLM_API_KEY=SECRETS["CABLESIM_LLM_API_KEY"])["api_key"] == ""
    # ... nor a model name: half a connection in the file stays half, whatever the environment holds.
    half = '[model]\nbase_url = "https://file.example/v1"\n'
    assert model_environment(monkeypatch, half, tmp_path, CABLESIM_LLM_MODEL="other-provider-model") == {
        "base_url": "https://file.example/v1", "model": "", "api_key": ""}
    # Endpoint, model and key of different sources are never mixed: half a file plus a full studio trio uses the trio.
    assert model_environment(monkeypatch, '[model]\nmodel = "only-a-name"\n', tmp_path, **studio)["base_url"] == "https://studio.example/v1"


# ---- launching ----------------------------------------------------------------------------------------------------

def stand_in_agent(app: Path) -> None:
    """A real child process that answers like the sidecar's guarded API and reports the environment it was given."""
    entry = app / "agent/fusion/server.ts"
    entry.parent.mkdir(parents=True)
    entry.write_text(dedent("""\
        import json, os, sys
        from http.server import BaseHTTPRequestHandler, HTTPServer
        from pathlib import Path

        Path(os.environ["FUSION_HOME"], "seen-environment.json").write_text(json.dumps(dict(os.environ)), encoding="utf-8")

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                authorized = self.headers.get("Authorization") == "Bearer " + os.environ["CABLESIM_AGENT_SIDECAR_TOKEN"]
                body = json.dumps({"agent": {"configured": False, "hint": "stand-in"}} if authorized else {"error": "no token"}).encode()
                self.send_response(200 if authorized else 401)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *arguments):
                pass

        HTTPServer(("127.0.0.1", int(os.environ["FUSION_PORT"])), Handler).serve_forever()
        """), encoding="utf-8")
    (app / "agent/dist-fusion").mkdir()
    (app / "agent/dist-fusion/fusion.html").write_text("<div id=root>agent page</div>", encoding="utf-8")
    (app / "agent/agent.json").write_text(json.dumps({"format": "cablesim.agent/1", "entry": "fusion/server.ts",
                                                      "ui": "dist-fusion"}), encoding="utf-8")
    executable = release_node_runtime.runtime_path(app)
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"stand-in")
    (app / release_node_runtime.METADATA).write_text(json.dumps({
        "format": release_node_runtime.FORMAT, "platform": sys.platform, "minimum_glibc": "2.17",
        "executable": executable.relative_to(app).as_posix()}), encoding="utf-8")


def test_the_platform_and_the_sidecar_share_one_private_token_and_the_sidecar_holds_no_model_key(tmp_path, monkeypatch):
    app = tmp_path / "program"
    stand_in_agent(app)
    bundle = package(app)
    monkeypatch.setattr(run_release, "ROOT", app)
    monkeypatch.setattr(release_node_runtime, "installed_node", lambda _root: Path(sys.executable))
    data, agent_port, server_port = tmp_path / "data", free_port(), free_port()
    configuration = tmp_path / "release.toml"
    configuration.write_text(f'[server]\nport = {server_port}\n[storage]\ndata_dir = {json.dumps(str(data))}\n'
                             f'[agent]\nport = {agent_port}\n[model]\napi_key_env = "LOCAL_MODEL_SECRET"\n', encoding="utf-8")
    for name, value in {**SECRETS, "HTTPS_PROXY": "http://proxy.invalid:3128", "NODE_OPTIONS": "--inspect"}.items():
        monkeypatch.setenv(name, value)
    settings = release_support.config(configuration)
    env = release_support.environment(settings, app)
    link = run_release.agent_link(settings, env, app)
    assert "CABLESIM_AGENT_SIDECAR_TOKEN" not in env, "the token is the platform's and the sidecar's alone, never the shared environment"
    assert link and link["command"] == [sys.executable, "fusion/server.ts"] and link["cwd"] == app / "agent"
    assert (data / "agent").is_dir()
    token = link["backend_env"]["CABLESIM_AGENT_SIDECAR_TOKEN"]
    assert len(token) >= 40 and link["env"]["CABLESIM_AGENT_SIDECAR_TOKEN"] == token
    assert link["backend_env"] == {"CABLESIM_AGENT_SIDECAR_TOKEN": token,
                                   "CABLESIM_AGENT_SIDECAR_URL": f"http://127.0.0.1:{agent_port}",
                                   "CABLESIM_AGENT_UI": str(app / "agent/dist-fusion")}
    assert link["env"]["FUSION_BACKEND_URL"] == f"http://127.0.0.1:{server_port}" and link["env"]["FUSION_PORT"] == str(agent_port)
    assert link["env"]["FUSION_HOME"] == str(data / "agent")
    assert run_release.agent_link(settings, env, app)["backend_env"]["CABLESIM_AGENT_SIDECAR_TOKEN"] != token, "a token is made per launch"

    # The stand-in is the test runner's own interpreter, which a hosted runner may start only with its loader path;
    # the shipped Node.js needs no such variable and never gets one (see the allow-list test above).
    loader = {name: value for name, value in os.environ.items() if name == "LD_LIBRARY_PATH"}
    process = run_release.spawn(link["command"], cwd=link["cwd"], env={**link["env"], **loader})
    try:
        deadline = time.monotonic() + 30
        while not run_release.agent_listening(agent_port):
            assert process.poll() is None and time.monotonic() < deadline, "the stand-in sidecar did not start"
            time.sleep(.05)
        seen = json.loads((data / "agent/seen-environment.json").read_text("utf-8"))
        assert not [name for name in seen if name.upper() in {"CABLESIM_LLM_API_KEY", "CABLE_STUDIO_MODEL_API_KEY", "OPENAI_API_KEY",
                                                             "LOCAL_MODEL_SECRET", "HTTPS_PROXY", "NODE_OPTIONS", "CABLESIM_DB"}]
        assert not any(secret in value for value in seen.values() for secret in SECRETS.values())
        # The platform, started from the environment the launcher built for it, reaches the sidecar with the shared token.
        for name, value in {**env, **link["backend_env"]}.items():
            monkeypatch.setenv(name, value)
        with TestClient(run_release.create_release_app()) as client:
            status = client.get("/agent-sidecar/api/status")
            assert status.status_code == 200 and status.json() == {"agent": {"configured": False, "hint": "stand-in"}}
            page = client.get("/agent-app/fusion.html")
            assert page.status_code == 200 and "agent page" in page.text
            assert client.get("/api/release-info").json()["build_id"] == bundle["build_id"]
        with socket.create_connection(("127.0.0.1", agent_port), timeout=3) as connection:
            connection.sendall(b"GET /api/status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
            assert connection.makefile("rb").readline().startswith(b"HTTP/1.0 401")
    finally:
        run_release.stop_process(process)
    deadline = time.monotonic() + 10
    while run_release.agent_listening(agent_port) and time.monotonic() < deadline:
        time.sleep(.05)
    assert not run_release.agent_listening(agent_port), "stopping the launcher must stop the sidecar"


def test_the_sidecar_is_not_started_when_disabled_or_when_the_build_has_none(tmp_path, monkeypatch, capsys):
    app = tmp_path / "program"
    configuration = tmp_path / "release.toml"
    configuration.write_text(f'[storage]\ndata_dir = {json.dumps(str(tmp_path / "data"))}\n[agent]\nenabled = false\n', encoding="utf-8")
    settings = release_support.config(configuration)
    assert run_release.agent_link(settings, release_support.environment(settings, app), app) is None
    assert not (tmp_path / "data/agent").exists()
    configuration.write_text(f'[storage]\ndata_dir = {json.dumps(str(tmp_path / "data"))}\n', encoding="utf-8")
    settings = release_support.config(configuration)
    assert run_release.agent_link(settings, release_support.environment(settings, app), app) is None
    assert "不含 Agent" in capsys.readouterr().err


def test_leftover_link_variables_never_reach_the_platform_and_an_unpreparable_agent_never_stops_it(tmp_path, monkeypatch, capsys):
    for name, value in (("CABLESIM_AGENT_SIDECAR_TOKEN", "dev-token"), ("CABLESIM_AGENT_SIDECAR_URL", "http://127.0.0.1:1"),
                        ("CABLESIM_AGENT_UI", "/developer/ui")):
        monkeypatch.setenv(name, value)
    app = tmp_path / "program"
    configuration = tmp_path / "release.toml"
    configuration.write_text(f'[storage]\ndata_dir = {json.dumps(str(tmp_path / "data"))}\n', encoding="utf-8")
    settings = release_support.config(configuration)
    env = release_support.environment(settings, app)
    assert not {"CABLESIM_AGENT_SIDECAR_TOKEN", "CABLESIM_AGENT_SIDECAR_URL", "CABLESIM_AGENT_UI"} & set(env)
    # The build ships an Agent, but its Node.js cannot be prepared on this host: the reason is said and the platform goes on.
    (app / "agent/fusion").mkdir(parents=True)
    (app / "agent/fusion/server.ts").write_text("", encoding="utf-8")
    (app / "agent/agent.json").write_text(json.dumps({"format": "cablesim.agent/1", "entry": "fusion/server.ts", "ui": "dist-fusion"}),
                                          encoding="utf-8")
    assert run_release.agent_link(settings, env, app) is None
    assert "Agent 对话不可用" in capsys.readouterr().err


@pytest.mark.parametrize(("host", "expected"), [("127.0.0.1", "127.0.0.1"), ("0.0.0.0", "127.0.0.1"), ("localhost", "127.0.0.1"),
                                                ("::", "[::1]"), ("::1", "[::1]"), ("192.168.1.8", "192.168.1.8"),
                                                ("fd00::8", "[fd00::8]")])
def test_the_sidecar_reaches_the_platform_at_the_address_it_is_served_on(host, expected):
    assert run_release.connect_host(host) == expected


# ---- installation -------------------------------------------------------------------------------------------------

def test_installation_names_the_agent_payload_and_refuses_a_node_this_host_cannot_run(tmp_path):
    bundle = {"files": {"agent/package.json": {}, "agent/node_modules/a/index.js": {}, "runtime/node/node.exe": {},
                        "runtime/python/python.exe": {}, "frontend/dist/index.html": {}}}
    assert install_release.agent_files(bundle) == ["agent/package.json", "agent/node_modules/a/index.js", "runtime/node/node.exe"]
    assert install_release.verify_node(tmp_path, {"files": {}}, {"agent": {"enabled": True}}) is None, "a build without Node needs no check"
    assert install_release.verify_node(tmp_path, {"node_runtime": {"version": "1"}}, {"agent": {"enabled": False}}) is None
    executable = release_node_runtime.runtime_path(tmp_path)
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"this is not an executable file")
    (tmp_path / release_node_runtime.METADATA).write_text(json.dumps({
        "format": release_node_runtime.FORMAT, "platform": sys.platform, "minimum_glibc": "2.17",
        "executable": executable.relative_to(tmp_path).as_posix()}), encoding="utf-8")
    with pytest.raises(RuntimeError, match=r"enabled = false"):
        install_release.verify_node(tmp_path, {"node_runtime": {"version": "24.0.0"}}, {"agent": {"enabled": True}})


def test_windows_path_check_covers_the_sidecar_dependency_tree(tmp_path):
    wheels = tmp_path / "wheelhouse"
    wheels.mkdir()
    shallow = Path("C:/cs/programs/1234567890123456")
    deep = "agent/node_modules/" + "/".join(["nested-package-name"] * 12) + "/file.js"
    assert release_support.windows_path_policy(shallow, wheels, long_paths_enabled=False, payload=["agent/package.json"])
    with pytest.raises(RuntimeError, match="较短路径"):
        release_support.windows_path_policy(shallow, wheels, long_paths_enabled=False, payload=[deep])
    assert release_support.windows_path_policy(shallow, wheels, long_paths_enabled=True, payload=[deep])["longest_destination_characters"] > 259
