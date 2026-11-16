from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.harness.external import make_external_router


class FakeTool:
    def __init__(self, kind="read"):
        self.kind = kind
        self.name = "workspace_read"
        self.title = "读取工程"
        self.description = "读取当前工程"
        self.hpc = False
        self.method = None

    def info(self):
        return {"name": self.name, "title": self.title, "kind": self.kind,
                "description": self.description, "hpc": self.hpc}

    def model(self):
        return {"type": "function", "function": {"name": self.name,
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}}


class FakeTasks:
    def __init__(self, record):
        self.value = record
        self.finished = []

    def record(self, session_id, model_context=False):
        assert session_id == self.value["id"]
        return deepcopy(self.value)

    def finish_turn(self, session_id, turn, state, reason):
        self.finished.append((session_id, turn, state, reason))


class FakeRegistry:
    def __init__(self, tools):
        self.tools = tools

    def visible(self, record):
        return self.tools


class FakeHarness:
    def __init__(self, tools):
        self.record_value = {
            "id": str(uuid4()), "workspace_id": str(uuid4()), "study_id": None,
            "workspace_revision": 1, "context": {"kind": "project"},
            "steps": [],
        }
        self.tasks = FakeTasks(self.record_value)
        self.registry = FakeRegistry(tools)
        self.turn = None
        self.began = False

    def begin(self, session_id, message):
        self.began = True
        self.turn = str(uuid4())
        return self.turn

    def execute_plan(self, session_id, turn, plan, tools, snapshot, source="external"):
        # Test double models the normal durable receipt boundary.
        result = {"status": "ok", "summary": "工程已读取", "data": {"name": "示例工程"}}
        self.record_value["steps"].append({
            "turn_id": turn, "tool": plan["nodes"][0]["tool"], "result": result,
        })
        yield "event"


def client(harness):
    app = FastAPI()
    app.include_router(make_external_router(harness), prefix="/api/agent")
    return TestClient(app)


def test_external_catalog_discloses_parameter_contract_and_session_scope():
    harness = FakeHarness({"workspace_read": FakeTool()})
    response = client(harness).get("/api/agent/external/tools",
                                   params={"session_id": harness.record_value["id"]})
    assert response.status_code == 200
    body = response.json()
    assert body["workspace_id"] == harness.record_value["workspace_id"]
    assert body["tools"][0]["parameters"]["type"] == "object"
    assert body["tools"][0]["scope"]["workspace_id"] == harness.record_value["workspace_id"]


def test_external_bridge_rejects_tools_outside_read_allowlist():
    harness = FakeHarness({"propose_domain_changes": FakeTool("propose")})
    response = client(harness).post("/api/agent/external/calls", json={
        "session_id": harness.record_value["id"],
        "tool": "propose_domain_changes",
        "arguments": {},
    })
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "TOOL_NOT_ALLOWED"
    assert harness.began is False


def test_external_bridge_rejects_scope_escape_before_execution():
    harness = FakeHarness({"workspace_read": FakeTool()})
    response = client(harness).post("/api/agent/external/calls", json={
        "session_id": harness.record_value["id"],
        "tool": "workspace_read",
        "arguments": {"workspace_id": str(uuid4())},
    })
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "SCOPE_VIOLATION"
    assert harness.began is False


def test_external_bridge_uses_durable_host_execution_receipt():
    harness = FakeHarness({"workspace_read": FakeTool()})
    response = client(harness).post("/api/agent/external/calls", json={
        "session_id": harness.record_value["id"], "tool": "workspace_read", "arguments": {},
    })
    assert response.status_code == 200
    assert response.json()["result"]["data"]["name"] == "示例工程"
    assert harness.began is True
    assert harness.tasks.finished[-1][2] == "completed"
