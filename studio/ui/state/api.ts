import type { AgentStatus, ChatAttachment, ChatSummary, ChatView, Issue, LibraryEntry, Proposal, ProjectMeta, ProjectView, RunRecord, StudioEvent } from '@shared/types';

export class ApiError extends Error {
  issue: Issue;
  status: number;

  constructor(issue: Issue, status: number) {
    super(issue.message);
    this.issue = issue;
    this.status = status;
  }
}

/** Where the host's API is: the same origin, or under a prefix when the page is shown inside another product (the Agent page of the fused one). */
const BASE: string = import.meta.env.VITE_API_BASE ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(BASE + path, init);
  } catch {
    throw new ApiError({ code: 'HOST_UNREACHABLE', message: '连不上本机服务，请确认 Cable Studio 仍在运行。' }, 0);
  }
  const body = await response.json().catch(() => ({ error: { code: 'INVALID_REPLY', message: '本机服务返回了无法读取的内容。' } }));
  if (!response.ok) throw new ApiError(body.error ?? { code: 'ERROR', message: `请求失败（${response.status}）。` }, response.status);
  return body as T;
}

const post = <T>(path: string, body: unknown = {}) =>
  request<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  status: () => request<{ agent: AgentStatus; home: string }>('/api/status'),
  projects: () => request<ProjectMeta[]>('/api/projects'),
  project: (id: string) => request<ProjectView>(`/api/projects/${id}`),
  library: () => request<LibraryEntry[]>('/api/library'),
  run: (project: string, run: string) => request<RunRecord>(`/api/projects/${project}/runs/${run}`),
  /** Every action of the workbench goes through the operation layer the agent also uses. */
  op: <T>(id: string, params: Record<string, unknown>) => post<T>(`/api/ops/${id}`, params),
  chats: () => request<ChatSummary[]>('/api/chat/sessions'),
  chat: (id: string) => request<ChatView>(`/api/chat/sessions/${id}`),
  /** Starts a conversation (no session yet), adds to one, or steers an agent that is busy. */
  send: (text: string, session?: string, attachments?: ChatAttachment[]) =>
    post<{ session: string; accepted: 'started' | 'steered' }>('/api/chat/messages', { session, text, attachments }),
  stop: (session: string) => post(`/api/chat/sessions/${session}/stop`),
  decide: (proposal: string, accept: boolean, note?: string) => post<Proposal>(`/api/proposals/${proposal}/decision`, { accept, note }),
  /** A structure table, kept on the host; the agent reads it by the identifier it gets back. */
  upload: async (file: File) => {
    const reply = await request<{ upload: string; file: string; size: number }>(`/api/uploads?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    return { upload: reply.upload, file: reply.file };
  },
};

/** onOpen runs when the connection is made again after it dropped, not on the first connection. */
export function subscribe(listener: (event: StudioEvent) => void, onOpen?: () => void): () => void {
  const source = new EventSource(BASE + '/api/events');
  let opened = false;
  source.onopen = () => {
    if (opened) onOpen?.();
    opened = true;
  };
  source.onmessage = message => listener(JSON.parse(message.data) as StudioEvent);
  return () => source.close();
}
