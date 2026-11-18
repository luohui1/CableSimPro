// The production AgentSession, native compact() and append-only session store
// run here. Only provider responses and the platform protocol are controlled.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAssistantMessageEventStream, createProvider, fauxAssistantMessage, fauxText, fauxToolCall,
  InMemoryCredentialStore, type AssistantMessage, type Model, type TranscriptContext } from '@earendil-works/pi-ai';
import { getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai/utils/transcript';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { FusionAgent } from '../fusion/agent.ts';
import { Backend, type BackendTool, type ToolResult } from '../fusion/backend.ts';
import { compactionSettings, compactionState, stateBlock, COMPACTION_STATE_MAX_BYTES, COMPACTION_STATE_MAX_CHARS } from '../fusion/compaction.ts';
import { pi, type ModelConfig } from '../fusion/pi.ts';
import { steps } from './support.ts';

const WORKSPACE = 'saved-workspace';
const STUDY = 'saved-study';
const CATALOG: BackendTool[] = [{ name: 'propose_note', title: '保存待审事项', kind: 'propose', scope: 'workspace', description: '独立人审的保存操作。',
  parameters: { type: 'object', properties: { sequence: { type: 'integer' } }, required: ['sequence'], additionalProperties: false } }];
const usage = (input: number, output: number) => ({ input, output, cacheRead: 0, cacheWrite: 0,
  totalTokens: input + output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });

class ProtocolBackend extends Backend {
  calls: number[] = [];
  approvals: string[] = [];
  recoveries = 0;
  constructor() { super('http://127.0.0.1:9', 'no-network'); }
  tools = async () => CATALOG;
  read = async <T>() => [] as T;
  open = async () => ({ session: 'platform-session', turn: 'turn-1', context: { kind: 'project' as const, id: WORKSPACE } });
  resume = async () => ({ session: 'platform-session', turn: 'turn-2', context: { kind: 'project' as const, id: WORKSPACE } });
  finish = async () => ({ finished: true });
  call = async (body: { arguments: Record<string, unknown> }): Promise<ToolResult> => {
    const sequence = Number(body.arguments.sequence);
    this.calls.push(sequence);
    return { status: 'ok', summary: '只生成待审提案。', data: { proposal: { id: `proposal-${sequence}`, title: `保存第${sequence}项`,
      changes: [], checks: ['必须人工接受。'] } }, diagnostics: [], next_actions: [] };
  };
  decide = async (id: string, accept: boolean) => {
    assert.equal(accept, true);
    assert.ok(!this.approvals.includes(id), 'a native continuation must not repeat an accepted business write');
    this.approvals.push(id);
    return { status: 'approved' as const, receipt: { kind: 'note', status: 'succeeded', executed: true,
      workspace_id: WORKSPACE, study_id: STUDY, run_id: `run-${id}`, engineering_approval: false,
      result: { run_id: `run-${id}`, workspace_id: WORKSPACE, study_id: STUDY,
        headlines: [{ key: 'ampacity', value: 701.4123456789, unit: 'A' }], checks: { engineering_approval: false } } } };
  };
  proposal = async () => { this.recoveries += 1; throw new Error('completed receipts must not be recovered after compaction'); };
}

async function runtime(respond: (context: TranscriptContext, index: number, model: Model<any>) => AssistantMessage,
  summarize?: (state: any, index: number, prompt: string) => AssistantMessage) {
  const summaryInputs: any[] = [];
  const businessInputs: TranscriptContext[] = [];
  const definition = { id: 'native-compaction-test', name: 'native-compaction-test', api: 'native-compaction-test', provider: 'native-compaction-test',
    baseUrl: 'http://unused', reasoning: false, input: ['text'] as ('text')[], contextWindow: 64000, maxTokens: 16384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const stream = (model: Model<any>, context: TranscriptContext) => {
    const output = createAssistantMessageEventStream();
    queueMicrotask(() => {
      try {
        let response: AssistantMessage;
        if (getCurrentSystemPrompt(context.messages).includes('You are a context summarization assistant.')) {
          assert.equal(getCurrentTools(context.messages).length, 0, 'summaries have no business tools');
          const text = JSON.stringify(context);
          const user = context.messages.findLast(item => item.role === 'user');
          const prompt = user?.role === 'user' ? typeof user.content === 'string' ? user.content
            : user.content.filter(part => part.type === 'text').map(part => part.text).join('\n') : '';
          const match = [...prompt.matchAll(/<cablesim-state>\n([\s\S]*?)\n<\/cablesim-state>/g)].at(-1);
          assert.ok(match, 'the real SDK summary prompt must receive the saved engineering state');
          const state = JSON.parse(match[1]);
          summaryInputs.push(state);
          assert.ok(text.includes('不得再次执行'));
          response = summarize?.(state, summaryInputs.length - 1, prompt)
            ?? { ...fauxAssistantMessage(`## Goal\n${state.goals.current}\n## Next Steps\n继续未完成目标，待审提案仍需接受。`), usage: usage(1000, 100) };
        } else {
          businessInputs.push(structuredClone(context));
          response = respond(context, businessInputs.length - 1, model);
        }
        const message = { ...response, api: model.api, provider: model.provider, model: model.id, timestamp: Date.now() };
        if (message.stopReason === 'pending') throw new Error('this protocol fixture supplies completed responses');
        output.push({ type: 'start', partial: { ...message, content: [] } });
        if (message.stopReason === 'error' || message.stopReason === 'aborted') output.push({ type: 'error', reason: message.stopReason, error: message });
        else output.push({ type: 'done', reason: message.stopReason, message });
        output.end(message);
      } catch (error) {
        const message = { ...fauxAssistantMessage('', { stopReason: 'error', errorMessage: String(error) }),
          api: model.api, provider: model.provider, model: model.id };
        output.push({ type: 'error', reason: 'error', error: message });
        output.end(message);
      }
    });
    return output;
  };
  const { ModelRuntime } = await pi();
  const models = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
  models.registerNativeProvider(createProvider({ id: definition.provider, models: [definition],
    auth: { apiKey: { name: 'protocol test', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  return { runtime: { models, model: definition, provider: definition.provider, thinking: 'off' } as ModelConfig, summaryInputs, businessInputs };
}

async function fixture(respond: Parameters<typeof runtime>[0], summarize?: Parameters<typeof runtime>[1], seedHistory = true) {
  const home = mkdtempSync(join(tmpdir(), 'fusion-native-compaction-'));
  const cwd = join(home, 'agent/workspace'), directory = join(home, 'agent/sessions');
  mkdirSync(cwd, { recursive: true }); mkdirSync(directory, { recursive: true });
  const { SessionManager } = await pi();
  const manager = SessionManager.create(cwd, directory);
  // A real persisted prefix gives the native cut-point algorithm work to do.
  // This text is deliberately irrelevant repetition, not engineering evidence.
  for (let index = 0; seedHistory && index < 5; index++) {
    manager.appendMessage({ role: 'user', content: `早先任务${index}已完成。`, timestamp: Date.now() - 10_000 + index * 2 });
    manager.appendMessage({ ...fauxAssistantMessage('已完成的叙述。'.repeat(1800)), usage: usage(0, 0), timestamp: Date.now() - 10_000 + index * 2 + 1 });
  }
  const backend = new ProtocolBackend();
  const provider = await runtime(respond, summarize);
  let agent = new FusionAgent({ home, backend, runtime: provider.runtime, emit: () => undefined });
  const entries = (id?: string) => SessionManager.open(id ? SessionManager.findById(cwd, id, directory)! : manager.getSessionFile()!, directory, cwd).getBranch();
  return { home, backend, provider, id: manager.getSessionId(), entries,
    get agent() { return agent; },
    restart: async () => { await agent.close(); agent = new FusionAgent({ home, backend, runtime: provider.runtime, emit: () => undefined }); },
    close: async () => { await agent.close(); rmSync(home, { recursive: true, force: true }); } };
}

async function waiting(agent: FusionAgent, id: string) {
  for (let index = 0; index < 150; index++) {
    const view = await agent.view(id);
    if (view.waiting.length) return view.waiting[0];
    if (!view.running) throw new Error(JSON.stringify(view.items.at(-1)));
    await new Promise(done => setTimeout(done, 10));
  }
  throw new Error('proposal did not reach the real review gate');
}

test('native threshold compaction preserves accepted cards, then a new pending card can be accepted once and survive restart', { timeout: 20_000 }, async () => {
  const env = await fixture((_context, index) => index < 2
    ? { ...fauxAssistantMessage([fauxToolCall('propose_note', { workspace_id: WORKSPACE, sequence: index + 1 })], { stopReason: 'toolUse' }),
      usage: usage(index === 0 ? 41000 : 4000, 50) }
    : { ...fauxAssistantMessage('两项均已保存，继续保留工程未批准状态。'), usage: usage(4000, 40) });
  try {
    await env.agent.send(env.id, '先保存两项工作，再说明剩余步骤。', { workspace_id: WORKSPACE, study_id: STUDY });
    const first = await waiting(env.agent, env.id);
    await env.agent.decide(first.id, true, undefined, env.id);
    const second = await waiting(env.agent, env.id);
    assert.equal(second.id, 'proposal-2');
    const compacted = env.entries().filter(entry => entry.type === 'compaction');
    assert.ok(compacted.length > 0, 'the production native threshold must really append a compaction');
    assert.ok(env.provider.summaryInputs.some(state => state.accepted_receipts.some((item: any) => item.step_id === first.step_id)));
    const last = compacted.at(-1)!;
    assert.ok(last.type === 'compaction');
    const state = (last.details as any).cablesim_state;
    assert.equal(state.current_object.workspace_id, WORKSPACE);
    assert.ok(state.key_facts.some((fact: any) => fact.data.headlines?.[0]?.value === 701.4123456789));
    assert.ok(last.summary.includes('701.4123456789'));
    assert.equal((await env.agent.view(env.id)).waiting[0].id, second.id);
    await env.agent.decide(second.id, true, undefined, env.id);
    await env.agent.idle(env.id);
    const before = await env.agent.view(env.id);
    assert.equal(steps(before).filter(step => step.status === 'done').length, 2);
    assert.deepEqual(env.backend.calls, [1, 2]);
    assert.deepEqual(env.backend.approvals, ['proposal-1', 'proposal-2']);
    const historyCount = before.items.length;
    await env.restart();
    assert.equal((await env.agent.view(env.id)).items.length, historyCount, 'reopen displays original cards, not the compacted provider view');
    await env.agent.send(env.id, '根据刚才保存结果继续说明，不再保存。');
    await env.agent.idle(env.id);
    assert.equal(env.backend.recoveries, 0, 'a compacted receipt is not a missing receipt');
    assert.deepEqual(env.backend.calls, [1, 2]);
    assert.ok(JSON.stringify(env.provider.businessInputs.at(-1)).includes('<cablesim-state>'));
  } finally { await env.close(); }
});

test('native compaction receives an entire 8k Chinese goal while its saved index stays bounded and preserves the unique tail and receipts',
  { timeout: 20_000 }, async () => {
    const tail = '唯一尾部目标：第二项完成后仍须标明工程未批准，保留温度二百一十三摄氏度的未核验限制。';
    const goal = '核对保存记录后先保存第一项，再保存第二项，均须人工接受；重复叙述仅用于任务背景。'.repeat(200).slice(0, 8000 - tail.length) + tail;
    assert.equal(goal.length, 8000);
    const env = await fixture((context, index) => {
      if (index === 0) return { ...fauxAssistantMessage([
        // A real long turn makes native keepRecentTokens split this turn. The
        // full user goal must reach the native turn-prefix summarizer.
        fauxText('Read the stored review note. '.repeat(1600)),
        fauxToolCall('propose_note', { workspace_id: WORKSPACE, sequence: 1 }),
      ], { stopReason: 'toolUse' }), usage: usage(41000, 12000) };
      assert.ok(JSON.stringify(context).includes(tail), 'the native summary must carry the unique requirement into the continuation');
      if (index === 1) return { ...fauxAssistantMessage([fauxToolCall('propose_note', { workspace_id: WORKSPACE, sequence: 2 })],
        { stopReason: 'toolUse' }), usage: usage(4000, 50) };
      assert.equal(index, 2);
      return { ...fauxAssistantMessage(`两项已保存。${tail}`), usage: usage(4000, 80) };
    }, (state, index, prompt) => {
      assert.equal(index, 0);
      assert.ok(prompt.includes(goal), 'the facts excerpt must never replace or truncate the native summarizer input');
      assert.ok(prompt.includes('正文必须根据完整用户消息'));
      assert.equal(state.goals.requests, 1);
      return { ...fauxAssistantMessage(`## Goal\n${tail}\n## Progress\n第一项已保存，接着提出第二项供人工接受。`), usage: usage(4000, 150) };
    }, false);
    try {
      const { session: id } = await env.agent.send(undefined, goal, { workspace_id: WORKSPACE, study_id: STUDY });
      const first = await waiting(env.agent, id);
      await env.agent.decide(first.id, true, undefined, id);
      const second = await waiting(env.agent, id);
      assert.equal(second.id, 'proposal-2');
      const entries = env.entries(id);
      const userEntries = entries.filter(entry => entry.type === 'message' && entry.message.role === 'user');
      assert.equal(userEntries.length, 1, 'this is the first user goal, not a copy added to earlier history');
      const original = userEntries[0];
      assert.ok(original.type === 'message' && original.message.role === 'user');
      const savedGoal = typeof original.message.content === 'string' ? original.message.content
        : original.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
      assert.ok(savedGoal === goal, 'the persistent user message remains complete');
      const checkpoints = entries.filter(entry => entry.type === 'compaction');
      assert.equal(checkpoints.length, 1, 'the production native threshold must append a real checkpoint');
      const checkpoint = checkpoints[0];
      assert.ok(checkpoint.type === 'compaction');
      const state = (checkpoint.details as any).cablesim_state;
      assert.equal(state.goals.original.complete, false);
      assert.deepEqual(state.goals.original.original_message, { entry_id: original.id, role: 'user', timestamp: original.message.timestamp });
      assert.equal(state.goals.original.characters, 8000);
      assert.equal(state.goals.original.utf8_bytes, Buffer.byteLength(goal));
      assert.equal(state.goals.original.sha256, createHash('sha256').update(goal).digest('hex'));
      assert.equal(state.goals.original.excerpt.beginning, Array.from(goal).slice(0, 480).join(''));
      assert.equal(state.goals.original.excerpt.ending, Array.from(goal).slice(-240).join(''));
      assert.deepEqual(state.goals.current, { same_as: 'original' }, 'a single long goal is indexed only once');
      assert.ok(JSON.stringify(state.goals).length < 1500);
      assert.ok(JSON.stringify(state).length <= COMPACTION_STATE_MAX_CHARS);
      assert.ok(Buffer.byteLength(JSON.stringify(state)) <= COMPACTION_STATE_MAX_BYTES);
      assert.ok(checkpoint.summary.includes(tail));
      assert.ok(checkpoint.summary.includes('701.4123456789'));
      assert.deepEqual(state.accepted_receipts.map((item: any) => item.step_id), [first.step_id]);
      assert.equal(state.accepted_receipts[0].receipt.engineering_approval, false);
      assert.equal(state.accepted_receipts[0].receipt.run_id, 'run-proposal-1');
      await env.agent.decide(second.id, true, undefined, id);
      await env.agent.idle(id);
      assert.equal(steps(await env.agent.view(id)).filter(step => step.status === 'done').length, 2);
      assert.deepEqual(env.backend.calls, [1, 2]);
      assert.deepEqual(env.backend.approvals, ['proposal-1', 'proposal-2']);
      await env.restart();
      await env.agent.view(id);
      assert.equal(env.backend.recoveries, 0);
      const later = compactionState([...env.entries(id), { ...original, id: 'later-request',
        message: { role: 'user', content: '只说明已保存结果。', timestamp: Date.now() } }], { workspace_id: WORKSPACE });
      assert.equal(later.goals.current, '只说明已保存结果。', 'ordinary short goals remain verbatim');
      assert.ok(Buffer.byteLength(JSON.stringify(later)) <= COMPACTION_STATE_MAX_BYTES, 'the original long goal cannot block future compactions');
    } finally { await env.close(); }
  });

for (const full of [false, true]) for (const failsAgain of [false, true]) {
  test(`${full ? 'full output' : 'context-clamped'} length stop compacts and retries the model once${failsAgain ? ', then reports failure' : ''}`,
    { timeout: 20_000 }, async () => {
      const env = await fixture((_context, index, model) => {
        assert.ok(index < 2, 'only one model retry is permitted');
        if (!index || failsAgain) return { ...fauxAssistantMessage('未完成的响应', { stopReason: 'length' }),
          usage: usage(1000, full ? model.maxTokens : 100) };
        return { ...fauxAssistantMessage('压缩后完成原目标。'), usage: usage(1000, 20) };
      });
      try {
        await env.agent.send(env.id, '继续说明已有记录，不执行写入。');
        await env.agent.idle(env.id);
        assert.equal(env.provider.businessInputs.length, 2);
        assert.ok(env.provider.summaryInputs.length > 0);
        assert.equal(env.entries().filter(entry => entry.type === 'compaction').length, 1);
        assert.equal(env.backend.calls.length, 0);
        const view = await env.agent.view(env.id);
        assert.equal(view.running, false);
        if (failsAgain) assert.match(JSON.stringify(view.items.at(-1)), /已经压缩并重试一次|已压缩并重试一次/);
        else assert.match(JSON.stringify(view.items.at(-1)), /压缩后完成原目标/);
      } finally { await env.close(); }
    });
}

for (const full of [false, true]) for (const failsAgain of [false, true]) {
  test(`a ${full ? 'full-output' : 'context-clamped'} length stop immediately after native threshold compaction ${failsAgain ? 'reports a second length stop' : 'continues to the next independently accepted write'}`,
    { timeout: 20_000 }, async () => {
      const env = await fixture((context, index, model) => {
        assert.ok(index < (failsAgain ? 3 : 4), 'the threshold checkpoint permits exactly one length recovery');
        if (index === 0 || (!failsAgain && index === 2)) {
          const sequence = index === 0 ? 1 : 2;
          if (sequence === 2) assert.ok(JSON.stringify(context).includes('run-proposal-1'), 'the accepted first receipt remains visible after recovery');
          return { ...fauxAssistantMessage([fauxToolCall('propose_note', { workspace_id: WORKSPACE, sequence })], { stopReason: 'toolUse' }),
            usage: usage(sequence === 1 ? 41000 : 4000, 50) };
        }
        if (index === 1 || failsAgain) return { ...fauxAssistantMessage('压缩后的响应仍未完成。', { stopReason: 'length' }),
          usage: usage(1000, full ? model.maxTokens : 100) };
        return { ...fauxAssistantMessage('两项已分别接受并完成。'), usage: usage(4000, 40) };
      });
      try {
        await env.agent.send(env.id, '保存第一项后继续保存第二项，每项先让我接受。', { workspace_id: WORKSPACE, study_id: STUDY });
        await env.agent.decide((await waiting(env.agent, env.id)).id, true, undefined, env.id);
        if (!failsAgain) {
          const second = await waiting(env.agent, env.id);
          assert.equal(second.id, 'proposal-2');
          assert.deepEqual(env.backend.approvals, ['proposal-1'], 'the next proposal still waits for its own decision');
          await env.agent.decide(second.id, true, undefined, env.id);
        }
        await env.agent.idle(env.id);
        assert.equal(env.provider.businessInputs.length, failsAgain ? 3 : 4);
        const entries = env.entries();
        const checkpoints = entries.filter(entry => entry.type === 'compaction');
        assert.equal(checkpoints.length, 1,
          'the fresh threshold checkpoint is reused when native compact has no new cut point');
        const checkpoint = checkpoints[0];
        assert.ok(checkpoint.type === 'compaction');
        const savedState = (checkpoint.details as any).cablesim_state;
        assert.equal(savedState.accepted_receipt_count, 1);
        assert.equal(savedState.accepted_receipts[0].receipt.run_id, 'run-proposal-1');
        assert.equal(savedState.accepted_receipts[0].receipt.engineering_approval, false);
        assert.equal(savedState.pending_proposals.length, 0);
        const recovery = entries.find(entry => entry.type === 'custom_message' && entry.customType === 'cablesim.fusion.length-recovery');
        assert.ok(recovery?.type === 'custom_message');
        assert.equal((recovery.details as any).reused_checkpoint, checkpoint.id, 'record exactly which effective native checkpoint was reused');
        assert.match(String(recovery.content), /沿用刚完成且仍有效的原生上下文摘要/);
        const between = entries.slice(entries.indexOf(checkpoint) + 1, entries.indexOf(recovery));
        assert.equal(between.filter(entry => entry.type === 'message').length, 1);
        assert.ok(between.every(entry => (entry.type === 'message' && entry.message.role === 'assistant' && entry.message.stopReason === 'length')
          || (entry.type === 'context_edit' && entry.replacement === null)), 'no user input or tool result is skipped between checkpoint and retry');
        assert.deepEqual(env.backend.calls, failsAgain ? [1] : [1, 2]);
        assert.deepEqual(env.backend.approvals, failsAgain ? ['proposal-1'] : ['proposal-1', 'proposal-2']);
        const view = await env.agent.view(env.id);
        assert.equal(view.running, false);
        assert.equal(steps(view).filter(step => step.status === 'done').length, failsAgain ? 1 : 2);
        if (failsAgain) assert.match(JSON.stringify(view.items.at(-1)), /已经压缩并重试一次/);
        else assert.match(JSON.stringify(view.items.at(-1)), /两项已分别接受并完成/);
        await env.restart();
        await env.agent.view(env.id);
        assert.equal(env.backend.recoveries, 0, 'a reused native checkpoint cannot turn an accepted write into an unconfirmed operation');
      } finally { await env.close(); }
    });
}

test('a native checkpoint before a new accepted tool result cannot excuse a later compaction failure', { timeout: 20_000 }, async () => {
  const env = await fixture((_context, index, model) => {
    assert.ok(index < 3, 'an older checkpoint must not silently stand in for uncompacted new tool results');
    if (index < 2) return { ...fauxAssistantMessage([fauxToolCall('propose_note', { workspace_id: WORKSPACE, sequence: index + 1 })], { stopReason: 'toolUse' }),
      usage: usage(index === 0 ? 41000 : 4000, 50) };
    return { ...fauxAssistantMessage('尚未说明第二项的结果。', { stopReason: 'length' }), usage: usage(1000, model.maxTokens) };
  });
  try {
    await env.agent.send(env.id, '分别保存两项，再说明两个保存结果。', { workspace_id: WORKSPACE, study_id: STUDY });
    await env.agent.decide((await waiting(env.agent, env.id)).id, true, undefined, env.id);
    await env.agent.decide((await waiting(env.agent, env.id)).id, true, undefined, env.id);
    await env.agent.idle(env.id);
    const entries = env.entries();
    assert.equal(entries.filter(entry => entry.type === 'compaction').length, 1);
    assert.equal(entries.filter(entry => entry.type === 'custom_message' && entry.customType === 'cablesim.fusion.length-recovery').length, 0);
    assert.deepEqual(env.backend.calls, [1, 2]);
    assert.deepEqual(env.backend.approvals, ['proposal-1', 'proposal-2']);
    const view = await env.agent.view(env.id);
    assert.equal(view.running, false);
    assert.equal(steps(view).filter(step => step.status === 'done').length, 2);
    assert.match(JSON.stringify(view.items.at(-1)), /上下文压缩失败/);
    await env.restart();
    await env.agent.view(env.id);
    assert.equal(env.backend.recoveries, 0, 'even a stopped continuation retains both saved receipts');
  } finally { await env.close(); }
});

for (const stopReason of ['error', 'length'] as const) {
  test(`a ${stopReason === 'error' ? 'failed' : 'truncated'} native summary stops before another business request and retains the accepted receipt`,
    { timeout: 20_000 }, async () => {
      const env = await fixture((_context, index) => {
        assert.equal(index, 0, 'failed compaction must not send the original overlong context again');
        return { ...fauxAssistantMessage([fauxToolCall('propose_note', { workspace_id: WORKSPACE, sequence: 1 })], { stopReason: 'toolUse' }),
          usage: usage(41000, 50) };
      }, () => ({ ...fauxAssistantMessage('未完成的摘要', { stopReason,
        ...(stopReason === 'error' ? { errorMessage: '摘要服务拒绝请求' } : {}) }), usage: usage(1000, 100) }));
      try {
        await env.agent.send(env.id, '保存这一项，并根据保存结果继续说明。', { workspace_id: WORKSPACE, study_id: STUDY });
        await env.agent.decide((await waiting(env.agent, env.id)).id, true, undefined, env.id);
        await env.agent.idle(env.id);
        assert.equal(env.provider.businessInputs.length, 1);
        assert.equal(env.provider.summaryInputs.length, 1);
        assert.equal(env.entries().filter(entry => entry.type === 'compaction').length, 0, 'a partial summary cannot replace the valid context');
        assert.deepEqual(env.backend.approvals, ['proposal-1']);
        const view = await env.agent.view(env.id);
        assert.equal(view.running, false);
        assert.equal(view.waiting.length, 0);
        assert.equal(steps(view).filter(step => step.status === 'done').length, 1);
        assert.match(JSON.stringify(view.items.at(-1)), /上下文压缩失败/);
        await env.restart();
        await env.agent.view(env.id);
        assert.equal(env.backend.recoveries, 0, 'failed compaction does not turn a saved receipt into a pending write');
      } finally { await env.close(); }
    });
}

test('a full-output recovery that cannot summarize keeps its explicit Chinese failure and does not retry the business request',
  { timeout: 20_000 }, async () => {
    const env = await fixture((_context, index, model) => {
      assert.equal(index, 0);
      return { ...fauxAssistantMessage('未完成的响应', { stopReason: 'length' }), usage: usage(1000, model.maxTokens) };
    }, () => fauxAssistantMessage('', { stopReason: 'error', errorMessage: '摘要服务拒绝请求' }));
    try {
      await env.agent.send(env.id, '继续说明保存结果。');
      await env.agent.idle(env.id);
      assert.equal(env.provider.businessInputs.length, 1);
      assert.equal(env.provider.summaryInputs.length, 1);
      assert.equal(env.entries().filter(entry => entry.type === 'compaction').length, 0);
      assert.equal(env.backend.calls.length, 0);
      const view = await env.agent.view(env.id);
      assert.equal(view.running, false);
      assert.match(JSON.stringify(view.items.at(-1)), /上下文压缩失败，本次对话未完成/);
    } finally { await env.close(); }
  });

for (const full of [false, true]) {
  test(`${full ? 'full output' : 'context-clamped'} length recovery is not repeated after an intervening accepted tool`,
    { timeout: 20_000 }, async () => {
      const env = await fixture((_context, index, model) => {
        assert.ok(index < 3, 'one user question gets only one compact-and-retry even after a successful tool response');
        if (index === 1) return { ...fauxAssistantMessage([fauxToolCall('propose_note', { workspace_id: WORKSPACE, sequence: 1 })], { stopReason: 'toolUse' }),
          usage: usage(4000, 50) };
        return { ...fauxAssistantMessage('回复再次达到长度限制。', { stopReason: 'length' }),
          usage: usage(1000, index === 0 && full ? model.maxTokens : 100) };
      });
      try {
        await env.agent.send(env.id, '保存这一项，再说明保存后的待办。', { workspace_id: WORKSPACE, study_id: STUDY });
        await env.agent.decide((await waiting(env.agent, env.id)).id, true, undefined, env.id);
        await env.agent.idle(env.id);
        assert.equal(env.provider.businessInputs.length, 3);
        assert.equal(env.entries().filter(entry => entry.type === 'compaction').length, 1);
        assert.deepEqual(env.backend.calls, [1]);
        assert.deepEqual(env.backend.approvals, ['proposal-1']);
        const view = await env.agent.view(env.id);
        assert.equal(view.running, false);
        assert.match(JSON.stringify(view.items.at(-1)), /已经压缩并重试一次/);
      } finally { await env.close(); }
    });
}

test('pinned compaction state stays bounded over twelve and hundreds of completed rounds and keeps unresolved acceptance exact', t => {
  const entries: SessionEntry[] = [];
  let sequence = 0;
  const append = (value: any) => entries.push({ ...value, id: String(++sequence), parentId: sequence > 1 ? String(sequence - 1) : null, timestamp: new Date().toISOString() });
  const sizes: number[] = [];
  for (let index = 0; index < 400; index++) {
    append({ type: 'message', message: { role: 'user', content: `继续第${index + 1}轮工程任务。`, timestamp: Date.now() } });
    append({ type: 'custom', customType: 'cablesim.fusion.proposal', data: { scope: { session: `scope-${index}` },
      proposal: { id: `proposal-${index}`, step_id: `step-${index}`, project_id: WORKSPACE, operation: 'propose_note', status: 'accepted', title: `第${index + 1}项` } } });
    append({ type: 'message', message: { role: 'toolResult', toolCallId: `step-${index}`, toolName: 'propose_note', isError: false,
      content: [{ type: 'text', text: JSON.stringify({ status: 'ok', data: { receipt: { kind: 'run', status: 'succeeded', executed: true,
        workspace_id: WORKSPACE, study_id: STUDY, run_id: `run-${index}`, engineering_approval: false,
        result: { workspace_id: WORKSPACE, study_id: STUDY, run_id: `run-${index}`,
          headlines: [{ key: 'ampacity', value: 701.4123456789 + index, unit: 'A' }], input_fields: [{ value: 0, unit: 'K', missing: false }] } } } }) }], timestamp: Date.now() } });
    if (index === 11 || index === 399) {
      const state = compactionState(entries, { workspace_id: WORKSPACE });
      assert.equal(state.accepted_receipt_count, index + 1);
      assert.equal(state.archived_receipt_count + state.accepted_receipts.length, index + 1);
      assert.ok(state.accepted_receipts.length <= 12 && state.key_facts.length <= 6);
      assert.ok(stateBlock(state).length <= COMPACTION_STATE_MAX_CHARS + 40);
      assert.ok(Buffer.byteLength(JSON.stringify(state)) <= COMPACTION_STATE_MAX_BYTES);
      sizes.push(Buffer.byteLength(JSON.stringify(state)));
    }
  }
  assert.ok(sizes[1] < sizes[0] + 2000, 'completed history cannot become another ever-growing context copy');
  append({ type: 'custom', customType: 'cablesim.fusion.proposal', data: { scope: { session: 'uncertain-platform-session' },
    proposal: { id: 'uncertain-proposal', step_id: 'uncertain-step', project_id: WORKSPACE, operation: 'propose_structure_upload', status: 'accepted', title: '上传' } } });
  const originalError = '已接受，但结果尚不能确定；可能已保存原件，不得自动重复执行。';
  append({ type: 'message', message: { role: 'toolResult', toolCallId: 'uncertain-step', toolName: 'propose_structure_upload', isError: true,
    content: [{ type: 'text', text: originalError }], timestamp: Date.now() } });
  const snapshot = JSON.stringify(entries);
  const state = compactionState(entries, { workspace_id: WORKSPACE });
  assert.equal(state.unresolved_accepted[0].id, 'uncertain-proposal');
  assert.equal(state.unresolved_accepted[0].platform_session, 'uncertain-platform-session');
  assert.equal(state.unresolved_accepted[0].original_tool_error, originalError);
  assert.equal(state.unresolved_accepted[0].result_confirmed, false);
  assert.equal(JSON.stringify(entries), snapshot);
  assert.deepEqual(compactionSettings({ contextWindow: 64000, maxTokens: 16384 }), { enabled: true, reserveTokens: 24576, keepRecentTokens: 8000 });
  t.diagnostic(JSON.stringify({ rounds: [12, 400], stateBytes: sizes, stateByteLimit: COMPACTION_STATE_MAX_BYTES,
    stateCharacterLimit: COMPACTION_STATE_MAX_CHARS, unresolvedAccepted: state.unresolved_accepted.length }));
});
