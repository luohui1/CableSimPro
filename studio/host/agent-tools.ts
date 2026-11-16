// The agent's tools are the studio's operations and nothing else: a button and a tool call run the same code. The result the
// model reads is the operation's brief; the details kept in the session file are references and notes for the page, never numbers
// the model could have made up.
import { obj, str, type Schema } from '@earendil-works/pi-schema';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { StudioError } from './core.ts';
import type { Studio } from './operations.ts';

/** A result longer than this is cut: the model's context and the session file are not a place for a mesh or a table of hundreds of rows. */
const OUTPUT_LIMIT = 24_000;

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
        return { content: [{ type: 'text' as const, text: shortened(JSON.stringify(operation.brief ? operation.brief(result) : result) ?? 'null') }],
                 details: { ...(card ? { card } : {}), ...(notes?.length ? { notes } : {}) } };
      } catch (error) {
        if (error instanceof StudioError) throw new Error(error.message + (error.path ? `（字段 ${error.path}）` : ''));
        throw error;
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
    description: '读取一份技能的全文。path 写技能目录里列出的 location，或直接写技能名。只能读技能文件，读不了别的文件。',
    parameters: schema(obj({ path: str({ minLength: 1, description: '技能的 location，或技能名' }) })),
    execute: async (_id: string, params: { path: string }) => {
      const wanted = normal(params.path.trim());
      const skill = skills.find(item => item.name === params.path.trim() || normal(item.filePath) === wanted);
      if (!skill) throw new Error(`只能读取技能文件：${skills.map(item => item.name).join('、')}。`);
      return { content: [{ type: 'text' as const, text: read(skill.filePath) }], details: {} };
    },
  };
}
