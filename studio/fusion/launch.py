"""The demo launcher's Agent process: one private link, one child, no model credentials."""
from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
from typing import Iterator


def prepare(root: Path, release: Path, npm: str, environment: dict[str, str],
            backend_url: str, *, skip_install: bool) -> None:
    """Build the isolated chat entry and configure the two hosts in memory only."""
    studio = root / "studio"
    if not (studio / "node_modules").is_dir():
        if skip_install:
            raise RuntimeError("Agent 依赖尚未安装；请在 studio 目录运行 npm ci，或去掉 --skip-install。")
        subprocess.run([npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
                       cwd=studio, env=child_environment(environment), check=True)
    subprocess.run([npm, "run", "build:fusion"], cwd=studio, env=child_environment(environment), check=True)
    try:
        port = int(environment.get("FUSION_PORT", "8111"))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError as error:
        raise RuntimeError("FUSION_PORT 必须是 1–65535 之间的端口号。") from error
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError as error:
            raise RuntimeError("Agent 边车端口已占用；请停止旧边车或设置 FUSION_PORT。") from error
    environment.update({
        "CABLESIM_AGENT_SIDECAR_TOKEN": secrets.token_urlsafe(32),
        "CABLESIM_AGENT_SIDECAR_URL": f"http://127.0.0.1:{port}",
        "CABLESIM_AGENT_UI": str(studio / "dist-fusion"),
        "FUSION_PORT": str(port),
        "FUSION_BACKEND_URL": backend_url,
        "FUSION_HOME": str(release / "agent"),
    })


def child_environment(environment: dict[str, str]) -> dict[str, str]:
    """Only the Python backend holds model keys, including the Studio fallback."""
    return {key: value for key, value in environment.items()
            if key not in {"CABLESIM_LLM_API_KEY", "CABLE_STUDIO_MODEL_API_KEY"}}


@contextmanager
def running(root: Path, environment: dict[str, str]) -> Iterator[subprocess.Popen]:
    node = shutil.which("node.exe" if os.name == "nt" else "node")
    if not node:
        raise RuntimeError("Agent 需要 Node.js 22.19 或更新版本。")
    process = subprocess.Popen([node, "fusion/server.ts"], cwd=root / "studio",
                               env=child_environment(environment))
    try:
        yield process
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
