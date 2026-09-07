from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.schemas import Scenario


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "projects.sqlite")) as c:
        yield c


def test_health_and_presets(client):
    assert client.get("/api/health").json()["status"] == "ok"
    presets = client.get("/api/presets").json()
    assert len(presets) == 6
    for preset in presets:
        assert client.post("/api/validate", json=preset["scenario"]).status_code == 200


def test_calculate_returns_traceable_results(client):
    response = client.post("/api/calculate", json=Scenario().model_dump())
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["ampacity_a"] > 0
    assert body["rating"]["residual_k"] < 1e-8
    assert body["input"]["schema_version"] == 1
    assert len(body["warnings"]) >= 5


def test_crud_and_persistence(client):
    p = Scenario().model_dump()
    response = client.post("/api/projects", json=p)
    assert response.status_code == 201
    saved = response.json()
    key = saved["id"]
    assert len(client.get("/api/projects").json()) == 1
    assert client.get(f"/api/projects/{key}").json()["scenario"] == p
    p["name"] = "更新后的工程"
    assert client.put(f"/api/projects/{key}", json=p).json()["name"] == p["name"]
    assert client.delete(f"/api/projects/{key}").status_code == 204
    assert client.get(f"/api/projects/{key}").status_code == 404
    assert client.delete(f"/api/projects/{key}").status_code == 404


def test_disk_persistence_across_app_instances(tmp_path):
    db = tmp_path / "persistent.sqlite"
    with TestClient(create_app(db)) as first:
        key = first.post("/api/projects", json=Scenario().model_dump()).json()["id"]
    with TestClient(create_app(db)) as second:
        assert second.get(f"/api/projects/{key}").status_code == 200


def test_update_missing_project_does_not_create(client):
    assert client.put(f"/api/projects/{uuid4()}", json=Scenario().model_dump()).status_code == 404


def test_unknown_fields_and_schema_versions_rejected(client):
    p = Scenario().model_dump()
    p["unsupported"] = 1
    assert client.post("/api/calculate", json=p).status_code == 422
    p.pop("unsupported")
    p["schema_version"] = 2
    assert client.post("/api/projects", json=p).status_code == 422


def test_sweep_and_invalid_point(client):
    response = client.post("/api/sweep", json={"scenario": Scenario().model_dump(), "parameter": "soil_rho_k_m_w", "values": [0, 1.2, 2.4]})
    assert response.status_code == 200
    points = response.json()["points"]
    assert points[0]["error"]
    assert points[1]["ampacity_a"] > points[2]["ampacity_a"]


def test_report_escapes_user_text_and_has_trace(client):
    p = Scenario().model_dump()
    p["name"] = "<script>alert(1)</script>"
    response = client.post("/api/report", json=p)
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "<script>alert(1)</script>" not in response.text
    assert "&lt;script&gt;" in response.text
    assert "SHA-256" in response.text
    assert "未通过正式标准算例" in response.text


def test_unknown_api_stays_json_404(client):
    r = client.get("/api/not-a-real-endpoint")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")
