// Conversation contracts for manufacturer attachments and interrupted import checks. The platform below is a recorded-contract
// stand-in, with no parser or engineering result generator; actual upload/import/check execution is covered by the backend and
// fusion-integration tests. These tests use pi's real session files and the same scripted provider as the other Agent tests.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxText, fauxToolCall, getSystemMessageText } from '@earendil-works/pi-ai';
import { FusionAgent } from '../fusion/agent.ts';
import { attachmentInputs } from '../fusion/attachments.ts';
import { Backend, type BackendProposal, type BackendTool, type DecisionReceipt, type Opened, type ProposalState, type ToolResult } from '../fusion/backend.ts';
import { attachmentNote, splitAttachments } from '../host/chat-view.ts';
import type { StructureAttachment } from '../shared/fusion-types.ts';
import type { ChatStep, Proposal, StudioEvent } from '../shared/types.ts';
import { scriptedModel, steps, toolText } from './support.ts';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const SERIES = '22222222-2222-4222-8222-222222222222';
const BATCH = '33333333-3333-4333-8333-333333333333';
const SPEC = '44444444-4444-4444-8444-444444444444';
const RUN = '55555555-5555-4555-8555-555555555555';
const ATTACHMENT = '66666666-6666-4666-8666-666666666666';
const RAW = 'private-original-column,private-original-value\n';
const BASE64 = Buffer.from(RAW).toString('base64');
const PRIVATE_PATH = '/private-contract-source/manufacturer-original.csv';
const FILENAME = '厂家结构（原表）].csv';

const CHECK_TOOL: BackendTool = {
  name: 'propose_structure_check', title: '提出核对导入规格', kind: 'propose', scope: 'workspace',
  description: '接受后才核对本对话导入的明确规格。',
  parameters: { type: 'object', properties: { series_id: { type: 'string' }, spec_ids: { type: 'array', items: { type: 'string' } } },
    required: ['series_id', 'spec_ids'], additionalProperties: false } as never,
};
const CHECK_PROPOSAL: BackendProposal = {
  id: '77777777-7777-4777-8777-777777777777', title: '核对导入规格',
  changes: [{ path: '/specs/0', label: '合同规格 A · 固定版本', before: null, after: { version: 1, workspace_revision: 2 } }],
  checks: ['接受后保存逐项核对记录；计算完成不代表标准符合或人工批准。'], assumptions: [],
};
const CHECK_ITEM = { spec_id: SPEC, name: '合同规格 A', workspace_id: WORKSPACE, run_id: RUN, status: 'succeeded',
  message: '这是用于验证回执保留的固定合同记录，不提供工程数值。' };
const unfinished = (status: 'running' | 'interrupted') => ({
  kind: 'structure_check', id: BATCH, batch_id: BATCH, series_id: SERIES, status, executed: true, complete: false,
  may_have_written: true, items: [CHECK_ITEM],
  message: '批量核对尚未完成；已保存的逐项记录保留，不会自动重跑。',
});

class ContractPlatform extends Backend {
  staged: { conversation: string; filename: string; content: string }[] = [];
  calls: Parameters<Backend['call']>[0][] = [];
  opened: { workspace: string; conversation?: string }[] = [];
  decisions: { id: string; accept: boolean }[] = [];
  proposalReads: { id: string; session: string }[] = [];
  savedDecision: DecisionReceipt | undefined;
  decisionReceipt: Record<string, unknown> = unfinished('interrupted');
  catalog: BackendTool[] = [];

  constructor() { super('http://127.0.0.1:9', 'contract-test-no-network'); }
  tools = async () => structuredClone(this.catalog);
  stageAttachment = async (conversation: string, filename: string, content: string): Promise<StructureAttachment> => {
    this.staged.push({ conversation, filename, content });
    // The transport is allowed to return only metadata. Extra fields here deliberately verify that pi persists a whitelist.
    return { id: ATTACHMENT, filename, sha256: createHash('sha256').update(Buffer.from(content, 'base64')).digest('hex'),
      size: Buffer.from(content, 'base64').length, content_base64: content, source_path: PRIVATE_PATH } as StructureAttachment;
  };
  open = async (workspace: string, _message: string, _study?: string, conversation?: string): Promise<Opened> => {
    this.opened.push({ workspace, conversation });
    return { session: randomUUID(), turn: randomUUID(), context: { kind: 'project', id: workspace } };
  };
  resume = async (session: string): Promise<Opened> => ({ session, turn: randomUUID(), context: { kind: 'project', id: WORKSPACE } });
  finish = async () => ({ finished: true });
  call = async (body: Parameters<Backend['call']>[0]): Promise<ToolResult> => {
    this.calls.push(structuredClone(body));
    assert.equal(body.tool, CHECK_TOOL.name, 'only the declared proposal can reach the platform');
    return { status: 'ok', summary: '待人审阅，尚未执行。', data: { proposal: structuredClone(CHECK_PROPOSAL) }, diagnostics: [], next_actions: [] };
  };
  decide = async (id: string, accept: boolean): Promise<DecisionReceipt> => {
    this.decisions.push({ id, accept });
    this.savedDecision = accept ? { status: 'approved', receipt: structuredClone(this.decisionReceipt) } : { status: 'rejected' };
    return this.savedDecision;
  };
  proposal = async (id: string, session: string): Promise<ProposalState> => {
    this.proposalReads.push({ id, session });
    return { proposal: structuredClone(CHECK_PROPOSAL), session, ...(this.savedDecision ?? { status: 'pending' as const }) };
  };
  read = async <T>(path: string): Promise<T> => {
    assert.ok(path.startsWith('/api/methods'), 'these contract tests cannot query or fabricate engineering results');
    return [] as T;
  };
}

function pendingReview() {
  let resolve!: (proposal: Proposal) => void;
  const promise = new Promise<Proposal>(done => { resolve = done; });
  return { promise, emit: (event: StudioEvent) => {
    if (event.type === 'proposal' && event.proposal.status === 'pending') resolve(event.proposal);
  } };
}

function assertUnfinished(step: ChatStep, status: 'running' | 'interrupted') {
  assert.equal(step.status, 'failed', 'an accepted but unfinished batch cannot be displayed as done');
  assert.equal(step.proposal?.status, 'accepted', 'execution failure must not rewrite the human decision');
  assert.match(step.reason ?? '', /未完成|中断/);
  assert.match(step.reason ?? '', /不得自动|不会自动|不能自动/);
  assert.equal(step.card?.kind, 'structure_check', 'the failure must retain its actual saved item card');
  if (step.card?.kind !== 'structure_check') return;
  assert.equal(step.card.view.status, status);
  // view.complete describes whether the saved page was fully read, independently of the batch execution state above.
  assert.deepEqual(step.card.view.items, [CHECK_ITEM]);
}

function persistedFiles(folder: string): string {
  return readdirSync(folder, { withFileTypes: true }).map(entry => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? persistedFiles(path) : readFileSync(path, 'utf8');
  }).join('\n');
}

test('attachment notes parse actual UUIDs and existing Studio upload IDs without inventing attachments from other text', () => {
  const files = [{ upload: ATTACHMENT, file: '厂家结构.csv' }, { upload: 'u-1a2b3c4d', file: '旧结构.xlsx' }];
  const parsed = splitAttachments('请核对来源。' + attachmentNote(files));
  assert.deepEqual(parsed, { text: '请核对来源。', attachments: files });
  const ordinary = '只写一个文件名不算上传：[附件：厂家结构.csv（upload not-an-attachment）]';
  assert.deepEqual(splitAttachments(ordinary), { text: ordinary, attachments: [] });
});

test('attachment input rejects unsafe names, invalid encodings, excess bytes and forged metadata without echoing the input', () => {
  assert.deepEqual(attachmentInputs([{ id: ATTACHMENT }]), [{ id: ATTACHMENT }]);
  assert.deepEqual(attachmentInputs([{ filename: '厂家.CSV', content_base64: BASE64 }]), [{ filename: '厂家.CSV', content_base64: BASE64 }]);
  const invalid = [
    [{ filename: '../secret.csv', content_base64: BASE64 }],
    [{ filename: '厂家.pdf', content_base64: BASE64 }],
    [{ filename: '厂家.csv', content_base64: BASE64, source_path: PRIVATE_PATH }],
    [{ filename: '厂家.csv', content_base64: 'Zh==' }], // decodes, but is not canonical base64
    [{ filename: '厂家.csv', content_base64: '' }],
    [{ id: 'u-1a2b3c4d' }], // legacy notes remain readable, but cannot become platform-owned input
    [{ id: ATTACHMENT, content_base64: BASE64 }],
    Array.from({ length: 5 }, () => ({ id: ATTACHMENT })),
    ['a', 'b'].map(name => ({ filename: `${name}.csv`, content_base64: Buffer.alloc(600_000, 1).toString('base64') })),
  ];
  for (const input of invalid) assert.throws(() => attachmentInputs(input), (error: { code?: string; message?: string }) => {
    assert.equal(error.code, 'ATTACHMENT_INVALID');
    for (const source of [BASE64, RAW, PRIVATE_PATH, '../secret.csv']) assert.ok(!error.message?.includes(source));
    return true;
  });
});

test('only this conversation\'s staged metadata reaches the model, event stream and session files, including after restart', { timeout: 20_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'fusion-import-metadata-'));
  const platform = new ContractPlatform();
  const { faux, runtime } = await scriptedModel();
  const events: StudioEvent[] = [];
  const contexts: string[] = [];
  const prompts: string[] = [];
  let agent = new FusionAgent({ home, backend: platform, runtime, emit: event => events.push(event) });
  const respond = () => faux.setResponses([context => {
    contexts.push(JSON.stringify(context));
    const leading = context.messages[0];
    assert.equal(leading?.role, 'system');
    if (leading.role === 'system') prompts.push(getSystemMessageText(leading));
    return fauxAssistantMessage([fauxText('附件已暂存，业务写入仍须独立接受。')]);
  }]);
  try {
    respond();
    const { session } = await agent.send(undefined, '请检查原表。', undefined, [{ filename: FILENAME, content_base64: BASE64 }]);
    await agent.idle(session);
    assert.deepEqual(platform.staged, [{ conversation: session, filename: FILENAME, content: BASE64 }]);
    const view = await agent.view(session);
    assert.deepEqual(view.items.find(item => item.role === 'user')?.attachments, [{ upload: ATTACHMENT, file: FILENAME }],
      'the chip restores the real filename rather than the parser-escaped note');
    assert.ok(contexts[0].includes(ATTACHMENT) && contexts[0].includes(FILENAME));
    assert.ok(contexts[0].includes(createHash('sha256').update(RAW).digest('hex')));
    assert.ok(prompts[0].includes(FILENAME) && prompts[0].includes(ATTACHMENT), 'the provider-rendered system prompt carries the metadata');
    assert.equal(platform.calls.length, 0, 'selecting a file cannot execute a library operation');
    await agent.close();

    agent = new FusionAgent({ home, backend: platform, runtime, emit: event => events.push(event) });
    respond();
    await agent.send(session, '继续读取这份附件。', undefined, [{ id: ATTACHMENT }]);
    await agent.idle(session);
    assert.equal(platform.staged.length, 1, 'reopening or retrying a saved attachment does not restage its bytes');
    assert.ok(contexts.at(-1)?.includes(ATTACHMENT) && contexts.at(-1)?.includes(FILENAME));
    assert.ok(prompts.at(-1)?.includes(FILENAME) && prompts.at(-1)?.includes(ATTACHMENT));

    respond();
    const other = await agent.send(undefined, '只写标记：' + attachmentNote([{ upload: ATTACHMENT, file: '伪造文件名.csv' }]));
    await agent.idle(other.session);
    assert.deepEqual((await agent.view(other.session)).items.find(item => item.role === 'user')?.attachments, [],
      'a literal attachment marker from another conversation is not proof of a staged input');
    const callsBefore = contexts.length;
    await assert.rejects(agent.send(other.session, '使用另一段对话的附件', undefined, [{ id: ATTACHMENT }]),
      (error: { code?: string }) => error.code === 'ATTACHMENT_UNKNOWN');
    assert.equal(contexts.length, callsBefore, 'cross-conversation references are refused before a model request');
    assert.equal(platform.staged.length, 1);
    assert.equal(platform.calls.length, 0);

    const exposed = contexts.join('\n') + JSON.stringify(events) + JSON.stringify(await agent.view(session)) + persistedFiles(home);
    for (const source of [BASE64, RAW, PRIVATE_PATH, 'content_base64', 'source_path']) assert.ok(!exposed.includes(source), `metadata boundary excludes ${source === RAW || source === BASE64 ? 'original file content' : source}`);
  } finally {
    await agent.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('an attachment sent while a proposal waits reaches the next model request as metadata without executing the proposal', { timeout: 20_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'fusion-import-steered-'));
  const platform = new ContractPlatform();
  platform.catalog = [CHECK_TOOL];
  const { faux, runtime } = await scriptedModel();
  const review = pendingReview();
  const agent = new FusionAgent({ home, backend: platform, runtime, emit: review.emit });
  let continuedContext = '';
  let continuedPrompt = '';
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall(CHECK_TOOL.name, { workspace_id: WORKSPACE, series_id: SERIES, spec_ids: [SPEC] })], { stopReason: 'toolUse' }),
    context => {
      continuedContext = JSON.stringify(context);
      const leading = context.messages[0];
      assert.equal(leading?.role, 'system');
      if (leading.role === 'system') continuedPrompt = getSystemMessageText(leading);
      return fauxAssistantMessage([fauxText('已收到补充附件，未执行刚才的方案。')]);
    },
  ]);
  try {
    const { session } = await agent.send(undefined, '先提出核对方案。', { workspace_id: WORKSPACE });
    const pending = await review.promise;
    const queued = await agent.send(session, '先看这份补充表。', undefined, [{ filename: FILENAME, content_base64: BASE64 }]);
    assert.equal(queued.accepted, 'steered');
    assert.equal(platform.decisions.length, 0);
    await agent.decide(pending.id, false, '先核对新附件。', session);
    await agent.idle(session);
    assert.ok(continuedContext.includes(ATTACHMENT) && continuedContext.includes(FILENAME), 'new staged metadata survives the active turn\'s original system prompt');
    assert.ok(continuedContext.includes(createHash('sha256').update(RAW).digest('hex')));
    assert.ok(continuedPrompt.includes(FILENAME) && continuedPrompt.includes(ATTACHMENT), 'the real provider prompt includes the steered attachment metadata');
    for (const source of [RAW, BASE64, PRIVATE_PATH]) assert.ok(!continuedContext.includes(source));
    assert.deepEqual(platform.decisions, [{ id: pending.id, accept: false }]);
    assert.equal(platform.calls.length, 1, 'receiving a new file cannot approve or repeat the pending operation');
  } finally {
    await agent.close();
    rmSync(home, { recursive: true, force: true });
  }
});

for (const status of ['running', 'interrupted'] as const) {
  test(`an accepted ${status} batch remains unfinished while its saved per-item card is visible`, { timeout: 20_000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), `fusion-import-${status}-`));
    const platform = new ContractPlatform();
    platform.catalog = [CHECK_TOOL];
    platform.decisionReceipt = unfinished(status);
    const { faux, runtime } = await scriptedModel();
    const review = pendingReview();
    const agent = new FusionAgent({ home, backend: platform, runtime, emit: review.emit });
    let told: { status?: string; data?: { receipt?: unknown } } = {};
    let isError = false;
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall(CHECK_TOOL.name, { workspace_id: WORKSPACE, series_id: SERIES, spec_ids: [SPEC] })], { stopReason: 'toolUse' }),
      context => {
        told = JSON.parse(toolText(context));
        isError = Boolean((context.messages.at(-1) as { isError?: boolean }).isError);
        return fauxAssistantMessage([fauxText('核对未完成，请核对已保存项目；不会自动重跑。')]);
      },
    ]);
    try {
      const { session } = await agent.send(undefined, '核对这批已导入的规格。', { workspace_id: WORKSPACE });
      const pending = await review.promise;
      assert.equal(platform.decisions.length, 0, 'the model has only created a pending proposal');
      assert.equal(steps(await agent.view(session))[0].status, 'waiting_review');
      assert.equal(platform.opened[0].conversation, session, 'the platform task carries the real pi conversation identity');
      await assert.rejects(agent.decide(pending.id, true, undefined, randomUUID()),
        (error: { code?: string }) => error.code === 'PROPOSAL_UNKNOWN');
      assert.equal(platform.decisions.length, 0, 'another conversation cannot approve this proposal');
      await agent.decide(pending.id, true, undefined, session);
      await agent.idle(session);
      assert.equal(isError, true, 'the model must receive an error state for the unfinished batch');
      assert.equal(told.status, 'error');
      assert.deepEqual(told.data?.receipt, { ...unfinished(status), items: [{ ...CHECK_ITEM, check_counts: {}, checks: [] }],
        item_count: 1, statuses: { succeeded: 1 }, check_counts: {}, engineering_approval: false });
      assertUnfinished(steps(await agent.view(session))[0], status);
      assert.deepEqual(platform.decisions, [{ id: pending.id, accept: true }]);
      assert.equal(platform.calls.length, 1, 'the batch is not automatically proposed or executed again');
    } finally {
      await agent.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test(`reopening a crashed ${status} batch reconciles the saved receipt without retrying or losing completed items`, { timeout: 20_000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), `fusion-import-before-${status}-`));
    const snapshot = mkdtempSync(join(tmpdir(), `fusion-import-after-${status}-`));
    const platform = new ContractPlatform();
    platform.catalog = [CHECK_TOOL];
    const { faux, runtime } = await scriptedModel();
    const review = pendingReview();
    const first = new FusionAgent({ home, backend: platform, runtime, emit: review.emit });
    let second: FusionAgent | undefined;
    faux.setResponses([fauxAssistantMessage([fauxToolCall(CHECK_TOOL.name,
      { workspace_id: WORKSPACE, series_id: SERIES, spec_ids: [SPEC] })], { stopReason: 'toolUse' })]);
    try {
      const { session } = await first.send(undefined, '接受之后进程中断。', { workspace_id: WORKSPACE });
      const pending = await review.promise;
      // A real pending session snapshot represents the process dying before it recorded the backend's later human decision.
      cpSync(join(home, 'agent'), join(snapshot, 'agent'), { recursive: true });
      await first.close();
      // SessionManager deliberately binds a conversation to its original cwd; restore a crash snapshot at that same location.
      rmSync(join(home, 'agent'), { recursive: true, force: true });
      cpSync(join(snapshot, 'agent'), join(home, 'agent'), { recursive: true });
      platform.savedDecision = { status: 'approved', receipt: unfinished(status) };
      const decisionsBefore = platform.decisions.length;
      second = new FusionAgent({ home, backend: platform, runtime, emit: () => undefined });
      const recovered = await second.view(session);
      assertUnfinished(steps(recovered)[0], status);
      assert.equal(platform.decisions.length, decisionsBefore, 'recovery reads the saved decision rather than approving or rejecting it again');
      assert.equal(platform.calls.length, 1, 'recovery never reruns the business tool');
      assert.deepEqual(platform.proposalReads.map(item => item.id), [pending.id]);
      assert.equal(platform.opened.length, 1, 'recovery does not open a new write scope');
      assertUnfinished(steps(await second.view(session))[0], status);
      assert.equal(platform.proposalReads.length, 1, 'the reconciled tool result is durable across subsequent reads');
    } finally {
      await first.close();
      await second?.close();
      rmSync(home, { recursive: true, force: true });
      rmSync(snapshot, { recursive: true, force: true });
    }
  });
}
