import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, repositoryRoot } from './browser.mjs';
import { assertLayout } from './layout-assertions.mjs';
import { checkLayout } from '../src/features/type/tests/ui-checks.mjs';
import { identifyText, exceptionFor } from './visible-text-policy.mjs';

assert.equal(process.env.E2E_ISOLATED, '1', '真实使用只能在发布库隔离副本运行');
const base = process.env.FRONTEND_URL, expect = baseExpect.configure({ timeout: 45000 });
const out = path.join(repositoryRoot, '.data/fix-round/shared-shell/real-use');
await fs.mkdir(out, { recursive: true });
const report = { started: new Date().toISOString(), mode: process.env.REAL_USE_MODE || 'all', checks: [], variants: [], tasks: [], errors: [], blocked: [], requests: [], fixtures: [], coreHours: 0 };
const taskNames = new Set((process.env.REAL_USE_TASKS || 'missing-inputs,inbox,type-proposal').split(','));
assert.ok([...taskNames].every(name => ['missing-inputs', 'inbox', 'type-proposal'].includes(name)), '未知真实使用任务');
const session = await openHeadlessBrowser({ executable: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headed: process.env.REAL_USE_HEADED === '1' });
const { page, context } = session;
report.transport = [];
page.on('console', event => { if (event.type() === 'error') report.transport.push({ kind: 'console', text: event.text() }); });
page.on('requestfailed', request => report.transport.push({ kind: 'request', path: new URL(request.url()).pathname, failure: request.failure()?.errorText }));
page.setDefaultTimeout(45000);
page.on('pageerror', error => report.errors.push({ page: page.url(), message: error.message }));
const allowedWrite = (method, url) => {
  const p = new URL(url).pathname;
  return method === 'PUT' && p === '/api/hpc/profile' || method === 'POST' && (
    ['/api/hpc/profile/undo', '/api/hpc/profile/check', '/api/agent/sessions', '/api/plugin-queries/cablesim.standards-basis/lookup'].includes(p)
    || /^\/api\/agent\/sessions\/[0-9a-f-]{36}\/messages$/.test(p)
    || /^\/api\/agent\/proposals\/[0-9a-f-]{36}\/approve$/.test(p)
    || /^\/api\/workspaces\/[0-9a-f-]{36}\/undo$/.test(p)
    || /^\/api\/workspaces\/[0-9a-f-]{36}\/geometry-preview$/.test(p));
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
async function saveReport() { const name = report.mode === 'all' ? 'real-use' : report.mode + (process.env.REAL_USE_TASKS ? '-' + [...taskNames].join('-') : ''); await fs.writeFile(path.join(out, name + '.json'), JSON.stringify(report, null, 2)); }
async function appearance(label, selector, strict = true) {
  for (const width of [1366, 1920]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; for (const node of document.querySelectorAll('[data-theme]')) node.dataset.theme = theme; }, theme);
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
  await page.evaluate(() => { for (const node of document.querySelectorAll('[data-theme]')) node.dataset.theme = 'light'; });
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

async function history() {
  const previous = JSON.parse(await fs.readFile(path.join(out, 'readonly-inbox.json'), 'utf8'));
  const saved = await get('/api/agent/sessions/' + previous.tasks[0].id);
  await go(`/agent?theme=light&task=${saved.id}&workspace=${saved.workspace_id}`);
  const surface = page.locator('.agent-page');
  await expect(surface.locator('.agent-answer')).toContainText('本次读取的统一待办');
  await expect(surface.locator('.agent-question').filter({ hasText: '帮我理一下待办' })).toHaveCount(1);
  await expect(surface.locator('.agent-notice-details')).toBeVisible();
  await expect(surface.locator('.agent-notice-details pre')).not.toBeVisible();
  assert.equal(await surface.locator('.agent-notice-details').getAttribute('open'), null);
  const visibleNotices = await surface.locator('.agent-notice').allTextContents();
  assert.ok(visibleNotices.every(text => !/reasoning_content|request_id|[0-9a-f]{8}-/.test(text)));
  const refs = surface.locator('.agent-ref-details');
  await expect(refs).toBeVisible(); assert.equal(await refs.getAttribute('open'), null);
  const expectedRefs = saved.events.filter(event => event.type === 'chat.message' && event.data.role === 'assistant').at(-1)?.data.object_refs?.length;
  assert.ok(expectedRefs > 4, '真实待办回答应包含多个对象引用');
  await expect(refs.locator('.object-chip')).toHaveCount(expectedRefs);
  await refs.locator('summary').click(); await expect(refs.getByRole('button').or(refs.getByRole('link')).first()).toBeVisible();
  await refs.locator('summary').click(); assert.equal(await refs.getAttribute('open'), null);
  await appearance('真实保存 Agent 失败记录重开，错误详情默认收起', '.agent-page', false);
  await surface.locator('.agent-thread').evaluate(e => e.scrollTop = e.scrollHeight);
  await page.screenshot({ path: path.join(out, 'agent-inbox-history-light.png') });
  report.checks.push('从上一轮真实会话隔离备份重开任务；单次提问、中文错误与默认折叠技术详情均核对；未调用模型');
}

async function agentTask({ name, route, prompt, panel, trigger }) {
  console.log('真实模型任务：' + name); await go(route);
  if (trigger) await trigger();
  const surface = panel ? page.locator('.agent-panel') : page.locator('.agent-page');
  await expect(surface.getByRole('textbox', { name: '给 Agent 的任务' })).toBeVisible();
  await expect(surface.locator('.agent-panel-model')).toContainText('deepseek-flash');
  const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/agent/sessions' && r.request().method() === 'POST');
  const response = page.waitForResponse(r => /\/api\/agent\/sessions\/[^/]+\/messages$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
  void created.catch(() => {}); void response.catch(() => {});
  await surface.getByRole('textbox', { name: '给 Agent 的任务' }).fill(prompt);
  await surface.getByRole('textbox', { name: '给 Agent 的任务' }).press('Enter');
  const id = (await (await created).json()).id;
  await expect(surface.getByRole('button', { name: '停止接收', exact: true })).toBeVisible();
  const waiting = await surface.locator('.agent-steps-head').last().innerText();
  await expect(surface.locator('.agent-question').filter({ hasText: prompt })).toHaveCount(1);
  const timer = setInterval(() => console.log('模型仍在处理：' + name), 30000);
  try {
    const stream = await response; assert.ok(stream.ok(), '消息请求失败：' + stream.status());
    // The user-visible completion is the interface returning to Send; SSE fetch does not owe a Playwright network-finished event.
    await expect(surface.getByRole('button', { name: '发送', exact: true })).toBeVisible({ timeout: 300000 });
    await page.waitForTimeout(1200);
    const record = await get('/api/agent/sessions/' + id);
    const answers = await surface.locator('.agent-answer').allTextContents();
    const notices = await surface.locator('.agent-notice').allTextContents();
    const exposed = [...answers, ...notices].flatMap(text => identifyText(text).filter(hit => !exceptionFor({ ...hit, text, layer: 'ordinary' })).map(hit => ({ ...hit, text, owner: 'Agent' })));
    const item = { name, prompt, id, waiting, state: record.state, waiting_reason: record.waiting_reason, answers, exposed, proposals: record.proposals, budget: record.budget, steps: record.steps.map(step => ({ tool: step.tool, state: step.state, result: step.result?.summary })), notices };
    report.tasks.push(item); await appearance('真实 Agent · ' + name, panel ? '.agent-panel' : '.agent-page', false);
    await surface.locator('.agent-thread').evaluate(e => e.scrollTop = e.scrollHeight);
    await page.screenshot({ path: path.join(out, 'agent-' + name + '-light.png') });
    await saveReport(); return { id, record, surface, item };
  } finally { clearInterval(timer); }
}

async function agents() {
  const status = await get('/api/agent/status'); report.model = status;
  if (!status.configured || status.model !== 'deepseek-flash') { report.agentUnavailable = '隔离平台未能使用已配置 deepseek-flash；没有读取、复制或填写密钥。'; return; }
  const workspaces = await get('/api/workspaces'), types = await get('/api/design/type-workspaces');
  const typeIds = new Set(types.map(t => t.id)), project = workspaces.find(w => !typeIds.has(w.id));
  assert.ok(project, '来源库没有工程');
  const studies = await get('/api/workspaces/' + project.id + '/studies');
  const study = studies.find(s => s.definition.driver.kind === 'single') || studies[0]; assert.ok(study, '来源工程没有研究');
  if (taskNames.has('missing-inputs')) await agentTask({ name: 'missing-inputs', route: `/studies/${study.id}?theme=light&workspace=${project.id}&inspector=agent`, panel: true, prompt: '检查这个研究还缺哪些输入。只检查已保存输入，按影响说明缺项和下一步；不要修改、运行计算或提交作业。' });
  if (taskNames.has('inbox')) await agentTask({ name: 'inbox', route: `/agent?theme=light&workspace=${project.id}`, prompt: '帮我理一下待办' });
  if (!taskNames.has('type-proposal')) return;
  const type = types.find(t => /YJV22/.test(t.name)) || types[0]; assert.ok(type, '来源库没有型号');
  const original = await get('/api/workspaces/' + type.id);
  const cable = original.domain.cable_types[0], core = cable.cores[0], insulation = core.layers.find(l => l.role === 'insulation');
  assert.ok(insulation && Number.isFinite(insulation.thickness), '保存型号未登记绝缘厚度');
  const before = insulation.thickness, nextMm = Number((before * 1000 + 0.1).toFixed(4));
  const task = await agentTask({ name: 'type-proposal', route: `/types/${type.id}/structure/table?theme=light`, panel: true, trigger: async () => { await page.getByRole('tab', { name: 'Agent', exact: true }).click(); }, prompt: `请给「${type.name}」第一芯的绝缘层厚度提出一项修改方案：改为 ${nextMm} mm。只提方案供我批准，不保存、不试算、不运行、不提交作业，保留已有材料和来源。` });
  const proposal = task.record.proposals.find(p => p.status === 'pending');
  if (!proposal) { task.item.approval = { completed: false, reason: '真实模型没有产生可审核方案，未伪造提案或绕过界面保存。' }; return; }
  const card = task.surface.locator('.agent-review-card').filter({ hasText: proposal.title });
  await expect(card).toBeVisible(); await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'type-proposal-light.png') });
  const held = card.getByRole('button', { name: /按住批准/ }); await held.focus();
  const approvedReply = page.waitForResponse(r => new URL(r.url()).pathname === '/api/agent/proposals/' + proposal.id + '/approve');
  await page.keyboard.down('Enter'); await page.waitForTimeout(900); await page.keyboard.up('Enter');
  const reply = await approvedReply;
  if (!reply.ok()) { task.item.approval = { completed: false, reason: await reply.text() }; return; }
  await expect(card).toContainText('已批准');
  const changed = await get('/api/workspaces/' + type.id);
  const changedLayer = changed.domain.cable_types[0].cores[0].layers.find(l => l.id === insulation.id);
  assert.ok(Math.abs(changedLayer.thickness - nextMm / 1000) < 1e-12, '人工批准后真实输入未改变');
  assert.ok(changed.revision > original.revision);
  await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, 'type-approved-light.png') });
  // Leave the text box so Ctrl+Z invokes the ordinary model-history undo.
  await page.locator('.work-panel h1,.app-header h1,h1').first().click();
  const undoneReply = page.waitForResponse(r => new URL(r.url()).pathname === '/api/workspaces/' + type.id + '/undo');
  await page.keyboard.press('Control+z'); assert.ok((await undoneReply).ok(), '型号工作台撤销失败');
  const restored = await get('/api/workspaces/' + type.id);
  assert.equal(restored.domain.cable_types[0].cores[0].layers.find(l => l.id === insulation.id).thickness, before);
  assert.ok(restored.revision > changed.revision, '撤销产生新修订，不倒退编号');
  task.item.approval = { completed: true, beforeMm: before * 1000, proposedMm: nextMm, restoredMm: before * 1000, originalRevision: original.revision, approvedRevision: changed.revision, undoRevision: restored.revision };
  report.checks.push('真实模型型号提案 → 键盘按住人工批准 → 普通工作台 Ctrl+Z 撤销 → API 复读确认输入恢复');
}

try {
  if (report.mode === 'history') await history();
  else if (report.mode === 'readonly') { await readonly(); if (process.env.REAL_USE_TASKS) await agents(); if (process.env.REAL_USE_HISTORY === '1') await history(); }
  else { if (report.mode !== 'agent') await hpc(); await saveReport(); if (report.mode !== 'hpc') await agents(); if (process.env.REAL_USE_HISTORY === '1') await history(); }
  report.finished = new Date().toISOString();
  if (report.errors.length || report.blocked.length || report.agentUnavailable || report.tasks.some(task => ['blocked', 'failed', 'cancelled'].includes(task.state) || task.exposed.length || task.approval && !task.approval.completed) || report.variants.some(v => !v.passed)) process.exitCode = 1;
} catch (error) { report.failure = error.stack; process.exitCode = 1; await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); console.error(error); }
finally { await saveReport(); await session.close(); }
console.log(JSON.stringify({ tasks: report.tasks.length, variants: report.variants.length, errors: report.errors.length, blocked: report.blocked.length, failure: report.failure?.split('\n')[0] }));
