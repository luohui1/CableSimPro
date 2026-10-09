import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, array, message, numeric, optionalRecord, record, responseData, text } from "@/api/client";
import { studyRuns } from "@/api/research";
import { savedDomain, entityLabel } from "@/lib/domain-fields";
import { DataTable } from "@/components/data-table";
import { Select } from "@/components/ui/select";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { savedRunLabel } from './run-label';
import './field.css';

const records = (value: unknown) => Array.isArray(value) ? value.map(optionalRecord) : [];
const canonical = (value: unknown): string => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export function compareSavedFields(fem: Record<string, unknown>, iec: Record<string, unknown>) {
  if ([fem, iec].some(run => run.integrity !== "verified" || !["succeeded", "partial"].includes(text(run.status)))) throw Error("只能比较完整性通过的保存运行。");
  const snapshot = optionalRecord(fem.snapshot), other = optionalRecord(iec.snapshot);
  const definition = optionalRecord(snapshot.definition), referenceDefinition = optionalRecord(other.definition);
  if (optionalRecord(referenceDefinition.method).plugin_id !== "cablesim.iec60287") throw Error("参考运行不是 IEC 方法。");
  const cases = records(optionalRecord(fem.output).cases), referenceCases = records(optionalRecord(iec.output).cases);
  const caseId = text(optionalRecord(fem.convergence).reference_case_id) || text(cases[0]?.case_id);
  const chosen = cases.find(item => item.case_id === caseId && item.status === "succeeded");
  const original = records(snapshot.cases).find(item => item.case_id === caseId);
  const matchingIds = records(other.cases).filter(item => canonical(item.input) === canonical(original?.input)).map(item => item.case_id);
  const reference = referenceCases.find(item => item.status === "succeeded" && matchingIds.includes(item.case_id));
  if (!chosen || !reference || !original?.input) throw Error("两次保存运行没有完全相同的领域工况；请对同一保存输入运行 IEC。");
  const femParameters = optionalRecord(original.parameters), iecParameters = optionalRecord(records(other.cases).find(item => item.case_id === reference.case_id)?.parameters);
  const scope = (value: unknown) => Object.fromEntries(Object.entries(optionalRecord(value)).filter(([key]) => key !== 'operation'));
  if (canonical(scope(femParameters.iec)) !== canonical(scope(iecParameters))) throw Error("两次运行的 IEC 电损耗参数或额定口径不同，不能作为同工况对照。");
  const saved = records(chosen.results), right = records(reference.results);
  const identity = (row: Record<string, unknown>) => canonical([row.key, row.entity, row.unit, row.case]);
  const left: Record<string, unknown>[] = [...saved, ...right.filter(row => !saved.some(item => identity(item) === identity(row))).map(row =>
    ({ ...row, status: 'unavailable', value: null, reason: { message: '此保存级别未计算该量值。' } }))];
  const rows = left.filter(item => ["conductor_temperature", "ampacity"].includes(text(item.key))).map((item, index) => {
    const match = right.find(row => row.key === item.key && row.entity === item.entity && row.unit === item.unit && row.case === item.case);
    const a = item.status === "available" ? numeric(item.value) : null, b = match?.status === "available" ? numeric(match.value) : null;
    const delta = a !== null && b !== null ? a - b : null;
    // Relative absolute temperatures use kelvin, never Celsius percentages.
    return { id: String(index), entity: text(item.entity), key: text(item.key), condition: text(item.case), unit: text(item.unit),
      fem: a, iec: b, delta, relative: delta !== null && b !== null && b !== 0 ? delta / b * 100 : null,
      reason: text(optionalRecord(item.reason).message) || text(optionalRecord(match?.reason).message),
      exceeded: delta !== null && (item.unit === "K" ? Math.abs(delta) > 2 : b !== null && b !== 0 && Math.abs(delta / b) > .05) };
  });
  const temperatures = rows.filter(row => row.key === "conductor_temperature" && row.fem !== null && row.iec !== null);
  const expectedTemperatures = left.filter(row => row.key === "conductor_temperature");
  const referenceTemperatures = right.filter(row => row.key === "conductor_temperature");
  if (temperatures.length && temperatures.length === expectedTemperatures.length && temperatures.length === referenceTemperatures.length) {
    const a = Math.max(...temperatures.map(row => row.fem!)), b = Math.max(...temperatures.map(row => row.iec!));
    rows.unshift({ id: "maximum", entity: "最高导体温度", key: "conductor_temperature", condition: "operating", unit: "K", fem: a, iec: b, delta: a-b, relative: (a-b)/b*100, reason: "", exceeded: Math.abs(a-b)>2 });
  }
  return { rows, boundary: femParameters.outer_boundary === 'kennelly_image' ? 'Kennelly 镜像远场 · 当前迭代实际损耗' : '环境定温截断', femCase: caseId, iecCase: text(reference.case_id), method: optionalRecord(definition.method), referenceMethod: optionalRecord(referenceDefinition.method), femLabel: savedRunLabel(fem), iecLabel: savedRunLabel(iec) };
}

export function SavedFieldComparison({ run }: { run: Record<string, unknown> }) {
  const [selected, setSelected] = useState("");
  const wid = text(run.workspace);
  const candidates = useQuery({ queryKey: ["field-comparison-runs", wid], enabled: !!wid, queryFn: async ({ signal }) => {
    const studies = array(await responseData(api.GET("/api/workspaces/{wid}/studies", { params: { path: { wid } }, signal }))).map(optionalRecord);
    const values = await Promise.all(studies.filter(study => optionalRecord(optionalRecord(study.definition).method).plugin_id === "cablesim.iec60287").map(async study =>
      (await studyRuns(wid, text(study.id), signal, "summary")).filter(item => ["succeeded", "partial"].includes(text(item.status))).map(item => ({ ...item, id: text(item.id), created: text(item.created), study: text(study.id), title: text(optionalRecord(study.definition).title) }))));
    return values.flat();
  } });
  const candidate = candidates.data?.find(item => item.id === selected) || candidates.data?.at(-1);
  const comparison = useQuery({ queryKey: ["saved-field-comparison", run.id, candidate?.id], enabled: !!candidate, retry: false, queryFn: async ({ signal }) => {
    const read = async (id: string) => {
      const response = await fetch(`/api/hpc/workspaces/${encodeURIComponent(wid)}/fields/${encodeURIComponent(id)}/view`, { signal, credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw Error("保存运行读取失败（" + response.status + "）");
      return record(await response.json());
    };
    const [fem, iec] = await Promise.all([read(text(run.id)), read(text(candidate!.id))]);
    return compareSavedFields(fem, iec);
  } });
  const domain = savedDomain(run), data = comparison.data;
  const value = (number: number | null, unit: string) => number === null ? "未覆盖" : (unit === "K" ? number - 273.15 : number).toFixed(2);
  return <section className="input-section" aria-label="有限元与IEC保存运行对照">
    <h3>有限元 vs IEC</h3>
    {candidates.isPending ? <LoadingState title="读取保存运行" /> : candidates.error ? <ErrorState description={message(candidates.error)} /> : !candidate ? <EmptyState title="尚无可对照的 IEC 保存运行" description="在同一保存工况下运行 IEC 后再比较。" /> : <>
      <Select label="IEC 参考运行" value={text(candidate.id)} onChange={setSelected} options={(candidates.data || []).map(item => ({ value: text(item.id), label: savedRunLabel(item, text(item.title)) }))} />
      {comparison.isPending ? <LoadingState title="核对两次保存运行" /> : comparison.error ? <ErrorState description={message(comparison.error)} /> : data && <>
        <dl className="field-scope"><div><dt>有限元 {text(data.method.version)}</dt><dd>{data.femLabel}</dd></div>
          <div><dt>IEC {text(data.referenceMethod.version)}</dt><dd>{data.iecLabel}</dd></div></dl>
        <DataTable label="有限元与IEC量值对照" columns={[
          { id: "entity", label: "对象", render: row => row.id === "maximum" ? row.entity : entityLabel(domain, row.entity) },
          { id: "quantity", label: "量值", render: row => row.key === "ampacity" ? (row.condition === "rating-simultaneous" ? "共同允许电流 A" : "条件允许电流 A") : "导体温度 °C" },
          { id: "fem", label: "有限元", numeric: true, render: row => value(row.fem, row.unit) },
          { id: "iec", label: "IEC", numeric: true, render: row => value(row.iec, row.unit) },
          { id: "difference", label: "差值 K / A", numeric: true, render: row => row.delta?.toFixed(3) ?? "—" },
          { id: "relative", label: "相对差 %", numeric: true, render: row => row.relative?.toFixed(2) ?? "—" },
        ]} groups={[{ id: "comparison", label: "保存值", rows: data.rows }]} rowLabel={row => row.entity} showGroups={false} />
        <details><summary>对照口径{data.rows.some(row => row.exceeded) ? ' · 差异超过提示阈值' : ''}</summary>
          <dl className="field-scope"><div><dt>边界</dt><dd>有限元：{data.boundary}；IEC：无限土壤外部热阻</dd></div>
            <div><dt>地表</dt><dd>两者均为保存环境温度 · 等温</dd></div>
            <div><dt>互热</dt><dd>有限元：二维三芯耦合；IEC：外部互热模型</dd></div>
            <div><dt>相对差</dt><dd>以 IEC 保存值为分母；温度用 K</dd></div>
            <div><dt>提示阈值</dt><dd>温差 2 K / 电流 5%（非标准验收限值）</dd></div></dl>
          {data.rows.some(row => row.exceeded) && <p>优先核对上述边界、地表与互热口径，并检查网格和计算域核验。</p>}
          {data.rows.filter(row => row.reason).map(row => <p key={row.id}>{entityLabel(domain, row.entity)}：{row.reason}</p>)}
        </details>
      </>}
    </>}
  </section>;
}
