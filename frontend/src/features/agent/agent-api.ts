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
import type { ObjectCard } from "@/api/object-index";

/** message.delta 的首个分片附带回答里提到的对象名片（统一索引），本条回答内保留。 */
export type AgentEvent =
  | { type: "message.delta"; text: string; object_refs?: ObjectCard[] }
  | { type: "tool.call"; id: string; tool: string; title?: string; arguments?: Record<string, unknown> }
  | { type: "tool.result"; id: string; status: "ok" | "error"; summary: string; next_actions?: string[] }
  | { type: "proposal.created"; id: string; title: string; changes: ProposalChange[]; checks?: string[]; kind?: string; base_revision?: number | null }
  | { type: "error"; code?: string; message: string }
  | { type: "done"; usage?: { prompt_tokens?: number; completion_tokens?: number } };

export type AgentSessionSummary = { id: string; workspace_id: string; study_id: string | null; state: string; waiting_reason: string | null; title: string; created: string; updated: string; pending_proposals: number };
export type AgentProposal = { id: string; title: string; changes: ProposalChange[]; checks?: string[]; status: "pending" | "approved" | "rejected"; base_revision?: number | null; kind?: string | null };
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
/** 配方按会话或工作区筛选：型号会话只列型号适用的配方（host-inputs.md）。 */
export const agentRecipes = (scope: { session?: string; workspace?: string }, signal?: AbortSignal) => {
  const query = scope.session ? `?session_id=${encodeURIComponent(scope.session)}` : scope.workspace ? `?workspace_id=${encodeURIComponent(scope.workspace)}` : "";
  return fetch("/api/agent/recipes" + query, { signal }).then((response) => json<AgentRecipe[]>(response));
};

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
export type MemorySettings = { enabled: boolean; recall_limit: number; available: boolean; code?: string | null; worker_error?: string | null; engineering_evidence: false };
export type AgentMemory = { id: string; workspace_id: string; study_id: string | null; kind: string; topic: string; content: string; revision: number; status: string; reason: string | null; updated: string; sources: { task_id: string; sequence: number }[] };
export const memorySettings = (signal?: AbortSignal) => fetch('/api/agent/memory/settings', { signal }).then(response => json<MemorySettings>(response));
export const saveMemorySettings = (body: { enabled: boolean; recall_limit: number }) => fetch('/api/agent/memory/settings', sendJson('PUT', body)).then(response => json<MemorySettings>(response));
export const agentMemories = (scope: { workspace_id: string; study_id?: string; q: string; offset: number }, signal?: AbortSignal) => fetch('/api/agent/memories?' + new URLSearchParams({ ...scope, offset: String(scope.offset), limit: '10' }), { signal }).then(response => json<{ items: AgentMemory[]; total: number }>(response));
export const correctMemory = (memory: AgentMemory, content: string) => fetch('/api/agent/memories/' + encodeURIComponent(memory.id), sendJson('PUT', { expected_revision: memory.revision, content })).then(response => json<AgentMemory>(response));
export const deleteMemory = (memory: AgentMemory) => fetch('/api/agent/memories/' + encodeURIComponent(memory.id) + '?expected_revision=' + memory.revision, { method: 'DELETE' }).then(response => json<AgentMemory>(response));
export const agentSettings = (signal?: AbortSignal) => fetch("/api/agent/settings", { signal }).then((response) => json<AgentSettings>(response));
export const saveAgentSettings = (body: AgentSettingsUpdate) => fetch("/api/agent/settings", sendJson("PUT", body)).then((response) => json<AgentSettings>(response));
export const resetAgentSettings = () => fetch("/api/agent/settings", { method: "DELETE" }).then((response) => json<AgentSettings>(response));
export const testAgentSettings = (body: { base_url?: string; model?: string; api_key?: string }) => fetch("/api/agent/settings/test", sendJson("POST", body)).then((response) => json<AgentProbe>(response));

export const agentSessions = (workspaceId?: string, signal?: AbortSignal) =>
  fetch(`/api/agent/sessions${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ""}`, { signal }).then((response) => json<AgentSessionSummary[]>(response));

export const agentSession = (id: string, signal?: AbortSignal) =>
  fetch(`/api/agent/sessions/${encodeURIComponent(id)}`, { signal }).then((response) => json<AgentRecord>(response));

export const createSession =(workspaceId: string, studyId?: string, signal?: AbortSignal) =>
  fetch("/api/agent/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: workspaceId, study_id: studyId }), signal })
    .then((response) => json<{ id: string }>(response));

export const decideProposal = (id: string, decision: "approve" | "reject") =>
  fetch(`/api/agent/proposals/${encodeURIComponent(id)}/${decision}`, { method: "POST" }).then((response) => json<{ status: string }>(response));

/** 发送一条消息并逐个回调服务器推送的事件（SSE：event: 类型，data: JSON）。 */
/** 宿主配方调用：带上它时宿主先按配方确定性执行工具步骤，再请模型作答一次（host-inputs.md）。 */
export type RecipeCall = { id: string; parameters: Record<string, unknown> };
export async function sendMessage(sessionId: string, content: string, onEvent: (event: AgentEvent) => void, signal?: AbortSignal, recipe?: RecipeCall, onAccepted?: () => void) {
  const response = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(recipe ? { content, recipe } : { content }), signal,
  });
  if (!response.ok) throw await failure(response);
  onAccepted?.();
  signal?.throwIfAborted();
  if (!response.body || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream')
    throw new Error('任务请求已接收，但对话连接没有返回事件流。请更新任务记录确认结果，勿重复发送。');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '', block: string[] = [], complete = false;
  const dispatch = () => {
    const type = block.find(line => line.startsWith('event:'))?.slice(6).trim();
    const data = block.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    block = [];
    if (!type || !data) return;
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('对话事件格式不完整，请更新任务记录确认结果。');
    onEvent({ ...value, type } as AgentEvent);
    if (type === 'done') complete = true;
  };
  const lines = (end = false) => {
    let boundary: number;
    while (!complete && (boundary = buffer.search(/[\r\n]/)) >= 0) {
      // A CRLF can straddle two transport chunks. Do not invent an empty line.
      if (!end && buffer[boundary] === '\r' && boundary === buffer.length - 1) return;
      const line = buffer.slice(0, boundary);
      const length = buffer[boundary] === '\r' && buffer[boundary + 1] === '\n' ? 2 : 1;
      buffer = buffer.slice(boundary + length);
      if (!line) dispatch(); else block.push(line);
    }
  };
  try {
    while (!complete) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) {
        lines(true);
        if (!complete) throw new Error('对话连接在完成回执前结束。已接收的内容仍保留，请更新任务记录确认服务端结果。');
        break;
      }
      buffer += value;
      lines();
    }
  } finally {
    // Releasing this reader only closes the browser transport; it never sends a server cancellation or repeats the task.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
