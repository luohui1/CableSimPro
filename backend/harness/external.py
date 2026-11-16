"""Read-only, session-scoped bridge for the Studio Agent sidecar.

The sidecar never receives a direct domain-service handle. Calls are admitted from
the session's visible read-tool allowlist and executed through Harness.execute_plan,
which delegates to ToolBroker.execute and records the normal durable step receipt.
"""
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .recipe_compiler import compile_calls
from .session_scope import require_tool


class ExternalCall(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: UUID
    tool: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    arguments: dict = Field(default_factory=dict)


def _scope_check(value, workspace_id, path=""):
    """Reject caller-supplied scope selectors that escape the persisted session."""
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {"workspace_id", "workspace", "wid"} and child is not None:
                if str(child) != str(workspace_id):
                    raise HTTPException(422, {
                        "code": "SCOPE_VIOLATION",
                        "message": "工具参数试图访问会话绑定工程之外的范围。",
                        "path": f"{path}/{key}",
                    })
            _scope_check(child, workspace_id, f"{path}/{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _scope_check(child, workspace_id, f"{path}/{index}")


def make_external_router(harness):
    router = APIRouter()

    def session_record(session_id):
        return harness.tasks.record(str(session_id), model_context=True)

    @router.get("/external/tools")
    def external_tools(session_id: UUID):
        record = session_record(session_id)
        visible = harness.registry.visible(record)
        return {
            "session_id": str(session_id),
            "workspace_id": record["workspace_id"],
            "context": record["context"],
            "tools": [
                {
                    **tool.info(),
                    "parameters": tool.model()["function"]["parameters"],
                    "scope": {
                        "workspace_id": record["workspace_id"],
                        "study_id": record.get("study_id"),
                        "context": record["context"]["kind"],
                    },
                }
                for tool in visible.values() if tool.kind == "read"
            ],
        }

    @router.post("/external/calls")
    def external_call(body: ExternalCall):
        record = session_record(body.session_id)
        tools = harness.registry.visible(record)
        tool = tools.get(body.tool)
        if tool is None or tool.kind != "read":
            raise HTTPException(403, {
                "code": "TOOL_NOT_ALLOWED",
                "message": "外部 Agent 桥当前只开放本会话白名单中的只读工具。",
            })
        require_tool(record, body.tool)
        _scope_check(body.arguments, record["workspace_id"])

        turn = harness.begin(str(body.session_id), "外部 Agent 只读工具调用：" + body.tool)
        call = {
            "id": "external-" + str(uuid4()),
            "name": body.tool,
            "arguments": body.arguments,
        }
        plan = compile_calls([call], tools, record["workspace_id"], record["workspace_revision"])
        waiting = None
        try:
            # Exhaust the durable host plan. Every node flows through execute_plan
            # and ToolBroker.execute; no sidecar-owned operation is invoked.
            for event in harness.execute_plan(
                str(body.session_id), turn, plan, tools, record, source="external"
            ):
                pass
            current = session_record(body.session_id)
            step = next(
                (item for item in reversed(current["steps"]) if item.get("turn_id") == turn and item.get("tool") == body.tool),
                None,
            )
            if step is None or step.get("result") is None:
                raise HTTPException(500, {
                    "code": "TOOL_RECEIPT_MISSING",
                    "message": "宿主未生成可核验的工具回执。",
                })
            result = step["result"]
            state = "completed" if result.get("status") == "ok" else "blocked"
            harness.tasks.finish_turn(str(body.session_id), turn, state, None if state == "completed" else "capability")
            return {
                "session_id": str(body.session_id),
                "turn_id": turn,
                "tool": body.tool,
                "status": result["status"],
                "result": result,
                "execution_ref": result.get("execution_ref"),
            }
        except Exception:
            # A running operation is never replayed. finish_turn marks unresolved
            # running work unknown, preserving the host's existing recovery rule.
            harness.tasks.finish_turn(str(body.session_id), turn, "waiting", "capability")
            raise

    return router
