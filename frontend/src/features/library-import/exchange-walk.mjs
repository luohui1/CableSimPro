import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { chromium, expect as baseExpect } from '@playwright/test';
import { assertLayout } from '../../../scripts/layout-assertions.mjs';

if (process.env.E2E_ISOLATED !== '1' || !process.env.E2E_EXCHANGE_TASKS || !process.env.LIBRARY_IMPORT_EVIDENCE) throw new Error('交换走查须由结构表隔离验收启动。');
const base = process.env.FRONTEND_URL;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('仅允许本机隔离数据库。');
const out = process.env.LIBRARY_IMPORT_EVIDENCE;
const tasks = JSON.parse(await fs.readFile(process.env.E2E_EXCHANGE_TASKS, 'utf8'));
const expect = baseExpect.configure({ timeout: 30000 });
const report = { checks: [], screenshots: [], requests: [], errors: [], failures: [], layout_failures: [] };
const executablePath = process.env.BROWSER_EXECUTABLE || [chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
for (const task of tasks) {
  const context = await browser.newContext({ viewport: task.viewport, locale: 'zh-CN' });
  const page = await context.newPage();
  const width = task.viewport.width;
  page.on('pageerror', error => report.errors.push({ viewport: width, kind: 'page', message: error.message }));
  page.on('console', entry => { if (entry.type() === 'error') report.errors.push({ viewport: width, kind: 'console', message: entry.text() }); });
  page.on('requestfailed', request => { if (!request.failure()?.errorText.includes('ERR_ABORTED')) report.errors.push({ viewport: width, kind: 'request', url: request.url(), message: request.failure()?.errorText }); });
  page.on('response', response => {
    if (!response.url().includes('/api/')) return;
    report.requests.push({ viewport: width, method: response.request().method(), url: response.url(), status: response.status() });
    if (response.status() >= 400) report.errors.push({ viewport: width, kind: 'network', url: response.url(), status: response.status() });
  });
  let shot = 0;
  async function capture(label) {
    await page.evaluate(() => document.fonts.ready);
    const name = `exchange-${width}-${String(++shot).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: path.join(out, name) });
    await fs.writeFile(path.join(out, name.replace('.png', '.txt')), await page.locator('body').innerText());
    report.screenshots.push(name);
    try { await assertLayout(page, `${width} ${label}`); }
    catch (error) { report.layout_failures.push({ viewport: width, screenshot: name, message: String(error) }); }
    console.log(`${width} ${label}`);
  }
  try {
    await page.goto(base + '/resources/cables/structure-import');
    await page.getByRole('tab', { name: '数据交换', exact: true }).click();
    await capture('新库选择交换文件');
    await page.getByLabel('型号交换文件', { exact: true }).setInputFiles(task.file);
    await expect(page.getByRole('heading', { name: '核对交换预览', exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: '型号交换预览', exact: true })).toContainText(task.name);
    await capture('新库交换内容预览');
    await expect(page.getByRole('button', { name: '确认导入型号交换文件', exact: true })).toBeDisabled();
    await page.getByRole('checkbox', { name: '确认交换文件来源', exact: true }).check();
    const importedPromise = page.waitForResponse(response => response.url().endsWith('/api/type-library/exchange/import') && response.request().method() === 'POST', { timeout: 180000 });
    await page.getByRole('button', { name: '确认导入型号交换文件', exact: true }).click();
    const response = await importedPromise;
    assert.equal(response.ok(), true, await response.text());
    const receipt = await response.json();
    assert.equal(receipt.created, task.specs.length);
    await expect(page.getByRole('heading', { name: `已导入 ${task.specs.length} 个规格草稿`, exact: true })).toBeVisible();
    await capture('人工确认后导入草稿');
    const freshResponse = await fetch(base + `/api/type-library/series/${receipt.series[0].series_id}`);
    assert.equal(freshResponse.ok, true);
    const fresh = await freshResponse.json();
    assert.equal(fresh.specs.length, task.specs.length);
    for (const spec of fresh.specs) {
      assert.equal(spec.version, 1);
      assert.equal(spec.state, 'draft');
      const original = task.specs.find(item => item.name === spec.name);
      assert.ok(original, '导入后的规格名称须保留');
      assert.deepEqual(spec.values, original.values, '数值、原表来源、方法版本及可信分档须完整往返');
    }
    await page.getByRole('button', { name: `打开系列：${task.name}`, exact: true }).click();
    await expect(page.getByRole('table', { name: '系列规格', exact: true })).toBeVisible();
    await capture('新库恢复系列与逐项来源');
    await page.getByRole('tab', { name: '数据交换', exact: true }).click();
    await page.getByLabel('型号交换文件', { exact: true }).setInputFiles(task.file);
    await expect(page.getByRole('table', { name: '型号交换预览', exact: true })).toContainText('目标库存在同名系列，整包不入库');
    await expect(page.getByRole('button', { name: '确认导入型号交换文件', exact: true })).toHaveCount(0);
    await capture('同名系列整包拒绝');
    report.checks.push(`${width}：${path.extname(task.file).slice(1).toUpperCase()} 导出在全新隔离库经真实UI预览、人工确认恢复${task.specs.length}个草稿；逐项数值/来源/方法/可信分档完全一致，同名系列整包拒绝`);
  } catch (error) {
    report.failures.push({ viewport: width, message: String(error) });
    await page.screenshot({ path: path.join(out, `exchange-${width}-failure.png`) }).catch(() => {});
    await fs.writeFile(path.join(out, `exchange-${width}-failure.txt`), await page.locator('body').innerText().catch(() => '页面已关闭'));
    console.error(error);
  } finally { await context.close(); }
}
await browser.close();
await fs.writeFile(path.join(out, 'exchange-report.json'), JSON.stringify(report, null, 2));
assert.deepEqual(report.errors, [], '交换导入控制台或网络错误');
assert.deepEqual(report.failures, [], '全新库真实交换流程未通过');
assert.deepEqual(report.layout_failures, [], '交换页面截图布局或可见名称未通过');
console.log(JSON.stringify({ checks: report.checks, screenshots: report.screenshots.length }, null, 2));
