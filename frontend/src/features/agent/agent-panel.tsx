import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from '@tanstack/react-router';
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { entityLabel } from "@/lib/domain-fields";
import { workspaceQuery } from "@/lib/study-queries";
import { agentRecipes, agentTools, type RecipeCall } from "./agent-api";
import { ProposalCard, TurnView } from "./conversation";
import { PromptBar } from "./prompt-bar";
import { AgentConversationMessages, AgentConversationProvider } from "./conversation-runtime";
import { AgentThread } from "./thread-viewport";
import { useAgentSession, useAgentStatus } from "./use-agent-session";

const SUGGESTIONS = ["解释这个研究的结论和主要限制因素", "土壤热阻率改成 1.2 K·m/W 会怎样？", "检查这个研究还缺哪些输入"];

/**
 * 工作台属性栏里的 Agent：与 Agent 模式同一套对话组件，位置窄，改动审核卡直接嵌在对话里。
 */
type AgentPanelProps = { workspaceId: string; studyId?: string; context: string; suggestions?: string[] };

export function AgentPanel(props: AgentPanelProps) {
  return <ScopedAgentPanel key={`${props.workspaceId}/${props.studyId || ''}`} {...props} />;
}

function ScopedAgentPanel({ workspaceId, studyId, context, suggestions = SUGGESTIONS }: AgentPanelProps) {
  const navigate = useNavigate();
  const { ready, canSend, label: model, hint: modelHint, loading: modelLoading, error: modelError, retry: retryModel } = useAgentStatus();
  const tools = useQuery({ queryKey: ["agent-tools"], queryFn: ({ signal }) => agentTools(signal), retry: false, staleTime: 60_000 });
  const recipes = useQuery({ queryKey: ['agent-recipes', workspaceId], queryFn: ({ signal }) => agentRecipes({ workspace: workspaceId }, signal), enabled: !!studyId, retry: false, staleTime: 300_000 });
  const kinds = useMemo(() => new Map((tools.data || []).map((tool) => [tool.name, tool.kind])), [tools.data]);
  const workspace = useQuery(workspaceQuery(workspaceId));
  const label = (entity: string) => entityLabel(workspace.data?.domain, entity);
  const [session, setSession] = useState<string | undefined>();
  const agent = useAgentSession({ sessionId: session, workspaceId, studyId, onCreated: setSession });
  const [draft, setDraft] = useState("");
  const thread = useRef<HTMLDivElement>(null);
  const turns = useMemo(() => agent.live ? [...agent.turns, agent.live] : agent.turns, [agent.turns, agent.live]);
  const send = (value: string, recipe?: RecipeCall) => agent.send(value, recipe, () => setDraft(current => current.trim() === value.trim() ? "" : current));
  const suggestion = (value: string) => {
    const check = studyId && value === '检查这个研究还缺哪些输入' && recipes.data?.some(recipe => recipe.id === 'missing_inputs');
    return send(value, check ? { id: 'missing_inputs', parameters: { study_id: studyId } } : undefined);
  };
  const openWorkbench = () => {
    if (studyId) void navigate({ to: '/studies/$sid', params: { sid: studyId }, search: { workspace: workspaceId, inspector: 'input', theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', run: '', delivery: '' } });
    else {
      const tab = [...(document.querySelector('.workbench-inspector')?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || [])].find(node => node.textContent?.trim() !== 'Agent');
      tab?.click(); tab?.focus();
    }
  };
  const reviewPending = () => {
    const card = thread.current?.querySelector<HTMLElement>('.agent-review-card.is-pending');
    card?.scrollIntoView({ block: 'center' }); card?.querySelector<HTMLElement>('button')?.focus();
  };

  return <AgentConversationProvider key={agent.id || 'new'} turns={turns} loading={agent.loading} sending={agent.sending}
    canSend={canSend && agent.canContinue} onSend={suggestion} onStop={agent.stop}>
    <section className="agent-panel" aria-label="Agent">
    <header className="agent-panel-head">
      <span className={`status-dot ${ready ? "is-ok" : "is-off"}`} />
      <span className="agent-panel-model">{agent.serverRunning && !agent.sending ? "服务端处理中" : agent.awaitingRecord && !agent.sending ? "核对任务记录" : model}</span>
      {turns.length > 0 && <Button size="compact" variant="ghost" disabled={agent.sending || agent.serverRunning || agent.awaitingRecord} title={agent.sending || agent.serverRunning || agent.awaitingRecord ? "请先核对当前任务的最终状态，再开始新对话" : "开始新对话"} onClick={() => { setSession(undefined); setDraft(''); }}><Icon name="action/edit" />新对话</Button>}
    </header>
    <AgentThread session={agent.id} viewportRef={thread} compact busy={agent.loading}>
      {agent.loading ? <p className="agent-thread-note" role="status">正在读取任务记录</p>
        : agent.error && !turns.length ? <div className="agent-notice" role="alert"><span>任务记录读取失败：{agent.error.message}</span><Button size="compact" onClick={() => void agent.reload()}>重新读取任务</Button></div>
        : !turns.length ? <div className="agent-start is-compact">
        <p>基于「{context}」工作，调用工作台同一批模块和插件；改动先写成方案，由你批准。</p>
        <div className="agent-start-grid">{suggestions.map((item) => <Button key={item} type="button" variant="outline" onClick={() => { setDraft(item); thread.current?.closest('.agent-panel')?.querySelector<HTMLTextAreaElement>('textarea')?.focus(); }}><Icon name="agent/message" />{item}</Button>)}</div>
      </div>
        : <AgentConversationMessages renderTurn={turn => <TurnView showQuestion={false} key={turn.id} turn={turn} kinds={kinds} proposals={agent.proposals} label={label}
          onRetry={turn.id === turns.at(-1)?.id && canSend && agent.canContinue && !agent.sending ? () => send(turn.question) : undefined}
          onRefresh={turn.id === turns.at(-1)?.id && !agent.sending ? () => void agent.reload() : undefined}
          onOpenWorkspace={turn.id === turns.at(-1)?.id ? openWorkbench : undefined} onReview={reviewPending}
          review={(proposal) => {
            const event = [...agent.events].reverse().find(event => event.type === 'proposal.decision' && event.data.id === proposal.id);
            return <ProposalCard proposal={proposal} label={label} onDecide={(id, decision) => void agent.decide(id, decision)}
              receipt={event ? { created: event.created, status: String(event.data.status), actor: typeof event.data.actor === 'string' ? event.data.actor : undefined } : undefined}
              busy={agent.decisions[proposal.id]?.busy} error={agent.decisions[proposal.id]?.error} />;
          }} />} />}
    </AgentThread>
    {agent.error && turns.length > 0 && <div className="agent-notice" role="alert"><span>记录尚未更新：{agent.error.message}</span><Button size="compact" onClick={() => void agent.reload()}>重新读取任务</Button></div>}
    {agent.awaitingRecord && !agent.sending && <Button size="compact" variant="outline" onClick={() => void agent.reload()}>更新任务状态</Button>}
    {!canSend && <div className="agent-panel-connection"><p>{modelHint}</p>{!modelLoading && <Button size="compact" variant="outline" onClick={() => modelError ? void retryModel() : void navigate({ to: '/settings', search: { theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', section: 'ai' } })}>{modelError ? '重新连接' : '模型设置'}</Button>}</div>}
    <PromptBar value={draft} onChange={setDraft} busy={agent.sending} canSend={canSend && agent.canContinue}
      disabledReason={agent.blockedReason || (!canSend ? modelHint : agent.loading ? '正在读取任务记录，请稍候。' : agent.error ? '请先重新读取任务记录。' : undefined)}
      placeholder={canSend ? "描述任务，如：回路间距加大到 0.3 m，看看载流量" : "Agent 模型未连接，暂时不能发送"} />
  </section></AgentConversationProvider>;
}
