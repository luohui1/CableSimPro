import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, repositoryRoot } from './browser.mjs';
import { checkLayout } from '../src/features/type/tests/ui-checks.mjs';
import { identifyText, exceptionFor, readOnlyPost } from './visible-text-policy.mjs';

assert.equal(process.env.E2E_ISOLATED, '1', '客户端真实使用只能在隔离副本运行');
const base = process.env.FRONTEND_URL, expect = baseExpect.configure({ timeout: 45000 });
const out = path.join(repositoryRoot, '.data/fix-round/shared-shell/agent-real-use');
await fs.mkdir(out, { recursive: true });
const session = await openHeadlessBrowser({ executable: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headed: true });
const { page, context } = session;
const evidence = { started: new Date().toISOString(), actions: [], variants: [], jobs: [], errors: [], blocked: [], requests: [], coreHours: 0 };
let study, workspace;
page.on('pageerror', error => evidence.errors.push(error.message));
await context.route('**/api/**', route => {
  const req = route.request(), p = new URL(req.url()).pathname, method = req.method();
  const permitted = ['GET', 'HEAD', 'OPTIONS'].includes(method) || method === 'POST' && (
    p === '/api/design/study-workspaces' || /^\/api\/workspaces\/[^/]+\/studies$/.test(p)
    || study && p === `/api/workspaces/${workspace}/studies/${study}/runs`
    || workspace && p === `/api/workspaces/${workspace}/delivery-jobs`
    || /^\/api\/workspaces\/[^/]+\/geometry-preview$/.test(p) || readOnlyPost(p));
  if (!permitted) { evidence.blocked.push({ method, path: p }); return route.abort('blockedbyclient'); }
  evidence.requests.push({ method, path: p });
  return route.fallback();
});
page.on('response', async response => {
  if (/\/delivery-jobs(?:\/[^/]+)?$/.test(new URL(response.url()).pathname)) {
    try { evidence.jobs.push({ status: response.status(), job: await response.json() }); } catch { /* failure is retained by the real UI */ }
  }
});
async function get(url) { const response = await fetch(base + url); assert.ok(response.ok, url + ': ' + response.status); return response.json(); }
async function theme(value) {
  if (await page.locator('html').getAttribute('data-theme') === value) return;
  await page.locator('.sidebar-foot').getByRole('button').click();
  await page.getByRole('menuitem', { name: value === 'dark' ? '切换深色模式' : '切换浅色模式', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', value);
}
async function appearance(label, selector) {
  for (const width of [1366, 1920]) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
    await page.evaluate(() => document.fonts.ready);
    evidence.variants.push({ label, theme: await page.locator('html').getAttribute('data-theme'), width, layout: await checkLayout(page, selector), passed: true });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
}
async function inquiry() {
  await page.getByRole('button', { name: '新建研究', exact: true }).first().click();
  const chooser = page.getByRole('dialog', { name: '新建研究', exact: true });
  await chooser.getByRole('combobox', { name: '研究任务', exact: true }).click();
  await page.getByRole('option', { name: '客户问询选型', exact: true }).click();
  const initial = page.getByRole('dialog', { name: '新建问询', exact: true });
  await expect(initial.getByLabel('工程名称', { exact: true })).toBeVisible();
  return initial;
}
try {
  await page.goto(base + '/?theme=light'); await expect(page.locator('.app-shell')).toBeVisible();
  const projectName = '工程甲 · 载流量客户询价';
  for (const value of ['light', 'dark']) {
    await theme(value);
    const initial = await inquiry();
    await appearance('询价工程字段初始', '[role=dialog]');
    await initial.getByLabel('目标电流', { exact: true }).fill('350');
    await initial.getByLabel('目标电流', { exact: true }).press('Tab');
    await initial.locator('input[type=radio]').first().check();
    await initial.getByLabel('工程名称', { exact: true }).fill('');
    await initial.getByRole('button', { name: '建立研究', exact: true }).click();
    await expect(initial.getByLabel('工程名称', { exact: true })).toBeFocused();
    await expect(initial.getByLabel('工程名称', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(initial.getByRole('alert')).toHaveText('请填写客户与工程名称');
    assert.equal(evidence.requests.some(req => req.method === 'POST' && req.path === '/api/design/study-workspaces'), false, '缺工程名不得保存工程');
    await appearance('工程名缺项就地拒绝', '[role=dialog]');
    if (value === 'light') await page.screenshot({ path: path.join(out, 'inquiry-name-light.png') });
    await initial.getByLabel('工程名称', { exact: true }).fill(projectName);
    await expect(initial.getByRole('alert')).toHaveCount(0);
    await initial.getByLabel('研究名称', { exact: true }).fill('客户载流量询价');
    await appearance('工程名修好待保存', '[role=dialog]');
    if (value === 'light') await page.keyboard.press('Escape');
    else await initial.getByRole('button', { name: '建立研究', exact: true }).click();
  }
  const completion = page.getByRole('dialog', { name: '补录工程师给定参数', exact: true });
  await expect(completion.getByRole('button', { name: '采用参考输入', exact: true })).toBeEnabled();
  await completion.getByRole('button', { name: '采用参考输入', exact: true }).click();
  await expect(completion).toContainText('尚缺 0 项');
  await completion.getByRole('button', { name: '保存并预检', exact: true }).click();
  const preflight = page.getByRole('dialog', { name: '运行前预检', exact: true });
  await expect(preflight).toBeVisible();
  const location = new URL(page.url()); study = location.pathname.split('/')[2]; workspace = location.searchParams.get('workspace');
  const saved = await get(`/api/workspaces/${workspace}`), savedStudy = await get(`/api/workspaces/${workspace}/studies/${study}`);
  assert.equal(saved.domain.name, projectName); assert.equal(savedStudy.definition.method.plugin_id, 'cablesim.iec60287');
  evidence.actions.push({ action: '填写工程名后实际保存新询价', workspace, study, name: saved.domain.name, method: savedStudy.definition.method });
  await expect(preflight.getByText('你的工况在适用范围内 ✓', { exact: true })).toBeVisible({ timeout: 180000 });
  await preflight.getByRole('button', { name: '确认并运行', exact: true }).click();
  await expect(page.locator('.study-selection-table').first()).toBeVisible({ timeout: 180000 });
  const runs = await get(`/api/workspaces/${workspace}/studies/${study}/runs`);
  const run = runs.items.find(row => ['succeeded', 'partial'].includes(row.status) && row.integrity === 'verified' && row.freshness === 'current');
  assert.ok(run, '应有真实 IEC 插件保存运行');
  evidence.actions.push({ action: '真实 IEC 选型运行', run: run.id, status: run.status, inputDigest: run.input_digest, outputDigest: run.output_digest });
  await theme('light');
  await page.evaluate(() => {
    window.clientProgress = [];
    window.clientProgressObserver = new MutationObserver(() => {
      const text = document.querySelector('.report-module .report-toolbar [role=status]')?.textContent?.trim();
      if (text && window.clientProgress.at(-1)?.text !== text) window.clientProgress.push({ text, time: new Date().toISOString() });
    });
    window.clientProgressObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.getByRole('toolbar', { name: '工程命令' }).getByRole('button', { name: '生成计算书', exact: true }).click();
  await expect(page.locator('.report-module .report-toolbar [role=status]')).toBeVisible();
  await page.screenshot({ path: path.join(out, 'report-progress-light.png') });
  await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled({ timeout: 180000 });
  evidence.progress = await page.evaluate(() => { window.clientProgressObserver.disconnect(); return window.clientProgress; });
  assert.ok(evidence.progress.length >= 2, '生成应在界面显示实际分步进度');
  evidence.exposed = evidence.progress.flatMap(({ text }) => identifyText(text).filter(hit => !exceptionFor({ ...hit, text, layer: 'ordinary' })));
  assert.deepEqual(evidence.exposed, [], '分步进度应显示人话');
  const terminal = evidence.jobs.findLast(entry => entry.job.state === 'succeeded')?.job;
  assert.ok(terminal?.delivery_id && terminal.elapsed_seconds > 0 && Object.keys(terminal.timings_seconds || {}).length >= 2, '正式任务应返回实际总耗时与分步耗时');
  evidence.actions.push({ action: '从真实保存运行生成计算书', job: terminal });
  for (const value of ['light', 'dark']) { await theme(value); await appearance('真实计算书生成完成', '.report-module'); }
  await theme('light');
  await expect(page.getByTitle('计算书预览', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(out, 'report-generated-light.png') });
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
  await (await download).saveAs(path.join(out, 'customer.pdf'));
  assert.equal((await fs.readFile(path.join(out, 'customer.pdf'))).subarray(0, 5).toString(), '%PDF-');
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.blocked, []);
  evidence.finished = new Date().toISOString(); evidence.passed = true;
} catch (error) { evidence.failure = error.stack; process.exitCode = 1; await page.screenshot({ path: path.join(out, 'client-failure.png') }).catch(() => {}); console.error(error); }
finally { await fs.writeFile(path.join(out, 'client.json'), JSON.stringify(evidence, null, 2)); await session.close(); }
console.log(JSON.stringify({ passed: evidence.passed || false, variants: evidence.variants.length, errors: evidence.errors.length, blocked: evidence.blocked.length, progress: evidence.progress?.length }));
