import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { exactContract, inputContracts } from "@/api/input-contracts";
import { api, responseData, optionalRecord, text, numeric, message } from "@/api/client";
import { moduleConfiguration } from "@/lib/study-config";
import { useStudy } from "./study-provider";
import { DataTable } from "./data-table";
import { EngineeringValue } from "./engineering-value";
import { EmptyState, ErrorState, LoadingState } from "./states";
import { Toolbar } from "./toolbar";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
import { Dialog } from "./ui/dialog";
import { StudyMethodForm } from "./study-method-form";
import { downloadJson } from "@/lib/download";
import type { CatalogRow } from "@/api/catalogs";
import type { StudyDefinition } from "@/api/research";
import { displayName } from "@/lib/display-names";
export function StudySimulation({
  run,
  tab,
  readOnly,
}: {
  run?: Record<string, unknown>;
  tab: string;
  readOnly: boolean;
}) {
  const context = useStudy(),
    current = context.draft?.definition || context.study.definition;
  const fixed =
    optionalRecord(run?.snapshot).study_definition ||
    optionalRecord(run?.snapshot).definition;
  const definition = readOnly && fixed ? (fixed as StudyDefinition) : current;
  const config =
    moduleConfiguration(definition, "simulation") ||
    (definition.input_source === "study" ? definition : undefined);
  const query = useQuery({
    queryKey: ["input-contracts"],
    queryFn: ({ signal }) => inputContracts(signal),
  });
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [method, setMethod] = useState(""),
    [filename, setFilename] = useState("");
  const problemContract = useQuery({
    queryKey: ["simulation-problem-contract"],
    queryFn: ({ signal }) => responseData(api.GET("/api/simulation/problem-contract", { signal })),
    enabled: open,
  });
  const form = optionalRecord(context.moduleInputs.simulation?.value),
    raw = text(form.raw),
    reference = text(form.reference);
  const methods = (query.data || []).filter(
    (value) => value.input_schema === "cablesim.simulation-problem/1",
  );
  const key = (value: (typeof methods)[number]["method"]) =>
    [
      value.plugin_id,
      value.capability,
      value.version,
      value.release_digest,
    ].join(":");
  function adopt() {
    try {
      if (readOnly) throw Error("固定运行输入只读，请返回当前研究。");
      if (!problemContract.data || problemContract.isError) throw Error("请先读取宿主输入格式，再采用算例。");
      if (new TextEncoder().encode(raw).length > 120 * 1024)
        throw Error("仿真输入超过 120 KB，请缩小定义。");
      const parsed = JSON.parse(raw),
        input = optionalRecord(parsed.method_input || parsed.problem || parsed);
      if (input.schema_version !== problemContract.data.schema_version)
        throw Error("文件不是已声明的仿真问题格式；请使用对应的算例输入。");
      const required = problemContract.data.schema.required;
      const missing = Array.isArray(required) ? required.filter(field => typeof field === "string" && !(field in input)) : [];
      if (missing.length) throw Error("算例缺少输入格式要求的字段：" + missing.map(field => displayName(String(field))).join("、"));
      const chosen = methods.find((value) => key(value.method) === method);
      if (!chosen) throw Error("请选择声明支持该问题的准确方法版本。");
      exactContract(query.data!, chosen.method);
      if (!reference.trim()) throw Error("请填写算例来源与位置。");
      const pending = context.moduleInputs.simulation;
      if (
        pending &&
        (pending.revision !== numeric(context.workspace.revision) ||
          pending.studyRevision !== context.study.revision)
      )
        throw Error("研究基准已变化，输入草稿保留；请核对后重新导入。");
      const next = {
        title: text(input.name) || "仿真算例复现",
        method: chosen.method,
        input_source: "study" as const,
        method_input: input,
        parameters: optionalRecord(parsed.parameters),
        driver: { kind: "single" as const },
        input_sources: {
          "/method_input": {
            kind: "user" as const,
            reference: reference.trim(),
            reviewed: false,
          },
        },
        crosschecks: [],
      };
      context.editDefinition({
        ...current,
        modules: { ...current.modules, simulation: next },
      });
      context.editModuleInput("simulation", undefined);
      setOpen(false);
      setError("");
    } catch (error) {
      setError(message(error));
    }
  }
  const cases = (
    Array.isArray(optionalRecord(run?.output).cases)
      ? (optionalRecord(run?.output).cases as unknown[])
      : []
  ).map(optionalRecord);
  const rows: CatalogRow[] =
    run?.integrity === "verified"
      ? cases.flatMap((value, index) =>
          (Array.isArray(value.results) ? value.results : [])
            .map(optionalRecord)
            .map((row, at) => ({
              ...row,
              id: index + "/" + at,
              executionStatus: value.status,
              executionError: value.error,
            })),
        )
      : [];
  const hasSimulation =
    config?.input_source === "study" &&
    optionalRecord(config.method_input).schema_version ===
      "cablesim.simulation-problem/1";
  return (
    <div
      className="input-module"
      data-module-state={
        error
          ? "error"
          : readOnly || run?.freshness === "historical"
            ? "historical"
            : !hasSimulation
              ? "empty"
              : "success"
      }
    >
      <Toolbar>
        <h2>仿真复现</h2>
        <div className="spacer" />
        {!readOnly && (
          <Button
            size="compact"
            onClick={() => {
              setOpen(true);
              setError("");
            }}
          >
            导入算例输入
          </Button>
        )}
        {hasSimulation && (
          <Button
            size="compact"
            onClick={() =>
              downloadJson(
                {
                  definition: config,
                  snapshot: run?.snapshot,
                  output:
                    run?.integrity === "verified" ? run.output : undefined,
                },
                "simulation-evidence.json",
              )
            }
          >
            导出保存记录
          </Button>
        )}
      </Toolbar>
      {!hasSimulation ? (
        <EmptyState
          title="尚无独立仿真算例"
          description={
            query.isPending
              ? "正在读取可执行方法。"
              : query.error
                ? message(query.error)
                : methods.length
                  ? "导入有出处的完整问题，保存、预检后运行。"
                  : "已安装方法尚未提供此类独立问题的输入契约；当前原生任务请使用各研究模块。"
          }
        />
      ) : tab === "inputs" ? (
        <>
          <section className="input-section">
            <h2>固定问题输入</h2>
            <span className="muted">
              {config?.input_sources?.["/method_input"]?.reference ||
                "来源未提供"}
            </span>
            <Button
              size="compact"
              onClick={() =>
                downloadJson(config?.method_input, "simulation-input.json")
              }
            >
              下载模型与网格输入
            </Button>
          </section>
          <StudyMethodForm
            module="simulation"
            historical={readOnly}
            definition={definition}
          />
        </>
      ) : tab === "evidence" ? (
        <>
          <section className="input-section">
            <h2>方法与输入来源</h2>
            <Button
              size="compact"
              onClick={() =>
                downloadJson(
                  {
                    method: config?.method,
                    input_sources: config?.input_sources,
                    executions: optionalRecord(run?.output).executions,
                    convergence: run?.convergence,
                    artifact_status: run?.artifact_status,
                  },
                  "simulation-evidence.json",
                )
              }
            >
              下载完整方法与输入证据
            </Button>
          </section>
          <span className="muted">
            参考求解器对照仅展示保存的证据；缺项不补造数值。
          </span>
        </>
      ) : run && run.integrity !== "verified" ? (
        <ErrorState
          title="运行完整性未通过"
          description="拒绝显示数值，请核对保存的运行与工件。"
        />
      ) : rows.length ? (
        <DataTable
          label="仿真复现保存结果"
          rowLabel={(row) => text(row.key)}
          showGroups={false}
          groups={[{ id: "results", label: "结果", rows }]}
          columns={[
            { id: "quantity", label: "结果量", render: (row) => text(row.key) },
            {
              id: "entity",
              label: "对象 / 条件",
              render: (row) => text(row.entity) + " · " + text(row.case),
            },
            {
              id: "value",
              label: "保存值",
              numeric: true,
              render: (row) => (
                <EngineeringValue
                  quantity={text(row.key)}
                  value={
                    row.executionStatus === "succeeded" &&
                    row.status === "available"
                      ? numeric(row.value)
                      : null
                  }
                  unit={text(row.unit)}
                  withUnit
                />
              ),
            },
            { id: "status", label: "状态", render: (row) => text(row.status) },
            {
              id: "reason",
              label: "原因",
              wrap: true,
              render: (row) =>
                text(optionalRecord(row.reason).message) ||
                text(optionalRecord(row.executionError).message) ||
                "—",
            },
          ]}
        />
      ) : (
        <EmptyState
          title="尚无保存的复现运行"
          description="方法参数和来源核对后，通过运行前预检。"
        />
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="导入仿真输入草稿"
        description="不会替换共享电缆；整体校验由保存与预检完成。"
        initialFocus="form"
        actions={
          <Button
            variant="primary"
            disabled={!raw || !reference || !method || query.isPending || !!query.error || !problemContract.data || problemContract.isFetching || problemContract.isError}
            onClick={adopt}
          >
            采用输入草稿
          </Button>
        }
      >
        {problemContract.isPending ? <LoadingState title="正在读取宿主输入格式" /> : problemContract.error ?
          <ErrorState description={message(problemContract.error)} action={<Button onClick={() => problemContract.refetch()}>重新读取输入格式</Button>} /> : problemContract.data &&
          <section className="input-section" aria-label="宿主仿真输入格式">
            <div className="report-toolbar"><span>输入格式已读取 · 长度 m / 温度 K / 电流 A</span><Button size="compact" onClick={() => downloadJson(problemContract.data, "simulation-problem-contract.json")}>下载输入格式</Button></div>
            <details><summary>查看字段单位与格式依据</summary>
              <dl className="report-sources">{Object.entries(problemContract.data.units).map(([field, unit]) => <div key={field}><dt>{field}</dt><dd>{unit}</dd></div>)}</dl>
              <p className="digest">格式摘要：{problemContract.data.schema_sha256}</p>
              <p className="muted">{problemContract.data.source} · {problemContract.data.source_sha256}</p>
            </details>
          </section>}
        {!!query.error && <ErrorState description={message(query.error)} action={<Button onClick={() => query.refetch()}>重新读取方法</Button>} />}
        <label className="text-field">
          算例 JSON
          <input
            type="file"
            accept=".json,application/json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 120 * 1024) {
                setError("文件超过 120 KB");
                return;
              }
              setFilename(file.name);
              context.editModuleInput("simulation", {
                ...form,
                raw: await file.text(),
              });
              setError("");
            }}
          />
        </label>
        {filename && <span className="muted">{filename}</span>}
        <Select
          label="准确方法版本"
          value={method}
          onChange={setMethod}
          options={methods.map((value) => ({
            value: key(value.method),
            label: displayName(value.method.plugin_id) + " · " + displayName(value.method.capability) + " · " + value.method.version,
          }))}
        />
        <label className="text-field">
          来源与位置
          <input
            value={reference}
            onChange={(event) =>
              context.editModuleInput("simulation", {
                ...form,
                reference: event.target.value,
              })
            }
            placeholder="算例、文献版本与页码"
          />
        </label>
        <label className="text-field">
          输入内容
          <textarea
            value={raw}
            onChange={(event) =>
              context.editModuleInput("simulation", {
                ...form,
                raw: event.target.value,
              })
            }
          />
        </label>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </Dialog>
    </div>
  );
}
