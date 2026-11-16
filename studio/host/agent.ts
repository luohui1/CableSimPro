// The agent is a colleague inside the studio. Its core is pi's session layer with every built-in tool switched off: the tools it
// has are the studio's own operations and a reader that opens nothing but the skill files. A write waits in a gate until the
// engineer accepts or rejects it. Conversations are pi's session files under <home>/agent, so they survive a restart.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import { createProvider, envApiKeyAuth, InMemoryCredentialStore, type Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import type { AgentSession, ExtensionFactory, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import type { AgentStatus, ChatAttachment, ChatSummary, ChatView, Proposal } from '../shared/types.ts';
import { operationTools, skillReader } from './agent-tools.ts';
import { attachmentNote, chatMessages, plainText, titleOf, type PiMessage } from './chat-view.ts';
import { StudioError } from './core.ts';
import type { Operation, Studio } from './operations.ts';

const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(STUDIO, 'skills');
const PROPOSAL_ENTRY = 'cable-studio.proposal';

/** pi's system prompt with the working folder dropped and each skill's location replaced by its name. */
export function noPaths(prompt: string): string {
  return prompt
    .replace(/\n*<cwd>[\s\S]*?<\/cwd>\n*/, '\n')
    .replace(/(<name>([^<]+)<\/name>[\s\S]*?<location>)[^<]*(<\/location>)/g, '$1$2$3')
    .replace('Use absolute paths in tool calls.', 'Call the read tool with the skill name.');
}

/** The skills' names in Chinese (what comes before the first full-width colon of their description), read without the session layer so a
 *  conversation opened from its file can name them too. */
function skillTitles(dir: string): Map<string, string> {
  const titles = new Map<string, string>();
  if (!existsSync(dir)) return titles;
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, 'SKILL.md');
    const description = existsSync(file) ? /^description:\s*(.+)$/m.exec(readFileSync(file, 'utf-8'))?.[1] : undefined;
    if (description) titles.set(name, description.split('：')[0]);
  }
  return titles;
}

export interface ModelConfig {
  models: ModelRuntime;
  model: Model<any>;
  provider: string;
  thinking: ThinkingLevel;
}
export interface ModelIdentity { model: string; provider: string; thinking: ThinkingLevel }

const NOT_CONFIGURED = '设置环境变量 DEEPSEEK_API_KEY，或设置 CABLE_STUDIO_MODEL_BASE_URL、CABLE_STUDIO_MODEL_ID、CABLE_STUDIO_MODEL_API_KEY（OpenAI 兼容接口）后重启。密钥只从环境变量读取，不写入磁盘。';

export const SYSTEM_PROMPT = `你是在 Cable Studio 里干活的电缆工程师同事。软件做两件事：电缆型号（导入结构表、算参数、按国标核对、改版、出规格书、建三维模型）和载流量计算（一款型号在某种敷设和环境下的允许电流，哪根电缆先到温限）。

规矩：
1. 只通过工具做事。凡是数字——电流、温度、损耗、尺寸、核对结论——都必须来自工具结果；工具没算出来、数据缺失或被拒绝，就如实说并转述原因，不估算、不心算、不凭经验补数。
2. 条件不清楚就问，一次问清，不替工程师假设埋深、土壤热阻率、环境温度、负荷、电压、执行标准。例外：他明说让你定（“选一款”“随便”“给个示例”）时，就用型号模板的默认条件做，并在回答里写明用了哪些默认值（审阅卡上也看得到），请他确认或改。
3. 改动（新建工程、更换型号、改敷设、改工况、改结构、导入系列）会先交工程师审阅，可能被拒绝；被拒绝后不重复提同样的改动。计算和导出不需要审阅。
4. 审核、批准、发布只能由人做，你没有这类工具，也不要代办。
5. 做一类事之前先读对应的技能（技能目录在下面），照技能里的步骤做。
6. 有限元仿真本机不跑，超算还没接通：被问到就如实说做不了，不给任何仿真数字。
7. 用户消息里的“[附件：…（upload u-xxxx）]”是已上传的结构表，用 inspect_table 读取。
8. 想让工程师看某个对象，就调用 open_in_workbench。结果表、断面、文件、三维模型由界面的卡片显示，不要把表格抄一遍；回答里用名称说话，不要写工程、运行记录、电缆的内部编号（p-…、run-…、cable/c1）。
9. 用简体中文。调用工具之间不写过程说明；做完后一次性交代，最多五行，每行一句话，不用标题和列表：做了什么、结论、需要工程师注意或决定的事。`;

/** Which model the environment names, without building anything. */
export function modelIdentity(env: NodeJS.ProcessEnv = process.env): ModelIdentity | null {
  const thinking = (env.CABLE_STUDIO_MODEL_THINKING as ThinkingLevel | undefined) ?? 'off';
  if (env.CABLE_STUDIO_MODEL_BASE_URL && env.CABLE_STUDIO_MODEL_ID && env.CABLE_STUDIO_MODEL_API_KEY) {
    return { model: env.CABLE_STUDIO_MODEL_ID, provider: new URL(env.CABLE_STUDIO_MODEL_BASE_URL).host, thinking };
  }
  if (env.DEEPSEEK_API_KEY) return { model: env.CABLE_STUDIO_MODEL_ID ?? 'deepseek-flash', provider: 'DeepSeek', thinking };
  return null;
}

let loaded: Promise<typeof import('@earendil-works/pi-coding-agent')> | undefined;
/** The session layer takes a few seconds to load, so the host starts without it and the first conversation pays once. */
function pi() {
  // Install telemetry and catalogue downloads are off: the only network traffic is the model the engineer configured.
  process.env.PI_TELEMETRY ??= '0';
  process.env.PI_OFFLINE ??= '1';
  return (loaded ??= import('@earendil-works/pi-coding-agent'));
}

/** Model access comes from the environment only; nothing is written to disk, not even into pi's own credential file. */
export async function modelFromEnvironment(env: NodeJS.ProcessEnv = process.env): Promise<ModelConfig | null> {
  const identity = modelIdentity(env);
  if (!identity) return null;
  const { ModelRuntime } = await pi();
  const models = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
  if (env.CABLE_STUDIO_MODEL_BASE_URL) {
    const model: Model<'openai-completions'> = {
      id: identity.model, name: identity.model, api: 'openai-completions', provider: 'cable-studio',
      baseUrl: env.CABLE_STUDIO_MODEL_BASE_URL, reasoning: identity.thinking !== 'off', input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192,
    };
    models.registerNativeProvider(createProvider({
      id: 'cable-studio', name: 'OpenAI 兼容接口', baseUrl: env.CABLE_STUDIO_MODEL_BASE_URL,
      auth: { apiKey: envApiKeyAuth('Cable Studio 模型密钥', ['CABLE_STUDIO_MODEL_API_KEY']) },
      models: [model], api: openAICompletionsApi(),
    }));
    return { models, model, provider: identity.provider, thinking: identity.thinking };
  }
  models.registerNativeProvider(deepseekProvider());
  const model = models.getModel('deepseek', identity.model);
  return model ? { models, model, provider: identity.provider, thinking: identity.thinking } : null;
}

interface Decision { accept: boolean; note?: string }
interface Waiting { proposal: Proposal; conversation: string; settle(decision: Decision): void }
interface Live {
  id: string;
  session: AgentSession;
  manager: SessionManager;
  running: boolean;
  /** The assistant message being written. */
  partial?: PiMessage;
  queued: string[];
  error?: string;
  run?: Promise<void>;
  timer?: NodeJS.Timeout;
  dirty: boolean;
  revision: number;
  unsubscribe(): void;
}

export class AgentService {
  #studio: Studio;
  /** undefined: from the environment when first needed; null: no model on purpose (tests, offline). */
  #given: ModelConfig | null | undefined;
  #built?: Promise<ModelConfig | null>;
  #live = new Map<string, Live>();
  #opening = new Map<string, Promise<Live>>();
  #waiting = new Map<string, Waiting>();
  #targets = new Map<string, string | undefined>();
  #byTool?: Map<string, Operation>;
  #cwd: string;
  #agentDir: string;
  #sessions: string;

  constructor(studio: Studio, runtime?: ModelConfig | null) {
    this.#studio = studio;
    this.#given = runtime;
    const root = join(studio.home, 'agent');
    this.#cwd = join(root, 'workspace');
    this.#agentDir = join(root, 'pi');
    this.#sessions = join(root, 'sessions');
    // Start loading the session layer in the background so the conversation list is ready when the page asks for it.
    if (runtime !== null) void pi().catch(() => undefined);
  }

  status(): AgentStatus {
    if (this.#given === null) return { configured: false, hint: NOT_CONFIGURED };
    if (this.#given) return { configured: true, model: this.#given.model.id, provider: this.#given.provider };
    const identity = modelIdentity();
    return identity ? { configured: true, model: identity.model, provider: identity.provider } : { configured: false, hint: NOT_CONFIGURED };
  }

  async #config(): Promise<ModelConfig> {
    if (this.#given) return this.#given;
    if (this.#given !== null) {
      this.#built ??= modelFromEnvironment();
      const config = await this.#built;
      if (config) return config;
    }
    throw new StudioError({ code: 'MODEL_NOT_CONFIGURED', message: '模型未配置。' + NOT_CONFIGURED }, 409);
  }

  #tool(name: string): Operation | undefined {
    this.#byTool ??= new Map(this.#studio.agentOperations().map(operation => [operation.tool!, operation]));
    return this.#byTool.get(name);
  }

  // ---- what the page shows ----

  /** What a step acts on, in the engineer's words. Looked up once per call. */
  #target(tool: string, args: Record<string, unknown>): string | undefined {
    const key = tool + JSON.stringify(args);
    if (this.#targets.has(key)) return this.#targets.get(key);
    const { store, library } = this.#studio;
    let target: string | undefined;
    try {
      if (tool === 'read') {
        const skill = this.#skillTitle(String(args.path ?? ''));
        target = skill ? `技能「${skill}」` : undefined;
      } else if (typeof args.name === 'string' && tool.endsWith('_project')) target = `工程「${args.name}」`;
      else if (typeof args.project === 'string') target = `工程「${store.meta(args.project).name}」`;
      else if (typeof args.spec === 'string') target = library.specName(args.spec);
      else if (typeof args.series === 'string') target = library.seriesList().find(item => item.id === args.series)?.name;
      else if (typeof args.sheet === 'string') target = `工作表「${args.sheet}」`;
      else if (typeof args.text === 'string') target = args.text.slice(0, 30);
    } catch { target = undefined; }
    this.#targets.set(key, target);
    return target;
  }

  #skillTitles = skillTitles(SKILLS);
  /** The skill's name in Chinese, from a skill name or from the path of its file. */
  #skillTitle(path: string): string | undefined {
    const clean = path.trim().replace(/\\/g, '/');
    return this.#skillTitles.get(clean) ?? this.#skillTitles.get(basename(dirname(clean)));
  }

  #describe = (tool: string, args: Record<string, unknown>) => ({ label: tool === 'read' ? '读取技能' : this.#tool(tool)?.title ?? tool, target: this.#target(tool, args) });

  #proposals(conversation: string, manager?: SessionManager): Map<string, Proposal> {
    const out = new Map<string, Proposal>();
    for (const entry of manager?.getEntries() ?? []) {
      const data = entry.type === 'custom' && entry.customType === PROPOSAL_ENTRY ? entry.data as Proposal : undefined;
      if (data) out.set(data.step_id, data);
    }
    for (const waiting of this.#waiting.values()) if (waiting.conversation === conversation) out.set(waiting.proposal.step_id, waiting.proposal);
    return out;
  }

  #pending(conversation: string): Proposal[] {
    return [...this.#waiting.values()].filter(item => item.conversation === conversation).map(item => item.proposal);
  }

  #viewOf(id: string, messages: readonly PiMessage[], manager: SessionManager | undefined, live?: Live): ChatView {
    const items = chatMessages({ messages, partial: live?.partial, queued: live?.queued ?? [], running: live?.running ?? false,
      proposals: this.#proposals(id, manager), describe: this.#describe, error: live?.error });
    const first = messages.find(message => message.role === 'user');
    const last = messages.at(-1);
    return { id, title: first ? titleOf(plainText(first)) : '新对话', created: new Date(first?.timestamp ?? Date.now()).toISOString(),
      updated: new Date(last?.timestamp ?? Date.now()).toISOString(), message_count: items.length, running: live?.running ?? false, revision: live?.revision ?? 0,
      items, waiting: this.#pending(id) };
  }

  #changed(live: Live, now = false): void {
    if (now) {
      if (live.timer) clearTimeout(live.timer);
      live.timer = undefined;
      live.dirty = false;
      live.revision += 1;
      const { items, waiting, ...summary } = this.#viewOf(live.id, live.session.messages as PiMessage[], live.manager, live);
      this.#studio.emit({ type: 'chat', summary, tail: items.slice(-3), count: items.length, waiting });
      return;
    }
    if (live.timer) { live.dirty = true; return; }
    this.#changed(live, true);
    live.timer = setTimeout(() => { live.timer = undefined; if (live.dirty) this.#changed(live); }, 80);
    live.timer.unref();
  }

  async list(): Promise<ChatSummary[]> {
    const { SessionManager } = await pi();
    mkdirSync(this.#sessions, { recursive: true });
    const infos = await SessionManager.list(this.#cwd, this.#sessions);
    const seen = new Set<string>();
    const rows: ChatSummary[] = infos.map(info => {
      seen.add(info.id);
      return { id: info.id, title: info.name ?? titleOf(info.firstMessage), created: info.created.toISOString(), updated: info.modified.toISOString(),
        message_count: info.messageCount, running: Boolean(this.#live.get(info.id)?.running), revision: this.#live.get(info.id)?.revision ?? 0 };
    });
    for (const live of this.#live.values()) {
      if (seen.has(live.id)) continue;
      const { items: _items, waiting: _waiting, ...summary } = this.#viewOf(live.id, live.session.messages as PiMessage[], live.manager, live);
      rows.push(summary);
    }
    return rows.sort((a, b) => b.updated.localeCompare(a.updated));
  }

  async view(id: string): Promise<ChatView> {
    const live = this.#live.get(id);
    if (live) return this.#viewOf(id, live.session.messages as PiMessage[], live.manager, live);
    const { SessionManager } = await pi();
    const file = SessionManager.findById(this.#cwd, id, this.#sessions);
    if (!file) throw new StudioError({ code: 'CHAT_UNKNOWN', message: '没有这个对话。' }, 404);
    const manager = SessionManager.open(file, this.#sessions, this.#cwd);
    return this.#viewOf(id, manager.buildSessionContext().messages as PiMessage[], manager);
  }

  // ---- running ----

  /** The gate: a write the agent proposes waits here until a person accepts or rejects it. Aborting settles it as a rejection. */
  #gate(live: () => Live): ExtensionFactory {
    return pi_ => {
      // The model has no use for the machine's paths: the working folder is left out, and a skill is named, not located. The reader takes the name.
      pi_.on('before_agent_start', event => ({ systemPrompt: noPaths(event.systemPrompt) }));
      pi_.on('tool_call', async (event, ctx) => {
        if (event.toolName === 'read') return undefined;
        const operation = this.#tool(event.toolName);
        if (!operation) return { block: true, reason: `没有工具 ${event.toolName}。` };
        if (operation.kind !== 'write') return undefined;
        const studio = this.#studio;
        const conversation = live();
        let review;
        try {
          review = await studio.reviewFor(operation, event.input);
        } catch (error) {
          return { block: true, reason: error instanceof Error ? error.message : String(error) };
        }
        if (!review.changes.length) return undefined;
        const proposal: Proposal = { id: 'pr-' + randomBytes(4).toString('hex'), session_id: conversation.id, step_id: event.toolCallId, project_id: review.project,
          operation: operation.id, title: review.title, changes: review.changes, preview: review.preview ?? null, issue: review.issue ?? null, status: 'pending' };
        const decision = await new Promise<Decision>(settle => {
          this.#waiting.set(proposal.id, { proposal, conversation: conversation.id, settle });
          // Without this a stop would wait for a person who may never answer.
          ctx.signal?.addEventListener('abort', () => settle({ accept: false, note: '任务已停止' }), { once: true });
          studio.emit({ type: 'proposal', proposal });
          this.#changed(conversation, true);
        });
        this.#waiting.delete(proposal.id);
        proposal.status = decision.accept ? 'accepted' : 'rejected';
        proposal.note = decision.note;
        conversation.manager.appendCustomEntry(PROPOSAL_ENTRY, proposal);
        studio.emit({ type: 'proposal', proposal });
        this.#changed(conversation, true);
        if (decision.accept) return undefined;
        return { block: true, reason: `工程师拒绝了这项改动${decision.note ? '：' + decision.note : ''}。不要重复提出同样的改动；换一种做法，或说明情况后结束。` };
      });
    };
  }

  #observe(live: Live, event: { type: string; message?: PiMessage; steering?: readonly string[]; followUp?: readonly string[] }): void {
    if (event.type === 'message_start' || event.type === 'message_update') {
      if (event.message?.role === 'assistant') live.partial = event.message;
    } else if (event.type === 'message_end') {
      live.partial = undefined;
    } else if (event.type === 'queue_update') {
      live.queued = [...(event.steering ?? []), ...(event.followUp ?? [])];
    } else if (!['tool_execution_start', 'tool_execution_end', 'turn_end', 'agent_end', 'agent_settled'].includes(event.type)) {
      return;
    }
    this.#changed(live);
  }

  async #open(id?: string): Promise<Live> {
    const config = await this.#config();
    const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = await pi();
    for (const dir of [this.#cwd, this.#agentDir, this.#sessions]) mkdirSync(dir, { recursive: true });
    let manager: SessionManager;
    if (id) {
      const file = SessionManager.findById(this.#cwd, id, this.#sessions);
      if (!file) throw new StudioError({ code: 'CHAT_UNKNOWN', message: '没有这个对话。' }, 404);
      manager = SessionManager.open(file, this.#sessions, this.#cwd);
    } else {
      manager = SessionManager.create(this.#cwd, this.#sessions);
    }
    const live: Live = { id: manager.getSessionId(), manager, session: undefined as unknown as AgentSession, running: false, queued: [], dirty: false, revision: 0, unsubscribe: () => undefined };
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: true, maxRetries: 2 }, enableInstallTelemetry: false });
    const loader = new DefaultResourceLoader({
      cwd: this.#cwd, agentDir: this.#agentDir, settingsManager,
      // Nothing is discovered: not the repository's AGENTS.md or CLAUDE.md, not a user's own extensions, themes or prompts.
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      additionalSkillPaths: [SKILLS], extensionFactories: [this.#gate(() => live)],
      systemPromptOverride: () => SYSTEM_PROMPT, appendSystemPromptOverride: () => [],
    });
    await loader.reload();
    const { skills, diagnostics } = loader.getSkills();
    for (const item of diagnostics) console.warn('技能文件有问题：', JSON.stringify(item));
    const reader = skillReader(skills, path => readFileSync(path, 'utf-8'));
    const tools = [...operationTools(this.#studio, () => live.id), reader];
    const { session } = await createAgentSession({
      cwd: this.#cwd, agentDir: this.#agentDir, modelRuntime: config.models, model: config.model, thinkingLevel: config.thinking,
      settingsManager, resourceLoader: loader, tools: tools.map(tool => tool.name), customTools: tools, sessionManager: manager,
    });
    await session.bindExtensions({});
    live.session = session;
    live.unsubscribe = session.subscribe(event => this.#observe(live, event as never));
    this.#live.set(live.id, live);
    return live;
  }

  /** The running conversation, opened from its file when the host has not touched it since it started; a new one when no id is given. */
  async #conversation(id?: string): Promise<Live> {
    if (id) {
      const live = this.#live.get(id);
      if (live) return live;
      const opening = this.#opening.get(id) ?? this.#open(id).finally(() => this.#opening.delete(id));
      this.#opening.set(id, opening);
      return opening;
    }
    return this.#open();
  }

  /** Starts a conversation or, when one is given, adds to it. While the agent is busy a new message steers it after its current step. */
  async send(id: string | undefined, text: string, attachments: ChatAttachment[] = []): Promise<{ session: string; accepted: 'started' | 'steered' }> {
    const live = await this.#conversation(id);
    const message = text.trim() + attachmentNote(attachments);
    if (live.running) {
      await live.session.prompt(message, { streamingBehavior: 'steer' });
      this.#changed(live, true);
      return { session: live.id, accepted: 'steered' };
    }
    live.running = true;
    live.error = undefined;
    live.run = live.session.prompt(message).catch(error => {
      live.error = error instanceof Error ? error.message : String(error);
    }).finally(() => {
      live.running = false;
      live.partial = undefined;
      this.#changed(live, true);
    });
    this.#changed(live, true);
    return { session: live.id, accepted: 'started' };
  }

  decide(proposalId: string, accept: boolean, note?: string): Proposal {
    const waiting = this.#waiting.get(proposalId);
    if (!waiting) throw new StudioError({ code: 'PROPOSAL_UNKNOWN', message: '这项改动已经处理过，或已不存在。' }, 404);
    waiting.settle({ accept, note });
    return { ...waiting.proposal, status: accept ? 'accepted' : 'rejected', note };
  }

  /** Stops what the agent is doing and drops what was queued behind it. */
  async stop(id: string): Promise<void> {
    const live = this.#live.get(id);
    if (!live?.running) return;
    for (const waiting of this.#waiting.values()) if (waiting.conversation === id) waiting.settle({ accept: false, note: '任务已停止' });
    live.session.clearQueue();
    live.queued = [];
    await live.session.abort();
  }

  /** Resolves when the conversation has nothing in flight (used by tests). */
  async idle(id: string): Promise<void> {
    await this.#live.get(id)?.run;
  }

  /** What the model is given: the tools switched on and the system prompt as it is sent (used by tests). */
  inspect(id: string): { tools: string[]; prompt: string } {
    const live = this.#live.get(id);
    if (!live) throw new StudioError({ code: 'CHAT_UNKNOWN', message: '这段对话没有在运行。' }, 404);
    return { tools: [...live.session.getActiveToolNames()], prompt: live.session.systemPrompt };
  }

  async close(): Promise<void> {
    for (const waiting of this.#waiting.values()) waiting.settle({ accept: false, note: '宿主关闭' });
    for (const live of this.#live.values()) {
      if (live.timer) clearTimeout(live.timer);
      live.unsubscribe();
      live.session.dispose();
    }
    await Promise.allSettled([...this.#live.values()].map(live => live.run));
    this.#live.clear();
  }
}
