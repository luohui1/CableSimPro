// A browser acceptance run of the fused product. Only the language model is scripted: the old backend, its ToolBroker,
// proposal approval, calculation methods, saved records, files, sidecar and old frontend all run for real on a fresh seed.
// Prepare the environment described in the issue/CI, then:
//   npm run build:fusion && CABLE_STUDIO_PYTHON=/path/to/python npm run walk:fusion [artifact folder]
// PLAYWRIGHT_EXECUTABLE_PATH can select a system Chromium when the Playwright browser download is unavailable.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Frame, type Locator, type Page } from 'playwright';
import { createSidecar, type Sidecar } from '../fusion/server.ts';
import type { Proposal } from '../shared/types.ts';
import { gbRequest, installConditionWorkflow, installGbWorkflow, installMissingData, installRatingTableWorkflow,
  installStudyRead, installStudyWorkflow, installTypeWorkflow, prepareGbFixture, ratingConditions, type FlowState } from './fusion-scripts.ts';
import { probe } from './layout-probe.ts';
import { scriptedModel } from './support.ts';
import { importInventory, installMissingStructureSource, installStructureImport, manufacturerWorkbook } from './fusion-import-scripts.ts';

const repo = resolve(import.meta.dirname, '..', '..');
const out = resolve(process.argv[2] ?? join(repo, '.tmp', 'fusion-walk'));
const home = mkdtempSync(join(tmpdir(), 'cablesim-fusion-walk-'));
const python = process.env.CABLE_STUDIO_PYTHON || 'python';
const database = join(home, 'engineering.sqlite');
const token = randomBytes(32).toString('hex');
// The sentinel stays in memory and the child's environment. It makes the leak check meaningful without a live model credential.
const sentinel = 'walk-key-' + randomBytes(28).toString('hex');
const secrets = [sentinel, token, process.env.CABLE_STUDIO_MODEL_API_KEY, process.env.CABLESIM_LLM_API_KEY].filter((value): value is string => Boolean(value));
const configuredRealModel = ['CABLE_STUDIO_MODEL_BASE_URL', 'CABLE_STUDIO_MODEL_ID', 'CABLE_STUDIO_MODEL_API_KEY'].every(name => Boolean(process.env[name]?.trim()));
const children: ChildProcess[] = [];
const processLogs: Record<string, string> = {};
const network: Record<string, unknown>[] = [];
const consoles: Record<string, unknown>[] = [];
const browserErrors: Record<string, unknown>[] = [];
const leakLocations = new Set<string>();
const checks: { id: string; status: '通过' | '未通过' | '云端无法验证'; evidence: unknown }[] = [];
const screenshots: Record<string, unknown>[] = [];
const completedImports = new Set<number>();
const clickedProposalIds = new Set<string>();
let stage = 'startup';
let browser: Browser | undefined;
let sidecar: Sidecar | undefined;
let failure: string | undefined;
mkdirSync(out, { recursive: true });

function clean(value: string, where: string): string {
  let safe = value;
  for (const secret of secrets) {
    if (safe.includes(secret)) { leakLocations.add(where); safe = safe.replaceAll(secret, '[redacted]'); }
  }
  return safe;
}
function recordedRequestBody(url: string, body: string): string {
  const safe = clean(body, 'browser/request-body');
  if (!url.includes('/api/chat/messages') || !safe) return safe;
  try {
    const message = JSON.parse(safe);
    if (!Array.isArray(message.attachments)) return safe;
    message.attachments = message.attachments.map((item: Record<string, unknown>) => {
      if (typeof item.content_base64 !== 'string') return item;
      const { content_base64, ...metadata } = item;
      return { ...metadata, content_base64: '[original attachment bytes omitted]', encodedLength: content_base64.length,
        sha256: createHash('sha256').update(Buffer.from(content_base64, 'base64')).digest('hex') };
    });
    return JSON.stringify(message);
  } catch { return '[attachment request scanned; unparseable body omitted]'; }
}
function record(id: string, passed: boolean, evidence: unknown): void {
  checks.push({ id, status: passed ? '通过' : '未通过', evidence });
  assert.ok(passed, id);
}
async function until(check: () => boolean | Promise<boolean>, label: string, milliseconds = 60_000): Promise<void> {
  const end = Date.now() + milliseconds;
  while (!(await check())) {
    if (Date.now() >= end) throw new Error('等待超时：' + label);
    await new Promise(done => setTimeout(done, 100));
  }
}
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>(done => server.close(() => done()));
  return address.port;
}
function launch(label: string, command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  processLogs[label] = '';
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  child.stdout?.on('data', chunk => { processLogs[label] += String(chunk); });
  child.stderr?.on('data', chunk => { processLogs[label] += String(chunk); });
  child.on('error', error => { processLogs[label] += error.message; });
  return child;
}
async function completed(child: ChildProcess, label: string, milliseconds = 300_000): Promise<void> {
  await until(() => child.exitCode !== null || child.signalCode !== null, label, milliseconds);
  assert.equal(child.exitCode, 0, clean(processLogs[label].slice(-8000), label));
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  try { await until(() => child.exitCode !== null || child.signalCode !== null, '关闭进程', 5000); }
  catch { child.kill('SIGKILL'); }
}
async function ready(url: string, child?: ChildProcess): Promise<void> {
  await until(async () => {
    assert.ok(!child || child.exitCode === null, '服务在就绪前退出：' + url);
    return fetch(url, { signal: AbortSignal.timeout(1500) }).then(response => response.ok).catch(() => false);
  }, url, 60_000);
}
async function json<T = any>(base: string, path: string, body?: unknown, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = clean(await response.text(), 'setup/public-api');
  assert.ok(response.ok, `${response.status} ${path}: ${text.slice(0, 1200)}`);
  return JSON.parse(text) as T;
}

/** Records browser traffic, including the SSE data that a response.body() cannot read until the connection is closed. */
async function observe(page: Page): Promise<() => Promise<void>> {
  const pending = new Set<Promise<unknown>>();
  const track = (task: Promise<unknown>) => { pending.add(task); void task.finally(() => pending.delete(task)); };
  page.on('console', message => {
    const item = { stage, type: message.type(), text: clean(message.text(), 'browser/console'), location: message.location() };
    consoles.push(item);
    if (message.type() === 'error') browserErrors.push({ ...item, expected: stage === 'sidecar-down'
      && item.location.url.includes('/agent-sidecar/api/status') && /502|503/.test(message.text()) });
  });
  page.on('pageerror', error => browserErrors.push({ stage, type: 'pageerror', text: clean(error.message, 'browser/pageerror'), expected: false }));
  page.on('request', request => {
    const at = stage;
    track((async () => {
      const headers = await request.allHeaders().catch(() => request.headers());
      network.push({ stage: at, type: 'request', method: request.method(), url: clean(request.url(), 'browser/request-url'),
        headers: clean(JSON.stringify(headers), 'browser/request-headers'), body: recordedRequestBody(request.url(), request.postData() || '') });
    })());
  });
  page.on('requestfailed', request => {
    const reason = request.failure()?.errorText || 'request failed';
    const expected = /ERR_ABORTED/.test(reason) || stage === 'sidecar-down' && /\/agent-sidecar\/api\/(status|events)(?:\?|$)/.test(request.url());
    browserErrors.push({ stage, type: 'requestfailed', url: request.url(), reason, expected });
  });
  page.on('response', response => {
    const at = stage;
    const header = response.headers()['content-type'] || '';
    const expected = at === 'sidecar-down' && response.url().includes('/agent-sidecar/api/status') && [502, 503].includes(response.status());
    if (response.status() >= 400) browserErrors.push({ stage: at, type: 'http', url: response.url(), status: response.status(), expected });
    track((async () => {
      const headers = await response.allHeaders().catch(() => response.headers());
      const item = { stage: at, type: 'response', url: clean(response.url(), 'browser/response-url'), status: response.status(), contentType: header,
        headers: clean(JSON.stringify(headers), 'browser/response-headers') };
      // Stream data is captured by CDP below; its headers still need to be scanned immediately.
      if (header.includes('text/event-stream')) { network.push({ ...item, body: '[SSE events recorded separately]' }); return; }
      const bytes = await response.body().catch(() => undefined);
      if (!bytes) { network.push({ ...item, body: '[response closed during navigation]' }); return; }
      const body = clean(bytes.toString('utf8'), 'browser/response-body');
      // Inspect assets and binary downloads too, without writing megabytes of built JavaScript or fonts to the evidence.
      network.push({ ...item, scannedBytes: bytes.length, body: /\/(api|agent-sidecar)\//.test(response.url()) && (header.includes('json') || header.includes('text/'))
        ? body : '[body scanned; asset or binary content omitted]' });
    })());
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.eventSourceMessageReceived', event => network.push({ stage, type: 'sse', data: clean(event.data, 'browser/sse') }));
  return async () => { await Promise.allSettled([...pending]); await cdp.detach().catch(() => undefined); };
}
async function agentFrame(page: Page): Promise<Frame> {
  await page.locator('iframe[title="Agent 对话"]').waitFor();
  const element = await page.locator('iframe[title="Agent 对话"]').elementHandle();
  const frame = await element!.contentFrame();
  assert.ok(frame);
  await frame.getByRole('textbox', { name: '给 Agent 的消息' }).waitFor();
  return frame;
}
async function speak(frame: Frame, text: string): Promise<void> {
  await frame.getByRole('textbox', { name: '给 Agent 的消息' }).fill(text);
  await frame.getByRole('button', { name: '发送', exact: true }).click();
}
async function newChat(frame: Frame): Promise<void> {
  const id = /^#\/chat\/([^/]+)/.exec(new URL(frame.url()).hash)?.[1];
  if (id) await until(() => frame.evaluate(async session => {
    const response = await fetch('/agent-sidecar/api/chat/sessions/' + encodeURIComponent(session));
    const view = await response.json();
    return !view.running;
  }, decodeURIComponent(id)), '上一项对话保存完成');
  await frame.getByRole('button', { name: '新对话', exact: true }).click();
  await frame.getByRole('heading', { name: '今天要完成哪项工作？' }).waitFor();
}
async function waitFlow(state: FlowState, label: string): Promise<void> {
  await until(() => state.done || Boolean(state.failure), label, 90_000);
  assert.equal(state.failure, undefined, label + ': ' + state.failure);
  assert.ok(state.done, label);
}
async function waitingReviews(frame: Frame): Promise<Proposal[]> {
  return frame.evaluate(async () => {
    const session = /^#\/chat\/([^/]+)/.exec(location.hash)?.[1];
    if (!session) return [];
    const response = await fetch('/agent-sidecar/api/chat/sessions/' + encodeURIComponent(decodeURIComponent(session)), { cache: 'no-store' });
    if (!response.ok) throw new Error('读取实际待审状态失败：' + response.status);
    return (await response.json()).waiting ?? [];
  });
}
function proposalCard(frame: Frame, id: string): Locator {
  assert.match(id, /^[a-zA-Z0-9_-]+$/, '提案标识必须来自实际保存记录');
  return frame.locator(`[data-card="proposal"][data-proposal-id="${id}"]`);
}
async function canAccept(frame: Frame, id: string): Promise<boolean> {
  const button = proposalCard(frame, id).getByRole('button', { name: '接受', exact: true });
  return await button.count() > 0 && await button.isEnabled({ timeout: 500 }).catch(() => false);
}
async function pendingReview(frame: Frame, match: (proposal: Proposal) => boolean = () => true): Promise<Proposal> {
  let review: Proposal | undefined;
  await until(async () => {
    review = (await waitingReviews(frame)).filter(match).at(-1);
    return Boolean(review && await canAccept(frame, review.id));
  }, '实际待审提案及其接受按钮', 90_000);
  assert.ok(review);
  return review;
}
async function pending(frame: Frame, title?: string): Promise<Locator> {
  const review = await pendingReview(frame, proposal => !title || proposal.title === title);
  return proposalCard(frame, review.id);
}
async function pendingOperation(frame: Frame, operation: string): Promise<Locator> {
  const review = await pendingReview(frame, proposal => proposal.operation === operation);
  return proposalCard(frame, review.id);
}
async function expandProposal(card: Locator): Promise<void> {
  const trigger = card.getByRole('button', { name: /^完整改动/ });
  if (await trigger.count() === 0) return;
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  const changes = card.locator('[data-proposal-changes]');
  await until(async () => await trigger.getAttribute('aria-expanded') === 'true' && await changes.evaluate(element => {
    const panel = element.closest<HTMLElement>('[data-slot="collapsible-content"]');
    return Boolean(panel && panel.clientHeight > 0 && panel.clientHeight >= panel.scrollHeight - 1
      && !panel.hasAttribute('data-starting-style') && !panel.hasAttribute('data-ending-style')
      && panel.getAnimations({ subtree: true }).every(animation => !animation.pending && animation.playState !== 'running'));
  }).catch(() => false), '完整改动实际展开且动画结束');
  await card.evaluate(element => element.scrollIntoView({ block: 'start' }));
  await until(async () => changes.evaluate(element => {
    const panel = element.closest('[data-slot="collapsible-content"]')!.getBoundingClientRect();
    return ['dt', 'dd'].every(selector => {
      const box = element.querySelector(selector)!.getBoundingClientRect();
      return box.height > 0 && box.top >= Math.max(0, panel.top) && box.bottom <= Math.min(innerHeight, panel.bottom);
    });
  }), '展开后的首项字段和值在画面内可见');
}
async function accept(frame: Frame, proposalId?: string): Promise<void> {
  const id = proposalId ?? (await pendingReview(frame)).id;
  assert.ok(!clickedProposalIds.has(id), '同一提案只能点击接受一次：' + id);
  const button = proposalCard(frame, id).getByRole('button', { name: '接受', exact: true });
  await button.scrollIntoViewIfNeeded();
  const [response] = await Promise.all([
    frame.page().waitForResponse(reply => reply.request().method() === 'POST'
      && new URL(reply.url()).pathname.endsWith('/api/proposals/' + encodeURIComponent(id) + '/decision'), { timeout: 90_000 }),
    button.click(),
  ]);
  clickedProposalIds.add(id);
  assert.equal(response.status(), 200, '人工接受必须收到实际决定回执');
  const decision = await response.json();
  assert.equal(decision.id, id);
  assert.equal(decision.status, 'accepted');
  await until(async () => !(await waitingReviews(frame)).some(proposal => proposal.id === id), '同一已接受提案退出实际待审队列', 90_000);
}
async function approveAll(frame: Frame, state: FlowState): Promise<number> {
  let count = 0;
  while (!state.done && !state.failure) {
    let review: Proposal | undefined;
    await until(async () => {
      if (state.done || state.failure) return true;
      review = (await waitingReviews(frame)).at(-1);
      if (!review) return false;
      assert.ok(!clickedProposalIds.has(review.id), '已经接受的提案不得再次进入待审队列：' + review.id);
      return canAccept(frame, review.id);
    }, '下一项实际待审提案或任务完成', 90_000);
    if (state.done || state.failure) break;
    assert.ok(review);
    await accept(frame, review.id);
    count += 1;
    assert.ok(count <= 10, '单项任务不应无限产生提案');
  }
  await waitFlow(state, '多步任务完成');
  return count;
}
async function savedDrawing(page: Page, backendUrl: string, workspace: string, study: string, run: string, result: Record<string, any>): Promise<void> {
  const caseId = result.cases?.[0]?.case_id;
  assert.ok(caseId, '保存运行必须给出可追溯的工况');
  const saved = await json(backendUrl, `/api/workspaces/${workspace}/studies/${study}/runs/${run}/cases/${caseId}/input`);
  assert.equal(saved.integrity, 'verified');
  const cableIds = saved.input.sections[0].placements.map((item: any) => 'cable/' + item.cable).sort();
  assert.ok(cableIds.length > 0, '真实保存工况必须包含待显示的电缆位置');
  const drawing = page.locator('.workbench-canvas [data-laying-section-state="success"][aria-busy="false"], .workbench-canvas [data-laying-section-state="historical"][aria-busy="false"]');
  await until(async () => await drawing.count() === 1 && await drawing.isVisible()
    && await drawing.locator('svg[data-drawing-canvas="laying"]').isVisible()
    && JSON.stringify(await drawing.locator('[data-section-object^="cable/"]').evaluateAll(items => items.map(item => item.getAttribute('data-section-object')).sort())) === JSON.stringify(cableIds),
  '保存工况的敷设截面和全部电缆绘制完成');
  record(`${page.viewportSize()!.width}/drawing-${run}`, true, { run, caseId, cableIds, state: await drawing.getAttribute('data-laying-section-state') });
}
async function shot(page: Page, frame: Frame | undefined, name: string, detail: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  if (frame) await frame.evaluate(() => document.fonts.ready);
  const layout = [...await page.evaluate(probe), ...frame ? await frame.evaluate(probe) : []];
  const filename = `${page.viewportSize()!.width}x${page.viewportSize()!.height}-${name}.png`;
  const text = [await page.locator('body').innerText(), ...(frame ? [await frame.locator('body').innerText()] : [])].join('\n');
  const visible = clean(text, 'browser/dom');
  assert.ok(!secrets.some(secret => text.includes(secret)), '页面包含凭据，已停止保存截图；只记录泄漏位置，不保存凭据值。');
  await page.screenshot({ path: join(out, filename), fullPage: false });
  screenshots.push({ ...detail, file: filename, state: name, viewport: page.viewportSize(), url: page.url(), frame: frame?.url(), layout, visibleText: visible });
  record(`${filename}/layout`, layout.length === 0, layout);
}

try {
  assert.ok(existsSync(join(repo, 'studio', 'dist-fusion', 'fusion.html')), '先执行 npm run build:fusion。');
  const backendPort = await freePort();
  const sidecarPort = await freePort();
  const frontendPort = await freePort();
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  const env = { ...process.env, PYTHONUNBUFFERED: '1', CABLESIM_DB: database,
    CABLESIM_DATASETS_DIR: join(home, 'datasets'), CABLESIM_REPRODUCTION_LIBRARY: join(home, 'library'),
    CABLESIM_AGENT_SIDECAR_TOKEN: token, CABLESIM_AGENT_SIDECAR_URL: `http://127.0.0.1:${sidecarPort}`,
    CABLESIM_AGENT_UI: join(repo, 'studio', 'dist-fusion'), CABLESIM_FRONTEND_DIST: join(home, 'no-built-frontend'),
    CABLE_STUDIO_MODEL_BASE_URL: 'http://127.0.0.1:1/v1', CABLE_STUDIO_MODEL_ID: 'scripted-browser-walk', CABLE_STUDIO_MODEL_API_KEY: sentinel };
  const frontendEnv: NodeJS.ProcessEnv = { ...process.env, BACKEND_URL: backendUrl };
  for (const name of Object.keys(frontendEnv)) {
    if (/^(CABLE_STUDIO_MODEL_|CABLESIM_LLM_|CABLESIM_AGENT_SIDECAR_TOKEN$)/.test(name)) delete frontendEnv[name];
  }
  console.log('准备独立发布种子；真实 CAD 预检与 IEC 计算，不提交本机原生场求解。');
  const seed = launch('seed', python, ['-c',
    'import importlib.util,pathlib,sys; spec=importlib.util.spec_from_file_location("fusion_walk_seed","frontend/scripts/seed-engineering-demo.py"); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); module.seed_release(pathlib.Path(sys.argv[1]))', database], repo, env);
  await completed(seed, 'seed');
  const seeded = JSON.parse(readFileSync(database.replace(/\.sqlite$/, '.seed.json'), 'utf8'));
  record('fresh-release-seed', seeded.complete && seeded.native_core_hours === 0, { complete: seeded.complete, native_core_hours: seeded.native_core_hours,
    studyCount: seeded.studies.length, typeCount: seeded.types.length, source: seeded.source });
  const source = seeded.studies.find((item: any) => item.title.includes('城南') && item.title.includes('110 kV') && item.status === 'succeeded' && item.run);
  const type = seeded.types.find((item: any) => item.name.startsWith('YJV22') && !item.teaching);
  assert.ok(source && type, '种子必须提供真实研究与型号');
  const backend = launch('backend', python, ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', String(backendPort)], repo, env);
  await ready(backendUrl + '/api/health', backend);
  const model = await scriptedModel();
  sidecar = createSidecar({ backendUrl, token, home: join(home, 'conversations'), port: sidecarPort, runtime: model.runtime });
  await new Promise<void>(done => sidecar!.server.listen(sidecarPort, '127.0.0.1', done));
  const frontend = launch('frontend', process.execPath, [join(repo, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], join(repo, 'frontend'), frontendEnv);
  record('frontend-environment-has-no-model-credentials', !Object.keys(frontendEnv).some(name => /^(CABLE_STUDIO_MODEL_|CABLESIM_LLM_|CABLESIM_AGENT_SIDECAR_TOKEN$)/.test(name)),
    { modelCredentialsPassed: false, sidecarTokenPassed: false });
  await ready(frontendUrl + '/api/health', frontend);
  await ready(frontendUrl + '/agent-sidecar/api/status');
  console.log('后端、边车、老前端就绪；开始浏览器实聊。');

  // A deliberately incomplete saved study is fixture setup through the same public API an engineer uses. No result is inserted.
  const workspace = await json(backendUrl, `/api/workspaces/${source.workspace}`);
  const sourceStudies = await json(backendUrl, `/api/workspaces/${source.workspace}/studies`);
  const definition = structuredClone(sourceStudies.find((item: any) => item.id === source.study).definition);
  const incomplete = structuredClone(workspace.domain);
  for (const cable of incomplete.cable_types) for (const core of cable.cores) { core.conductor.r20 = null; core.conductor.r20_basis = null; }
  const missing = await json(backendUrl, `/api/workspaces/${source.workspace}/studies`, { ...definition, modules: {}, title: 'Agent 验收 · 缺少导体电阻',
    input_source: 'study', method_input: incomplete, expected_revision: workspace.revision });
  record('missing-data-fixture-no-run', (await json(backendUrl, `/api/workspaces/${source.workspace}/studies/${missing.id}/runs`)).items.length === 0,
    { study: missing.id, removed: 'core.conductor.r20, core.conductor.r20_basis', createdThrough: 'public study API' });

  const typeRating = (await json(backendUrl, `/api/workspaces/${type.workspace}/studies`)).find((item: any) =>
    item.definition.method.plugin_id === 'cablesim.iec60287' && item.definition.driver.kind === 'batch'
    && item.definition.driver.cases?.every((row: any) => row.metadata?.kind === 'type-rating-table'));
  assert.ok(typeRating, '发布型号须有已保存的载流量表参数与来源');
  const gb = await prepareGbFixture((path, body, method) => json(backendUrl, path, body, method), type.workspace);
  record('gb-baseline-saved-pdf', true, { workspace: gb.workspace, study: gb.baselineStudy, run: gb.baselineRun,
    baselineA: gb.baselineCurrent, source: gb.baselineSource, pdfSha256: gb.baselineDigest, pdfPage: gb.baselinePage,
    systemVoltageV: 10000, cableRatedVoltageChanged: false });

  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const flush = await observe(page);
    try {
      stage = 'empty';
      await page.goto(frontendUrl + '/agent', { waitUntil: 'domcontentloaded' });
      let frame = await agentFrame(page);
      await frame.getByRole('heading', { name: '今天要完成哪项工作？' }).waitFor();
      await shot(page, frame, 'empty');

      stage = 'saved-result';
      const read = installStudyRead(model.faux, source);
      await speak(frame, '城南线路 110 kV 直埋单回校核保存的结论是什么，受什么限制？');
      await waitFlow(read, '只读研究结论');
      const current = read.result!.headlines.find((row: any) => row.key === 'ampacity').display_value.toFixed(1);
      const rating = frame.locator('[data-card="rating"]').last();
      await rating.waitFor();
      const ratingText = await rating.innerText();
      record(`${viewport.width}/saved-value`, ratingText.includes(current), { workspace: source.workspace, study: source.study, run: source.run,
        backendAmpacity: current, cardText: ratingText });
      await rating.scrollIntoViewIfNeeded();
      await shot(page, frame, 'result-card', { run: source.run, ampacityA: current });
      const frameIdentity = await frame.evaluate(() => { (window as any).__fusionWalkIdentity = Math.random(); return (window as any).__fusionWalkIdentity; });
      await page.getByRole('button', { name: '本机用户' }).click();
      await page.getByRole('menuitem', { name: '切换深色模式' }).click();
      await until(() => frame.evaluate(() => document.documentElement.dataset.theme === 'dark'), 'iframe主题同步');
      record(`${viewport.width}/theme-keeps-conversation`, await frame.evaluate(() => (window as any).__fusionWalkIdentity) === frameIdentity,
        { frame: frame.url(), theme: 'dark', reloaded: false });
      await page.getByRole('button', { name: '本机用户' }).click();
      await page.getByRole('menuitem', { name: '切换浅色模式' }).click();
      await rating.getByRole('button', { name: '在工作台打开', exact: true }).click();
      await page.waitForURL(/\/studies\//);
      await until(() => page.locator('body').innerText().then(text => text.includes(current)), '工作台显示同一保存数值', 90_000);
      record(`${viewport.width}/same-workbench-result`, page.url().includes(source.run), { run: source.run, ampacityA: current, workbenchUrl: page.url() });
      await savedDrawing(page, backendUrl, source.workspace, source.study, source.run, read.result!);
      await shot(page, undefined, 'workbench-saved-result', { run: source.run, ampacityA: current });
      await page.locator('.sidebar-mode').locator('button').filter({ hasText: /^Agent$/ }).click();
      frame = await agentFrame(page);
      await frame.locator('[data-card="rating"]').waitFor();

      stage = 'study-proposal';
      await newChat(frame);
      const studyBefore = await json(backendUrl, `/api/workspaces/${source.workspace}/studies`);
      const deliveriesBefore = await json(backendUrl, `/api/workspaces/${source.workspace}/deliveries`);
      const flow = installStudyWorkflow(model.faux, { workspace: source.workspace, study: source.study, title: `Agent 验收 · ${viewport.width} 直埋校核` });
      await speak(frame, '按城南已保存工况新建一项直埋校核，算出来，再导出计算书。每个写操作先让我接受。');
      await pending(frame);
      const studyPending = await json(backendUrl, `/api/workspaces/${source.workspace}/studies`);
      record(`${viewport.width}/unapproved-create-does-not-write`, studyPending.length === studyBefore.length, { before: studyBefore.length, pending: studyPending.length });
      await frame.locator('[data-card="proposal"][data-phase="pending"]').last().scrollIntoViewIfNeeded();
      await shot(page, frame, 'pending-proposal');
      await accept(frame);
      await until(() => Boolean(flow.study) || Boolean(flow.failure), '接受创建后继续');
      assert.equal(flow.failure, undefined);
      await pending(frame);
      const runsBefore = await json(backendUrl, `/api/workspaces/${source.workspace}/studies/${flow.study}/runs`);
      record(`${viewport.width}/unapproved-run-does-not-write`, runsBefore.items.length === 0, { createdStudy: flow.study, runs: runsBefore.items.length });
      const runProposal = frame.locator('[data-card="proposal"][data-phase="pending"]').last();
      const assumptions = await frame.evaluate(async () => {
        const session = decodeURIComponent(location.hash.split('/')[2]);
        const response = await fetch('/agent-sidecar/api/chat/sessions/' + encodeURIComponent(session));
        return (await response.json()).waiting.at(-1)?.assumptions ?? [];
      }) as string[];
      const disclosure = runProposal.getByRole('button', { name: /^方法适用范围与限制/ });
      assert.ok(assumptions.length > 0, '运行提案必须保留真实方法的适用范围');
      assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
      await disclosure.click();
      await until(async () => { const text = await runProposal.innerText(); return assumptions.every(limit => text.includes(limit)); }, '展开完整方法适用范围');
      await disclosure.click();
      await until(async () => {
        await runProposal.scrollIntoViewIfNeeded();
        return runProposal.evaluate(element => {
          const input = document.querySelector('textarea[aria-label="给 Agent 的消息"]');
          const bottom = (input?.closest('form') ?? input)?.getBoundingClientRect().top ?? innerHeight;
          const decisions = [...element.querySelectorAll('button')].filter(button => ['接受', '拒绝'].includes(button.textContent!.trim()));
          return decisions.length === 2 && decisions.every(button => { const box = button.getBoundingClientRect(); return box.top >= 0 && box.bottom <= bottom; });
        });
      }, '待审操作按钮在输入框上方完整可见');
      record(`${viewport.width}/review-limitations-and-actions`, true, { fullLimitations: assumptions.length, initiallyCollapsed: true, allTextPreserved: true, actionsVisible: true });
      await shot(page, frame, 'accepted-continues', { createdStudy: flow.study, pendingRun: true });
      await accept(frame);
      await until(() => Boolean(flow.run) || Boolean(flow.failure), '真实计算后继续', 90_000);
      assert.equal(flow.failure, undefined);
      await pending(frame);
      const deliveriesPending = await json(backendUrl, `/api/workspaces/${source.workspace}/deliveries`);
      record(`${viewport.width}/unapproved-report-does-not-write`, deliveriesPending.length === deliveriesBefore.length,
        { before: deliveriesBefore.length, pending: deliveriesPending.length });
      await accept(frame);
      await waitFlow(flow, '研究计算书');
      await frame.locator('[data-card="file"]').last().waitFor();
      const saved = await json(backendUrl, `/api/workspaces/${source.workspace}/studies/${flow.study}/runs/${flow.run}`);
      const file = await fetch(backendUrl + flow.file!);
      const reportHtml = clean(await file.text(), 'download/report');
      record(`${viewport.width}/study-run-report`, saved.status === 'succeeded' && file.ok && Boolean(file.headers.get('x-artifact-sha256')) && /<html[\s>]/i.test(reportHtml),
        { study: flow.study, run: flow.run, runStatus: saved.status, integrity: saved.integrity, file: flow.file,
          archiveDigest: file.headers.get('x-artifact-sha256'), downloadedBytes: Buffer.byteLength(reportHtml) });
      const fileCard = frame.locator('[data-card="file"]').last();
      await fileCard.getByRole('button', { name: '预览', exact: true }).click();
      const previewElement = frame.locator('[role="dialog"] iframe');
      await previewElement.waitFor();
      const previewFrame = await (await previewElement.elementHandle())!.contentFrame();
      assert.ok(previewFrame);
      await until(() => previewFrame.locator('body').innerText().then(text => text.includes('计算书')), '打开真实计算书预览');
      record(`${viewport.width}/report-preview`, true, { file: flow.file, previewUrlKind: new URL(previewFrame.url()).protocol,
        sandboxed: await previewElement.getAttribute('sandbox') === '' });
      await frame.getByRole('button', { name: '关闭', exact: true }).click();
      const downloadEvent = page.waitForEvent('download');
      await fileCard.getByRole('button', { name: '下载', exact: true }).click();
      const downloaded = await downloadEvent;
      record(`${viewport.width}/report-download`, await downloaded.failure() === null, { url: downloaded.url(), filename: downloaded.suggestedFilename() });
      await fileCard.scrollIntoViewIfNeeded();
      await shot(page, frame, 'saved-report', { run: flow.run, download: flow.file });

      stage = 'rejection';
      await newChat(frame);
      const beforeReject = (await json(backendUrl, `/api/workspaces/${source.workspace}/studies`)).length;
      installStudyWorkflow(model.faux, { workspace: source.workspace, study: source.study, title: `不可创建 · ${viewport.width}` });
      await speak(frame, '先给我一份复制保存研究的提案。');
      await pending(frame);
      const reject = frame.locator('[data-card="proposal"][data-phase="pending"]').last();
      await reject.getByRole('button', { name: '拒绝', exact: true }).click();
      await frame.getByRole('textbox', { name: '拒绝的原因' }).fill('当前工况还需要人工核对。');
      await frame.getByRole('button', { name: '确认拒绝', exact: true }).click();
      await frame.locator('[data-card="proposal"][data-phase="rejected"]').waitFor();
      record(`${viewport.width}/rejected-write-does-not-happen`, (await json(backendUrl, `/api/workspaces/${source.workspace}/studies`)).length === beforeReject,
        { studiesBefore: beforeReject, refusal: '当前工况还需要人工核对。' });

      stage = 'missing-data';
      await newChat(frame);
      const missingFlow = installMissingData(model.faux, { workspace: source.workspace, study: missing.id });
      await speak(frame, '运行这项缺少导体电阻的研究；有缺项就说明，不要补猜。');
      await pending(frame);
      await accept(frame);
      await waitFlow(missingFlow, '缺数据拒算');
      await frame.locator('[data-card="refusal"]').waitFor();
      const refusedRuns = await json(backendUrl, `/api/workspaces/${source.workspace}/studies/${missing.id}/runs`);
      const missingReason = await frame.locator('[data-card="refusal"]').innerText();
      record(`${viewport.width}/missing-data-refuses`, refusedRuns.items.length === 0 && /R20|20\s*°C.*电阻/.test(missingReason) && /工作台|输入/.test(missingReason) && !/Input should be/.test(missingReason),
        { study: missing.id, runCount: refusedRuns.items.length, reason: missingReason });
      await frame.locator('[data-card="refusal"]').scrollIntoViewIfNeeded();
      await shot(page, frame, 'missing-data-refusal', { study: missing.id, runCount: refusedRuns.items.length });

      stage = 'condition-workflow';
      await newChat(frame);
      const currentWorkspace = await json(backendUrl, `/api/workspaces/${source.workspace}`);
      const soilId = currentWorkspace.domain.sections[0].medium.material;
      const soil = currentWorkspace.domain.materials.find((item: any) => item.id === soilId);
      const soilPath = '/materials/' + String(soilId).replaceAll('~', '~0').replaceAll('/', '~1') + '/thermal_resistivity';
      const nextSoil = Number((Number(soil.thermal_resistivity) + 0.1).toFixed(1));
      const condition = installConditionWorkflow(model.faux, { workspace: source.workspace, study: source.study, run: source.run,
        path: soilPath, value: nextSoil });
      await speak(frame, `把城南土壤热阻率改为 ${nextSoil.toFixed(1)} K·m/W，重算后和最初保存的记录比较。`);
      const conditionApprovals = await approveAll(frame, condition);
      record(`${viewport.width}/conditions-recalculate-compare`, conditionApprovals === 2 && Boolean(condition.comparison && condition.run),
        { approvals: conditionApprovals, newRun: condition.run, originalRun: source.run, comparison: condition.comparison });
      const comparisonSummary = frame.locator('[data-role="assistant"]').last().locator('p').filter({ hasText: '保存的比较差值为' });
      await until(async () => (await comparisonSummary.innerText()).includes('旧记录保持不变'), '完整保存运行比较文字到达');
      const latest = frame.getByRole('button', { name: '回到最新', exact: true, includeHidden: true });
      if (await latest.isVisible() && await latest.isEnabled()) await latest.click();
      await until(async () => await latest.isDisabled() && !await latest.isVisible(), '真实滚到消息结尾且浮动按钮消失');
      await until(() => comparisonSummary.evaluate(element => {
        const box = element.getBoundingClientRect();
        const viewport = element.closest('.overflow-y-auto')?.getBoundingClientRect();
        const composer = document.querySelector('[aria-label="给 Agent 的消息"]')?.closest('form')?.getBoundingClientRect();
        return Boolean(viewport && composer && box.height > 0 && box.top >= viewport.top
          && box.bottom <= Math.min(viewport.bottom, composer.top));
      }), '比较差值完整可见且没有被输入框遮挡');
      await shot(page, frame, 'conditions-compared', { run: condition.run, originalRun: source.run });
      const changedAmpacity = condition.result!.headlines.find((row: any) => row.key === 'ampacity').display_value.toFixed(1);
      await frame.locator('[data-card="rating"]').last().getByRole('button', { name: '在工作台打开', exact: true }).click();
      await page.waitForURL(url => url.searchParams.get('run') === condition.run);
      const soilInput = page.getByRole('textbox', { name: '介质热阻率', exact: true });
      await until(async () => (await page.locator('body').innerText()).includes(changedAmpacity)
        && Math.abs(Number(await soilInput.inputValue()) - nextSoil) < 1e-9, '批准后工作台显示同一运行和更新的条件');
      record(`${viewport.width}/changed-workbench-current`, true, { run: condition.run, ampacityA: changedAmpacity, soilResistivity: await soilInput.inputValue() });
      await savedDrawing(page, backendUrl, source.workspace, source.study, condition.run!, condition.result!);
      await shot(page, undefined, 'workbench-updated-conditions', { run: condition.run, ampacityA: changedAmpacity, soilResistivity: nextSoil });
      await page.locator('.sidebar-mode').locator('button').filter({ hasText: /^Agent$/ }).click();
      frame = await agentFrame(page);

      stage = 'type-workflow';
      await newChat(frame);
      const typeBefore = await json(backendUrl, `/api/workspaces/${type.workspace}`);
      const typeFlow = installTypeWorkflow(model.faux, { workspace: type.workspace, typeId: type.workspace, thicknessMm: 4.7 + (viewport.width === 1920 ? 0.1 : 0) });
      await speak(frame, `把 YJV22-8.7/15 3×300 草稿的绝缘厚度改为 ${viewport.width === 1920 ? '4.8' : '4.7'} mm，核对后出内部规格书。每一步让我接受。`);
      await pending(frame);
      const typePending = await json(backendUrl, `/api/workspaces/${type.workspace}`);
      record(`${viewport.width}/unapproved-structure-does-not-write`, typePending.revision === typeBefore.revision,
        { type: type.workspace, revisionBefore: typeBefore.revision, revisionPending: typePending.revision });
      const typeApprovals = await approveAll(frame, typeFlow);
      await frame.locator('[data-card="file"]').last().waitFor();
      const specification = await fetch(backendUrl + typeFlow.file!);
      const pdf = Buffer.from(await specification.arrayBuffer());
      record(`${viewport.width}/type-change-check-specification`, typeApprovals === 5 && specification.ok && specification.headers.get('content-type')?.includes('application/pdf') === true && pdf.subarray(0, 5).toString() === '%PDF-',
        { type: typeFlow.typeId, approvals: typeApprovals, study: typeFlow.study, run: typeFlow.run, file: typeFlow.file,
          artifactDigest: specification.headers.get('x-artifact-sha256'), downloadedBytes: pdf.length });
      await frame.locator('[data-card="file"]').last().scrollIntoViewIfNeeded();
      await shot(page, frame, 'type-specification', { type: typeFlow.typeId, run: typeFlow.run, download: typeFlow.file });

      stage = 'rating-table';
      await newChat(frame);
      const tableStudyCount = (await json(backendUrl, `/api/workspaces/${type.workspace}/studies`)).length;
      const tableFlow = installRatingTableWorkflow(model.faux, { workspace: type.workspace, sourceStudy: typeRating.id,
        title: `Agent 验收 · ${viewport.width} 明示温度载流量表` });
      await speak(frame, '给此型号建25 °C和30 °C的三芯单回直埋载流量表。中心埋深0.8 m，土壤1.2 K·m/W，50 Hz，两端接地；这些是我明示的参考工况，不是现场测量。沿用已保存且有出处的计算参数，每次保存和运行先让我接受。');
      await pending(frame);
      record(`${viewport.width}/unapproved-rating-table-does-not-write`, (await json(backendUrl, `/api/workspaces/${type.workspace}/studies`)).length === tableStudyCount,
        { before: tableStudyCount, pending: tableStudyCount });
      const tableProposal = frame.locator('[data-card="proposal"][data-phase="pending"]').last();
      const changes = await frame.evaluate(async () => {
        const session = decodeURIComponent(location.hash.split('/')[2]);
        const response = await fetch('/agent-sidecar/api/chat/sessions/' + encodeURIComponent(session));
        return (await response.json()).waiting.at(-1)?.changes ?? [];
      }) as { label: string; before: string; after: string }[];
      const allChanges = tableProposal.getByRole('button', { name: /^完整改动/ });
      assert.ok(changes.length > 8, '真实两工况提案应有完整条件与来源');
      assert.equal(await allChanges.getAttribute('aria-expanded'), 'false');
      assert.equal(await tableProposal.locator('[data-proposal-changes]').count(), 0);
      await expandProposal(tableProposal);
      await until(async () => {
        const value = (await tableProposal.innerText()).replaceAll(/\s/g, '');
        return changes.every(change => [change.label, change.before, change.after].filter(part => part && part !== '—').every(part => value.includes(part.replaceAll(/\s/g, ''))))
          && ratingConditions().every(condition => value.includes(condition.name.replaceAll(/\s/g, '')) && value.includes(condition.source.replaceAll(/\s/g, '')));
      }, '展开载流量表的完整条件、参数、改前改后与来源');
      await shot(page, frame, 'rating-table-proposal-expanded', { changes: changes.length, type: type.workspace });
      await allChanges.click();
      await until(async () => {
        await tableProposal.scrollIntoViewIfNeeded();
        return tableProposal.evaluate(element => {
          const input = document.querySelector('textarea[aria-label="给 Agent 的消息"]');
          const bottom = (input?.closest('form') ?? input)?.getBoundingClientRect().top ?? innerHeight;
          const decisions = [...element.querySelectorAll('button')].filter(button => ['接受', '拒绝'].includes(button.textContent!.trim()));
          return decisions.length === 2 && decisions.every(button => { const box = button.getBoundingClientRect(); return box.top >= 0 && box.bottom <= bottom; });
        });
      }, '收起完整改动后接受与拒绝完整可见');
      record(`${viewport.width}/rating-table-review`, true, { changes: changes.length, initiallyCollapsed: true, allValuesAndSourcesPreserved: true, decisionsVisible: true });
      await shot(page, frame, 'rating-table-proposal', { changes: changes.length, type: type.workspace });
      await accept(frame);
      await until(() => Boolean(tableFlow.study) || Boolean(tableFlow.failure), '接受载流量表定义后的实际保存回执');
      assert.equal(tableFlow.failure, undefined);
      assert.ok(tableFlow.study, '保存回执必须给出实际研究标识');
      await until(() => frame.evaluate(async () => {
        const session = decodeURIComponent(location.hash.split('/')[2]);
        const response = await fetch('/agent-sidecar/api/chat/sessions/' + encodeURIComponent(session));
        const view = await response.json();
        return view.waiting.length === 1 && view.waiting[0].operation === 'propose_study_run';
      }), '对话实际等待独立的运行提案');
      const tableRunProposal = await pending(frame, '运行研究');
      record(`${viewport.width}/unapproved-rating-table-run-does-not-write`, (await json(backendUrl, `/api/workspaces/${type.workspace}/studies/${tableFlow.study}/runs`)).items.length === 0,
        { study: tableFlow.study, runs: 0 });
      const tableRunProposalId = await tableRunProposal.getAttribute('data-proposal-id');
      assert.ok(tableRunProposalId);
      await accept(frame, tableRunProposalId);
      await waitFlow(tableFlow, '真实载流量表');
      const savedTable = await json(backendUrl, `/api/design/workspaces/${type.workspace}/rating-table-runs/${tableFlow.run}?view=rows`);
      assert.deepEqual(tableFlow.table, savedTable.rows);
      const tableCard = frame.locator('[data-card="rating-table"]').last();
      await tableCard.waitFor();
      for (const row of savedTable.rows) {
        const shown = tableCard.locator(`[data-case-id="${row.case_id}"]`);
        assert.ok((await shown.innerText()).includes(row.value_a.toFixed(1)));
      }
      record(`${viewport.width}/rating-table-saved-values`, savedTable.run.integrity === 'verified', { run: tableFlow.run,
        rows: savedTable.rows.map((row: any) => ({ case_id: row.case_id, value_a: row.value_a, condition: row.condition, status: row.status })) });
      await tableCard.scrollIntoViewIfNeeded();
      await shot(page, frame, 'rating-table-card', { run: tableFlow.run });
      await tableCard.getByRole('button', { name: '在工作台打开', exact: true }).click();
      await page.waitForURL(url => url.pathname === `/types/${type.workspace}/rating-table/results` && url.searchParams.get('run') === tableFlow.run);
      const oldTable = page.getByRole('table', { name: '载流量表', exact: true });
      await oldTable.waitFor();
      for (const row of savedTable.rows) await until(async () => (await oldTable.getByRole('row').filter({ hasText: row.name }).innerText()).includes(row.value_a.toFixed(1)), '工作台逐行显示相同保存电流');
      record(`${viewport.width}/rating-table-workbench-same-run`, true, { run: tableFlow.run, url: page.url(), rowCount: savedTable.rows.length });
      await shot(page, undefined, 'workbench-rating-table', { run: tableFlow.run, type: type.workspace });
      await page.locator('.sidebar-mode').locator('button').filter({ hasText: /^Agent$/ }).click();
      frame = await agentFrame(page);

      stage = 'gb-correction';
      await newChat(frame);
      const gbStudyCount = (await json(backendUrl, `/api/workspaces/${gb.workspace}/studies`)).length;
      const correction = installGbWorkflow(model.faux, { ...gb, baselineReviewed: true });
      await speak(frame, gbRequest(gb, true));
      await pending(frame);
      record(`${viewport.width}/unapproved-gb-study-does-not-write`, (await json(backendUrl, `/api/workspaces/${gb.workspace}/studies`)).length === gbStudyCount,
        { before: gbStudyCount, pending: gbStudyCount, baselineConfirmationFrom: 'explicit human message' });
      const gbProposal = frame.locator('[data-card="proposal"][data-phase="pending"]').last();
      const gbChanges = gbProposal.getByRole('button', { name: /^完整改动/ });
      await expandProposal(gbProposal);
      const gbReviewText = (await gbProposal.innerText()).replaceAll(/\s/g, '');
      assert.ok(gbReviewText.includes(gb.baselineSource.replaceAll(/\s/g, '')) && gbReviewText.includes(gb.baselineDigest)
        && gbReviewText.includes('基准条件已人工核对'), 'GB人审必须同时保留确认、基准出处、实际PDF摘要和页码');
      record(`${viewport.width}/gb-baseline-review-visible`, true, { actualSourcePreserved: true, pdfSha256: gb.baselineDigest, pdfPage: gb.baselinePage });
      await gbProposal.locator('dt').filter({ hasText: '基准条件已人工核对' }).scrollIntoViewIfNeeded();
      await shot(page, frame, 'gb-baseline-proposal', { baselinePage: gb.baselinePage, baselineSha256: gb.baselineDigest });
      if (await gbChanges.count()) await gbChanges.click();
      const gbApprovals = await approveAll(frame, correction);
      const correctedRun = await json(backendUrl, `/api/workspaces/${gb.workspace}/studies/${correction.study}/runs/${correction.run}?view=full`);
      const artifact = correctedRun.output.cases[0].artifacts['x-cablesim.gb50217-correction'];
      const gbValue = artifact.corrected_current_a.toFixed(1);
      record(`${viewport.width}/gb-correction-saved`, gbApprovals === 3 && correctedRun.status === 'succeeded' && correctedRun.integrity === 'verified'
        && artifact.total_factor === 0.96 && correctedRun.snapshot.definition.parameters.baseline_sha256 === gb.baselineDigest,
      { run: correction.run, currentA: artifact.corrected_current_a, coefficients: artifact.coefficients, baselinePage: gb.baselinePage, baselineSha256: gb.baselineDigest, file: correction.file });
      await frame.getByRole('button', { name: '在工作台打开 · 查看已保存运行', exact: true }).last().click();
      await page.waitForURL(url => url.searchParams.get('run') === correction.run);
      await until(async () => (await page.getByLabel('GB 50217 校正结论', { exact: true }).innerText()).includes(gbValue), '旧工作台显示同一GB校正电流');
      await savedDrawing(page, backendUrl, gb.workspace, correction.study!, correction.run!, correction.result!);
      const coefficientDetails = page.locator('details').filter({ has: page.locator('summary').getByText('校正系数与标准出处', { exact: false }) }).first();
      if (!await coefficientDetails.evaluate(node => (node as HTMLDetailsElement).open)) await coefficientDetails.locator('summary').click();
      const coefficients = page.getByRole('table', { name: 'GB 50217 校正系数' });
      await coefficients.waitFor();
      for (const item of artifact.coefficients) assert.ok((await coefficients.innerText()).includes(String(item.factor)));
      record(`${viewport.width}/gb-workbench-same-run`, true, { run: correction.run, currentA: gbValue, url: page.url() });
      await shot(page, undefined, 'gb-correction-result', { run: correction.run, currentA: gbValue, baselineA: gb.baselineCurrent });
      await page.locator('.sidebar-mode').locator('button').filter({ hasText: /^Agent$/ }).click();
      frame = await agentFrame(page);

      stage = 'import-missing-source';
      await newChat(frame);
      const withoutSource = importInventory(repo, database);
      const missingSource = installMissingStructureSource(model.faux, source.workspace);
      await speak(frame, '导入厂家结构表.xlsx，先预览和映射列，再让我确认。');
      await waitFlow(missingSource, '只有文件名时拒绝导入');
      await frame.locator('[data-card="refusal"]').waitFor();
      record(`${viewport.width}/import-requires-original-source`, JSON.stringify(importInventory(repo, database)) === JSON.stringify(withoutSource),
        { pendingProposals: await frame.locator('[data-card="proposal"][data-phase="pending"]').count(), businessWrites: 0 });
      await shot(page, frame, 'import-missing-source');

      stage = 'structure-import';
      await newChat(frame);
      const beforeImport = importInventory(repo, database);
      const workbook = manufacturerWorkbook(repo);
      const imported = installStructureImport(model.faux, { workspace: source.workspace, seriesName: `Agent 验收 · ${viewport.width} 人民电器原表` });
      const choosingFile = page.waitForEvent('filechooser');
      await frame.getByRole('button', { name: '附上结构表', exact: true }).click();
      await (await choosingFile).setFiles({ name: workbook.filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: workbook.buffer });
      await frame.getByText(workbook.filename, { exact: true }).waitFor();
      await speak(frame, '把附上的人民电器原始结构表导入型号库并核对，关联城南工程；保留来源和缺项，每次写入先给我审阅。');
      const operations = ['propose_structure_upload', 'propose_structure_preview', 'propose_structure_import', 'propose_structure_check'];
      for (const [phase, operation] of operations.entries()) {
        const proposal = await pendingOperation(frame, operation);
        const actual = importInventory(repo, database);
        const expected = { ...beforeImport,
          type_table_uploads: beforeImport.type_table_uploads + (phase >= 1 ? 1 : 0),
          type_table_previews: beforeImport.type_table_previews + (phase >= 2 ? 1 : 0),
          type_series: beforeImport.type_series + (phase >= 3 ? 1 : 0),
          type_series_specs: beforeImport.type_series_specs + (phase >= 3 ? 11 : 0),
          domain_cable_models: beforeImport.domain_cable_models + (phase >= 3 ? 11 : 0) };
        record(`${viewport.width}/unapproved-${operation}`, JSON.stringify(actual) === JSON.stringify(expected), { operation, before: beforeImport, actual, expected });
        if (phase === 0) {
          await proposal.scrollIntoViewIfNeeded();
          await shot(page, frame, 'import-upload-proposal', { file: workbook.filename, sha256: imported.attachment!.sha256 });
        } else if (phase === 1) {
          await expandProposal(proposal);
          const review = await proposal.innerText();
          record(`${viewport.width}/import-mapping-review`, review.includes(workbook.filename) && review.includes(imported.upload!.sha256),
            { file: workbook.filename, sha256: imported.upload!.sha256, operation });
          await shot(page, frame, 'import-mapping-proposal', { file: workbook.filename });
        } else if (phase === 2) {
          const preview = frame.locator('[data-card="structure-preview"]').last();
          await preview.waitFor();
          record(`${viewport.width}/saved-import-preview`, await preview.locator('[data-structure-row]').count() === 11
            && imported.preview!.valid_count === 11 && imported.preview!.error_count === 0,
          { rows: 11, valid: imported.preview!.valid_count, errors: imported.preview!.error_count, missing: imported.preview!.incomplete_count,
            sourceSha256: imported.preview!.sha256, previewDigest: imported.preview!.preview_digest });
          await preview.evaluate(element => element.scrollIntoView({ block: 'start' }));
          await shot(page, frame, 'import-saved-preview', { previewDigest: imported.preview!.preview_digest });
          const firstRow = preview.locator('[data-structure-row]').first();
          const firstToggle = firstRow.getByRole('button', { name: /^第 \d+ 行 ·/ });
          await firstToggle.click();
          await until(async () => await firstToggle.getAttribute('aria-expanded') === 'true' && firstRow.locator('[data-structure-field]').first().evaluate(element => {
            const panel = element.closest<HTMLElement>('[data-slot="collapsible-content"]');
            return Boolean(panel && panel.clientHeight >= panel.scrollHeight - 1 && !panel.hasAttribute('data-starting-style')
              && panel.getAnimations({ subtree: true }).every(animation => !animation.pending && animation.playState !== 'running'));
          }).catch(() => false), '原字段、单位与来源实际展开');
          const firstFact = imported.preview!.preview.rows[0].values[0];
          const sourceText = await firstRow.innerText();
          record(`${viewport.width}/import-source-and-units-visible`, sourceText.includes(firstFact.label) && sourceText.includes(workbook.filename)
            && sourceText.includes('保存值'), { row: imported.preview!.preview.rows[0].row_number, fullFields: imported.preview!.preview.rows[0].values.length });
          await firstRow.evaluate(element => element.scrollIntoView({ block: 'start' }));
          await shot(page, frame, 'import-source-fields');
          await firstToggle.click();
          await expandProposal(proposal);
          const review = await proposal.innerText();
          record(`${viewport.width}/import-fixed-digest-review`, review.includes(imported.preview!.preview_digest) && review.includes(workbook.filename),
            { previewDigest: imported.preview!.preview_digest, allRowsPreserved: true });
          await shot(page, frame, 'import-draft-proposal', { rows: 11, previewDigest: imported.preview!.preview_digest });
        }
        const importProposalId = await proposal.getAttribute('data-proposal-id');
        assert.ok(importProposalId);
        await accept(frame, importProposalId);
      }
      await waitFlow(imported, '原件导入并逐项真实核对');
      const checked = frame.locator('[data-card="structure-check"]').last();
      await checked.waitFor();
      const afterImport = importInventory(repo, database);
      record(`${viewport.width}/import-four-approvals-and-real-runs`, imported.imported!.created === 11 && imported.checked!.items.length === 11
        && afterImport.study_runs === beforeImport.study_runs + 11 && await checked.locator('[data-check-spec]').count() === 11,
      { acceptedOperations: operations, before: beforeImport, after: afterImport, series: imported.imported!.series_id });
      for (const item of imported.checked!.items) {
        const run = await json(backendUrl, `/api/workspaces/${item.workspace_id}/studies/${item.study_id}/runs/${item.run_id}?view=full`);
        assert.ok(run.status === 'succeeded' && run.integrity === 'verified' && run.input_digest === item.input_digest
          && run.output_digest === item.output_digest && run.snapshot.definition.method.plugin_id === 'cablesim.standard-check', '核对卡必须来自真实固定输入的保存运行');
      }
      await checked.evaluate(element => element.scrollIntoView({ block: 'start' }));
      await shot(page, frame, 'import-checked', { series: imported.imported!.series_id, runs: imported.checked!.items.map((item: any) => item.run_id) });
      const firstSpec = imported.imported!.specs[0];
      await checked.getByRole('button', { name: '在工作台打开 · ' + firstSpec.name, exact: true }).click();
      await page.waitForURL(url => url.pathname.includes(firstSpec.workspace_id));
      await until(() => page.locator('body').innerText().then(text => text.includes(firstSpec.name) && text.includes('草稿')), '真实导入型号的旧工作台');
      record(`${viewport.width}/import-old-workbench`, true, { type: firstSpec.workspace_id, name: firstSpec.name, url: page.url(), state: 'draft' });
      await shot(page, undefined, 'imported-type-workbench', { workspace: firstSpec.workspace_id, name: firstSpec.name });
      completedImports.add(viewport.width);
    } catch (error) {
      const visibleFrame = page.frames().find(item => item.url().includes('/agent-app/fusion.html'));
      await shot(page, visibleFrame, `${stage}-failed`, { error: clean(error instanceof Error ? error.message : String(error), 'browser/scenario-failure') }).catch(() => undefined);
      throw error;
    } finally { await flush(); await context.close(); }
  }

  // A real stopped sidecar, reached through the old backend proxy. No intercepted response is used for this state.
  await sidecar.close();
  sidecar = undefined;
  stage = 'sidecar-down';
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const flush = await observe(page);
    try {
      await page.goto(frontendUrl + '/agent', { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Agent 对话服务未连接' }).waitFor();
      await shot(page, undefined, 'sidecar-down');
      record(`${viewport.width}/sidecar-down-explanation`, await page.getByRole('button', { name: '重试', exact: true }).isVisible(),
        { actualServiceStopped: true, visible: await page.locator('.agent-page').innerText() });
    } finally { await flush(); await context.close(); }
  }
  record('browser-console-network', browserErrors.every(item => item.expected === true), { unexpected: browserErrors.filter(item => !item.expected),
    expected: browserErrors.filter(item => item.expected), policy: '仅忽略导航取消请求，以及主动停止边车阶段的 502/503 和断连；其余错误失败。' });
} catch (error) {
  failure = clean(error instanceof Error ? error.stack || error.message : String(error), 'walk/failure');
  checks.push({ id: 'walk-completion', status: '未通过', evidence: failure });
} finally {
  // Capability limits remain visible even when an earlier browser scenario fails.
  checks.push({ id: 'manufacturer-structure-import', status: completedImports.size === 2 ? '通过' : '未通过',
    evidence: { completedViewports: [...completedImports], requiredViewports: [1366, 1920],
      workflow: '原始XLSX附件→原件上传提案→列映射预览提案→固定摘要草稿入库提案→逐项核对提案→真实保存运行与旧型号工作台；四次接受前检查真实数据库无提前写入。' } });
  checks.push({ id: 'real-model-six-phrases', status: '云端无法验证', evidence: configuredRealModel
    ? '检测到真实模型配置；本脚本只验脚本化模型，请另附真实模型六句话走查证据。'
    : '三项 CABLE_STUDIO_MODEL_* 环境配置不齐全；本轮未调用真实模型，也没有把脚本化模型结果标成真实模型验收。' });
  if (browser) await browser.close().catch(() => undefined);
  if (sidecar) await sidecar.close().catch(() => undefined);
  await Promise.all(children.map(stop));
  for (const [label, content] of Object.entries(processLogs)) writeFileSync(join(out, `${label}.log`), clean(content, `process/${label}`));
  // Inspect the complete records before deriving the verdict, including URLs and locations outside response bodies.
  const safeNetwork = clean(JSON.stringify(network, null, 2), 'artifact/network');
  const safeConsole = clean(JSON.stringify({ consoles, errors: browserErrors }, null, 2), 'artifact/console');
  clean(JSON.stringify({ checks, screenshots }), 'artifact/acceptance');
  const browserObserved = network.some(item => item.type === 'request') && network.some(item => item.type === 'sse');
  const secretCheck = { passed: browserObserved && leakLocations.size === 0, browserObserved,
    credentialsExamined: 'in-memory model sentinel, sidecar token, and any supplied model keys',
    matchedLocations: [...leakLocations], browserRequests: network.filter(item => item.type === 'request').length,
    browserResponses: network.filter(item => item.type === 'response').length, browserSseEvents: network.filter(item => item.type === 'sse').length,
    processLogs: Object.keys(processLogs), actualSecretValuesSaved: false };
  checks.push({ id: 'model-keys-absent-from-network-and-logs', status: leakLocations.size ? '未通过' : browserObserved ? '通过' : '云端无法验证', evidence: secretCheck });
  writeFileSync(join(out, 'browser-network.json'), safeNetwork);
  writeFileSync(join(out, 'browser-console.json'), safeConsole);
  writeFileSync(join(out, 'acceptance.json'), clean(JSON.stringify({ testedAt: new Date().toISOString(), mode: 'scripted-model-real-platform',
    serverTopology: ['real FastAPI backend with fresh release seed', 'real pi sidecar with scripted model provider', 'old frontend Vite server'],
    visualReview: '截图已生成，必须由操作者逐张打开检查后才可在 PR 标为通过。', failure, checks, screenshots, secretCheck }, null, 2), 'artifact/acceptance'));
  rmSync(home, { recursive: true, force: true });
}
console.log(`走查证据：${out}`);
if (failure || leakLocations.size) { console.error(failure || '密钥泄漏检查失败，详见验收记录中的匹配位置。'); process.exitCode = 1; }
else console.log(`脚本化模型真实平台走查完成：${screenshots.length} 张截图；待操作者逐张检查。真实模型与结构表实际完成状态已单列。`);
