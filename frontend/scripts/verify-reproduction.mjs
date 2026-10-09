import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, settle, outputRoot } from './browser.mjs';
import { request } from './research-fixtures.mjs';

if (process.env.E2E_ISOLATED !== '1') throw Error('Requires isolated database');
const base = process.env.FRONTEND_URL, expect = baseExpect.configure({ timeout: 20000 });
const session = await openHeadlessBrowser(), { page, context } = session;
const out = path.join(outputRoot, 'reproduction'), report = { checks: [], layouts: [], errors: [] };
await fs.mkdir(out, { recursive: true });
page.on('pageerror', error => report.errors.push(error.message));
async function go(route) { await page.goto('about:blank'); await page.goto(base + route); await settle(page); }
async function geometry() {
  const value = await page.locator('.series-chart > svg').evaluate(svg => {
    const ticks = [...svg.querySelectorAll('text[y="292"]')].map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; });
    return { invalid: /NaN|Infinity/.test(svg.outerHTML), overflow: document.documentElement.scrollWidth > innerWidth, ticks };
  });
  assert.equal(value.invalid, false); assert.equal(value.overflow, false);
  for (let i = 1; i < value.ticks.length; i++) assert.ok(value.ticks[i].left >= value.ticks[i - 1].right);
  report.layouts.push(value);
}
try {
  const catalog = await request(base, '/api/foundation/reproductions');
  const target = catalog.items.find(item => item.id === 'E17');
  assert.ok(target, 'Requires saved E17 evidence; never synthesizes solver values');
  const detail = await request(base, '/api/foundation/reproductions/E17');
  assert.ok(detail.rows.some(row => row.reference === 0.000177)); assert.ok(detail.evidence.length);
  await go('/validation');
  const table = page.getByRole('table', { name: '复现目标', exact: true });
  await expect(table.locator('tbody tr')).toHaveCount(catalog.items.length);
  let total = 0;
  const labels = { reproduced: '声明范围内已复现', partial: '部分覆盖', missing_data: '缺资料', capability_gap: '能力未覆盖' };
  for (const [status, label] of Object.entries(labels)) {
    const count = catalog.items.filter(item => item.status === status).length; total += count;
    if (!count) continue;
    await page.getByRole('combobox', { name: '覆盖状态', exact: true }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await expect(table.locator('tbody tr')).toHaveCount(count);
    for (const row of await table.locator('tbody tr').all()) await expect(row.locator('td').nth(2)).toHaveText(label);
  }
  assert.equal(total, catalog.items.length);
  await page.getByRole('combobox', { name: '覆盖状态', exact: true }).click(); await page.getByRole('option', { name: '全部', exact: true }).click();
  await page.getByPlaceholder('目标、来源或编号').fill('E17'); await page.keyboard.press('Enter');
  await expect(table.locator('tbody tr')).toHaveCount(1); await expect(table).toContainText('双圆导体交流电阻');
  await table.locator('tbody tr').first().focus(); await page.keyboard.press('Enter');
  const results = page.getByRole('table', { name: '原文、开源与 COMSOL 对照', exact: true });
  await expect(results).toBeVisible(); await expect(results).toContainText('0.1770'); await expect(results).toContainText('Ω/km');
  assert.equal(await results.locator('tbody tr').count(), detail.rows.length);
  await results.locator('span.numeric').filter({ hasText: '0.1770' }).first().hover();
  await expect(page.getByRole('tooltip')).toContainText('0.000177 ohm/m');
  await expect(page.locator('.evidence-summary')).toContainText(detail.scope);
  assert.ok(await page.locator('.evidence-summary').evaluate(el => el.getBoundingClientRect().bottom <= document.querySelector('[aria-label="原文、开源与 COMSOL 对照"]').getBoundingClientRect().top));
  report.checks.push('真实 E17 检索、Enter 打开、状态分组总数、中文标题、结果精度和结论优先');
  await page.getByRole('tab', { name: '输入来源', exact: true }).click();
  await expect(page.locator('[data-page=reproduction-detail]')).toContainText(/Table\s*1/);
  await page.getByRole('link', { name: '全部复现目标', exact: true }).focus();
  const exporting = page.waitForEvent('download'); await page.keyboard.press('Control+s');
  const download = await exporting, file = path.join(out, download.suggestedFilename()); await download.saveAs(file);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), detail);
  await page.getByRole('link', { name: '全部复现目标', exact: true }).click();
  await expect(table).toBeVisible();
  report.checks.push('来源正文、CtrlS 实际 JSON 下载与完整固定证据相等、返回列表');
  // Formal UI uses its list link and search field instead of prototype-global Escape/CtrlZ.
  await page.getByPlaceholder('目标、来源或编号').fill('不存在的复现目标');
  await expect(page.getByText('没有匹配的复现目标', { exact: true })).toBeVisible();
  await go('/validation'); await expect(table.locator('tbody tr')).toHaveCount(catalog.items.length);
  const pattern = '**/api/foundation/reproductions';
  await context.route(pattern, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...catalog, items: [] }) }));
  await go('/validation'); await expect(page.locator('[data-page=reproductions]')).toHaveAttribute('data-state', 'empty');
  await context.unroute(pattern); await page.getByRole('button', { name: '刷新', exact: true }).click(); await expect(table.locator('tbody tr')).toHaveCount(catalog.items.length);
  report.checks.push('搜索空结果和真实空目录响应分别覆盖；刷新恢复全部记录');
  for (const width of [1366, 1920, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 844 });
    await go('/validation/E17/overlay?theme=' + theme);
    for (const series of ['reference', 'open_source', 'comsol']) await expect(page.locator(`[data-series=${series}]`)).toBeVisible();
    const toggle = page.getByRole('checkbox', { name: 'COMSOL', exact: true });
    await toggle.focus(); await page.keyboard.press('Space'); await expect(page.locator('[data-series=comsol]')).not.toBeVisible();
    await page.keyboard.press('Space'); await expect(page.locator('[data-series=comsol]')).toBeVisible(); await geometry();
    if (width === 1366 && theme === 'light') await page.screenshot({ path: path.join(out, 'overlay.png') });
    await go('/validation/C06/convergence?theme=' + theme);
    await expect(page.locator('.series-point').first()).toBeVisible(); assert.ok(await page.locator('.series-point').count() >= 3); await geometry();
  }
  report.checks.push('三方曲线、COMSOL 键盘开关、收敛至少三点、刻度间距、有效 SVG、桌面和手机无横向溢出');
  assert.deepEqual(report.errors, []);
} catch (error) { report.failure = String(error.stack || error); console.error(report.failure); process.exitCode = 1; }
finally { await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2)); await session.close(); }
console.log(JSON.stringify(report));
