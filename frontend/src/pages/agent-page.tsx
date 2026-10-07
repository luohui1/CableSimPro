import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { studyIndex, typeIndex, workspaces } from "@/api/research";
import { text } from "@/api/client";
import { AppShell } from "@/components/app-shell";
import { usePageTheme } from "@/components/catalog-shell";
import { StatusMark } from "@/components/status-mark";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { entityLabel } from "@/lib/domain-fields";
import { rootModule, studyEntryTab } from "@/lib/study-config";
import { workspaceQuery } from "@/lib/study-queries";
import { agentSessions, agentTools } from "@/features/agent/agent-api";
import { Composer, PreviewCard, ProposalCard, TurnView } from "@/features/agent/conversation";
import { taskState } from "@/features/agent/task-list";
import { useAgentSession, useAgentStatus } from "@/features/agent/use-agent-session";

const SUGGESTIONS = ["汇总各研究的载流量结论和限制因素", "这个工程里哪些研究还没有结果？", "土壤热阻率改成 1.2 K·m/W，给出方案并试算最高导体温度的变化"];

/**
 * Agent 模式（组件陈列“Agent 模式（整页）”）：左栏任务、中间对话、右栏审核。
 * 对话里只放提问、工作过程、回答和试算；改动方案都进右栏，由人核对后按住批准。
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
  const workspace = useQuery({ ...workspaceQuery(workspaceId), enabled: !!workspaceId });
  const label = (entity: string) => entityLabel(workspace.data?.domain, entity);
  const agent = useAgentSession({ sessionId: search.task, workspaceId, studyId: summary?.study_id ?? undefined,
    onCreated: (id) => void navigate({ to: "/agent", search: { theme, task: id, workspace: workspaceId }, replace: true }) });
  const [draft, setDraft] = useState("");
  const thread = useRef<HTMLDivElement>(null);

  // 新内容出现时滚到底部
  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight }); }, [agent.turns.length, agent.live]);

  const openStudy = (sid: string) => {
    const row = studies.data?.find((item) => item.id === sid);
    if (!row) return;
    const module = rootModule(row.definition);
    void navigate({ to: "/studies/$sid/$module/$tab", params: { sid, module, tab: studyEntryTab(module) }, search: { workspace: row.workspace, theme, run: "", delivery: "" } });
  };
  const send = (value: string) => { void agent.send(value); setDraft(""); };
  const turns = agent.live ? [...agent.turns, agent.live] : agent.turns;
  const proposals = [...new Set(turns.flatMap((turn) => turn.proposals))].map((id) => agent.proposals.get(id)).filter((item) => !!item);
  const pending = proposals.filter((item) => item.status === "pending").length;
  const previews = turns.flatMap((turn) => turn.previews);
  const title = summary?.title || turns[0]?.question || "新任务";
  const state = agent.live?.running ? { tone: "running", text: "执行中" } : summary ? taskState({ ...summary, pending_proposals: pending }) : null;

  const scope = agent.id
    ? <span className="agent-scope-chip"><Icon name="object/folder" />{project?.name || "工程"}</span>
    : <DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button" className="agent-scope-chip is-picker" aria-label="选择工程"><Icon name="object/folder" />{project?.name || "选择工程"}<Icon name="action/chevron-down" /></button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">{options.map((row) => <DropdownMenuItem key={row.id} onSelect={() => void navigate({ to: "/agent", search: { theme, workspace: row.id }, replace: true })}>{row.name}</DropdownMenuItem>)}</DropdownMenuContent>
    </DropdownMenu>;

  // 右栏只在有改动或试算要人核对时出现
  const review = <aside className="property-panel agent-review" aria-label="审核">
    <Tabs defaultValue="changes" className="agent-review-tabs">
      <TabsList><TabsTrigger value="changes">改动{proposals.length > 0 && ` ${proposals.length}`}</TabsTrigger><TabsTrigger value="previews">试算{previews.length > 0 && ` ${previews.length}`}</TabsTrigger></TabsList>
      <TabsContent value="changes">
        {proposals.length ? proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} onDecide={(id, decision) => void agent.decide(id, decision)}
          busy={agent.decisions[proposal.id]?.busy} error={agent.decisions[proposal.id]?.error} />)
          : <div className="agent-review-empty"><Icon name="agent/proposal" /><p>Agent 要改工程时，会把字段级改动写成方案放在这里。你核对后按住批准才会保存；拒绝不会留下任何改动。</p></div>}
      </TabsContent>
      <TabsContent value="previews">
        {previews.length ? previews.map((item) => <PreviewCard key={item.id} preview={item} label={label} proposalTitle={item.proposalId ? agent.proposals.get(item.proposalId)?.title : undefined}
          onOpen={item.studyId ? () => openStudy(item.studyId!) : undefined} />)
          : <div className="agent-review-empty"><Icon name="calc/ampacity" /><p>Agent 用方案做的快速试算会列在这里。试算不保存运行，也不代表批准。</p></div>}
      </TabsContent>
    </Tabs>
  </aside>;

  return (
    <AppShell title={title} status={state ? <span className={`agent-state is-${state.tone}`}>{state.text}</span> : <StatusMark kind="draft" label="新任务" />}
      actions={summary?.study_id ? <Button size="compact" variant="ghost" onClick={() => openStudy(summary.study_id!)}><Icon name="nav/workbench" />在工作台打开</Button> : null}
      property={proposals.length || previews.length ? review : undefined} theme={theme} onTheme={() => {}} onUnavailable={() => {}}>
      <div className="agent-page" data-page="agent">
        <div className="agent-thread" ref={thread}>
          {agent.loading ? <p className="agent-thread-note">正在读取任务记录</p>
            : agent.error ? <p className="agent-notice" role="alert"><Icon name="status/warning" />任务记录读取失败：{agent.error.message}</p>
              : !turns.length ? <div className="agent-start">
                <h2>要 Agent 做什么？</h2>
                <p>{project ? `基于「${project.name}」工作。` : "先选择一个工程。"}它调用工作台同一批模块和插件；改工程时先写成方案，由你批准。</p>
                <div className="agent-start-grid">{SUGGESTIONS.map((item) => <button key={item} type="button" disabled={!canSend || !project} onClick={() => send(item)}><Icon name="agent/message" />{item}</button>)}</div>
              </div>
                : turns.map((turn, index) => <TurnView key={turn.id} turn={turn} kinds={kinds} proposals={agent.proposals} label={label} review="aside" onOpenStudy={openStudy}
                  onRetry={index === turns.length - 1 && canSend && !agent.sending ? () => send(turn.question) : undefined} />)}
        </div>
        <Composer value={draft} onChange={setDraft} onSend={() => send(draft)} disabled={!canSend || !project || agent.sending} sending={agent.sending}
          placeholder={canSend ? "描述任务，如：回路间距加大到 0.3 m，看看载流量怎么变" : "Agent 模型未连接，暂时不能发送"}
          scope={scope} model={<><span className={`status-dot ${ready ? "is-ok" : "is-off"}`} /><span className="agent-panel-model">{model}</span></>} />
      </div>
    </AppShell>
  );
}
