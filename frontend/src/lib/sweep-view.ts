import { array, record, optionalRecord, numeric, text, ApiError } from "@/api/client";
import { displayName } from "./display-names";
import { entityLabel, savedDomain } from "./domain-fields";
export type SweepPoint = { id: string; label: string; x: number | null; value: number | null; unit: string; key: string; entity: string; status: string; reason: string; verdict: string; changes: Record<string, unknown>; source: Record<string, unknown> };
export function sweepView(run: Record<string, unknown>, selectedQuantity = "") {
  if (run.integrity !== "verified") throw new ApiError(409, "扫描运行完整性未通过，拒绝显示结果");
  const snapshot = record(run.snapshot, "扫描快照"), definition = record(snapshot.definition, "扫描配置"), driver = record(definition.driver, "扫描驱动");
  if (driver.kind !== "sweep") return undefined;
  const samples = array(driver.samples, "固定采样").map(optionalRecord), cases = array(record(run.output, "扫描输出").cases, "逐点输出").map(optionalRecord);
  const metrics = new Map<string, { value: string; label: string; key: string; entity: string; condition: string; unit: string }>();
  for (const value of cases) for (const raw of Array.isArray(value.results) ? value.results : []) {
    const row = optionalRecord(raw);
    if (row.type !== "quantity") continue;
    const id = [row.key, row.entity, row.case, row.unit].join("|");
    metrics.set(id, { value: id, label: displayName(text(row.key)) + " · " + entityLabel(savedDomain(run), text(row.entity)) + (row.case && row.case !== "rating" ? " · " + displayName(text(row.case)) : ""), key: text(row.key), entity: text(row.entity), condition: text(row.case), unit: text(row.unit) });
  }
  // 默认口径依次取：用户所选 → 扫描目标 → 插件声明的默认结果（如三回同时额定）→ 第一个载流量。
  const preferred = optionalRecord(record(run.output, "扫描输出").default_result);
  const isPreferred = (row: { key: string; entity: string; condition: string }) => row.key === text(preferred.key) && row.entity === text(preferred.entity) && row.condition === text(preferred.case);
  const targets = [...metrics.values()].filter(row => row.key === driver.target_key && row.entity === driver.target_entity);
  const metric = metrics.get(selectedQuantity) || targets.find(isPreferred) || targets[0]
    || [...metrics.values()].find(isPreferred) || [...metrics.values()].find(row => row.key === "ampacity") || [...metrics.values()][0];
  const points: SweepPoint[] = samples.map((sample, index) => {
    const current = cases.find(row => row.case_id === "case-" + index);
    if (!current) throw new ApiError(502, "扫描快照缺少第 " + (index + 1) + " 个点的执行状态");
    const matches = (Array.isArray(current.results) ? current.results : []).map(optionalRecord).filter(row => metric && [row.key, row.entity, row.case, row.unit].join("|") === metric.value);
    if (matches.length > 1) throw new ApiError(502, "扫描结果口径重复，拒绝选择一个值补空");
    const result = matches[0], changes = optionalRecord(sample.changes);
    const coordinates = Object.values(changes).filter(value => numeric(value) !== null);
    const x = coordinates.length === 1 ? numeric(coordinates[0]) : numeric(text(sample.label).split(" ")[0] ? Number(text(sample.label).split(" ")[0]) : null);
    const goals = Object.values(optionalRecord(current.artifacts)).flatMap(value => Array.isArray(optionalRecord(value).goal_checks) ? optionalRecord(value).goal_checks as unknown[] : []).map(optionalRecord);
    const goal = goals.find(row => row.key === metric?.key && row.entity === metric?.entity && (!metric?.condition || row.condition === metric.condition));
    return { id: text(current.case_id), label: text(sample.label), x, value: current.status === "succeeded" && result?.status === "available" ? numeric(result.value) : null, unit: metric?.unit || "", key: metric?.key || "", entity: metric?.entity || "", status: text(current.status), reason: text(optionalRecord(current.error).message) || text(optionalRecord(result?.reason).message) || (result?.status !== "available" ? "该点没有可用的指定结果" : ""), verdict: text(goal?.verdict), changes, source: optionalRecord(optionalRecord(definition.input_sources)["/driver/samples"]) };
  });
  return { points, metrics: [...metrics.values()], metric, definition };
}
