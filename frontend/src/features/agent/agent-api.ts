/**
 * Agent 接口约定（前后端共用，后端由 harness 实现）：
 * - GET  /api/agent/status → { configured, model?, tools }
 * - POST /api/agent/sessions { workspace_id, study_id? } → { id }
 * - POST /api/agent/sessions/{id}/messages { content } → text/event-stream，事件见 AgentEvent
 * - POST /api/agent/proposals/{id}/approve | reject → { status }
 * 写操作只以“方案”出现，批准由人在界面完成；密钥从不经过前端。
 */
export type AgentStatus = { configured: boolean; model?: string; tools?: number };
export type ProposalChange = { path: string; label: string; before: unknown; after: unknown; unit?: string };
export type AgentEvent =
  | { type: "message.delta"; text: string }
  | { type: "tool.call"; id: string; tool: string; title?: string; arguments?: Record<string, unknown> }
  | { type: "tool.result"; id: string; status: "ok" | "error"; summary: string; next_actions?: string[] }
  | { type: "proposal.created"; id: string; title: string; changes: ProposalChange[]; checks?: string[] }
  | { type: "error"; code?: string; message: string }
  | { type: "done"; usage?: { prompt_tokens?: number; completion_tokens?: number } };

export class AgentUnavailable extends Error {}

async function json<T>(response: Response): Promise<T> {
  if (response.status === 404) throw new AgentUnavailable("Agent 服务尚未部署");
  if (!response.ok) throw new Error((await response.text()) || `请求失败（${response.status}）`);
  return response.json() as Promise<T>;
}

export const agentStatus = (signal?: AbortSignal) => fetch("/api/agent/status", { signal }).then((response) => json<AgentStatus>(response));

export const createSession = (workspaceId: string, studyId?: string) =>
  fetch("/api/agent/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: workspaceId, study_id: studyId }) })
    .then((response) => json<{ id: string }>(response));

export const decideProposal = (id: string, decision: "approve" | "reject") =>
  fetch(`/api/agent/proposals/${encodeURIComponent(id)}/${decision}`, { method: "POST" }).then((response) => json<{ status: string }>(response));

/** 发送一条消息并逐个回调服务器推送的事件（SSE：event: 类型，data: JSON）。 */
export async function sendMessage(sessionId: string, content: string, onEvent: (event: AgentEvent) => void, signal?: AbortSignal) {
  const response = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ content }), signal,
  });
  if (response.status === 404) throw new AgentUnavailable("Agent 服务尚未部署");
  if (!response.ok || !response.body) throw new Error((await response.text()) || `请求失败（${response.status}）`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const type = /^event: *(.+)$/m.exec(block)?.[1]?.trim();
      const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (type && data) onEvent({ type, ...JSON.parse(data) } as AgentEvent);
    }
  }
}
