import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, repositoryRoot } from './browser.mjs';
import { checkLayout } from '../src/features/type/tests/ui-checks.mjs';
import { readOnlyPost } from './visible-text-policy.mjs';

assert.equal(process.env.E2E_ISOLATED, '1', '只能在发布库隔离副本使用');
const base = process.env.FRONTEND_URL, expect = baseExpect.configure({ timeout: 45000 });
const out = path.join(repositoryRoot, '.data/fix-round/shared-shell/forms-real-use');
await fs.mkdir(out, { recursive: true });
const record = { started: new Date().toISOString(), actions: [], variants: [], requests: [], blocked: [], errors: [], fixtures: [], coreHours: 0 };
const session = await openHeadlessBrowser({ executable: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const { page, context } = session;
let study;
page.setDefaultTimeout(45000);
page.on('pageerror', error => record.errors.push(error.message));
await context.route('**/api/**', route => {
  const req = route.request(), p = new URL(req.url()).pathname, method = req.method();
  if (method === 'GET' && p.endsWith('/preflight') || !['GET', 'HEAD', 'OPTIONS'].includes(method) && !(method === 'PUT' && study && p === `/api/workspaces/${study.workspace}/studies/${study.id}`) && !(method === 'POST' && readOnlyPost(p))) {
    record.blocked.push({ method, path: p });
    return route.abort('blockedbyclient');
  }
  return route.fallback();
});
page.on('request', request => { if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method())) record.requests.push({ method: request.method(), path: new URL(request.url()).pathname }); });
async function get(url) { const response = await fetch(base + url, { signal: AbortSignal.timeout(60000) }); assert.ok(response.ok, url + ': ' + response.status); return response.json(); }
async function go(url) { await page.goto(base + url, { waitUntil: 'domcontentloaded' }); await expect(page.locator('.app-shell')).toBeVisible(); await page.evaluate(() => document.fonts.ready); }
async function appearance(label, selector) {
  for (const width of [1366, 1920]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; for (const node of document.querySelectorAll('[data-theme]')) node.dataset.theme = theme; }, theme);
    await page.waitForTimeout(100); await checkLayout(page, selector); record.variants.push({ label, width, theme, passed: true });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; for (const node of document.querySelectorAll('[data-theme]')) node.dataset.theme = 'light'; });
}
const config = value => value.definition.modules?.['thermal-field'] || value.definition;
let range;
async function save() {
  const response = page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/workspaces/${study.workspace}/studies/${study.id}`);
  await page.keyboard.press('Control+s'); const saved = await response;
  assert.ok(saved.ok(), '真实保存失败：' + saved.status());
  await expect(page.getByRole('toolbar', { name: '工程命令' }).locator('[data-command-role=save]:visible')).toHaveText('已保存');
  const value = await get(`/api/workspaces/${study.workspace}/studies/${study.id}`);
  record.actions.push({ action: '界面保存', status: saved.status(), revision: value.revision, bounds: config(value).parameters.domain_options.bounds_m });
  return value;
}
async function preflight() {
  const result = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/input-preflight'));
  await page.getByRole('toolbar', { name: '工程命令' }).getByRole('button', { name: /^预检/ }).click();
  assert.ok((await result).ok(), '真实输入预检请求失败'); const data = await (await result).json();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByText(/正在本机检查/)).toHaveCount(0);
  record.actions.push({ action: '真实宿主与插件输入预检', data }); return data;
}
const issues = data => (data.cases || []).flatMap(row => row.error?.issues?.length ? row.error.issues : row.error ? [row.error] : []);
try {
  if (process.env.FORMS_REAL_USE_HISTORY_ONLY !== '1') {
  for (const project of await get('/api/workspaces')) {
    study = (await get(`/api/workspaces/${project.id}/studies`)).find(row => config(row).method.capability === 'iec-thermal-field');
    if (study) break;
  }
  assert.ok(study, '来源库须有真实保存的有限元研究，不造数据');
  const original = structuredClone(study); record.source = { study: study.id, workspace: study.workspace, configuration: config(study) };
  await go(`/studies/${study.id}/thermal-field/parameters?workspace=${study.workspace}&theme=light&inspector=method`);
  const form = page.getByLabel('有限元方法参数', { exact: true }); await expect(form).toBeVisible();
  const contracts = await get('/api/input-contracts');
  if (!contracts.some(row => row.method.release_digest === config(study).method.release_digest)) {
    const installed = (await get('/api/methods')).find(row => row.method.plugin_id === 'cablesim.simulation');
    assert.ok(installed, '实际仿真插件未安装');
    await form.getByRole('combobox', { name: '方法版本', exact: true }).click();
    await page.getByRole('option').filter({ hasText: '电缆有限元仿真' }).filter({ hasText: installed.method.version }).first().click();
    record.actions.push({ action: '界面明确选择已安装方法', from: config(original).method.version, to: installed.method.version });
  }
  range = form.locator('.range-field'); await expect(range).toBeVisible();
  await expect(range.locator('input')).toHaveCount(4);
  for (const [index, label] of ['左', '下', '右', '上'].entries()) {
    const field = range.getByLabel(label, { exact: true }); await expect(field).toBeVisible();
    assert.ok((await field.locator('xpath=ancestor::*[@data-field-path][1]').getAttribute('data-field-path')).endsWith('/' + index));
    await expect(field.locator('..').locator('.unit')).toHaveText('m');
  }
  const before = config(original).parameters.domain_options.bounds_m;
  assert.equal(before.length, 4); assert.ok(before.every(Number.isFinite));
  const expected = [...before]; expected[0] -= 0.1;
  await range.getByLabel('左', { exact: true }).fill(String(expected[0]));
  // Save while the coordinate is still focused: exercise the formal numeric draft and array path.
  const changed = await save(); assert.deepEqual(config(changed).parameters.domain_options.bounds_m, expected, '四个位置和SI单位须原样保存');
  const good = await preflight(); assert.ok(!issues(good).some(row => row.path?.includes('/bounds_m')), '修正范围不能仍有范围契约错误');
  await page.keyboard.press('Escape');
  await range.scrollIntoViewIfNeeded(); await appearance('真实修改、保存及预检后的计算域', '.range-field');
  await page.screenshot({ path: path.join(out, 'range-saved-light.png') });
  await range.getByLabel('右', { exact: true }).fill(''); await range.getByLabel('右', { exact: true }).press('Enter');
  const missing = await save(); assert.deepEqual(config(missing).parameters.domain_options.bounds_m, [expected[0], expected[1], null, expected[3]], '空值保留原数组下标，不能缩短或排序');
  const rejected = await preflight(), issue = issues(rejected).find(row => row.path?.endsWith('/bounds_m/2'));
  assert.ok(issue, '真实预检必须返回具体数组下标 /bounds_m/2');
  await page.getByRole('dialog').getByRole('button', { name: /修正.*截面计算边界/ }).first().click();
  await expect(range.getByLabel('右', { exact: true })).toBeFocused();
  const location = await page.evaluate(() => { const node = document.activeElement, box = node.getBoundingClientRect(); return { label: node.labels?.[0]?.textContent, path: node.closest('[data-field-path]')?.dataset.fieldPath, visible: box.top >= 0 && box.bottom <= innerHeight }; });
  assert.ok(location.visible); assert.ok(location.path.endsWith('/bounds_m/2'));
  record.actions.push({ action: '点击真实预检缺项入口，具体框获得焦点', issue, location });
  await appearance('真实预检缺项定位到右值框', '.range-field');
  await page.screenshot({ path: path.join(out, 'range-focused-light.png') });
  await range.getByLabel('右', { exact: true }).fill(String(expected[2])); await range.getByLabel('右', { exact: true }).press('Enter');
  assert.deepEqual(config(await save()).parameters.domain_options.bounds_m, expected);
  const repaired = await preflight(); assert.ok(!issues(repaired).some(row => row.path?.includes('/bounds_m')), '修好后范围缺项须消失');
  await page.keyboard.press('Escape'); await appearance('真实修复范围并重新预检', '.range-field');
  }
  // Real saved Agent history only. Do not call a model or create substitute tasks before the next round.
  const tasks = await get('/api/agent/sessions'); record.agentHistory = { states: [...new Set(tasks.map(task => task.state))], checked: [] };
  for (const state of ['waiting', 'blocked', 'failed']) {
    const task = tasks.find(task => task.state === state); if (!task) { record.agentHistory.checked.push({ state, covered: false, reason: '来源隔离库无此类真实保存任务；不造任务、不调用模型。' }); continue; }
    await go(`/agent?task=${task.id}&workspace=${task.workspace_id}&theme=light`);
    await expect(page.locator('.agent-next-step').last()).toBeVisible();
    await appearance('真实保存 Agent ' + state + ' 任务', '.agent-page');
    record.agentHistory.checked.push({ state, covered: true, task: task.id, text: await page.locator('.agent-next-step').last().innerText() });
    if (state === 'blocked') {
      await expect(page.locator('.agent-steps-head').last()).toContainText('已结束');
      await expect(page.getByRole('button', { name: '重试这次提问', exact: true })).toHaveCount(0);
      await page.locator('.agent-thread').evaluate(node => node.scrollTop = node.scrollHeight);
      await page.screenshot({ path: path.join(out, 'agent-blocked-history-light.png') });
      await page.getByRole('button', { name: '在工作台处理', exact: true }).last().click(); await expect(page).not.toHaveURL(/\/agent\?/);
      const endpoint = '**/api/agent/sessions/' + task.id;
      let release, started, delivered;
      const gate = new Promise(resolve => release = resolve), entered = new Promise(resolve => started = resolve), done = new Promise(resolve => delivered = resolve);
      await page.route(endpoint, async route => { try { const response = await route.fetch(); started(); await gate; await route.fulfill({ response }); } finally { delivered(); } });
      record.fixtures.push('任务记录慢网：仅延迟实际宿主响应，不改变任务状态、内容或方案。');
      await go(`/agent?task=${task.id}&workspace=${task.workspace_id}&theme=light`); await entered;
      await expect(page.getByText('正在读取任务记录', { exact: true })).toBeVisible();
      try { await appearance('实际任务记录慢网加载', '.agent-page'); } finally { release(); await done; await page.unroute(endpoint); }
      await expect(page.locator('.agent-next-step').last()).toBeVisible();
      await page.route(endpoint, route => route.abort('internetdisconnected'));
      record.fixtures.push('任务记录断网：仅中断 GET；不制造模型失败任务。');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByText(/任务记录读取失败/)).toBeVisible(); await appearance('任务记录读取断网及重试', '.agent-page');
      await page.unroute(endpoint); await page.getByRole('button', { name: '重新读取任务', exact: true }).click();
      await expect(page.locator('.agent-next-step').last()).toBeVisible();
      record.actions.push({ action: '真实受阻任务回工作台、记录加载与断网重试', task: task.id });
    }
  }
  assert.deepEqual(record.errors, []); assert.deepEqual(record.blocked, []); record.passed = true;
} catch (error) { record.failure = error.stack; process.exitCode = 1; await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); console.error(error); }
finally { record.finished = new Date().toISOString(); await fs.writeFile(path.join(out, process.env.FORMS_REAL_USE_HISTORY_ONLY === '1' ? 'agent-history.json' : 'evidence.json'), JSON.stringify(record, null, 2)); await session.close(); }
console.log(JSON.stringify({ passed: record.passed, variants: record.variants.length, errors: record.errors.length, blocked: record.blocked.length, failure: record.failure?.split('\n')[0] }));
