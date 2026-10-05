import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, settle, outputRoot } from './browser.mjs';
import { request } from './research-fixtures.mjs';

if (process.env.E2E_ISOLATED !== '1') throw Error('Requires isolated database');
const base = process.env.FRONTEND_URL, expect = baseExpect.configure({ timeout: 25000 });
const session = await openHeadlessBrowser(), { page, context } = session;
const out = path.join(outputRoot, 'type-resilience'), report = { checks: [], errors: [], injected: 'Only request failures and lifecycle states; no solver values or production approvals' };
await fs.mkdir(out, { recursive: true }); page.on('pageerror', e => report.errors.push(e.message));
async function go(route) { await page.goto('about:blank'); await page.goto(base + route); await settle(page); }
const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
try {
  const chosen = {};
  for (const type of await request(base, '/api/design/type-workspaces')) {
    for (const study of await request(base, `/api/workspaces/${type.id}/studies`)) {
      const module = study.definition.driver?.kind === 'batch' && study.definition.driver.cases?.some(c => c.metadata?.kind === 'type-rating-table') ? 'rating-table' : study.definition.method.capability;
      if (!['rating-table', 'electrical', 'short-circuit'].includes(module) || chosen[module]) continue;
      const runs = (await request(base, `/api/workspaces/${type.id}/studies/${study.id}/runs`)).items;
      if (runs.some(r => r.integrity === 'verified' && ['succeeded', 'partial'].includes(r.status))) chosen[module] = { wid: type.id, study, runs };
    }
  }
  assert.ok(chosen['rating-table'], 'Requires saved rating evidence'); assert.ok(chosen.electrical, 'Requires saved electrical evidence');
  for (const module of ['rating-table', 'electrical', 'short-circuit'].filter(m => chosen[m])) {
    const { wid, study, runs } = chosen[module], label = module === 'rating-table' ? '计算所选工况' : '按保存条件重算' + (module === 'electrical' ? '电气参数' : '短路容量');
    // Saved inputs/results are real. Isolate submission transport so this test never starts a solver.
    await context.route(`**/api/workspaces/${wid}/studies`, route => route.request().method() === 'POST' ? route.fulfill(json(study)) : route.continue());
    if (module === 'rating-table') await context.route(`**/api/design/workspaces/${wid}/rating-table-definition`, route => route.fulfill(json(study.definition)));
    await context.route(`**/api/workspaces/${wid}/studies/${study.id}/preflight?*`, route => route.fulfill(json({ ready: true, lock_digest: 'isolated-transport-check', cases: [], limitations: ['隔离界面传输验收，不执行计算'] })));
    const url = `/types/${wid}/${module}/results`, mask = `**/api/workspaces/${wid}/studies/${study.id}/runs`;
    await go(url); const table = page.getByRole('table', { name: module === 'rating-table' ? '载流量表' : module === 'electrical' ? '电气参数' : '短路容量', exact: true });
    await expect(table).toBeVisible(); const original = await table.innerText();
    if (module === 'rating-table') {
      const count = await table.locator('tbody tr.data-row').count();
      await page.locator('.type-rating-edit summary').click(); await page.getByRole('button', { name: '删除工况', exact: true }).click();
      await expect(table.locator('tbody tr.data-row')).toHaveCount(count - 1);
      await page.locator('.type-rating-edit summary').focus(); await page.keyboard.press('Control+z');
      await expect(table.locator('tbody tr.data-row')).toHaveCount(count);
      report.checks.push('删除工况与模块撤销恢复完整列表，尚未写入宿主');
    }
    async function prepare() { await page.getByRole('button', { name: label, exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('checkbox', { name: '已核对输入来源与方法适用范围', exact: true }).check(); }
    for (const code of ['PLUGIN_TIMEOUT', 'PROCESS_FAILED', 'ENVIRONMENT_MISSING']) {
      await context.route(mask, route => route.request().method() === 'POST' ? route.fulfill(json({ status: 'failed', error: { code, message: code + ' · 隔离故障' } })) : route.continue());
      await prepare(); await page.getByRole('button', { name: '确认并运行', exact: true }).click();
      await expect(page.locator('[role=alert]')).toContainText(code); await page.keyboard.press('Escape'); await expect(table).toHaveText(original, { useInnerText: true });
      await context.unroute(mask);
    }
    const sent = []; let release;
    const gate = new Promise(resolve => release = resolve);
    await context.route(mask, async route => { if (route.request().method() !== 'POST') return route.continue(); sent.push(route.request().postDataJSON()); if (sent.length === 1) { await gate; return route.abort('failed'); } return route.fulfill(json({ status: 'failed', error: { code: 'PROCESS_FAILED', message: '同一请求重放已响应' } })); });
    await prepare(); await page.getByRole('button', { name: '确认并运行', exact: true }).evaluate(button => { button.click(); button.click(); });
    await expect.poll(() => sent.length).toBe(1); release(); await expect(page.locator('[role=alert]')).toBeVisible();
    await page.reload(); await expect(page.getByRole('button', { name: '查询同一运行', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '查询同一运行', exact: true }).click(); await expect(page.locator('[role=alert]')).toContainText('同一请求重放已响应');
    assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]); await expect(table).toHaveText(original, { useInnerText: true });
    assert.deepEqual((await request(base, `/api/workspaces/${wid}/studies/${study.id}/runs`)).items, runs);
    report.checks.push(module + '：三类执行失败保留真实表格；重复点击仅一请求；断网重载复用完整请求与编号；未写入新运行');
    await context.unrouteAll({ behavior: 'wait' });
  }
  // Isolated response states exercise the human gate without approving a real engineering version.
  const { wid } = chosen['rating-table'], originalSpec = await request(base, `/api/types/${wid}/specification?audience=customer`), workspace = await request(base, `/api/workspaces/${wid}`);
  let status = 'submitted'; const writes = [];
  await context.route(`**/api/types/${wid}/specification?*`, route => route.fulfill(json({ ...originalSpec, ready: true, payload: { ...originalSpec.payload, sources: originalSpec.payload.sources.map(s => ({ ...s, freshness: 'current' })) }, lifecycle: { ...originalSpec.lifecycle, status, stale: false, submission_id: 'isolated-lifecycle', approval: status === 'submitted' ? null : { reviewer: '隔离测试操作人' } } })));
  await context.route(`**/api/workspaces/${wid}`, route => route.fulfill(json({ ...workspace, type_lifecycle: { status } })));
  for (const action of ['approve', 'publish']) await context.route(`**/api/types/${wid}/${action}`, route => { writes.push({ action, body: route.request().postDataJSON(), actor: route.request().headers()['x-cablesim-actor'] }); status = action === 'approve' ? 'approved' : 'published'; return route.fulfill(json({ status })); });
  await go(`/types/${wid}/specification/review`);
  for (const [action, label] of [['approve', '人工批准'], ['publish', '发布型号版本']]) {
    await page.getByRole('button', { name: label, exact: true }).click(); const dialog = page.getByRole('dialog', { name: label, exact: true });
    await expect(dialog.getByRole('button', { name: label, exact: true })).toBeDisabled(); await page.keyboard.press('Escape'); assert.equal(writes.length, action === 'approve' ? 0 : 1);
    await page.getByRole('button', { name: label, exact: true }).click(); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: label, exact: true }).click(); await expect(dialog).not.toBeVisible();
  }
  assert.equal(writes[0].body.human_confirmed, true); assert.ok(writes.every(w => w.actor === 'human' && w.body.specification_digest === originalSpec.digest));
  await page.reload(); await expect(page.getByText('已发布', { exact: true }).first()).toBeVisible();
  await go(`/types/${wid}/structure/table`); await expect(page.getByText('只读型号版本', { exact: true })).toBeVisible(); await expect(page.locator('#type-name')).toHaveCount(0); await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  assert.deepEqual(await request(base, `/api/types/${wid}/specification?audience=customer`), originalSpec);
  report.checks.push('隔离响应验证批准/发布人工勾选、Esc取消、摘要与操作人传输、发布后重载只读；真实宿主规格书未修改');
  assert.deepEqual(report.errors, []);
} catch (error) { report.failure = String(error.stack || error); console.error(report.failure); console.error((await page.locator('body').innerText()).slice(0, 2000)); process.exitCode = 1; }
finally { await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2)); await session.close(); }
console.log(JSON.stringify(report));
