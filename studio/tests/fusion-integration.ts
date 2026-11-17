// Real FastAPI + ToolBroker + pi integration. Only the model is scripted. Fresh release data is created through the same seeder
// as run_demo; the test never opens a developer database and never runs native finite-element solvers.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { createSidecar, type Sidecar } from '../fusion/server.ts';
import type { ChatView, Proposal } from '../shared/types.ts';
import { installConditionWorkflow, installImportRefusal, installMissingData, installStudyRead, installStudyWorkflow, installTypeWorkflow, type FlowState } from './fusion-scripts.ts';
import { scriptedModel, steps, toolText } from './support.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const home = mkdtempSync(join(tmpdir(), 'cablesim-fusion-integration-'));
const TOKEN = 'fusion-integration-scoped-transport';
let process_: ChildProcess;
let serverLog = '';
let url = '';
let sidecar: Sidecar;
let faux: Awaited<ReturnType<typeof scriptedModel>>['faux'];
let runtime: Awaited<ReturnType<typeof scriptedModel>>['runtime'];
let fixture: { workspace: string; study: string; run: string };
let manifest: any;
let workflow: FlowState;
let studyConversation: string;

async function port(): Promise<number> {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const value = (server.address() as { port: number }).port;
  await new Promise<void>(done => server.close(() => done()));
  return value;
}

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const result = await fetch(url + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await result.json();
  assert.ok(result.ok, `${path}: ${JSON.stringify(value)}`);
  return value as T;
}

before(async () => {
  const backendPort = await port();
  url = `http://127.0.0.1:${backendPort}`;
  const environment = { ...process.env, PYTHONPATH: REPO, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8',
    NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1', CABLESIM_AGENT_SIDECAR_TOKEN: TOKEN,
    CABLESIM_DB: join(home, 'engineering.sqlite'), CABLESIM_DATASETS_DIR: join(home, 'datasets'), CABLESIM_REPRODUCTION_LIBRARY: join(home, 'library') };
  for (const key of Object.keys(environment)) if (/^(CABLESIM_LLM_|CABLE_STUDIO_MODEL_|DEEPSEEK_API_KEY)/.test(key)) delete environment[key as keyof typeof environment];
  const script = `from pathlib import Path
import importlib.util, os
spec = importlib.util.spec_from_file_location('fusion_seed', 'frontend/scripts/seed-engineering-demo.py')
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)
seed.seed_release(Path(os.environ['CABLESIM_DB']))
from backend.main import create_app
import uvicorn
uvicorn.run(create_app(os.environ['CABLESIM_DB']), host='127.0.0.1', port=${backendPort}, log_level='warning', access_log=False)
`;
  process_ = spawn(process.env.CABLE_STUDIO_PYTHON ?? 'python', ['-u', '-c', script], { cwd: REPO, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  process_.stdout?.on('data', value => { serverLog += value.toString(); });
  process_.stderr?.on('data', value => { serverLog += value.toString(); });
  const deadline = Date.now() + 180_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (process_.exitCode !== null || process_.signalCode !== null) throw new Error(`The real platform did not start: ${serverLog}`);
    ready = await fetch(url + '/api/workspaces', { signal: AbortSignal.timeout(1500) }).then(response => response.ok).catch(() => false);
    if (ready) break;
    await new Promise(done => setTimeout(done, 150));
  }
  assert.ok(ready, `The real platform did not become ready: ${serverLog}`);
  manifest = JSON.parse(readFileSync(join(home, 'engineering.seed.json'), 'utf8'));
  fixture = manifest.studies.find((study: any) => study.title.includes('110 kV') && study.run && !study.saved_evidence);
  assert.ok(fixture?.workspace && fixture.study && fixture.run, 'the declared release example must have its own saved IEC run');
  const scripted = await scriptedModel();
  faux = scripted.faux;
  runtime = scripted.runtime;
  sidecar = createSidecar({ backendUrl: url, token: TOKEN, home: join(home, 'sidecar'), port: 8111, runtime });
}, { timeout: 190_000 });

after(async () => {
  if (sidecar) await sidecar.close();
  if (process_ && process_.exitCode === null && process_.signalCode === null) {
    process_.kill('SIGTERM');
    await Promise.race([new Promise<void>(done => process_.once('exit', () => done())), new Promise(done => setTimeout(done, 5000))]);
    if (process_.exitCode === null && process_.signalCode === null) { process_.kill('SIGKILL'); await new Promise<void>(done => process_.once('exit', () => done())); }
  }
  rmSync(home, { recursive: true, force: true });
});

afterEach(async context => {
  if (sidecar) for (const conversation of await sidecar.agent.list()) if (conversation.running) await sidecar.agent.stop(conversation.id);
  if (serverLog.includes('ERROR')) { context.diagnostic(serverLog.slice(-18_000)); serverLog = ''; }
});

async function nextView(session: string, predicate: (view: ChatView) => boolean, timeout = 60_000): Promise<ChatView> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const view = await sidecar.agent.view(session);
    if (predicate(view)) return view;
    await new Promise(done => setTimeout(done, 30));
  }
  throw new Error('Timed out while waiting for the actual Agent state: ' + JSON.stringify(await sidecar.agent.view(session)));
}

async function acceptEach(session: string, verify?: (proposal: Proposal) => Promise<void>): Promise<ChatView> {
  for (let count = 0; count < 12; count += 1) {
    const view = await nextView(session, view => view.waiting.length > 0 || !view.running);
    if (!view.running) return view;
    assert.equal(view.waiting.length, 1, 'tools execute sequentially and only one immutable proposal waits at a time');
    const proposal = view.waiting[0];
    assert.ok(proposal.changes.length && proposal.checks?.length, 'the reviewer sees actual changes and effects');
    await verify?.(proposal);
    await sidecar.agent.decide(proposal.id, true, '隔离验收：人工逐项接受', session);
  }
  throw new Error('The workflow exceeded its expected number of human decisions');
}

function savedSpecification(view: ChatView, state: FlowState) {
  const completed = steps(view).filter(step => step.tool === 'propose_type_specification' && step.status === 'done');
  assert.equal(completed.length, 1, 'the accepted specification must remain a completed step in the actual conversation');
  const card = completed[0].card;
  assert.ok(card?.kind === 'saved_file', 'the specification step must retain its downloadable file card alongside earlier cards for this type');
  assert.equal(card.document_kind, '规格书');
  assert.equal(card.format, 'pdf');
  assert.ok(state.typeId && state.file, 'the file card needs the actual accepted type and saved file receipt');
  assert.equal(card.href, `cablesim:type/${encodeURIComponent(state.typeId)}`);
  assert.equal(card.download_url, state.file);
  assert.match(card.download_url, /^\/api\/agent\/files\//);
  return card;
}

test('a read answer and its result card use the exact saved platform figures', async () => {
  const state = installStudyRead(faux, fixture);
  const { session } = await sidecar.agent.send(undefined, '研究的结论是什么，受什么限制？');
  await sidecar.agent.idle(session);
  assert.equal(state.failure, undefined);
  assert.equal(state.done, true);
  const view = await sidecar.agent.view(session);
  const card = steps(view).map(step => step.card).find(card => card?.kind === 'saved_run');
  assert.equal(card?.kind, 'saved_run');
  if (card?.kind !== 'saved_run') return;
  const current = state.result!.headlines.find((point: any) => point.key === 'ampacity').display_value;
  assert.equal(card.view.current, current.toFixed(1));
  assert.equal(card.view.tier, 'reference');
  assert.match(card.view.tier_note!, /未声明/);
  const tools = sidecar.agent.inspect(session).tools;
  assert.ok(!tools.some(name => /approve|reject|^bash$|^write$|^edit$/.test(name)));
});

test('create a study, run it and export its calculation book; each business write waits for its own acceptance', { timeout: 90_000 }, async () => {
  workflow = installStudyWorkflow(faux, fixture);
  const original = await api<any[]>(`/api/workspaces/${fixture.workspace}/studies`);
  const { session } = await sidecar.agent.send(undefined, '复制城南保存工况新建直埋校核，算出来并导出计算书',
    { workspace_id: fixture.workspace, study_id: fixture.study, label: '当前研究详情' });
  studyConversation = session;
  const accepted: string[] = [];
  const view = await acceptEach(session, async proposal => {
    accepted.push(proposal.operation);
    if (proposal.operation === 'propose_study') assert.equal((await api<any[]>(`/api/workspaces/${fixture.workspace}/studies`)).length, original.length);
    if (proposal.operation === 'propose_study_run') {
      const runs = await api<{ items: any[] }>(`/api/workspaces/${fixture.workspace}/studies/${workflow.study}/runs`);
      assert.equal(runs.items.length, 0, 'no saved run before this second acceptance');
    }
    if (proposal.operation === 'propose_delivery') {
      const rows = await api<any[]>(`/api/workspaces/${fixture.workspace}/deliveries`);
      assert.ok(!rows.some(row => row.sources?.some((source: any) => source.run_id === workflow.run || source.run === workflow.run)), 'no delivery for the new run before this third acceptance');
    }
  });
  assert.equal(workflow.failure, undefined);
  assert.equal(workflow.done, true);
  assert.deepEqual(accepted, ['propose_study', 'propose_study_run', 'propose_delivery']);
  assert.ok(steps(view).every(step => step.status === 'done'));
  const document = await fetch(url + workflow.file!).then(response => response.text());
  assert.match(document, /计算|电流|研究/);
  assert.ok(steps(view).some(step => step.card?.kind === 'saved_file'));
});

test('modify a saved condition, recompute and compare real runs without replacing the earlier result', { timeout: 90_000 }, async () => {
  assert.ok(workflow?.study && workflow?.run, 'run the whole integration file in order');
  // A later message after a sidecar restart must retain the explicitly accepted new-study scope, even if its iframe still identifies
  // the original study. This reload verifies persisted references without re-executing an already accepted action.
  await sidecar.close();
  sidecar = createSidecar({ backendUrl: url, token: TOKEN, home: join(home, 'sidecar'), port: 8111, runtime });
  const workspace = await api(`/api/workspaces/${fixture.workspace}`);
  const section = workspace.domain.sections[0];
  const escape = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1');
  const path = `/sections/${escape(section.id)}/medium/surface_temperature`;
  const state = installConditionWorkflow(faux, { workspace: fixture.workspace, study: workflow.study!, run: workflow.run!, path, value: 26 });
  const { session } = await sidecar.agent.send(studyConversation, '把地表温度改为26 °C，重算并与刚才那次比较',
    { workspace_id: fixture.workspace, study_id: fixture.study, label: '当前研究详情' });
  const view = await acceptEach(session);
  assert.equal(state.failure, undefined);
  assert.equal(state.done, true);
  assert.notEqual(state.run, state.previousRun);
  assert.ok(state.comparison);
  const compared = state.comparison!.differences[0].quantities.find((point: any) => point.key === 'ampacity' && point.unit === 'A');
  assert.equal(compared.baseline, workflow.result!.headlines.find((point: any) => point.key === 'ampacity').display_value);
  assert.equal(compared.value, state.result!.headlines.find((point: any) => point.key === 'ampacity').display_value);
  assert.ok(compared.difference < 0, 'the actual saved IEC result reflects the higher surface temperature');
  assert.ok(steps(view).every(step => step.status === 'done'));
  const previous = await api(`/api/workspaces/${fixture.workspace}/studies/${workflow.study}/runs/${state.previousRun}`);
  assert.equal(previous.id, state.previousRun);
  assert.equal(previous.freshness, 'historical');
});

test('create a type, revise its insulation, run standard checks and save its internal specification through approvals', { timeout: 120_000 }, async () => {
  const choices = await api('/api/types/creation-options');
  const source = choices.library.find((item: any) => /YJV22/.test(item.name) && /300/.test(item.name));
  assert.ok(source, 'use the real released type version, not a synthetic model');
  const state = installTypeWorkflow(faux, { workspace: fixture.workspace, source, thicknessMm: 4.6 });
  const { session } = await sidecar.agent.send(undefined, '从保存型号建立草稿，把绝缘厚度改为4.6 mm，核对并出内部规格书');
  const view = await acceptEach(session);
  assert.equal(state.failure, undefined);
  assert.equal(state.done, true);
  assert.ok(steps(view).some(step => step.tool === 'propose_type_changes' && step.status === 'done'));
  assert.ok(steps(view).some(step => step.tool === 'propose_study_run' && step.status === 'done'));
  const file = savedSpecification(view, state);
  const response = await fetch(url + file.download_url);
  assert.ok(response.ok);
  assert.equal(response.headers.get('content-type')?.split(';')[0], 'application/pdf');
  const pdf = Buffer.from(await response.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const type = await api(`/api/workspaces/${state.typeId}`);
  assert.equal(type.domain.cable_types[0].cores[0].layers.find((layer: any) => layer.role === 'insulation').thickness, 0.0046);
});

test('an existing type with saved calculation evidence completes input paging, revision checks and specification within the ordinary budget', { timeout: 120_000 }, async t => {
  const source = manifest.types.find((item: any) => item.name.startsWith('YJV22') && !item.teaching);
  assert.ok(source?.workspace, 'use the same saved release type as the browser walk');
  const beforeType = await api(`/api/workspaces/${source.workspace}`);
  const evidence = await api(`/api/types/${source.workspace}/display-runs?after=0&limit=5`);
  assert.ok(evidence.items.length > 0, 'this regression must retain the existing saved calculations, not replace the type with an empty draft');
  const state = installTypeWorkflow(faux, { workspace: source.workspace, typeId: source.workspace, thicknessMm: 4.7 });
  const accepted: string[] = [];
  let linkedChanges: Proposal['changes'] = [];
  const { session } = await sidecar.agent.send(undefined, '把已有 YJV22 三芯型号的绝缘厚度改为4.7 mm，按新修订核对后出内部规格书');
  const view = await acceptEach(session, async proposal => {
    accepted.push(proposal.operation);
    if (proposal.operation === 'propose_type_changes') {
      const waiting = await api(`/api/workspaces/${source.workspace}`);
      assert.equal(waiting.revision, beforeType.revision);
      assert.deepEqual(waiting.domain, beforeType.domain, 'input paging never writes the proposed thickness');
      const cable = beforeType.domain.cable_types[0];
      const escape = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');
      const requested = cable.cores.map((core: any) => {
        const path = `/cable_types/${escape(cable.id)}/cores/${escape(core.id)}/layers/insulation/thickness`;
        const change = proposal.changes.find(change => change.field === path);
        assert.ok(change, 'every saved core insulation must be read before proposing the change');
        assert.match(change.before, / mm$/);
        assert.ok(Math.abs(Number.parseFloat(change.before) - core.layers.find((layer: any) => layer.role === 'insulation').thickness * 1000) < 1e-9);
        assert.equal(change.after, '4.7 mm');
        return path;
      });
      linkedChanges = proposal.changes.filter(change => !requested.includes(change.field));
      assert.ok(linkedChanges.every(change => /\/cores\/[^/]+\/(x|z)$/.test(change.field)), 'the existing tangent-core editor exposes its dependent coordinate changes for review');
    }
  });
  assert.equal(state.failure, undefined);
  assert.equal(state.done, true);
  assert.deepEqual(accepted, ['propose_type_changes', 'propose_type_basis', 'propose_study', 'propose_study_run', 'propose_type_specification']);
  const completed = steps(view);
  assert.ok(completed.every(step => step.status === 'done'));
  const inputPages = completed.filter(step => step.tool === 'type_read').length;
  assert.ok(inputPages > 1, 'the actual saved input exercises continuation pages');
  assert.ok(completed.some(step => step.tool === 'workspace_read'), 'the accepted fields are read back at the adopted revision before the check');
  const saved = await api(`/api/workspaces/${state.typeId}`);
  for (const core of saved.domain.cable_types[0].cores) {
    assert.equal(core.layers.find((layer: any) => layer.role === 'insulation').thickness, 0.0047);
  }
  for (const change of linkedChanges) {
    const tokens = change.field.split('/').slice(1).map(token => token.replaceAll('~1', '/').replaceAll('~0', '~'));
    const core = saved.domain.cable_types[0].cores.find((item: any) => item.id === tokens[3]);
    assert.match(change.after, / mm$/);
    assert.ok(Math.abs(Number.parseFloat(change.after) - core[tokens.at(-1)!] * 1000) < 1e-9, 'reviewed dependent coordinates must match the actual saved type');
  }
  const run = await api(`/api/workspaces/${state.typeId}/studies/${state.study}/runs/${state.run}`);
  assert.equal(run.status, 'succeeded');
  assert.equal(run.integrity, 'verified');
  const file = savedSpecification(view, state);
  const response = await fetch(url + file.download_url);
  assert.ok(response.ok);
  assert.equal(response.headers.get('content-type')?.split(';')[0], 'application/pdf');
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  t.diagnostic(JSON.stringify({ existingSavedRuns: evidence.items.length, inputPages,
    toolSteps: completed.length, approvals: accepted.length, linkedChanges, type: state.typeId, run: state.run }));
});

test('rejecting or stopping a proposed write leaves the real study list unchanged', { timeout: 60_000 }, async () => {
  faux.setResponses([fauxAssistantMessage([fauxText('这是一段独立的对话。')])]);
  const foreign = await sidecar.agent.send(undefined, '新开一段独立对话');
  await sidecar.agent.idle(foreign.session);
  for (const action of ['reject', 'stop']) {
    const before_ = await api<any[]>(`/api/workspaces/${fixture.workspace}/studies`);
    let refused = '';
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('propose_study', { workspace_id: fixture.workspace, source_study_id: fixture.study, title: '未经接受不能保存' })], { stopReason: 'toolUse' }),
      context => { refused = toolText(context); return fauxAssistantMessage([fauxText('未保存改动。')]); },
    ]);
    const { session } = await sidecar.agent.send(undefined, '提出创建研究');
    const pending = await nextView(session, view => view.waiting.length === 1);
    assert.equal((await api<any[]>(`/api/workspaces/${fixture.workspace}/studies`)).length, before_.length);
    await assert.rejects(sidecar.agent.decide(pending.waiting[0].id, true, undefined, foreign.session), (error: { code?: string }) => error.code === 'PROPOSAL_UNKNOWN');
    assert.equal((await api<any[]>(`/api/workspaces/${fixture.workspace}/studies`)).length, before_.length, 'another conversation cannot accept this pending write');
    if (action === 'reject') await sidecar.agent.decide(pending.waiting[0].id, false, '本次不建立', session);
    else await sidecar.agent.stop(session);
    await sidecar.agent.idle(session);
    assert.equal((await api<any[]>(`/api/workspaces/${fixture.workspace}/studies`)).length, before_.length);
    assert.equal((await sidecar.agent.view(session)).waiting.length, 0);
    if (action === 'reject') assert.match(refused, /拒绝|没有执行/);
  }
});

test('missing input and the unavailable manufacturer structure-table API are explicit refusals with no writes', async () => {
  const before_ = (await api<any[]>(`/api/workspaces/${fixture.workspace}/studies`)).length;
  const typesBefore = (await api('/api/index/objects?kind=type&limit=1')).total;
  for (const install of [() => installMissingData(faux, { workspace: fixture.workspace }), () => installImportRefusal(faux)]) {
    const state = install();
    const { session } = await sidecar.agent.send(undefined, '请完成任务，缺数据时明确拒绝');
    // Missing input deliberately omits a source/method; the structure-table path is absent, not a mocked successful import.
    await sidecar.agent.idle(session);
    const view = await sidecar.agent.view(session);
    assert.equal(state.failure, undefined);
    assert.equal(state.done, true);
    assert.equal(view.waiting.length, 0);
    assert.ok(steps(view).some(step => step.status === 'failed'));
  }
  assert.equal((await api<any[]>(`/api/workspaces/${fixture.workspace}/studies`)).length, before_);
  assert.equal((await api('/api/index/objects?kind=type&limit=1')).total, typesBefore);
});
