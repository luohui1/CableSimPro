import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { entityLabel } from "@/lib/domain-fields";
import { workspaceQuery } from "@/lib/study-queries";
import { agentTools } from "./agent-api";
import { Composer, ProposalCard, TurnView } from "./conversation";
import { useAgentSession, useAgentStatus } from "./use-agent-session";

const SUGGESTIONS = ["解释这个研究的结论和主要限制因素", "土壤热阻率改成 1.2 K·m/W 会怎样？", "检查这个研究还缺哪些输入"];

/**
 * 工作台属性栏里的 Agent：与 Agent 模式同一套对话组件，位置窄，改动审核卡直接嵌在对话里。
 */
export function AgentPanel({ workspaceId, studyId, context, suggestions = SUGGESTIONS }: { workspaceId: string; studyId?: string; context: string; suggestions?: string[] }) {
  const { ready, canSend, label: model } = useAgentStatus();
  const tools = useQuery({ queryKey: ["agent-tools"], queryFn: ({ signal }) => agentTools(signal), retry: false, staleTime: 60_000 });
  const kinds = useMemo(() => new Map((tools.data || []).map((tool) => [tool.name, tool.kind])), [tools.data]);
  const workspace = useQuery(workspaceQuery(workspaceId));
  const label = (entity: string) => entityLabel(workspace.data?.domain, entity);
  const [session, setSession] = useState<string | undefined>();
  const agent = useAgentSession({ sessionId: session, workspaceId, studyId, onCreated: setSession });
  const [draft, setDraft] = useState("");
  const thread = useRef<HTMLDivElement>(null);
  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight }); }, [agent.turns.length, agent.live]);
  const turns = agent.live ? [...agent.turns, agent.live] : agent.turns;
  const send = (value: string) => { void agent.send(value); setDraft(""); };

  return <section className="agent-panel" aria-label="Agent">
    <header className="agent-panel-head">
      <span className={`status-dot ${ready ? "is-ok" : "is-off"}`} />
      <span className="agent-panel-model">{model}</span>
      {turns.length > 0 && <Button size="compact" variant="ghost" disabled={agent.sending} onClick={() => setSession(undefined)}><Icon name="action/edit" />新对话</Button>}
    </header>
    <div className="agent-thread is-compact" ref={thread}>
      {!turns.length ? <div className="agent-start is-compact">
        <p>基于「{context}」工作，调用工作台同一批模块和插件；改动先写成方案，由你批准。</p>
        <div className="agent-start-grid">{suggestions.map((item) => <button key={item} type="button" disabled={!canSend || agent.sending} onClick={() => send(item)}><Icon name="agent/message" />{item}</button>)}</div>
      </div>
        : turns.map((turn, index) => <TurnView key={turn.id} turn={turn} kinds={kinds} proposals={agent.proposals} label={label}
          onRetry={index === turns.length - 1 && canSend && !agent.sending ? () => send(turn.question) : undefined}
          review={(proposal) => <ProposalCard proposal={proposal} onDecide={(id, decision) => void agent.decide(id, decision)} busy={agent.decisions[proposal.id]?.busy} error={agent.decisions[proposal.id]?.error} />} />)}
    </div>
    <Composer value={draft} onChange={setDraft} onSend={() => send(draft)} disabled={!canSend || agent.sending} sending={agent.sending}
      placeholder={canSend ? "描述任务，如：回路间距加大到 0.3 m，看看载流量" : "Agent 模型未连接，暂时不能发送"} />
  </section>;
}
