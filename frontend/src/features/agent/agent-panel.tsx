import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { agentStatus, AgentUnavailable, createSession, decideProposal, sendMessage, type AgentEvent, type ProposalChange } from "./agent-api";
import "./agent.css";

type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; tool: string; title?: string; args?: Record<string, unknown>; status: "running" | "ok" | "error"; summary?: string }
  | { kind: "proposal"; id: string; title: string; changes: ProposalChange[]; checks?: string[]; decision?: "approve" | "reject" | "pending"; error?: string }
  | { kind: "error"; text: string };

const show = (value: unknown) => (value === null || value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value));
/** 工具参数只摘要简单标量；身份编号与结构化内容（方案字段差异等）在各自卡片里展示，不摊开 JSON。 */
const argumentText = (args?: Record<string, unknown>) => Object.entries(args || {})
  .filter(([key, value]) => ["string", "number", "boolean"].includes(typeof value) && !/(^|_)id$/.test(key) && String(value).length <= 40)
  .map(([key, value]) => `${key}=${String(value)}`).join("  ");
type ToolItem = Extract<Item, { kind: "tool" }>;
/** 从 index 起连续的工具调用。 */
const toolRun = (items: Item[], index: number) => {
  const end = items.findIndex((item, position) => position > index && item.kind !== "tool");
  return items.slice(index, end === -1 ? items.length : end) as ToolItem[];
};
/** 连续的工具调用合成一组：进行中展开显示每一步，完成后收成一行“工具调用 · N 步”。 */
function ToolGroup({ tools }: { tools: ToolItem[] }) {
  const running = tools.some((tool) => tool.status === "running"), failed = tools.filter((tool) => tool.status === "error").length;
  const last = tools[tools.length - 1];
  return <details className="agent-tools-group" open={running || undefined}>
    <summary><Icon name="nav/plugin" /><b>工具调用 · {tools.length} 步</b><span>{running ? (last.title || last.tool) + " · 运行中" : failed ? `${failed} 步失败` : "完成"}</span></summary>
    <ol>{tools.map((tool) => <li key={tool.id} className={`agent-tool is-${tool.status}`}>
      <div className="agent-tool-head"><b>{tool.title || tool.tool}</b><span>{tool.status === "running" ? "运行中" : tool.status === "ok" ? "完成" : "失败"}</span></div>
      {argumentText(tool.args) && <code>{argumentText(tool.args)}</code>}
      {tool.summary && <p>{tool.summary}</p>}
    </li>)}</ol>
  </details>;
}
const SUGGESTIONS = ["解释这个研究的结论和主要限制因素", "土壤热阻率改成 1.2 K·m/W 会怎样？", "检查这个研究还缺哪些输入"];

/**
 * Agent 面板：与工作台同一套工具（由插件能力生成）。对话里每次工具调用显示为卡片，
 * 修改只以“方案”出现，列出字段级前后值，由人批准或拒绝；数值只来自工具结果。
 */
export function AgentPanel({ workspaceId, studyId, context, suggestions = SUGGESTIONS }: { workspaceId: string; studyId?: string; context: string; suggestions?: string[] }) {
  const status = useQuery({ queryKey: ["agent-status"], queryFn: ({ signal }) => agentStatus(signal), retry: false, staleTime: 60_000 });
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const session = useRef<string | null>(null);
  const unavailable = status.error instanceof AgentUnavailable;
  const ready = !!status.data?.configured;

  const apply = (event: AgentEvent) => setItems((current) => {
    const next = [...current];
    const last = next.at(-1);
    if (event.type === "message.delta") {
      if (last?.kind === "assistant") next[next.length - 1] = { ...last, text: last.text + event.text };
      else next.push({ kind: "assistant", text: event.text });
    } else if (event.type === "tool.call") next.push({ kind: "tool", id: event.id, tool: event.tool, title: event.title, args: event.arguments, status: "running" });
    else if (event.type === "tool.result") {
      const index = next.findIndex((item) => item.kind === "tool" && item.id === event.id);
      if (index >= 0) next[index] = { ...(next[index] as Extract<Item, { kind: "tool" }>), status: event.status, summary: event.summary };
    } else if (event.type === "proposal.created") next.push({ kind: "proposal", id: event.id, title: event.title, changes: event.changes, checks: event.checks });
    else if (event.type === "error") next.push({ kind: "error", text: event.message });
    return next;
  });

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setDraft(""); setSending(true);
    setItems((current) => [...current, { kind: "user", text: content }]);
    try {
      session.current ||= (await createSession(workspaceId, studyId)).id;
      await sendMessage(session.current, content, apply);
    } catch (error) {
      setItems((current) => [...current, { kind: "error", text: error instanceof Error ? error.message : String(error) }]);
    } finally { setSending(false); }
  }

  async function decide(id: string, decision: "approve" | "reject") {
    setItems((current) => current.map((item) => item.kind === "proposal" && item.id === id ? { ...item, decision: "pending", error: undefined } : item));
    try {
      await decideProposal(id, decision);
      setItems((current) => current.map((item) => item.kind === "proposal" && item.id === id ? { ...item, decision } : item));
    } catch (error) {
      setItems((current) => current.map((item) => item.kind === "proposal" && item.id === id ? { ...item, decision: undefined, error: error instanceof Error ? error.message : String(error) } : item));
    }
  }

  return <section className="agent-panel" aria-label="Agent">
    <header className="agent-panel-head">
      <span className={`status-dot ${ready ? "is-ok" : "is-off"}`} />
      <span className="agent-panel-model">{ready ? status.data?.model || "已连接" : unavailable ? "服务尚未部署" : status.isPending ? "检查中" : "模型未配置"}</span>
      {items.length > 0 && <Button size="compact" variant="ghost" disabled={sending} onClick={() => { session.current = null; setItems([]); }}>新对话</Button>}
    </header>
    <div className="agent-transcript">
      {!items.length && <div className="agent-empty">
        <p>基于「{context}」工作。它调用的是工作台同一批模块和插件；任何修改都先给出方案，由你批准。</p>
        <div className="agent-suggestions">{suggestions.map((text) => <button key={text} type="button" disabled={!ready || sending} onClick={() => void send(text)}>{text}</button>)}</div>
      </div>}
      {items.map((item, index) => item.kind === "user" ? <p key={index} className="agent-user">{item.text}</p>
        : item.kind === "assistant" ? <p key={index} className="agent-assistant">{item.text}</p>
          : item.kind === "error" ? <p key={index} className="agent-error" role="alert">{item.text}</p>
            : item.kind === "tool" ? (items[index - 1]?.kind === "tool" ? null : <ToolGroup key={index} tools={toolRun(items, index)} />)
              : <div key={index} className="agent-proposal">
                <div className="agent-tool-head"><Icon name="action/edit" /><b>方案：{item.title}</b></div>
                <table><tbody>{item.changes.map((change) => <tr key={change.path}><th>{change.label}</th><td>{show(change.before)}</td><td aria-hidden="true">→</td><td><b>{show(change.after)}</b>{change.unit && ` ${change.unit}`}</td></tr>)}</tbody></table>
                {item.checks?.map((check) => <p key={check} className="agent-check">{check}</p>)}
                {item.error && <p className="agent-error">{item.error}</p>}
                {item.decision === "approve" ? <p className="agent-decision">已批准并写入</p> : item.decision === "reject" ? <p className="agent-decision">已拒绝</p>
                  : <div className="agent-proposal-actions"><Button size="compact" variant="primary" loading={item.decision === "pending"} onClick={() => void decide(item.id, "approve")}>批准</Button><Button size="compact" variant="ghost" disabled={item.decision === "pending"} onClick={() => void decide(item.id, "reject")}>拒绝</Button></div>}
              </div>)}
    </div>
    <form className="agent-composer-box" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
      <textarea value={draft} disabled={!ready || sending} aria-label="给 Agent 的任务" placeholder={ready ? "描述任务，如：把回路间距加大到 0.3 m，看看载流量" : "Agent 模型连接后可用"}
        onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft); } }} />
      <Button type="submit" size="compact" variant="primary" disabled={!ready || !draft.trim()} loading={sending}>发送</Button>
    </form>
  </section>;
}
