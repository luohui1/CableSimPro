import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { studyIndex, typeIndex, workspaces } from "@/api/research";
import { text } from "@/api/client";
import { AppShell } from "@/components/app-shell";
import { usePageTheme } from "@/components/catalog-shell";
import { StatusMark } from "@/components/status-mark";
import { InlineEmpty } from "@/components/states";
import { Icon } from "@/components/icon";
import { Button, IconButton } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionThumbnail } from "@/features/drawing";
import { entityLabel, type DomainDocument } from "@/lib/domain-fields";
import { rootModule, studyEntryTab } from "@/lib/study-config";
import { workspaceQuery } from "@/lib/study-queries";
import { agentRecipes, agentSessions, agentTools } from "@/features/agent/agent-api";
import { PreviewCard, ProposalCard, SavedRunCard, TurnView } from "@/features/agent/conversation";
import { PromptBar, type PromptCommand, type PromptReference } from "@/features/agent/prompt-bar";
import { taskState } from "@/features/agent/task-list";
import { useAgentSession, useAgentStatus } from "@/features/agent/use-agent-session";

const SUGGESTIONS = ["汇总本工程各研究的结论量值和限制因素", "这个工程里哪些研究还没有结果？", "土壤热阻率改成 1.2 K·m/W，给出方案并试算最高导体温度的变化"];
/**
 * “/” 菜单来自宿主配方（GET /api/agent/recipes）；选中后填入一句任务开头。无必填参数的配方随消息带上 recipe 字段，
 * 由宿主确定性执行；需要参数的（如方案对比）仍作自由提问，由模型调用 recipe_execute。
 */
const RECIPE_TEXT: Record<string, string> = {
  conclusion_summary: "汇总本工程各研究的结论量值和限制因素",
  missing_inputs: "检查工程模型和各研究还缺哪些输入，按影响排序",
  proposal_comparison: "给出修改方案并快速试算对比：",
  sensitivity_advice: "给出参数敏感性研究建议：",
  type_review: "检查这个型号的缺项、与执行标准不一致处和可改进点",
  inbox_triage: "帮我理一下待办",
};
const SIDE_KEY = "cablesim:agent:side-open";
const readSide = () => { try { return localStorage.getItem(SIDE_KEY) !== "false"; } catch { return true; } };
const storeSide = (open: boolean) => { try { localStorage.setItem(SIDE_KEY, String(open)); } catch { /* 隐私模式只保留本次 */ } };

/**
 * Agent 模式（组件陈列“Agent 模式（整页）”）：左栏任务、中间对话、右栏侧栏（改动 · 运行 · 截面），右栏可收起。
 * 改动方案只在右栏审核，由人按住批准；试算与读过的保存运行列在“运行”，“截面”是 Agent 正在用的工程模型。
 */
export function AgentPage() {
  const { theme } = usePageTheme();
  const search = useSearch({ from: "/agent" });
  const navigate = useNavigate();
  const { ready, canSend, label: model } = useAgentStatus();
  const tools = useQuery({ queryKey: ["agent-tools"], queryFn: ({ signal }) => agentTools(signal), retry: false, staleTime: 60_000 });
  const kinds = useMemo(() => new Map((tools.data || []).map((tool) => [tool.name, tool.kind])), [tools.data]);
  const sessions = useQuery({ queryKey: ["agent-sessions"], queryFn: ({ signal }) => agentSessions(undefined, signal), retry: false });
  const projects = useQuery({ queryKey: ["workspace-index"], queryFn: ({ signal }) => workspaces(signal) });
  const types = useQuery({ queryKey: ["type-index"], queryFn: ({ signal }) => typeIndex(signal) });
  const studies = useQuery({ queryKey: ["study-index"], queryFn: ({ signal }) => studyIndex(signal) });
  const typeIds = new Set((types.data || []).map((row) => text(row.id)));
  const options = (projects.data || []).filter((row) => !typeIds.has(text(row.id))).map((row) => ({ id: text(row.id), name: text(row.name) || "未命名工程" }));
  const summary = sessions.data?.find((row) => row.id === search.task);
  const workspaceId = summary?.workspace_id || options.find((row) => row.id === search.workspace)?.id || options[0]?.id;
  const project = options.find((row) => row.id === workspaceId);
  const recipes = useQuery({ queryKey: ["agent-recipes", search.task || "", workspaceId || ""], queryFn: ({ signal }) => agentRecipes({ session: search.task, workspace: workspaceId }, signal), retry: false, staleTime: 300_000 });
  const commands: PromptCommand[] = (recipes.data || []).map((row) => ({ key: row.id, name: row.name, description: row.description, text: RECIPE_TEXT[row.id] || `${row.name}：` }));
  const workspace = useQuery({ ...workspaceQuery(workspaceId), enabled: !!workspaceId });
  const domain = workspace.data?.domain as DomainDocument | undefined;
  const label = (entity: string) => entityLabel(domain, entity);
  const agent = useAgentSession({ sessionId: search.task, workspaceId, studyId: summary?.study_id ?? undefined,
    onCreated: (id) => void navigate({ to: "/agent", search: { theme, task: id, workspace: workspaceId }, replace: true }) });
  const [draft, setDraft] = useState("");
  const [side, setSide] = useState(readSide);
  // 右栏页签：没手动选过时跟着内容走（有待审改动先看改动），换任务时重置
  const [sideTab, setSideTab] = useState<string>();
  useEffect(() => setSideTab(undefined), [agent.id]);
  const thread = useRef<HTMLDivElement>(null);

  // 新内容出现时滚到底部
  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight }); }, [agent.turns.length, agent.live]);

  const projectStudies = (studies.data || []).filter((row) => row.workspace === workspaceId);
  const studyTitle = (sid: string) => studies.data?.find((row) => row.id === sid)?.title;
  const openStudy = (sid: string, run = "") => {
    const row = studies.data?.find((item) => item.id === sid);
    if (!row) return;
    const module = rootModule(row.definition);
    void navigate({ to: "/studies/$sid/$module/$tab", params: { sid, module, tab: studyEntryTab(module) }, search: { workspace: row.workspace, theme, run, delivery: "" } });
  };
  const references: PromptReference[] = [
    ...projectStudies.map((row) => ({ key: row.id, name: row.title, description: row.task, icon: "object/study" })),
    ...(types.data || []).map((row) => ({ key: text(row.id), name: text(row.name), description: "型号", icon: "object/cable" })),
  ];
  // 以“/”任务开头、且不需要额外参数的配方，交给宿主按固定步骤执行，再请模型作答一次
  const send = (value: string) => {
    const recipe = (recipes.data || []).find((row) => RECIPE_TEXT[row.id] && value.trim().startsWith(RECIPE_TEXT[row.id]) && !(row.parameters.required as unknown[] | undefined)?.length);
    void agent.send(value, recipe ? { id: recipe.id, parameters: {} } : undefined);
    setDraft("");
  };
  // 首页“让 Agent 整理”：带 ask=inbox 打开时，新建任务并按宿主配方整理待办；只发一次，随后从地址里去掉
  const asked = useRef(false);
  useEffect(() => {
    if (search.ask !== "inbox" || asked.current || !canSend || !project || !recipes.data || agent.sending) return;
    asked.current = true;
    send(RECIPE_TEXT.inbox_triage);
    void navigate({ to: "/agent", search: { theme, workspace: workspaceId }, replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.ask, canSend, project, recipes.data]);
  const toggleSide = () => setSide((open) => { storeSide(!open); return !open; });

  const turns = agent.live ? [...agent.turns, agent.live] : agent.turns;
  const proposals = [...new Set(turns.flatMap((turn) => turn.proposals))].map((id) => agent.proposals.get(id)).filter((item) => !!item);
  const pending = proposals.filter((item) => item.status === "pending").length;
  const previews = turns.flatMap((turn) => turn.previews);
  const runs = turns.flatMap((turn) => turn.runs).filter((run, index, all) => all.findIndex((item) => item.id === run.id) === index);
  const title = summary?.title || turns[0]?.question || "新任务";
  const state = agent.live?.running ? { tone: "running", text: "执行中" } : summary ? taskState({ ...summary, pending_proposals: pending }) : null;
  const section = domain?.sections?.[0];

  const scope = agent.id
    ? <span className="agent-scope-chip"><Icon name="object/folder" />{project?.name || "工程"}</span>
    : <DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button" className="agent-scope-chip is-picker" aria-label="选择工程"><Icon name="object/folder" />{project?.name || "选择工程"}<Icon name="action/chevron-down" /></button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">{options.map((row) => <DropdownMenuItem key={row.id} onSelect={() => void navigate({ to: "/agent", search: { theme, workspace: row.id }, replace: true })}>{row.name}</DropdownMenuItem>)}</DropdownMenuContent>
    </DropdownMenu>;

  const sidebar = <aside className="property-panel agent-side" aria-label="侧栏">
    <Tabs value={sideTab ?? (pending || !(previews.length + runs.length) ? "changes" : "runs")} onValueChange={setSideTab} className="agent-side-tabs">
      <div className="agent-side-head">
        <TabsList>
          <TabsTrigger value="changes">改动{proposals.length > 0 && <span className="agent-side-count">{proposals.length}</span>}</TabsTrigger>
          <TabsTrigger value="runs">运行{previews.length + runs.length > 0 && <span className="agent-side-count">{previews.length + runs.length}</span>}</TabsTrigger>
          <TabsTrigger value="section">截面</TabsTrigger>
        </TabsList>
        <IconButton variant="ghost" icon="nav/sidebar" label="收起右栏" onClick={toggleSide} />
      </div>
      <TabsContent value="changes">
        {proposals.length ? proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} onDecide={(id, decision) => void agent.decide(id, decision)}
          busy={agent.decisions[proposal.id]?.busy} error={agent.decisions[proposal.id]?.error} />)
          : <div className="agent-review-empty"><Icon name="agent/proposal" /><p>Agent 要改工程时，会把字段级改动写成方案放在这里。你核对后按住批准才会保存；拒绝不会留下任何改动。</p></div>}
      </TabsContent>
      <TabsContent value="runs">
        {previews.map((item) => <PreviewCard key={item.id} preview={item} label={label} proposalTitle={item.proposalId ? agent.proposals.get(item.proposalId)?.title : undefined}
          onOpen={item.studyId ? () => openStudy(item.studyId!) : undefined} />)}
        {runs.map((run) => <SavedRunCard key={run.id} run={run} title={studyTitle(run.studyId)} label={label} onOpen={() => openStudy(run.studyId, run.id)} />)}
        {!previews.length && !runs.length && <div className="agent-review-empty"><Icon name="result/snapshot" /><p>Agent 读取的保存结果和它做的快速试算会列在这里，可以直接回到工作台查看。</p></div>}
      </TabsContent>
      <TabsContent value="section">
        {domain && section ? <figure className="agent-side-section">
          <SectionThumbnail document={domain} sectionId={section.id} label={`${project?.name || "工程"} 敷设截面`} />
          <figcaption>{project?.name} · 工程模型第 {String(workspace.data?.revision ?? "—")} 版。Agent 读取和试算用的都是这一版；待批准的改动不会画进来。</figcaption>
        </figure> : <div className="agent-review-empty"><Icon name="object/section" /><p>{workspace.isPending ? "正在读取工程模型" : "这个工程还没有敷设截面。"}</p></div>}
      </TabsContent>
    </Tabs>
  </aside>;

  return (
    <AppShell title={title} status={state ? <span className={`agent-state is-${state.tone}`}>{state.text}</span> : <StatusMark kind="draft" label="新任务" />}
      actions={<>
        {summary?.study_id && <Button size="compact" variant="ghost" onClick={() => openStudy(summary.study_id!)}><Icon name="nav/workbench" />在工作台打开</Button>}
        {!side && <IconButton variant="ghost" icon="nav/sidebar" label={pending ? `展开右栏（${pending} 项改动待审核）` : "展开右栏"} onClick={toggleSide} />}
      </>}
      property={side ? sidebar : undefined} theme={theme} onTheme={() => {}} onUnavailable={() => {}}>
      <div className="agent-page" data-page="agent">
        <div className="agent-thread" ref={thread}>
          {agent.loading ? <p className="agent-thread-note">正在读取任务记录</p>
            : agent.error ? <p className="agent-notice" role="alert"><Icon name="status/warning" />任务记录读取失败：{agent.error.message}</p>
              : !turns.length ? <div className="agent-start">
                <h2>要 Agent 做什么？</h2>
                <p>{project ? `基于「${project.name}」工作。` : "先选择一个工程。"}它调用工作台同一批模块和插件；改工程时先写成方案，由你批准。</p>
                {/* 没连模型时先说明原因和去处，建议不再整体变淡得像坏了 */}
                {!canSend ? <InlineEmpty title="还没有连接 AI 模型。在设置里填写服务地址、模型名和密钥后即可使用。" action={<Button size="compact" onClick={() => void navigate({ to: "/settings", search: { theme, section: "ai" } })}>去设置</Button>} />
                  : <div className="agent-start-grid">{SUGGESTIONS.map((item) => <button key={item} type="button" disabled={!project} onClick={() => send(item)}><Icon name="agent/message" />{item}</button>)}</div>}
              </div>
                : turns.map((turn, index) => <TurnView key={turn.id} turn={turn} kinds={kinds} proposals={agent.proposals} label={label} review="aside" onOpenStudy={openStudy}
                  onRetry={index === turns.length - 1 && canSend && !agent.sending ? () => send(turn.question) : undefined} />)}
        </div>
        <div className="agent-prompt">
          <PromptBar value={draft} onChange={setDraft} onSend={() => send(draft)} onStop={agent.stop} busy={agent.sending} canSend={canSend && !!project}
            placeholder={canSend ? "描述任务，或输入 @ 引用研究、/ 调出常用任务" : "Agent 模型未连接，暂时不能发送"}
            references={references} commands={commands}
            model={<><span className={`status-dot ${ready ? "is-ok" : "is-off"}`} /><span className="agent-panel-model">{model}</span></>} />
          <div className="agent-prompt-scope">{scope}</div>
        </div>
      </div>
    </AppShell>
  );
}
