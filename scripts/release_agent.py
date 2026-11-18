"""Stage the Agent sidecar for the offline release (builder side only).

The payload is ``agent/``: the TypeScript sources the sidecar actually imports, a production lock
derived from ``studio/package-lock.json`` (the pi packages and what they pull in, not the page
toolchain), the dependencies installed from that lock without lifecycle scripts, and the built chat
page. The shipped Node.js (``release_node_runtime``) runs ``fusion/server.ts`` directly.
Nothing here runs on the installed system.
"""
from __future__ import annotations

from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

from scripts.release_node_runtime import isolated_environment

ENTRY = "fusion/server.ts"
# Read at run time relative to fusion/ (fusion/agent.ts: SKILLS), so no import reaches them: the nine skills the
# model follows for each task. Every tracked file under these directories ships.
RUNTIME_DATA = ("skills",)
METADATA = "agent/agent.json"
FORMAT = "cablesim.agent/1"
UI_ENTRY = "fusion.html"
IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1""")
BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
LINE_COMMENT = re.compile(r"^[ \t]*//.*$", re.MULTILINE)


def digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def package_name(specifier: str) -> str:
    """'@scope/name/sub/path' -> '@scope/name'; 'name/sub' -> 'name'."""
    parts = specifier.split("/")
    return "/".join(parts[:2]) if specifier.startswith("@") else parts[0]


def source_closure(studio: Path, entry: str = ENTRY) -> tuple[list[Path], set[str]]:
    """Every local file the entry reaches through imports, and every bare package specifier it names.

    Sources use explicit extensions (Node strips types, it does not resolve them), so a specifier either
    names a file or is an error: nothing is guessed and nothing the sidecar needs can be left behind
    silently. Built-ins (``node:``) are not packages.
    """
    studio = studio.resolve()
    seen: dict[Path, None] = {}
    bare: set[str] = set()
    pending = [(studio / entry).resolve()]
    while pending:
        path = pending.pop()
        if path in seen:
            continue
        if not path.is_file() or studio not in path.parents:
            raise RuntimeError("Agent source import does not resolve inside studio/: " + str(path))
        seen[path] = None
        text = LINE_COMMENT.sub("", BLOCK_COMMENT.sub("", path.read_text("utf-8")))
        for _, specifier in IMPORT.findall(text):
            if specifier.startswith("."):
                pending.append((path.parent / specifier).resolve())
            elif not specifier.startswith("node:"):
                bare.add(specifier)
    return sorted(seen), bare


def lock_closure(lock: dict, roots: dict[str, str]) -> list[str]:
    """Lock entries reachable from the roots, resolved the way npm resolves them (nearest node_modules first)."""
    packages = lock["packages"]

    def resolve(origin: str, name: str) -> str | None:
        base = origin
        while True:
            candidate = (base + "/" if base else "") + "node_modules/" + name
            if candidate in packages:
                return candidate
            if not base:
                return None
            cut = base.rfind("/node_modules/")
            base = base[:cut] if cut >= 0 else ""

    keep: set[str] = set()
    pending = []
    for name, version in roots.items():
        path = resolve("", name)
        if path is None or packages[path].get("version") != version:
            raise RuntimeError(f"{name}@{version} is not what studio/package-lock.json pins")
        pending.append(path)
    while pending:
        path = pending.pop()
        if path in keep:
            continue
        keep.add(path)
        entry = packages[path]
        wanted = {**entry.get("dependencies", {}), **entry.get("optionalDependencies", {})}
        optional_peers = entry.get("peerDependenciesMeta", {})
        wanted.update({name: "*" for name in entry.get("peerDependencies", {})
                       if not optional_peers.get(name, {}).get("optional")})
        for name in wanted:
            found = resolve(path, name)
            if found:
                pending.append(found)
            elif name not in entry.get("optionalDependencies", {}) and name not in entry.get("peerDependencies", {}):
                raise RuntimeError(f"{path} needs {name}, which the lock does not contain")
    return sorted(keep)


def production_lock(lock: dict, roots: dict[str, str], *, version: str, engines: dict) -> dict:
    """The part of studio's lock the sidecar needs. Every entry (version, URL, integrity) is copied unchanged."""
    packages = {path: lock["packages"][path] for path in lock_closure(lock, roots)}
    root = {"name": "cablesim-agent", "version": version, "dependencies": dict(sorted(roots.items())), "engines": engines}
    return {"name": "cablesim-agent", "version": version, "lockfileVersion": lock["lockfileVersion"], "requires": True,
            "packages": {"": root, **packages}}


def _verify_imports(node: Path, agent: Path, specifiers: list[str]) -> None:
    """Load the entry module and every bare specifier with the shipped Node: unresolved imports fail the build."""
    script = (
        "import { pathToFileURL } from 'node:url';"
        "import { resolve } from 'node:path';"
        "const failures = [];"
        "for (const target of JSON.parse(process.argv[1])) {"
        "  try { await import(target.startsWith('.') ? pathToFileURL(resolve(target)).href : target); }"
        "  catch (error) { failures.push(target + ': ' + (error?.code ?? '') + ' ' + String(error?.message ?? error).split('\\n')[0]); }"
        "}"
        "if (failures.length) { console.error(failures.join('\\n')); process.exit(1); }"
    )
    result = subprocess.run([str(node), "--input-type=module", "-e", script, json.dumps(["./" + ENTRY, *specifiers])],
                            cwd=agent, env=isolated_environment(), capture_output=True, text=True, encoding="utf-8",
                            timeout=180)
    if result.returncode:
        raise RuntimeError("The staged Agent cannot load its modules with the bundled Node.js:\n" + result.stderr[-4000:])


def bundle_agent(root: Path, staged: Path, *, ui: Path, node: Path, npm: str | None = None) -> dict:
    studio = root / "studio"
    package = json.loads((studio / "package.json").read_text("utf-8"))
    lock_file = studio / "package-lock.json"
    lock = json.loads(lock_file.read_text("utf-8"))
    files, bare = source_closure(studio)
    tracked = set(subprocess.check_output(["git", "ls-files", "-z", "--", "studio"], cwd=root).decode().split("\0"))
    untracked = [path.relative_to(root.resolve()).as_posix() for path in files
                 if path.relative_to(root.resolve()).as_posix() not in tracked]
    if untracked:
        raise RuntimeError("Agent 源码必须是 Git 跟踪文件，发行包不收未跟踪文件：" + ", ".join(untracked))
    names = sorted({package_name(specifier) for specifier in bare})
    declared = package.get("dependencies", {})
    undeclared = [name for name in names if name not in declared]
    if undeclared:
        raise RuntimeError("The Agent imports packages that studio/package.json does not declare: " + ", ".join(undeclared))
    roots = {name: declared[name] for name in names}
    if not (ui / UI_ENTRY).is_file() or not any(ui.rglob("*.js")) or not any(ui.rglob("*.css")):
        raise RuntimeError("请先构建 Agent 对话页：在 studio 目录运行 npm ci --ignore-scripts 与 npm run build:fusion。")
    if any(path.is_symlink() for path in ui.rglob("*")):
        raise RuntimeError("Agent 对话页构建目录不能包含符号链接。")
    agent = staged / "agent"
    agent.mkdir(parents=True)
    for source in files:
        output = agent / source.relative_to(studio.resolve())
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, output)
    data = sorted(name for name in tracked if name.startswith(tuple("studio/" + folder + "/" for folder in RUNTIME_DATA)))
    if not data:
        raise RuntimeError("Agent 运行时读取的数据目录没有 Git 跟踪文件：" + ", ".join(RUNTIME_DATA))
    for name in data:
        output = agent / name.removeprefix("studio/")
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / name, output)
    shutil.copytree(ui, agent / "dist-fusion")
    manifest = {"name": "cablesim-agent", "version": package["version"], "private": True, "type": "module",
                "description": "CableSimPro Agent sidecar: source subset and production dependencies of studio/",
                "engines": package["engines"], "dependencies": dict(sorted(roots.items()))}
    derived = production_lock(lock, roots, version=package["version"], engines=package["engines"])
    (agent / "package.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    (agent / "package-lock.json").write_text(json.dumps(derived, indent=2) + "\n", encoding="utf-8", newline="\n")
    program = npm or shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not program:
        raise RuntimeError("发行构建需要 npm 来安装 Agent 的生产依赖（仅构建机需要，安装端不需要）。")
    environment = {**os.environ, "npm_config_update_notifier": "false", "npm_config_fund": "false"}
    subprocess.run([program, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--no-progress"],
                   cwd=agent, env=environment, check=True)
    modules = agent / "node_modules"
    # Link shims and npm's private cache of the tree are build products, not shipped files.
    shutil.rmtree(modules / ".bin", ignore_errors=True)
    (modules / ".package-lock.json").unlink(missing_ok=True)
    present = sorted(entry for entry in derived["packages"] if entry)
    missing = [entry for entry in present if not (agent / entry / "package.json").is_file()]
    if missing:
        raise RuntimeError("npm ci 没有装出锁里的全部生产依赖：" + ", ".join(missing[:5]))
    _verify_imports(node, agent, sorted(bare))
    metadata = {"format": FORMAT, "entry": ENTRY, "ui": "dist-fusion", "engines": package["engines"],
                "source_files": [path.relative_to(studio.resolve()).as_posix() for path in files],
                "data_files": [name.removeprefix("studio/") for name in data],
                "dependencies": dict(sorted(roots.items())), "locked_packages": len(present),
                "studio_lock_sha256": digest(lock_file),
                "install": "npm ci --omit=dev --ignore-scripts from the derived production lock; no lifecycle scripts, "
                           "no native build; better-sqlite3 is resolved for import only and its addon is not built"}
    (staged / METADATA).write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return metadata
