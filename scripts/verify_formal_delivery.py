"""Independently inspect formal API files against complete frozen API records.

This is the installed-release gate's verifier, not a renderer. It deliberately
does not import the backend's model builder, numeric formatter or XLSX writer.
"""
from __future__ import annotations

from copy import deepcopy
from collections import Counter
import base64
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from hashlib import sha256
from io import BytesIO
import json
import math
import posixpath
import re
import unicodedata
from urllib.parse import parse_qs, urlencode, urlsplit
from xml.etree import ElementTree
import zipfile


SCHEMA = "cablesim.formal-delivery/1"
ROLES = (("design", "设计"), ("check", "校核"), ("review", "审核"), ("approve", "批准"))
RUN_FIELDS = ("id", "workspace", "study", "sequence", "input_digest", "output_digest", "status", "created", "finished")
# Expected public SI vocabulary, audited separately from the formal producer.
# These are declarations of named contracts, never guesses from field suffixes.
DOMAIN_UNITS = {name: unit for unit, names in {
    "m2": "nominal_area",
    "m": "diameter inner_diameter outer_diameter thickness length x z width height wire_diameter lay_length core_lay_length corrugation_depth corrugation_pitch padding_thickness tape_width tape_gap screen_inner_diameter nominal_tape_thickness reverse_binder_thickness reverse_binder_width",
    "ohm/m": "r20 longitudinal_r20", "K·m/W": "thermal_resistivity dry_thermal_resistivity",
    "J/(m³·K)": "volumetric_heat_capacity", "Ω·m": "electrical_resistivity_20",
    "1/K": "temperature_coefficient_20", "kg/m³": "density",
    "1": "relative_permittivity relative_permeability loss_tangent emissivity solar_absorptivity wire_count segments parallel_index tape_count reverse_binder_count lay_factor overlap minimum_overlap conductor_class",
    "K": "surface_temperature air_temperature critical_temperature_rise", "s": "duration period",
    "Hz": "frequency longitudinal_resistance_frequency", "V": "voltage u0 u um",
    "m/s": "wind_speed", "W/m²": "solar_irradiance", "°": "sector_angle_deg sector_rotation_deg",
    "rad": "reference_angle_rad",
}.items() for name in names.split()}
CONTRACT_UNITS = {
    "x-cablesim.cad-model": {
        "outer_diameter_m": "m", "inner_diameter_m": "m", "length_m": "m", "mass_kg_per_km": "kg/km",
        "inner_radius_m": "m", "outer_radius_m": "m", "material_volume_m3": "m³", "envelope_volume_m3": "m³",
        "density_kg_m3": "kg/m³", "material_volume_m3_per_km": "m³/km"},
    "type-rating-table": {
        "circuit_count": "1", "value_a": "A", "depth_m": "m", "soil_rho_k_m_w": "K·m/W", "ambient_temperature_c": "°C",
        "actual_spacing_m": "m", "spacing_m": "m", "frequency_hz": "Hz", "duct_inner_m": "m",
        "duct_outer_m": "m", "duct_rho_k_m_w": "K·m/W"},
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def canonical(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value) -> str:
    return sha256(canonical(value)).hexdigest()


def original_text(value) -> str:
    return "" if value is None else value if isinstance(value, str) else canonical(value).decode("utf-8")


def pointer_value(document, pointer: str):
    """Resolve RFC 6901 without borrowing the implementation under test."""
    require(isinstance(pointer, str) and (not pointer or pointer.startswith("/")), "正式文件来源指针无效。")
    value = document
    if not pointer:
        return value
    for token in pointer[1:].split("/"):
        require(re.search(r"~(?![01])", token) is None, "正式文件来源指针含无效转义。")
        key = token.replace("~1", "/").replace("~0", "~")
        if isinstance(value, list):
            require(re.fullmatch(r"0|[1-9][0-9]*", key) is not None, "正式文件来源数组下标无效。")
            value = value[int(key)]
        else:
            require(isinstance(value, dict) and key in value, "正式文件来源指针没有对应记录。")
            value = value[key]
    return value


def full_run_payload(record: dict) -> dict:
    require(record["integrity"] == "verified" and record["status"] in {"succeeded", "partial"},
            "正式文件来源运行未通过完整性核验。")
    require(digest(record["snapshot"]) == record["input_digest"], "正式文件没有取得完整运行输入；禁止用 detail/evidence 投影。")
    require(digest(record["output"]) == record["output_digest"], "正式文件没有取得完整运行输出。")
    require(all("input" in case for case in record["snapshot"]["cases"]), "完整运行快照缺少工况输入。")
    return {"record": {key: record[key] for key in RUN_FIELDS},
            "snapshot": record["snapshot"], "output": record["output"]}


def validate_contract_unit(cell: dict, payloads: dict, sources: dict) -> None:
    reference, unit_reference = cell.get("value_ref"), cell["unit_ref"]
    contract, field = unit_reference.get("contract"), unit_reference.get("field")
    require(reference is not None and isinstance(field, str), "声明单位缺少数值来源或字段身份。")
    path, source_id = reference["pointer"], reference["source_id"]
    if contract == "cablesim.domain/1":
        match = re.fullmatch(r"(/snapshot/cases/[0-9]+/input)(/.*)", path)
        require(match is not None and match[2] == field and sources[source_id]["kind"] == "run"
                and pointer_value(payloads[source_id], match[1])["schema_version"] == contract,
                "领域单位声明与完整输入的字段身份不一致。")
        tokens = [part.replace("~1", "/").replace("~0", "~") for part in field[1:].split("/")]
        require("provenance" not in tokens and "layout_template" not in tokens, "来源描述不得充当工程单位契约。")
        unit = "K" if "max_conductor_temperature" in tokens else (
            "A" if "currents" in tokens or "base_current" in tokens else DOMAIN_UNITS.get(tokens[-1]))
    elif contract == "x-cablesim.cad-model":
        require(sources[source_id]["kind"] == "run"
                and re.fullmatch(r"/output/cases/[0-9]+/artifacts/x-cablesim\.cad-model(?:/(?:layers|material_usage)/[0-9]+)?/" + re.escape(field), path),
                "结构工件单位声明与保存字段身份不一致。")
        unit = CONTRACT_UNITS[contract].get(field)
    elif contract == "type-rating-table":
        require(sources[source_id]["kind"] == "rating_projection"
                and re.fullmatch(r"/rows/[0-9]+/" + ("" if field == "value_a" else "condition/") + re.escape(field), path),
                "载流量单位声明与 API 投影字段身份不一致。")
        unit = CONTRACT_UNITS[contract].get(field)
    else:
        raise RuntimeError("未定义的正式文件单位契约：" + str(contract))
    require(unit is not None and cell.get("unit") == unit, "正式文件单位与明确声明的原始契约不一致。")


class SourceReader:
    """Fetch each declared source independently and retain its whole API reply."""
    def __init__(self, gate):
        self.gate = gate
        self.responses = {}

    def get(self, url: str):
        if url not in self.responses:
            response = self.gate.api("GET", url)
            self.responses[url] = response
            self.gate.artifact("formal/sources/" + sha256(url.encode()).hexdigest() + ".json",
                               {"api_url": url, "response": response})
        return self.responses[url]

    def payloads(self, model: dict) -> dict:
        observed = {}
        for source_id, source in model["sources"].items():
            require("payload" not in source, "预览意外返回完整来源，接口投影契约改变。")
            url = source["api_url"]
            parsed = urlsplit(url)
            require(not parsed.scheme and not parsed.netloc and not parsed.fragment and parsed.path.startswith("/api/"),
                    "正式文件来源不是本次安装服务的 API。")
            kind = source["kind"]
            if kind == "run":
                match = re.fullmatch(r"/api/workspaces/([^/]+)/studies/([^/]+)/runs/([^/]+)", parsed.path)
                require(match is not None and parse_qs(parsed.query) == {"view": ["full"]},
                        "正式文件运行来源必须明确使用 view=full。")
                record = self.get(url)
                require((record["workspace"], record["study"], record["id"]) == match.groups()
                        and source_id == "run:" + record["id"], "正式文件运行身份与 API 地址不一致。")
                payload = full_run_payload(record)
            elif kind == "workspace":
                match = re.fullmatch(r"/api/workspaces/([^/]+)", parsed.path)
                require(match is not None and not parsed.query, "正式文件工程来源地址无效。")
                record = self.get(url)
                require(record["id"] == match[1] and source_id == "workspace:" + record["id"], "正式文件工程身份不一致。")
                payload = {"id": record["id"], "revision": record["revision"]}
            elif kind == "specification":
                match = re.fullmatch(r"/api/types/([^/]+)/specification", parsed.path)
                parameters = parse_qs(parsed.query)
                require(match is not None and parameters.get("audience") == ["internal"]
                        and set(parameters) <= {"audience", "view"}
                        and parameters.get("view", ["full"]) == ["full"], "正式规格书来源须为完整内部 API 记录。")
                require(source_id == "specification:" + match[1], "正式规格书来源身份不一致。")
                record = self.get(parsed.path + "?" + urlencode({"audience": "internal", "view": "full"}))
                require(digest(record["payload"]) == record["digest"], "正式规格书完整冻结来源摘要不符。")
                payload = {"payload": record["payload"], "digest": record["digest"],
                           "lifecycle": {key: record["lifecycle"][key] for key in ("status", "submission_id", "approval", "stale")}}
            elif kind == "rating_projection":
                match = re.fullmatch(r"/api/design/workspaces/([^/]+)/rating-table-runs/([^/]+)", parsed.path)
                require(match is not None and parse_qs(parsed.query) == {"view": ["rows"]}
                        and source_id == "rating:" + match[2] and source["run_source_id"] == "run:" + match[2],
                        "载流量投影身份或 API 契约无效。")
                require(source["projection"] == "rows-and-run-digests", "载流量来源投影契约发生改变。")
                table = self.get(url)
                run_url = model["sources"][source["run_source_id"]]["api_url"]
                run = self.get(run_url)
                full_run_payload(run)
                require(run["id"] == match[2] and run["workspace"] == match[1]
                        and table["run"]["integrity"] == "verified"
                        and all(table["run"][key] == run[key] for key in ("id", "workspace", "input_digest", "output_digest")),
                        "载流量投影与完整来源运行不一致。")
                inputs = {item["case_id"]: item["input"] for item in run["snapshot"]["cases"]}
                outputs = {item["case_id"]: item for item in run["output"]["cases"]}
                for row in table["rows"]:
                    circuits = inputs[row["case_id"]]["circuits"]
                    joint = len(circuits) > 1 and row["condition"]["rating_basis"] == "simultaneous"
                    entities = {item["id"] for item in circuits} if joint else {circuits[0]["id"]}
                    values = {item["entity"]: item["value"] for item in outputs[row["case_id"]]["results"]
                              if item["key"] == "ampacity" and item.get("unit") == "A" and item["status"] == "available"
                              and item.get("case", "rating") == ("rating-simultaneous" if joint else "rating")
                              and item["entity"] in entities}
                    require(set(values) == entities and row["value_a"] == min(values.values()),
                            "正式载流量表与完整运行的原始电流不一致。")
                payload = {"run_id": run["id"], "input_digest": run["input_digest"],
                           "output_digest": run["output_digest"], "rows": table["rows"]}
            else:
                raise RuntimeError("未定义的正式交付来源契约：" + str(kind))
            require(digest(payload) == source["payload_digest"], "正式交付来源摘要与独立完整 API 记录不一致：" + source_id)
            observed[source_id] = payload
        require(bool(observed), "正式文件没有可核验的来源。")
        return observed


def validate_model(model: dict, payloads: dict, *, expected_document: dict | None = None) -> dict:
    """Check every visible value and reference, including original numeric text."""
    require(model.get("schema") == SCHEMA, "正式文件模型版本不正确。")
    require(set(model["sources"]) == set(payloads), "正式文件来源记录不完整。")
    for source_id, payload in payloads.items():
        require(digest(payload) == model["sources"][source_id]["payload_digest"], "正式文件来源内容与摘要不符。")
    if expected_document is not None:
        for key, value in expected_document.items():
            require(model["metadata"].get(key) == value, "正式文件单位信息或文件元数据发生改变：" + key)
    require([(item["role"], item["label"]) for item in model["signatures"]] == list(ROLES),
            "正式文件缺少独立设计、校核、审核、批准签栏。")
    require(all(not item.get("name") and not item.get("date") and not item.get("evidence_ref")
                for item in model["signatures"]), "发布种子没有签核记录，正式文件签栏必须全部留空。")

    body_tables, used, trace_started = set(), [], False
    for section in model["sections"]:
        require(section["role"] in {"body", "trace"} and not (trace_started and section["role"] == "body"),
                "正式文件追溯章节顺序无效。")
        trace_started |= section["role"] == "trace"
        used.extend(section["table_ids"])
        if section["role"] == "body":
            body_tables.update(section["table_ids"])
            require("cablesim." not in section.get("heading", section.get("title", "")).lower(), "正式文件正文标题出现插件标识。")
        for paragraph in section.get("paragraphs", []):
            reference = paragraph.get("source_ref")
            if reference is not None:
                original = pointer_value(payloads[reference["source_id"]], reference["pointer"])
                if paragraph.get("verbatim"):
                    require(paragraph["text"] == original, "正式文件保存结论原文与 API 不一致。")
            if section["role"] == "body":
                require("cablesim." not in paragraph["text"].lower(), "正式文件正文段落出现插件标识。")
    require(trace_started and body_tables and set(used) == set(model["tables"]) and len(used) == len(set(used)),
            "正式文件正文、追溯页或表格缺失、重复。")
    numeric_cells, references, row_count = 0, 0, 0
    for table_id, table in model["tables"].items():
        columns = [column["key"] for column in table["columns"]]
        require(columns and len(columns) == len(set(columns)), "正式文件表头为空或重复。")
        require(len({row["id"] for row in table["rows"]}) == len(table["rows"]), "正式文件同名结果行被重复覆盖。")
        if table_id in body_tables:
            visible = [table.get("title", "")] + [column.get("label", "") for column in table["columns"]]
            require(all("cablesim." not in str(value).lower() for value in visible), "正式文件正文表头出现插件标识。")
        row_count += len(table["rows"])
        for row in table["rows"]:
            require(set(row["cells"]) == set(columns), "正式文件行与表头列不一致。")
            for key in columns:
                cell = row["cells"][key]
                value = cell["value"]
                require(isinstance(value, (str, int, float, bool, type(None))), "正式文件可见单元格不是标量。")
                require(cell["raw_text"] == original_text(value), "正式文件原始数值文本被舍入或改变。")
                reference = cell.get("value_ref")
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    numeric_cells += 1
                    require(math.isfinite(value) and reference is not None, "正式文件数值没有有限的冻结来源。")
                if reference is not None:
                    references += 1
                    frozen = pointer_value(payloads[reference["source_id"]], reference["pointer"])
                    require(canonical(value) == canonical(frozen), "正式文件单元格与完整 API 来源数值不一致。")
                unit_reference = cell.get("unit_ref")
                if unit_reference is not None and "source_id" in unit_reference:
                    unit = pointer_value(payloads[unit_reference["source_id"]], unit_reference["pointer"])
                    require(cell.get("unit") == unit, "正式文件单位与完整 API 来源不一致。")
                elif unit_reference is not None:
                    validate_contract_unit(cell, payloads, model["sources"])
                if table_id in body_tables:
                    require("cablesim." not in (rendered_text(cell) + str(displayed_unit(cell) or "")).lower(),
                            "正式文件正文出现插件标识。")
    require(numeric_cells > 0, "正式文件没有可核验的真实工程数值。")
    check_engineering_body(model, payloads, body_tables)
    complete = {**model, "sources": {key: {**source, "payload": payloads[key]} for key, source in model["sources"].items()}}
    require(digest(complete["sources"]) == model["source_digest"], "正式文件完整来源集合摘要不一致。")
    model_digest = complete.pop("model_digest")
    require(digest(complete) == model_digest, "正式文件预览模型摘要与完整 API 来源不一致。")
    return {"sources": len(payloads), "tables": len(model["tables"]), "rows": row_count,
            "numeric_cells": numeric_cells, "referenced_cells": references, "empty_signature_roles": [role for role, _ in ROLES]}


def verify_embedded_model(model: dict, preview: dict, payloads: dict) -> None:
    """The file must retain the same preview plus the independent API payloads."""
    projected = deepcopy(model)
    for source_id, source in projected["sources"].items():
        require(canonical(source.pop("payload")) == canonical(payloads[source_id]), "导出附件中的完整来源与 API 不一致。")
    require(canonical(projected) == canonical(preview), "导出附件中的模型与已预览模型不一致。")


def validate_pdf(raw: bytes, preview: dict, payloads: dict) -> dict:
    """Inspect actual pages and the complete embedded source attachment."""
    import fitz

    require(raw.startswith(b"%PDF-"), "正式 PDF 接口未返回 PDF。")
    compact = lambda text: "".join(text.split())
    metadata = preview["metadata"]
    with fitz.open(stream=raw, filetype="pdf") as document:
        attachments = document.embfile_names()
        require(len(attachments) == 3 and set(attachments) == {"formal-model.json", "DROID_NOTICE.txt", "bitstream-vera-license.txt"},
                "正式 PDF 缺少唯一完整来源附件或字体许可。")
        embedded_bytes = document.embfile_get("formal-model.json")
        embedded = json.loads(embedded_bytes)
        require(embedded_bytes == canonical(embedded), "正式 PDF 完整来源附件不是规范 JSON。")
        require(all(document.embfile_get(name).strip() for name in attachments if name != "formal-model.json"), "正式 PDF 字体许可附件为空。")
        verify_embedded_model(embedded, preview, payloads)
        pages = [page.get_text() for page in document]
        require(len(pages) >= 2 and all(text.strip() for text in pages), "正式 PDF 缺少正文、追溯页或有空白页。")
        require("\ufffd" not in "".join(pages), "正式 PDF 包含乱码。")
        for number, (page, text) in enumerate(zip(document, pages, strict=True), 1):
            visible = compact(text)
            for key in ("organization", "number", "revision", "header", "footer"):
                if metadata.get(key):
                    require(compact(metadata[key]) in visible, f"正式 PDF 第 {number} 页缺少 {key}。")
            require(f"第{number}页/共{len(pages)}页" in visible, f"正式 PDF 第 {number} 页缺少完整页码。")
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    for span in line["spans"]:
                        if span["text"].strip():
                            x0, y0, x1, y1 = span["bbox"]
                            require(x0 >= -.5 and y0 >= -.5 and x1 <= page.rect.width + .5 and y1 <= page.rect.height + .5,
                                    f"正式 PDF 第 {number} 页存在越过页面边界的文字。")
        require(all(label in compact(pages[0]) for _role, label in ROLES), "正式 PDF 封面缺少四个签栏。")
        trace = [number for number, text in enumerate(pages) if "追溯记录" in [compact(line) for line in text.splitlines()]]
        require(trace and trace[0] > 0, "正式 PDF 追溯页没有从正文后的新页开始。")
        body = "".join(pages[:trace[0]])
        require("cablesim." not in compact(body).lower(), "正式 PDF 正文出现插件标识。")
        body_tables = {table_id for section in preview["sections"] if section["role"] == "body"
                       for table_id in section["table_ids"]}
        expected_numbers = Counter()
        expected_units = set()
        for table_id in body_tables:
            for row in preview["tables"][table_id]["rows"]:
                for cell in row["cells"].values():
                    if isinstance(cell["value"], (int, float)) and not isinstance(cell["value"], bool):
                        expected_numbers[rendered_text(cell)] += 1
                    if cell.get("unit"):
                        expected_units.add(displayed_unit(cell))
        if preview.get("presentation"):
            require(not re.search(r"\d+\.\d{7,}|(?<![A-Za-z])K(?![A-Za-z])|\bcase-\d+\b|\bthree_core_[a-z_]+|(?:ohm|Ω)/m\b", body),
                    "Rendered PDF body contains unrounded decimals, K or internal identifiers")
        observed_numbers = Counter(re.findall(r"(?<![\w.])[-+]?(?:\d+\.\d*|\d+)(?:[eE][-+]?\d+)?(?![\w.])", body))
        require(all(observed_numbers[value] >= count for value, count in expected_numbers.items()),
                "PDF body is missing declared displayed numbers")
        unit_text = compact(unicodedata.normalize("NFKC", body)).replace("−", "-")
        require(all(compact(unicodedata.normalize("NFKC", unit)).replace("−", "-") in unit_text
                    for unit in expected_units), "正式 PDF 正文缺少来源单位。")
        if metadata.get("logo_data_uri"):
            require(bool(document[0].get_images()), "正式 PDF 封面没有单位标志。")
        return {"pages": len(pages), "trace_starts_on_page": trace[0] + 1,
                "original_numeric_occurrences": sum(expected_numbers.values()), "original_units": sorted(expected_units),
                "attachment": "formal-model.json", "page_bounds_checked": True}


def validate_xlsx(raw: bytes, preview: dict, payloads: dict) -> dict:
    """Read the actual workbook and independently check raw numeric OOXML."""
    from openpyxl import load_workbook

    expected_header = ("table_id", "row_id", "column_key", "sheet", "cell", "raw_text", "numeric_value", "unit",
                       "source_id", "pointer", "unit_source_id", "unit_pointer", "numeric_kind")
    if preview.get("presentation"):
        expected_header += ("rendered_text", "display_text", "display_unit", "scale", "offset", "quantum", "rounding", "display_policy")
    expected = {(table_id, row["id"], key): cell
                for table_id, table in preview["tables"].items() for row in table["rows"]
                for key, cell in row["cells"].items()
                if isinstance(cell["value"], (int, float)) and not isinstance(cell["value"], bool)}
    workbook = load_workbook(BytesIO(raw), data_only=False, keep_links=False)
    try:
        require({"文件信息", "追溯原文", "追溯数值"} <= set(workbook.sheetnames), "正式 Excel 缺少文件信息或完整追溯页。")
        source_sheet, index_sheet = workbook["追溯原文"], workbook["追溯数值"]
        require(tuple(cell.value for cell in source_sheet[1]) == ("chunk_index", "json_chunk"), "正式 Excel 完整来源表头不符。")
        chunks = []
        for number, row in enumerate(source_sheet.iter_rows(min_row=2), 1):
            require(len(row) == 2 and row[0].value == number and isinstance(row[1].value, str)
                    and row[1].data_type == "s" and 0 < len(row[1].value) <= 30000,
                    "正式 Excel 完整来源分片不连续、被截断或不是原始文本。")
            chunks.append(row[1].value)
        complete_text = "".join(chunks)
        embedded = json.loads(complete_text)
        require(complete_text.encode("utf-8") == canonical(embedded), "正式 Excel 完整来源原文不是完整规范 JSON。")
        verify_embedded_model(embedded, preview, payloads)
        require(tuple(cell.value for cell in index_sheet[1]) == expected_header, "正式 Excel 数值追溯表头不符。")

        ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        with zipfile.ZipFile(BytesIO(raw)) as archive:
            xml_workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
            relationships = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            sheet = next(node for node in xml_workbook.findall("m:sheets/m:sheet", ns) if node.attrib["name"] == "追溯数值")
            relationship_id = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
            relationship = next(node for node in relationships if node.attrib["Id"] == relationship_id)
            target = relationship.attrib["Target"]
            part = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("xl", target))
            xml_sheet = ElementTree.fromstring(archive.read(part))
            xml_cells = {node.attrib["r"]: node for node in xml_sheet.findall("m:sheetData/m:row/m:c", ns)}
            logo = preview["metadata"].get("logo_data_uri")
            if logo:
                logo_sha = sha256(base64.b64decode(logo.split(",", 1)[1], validate=True)).hexdigest()
                require(any(sha256(archive.read(name)).hexdigest() == logo_sha for name in archive.namelist()
                            if name.startswith("xl/media/")), "正式 Excel 没有保留上传的单位标志。")

        seen, locations, units = set(), set(), set()
        for row in index_sheet.iter_rows(min_row=2):
            data = dict(zip(expected_header, (cell.value for cell in row), strict=True))
            identity = (data["table_id"], data["row_id"], data["column_key"])
            require(identity in expected and identity not in seen, "正式 Excel 数值索引缺失来源或重复覆盖。")
            seen.add(identity)
            cell = expected[identity]
            location = (data["sheet"], data["cell"])
            require(location not in locations and data["sheet"] not in {"追溯原文", "追溯数值"}, "正式 Excel 数值索引指向重复或内部单元格。")
            locations.add(location)
            visible = workbook[data["sheet"]][data["cell"]]
            require(visible.value == rendered_text(cell) and visible.data_type == "s", "正式 Excel 正文原文数值与 API 不一致。")
            require(row[5].data_type == "s" and data["raw_text"] == cell["raw_text"], "正式 Excel 数值原文列被舍入。")
            huge_integer = isinstance(cell["value"], int) and abs(cell["value"]) > 2 ** 53 - 1
            if huge_integer:
                require(data["numeric_kind"] == "int-text" and row[6].data_type == "s"
                        and data["numeric_value"] == cell["raw_text"], "正式 Excel 未保留超出精确范围的整数原文。")
            else:
                require(row[6].data_type == "n" and canonical(data["numeric_value"]) == canonical(cell["value"]),
                        "正式 Excel 重新打开后的数值与 API 不一致。")
                xml_cell = xml_cells[row[6].coordinate]
                require(xml_cell.attrib.get("t", "n") == "n" and xml_cell.findtext("m:v", namespaces=ns) == cell["raw_text"],
                        "正式 Excel OOXML 数值字面值与 API 原始值不一致。")
                require(data["numeric_kind"] == ("int" if isinstance(cell["value"], int) else "float"), "正式 Excel 数值类型发生改变。")
            reference, unit_reference = cell["value_ref"], cell.get("unit_ref") or {}
            require(data["source_id"] == reference["source_id"] and (data["pointer"] or "") == reference["pointer"],
                    "正式 Excel 数值来源指针不一致。")
            require((data["unit"] or "") == (cell.get("unit") or "")
                    and (data["unit_source_id"] or "") == unit_reference.get("source_id", "")
                    and (data["unit_pointer"] or "") == unit_reference.get("pointer", ""), "正式 Excel 单位或单位来源不一致。")
            if preview.get("presentation"):
                display = cell.get("display") or cell.get("display_origin") or {}
                expected_fields = {"rendered_text": rendered_text(cell),
                    "display_text": display.get("text", rendered_text(cell)), "display_unit": display.get("unit", displayed_unit(cell)),
                    **{k: display.get(k) for k in ("scale", "offset", "quantum", "rounding")},
                    "display_policy": display.get("policy")}
                require(all((data[k] or "") == (v or "") for k, v in expected_fields.items()),
                        "Excel trace lost the raw-to-display relationship")
            if data["unit"]:
                units.add(data["unit"])
        require(seen == set(expected), "正式 Excel 漏掉模型中的数值单元格。")

        expected_text = Counter(rendered_text(cell) for table in preview["tables"].values() for row in table["rows"]
                                for cell in row["cells"].values() if rendered_text(cell))
        visible_text, sheets = Counter(), []
        for sheet in workbook.worksheets:
            require(sheet.max_column <= 100 and sheet.max_row <= max(10000, len(expected) + 100), "正式 Excel 存在超出交付模型的异常区域。")
            metadata = preview["metadata"]
            page_text = "".join((part.text or "").replace("&&", "&") for element in (sheet.oddHeader, sheet.oddFooter)
                                for part in (element.left, element.center, element.right))
            compact = lambda text: "".join(text.split())
            require(all(compact(metadata.get(key, "")) in compact(page_text)
                        for key in ("organization", "number", "revision", "header", "footer"))
                    and "第&P页/共&N页" in compact(page_text), "正式 Excel 缺少单位、文件号、页眉页脚或页码。")
            for row in sheet.iter_rows():
                for cell in row:
                    require(cell.data_type != "f", "正式 Excel 把来源文本或数值变成了公式。")
                    if sheet.title not in {"追溯原文", "追溯数值", "文件信息"} and isinstance(cell.value, str):
                        visible_text[cell.value] += 1
            sheets.append({"name": sheet.title, "state": sheet.sheet_state, "rows": sheet.max_row,
                           "columns": sheet.max_column, "freeze_panes": str(sheet.freeze_panes or "")})
        require(all(visible_text[text] >= count for text, count in expected_text.items()), "正式 Excel 可见表格漏掉或改变了模型原文。")
        headers = Counter(column["label"] for table in preview["tables"].values() for column in table["columns"])
        require(all(visible_text[text] >= count for text, count in headers.items()), "正式 Excel 表头缺失或被改写。")
        require(all(visible_text[section["heading"]] for section in preview["sections"]), "正式 Excel 正文或追溯章节标题缺失。")
        cover_text = [cell.value for row in workbook["文件信息"].iter_rows() for cell in row if isinstance(cell.value, str)]
        for key in ("organization", "number", "revision", "header", "footer", "issued_on"):
            value = preview["metadata"].get(key)
            if value:
                require(value in cover_text, "正式 Excel 文件信息页缺少元数据：" + key)
        require(all(label in cover_text for _role, label in ROLES), "正式 Excel 文件信息页缺少四个签栏。")
        for _role, label in ROLES:
            signature_rows = [row for row in workbook["文件信息"].iter_rows() if row[0].value == label]
            require(len(signature_rows) == 1 and all(cell.value in (None, "") for cell in signature_rows[0][1:3]),
                    "正式 Excel 发布种子签栏出现没有依据的姓名或日期。")
        return {"sheets": sheets, "numeric_index_header": list(expected_header), "numeric_cells": len(seen),
                "raw_json_chunks": len(chunks), "units": sorted(units), "formulas": 0,
                "numeric_xml_exact": True, "numeric_reopen_exact": True, "original_text_exact": True}
    finally:
        workbook.close()


def sample_document() -> dict:
    """An explicit test organization and embedded test mark, never a real seal."""
    from PIL import Image, ImageDraw

    mark = Image.new("RGB", (144, 48), "#187f8c")
    drawing = ImageDraw.Draw(mark)
    drawing.rectangle((5, 5, 41, 41), outline="white", width=2)
    drawing.text((15, 17), "T4", fill="white")
    drawing.text((52, 17), "CI SAMPLE", fill="white")
    buffer = BytesIO()
    mark.save(buffer, format="PNG")
    return {"organization": "发行验收示例单位", "number": "T4-CI", "revision": "A.0",
            "header": "发布种子数据 · 正式文件验收", "footer": "验收示例 · 以保存运行记录为准",
            "issued_on": datetime.now(timezone.utc).date().isoformat(),
            "logo_data_uri": "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")}


def verify_formal_exports(gate, engineering_sources: dict) -> None:
    """Export all four document types through the installed release's real API."""
    reader = SourceReader(gate)
    wid, sid, rid = (engineering_sources[key] for key in ("workspace", "study", "run"))
    calc_wid, calc_sid, calc_rid = (engineering_sources[key] for key in
                                  ("calculation_workspace", "calculation_study", "calculation_run"))
    workspace = reader.get("/api/workspaces/" + wid)
    calculation_workspace = reader.get("/api/workspaces/" + calc_wid)
    rating = reader.get(f"/api/workspaces/{wid}/studies/{sid}/runs/{rid}?view=full")
    calculation = reader.get(f"/api/workspaces/{calc_wid}/studies/{calc_sid}/runs/{calc_rid}?view=full")
    full_run_payload(rating)
    full_run_payload(calculation)
    # The legacy chain generated a newer rating run. Fetch the specification
    # again, instead of reusing the now-stale digest from before that run.
    specification = reader.get(f"/api/types/{wid}/specification?audience=internal&view=full")
    require(digest(specification["payload"]) == specification["digest"], "当前完整规格书摘要不符。")

    def pin(run):
        return {"run_id": run["id"], "input_digest": run["input_digest"], "output_digest": run["output_digest"]}

    def selection(workspace, run):
        return {"workspace_id": workspace["id"], "expected_revision": workspace["revision"], "runs": [pin(run)]}

    selections = {
        "specification": {"workspace_id": wid, "expected_revision": workspace["revision"],
                          "specification_digest": specification["digest"]},
        "calculation": selection(calculation_workspace, calculation),
        "rating_table": selection(workspace, rating),
        # A genuine multi-case saved run exercises case identity in the report.
        "research_report": selection(workspace, rating),
    }
    metadata = sample_document()
    result = {"status": "running", "source_mode": "independent full API records", "documents": [],
              "human_visual_review": "逐页图片已生成后仍须人工逐页打开；自动检查不代替目视验收。"}
    gate.result["formal_documents"] = result
    for kind, source in selections.items():
        request = {"kind": kind, "source": source, "document": {**metadata, "number": "T4-CI-" + kind.upper() + "-001"}}
        prefix = "formal/" + kind
        gate.artifact(prefix + "-request.json", request)
        preview = gate.api("POST", "/api/formal-deliveries/preview", request)
        gate.artifact(prefix + "-preview.json", preview)
        require(preview["kind"] == kind, "正式交付 API 返回了错误文件类型。")
        identity = preview["source_identity"]
        require(identity["workspace_id"] == source["workspace_id"] and identity["revision"] == source["expected_revision"],
                "正式文件来源工程或修订与请求不一致。")
        if kind == "specification":
            require(identity["specification_digest"] == source["specification_digest"], "正式文件未使用请求固定的规格书摘要。")
            expected_pins = [{key: item[key] for key in ("run_id", "input_digest", "output_digest")}
                             for item in specification["payload"]["sources"]]
        else:
            expected_pins = source["runs"]
        require(canonical(identity["pins"]) == canonical(expected_pins), "正式文件所选运行或摘要与请求不一致。")
        with gate.step("正式 " + kind + " 所有数值、单位、签栏及完整来源核验"):
            payloads = reader.payloads(preview)
            checks = validate_model(preview, payloads, expected_document=request["document"])
        row = {"kind": kind, "source_digest": preview["source_digest"], "model_digest": preview["model_digest"],
               "model": checks, "formats": {}}
        result["documents"].append(row)
        for format in ("pdf", "xlsx"):
            raw, headers = gate.api("POST", "/api/formal-deliveries/export",
                {**request, "format": format, "expected_model_digest": preview["model_digest"]}, binary=True, include_headers=True)
            file_name = "formal-" + kind + "." + format
            # Retain/render failed output before applying assertions so a CI
            # failure remains reviewable instead of discarding the evidence.
            if format == "pdf":
                gate.pdf(file_name, raw, (preview["title"], request["document"]["organization"]))
            else:
                gate.artifact(file_name, raw)
            gate.artifact(prefix + "-" + format + "-headers.json", headers)
            with gate.step("正式 " + file_name + " 文件与完整 API 精确核验"):
                expected_mime = ("application/pdf" if format == "pdf" else
                                 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                require(headers.get("content-type", "").split(";")[0] == expected_mime
                        and headers.get("content-disposition", "").startswith("attachment;"), "正式文件响应类型或附件名称不正确。")
                require(headers.get("x-artifact-sha256") == sha256(raw).hexdigest()
                        and headers.get("x-delivery-source-sha256") == preview["source_digest"]
                        and headers.get("x-delivery-model-sha256") == preview["model_digest"], "正式文件响应摘要与实际文件或预览不一致。")
                details = validate_pdf(raw, preview, payloads) if format == "pdf" else validate_xlsx(raw, preview, payloads)
                row["formats"][format] = {"file": file_name, "sha256": sha256(raw).hexdigest(), **details}
                gate.artifact(prefix + "-" + format + "-validation.json", details)
        gate.artifact(prefix + "-validation.json", row)
    require(len(result["documents"]) == 4 and all(set(row["formats"]) == {"pdf", "xlsx"} for row in result["documents"]),
            "正式文件没有完成全部四类 PDF 与 Excel 导出。")
    result["status"] = "passed"
    gate.artifact("formal/validation.json", result)
