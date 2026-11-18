// Recover the precise interruption window between a platform action and the sidecar recording its tool result. The platform is
// a small protocol stand-in; pi's session persistence, recovery, scope checks and proposal gate are the production implementation.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { FusionAgent } from '../fusion/agent.ts';
import { Backend, type BackendProposal, type BackendTool, type DecisionReceipt, type Opened, type ProposalState, type ToolResult } from '../fusion/backend.ts';
import { pi } from '../fusion/pi.ts';
import type { Proposal } from '../shared/types.ts';
import { scriptedModel, steps } from './support.ts';

const ORIGINAL = 'original-workspace';
const OLD_STUDY = 'original-study';
const NEW_STUDY = 'created-study';
const NEW_TYPE = 'created-type';
const CREATED_ENTRY = 'cablesim.fusion.created';
const empty = { type: 'object', properties: {}, additionalProperties: false };
const publicProposal = (id: string): BackendProposal => ({ id, title: '下一步保存操作',
  changes: [{ path: '', label: '操作', before: null, after: '保存新的操作' }], checks: ['这一步仍要由工程师单独接受。'] });

class RecoveryBackend extends Backend {
  opened: { workspace_id: string; study_id?: string }[] = [];
  calls: { tool: string; arguments: Record<string, unknown> }[] = [];
  decisions: { id: string; accept: boolean }[] = [];
  lookups = 0;
  saved: ProposalState;

  constructor(status: ProposalState['status'], receipt?: Record<string, any>) {
    super('http://127.0.0.1:9', 'no-network-in-this-test');
    this.saved = { status, receipt, proposal: publicProposal('creation'), session: 'original-session' };
  }
  tools = async (): Promise<BackendTool[]> => [
    { name: 'propose_study_run', title: '提出运行研究', kind: 'propose', scope: 'workspace', description: '下一步运行仍需接受。',
      parameters: { ...empty, properties: { study_id: { type: 'string' } }, required: ['study_id'] } },
    { name: 'propose_type_basis', title: '提出保存标准依据', kind: 'propose', scope: 'type', description: '下一步保存仍需接受。', parameters: empty },
    { name: 'propose_delivery', title: '提出导出计算书', kind: 'propose', scope: 'workspace', description: '仅恢复已保存文件。', parameters: empty },
    { name: 'propose_type_specification', title: '提出导出规格书', kind: 'propose', scope: 'type', description: '仅恢复已保存文件。', parameters: empty },
  ];
  proposal = async (id: string, session: string): Promise<ProposalState> => {
    assert.equal(id, 'creation'); assert.equal(session, 'original-session'); this.lookups += 1;
    return this.saved;
  };
  decide = async (id: string, accept: boolean): Promise<DecisionReceipt> => {
    this.decisions.push({ id, accept });
    assert.equal(accept, false, 'recovery may reconcile or reject; it cannot approve an operation');
    if (id === 'creation') this.saved = { ...this.saved, status: 'rejected', receipt: undefined };
    return { status: 'rejected' };
  };
  open = async (workspace_id: string, _message: string, study_id?: string): Promise<Opened> => {
    this.opened.push({ workspace_id, ...(study_id ? { study_id } : {}) });
    return { session: 'next-session', turn: 'next-turn', context: { kind: 'project', id: workspace_id } };
  };
  finish = async () => ({ finished: true });
  resume = async (): Promise<Opened> => ({ session: 'next-session', turn: 'resumed-turn', context: { kind: 'project', id: ORIGINAL } });
  call = async (body: { tool: string; arguments: Record<string, unknown> }): Promise<ToolResult> => {
    this.calls.push(body);
    if (body.tool === 'propose_study_run') assert.equal(this.opened.at(-1)?.study_id, body.arguments.study_id, 'the next call must use the created study scope');
    return { status: 'ok', summary: '下一步只产生待审提案。', data: { proposal: publicProposal('next-proposal') }, diagnostics: [], next_actions: [] };
  };
}

async function interrupted(kind: 'study' | 'type' | 'delivery' | 'specification', localStatus: 'pending' | 'accepted', status: ProposalState['status'], receipt?: Record<string, any>) {
  const home = mkdtempSync(join(tmpdir(), 'fusion-recovery-'));
  const cwd = join(home, 'agent', 'workspace');
  const sessions = join(home, 'agent', 'sessions');
  mkdirSync(cwd, { recursive: true }); mkdirSync(sessions, { recursive: true });
  const { SessionManager } = await pi();
  const manager = SessionManager.create(cwd, sessions);
  const id = manager.getSessionId();
  const context = { workspace_id: ORIGINAL, study_id: OLD_STUDY };
  const operation = { study: 'propose_study', type: 'propose_type_create', delivery: 'propose_delivery', specification: 'propose_type_specification' }[kind];
  manager.appendCustomEntry('cablesim.fusion.context', context);
  manager.appendCustomEntry(CREATED_ENTRY, { types: ['earlier-type'], studies: [['earlier-workspace', 'earlier-study']] });
  manager.appendMessage({ role: 'user', content: '新建之后继续完成任务', timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage([{ ...fauxToolCall(operation, { workspace_id: ORIGINAL }), id: 'interrupted-call' }], { stopReason: 'toolUse' }));
  const proposal: Proposal = { id: 'creation', session_id: id, project_id: ORIGINAL, step_id: 'interrupted-call', operation,
    title: '已经交给平台的创建', changes: [{ part: '对象', field: '', label: '创建', before: '—', after: '新对象' }], status: localStatus };
  manager.appendCustomEntry('cablesim.fusion.proposal', { proposal, scope: { session: 'original-session', turn: 'original-turn' } });
  const backend = new RecoveryBackend(status, receipt);
  const scripted = await scriptedModel();
  let agent = new FusionAgent({ home, backend, runtime: scripted.runtime, emit: () => undefined });
  const savedAdoption = () => {
    const reopened = SessionManager.open(manager.getSessionFile()!, sessions, cwd);
    const entry = reopened.getEntries().findLast(entry => entry.type === 'custom' && entry.customType === CREATED_ENTRY);
    assert.ok(entry?.type === 'custom');
    return entry.data as { types: string[]; studies: [string, string][] };
  };
  const savedMessages = () => SessionManager.open(manager.getSessionFile()!, sessions, cwd).buildSessionContext().messages;
  return { get agent() { return agent; }, backend, faux: scripted.faux, id, context, savedAdoption, savedMessages,
    restart: async () => { await agent.close(); agent = new FusionAgent({ home, backend, runtime: scripted.runtime, emit: () => undefined }); },
    close: async () => { await agent.close(); rmSync(home, { recursive: true, force: true }); } };
}

test('concurrent history reads and a new prompt share recovery and retain the completed continuation on disk', { timeout: 20_000 }, async () => {
  const fixture = await interrupted('type', 'pending', 'approved', { kind: 'type', workspace_id: NEW_TYPE, type_id: NEW_TYPE });
  const entered = Promise.withResolvers<void>();
  const delayed = Promise.withResolvers<void>();
  const competing = Promise.withResolvers<void>();
  fixture.backend.proposal = async () => {
    fixture.backend.lookups += 1;
    if (fixture.backend.lookups === 1) { entered.resolve(); await delayed.promise; }
    else competing.resolve();
    return fixture.backend.saved;
  };
  fixture.faux.setResponses([fauxAssistantMessage([fauxText('已核对保存记录，继续处理完成。')])]);
  const firstRead = fixture.agent.view(fixture.id);
  await entered.promise;
  const otherRead = fixture.agent.view(fixture.id);
  const continuation = fixture.agent.send(fixture.id, '恢复后继续处理这条消息', fixture.context);
  try {
    // A competing recovery would bypass the delayed read. Let that continuation finish before the stale reader appends,
    // reproducing the lost-history window; with one shared recovery the event-loop turn simply releases the waiting read.
    await Promise.race([competing.promise, new Promise<void>(done => setImmediate(done))]);
    if (fixture.backend.lookups > 1) { await continuation; await fixture.agent.idle(fixture.id); }
    delayed.resolve();
    await Promise.all([firstRead, otherRead, continuation]);
    await fixture.agent.idle(fixture.id);
    const saved = fixture.savedMessages();
    assert.ok(saved.some(message => message.role === 'user' && (typeof message.content === 'string'
      ? message.content === '恢复后继续处理这条消息' : message.content.some(part => part.type === 'text' && part.text === '恢复后继续处理这条消息'))),
      'the next restart must retain the new user message');
    assert.ok(saved.some(message => message.role === 'assistant' && message.content.some(part => part.type === 'text' && part.text === '已核对保存记录，继续处理完成。')),
      'the next restart must retain the completed assistant answer');
    assert.equal(saved.filter(message => message.role === 'toolResult' && message.toolCallId === 'interrupted-call').length, 1);
    assert.equal(fixture.backend.lookups, 1, 'history reads and prompting reconcile the interrupted decision once');
    assert.deepEqual(fixture.backend.decisions, [], 'reading history never approves or replays a saved write');
    assert.deepEqual(fixture.backend.calls, []);
  } finally {
    delayed.resolve();
    await Promise.allSettled([firstRead, otherRead, continuation]);
    await fixture.close();
  }
});

for (const kind of ['study', 'type'] as const) for (const localStatus of ['pending', 'accepted'] as const) {
  test(`recovery adopts an approved ${kind} from its receipt when the local step was ${localStatus}, without replaying creation`, async () => {
    const receipt = kind === 'study' ? { kind, workspace_id: ORIGINAL, study_id: NEW_STUDY, study_revision: 1 }
      : { kind, workspace_id: NEW_TYPE, type_id: NEW_TYPE, workspace_revision: 1 };
    const fixture = await interrupted(kind, localStatus, 'approved', receipt);
    try {
      const recovered = await fixture.agent.view(fixture.id);
      assert.equal(steps(recovered)[0].proposal?.status, 'accepted');
      const saved = fixture.savedAdoption();
      assert.ok(saved.types.includes('earlier-type'));
      assert.ok(saved.studies.some(([workspace, study]) => workspace === 'earlier-workspace' && study === 'earlier-study'));
      if (kind === 'study') assert.ok(saved.studies.some(([workspace, study]) => workspace === ORIGINAL && study === NEW_STUDY));
      else assert.ok(saved.types.includes(NEW_TYPE));
      assert.equal(fixture.backend.lookups, 1);
      assert.deepEqual(fixture.backend.decisions, []);
      assert.deepEqual(fixture.backend.calls, [], 'reconciliation is read-only and never replays a creation tool');
      fixture.faux.setResponses([fauxAssistantMessage([fauxToolCall(kind === 'study' ? 'propose_study_run' : 'propose_type_basis',
        kind === 'study' ? { workspace_id: ORIGINAL, study_id: NEW_STUDY } : { type_id: NEW_TYPE })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('等待下一步的单独接受。')])]);
      await fixture.agent.send(fixture.id, '继续下一步', fixture.context);
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const view = await fixture.agent.view(fixture.id);
        if (view.waiting.length || !view.running) break;
        await new Promise(done => setTimeout(done, 10));
      }
      const pending = await fixture.agent.view(fixture.id);
      assert.equal(pending.waiting.length, 1, JSON.stringify(pending));
      assert.equal(pending.waiting[0].id, 'next-proposal', 'recovering a created identity does not approve the next write');
      assert.equal(fixture.backend.opened[0].workspace_id, kind === 'study' ? ORIGINAL : NEW_TYPE);
      assert.deepEqual(fixture.backend.decisions, []);
      assert.equal(fixture.backend.lookups, 1, 'the completed recovery is durable when the conversation reopens for a prompt');
      await fixture.agent.stop(fixture.id);
      assert.deepEqual(fixture.backend.decisions, [{ id: 'next-proposal', accept: false }]);
    } finally { await fixture.close(); }
  });
}

for (const invalid of ['failed', 'incomplete', 'unapproved'] as const) {
  test(`recovery does not adopt ${invalid} creation receipts, even if the transcript names a target`, async () => {
    const receipt = invalid === 'incomplete' ? { kind: 'type', workspace_id: NEW_TYPE }
      : { kind: 'type', workspace_id: NEW_TYPE, type_id: NEW_TYPE, ...(invalid === 'failed' ? { executed: false, status: 'failed', error: { message: '创建未执行' } } : {}) };
    const fixture = await interrupted('type', 'pending', invalid === 'unapproved' ? 'pending' : 'approved', receipt);
    try {
      await fixture.agent.view(fixture.id);
      assert.deepEqual(fixture.savedAdoption(), { types: ['earlier-type'], studies: [['earlier-workspace', 'earlier-study']] });
      fixture.faux.setResponses([fauxAssistantMessage([fauxToolCall('propose_type_basis', { type_id: NEW_TYPE })], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxText('这个对象没有获得当前会话的创建授权。')])]);
      await fixture.agent.send(fixture.id, '继续声称创建的型号', fixture.context);
      await fixture.agent.idle(fixture.id);
      assert.deepEqual(fixture.backend.calls, []);
      assert.deepEqual(fixture.backend.opened, []);
      assert.ok(steps(await fixture.agent.view(fixture.id)).some(step => step.reason?.includes('绑定了另一个工作台对象')));
      assert.deepEqual(fixture.backend.decisions, invalid === 'unapproved' ? [{ id: 'creation', accept: false }] : []);
    } finally { await fixture.close(); }
  });
}

for (const kind of ['delivery', 'specification'] as const) for (const localStatus of ['pending', 'accepted'] as const) {
  test(`recovery restores the saved formal PDF ${kind} card from a ${localStatus} local step without exporting again`, async () => {
    // Protocol metadata only: the real PDF bytes and T4 source binding are
    // separately verified by the backend and integration export tests.
    const receipt = { kind, workspace_id: ORIGINAL, title: kind === 'delivery' ? '已保存计算书' : '已保存规格书',
      download_url: '/api/agent/files/creation', href: '/api/agent/files/creation', media_type: 'application/pdf',
      digest: 'a'.repeat(64), source_digest: 'b'.repeat(64), model_digest: 'c'.repeat(64),
      document_kind: kind === 'delivery' ? 'calculation' : 'specification',
      document: { organization: '协议恢复测试单位', number: 'RECOVERY-TEST', revision: 'A' },
      source: { workspace_id: ORIGINAL, revision: 1, ...(kind === 'delivery'
        ? { study_id: OLD_STUDY, run_id: 'saved-run' } : { type_id: ORIGINAL }) } };
    const fixture = await interrupted(kind, localStatus, 'approved', receipt);
    try {
      const recovered = steps(await fixture.agent.view(fixture.id))[0];
      assert.equal(recovered.status, 'done');
      assert.equal(recovered.proposal?.status, 'accepted');
      const card = recovered.card;
      assert.ok(card?.kind === 'saved_file', 'recovery must restore the actual saved file entry point, not only a successful step');
      assert.equal(card.format, 'pdf');
      assert.equal(card.title, receipt.title);
      assert.equal(card.download_url, receipt.download_url);
      assert.equal(card.href, kind === 'delivery' ? `cablesim:study/${OLD_STUDY}?workspace=${ORIGINAL}&run=saved-run` : `cablesim:type/${ORIGINAL}`);
      const messages = fixture.savedMessages().filter(message => message.role === 'toolResult' && message.toolCallId === 'interrupted-call');
      assert.equal(messages.length, 1);
      assert.ok(messages[0].role === 'toolResult');
      const text = messages[0].content.filter(part => part.type === 'text').map(part => part.text).join('\n');
      assert.deepEqual(JSON.parse(text).data.receipt, receipt, 'the recovered observation retains the exact saved URL, digests and source identity');
      await fixture.restart();
      assert.deepEqual(steps(await fixture.agent.view(fixture.id))[0].card, card, 'the restored card is persisted across another restart');
      await assert.rejects(fixture.agent.decide('creation', true, undefined, fixture.id), { code: 'PROPOSAL_UNKNOWN' });
      assert.equal(fixture.backend.lookups, 1);
      assert.deepEqual(fixture.backend.decisions, [], 'restoring or reopening a completed PDF never accepts an export again');
      assert.deepEqual(fixture.backend.calls, [], 'the saved receipt is not a request to run another export');
      assert.deepEqual(fixture.backend.opened, []);
      assert.deepEqual(fixture.savedAdoption(), { types: ['earlier-type'], studies: [['earlier-workspace', 'earlier-study']] });
    } finally { await fixture.close(); }
  });
}
