/** Full production router and real local API; fresh input-only database, no saved-result fixtures or solver calls. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..'), root = resolve(frontend, '..');
await mkdir(join(root, '.tmp'), { recursive: true });
const scratch = await mkdtemp(join(root, '.tmp', 'frontend-polish-'));
const output = join(frontend, 'test-results', 'visualization'); await mkdir(output, { recursive: true });
const python = process.env.PYTHON || [join(root, '.venv', 'Scripts', 'python.exe'), join(root, '.venv', 'bin', 'python')].find(existsSync) || 'python';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [], checks = [], visited = [], prohibitedRequests = [];
let backend, server, browser, backendLog = '', backendUrl;
async function availablePort() {
  const socket = net.createServer(); await new Promise((yes, no) => { socket.once('error', no); socket.listen(0, '127.0.0.1', yes); });
  const address = socket.address(); assert(address && typeof address === 'object');
  await new Promise(resolve => socket.close(resolve)); return address.port;
}
async function request(path, method = 'GET', body) {
  const result = await fetch(backendUrl + path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const text = await result.text(); assert(result.ok, `${method} ${path}: ${result.status} ${text.slice(0, 1600)}`); return text ? JSON.parse(text) : null;
}
async function inputWorkspace() {
  const workspace = await request('/api/workspaces', 'POST', {});
  assert(workspace.id && workspace.revision);
  await request(`/api/workspaces/${workspace.id}/domain/conversion`, 'POST', { expected_revision: workspace.revision });
  const converted = await request(`/api/workspaces/${workspace.id}`);
  assert.equal(converted.domain.schema_version, 'cablesim.domain/1'); return converted;
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit').catch(() => {}); child.kill('SIGTERM');
  await Promise.race([exited, delay(6000)]);
  if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
}
try {
  const backendPort = await availablePort(); backendUrl = `http://127.0.0.1:${backendPort}`;
  const environment = { ...process.env, CABLESIM_DB: join(scratch, 'workspace.sqlite'), CABLESIM_DATASETS_DIR: join(scratch, 'datasets'), CABLESIM_REPRODUCTION_LIBRARY: join(scratch, 'reproductions'), TEMP: scratch, TMP: scratch };
  backend = spawn(python, ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', String(backendPort), '--log-level', 'warning'], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  backend.on('error', error => { backendLog += error.message; });
  for (const stream of [backend.stdout, backend.stderr]) stream.on('data', chunk => { backendLog = (backendLog + String(chunk)).slice(-12000); });
  let healthy = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (backend.exitCode !== null) throw Error('Fresh host startup failed: ' + backendLog);
    try { healthy = (await fetch(backendUrl + '/api/health', { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (healthy) break; await delay(250);
  }
  assert(healthy, 'Fresh host did not become ready: ' + backendLog);
  const studyWorkspace = await inputWorkspace(), typeWorkspace = await inputWorkspace();
  const methods = await request('/api/methods');
  const entry = methods.find(row => row.method?.plugin_id === 'cablesim.thermal-network');
  assert(entry && entry.capabilities.some(capability => capability.id === 'steady-rating'), 'The declared thermal reference must exist; do not substitute another method');
  const sectionId = studyWorkspace.domain.sections[0]?.id;
  assert(sectionId, 'The converted input must contain a real installation section');
  const study = await request(`/api/workspaces/${studyWorkspace.id}/studies`, 'POST', {
    title: '界面回归 · 输入工况（未求解）', expected_revision: studyWorkspace.revision, task: 'rating',
    profile: { profile: 'mv-concentric/1', section_id: sectionId },
    method: { ...entry.method, capability: 'steady-rating' }, driver: { kind: 'single' }, parameters: {},
  });
  assert(study.id); checks.push('fresh host, real workspace conversion and pinned input-only study');
  process.env.BACKEND_URL = backendUrl;
  server = await createServer({ root: frontend, configFile: join(frontend, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [root] }, proxy: { '/api': { target: backendUrl, changeOrigin: true } } } });
  await server.listen(); const address = server.httpServer.address(); assert(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && /\/(runs|recalculate|execute)$/.test(path)) {
      prohibitedRequests.push(`${request.method()} ${path}`); return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  async function visit(path, width = 1440, theme = 'light') {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin + path + (path.includes('?') ? '&' : '?') + 'theme=' + theme, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell[data-ui-polish]')).toHaveCount(1, { timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 });
    await expect(page.locator('.main-content .state-view[aria-busy="true"]')).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const layout = await page.evaluate(() => {
      const main = document.querySelector('.main-content'), viewport = innerWidth;
      const actions = [...document.querySelectorAll('.topbar button')].filter(element => element.getClientRects().length > 0).map(element => ({ label: element.textContent, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }));
      return { documentWidth: document.documentElement.scrollWidth, viewport, mainWidth: main?.clientWidth || 0, mainHeight: main?.clientHeight || 0, clippedActions: actions.filter(row => row.left < -1 || row.right > viewport + 1) };
    });
    assert(layout.documentWidth <= width + 1, `${path} document overflow: ${JSON.stringify(layout)}`);
    assert(layout.mainWidth > 0 && layout.mainHeight > 0, `${path} lost the work pane`);
    assert.deepEqual(layout.clippedActions, [], `${path} actions outside viewport`);
    visited.push({ path, width, theme });
  }
  const topPages = ['/', '/types', '/studies', '/library', '/library/documents', '/library/deliveries', '/library/reproductions', '/plugins', '/settings'];
  for (const path of topPages) await visit(path);
  checks.push('all nine top-level production pages with the real host');
  const definitions = await page.evaluate(async () => ({ studies: (await import('/src/pages/study-modules.ts')).moduleDefinitions, types: (await import('/src/features/type/module-definitions.ts')).typeModules }));
  // Native runtime and saved-result interactions are separately validated; no fake results here.
  const deferred = [];
  for (const [module, definition] of Object.entries(definitions.studies)) for (const tab of definition.tabs) {
    if (module === 'section' && tab.id === 'three-dimensional') { deferred.push('study:section/three-dimensional (native geometry/runtime acceptance is separate)'); continue; }
    await visit(`/studies/${study.id}/${module}/${tab.id}?workspace=${studyWorkspace.id}`);
  }
  checks.push('registered study tabs: actual inputs, method controls and explicit no-result states');
  for (const module of definitions.types) for (const [tab] of module.tabs) {
    if (module.id === 'structure' && tab === 'three') { deferred.push('type:structure/three (native geometry/runtime acceptance is separate)'); continue; }
    await visit(`/types/${typeWorkspace.id}/${module.id}/${tab}`);
  }
  checks.push('registered type tabs: structure table, requirements, evidence, comparisons and specifications');
  const compactPages = [...topPages, `/types/${typeWorkspace.id}/structure/table`, `/studies/${study.id}/conditions/inputs?workspace=${studyWorkspace.id}`, `/studies/${study.id}/ampacity/visualization?workspace=${studyWorkspace.id}`];
  for (const path of compactPages) await visit(path, 640, 'dark');
  for (const path of ['/', '/types', '/library/documents', '/settings', `/types/${typeWorkspace.id}/structure/table`, `/studies/${study.id}/conditions/inputs?workspace=${studyWorkspace.id}`]) await visit(path, 320, 'light');
  checks.push('640px dark and 320px light layouts retain usable panes and primary actions');
  await page.getByRole('button', { name: '模块导航', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '研究模块', exact: true }); await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: '电缆', exact: true }).click();
  await expect(page.getByRole('button', { name: '模块导航', exact: true })).toHaveAttribute('aria-expanded', 'false');
  assert(new URL(page.url()).pathname.endsWith('/cable/section'));
  checks.push('compact module navigation changes the real route and closes its disclosure');
  await visit(`/types/${typeWorkspace.id}/structure/table`, 640, 'dark');
  await page.screenshot({ path: join(output, 'type-table-production-route.png'), fullPage: false });
  await visit(`/studies/${study.id}/conditions/inputs?workspace=${studyWorkspace.id}`, 1440, 'light');
  await page.screenshot({ path: join(output, 'study-inputs-production-route.png'), fullPage: false });
  await visit('/library/documents', 640, 'dark');
  await page.screenshot({ path: join(output, 'documents-production-route.png'), fullPage: false });
  await page.goto(origin + '/not-a-cablesim-route?theme=dark');
  await expect(page.getByRole('heading', { name: '页面不存在', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '研究列表', exact: true })).toHaveAttribute('href', /theme=dark/);
  checks.push('unknown production route offers working theme-preserving recovery');
  const afterStudy = await request(`/api/workspaces/${studyWorkspace.id}`), afterType = await request(`/api/workspaces/${typeWorkspace.id}`);
  assert.deepEqual(afterStudy.domain, studyWorkspace.domain); assert.deepEqual(afterType.domain, typeWorkspace.domain);
  assert.equal(afterStudy.revision, studyWorkspace.revision); assert.equal(afterType.revision, typeWorkspace.revision);
  const runs = await request(`/api/workspaces/${studyWorkspace.id}/studies/${study.id}/runs`);
  assert(!Array.isArray(runs) || runs.length === 0);
  if (!Array.isArray(runs)) assert.equal((runs.items || runs.runs || []).length, 0);
  assert.deepEqual(prohibitedRequests, [], 'Page visits must not start a solver');
  assert.deepEqual(errors, [], errors.join('\n'));
  const report = { status: 'passed', checks, visited, deferred, errors, scope: 'Production main/router + real local API, fresh input-only database. Not numerical, saved-result, native OCCT runtime or release-build acceptance.' };
  await writeFile(join(output, 'production-route-checks.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const message = String(error?.stack || error).slice(0, 3500).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.error(`::error title=Production frontend route regression::${message}`);
  console.error(JSON.stringify({ status: 'failed', checks, visited, errors, prohibitedRequests, backendLog }, null, 2)); throw error;
}
finally { await browser?.close(); await server?.close(); await stop(backend); await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 }); }
