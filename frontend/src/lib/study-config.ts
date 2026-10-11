import type { components } from "@/api/generated/schema";
import type { StudyDefinition } from "@/api/research";
import { ApiError } from "@/api/client";
import { parseInput, type NumericInput } from "./domain-fields";
import { pointerParts } from './missing-input';
export type Configuration = components["schemas"]["StudyConfiguration"];
export type ParameterDraft = {
  module: string;
  path: string;
  text: string;
  kind: "number" | "integer" | "json";
  spec?: NumericInput;
  crosscheck?: number;
};
export function rootModule(definition: StudyDefinition): string {
  if (definition.method?.capability === "physics-comparison") return "method-compare";
  if (definition.method_input?.schema_version === "cablesim.simulation-problem/1") return "simulation";
  if (definition.method?.plugin_id === "cablesim.hybrid-rating")
    return "hybrid";
  const cap = definition.method?.capability || "";
  if (cap === "transient-temperature") return "transient";
  if (cap === "sheath-losses") return "sheath-losses";
  if (cap === "electrothermal-steady") return "electrothermal";
  if (cap.includes("temperature-field") || cap === "thermal-field" ||
      cap === "iec-thermal-field" || cap === "multiregion-thermal")
    return "thermal-field";
  return (
    (
      {
        selection: "selection",
        sweep: "sweep",
        batch: "batch",
        crosscheck: "method-compare",
      } as Record<string, string>
    )[definition.driver?.kind || ""] || "ampacity"
  );
}
export function studyEntryTab(module: string): string {
  return ({ sweep: "curve", batch: "space", "thermal-field": "field" } as Record<string, string>)[module] || "results";
}
export function configurationOnly(value: Configuration): Configuration {
  const { modules: _modules, ...configuration } = value as StudyDefinition;
  void _modules;
  return configuration;
}
export function moduleConfiguration(
  definition: StudyDefinition,
  module: string,
): Configuration | undefined {
  return (
    definition.modules?.[module] ||
    (module === rootModule(definition) ? definition : undefined)
  );
}
export function withConfiguration(
  definition: StudyDefinition,
  module: string,
  value: Configuration,
): StudyDefinition {
  return definition.modules?.[module]
    ? { ...definition, modules: { ...definition.modules, [module]: value } }
    : { ...definition, ...value };
}
export function parameterChange(
  definition: StudyDefinition,
  module: string,
  path: string,
  value: unknown,
  crosscheck?: number,
): StudyDefinition {
  const next = structuredClone(definition),
    config = moduleConfiguration(next, module);
  if (!config) throw new ApiError(422, "参数所属模块不存在");
  const parts = pointerParts(path);
  if (!parts.length) throw new ApiError(422, '参数字段路径无效');
  const owner = crosscheck === undefined ? config : config.crosschecks?.[crosscheck];
  if (!owner) throw new ApiError(422, "对照方法配置不存在");
  const params = owner.parameters || {};
  let target: Record<string, unknown> = params;
  for (const key of parts.slice(0, -1)) {
    if (
      !target[key] ||
      typeof target[key] !== "object"
    )
      target[key] = {};
    target = target[key] as Record<string, unknown>;
  }
  // 空数组元素保留位置，不能删除后把左右/上下坐标错位。
  if (value === undefined && Array.isArray(target)) target[Number(parts.at(-1)!)] = null;
  else if (value === undefined) delete target[parts.at(-1)!];
  else target[parts.at(-1)!] = value;
  owner.parameters = params;
  config.input_sources = {
    ...config.input_sources,
    [(crosscheck === undefined ? "" : "/crosschecks/" + crosscheck) + "/parameters" + path]: {
      kind: "user",
      reference: "工程师按匹配的输入契约填写",
      reviewed: false,
    },
  };
  return withConfiguration(next, module, config);
}
export function commitParameters(
  definition: StudyDefinition,
  fields: Record<string, ParameterDraft>,
): StudyDefinition {
  let next = definition;
  for (const field of Object.values(fields)) {
    next = parameterChange(next, field.module, field.path, committedParameter(field), field.crosscheck);
  }
  return next;
}
export function committedParameter(field: ParameterDraft): unknown {
    let value: unknown;
    if (field.kind === "json") {
      try {
        value = JSON.parse(field.text);
      } catch {
        throw new ApiError(422, "参数 " + field.path + "：请输入有效 JSON");
      }
    } else {
      value = parseInput(field.spec!, field.text);
      if (
        field.kind === "integer" &&
        value !== null &&
        !Number.isInteger(value)
      )
        throw new ApiError(422, field.spec!.label + "：请输入整数");
      if (value === null && !field.spec?.required) value = undefined;
    }
    return value;
}
