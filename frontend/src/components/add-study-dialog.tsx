import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api, ApiError, message, numeric, optionalRecord, record, responseData, text } from "@/api/client";
import type { components } from "@/api/generated/schema";
import { exactContract, capabilityInputContracts } from "@/api/input-contracts";
import { studyIndex, type StudyDefinition } from "@/api/research";
import { methodCardsQuery } from '@/lib/study-queries';
import { displayName } from "@/lib/display-names";
import { rootModule, studyEntryTab } from "@/lib/study-config";
import { workspaceQuery } from "@/lib/study-queries";
import { Icon } from "./icon";
import { ErrorState, LoadingState } from "./states";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Select } from "./ui/select";
import { hostTasks } from './study-workbench-config';

type Method = components["schemas"]["Method"];
type Task = NonNullable<components["schemas"]["CreateStudy"]["task"]>;
type Choice = { id: string; task: Task; taskKey?: string; taskTitle?: string; method: Method; label: string; hpc: boolean; limitations?: string[] };

/** 载流量类任务按插件声明的输出判断；仿真任务由宿主的任务清单给出方法。 */
const AMPACITY_TASKS: [Task, string, string, string][] = hostTasks.map(row => [row.task, row.label, row.icon, row.output]);

/**
 * 在当前工程里新建研究：工程模型（敷设截面、电缆、工况）原样带入，只选任务、方法和名称。
 * 默认采用插件契约默认值；工程师可明确选择沿用本工程同方法的最近研究，并记录来源；
 * 建好后在右侧“方法”页按分组修改。缺必填参数时宿主会拒绝，界面如实显示原因。
 */
export function AddStudyDialog({ open, onOpenChange, theme, workspaceId, projectName, workspacePicker }: {
  open: boolean; onOpenChange: (open: boolean) => void; theme: "light" | "dark"; workspaceId: string; projectName: string; workspacePicker?:ReactNode;
}) {
  const navigate = useNavigate();
  const queries = useQueryClient();
  const [task, setTask] = useState<string>("rating");
  const [methodId, setMethodId] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [parameterSource, setParameterSource] = useState('defaults');
  const workspace = useQuery({ ...workspaceQuery(workspaceId), enabled: open });
  const methods = useQuery({ ...methodCardsQuery(), enabled: open });
  const studies = useQuery({ queryKey: ["study-index"], queryFn: ({ signal }) => studyIndex(signal), enabled: open });
  const simulation = useQuery({
    queryKey: ["study-tasks"],
    queryFn: async () => {
      const value = await responseData(api.GET("/api/study-tasks"));
      if (!Array.isArray(value)) throw new ApiError(502, "仿真任务清单不完整");
      return value.map((item) => record(item, "仿真任务"));
    },
    enabled: open,
  });

  const catalog = methods.data || [];
  const hpcOf = (pluginId: string) => text(optionalRecord(catalog.find((item) => text(optionalRecord(item.method).plugin_id) === pluginId)?.execution_policy).backend) === "slurm";
  const choices: Choice[] = [
    ...AMPACITY_TASKS.flatMap(([value, , , output]) => catalog.flatMap((item) => {
      const pin = optionalRecord(item.method);
      return (Array.isArray(item.capabilities) ? item.capabilities : []).map(optionalRecord)
        .filter((cap) => (Array.isArray(cap.outputs) ? cap.outputs : []).some((entry) => optionalRecord(entry).key === output) &&
          cap.analysis !== "crosscheck" && cap.input_schema === "cablesim.domain/1" &&
          (!Array.isArray(cap.study_tasks) || !cap.study_tasks.length || cap.study_tasks.includes(value)) &&
          pin.plugin_id !== 'cablesim.hybrid-rating' && !text(cap.id).includes('benchmark') && item.platform_supported !== false)
        .map((cap) => ({
          id: `${value}:${text(pin.plugin_id)}:${text(cap.id)}`, task: value,
          // Correction is a distinct question while reusing the host's rating
          // workflow. Its displayed task title comes from the capability.
          taskKey: cap.analysis === 'ampacity_correction' ? `${text(pin.plugin_id)}:${text(cap.id)}` : value,
          taskTitle: cap.analysis === 'ampacity_correction' ? text(cap.title) : undefined,
          limitations: cap.analysis === 'ampacity_correction' && Array.isArray(cap.limitations) ? cap.limitations.map(text) : undefined,
          method: { ...pin, capability: text(cap.id) } as Method,
          label: `${text(item.name)} · ${text(cap.title).replace(/\s*[（(][^（）()]*[）)]\s*$/, "")} ${text(pin.version)}`,
          hpc: hpcOf(text(pin.plugin_id)),
        }));
    })),
    ...(simulation.data || []).map((item) => {
      const pin = optionalRecord(item.method);
      return { id: `${text(item.task)}:${text(pin.plugin_id)}:${text(pin.capability)}`, task: text(item.task) as Task, method: pin as Method,
        label: `${text(catalog.find((entry) => text(optionalRecord(entry.method).plugin_id) === text(pin.plugin_id))?.name) || text(pin.plugin_id)} ${text(pin.version)}`, hpc: hpcOf(text(pin.plugin_id)) };
    }),
  ];
  const tasks: [string, string, string][] = [
    ...AMPACITY_TASKS.filter(([value]) => choices.some((choice) => choice.task === value)).map(([value, label, icon]) => [value, label, icon] as [Task, string, string]),
    ...(simulation.data || []).map((item) => [text(item.task) as Task, text(item.label), "nav/simulation"] as [Task, string, string]),
    ...choices.filter(choice => choice.taskTitle).map(choice => [choice.taskKey!,choice.taskTitle!,"nav/study"] as [string,string,string]),
  ];
  const options = choices.filter((choice) => (choice.taskKey || choice.task) === task).sort((a,b) => Number(b.method.plugin_id === 'cablesim.iec60287') - Number(a.method.plugin_id === 'cablesim.iec60287'));
  const chosen = options.find((choice) => choice.id === methodId) || options[0];

  // 同方法仅用于工程师主动选择沿用；不把旧研究边界冒充当前插件默认值。
  const same = (studies.data || []).filter((row) => row.workspace === workspaceId && chosen &&
    row.definition.method?.plugin_id === chosen.method.plugin_id && row.definition.method?.capability === chosen.method.capability)
    .sort((a, b) => b.updated.localeCompare(a.updated))[0];
  const inherit = parameterSource === 'recent' && !!same;
  const origin = inherit ? `沿用本工程研究「${same.title}」已保存的方法参数（包含显式边界）` : "采用当前插件契约声明的默认值";

  const create = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!title.trim()) throw new ApiError(422, "请填写研究名称");
      if (!chosen) throw new ApiError(422, "所选任务没有可用方法");
      const revision = numeric(workspace.data?.revision);
      if (revision === null) throw new ApiError(409, "工程修订不可用，请刷新后重试");
      let parameters: Record<string, unknown> = inherit ? structuredClone(optionalRecord(same.definition.parameters)) : {};
      if (!inherit) {
        const schema = optionalRecord(exactContract(await capabilityInputContracts(chosen.method), chosen.method).parameter_schema);
        parameters = Object.fromEntries(Object.entries(optionalRecord(schema.properties)).flatMap(([key, value]) => "default" in optionalRecord(value) ? [[key, optionalRecord(value).default]] : []));
      }
      const body: components["schemas"]["CreateStudy"] = {
        title: title.trim(), task: chosen.task, expected_revision: revision, method: chosen.method, input_source: "domain",
        parameters: parameters as components["schemas"]["CreateStudy"]["parameters"], driver: { kind: "single" },
        input_sources: {
          "/title": { kind: "user", reference: "工程师填写研究名称", reviewed: false },
          "/parameters": { kind: "derived", reference: origin, reviewed: false },
        },
      };
      const saved = record(await responseData(api.POST("/api/workspaces/{wid}/studies", { params: { path: { wid: workspaceId } }, body })), "新研究");
      return { sid: text(saved.id), module: rootModule(body as unknown as StudyDefinition) };
    },
    onSuccess: async ({ sid, module }) => {
      await Promise.all([queries.invalidateQueries({ queryKey: ["study-index"] }), queries.invalidateQueries({ queryKey: ["workspace", workspaceId] })]);
      onOpenChange(false);
      setTitle("");
      await navigate({ to: "/studies/$sid/$module/$tab", params: { sid, module, tab: studyEntryTab(module) }, search: { workspace: workspaceId, theme, run: "", delivery: "", inspector: "method" } });
    },
    onError: (problem) => {
      // 宿主按方法契约逐项拒绝缺失的必填参数；翻成中文并说明为什么没有默认值
      const missing = [...message(problem).matchAll(/parameters\.([\w.]+)：Field required/g)].map((match) => displayName(match[1]));
      setError(missing.length ? `请补齐没有插件默认值的参数：${missing.join("、")}；可选择沿用已保存的同方法研究参数。` : message(problem));
    },
  });

  const loading = workspace.isPending || methods.isPending || studies.isPending;
  const failure = workspace.error || methods.error || studies.error;
  return <Dialog open={open} onOpenChange={(value) => { if (!create.isPending) { onOpenChange(value); setError(""); } }}
    title="新建研究" description={`在「${projectName}」中提出一个新问题；工程模型自动带入。`} initialFocus="form"
    actions={<Button variant="primary" loading={create.isPending} disabled={loading || !!failure || !chosen} onClick={() => { setError(""); create.mutate(); }}>建立研究</Button>}>
    {loading ? <LoadingState title="正在读取工程与方法" />
      : failure ? <ErrorState description={message(failure)} />
        : <form className="create-study-form add-study-form" onSubmit={(event) => { event.preventDefault(); setError(""); create.mutate(); }}>
          {workspacePicker}
          <label className="text-field">研究名称<input value={title} maxLength={120} aria-invalid={!!error && !title.trim()} placeholder="如：排管段 · 夏季高温工况" onChange={(event) => setTitle(event.target.value)} /></label>
          <fieldset className="task-choices">
            <legend>要回答的问题</legend>
            {tasks.map(([value, label, icon]) => <button key={value} type="button" aria-pressed={task === value} onClick={() => { setTask(value); setMethodId(""); setError(""); }}>
              <Icon name={icon} /><span>{label}</span>
            </button>)}
            {simulation.isError && <p className="muted">仿真任务清单读取失败：{message(simulation.error)}</p>}
          </fieldset>
          {options.length > 1 ? <Select label="计算方法" value={chosen?.id} onChange={setMethodId} options={options.map((choice) => ({ value: choice.id, label: `${choice.label} · ${choice.hpc ? "超算" : "本机"}` }))} />
            : chosen && <p className="add-study-method"><span className="muted">计算方法</span>{chosen.label} · {chosen.hpc ? "超算" : "本机"}</p>}
          {chosen && <><Select label="方法参数来源" value={inherit ? 'recent' : 'defaults'} onChange={setParameterSource}
            options={[{value:'defaults',label:'插件默认值'},...(same ? [{value:'recent',label:`沿用最近研究 · ${same.title}`}] : [])]} />
            <p className="muted">{origin}；旧研究与运行保持原值。</p></>}
          {!!chosen?.limitations?.length && <section aria-label="方法适用范围"><h4>先核对基准与敷设条件</h4>
            {chosen.limitations.map((limit,index)=><p key={index}>{limit}</p>)}
          </section>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <button type="submit" className="visually-hidden" tabIndex={-1} aria-hidden="true">建立研究</button>
        </form>}
  </Dialog>;
}
