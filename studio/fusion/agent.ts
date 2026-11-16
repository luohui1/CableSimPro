// The Agent of the fused product: pi's session layer with every built-in tool switched off. The tools it has are the old platform's
// read-only tools, which run on the platform inside a session and turn of its own; what it writes is the conversation file under
// <home>/agent, so conversations survive a restart. This is a trimmed copy of Cable Studio's host/agent.ts (no operations, no review
// gate, no skills yet); when the two products are one, the two are to become one.
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSession, ExtensionFactory, SessionManager } from '@earendil-works/pi-coding-agent';
import type { AgentStatus, ChatSummary, ChatView, StudioEvent } from '../shared/types.ts';
import { noPaths, type ModelConfig } from '../host/agent.ts';
import { chatMessages, plainText, titleOf, type PiMessage } from '../host/chat-view.ts';
import { StudioError } from '../host/core.ts';
import type { Backend, BackendTool } from './backend.ts';
import { targetFor } from './cards.ts';
import { agentStatus, NOT_CONFIGURED, resolveModel } from './model.ts';
import { pi } from './pi.ts';
import { SYSTEM_PROMPT } from './prompt.ts';
import { backendTools, ScopeBook } from './tools.ts';

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
  /** The platform sessions of the question being answered. */
  scopes?: ScopeBook;
  unsubscribe(): void;
}

export interface FusionOptions {
  home: string;
  backend: Backend;
  emit(event: StudioEvent): void;
  /** A model given by the caller (tests); otherwise the platform's, or the environment's. */
  runtime?: ModelConfig;
}

export class FusionAgent {
  #backend: Backend;
  #emit: (event: StudioEvent) => void;
  #given?: ModelConfig;
  #live = new Map<string, Live>();
  #opening = new Map<string, Promise<Live>>();
  #catalog?: Promise<BackendTool[]>;
  #titles = new Map<string, string>();
  readonly #epoch = randomBytes(4).toString('hex');
  readonly home: string;
  #cwd: string;
  #agentDir: string;
  #sessions: string;

  constructor(options: FusionOptions) {
    this.#backend = options.backend;
    this.#emit = options.emit;
    this.#given = options.runtime;
    this.home = options.home;
    const root = join(options.home, 'agent');
    this.#cwd = join(root, 'workspace');
    this.#agentDir = join(root, 'pi');
    this.#sessions = join(root, 'sessions');
    // Start loading the session layer in the background so the conversation list is ready when the page asks for it.
    void pi().catch(() => undefined);
  }

  async status(): Promise<AgentStatus> {
    if (this.#given) return { configured: true, model: this.#given.model.id, provider: this.#given.provider };
    return agentStatus(this.#backend);
  }

  /** The tools the platform offers; read again after a failure, so a platform that was not up yet is picked up when it is. */
  async #tools(): Promise<BackendTool[]> {
    this.#catalog ??= this.#backend.tools().then(tools => {
      for (const tool of tools) this.#titles.set(tool.name, tool.title);
      return tools;
    });
    try {
      return await this.#catalog;
    } catch (error) {
      this.#catalog = undefined;
      throw error;
    }
  }

  #describe = (tool: string, args: Record<string, unknown>) => ({ label: this.#titles.get(tool) ?? tool, target: targetFor(tool, args) });

  #viewOf(id: string, messages: readonly PiMessage[], live?: Live): ChatView {
    const items = chatMessages({ messages, partial: live?.partial, queued: live?.queued ?? [], running: live?.running ?? false,
      proposals: new Map(), describe: this.#describe, error: live?.error });
    const first = messages.find(message => message.role === 'user');
    const last = messages.at(-1);
    return { id, title: first ? titleOf(plainText(first)) : '新对话', created: new Date(first?.timestamp ?? Date.now()).toISOString(),
      updated: new Date(last?.timestamp ?? Date.now()).toISOString(), message_count: items.length, running: live?.running ?? false, revision: live?.revision ?? 0,
      epoch: this.#epoch, items, waiting: [] };
  }

  #changed(live: Live, now = false): void {
    if (now) {
      if (live.timer) clearTimeout(live.timer);
      live.timer = undefined;
      live.dirty = false;
      live.revision += 1;
      const { items, waiting, ...summary } = this.#viewOf(live.id, live.session.messages as PiMessage[], live);
      // From the first message that is not settled (still streaming, waiting, or holding a step that runs), and at least the last three.
      const open = items.findIndex(item => item.status === 'streaming' || item.queued
        || item.parts.some(part => part.type === 'step' && (part.status === 'running' || part.status === 'waiting_review')));
      const from = Math.max(0, Math.min(items.length - 3, open < 0 ? items.length : open));
      this.#emit({ type: 'chat', summary, tail: items.slice(from), count: items.length, waiting });
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
        message_count: info.messageCount, running: Boolean(this.#live.get(info.id)?.running), revision: this.#live.get(info.id)?.revision ?? 0, epoch: this.#epoch };
    });
    for (const live of this.#live.values()) {
      if (seen.has(live.id)) continue;
      const { items: _items, waiting: _waiting, ...summary } = this.#viewOf(live.id, live.session.messages as PiMessage[], live);
      rows.push(summary);
    }
    return rows.sort((a, b) => b.updated.localeCompare(a.updated));
  }

  async view(id: string): Promise<ChatView> {
    await this.#tools().catch(() => undefined);
    const live = this.#live.get(id);
    if (live) return this.#viewOf(id, live.session.messages as PiMessage[], live);
    const { SessionManager } = await pi();
    const file = SessionManager.findById(this.#cwd, id, this.#sessions);
    if (!file) throw new StudioError({ code: 'CHAT_UNKNOWN', message: '没有这个对话。' }, 404);
    const manager = SessionManager.open(file, this.#sessions, this.#cwd);
    return this.#viewOf(id, manager.buildSessionContext().messages as PiMessage[]);
  }

  // ---- running ----

  /** What the model is given of the platform's tools, and no tool outside them. */
  #guard(names: () => ReadonlySet<string>): ExtensionFactory {
    return pi_ => {
      // The model has no use for the machine's paths: the working folder is left out of what it is told.
      pi_.on('before_agent_start', event => ({ systemPrompt: noPaths(event.systemPrompt) }));
      pi_.on('tool_call', event => (names().has(event.toolName) ? undefined : { block: true, reason: `没有工具 ${event.toolName}。` }));
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
    // The platform first: when it is not there, that is what is said, not that no model is configured.
    let catalog: BackendTool[];
    try {
      catalog = await this.#tools();
    } catch (error) {
      throw new StudioError({ code: 'BACKEND_UNREACHABLE', message: error instanceof Error ? error.message : String(error) }, 503);
    }
    const config = this.#given ?? await resolveModel(this.#backend);
    if (!config) throw new StudioError({ code: 'MODEL_NOT_CONFIGURED', message: '模型未配置。' + NOT_CONFIGURED }, 409);
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
    const names = new Set(catalog.map(tool => tool.name));
    const loader = new DefaultResourceLoader({
      cwd: this.#cwd, agentDir: this.#agentDir, settingsManager,
      // Nothing is discovered: not the repository's AGENTS.md or CLAUDE.md, not a user's own extensions, skills, themes or prompts.
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [this.#guard(() => names)], systemPromptOverride: () => SYSTEM_PROMPT, appendSystemPromptOverride: () => [],
    });
    await loader.reload();
    const tools = backendTools(this.#backend, catalog, () => (live.scopes ??= new ScopeBook(this.#backend, '')), [this.home]);
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

  /** The running conversation, opened from its file when the sidecar has not touched it since it started; a new one when no id is given. */
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
  async send(id: string | undefined, text: string): Promise<{ session: string; accepted: 'started' | 'steered' }> {
    const live = await this.#conversation(id);
    const message = text.trim();
    if (live.running) {
      await live.session.prompt(message, { streamingBehavior: 'steer', expandPromptTemplates: false });
      this.#changed(live, true);
      return { session: live.id, accepted: 'steered' };
    }
    live.running = true;
    live.error = undefined;
    // A question gets sessions of its own on the platform, so the project's revision is the one in force when it was asked.
    live.scopes = new ScopeBook(this.#backend, message.slice(0, 8000));
    live.run = live.session.prompt(message, { expandPromptTemplates: false }).catch(error => {
      live.error = error instanceof Error ? error.message : String(error);
    }).finally(() => {
      live.running = false;
      live.partial = undefined;
      const scopes = live.scopes;
      live.scopes = undefined;
      void scopes?.close();
      this.#changed(live, true);
    });
    this.#changed(live, true);
    return { session: live.id, accepted: 'started' };
  }

  /** Stops what the agent is doing and drops what was queued behind it. */
  async stop(id: string): Promise<void> {
    const live = this.#live.get(id);
    if (!live?.running) return;
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
    for (const live of this.#live.values()) {
      if (live.timer) clearTimeout(live.timer);
      live.unsubscribe();
      live.session.dispose();
    }
    await Promise.allSettled([...this.#live.values()].map(live => live.run));
    this.#live.clear();
  }
}
