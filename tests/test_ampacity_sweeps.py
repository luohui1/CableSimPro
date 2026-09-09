"""Bounded local ampacity sweep contract; every point is checked by the real solver."""
from copy import deepcopy
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.schemas import Scenario


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "ampacity-sweeps.sqlite")) as c:
        yield c


def plan(client, message):
    return client.post(
        "/api/agent/plan",
        json={"scenario": Scenario().model_dump(), "message": message, "mode": "local"},
    )


@pytest.mark.parametrize(
    "message,parameter,values",
    [
        ("比较土壤热阻率 0.8、1.2、1.6 K·m/W 下的载流量", "soil_rho_k_m_w", [0.8, 1.2, 1.6]),
        ("比较环境温度 -10、25、40 °C 下的载流量", "ambient_temperature_c", [-10.0, 25.0, 40.0]),
        ("比较平均中心埋深 0.4、0.8、1.2 m 下的载流量", "depth_m", [0.4, 0.8, 1.2]),
        ("比较相邻中心间距 0.08、0.12、0.20 m 下的载流量", "spacing_m", [0.08, 0.12, 0.20]),
    ],
)
def test_local_agent_sweeps_every_supported_buried_parameter(client, message, parameter, values):
    baseline = Scenario().model_dump()
    response = plan(client, message)
    assert response.status_code == 200
    proposal = response.json()
    assert proposal["ready"] is True
    assert proposal["action"] == "sweep"
    assert proposal["parameter"] == parameter
    assert proposal["values"] == values
    assert proposal["changes"] == []
    assert proposal["scenario"] == baseline

    executed = client.post(
        "/api/agent/execute",
        json={"scenario": baseline, "ticket": proposal["ticket"]},
    )
    assert executed.status_code == 200
    output = executed.json()
    assert output["result"] is None
    assert output["scenario"] == baseline
    assert output["sweep"]["parameter"] == parameter
    assert [point["value"] for point in output["sweep"]["points"]] == values

    # The sweep must be a transparent series of the same deterministic solves,
    # not a lookup table or language-model estimate.
    for point, value in zip(output["sweep"]["points"], values, strict=True):
        candidate = deepcopy(baseline)
        candidate["installation"][parameter] = value
        reference = client.post("/api/calculate", json=candidate)
        assert reference.status_code == 200
        assert point["ampacity_a"] == pytest.approx(reference.json()["summary"]["ampacity_a"])
        assert point["error"] is None

    # Planning and executing through the stateless compatibility route never
    # creates or mutates a saved project.
    assert client.get("/api/projects").json() == []


def test_runtime_plan_approval_executes_depth_sweep_and_preserves_saved_inputs(client):
    workspace = client.post("/api/workspaces", json={}).json()
    baseline = deepcopy(workspace["scenario"])
    planned = client.post(
        f"/api/runtime/{workspace['id']}/invoke",
        json={
            "request_id": str(uuid4()),
            "capability": "task.plan",
            "expected_revision": workspace["revision"],
            "arguments": {
                "message": "比较埋深 0.4、0.8、1.2 m 下的载流量",
                "mode": "local",
                "consent": False,
            },
        },
    )
    assert planned.status_code == 200, planned.text
    proposal = planned.json()["result"]
    assert proposal["ready"] is True
    assert proposal["action"] == "sweep"
    assert proposal["parameter"] == "depth_m"
    assert proposal["changes"] == []
    assert proposal["scenario"] == baseline

    approved = client.post(
        f"/api/workspaces/{workspace['id']}/proposals/{proposal['id']}/approve",
        json={"expected_revision": workspace["revision"]},
    )
    assert approved.status_code == 200, approved.text
    payload = approved.json()
    saved = payload["workspace"]
    output = payload["output"]

    # Approval is audited as a new engineering revision, but a study does not
    # replace any saved installation input with one of its sweep points.
    assert saved["revision"] == workspace["revision"] + 1
    assert saved["scenario"] == baseline
    assert output["result"] is None
    assert output["sweep"]["parameter"] == "depth_m"
    assert [point["value"] for point in output["sweep"]["points"]] == [0.4, 0.8, 1.2]
    assert output["run_id"]
    assert saved["runs"][0]["revision"] == saved["revision"]

    for point in output["sweep"]["points"]:
        candidate = deepcopy(baseline)
        candidate["installation"]["depth_m"] = point["value"]
        reference = client.post("/api/calculate", json=candidate)
        assert reference.status_code == 200
        assert point["ampacity_a"] == pytest.approx(reference.json()["summary"]["ampacity_a"])


@pytest.mark.parametrize(
    "message",
    [
        "比较埋深 0.8 m 下的载流量",  # fewer than two points
        "比较间距 0.02、0.03 m 下的载流量",  # cable overlap for this model
        "比较环境温度 25、100 °C 下的载流量",  # outside validated domain
    ],
)
def test_supported_sweep_with_invalid_points_never_gets_a_ticket(client, message):
    response = plan(client, message)
    assert response.status_code == 422
    assert "方案校验失败" in response.json()["detail"]


@pytest.mark.parametrize(
    "message",
    [
        "比较导体截面积 240、300 mm² 下的载流量",  # not an installation sweep
        "比较埋深 0.4 到 1.0 m 下的载流量",  # inferred range/step is deliberately unsupported
        "比较土壤含水率 10、20、30% 下的载流量",  # unsupported physics/input
    ],
)
def test_local_sweep_does_not_guess_unsupported_dimensions_or_ranges(client, message):
    response = plan(client, message)
    assert response.status_code == 200
    proposal = response.json()
    assert proposal["ready"] is False
    assert proposal["ticket"] is None
    assert proposal["changes"] == []
