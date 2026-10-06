import { numeric, optionalRecord, text } from "@/api/client";

/**
 * 把一次运行里某个工况的导体温度（运行工况，插件给出的 SI 值）转成截面标注：
 * 电缆放置 id → 「87.8 °C」，最热的一根加强显示。没有该结果时返回 undefined，不补值。
 */
export function conductorAnnotations(run: Record<string, unknown> | undefined, caseId?: string) {
  const cases = (Array.isArray(optionalRecord(run?.output).cases) ? optionalRecord(run?.output).cases as unknown[] : []).map(optionalRecord);
  const current = (caseId && cases.find((item) => text(item.case_id) === caseId)) || cases[0];
  if (!current) return undefined;
  const temperatures = new Map<string, number>();
  for (const item of Array.isArray(current.results) ? current.results : []) {
    const row = optionalRecord(item);
    const value = numeric(row.value);
    if (text(row.key) === "conductor_temperature" && text(row.case) === "operating" && text(row.status) !== "unavailable" && value !== null)
      temperatures.set(text(row.entity), value);
  }
  if (!temperatures.size) return undefined;
  const hottest = Math.max(...temperatures.values());
  return Object.fromEntries([...temperatures].map(([entity, kelvin]) => [entity, { text: `${(kelvin - 273.15).toFixed(1)} °C`, emphasis: temperatures.size > 1 && kelvin === hottest }]));
}
