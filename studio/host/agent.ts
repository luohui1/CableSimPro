// The agent is a colleague inside the workbench: pi's agent core, with the studio's own
// operations as its only tools. It has no file, shell or network tool. A change to the
// inputs stops in beforeToolCall until the engineer accepts or rejects it.
import { randomBytes } from 'node:crypto';
import { Agent, type AgentEvent, type AgentTool, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import { createModels, createProvider, envApiKeyAuth, type Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import type { AgentStatus, Proposal, Task, TaskStep } from '../shared/types.ts';
import { StudioError } from './core.ts';
import type { Operation, Studio } from './operations.ts';

export interface ModelRuntime {
  models: ReturnType<typeof createModels>;
  model: Model<any>;
  provider: string;
  thinking: ThinkingLevel;
}

/** Model access comes from the environment only; nothing is written to disk. */
export function modelFromEnvironment(env: NodeJS.ProcessEnv = process.env): ModelRuntime | null {
  const models = createModels();
  const thinking = (env.CABLE_STUDIO_MODEL_THINKING as ThinkingLevel | undefined) ?? 'off';
  if (env.CABLE_STUDIO_MODEL_BASE_URL && env.CABLE_STUDIO_MODEL_ID) {
    const model: Model<'openai-completions'> = {
      id: env.CABLE_STUDIO_MODEL_ID, name: env.CABLE_STUDIO_MODEL_ID, api: 'openai-completions', provider: 'cable-studio',
      baseUrl: env.CABLE_STUDIO_MODEL_BASE_URL, reasoning: thinking !== 'off', input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192,
    };
    models.setProvider(createProvider({
      id: 'cable-studio', name: 'OpenAI 兼容接口', baseUrl: env.CABLE_STUDIO_MODEL_BASE_URL,
      auth: { apiKey: envApiKeyAuth('Cable Studio 模型密钥', ['CABLE_STUDIO_MODEL_API_KEY']) },
      models: [model], api: openAICompletionsApi(),
    }));
    return { models, model, provider: new URL(env.CABLE_STUDIO_MODEL_BASE_URL).host, thinking };
  }
  if (env.DEEPSEEK_API_KEY) {
    models.setProvider(deepseekProvider());
    const model = models.getModel('deepseek', env.CABLE_STUDIO_MODEL_ID ?? 'deepseek-flash');
    if (model) return { models, model, provider: 'DeepSeek', thinking };
  }
  return null;
}

const NOT_CONFIGURED = '设置环境变量 DEEPSEEK_API_KEY，或设置 CABLE_STUDIO_MODEL_BASE_URL、CABLE_STUDIO_MODEL_ID、CABLE_STUDIO_MODEL_API_KEY（OpenAI 兼容接口）后重启。密钥只从环境变量读取，不写入磁盘。';

function systemPrompt(name: string, id: string): string {
  return `你是电缆载流量工程师的同事，在一套专业工作台软件里干活。当前工程：${name}（${id}）。

工作方式：
1. 先用 get_project 看清当前型号、敷设、工况和已有运行记录，再动手。
2. 只通过工具做事。所有数值必须来自工具返回的结果，不许自己估算、心算或凭经验给出电流、温度、损耗。工具没算出来就如实说没算出来，并转述拒绝的原因。
3. 改动输入（set_cable、set_installation、set_conditions、set_method）会先交给工程师审阅，可能被拒绝。一次调用只做一项有明确理由的改动；被拒绝后不要重复提同样的改动。
4. 计算（run_rating、run_sweep、run_selection）不改输入，直接生成不可改的运行记录，结果留在工作台里。扫描和选型不需要先改输入。
5. 工程条件不清楚就直接问，一次问清；不要替工程师假设埋深、土壤、负荷。
6. 做完后用两三句话交代：做了什么、看哪条运行记录、结论的可信分档（可交付 / 参考）以及需要工程师注意的地方。不要把结果表格抄一遍，工程师会在工作台里看。
7. 目前只有 IEC 60287 稳态载流量（地下直埋与排管）。超出范围的要求（暂态、空气中敷设、有限元等）直接说明还不支持。
8. 用简体中文。`;
}

function withoutProject(schema: any): object {
  const { project: _project, ...properties } = schema.properties ?? {};
  return { ...schema, properties, required: (schema.required ?? []).filter((key: string) => key !== 'project') };
}

interface Session { agent: Agent; task?: Task; rejected: Set<string> }
interface Waiting { proposal: Proposal; settle: (decision: { accept: boolean; note?: string }) => void }

export class AgentService {
  #studio: Studio;
  #runtime: ModelRuntime | null;
  #sessions = new Map<string, Session>();
  #tasks = new Map<string, Task[]>();
  #waiting = new Map<string, Waiting>();
  #decided: Proposal[] = [];

  constructor(studio: Studio, runtime: ModelRuntime | null = modelFromEnvironment()) {
    this.#studio = studio;
    this.#runtime = runtime;
  }

  status(): AgentStatus {
    return this.#runtime
      ? { configured: true, model: this.#runtime.model.id, provider: this.#runtime.provider }
      : { configured: false, hint: NOT_CONFIGURED };
  }

  tasks(project: string): Task[] {
    return this.#tasks.get(project) ?? [];
  }

  proposals(project: string): Proposal[] {
    return [...this.#waiting.values()].map(item => item.proposal).filter(proposal => proposal.project_id === project);
  }

  #publish(task: Task): void {
    this.#studio.emit({ type: 'task', task: structuredClone(task) });
  }

  #tools(project: string, session: () => Session): AgentTool<any>[] {
    return [...this.#studio.operations.values()].filter(operation => operation.tool).map(operation => ({
      name: operation.tool!, label: operation.title, description: operation.description,
      parameters: withoutProject(operation.parameters), executionMode: 'sequential' as const,
      execute: async (_id: string, params: Record<string, unknown>) => {
        try {
          const result: any = await this.#studio.invoke(operation.id, { ...params, project }, { by: 'agent', task_id: session().task?.id });
          return { content: [{ type: 'text' as const, text: JSON.stringify(operation.brief ? operation.brief(result) : result) }],
                   details: { run_id: typeof result?.id === 'string' && result.id.startsWith('run-') ? result.id : result?.run } };
        } catch (error) {
          if (error instanceof StudioError) throw new Error(error.message + (error.path ? `（字段 ${error.path}）` : ''));
          throw error;
        }
      },
    }));
  }

  #session(project: string): Session {
    const existing = this.#sessions.get(project);
    if (existing) return existing;
    const runtime = this.#runtime!;
    const meta = this.#studio.store.meta(project);
    const byTool = new Map<string, Operation>([...this.#studio.operations.values()].filter(op => op.tool).map(op => [op.tool!, op]));
    const session: Session = { rejected: new Set(), agent: undefined as unknown as Agent };
    session.agent = new Agent({
      initialState: { systemPrompt: systemPrompt(meta.name, project), model: runtime.model, thinkingLevel: runtime.thinking,
                      tools: this.#tools(project, () => session) },
      streamFn: runtime.models.streamSimple.bind(runtime.models),
      toolExecution: 'sequential',
      identity: { attribution: null },
      beforeToolCall: async ({ toolCall, args }, signal) => {
        const operation = byTool.get(toolCall.name);
        const task = session.task;
        if (!operation?.plan || operation.kind !== 'write' || !task) return undefined;
        let plan;
        try {
          plan = await operation.plan({ ...(args as object), project });
        } catch (error) {
          return { block: true, reason: error instanceof Error ? error.message : String(error) };
        }
        if (!plan.changes.length) return undefined;
        const parts = { ...this.#studio.store.parts(project), ...plan.parts };
        const { preview, issue } = await this.#studio.preview(this.#studio.store.meta(project).name, parts);
        const proposal: Proposal = { id: 'pr-' + randomBytes(4).toString('hex'), task_id: task.id, step_id: toolCall.id, project_id: project,
          operation: operation.id, title: operation.title, changes: plan.changes, preview, issue, status: 'pending' };
        const step = task.steps.find(item => item.id === toolCall.id);
        if (step) { step.status = 'waiting_review'; step.proposal_id = proposal.id; }
        task.status = 'waiting_review';
        this.#publish(task);
        const decision = await new Promise<{ accept: boolean; note?: string }>(resolve => {
          this.#waiting.set(proposal.id, { proposal, settle: resolve });
          signal?.addEventListener('abort', () => resolve({ accept: false, note: '任务已停止' }), { once: true });
          this.#studio.emit({ type: 'proposal', proposal });
        });
        this.#waiting.delete(proposal.id);
        proposal.status = decision.accept ? 'accepted' : 'rejected';
        proposal.note = decision.note;
        this.#decided.push(proposal);
        this.#studio.emit({ type: 'proposal', proposal });
        task.status = 'running';
        if (step) step.status = 'running';
        this.#publish(task);
        if (decision.accept) return undefined;
        session.rejected.add(toolCall.id);
        return { block: true, reason: `工程师拒绝了这项改动${decision.note ? '：' + decision.note : ''}。不要重复提出同样的改动；换一种做法，或说明情况后结束。` };
      },
    });
    session.agent.subscribe(event => this.#observe(session, byTool, event));
    this.#sessions.set(project, session);
    return session;
  }

  #observe(session: Session, byTool: Map<string, Operation>, event: AgentEvent): void {
    const task = session.task;
    if (!task) return;
    if (event.type === 'tool_execution_start') {
      const operation = byTool.get(event.toolName);
      const detail = Object.entries(event.args ?? {}).map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`).join('，');
      task.steps.push({ id: event.toolCallId, tool: event.toolName, label: operation?.title ?? event.toolName, detail, status: 'running' });
    } else if (event.type === 'tool_execution_end') {
      const step = task.steps.find(item => item.id === event.toolCallId);
      if (step) {
        const text = event.result?.content?.find((item: { type: string }) => item.type === 'text')?.text as string | undefined;
        step.status = session.rejected.has(event.toolCallId) ? 'rejected' : event.isError ? 'failed' : 'done';
        step.duration_ms = event.durationMs;
        step.run_id = event.result?.details?.run_id;
        step.result = step.status === 'done' ? this.#outcome(text) : text;
      }
    } else if (event.type === 'message_end' && event.message.role === 'assistant') {
      const text = event.message.content.filter(block => block.type === 'text').map(block => (block as { text: string }).text).join('').trim();
      if (text) task.reply = text;
      if (event.message.stopReason === 'error' || event.message.stopReason === 'aborted') {
        task.error = event.message.stopReason === 'aborted' ? '任务已停止。' : `模型调用失败：${event.message.errorMessage ?? '未知错误'}`;
      }
    } else if (event.type === 'agent_end') {
      task.status = task.error ? (task.error === '任务已停止。' ? 'stopped' : 'failed') : 'done';
      task.finished = new Date().toISOString();
      session.task = undefined;
    } else {
      return;
    }
    this.#publish(task);
  }

  /** One line for the task panel; the full result is in the workbench. */
  #outcome(text: string | undefined): string | undefined {
    if (!text) return undefined;
    try {
      const value = JSON.parse(text);
      if (value?.title) return value.title;
      if (Array.isArray(value?.applied)) return value.applied.length ? value.applied.join('；') : '无变化';
      if (value?.name && value?.cable) return `${value.cable.name} · ${value.installation.layout_label}`;
      if (Array.isArray(value)) return `${value.length} 项`;
    } catch { /* plain text result */ }
    return text.length > 80 ? text.slice(0, 80) + '…' : text;
  }

  instruct(project: string, instruction: string, context?: string): Task {
    if (!this.#runtime) throw new StudioError({ code: 'MODEL_NOT_CONFIGURED', message: '模型未配置。' + NOT_CONFIGURED }, 409);
    const session = this.#session(project);
    if (session.task) throw new StudioError({ code: 'AGENT_BUSY', message: 'Agent 正在做上一件事；等它做完，或先停止。' }, 409);
    const task: Task = { id: 't-' + randomBytes(4).toString('hex'), project_id: project, instruction, context, status: 'running',
                         created: new Date().toISOString(), steps: [] };
    session.task = task;
    this.#tasks.set(project, [task, ...this.tasks(project)].slice(0, 30));
    this.#publish(task);
    const prompt = context ? `${instruction}\n\n（工程师当前选中的对象：${context}）` : instruction;
    session.agent.prompt(prompt).catch(error => {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      task.finished = new Date().toISOString();
      session.task = undefined;
      this.#publish(task);
    });
    return task;
  }

  decide(proposalId: string, accept: boolean, note?: string): Proposal {
    const waiting = this.#waiting.get(proposalId);
    if (!waiting) throw new StudioError({ code: 'PROPOSAL_UNKNOWN', message: '这项改动已经处理过，或已不存在。' }, 404);
    waiting.settle({ accept, note });
    return { ...waiting.proposal, status: accept ? 'accepted' : 'rejected', note };
  }

  stop(project: string): void {
    this.#sessions.get(project)?.agent.abort();
  }

  /** Resolves when the project's agent has no task in flight (used by tests). */
  async idle(project: string): Promise<void> {
    await this.#sessions.get(project)?.agent.waitForIdle();
  }
}
