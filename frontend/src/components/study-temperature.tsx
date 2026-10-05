import { useEffect, useMemo, useState } from "react";
import { message, optionalRecord, text, numeric } from "@/api/client";
import { temperatureView, type FieldSample } from "@/lib/temperature-view";
import { entityLabel, savedDomain } from "@/lib/domain-fields";
import { formatNumber, parameterUnit, engineeringQuantity } from "@/lib/format";
import { TemperaturePlot } from "./temperature-plot";
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
  if (!run) return <EmptyState description="" title="尚无温度场运行" />;
  if (parsed.error)
    return (
      <ErrorState title="温度场不可用" description={message(parsed.error)} />
    );
  const data = parsed.view;
  if (!data) return <EmptyState description="" title="该运行没有温度场工件" />;
  const domain = savedDomain(run);
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
      title="温度场结论"
      model={`最高温度 ${engineeringQuantity("temperature", data.maximum, "K").text} °C`}
      description={`位于 x ${engineeringQuantity("coordinate", data.hotspot.point[0], "m").text} ${engineeringQuantity("coordinate", data.hotspot.point[0], "m").unit}，z ${engineeringQuantity("coordinate", data.hotspot.point[1], "m").text} ${engineeringQuantity("coordinate", data.hotspot.point[1], "m").unit}`}
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
          <Select
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
          />
          <Button size="compact" onClick={() => select(data.hotspot)}>
            选择热点
          </Button>
        </Toolbar>
        <TemperaturePlot
          data={data}
          selected={selected}
          onSelect={select}
          zoom={Number(zoom)}
        />
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
  const summary = optionalRecord(data.bundle.summary),
    evidence = optionalRecord(data.case.evidence);
  const entries: Record<string, unknown> = {
    ...summary,
    ...evidence,
    ...optionalRecord(data.field.convergence),
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
          } as Record<string, string>
        )[key] || key,
      value,
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
