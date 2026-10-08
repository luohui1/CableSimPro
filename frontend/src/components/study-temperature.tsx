import { useEffect, useMemo, useState } from "react";
import { message, optionalRecord, text, numeric } from "@/api/client";
import { temperatureView, type FieldSample } from "@/lib/temperature-view";
import { entityLabel, savedDomain } from "@/lib/domain-fields";
import { formatNumber, parameterUnit, engineeringQuantity } from "@/lib/format";
import { deferredView } from './deferred-view';
const TemperaturePlot = deferredView(() => import('./temperature-plot').then(m => ({ default: m.TemperaturePlot })));
import { DataTable } from "./data-table";
import { Toolbar } from "./toolbar";
import { EmptyState, ErrorState } from "./states";
import { SourceBadge } from "./source-badge";
import { Select } from "./ui/select";
import { Button } from "./ui/button";
import { Tooltip } from "./ui/tooltip";
import { Conclusion } from "./conclusion";
import { EngineeringValue } from "./engineering-value";
import type { InputSelection } from "./study-inputs";
import { StatusMark } from './status-mark';
import { FieldView } from '@/features/field/field-view';
import { ConvergenceChart } from '@/features/field/convergence-chart';
import { StudyRemoteProgress } from './study-run-control';
import { SavedFieldComparison } from '@/features/field/saved-comparison';
export function StudyTemperature({
  run,
  tab,
  onSelect,
}: {
  run?: Record<string, unknown>;
  tab: string;
  onSelect: (selection: InputSelection) => void;
}) {
  const [selected, setSelected] = useState("");
  const [zoom, setZoom] = useState("2");
  useEffect(() => {
    setZoom("2");
    setSelected("");
  }, [run?.id]);
  const parsed = useMemo(() => {
    try {
      return { view: run ? temperatureView(run) : undefined, error: undefined };
    } catch (error) {
      return { view: undefined, error };
    }
  }, [run]);
  if (!run) return <EmptyState art="simulation" description="" title="尚无温度场运行" />;
  if (parsed.error)
    return (
      <ErrorState title="温度场不可用" description={message(parsed.error)} />
    );
  const data = parsed.view;
  if (!data) return <EmptyState description="" title="该运行没有温度场工件" />;
  const domain = savedDomain(run);
  const summaryEntry = Object.entries(optionalRecord(data.case.artifacts)).find(([, value]) => optionalRecord(value).schema_version === 'cablesim.electrothermal-reference/1');
  const thermalSummary = optionalRecord(summaryEntry?.[1]);
  const checked = summaryEntry && optionalRecord(optionalRecord(optionalRecord(run.artifact_status)[text(data.case.case_id)])[summaryEntry[0]]).status === 'verified';
  const limit = numeric(thermalSummary.temperature_limit_c), savedMaximum = numeric(thermalSummary.maximum_temperature_c);
  const verdict = checked && limit !== null && savedMaximum !== null && typeof thermalSummary.within_temperature_limit === 'boolean' ? thermalSummary.within_temperature_limit : undefined;
  function select(sample: FieldSample) {
    setSelected(sample.id);
    onSelect({
      id: sample.id,
      title:
        sample.id === "hotspot"
          ? "最高温度位置"
          : entityLabel(domain, sample.entity),
      groups: [
        {
          label: "取样",
          items: [
            {
              label: "x 坐标",
              value: <EngineeringValue quantity="coordinate" value={sample.point[0]} unit="m" withUnit />,
            },
            {
              label: "z 坐标",
              value: <EngineeringValue quantity="coordinate" value={sample.point[1]} unit="m" withUnit />,
            },
            {
              label: "温度",
              value: (
                <EngineeringValue
                  quantity="temperature"
                  value={sample.temperature}
                  unit="K"
                />
              ),
              unit: "°C",
              source: "calculation",
            },
            { label: "时刻", value: formatNumber(sample.time, 3), unit: "s" },
            {
              label: "取样方法",
              value: (
                <Tooltip content={sample.method}>
                  <span tabIndex={0}>
                    {sample.method ===
                    "maximum-of-exported-nodes; not a continuous extremum proof"
                      ? "导出节点最大值"
                      : "已保存方法"}
                  </span>
                </Tooltip>
              ),
            },
          ],
        },
      ],
    });
  }
  const conclusion = (
    <Conclusion
      title={<StatusMark kind={verdict === undefined ? 'unknown' : verdict ? 'satisfied' : 'unsatisfied'} label={verdict === undefined ? '无法判断' : verdict ? '满足温限' : '超温'} />}
      model={`最高温度 ${verdict === undefined ? engineeringQuantity("temperature", data.maximum, "K").text : formatNumber(savedMaximum, 1)} °C`}
      description={verdict === undefined ? '保存工件未提供温限判定与超出量；最高温度不代表满足温限。' : `保存温限 ${formatNumber(limit, 1)} °C。${verdict ? '判定来自已校验的插件工件。' : '插件已判定超温，但工件未提供超出量。'}`}
      historical={run.freshness === "historical"}
      metrics={[
        {
          label: "场内最高温度",
          value: data.maximum,
          unit: "K",
          quantity: "temperature",
        },
        {
          label: "场内最低温度",
          value: data.minimum,
          unit: "K",
          quantity: "temperature",
        },
      ]}
    />
  );
  if (tab === "field")
    return (
      <div className="input-module">
        {data.kind === "fem" && <StudyRemoteProgress run={run} />}
        {conclusion}
        <Toolbar>
          <h2>保存温度场</h2>
          <div className="spacer" />
          {data.geometryError && (
            <Tooltip content={data.geometryError}>
              <span tabIndex={0} className="muted">
                轮廓未覆盖
              </span>
            </Tooltip>
          )}
          {data.kind !== "fem" && <Select
            label="场图范围"
            value={zoom}
            onChange={setZoom}
            options={[
              { value: "2", label: "电缆周围 · 外扩 1 m" },
              { value: "1", label: "敷设全景" },
              { value: "0", label: "原始计算域" },
              { value: "4", label: "热点 · 4×" },
              { value: "16", label: "热点 · 16×" },
              { value: "64", label: "热点 · 64×" },
              { value: "256", label: "热点 · 256×" },
            ]}
          />}
          <Button size="compact" onClick={() => select(data.hotspot)}>
            选择热点
          </Button>
        </Toolbar>
        {data.kind === "fem" ? <div className="saved-fem-field"><FieldView
          label="有限元温度场" points={data.points} triangles={data.triangles}
          values={data.temperatures.map(value => value - 273.15)}
          hotspot={{ point: data.hotspot.point, value: data.hotspot.temperature - 273.15, label: "最高温度" }}
        /></div> : <TemperaturePlot
          data={data}
          selected={selected}
          onSelect={select}
          zoom={Number(zoom)}
        />}
      </div>
    );
  if (tab === "samples")
    return (
      <div className="input-module">
        {conclusion}
        <DataTable
          label="保存温度取样"
          columns={[
            {
              id: "entity",
              label: "对象",
              render: (row) => entityLabel(domain, row.entity),
            },
            {
              id: "x",
              label: "x",
              numeric: true,
              render: (row) => <EngineeringValue quantity="coordinate" value={row.point[0]} unit="m" withUnit />,
            },
            {
              id: "z",
              label: "z",
              numeric: true,
              render: (row) => <EngineeringValue quantity="coordinate" value={row.point[1]} unit="m" withUnit />,
            },
            {
              id: "temperature",
              label: "温度",
              unit: "°C",
              numeric: true,
              render: (row) => (
                <EngineeringValue
                  quantity="temperature"
                  value={row.temperature}
                  unit="K"
                />
              ),
            },
            {
              id: "time",
              label: "时刻",
              unit: "s",
              numeric: true,
              render: (row) => formatNumber(row.time, 3),
            },
            {
              id: "source",
              label: "来源",
              render: (row) => (
                <SourceBadge kind="calculation" detail={row.method} />
              ),
            },
          ]}
          groups={[
            {
              id: "samples",
              label: "取样",
              rows: [...data.samples, data.hotspot],
            },
          ]}
          selectedId={selected}
          onSelect={select}
          rowLabel={(row) => entityLabel(domain, row.entity)}
          showGroups={false}
        />
        {data.kind === "fem" && <SavedFieldComparison run={run} />}
      </div>
    );
  if (tab === "convergence") {
    const proof = optionalRecord(run.convergence);
    const solver = optionalRecord(data.field.convergence);
    if (
      (!Array.isArray(proof.rows) || !proof.rows.length) &&
      Array.isArray(solver.iterations) &&
      solver.iterations.length
    ) {
      const rows: (Record<string, unknown> & { id: string })[] =
        solver.iterations.map((value, index) => ({
          ...optionalRecord(value),
          id: String(index),
        }));
      return (
        <div className="input-module">
          {conclusion}
          <Toolbar>
            <h2>保存耦合迭代</h2>
            <span className="muted">
              {solver.solver_status === "converged"
                ? "求解器已收敛"
                : "求解器未确认收敛"}{" "}
              · 网格核验未覆盖
            </span>
          </Toolbar>
          <ConvergenceChart label="耦合迭代温度更新" unit="K" values={rows.map(row => numeric(row.temperature_update_inf_k))} />
          <DataTable
            label="保存耦合迭代记录"
            columns={[
              {
                id: "iteration",
                label: "迭代",
                numeric: true,
                render: (row) => formatNumber(numeric(row.iteration), 0),
              },
              {
                id: "temperature",
                label: "温度更新",
                unit: "K",
                numeric: true,
                render: (row) => (
                  <EngineeringValue
                    quantity="temperature_update"
                    value={numeric(row.temperature_update_inf_k)}
                    unit="K"
                  />
                ),
              },
              {
                id: "power",
                label: "功率",
                unit: "W/m",
                numeric: true,
                render: (row) => (
                  <EngineeringValue
                    quantity="power"
                    value={numeric(row.power_w_m)}
                    unit="W/m"
                  />
                ),
              },
              {
                id: "energy",
                label: "能量相对残差",
                numeric: true,
                render: (row) => (
                  <EngineeringValue
                    quantity="energy_residual"
                    value={numeric(row.energy_relative_residual)}
                    unit="1"
                  />
                ),
              },
              {
                id: "residual",
                label: "热残差",
                unit: "W/m",
                numeric: true,
                render: (row) => (
                  <EngineeringValue
                    quantity="thermal_residual"
                    value={numeric(row.thermal_residual_inf_w_m)}
                    unit="W/m"
                  />
                ),
              },
              {
                id: "transfer",
                label: "传递相对误差",
                numeric: true,
                render: (row) => (
                  <EngineeringValue
                    quantity="transfer_relative_error"
                    value={numeric(row.transfer_relative_error)}
                    unit="1"
                  />
                ),
              },
            ]}
            groups={[{ id: "iterations", label: "迭代", rows }]}
            rowLabel={(row) => `迭代 ${row.iteration}`}
            showGroups={false}
          />
        </div>
      );
    }
    if (!Array.isArray(proof.rows) || !proof.rows.length)
      return (
        <EmptyState
          title="尚无收敛核验记录"
          description={
            text(proof.reason) || "仅显示后端已保存的核验，不补造网格扫描。"
          }
        />
      );
    const rows: (Record<string, unknown> & { id: string })[] = proof.rows.map(
      (value, index) => ({
        id: String(index),
        ...optionalRecord(value),
      }),
    );
    return (
      <div className="input-module">
        {conclusion}
        <Toolbar>
          <h2>收敛核验</h2>
          <span className="muted">
            {proof.status === "converged"
              ? "已收敛"
              : proof.status === "not_converged"
                ? "未收敛"
                : text(proof.status)}
          </span>
        </Toolbar>
        <ConvergenceChart label="网格与计算域核验热点" unit="K" values={rows.map(row => numeric(row.hotspot_k))} />
        {Array.isArray(solver.iterations) && <ConvergenceChart label="耦合迭代温度更新" unit="K" values={solver.iterations.map(value => numeric(optionalRecord(value).temperature_update_inf_k))} />}
        <DataTable
          label="保存收敛记录"
          columns={[
            { id: "case", label: "工况", render: (row) => text(row.case_id) },
            {
              id: "mesh",
              label: "网格长度",
              unit: "m",
              numeric: true,
              render: (row) => formatNumber(numeric(row.mesh_size_m), 5),
            },
            {
              id: "nodes",
              label: "节点数",
              numeric: true,
              render: (row) => formatNumber(numeric(row.nodes), 0),
            },
            {
              id: "hotspot",
              label: "热点",
              unit: "°C",
              numeric: true,
              render: (row) => (
                <EngineeringValue
                  quantity="temperature"
                  value={numeric(row.hotspot_k)}
                  unit="K"
                />
              ),
            },
            {
              id: "change",
              label: "变化",
              unit: "K",
              numeric: true,
              render: (row) => (
                <EngineeringValue
                  quantity="temperature_change"
                  value={numeric(row.change_k)}
                  unit="K"
                />
              ),
            },
          ]}
          groups={[{ id: "convergence", label: "核验", rows }]}
          rowLabel={(row) => text(row.case_id)}
          showGroups={false}
        />
      </div>
    );
  }
  const summary = optionalRecord(data.bundle.summary || data.bundle.result),
    evidence = optionalRecord(data.case.evidence);
  const entries: Record<string, unknown> = {
    ...summary,
    ...evidence,
    ...optionalRecord(data.field.convergence),
    ...(data.kind === "fem" ? { nodes: data.points.length, elements: data.triangles.length } : {}),
  };
  const diagnostics = Object.entries(entries)
    .filter(
      ([, value]) =>
        typeof value === "number" ||
        typeof value === "string" ||
        typeof value === "boolean",
    )
    .map(([key, value]) => ({
      id: key,
      label:
        (
          {
            nodes: "节点数",
            elements: "单元数",
            energy_relative_residual: "能量相对残差",
            physical_residual_inf_w_m: "物理残差",
            source_heat_w_m: "总热源",
            boundary_heat_w_m: "边界流出",
            iterations: "迭代次数",
            residual_k: "温度残差",
            engineering_approval: "工程批准",
            solver: "求解方法",
            mesh_status: "本工件网格核验",
            solver_status: "求解器状态",
          } as Record<string, string>
        )[key] || key,
      value: typeof value === "boolean" ? (value ? "是" : "否") : ({ converged: "已收敛", not_assessed_single_mesh: "单网格工件；多网格结论见收敛页" } as Record<string, string>)[String(value)] || value,
      unit:
        typeof value === "number"
          ? parameterUnit(key, { type: "number" })
          : "—",
    }));
  return (
    <div className="input-module">
      {conclusion}
      <DataTable
        label="保存温度场诊断"
        columns={[
          { id: "name", label: "诊断项", render: (row) => row.label },
          {
            id: "value",
            label: "保存值",
            numeric: true,
            render: (row) =>
              typeof row.value === "number" ? (
                <EngineeringValue
                  quantity={row.id}
                  value={row.value}
                  unit={row.unit}
                />
              ) : (
                String(row.value)
              ),
          },
          {
            id: "unit",
            label: "单位",
            render: (row) =>
              engineeringQuantity(row.id, numeric(row.value), row.unit).unit,
          },
        ]}
        groups={[{ id: "diagnostics", label: "诊断", rows: diagnostics }]}
        rowLabel={(row) => row.label}
        showGroups={false}
      />
    </div>
  );
}
