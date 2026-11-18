import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, repositoryRoot } from './browser.mjs';
import { assertLayout } from './layout-assertions.mjs';
import { runOwnerName, runPresentation, scopedRunOrdinals } from '../src/lib/run-presentation.ts';

assert.equal(process.env.E2E_ISOLATED, '1');
const base = process.env.FRONTEND_URL;
const agentOnly = process.env.PUBLIC_MODE === 'agent-decisions';
const out = path.join(repositoryRoot, '.data/fix-round/shared-shell/public-workflows');
await fs.mkdir(out, { recursive: true });
const result = { variants: [], checks: [], errors: [], writes: [], fixtures: agentOnly ? 'Agent 提案审批与保存失败使用响应夹具；记忆纠正和删除另验真实宿主 API' : '状态和记忆交互使用响应夹具；运行与材料及记忆纠正和删除另验真实隔离库 API' };
const browser = await openHeadlessBrowser({ executable: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const { page } = browser;
const expect = baseExpect.configure({ timeout: 30000 });
page.setDefaultTimeout(30000);
page.on('pageerror', error => result.errors.push(error.message));
page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) result.writes.push({ path: new URL(request.url()).pathname, method: request.method() }); });
const get = async url => { const r = await fetch(base + url); assert.ok(r.ok, url + ':' + r.status); return r.json(); };
const sizes = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }];
async function go(url) { await page.goto('about:blank'); await page.goto(base + url, { waitUntil: 'domcontentloaded' }); }
async function layout(label) { await page.evaluate(() => document.fonts.ready); await assertLayout(page, label, { includeFrames: false }); }
async function matrix(url, label, check, prepare) {
  console.log('验收：' + label);
  for (const size of sizes) for (const theme of ['light', 'dark']) {
    await prepare?.(); await page.setViewportSize(size); await go(url + (url.includes('?') ? '&' : '?') + 'theme=' + theme);
    await check(); await layout(label); result.variants.push({ label, ...size, theme });
  }
}
const fail = route => route.fulfill({ status: 503, json: { detail: '验收读取失败，请重试' } });
const stamp = '2026-10-10T12:00:00Z';
const settings = { source: 'settings', base_url: 'https://example.invalid/v1', model: '验收模型', has_key: true, key_source: 'memory', key_storage: 'memory', configured: true, instructions: '', model_timeout_s: null, environment: { base_url: false, model: false, api_key: false } };
const memory = { id: '22222222-2222-4222-8222-222222222222', topic: '回答偏好', kind: 'preference', content: '先给结论，再列来源。', revision: 1, status: 'active', reason: null, updated: stamp, sources: [] };
let memoryMode = 'success', memSettings = { enabled: false, recall_limit: 5, available: true, engineering_evidence: false }, memoryItems = [memory], editMode = 'success', gates = [];
const all = [];
async function route(pattern, fn) { await page.route(pattern, async request => { try { await fn(request); } catch (error) { if (!/already handled|closed|cancelled/i.test(error.message)) throw error; } }); all.push(pattern); }
async function releaseGates() { for (const resolve of gates) resolve(); gates = []; }
const block = () => new Promise(resolve => gates.push(resolve));

try {
  const types = await get('/api/design/type-workspaces'), workspaces = await get('/api/workspaces');
  result.memoryRuntime = await get('/api/agent/memory/settings');
  const typeIds = new Set(types.map(row => row.id));
  if (!agentOnly) {
  const studies = (await Promise.all(workspaces.map(row => get('/api/workspaces/' + row.id + '/studies')))).flat();
  const histories = (await Promise.all(studies.map(async study => {
    const items = []; let after = 0;
    do { const batch = await get(`/api/workspaces/${study.workspace}/studies/${study.id}/runs?view=summary&limit=100&after=${after}`); items.push(...batch.items); after = batch.next_cursor; } while (after != null);
    return items;
  }))).flat();
  const ordinals = scopedRunOrdinals(histories, typeIds);
  await matrix('/runs', '真实运行：对象内编号、型号归属、封存结论', async () => {
    const table = page.getByRole('table', { name: '运行', exact: true }); await expect(table).toBeVisible();
    await expect(page.getByText('正在读取方法与结论', { exact: true })).toHaveCount(0);
    for (const run of histories) {
      const expected = runPresentation(run, ordinals.get(run.id));
      await expect(table.getByRole('link', { name: expected.name, exact: true }).first()).toBeVisible();
      const row = page.locator(`[id="row-运行-${run.id}"]`);
      if (!expected.conclusion) await expect(row.getByRole('link', { name: '查看结果', exact: true })).toBeVisible();
      const type = types.find(type => type.id === run.workspace), study = studies.find(study => study.id === run.study);
      if (type) await expect(row).toContainText(runOwnerName(type.name, study.definition.title));
    }
    await expect(table).not.toContainText('可用结论数'); await expect(table).not.toContainText('不满足项数'); await expect(table).not.toContainText('摘要未提供');
    if (page.viewportSize().width === 1366 && new URL(page.url()).searchParams.get('theme') === 'light') await page.screenshot({ path: path.join(out, 'runs-light.png') });
  });
  await matrix('/resources/materials', '真实材料：发布与物性分别展示', async () => {
    await expect(page.getByRole('table', { name: '材料与部件', exact: true })).toBeVisible();
    await expect(page.locator('.asset-coverage').first()).toBeVisible();
    await expect(page.getByText('物性读取中', { exact: true })).toHaveCount(0);
    const missing = page.locator('.asset-coverage').filter({ hasText: '缺 ' }).first(); await missing.locator('summary').click(); await expect(missing.locator('li').first()).toBeVisible();
    if (page.viewportSize().width === 1366 && new URL(page.url()).searchParams.get('theme') === 'light') await page.screenshot({ path: path.join(out, 'materials-light.png') });
  });
  await page.setViewportSize(sizes[0]); await go('/resources/templates?theme=light'); await page.locator('.resource-scope summary').click(); await expect(page.getByText('正在读取资源', { exact: true })).toHaveCount(0); await layout('真实模板作用域'); await page.screenshot({ path: path.join(out, 'templates-light.png') });
  }
  // 仅在本任务的隔离副本种一条非工程偏好夹具，之后经真实 UI 与 API 纠正、删除；不调用模型抽取。
  const fixtureId = '44444444-4444-4444-8444-444444444444';
  const python = process.env.PYTHON || path.join(repositoryRoot, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  await promisify(execFile)(python, ['-c', "import sqlite3,sys;from pathlib import Path;p=Path(sys.argv[1]).resolve();assert 'frontend-e2e' in p.parts and '.tmp' in p.parts;db=sqlite3.connect(p);db.execute('INSERT INTO agent_memories(id,workspace_id,study_id,workspace_revision,study_revision,kind,topic,content,sources,methods,revision,status,created,updated) VALUES(?,?,NULL,NULL,NULL,?,?,?,?,?,1,?,?,?)',(sys.argv[2],sys.argv[3],'preference','浏览器验收偏好','先给结论，再列来源。','[]','[]','active',sys.argv[4],sys.argv[4]));db.commit();db.close()", process.env.CABLESIM_DB, fixtureId, workspaces[0].id, stamp], { windowsHide: true });
  await page.setViewportSize(sizes[0]); await go('/settings?section=ai&theme=light'); await page.locator('.memory-management > summary').click();
  const realMemory = page.locator('.memory-item').filter({ hasText: '浏览器验收偏好' }); await expect(realMemory).toBeVisible();
  await realMemory.getByRole('button', { name: '纠正', exact: true }).click(); await realMemory.getByRole('textbox', { name: '纠正内容' }).fill('先给结论，并核对原始来源。'); await realMemory.getByRole('button', { name: '保存纠正', exact: true }).click();
  await expect(realMemory.locator('.memory-editor')).toHaveCount(0); await expect(realMemory.locator('p').filter({ hasText: '先给结论，并核对原始来源。' }).first()).toBeVisible();
  const stored = await get('/api/agent/memories?workspace_id=' + workspaces[0].id); const corrected = stored.items.find(item => item.id === fixtureId); assert.equal(corrected.content, '先给结论，并核对原始来源。'); assert.equal(corrected.revision, 2);
  await expect(page.getByRole('combobox', { name: '研究范围', exact: true })).toBeEnabled(); await layout('真实记忆纠正'); await page.screenshot({ path: path.join(out, 'memory-light.png') });
  await realMemory.getByRole('button', { name: '删除', exact: true }).click(); await realMemory.getByRole('button', { name: '确认删除', exact: true }).click(); await expect(realMemory).toHaveCount(0); assert.equal((await get('/api/agent/memories?workspace_id=' + workspaces[0].id)).items.some(item => item.id === fixtureId), false);
  result.checks.push('真实宿主 API 纠正与删除非工程记忆夹具，复读确认修订 2 与删除生效；未调用模型抽取');
  await go('/agent?theme=light'); await expect(page.locator('.agent-scope-chip')).toContainText(workspaces.find(row => !typeIds.has(row.id)).name); await layout('真实 Agent 空任务'); await page.screenshot({ path: path.join(out, 'agent-light.png') });
  await route('**/api/agent/settings', r => r.fulfill({ json: settings }));
  await route('**/api/agent/status', r => r.fulfill({ json: { configured: true, model: '验收模型', tools: 8 } }));
  await route('**/api/agent/memory/settings', async r => {
    if (memoryMode === 'loading') await block();
    if (memoryMode === 'error') return fail(r);
    if (r.request().method() === 'PUT') { memSettings = { ...memSettings, ...r.request().postDataJSON() }; }
    return r.fulfill({ json: { ...memSettings, available: memoryMode !== 'dependency' } });
  });
  await route('**/api/agent/memories?*', async r => {
    if (memoryMode === 'loading') await block(); if (memoryMode === 'error') return fail(r);
    return r.fulfill({ json: { items: memoryMode === 'empty' ? [] : memoryItems.map(item => memoryMode === 'historical' ? { ...item, status: 'outdated', reason: '输入修订已变化' } : item), total: memoryMode === 'empty' ? 0 : memoryItems.length } });
  });
  await route('**/api/agent/memories/*', async r => {
    if (editMode === 'conflict') return r.fulfill({ status: 409, json: { detail: '记忆已被修改，请重新读取后再操作' } });
    const expected = r.request().method() === 'PUT' ? r.request().postDataJSON().expected_revision : Number(new URL(r.request().url()).searchParams.get('expected_revision'));
    assert.equal(expected, memoryItems[0].revision);
    if (r.request().method() === 'DELETE') { memoryItems = []; return r.fulfill({ json: { ...memory, status: 'deleted', content: '' } }); }
    const item = { ...memoryItems[0], content: r.request().postDataJSON().content, revision: expected + 1, status: 'corrected' }; memoryItems = [item]; return r.fulfill({ json: item });
  });
  if (!agentOnly) {
  for (const state of ['empty', 'loading', 'error', 'success', 'historical']) {
    memoryMode = state;
    await matrix('/settings?section=ai', '记忆 ' + state, async () => {
      if (state === 'loading') await expect(page.getByText('正在读取记忆设置', { exact: true })).toBeVisible();
      else if (state === 'error') await expect(page.getByText('记忆设置读取失败', { exact: true })).toBeVisible();
      else await expect(page.getByRole('switch', { name: '启用长期记忆' })).toBeVisible();
      await page.locator('.memory-management > summary').click();
      if (state === 'loading') await expect(page.getByText('正在读取记忆', { exact: true })).toBeVisible();
      else if (state === 'error') await expect(page.getByText('记忆读取失败', { exact: true })).toBeVisible();
      else if (state === 'empty') await expect(page.getByText('此范围还没有记忆。', { exact: true })).toBeVisible();
      else { await expect(page.getByText(memory.content, { exact: true })).toBeVisible(); if (state === 'historical') await expect(page.locator('[data-memory-status=outdated]')).toBeVisible(); }
      await page.locator('.settings-memory').scrollIntoViewIfNeeded();
    }); await releaseGates();
  }
  memoryMode = 'dependency'; await matrix('/settings?section=ai', '记忆依赖缺失', async () => { await expect(page.getByText('需要先安装依赖', { exact: true })).toBeVisible(); await expect(page.getByRole('switch', { name: '启用长期记忆' })).toBeDisabled(); });
  memoryMode = 'success';
  await matrix('/settings?section=ai', '记忆开关、纠正冲突、保存、删除', async () => {
    const toggle = page.getByRole('switch', { name: '启用长期记忆' }); const before = await toggle.getAttribute('aria-checked'); await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
    await page.locator('.memory-management > summary').click(); await page.getByRole('button', { name: '纠正', exact: true }).click();
    await page.getByRole('textbox', { name: '纠正内容' }).fill('先给结论，并核对真实来源。');
    editMode = 'conflict'; await page.getByRole('button', { name: '保存纠正', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: '记忆已被修改' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '纠正内容' })).toHaveValue('先给结论，并核对真实来源。');
    editMode = 'success'; await page.getByRole('textbox', { name: '纠正内容' }).press('Control+s'); await expect(page.getByText('先给结论，并核对真实来源。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '删除', exact: true }).click(); await expect(page.getByRole('button', { name: '确认删除', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click(); await expect(page.getByText('先给结论，并核对真实来源。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '删除', exact: true }).click(); await page.getByRole('button', { name: '确认删除', exact: true }).click(); await expect(page.getByText('此范围还没有记忆。', { exact: true })).toBeVisible();
  }, () => { memoryItems = [{ ...memory }]; });
  }
  if (agentOnly) await matrix('/settings?section=ai', '记忆筛选标签与控件对齐', async () => {
    await page.locator('.memory-management > summary').click(); await expect(page.locator('.memory-item')).toBeVisible();
    const label = await page.locator('.memory-filters .search-field').evaluate(node => { const text = node.firstChild, range = document.createRange(); range.selectNode(text); return range.getBoundingClientRect().height; });
    assert.ok(label <= 24, '检索标签不应折成两行');
    await page.locator('.memory-filters').scrollIntoViewIfNeeded();
  });

  const wid = workspaces.find(row => !typeIds.has(row.id)).id, taskId = '33333333-3333-4333-8333-333333333333';
  let agentMode = 'empty';
  let decisionWrites = 0, releaseDecision;
  await route('**/api/agent/proposals/proposal-fixture/approve', async r => { decisionWrites++; await new Promise(resolve => releaseDecision = resolve); return r.fulfill({ status: 503, json: { detail: '验收保存失败，请重试' } }); });
  await route('**/api/agent/sessions?*', r => r.fulfill({ json: agentMode === 'empty' ? [] : [{ id: taskId, workspace_id: wid, study_id: null, state: agentMode === 'success' ? 'reviewing' : 'completed', title: '验收任务', pending_proposals: agentMode === 'success' ? 1 : 0, created: stamp, updated: stamp }] }));
  await route('**/api/agent/sessions', r => r.fulfill({ json: agentMode === 'empty' ? [] : [{ id: taskId, workspace_id: wid, study_id: null, state: 'completed', title: '验收任务', pending_proposals: 0, created: stamp, updated: stamp }] }));
  await route('**/api/agent/sessions/' + taskId, async r => {
    if (agentMode === 'loading') await block(); if (agentMode === 'error') return fail(r);
    const approved = agentMode === 'historical', proposal = { id: 'proposal-fixture', title: '核对后保存说明', base_revision: 2, changes: [{ path: '/description', label: '说明', before: '原说明', after: '修订说明' }], checks: ['只保存输入'], status: approved ? 'approved' : 'pending' };
    const events = [{ sequence: 1, type: 'chat.message', created: stamp, data: { role: 'user', content: '核对工程说明' } }, { sequence: 2, type: 'tool.call', created: stamp, data: { id: 'proposal-step', tool: 'domain_propose', title: '准备方案' } }, { sequence: 3, type: 'tool.result', created: stamp, data: { id: 'proposal-step', status: 'ok', summary: '已准备方案' } }, { sequence: 4, type: 'chat.message', created: stamp, data: { role: 'assistant', content: '方案已列在右侧。' } }, { sequence: 5, type: 'task.state', created: stamp, data: { state: 'completed' } }];
    if (approved) events.push({ sequence: 6, type: 'proposal.decision', created: stamp, data: { id: proposal.id, status: 'approved', actor: '验收工程师', engineering_approval: false } });
    return r.fulfill({ json: { id: taskId, workspace_id: wid, state: 'completed', proposals: [proposal], events, steps: [{ node_id: 'proposal-step', tool: 'domain_propose', arguments: {}, elapsed_ms: 1, result: { status: 'ok', summary: '', data: { proposal } } }] } });
  });
  for (const state of agentOnly ? ['success'] : ['empty', 'loading', 'error', 'success', 'historical']) {
    agentMode = state; await matrix('/agent' + (state === 'empty' ? '' : '?task=' + taskId), 'Agent ' + state, async () => {
      if (state === 'loading') await expect(page.getByText('正在读取任务记录', { exact: true })).toBeVisible();
      else if (state === 'error') await expect(page.getByRole('button', { name: '重新读取任务', exact: true })).toBeVisible();
      else if (state === 'empty') await expect(page.getByText('暂无待审核方案', { exact: true })).toBeVisible();
      else { await expect(page.locator('.agent-review-card')).toBeVisible(); await expect(page.getByText('基于第 2 修订', { exact: true })).toBeVisible(); if (state === 'historical') await expect(page.locator('.agent-review-card')).toContainText('验收工程师'); }
      await expect(page.locator('.agent-policy')).toHaveCount(1); const summary = page.locator('.agent-policy summary'); await summary.focus(); await summary.press('Enter'); await expect(page.locator('.agent-policy')).toHaveAttribute('open', '');
      if (agentOnly) {
        const hold = page.locator('.agent-review-card .agent-hold'), before = decisionWrites;
        await hold.focus(); await page.keyboard.down('Enter'); await page.keyboard.press('Escape'); await page.keyboard.up('Enter'); await page.waitForTimeout(900); assert.equal(decisionWrites, before, 'Esc 应取消按住批准');
        await hold.focus(); await page.keyboard.down('Enter'); await summary.focus(); await page.keyboard.up('Enter'); await page.waitForTimeout(900); assert.equal(decisionWrites, before, '失去焦点应取消按住批准');
        await hold.focus(); await page.keyboard.down('Enter'); await expect.poll(() => decisionWrites).toBe(before + 1); await expect(hold).toBeDisabled(); await page.keyboard.up('Enter');
        releaseDecision(); await expect(page.getByRole('alert').filter({ hasText: '验收保存失败' })).toBeVisible(); await expect(hold).toBeEnabled(); assert.equal(decisionWrites, before + 1);
        await expect(page.locator('.agent-review-card')).toHaveClass(/is-pending/); await expect(page.locator('.agent-review-card')).not.toContainText('已批准');
      }
      const contrast = await page.locator('.prompt-bar textarea').evaluate(node => { const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number); const lum = values => values.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0); const a = lum(rgb(getComputedStyle(node, '::placeholder').color)), b = lum(rgb(getComputedStyle(node.closest('.prompt-bar-box')).backgroundColor)); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }); assert.ok(contrast >= 4.5, '输入提示对比度');
    }); await releaseGates();
  }

  let assetMode = 'success', resourceGroup = 'materials'; const asset = { id: 'asset-fixture', name: '验收材料', kind: 'material', status: 'published', version: '1.0.0', updated: stamp };
  const source = value => ({ reference: JSON.stringify({ schema: 'cablesim.reference-data/1', ...value }) });
  await route('**/api/foundation/assets?*', async r => {
    if (assetMode === 'loading') await block(); if (assetMode === 'error') return fail(r);
    const kind = new URL(r.request().url()).searchParams.get('kind'); const selected = resourceGroup === 'materials' ? kind === 'material' : kind === 'installation';
    const items = assetMode === 'empty' || !selected ? [] : [{ ...asset, kind: resourceGroup === 'materials' ? 'material' : 'installation', status: assetMode === 'historical' ? 'deprecated' : 'published' }]; return r.fulfill({ json: { items, total: items.length } });
  });
  await route('**/api/foundation/assets/asset-fixture', r => r.fulfill({ json: { ...asset, release: { sources: [source({ property: 'density', value: 8900, unit: 'kg/m3' }), source({ missing: ['thermal_resistivity'], reason: '资料未提供该用途的值' })], parameters: [] } } }));
  if (!agentOnly) for (const group of ['materials', 'templates']) for (const state of ['empty', 'loading', 'error', 'success', 'historical']) {
    resourceGroup = group; assetMode = state;
    await matrix('/resources/' + group, group + ' ' + state, async () => {
      if (state === 'loading') await expect(page.getByText('正在读取资源', { exact: true })).toBeVisible();
      else if (state === 'error') await expect(page.getByRole('button', { name: '重新读取', exact: true })).toBeVisible();
      else if (state === 'empty') await expect(page.locator('.state-inline').filter({ hasText: '还没有' })).toBeVisible();
      else { await expect(page.getByRole('table')).toBeVisible(); if (group === 'materials') { const summary = page.locator('.asset-coverage summary'); await expect(summary).toContainText('物性 1/2'); await summary.focus(); await summary.press('Enter'); await expect(page.locator('.asset-coverage li')).toContainText('热阻率'); } if (state === 'historical') await expect(page.getByRole('table')).toContainText('已停用'); }
      await page.locator('.resource-scope summary').click(); await expect(page.locator('.resource-scope')).toHaveAttribute('open', '');
      if (group === 'templates') await expect(page.locator('.resource-scope')).toContainText('发布新资源版本不会自动替换既有引用');
    }); await releaseGates();
  }
  result.checks.push(agentOnly ? '按住批准：Esc/失焦取消、提交中禁用、失败仍未批准且可重试；记忆筛选标签不换行；两尺寸深浅主题' : '真实隔离库运行身份与型号归属；材料缺项；记忆关闭/依赖缺失/开关与修订冲突/纠正/删除；Agent服务端审批回执字段投影（响应夹具）；模板影响范围；五态、两尺寸、深浅主题、字号/对比度/边界');
  assert.deepEqual(result.errors, []);
} catch (error) { result.failure = String(error.stack || error); process.exitCode = 1; console.error(result.failure); }
finally { await releaseGates(); for (const pattern of all) await page.unroute(pattern); await fs.writeFile(path.join(out, agentOnly ? 'agent-decisions-verification.json' : 'verification.json'), JSON.stringify(result, null, 2)); await browser.close(); }
