"""The release gate rejects altered values from a real saved IEC calculation."""
from copy import deepcopy
from functools import partial
from hashlib import sha256
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from threading import Thread
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.kernel.scenarios import system_models
from scripts.verify_installation import InstallationGate, validate_rating_values


def test_frontend_http_evidence_rejects_wrong_bytes_and_mime_type(tmp_path):
    frontend = tmp_path / "frontend"
    assets = frontend / "assets"
    assets.mkdir(parents=True)
    (frontend / "index.html").write_text('<div id="root"></div><script type="module" src="/assets/app.js"></script>'
                                       '<link rel="stylesheet" href="/assets/app.css">', encoding="utf-8")
    (assets / "app.js").write_text("export const loaded = true;", encoding="utf-8")
    (assets / "app.css").write_text("body { margin: 0; }", encoding="utf-8")
    (assets / "geometry.wasm").write_bytes(b"\x00asm\x01\x00\x00\x00")
    manifest = {"files": {"frontend/dist/" + path.relative_to(frontend).as_posix():
                         {"sha256": sha256(path.read_bytes()).hexdigest(), "size_bytes": path.stat().st_size}
                         for path in frontend.rglob("*") if path.is_file()}}

    class Handler(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm"}

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(frontend)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    gate = InstallationGate(evidence, timeout=5)
    gate.base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        gate.frontend_assets(manifest)
        observed = json.loads((evidence / "frontend-assets.json").read_text("utf-8"))["assets"]
        assert {item["path"] for item in observed} == {"/", "/assets/app.js", "/assets/app.css", "/assets/geometry.wasm"}
        assert all(item["manifest_verified"] for item in observed)

        # A 200 response alone must not conceal stale assets or SPA fallbacks.
        original = (assets / "app.js").read_bytes()
        (assets / "app.js").write_bytes(original + b"\n// stale server asset")
        with pytest.raises(RuntimeError, match="摘要不一致"):
            gate.frontend_assets(manifest)
        (assets / "app.js").write_bytes(original)
        Handler.extensions_map[".wasm"] = "text/html"
        with pytest.raises(RuntimeError, match="类型不正确"):
            gate.frontend_assets(manifest)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


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
