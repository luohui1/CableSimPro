// Real FastAPI + ToolBroker + pi integration. Only the model is scripted. Fresh release data is created through the same seeder
// as run_demo; the test never opens a developer database and never runs native finite-element solvers.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { createSidecar, type Sidecar } from '../fusion/server.ts';
import type { ChatView, Proposal } from '../shared/types.ts';
import { gbRequest, installConditionWorkflow, installGbWorkflow, installMissingData, installRatingTableWorkflow,
  installStudyRead, installStudyWorkflow, installTypeWorkflow, prepareGbFixture, ratingConditions, type FlowState, type GbFixture } from './fusion-scripts.ts';
import { scriptedModel, steps, toolText } from './support.ts';
import { importInventory, installMissingStructureSource, installStructureImport, manufacturerWorkbook } from './fusion-import-scripts.ts';

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
let gbFixture: GbFixture | undefined;

async function port(): Promise<number> {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const value = (server.address() as { port: number }).port;
  await new Promise<void>(done => server.close(() => done()));
  return value;
}

async function api<T = any>(path: string, body?: unknown, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  const result = await fetch(url + path, body === undefined ? {} : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
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

async function ratingSource() {
  const type = manifest.types.find((item: any) => item.name.startsWith('YJV22') && !item.teaching);
  assert.ok(type?.workspace);
  const study = (await api<any[]>(`/api/workspaces/${type.workspace}/studies`)).find(item =>
    item.definition.method.plugin_id === 'cablesim.iec60287' && item.definition.driver.kind === 'batch'
    && item.definition.driver.cases?.every((row: any) => row.metadata?.kind === 'type-rating-table'));
  assert.ok(study, 'the real released type must contain declared rating parameters');
  return { type, study };
}

async function baselineFixture() {
  if (!gbFixture) gbFixture = await prepareGbFixture(api, (await ratingSource()).type.workspace);
  return gbFixture;
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

test('a type rating table saves only accepted explicit conditions and shows the exact immutable platform rows', { timeout: 120_000 }, async () => {
  const { type, study } = await ratingSource();
  const before = await api(`/api/workspaces/${type.workspace}`);
  const count = (await api<any[]>(`/api/workspaces/${type.workspace}/studies`)).length;
  const state = installRatingTableWorkflow(faux, { workspace: type.workspace, sourceStudy: study.id });
  const { session } = await sidecar.agent.send(undefined, '按已保存型号的明示参数，建立25 °C和30 °C的三芯单回直埋载流量表；埋深0.8 m，土壤1.2 K·m/W，50 Hz，两端接地，明确参考工况来源；每次保存和运行先让我接受。');
  const accepted: string[] = [];
  const view = await acceptEach(session, async proposal => {
    accepted.push(proposal.operation);
    if (proposal.operation === 'propose_rating_table') {
      assert.equal((await api<any[]>(`/api/workspaces/${type.workspace}/studies`)).length, count);
      assert.deepEqual((await api(`/api/workspaces/${type.workspace}`)).domain, before.domain);
    }
    if (proposal.operation === 'propose_study_run') assert.equal((await api(`/api/workspaces/${type.workspace}/studies/${state.study}/runs`)).items.length, 0);
  });
  assert.equal(state.failure, undefined);
  assert.equal(state.done, true);
  assert.deepEqual(accepted, ['propose_rating_table', 'propose_study_run']);
  const saved = await api(`/api/design/workspaces/${type.workspace}/rating-table-runs/${state.run}`);
  assert.equal(saved.run.status, 'succeeded');
  assert.equal(saved.run.integrity, 'verified');
  assert.deepEqual(state.table, saved.rows);
  assert.deepEqual(saved.run.snapshot.definition.parameters, study.definition.parameters);
  const conditions = ratingConditions();
  for (let index = 0; index < conditions.length; index += 1) {
    const row = saved.rows[index], requested = conditions[index];
    for (const [key, value] of Object.entries(requested)) assert.equal(row.condition[key], value, key);
    const output = saved.run.output.cases.find((item: any) => item.case_id === row.case_id);
    const current = output.results.find((item: any) => item.key === 'ampacity' && item.case === 'rating' && item.unit === 'A' && item.status === 'available');
    assert.equal(row.value_a, current.value);
  }
  const card = steps(view).map(step => step.card).findLast(card => card?.kind === 'saved_rating_table');
  assert.ok(card?.kind === 'saved_rating_table');
  assert.equal(card.href, `cablesim:type_rating/${type.workspace}?run=${state.run}`);
  assert.equal(card.view.total, saved.rows.length);
  assert.deepEqual(card.view.rows.map(row => ({ case_id: row.case_id, value_a: row.value_a, status: row.status })),
    saved.rows.map((row: any) => ({ case_id: row.case_id, value_a: row.value_a, status: row.status })));
  assert.ok(card.view.method.endsWith(saved.run.snapshot.definition.method.version));
  assert.deepEqual((await api(`/api/workspaces/${type.workspace}`)).domain, before.domain, 'the table never rewrites the saved type facts');
});

test('GB correction uses an explicitly human-confirmed real IEC PDF baseline and preserves the actual coefficients and saved delivery', { timeout: 120_000 }, async () => {
  const reference = await baselineFixture();
  const studyCount = (await api<any[]>(`/api/workspaces/${reference.workspace}/studies`)).length;
  const deliveries = (await api<any[]>(`/api/workspaces/${reference.workspace}/deliveries`)).length;
  const state = installGbWorkflow(faux, { ...reference, baselineReviewed: true });
  const { session } = await sidecar.agent.send(undefined, gbRequest(reference, true));
  const accepted: string[] = [];
  const view = await acceptEach(session, async proposal => {
    accepted.push(proposal.operation);
    if (proposal.operation === 'propose_study') {
      assert.equal((await api<any[]>(`/api/workspaces/${reference.workspace}/studies`)).length, studyCount);
      assert.ok(proposal.changes.some(change => change.field.endsWith('baseline_reviewed') && /true|是|已/.test(change.after)), 'the human confirmation stays visible in the proposal');
      for (const [field, value] of [['baseline_source', reference.baselineSource], ['baseline_sha256', reference.baselineDigest], ['baseline_page', String(reference.baselinePage)]]) {
        assert.equal(proposal.changes.find(change => change.field.endsWith('/' + field))?.after, value, 'the person must see the exact accepted baseline ' + field);
      }
    }
    if (proposal.operation === 'propose_study_run') assert.equal((await api(`/api/workspaces/${reference.workspace}/studies/${state.study}/runs`)).items.length, 0);
    if (proposal.operation === 'propose_delivery') assert.equal((await api<any[]>(`/api/workspaces/${reference.workspace}/deliveries`)).length, deliveries);
  });
  assert.equal(state.failure, undefined);
  assert.equal(state.done, true);
  assert.deepEqual(accepted, ['propose_study', 'propose_study_run', 'propose_delivery']);
  const run = await api(`/api/workspaces/${reference.workspace}/studies/${state.study}/runs/${state.run}?view=full`);
  assert.equal(run.status, 'succeeded');
  assert.equal(run.integrity, 'verified');
  const corrected = run.output.cases[0].artifacts['x-cablesim.gb50217-correction'];
  assert.equal(corrected.total_factor, 0.96);
  assert.ok(Math.abs(corrected.corrected_current_a - reference.baselineCurrent * corrected.total_factor) < 1e-8);
  assert.equal(corrected.coefficients[0].factor, corrected.coefficients[0].record.value);
  assert.match(corrected.coefficients[0].record.source_sha256, /^[0-9a-f]{64}$/);
  assert.equal(run.snapshot.definition.parameters.baseline_sha256, reference.baselineDigest);
  assert.equal(run.snapshot.definition.parameters.baseline_page, reference.baselinePage);
  const baseline = await api(`/api/workspaces/${reference.workspace}/studies/${reference.baselineStudy}/runs/${reference.baselineRun}?view=full`);
  assert.deepEqual(run.snapshot.cases[0].input.cable_types, baseline.snapshot.cases[0].input.cable_types, 'correction cannot change the rated voltage or saved cable facts to fit its scope');
  assert.equal(run.snapshot.cases[0].input.circuits[0].system.voltage, 10000);
  assert.equal(run.snapshot.cases[0].input.sections[0].medium.surface_temperature, 303.15);
  assert.equal(baseline.snapshot.cases[0].input.sections[0].medium.surface_temperature, 298.15);
  const open = steps(view).findLast(step => step.tool === 'run_read')?.card;
  assert.ok(open?.kind === 'open' && open.href.includes(state.run!), 'GB opens its own exact saved run without pretending to be an IEC temperature card');
  const response = await fetch(url + state.file!);
  assert.ok(response.ok);
  assert.match(await response.text(), /GB 50217|GB50217/);
});

test('unconfirmed GB baselines and omitted rating-table inputs are explicitly refused without a computed result', { timeout: 120_000 }, async () => {
  const reference = await baselineFixture();
  const state = installGbWorkflow(faux, { ...reference, baselineReviewed: false });
  const { session } = await sidecar.agent.send(undefined, gbRequest(reference, false));
  const view = await acceptEach(session);
  assert.equal(state.failure, undefined);
  assert.equal(state.refused, true);
  assert.equal((await api(`/api/workspaces/${reference.workspace}/studies/${state.study}/runs`)).items.length, 0);
  assert.ok(steps(view).some(step => step.tool === 'propose_study_run' && step.status === 'failed'));
  const { type, study } = await ratingSource();
  const count = (await api<any[]>(`/api/workspaces/${type.workspace}/studies`)).length;
  const missing = installRatingTableWorkflow(faux, { workspace: type.workspace, sourceStudy: study.id, missingSoil: true });
  const other = await sidecar.agent.send(undefined, '建立载流量表，但第一行的土壤热阻率还没有提供，不要代填。');
  await sidecar.agent.idle(other.session);
  assert.equal(missing.failure, undefined);
  assert.equal(missing.refused, true);
  assert.equal((await api<any[]>(`/api/workspaces/${type.workspace}/studies`)).length, count);
  assert.equal((await sidecar.agent.view(other.session)).waiting.length, 0);
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

test('a real attached manufacturer table becomes reviewed drafts and ordinary check runs through four separate acceptances', { timeout: 180_000 }, async () => {
  const file = manufacturerWorkbook(REPO);
  const database = join(home, 'engineering.sqlite');
  const before_ = importInventory(REPO, database);
  const state = installStructureImport(faux, { workspace: fixture.workspace, seriesName: 'Agent 验收 · 人民电器三芯结构表' });
  const { session } = await sidecar.agent.send(undefined, '将附上的人民电器结构表导入型号库并核对，记录关联当前城南工程；每次写入先给我审阅。',
    { workspace_id: fixture.workspace, label: '城南工程' }, [{ filename: file.filename, content_base64: file.content_base64 }]);
  const accepted: string[] = [];
  const view = await acceptEach(session, async proposal => {
    const counts = importInventory(REPO, database);
    const phase = accepted.length;
    assert.equal(counts.type_table_uploads, before_.type_table_uploads + (phase >= 1 ? 1 : 0), 'no platform upload before its acceptance');
    assert.equal(counts.type_table_previews, before_.type_table_previews + (phase >= 2 ? 1 : 0), 'no saved preview before its acceptance');
    assert.equal(counts.type_series, before_.type_series + (phase >= 3 ? 1 : 0), 'no imported series before its acceptance');
    assert.equal(counts.type_series_specs, before_.type_series_specs + (phase >= 3 ? 11 : 0));
    assert.equal(counts.domain_cable_models, before_.domain_cable_models + (phase >= 3 ? 11 : 0));
    assert.equal(counts.study_runs, before_.study_runs, 'no standard check runs before the fourth acceptance');
    if (proposal.operation === 'propose_structure_import') {
      const review = JSON.stringify(proposal.changes);
      assert.ok(review.includes(state.preview!.preview_digest), 'review is tied to the actual immutable preview');
      assert.ok(review.includes(file.filename), 'the source file remains visible in the import proposal');
    }
    accepted.push(proposal.operation);
  });
  assert.equal(state.failure, undefined);
  assert.equal(state.done, true);
  assert.deepEqual(accepted, ['propose_structure_upload', 'propose_structure_preview', 'propose_structure_import', 'propose_structure_check']);
  assert.ok(view.items.some(item => item.role === 'user' && item.attachments?.some(item => item.file === file.filename)), 'the user sees the real attachment');
  assert.equal(state.imported!.created, 11);
  const cards = steps(view).map(step => step.card);
  const previewCard = cards.find(card => card?.kind === 'structure_preview');
  assert.ok(previewCard?.kind === 'structure_preview');
  assert.equal(previewCard.view.rows.length, 11);
  assert.equal(previewCard.view.sha256, state.attachment!.sha256);
  assert.equal(previewCard.view.preview_digest, state.preview!.preview_digest);
  const importCard = cards.find(card => card?.kind === 'structure_import');
  assert.ok(importCard?.kind === 'structure_import');
  assert.deepEqual(importCard.view.specs.map(spec => spec.workspace_id), state.imported!.specs.map((spec: any) => spec.workspace_id));
  const checkCard = cards.find(card => card?.kind === 'structure_check');
  assert.ok(checkCard?.kind === 'structure_check');
  assert.equal(checkCard.view.items.length, 11);
  assert.deepEqual(checkCard.view.items.map(item => [item.run_id, item.input_digest, item.output_digest]),
    state.checked!.items.map((item: any) => [item.run_id, item.input_digest, item.output_digest]));
  const series = await api(`/api/type-library/series/${state.imported!.series_id}`);
  assert.equal(series.specs.length, 11);
  for (const item of state.checked!.items) {
    const run = await api(`/api/workspaces/${item.workspace_id}/studies/${item.study_id}/runs/${item.run_id}?view=full`);
    assert.equal(run.status, 'succeeded');
    assert.equal(run.integrity, 'verified');
    assert.equal(run.input_digest, item.input_digest);
    assert.equal(run.output_digest, item.output_digest);
    assert.equal(run.snapshot.definition.method.plugin_id, 'cablesim.standard-check');
  }
  const after_ = importInventory(REPO, database);
  assert.equal(after_.study_runs, before_.study_runs + 11);
  // A restart must retain the accepted imported type scopes and source metadata without retaining the workbook bytes in pi.
  await sidecar.close();
  sidecar = createSidecar({ backendUrl: url, token: TOKEN, home: join(home, 'sidecar'), port: 8111, runtime });
  const recovered = await sidecar.agent.view(session);
  assert.ok(recovered.items.some(item => item.role === 'user' && item.attachments?.some(item => item.file === file.filename)));
  assert.ok(state.typeId, 'the completed import has a real type workspace');
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('type_read', { type_id: state.typeId, view: 'input', limit: 20 })], { stopReason: 'toolUse' }),
    context => { assert.equal((context.messages.at(-1) as { isError?: boolean }).isError, false, toolText(context)); return fauxAssistantMessage([fauxText('已读回刚才导入的型号草稿。')]); },
  ]);
  await sidecar.agent.send(session, '读取刚才导入的第一个型号', { workspace_id: fixture.workspace, label: '城南工程' });
  await sidecar.agent.idle(session);
  assert.deepEqual(importInventory(REPO, database), after_, 'reading after restart must not repeat any import or check');
  for (const entry of readdirSync(join(home, 'sidecar'), { recursive: true })) {
    if (String(entry).endsWith('.jsonl')) assert.ok(!readFileSync(join(home, 'sidecar', String(entry)), 'utf8').includes(file.content_base64), 'raw file bytes stay out of pi history');
  }
});

test('missing engineering input or a filename without an actual attachment is refused with no writes', async () => {
  const before_ = (await api<any[]>(`/api/workspaces/${fixture.workspace}/studies`)).length;
  const typesBefore = (await api('/api/index/objects?kind=type&limit=1')).total;
  const importsBefore = importInventory(REPO, join(home, 'engineering.sqlite'));
  for (const install of [() => installMissingData(faux, { workspace: fixture.workspace }), () => installMissingStructureSource(faux, fixture.workspace)]) {
    const state = install();
    const { session } = await sidecar.agent.send(undefined, '请完成任务，缺数据时明确拒绝');
    // An installed importer is not evidence that a source exists: the second script deliberately supplies an unbound identity.
    await sidecar.agent.idle(session);
    const view = await sidecar.agent.view(session);
    assert.equal(state.failure, undefined);
    assert.equal(state.done, true);
    assert.equal(view.waiting.length, 0);
    assert.ok(steps(view).some(step => step.status === 'failed'));
  }
  assert.equal((await api<any[]>(`/api/workspaces/${fixture.workspace}/studies`)).length, before_);
  assert.equal((await api('/api/index/objects?kind=type&limit=1')).total, typesBefore);
  assert.deepEqual(importInventory(REPO, join(home, 'engineering.sqlite')), importsBefore);
});
