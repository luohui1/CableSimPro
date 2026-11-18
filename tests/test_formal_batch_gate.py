"""A real saved IEC run and actual API ZIP expose batch evidence tampering."""
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from xml.etree import ElementTree
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi.testclient import TestClient
from openpyxl import load_workbook
import pytest

from backend.main import create_app
from scripts.verify_formal_batch import unpack_batch, validate_batch_files, validate_batch_preview, verify_formal_batches
from scripts.verify_formal_delivery import (SourceReader, canonical, digest, full_run_payload,
                                           validate_model, verify_formal_exports)
from scripts.verify_installation import InstallationGate
from test_formal_sources import saved as full_sources
from test_research import study, request as execution_request


def repack(entries):
    result = BytesIO()
    with ZipFile(result, "w", ZIP_DEFLATED) as archive:
        for name, content in entries:
            archive.writestr(name, content)
    return result.getvalue()


@pytest.fixture(scope="module")
def actual_batch(tmp_path_factory):
    directory = tmp_path_factory.mktemp("actual-batch-gate")
    with TestClient(create_app(directory / "engineering.sqlite")) as client:
        workspace, definition = study(client)
        prefix, execution = execution_request(client, workspace, definition)
        response = client.post(prefix + "/runs", json=execution)
        assert response.status_code == 200, response.text
        run = response.json()
        assert run["status"] == "succeeded" and run["integrity"] == "verified"
        response = client.get(prefix + "/runs/" + run["id"], params={"view": "full"})
        assert response.status_code == 200, response.text
        full_run_payload(response.json())
        single = {"kind": "calculation", "source": {"workspace_id": workspace["id"],
            "expected_revision": workspace["revision"], "runs": [{"run_id": run["id"],
                "input_digest": run["input_digest"], "output_digest": run["output_digest"]}]},
            "document": {"organization": "批量独立验收单位", "number": "同一编号-001", "revision": "A",
                         "header": "实际保存的 IEC 运行", "footer": "完整来源与精确数值核验", "issued_on": "2026-01-01"}}
        request = {"scope": {"kind": "project", "workspace_id": workspace["id"]},
                   "items": [{**deepcopy(single), "key": "first", "formats": ["pdf", "xlsx"]},
                             {**deepcopy(single), "key": "second", "formats": ["xlsx"]}]}

        class Evidence:
            def api(self, method, path):
                response = client.request(method, path)
                assert response.status_code == 200, response.text
                return response.json()

            def artifact(self, name, value):
                target = directory / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")

        def forbidden(*_args, **_kwargs):
            pytest.fail("批量交付重新执行了求解器，未只读消费保存结果")

        with pytest.MonkeyPatch.context() as patch:
            patch.setattr(client.app.state.research.executor, "run", forbidden)
            response = client.post("/api/formal-deliveries/preview", json=single)
            assert response.status_code == 200, response.text
            model = response.json()
            payload = SourceReader(Evidence()).payloads(model)
            models = {"first": model, "second": deepcopy(model)}
            payloads = {"first": payload, "second": payload}
            response = client.post("/api/formal-deliveries/batch/preview", json=request)
            assert response.status_code == 200, response.text
            preview = response.json()
            validate_batch_preview(preview, request, models, payloads)
            response = client.post("/api/formal-deliveries/batch/export", json={
                **request, "expected_batch_digest": preview["batch_digest"]})
            assert response.status_code == 200, response.text
            raw, headers = response.content, dict(response.headers)
            manifest, members = unpack_batch(raw, preview)
            yield {"request": request, "preview": preview, "models": models, "payloads": payloads,
                   "raw": raw, "headers": headers, "manifest": manifest, "members": members}


def test_actual_zip_keeps_duplicate_document_numbers_distinct_and_exact(actual_batch):
    actual = actual_batch
    assert actual["headers"]["content-type"] == "application/zip"
    assert actual["headers"]["cache-control"] == "no-store"
    assert actual["headers"]["x-artifact-sha256"] == sha256(actual["raw"]).hexdigest()
    assert actual["headers"]["x-delivery-batch-sha256"] == actual["preview"]["batch_digest"]
    assert list(actual["members"]) == ["manifest.json", "001-first/calculation.pdf",
                                       "001-first/calculation.xlsx", "002-second/calculation.xlsx"]
    assert [item["document"]["number"] for item in actual["manifest"]["items"]] == ["同一编号-001"] * 2
    checks = validate_batch_files(actual["manifest"], actual["members"], actual["models"], actual["payloads"])
    assert len(checks) == 3
    assert checks[0]["pages"] >= 2
    assert all(item["numeric_xml_exact"] and item["numeric_reopen_exact"] and item["original_text_exact"]
               for item in checks[1:])


def test_single_export_gate_passes_exact_successful_selections_to_real_batches(full_sources, tmp_path, monkeypatch):
    """Exercise the installed gate's handoff against real saved five-channel API data."""
    client = full_sources["client"]
    rating, calculation = full_sources["rating_table"], full_sources["calculation"]
    engineering_sources = {
        "workspace": full_sources["workspace"]["id"], "study": rating["study"], "run": rating["id"],
        "calculation_workspace": full_sources["calculation_workspace"]["id"],
        "calculation_study": calculation["study"], "calculation_run": calculation["id"],
    }
    posted = []

    class ApiGate(InstallationGate):
        def api(self, method, path, body=None, *, binary=False, include_headers=False):
            if method == "POST":
                posted.append((path, deepcopy(body)))
            response = client.request(method, path, json=body)
            assert response.status_code == 200, response.text[:1000]
            content = response.content if binary else response.json()
            return (content, dict(response.headers)) if include_headers else content

    def forbidden(*_args, **_kwargs):
        pytest.fail("single-to-batch verification must consume saved results, never recalculate")

    monkeypatch.setattr(client.app.state.research.executor, "run", forbidden)
    gate = ApiGate(tmp_path, timeout=30)
    requests = verify_formal_exports(gate, engineering_sources)
    assert set(requests) == {"specification", "calculation", "rating_table", "research_report"}
    assert gate.result["formal_documents"]["status"] == "passed"
    single_exports = [body for path, body in posted if path == "/api/formal-deliveries/export"]
    assert len(single_exports) == 8
    for exported in single_exports:
        assert requests[exported["kind"]] == {key: exported[key] for key in ("kind", "source", "document")}
    before = deepcopy(requests)
    verify_formal_batches(gate, requests)
    assert requests == before
    assert gate.result["formal_batches"]["status"] == "passed"
    assert all(list((tmp_path / prefix / "sources").glob("*.json"))
               for prefix in ("formal", "batch/project", "batch/series"))
    batch_exports = [body for path, body in posted if path == "/api/formal-deliveries/batch/export"]
    assert {body["scope"]["kind"] for body in batch_exports} == {"project", "series"}
    for batch in batch_exports:
        for item in batch["items"]:
            assert {key: item[key] for key in ("kind", "source", "document")} == requests[item["kind"]]


@pytest.mark.parametrize("mutation", ["manifest-sha", "manifest-source", "missing", "duplicate", "traversal"])
def test_actual_zip_or_manifest_tampering_is_rejected_and_safe_members_retained(actual_batch, mutation):
    actual = actual_batch
    entries = list(actual["members"].items())
    manifest = deepcopy(actual["manifest"])
    if mutation == "manifest-sha":
        manifest["files"][0]["sha256"] = "0" * 64
        entries[0] = ("manifest.json", canonical(manifest))
    elif mutation == "manifest-source":
        manifest["files"][0]["source_identity"]["pins"][0]["output_digest"] = "0" * 64
        entries[0] = ("manifest.json", canonical(manifest))
    elif mutation == "missing":
        entries.pop()
    elif mutation == "duplicate":
        entries[-1] = entries[-2]
    elif mutation == "traversal":
        entries[-1] = ("../outside.xlsx", entries[-1][1])
    if mutation == "duplicate":
        with pytest.warns(UserWarning, match="Duplicate name"):
            changed = repack(entries)
    else:
        changed = repack(entries)
    retained = {}
    with pytest.raises(RuntimeError):
        unpack_batch(changed, actual["preview"], retain=lambda name, value: retained.__setitem__(name, value))
    if mutation.startswith("manifest-"):
        # A failed integrity assertion must not discard the safe original files
        # needed to inspect the failure; unsafe paths must never be extracted.
        assert retained == dict(entries)
    else:
        assert retained == {}


def test_self_consistent_preview_digest_cannot_change_selected_run(actual_batch):
    actual = actual_batch
    changed = deepcopy(actual["preview"])
    changed["items"][1]["source_identity"]["pins"][0]["input_digest"] = "0" * 64
    changed["batch_digest"] = digest({key: value for key, value in changed.items() if key != "batch_digest"})
    with pytest.raises(RuntimeError, match="独立文件模型或完整来源不一致"):
        validate_batch_preview(changed, actual["request"], actual["models"], actual["payloads"])


def test_body_gate_uses_the_frozen_publisher_id_not_only_the_builtin_prefix(actual_batch):
    # Identifier-policy mutation only: the altered snapshot is never presented
    # as an actual server record, and no engineering number is manufactured.
    model, payloads = deepcopy(actual_batch["models"]["first"]), deepcopy(actual_batch["payloads"]["first"])
    source_id = next(key for key, value in payloads.items() if "snapshot" in value)
    manifest = next(iter(payloads[source_id]["snapshot"]["method_manifests"].values()))
    manifest["id"] = "manufacturer.thermal"
    model["sources"][source_id]["payload_digest"] = digest(payloads[source_id])
    body = next(section for section in model["sections"] if section["role"] == "body")
    body["paragraphs"] = [{"text": "Manufacturer.Thermal 的保存说明", "source_ref": None, "verbatim": False}]
    with pytest.raises(RuntimeError, match="正文段落出现插件标识"):
        validate_model(model, payloads)


def test_rehashed_zip_still_rejects_rounded_actual_iec_workbook_number(actual_batch):
    actual = actual_batch
    name = "001-first/calculation.xlsx"
    original = actual["members"][name]
    workbook = load_workbook(BytesIO(original), data_only=False)
    try:
        sheet = workbook["追溯数值"]
        row = next(row for row in sheet.iter_rows(min_row=2)
                   if row[12].value == "float" and "/output/" in row[9].value
                   and float(format(row[6].value, ".16g")) != row[6].value)
        address, rounded = row[6].coordinate, format(row[6].value, ".16g")
        sheet_part = f"xl/worksheets/sheet{workbook.sheetnames.index(sheet.title) + 1}.xml"
    finally:
        workbook.close()
    entries = []
    namespace = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with ZipFile(BytesIO(original)) as archive:
        for info in archive.infolist():
            content = archive.read(info)
            if info.filename == sheet_part:
                xml = ElementTree.fromstring(content)
                cell = next(node for node in xml.findall("m:sheetData/m:row/m:c", namespace) if node.attrib["r"] == address)
                cell.find("m:v", namespace).text = rounded
                content = ElementTree.tostring(xml, encoding="utf-8")
            entries.append((info.filename, content))
    changed_xlsx = repack(entries)
    members, manifest = dict(actual["members"]), deepcopy(actual["manifest"])
    members[name] = changed_xlsx
    record = next(item for item in manifest["files"] if item["path"] == name)
    record.update(bytes=len(changed_xlsx), sha256=sha256(changed_xlsx).hexdigest())
    members["manifest.json"] = canonical(manifest)
    # Every ZIP/manifest hash is now internally consistent. Only reopening the
    # actual workbook against the independently fetched full run can reject it.
    manifest, members = unpack_batch(repack(members.items()), actual["preview"])
    with pytest.raises(RuntimeError, match="重新打开后的数值与 API 不一致"):
        validate_batch_files(manifest, members, actual["models"], actual["payloads"])
