import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  api,
  record,
  optionalRecord,
  text,
  numeric,
  responseData,
  message,
  ApiError,
} from "@/api/client";
import { modelVersions } from "@/api/research";
import { methodCardsQuery } from '@/lib/study-queries';
import type { components } from "@/api/generated/schema";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
import { NumberField } from "./ui/number-field";
import { LoadingState, ErrorState, EmptyState } from "./states";
import { SourceBadge } from "./source-badge";
import { sourceKind } from "@/lib/selection-view";
import { modelArtifacts } from "@/api/model-artifacts";
import { capabilityInputContracts, inputContractQuery, exactContract } from "@/api/input-contracts";
import { CreateInquiryDialog } from "./create-inquiry-dialog";
import { AddStudyDialog } from './add-study-dialog';
import { MethodParameterFields } from './method-parameter-fields';
import { SolverLocation } from './solver-location';
import type { SolverCapability } from '@/lib/solver-location';
import { committedParameter, type ParameterDraft } from '@/lib/study-config';
import { declaredParameterDefaults, focusParameterField, parameterErrors, parameterReferences, setParameterValue } from '@/lib/study-parameter-form';
import { entityLabel, type DomainDocument } from '@/lib/domain-fields';

export function CreateStudyDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: "light" | "dark";
  initialTask?: string;
  /** A real creation-options resource ID; this entry always creates a new project. */
  initialModelId?: string;
}) {
  const [task, setTask] = useState(props.initialTask || "operating");
  useEffect(() => { if (props.open) setTask(props.initialTask || 'operating'); }, [props.open, props.initialTask]);
  const [workspaceId,setWorkspaceId]=useState('');
  const workspaces=useQuery({queryKey:['workspaces'],queryFn:async()=>responseData(api.GET('/api/workspaces')),enabled:props.open});
  const projects=(Array.isArray(workspaces.data)?workspaces.data:[]).map(optionalRecord);
  const selected=projects.find(item=>text(item.id)===workspaceId);
  const picker=<Select label="所属工程" value={workspaceId || 'new-project'} onChange={value=>setWorkspaceId(value==='new-project'?'':value)} options={[{value:'new-project',label:'新建工程'},...projects.map(item=>({value:text(item.id),label:text(item.name)||text(item.title)||text(optionalRecord(item.design).title)||'工程'}))]} />;
  if(selected && !props.initialModelId)return <AddStudyDialog {...props} key={workspaceId} workspaceId={workspaceId} projectName={text(selected.name)||text(selected.title)||text(optionalRecord(selected.design).title)||'工程'} workspacePicker={picker} />;
  return task === "selection" ? (
    <CreateInquiryDialog
      {...props}
      onOpenChange={(value) => {
        props.onOpenChange(value);
        if (!value) setTask(props.initialTask || "operating");
      }}
      onOtherTask={setTask}
    />
  ) : (
    <GenericCreateStudyDialog
      {...props}
      key={task}
      initialTask={task}
      workspacePicker={props.initialModelId ? undefined : picker}
      onInquiry={() => setTask("selection")}
      onOpenChange={(value) => {
        props.onOpenChange(value);
        if (!value) setTask(props.initialTask || "operating");
      }}
    />
  );
}
function GenericCreateStudyDialog({
  open,
  onOpenChange,
  theme,
  initialTask,
  onInquiry,
  workspacePicker,
  initialModelId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: "light" | "dark";
  initialTask: string;
  onInquiry: () => void;
  workspacePicker?:ReactNode;
  initialModelId?:string;
}) {
  const navigate = useNavigate();
  const queries = useQueryClient();
  const [task, setTask] = useState(initialTask);
  const [modelId, setModelId] = useState(initialModelId || '');
  useEffect(()=>{if(open && initialModelId)setModelId(initialModelId);},[open,initialModelId]);
  const [methodId, setMethodId] = useState("");
  const [trainedModelId, setTrainedModelId] = useState("");
  const trainedModels = useQuery({
    queryKey: ["model-artifacts"],
    queryFn: ({ signal }) => modelArtifacts(signal),
    enabled: open && task === "hybrid",
  });
  const trainedModel = trainedModels.data?.find(
    (item) => item.id === trainedModelId && item.availability === "available",
  );
  const [title, setTitle] = useState("");
  const [projectName, setProjectName] = useState("");
  const [target, setTarget] = useState<number | null>(null);
  const [error, setError] = useState("");
  const allocated = useRef<Record<string, unknown> | null>(null);
  const installedTemplate = useRef("");
  const pending = useRef(false);
  const form=useRef<HTMLFormElement>(null), firstError=useRef<string | undefined>(undefined);
  const [nativeWorkspace,setNativeWorkspace]=useState<Record<string,unknown> | null>(null);
  const [nativeDraftFields,setNativeDraftFields]=useState<Record<string,ParameterDraft>>({});
  const [nativeErrors,setNativeErrors]=useState<Record<string,string>>({});
  const models = useQuery({
    queryKey: ["model-versions"],
    queryFn: ({ signal }) => modelVersions(signal),
    enabled: open,
  });
  const methods = useQuery({
    ...methodCardsQuery(),
    enabled: open,
  });
  const tasks = useQuery({
    queryKey: ["study-tasks"],
    queryFn: async () => {
      const value = await responseData(api.GET("/api/study-tasks"));
      if (!Array.isArray(value)) throw new ApiError(502, "仿真任务清单不完整");
      return value.map((item) => record(item, "仿真任务"));
    },
    enabled: open,
  });
  const nativeTask = tasks.data?.find((item) => item.task === task);
  const nativeRequested = [
    "transient-temperature",
    "sheath-losses",
    "electrothermal-steady",
  ].includes(task);
  const [nativeParameters, setNativeParameters] = useState<Record<string,unknown>>({});
  const model = models.data?.find((item) => text(item.id) === modelId);
  const choices = (methods.data || []).flatMap((item) => {
    const pin = optionalRecord(item.method);
    return (Array.isArray(item.capabilities) ? item.capabilities : []).flatMap(
      (value) => {
        const capability = optionalRecord(value);
        const outputs = Array.isArray(capability.outputs)
          ? capability.outputs
          : [];
        const suitable = nativeRequested
          ? !!nativeTask &&
            text(capability.id) === task &&
            text(pin.plugin_id) ===
              text(optionalRecord(nativeTask.method).plugin_id)
          : (task === "operating"
              ? outputs.some(
                  (output) =>
                    optionalRecord(output).key === "conductor_temperature",
                )
              : outputs.some(
                  (output) => optionalRecord(output).key === "ampacity",
                )) &&
            capability.analysis !== "crosscheck" &&
            capability.input_schema === "cablesim.domain/1" &&
            pin.plugin_id !== "cablesim.hybrid-rating" &&
            item.platform_supported !== false;
        return suitable
          ? [
              {
                id: `${text(pin.plugin_id)}:${text(capability.id)}`,
                label: `${text(item.name)} · ${text(capability.title)} · ${text(pin.version)}`,
                method: {
                  ...pin,
                  capability: text(capability.id),
                } as components["schemas"]["Method"],
                capability:capability as SolverCapability,
              },
            ]
          : [];
      },
    );
  });
  const chosen = choices.find((item) => item.id === methodId);
  const contracts = useQuery({
    ...inputContractQuery(chosen?.method || optionalRecord(nativeTask?.method) as components['schemas']['Method']),
    enabled: open && nativeRequested && !!chosen,
  });
  const nativeContract=nativeRequested && chosen ? contracts.data : undefined;
  useEffect(()=>{
    if(nativeRequested && nativeContract){setNativeParameters(declaredParameterDefaults(nativeContract.parameter_schema));setNativeDraftFields({});setNativeErrors({});}
  },[nativeRequested,nativeContract]);
  const nativeDomain=nativeWorkspace?.domain as DomainDocument | undefined;
  const references=useMemo(()=>nativeDomain ? parameterReferences(nativeDomain,id=>entityLabel(nativeDomain,id)) : {},[nativeDomain]);
  const allocateNative=useMutation({retry:false,mutationFn:async()=>{
    if(!title.trim())throw new ApiError(422,'请填写研究名称');
    if(!projectName.trim())throw new ApiError(422,'请填写工程名称');
    if(!model || !chosen)throw new ApiError(422,'请选择准确型号版本和计算方法');
    if(!optionalRecord(model.payload).cable_type)throw new ApiError(422,'该型号缺少工程参数，请先完成型号工程输入。');
    if(!nativeContract?.input_sources.includes('domain'))throw new ApiError(422,'所选方法的领域输入契约尚不可用，请重新读取。');
    if(!allocated.current)allocated.current=record(await responseData(api.POST('/api/design/study-workspaces',{body:{model_id:text(model.id),content_sha256:text(model.content_sha256),project_name:projectName.trim()}})),'新工程');
    const workspace=allocated.current;
    if(!text(workspace.id) || numeric(workspace.revision)===null || !optionalRecord(workspace.domain).schema_version)throw new ApiError(502,'新工程未返回有效的模型与修订，请从工程列表重新打开。');
    setNativeWorkspace(workspace);
    await queries.invalidateQueries({queryKey:['workspaces']});
  }});
  const mutation = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!task) throw new ApiError(422, "请选择研究任务");
      if (nativeRequested && !nativeTask)
        throw new ApiError(
          503,
          tasks.error ? message(tasks.error) : "正式宿主尚未提供所选仿真任务",
        );
      if (!title.trim()) throw new ApiError(422, "请填写研究名称");
      if (task !== 'hybrid' && !projectName.trim()) throw new ApiError(422, '请填写工程名称');
      if (task === "hybrid") {
        if (!trainedModel) throw new ApiError(422, "请选择可用的准确模型版本");
        if (!allocated.current)
          allocated.current = record(
            await responseData(api.POST("/api/workspaces", { body: {} })),
            "新研究工程",
          );
        let workspace = allocated.current;
        const wid = text(workspace.id);
        if (!optionalRecord(workspace.domain).schema_version) {
          await responseData(
            api.POST("/api/workspaces/{wid}/domain/conversion", {
              params: { path: { wid } },
              body: { expected_revision: numeric(workspace.revision)! },
            }),
          );
          workspace = record(
            await responseData(
              api.GET("/api/workspaces/{wid}", { params: { path: { wid } } }),
            ),
            "工程",
          );
          allocated.current = workspace;
        }
        if (installedTemplate.current !== trainedModel.id) {
          await responseData(
            api.PUT("/api/workspaces/{wid}/domain", {
              params: { path: { wid } },
              body: {
                expected_revision: numeric(workspace.revision)!,
                document: trainedModel.input,
              },
            }),
          );
          installedTemplate.current = trainedModel.id;
          workspace = record(
            await responseData(
              api.GET("/api/workspaces/{wid}", { params: { path: { wid } } }),
            ),
            "工程",
          );
          allocated.current = workspace;
        }
        const body: components["schemas"]["CreateStudy"] = {
          title: title.trim(),
          task: "rating",
          expected_revision: numeric(workspace.revision)!,
          method: trainedModel.method,
          input_source: "domain",
          parameters: trainedModel.parameters,
          driver: { kind: "single" },
          input_sources: {
            "/title": {
              kind: "user",
              reference: "工程师选择混合参考模型并填写研究名称",
              reviewed: false,
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
          "混合研究",
        );
        return { wid, sid: text(saved.id), module: "hybrid" };
      }
      if (!model || !chosen)
        throw new ApiError(422, "请选择准确型号版本和可用方法");
      if (task === "selection" && (target === null || target <= 0))
        throw new ApiError(422, "请填写大于 0 A 的目标电流");
      if (task === "selection" && !text(model.id).startsWith("candidate:"))
        throw new ApiError(
          422,
          "问询选型须引用型号库候选；系统结构演示不能作为工程候选。",
        );
      if (!optionalRecord(model.payload).cable_type)
        throw new ApiError(
          422,
          "该厂家型号尚缺工程参数；请先完成型号工程输入。",
        );
      const defaults = optionalRecord(model.method_defaults);
      const contract = exactContract(await capabilityInputContracts(chosen.method), chosen.method);
      if (!contract.input_sources.includes("domain"))
        throw new ApiError(422, "所选方法不接受领域工程输入");
      let parameters = optionalRecord(defaults[chosen.method.plugin_id]);
      if (nativeRequested) {
        if(!nativeWorkspace)throw new ApiError(422,'请先建立工程，再选择其真实对象并填写仿真参数。');
        parameters=nativeParameters;
        for(const field of Object.values(nativeDraftFields))try{parameters=setParameterValue(parameters,field.path,committedParameter(field));}catch(problem){firstError.current=field.path;setNativeErrors({[field.path]:message(problem)});throw problem;}
        const problems=parameterErrors(contract.parameter_schema,parameters);setNativeErrors(problems);
        if(Object.keys(problems).length){firstError.current=Object.keys(problems)[0];throw new ApiError(422,'请补齐方法输入：'+Object.values(problems).slice(0,3).join('；'));}
      }
      if (!allocated.current)
        allocated.current = record(
          await responseData(
            api.POST("/api/design/study-workspaces", {
              body: {
                model_id: text(model.id),
                content_sha256: text(model.content_sha256),
                project_name: projectName.trim(),
                ...(task === "selection" ? { target_current_a: target! } : {}),
              },
            }),
          ),
          "新工程",
        );
      const workspace = allocated.current;
      const wid = text(workspace.id),
        revision = numeric(workspace.revision);
      if (!wid || revision === null)
        throw new ApiError(502, "新工程缺少有效身份和修订");
      const driver: components["schemas"]["Driver"] =
        task === "selection"
          ? {
              kind: "selection",
              candidate_ids: [text(model.id).replace(/^candidate:/, "")],
              minimum: target!,
              target_unit: "A",
              allow_demo_candidates: false,
            }
          : { kind: "single" };
      const body: components["schemas"]["CreateStudy"] = {
        title: title.trim(),
        task: nativeTask
          ? (task as
              | "transient-temperature"
              | "sheath-losses"
              | "electrothermal-steady")
          : task === "operating"
            ? "operating"
            : task === "selection"
              ? "target"
              : "rating",
        expected_revision: revision,
        method: chosen.method,
        input_source: "domain",
        parameters,
        driver,
        input_sources: {
          ...(nativeRequested
            ? {
                "/parameters": {
                  kind: "user" as const,
                  reference: "工程师按所选方法契约填写 SI 参数",
                  reviewed: false,
                },
              }
            : {}),
          "/title": {
            kind: "user",
            reference: "工程师填写研究名称",
            reviewed: false,
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
        "新研究",
      );
      return {
        wid,
        sid: text(saved.id),
        module: nativeTask
          ? (
              {
                "transient-temperature": "transient",
                "sheath-losses": "sheath-losses",
                "electrothermal-steady": "electrothermal",
              } as Record<string, string>
            )[task]
          : task === "selection"
            ? "selection"
            : "ampacity",
      };
    },
    onSuccess: async ({ wid, sid, module }) => {
      // This path creates a project as well as its first study. Refresh the
      // real project index before navigating so the current project and its
      // study count appear together in the persistent sidebar.
      await Promise.all([
        queries.invalidateQueries({ queryKey: ["workspace-index"], exact: true }),
        queries.invalidateQueries({ queryKey: ["study-index"] }),
        // The picker closes below; let its next opening read the new project.
        queries.invalidateQueries({ queryKey: ["workspaces"], exact: true, refetchType: "none" }),
      ]);
      allocated.current = null;
      installedTemplate.current = "";
      onOpenChange(false);
      await navigate({
        to: "/studies/$sid/$module/$tab",
        params: { sid, module, tab: "results" },
        search: { workspace: wid, theme, run: "", delivery: "" },
      });
    },
  });
  useEffect(() => {
    if (!open || !error || mutation.isPending || allocateNative.isPending) return;
    const frame = requestAnimationFrame(() => focusParameterField(form.current, firstError.current));
    return () => cancelAnimationFrame(frame);
  }, [open, error, mutation.isPending, allocateNative.isPending]);
  async function submit() {
    if (pending.current) return;
    pending.current = true;
    setError("");
    firstError.current=undefined;
    try {
      if(nativeRequested && !nativeWorkspace)await allocateNative.mutateAsync();
      else await mutation.mutateAsync();
    } catch (problem) {
      setError(message(problem));
    } finally {
      pending.current = false;
    }
  }
  const loading = models.isPending || methods.isPending;
  const catalogError =
    models.error || methods.error || (nativeRequested && tasks.error);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending.current) {
          onOpenChange(value);
          if (!value) {
            setError("");
            allocated.current = null;
            setNativeWorkspace(null);
            installedTemplate.current = "";
          }
        }
      }}
      title="新建研究"
      description="选择任务、型号版本和计算方法。"
      initialFocus="form"
      actions={
        <Button
          variant="primary"
          loading={mutation.isPending || allocateNative.isPending}
          disabled={
            task === "hybrid"
              ? trainedModels.isPending || !trainedModel
              : loading ||
                !!catalogError ||
                !models.data?.length ||
                !choices.length || nativeRequested && (contracts.isPending || !!contracts.error)
          }
          onClick={submit}
        >
          {nativeRequested && !nativeWorkspace ? '建立工程并配置仿真' : '建立研究'}
        </Button>
      }
    >
      {loading ? (
        <LoadingState title="正在读取型号与方法" />
      ) : catalogError ? (
        <ErrorState
          description={message(catalogError)}
          action={
            <Button
              onClick={() => {
                models.refetch();
                methods.refetch();
              }}
            >
              重新读取
            </Button>
          }
        />
      ) : !models.data?.length || !methods.data?.length ? (
        <EmptyState
          title="无可用型号或方法"
          description="请先安装适用方法并提供型号版本。"
        />
      ) : (
        <form
          ref={form}
          className="create-study-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {workspacePicker}
          {!!allocated.current && <p className="muted">工程已建立，工程名称、型号与任务已固定{nativeWorkspace ? '，计算方法也已固定' : ''}；重试会在同一工程继续创建研究。</p>}
          {task !== 'hybrid' && <label className="text-field">
            工程名称
            <input value={projectName} maxLength={120} required disabled={!!allocated.current}
              aria-invalid={!!error && !projectName.trim()}
              onChange={event => { setProjectName(event.target.value); setError(''); }} />
          </label>}
          <Select
            label="研究任务"
            value={task || undefined}
            onChange={(value) => {
              if (value === "selection") {
                onInquiry();
                return;
              }
              setTask(value);
              setMethodId("");
              setNativeParameters({});setNativeDraftFields({});setNativeErrors({});
              setError("");
            }}
            disabled={!!allocated.current}
            options={[
              { value: "selection", label: "客户问询选型" },
              { value: "rating", label: "额定载流量" },
              { value: "operating", label: "运行温度" },
              { value: "hybrid", label: "混合载流量参考研究" },
              ...[
                { value: "transient-temperature", label: "暂态温升" },
                { value: "sheath-losses", label: "护套损耗" },
                { value: "electrothermal-steady", label: "电热耦合" },
              ].map((item) => ({
                ...item,
                label:
                  text(
                    tasks.data?.find((value) => value.task === item.value)
                      ?.label,
                  ) || item.label,
              })),
            ]}
          />
          {task !== "hybrid" && task && !choices.length && (
            <ErrorState
              title="所选任务没有可用方法"
              description={
                nativeRequested && !nativeTask
                  ? "正式宿主尚未提供所选仿真任务。"
                  : "请检查已安装方法的声明范围。"
              }
            />
          )}
          <label className="text-field">
            研究名称
            <input
              value={title}
              maxLength={120}
              aria-invalid={!!error && !title.trim()}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {task === "hybrid" ? (
            trainedModels.isPending ? (
              <LoadingState title="正在读取模型版本" />
            ) : trainedModels.error ? (
              <ErrorState
                description={message(trainedModels.error)}
                action={
                  <Button onClick={() => trainedModels.refetch()}>
                    重新读取
                  </Button>
                }
              />
            ) : !trainedModels.data?.some(
                (item) => item.availability === "available",
              ) ? (
              <EmptyState
                title="尚无已安装模型"
                description="生成并验证训练模型后，可在此建立参考研究。"
              />
            ) : (
              <>
                <Select
                  label="引用训练模型"
                  value={trainedModelId || undefined}
                  onChange={setTrainedModelId}
                  disabled={!!allocated.current}
                  options={trainedModels.data
                    .filter((item) => item.availability === "available")
                    .map((item) => ({
                      value: item.id,
                      label: `${item.name} · ${item.version}`,
                    }))}
                />
                <span className="muted">
                  研究结构与训练适用域绑定，仅用于参考。
                </span>
              </>
            )
          ) : (
            <>
              <Select
                label="引用型号版本"
                value={modelId || undefined}
                onChange={(value) => {
                  setModelId(value);
                  setError("");
                }}
                disabled={!!allocated.current || !!initialModelId}
                options={(models.data || []).map((item) => ({
                  value: text(item.id),
                  label: `${text(item.name)} · ${text(item.version)}${item.state === "incomplete" ? " · 工程参数缺项" : ""}`,
                }))}
              />
              <div className="source-line">
                <Button type="button" size="compact" disabled={!!allocated.current || !!initialModelId} title={initialModelId ? '本入口已明确引用固定型号版本；关闭后可从型号库新建型号' : allocated.current ? '工程已建立，正在使用已选型号继续创建研究' : undefined} onClick={() => {
                  onOpenChange(false);
                  void navigate({to:'/types',search:{theme,create:true}});
                }}>新建型号</Button>
                <span className="muted">保存型号后，可在型号工作区“建立研究”。</span>
              </div>
              {model && (
                <div className="source-line">
                  {sourceKind(
                    optionalRecord(optionalRecord(model.payload).sources)
                      .factory,
                  ) && (
                    <SourceBadge
                      kind={sourceKind(
                        optionalRecord(optionalRecord(model.payload).sources)
                          .factory,
                      )!}
                      detail={text(model.source)}
                    />
                  )}
                  <span className="muted">
                    {model.state === "demo"
                      ? "结构模板，尚未形成厂家工程型号"
                      : model.state === "incomplete"
                        ? "型号规格已引用，工程参数尚未补齐"
                        : "固定型号版本"}
                  </span>
                </div>
              )}
              <Select
                label="计算方法"
                value={methodId || undefined}
                onChange={setMethodId}
                disabled={!!nativeWorkspace}
                options={choices.map((item) => ({
                  value: item.id,
                  label: item.label,
                }))}
              />
            </>
          )}
          {task === "selection" && (
            <NumberField
              label="目标电流"
              value={target}
              onCommit={setTarget}
              unit="A"
              min={0.001}
              required
              source="user"
            />
          )}
          {nativeRequested && methodId && (
            <div className="parameter-form">
              {contracts.isPending ? (
                <LoadingState title="正在读取方法参数契约" />
              ) : contracts.error ? (
                <ErrorState description={message(contracts.error)} />
              ) : !nativeContract ? (
                <ErrorState description="所选方法版本没有匹配的参数契约。" />
              ) : (
                <>{chosen && <SolverLocation pluginId={chosen.method.plugin_id} capability={chosen.capability} />}
                  {!nativeWorkspace ? <p className="muted">先建立工程，再从真实敷设截面、负荷和电缆中选择对象。仅采用插件明确声明的默认值，其余物理输入由工程师填写。</p>
                    : <><p className="muted">工程已建立。请逐项填写方法输入；缺项会指出位置。关闭后，工程仍可从工程列表继续使用。</p><MethodParameterFields method={chosen!.method} namespace="new-simulation" values={nativeParameters} references={references} fieldErrors={nativeErrors} draftFields={nativeDraftFields} readOnly={mutation.isPending}
                      onDraftChange={(field,key)=>setNativeDraftFields(current=>{const next={...current};if(field)next[key]=field;else delete next[key];return next;})}
                      onChange={(path,value)=>{setNativeParameters(current=>setParameterValue(current,path,value));setNativeErrors(current=>Object.fromEntries(Object.entries(current).filter(([key])=>key!==path && !key.startsWith(path+'/'))));setError('');}} /></>}
                </>
              )}
            </div>
          )}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
          >
            建立研究
          </button>
        </form>
      )}
    </Dialog>
  );
}
