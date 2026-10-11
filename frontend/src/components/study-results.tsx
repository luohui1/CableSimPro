import { useState } from "react";
import { displayName } from "@/lib/display-names";
import { savedRunLabel } from './study-run-label';
import { isVersionStale } from '@/lib/version-status';
import {
  optionalRecord,
  record,
  array,
  numeric,
  text,
  message,
  ApiError,
} from "@/api/client";
import { entityLabel, savedDomain } from "@/lib/domain-fields";
import { engineeringQuantity } from "@/lib/format";
import { DataTable, type Column } from "./data-table";
import { StudyDetailGroup } from './study-detail-group';
import { StudyMaterialBasis } from './study-material-basis';
import { StudyCorrection } from './study-correction';
import { Select } from "./ui/select";
import { SourceBadge } from "./source-badge";
import { EmptyState, ErrorState } from "./states";
import { Toolbar } from "./toolbar";
import { Conclusion } from "./conclusion";
import { EngineeringValue } from "./engineering-value";
import type { InputSelection } from "./study-inputs";

type ResultRow = {
  id: string;
  key: string;
  label: string;
  entity: string;
  entityId: string;
  value: number | null;
  unit: string;
  status: string;
  case: string;
  reason: string;
  conditionLabel: string;
};
export function StudyResults({
  run,
  onSelect,
  part = "all",
}: {
  run?: Record<string, unknown>;
  onSelect: (selection: InputSelection) => void;
  /** conclusion：只渲染结论（工作窗口答案条）；details：只渲染明细。 */
  part?: "all" | "conclusion" | "details";
}) {
  const [chosen, setChosen] = useState("");
  const [circuit, setCircuit] = useState("");
  if (!run) return <EmptyState description="" title="尚无载流量运行" />;
  let cases: Record<string, unknown>[] = [];
  try {
    if (run.integrity !== "verified")
      throw new ApiError(409, "运行完整性未通过，拒绝显示数值");
    cases = array(record(run.output, "保存输出").cases, "运行工况").map(
      (value) => record(value, "工况"),
    );
  } catch (error) {
    return <ErrorState title="运行结果不可用" description={message(error)} />;
  }
  const selected =
    cases.find((value) => value.case_id === chosen) ||
    cases.find((value) => value.status === "succeeded") ||
    cases[0];
  if (!selected) return <EmptyState description="" title="运行没有输出工况" />;
  if (selected.status !== "succeeded")
    return (
      <ErrorState
        title="所选工况未成功"
        description={
          text(optionalRecord(selected.error).message) || text(selected.status)
        }
      />
    );
  const snapshot = optionalRecord(run.snapshot),
    domain = savedDomain(run);
  const correction=optionalRecord(selected.artifacts)['x-cablesim.gb50217-correction'];
  if (correction) return <StudyCorrection artifact={optionalRecord(correction)} historical={run.freshness==='historical'||isVersionStale(run)} part={part} />;
  const rows: ResultRow[] = (
    Array.isArray(selected.results) ? selected.results : []
  ).map((value, index) => {
    const result = optionalRecord(value),
      key = text(result.key),
      unit = text(result.unit);
    const numericValue =
      result.status === "available" ? numeric(result.value) : null;
    return {
      id: String(index),
      key,
      label: text(result.title) || text((Array.isArray(snapshot.headline_contract) ? snapshot.headline_contract : []).map(optionalRecord).find(spec => spec.key === key)?.title) || displayName(key),
      entity: entityLabel(domain, text(result.entity)),
      entityId: text(result.entity),
      value: numericValue,
      unit,
      status: text(result.status),
      case: text(result.case),
      reason: text(optionalRecord(result.reason).message),
      conditionLabel: text(optionalRecord(result.rating_basis).display_name) || text(result.case),
    };
  });
  const ratings = rows.filter(
    (row) => row.key === "ampacity" && row.case !== "rating-simultaneous",
  );
  const rating = ratings.find((row) => row.entityId === circuit) || ratings[0];
  const trace = Object.values(optionalRecord(selected.artifacts))
    .map(optionalRecord)
    .find((artifact) =>
      Array.isArray(optionalRecord(artifact.operating).cable_states),
    );
  const states = (
    Array.isArray(optionalRecord(trace?.operating).cable_states)
      ? (optionalRecord(trace?.operating).cable_states as unknown[])
      : []
  ).map(optionalRecord);
  const crossing=(Array.isArray(trace?.crossing_derating) ? trace.crossing_derating : []).map(optionalRecord)[0];
  const operating = states
    .filter((state) => !rating || state.circuit === rating.entityId)
    .sort(
      (a, b) =>
        (numeric(b.conductor_temperature_c) ?? -Infinity) -
        (numeric(a.conductor_temperature_c) ?? -Infinity),
    )[0];
  const conductorRows = rows.filter(
    (row) =>
      row.key === "conductor_temperature" &&
      row.case !== "rating" &&
      row.value !== null,
  );
  const hottest =
    conductorRows.find((row) => row.entityId === operating?.entity) ||
    (!rating
      ? [...conductorRows].sort(
          (a, b) =>
            (engineeringQuantity(b.key, b.value, b.unit).value ?? -Infinity) -
            (engineeringQuantity(a.key, a.value, a.unit).value ?? -Infinity),
        )[0]
      : undefined);
  const goals = (
    Array.isArray(trace?.goal_checks) ? trace.goal_checks : []
  ).map(optionalRecord);
  const temperatureGoal = goals.find(
    (goal) =>
      goal.key === "conductor_temperature" &&
      goal.entity === hottest?.entityId &&
      goal.condition === "operating",
  );
  const circuitRating = (
    Array.isArray(trace?.circuit_ratings) ? trace.circuit_ratings : []
  )
    .map(optionalRecord)
    .find((row) => row.entity === rating?.entityId);
  const limitingCable = text(circuitRating?.limiting_cable);
  // 多回路：所选回路的条件额定（其他回路负荷固定）可能不存在；同时额定（各回路同电流）单独给出
  const simultaneous = rows.find((row) => row.key === "ampacity" && row.case === "rating-simultaneous" && row.entityId === rating?.entityId && row.value !== null);
  const noRating = !!rating && rating.value === null;
  const load = numeric(operating?.current_a),
    limit = numeric(temperatureGoal?.target),
    margin = numeric(temperatureGoal?.margin);
  const show = (key: string, value: number | null, unit: string) => {
    const display = engineeringQuantity(key, value, unit);
    return display.text + (display.unit === "—" ? "" : " " + display.unit);
  };
  const description =
    hottest && load !== null && limit !== null && margin !== null
      ? `运行 ${show("current", load, "A")} 时最热导体 ${show(hottest.key, hottest.value, hottest.unit)}，距 ${show("temperature_limit", limit, "K")} 温限 ${show("temperature_margin", margin, "K")}`
      : hottest
        ? `保存的最高导体温度 ${show(hottest.key, hottest.value, hottest.unit)}；温限余量${margin === null ? "未覆盖" : " " + show("temperature_margin", margin, "K")}`
        : "给定电流下的运行温度未覆盖";
  const operatingTask = optionalRecord(snapshot.definition).task === 'operating';
  const temperatureChecks = goals.filter(goal => goal.key === 'conductor_temperature' && goal.condition === 'operating');
  const verdict = temperatureChecks.some(goal => goal.verdict === 'not_satisfied') ? '不满足温限'
    : temperatureChecks.length && temperatureChecks.every(goal => goal.verdict === 'satisfied') ? '满足温限' : '温限判定未提供';
  const groupOf = (row: ResultRow) =>
    /temperature/.test(row.key) || row.unit === "K" || row.unit === "°C"
      ? "temperature"
      : /(?:loss|factor|lambda)/.test(row.key) || row.unit === "W/m"
        ? "losses"
        : /thermal_resistance/.test(row.key) ||
            row.unit === "K·m/W" ||
            row.unit === "K*m/W"
          ? "thermal"
          : "electrical";
  const columns: Column<ResultRow>[] = [
    { id: "quantity", label: "物理量", wrap: true, render: (row) => row.label },
    { id: "entity", label: "对象", render: (row) => row.entity },
    {
      id: "case",
      label: "输出条件",
      render: (row) => displayName(row.conditionLabel),
    },
    {
      id: "value",
      label: "数值",
      numeric: true,
      render: (row) => (
        <EngineeringValue
          quantity={row.key}
          value={row.value}
          unit={row.unit}
        />
      ),
    },
    {
      id: "unit",
      label: "单位",
      render: (row) => engineeringQuantity(row.key, row.value, row.unit).unit,
    },
  ];
  const conclusion = (
      <Conclusion
      title={operatingTask ? "负荷校核结论" : rating ? "载流量结论" : "保存结果结论"}
      model={
        operatingTask && hottest
          ? `${load === null ? '当前' : show('current', load, 'A')} 负荷${verdict}，最热 ${show(hottest.key, hottest.value, hottest.unit)}`
          : noRating
          ? rating!.entity + " 在其他回路当前负荷下没有正允许电流" + (simultaneous ? "；同时额定 " + show("ampacity", simultaneous.value, simultaneous.unit) : "")
          : rating
          ? "允许电流 " + show("ampacity", rating.value, rating.unit) +
            (limitingCable
              ? "，受限于 " + entityLabel(domain, limitingCable).replace(/ · ([ABC])$/, " 的 $1 相")
              : "；限制电缆未提供")
          : hottest?.entity || "该运行未提供温度结论"
      }
      description={crossing ? text(crossing.clause) : noRating ? [rating!.reason, description].filter(Boolean).join(" ") : description}
      historical={run.freshness === "historical" || isVersionStale(run)}
      metrics={[
        ...(crossing ? [{label:'降额前允许电流',value:numeric(crossing.baseline_current_a),unit:'A',quantity:'ampacity'},
          {label:'交叉降额系数',value:numeric(crossing.derating_factor),unit:'1',quantity:'derating_factor'}] : []),
        ...(rating && !noRating
          ? [
              {
                label: crossing ? "降额后允许电流" : "允许电流",
                value: rating.value,
                unit: rating.unit,
                quantity: "ampacity",
              },
            ]
          : []),
        ...(simultaneous && (noRating || simultaneous.value !== rating?.value)
          ? [{ label: "同时额定", value: simultaneous.value, unit: simultaneous.unit, quantity: "ampacity" }]
          : []),
        ...(!crossing ? [{
          label: "最热导体",
          value: hottest?.value ?? null,
          unit: hottest?.unit || "K",
          quantity: "conductor_temperature",
        },
        {
          label: "温限余量",
          value: margin,
          unit: "K",
          quantity: "temperature_margin",
        }] : []),
      ]}
    />
  );
  if (part === "conclusion") return conclusion;
  return (
    <div className="input-module">
      {part === "all" && conclusion}
      <Toolbar>
        <h2>结果明细</h2>
        <SourceBadge kind="calculation" detail={displayName(text(optionalRecord(optionalRecord(snapshot.definition).method).plugin_id)) + " · " + savedRunLabel(run)} />
        <div className="spacer" />
        {ratings.length > 1 && (
          <Select
            label="结论回路"
            value={rating?.entityId}
            onChange={setCircuit}
            options={ratings.map((row) => ({
              value: row.entityId,
              label: row.entity,
            }))}
          />
        )}
        {cases.length > 1 && (
          <Select
            label="运行工况"
            value={text(selected.case_id)}
            onChange={setChosen}
            options={cases.map((value) => ({
              value: text(value.case_id),
              label:
                displayName(text(value.case_id)) +
                " · " +
                (value.status === "succeeded" ? "成功" : "未成功"),
            }))}
          />
        )}
      </Toolbar>
      {[["temperature", "温度与电流"], ["losses", "损耗"], ["thermal", "热阻"], ["electrical", "电气参数"]].map(([id, label]) => {
        const values = rows.filter(row => groupOf(row) === id);
        if (!values.length) return null;
        return <StudyDetailGroup key={id} id={'results:' + id} title={label} count={values.length}><DataTable
        key={text(run.id) + text(selected.case_id)}
        label="研究物理量结果"
        historical={run.freshness === "historical" || isVersionStale(run)}
        columns={columns}
        groups={[{id, label, rows: values}]}
        showGroups={false}
        rowLabel={(row) => row.label + " · " + row.entity}
        onSelect={(row) =>
          onSelect({
            id: row.id,
            title: row.label,
            groups: [
              {
                label: row.entity,
                items: [
                  {
                    label: "保存值",
                    value: (
                      <EngineeringValue
                        quantity={row.key}
                        value={row.value}
                        unit={row.unit}
                      />
                    ),
                    unit: engineeringQuantity(row.key, row.value, row.unit)
                      .unit,
                    source: "calculation",
                  },
                  { label: "输出条件", value: displayName(row.case) },
                  { label: "结果身份", value: displayName(text(selected.case_id)) },
                ],
              },
            ],
          })
        }
      /></StudyDetailGroup>;
      })}
      <StudyMaterialBasis caseRow={selected} />
    </div>
  );
}
