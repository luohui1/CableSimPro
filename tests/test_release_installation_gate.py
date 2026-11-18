"""The release gate rejects altered values from a real saved IEC calculation."""
from copy import deepcopy
from functools import partial
from hashlib import sha256
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import os
from threading import Thread
import venv
from uuid import uuid4
from xml.etree import ElementTree
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.kernel.scenarios import system_models
from scripts.verify_installation import InstallationGate, loopback_probe, validate_rating_values
# The independent file verifier lives in scripts/verify_formal_delivery.py.
from scripts.verify_formal_delivery import SourceReader, digest, full_run_payload, validate_model, validate_xlsx


def test_loopback_preflight_exchanges_bytes_with_actual_temporary_python(tmp_path):
    environment = tmp_path / "python-environment"
    venv.EnvBuilder(with_pip=False).create(environment)
    interpreter = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    observation = loopback_probe(interpreter, dict(os.environ))
    assert observation == {"python_executable": str(interpreter), "address": "127.0.0.1", "round_trip": True}


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

        # Use a real result that would lose precision with a 16-digit writer.
        # The independent formal verifier must compare with the complete API
        # record, not with the renderer's rounded or projected data model.
        case = run["output"]["cases"][0]
        index, quantity = next((index, value) for index, value in enumerate(case["results"])
            if value["type"] == "quantity" and isinstance(value.get("value"), float)
            and float(format(value["value"], ".16g")) != value["value"])
        payload = full_run_payload(run)
        source_id = "run:" + run["id"]
        cell = {"value": quantity["value"], "raw_text": json.dumps(quantity["value"]), "unit": quantity["unit"],
            "value_ref": {"source_id": source_id, "pointer": f"/output/cases/0/results/{index}/value"},
            "unit_ref": {"source_id": source_id, "pointer": f"/output/cases/0/results/{index}/unit"}}
        formal = {"schema": "cablesim.formal-delivery/1",
            "sources": {source_id: {"payload_digest": digest(payload)}},
            "sections": [{"role": "body", "table_ids": ["results"]}, {"role": "trace", "table_ids": ["trace"]}],
            "tables": {"results": {"columns": [{"key": "value", "label": "数值"}],
                "rows": [{"id": "frozen-quantity", "cells": {"value": cell}}]},
                "trace": {"columns": [{"key": "reference"}], "rows": []}},
            "signatures": [{"role": role, "label": label, "name": None, "date": None, "evidence_ref": None}
                           for role, label in (("design", "设计"), ("check", "校核"), ("review", "审核"), ("approve", "批准"))]}
        complete_sources = {source_id: {**formal["sources"][source_id], "payload": payload}}
        formal["source_digest"] = digest(complete_sources)
        formal["model_digest"] = digest({**formal, "sources": complete_sources})
        assert validate_model(formal, {source_id: payload})["numeric_cells"] == 1
        altered = deepcopy(formal)
        altered_cell = altered["tables"]["results"]["rows"][0]["cells"]["value"]
        altered_cell["value"] = float(format(quantity["value"], ".16g"))
        altered_cell["raw_text"] = json.dumps(altered_cell["value"])
        with pytest.raises(RuntimeError, match="完整 API 来源数值不一致"):
            validate_model(altered, {source_id: payload})
        altered = deepcopy(formal)
        altered["tables"]["results"]["rows"][0]["cells"]["value"]["raw_text"] = format(quantity["value"], ".16g")
        with pytest.raises(RuntimeError, match="原始数值文本被舍入"):
            validate_model(altered, {source_id: payload})
        altered = deepcopy(formal)
        altered["tables"]["results"]["rows"][0]["cells"]["value"]["unit"] = "kA"
        with pytest.raises(RuntimeError, match="单位与完整 API 来源不一致"):
            validate_model(altered, {source_id: payload})
        altered = deepcopy(formal)
        altered["signatures"][-1]["name"] = "编造的批准人"
        with pytest.raises(RuntimeError, match="签栏必须全部留空"):
            validate_model(altered, {source_id: payload})
        projected = deepcopy(run)
        projected["snapshot"]["cases"][0].pop("input")
        with pytest.raises(RuntimeError, match="禁止用 detail/evidence 投影"):
            full_run_payload(projected)

        # Exercise the actual workbook endpoint on this same computed record.
        # Tamper only ZIP/XML cells, preserving all other numeric lexemes; a
        # re-save through openpyxl would itself round the values under test.
        request = {"kind": "calculation", "source": {"workspace_id": wid, "expected_revision": workspace["revision"],
                   "runs": [{"run_id": run["id"], "input_digest": run["input_digest"], "output_digest": run["output_digest"]}]},
                   "document": {"organization": "自动验收示例单位", "number": "T4-EXACT-001", "revision": "A.0",
                                "header": "完整保存运行", "footer": "精度与来源验收"}}
        response = client.post("/api/formal-deliveries/preview", json=request)
        assert response.status_code == 200, response.text
        preview = response.json()

        class ApiEvidence:
            def api(self, method, path):
                response = client.request(method, path)
                assert response.status_code == 200, response.text
                return response.json()

            def artifact(self, name, value):
                target = tmp_path / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")

        payloads = SourceReader(ApiEvidence()).payloads(preview)
        validate_model(preview, payloads, expected_document=request["document"])
        response = client.post("/api/formal-deliveries/export", json={**request, "format": "xlsx",
                               "expected_model_digest": preview["model_digest"]})
        assert response.status_code == 200, response.text
        raw = response.content
        assert validate_xlsx(raw, preview, payloads)["numeric_xml_exact"] is True

        from openpyxl import load_workbook
        workbook = load_workbook(BytesIO(raw), data_only=False)
        index_sheet = workbook["追溯数值"]
        index_row = next(row for row in index_sheet.iter_rows(min_row=2)
                         if row[8].value == source_id and row[9].value == cell["value_ref"]["pointer"])
        numeric_address = index_row[6].coordinate
        unit_address = index_row[7].coordinate
        body_sheet = index_row[3].value
        body_address = index_row[4].value
        sheet_parts = {sheet.title: f"xl/worksheets/sheet{number}.xml" for number, sheet in enumerate(workbook, 1)}
        workbook.close()
        namespace = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

        def altered_cell_bytes(sheet_name, address, *, text=None, numeric=None):
            result = BytesIO()
            with ZipFile(BytesIO(raw)) as source, ZipFile(result, "w", ZIP_DEFLATED) as target:
                for entry in source.infolist():
                    data = source.read(entry.filename)
                    if entry.filename == sheet_parts[sheet_name]:
                        xml = ElementTree.fromstring(data)
                        node = next(item for item in xml.findall("m:sheetData/m:row/m:c", namespace)
                                    if item.attrib["r"] == address)
                        if text is not None:
                            node.find("m:is/m:t", namespace).text = text
                        if numeric is not None:
                            node.find("m:v", namespace).text = numeric
                        data = ElementTree.tostring(xml, encoding="utf-8")
                    target.writestr(entry, data)
            return result.getvalue()

        with pytest.raises(RuntimeError, match="重新打开后的数值与 API 不一致"):
            validate_xlsx(altered_cell_bytes("追溯数值", numeric_address,
                          numeric=format(quantity["value"], ".16g")), preview, payloads)
        with pytest.raises(RuntimeError, match="正文原文数值与 API 不一致"):
            validate_xlsx(altered_cell_bytes(body_sheet, body_address,
                          text=format(quantity["value"], ".16g")), preview, payloads)
        with pytest.raises(RuntimeError, match="单位或单位来源不一致"):
            validate_xlsx(altered_cell_bytes("追溯数值", unit_address, text="kA"), preview, payloads)

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
