// The Agent's tools are the platform's tools and nothing else. A call goes to the platform, which runs it through its own
// broker (argument contract, session scope, budget, audit); what comes back is what the model reads. The numbers a card shows are
// read from the platform by the page, never relayed through the model.
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { randomUUID } from 'node:crypto';
import type { Schema } from '@earendil-works/pi-schema';
import { failureText, scrubValue } from '../host/agent-tools.ts';
import { Backend, BackendError, type BackendProposal, type BackendTool, type ToolResult, type WorkbenchContext } from './backend.ts';
import { describeResult, remember } from './cards.ts';

export interface Entry { session: string; turn: string }
export interface AdoptedScopes { types: Set<string>; studies: Map<string, string> }
export interface ReviewCall {
  id: string;
  tool: BackendTool;
  proposal: BackendProposal;
  workspace: string;
  scope: Entry;
  signal?: AbortSignal;
}
export interface ReviewDecision { accepted: boolean; receipt?: Record<string, any>; note?: string; error?: string }
export type ReviewGate = (call: ReviewCall) => Promise<ReviewDecision>;

/** One question's sessions on the platform: a session and turn for each project it touches, opened when first needed and closed when
 *  the answer is done. A question gets sessions of its own so the project's revision is the one in force when it was asked. */
export class ScopeBook {
  #backend: Backend;
  #message: string;
  #open = new Map<string, Promise<Entry>>();
  #adopted: AdoptedScopes;
  #onAdopt: () => void;
  readonly context?: WorkbenchContext;
  readonly discovery = randomUUID();

  constructor(backend: Backend, message: string, context?: WorkbenchContext,
    adopted: AdoptedScopes = { types: new Set(), studies: new Map() }, onAdopt: () => void = () => undefined) {
    this.#backend = backend;
    this.#message = message;
    this.context = context;
    this.#adopted = adopted;
    this.#onAdopt = onAdopt;
  }

  for(workspace: string): Promise<Entry> {
    let entry = this.#open.get(workspace);
    if (!entry) {
      // Only the session and turn: the call the platform's contract takes has no other field.
      const study = this.#adopted.studies.get(workspace) ?? (this.context?.workspace_id === workspace ? this.context.study_id : undefined);
      entry = this.#backend.open(workspace, this.#message, study).then(({ session, turn }) => ({ session, turn }));
      this.#open.set(workspace, entry);
      entry.catch(() => this.#open.delete(workspace));
    }
    return entry;
  }

  /** A pending proposal ended its turn. The same session keeps its scope, budget and adopted revision after the person's decision. */
  async resume(workspace: string): Promise<void> {
    const entry = await this.for(workspace);
    const next = await this.#backend.resume(entry.session, this.#message);
    entry.turn = next.turn;
  }

  assertTarget(workspace: string, tool: BackendTool): void {
    if (tool.kind !== 'read' && this.context && this.context.workspace_id !== workspace && !this.#adopted.types.has(workspace)) {
      throw new BackendError('SCOPE_VIOLATION', '当前对话绑定了另一个工作台对象；请在目标工程或型号中另开对话后提出改动。', 403);
    }
  }

  async adoptCreated(receipt: Record<string, any>): Promise<void> {
    if (receipt.kind === 'type' && typeof receipt.type_id === 'string' && receipt.workspace_id === receipt.type_id) {
      this.#adopted.types.add(receipt.type_id);
      this.#onAdopt();
    }
    if (receipt.kind === 'study' && typeof receipt.workspace_id === 'string' && typeof receipt.study_id === 'string') {
      const workspace = receipt.workspace_id;
      const prior = this.#adopted.studies.get(workspace) ?? (this.context?.workspace_id === workspace ? this.context.study_id : undefined);
      if (prior && prior !== receipt.study_id) {
        // A clone accepted in a study-bound conversation is a new object. End the original scope and explicitly open the accepted
        // study on the next call; never broaden the backend's study boundary to allow a foreign study in the original session.
        const current = this.#open.get(workspace);
        if (current) { const entry = await current; await this.#backend.finish(entry.session, entry.turn); this.#open.delete(workspace); }
        this.#adopted.studies.set(workspace, receipt.study_id);
        this.#onAdopt();
      }
    }
  }

  async close(): Promise<void> {
    const entries = await Promise.all([...this.#open.values()].map(entry => entry.catch(() => undefined)));
    this.#open.clear();
    await Promise.allSettled(entries.flatMap(entry => (entry ? [this.#backend.finish(entry.session, entry.turn)] : [])));
  }
}

/** The tool's schema as the model sees it: a project's tools take the project (its id, from a card's parent or the project list). */
function modelSchema(tool: BackendTool): Schema {
  if (tool.scope === 'global') return tool.parameters;
  const parameters = structuredClone(tool.parameters) as unknown as { properties: Record<string, unknown>; required?: string[] };
  const field = tool.scope === 'type' ? 'type_id' : 'workspace_id';
  parameters.properties = { [field]: { type: 'string', description: tool.scope === 'type' ? '准确的型号设计工作区 ID，来自 type_read 或新建型号回执。' : '工程 ID：对象名片里 parent 的 id，或 workspace_list 返回的 id。' }, ...parameters.properties };
  parameters.required = [...new Set([field, ...(parameters.required ?? [])])];
  return parameters as unknown as Schema;
}

/** What the model reads of a result: the summary, the data, why it failed and what to do next; no execution or artifact bookkeeping. */
function brief(result: ToolResult): Record<string, unknown> {
  return {
    status: result.status, summary: result.summary,
    ...(Object.keys(result.data).length ? { data: result.data } : {}),
    ...(result.diagnostics.length ? { diagnostics: result.diagnostics.map(({ code, message, path }) => ({ code, message, ...(path ? { path } : {}) })) } : {}),
    ...(result.next_actions.length ? { next_actions: result.next_actions } : {}),
  };
}

/** The names of the methods, by their sealed identity: the model is given a name to say, never an identifier to repeat. */
const methodNames = new WeakMap<Backend, { at: number; names: Map<string, string> }>();
async function namesOfMethods(backend: Backend): Promise<Map<string, string>> {
  const cached = methodNames.get(backend);
  if (cached && Date.now() - cached.at < 300_000) return cached.names;
  try {
    const rows = await backend.read<{ method: { plugin_id: string }; name: string }[]>('/api/methods?view=summary');
    const names = new Map(rows.map(row => [row.method.plugin_id, row.name]));
    methodNames.set(backend, { at: Date.now(), names });
    return names;
  } catch {
    return cached?.names ?? new Map();
  }
}

/** A method's identity in a result (its plugin identifier and release digest) becomes its name and version. */
function named(value: unknown, names: Map<string, string>, keepIdentity = false): unknown {
  if (Array.isArray(value)) return value.map(item => named(item, names, keepIdentity));
  if (!value || typeof value !== 'object') return value;
  const converted = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, named(item, names, keepIdentity)])) as Record<string, unknown>;
  if (typeof converted.plugin_id !== 'string') return converted;
  // This is an exact sealed input for a subsequent tool. An added display-only property would fail the backend's strict Method
  // schema if the model copies it; discovery records already carry human-readable names next to their identities.
  if (keepIdentity) return converted;
  const { plugin_id: identity, release_digest: _digest, ...rest } = converted;
  const name = names.get(identity as string);
  return { ...rest, method_name: name ? `${name}${typeof rest.version === 'string' ? ' ' + rest.version : ''}` : '某个方法' };
}

const refusalText = (result: ToolResult) => [result.summary, ...result.diagnostics.map(item => item.message).filter(message => message !== result.summary), ...result.next_actions].join(' ');

export function backendTools(backend: Backend, catalog: readonly BackendTool[], scopes: () => ScopeBook, roots: string[], review?: ReviewGate): ToolDefinition[] {
  return catalog.map(tool => ({
    name: tool.name, label: tool.title, description: tool.description, parameters: modelSchema(tool) as unknown as ToolDefinition['parameters'],
    executionMode: 'sequential' as const,
    execute: async (id: string, params: Record<string, unknown>, signal: AbortSignal | undefined) => {
      try {
        const { workspace_id, type_id, ...rest } = params;
        const declared = (tool.parameters as unknown as { properties?: Record<string, unknown> }).properties ?? {};
        if ('type_id' in declared && type_id !== undefined) rest.type_id = type_id;
        const workspace = tool.scope === 'workspace' ? String(workspace_id ?? '') : tool.scope === 'type' ? String(type_id ?? '') : undefined;
        if (tool.scope !== 'global' && !workspace) throw new BackendError('INPUT_INVALID', '缺少工程 ID。', 422);
        if (workspace) scopes().assertTarget(workspace, tool);
        const scope = workspace ? await scopes().for(workspace) : undefined;
        const result = await backend.call({ tool: tool.name, arguments: rest, ...(scope ?? { discovery: scopes().discovery }) }, signal);
        remember(tool.name, result);
        if (result.status === 'error') throw new BackendError('TOOL_REFUSED', refusalText(result), 422);
        if (result.data.proposal) {
          if (!review || !workspace || !scope) throw new BackendError('REVIEW_UNAVAILABLE', '这项改动尚未批准；请在对话中审阅后再执行。', 409);
          const decision = await review({ id, tool, proposal: result.data.proposal as BackendProposal, workspace, scope, signal });
          if (!signal?.aborted) await scopes().resume(workspace);
          if (decision.error) throw new BackendError('PROPOSAL_NOT_EXECUTED', decision.error, 409);
          if (!decision.accepted) throw new BackendError('PROPOSAL_REJECTED', `工程师拒绝了这项改动${decision.note ? '：' + decision.note : ''}；没有执行。不要重复提出同样的改动。`, 409);
          const receipt = decision.receipt ?? {};
          if (receipt.status === 'failed' || receipt.error) {
            throw new BackendError('PROPOSAL_NOT_EXECUTED', '已接受，但平台未完成执行：' + (receipt.error?.message ?? '请在工作台查看保存诊断；没有替代结果。'), 422);
          }
          await scopes().adoptCreated(receipt);
          result.data = { ...result.data, proposal: { ...result.data.proposal, status: 'approved' }, receipt };
          result.summary = '工程师已接受，平台返回了执行回执。请按回执确认结果；未核对、未发布的对象仍保持原状态。';
        }
        const shown = await describeResult(backend, tool.name, rest, result, workspace, signal);
        // Method discovery must retain the exact sealed identity the next tool requires; result-only prose uses method names.
        const keepIdentity = ['method_list', 'plugin_inspect', 'plugin_query', 'study_read'].includes(tool.name);
        const told = JSON.stringify(scrubValue(named(brief(result), await namesOfMethods(backend), keepIdentity), roots)) ?? 'null';
        // The backend owns bounded/paginated projections. Cutting serialized JSON breaks numeric evidence and can hide the
        // exact method identity required by the next step; preserve the complete structured result supplied by that contract.
        return { content: [{ type: 'text' as const, text: told }], details: shown };
      } catch (error) {
        throw new Error(failureText(error, roots));
      }
    },
  } satisfies ToolDefinition));
}
