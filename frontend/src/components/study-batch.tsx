import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  batchConfiguration,
  batchRuns,
  batchDataset,
  saveBatch,
  batchPreflight,
  submitBatch,
  resumeBatch,
  exportBatch,
  type SaveBatch,
  type SubmitBatch,
} from "@/api/batch";
import { optionalRecord, numeric, text, message, ApiError } from "@/api/client";
import type { components } from "@/api/generated/schema";
import type { CatalogRow } from "@/api/catalogs";
import { engineeringQuantity } from "@/lib/format";
import { domainInputChoices } from "@/lib/domain-input-choices";
import type { DomainDocument } from "@/lib/domain-fields";
import { downloadBlob } from "@/lib/download";
import { useStudy } from "./study-provider";
import { DataTable } from "./data-table";
import { EngineeringValue } from "./engineering-value";
import { QueryState } from "./query-state";
import { EmptyState, ErrorState, StaleBanner } from "./states";
import { StatusMark } from "./status-mark";
import { PreflightDialog } from "./preflight-dialog";
import { Toolbar } from "./toolbar";
import { Button } from "./ui/button";
import { NumberField } from "./ui/number-field";
import { Select } from "./ui/select";
import type { InputSelection } from "./study-inputs";
type Axis = components["schemas"]["Axis"];
type AxisInput = {
  axis: Axis;
  minimum: string;
  maximum: string;
  levels: string;
};
type BatchInput = {
  sampling: "grid" | "latin_hypercube" | "random";
  sampleCount: string;
  seed: string;
  source: string;
  sourceModule: string;
  execution: Record<string, string>;
  axes: AxisInput[];
  configurationRevision: number;
};
const statusLabels: Record<string, string> = {
  preparing: "准备中",
  queued: "排队",
  running: "运行中",
  submitted: "已提交",
  completed: "已完成",
  succeeded: "有效",
  pending: "待运行",
  failed: "失败",
  nonconverged: "未收敛",
  interrupted: "已中断",
  disconnected: "连接中断",
  environment_missing: "环境缺失",
  timed_out: "超时",
  crashed: "进程退出",
  submission_unknown: "提交待核对",
};
function inputFrom(meta: Record<string, unknown>): BatchInput {
  const configuration = optionalRecord(meta.configuration),
    definition = optionalRecord(configuration.definition),
    space = optionalRecord(definition.parameter_space),
    execution = optionalRecord(definition.execution);
  return {
    sampling: (text(space.sampling) ||
      "latin_hypercube") as BatchInput["sampling"],
    sampleCount: String(numeric(space.sample_count) ?? 2),
    seed: String(numeric(space.seed) ?? 0),
    source: text(space.source),
    sourceModule: text(definition.source_module),
    configurationRevision: numeric(configuration.revision) || 0,
    execution: {
      backend: text(execution.backend) || "slurm",
      workers: String(numeric(execution.workers) ?? 1),
      sample_timeout_s: String(numeric(execution.sample_timeout_s) ?? 300),
      slurm_parallelism: String(numeric(execution.slurm_parallelism) ?? 1),
      slurm_wall_seconds: String(numeric(execution.slurm_wall_seconds) ?? 360),
      slurm_memory_mb: String(numeric(execution.slurm_memory_mb) ?? 2048),
      slurm_cpus_per_task: String(numeric(execution.slurm_cpus_per_task) ?? 1),
    },
    axes: (Array.isArray(space.axes) ? space.axes : []).map((value) => {
      const axis = value as Axis;
      return {
        axis,
        minimum:
          axis.minimum == null
            ? ""
            : String(
                engineeringQuantity(axis.name, axis.minimum, axis.unit).value,
              ),
        maximum:
          axis.maximum == null
            ? ""
            : String(
                engineeringQuantity(axis.name, axis.maximum, axis.unit).value,
              ),
        levels: String(axis.levels ?? 2),
      };
    }),
  };
}
export function StudyBatch({
  tab,
  datasetId,
  onDataset,
  onSelect,
  readOnly,
}: {
  tab: string;
  datasetId: string;
  onDataset: (id: string) => void;
  onSelect: (selection: InputSelection) => void;
  readOnly: boolean;
}) {
  const context = useStudy(),
    queries = useQueryClient(),
    wid = context.study.workspace,
    sid = context.study.id;
  const staged = context.moduleInputs.batch;
  const [sourceModule, setSourceModule] = useState<string | null>(null),
    [field, setField] = useState(""),
    [status, setStatus] = useState("all"),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [ack, setAck] = useState(false);
  const requestedModule = staged
    ? text(optionalRecord(staged.value).sourceModule)
    : sourceModule;
  const meta = useQuery({
    queryKey: ["batch-configuration", wid, sid, requestedModule],
    queryFn: ({ signal }) =>
      batchConfiguration(wid, sid, requestedModule ?? undefined, signal),
  });
  const history = useQuery({
    queryKey: ["batch-runs", wid, sid],
    queryFn: ({ signal }) => batchRuns(wid, sid, signal),
  });
  const chosenId = datasetId || history.data?.[0]?.id || "";
  const dataset = useQuery({
    queryKey: ["batch-dataset", wid, sid, chosenId, offset, status],
    queryFn: ({ signal }) =>
      batchDataset(wid, sid, chosenId, offset, status, signal),
    enabled: !!chosenId,
    refetchInterval: (query) =>
      ["preparing", "queued", "running", "submitted"].includes(
        text(query.state.data?.status),
      )
        ? 4000
        : false,
  });
  const editor = (staged?.value || inputFrom(meta.data || {})) as BatchInput;
  const baseInput = optionalRecord(optionalRecord(meta.data?.base_case).input);
  const fields = [
    ...(Array.isArray(meta.data?.fields) ? meta.data.fields : []).map(
      optionalRecord,
    ),
    ...(baseInput.schema_version === "cablesim.domain/1"
      ? domainInputChoices(baseInput as DomainDocument).map((value) => ({
          pointer: value.value,
          label: value.label,
          unit: value.unit,
          value: value.number,
        }))
      : []),
  ].filter(
    (value, index, values) =>
      values.findIndex((item) => item.pointer === value.pointer) === index,
  );
  function change(next: BatchInput) {
    if (!readOnly) {
      context.editModuleInput("batch", next);
      setError("");
    }
  }
  function changeValue(key: keyof BatchInput, value: unknown) {
    change({ ...editor, [key]: value });
  }
  function integer(value: string, label: string, min: number, max: number) {
    const number = Number(value);
    if (
      !value.trim() ||
      !Number.isInteger(number) ||
      number < min ||
      number > max
    )
      throw Error(label + "须为 " + min + "–" + max + " 的整数");
    return number;
  }
  function saveBody(): SaveBatch {
    if (context.dirty)
      throw Error("请先保存基准研究与共享输入；批量范围仍保留。");
    if (editor.execution.backend !== "slurm")
      throw Error("本机计算未覆盖，请明确选择超算 Slurm。");
    if (!editor.axes.length)
      throw Error("请添加至少一个来自基准输入的采样参数。");
    if (!editor.source.trim()) throw Error("请填写参数空间的出处。");
    const axes = editor.axes.map((value, index) => {
      if (value.axis.choices?.length) return value.axis;
      const presentation = engineeringQuantity(
        value.axis.name,
        0,
        value.axis.unit,
      );
      const minimum =
          (Number(value.minimum) - presentation.offset) / presentation.scale,
        maximum =
          (Number(value.maximum) - presentation.offset) / presentation.scale;
      if (
        !value.minimum.trim() ||
        !value.maximum.trim() ||
        !Number.isFinite(minimum) ||
        !Number.isFinite(maximum) ||
        minimum >= maximum
      )
        throw new ApiError(
          422,
          value.axis.label + "：下限须小于上限，单位 " + presentation.unit,
          { field: "batch-axis-" + index + "-minimum" },
        );
      if (!value.axis.source.trim())
        throw new ApiError(422, value.axis.label + "：请填写范围来源", {
          field: "batch-axis-" + index + "-source",
        });
      return {
        ...value.axis,
        minimum,
        maximum,
        levels: integer(value.levels, "轴点数", 2, 10000),
      };
    });
    const sampleCount =
      editor.sampling === "grid"
        ? axes.reduce(
            (count, axis) => count * (axis.choices?.length || axis.levels || 2),
            1,
          )
        : integer(editor.sampleCount, "样本数", 1, 100000);
    if (sampleCount > 100000)
      throw Error("网格样本数超过 100000，请减少各轴点数。");
    const execution: components["schemas"]["Execution"] = {
      backend: "slurm",
      workers: 1,
      sample_timeout_s: integer(
        editor.execution.sample_timeout_s,
        "单样本超时",
        1,
        3600,
      ),
      slurm_parallelism: integer(
        editor.execution.slurm_parallelism,
        "并行任务上限",
        1,
        128,
      ),
      slurm_wall_seconds: integer(
        editor.execution.slurm_wall_seconds,
        "每样本时限",
        30,
        3600,
      ),
      slurm_memory_mb: integer(
        editor.execution.slurm_memory_mb,
        "内存",
        512,
        8192,
      ),
      slurm_cpus_per_task: integer(
        editor.execution.slurm_cpus_per_task,
        "每任务 CPU 数",
        1,
        32,
      ),
    };
    return {
      source_module: editor.sourceModule || null,
      parameter_space: {
        schema_version: "cablesim.parameter-space/1",
        sampling: editor.sampling,
        sample_count: sampleCount,
        seed: integer(editor.seed, "随机种子", 0, 2147483647),
        axes,
        source: editor.source.trim(),
      },
      execution,
      expected_revision:
        staged?.revision ?? numeric(meta.data?.workspace_revision)!,
      expected_study_revision:
        staged?.studyRevision ?? numeric(meta.data?.study_revision)!,
      expected_configuration_revision: editor.configurationRevision,
    };
  }
  const save = useMutation({
    retry: false,
    mutationFn: () => saveBatch(wid, sid, saveBody()),
    onSuccess: async () => {
      context.editModuleInput("batch", undefined);
      await queries.invalidateQueries({
        queryKey: ["batch-configuration", wid, sid],
      });
    },
    onError: (failure) => {
      setError(message(failure));
      const path =
        failure instanceof ApiError
          ? text(optionalRecord(failure.detail).field)
          : "";
      if (path)
        document
          .querySelector<HTMLInputElement>(
            '[data-field-path="' + path + '"] input',
          )
          ?.focus();
    },
  });
  const request = useRef<SubmitBatch | null>(null),
    resumeIdentity = useRef({ id: "", request: "" });
  const check = useMutation({
    retry: false,
    mutationFn: async () => {
      if (
        context.dirty ||
        staged ||
        !meta.data ||
        numeric(optionalRecord(meta.data.configuration).revision) === null
      )
        throw Error("先保存批量配置和基准输入。");
      if (!ack) throw Error("请核对保存输入与采样范围。");
      request.current = {
        request_id: crypto.randomUUID(),
        expected_revision: numeric(meta.data.workspace_revision)!,
        expected_study_revision: numeric(meta.data.study_revision)!,
        configuration_revision: numeric(
          optionalRecord(meta.data.configuration).revision,
        )!,
        lock_digest: text(meta.data.lock_digest),
        module:
          text(
            optionalRecord(optionalRecord(meta.data.configuration).definition)
              .source_module,
          ) || null,
        scope_acknowledged: true,
      };
      return batchPreflight(wid, sid, request.current);
    },
    onSuccess: () => setAck(false),
  });
  const submit = useMutation({
    retry: false,
    mutationFn: async () => {
      if (
        !ack ||
        check.data?.ready !== true ||
        !request.current ||
        context.dirty ||
        staged
      )
        throw Error("输入须保存，并确认预检范围和核时上限。");
      return submitBatch(wid, sid, request.current);
    },
    onSuccess: async (value) => {
      setOpen(false);
      await queries.invalidateQueries({ queryKey: ["batch-runs", wid, sid] });
      onDataset(text(value.id));
    },
  });
  const resume = useMutation({
    retry: false,
    mutationFn: async () => {
      if (optionalRecord(dataset.data?.execution).backend !== "slurm")
        throw Error("历史本机数据集仅可读取；请保存新的 Slurm 配置。");
      if (resumeIdentity.current.id !== chosenId)
        resumeIdentity.current = { id: chosenId, request: crypto.randomUUID() };
      return resumeBatch(wid, sid, chosenId, resumeIdentity.current.request);
    },
    onSuccess: () =>
      queries.invalidateQueries({
        queryKey: ["batch-dataset", wid, sid, chosenId],
      }),
  });
  const exporting = useMutation({
    retry: false,
    mutationFn: () => exportBatch(wid, sid, chosenId),
    onSuccess: (value) => downloadBlob(value, "CableSimPro-dataset.zip"),
  });
  const result = dataset.data;
  const datasetRows: CatalogRow[] = (
    Array.isArray(result?.samples) ? result.samples : []
  ).map((value) => {
    const row = optionalRecord(value);
    return { ...row, id: text(row.sample_id) };
  });
  const state =
    tab === "space"
      ? meta.isPending
        ? "loading"
        : meta.error
          ? "error"
          : readOnly
            ? "historical"
            : !meta.data?.configuration
              ? "empty"
              : "success"
      : history.isPending || (chosenId && dataset.isPending)
        ? "loading"
        : history.error || dataset.error
          ? "error"
          : !result
            ? "empty"
            : result.historical === true
              ? "historical"
              : "success";
  function resultValue(row: CatalogRow, key: string, condition?: string) {
    if (row.valid !== true) return null;
    const quantities = (Array.isArray(row.results) ? row.results : [])
      .map(optionalRecord)
      .filter(
        (value) =>
          value.key === key &&
          value.status === "available" &&
          (!condition || value.case === condition),
      );
    const values = quantities
      .map((value) => numeric(value.value))
      .filter((value): value is number => value !== null);
    return values.length
      ? key === "conductor_temperature"
        ? Math.max(...values)
        : quantities.length === 1
          ? values[0]
          : null
      : null;
  }
  if (tab === 'space' && readOnly) return <div data-module-state="historical"><EmptyState title="该运行未保存批量配置" description="请选择数据集记录查看固定输入。" /></div>;
  return (
    <div
      className="input-module"
      data-module-state={state}
      onKeyDown={(event) => {
        if (
          tab === "space" &&
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (!readOnly && !save.isPending) save.mutate();
        }
      }}
    >
      {tab === "space" ? (
        <QueryState query={meta} empty={false}>
          <Toolbar>
            <h2>参数空间</h2>
            {staged && <StatusMark kind="draft" label="未保存" />}
            <div className="spacer" />
            <Button
              variant={
                !context.dirty && (staged || !meta.data?.configuration)
                  ? "primary"
                  : "default"
              }
              size="compact"
              disabled={readOnly || !!meta.error}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              保存批量配置
            </Button>
            {!staged && meta.data?.configuration && (
              <Button
                variant="run"
                size="compact"
                disabled={readOnly || context.dirty}
                onClick={() => {
                  check.reset();
                  submit.reset();
                  setAck(false);
                  setOpen(true);
                }}
              >
                预检批量
              </Button>
            )}
          </Toolbar>
          {readOnly && (
            <StaleBanner description="固定运行只读；批量参数编辑需返回当前研究。" />
          )}
          <div className="input-form-grid">
            <Select
              label="基准模块"
              disabled={readOnly || !!staged}
              value={editor.sourceModule || ""}
              options={(Array.isArray(meta.data?.source_modules)
                ? meta.data.source_modules
                : []
              ).map((value) => ({
                value: text(optionalRecord(value).id),
                label: text(optionalRecord(value).title),
              }))}
              onChange={(value) => {
                setSourceModule(value);
                setField("");
                change({ ...editor, sourceModule: value, axes: [] });
              }}
            />
            <Select
              label="采样方式"
              disabled={readOnly}
              value={editor.sampling}
              onChange={(value) => changeValue("sampling", value)}
              options={[
                { value: "grid", label: "网格" },
                { value: "latin_hypercube", label: "拉丁超立方" },
                { value: "random", label: "随机" },
              ]}
            />
            <NumberField
              label="样本数"
              value={
                editor.sampling === "grid"
                  ? editor.axes.reduce(
                      (count, axis) => count * Number(axis.levels || 2),
                      1,
                    )
                  : Number(editor.sampleCount)
              }
              locked={readOnly || editor.sampling === "grid"}
              unit="—"
              integer
              required
              min={1}
              max={100000}
              draftText={staged && editor.sampling !== 'grid' ? editor.sampleCount : undefined}
              onDraftChange={(value) => {
                if (value !== undefined) changeValue("sampleCount", value);
              }}
            />
            <NumberField
              label="随机种子"
              value={Number(editor.seed)}
              unit="—"
              integer
              required
              min={0}
              locked={readOnly}
              draftText={staged ? editor.seed : undefined}
              onDraftChange={(value) => {
                if (value !== undefined) changeValue("seed", value);
              }}
            />
          </div>
          <Toolbar>
            <Select
              label="基准参数"
              disabled={readOnly}
              value={field}
              onChange={setField}
              options={fields.map((value) => ({
                value: text(value.pointer),
                label:
                  text(value.label) +
                  " / " +
                  engineeringQuantity(text(value.label), 0, text(value.unit))
                    .unit,
              }))}
            />
            <Button
              size="compact"
              disabled={readOnly || !field || editor.axes.length >= 32}
              onClick={() => {
                const selected = fields.find(
                  (value) => value.pointer === field,
                );
                if (!selected) return;
                change({
                  ...editor,
                  axes: [
                    ...editor.axes,
                    {
                      axis: {
                        name: "parameter_" + editor.axes.length,
                        label: text(selected.label),
                        unit: text(selected.unit) as Axis["unit"],
                        source: "",
                        bindings: [
                          {
                            pointer: field,
                            target_unit: text(selected.unit) as Axis["unit"],
                          },
                        ],
                      },
                      minimum: "",
                      maximum: "",
                      levels: "2",
                    },
                  ],
                });
              }}
            >
              添加参数
            </Button>
          </Toolbar>
          {!editor.axes.length && (
            <EmptyState
              title="尚无采样参数"
              description="选择基准研究中的字段，明确范围和来源。"
            />
          )}
          {editor.axes.map((value, index) => (
            <section className="input-section" key={value.axis.name}>
              <Toolbar>
                <h2>{value.axis.label}</h2>
                <span
                  className="muted"
                  title={JSON.stringify(value.axis.bindings)}
                >
                  {value.axis.bindings?.length || 0} 个固定字段
                </span>
                <div className="spacer" />
                <Button
                  size="compact"
                  disabled={readOnly}
                  onClick={() =>
                    change({
                      ...editor,
                      axes: editor.axes.filter((_, item) => item !== index),
                    })
                  }
                >
                  移除
                </Button>
              </Toolbar>
              {value.axis.choices?.length ? (
                <span className="muted">
                  {value.axis.choices.map((value) => value.label).join(" / ")}
                </span>
              ) : (
                <div className="input-form-grid">
                  {(["minimum", "maximum", "levels"] as const).map((key) => (
                    <NumberField
                      key={key}
                      path={"batch-axis-" + index + "-" + key}
                      label={
                        {
                          minimum: "下限",
                          maximum: "上限",
                          levels: "网格点数",
                        }[key]
                      }
                      value={value[key].trim() ? Number(value[key]) : null}
                      precision={key === 'levels' ? 0 : 3}
                      unit={
                        key === "levels"
                          ? "—"
                          : engineeringQuantity(
                              value.axis.name,
                              0,
                              value.axis.unit,
                            ).unit
                      }
                      integer={key === "levels"}
                      locked={readOnly}
                      min={key === "levels" ? 2 : undefined}
                      required
                      draftText={staged ? value[key] : undefined}
                      onDraftChange={(raw) => {
                        if (raw !== undefined)
                          change({
                            ...editor,
                            axes: editor.axes.map((item, at) =>
                              at === index ? { ...item, [key]: raw } : item,
                            ),
                          });
                      }}
                    />
                  ))}
                </div>
              )}
              <label
                className="text-field"
                data-field-path={"batch-axis-" + index + "-source"}
              >
                范围来源
                <input
                  value={value.axis.source}
                  readOnly={readOnly}
                  onChange={(event) =>
                    change({
                      ...editor,
                      axes: editor.axes.map((item, at) =>
                        at === index
                          ? {
                              ...item,
                              axis: {
                                ...item.axis,
                                source: event.target.value,
                              },
                            }
                          : item,
                      ),
                    })
                  }
                />
              </label>
            </section>
          ))}
          <section className="input-section">
            <h2>超算执行</h2>
            <div className="input-form-grid">
              <Select
                label="计算资源"
                value={editor.execution.backend}
                disabled={readOnly}
                options={[
                  { value: "slurm", label: "超算 Slurm · dg83" },
                  ...(editor.execution.backend === "local"
                    ? [
                        {
                          value: "local",
                          label: "本机 · 未覆盖",
                          disabled: true,
                        },
                      ]
                    : []),
                ]}
                onChange={(value) =>
                  change({
                    ...editor,
                    execution: { ...editor.execution, backend: value },
                  })
                }
              />
              {[
                ["slurm_parallelism", "并行任务上限", 1, 128, "—"],
                ["sample_timeout_s", "单样本超时", 1, 3600, "s"],
                ["slurm_wall_seconds", "每样本时限", 30, 3600, "s"],
                ["slurm_memory_mb", "每任务内存", 512, 8192, "MB"],
                ["slurm_cpus_per_task", "每任务 CPU 数", 1, 32, "—"],
              ].map(([key, label, min, max, unit]) => (
                <NumberField
                  key={key}
                  label={String(label)}
                  value={Number(editor.execution[String(key)])}
                  unit={String(unit)}
                  integer
                  min={Number(min)}
                  max={Number(max)}
                  required
                  locked={readOnly}
                  draftText={staged ? editor.execution[String(key)] : undefined}
                  onDraftChange={(value) => {
                    if (value !== undefined)
                      change({
                        ...editor,
                        execution: {
                          ...editor.execution,
                          [String(key)]: value,
                        },
                      });
                  }}
                />
              ))}
            </div>
            <label className="text-field">
              参数空间出处
              <input
                readOnly={readOnly}
                value={editor.source}
                onChange={(event) => changeValue("source", event.target.value)}
              />
            </label>
            <span className="muted">
              单次上限 2000 核时 · 累计上限 20000 核时 · 预检返回本次预留上限
            </span>
          </section>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
        </QueryState>
      ) : (
        <QueryState
          query={chosenId ? dataset : history}
          empty={!result && "尚无批量数据集"}
        >
          <Toolbar>
            <Select
              label="数据集记录"
              value={chosenId}
              onChange={(value) => {
                setOffset(0);
                onDataset(value);
              }}
              options={(history.data || []).map((row) => ({
                value: row.id,
                label:
                  text(row.created) +
                  " · " +
                  (statusLabels[text(row.status)] || text(row.status)),
              }))}
            />
            <div className="spacer" />
            <Button
              variant="primary"
              size="compact"
              disabled={!chosenId || !!dataset.error}
              loading={exporting.isPending}
              onClick={() => exporting.mutate()}
            >
              导出数据集
            </Button>
            {result &&
              [
                "interrupted",
                "disconnected",
                "failed",
                "submission_unknown",
              ].includes(text(result.status)) && (
                <Button
                  size="compact"
                  loading={resume.isPending}
                  onClick={() => resume.mutate()}
                >
                  恢复连接与执行
                </Button>
              )}
          </Toolbar>
          {result?.historical === true && (
            <StaleBanner description="数据集基准输入已变化；结果保留固定快照。" />
          )}
          <section className="evidence-summary">
            <h2>
              {numeric(result?.valid_count) ?? 0} /{" "}
              {numeric(result?.sample_count) ?? 0} 个有效样本
            </h2>
            <p className="muted">
              {statusLabels[text(result?.status)] || text(result?.status)}
            </p>
          </section>
          {tab === "execution" ? (
            <DataTable
              label="数据集执行记录"
              rowLabel={(row) => row.label}
              showGroups={false}
              groups={[
                {
                  id: "execution",
                  label: "执行",
                  rows: [
                    {
                      id: "method",
                      label: "插件与方法",
                      value: JSON.stringify(result?.method),
                    },
                    {
                      id: "execution",
                      label: "执行与核时",
                      value: JSON.stringify(result?.execution),
                    },
                    {
                      id: "source",
                      label: "固定输入",
                      value: JSON.stringify(result?.source),
                    },
                    {
                      id: "failure",
                      label: "异常",
                      value: text(optionalRecord(result?.error).message) || "—",
                    },
                  ],
                },
              ]}
              columns={[
                { id: "name", label: "记录", render: (row) => row.label },
                {
                  id: "value",
                  label: "保存信息",
                  wrap: true,
                  render: (row) => row.value,
                },
              ]}
            />
          ) : (
            <>
              <Toolbar>
                <Select
                  label="样本状态"
                  value={status}
                  onChange={(value) => {
                    setStatus(value);
                    setOffset(0);
                  }}
                  options={[
                    "all",
                    "succeeded",
                    "failed",
                    "nonconverged",
                    "pending",
                    "running",
                  ].map((value) => ({
                    value,
                    label: value === "all" ? "全部" : statusLabels[value],
                  }))}
                />
              </Toolbar>
              <DataTable
                label="批量样本"
                rowLabel={(row) => "样本 " + (Number(row.index) + 1)}
                groups={[{ id: "samples", label: "样本", rows: datasetRows }]}
                showGroups={false}
                onSelect={(row) =>
                  onSelect({
                    id: row.id,
                    title: "样本 " + (Number(row.index) + 1),
                    groups: [
                      {
                        label: "保存输入与执行",
                        items: [
                          {
                            label: "参数与来源",
                            value: JSON.stringify(row.parameters),
                          },
                          {
                            label: "状态",
                            value:
                              statusLabels[text(row.status)] ||
                              text(row.status),
                          },
                          {
                            label: "错误",
                            value:
                              text(optionalRecord(row.error).message) || "—",
                          },
                          {
                            label: "耗时",
                            value: numeric(row.wall_seconds) ?? "—",
                            unit: "s",
                          },
                          {
                            label: "收敛与网格",
                            value: JSON.stringify(row.convergence),
                          },
                        ],
                      },
                    ],
                  })
                }
                columns={[
                  {
                    id: "index",
                    label: "样本",
                    numeric: true,
                    render: (row) => Number(row.index) + 1,
                  },
                  {
                    id: "parameters",
                    label: "采样参数",
                    wrap: true,
                    render: (row) =>
                      Object.entries(optionalRecord(row.parameters)).map(
                        ([key, raw]) => {
                          const value = optionalRecord(raw);
                          return (
                            <span key={key}>
                              {key}{" "}
                              <EngineeringValue
                                quantity={key}
                                value={numeric(value.value)}
                                unit={text(value.unit)}
                                withUnit
                              />{" "}
                            </span>
                          );
                        },
                      ),
                  },
                  {
                    id: "temperature",
                    label: "运行最热导体",
                    numeric: true,
                    render: (row) => (
                      <EngineeringValue
                        quantity="temperature"
                        value={resultValue(
                          row,
                          "conductor_temperature",
                          "operating",
                        )}
                        unit="K"
                        withUnit
                      />
                    ),
                  },
                  {
                    id: "ampacity",
                    label: "允许电流",
                    numeric: true,
                    render: (row) => (
                      <EngineeringValue
                        quantity="ampacity"
                        value={resultValue(row, "ampacity")}
                        unit="A"
                        withUnit
                      />
                    ),
                  },
                  {
                    id: "status",
                    label: "状态",
                    render: (row) => (
                      <StatusMark
                        kind={
                          row.valid === true
                            ? "success"
                            : ["pending", "running"].includes(text(row.status))
                              ? "running"
                              : "error"
                        }
                        label={
                          statusLabels[text(row.status)] || text(row.status)
                        }
                        detail={text(optionalRecord(row.error).message)}
                      />
                    ),
                  },
                ]}
              />
              <Toolbar>
                <Button
                  size="compact"
                  disabled={!offset}
                  onClick={() => setOffset((value) => Math.max(0, value - 50))}
                >
                  上一页
                </Button>
                <span className="muted">
                  {offset + (datasetRows.length ? 1 : 0)}–
                  {offset + datasetRows.length} /{" "}
                  {numeric(result?.filtered_count) ?? 0}
                </span>
                <Button
                  size="compact"
                  disabled={numeric(result?.next_offset) === null}
                  onClick={() => setOffset(numeric(result?.next_offset)!)}
                >
                  下一页
                </Button>
              </Toolbar>
            </>
          )}
        </QueryState>
      )}
      {(resume.error || exporting.error) && (
        <ErrorState
          title="数据集操作失败"
          description={message(resume.error || exporting.error)}
        />
      )}
      <PreflightDialog
        open={open}
        onOpenChange={(value) => {
          if (!submit.isPending) setOpen(value);
        }}
        method="批量仿真 · 超算 Slurm"
        loading={check.isPending}
        error={check.error}
        data={
          check.data
            ? {
                ...check.data,
                method_scopes: [{ limitations: check.data.limitations }],
              }
            : undefined
        }
        ack={ack}
        onAck={setAck}
        running={submit.isPending}
        runError={submit.error}
        disabled={!!staged || context.dirty}
        onCheck={!check.data ? () => check.mutate() : undefined}
        onRun={() => submit.mutate()}
        onMissing={() => setOpen(false)}
        missingLabel={() => "参数空间"}
        summary={
          <p className="muted">
            {check.data
              ? "预留核时上限 " +
                engineeringQuantity(
                  "core_hours",
                  numeric(check.data.estimated_upper_core_hours),
                  "h",
                ).text +
                " h"
              : "先核对保存的采样范围；预检返回预算与适用范围。"}
          </p>
        }
      />
    </div>
  );
}
