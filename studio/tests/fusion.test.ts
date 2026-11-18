// The Agent sidecar of the fused product, used the way it is used: a question goes to the model, the model's tool calls go to the platform
// (here a stand-in that records what it was asked), and what the page shows is what came back. The platform's own checks of a call are
// tested on the platform (tests/test_harness_external.py); here is what the sidecar owes it: the project's session per question, the
// token, no project id in the arguments the platform's contract does not know, the way back to the workbench.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { Backend, type ToolResult } from '../fusion/backend.ts';
import { describeResult } from '../fusion/cards.ts';
import { createSidecar, type Sidecar } from '../fusion/server.ts';
import { backendTools, ScopeBook } from '../fusion/tools.ts';
import { MODEL_RESULT_MAX_CHARS, MODEL_RESULT_MAX_BYTES } from '../fusion/model-result.ts';
import { lastText, scriptedModel, steps, toolText } from './support.ts';

const TOKEN = 'test-token-0123456789';
const STUDY = '城南线路 · 110 kV 直埋单回校核';
const CATALOG = [
  { name: 'object_find', title: '查找对象', kind: 'read', scope: 'global', description: '按名称查名片。', parameters: { type: 'object', properties: { kind: { type: 'string' }, q: { type: 'string' } }, required: [], additionalProperties: false } },
  { name: 'run_read', title: '读取运行结果要点', kind: 'read', scope: 'workspace', description: '读一次保存运行的量值。', parameters: { type: 'object', properties: { study_id: { type: 'string' }, run_id: { type: 'string' } }, required: ['run_id'], additionalProperties: false } },
];
const ok = (data: unknown) => ({ status: 'ok', summary: '已读取。', data, diagnostics: [], next_actions: [] });

const seen = { opened: [] as any[], calls: [] as any[], finished: [] as string[], headers: [] as (string | undefined)[] };
let platform: Server;
let platformUrl = '';
let sidecar: Sidecar;
let faux: Awaited<ReturnType<typeof scriptedModel>>['faux'];
const home = mkdtempSync(join(tmpdir(), 'cable-fusion-'));
const waitFor = async (condition: () => boolean) => { for (let tries = 0; tries < 100 && !condition(); tries += 1) await new Promise(done => setTimeout(done, 20)); };

before(async () => {
  platform = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk as Buffer));
    request.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {};
      const reply = (value: unknown, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
      // What needs the token is the platform's agent interface; the platform's public reads (the method names) need none.
      if ((request.url ?? '').startsWith('/api/agent/external')) seen.headers.push(request.headers.authorization);
      const path = request.url ?? '';
      if (path === '/api/agent/external/tools') return reply(CATALOG);
      if (path.startsWith('/api/methods')) return reply([{ method: { plugin_id: 'cablesim.other', version: '1.0.0' }, name: '测试方法' }]);
      if (path === '/api/agent/external/sessions') { seen.opened.push(body); return reply({ session: 's-1', turn: 't-1', context: { kind: 'project', id: body.workspace_id } }); }
      if (path.endsWith('/finish')) { seen.finished.push(path.split('/').slice(-4).join('/')); return reply({ finished: true }); }
      if (path === '/api/agent/external/calls') {
        // The platform's request model forbids any other field (pydantic StrictModel): a call with one is refused, as here.
        if (Object.keys(body).some(key => !['tool', 'arguments', 'session', 'turn', 'discovery'].includes(key))) return reply({ detail: [{ msg: 'Extra inputs are not permitted' }] }, 422);
        seen.calls.push(body);
        if (body.tool === 'object_find') return reply(ok({ items: [{ id: 'st-1', name: STUDY, parent: { kind: 'project', id: 'w-1', name: '城南线路 · 110 kV 直埋单回' } }],
          ...(body.arguments.q === '完整证据' ? { saved_evidence: '保存输入与限制。'.repeat(4000), final_value: 612.3456 } : {}) }));
        if (body.arguments.run_id === 'r-bad') return reply({ status: 'error', summary: '没有取得结果。', data: {}, diagnostics: [{ code: 'RUN_NOT_FOUND', message: '本工程中没有此保存运行。' }], next_actions: [] });
        return reply(ok({ run_id: 'r-1', study_id: 'st-1', status: 'succeeded', method: { plugin_id: 'cablesim.other', capability: 'x', version: '1.0.0', release_digest: 'abc' }, headlines: [], cases: [] }));
      }
      reply({ detail: '没有这个接口。' }, 404);
    });
  });
  await new Promise<void>(done => platform.listen(0, '127.0.0.1', done));
  platformUrl = `http://127.0.0.1:${(platform.address() as { port: number }).port}`;
  const scripted = await scriptedModel();
  faux = scripted.faux;
  sidecar = createSidecar({ backendUrl: platformUrl, token: TOKEN, home, port: 8111, runtime: scripted.runtime });
});

after(async () => {
  await sidecar.close();
  await new Promise<void>(done => platform.close(() => done()));
  rmSync(home, { recursive: true, force: true });
});

test('a question about a study reaches the platform through a session of its own, and the page shows what came back', async () => {
  let sent = '';
  let told = '';
  faux.setResponses([
    context => { sent = JSON.stringify(context); return fauxAssistantMessage([fauxToolCall('object_find', { kind: 'study', q: '城南' })], { stopReason: 'toolUse' }); },
    fauxAssistantMessage([fauxToolCall('run_read', { workspace_id: 'w-1', study_id: 'st-1', run_id: 'r-1' })], { stopReason: 'toolUse' }),
    context => { told = toolText(context); return fauxAssistantMessage([fauxText('结论在卡片里。')]); },
  ]);
  const question = '城南线路 110 kV 直埋单回校核这项研究的结论是什么？';
  const { session } = await sidecar.agent.send(undefined, question);
  await sidecar.agent.idle(session);
  await waitFor(() => seen.finished.length > 0);

  // The model has the platform's tools and nothing built in; a project's tools ask for the project, the global one does not.
  assert.deepEqual([...sidecar.agent.inspect(session).tools].sort(), ['object_find', 'read', 'run_read']);
  const defined = backendTools(new Backend(platformUrl, TOKEN), CATALOG as never, () => new ScopeBook(new Backend(platformUrl, TOKEN), ''), []);
  const schema = (name: string) => defined.find(tool => tool.name === name)!.parameters as unknown as { properties: Record<string, unknown>; required?: string[] };
  assert.ok('workspace_id' in schema('run_read').properties && schema('run_read').required?.[0] === 'workspace_id');
  assert.ok(!('workspace_id' in schema('object_find').properties));
  for (const leak of ['开发约定', 'AGENTS.md', 'CLAUDE.md', '<cwd>']) assert.ok(!sent.includes(leak), `the request does not carry ${leak}`);
  assert.ok(sent.includes('每一个业务写入都是提案'));
  assert.ok(sent.includes('<name>ampacity-rating</name>') && sent.includes('<name>cable-import-check</name>'));

  // What the platform was asked: the global lookup outside any session, then one session for the project named, opened with the
  // question as it was asked, and the call inside it without the project id the platform's contract does not know; then the turn ended.
  assert.equal(seen.calls[0].tool, 'object_find');
  assert.ok(!('session' in seen.calls[0]));
  assert.deepEqual(seen.opened, [{ workspace_id: 'w-1', message: question, conversation_id: session }]);
  assert.deepEqual(seen.calls[1], { tool: 'run_read', arguments: { study_id: 'st-1', run_id: 'r-1' }, session: 's-1', turn: 't-1' });
  assert.deepEqual(seen.finished, ['s-1/turns/t-1/finish']);
  assert.ok(seen.headers.every(header => header === `Bearer ${TOKEN}`), 'every call carries the token');
  assert.ok(told.includes('已读取'), 'the model is told what the platform returned');
  assert.ok(told.includes('测试方法 1.0.0') && !told.includes('cablesim.other') && !told.includes('abc'), 'a method reaches the model by its name and version, not its identifier');

  // What the page shows: both steps done, the second named by the study (learned from the first), with a way to the workbench.
  const view = await sidecar.agent.view(session);
  const done = steps(view);
  assert.deepEqual(done.map(step => [step.tool, step.status]), [['object_find', 'done'], ['run_read', 'done']]);
  assert.equal(done[1].label, '读取运行结果要点');
  assert.equal(done[1].target, `研究「${STUDY}」`);
  assert.deepEqual(done[1].card, { kind: 'open', label: '查看已保存运行', href: 'cablesim:study/st-1?workspace=w-1&run=r-1' });
  assert.equal(lastText(view), '结论在卡片里。');
});

test('a call the platform refused is a failed step with the platform\'s own reason, and the model is told it', async () => {
  seen.calls.length = 0;
  let told = '';
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('run_read', { workspace_id: 'w-1', study_id: 'st-1', run_id: 'r-bad' })], { stopReason: 'toolUse' }),
    context => { told = toolText(context); return fauxAssistantMessage([fauxText('没有读到。')]); },
  ]);
  const { session } = await sidecar.agent.send(undefined, '读一条不存在的运行');
  await sidecar.agent.idle(session);
  const step = steps(await sidecar.agent.view(session))[0];
  assert.equal(step.status, 'failed');
  assert.ok(step.reason?.includes('本工程中没有此保存运行'), step.reason);
  assert.ok(told.includes('本工程中没有此保存运行'));
  assert.equal(step.card, undefined, 'no card for a result that was not read');
});

test('without the platform the Agent says so, not that no model is configured', async () => {
  const lonely = createSidecar({ backendUrl: 'http://127.0.0.1:9', token: TOKEN, home: mkdtempSync(join(tmpdir(), 'cable-fusion-down-')), port: 8111 });
  try {
    const status = await lonely.agent.status();
    assert.equal(status.configured, false);
    assert.ok(status.hint?.includes('连不上老后端'), status.hint);
    await assert.rejects(lonely.agent.send(undefined, '你好'), (error: { code?: string }) => error.code === 'BACKEND_UNREACHABLE');
  } finally {
    await lonely.close();
  }
});

test('a large structured tool result is bounded valid JSON, retains the final quantity and identifies a read-only detail page', async () => {
  let parsed: any;
  let text = '';
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('object_find', { q: '完整证据' })], { stopReason: 'toolUse' }),
    context => { text = toolText(context); parsed = JSON.parse(text); return fauxAssistantMessage([fauxText('摘要已读取；未展开的长文本仍在保存记录。')]); },
  ]);
  const { session } = await sidecar.agent.send(undefined, '读取完整保存证据');
  await sidecar.agent.idle(session);
  assert.ok(text.length <= MODEL_RESULT_MAX_CHARS && Buffer.byteLength(text) <= MODEL_RESULT_MAX_BYTES);
  assert.equal(parsed.data.saved_evidence.omitted, true);
  assert.equal(parsed.data.saved_evidence.characters, '保存输入与限制。'.length * 4000);
  assert.equal(parsed.data.final_value, 612.3456);
  assert.equal(parsed.detail.truncated, true);
  assert.deepEqual(parsed.detail.read, { tool: 'object_find', arguments: { q: '完整证据', result_view: '', result_offset: 0 } });
  assert.ok(parsed.detail.omitted_paths.includes('/saved_evidence'));
  assert.ok(steps(await sidecar.agent.view(session)).every(step => step.status === 'done'));
});

test('workbench scope reaches the model without being appended as machine identifiers in the user message', async () => {
  let contextSent = '';
  faux.setResponses([context => { contextSent = JSON.stringify(context); return fauxAssistantMessage([fauxText('已定位当前研究。')]); }]);
  const question = '读取当前研究';
  const { session } = await sidecar.agent.send(undefined, question, { workspace_id: 'workbench-workspace', study_id: 'workbench-study', label: '当前工作台' });
  await sidecar.agent.idle(session);
  assert.ok(contextSent.includes('workbench-workspace') && contextSent.includes('workbench-study'));
  const user = (await sidecar.agent.view(session)).items.find(item => item.role === 'user')!;
  assert.deepEqual(user.parts, [{ type: 'text', text: question }]);
});

test('a historical result card retains the saved method version and never infers engineering confidence from geometry', async () => {
  class HistoricalBackend extends Backend {
    read = async <T>(path: string): Promise<T> => {
      if (path.includes('/runs?')) return { items: [{ id: 'saved-run', sequence: 2, freshness: 'historical', headline: '允许电流 612.3 A（连续额定）受限于电缆 A' }], next_cursor: null } as T;
      if (path.endsWith('/input')) return { run_id: 'saved-run', case_id: 'case', integrity: 'verified', input: {
        cable_types: [{ id: 'type', rating: { max_conductor_temperature: { normal: 363.15 } } }],
        circuits: [{ id: 'circuit', cable_type: 'type', cables: [{ id: 'cable' }] }],
        sections: [{ medium: { surface_temperature: 298.15 } }], load_cases: [{ currents: { circuit: 500 } }] } } as T;
      if (path.startsWith('/api/index/objects')) return { items: [{ id: 'saved-study', name: '历史校核' }] } as T;
      if (path.startsWith('/api/methods')) return [{ method: { plugin_id: 'cablesim.iec60287', version: '9.0.0' }, name: 'IEC 60287 稳态载流量' }] as T;
      throw new Error('Unexpected card read: ' + path);
    };
  }
  const backend = new HistoricalBackend('http://127.0.0.1:9', 'unused');
  const result = ok({ run_id: 'saved-run', study_id: 'saved-study', status: 'succeeded',
    method: { plugin_id: 'cablesim.iec60287', capability: 'steady-rating', version: '1.2.3' },
    headlines: [{ key: 'ampacity', case_id: 'case', condition: 'rating', entity: 'circuit', display_value: 612.3456, display_unit: 'A' },
      { key: 'conductor_temperature', case_id: 'case', entity: 'cable', condition: 'operating', display_value: 78.2, display_unit: '°C' }],
    cases: [{ case_id: 'case', status: 'succeeded', results: [{ key: 'ampacity', entity: 'circuit', case: 'rating', status: 'available', value: 612.3456, unit: 'A' }],
      factors: [{ key: 'limiting_cable', entity: 'cable' },
        { key: 'temperature_margin', entity: 'cable', condition: 'operating', unit: 'K', value: 11.8 },
        { key: 'current_margin', entity: 'circuit', condition: 'rating', unit: 'A', value: 112.3456 }]
        .map(factor => ({ ...factor, source: { run_id: 'saved-run', case_id: 'case' } })) }],
  }) as ToolResult;
  const shown = await describeResult(backend, 'run_read', { study_id: 'saved-study' }, result, 'workspace');
  assert.equal(shown.card?.kind, 'saved_run');
  if (shown.card?.kind !== 'saved_run') return;
  assert.equal(shown.card.view.current, '612.3', 'display rounding comes from the saved platform number');
  assert.equal(shown.card.view.method, 'IEC 60287 稳态载流量 1.2.3', 'upgrading an installed plugin cannot relabel a historical result');
  assert.equal(shown.card.view.tier, 'reference');
  assert.match(shown.card.view.tier_note!, /保存记录未声明/);
  assert.equal(shown.card.view.freshness, 'historical');
});
