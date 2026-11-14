import type { AgentStatus, Issue, LibraryEntry, Proposal, ProjectMeta, ProjectView, RunRecord, StudioEvent, Task } from '../shared/types.ts';

export class ApiError extends Error {
  issue: Issue;
  status: number;

  constructor(issue: Issue, status: number) {
    super(issue.message);
    this.issue = issue;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
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
  agent: (project: string) => request<{ status: AgentStatus; tasks: Task[]; proposals: Proposal[] }>(`/api/projects/${project}/agent`),
  instruct: (project: string, instruction: string, context?: string) => post<Task>(`/api/projects/${project}/agent/instruct`, { instruction, context }),
  stop: (project: string) => post(`/api/projects/${project}/agent/stop`),
  decide: (proposal: string, accept: boolean, note?: string) => post<Proposal>(`/api/proposals/${proposal}/decision`, { accept, note }),
};

export function subscribe(listener: (event: StudioEvent) => void): () => void {
  const source = new EventSource('/api/events');
  source.onmessage = message => listener(JSON.parse(message.data) as StudioEvent);
  return () => source.close();
}
