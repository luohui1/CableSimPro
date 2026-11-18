/** 老后端的模型与记忆设置。对话和提案由统一的 Agent 边车提供。 */
export type AgentStatus = { configured: boolean; model?: string; tools?: number };
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

/** 模型设置：密钥只写不读，响应里只有是否已保存、末四位与存放位置。 */
export type AgentSettings = {
  source: "settings" | "environment" | "none"; base_url: string; model: string; has_key: boolean; key_hint: string | null;
  key_source: "system" | "memory" | "environment" | null; key_storage: "system" | "memory"; configured: boolean;
  instructions: string; model_timeout_s: number | null; context_window: number | null; max_output_tokens: number | null;
  environment: { base_url: boolean; model: boolean; api_key: boolean };
};
export type AgentSettingsUpdate = { base_url: string; model: string; api_key?: string; instructions: string; model_timeout_s: number | null;
  context_window?: number | null; max_output_tokens?: number | null };
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
