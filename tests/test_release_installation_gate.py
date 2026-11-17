"""The release gate rejects altered values from a real saved IEC calculation."""
from copy import deepcopy
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.kernel.scenarios import system_models
from scripts.verify_installation import validate_rating_values


def test_installation_evidence_compares_real_table_with_frozen_run(tmp_path):
    with TestClient(create_app(tmp_path / "release.sqlite")) as client:
        model = next(item for item in system_models() if item["id"] == "system.specification-yjv22-300")
        response = client.post("/api/design/type-workspaces", json={
            "model_id": model["id"], "content_sha256": model["content_sha256"]})
        assert response.status_code == 201, response.text
        workspace = response.json()
        wid = workspace["id"]
        response = client.post(f"/api/design/workspaces/{wid}/rating-table-definition", json={
            "expected_revision": workspace["revision"], **model["payload"]["specification_conditions"]["rating"]})
        assert response.status_code == 200, response.text
        response = client.post(f"/api/workspaces/{wid}/studies", json={
            "expected_revision": workspace["revision"], **response.json()})
        assert response.status_code == 201, response.text
        study = response.json()
        prefix = f"/api/workspaces/{wid}/studies/{study['id']}"
        check = client.get(prefix + "/preflight", params={"expected_revision": workspace["revision"],
                           "expected_study_revision": study["revision"]})
        assert check.status_code == 200 and check.json()["ready"], check.text
        response = client.post(prefix + "/runs", json={"request_id": str(uuid4()),
            "expected_revision": workspace["revision"], "expected_study_revision": study["revision"],
            "scope_acknowledged": True, "lock_digest": check.json()["lock_digest"]})
        assert response.status_code == 200, response.text
        run = response.json()
        assert run["status"] == "succeeded", run
        response = client.get(f"/api/design/workspaces/{wid}/rating-table-runs/{run['id']}")
        assert response.status_code == 200, response.text
        table = response.json()
        validate_rating_values(table)

        changed = deepcopy(table)
        changed["rows"][0]["value_a"] += .01
        with pytest.raises(RuntimeError, match="数字与保存运行不一致"):
            validate_rating_values(changed)

        # Multiple circuits must use the jointly solved current, never silently
        # substitute a different circuit or a result with a different SI unit.
        changed = deepcopy(table)
        case_id = changed["rows"][1]["case_id"]
        case = next(item for item in changed["run"]["output"]["cases"] if item["case_id"] == case_id)
        for value in case["results"]:
            if value["key"] == "ampacity":
                value["unit"] = "kA"
        with pytest.raises(RuntimeError, match="数字与保存运行不一致"):
            validate_rating_values(changed)
