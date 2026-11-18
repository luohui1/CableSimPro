"""Independently inspect actual project/selected-series delivery ZIP files.

The installed-release gate uses only public APIs and the downloaded archive.
No batch builder, renderer or server-side manifest helper is imported here.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from pathlib import PurePosixPath
import re
import stat
import unicodedata
import zipfile

if __package__:
    from .verify_formal_delivery import (
        SourceReader, canonical, digest, require, validate_model, validate_pdf, validate_xlsx,
    )
else:
    from verify_formal_delivery import (
        SourceReader, canonical, digest, require, validate_model, validate_pdf, validate_xlsx,
    )


SCHEMA = "cablesim.formal-batch/1"
MAX_FILES = 32
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_BATCH_BYTES = 128 * 1024 * 1024
KINDS = ("specification", "calculation", "rating_table", "research_report")


def normalized_source(request: dict) -> dict:
    return {"specification_digest": None, "runs": [], **deepcopy(request["source"])}


def normalized_document(request: dict) -> dict:
    result = {"header": "", "footer": "", "issued_on": None, "logo_data_uri": None,
              **deepcopy(request["document"])}
    for key in ("organization", "number", "revision", "header", "footer"):
        result[key] = result[key].strip()
    return result


def validate_selection(model: dict, request: dict, payloads: dict) -> None:
    source = request["source"]
    require(model["kind"] == request["kind"], "批量条目返回了错误的文件类型。")
    expected = {"workspace_id": source["workspace_id"], "revision": source["expected_revision"]}
    if request["kind"] == "specification":
        specification = payloads["specification:" + source["workspace_id"]]
        require(specification["digest"] == source["specification_digest"], "批量规格书没有使用固定的来源摘要。")
        expected["specification_digest"] = source["specification_digest"]
        expected["pins"] = [{key: item[key] for key in ("run_id", "input_digest", "output_digest")}
                            for item in specification["payload"]["sources"]]
    else:
        expected["pins"] = source["runs"]
    require(canonical(model["source_identity"]) == canonical(expected), "批量条目的工程修订或完整运行身份与请求不一致。")


def validate_batch_preview(preview: dict, request: dict, models: dict, payloads: dict) -> dict:
    """Compare the batch plan with independent single previews and full APIs."""
    require(preview.get("schema") == SCHEMA, "批量预览版本不正确。")
    require(set(preview) == {"schema", "scope", "items", "file_count", "source_bytes", "batch_digest"},
            "批量预览字段不符合公开契约。")
    require(digest({key: value for key, value in preview.items() if key != "batch_digest"}) == preview["batch_digest"],
            "批量预览摘要与实际计划不一致。")
    expected_scope = deepcopy(request["scope"])
    workspaces = {item["source"]["workspace_id"] for item in request["items"]}
    revisions = {}
    for item in request["items"]:
        wid, revision = item["source"]["workspace_id"], item["source"]["expected_revision"]
        require(wid not in revisions or revisions[wid] == revision, "同一工程的批量条目修订不一致。")
        revisions[wid] = revision
    if expected_scope["kind"] == "project":
        require(workspaces == {expected_scope["workspace_id"]}, "项目批量范围混入其他工程。")
    else:
        require(expected_scope["kind"] == "series" and len(expected_scope["workspace_ids"]) == len(workspaces)
                and set(expected_scope["workspace_ids"]) == workspaces, "系列批量的显式成员与实际条目不一致。")
        expected_scope["series_name"] = expected_scope["series_name"].strip()
        expected_scope["membership_source"] = "explicit_workspace_ids"
    require(canonical(preview["scope"]) == canonical(expected_scope), "批量预览没有保留请求范围或伪称了系列归属。")
    require(0 < len(preview["items"]) == len(request["items"]) <= 16, "批量预览条目数量不完整。")

    keys, paths, source_bytes = set(), [], 0
    for index, (item, selected) in enumerate(zip(preview["items"], request["items"], strict=True), 1):
        key, kind, formats = selected["key"], selected["kind"], selected["formats"]
        require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,39}", key) is not None
                and key.casefold() not in keys, "批量条目标识不安全或存在大小写重名。")
        keys.add(key.casefold())
        require(kind in KINDS and 0 < len(formats) <= 2 and len(set(formats)) == len(formats)
                and set(formats) <= {"pdf", "xlsx"}, "批量条目格式无效或重复。")
        model = models[key]
        validate_selection(model, selected, payloads[key])
        validate_model(model, payloads[key], expected_document=normalized_document(selected))
        files = [{"format": format, "path": f"{index:03d}-{key}/{kind}.{format}"} for format in formats]
        expected = {"index": index, "key": key, "kind": kind, "title": model["title"],
                    "source": normalized_source(selected), "document": normalized_document(selected),
                    "source_identity": model["source_identity"], "model_digest": model["model_digest"],
                    "source_digest": model["source_digest"], "sources": model["sources"],
                    "formats": formats, "files": files}
        require(canonical(item) == canonical(expected), "批量预览条目与独立文件模型或完整来源不一致：" + key)
        full_sources = {source_id: {**descriptor, "payload": payloads[key][source_id]}
                        for source_id, descriptor in model["sources"].items()}
        source_bytes += len(canonical(full_sources))
        paths.extend(file["path"] for file in files)
    require(type(preview["file_count"]) is int and preview["file_count"] == len(paths) <= MAX_FILES,
            "批量预览文件数量不完整。")
    require(type(preview["source_bytes"]) is int and preview["source_bytes"] == source_bytes <= MAX_BATCH_BYTES,
            "批量预览的完整来源字节数不一致或超过上限。")
    require(len({path.casefold() for path in paths}) == len(paths), "批量路径会在 Windows 上相互覆盖。")
    return {"items": len(keys), "files": len(paths), "source_bytes": source_bytes,
            "workspaces": sorted(workspaces), "explicit_scope_verified": True}


def strict_json(raw: bytes):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "批量清单 JSON 含重复字段。")
            result[key] = value
        return result

    def constant(_value):
        raise RuntimeError("批量清单 JSON 含非有限数值。")

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def unpack_batch(raw: bytes, preview: dict, *, retain=None) -> tuple[dict, dict[str, bytes]]:
    """Read only safe, unique members, then verify the actual manifest and bytes.

    ``retain`` receives original ZIP members before content assertions. The
    caller already retains the ZIP itself, including structurally invalid ZIPs.
    """
    expected_files = [(item, file) for item in preview["items"] for file in item["files"]]
    expected_names = ["manifest.json", *(file["path"] for _item, file in expected_files)]
    require(len(expected_files) == preview["file_count"] <= MAX_FILES, "批量 ZIP 预期文件数不正确。")
    with zipfile.ZipFile(BytesIO(raw)) as archive:
        infos = archive.infolist()
        require(len(infos) == len(expected_names), "批量 ZIP 有缺失、重复或额外成员。")
        names = set()
        for info in infos:
            name = info.filename
            path = PurePosixPath(name)
            require(name and not path.is_absolute() and ".." not in path.parts
                    and "\\" not in name and ":" not in name and not any(ord(char) < 32 for char in name)
                    and name == path.as_posix() and all(part not in {"", ".", ".."} and part == part.rstrip(" .")
                        and not re.fullmatch(r"(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", part) for part in path.parts),
                    "批量 ZIP 包含不安全路径：" + name)
            normalized = unicodedata.normalize("NFC", name).casefold()
            require(normalized not in names, "批量 ZIP 包含重复路径或 Windows 大小写覆盖。")
            names.add(normalized)
            mode = stat.S_IFMT(info.external_attr >> 16)
            require(not info.is_dir() and mode in {0, stat.S_IFREG} and not info.flag_bits & 1,
                    "批量 ZIP 含目录、链接、特殊文件或加密成员。")
            require(0 < info.file_size <= MAX_FILE_BYTES, "批量 ZIP 单文件为空或超过允许大小。")
        require([info.filename for info in infos] == expected_names, "批量 ZIP 成员路径、顺序或格式与预览不一致。")
        require(sum(info.file_size for info in infos) <= MAX_BATCH_BYTES, "批量 ZIP 未压缩总量超过上限。")
        members = {info.filename: archive.read(info) for info in infos}
    if retain is not None:
        for name, content in members.items():
            retain(name, content)
    manifest = strict_json(members["manifest.json"])
    require(members["manifest.json"] == canonical(manifest), "批量清单不是规范 JSON。")
    require(set(manifest) == set(preview) | {"files"}
            and canonical({key: value for key, value in manifest.items() if key != "files"}) == canonical(preview),
            "批量清单计划或摘要与预览不一致。")
    require(len(manifest["files"]) == len(expected_files), "批量清单没有列全实际文件。")
    for record, (item, file) in zip(manifest["files"], expected_files, strict=True):
        content = members[file["path"]]
        expected = {"item_index": item["index"], "item_key": item["key"], "kind": item["kind"],
                    "format": file["format"], "path": file["path"], "bytes": len(content),
                    "sha256": sha256(content).hexdigest(), "model_digest": item["model_digest"],
                    "source_digest": item["source_digest"], "source": item["source"],
                    "source_identity": item["source_identity"], "sources": item["sources"]}
        require(canonical(record) == canonical(expected), "批量清单的文件摘要、大小或完整来源不一致：" + file["path"])
    return manifest, members


def validate_batch_files(manifest: dict, members: dict, models: dict, payloads: dict) -> list[dict]:
    """Reopen every PDF/XLSX and compare its own embedded source and values."""
    results = []
    for record in manifest["files"]:
        key, format = record["item_key"], record["format"]
        model = models[key]
        validator = validate_pdf if format == "pdf" else validate_xlsx
        details = validator(members[record["path"]], model, payloads[key])
        results.append({"path": record["path"], "item_key": key, "format": format,
                        "sha256": record["sha256"], **details})
    return results


def render_batch_pdf(gate, prefix: str, path: str, raw: bytes) -> int:
    """Render each original ZIP PDF without placing diagnostics among members."""
    import fitz

    stem = path.removesuffix(".pdf")
    with fitz.open(stream=raw, filetype="pdf") as document:
        texts = []
        for number, page in enumerate(document, 1):
            gate.artifact(f"{prefix}/pages/{stem}-{number:02}.png",
                          page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).tobytes("png"))
            texts.append(page.get_text())
        gate.artifact(f"{prefix}/text/{stem}.txt", "\n".join(texts).encode("utf-8"))
        return len(document)


def verify_formal_batches(gate, requests: dict[str, dict]) -> None:
    """Export a project and an explicitly selected multi-workspace series."""
    require(set(requests) == set(KINDS), "批量验收没有取得四类真实单文件来源。")
    project_kinds = ("specification", "rating_table", "research_report")
    project_workspace = requests["specification"]["source"]["workspace_id"]
    require(all(requests[kind]["source"]["workspace_id"] == project_workspace for kind in project_kinds),
            "项目验收选中的真实来源不属于同一工程。")
    calculation_workspace = requests["calculation"]["source"]["workspace_id"]
    require(calculation_workspace != project_workspace, "系列验收须实际包含另一个保存工程。")
    result = {"status": "running", "batches": [], "source_mode": "independent full API records",
              "human_visual_review": "批量 ZIP 内每个 PDF 的全页图须人工逐页打开；自动检查不代替目视验收。"}
    gate.result["formal_batches"] = result
    scopes = (("project", {"kind": "project", "workspace_id": project_workspace}, project_kinds),
              ("series", {"kind": "series", "series_name": "T4 发布验收所选工程",
                          "workspace_ids": [project_workspace, calculation_workspace]}, (*project_kinds, "calculation")))
    for label, scope, kinds in scopes:
        prefix = "batch/" + label
        request = {"scope": scope, "items": [{**deepcopy(requests[kind]), "key": kind, "formats": ["pdf", "xlsx"]}
                                             for kind in kinds]}
        gate.artifact(prefix + "/request.json", request)
        reader, models, payloads = SourceReader(gate, artifact_prefix=prefix + "/sources"), {}, {}
        for item in request["items"]:
            key = item["key"]
            single = {field: item[field] for field in ("kind", "source", "document")}
            models[key] = gate.api("POST", "/api/formal-deliveries/preview", single)
            gate.artifact(f"{prefix}/models/{key}-preview.json", models[key])
            payloads[key] = reader.payloads(models[key])
        preview = gate.api("POST", "/api/formal-deliveries/batch/preview", request)
        gate.artifact(prefix + "/preview.json", preview)
        with gate.step(label + " 批量范围与独立完整来源核验"):
            plan_checks = validate_batch_preview(preview, request, models, payloads)
        row = {"scope": label, "status": "running", "batch_digest": preview["batch_digest"], "plan": plan_checks}
        result["batches"].append(row)
        raw, headers = gate.api("POST", "/api/formal-deliveries/batch/export",
                                {**request, "expected_batch_digest": preview["batch_digest"]}, binary=True, include_headers=True)
        gate.artifact(prefix + "/delivery.zip", raw)
        gate.artifact(prefix + "/headers.json", headers)
        with gate.step(label + " 批量 ZIP 清单、路径、摘要与来源核验"):
            require(headers.get("content-type", "").split(";")[0] == "application/zip"
                    and headers.get("content-disposition", "").startswith("attachment;")
                    and headers.get("cache-control") == "no-store", "批量 ZIP 响应类型、附件或缓存策略不正确。")
            require(headers.get("x-artifact-sha256") == sha256(raw).hexdigest()
                    and headers.get("x-delivery-batch-sha256") == preview["batch_digest"], "批量 ZIP 响应摘要不正确。")
            manifest, members = unpack_batch(raw, preview,
                retain=lambda name, content: gate.artifact(prefix + "/expanded/" + name, content))
        # All original ZIP members are now retained, even if a document below
        # fails. Keep page images/text separate from that exact expansion.
        rendered = {}
        for record in manifest["files"]:
            if record["format"] == "pdf":
                with gate.step("逐页渲染批量 " + label + "/" + record["path"]):
                    rendered[record["path"]] = render_batch_pdf(gate, prefix, record["path"], members[record["path"]])
        with gate.step(label + " 批量每个 PDF/Excel 与完整 API 逐值核验"):
            files = validate_batch_files(manifest, members, models, payloads)
            require(all(file["pages"] == rendered[file["path"]] for file in files if file["format"] == "pdf"),
                    "批量 PDF 逐页图片数量与实际文件不符。")
        row.update(status="passed", archive_sha256=sha256(raw).hexdigest(), archive_bytes=len(raw), files=files,
                   pdf_pages=sum(rendered.values()), original_members=len(members), extracted_directory=prefix + "/expanded")
        gate.artifact(prefix + "/validation.json", row)
    require(len(result["batches"]) == 2 and all(row["status"] == "passed" for row in result["batches"]),
            "项目和所选系列两个真实批量导出没有全部通过。")
    result["status"] = "passed"
    gate.artifact("batch/validation.json", result)
