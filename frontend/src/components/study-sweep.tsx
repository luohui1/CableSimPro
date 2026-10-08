import { useMemo, useState } from "react";
import { useStudy } from "./study-provider";
import {
  moduleConfiguration,
  withConfiguration,
  configurationOnly,
} from "@/lib/study-config";
import { optionalRecord, numeric, text, message } from "@/api/client";
import { engineeringQuantity } from "@/lib/format";
import { displayName, displayUnit } from "@/lib/display-names";
import { sweepSummary } from "@/lib/sweep-summary";
import { savedDomain } from "@/lib/domain-fields";
import type { DomainDocument } from "@/lib/domain-fields";
import { domainInputChoices } from "@/lib/domain-input-choices";
import { sweepView } from "@/lib/sweep-view";
import { DataTable } from "./data-table";
import { deferredView } from './deferred-view';
const SeriesChart = deferredView(() => import('./series-chart').then(m => ({ default: m.SeriesChart })));
import { EngineeringValue } from "./engineering-value";
import { Toolbar } from "./toolbar";
import { EmptyState, ErrorState } from "./states";
import { StatusMark } from "./status-mark";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
import { NumberField } from "./ui/number-field";
import { StudyMethodForm } from "./study-method-form";
import { downloadCsv } from "@/lib/download";
import type { InputSelection } from "./study-inputs";
import './study-sweep.css';
type ScanForm = {
  path: string;
  minimum: string;
  maximum: string;
  step: string;
  source: string;
};
export function StudySweep({
  run,
  tab,
  readOnly,
  onSelect,
}: {
  run?: Record<string, unknown>;
  tab: string;
  readOnly: boolean;
  onSelect: (selection: InputSelection) => void;
}) {
  const context = useStudy(),
    definition = context.draft?.definition || context.study.definition;
  const configuration = moduleConfiguration(definition, "sweep"),
    base =
      configuration ||
      moduleConfiguration(definition, "ampacity") ||
      definition;
  const candidates = domainInputChoices(
    base.input_source === "domain"
      ? context.domain
      : optionalRecord(base.method_input).schema_version === "cablesim.domain/1"
        ? (base.method_input as DomainDocument)
        : undefined,
  );
  const [error, setError] = useState(""),
    [selectedQuantity, setSelectedQuantity] = useState("");
  const saved =
    configuration?.input_sources?.["/driver/samples"]?.reference || "";
  let metadata: Partial<ScanForm> = {};
  if (saved.startsWith("扫描设置："))
    try {
      metadata = JSON.parse(saved.slice(5));
    } catch {
      /* older snapshot retains its explicit samples */
    }
  const form = (context.moduleInputs.sweep?.value || {
    path: metadata.path || candidates[0]?.value || "",
    minimum: metadata.minimum || "",
    maximum: metadata.maximum || "",
    step: metadata.step || "",
    source: metadata.source || "",
  }) as ScanForm;
  const chosen = candidates.find((value) => value.value === form.path);
  function edit(key: keyof ScanForm, value: string) {
    context.editModuleInput("sweep", { ...form, [key]: value });
    setError("");
  }
  const parsed = useMemo(() => {
    try {
      return {
        view: run ? sweepView(run, selectedQuantity) : undefined,
        error: undefined,
      };
    } catch (error) {
      return { view: undefined, error };
    }
  }, [run, selectedQuantity]);
  function apply() {
    try {
      if (!chosen) throw Error("请选择当前输入中真实存在的变量。");
      const pending = context.moduleInputs.sweep;
      if (
        pending &&
        (pending.revision !== numeric(context.workspace.revision) ||
          pending.studyRevision !== context.study.revision)
      )
        throw Error(
          "扫描草稿基准已变化；请保留当前范围，核对新输入后重新配置。",
        );
      const minimum = Number(form.minimum),
        maximum = Number(form.maximum),
        step = Number(form.step);
      if (
        ![form.minimum, form.maximum, form.step].every((value) =>
          value.trim(),
        ) ||
        ![minimum, maximum, step].every(Number.isFinite) ||
        minimum < 0 ||
        maximum <= minimum ||
        step <= 0
      )
        throw Error("请填写非负下限、较大的上限和正步长，单位见字段。");
      if (!form.source.trim()) throw Error("请填写扫描范围的出处。");
      const count = Math.floor((maximum - minimum) / step + 1e-9) + 1;
      if (count > 100 || count < 2)
        throw Error("扫描须有 2–100 个明确采样点；请调整步长。");
      const {
        modules: _modules,
        expected_revision: _revision,
        ...source
      } = definition as typeof definition & { expected_revision?: number };
      void _modules;
      void _revision;
      const baseline = configurationOnly({ ...source, ...base });
      const next = {
        ...baseline,
        title: chosen.label + "敏感性",
        driver: {
          ...base.driver,
          kind: "sweep" as const,
          cases: [],
          selected_case_ids: null,
          candidate_ids: [],
          samples: Array.from({ length: count }, (_, index) => {
            const value = Number((minimum + index * step).toPrecision(12));
            return {
              label: value + " " + chosen.unit,
              changes: { [chosen.value]: value },
            };
          }),
        },
        crosschecks: [],
        candidate_completions: {},
        verification: null,
        input_sources: {
          ...base.input_sources,
          "/driver/samples": {
            kind: "user" as const,
            reference: "扫描设置：" + JSON.stringify(form),
            reviewed: false,
          },
        },
      };
      context.editDefinition(
        withConfiguration(
          { ...definition, modules: { ...definition.modules, sweep: next } },
          "sweep",
          next,
        ),
      );
      context.editModuleInput("sweep", undefined);
      setError("");
    } catch (error) {
      setError(message(error));
      document
        .querySelector<HTMLInputElement>(
          '[data-field-path="scan-minimum"] input',
        )
        ?.focus();
    }
  }
  if (tab === "settings")
    return (
      <div
        className="input-module"
        data-module-state={
          error
            ? "error"
            : readOnly
              ? "historical"
              : configuration
                ? "success"
                : "empty"
        }
      >
        {readOnly ? (
          <StudyMethodForm
            module="sweep"
            historical
            definition={
              (optionalRecord(run?.snapshot)
                .study_definition as typeof definition) ||
              (optionalRecord(run?.snapshot).definition as typeof definition)
            }
          />
        ) : (
          <>
            <Toolbar>
              <h2>扫描设置</h2>
              {context.moduleInputs.sweep && (
                <StatusMark kind="draft" label="范围待确认" />
              )}
            </Toolbar>
            {!candidates.length ? (
              <EmptyState
                title="当前输入没有已接入的扫描变量"
                description="可保存原方法参数；独立仿真问题的采样请使用批量参数空间。"
              />
            ) : (
              <>
                <Select
                  label="扫描变量"
                  value={form.path}
                  options={candidates.map(({ value, label, unit }) => ({
                    value,
                    label:
                      label +
                      " / " +
                      engineeringQuantity("parameter", 0, unit).unit,
                  }))}
                  onChange={(value) => edit("path", value)}
                />
                <div className="input-form-grid">
                  {(["minimum", "maximum", "step"] as const).map((key) => (
                    <NumberField
                      key={key}
                      path={"scan-" + key}
                      label={
                        { minimum: "起点", maximum: "终点", step: "步长" }[key]
                      }
                      value={form[key].trim() ? Number(form[key]) : null}
                      unit={
                        engineeringQuantity("parameter", 0, chosen?.unit || "")
                          .unit
                      }
                      required
                      min={key === "step" ? 0 : undefined}
                      minExclusive={key === "step"}
                      precision={3}
                      draftText={
                        context.moduleInputs.sweep ? form[key] : undefined
                      }
                      onDraftChange={(value) => {
                        if (value !== undefined) edit(key, value);
                      }}
                      onCommit={(value) =>
                        edit(key, value === null ? "" : String(value))
                      }
                    />
                  ))}
                </div>
                <label className="text-field">
                  范围出处
                  <input
                    value={form.source}
                    onChange={(event) => edit("source", event.target.value)}
                    placeholder="试验计划、算例或参数来源"
                  />
                </label>
                {error && (
                  <p role="alert" className="field-error">
                    {error}
                  </p>
                )}
                <div className="demo-row">
                  <Button onClick={apply}>应用扫描设置</Button>
                  {context.moduleInputs.sweep && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        context.editModuleInput("sweep", undefined)
                      }
                    >
                      取消本次范围
                    </Button>
                  )}
                </div>
              </>
            )}
            {configuration && (
              <StudyMethodForm module="sweep" historical={false} />
            )}
          </>
        )}
      </div>
    );
  if (parsed.error)
    return (
      <ErrorState title="扫描结果不可用" description={message(parsed.error)} />
    );
  const data = parsed.view;
  if (!data)
    return (
      <EmptyState
        title="尚无扫描运行"
        description="先配置范围、保存并预检，再运行逐点计算。"
      />
    );
  const rows = data.points;
  const selected = data.metric;
  const valid = rows.filter((row) => row.value !== null);
  const variableUnit = rows[0]?.label.split(" ").slice(1).join(" ") || "";
  const variablePath = Object.keys(rows[0]?.changes || {})[0];
  const variable = domainInputChoices(run ? savedDomain(run) : undefined).find(
    (item) => item.value === variablePath,
  );
  const variableLabel = variable?.label.split(" · ").at(-1) || "采样变量";
  return (
    <div
      className="input-module study-sweep-results"
      data-module-state={
        run?.freshness === "historical" ? "historical" : "success"
      }
    >
      <section className="evidence-summary">
        <h2>
          {sweepSummary(
            rows,
            variableLabel,
            variable?.unit || variableUnit,
            selected?.key || "",
            selected?.unit || "",
          )}
        </h2>
        <StatusMark
          kind={valid.length === rows.length ? "success" : "unknown"}
          label={`${valid.length} / ${rows.length} 点有效`}
        />
      </section>
      <Toolbar>
        <Select
          label="结果量"
          value={selected?.value}
          onChange={setSelectedQuantity}
          options={data.metrics.map((value) => ({
            value: value.value,
            label: value.label,
          }))}
        />
        <div className="spacer" />
        <Button
          size="compact"
          onClick={() =>
            downloadCsv(
              [
                [
                  "采样",
                  "变量 / SI",
                  "物理量",
                  "实体",
                  "结果 / SI",
                  "单位",
                  "状态",
                  "原因",
                  "判定",
                  "方法",
                  "运行",
                  "来源",
                ],
                ...rows.map((row) => [
                  row.label,
                  JSON.stringify(row.changes),
                  row.key,
                  row.entity,
                  row.value,
                  row.unit,
                  row.status,
                  row.reason,
                  row.verdict,
                  JSON.stringify(data.definition.method),
                  run?.id,
                  row.source.reference,
                ]),
              ],
              "sweep-results.csv",
            )
          }
        >
          导出逐点 CSV
        </Button>
      </Toolbar>
      {tab === "curve" && (
        <SeriesChart
          xLabel={
            variableLabel + " / " + displayUnit(variable?.unit || variableUnit)
          }
          yLabel={selected?.label || "结果"}
          quantity={selected?.key || ""}
          unit={selected?.unit || ""}
          series={[
            {
              id: "saved",
              label: "保存结果",
              points: rows.map((row, index) => ({
                x: row.x ?? index,
                y: row.value,
                label: displayUnit(row.label),
              })),
            },
          ]}
        />
      )}
      <DataTable
        label="扫描点结果"
        rowLabel={(row) => row.label}
        showGroups={false}
        groups={[{ id: "points", label: "采样点", rows }]}
        onSelect={(row) =>
          onSelect({
            id: row.id,
            title: displayUnit(row.label),
            groups: [
              {
                label: "固定输入与结果",
                items: [
                  ...Object.entries(row.changes).map(([path, value]) => {
                    const input = domainInputChoices(
                      run ? savedDomain(run) : undefined,
                    ).find((item) => item.value === path);
                    return {
                      label: input?.label || "采样输入",
                      value: (
                        <EngineeringValue
                          quantity="parameter"
                          value={numeric(value)}
                          unit={input?.unit || variableUnit}
                          withUnit
                        />
                      ),
                    };
                  }),
                  {
                    label: "结果",
                    value: (
                      <EngineeringValue
                        quantity={row.key}
                        value={row.value}
                        unit={row.unit}
                        withUnit
                      />
                    ),
                    source: "calculation",
                  },
                  { label: "状态", value: displayName(row.status) },
                  { label: "失败原因", value: row.reason || "—" },
                  {
                    label: "来源",
                    value: (() => {
                      const reference = text(row.source.reference);
                      try {
                        return reference.startsWith("扫描设置：")
                          ? text(JSON.parse(reference.slice(5)).source)
                          : reference;
                      } catch {
                        return reference;
                      }
                    })(),
                  },
                ],
              },
            ],
          })
        }
        columns={[
          {
            id: "sample",
            label: "采样",
            render: (row) => displayUnit(row.label),
          },
          {
            id: "value",
            label: "保存结果",
            numeric: true,
            render: (row) => (
              <EngineeringValue
                quantity={row.key}
                value={row.value}
                unit={row.unit}
                withUnit
              />
            ),
          },
          {
            id: "status",
            label: "状态",
            render: (row) => (
              <StatusMark
                kind={row.status === "succeeded" ? "success" : "error"}
                label={row.status === "succeeded" ? "成功" : "未成功"}
              />
            ),
          },
          // 插件给出判定或原因时才显示这两列；全部为空时不占位
          ...(rows.some((row) => row.verdict) ? [{
            id: "verdict",
            label: "插件判定",
            render: (row: (typeof rows)[number]) =>
              ({
                satisfied: "满足",
                not_satisfied: "不满足",
                unavailable: "无法判断",
              } as Record<string, string>)[row.verdict] || "未提供",
          }] : []),
          ...(rows.some((row) => row.reason) ? [{
            id: "reason",
            label: "原因",
            wrap: true,
            render: (row: (typeof rows)[number]) => row.reason || "—",
          }] : []),
        ]}
      />
    </div>
  );
}
