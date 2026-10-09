import { ApiError } from "./client";

/**
 * 统一索引（FRONTEND_REQUIREMENTS §2.3，接口见 docs/architecture/host-inputs.md“统一索引”）：
 * 各类东西继续各自存储；这里只读同一张名片、关联与待办汇总。页面地址由 lib/object-link 按 kind 换算。
 */
export type ObjectKind = "project" | "study" | "type" | "cable_version" | "asset" | "run" | "job" | "delivery" | "plugin" | "validation" | "document" | "proposal" | "agent_task" | "input_snapshot";
export type ObjectStatus = { code: string; label: string; reason?: string | null };
export type ObjectCard = {
  kind: ObjectKind; id: string; name: string; version?: string | null; revision?: number | null; status: ObjectStatus;
  source?: { kind: string; label: string } | null; updated?: string | null; parent?: { kind: ObjectKind; id: string; name: string } | null; subtype?: string | null;
};
export type Relation = { role: string; target: ObjectCard; pinned?: { version?: string | null; revision?: number | null; digest?: string | null } | null; freshness: "current" | "outdated" | "unknown"; reason?: string | null };
export type Relations = { uses: Relation[]; used_by: Relation[]; unresolved: { role: string; freshness: "unknown"; reason: string }[] };
export type InboxItem = { category: "review" | "stale" | "missing" | "running"; origin: "agent" | "document" | "asset" | "type" | "study" | "job"; title: string; object: ObjectCard; reason: string; created?: string | null };
export type Inbox = { items: InboxItem[]; counts: { review: number; stale: number; missing: number; running: number } };

async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    let message = `读取失败（${response.status}）`;
    try {
      const detail = (await response.json() as { detail?: unknown }).detail;
      if (typeof detail === "string") message = detail;
      else if (detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string") message = (detail as { message: string }).message;
    } catch { /* 非 JSON 正文保留状态码说明 */ }
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export function indexObjects(filters: { kind?: ObjectKind; q?: string; limit?: number; offset?: number }, signal?: AbortSignal) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") query.set(key, String(value));
  return read<{ items: ObjectCard[]; total: number }>(`/api/index/objects?${query}`, signal);
}
export function objectRelations(kind: ObjectKind, id: string, signal?: AbortSignal) {
  return read<Relations>(`/api/index/objects/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/relations`, signal);
}
export function indexInbox(signal?: AbortSignal) {
  return read<Inbox>("/api/index/inbox", signal);
}
