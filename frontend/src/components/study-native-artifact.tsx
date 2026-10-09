import { useState } from "react";
import {
  ApiError,
  array,
  record,
  optionalRecord,
  text,
  numeric,
  message,
} from "@/api/client";
import { entityLabel, savedDomain } from "@/lib/domain-fields";
import { formatNumber, engineeringQuantity } from "@/lib/format";
import { DataTable } from "./data-table";
import { EmptyState, ErrorState } from "./states";
import { Select } from "./ui/select";
import { Toolbar } from "./toolbar";
import { SourceBadge } from "./source-badge";
import { Conclusion } from "./conclusion";
import { EngineeringValue } from "./engineering-value";
import { FieldHistoryNotice } from '@/features/field/history-notice';

function savedArtifact(run: Record<string, unknown>, key: string) {
  if (run.integrity !== "verified")
    throw new ApiError(409, "运行完整性未通过，拒绝显示工件");
  const cases = array(record(run.output, "保存输出").cases, "工况").map(
    (value) => record(value, "工况"),
  );
  const selected = cases.find(
    (value) =>
      value.status === "succeeded" && optionalRecord(value.artifacts)[key],
  );
  if (!selected) return undefined;
  if (
    optionalRecord(
      optionalRecord(
        optionalRecord(run.artifact_status)[text(selected.case_id)],
      )[key],
    ).status !== "verified"
  )
    throw new ApiError(409, "宿主未校验该结果工件");
  const artifact = record(optionalRecord(selected.artifacts)[key], "结果工件");
  const source =
      typeof artifact.source === "object" && artifact.source !== null
        ? optionalRecord(artifact.source)
        : optionalRecord(artifact.producer),
    digests = optionalRecord(selected.artifact_digests);
  if (
    source.bundle_sha256 !== digests["x-cablesim.simulation-bundle"] ||
    !digests[key]
  )
    throw new ApiError(409, "工件未绑定同次原始场束");
  return artifact;
}
export function StudyNativeArtifact({
  run,
  kind,
}: {
  run?: Record<string, unknown>;
  kind: "history" | "losses";
}) {
  const [entity, setEntity] = useState("");
  if (!run) return <EmptyState description="" title="尚无保存工件" />;
  try {
    const key =
      kind === "history"
        ? "x-cablesim.temperature-history"
        : "x-cablesim.loss-coefficients";
    const data = savedArtifact(run, key);
    if (!data)
      return <EmptyState description="" title="此运行没有该结果工件" />;
    const domain = savedDomain(run);
    if (kind === "losses") {
      if (data.schema !== "cablesim.loss-coefficients/1" || data.unit !== "1")
        throw new ApiError(502, "损耗系数契约或单位不支持");
      const rows: (Record<string, unknown> & { id: string })[] = array(
        data.rows,
        "损耗系数",
      ).map((value, index) => ({
        ...record(value, "损耗行"),
        id: String(index),
      }));
      const largest = [...rows].sort(
        (a, b) =>
          (numeric(b.sheath_loss_w_m) ?? -Infinity) -
          (numeric(a.sheath_loss_w_m) ?? -Infinity),
      )[0];
      return (
        <div className="input-module">
          <FieldHistoryNotice run={run} />
          <Conclusion
            title="护套损耗结论"
            model={entityLabel(domain, text(largest?.entity))}
            description="保存工件中护套损耗最大的电缆"
            historical={run.freshness === "historical"}
            metrics={[
              {
                label: "护套损耗",
                value: numeric(largest?.sheath_loss_w_m),
                unit: "W/m",
                quantity: "losses.sheath",
              },
              {
                label: "护套系数",
                value: numeric(largest?.lambda1),
                unit: "1",
                quantity: "loss_factor.sheath",
              },
              {
                label: "铠装系数",
                value: numeric(largest?.lambda2),
                unit: "1",
                quantity: "loss_factor.armour",
              },
            ]}
          />
          <DataTable
            label="保存护套损耗系数"
            columns={[
              {
                id: "entity",
                label: "对象",
                render: (row) => entityLabel(domain, text(row.entity)),
              },
              {
                id: "lambda1",
                label: "护套系数 λ₁",
                numeric: true,
                render: (row) => (
                  <EngineeringValue
                    quantity="loss_factor.sheath"
                    value={numeric(row.lambda1)}
                    unit="1"
                  />
                ),
              },
              {
                id: "lambda2",
                label: "铠装系数 λ₂",
                numeric: true,
                render: (row) => (
                  <EngineeringValue
                    quantity="loss_factor.armour"
                    value={numeric(row.lambda2)}
                    unit="1"
                  />
                ),
              },
              {
                id: "conductor",
                label: "导体损耗",
                unit: "W/m",
                numeric: true,
                render: (row) => (
                  <EngineeringValue
                    quantity="losses.conductor"
                    value={numeric(row.conductor_loss_w_m)}
                    unit="W/m"
                  />
                ),
              },
              {
                id: "sheath",
                label: "护套损耗",
                unit: "W/m",
                numeric: true,
                render: (row) => (
                  <EngineeringValue
                    quantity="losses.sheath"
                    value={numeric(row.sheath_loss_w_m)}
                    unit="W/m"
                  />
                ),
              },
              {
                id: "extra",
                label: "交流附加系数",
                numeric: true,
                render: (row) => (
                  <EngineeringValue
                    quantity="ac_extra_factor"
                    value={numeric(row.ac_extra_factor)}
                    unit="1"
                  />
                ),
              },
              {
                id: "source",
                label: "来源",
                render: () => (
                  <SourceBadge
                    kind="calculation"
                    detail={text(data.provenance)}
                  />
                ),
              },
            ]}
            groups={[{ id: "losses", label: "护套损耗", rows }]}
            rowLabel={(row) => entityLabel(domain, text(row.entity))}
            showGroups={false}
          />
        </div>
      );
    }
    if (
      data.schema_version !== "cablesim.temperature-history/1" ||
      data.temperature_unit !== "K" ||
      data.time_unit !== "s"
    )
      throw new ApiError(502, "暂态温度历史契约或单位不支持");
    const curves = array(data.curves, "保存温度曲线").map((value) =>
      record(value, "温度曲线"),
    );
    const curve = curves.find((value) => value.entity === entity) || curves[0];
    if (!curve) return <EmptyState description="" title="尚无保存温度曲线" />;
    const times = array(curve.time_s, "实际求解时间"),
      temperatures = array(curve.maximum_temperature_k, "温度序列");
    if (times.length !== temperatures.length || !times.length)
      throw new ApiError(502, "时间与温度没有一一对应");
    const rows = times.map((value, index) => {
      const time = numeric(value),
        temperature = numeric(temperatures[index]);
      if (
        time === null ||
        temperature === null ||
        temperature <= 0 ||
        (index > 0 && time <= Number(times[index - 1]))
      )
        throw new ApiError(502, "保存时间序列无效");
      return {
        id: String(index),
        time,
        temperature: engineeringQuantity("temperature", temperature, "K")
          .value!,
        rawTemperature: temperature,
      };
    });
    const min = Math.min(...rows.map((row) => row.temperature)),
      max = Math.max(...rows.map((row) => row.temperature));
    const start = rows[0].time,
      end = rows.at(-1)!.time;
    const points = rows
      .map(
        (row) =>
          `${60 + ((row.time - start) / (end - start || 1)) * 880},${240 - ((row.temperature - min) / (max - min || 1)) * 200}`,
      )
      .join(" ");
    const crossing = optionalRecord(curve.limit_crossing);
    return (
      <div className="input-module">
        <FieldHistoryNotice run={run} />
        <Conclusion
          title="暂态温度结论"
          model={entityLabel(domain, text(curve.entity))}
          description={
            curve.limit_status === "not_reached"
              ? "保存时段内未达到温限"
              : crossing.time_s === undefined
                ? "温限到达记录未覆盖"
                : "温限到达时间来自保存的求解时间步"
          }
          historical={run.freshness === "historical"}
          metrics={[
            {
              label: "导体峰值温度",
              value: numeric(curve.peak_temperature_k),
              unit: "K",
              quantity: "temperature",
            },
            {
              label: "峰值时刻",
              value: numeric(curve.peak_time_s),
              unit: "s",
              quantity: "time",
            },
            {
              label: "温限到达",
              value: numeric(crossing.time_s),
              unit: "s",
              quantity: "time",
            },
          ]}
        />
        <Toolbar>
          <h2>保存温度时间序列</h2>
          <div className="spacer" />
          <Select
            label="温度曲线对象"
            value={text(curve.entity)}
            onChange={setEntity}
            options={curves.map((value) => ({
              value: text(value.entity),
              label: entityLabel(domain, text(value.entity)),
            }))}
          />
        </Toolbar>
        <svg
          className="temperature-history-chart"
          viewBox="0 0 1000 280"
          role="img"
          aria-label="实际求解时间步温度曲线"
        >
          <path className="history-axis" d="M60 40V240H940" />
          <polyline className="history-curve" points={points} fill="none" />
          <text x="8" y="45">
            {engineeringQuantity("temperature", max, "°C").text} °C
          </text>
          <text x="8" y="240">
            {engineeringQuantity("temperature", min, "°C").text}
          </text>
          <text x="60" y="268">
            {formatNumber(start, 1)} s
          </text>
          <text x="890" y="268">
            {formatNumber(end, 1)} s
          </text>
        </svg>
        <span className="muted">
          {rows.length} 个实际求解时间步
          {curve.limit_status === "reached"
            ? ` · 温限到达 ${formatNumber(numeric(crossing.time_s), 3)} s`
            : " · 未记录温限到达"}
        </span>
        <DataTable
          label="保存暂态温度时间步"
          columns={[
            {
              id: "time",
              label: "时刻",
              unit: "s",
              numeric: true,
              render: (row) => formatNumber(row.time, 3),
            },
            {
              id: "temperature",
              label: "导体最高温度",
              unit: "°C",
              numeric: true,
              render: (row) => (
                <EngineeringValue
                  quantity="temperature"
                  value={row.rawTemperature}
                  unit="K"
                />
              ),
            },
            {
              id: "source",
              label: "来源",
              render: () => (
                <SourceBadge
                  kind="calculation"
                  detail={text(optionalRecord(data.convergence).time_history)}
                />
              ),
            },
          ]}
          groups={[{ id: "history", label: "时间步", rows }]}
          rowLabel={(row) => `时刻 ${row.time}`}
          showGroups={false}
        />
      </div>
    );
  } catch (error) {
    return <ErrorState title="结果工件不可用" description={message(error)} />;
  }
}
