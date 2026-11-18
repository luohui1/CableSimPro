// The platform as the sidecar sees it: its tools, proposals, the session and turn each question runs in, and which
// model it holds. Every call carries the shared token; the model key is never on this side (model requests go to the platform's
// own proxy, which adds it).
import type { Schema } from '@earendil-works/pi-schema';
import type { StructureAttachment } from '../shared/fusion-types.ts';

export interface Diagnostic { code: string; message: string; path?: string | null; recoverable?: boolean }
export interface ToolResult {
  status: 'ok' | 'error';
  summary: string;
  data: Record<string, any>;
  diagnostics: Diagnostic[];
  next_actions: string[];
  /** Digest of the complete audited data, for read-only result pagination. */
  result_digest?: string;
}
export type Scope = 'global' | 'workspace' | 'type';
export interface BackendTool { name: string; title: string; kind: string; scope: Scope; description: string; parameters: Schema }
export interface Opened { session: string; turn: string; context: { kind: 'project' | 'type'; id: string } }
export interface BackendModel {
  configured: boolean; source: string; model: string | null; provider: string | null;
  context_window?: number | null;
  max_output_tokens?: number | null;
}
export interface BackendProposal {
  id: string;
  title: string;
  changes: { path: string; label: string; before: unknown; after: unknown; unit?: string | null }[];
  checks: string[];
  assumptions?: string[];
  status?: 'pending' | 'approved' | 'rejected';
}
export interface DecisionReceipt { status: 'approved' | 'rejected'; receipt?: Record<string, any> }
export interface ProposalState { proposal: BackendProposal; status: 'pending' | 'approved' | 'rejected'; receipt?: Record<string, any>; session?: string }
export interface WorkbenchContext { workspace_id: string; study_id?: string; label?: string }

export class BackendError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** What a failed request says, whichever shape the platform gave it (a coded detail, a validation list, plain text). */
function problem(body: any, status: number): BackendError {
  const detail = body?.detail ?? body?.error ?? body;
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && typeof detail.message === 'string') return new BackendError(String(detail.code ?? 'HOST_ERROR'), detail.message, status);
  if (Array.isArray(detail) && detail[0]?.msg) return new BackendError('INPUT_INVALID', String(detail[0].msg), status);
  return new BackendError('HOST_ERROR', typeof detail === 'string' ? detail : `老后端返回了 ${status}。`, status);
}

export class Backend {
  readonly url: string;
  readonly #token: string;

  constructor(url: string, token: string) {
    this.url = url.replace(/\/+$/, '');
    this.#token = token;
  }

  async #send<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; token?: boolean } = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.url + path, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers: { ...(init.token === false ? {} : { authorization: 'Bearer ' + this.#token }), ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: init.signal,
      });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new BackendError('BACKEND_UNREACHABLE', `连不上老后端（${this.url}）；请确认它在运行。`, 0);
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) throw problem(body, response.status);
    return body as T;
  }

  tools = () => this.#send<BackendTool[]>('/api/agent/external/tools');
  model = () => this.#send<BackendModel>('/internal/agent/model');
  open = (workspace_id: string, message: string, study_id?: string, conversation_id?: string) => this.#send<Opened>('/api/agent/external/sessions', { body: { workspace_id, message, ...(study_id ? { study_id } : {}), ...(conversation_id ? { conversation_id } : {}) } });
  stageAttachment = (conversation_id: string, filename: string, content_base64: string) =>
    this.#send<StructureAttachment>('/api/agent/external/attachments', { body: { conversation_id, filename, content_base64 } });
  resume = (session: string, message: string) => this.#send<Opened>(`/api/agent/external/sessions/${encodeURIComponent(session)}/resume`, { body: { message } });
  finish = (session: string, turn: string) => this.#send<{ finished: boolean }>(`/api/agent/external/sessions/${session}/turns/${turn}/finish`, { body: {} });
  call = (body: { tool: string; arguments: Record<string, unknown>; session?: string; turn?: string; discovery?: string }, signal?: AbortSignal) =>
    this.#send<ToolResult>('/api/agent/external/calls', { body, signal });
  /** Only the human decision HTTP handler calls this; it is never an Agent tool. */
  decide = (proposal: string, accept: boolean) => this.#send<DecisionReceipt>(`/api/agent/proposals/${encodeURIComponent(proposal)}/${accept ? 'approve' : 'reject'}`, { body: {} });
  proposal = (proposal: string, session: string) => this.#send<ProposalState>(`/api/agent/external/proposals/${encodeURIComponent(proposal)}?session=${encodeURIComponent(session)}`);
  /** A read of the platform's own public API (what a card shows), which needs no token. */
  read = <T>(path: string, signal?: AbortSignal) => this.#send<T>(path, { signal, token: false });
}
