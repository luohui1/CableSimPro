import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  api,
  record,
  responseData,
  text,
  numeric,
  ApiError,
  optionalRecord,
  message,
} from "@/api/client";
import { moduleConfiguration } from "./study-method-form";
import { useStudy } from "./study-provider";
import { Button } from "./ui/button";
import { PreflightDialog, needsScopeConfirmation } from "./preflight-dialog";
import { modelVersions } from "@/api/research";
import { displayName } from "@/lib/display-names";
import { missingInputDestination, matchingFieldPath } from "@/lib/missing-input";
import type { components } from "@/api/generated/schema";
import { ErrorState } from "./states";
import { inputContracts, exactContract } from '@/api/input-contracts';
import { preflightFieldLabel, readablePreflight } from '@/features/field/preflight-labels';
import { hpcJson } from '@/features/field/run-label';
import { SolverLocation } from './solver-location';
import type { SolverCapability } from '@/lib/solver-location';
import { STATUS_WORDS } from '@/lib/status-vocabulary';

export function StudyRunControl({
  module,
  onResult,
  autoPreflight = false,
  onPreflightConsumed,
  onMissing,
  secondary = false,
  currentInput,
  label = '预检并运行',
}: {
  module: string;
  onResult: (id: string, module: string) => void;
  autoPreflight?: boolean;
  onPreflightConsumed?: () => void;
  onMissing?: (field: string) => void;
  secondary?: boolean;
  currentInput?: string;
  label?: string;
}) {
  const context = useStudy();
  const [open, setOpen] = useState(false),
    [ack, setAck] = useState(false);
  const [inputCheck, setInputCheck] = useState<Record<string, unknown>>();
  const request = useRef("");
  const accepted = useRef<{
    wid: string;
    sid: string;
    revision: number;
    studyRevision: number;
    module?: string;
    lock: string;
  } | null>(null);
  const configuration = moduleConfiguration(context.study.definition, module);
  const availability = useQuery({ queryKey: ['simulation-availability', context.study.id, module], enabled: !!configuration, retry: false,
    queryFn: ({signal}) => hpcJson(`/workspaces/${context.study.workspace}/studies/${context.study.id}/availability?` +
      new URLSearchParams(context.study.definition.modules?.[module] ? {module} : {}), {signal}) });
  const remoteOnly = availability.data?.location === 'slurm';
  const solver = availability.data?.solver;
  const capability = solver === 'slurm' || solver === 'local' || solver === 'either'
    ? { id: configuration?.method.capability || '', solver } satisfies SolverCapability : undefined;
  const contracts = useQuery({ queryKey: ['input-contracts'], queryFn: ({signal}) => inputContracts(signal), enabled: open });
  let parameterSchema: Record<string, unknown> = {};
  try { if (configuration && contracts.data) parameterSchema = exactContract(contracts.data, configuration.method).parameter_schema; } catch { /* Preserve preflight's version diagnosis. */ }
  const activeRun = context.runs.some(item => ["accepted", "queued", "running", "validating"].includes(text(item.status)) && (!item.module || item.module === module));
  const requestKey = `cablesim.pending-run:${context.study.workspace}:${context.study.id}:${module}`;
  const submitGuard = useRef(false);
  const focusTimer = useRef<number | undefined>(undefined);
  const models = useQuery({ queryKey: ["model-versions"], queryFn: ({ signal }) => modelVersions(signal), enabled: open && configuration?.driver?.kind === "selection" });
  const configuredModule = context.study.definition.modules?.[module]
    ? module
    : undefined;
  const preflight = useMutation({
    retry: false,
    mutationFn: async () => {
      setInputCheck(undefined);
      if (context.dirty)
        throw new ApiError(409, "请先保存输入和研究配置，再预检");
      if (!configuration) throw new ApiError(422, "该模块没有保存的方法配置");
      const source = {
        wid: context.study.workspace,
        sid: context.study.id,
        revision: numeric(context.workspace.revision)!,
        studyRevision: context.study.revision,
        module: configuredModule,
      };
      accepted.current = null;
      // Input validation remains usable even when connection settings cannot be read.
      const local = await hpcJson(`/workspaces/${source.wid}/studies/${source.sid}/input-preflight?` + new URLSearchParams({
          expected_revision: String(source.revision), expected_study_revision: String(source.studyRevision),
          ...(source.module ? { module: source.module } : {}),
        }));
      setInputCheck(local);
      const remote = await availability.refetch();
      if (remote.data?.conflict) throw new ApiError(409, '超算路由与能力声明冲突，请由管理员修正配置后重新预检。输入已保存。');
      if (remote.error || !remote.data || (remote.data.location === 'slurm' &&
          (local.input_ready !== true || remote.data.configured !== true))) return local;
      const value = record(
        await responseData(
          api.GET("/api/workspaces/{wid}/studies/{sid}/preflight", {
            params: {
              path: { wid: source.wid, sid: source.sid },
              query: {
                expected_revision: source.revision,
                expected_study_revision: source.studyRevision,
                ...(source.module ? { module: source.module } : {}),
              },
            },
          }),
        ),
        "研究预检",
      );
      accepted.current = { ...source, lock: text(value.lock_digest) };
      let previous: Record<string, unknown> = {};
      try { previous = optionalRecord(JSON.parse(sessionStorage.getItem(requestKey) || "{}")); } catch { /* Storage is optional; the server remains authoritative. */ }
      request.current = previous.lock === accepted.current.lock && typeof previous.id === "string" ? previous.id : crypto.randomUUID();
      try { sessionStorage.setItem(requestKey, JSON.stringify({ lock: accepted.current.lock, id: request.current })); } catch { /* Private browser storage can be unavailable. */ }
      return value;
    },
    onSuccess: () => {
      setAck(false);
    },
  });
  const execution = useMutation({
    retry: false,
    mutationFn: async () => {
      if (remoteOnly && availability.data?.configured !== true)
        throw new ApiError(409, '超算未配置，请前往设置 → 计算位置。输入已保存。');
      if (context.dirty || !preflight.data?.ready || ((needsScopeConfirmation(preflight.data) || remoteBudget) && !ack))
        throw new ApiError(409, "需保存输入并确认预检范围");
      const source = accepted.current;
      if (
        !source ||
        source.wid !== context.study.workspace ||
        source.sid !== context.study.id
      )
        throw new ApiError(409, "预检不属于当前研究");
      const body: components["schemas"]["RunStudy"] = {
        request_id: request.current,
        expected_revision: source.revision,
        expected_study_revision: source.studyRevision,
        lock_digest: source.lock,
        scope_acknowledged: true,
        ...(source.module ? { module: source.module } : {}),
      };
      return record(
        await responseData(
          api.POST("/api/workspaces/{wid}/studies/{sid}/runs", {
            params: { path: { wid: source.wid, sid: source.sid } },
            body,
          }),
        ),
        "研究运行",
      );
    },
    onSuccess: (value) => {
      try { sessionStorage.removeItem(requestKey); } catch { /* Optional request recovery storage. */ }
      setOpen(false);
      context.refresh();
      if (location.pathname.startsWith("/studies/" + context.study.id + "/"))
        onResult(text(value.id), module);
    },
    onSettled: () => { submitGuard.current = false; },
    onError: () => { context.refresh(); },
  });
  const checkedCases = Array.isArray(preflight.data?.cases) ? preflight.data.cases.map(optionalRecord) : [];
  const remoteBudget = checkedCases.map(item => optionalRecord(optionalRecord(item.evidence).execution_budget)).find(item => numeric(item.upper_core_hours) !== null);
  useEffect(() => {
    if (!execution.isPending) return;
    const timer = setInterval(context.refresh, 2000);
    return () => clearInterval(timer);
  }, [execution.isPending]);
  const started = useRef(false);
  useEffect(() => {
    if (autoPreflight && !started.current) {
      started.current = true;
      setOpen(true);
      preflight.mutate();
      onPreflightConsumed?.();
    }
  }, [autoPreflight]);
  return (
    <>
      <Button
        variant={secondary ? "default" : "run"}
        size="compact"
        disabled={context.dirty || context.saving || !configuration || activeRun || execution.isPending || preflight.isPending}
        title={remoteOnly ? '先在本机检查输入；只有提交与原生检查需要超算。' : undefined}
        onClick={() => {
          setOpen(true);
          setAck(false);
          setInputCheck(undefined);
          execution.reset();
          preflight.mutate();
        }}
      >
        {label}
      </Button>
      <PreflightDialog
        requireConfirmation={!!remoteBudget}
        summary={<>
          {(remoteOnly || inputCheck) && <section aria-label="预检步骤" className="input-section">
            <p>输入完整性与范围：{inputCheck ? inputCheck.input_ready === true ? '已通过输入检查' : '请修正下列缺项' : preflight.isPending ? '正在本机检查' : '等待检查'}</p>
            <p><SolverLocation pluginId={configuration?.method.plugin_id || ''} capability={capability} /></p>
            {remoteOnly && availability.data?.configured === true && <p>原生环境：{preflight.data?.local_only ? '输入修正后检查' : preflight.isPending ? '正在检查' : '预检完成后显示结论'}</p>}
            {(availability.error || preflight.error) && !preflight.isPending && <Button variant="ghost" size="compact" onClick={() => preflight.mutate()}>重新检查</Button>}
          </section>}
          {remoteBudget && <section aria-label="超算核时预算" className="input-section">
          <strong>提交 {text(remoteBudget.partition)} · 本次核时预算上限 {Number(remoteBudget.upper_core_hours).toFixed(3)} 核时</strong>
          <p>预计占用不超过上述资源上限；实际核时以 Slurm 记账为准。共 {Number(remoteBudget.case_count)} 个工况，单任务时限 {Number(remoteBudget.wall_seconds)} 秒。</p>
          {checkedCases.map((item, index) => { const evidence = optionalRecord(item.evidence); return <p key={text(item.case_id)}>工况 {index + 1}：{numeric(evidence.mesh_nodes) ?? "未提供"} {numeric(evidence.field_order) === 2 ? '自由度' : '节点'} · {numeric(evidence.mesh_elements) ?? "未提供"} 单元</p>; })}
        </section>}
        </>}
        caseLabel={(id, index) => {
          const match = /case-(\d+)$/.exec(id);
          const n = match ? Number(match[1]) : index;
          const driver = optionalRecord(configuration?.driver);
          const candidate = Array.isArray(driver.candidate_ids) ? driver.candidate_ids[n] : undefined;
          const model = models.data?.find(item => text(item.id) === `candidate:${candidate}`);
          const label = text(model?.name) || (driver.kind === "selection" ? `候选型号 ${n + 1}` : `工况 ${n + 1}`);
          return id.startsWith("crosscheck-") ? `${label} · 交叉核对` : label;
        }}
        missingLabel={(field) =>
          field.startsWith('/parameters') ? preflightFieldLabel(field, parameterSchema) : missingInputDestination(field, module, currentInput).label
        }
        open={open}
        onOpenChange={(value) => {
          if (!execution.isPending) setOpen(value);
        }}
        method={
          configuration
            ? (configuration.method.plugin_id === 'cablesim.simulation' ? '电缆有限元仿真' : displayName(configuration.method.plugin_id)) +
              " · " +
              configuration.method.version
            : ""
        }
        loading={preflight.isPending}
        error={preflight.error}
        data={readablePreflight(preflight.data, parameterSchema)}
        ack={ack}
        onAck={setAck}
        running={execution.isPending}
        runError={execution.error}
        disabled={context.dirty || (remoteOnly && availability.data?.configured !== true)}
        onRun={() => { if (submitGuard.current) return; submitGuard.current = true; execution.mutate(); }}
        onMissing={(field) => {
          setOpen(false);
          onMissing?.(field);
          // Wait for the exiting dialog's focus scope, then the lazy form.
          window.clearInterval(focusTimer.current);
          if (field) {
            const deadline = Date.now() + 10000;
            focusTimer.current = window.setInterval(() => {
              if (Date.now() > deadline || !location.pathname.includes(context.study.id)) { window.clearInterval(focusTimer.current); return; }
              if (document.querySelector('[role="dialog"]')) return;
              const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-field-path]'));
              const path = matchingFieldPath(field, nodes.map(node => node.dataset.fieldPath || ''), context.domain);
              const node = nodes.find(node => path !== undefined && node.dataset.fieldPath === path);
              const input = node?.matches('input,select,textarea,button') ? node : node?.querySelector<HTMLElement>('input,select,textarea,button');
              if (!input) return;
              node?.closest('details')?.setAttribute('open', '');
              input.focus();
              if (document.activeElement !== input) return;
              input.scrollIntoView({ block: 'center' });
              window.clearInterval(focusTimer.current);
            }, 50);
          }
        }}
      />
      {(activeRun || ["failed", "interrupted"].includes(text(context.runs.at(-1)?.status))) && <StudyRemoteProgress />}
    </>
  );
}

const remoteStates: Record<string, string> = {
  preparing: "准备", submitted: "已提交", collecting: "后处理",
  interrupted: "连接中断", disconnected: "连接中断", cancel_requested: "正在取消",
  ...STATUS_WORDS,
};

/** Can also be placed inside the workbench run-records drawer. */
export function StudyRemoteProgress({ run }: { run?: Record<string, unknown> }) {
  const context = useStudy();
  const selected = run || [...context.runs].reverse().find(item => ["cablesim.simulation", "cablesim.comsol-bridge"].includes(text(optionalRecord(item.method || optionalRecord(optionalRecord(item.snapshot).definition).method).plugin_id)) || optionalRecord(item.execution).backend === "slurm");
  return <SavedRunProgress run={selected && { ...selected, workspace: context.study.workspace, study: context.study.id }} onRefresh={context.refresh} />;
}

/** Saved fields can also be opened from reports without an editable study context. */
export function SavedRunProgress({ run: selected, onRefresh }: { run?: Record<string, unknown>; onRefresh?: () => void }) {
  const rid = text(selected?.id), wid = text(selected?.workspace), sid = text(selected?.study);
  const detail = useQuery({
    queryKey: ["remote-run-progress", wid, sid, rid], enabled: !!rid,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(wid)}/studies/${encodeURIComponent(sid)}/runs/${encodeURIComponent(rid)}/progress`, { signal, cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new ApiError(response.status, "超算进度读取失败，保存运行未改变");
      return record(await response.json(), "运行进度");
    },
    refetchInterval: query => ["accepted", "running", "validating"].includes(text(query.state.data?.status)) ? 2000 : false,
    retry: false,
  });
  const value = detail.data || selected, execution = optionalRecord(value?.execution);
  const status = text(execution.state) || text(value?.status), busy = ["accepted", "running", "validating"].includes(text(value?.status));
  const convergence = useQuery({ queryKey: ['adaptive-convergence', wid, sid], enabled: busy && !!wid && !!sid, retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/hpc/convergence?workspace=${encodeURIComponent(wid)}&study=${encodeURIComponent(sid)}`, { signal });
      if (!response.ok) throw new ApiError(response.status, '级别读取失败');
      return record(await response.json());
    }, refetchInterval: busy ? 3000 : false });
  const workflow = (Array.isArray(convergence.data?.items) ? convergence.data.items.map(optionalRecord) : []).find(item => item.current_run_id === rid);
  const action = useMutation({
    retry: false,
    mutationFn: async (verb: "cancel" | "resume") => {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(wid)}/studies/${encodeURIComponent(sid)}/runs/${encodeURIComponent(rid)}/${verb}`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new ApiError(response.status, typeof body.detail === "string" ? body.detail : "运行操作失败，原运行已保留"); }
      return response.json();
    },
    onSuccess: () => { detail.refetch(); onRefresh?.(); },
  });
  useEffect(() => {
    if (!action.isPending) return;
    const timer = setInterval(() => { void detail.refetch(); }, 2000);
    return () => clearInterval(timer);
  }, [action.isPending]);
  if (!rid || (!execution.backend && !detail.error)) return null;
  const cancelled = Array.isArray(execution.slurm_states) && execution.slurm_states.includes("CANCELLED");
  return <section className="input-section" aria-label="超算运行记录" aria-live="polite">
    <div className="report-toolbar"><strong>{cancelled ? STATUS_WORDS.cancelled : execution.cancel_requested && busy ? "正在取消" : remoteStates[status] || '状态未记录'}</strong>
      <span>作业 {text(execution.job_id) || "等待 Slurm 回执"} · 已用 {((numeric(execution.actual_cpu_seconds) || 0) / 3600).toFixed(4)} 核时{numeric(execution.budget_core_hours) !== null ? ` / 预算 ${Number(execution.budget_core_hours).toFixed(3)} 核时` : ''}</span>
      {busy && <span title="同分区待调度优先序，不保证开跑顺序">排队位置 {numeric(execution.queue_position) ?? '尚未提供'}</span>}
      {busy && <span>{workflow ? `第 ${(Array.isArray(workflow.rows) ? workflow.rows.length : 0)+1} 级 · ${optionalRecord(workflow.pending).kind === 'domain' ? '扩域' : optionalRecord(workflow.pending).kind === 'rating' ? '最终载流量' : '网格'}` : convergence.error ? '当前级别暂不可读' : '单次运行'}</span>}
      {busy && <Button size="compact" disabled={action.isPending || execution.cancel_requested === true} onClick={() => action.mutate("cancel")}>停止</Button>}
      {!busy && !cancelled && ["failed", "interrupted"].includes(text(value?.status)) && <Button size="compact" disabled={action.isPending} onClick={() => action.mutate("resume")}>恢复原作业</Button>}
    </div>
    {!!detail.error && <ErrorState title="进度连接中断，原作业保留" description={message(detail.error)} action={<Button size="compact" onClick={() => detail.refetch()}>重新读取进度</Button>} />}
    {!!action.error && <ErrorState description={message(action.error)} />}
    {text(optionalRecord(value?.error).message) && <p role="status">{text(optionalRecord(value?.error).message)}</p>}
  </section>;
}
