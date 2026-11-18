"""Exercise the installed release's Agent: the bundled Node.js sidecar, its guarded API and one real read-only conversation.

Everything runs over the public HTTP surface of the installed release. The only simulated party is the model
service, a loopback OpenAI-compatible endpoint scripted to call one real read-only platform tool and then answer
from what that tool returned, so the answer can only be correct if the sidecar, the platform's tool broker and the
seeded engineering database all did their real work. No credential of a real provider is involved: the key used
here is generated for the run, held only in the platform process's memory, and searched for in every response and
in the combined process log afterwards.
"""
from __future__ import annotations

from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
from threading import Thread
import time
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request
from uuid import uuid4

QUESTION = "库里现在有哪些工程？请只读查看，不要改动任何东西。"
READ_TOOL = "workspace_list"
MODEL = "gate-model"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


class ScriptedModel:
    """A loopback OpenAI-compatible endpoint: call the read tool once, then answer from its result."""

    def __init__(self, key: str, names: list[str], skills: list[str]):
        self.key, self.names, self.skills, self.requests = key, names, skills, []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length) or b"{}")
                if self.path.rstrip("/") != "/v1/chat/completions":
                    self.send_error(404)
                    return
                owner.respond(self, body)

            def log_message(self, *arguments):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.server.shutdown()
        self.server.server_close()

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}/v1"

    def respond(self, handler: BaseHTTPRequestHandler, body: dict) -> None:
        messages = body.get("messages", [])
        offered = [tool["function"]["name"] for tool in body.get("tools", []) if tool.get("type") == "function"]
        results = [message for message in messages if message.get("role") == "tool"]
        prompt = json.dumps([message.get("content") for message in messages if message.get("role") in ("system", "developer")],
                            ensure_ascii=False)
        self.requests.append({"authorized": handler.headers.get("Authorization") == "Bearer " + self.key,
                              "stream": bool(body.get("stream")), "model": body.get("model"), "tools_offered": len(offered),
                              "read_tool_offered": READ_TOOL in offered, "tool_results": len(results),
                              "skills_in_prompt": [name for name in self.skills if name in prompt]})
        if results:
            text = "".join(content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
                           for message in results for content in [message.get("content", "")])
            found = [name for name in self.names if name in text]
            events = [{"delta": {"role": "assistant", "content": "库里现有工程："}, "finish_reason": None},
                      {"delta": {"content": "、".join(found) if found else "（工具没有返回可识别的工程名）"}, "finish_reason": None},
                      {"delta": {}, "finish_reason": "stop"}]
        elif READ_TOOL in offered:
            call = {"index": 0, "id": "call_gate_" + uuid4().hex[:8], "type": "function",
                    "function": {"name": READ_TOOL, "arguments": "{}"}}
            events = [{"delta": {"role": "assistant", "content": None, "tool_calls": [call]}, "finish_reason": None},
                      {"delta": {}, "finish_reason": "tool_calls"}]
        else:
            events = [{"delta": {"role": "assistant", "content": "没有提供可用的只读工具。"}, "finish_reason": None},
                      {"delta": {}, "finish_reason": "stop"}]
        usage = {"prompt_tokens": 64, "completion_tokens": 16, "total_tokens": 80}
        stamp = {"id": "chatcmpl-gate", "object": "chat.completion.chunk", "created": 1, "model": MODEL}
        if body.get("stream"):
            handler.send_response(200)
            handler.send_header("Content-Type", "text/event-stream")
            handler.send_header("Cache-Control", "no-store")
            handler.end_headers()
            for event in events:
                handler.wfile.write(b"data: " + json.dumps({**stamp, "choices": [{"index": 0, **event}]}).encode() + b"\n\n")
            handler.wfile.write(b"data: " + json.dumps({**stamp, "choices": [], "usage": usage}).encode() + b"\n\n")
            handler.wfile.write(b"data: [DONE]\n\n")
        else:
            message = {key: value for event in events for key, value in event["delta"].items() if value is not None}
            payload = json.dumps({"id": "chatcmpl-gate", "object": "chat.completion", "created": 1, "model": MODEL,
                                  "choices": [{"index": 0, "message": message, "finish_reason": events[-1]["finish_reason"]}],
                                  "usage": usage}).encode()
            handler.send_response(200)
            handler.send_header("Content-Type", "application/json")
            handler.send_header("Content-Length", str(len(payload)))
            handler.end_headers()
            handler.wfile.write(payload)


def listening_addresses(port: int) -> set[str]:
    """Local addresses with a TCP listener on this port, read from the operating system, not from the sidecar."""
    found: set[str] = set()
    if os.name == "nt":
        for protocol in ("tcp", "tcpv6"):
            # Headers and state names are localized and in the OEM code page; a listener is the row whose remote port is 0.
            output = subprocess.run(["netstat", "-ano", "-p", protocol], capture_output=True, encoding="utf-8",
                                    errors="replace", timeout=30).stdout or ""
            for line in output.splitlines():
                fields = line.split()
                if len(fields) >= 3 and fields[0].upper() == "TCP":
                    address, _, local_port = fields[1].rpartition(":")
                    if local_port == str(port) and fields[2].rpartition(":")[2] == "0":
                        found.add(address.strip("[]"))
        return found
    for table, width in (("/proc/net/tcp", 8), ("/proc/net/tcp6", 32)):
        try:
            rows = Path(table).read_text("ascii").splitlines()[1:]
        except OSError:
            continue
        for row in rows:
            fields = row.split()
            address, _, hexport = fields[1].partition(":")
            if fields[3] == "0A" and int(hexport, 16) == port:
                if width == 8:
                    found.add(".".join(str(int(address[index:index + 2], 16)) for index in (6, 4, 2, 0)))
                else:
                    found.add("::1" if address == "0" * 31 + "1" or address == "00000000000000000000000001000000" else
                              "::" if set(address) == {"0"} else address)
    return found


class PageAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references: set[str] = set()

    def handle_starttag(self, tag, attributes):
        values = dict(attributes)
        if tag == "script" and values.get("src"):
            self.references.add(values["src"])
        elif tag == "link" and values.get("rel") in {"stylesheet", "modulepreload"} and values.get("href"):
            self.references.add(values["href"])


def files_holding(root: Path, needle: bytes, *, skip: tuple[str, ...] = ("programs",)) -> list[str]:
    """Files under ``root`` (not under its named top-level directories) that contain the bytes; read in chunks."""
    found = []
    for directory, directories, files in os.walk(root):
        if Path(directory) == root:
            directories[:] = [name for name in directories if name not in skip]
        for name in files:
            path = Path(directory) / name
            try:
                with path.open("rb") as stream:
                    tail = b""
                    while block := stream.read(8 * 1024 * 1024):
                        if needle in tail + block:
                            found.append(path.relative_to(root).as_posix())
                            break
                        tail = block[-(len(needle) - 1):]
            except OSError:
                continue
    return found


def verify_agent(gate, *, agent_port: int, manifest: dict | None, log: Path, data_dir: Path | None = None) -> dict:
    """Run every Agent check of the installation gate; returns the evidence summary."""
    summary: dict = {"sidecar_port": agent_port, "model": "scripted loopback endpoint; key generated for this run"}
    base = gate.base_url

    def get(path: str, *, raw: bool = False):
        with gate.http.open(base + path, timeout=gate.timeout) as response:
            data = response.read()
            return (data, response.headers) if raw else json.loads(data)

    def refused(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        request = Request(base + path, data=None if body is None else json.dumps(body).encode(), method=method,
                          headers={"Content-Type": "application/json"})
        try:
            with gate.http.open(request, timeout=gate.timeout) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read() or b"{}")

    with gate.step("Agent 对话页随包提供且不引用外部资源"):
        page, headers = get("/agent-app/fusion.html", raw=True)
        require(headers.get_content_type() == "text/html" and b'id="root"' in page, "平台没有提供随包的 Agent 对话页。")
        parsed = PageAssets()
        parsed.feed(page.decode("utf-8"))
        require(any(item.endswith((".js", ".mjs")) for item in parsed.references)
                and any(item.endswith(".css") for item in parsed.references), "Agent 对话页没有实际脚本或样式。")
        checked = []
        for reference in sorted(parsed.references):
            url = urlsplit(urljoin(base + "/agent-app/", reference))
            require((url.scheme, url.netloc) == ("http", urlsplit(base).netloc) and url.path.startswith("/agent-app/"),
                    "Agent 对话页依赖外部资源，不能作为内网发行包：" + reference)
            data, asset_headers = get(url.path, raw=True)
            checked.append({"path": url.path, "content_type": asset_headers.get_content_type(), "bytes": len(data)})
            if manifest is not None:
                expected = manifest["files"].get("agent/dist-fusion/" + url.path.removeprefix("/agent-app/"))
                require(expected is not None and expected["size_bytes"] == len(data), "Agent 页资源与发行清单不一致：" + url.path)
        gate.artifact("agent/page-assets.json", {"assets": checked, "external_resources": []})
        summary["page_assets"] = len(checked)

    with gate.step("边车只监听 127.0.0.1，直接访问需要令牌"):
        # The launcher starts the sidecar beside the platform; a slow first start of Node.js is not a failure.
        deadline = time.monotonic() + 90
        addresses = listening_addresses(agent_port)
        while not addresses and time.monotonic() < deadline:
            time.sleep(.5)
            addresses = listening_addresses(agent_port)
        require(addresses == {"127.0.0.1"}, "边车没有只监听 127.0.0.1：" + json.dumps(sorted(addresses)))
        status, body = 0, {}
        request = Request(f"http://127.0.0.1:{agent_port}/api/status")
        try:
            with gate.http.open(request, timeout=10) as response:
                status = response.status
        except HTTPError as error:
            status, body = error.code, json.loads(error.read() or b"{}")
        require(status == 401, "未带令牌访问边车应被拒绝。")
        summary["listening"] = sorted(addresses)

    with gate.step("没配模型：Agent 页接口说明去“设置 · AI 模型”，对话被拒且没有结果"):
        before = get("/agent-sidecar/api/status")
        gate.artifact("agent/status-before-model.json", before)
        require(before["agent"]["configured"] is False and "设置 · AI 模型" in before["agent"].get("hint", ""),
                "没配模型时 Agent 状态没有指向“设置 · AI 模型”。")
        code, body = refused("POST", "/agent-sidecar/api/chat/messages", {"text": QUESTION})
        gate.artifact("agent/chat-before-model.json", body)
        require(code == 409 and body["error"]["code"] == "MODEL_NOT_CONFIGURED" and "设置 · AI 模型" in body["error"]["message"],
                "没配模型时发消息应得到 409 与去设置页的提示，实际：" + json.dumps(body, ensure_ascii=False)[:300])
        require(not get("/agent-sidecar/api/chat/sessions"), "没配模型时不应产生任何对话。")

    workspaces = gate.api("GET", "/api/workspaces")
    names = sorted({row["name"] for row in workspaces if row.get("name")})
    require(len(names) >= 2, "发布种子应有多个工程可供只读查看。")
    key = "gate-" + uuid4().hex
    skills = sorted({PurePosixPath(name).parent.name for name in (manifest or {"files": {}})["files"]
                     if name.startswith("agent/skills/") and name.endswith("/SKILL.md")})
    if manifest is not None:
        require(len(skills) >= 1, "发行包没有随附 Agent 技能（agent/skills/*/SKILL.md）。")
    with ScriptedModel(key, names, skills) as model:
        with gate.step("在设置接口配上本机模型（密钥只进进程内存），Agent 状态转为已配置"):
            saved = gate.api("PUT", "/api/agent/settings", {"base_url": model.base_url, "model": MODEL, "api_key": key,
                                                             "instructions": ""})
            require(saved["configured"] is True and saved["key_storage"] == "memory" and key not in json.dumps(saved),
                    "设置接口没有把密钥只留在进程内存。")
            after = get("/agent-sidecar/api/status")
            gate.artifact("agent/status-after-model.json", after)
            require(after["agent"] == {"configured": True, "model": MODEL, "provider": "127.0.0.1"},
                    "配好模型后 Agent 状态不对：" + json.dumps(after, ensure_ascii=False))
        with gate.step("只读问答：模型调用 " + READ_TOOL + "，答案取自平台返回的工程名"):
            sent = gate.api("POST", "/agent-sidecar/api/chat/messages", {"text": QUESTION})
            session = sent["session"]
            deadline = time.monotonic() + gate.timeout
            while True:
                view = get(f"/agent-sidecar/api/chat/sessions/{session}")
                if not view["running"] and view["items"] and view["items"][-1]["role"] == "assistant":
                    break
                require(time.monotonic() < deadline, "Agent 对话超时：" + json.dumps(view, ensure_ascii=False)[:600])
                time.sleep(.25)
            gate.artifact("agent/conversation.json", view)
            answer = view["items"][-1]
            require(answer.get("status") != "error" and not answer.get("error"), "对话以错误结束：" + json.dumps(answer, ensure_ascii=False)[:600])
            steps = [part for item in view["items"] for part in item["parts"] if part["type"] == "step"]
            read = [part for part in steps if part.get("tool") == READ_TOOL]
            require(read and all(part["status"] == "done" for part in read), "对话里没有已完成的只读工具步骤：" + json.dumps(steps, ensure_ascii=False)[:600])
            text = "".join(part["text"] for part in answer["parts"] if part["type"] == "text")
            found = [name for name in names if name in text]
            require(found, "最终答案里没有平台工具返回的工程名：" + text[:300])
            summary["answer_names"] = found
            summary["tool_steps"] = [part["tool"] for part in steps]
        with gate.step("模型请求由平台加入密钥，密钥不出现在任何响应或日志里"):
            gate.artifact("agent/model-requests.json", {"requests": model.requests, "key": "generated for this run; not stored"})
            require(len(model.requests) >= 2 and all(item["authorized"] and item["stream"] and item["model"] == MODEL
                                                     for item in model.requests), "模型请求没有携带平台加入的密钥。")
            require(model.requests[0]["read_tool_offered"] and model.requests[-1]["tool_results"] >= 1,
                    "模型没有拿到只读工具，或没有收到工具结果。")
            require(set(skills) <= set(model.requests[0]["skills_in_prompt"]),
                    "随包技能没有进入模型看到的提示：缺 " + ", ".join(sorted(set(skills) - set(model.requests[0]["skills_in_prompt"]))))
            summary["skills"] = skills
            leaked = [name for name, value in (("settings", json.dumps(saved)), ("status", json.dumps(after)),
                                               ("conversation", json.dumps(view, ensure_ascii=False)),
                                               ("log", log.read_text("utf-8", errors="replace") if log.is_file() else ""))
                      if key in value]
            require(not leaked, "密钥出现在：" + ", ".join(leaked))
            if data_dir is not None:
                # Every file the installation keeps: engineering database, conversations and pi session files, logs.
                held = files_holding(data_dir, key.encode())
                require(not held, "密钥写进了数据目录里的文件：" + ", ".join(held[:5]))
                summary["searched_data_dir"] = True
            summary["model_requests"] = len(model.requests)
    gate.api("DELETE", "/api/agent/settings")
    return summary
