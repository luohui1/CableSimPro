// The Agent's tools are the platform's read-only tools and nothing else. A call goes to the platform, which runs it through its own
// broker (argument contract, session scope, budget, audit); what comes back is what the model reads. The numbers a card shows are
// read from the platform by the page, never relayed through the model.
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { Schema } from '@earendil-works/pi-schema';
import { failureText, scrubValue, shortened } from '../host/agent-tools.ts';
import { Backend, BackendError, type BackendTool, type ToolResult } from './backend.ts';
import { describeResult, remember } from './cards.ts';

interface Entry { session: string; turn: string }

/** One question's sessions on the platform: a session and turn for each project it touches, opened when first needed and closed when
 *  the answer is done. A question gets sessions of its own so the project's revision is the one in force when it was asked. */
export class ScopeBook {
  #backend: Backend;
  #message: string;
  #open = new Map<string, Promise<Entry>>();

  constructor(backend: Backend, message: string) {
    this.#backend = backend;
    this.#message = message;
  }

  for(workspace: string): Promise<Entry> {
    let entry = this.#open.get(workspace);
    if (!entry) {
      // Only the session and turn: the call the platform's contract takes has no other field.
      entry = this.#backend.open(workspace, this.#message).then(({ session, turn }) => ({ session, turn }));
      this.#open.set(workspace, entry);
      entry.catch(() => this.#open.delete(workspace));
    }
    return entry;
  }

  async close(): Promise<void> {
    const entries = await Promise.all([...this.#open.values()].map(entry => entry.catch(() => undefined)));
    this.#open.clear();
    await Promise.allSettled(entries.flatMap(entry => (entry ? [this.#backend.finish(entry.session, entry.turn)] : [])));
  }
}

/** The tool's schema as the model sees it: a project's tools take the project (its id, from a card's parent or the project list). */
function modelSchema(tool: BackendTool): Schema {
  if (tool.scope !== 'workspace') return tool.parameters;
  const parameters = structuredClone(tool.parameters) as unknown as { properties: Record<string, unknown>; required?: string[] };
  parameters.properties = { workspace_id: { type: 'string', description: '工程 ID：对象名片里 parent 的 id，或 workspace_list 返回的 id。' }, ...parameters.properties };
  parameters.required = ['workspace_id', ...(parameters.required ?? [])];
  return parameters as unknown as Schema;
}

/** What the model reads of a result: the summary, the data, why it failed and what to do next; no execution or artifact bookkeeping. */
function brief(result: ToolResult): Record<string, unknown> {
  return {
    summary: result.summary,
    ...(Object.keys(result.data).length ? { data: result.data } : {}),
    ...(result.diagnostics.length ? { diagnostics: result.diagnostics.map(({ code, message, path }) => ({ code, message, ...(path ? { path } : {}) })) } : {}),
    ...(result.next_actions.length ? { next_actions: result.next_actions } : {}),
  };
}

/** The names of the methods, by their sealed identity: the model is given a name to say, never an identifier to repeat. */
let methodNames: { at: number; names: Map<string, string> } | undefined;
async function namesOfMethods(backend: Backend): Promise<Map<string, string>> {
  if (methodNames && Date.now() - methodNames.at < 300_000) return methodNames.names;
  try {
    const rows = await backend.read<{ method: { plugin_id: string }; name: string }[]>('/api/methods?view=summary');
    methodNames = { at: Date.now(), names: new Map(rows.map(row => [row.method.plugin_id, row.name])) };
  } catch {
    methodNames ??= { at: 0, names: new Map() };
  }
  return methodNames.names;
}

/** A method's identity in a result (its plugin identifier and release digest) becomes its name and version. */
function named(value: unknown, names: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map(item => named(item, names));
  if (!value || typeof value !== 'object') return value;
  const converted = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, named(item, names)])) as Record<string, unknown>;
  if (typeof converted.plugin_id !== 'string') return converted;
  const { plugin_id: identity, release_digest: _digest, ...rest } = converted;
  const name = names.get(identity as string);
  return { ...rest, method_name: name ? `${name}${typeof rest.version === 'string' ? ' ' + rest.version : ''}` : '某个方法' };
}

const refusalText = (result: ToolResult) => [result.summary, ...result.diagnostics.map(item => item.message).filter(message => message !== result.summary), ...result.next_actions].join(' ');

export function backendTools(backend: Backend, catalog: readonly BackendTool[], scopes: () => ScopeBook, roots: string[]): ToolDefinition[] {
  return catalog.map(tool => ({
    name: tool.name, label: tool.title, description: tool.description, parameters: modelSchema(tool) as unknown as ToolDefinition['parameters'],
    executionMode: 'sequential' as const,
    execute: async (_id: string, params: Record<string, unknown>, signal: AbortSignal | undefined) => {
      try {
        const { workspace_id, ...rest } = params;
        const workspace = tool.scope === 'workspace' ? String(workspace_id ?? '') : tool.scope === 'type' ? String(rest.type_id ?? '') : undefined;
        if (tool.scope !== 'global' && !workspace) throw new BackendError('INPUT_INVALID', '缺少工程 ID。', 422);
        const scope = workspace ? await scopes().for(workspace) : undefined;
        const result = await backend.call({ tool: tool.name, arguments: rest, ...(scope ?? {}) }, signal);
        remember(tool.name, result);
        if (result.status === 'error') throw new BackendError('TOOL_REFUSED', refusalText(result), 422);
        const shown = await describeResult(backend, tool.name, rest, result, workspace, signal);
        const told = JSON.stringify(scrubValue(named(brief(result), await namesOfMethods(backend)), roots)) ?? 'null';
        return { content: [{ type: 'text' as const, text: shortened(told) }], details: shown };
      } catch (error) {
        throw new Error(failureText(error, roots));
      }
    },
  } satisfies ToolDefinition));
}
