// The agent's tools are the studio's operations and nothing else: a button and a tool call run the same code. The result the
// model reads is the operation's brief; the details kept in the session file are references and notes for the page, never numbers
// the model could have made up.
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { str, type Schema } from '@earendil-works/pi-schema';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { StudioError } from './core.ts';
import type { Studio } from './operations.ts';

/** A result longer than this is cut: the model's context and the session file are not a place for a mesh or a table of hundreds of rows. */
const OUTPUT_LIMIT = 24_000;

const LOCAL = '〈本机路径〉';
/** The repository this runs from: two folders above this file's folder. */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** What can follow in a path: not a space, a quote, and not the punctuation that ends a Chinese clause, which is not written with a space after it. */
const TAIL = '[^"\\s<>|，。；：、（）【】「」“”‘’]*';

/** What the model is told never carries a path of this machine. The folders this machine is known to use (the studio's own, the
 *  repository, the home and temporary folders, whatever else the caller names) are replaced wherever they appear, with whatever
 *  path goes on from them, in whichever spelling; so is anything shaped like a drive path, a network share or a system folder. */
export function scrubPaths(text: string, roots: string[] = []): string {
  const known = [...new Set([...roots, REPO_ROOT, homedir(), tmpdir(), process.cwd()].map(root => root.replace(/[\\/]+$/, '')))]
    .filter(root => root.length >= 5).sort((a, b) => b.length - a.length);
  let out = text;
  for (const root of known) {
    const forward = root.replace(/\\/g, '/');
    const spellings = new Set([root, forward, forward.replace(/\//g, '\\'), forward.replace(/\//g, '\\\\')]);
    out = out.replace(new RegExp(`(?:${[...spellings].map(escaped).join('|')})(?:[\\\\/]${TAIL})?`, 'gi'), LOCAL);
  }
  return out
    .replace(new RegExp(`\\b[A-Za-z]:[\\\\/]${TAIL}`, 'g'), LOCAL)
    .replace(new RegExp(`\\\\\\\\[\\w.$-]+\\\\${TAIL}`, 'g'), LOCAL)
    // Not after a word, a dot, a colon, a slash or a hyphen: the path of a web address is not a path of this machine.
    .replace(new RegExp(`(?<![\\w.:/-])/(?:Users|home|root|tmp|var|opt|mnt|srv|data|__w|private|Volumes)/${TAIL}`, 'g'), LOCAL);
}

/** The same for every string inside a value, before the value is written out as JSON (written out, a backslash is doubled). */
export function scrubValue<T>(value: T, roots: string[] = []): T {
  if (typeof value === 'string') return scrubPaths(value, roots) as T;
  if (Array.isArray(value)) return value.map(item => scrubValue(item, roots)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [scrubPaths(key, roots), scrubValue(item, roots)])) as T;
  return value;
}

/** An error as the model is told it: the reason, the field it is about, and no path of this machine. */
export function failureText(error: unknown, roots: string[] = []): string {
  const message = error instanceof Error ? error.message : String(error);
  return scrubPaths(message + (error instanceof StudioError && error.path ? `（字段 ${error.path}）` : ''), roots);
}

const schema = (value: Schema) => value as unknown as ToolDefinition['parameters'];

export function shortened(text: string): string {
  return text.length <= OUTPUT_LIMIT ? text : `${text.slice(0, OUTPUT_LIMIT)}…（结果太长，已截断；请缩小范围再问）`;
}

/** One tool for every operation that has a tool name and that the agent may run. Calls run one at a time, in the order the model gives them. */
export function operationTools(studio: Studio, conversation: () => string): ToolDefinition[] {
  return studio.agentOperations().map(operation => ({
    name: operation.tool!, label: operation.title, description: operation.description, parameters: schema(operation.parameters),
    executionMode: 'sequential' as const,
    execute: async (_id: string, params: Record<string, unknown>, signal: AbortSignal | undefined) => {
      try {
        const result = await studio.invoke(operation.id, params, { by: 'agent', task_id: conversation(), signal });
        const card = operation.card?.(params, result);
        const notes = operation.notes?.(params, result);
        const told = JSON.stringify(scrubValue(operation.brief ? operation.brief(result) : result, [studio.home])) ?? 'null';
        return { content: [{ type: 'text' as const, text: shortened(told) }],
                 details: { ...(card ? { card } : {}), ...(notes?.length ? { notes } : {}) } };
      } catch (error) {
        throw new Error(failureText(error, [studio.home]));
      }
    },
  } satisfies ToolDefinition));
}

/** The one place the agent can read a file: the skill files it was told about. Anything else, including the repository's own
 *  conventions, is refused, so it does not depend on what the model asks for. */
export function skillReader(skills: { name: string; filePath: string }[], read: (path: string) => string): ToolDefinition {
  const normal = (path: string) => path.replace(/\\/g, '/').toLowerCase();
  return {
    name: 'read', label: '读取技能', executionMode: 'sequential',
    description: '读取技能；长文件按返回的 offset 续读。path 写技能的 location 或技能名。只能读技能文件，读不了别的文件。',
    parameters: schema({ type: 'object', properties: { path: str({ minLength: 1, description: '技能的 location，或技能名' }),
      offset: { type: 'integer', minimum: 0, description: '只在前一页返回续读位置时填写。' } }, required: ['path'], additionalProperties: false }),
    execute: async (_id: string, params: { path: string; offset?: number }) => {
      const wanted = normal(params.path.trim());
      const skill = skills.find(item => item.name === params.path.trim() || normal(item.filePath) === wanted);
      if (!skill) throw new Error(`只能读取技能文件：${skills.map(item => item.name).join('、')}。`);
      const text = read(skill.filePath);
      const offset = params.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) throw new Error('技能续读位置无效，请从 offset=0 重新读取。');
      let end = Math.min(offset + 4000, text.length);
      // Do not split a UTF-16 surrogate pair. The returned offset, not a model guess, identifies the next page.
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
      const more = end < text.length ? `\n\n【技能尚未读完；下一页 read(${JSON.stringify({ path: skill.name, offset: end })})。】` : '';
      return { content: [{ type: 'text' as const, text: text.slice(offset, end) + more }], details: {} };
    },
  };
}
