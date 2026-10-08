/**
 * Agent 接口约定（前后端共用，后端由 harness 实现）：
 * - GET  /api/agent/status → { configured, model?, tools }
 * - GET  /api/agent/tools → AgentTool[]（工具注册表：宿主工具 + 由插件清单生成的工具）
 * - GET  /api/agent/sessions?workspace_id= → AgentSessionSummary[]（任务列表，新到旧）
 * - POST /api/agent/sessions { workspace_id, study_id? } → { id }
 * - GET  /api/agent/sessions/{id} → AgentRecord（完整审计记录，重开任务时据此还原对话）
 * - POST /api/agent/sessions/{id}/messages { content } → text/event-stream，事件见 AgentEvent
 * - POST /api/agent/proposals/{id}/approve | reject → { status }
 * 写操作只以“方案”出现，批准由人在界面完成；密钥从不经过前端。
 */
export type AgentStatus = { configured: boolean; model?: string; tools?: number };
/** kind：read 只读；propose 只生成方案；run 运行（正式运行与超算提交要人批准）。 */
export type AgentTool = { name: string; title: string; kind: "read" | "propose" | "run"; description?: string; plugin_id?: string; hpc?: boolean };
export type ProposalChange ={ path: string; label: string; before: unknown; after: unknown; unit?: string };
export type AgentEvent =
  | { type: "message.delta"; text: string }
  | { type: "tool.call"; id: string; tool: string; title?: string; arguments?: Record<string, unknown> }
  | { type: "tool.result"; id: string; status: "ok" | "error"; summary: string; next_actions?: string[] }
  | { type: "proposal.created"; id: string; title: string; changes: ProposalChange[]; checks?: string[] }
  | { type: "error"; code?: string; message: string }
  | { type: "done"; usage?: { prompt_tokens?: number; completion_tokens?: number } };

export type AgentSessionSummary = { id: string; workspace_id: string; study_id: string | null; state: string; waiting_reason: string | null; title: string; created: string; updated: string; pending_proposals: number };
export type AgentProposal = { id: string; title: string; changes: ProposalChange[]; checks?: string[]; status: "pending" | "approved" | "rejected" };
export type AgentStepRecord = { node_id: string; tool: string; arguments: Record<string, unknown> | null; result: { status: string; summary: string; data: Record<string, unknown> } | null; elapsed_ms: number | null };
export type AgentRecord = {
  id: string; workspace_id: string; study_id: string | null; state: string; waiting_reason: string | null; created: string; updated: string;
  proposals: AgentProposal[]; steps: AgentStepRecord[]; events: { sequence: number; type: string; created: string; data: Record<string, unknown> }[];
};

export class AgentUnavailable extends Error {}

/** 服务端错误只取人能读的说明（FastAPI 的 detail 或 detail.message），不把 JSON 原样摆给人看。 */
async function failure(response: Response) {
  const body = await response.text();
  try {
    const detail = (JSON.parse(body) as { detail?: unknown }).detail;
    if (typeof detail === "string") return new Error(detail);
    if (detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string") return new Error((detail as { message: string }).message);
  } catch { /* 非 JSON 正文按原文显示 */ }
  return new Error(body || `请求失败（${response.status}）`);
}

async function json<T>(response: Response): Promise<T> {
  if (response.status === 404 && response.url.endsWith("/api/agent/status")) throw new AgentUnavailable("Agent 服务尚未部署");
  if (!response.ok) throw await failure(response);
  return response.json() as Promise<T>;
}

export const agentStatus = (signal?: AbortSignal) => fetch("/api/agent/status", { signal }).then((response) => json<AgentStatus>(response));

/** 宿主审过的工程配方（结论汇总、检查缺项、方案试算对比……）；模型按配方编排既有工具，权限不放宽。 */
export type AgentRecipe = { id: string; name: string; description: string; parameters: Record<string, unknown> };
export const agentRecipes = (signal?: AbortSignal) => fetch("/api/agent/recipes", { signal }).then((response) => json<AgentRecipe[]>(response));

export const agentTools = (signal?: AbortSignal) => fetch("/api/agent/tools", { signal }).then((response) => json<AgentTool[]>(response));

/** 模型设置：密钥只写不读，响应里只有是否已保存、末四位与存放位置。 */
export type AgentSettings = {
  source: "settings" | "environment" | "none"; base_url: string; model: string; has_key: boolean; key_hint: string | null;
  key_source: "system" | "memory" | "environment" | null; key_storage: "system" | "memory"; configured: boolean;
  instructions: string; model_timeout_s: number | null; environment: { base_url: boolean; model: boolean; api_key: boolean };
};
export type AgentSettingsUpdate = { base_url: string; model: string; api_key?: string; instructions: string; model_timeout_s: number | null };
export type AgentProbe = { ok: boolean; latency_ms?: number; model?: string; code?: string; message?: string };
const sendJson = (method: string, body?: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
export const agentSettings = (signal?: AbortSignal) => fetch("/api/agent/settings", { signal }).then((response) => json<AgentSettings>(response));
export const saveAgentSettings = (body: AgentSettingsUpdate) => fetch("/api/agent/settings", sendJson("PUT", body)).then((response) => json<AgentSettings>(response));
export const resetAgentSettings = () => fetch("/api/agent/settings", { method: "DELETE" }).then((response) => json<AgentSettings>(response));
export const testAgentSettings = (body: { base_url?: string; model?: string; api_key?: string }) => fetch("/api/agent/settings/test", sendJson("POST", body)).then((response) => json<AgentProbe>(response));

export const agentSessions = (workspaceId?: string, signal?: AbortSignal) =>
  fetch(`/api/agent/sessions${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ""}`, { signal }).then((response) => json<AgentSessionSummary[]>(response));

export const agentSession = (id: string, signal?: AbortSignal) =>
  fetch(`/api/agent/sessions/${encodeURIComponent(id)}`, { signal }).then((response) => json<AgentRecord>(response));

export const createSession =(workspaceId: string, studyId?: string) =>
  fetch("/api/agent/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: workspaceId, study_id: studyId }) })
    .then((response) => json<{ id: string }>(response));

export const decideProposal = (id: string, decision: "approve" | "reject") =>
  fetch(`/api/agent/proposals/${encodeURIComponent(id)}/${decision}`, { method: "POST" }).then((response) => json<{ status: string }>(response));

/** 发送一条消息并逐个回调服务器推送的事件（SSE：event: 类型，data: JSON）。 */
export async function sendMessage(sessionId: string, content: string, onEvent: (event: AgentEvent) => void, signal?: AbortSignal) {
  const response = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ content }), signal,
  });
  if (!response.ok || !response.body) throw await failure(response);
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
