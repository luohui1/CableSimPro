import { numeric, optionalRecord, text } from "@/api/client";
import { displayUnit } from './display-names';

/** 展开参数契约里的包内引用（#/$defs/…）与可空的 anyOf，得到可直接渲染的字段描述。 */
export function expand(raw: unknown, root: unknown): Record<string, unknown> {
  let field = optionalRecord(raw);
  const ref = text(field.$ref);
  if (ref.startsWith("#/")) {
    let value = root;
    for (const key of ref.slice(2).split("/")) value = optionalRecord(value)[key];
    field = { ...optionalRecord(value), ...field };
  }
  if (Array.isArray(field.anyOf)) field = { ...expand(field.anyOf.find((item) => optionalRecord(item).type !== "null"), root), ...field };
  return field;
}

export type DisplayUnit = { unit: string; scale: number; offset: number };

/** 清单声明的显示单位（显示值 = SI × scale + offset）；非物理量返回 null。 */
export function declaredUnit(value: unknown): DisplayUnit | null {
  const unit = optionalRecord(value);
  if (!("display" in unit) && !("si" in unit)) return null;
  const label = text(unit.display) || text(unit.si);
  return label ? { unit: label === "1" ? "" : displayUnit(label), scale: numeric(unit.scale) ?? 1, offset: numeric(unit.offset) ?? 0 } : null;
}

/** 单位随同一行另一个字段变化（x-unit-by：selector + cases）。 */
export function rowUnit(field: Record<string, unknown>, row: Record<string, unknown>): DisplayUnit | null {
  const cases = optionalRecord(field["x-unit-by"]);
  if (text(cases.selector)) return declaredUnit(optionalRecord(cases.cases)[text(row[text(cases.selector)])]);
  return declaredUnit(field["x-unit"]);
}

export const toDisplay = (value: number, unit: DisplayUnit | null) => (unit ? value * unit.scale + unit.offset : value);
export const toSi = (value: number, unit: DisplayUnit | null) => (unit ? (value - unit.offset) / unit.scale : value);

/** 对象的标量字段（按 x-order），身份摘要类字段由宿主绑定，不在表格里编辑。 */
export function scalarColumns(item: Record<string, unknown>, root: unknown): [string, Record<string, unknown>][] {
  return Object.entries(optionalRecord(item.properties))
    .map(([key, raw]) => [key, expand(raw, root)] as [string, Record<string, unknown>])
    .filter(([key, field]) => !/_sha256$/.test(key) && ["number", "integer", "string", "boolean"].includes(text(field.type)))
    .sort(([, a], [, b]) => (numeric(a["x-order"]) ?? 0) - (numeric(b["x-order"]) ?? 0));
}
