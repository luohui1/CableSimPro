import {
  array,
  record,
  optionalRecord,
  text,
  numeric,
  ApiError,
} from "@/api/client";
import type { SourceKind } from "@/components/source-badge";

export type SelectionRow = {
  id: string;
  name: string;
  section: number | null;
  current: number | null;
  margin: number | null;
  verdict: "satisfied" | "unsatisfied" | "inapplicable" | "error";
  reason: string;
  version: string;
  sources: Record<string, unknown>;
  dependencies: string[];
  candidate: Record<string, unknown>;
};
export function selectionView(run: Record<string, unknown>) {
  if (run.integrity !== "verified")
    throw new ApiError(409, "运行完整性未通过，拒绝显示数值");
  const snapshot = record(run.snapshot, "运行快照");
  const definition = record(snapshot.definition, "运行定义");
  const driver = record(definition.driver, "选型任务");
  if (driver.kind !== "selection")
    throw new ApiError(422, "所选运行不是问询选型");
  if (driver.target_unit !== "A")
    throw new ApiError(502, "源运行目标单位不是 A，拒绝套用电流显示");
  const candidates = array(snapshot.candidate_snapshots, "候选快照");
  const output = record(run.output, "选型输出");
  const target = numeric(driver.minimum);
  if (target === null || target <= 0)
    throw new ApiError(502, "源运行缺少有效目标电流");
  const rows: SelectionRow[] = array(output.assessment, "候选判定").map(
    (value) => {
      const assessment = record(value, "判定");
      const caseId = text(assessment.case_id);
      const match = /^case-(\d+)$/.exec(caseId);
      if (!match || !candidates[Number(match[1])])
        throw new ApiError(502, "候选判定无法对应固定型号快照");
      const candidate = record(candidates[Number(match[1])], "候选");
      const payload = record(candidate.payload, "候选型号");
      const cable = optionalRecord(payload.cable_type);
      const specification = optionalRecord(payload.specification);
      const core = Array.isArray(cable.cores)
        ? optionalRecord(cable.cores[0])
        : {};
      const area =
        numeric(optionalRecord(core.conductor).nominal_area) ??
        numeric(specification.area_m2);
      const sourceStatus = text(assessment.status);
      if (assessment.unit !== undefined && assessment.unit !== "A")
        throw new ApiError(502, "源运行候选数值单位不是 A，拒绝套用电流显示");
      if (
        sourceStatus &&
        !["satisfied", "not_satisfied", "not_applicable", "failed"].includes(
          sourceStatus,
        )
      )
        throw new ApiError(502, "源运行包含未知候选判定，拒绝显示数值");
      const verdict =
        (
          {
            satisfied: "satisfied",
            not_satisfied: "unsatisfied",
            not_applicable: "inapplicable",
            failed: "error",
          } as const
        )[sourceStatus as "satisfied"] ??
        (assessment.meets_target === true
          ? "satisfied"
          : assessment.meets_target === false
            ? "unsatisfied"
            : "error");
      return {
        id: caseId,
        name: text(payload.name) || text(cable.label),
        section: area === null ? null : area * 1e6,
        current: numeric(assessment.value),
        margin: numeric(assessment.margin),
        verdict,
        reason:
          verdict === "satisfied"
            ? "—"
            : text(optionalRecord(assessment.reason).message) ||
              "源运行未提供限制原因",
        version: text(payload.version),
        sources: optionalRecord(payload.sources),
        dependencies: Array.isArray(candidate.dependencies)
          ? candidate.dependencies.filter(
              (v): v is string => typeof v === "string",
            )
          : [],
        candidate,
      };
    },
  );
  // Recommendation repeats the host's documented ordering of saved satisfied candidates; no current, temperature or verdict is calculated here.
  const ranked = rows
    .filter(
      (row) =>
        row.verdict === "satisfied" &&
        ["reviewed", "user_reviewed", "engineering_input"].includes(
          text(row.candidate.state),
        ) &&
        row.section !== null,
    )
    .sort(
      (a, b) =>
        a.section! - b.section! ||
        (a.margin ?? 0) - (b.margin ?? 0) ||
        a.name.localeCompare(b.name),
    );
  const recommendation =
    driver.allow_demo_candidates === true ? undefined : ranked[0];
  return {
    rows,
    target,
    recommendation,
    method: optionalRecord(definition.method),
    historical: run.freshness !== "current",
    demo: driver.allow_demo_candidates === true,
    title: text(definition.title),
  };
}
export function sourceKind(value: unknown): SourceKind | undefined {
  const kind = text(optionalRecord(value).kind);
  return (
    {
      manufacturer: "document",
      user: "user",
      standard: "standard",
      derived: "derived",
      library: "library",
      asset: "library",
      measurement: "measurement",
    } as Record<string, SourceKind>
  )[kind];
}
