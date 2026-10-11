import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, repositoryRoot } from './browser.mjs';
import { assertLayout } from './layout-assertions.mjs';
assert.equal(process.env.E2E_ISOLATED, '1');
const base = process.env.FRONTEND_URL, expect = baseExpect.configure({ timeout: 30000 });
const out = path.join(repositoryRoot, '.data/fix-round/shared-shell/visible-text');
await fs.mkdir(out, { recursive: true });
const session = await openHeadlessBrowser({ executable: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }), { page } = session;
const result = { variants: [], errors: [], writes: [], checks: ['关于页无运行历史态：以旧平台版本响应检查兼容；运行表按保存对象检查历史状态。五态使用响应夹具，不修改数据库。'] };
let baseline;
const sizes = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }];
let state = 'success', gates = [];
const health = { status: 'ok', version: '0.1.0', model_version: 'cablesim.domain/1' };
const release = async () => { gates.forEach(resolve => resolve()); gates = []; };
page.on('pageerror', e => result.errors.push(e.message));
page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) result.writes.push(new URL(request.url()).pathname); });
async function fulfill(route, options) { try { await route.fulfill(options); } catch (e) { if (!/closed|handled|cancelled/i.test(e.message)) throw e; } }
const healthRoute = async route => {
  if (state === 'loading') await new Promise(resolve => gates.push(resolve));
  return fulfill(route, state === 'error' ? { status: 503, json: { detail: '平台信息暂时不可用' } } : { json: state === 'empty' ? {} : { ...health, version: state === 'historical' ? '0.0.9' : health.version } });
};
const runsRoute = async route => {
  if (state === 'loading') await new Promise(resolve => gates.push(resolve));
  return fulfill(route, state === 'error' ? { status: 503, json: { detail: '运行列表暂时不可用' } } : { json: state === 'empty' ? { items: [], total: 0 } : { ...baseline, items: baseline.items.map(item => state === 'historical' ? { ...item, status: { code: 'historical', label: '历史' } } : item) } });
};
try {
  const response = await fetch(base + '/api/index/objects?kind=run&limit=50'); assert.ok(response.ok, '真实运行基线读取失败'); baseline = await response.json();
  for (const area of ['about', 'runs']) {
    const pattern = area === 'about' ? '**/api/health' : '**/api/index/objects?kind=run*';
    await page.route(pattern, area === 'about' ? healthRoute : runsRoute);
    for (const sample of ['empty', 'loading', 'error', 'success', 'historical']) for (const size of sizes) for (const theme of ['light', 'dark']) {
      state = sample; await release(); await page.setViewportSize(size); await page.goto('about:blank');
      await page.goto(base + (area === 'about' ? '/settings?section=about&' : '/runs?') + 'theme=' + theme, { waitUntil: 'domcontentloaded' });
      await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 45000 });
      if (area === 'about') {
        if (sample === 'loading') await expect(page.getByText('正在读取平台信息', { exact: true })).toBeVisible();
        else if (sample === 'error') await expect(page.getByText('平台信息读取失败', { exact: true })).toBeVisible();
        else if (sample === 'empty') await expect(page.getByText('未提供', { exact: true })).toBeVisible();
        else { await expect(page.getByText('电缆工程输入 · 第 1 版', { exact: true })).toBeVisible(); await expect(page.locator('.settings-card')).toContainText(sample === 'historical' ? '0.0.9' : '0.1.0'); }
        await expect(page.locator('.settings-content')).not.toContainText('cablesim.domain/1');
      } else if (sample === 'loading') await expect(page.getByText('正在读取运行', { exact: true })).toBeVisible();
      else if (sample === 'error') await expect(page.getByText('运行列表暂时不可用', { exact: true })).toBeVisible();
      else if (sample === 'empty') await expect(page.getByText('还没有运行。在研究或型号里预检并运行后会出现在这里。', { exact: true })).toBeVisible();
      else { await expect(page.getByRole('table', { name: '运行', exact: true })).toBeVisible(); await expect(page.getByText('正在读取方法与结论', { exact: true })).toHaveCount(0); if (sample === 'historical') await expect(page.getByText('历史', { exact: true }).first()).toBeVisible(); }
      await page.evaluate(() => document.fonts.ready); await assertLayout(page, area + ':' + sample, { includeFrames: false });
      result.variants.push({ area, state: sample, ...size, theme });
      if (area === 'about' && sample === 'success' && size.width === 1366 && theme === 'light') await page.screenshot({ path: path.join(out, 'about-light.png') });
      if (area === 'about' && sample === 'error') { state = 'success'; await page.getByRole('button', { name: '重新读取', exact: true }).focus(); await page.keyboard.press('Enter'); await expect(page.getByText('电缆工程输入 · 第 1 版', { exact: true })).toBeVisible(); }
    }
    await release(); await page.unroute(pattern);
  }
  const methodsResponse = await fetch(base + '/api/methods'); assert.ok(methodsResponse.ok); const methods = await methodsResponse.json();
  const pluginId = 'cablesim.iec60287', relationsPath = '/api/index/objects/plugin/' + pluginId + '/relations';
  const relationsResponse = await fetch(base + relationsPath); assert.ok(relationsResponse.ok); const relations = await relationsResponse.json();
  await page.route('**/api/methods', async route => {
    if (state === 'loading') await new Promise(resolve => gates.push(resolve));
    return fulfill(route, state === 'error' ? { status: 503, json: { detail: '插件清单暂时不可用' } } : { json: state === 'empty' ? [] : methods });
  });
  await page.route('**' + relationsPath, route => fulfill(route, { json: state === 'historical' ? { ...relations, uses: relations.uses.map(item => ({ ...item, target: { ...item.target, status: { code: 'historical', label: '历史' } } })) } : relations }));
  for (const sample of ['empty', 'loading', 'error', 'success', 'historical']) for (const size of sizes) for (const theme of ['light', 'dark']) {
    state = sample; await release(); await page.setViewportSize(size); await page.goto('about:blank');
    await page.goto(base + '/plugins/' + pluginId + '?theme=' + theme, { waitUntil: 'domcontentloaded' });
    await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 45000 });
    if (sample === 'loading') await expect(page.getByText('正在读取保存记录', { exact: true })).toBeVisible();
    else if (sample === 'error') await expect(page.getByText('插件清单暂时不可用', { exact: true })).toBeVisible();
    else if (sample === 'empty') await expect(page.getByText('尚无已安装插件', { exact: true })).toBeVisible();
    else {
      await expect(page.locator('.plugin-detail h1')).toContainText('IEC 60287');
      await page.getByRole('tab', { name: '验证', exact: true }).click();
      await expect(page.getByRole('table', { name: '公开算例复现', exact: true })).toBeVisible();
      await expect(page.getByRole('table', { name: '公开算例复现', exact: true })).toContainText('导体温度');
      await expect(page.getByRole('table', { name: '公开算例复现', exact: true })).not.toContainText('conductor_temperature_k');
      if (sample === 'historical') await expect(page.getByText('历史', { exact: true }).first()).toBeVisible();
    }
    await page.evaluate(() => document.fonts.ready); await assertLayout(page, 'plugins:' + sample, { includeFrames: false });
    result.variants.push({ area: 'plugins', state: sample, ...size, theme });
    if (sample === 'success' && size.width === 1366 && theme === 'light') await page.screenshot({ path: path.join(out, 'plugins-light.png') });
  }
  assert.deepEqual(result.errors, []); assert.deepEqual(result.writes, []); console.log(JSON.stringify({ variants: result.variants.length, checks: result.checks }));
} catch (error) { result.failure = error.stack; result.failurePage = { url: page.url(), text: await page.locator('body').innerText().catch(() => '') }; await page.screenshot({ path: path.join(out, 'state-failure.png') }).catch(() => {}); process.exitCode = 1; console.error(error); }
finally { await release(); await fs.writeFile(path.join(out, 'states.json'), JSON.stringify(result, null, 2)); await session.close(); }
