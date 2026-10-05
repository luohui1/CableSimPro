import type { components } from "@/api/generated/schema";
import { displayName } from "./display-names";
import { ApiError, numeric, optionalRecord, text } from "@/api/client";

export type DomainDocument = components["schemas"]["DomainDocument"];
export function savedDomain(run: Record<string, unknown>) {
  const snapshot = optionalRecord(run.snapshot),
    definition = optionalRecord(snapshot.definition);
  const input =
    definition.input_source === "study"
      ? definition.method_input
      : optionalRecord(snapshot.workspace_state).domain;
  return optionalRecord(input).schema_version === "cablesim.domain/1"
    ? (input as DomainDocument)
    : undefined;
}
export type NumericInput = {
  path: string;
  label: string;
  unit: string;
  scale?: number;
  offset?: number;
  precision?: number;
  min?: number;
  max?: number;
  required?: boolean;
  minExclusive?: boolean;
};
export type DomainDraft = {
  document: DomainDocument;
  base: DomainDocument;
  revision: number;
  scope: string;
  fields: Record<string, { value: string; spec: NumericInput }>;
};
export const pointer = (...parts: string[]) =>
  "/" +
  parts
    .map((part) => part.replaceAll("~", "~0").replaceAll("/", "~1"))
    .join("/");
export function at(document: unknown, path: string): unknown {
  let value: unknown = document;
  for (const encoded of path.split("/").slice(1)) {
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    value = Array.isArray(value)
      ? value.find((item) => {
          const row = optionalRecord(item);
          return row.id === key || row.role === key || row.cable === key;
        })
      : optionalRecord(value)[key];
  }
  return value;
}
function location(
  document: DomainDocument,
  path: string,
): [Record<string, unknown>, string] {
  const parts = path
    .split("/")
    .slice(1)
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  let target: unknown = document;
  for (const key of parts.slice(0, -1))
    target = Array.isArray(target)
      ? target.find((value) => {
          const row = optionalRecord(value);
          return row.id === key || row.role === key || row.cable === key;
        })
      : optionalRecord(target)[key];
  if (!target || typeof target !== "object" || Array.isArray(target))
    throw new ApiError(422, "字段对象已不存在：" + path);
  return [target as Record<string, unknown>, parts.at(-1)!];
}
export function displayed(
  document: unknown,
  spec: NumericInput,
): number | null {
  const value = numeric(at(document, spec.path));
  return value === null ? null : value * (spec.scale ?? 1) + (spec.offset ?? 0);
}
export function change(
  document: DomainDocument,
  path: string,
  value: unknown,
): DomainDocument {
  if (at(document, path) === value) return document;
  const next = structuredClone(document);
  const [target, key] = location(next, path);
  target[key] = value;
  next.provenance = {
    ...next.provenance,
    [path]: {
      kind: "user",
      reference: "工程师在研究工作区填写",
      reviewed: false,
    },
  };
  return next;
}
export function parseInput(spec: NumericInput, value: string): number | null {
  if (!value.trim()) {
    if (spec.required) throw new ApiError(422, "请填写" + spec.label);
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number))
    throw new ApiError(422, spec.label + "：请输入有效数值");
  if (spec.min !== undefined && number < spec.min)
    throw new ApiError(
      422,
      spec.label + "：不得小于 " + spec.min + " " + spec.unit,
    );
  if (spec.min !== undefined && spec.minExclusive && number === spec.min)
    throw new ApiError(
      422,
      spec.label + "：须大于 " + spec.min + " " + spec.unit,
    );
  if (spec.max !== undefined && number > spec.max)
    throw new ApiError(
      422,
      spec.label + "：不得大于 " + spec.max + " " + spec.unit,
    );
  return (number - (spec.offset ?? 0)) / (spec.scale ?? 1);
}
export function commitFields(draft: DomainDraft): DomainDocument {
  let document = draft.document;
  for (const [path, field] of Object.entries(draft.fields))
    document = change(document, path, parseInput(field.spec, field.value));
  return document;
}
export function isLocked(locks: unknown, path: string): boolean {
  return (
    Array.isArray(locks) &&
    locks.some(
      (value) =>
        typeof value === "string" &&
        (path === value || path.startsWith(value + "/")),
    )
  );
}
export function fieldSource(document: DomainDocument, path: string) {
  const sources = document.provenance || {};
  const matched = Object.keys(sources)
    .filter((key) => path === key || path.startsWith(key + "/"))
    .sort((a, b) => b.length - a.length)[0];
  return optionalRecord(matched ? sources[matched] : undefined);
}
export function entityLabel(document: unknown, id: string): string {
  const doc = optionalRecord(document);
  for (const key of [
    "cable_types",
    "circuits",
    "sections",
    "materials",
    "load_cases",
  ]) {
    const rows = Array.isArray(doc[key]) ? (doc[key] as unknown[]) : [];
    const index = rows.findIndex((row) => optionalRecord(row).id === id);
    if (index >= 0) {
      const row = optionalRecord(rows[index]);
      const label = text(row.label);
      return label && label !== "v0 circuit"
        ? displayName(label)
        : ({
            circuits: "回路",
            load_cases: "负荷",
            materials: "材料",
            sections: "截面",
            cable_types: "电缆",
          }[key] || "对象") +
            " " +
            (index + 1);
    }
  }
  if (id.startsWith("cable/")) {
    const circuits = Array.isArray(doc.circuits)
      ? (doc.circuits as unknown[])
      : [];
    for (const circuit of circuits) {
      const row = optionalRecord(circuit);
      const cables = Array.isArray(row.cables) ? row.cables : [];
      const index = cables.findIndex(
        (cable) => optionalRecord(cable).id === id,
      );
      if (index >= 0)
        return (
          entityLabel(document, text(row.id)) +
          " · " +
          text(optionalRecord(cables[index]).phase)
        );
    }
  }
  return displayName(id);
}
