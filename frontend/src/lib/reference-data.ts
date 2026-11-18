import { numeric, optionalRecord, text } from "@/api/client";

/**
 * 资源来源里的标准摘录（schema `cablesim.reference-data/1`，见 features/type/README“离线材料与标准参考库”）：
 * 数值行、缺项行、标准版本条目三种。只做显示投影，不推断缺的值，不把摘录当计算参数。
 */
export type ReferenceValue = {
  property: string; value: number; unit: string; standard: string; table: string;
  printedPage: number | null; pdfPage: number | null; condition: string; sourceDigest: string;
};
export type ReferenceGap = { properties: string[]; reason: string };
export type ReferenceEdition = {
  standard: string; edition: string; file: string; scope: string; pdfPage: number | null; sourceDigest: string; rights: string;
};
export type ReferenceData = { values: ReferenceValue[]; gaps: ReferenceGap[]; editions: ReferenceEdition[]; other: { kind: string; reference: string; reviewed: boolean }[] };

export const REFERENCE_SCHEMA = "cablesim.reference-data/1";

const PROPERTY_LABELS: Record<string, string> = {
  electrical_resistivity_20: "20 °C 电阻率",
  temperature_coefficient_20: "20 °C 电阻温度系数",
  thermal_resistivity: "热阻率",
  thermal_resistivity_insulation_le3kv: "热阻率（绝缘，不超过 3 kV）",
  thermal_resistivity_insulation_gt3kv: "热阻率（绝缘，超过 3 kV）",
  thermal_resistivity_covering_le35kv: "热阻率（护层，不超过 35 kV）",
  thermal_resistivity_covering_gt35kv: "热阻率（护层，超过 35 kV）",
  relative_permittivity: "相对介电常数",
  loss_tangent: "介质损耗角正切",
  density: "密度",
  mass_density: "密度",
  resistivity_20_ohm_m: "20 °C 电阻率",
  volumetric_heat_capacity: "体积热容",
  thermal_conductivity: "热导率",
  burial_depth: "埋深",
  conductor_area: "导体截面",
  conductor_limit: "导体温度上限",
  ambient_temperature: "环境温度",
  temperature_rise: "温升",
  linear_resistance: "单位长度电阻",
  current: "电流",
  frequency: "频率",
};
export const propertyLabel = (property: string) => PROPERTY_LABELS[property] || property;

const RIGHTS: Record<string, string> = { not_assessed: "授权未评估", not_registered: "未登记" };
export const rightsLabel = (value: string) => value.split("/").map((part) => RIGHTS[part] || part).join(" · ");

/** 来源列表 → 三类摘录；不是该 schema 的来源原样归入 other，不丢弃。 */
export function referenceData(sources: unknown): ReferenceData {
  const data: ReferenceData = { values: [], gaps: [], editions: [], other: [] };
  for (const source of Array.isArray(sources) ? sources : []) {
    const row = optionalRecord(source), reference = text(row.reference);
    let parsed: Record<string, unknown> | null = null;
    try { parsed = optionalRecord(JSON.parse(reference)); } catch { /* 非 JSON 出处按原文显示 */ }
    if (!parsed || parsed.schema !== REFERENCE_SCHEMA) { data.other.push({ kind: text(row.kind), reference, reviewed: row.reviewed === true }); continue; }
    const value = numeric(parsed.value);
    if (typeof parsed.property === "string" && value !== null) data.values.push({
      property: parsed.property, value, unit: text(parsed.unit), standard: text(parsed.standard), table: text(parsed.table),
      printedPage: numeric(parsed.printed_page), pdfPage: numeric(parsed.pdf_page), condition: text(parsed.condition), sourceDigest: text(parsed.source_digest),
    });
    else if (Array.isArray(parsed.missing)) data.gaps.push({ properties: parsed.missing.map(text), reason: text(parsed.reason) });
    else if (typeof parsed.edition === "string") data.editions.push({
      standard: text(parsed.standard), edition: parsed.edition, file: text(parsed.file), scope: text(parsed.scope),
      pdfPage: numeric(parsed.pdf_page), sourceDigest: text(parsed.source_digest), rights: text(parsed.rights),
    });
    else data.other.push({ kind: text(row.kind), reference, reviewed: row.reviewed === true });
  }
  return data;
}

const SUPERSCRIPT: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
/** 标准表值原样显示有效数字；很小或很大的数写成 a × 10ⁿ，不四舍五入改值。 */
export function referenceNumber(value: number) {
  const raw = String(value);
  const [mantissa, exponent] = (Math.abs(value) !== 0 && (Math.abs(value) < 1e-3 || Math.abs(value) >= 1e6) ? value.toExponential() : raw).split("e");
  if (!exponent) return mantissa;
  return `${mantissa} × 10${exponent.replace("+", "").split("").map((c) => SUPERSCRIPT[c] || c).join("")}`;
}

/** 出处一句话：标准 · 表 · 印刷页（PDF 页）。 */
export function referenceCitation(value: { standard: string; table?: string; printedPage?: number | null; pdfPage?: number | null }) {
  return [value.standard, value.table && `表 ${value.table}`, value.printedPage !== null && value.printedPage !== undefined && `印刷第 ${value.printedPage} 页`,
    value.pdfPage !== null && value.pdfPage !== undefined && `PDF 第 ${value.pdfPage} 页`].filter(Boolean).join(" · ");
}
