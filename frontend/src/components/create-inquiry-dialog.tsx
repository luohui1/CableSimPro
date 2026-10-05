import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  api,
  ApiError,
  message,
  numeric,
  optionalRecord,
  record,
  responseData,
  text,
} from "@/api/client";
import { inputContracts } from "@/api/input-contracts";
import { methodCatalog, modelVersions } from "@/api/research";
import type { components } from "@/api/generated/schema";
import {
  engineeringQuantity,
  engineeringInputPrecision,
  formatNumber,
} from "@/lib/format";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { NumberField } from "./ui/number-field";
import { Select } from "./ui/select";
import { Tooltip } from "./ui/tooltip";
import { LoadingState, ErrorState, EmptyState } from "./states";
import { SourceBadge } from "./source-badge";
type Source = components["schemas"]["Source"];
type Given = { value: string; source: Source["kind"]; reference: string };
export function CreateInquiryDialog({
  open,
  onOpenChange,
  theme,
  onOtherTask,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: "light" | "dark";
  onOtherTask: (task: string) => void;
}) {
  const navigate = useNavigate(),
    queries = useQueryClient();
  const [target, setTarget] = useState<number | null>(null),
    [title, setTitle] = useState(""),
    [range, setRange] = useState(""),
    [complete, setComplete] = useState(false),
    [values, setValues] = useState<Record<string, Given>>({}),
    [failure, setFailure] = useState("");
  const allocated = useRef<Record<string, unknown> | null>(null);
  const targetInput = useRef<HTMLInputElement>(null);
  function continueInquiry() {
    const raw = targetInput.current?.value.trim() ?? "";
    const current = Number(raw);
    if (!raw || !Number.isFinite(current) || current <= 0) {
      setFailure("请填写大于 0 A 的目标电流");
      targetInput.current?.focus();
      return;
    }
    if (loading || error || !candidates.length || !rating || !completion) return;
    setTarget(current);
    setFailure("");
    setComplete(true);
  }
  const models = useQuery({
    queryKey: ["model-versions"],
    queryFn: ({ signal }) => modelVersions(signal),
    enabled: open,
  });
  const methods = useQuery({
    queryKey: ["method-catalog"],
    queryFn: ({ signal }) => methodCatalog(signal),
    enabled: open,
  });
  const contracts = useQuery({
    queryKey: ["input-contracts"],
    queryFn: ({ signal }) => inputContracts(signal),
    enabled: open,
  });
  const ranges = new Map<string, Record<string, unknown>[]>();
  for (const model of models.data || []) {
    const spec = optionalRecord(optionalRecord(model.payload).specification),
      area = numeric(spec.area_m2);
    if (
      !text(model.id).startsWith("candidate:") ||
      area === null ||
      area < 300e-6 - 1e-12 ||
      area > 400e-6 + 1e-12
    )
      continue;
    const key = [
      text(spec.manufacturer),
      text(spec.designation),
      numeric(spec.u0_v),
      numeric(spec.voltage_v),
      numeric(spec.cores),
    ].join("|");
    ranges.set(key, [...(ranges.get(key) || []), model]);
  }
  const candidates = (ranges.get(range) || []).sort(
    (a, b) =>
      (numeric(
        optionalRecord(optionalRecord(a.payload).specification).area_m2,
      ) || 0) -
      (numeric(
        optionalRecord(optionalRecord(b.payload).specification).area_m2,
      ) || 0),
  );
  const completion = contracts.data?.find(
    (item) =>
      item.method.plugin_id === "cablesim.iec60287" &&
      item.method.capability === "model-completion",
  );
  const rating = contracts.data?.find(
    (item) =>
      item.method.plugin_id === "cablesim.iec60287" &&
      item.method.capability === "steady-rating",
  );
  const installed = (contract: typeof rating) =>
    !!contract &&
    (methods.data || []).some(
      (item) =>
        item.platform_supported !== false &&
        text(optionalRecord(item.method).release_digest) ===
          contract.method.release_digest,
    );
  const armoured = candidates.some((model) =>
    text(
      optionalRecord(optionalRecord(model.payload).specification).designation,
    ).includes("22"),
  );
  const fields = (completion?.engineering_fields || [])
    .map(optionalRecord)
    .filter(
      (field) =>
        (!field.armoured_only || armoured) &&
        (field.key !== "screen_longitudinal_r20" ||
          values.screen_model?.value === "given_r20"),
    );
  const defaults = (models.data || [])
    .map((model) =>
      optionalRecord(
        optionalRecord(model.method_defaults)["cablesim.iec60287"],
      ),
    )
    .find((value) => Object.keys(value).length);
  function edit(key: string, patch: Partial<Given>) {
    setValues((previous) => ({
      ...previous,
      [key]: {
        ...(previous[key] || { value: "", source: "user", reference: "" }),
        ...patch,
      },
    }));
  }
  function prepared() {
    if (!completion) throw new ApiError(501, "缺少正式型号补录契约");
    const given: Record<string, unknown> = {};
    for (const field of fields) {
      const key = text(field.key),
        entry = values[key];
      if (!entry?.value.trim()) {
        if (field.optional && !field.armoured_only) continue;
        throw new ApiError(422, "请填写" + text(field.title));
      }
      if (!entry.reference.trim() || !entry.source)
        throw new ApiError(422, text(field.title) + "需填写来源和出处");
      const raw = Array.isArray(field.choices)
        ? entry.value
        : Number(entry.value);
      if (
        typeof raw === "number" &&
        (!Number.isFinite(raw) ||
          (numeric(field.min) !== null && raw < numeric(field.min)!) ||
          (numeric(field.max) !== null && raw > numeric(field.max)!))
      )
        throw new ApiError(422, text(field.title) + "超出契约范围");
      given[key] = {
        value: raw,
        unit: text(field.unit),
        reference: entry.reference.trim(),
      };
    }
    return { method: completion.method, parameters: { values: given } };
  }
  const create = useMutation({
    retry: false,
    mutationFn: async () => {
      if (
        target === null ||
        target <= 0 ||
        !candidates.length ||
        !installed(rating) ||
        !installed(completion) ||
        !defaults
      )
        throw new ApiError(422, "请选择候选范围、目标电流及已安装方法");
      const completionValue = prepared();
      if (!allocated.current)
        allocated.current = record(
          await responseData(
            api.POST("/api/design/study-workspaces", {
              body: {
                model_id: text(candidates[0].id),
                content_sha256: text(candidates[0].content_sha256),
                candidate_completion: completionValue,
                target_current_a: target,
              },
            }),
          ),
          "新问询工程",
        );
      const workspace = allocated.current,
        wid = text(workspace.id);
      const sources: Record<string, Source> = {
        "/parameters": {
          kind: "demo",
          reference: "显式采用系统研究方法参考参数，需按实际条件核对",
          reviewed: false,
        },
        "/driver/minimum": {
          kind: "user",
          reference: "客户问询目标电流 A",
          reviewed: false,
        },
      };
      const completions: Record<
        string,
        components["schemas"]["CandidateCompletion"]
      > = {};
      for (const candidate of candidates) {
        const id = text(candidate.id).replace(/^candidate:/, "");
        completions[id] = completionValue;
        for (const field of fields) {
          const key = text(field.key),
            entry = values[key];
          if (entry?.value.trim())
            sources[
              "/candidate_completions/" + id + "/parameters/values/" + key
            ] = {
              kind: entry.source,
              reference: entry.reference,
              reviewed: false,
            };
        }
      }
      const body: components["schemas"]["CreateStudy"] = {
        title: title.trim() || `${formatNumber(target)} A 客户问询`,
        task: "target",
        expected_revision: numeric(workspace.revision)!,
        method: rating!.method,
        input_source: "domain",
        parameters: defaults,
        candidate_completions: completions,
        input_sources: sources,
        driver: {
          kind: "selection",
          candidate_ids: candidates.map((item) =>
            text(item.id).replace(/^candidate:/, ""),
          ),
          minimum: target,
          target_unit: "A",
          allow_demo_candidates: false,
          candidate_filters: {
            minimum_area_m2: 300e-6,
            maximum_area_m2: 400e-6,
            voltage_v: numeric(
              optionalRecord(
                optionalRecord(candidates[0].payload).specification,
              ).voltage_v,
            )!,
          },
        },
      };
      const saved = record(
        await responseData(
          api.POST("/api/workspaces/{wid}/studies", {
            params: { path: { wid } },
            body,
          }),
        ),
        "问询研究",
      );
      return { wid, sid: text(saved.id) };
    },
    onSuccess: async ({ wid, sid }) => {
      await queries.invalidateQueries({ queryKey: ["study-index"] });
      allocated.current = null;
      setComplete(false);
      onOpenChange(false);
      navigate({
        to: "/studies/$sid/$module/$tab",
        params: { sid, module: "selection", tab: "results" },
        search: {
          workspace: wid,
          theme,
          run: "",
          delivery: "",
          preflight: true,
        },
      });
    },
    onError: (error) => setFailure(message(error)),
  });
  const error = models.error || methods.error || contracts.error;
  const loading = models.isPending || methods.isPending || contracts.isPending;
  const formTitle =
    title || ((target || 0) > 0 ? `${formatNumber(target)} A 客户问询` : "");
  return (
    <>
      <Dialog
        open={open && !complete}
        onOpenChange={onOpenChange}
        title="新建问询"
        description="固定候选范围与计算方法"
        initialFocus="form"
        actions={
          <Button
            variant="primary"
            disabled={
              loading || !!error || !candidates.length || !rating || !completion
            }
            onClick={continueInquiry}
          >
            建立研究
          </Button>
        }
      >
        {loading ? (
          <LoadingState title="正在读取型号与方法" />
        ) : error ? (
          <ErrorState
            description={message(error)}
            action={
              <Button
                onClick={() => {
                  models.refetch();
                  methods.refetch();
                  contracts.refetch();
                }}
              >
                重新读取
              </Button>
            }
          />
        ) : (
          <form
            className="create-study-form"
            onSubmit={(event) => {
              event.preventDefault();
              continueInquiry();
            }}
          >
            <Select
              label="研究任务"
              value="selection"
              onChange={onOtherTask}
              options={[
                { value: "selection", label: "客户问询选型" },
                { value: "rating", label: "额定载流量" },
                { value: "operating", label: "运行温度" },
                { value: "hybrid", label: "混合载流量参考研究" },
                { value: "transient-temperature", label: "暂态温升" },
                { value: "sheath-losses", label: "护套损耗" },
                { value: "electrothermal-steady", label: "电热耦合" },
              ]}
            />
            <NumberField
              inputRef={targetInput}
              submitOnEnter
              label="目标电流"
              value={target}
              onCommit={setTarget}
              unit="A"
              min={0}
              minExclusive
              required
              source="user"
            />
            <button type="submit" className="visually-hidden" tabIndex={-1} aria-hidden="true">建立研究</button>
            <label className="text-field">
              研究名称
              <input
                value={formTitle}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
              />
            </label>
            <fieldset className="inquiry-range">
              <legend>候选型号范围 · 300–400 mm²</legend>
              {[...ranges].map(([key, items]) => (
                <label key={key}>
                  <input
                    type="radio"
                    name="candidate-range"
                    checked={range === key}
                    onChange={() => {
                      setRange(key);
                      setValues({});
                      allocated.current = null;
                    }}
                  />
                  {text(
                    optionalRecord(
                      optionalRecord(items[0].payload).specification,
                    ).designation,
                  )}{" "}
                  · {items.length} 个型号 · 300–400 mm²
                  <SourceBadge kind="document" detail={text(items[0].source)} />
                </label>
              ))}
            </fieldset>
            {!ranges.size && (
              <EmptyState
                title="没有此范围的厂家候选"
                description="型号库缺少 300–400 mm² 原始规格。"
              />
            )}
            <SourceBadge
              kind="library"
              detail={
                rating
                  ? rating.method.plugin_id +
                    " · " +
                    rating.method.capability +
                    " · " +
                    rating.method.version
                  : "缺少方法"
              }
            />
            {failure && (
              <p className="field-error" role="alert">
                {failure}
              </p>
            )}
          </form>
        )}
      </Dialog>
      <Dialog
        open={open && complete}
        onOpenChange={(value) => {
          if (!create.isPending && !value) setComplete(false);
        }}
        title="补录工程师给定参数"
        description="值、来源与出处随研究保存"
        initialFocus="form"
        actions={
          <Button
            variant="primary"
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            保存并预检
          </Button>
        }
      >
        <div className="demo-row">
          <Button
            size="compact"
            disabled={create.isPending}
            onClick={() => {
              const next: Record<string, Given> = {};
              for (const field of fields)
                if (field.example !== undefined)
                  next[text(field.key)] = {
                    value: String(field.example),
                    source: "user",
                    reference: text(field.reference),
                  };
              setValues(next);
            }}
          >
            采用参考输入
          </Button>
          <SourceBadge
            kind="demo"
            detail="参考输入为明确的工程假设，非厂家实测；敷设模板、土壤与方法参数须按实际工况核对。"
          />
        </div>
        <div className="engineering-completion">
          {fields.map((field) => {
            const key = text(field.key),
              entry = values[key] || {
                value: "",
                source: "user" as const,
                reference: "",
              };
            const quantity = engineeringQuantity(
              key,
              entry.value ? Number(entry.value) : null,
              text(field.unit),
            );
            const choices = Array.isArray(field.choices)
              ? (field.choices as unknown[][])
              : null;
            const scale = quantity.scale,
              unit = quantity.unit;
            return (
              <section className="input-section" key={key}>
                {choices ? (
                  <Select
                    label={text(field.title)}
                    value={entry.value || undefined}
                    options={choices.map((value) => ({
                      value: String(value[0]),
                      label: String(value[1]),
                    }))}
                    onChange={(value) => edit(key, { value })}
                    disabled={create.isPending}
                  />
                ) : (
                  <NumberField
                    label={text(field.title)}
                    value={entry.value ? Number(entry.value) * scale : null}
                    unit={unit}
                    precision={engineeringInputPrecision(
                      key,
                      entry.value ? Number(entry.value) : null,
                      text(field.unit),
                    )}
                    fullPrecision={quantity.complete}
                    min={
                      numeric(field.min) === null
                        ? undefined
                        : numeric(field.min)! * scale
                    }
                    max={
                      numeric(field.max) === null
                        ? undefined
                        : numeric(field.max)! * scale
                    }
                    onCommit={(value) =>
                      edit(key, {
                        value: value === null ? "" : String(value / scale),
                      })
                    }
                    disabled={create.isPending}
                  />
                )}
                <details>
                  <summary>
                    <SourceBadge
                      kind={
                        entry.source === "manufacturer"
                          ? "document"
                          : entry.source === "measurement"
                            ? "measurement"
                            : entry.source === "standard"
                              ? "standard"
                              : "user"
                      }
                      detail={entry.reference || text(field.hint)}
                    />
                    来源与出处
                  </summary>
                  <Select
                    label={text(field.title) + "来源"}
                    value={entry.source}
                    options={[
                      { value: "user", label: "工程师给定" },
                      { value: "manufacturer", label: "厂家" },
                      { value: "measurement", label: "实测" },
                      { value: "standard", label: "标准" },
                    ]}
                    onChange={(value) =>
                      edit(key, { source: value as Source["kind"] })
                    }
                    disabled={create.isPending}
                  />
                  <label className="text-field">
                    出处
                    <input
                      aria-label={text(field.title) + "出处"}
                      value={entry.reference}
                      onChange={(event) =>
                        edit(key, { reference: event.target.value })
                      }
                      disabled={create.isPending}
                    />
                  </label>
                  <Tooltip content={text(field.hint)}>
                    <span tabIndex={0}>参数范围与参考依据</span>
                  </Tooltip>
                </details>
              </section>
            );
          })}
        </div>
        {failure && (
          <p className="field-error" role="alert">
            {failure}
          </p>
        )}
      </Dialog>
    </>
  );
}
