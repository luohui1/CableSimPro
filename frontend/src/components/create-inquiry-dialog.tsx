import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
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
import { methodCatalog, modelVersions, workspaces, typeIndex } from "@/api/research";
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
import { engineeringContractFields } from './study-method-form';
import { declaredUnit } from '@/lib/contract-schema';
import './workbench-inspector.css';
import './study-inquiry.css';
type Source = components["schemas"]["Source"];
type Given = { value: string; source: Source["kind"]; reference: string };
function areaRange(models: Record<string, unknown>[]) {
  const areas=models.map(model=>numeric(optionalRecord(optionalRecord(model.payload).specification).area_m2)!).map(area=>area*1e6);
  return `${formatNumber(Math.min(...areas))}–${formatNumber(Math.max(...areas))} mm²`;
}
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
  const search = useSearch({ strict: false }) as { workspace?: string };
  const [workspaceId, setWorkspaceId] = useState(search.workspace || '');
  const [projectName,setProjectName]=useState('');
  const projectNameInput=useRef<HTMLInputElement>(null);
  const projects = useQuery({ queryKey: ['workspace-index'], queryFn: ({ signal }) => workspaces(signal), enabled: open });
  const types = useQuery({ queryKey: ['type-index'], queryFn: ({ signal }) => typeIndex(signal), enabled: open });
  const typeIds = new Set((types.data || []).map(item => text(item.id)));
  const projectOptions = (projects.data || []).filter(item => !typeIds.has(text(item.id)));
  const [target, setTarget] = useState<number | null>(null),
    [title, setTitle] = useState<string | null>(null),
    [range, setRange] = useState(""),
    [complete, setComplete] = useState(false),
    [values, setValues] = useState<Record<string, Given>>({}),
    [failure, setFailure] = useState("");
  const allocated = useRef<Record<string, unknown> | null>(null);
  const completionForm = useRef<HTMLDivElement>(null);
  const [fieldError, setFieldError] = useState<{key:string; message:string; source?:boolean}>();
  useEffect(() => { if (open) { setWorkspaceId(search.workspace || ''); allocated.current = null; } }, [open, search.workspace]);
  const targetInput = useRef<HTMLInputElement>(null);
  function continueInquiry() {
    if(!workspaceId && !projectName.trim()){
      setFailure('请填写客户与工程名称');projectNameInput.current?.focus();return;
    }
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
      area <= 0
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
  const fields = engineeringContractFields(completion?.parameter_schema)
    .filter(
      (field) =>
        (armoured || !['armour_gap_ratio','steel_relative_permeability'].includes(text(field.key))) &&
        (field.key !== "screen_longitudinal_r20" ||
          values.screen_model?.value === "given_r20"),
    );
  const reference = useQuery({
    queryKey: ['inquiry-reference', candidates.map(model => model.id)], enabled: complete && !!candidates.length,
    queryFn: async ({signal}) => {
      const ids = candidates.map(model => text(model.id).replace(/^candidate:/, ''));
      for (const project of projectOptions) {
        const studies = await responseData(api.GET('/api/workspaces/{wid}/studies', {params:{path:{wid:text(project.id)}},signal}));
        for (const study of (Array.isArray(studies) ? studies : []).map(optionalRecord)) {
          const definition = optionalRecord(study.definition), completions = optionalRecord(definition.candidate_completions);
          if (!ids.every(id => completions[id])) continue;
          const saved = optionalRecord(completions[ids[0]]);
          if (optionalRecord(saved.method).capability === 'model-completion')
            return {title:text(definition.title), values:optionalRecord(optionalRecord(saved.parameters).values)};
        }
      }
      return null;
    },
  });
  const defaults = (models.data || [])
    .map((model) =>
      optionalRecord(
        optionalRecord(model.method_defaults)["cablesim.iec60287"],
      ),
    )
    .find((value) => Object.keys(value).length);
  function edit(key: string, patch: Partial<Given>) {
    setFieldError(previous => previous?.key === key ? undefined : previous);
    setValues((previous) => ({
      ...previous,
      [key]: {
        ...(previous[key] || { value: "", source: "user", reference: "" }),
        ...patch,
      },
    }));
  }
  function invalid(key:string, reason:string, source=false):never {
    setFieldError({key,message:reason,source});
    const section=completionForm.current?.querySelector<HTMLElement>(`[${source?'data-source-key':'data-completion-key'}="${key}"]`);
    if(source){const details=section?.closest('details');if(details)details.open=true;}
    section?.scrollIntoView({block:'nearest'});
    section?.querySelector<HTMLElement>(source ? 'input' : 'input,button[role="combobox"]')?.focus();
    throw new ApiError(422,reason,{key});
  }
  function prepared() {
    if (!completion) throw new ApiError(501, "缺少正式型号补录契约");
    const given: Record<string, unknown> = {};
    for (const field of fields) {
      const key = text(field.key),
        entry = values[key];
      if (!entry?.value.trim()) {
        if (field.optional && !['armour_gap_ratio','steel_relative_permeability'].includes(key) && !(key==='screen_longitudinal_r20' && values.screen_model?.value==='given_r20')) continue;
        invalid(key, "请填写" + text(field.title));
      }
      if (!entry.reference.trim() || !entry.source)
        invalid(key, text(field.title) + "需填写来源和出处",true);
      const raw = Array.isArray(field.choices)
        ? entry.value
        : Number(entry.value);
      if (
        typeof raw === "number" &&
        (!Number.isFinite(raw) ||
          (numeric(field.min) !== null && (field.minExclusive ? raw <= numeric(field.min)! : raw < numeric(field.min)!)) ||
          (numeric(field.max) !== null && raw > numeric(field.max)!))
      )
        invalid(key, text(field.title) + "超出范围；" + text(field.hint));
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
      if (workspaceId) {
        if (!projectOptions.some(project => project.id === workspaceId)) throw new ApiError(409, '所选工程已不可用，请重新选择所属工程');
        allocated.current = record(await responseData(api.GET('/api/workspaces/{wid}', { params: { path: { wid: workspaceId } } })), '所属工程');
      }
      if (!allocated.current)
        allocated.current = record(
          await responseData(
            api.POST("/api/design/study-workspaces", {
              body: {
                ...{project_name:projectName.trim()},
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
        title: title?.trim() || `${formatNumber(target)} A 客户问询`,
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
            minimum_area_m2: Math.min(...candidates.map(item => numeric(optionalRecord(optionalRecord(item.payload).specification).area_m2)!)),
            maximum_area_m2: Math.max(...candidates.map(item => numeric(optionalRecord(optionalRecord(item.payload).specification).area_m2)!)),
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
    onError: (error) => {
      const raw = error instanceof ApiError ? error.detail : undefined, local = optionalRecord(raw);
      if(local.key){setFailure('');return;}
      const positions = [text(raw), text(local.path), ...(Array.isArray(raw) ? raw.map(row => (Array.isArray(optionalRecord(row).loc) ? optionalRecord(row).loc as unknown[] : []).map(text).join('/')) : [])];
      const detail = message(error), field = fields.find(item => positions.some(path => path.split('/').includes(text(item.key))) || detail.includes('/'+text(item.key)) || detail.includes('.'+text(item.key)));
      if(field){try{invalid(text(field.key),text(field.title)+'：请检查必填值、单位与出处。'+text(field.hint), positions.some(path=>path.endsWith('/reference')));}catch{/* mutation already failed */}setFailure('');}
      else setFailure(detail);
    },
  });
  useEffect(() => {
    // 服务端错误回调发生时控件仍处于提交禁用态；恢复可编辑后再定位。
    if (!complete || create.isPending || !fieldError) return;
    const section = completionForm.current?.querySelector<HTMLElement>(`[${fieldError.source?'data-source-key':'data-completion-key'}="${fieldError.key}"]`);
    if (fieldError.source) { const details = section?.closest('details'); if (details) details.open = true; }
    section?.scrollIntoView({block:'nearest'});
    section?.querySelector<HTMLElement>(fieldError.source ? 'input' : 'input,button[role="combobox"]')?.focus();
  }, [complete, create.isPending, fieldError]);
  const error = models.error || methods.error || contracts.error || projects.error || types.error;
  const loading = models.isPending || methods.isPending || contracts.isPending || projects.isPending || types.isPending;
  const formTitle =
    title ?? ((target || 0) > 0 ? `${formatNumber(target)} A 客户问询` : "");
  return (
    <>
      <Dialog
        open={open && !complete}
        onOpenChange={onOpenChange}
        title="新建问询"
        description="先选目标电流与候选系列，再核对工程参数和敷设工况"
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
                  projects.refetch();
                  types.refetch();
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
            <Select label="所属工程" value={workspaceId || 'new-project'} onChange={value => { setWorkspaceId(value === 'new-project' ? '' : value); allocated.current = null; }}
              options={[{ value: 'new-project', label: '新建工程' }, ...projectOptions.map(project => ({ value: text(project.id), label: text(project.name) || '未命名工程' }))]} />
            {!workspaceId && <label className="text-field">工程名称<input ref={projectNameInput} value={projectName} onChange={event=>setProjectName(event.target.value)} maxLength={120} required placeholder="填写客户与项目名称" /></label>}
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
              <legend>候选型号范围 · 型号库已保存规格</legend>
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
                  · {formatNumber(numeric(optionalRecord(optionalRecord(items[0].payload).specification).u0_v)! / 1000, 1)}/{formatNumber(numeric(optionalRecord(optionalRecord(items[0].payload).specification).voltage_v)! / 1000, 1)} kV · {numeric(optionalRecord(optionalRecord(items[0].payload).specification).cores)} 芯 · {items.length} 个型号 · {areaRange(items)}
                  <SourceBadge kind="document" detail={text(items[0].source)} />
                </label>
              ))}
            </fieldset>
            {!ranges.size && (
              <EmptyState
                title="没有此范围的厂家候选"
                description="请先导入有来源的厂家候选规格。"
              />
            )}
            {/* 新建默认工况来自宿主 scenarios.CreateStudyWorkspace；已有工程沿用其保存模型。 */}
            <p className="muted">{candidates.length ? `已选 ${candidates.length} 个候选；方法为 IEC 60287。${workspaceId ? '沿用所选工程的敷设工况。' : '新建工程先采用单回直埋参考敷设。'}建立后在“输入”核对埋深、土壤和负荷，再运行。` : '请选择一个候选系列，再建立研究并补录结构参数。'}</p>
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
        <p className="muted">所属工程：{workspaceId ? text(projectOptions.find(project => project.id === workspaceId)?.name) || '所选工程' : '新建工程'}</p>
        <div className="demo-row">
          <Button
            size="compact"
            disabled={create.isPending || !reference.data}
            title={reference.isPending ? '正在读取相同候选的保存参考参数' : reference.data ? `来源：保存研究「${reference.data.title}」；需核对实际构造` : '没有相同候选的保存参考参数，请逐项填写'}
            onClick={() => {
              const next: Record<string, Given> = {};
              for (const field of fields) {
                const saved = optionalRecord(reference.data?.values[text(field.key)]);
                if (saved.value !== undefined)
                  next[text(field.key)] = {
                    value: String(saved.value),
                    source: "demo",
                    reference: `沿用保存研究「${reference.data?.title}」的参考参数；`+text(saved.reference),
                  };
              }
              setFieldError(undefined); setFailure('');
              setValues(next);
            }}
          >
            采用参考输入
          </Button>
          <SourceBadge
            kind="demo"
            detail={`来源：保存研究「${reference.data?.title || '尚未读取'}」。参考参数是工程假设，非厂家实测；须按客户工况核对，逐项出处可在下方展开。`}
          />
        </div>
        {reference.error && <p className="field-error" role="alert">参考参数读取失败；可逐项填写，或重新读取。</p>}
        <p className="muted">目标 {formatNumber(target)} A · {candidates.length} 个候选 · 尚缺 {fields.filter(field => !values[text(field.key)]?.value.trim()).length} 项</p>
        <div className="engineering-completion" ref={completionForm}>
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
            const display = declaredUnit(field.display);
            const scale = display?.scale ?? quantity.scale,
              unit = display?.unit ?? quantity.unit;
            const required = !field.optional || ['armour_gap_ratio','steel_relative_permeability'].includes(key) || key==='screen_longitudinal_r20' && values.screen_model?.value==='given_r20';
            const label = text(field.title)+(required?'（必填）':'');
            const minimum = numeric(field.min), maximum = numeric(field.max);
            const bound = (value:number) => formatNumber(value * scale, 3).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
            const bounds = [minimum === null ? '' : `${field.minExclusive ? '>' : '≥'} ${bound(minimum)} ${unit}`, maximum === null ? '' : `≤ ${bound(maximum)} ${unit}`].filter(Boolean).join('；');
            return (
              <section className="input-section" key={key} data-completion-key={key} data-field-path={'/parameters/values/'+key}>
                <Tooltip content={[bounds ? `范围：${bounds}` : '', text(field.hint)].filter(Boolean).join('。')}><button type="button" className="completion-help" aria-label={text(field.title)+'填写说明'}>?</button></Tooltip>
                {choices ? (
                  <Select
                    label={label}
                    error={fieldError?.key===key ? fieldError.message : undefined}
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
                    label={label}
                    error={fieldError?.key===key ? fieldError.message : undefined}
                    value={entry.value ? Number(entry.value) * scale : null}
                    unit={unit}
                    required={required}
                    minExclusive={field.minExclusive===true}
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
              </section>
            );
          })}
          <details className="completion-sources">
            <summary>查看与修改逐项出处</summary>
            {fields.map(field => {
              const key=text(field.key), entry=values[key] || {value:'',source:'user' as const,reference:''};
              return <section className="input-section" key={key} data-source-key={key}>
                <Select label={text(field.title)+'来源'} value={entry.source} disabled={create.isPending}
                  options={[{value:'user',label:'工程师给定'},{value:'manufacturer',label:'厂家'},{value:'measurement',label:'实测'},{value:'standard',label:'标准'},{value:'demo',label:'参考输入（需核对）'}]}
                  onChange={value=>edit(key,{source:value as Source['kind']})} />
                <label className="text-field">出处<input aria-label={text(field.title)+'出处'} value={entry.reference} disabled={create.isPending}
                  onChange={event=>edit(key,{reference:event.target.value})} /></label>
                {fieldError?.key===key && fieldError.source && <p className="field-error" role="alert">{fieldError.message}</p>}
              </section>;
            })}
          </details>
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
