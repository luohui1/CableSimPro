import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, repositoryRoot } from './browser.mjs';
import { assertLayout } from './layout-assertions.mjs';
import { checkLayout } from '../src/features/type/tests/ui-checks.mjs';

assert.equal(process.env.E2E_ISOLATED, '1', '真实使用只能在发布库隔离副本运行');
const base = process.env.FRONTEND_URL, expect = baseExpect.configure({ timeout: 45000 });
// Agent conversations and approvals are verified by: cd studio && npm run walk:fusion.
const mode = process.env.REAL_USE_MODE || 'all';
assert.ok(['all', 'hpc', 'readonly'].includes(mode), '本脚本只验工作台与超算配置；Agent 场景已迁移，请运行 cd studio && npm run walk:fusion。');
assert.ok(process.env.REAL_USE_PHASE !== 'agent-real-use' && !process.env.REAL_USE_TASKS
  && !['REAL_USE_HISTORY', 'REAL_USE_RESUME_MISSING', 'REAL_USE_RESUME_TASKS'].some(name => process.env[name] === '1'),
'旧 Agent 专用模式已移除，请运行 cd studio && npm run walk:fusion；真实模型验收另行记录。');
const out = path.join(repositoryRoot, '.data/fix-round/shared-shell/real-use');
await fs.mkdir(out, { recursive: true });
const report = { started: new Date().toISOString(), mode, checks: [], variants: [], errors: [], blocked: [], requests: [], fixtures: [], coreHours: 0, agentVerification: 'cd studio && npm run walk:fusion（脚本化模型、真实平台；真实模型另验）' };
const session = await openHeadlessBrowser({ executable: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headed: process.env.REAL_USE_HEADED === '1' });
const { page, context } = session;
report.transport = [];
page.on('console', event => { if (event.type() === 'error') report.transport.push({ kind: 'console', text: event.text() }); });
page.on('requestfailed', request => report.transport.push({ kind: 'request', path: new URL(request.url()).pathname, failure: request.failure()?.errorText }));
page.setDefaultTimeout(45000);
page.on('pageerror', error => report.errors.push({ page: page.url(), message: error.message }));
const allowedWrite = (method, url) => {
  const p = new URL(url).pathname;
  return method === 'PUT' && p === '/api/hpc/profile' || method === 'POST' && ['/api/hpc/profile/undo', '/api/hpc/profile/check'].includes(p);
};
await context.route('**/api/**', route => {
  const request = route.request();
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || allowedWrite(request.method(), request.url())) return route.fallback();
  report.blocked.push({ method: request.method(), path: new URL(request.url()).pathname });
  return route.fulfill({ status: 403, json: { detail: '本次真实使用不运行求解器、提交作业或改模型设置。' } });
});
page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) report.requests.push({ method: request.method(), path: new URL(request.url()).pathname }); });
const get = async url => { const response = await fetch(base + url, { signal: AbortSignal.timeout(60000) }); assert.ok(response.ok, url + ':' + response.status); return response.json(); };
async function go(url) { await page.goto(base + url, { waitUntil: 'domcontentloaded' }); await page.locator('.app-shell').waitFor({ state: 'visible' }); await page.evaluate(() => document.fonts.ready); }
async function saveReport() { const name = report.mode === 'all' ? 'real-use' : report.mode; await fs.writeFile(path.join(out, name + '.json'), JSON.stringify(report, null, 2)); }
async function setTheme(theme) {
  if (await page.locator('html').getAttribute('data-theme') === theme) return;
  await page.locator('.sidebar-foot').getByRole('button').click();
  await page.getByRole('menuitem', { name: theme === 'dark' ? '切换深色模式' : '切换浅色模式', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.evaluate(() => document.fonts.ready);
}
async function appearance(label, selector, strict = true) {
  for (const width of [1366, 1920]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
    await setTheme(theme);
    await page.waitForTimeout(100);
    try {
      await page.evaluate(() => document.fonts.ready);
      await checkLayout(page, selector);
      if (strict) await assertLayout(page, label, { includeFrames: false });
      if (selector === '.hpc-connection') {
        const formLayout = await page.locator('.hpc-connection').evaluate(card => ({
          wrappedUnits: [...card.querySelectorAll('.settings-inline > span')].filter(node => node.getBoundingClientRect().height > parseFloat(getComputedStyle(node).lineHeight) + 1).map(node => node.textContent),
          unevenRows: [...card.querySelectorAll('.settings-form-pair')].flatMap(pair => { const controls = [...pair.querySelectorAll('input,[role=combobox]')]; return controls.length === 2 && Math.abs(controls[0].getBoundingClientRect().top - controls[1].getBoundingClientRect().top) > 1 ? [controls.map(node => node.id)] : []; }),
          dimmedReadonly: card.dataset.editable === 'false' ? [...card.querySelectorAll('input,[role=combobox]')].filter(node => node.getBoundingClientRect().width > 1 && Number(getComputedStyle(node).opacity) < 1).map(node => node.id) : [],
        }));
        assert.deepEqual(formLayout.wrappedUnits, [], '预算单位应保持一行'); assert.deepEqual(formLayout.unevenRows, [], '同一行连接字段应对齐');
        assert.deepEqual(formLayout.dimmedReadonly, [], '只读配置数值仍需保持可读');
      }
      report.variants.push({ label, width, theme, passed: true });
    } catch (error) { report.variants.push({ label, width, theme, passed: false, error: error.message }); if (strict) throw error; }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await setTheme('light');
}
async function hpc() {
  console.log('真实使用：超算配置保存、连接检查与撤销');
  const input = JSON.parse(process.env.E2E_HPC_INPUT);
  await go('/settings/compute?theme=light');
  const card = page.getByRole('region', { name: '超算连接', exact: true });
  await expect(card.getByRole('combobox', { name: 'SSH 别名' })).toBeEnabled();
  const initial = await get('/api/hpc/profile/configuration');
  assert.equal(initial.configured, false); assert.equal(initial.editable, true);
  assert.ok(initial.ssh_aliases.includes('dghpc'), '真实本机 SSH 配置必须存在 dghpc');
  await appearance('真实超算未配置', '.hpc-connection');
  await card.getByRole('combobox', { name: 'SSH 别名' }).click(); await page.getByRole('option', { name: 'dghpc', exact: true }).click();
  await card.getByLabel('分区', { exact: true }).fill(input.partition);
  await card.getByLabel('远程工作目录', { exact: true }).fill('/invalid/../directory');
  await card.getByRole('combobox', { name: '环境', exact: true }).click(); await page.getByRole('option', { name: input.environment.kind === 'conda' ? 'Conda' : 'Python', exact: true }).click();
  await card.getByLabel('环境目录', { exact: true }).fill(input.environment.path);
  await card.getByLabel('单批核时预算', { exact: true }).fill(String(input.budget_core_hours));
  await card.getByLabel('累计核时预算', { exact: true }).fill(String(input.total_budget_core_hours));
  const invalidReply = page.waitForResponse(r => new URL(r.url()).pathname === '/api/hpc/profile' && r.request().method() === 'PUT');
  await card.getByRole('button', { name: '保存连接', exact: true }).click(); assert.equal((await invalidReply).status(), 422);
  await expect(card.locator('#hpc-directory-error')).toContainText('绝对路径');
  await expect(card.getByLabel('远程工作目录', { exact: true })).toBeFocused();
  assert.equal((await get('/api/hpc/profile/configuration')).configured, false);
  await appearance('真实错误路径就地拒绝，未保存', '.hpc-connection');
  await card.getByLabel('远程工作目录', { exact: true }).fill(input.remote_workdir);
  const savedReply = page.waitForResponse(r => new URL(r.url()).pathname === '/api/hpc/profile' && r.request().method() === 'PUT');
  await card.getByLabel('环境目录', { exact: true }).press('Control+s');
  const saved = await (await savedReply).json();
  await expect(card.getByText('已保存 · 未检查连接', { exact: true })).toBeVisible();
  assert.equal(saved.connection_checked, false); assert.ok(saved.undo_token);
  const reread = await get('/api/hpc/profile/configuration'); assert.equal(reread.configuration.ssh_alias, 'dghpc'); assert.equal(reread.configuration.remote_workdir, input.remote_workdir);
  assert.equal(report.requests.filter(r => r.path === '/api/hpc/profile/check').length, 0, '加载和保存不得自动测试连接');
  await appearance('真实超算配置已保存，尚未检查', '.hpc-connection');
  const failedCheck = '**/api/hpc/profile/check';
  await page.route(failedCheck, route => route.abort('internetdisconnected'));
  await card.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(card.locator('.field-error')).toBeVisible();
  assert.equal((await get('/api/hpc/profile/configuration')).configured, true, '连接断网不丢保存配置');
  report.fixtures.push('连接检查断网：仅中断请求；实际已保存配置仍在，不伪造连接结果。');
  await appearance('连接检查断网，已保存配置保留', '.hpc-connection');
  await page.unroute(failedCheck);
  await card.getByLabel('分区', { exact: true }).fill(input.partition + '-editing');
  await expect(card.locator('.field-error')).toHaveCount(0);
  await card.getByLabel('分区', { exact: true }).press('Escape');
  await expect(card.getByLabel('分区', { exact: true })).toHaveValue(input.partition);
  const checkReply = page.waitForResponse(r => new URL(r.url()).pathname === '/api/hpc/profile/check');
  await card.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(card.getByText('正在检查连接、分区、目录和环境…', { exact: true })).toBeVisible();
  report.checks.push('真实连接请求期间显示等待状态；重复点击、保存和撤销被禁用');
  await expect(card.getByRole('button', { name: '保存连接', exact: true })).toBeDisabled();
  const check = await (await checkReply).json();
  await expect(card.locator('.hpc-check-result')).toBeVisible();
  report.hpc = { input, before: { configured: initial.configured }, saved: { configured: saved.configured, connection_checked: saved.connection_checked }, check };
  await saveReport();
  await appearance('真实 SSH 连接检查结果', '.hpc-connection');
  await card.locator('.hpc-check-result').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'compute-light.png') });
  if (process.env.REAL_USE_AUDIT_CONFIGURATION === '1') {
    process.env.VISIBLE_TEXT_PASS = 'real-use-config'; process.env.VISIBLE_TEXT_PATHS = '/settings/compute';
    await import('./verify-visible-text.mjs');
  }
  await card.getByLabel('分区', { exact: true }).fill(input.partition + '-editing');
  await expect(card.locator('.hpc-check-result')).toHaveCount(0);
  await card.getByLabel('分区', { exact: true }).press('Escape');
  await card.getByRole('button', { name: '撤销这次修改', exact: true }).click();
  await expect(card.getByText('已撤销这次修改 · 超算未配置', { exact: true })).toBeVisible();
  assert.equal((await get('/api/hpc/profile/configuration')).configured, false);
  await appearance('真实撤销后恢复为未配置', '.hpc-connection');
  report.checks.push('超算保存、真实 dghpc 连接检查、撤销均从界面执行；复读确认恢复未配置；无作业提交');
  // A slow or broken transport is the only simulated part: payloads remain actual host responses.
  const pattern = '**/api/hpc/profile/configuration';
  let release, entered, delivered;
  const started = new Promise(resolve => entered = resolve), gate = new Promise(resolve => release = resolve), done = new Promise(resolve => delivered = resolve);
  await page.route(pattern, async route => { try { const response = await route.fetch(); entered(); await gate; await route.fulfill({ response }); } finally { delivered(); } });
  report.fixtures.push('慢网：真实 configuration 响应仅延迟送达，不替换字段或配置。');
  await page.reload({ waitUntil: 'domcontentloaded' }); await started;
  await expect(page.getByText('正在读取超算连接', { exact: true })).toBeVisible();
  try { await appearance('慢网加载（真实响应延迟）', '.hpc-connection'); } finally { release(); await done; await page.unroute(pattern); }
  await expect(page.getByRole('combobox', { name: 'SSH 别名' })).toBeEnabled();
  await page.route(pattern, route => route.abort('internetdisconnected'));
  report.fixtures.push('断网：只中断 configuration 请求；未伪造错误响应或工程对象。');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('超算连接读取失败', { exact: true })).toBeVisible();
  await appearance('连接配置读取断网与重试', '.hpc-connection');
  await page.unroute(pattern); await page.getByRole('button', { name: '重新读取', exact: true }).press('Enter');
  await expect(page.getByRole('combobox', { name: 'SSH 别名' })).toBeEnabled();
}

async function readonly() {
  await go('/settings/compute?theme=light');
  const data = await get('/api/hpc/profile/configuration'); assert.equal(data.editable, false);
  report.readonlyConfiguration = data;
  const card = page.getByRole('region', { name: '超算连接', exact: true });
  await expect(card.getByText('管理员已指定外部配置文件，本页只读。请联系管理员修改连接参数。', { exact: true })).toBeVisible();
  await expect(card.getByRole('combobox', { name: 'SSH 别名' })).toBeDisabled();
  await expect(card.getByText('修改未保存', { exact: true })).toHaveCount(0);
  if (data.configuration?.ssh_alias) await expect(card.getByRole('combobox', { name: 'SSH 别名' })).toContainText(data.configuration.ssh_alias);
  await expect(card.getByText('先保存修改，再检查连接。', { exact: true })).toHaveCount(0);
  await expect(card.getByRole('button', { name: '保存连接', exact: true })).toHaveCount(0);
  await appearance('真实外部配置只读部署', '.hpc-connection');
  await page.screenshot({ path: path.join(out, 'compute-readonly-light.png') });
  assert.equal(report.requests.some(r => r.path === '/api/hpc/profile/check' || r.path === '/api/hpc/profile'), false);
  report.checks.push('隔离平台指向真实配置文件的独立副本，实际 editable=false；没有保存或连接检查请求');
}

try {
  if (report.mode === 'readonly') await readonly();
  else await hpc();
  report.finished = new Date().toISOString();
  if (report.errors.length || report.blocked.length || report.variants.some(v => !v.passed)) process.exitCode = 1;
} catch (error) { report.failure = error.stack; process.exitCode = 1; await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); console.error(error); }
finally { await saveReport(); await session.close(); }
console.log(JSON.stringify({ agentVerification: report.agentVerification, variants: report.variants.length, errors: report.errors.length, blocked: report.blocked.length, failure: report.failure?.split('\n')[0] }));
