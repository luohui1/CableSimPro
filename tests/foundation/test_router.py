"""Actual application integration; requires the repository's installed dependencies."""
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "study.sqlite")) as c:
        yield c


def test_preflight_is_revision_bound_and_has_no_persistent_effects(client):
    w = client.post("/api/workspaces", json={}).json()
    before = client.get(f"/api/workspaces/{w['id']}").json()
    path = f"/api/foundation/workspaces/{w['id']}/preflight"
    response = client.get(path, params={"expected_revision": 1})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "package_ready" and not data["solver_executed"]
    assert client.get(f"/api/workspaces/{w['id']}").json() == before
    assert client.get(path, params={"expected_revision": 2}).status_code == 409
    assert client.get(path).status_code == 422
    assert client.get(path, params={"expected_revision": 1, "target": "invalid"}).status_code == 422


def test_native_target_reports_blocked_without_starting_a_task(client):
    w = client.post("/api/workspaces", json={}).json()
    response = client.get(f"/api/foundation/workspaces/{w['id']}/preflight",
                          params={"expected_revision": 1, "target": "comsol"})
    assert response.status_code == 200
    assert response.json()["status"] == "blocked"
    after = client.get(f"/api/workspaces/{w['id']}").json()
    assert after["runs"] == [] and after["revision"] == 1


def test_missing_project_and_nonlocal_host_rejected(client):
    assert client.get("/api/foundation/workspaces/absent/preflight", params={"expected_revision": 1}).status_code == 404
    assert client.get("/api/foundation/capabilities", headers={"host": "untrusted.example"}).status_code == 403
    data = client.get("/api/foundation/capabilities").json()
    assert data["scope"] == "preflight_only" and data["executes_solver"] is False
