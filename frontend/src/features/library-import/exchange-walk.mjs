import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, expect as baseExpect } from '@playwright/test';
import { assertLayout } from '../../../scripts/layout-assertions.mjs';
import { classifyExchangeRefusals, importResourceExchange, multipartEvidence, observeExchangeUploads, saveRawResponse } from './resource-exchange-walk.mjs';

if (process.env.PUBLISHED_EXCHANGE_PHASE) {
  await (await import('./published-exchange-walk.mjs')).runPublishedExchangePhase();
} else {
if (process.env.E2E_ISOLATED !== '1' || !process.env.E2E_EXCHANGE_TASKS || !process.env.LIBRARY_IMPORT_EVIDENCE) throw new Error('交换走查须由结构表隔离验收启动。');
const base = process.env.FRONTEND_URL;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('仅允许本机隔离数据库。');
const out = process.env.LIBRARY_IMPORT_EVIDENCE;
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const tasks = JSON.parse(await fs.readFile(process.env.E2E_EXCHANGE_TASKS, 'utf8'));
const expect = baseExpect.configure({ timeout: 30000 });
const report = { checks: [], screenshots: [], requests: [], errors: [], failures: [], layout_failures: [], expected_refusals: [], observed_errors: [] };
const requestIds = new WeakMap();
let nextRequestId = 0;
function requestIdentity(request) {
  if (!requestIds.has(request)) requestIds.set(request, ++nextRequestId);
  return requestIds.get(request);
}
const saveReport = () => fs.writeFile(path.join(out, 'exchange-report.json'), JSON.stringify(report, null, 2));
await saveReport();
const executablePath = process.env.BROWSER_EXECUTABLE || [chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
let browser;
try { browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
catch (error) { report.failures.push({ phase: '浏览器启动', message: String(error) }); await saveReport(); throw error; }
for (const task of tasks) {
  const context = await browser.newContext({ viewport: task.viewport, acceptDownloads: true, locale: 'zh-CN' });
  const page = await context.newPage();
  const uploadObserver = await observeExchangeUploads(page);
  const width = task.viewport.width;
  page.on('pageerror', error => report.errors.push({ viewport: width, kind: 'page', message: error.message }));
  page.on('console', entry => { if (entry.type() === 'error') report.errors.push({ viewport: width, kind: 'console', location: entry.location(), message: entry.text() }); });
  page.on('requestfailed', request => { if (!request.failure()?.errorText.includes('ERR_ABORTED')) report.errors.push({ viewport: width, kind: 'request', url: request.url(), message: request.failure()?.errorText }); });
  page.on('response', response => {
    if (!response.url().includes('/api/')) return;
    const request_id = requestIdentity(response.request());
    report.requests.push({ viewport: width, request_id, method: response.request().method(), url: response.url(), status: response.status() });
    if (response.status() >= 400) report.errors.push({ viewport: width, request_id, kind: 'network', url: response.url(), status: response.status() });
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
    await saveReport();
    console.log(`${width} ${label}`);
  }
  try {
    if (task.kind === 'resources') {
      await importResourceExchange({ page, base, task, out, root, expect, capture, report, requestIdentity, uploadObserver });
    } else {
    await page.goto(base + '/resources/cables/structure-import');
    await page.getByRole('tab', { name: '数据交换', exact: true }).click();
    await capture('新库选择交换文件');
    const previewAction = await uploadObserver.begin('/api/type-library/exchange/preview', 'series-preview');
    const [previewResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/type-library/exchange/preview') && response.request().method() === 'POST'),
      Promise.resolve().then(() => page.getByLabel('型号交换文件', { exact: true }).setInputFiles(task.file)),
    ]);
    assert.equal(previewResponse.status(), 200, await previewResponse.text());
    const preview = await previewResponse.json();
    const previewObservation = await uploadObserver.finish(previewAction, previewResponse);
    const previewEvidence = await multipartEvidence(previewResponse, task.file, previewObservation);
    assert.deepEqual(previewEvidence.form, {}, '预览上传不应夹带确认字段');
    assert.equal(previewEvidence.file.sha256, preview.file_sha256);
    const previewRaw = await saveRawResponse(previewResponse, path.join(out, `exchange-${width}-series-preview-raw.json`));
    await fs.writeFile(path.join(out, `exchange-${width}-series-preview.json`), JSON.stringify({ ...previewEvidence, response: preview, raw_response: previewRaw }, null, 2));
    await expect(page.getByRole('heading', { name: '核对交换预览', exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: '型号交换预览', exact: true })).toContainText(task.name);
    await capture('新库交换内容预览');
    await expect(page.getByRole('button', { name: '确认导入型号交换文件', exact: true })).toBeDisabled();
    await page.getByRole('checkbox', { name: '确认交换文件来源', exact: true }).check();
    const importAction = await uploadObserver.begin('/api/type-library/exchange/import', 'series-import');
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/type-library/exchange/import') && response.request().method() === 'POST', { timeout: 180000 }),
      Promise.resolve().then(() => page.getByRole('button', { name: '确认导入型号交换文件', exact: true }).click()),
    ]);
    assert.equal(response.ok(), true, await response.text());
    const receipt = await response.json();
    const importObservation = await uploadObserver.finish(importAction, response);
    const importEvidence = await multipartEvidence(response, task.file, importObservation);
    assert.deepEqual(Object.keys(importEvidence.form).sort(), ['confirmed', 'request_id', 'reviewed_sha256']);
    assert.equal(importEvidence.request_headers['x-cablesim-actor'], 'human');
    assert.equal(importEvidence.form.confirmed, 'true');
    assert.equal(importEvidence.form.reviewed_sha256, preview.file_sha256);
    const importRaw = await saveRawResponse(response, path.join(out, `exchange-${width}-series-receipt-raw.json`));
    await fs.writeFile(path.join(out, `exchange-${width}-series-receipt.json`), JSON.stringify({ ...importEvidence, response: receipt, raw_response: importRaw }, null, 2));
    assert.equal(receipt.created, task.specs.length);
    await expect(page.getByRole('heading', { name: `已导入 ${task.specs.length} 个规格草稿`, exact: true })).toBeVisible();
    await capture('人工确认后导入草稿');
    const freshResponse = await page.request.get(base + `/api/type-library/series/${receipt.series[0].series_id}`);
    assert.equal(freshResponse.ok(), true);
    const fresh = await freshResponse.json();
    const freshRaw = await saveRawResponse(freshResponse, path.join(out, `exchange-${width}-series-fresh-raw.json`));
    await fs.writeFile(path.join(out, `exchange-${width}-series-fresh.json`), JSON.stringify({ endpoint: `/api/type-library/series/${receipt.series[0].series_id}`, status: freshResponse.status(), response: fresh, raw_response: freshRaw }, null, 2));
    await freshResponse.dispose();
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
    const conflictAction = await uploadObserver.begin('/api/type-library/exchange/preview', 'series-same-name-refusal');
    const [conflictPreviewResponse] = await Promise.all([
      page.waitForResponse(value => value.url().endsWith('/api/type-library/exchange/preview') && value.request().method() === 'POST'),
      Promise.resolve().then(() => page.getByLabel('型号交换文件', { exact: true }).setInputFiles(task.file)),
    ]);
    assert.equal(conflictPreviewResponse.status(), 200, await conflictPreviewResponse.text());
    const conflictObservation = await uploadObserver.finish(conflictAction, conflictPreviewResponse);
    const conflictEvidence = await multipartEvidence(conflictPreviewResponse, task.file, conflictObservation);
    const conflictPreview = await conflictPreviewResponse.json();
    assert.deepEqual(conflictEvidence.form, {});
    assert.equal(conflictPreview.file_sha256, preview.file_sha256);
    const conflictPreviewRaw = await saveRawResponse(conflictPreviewResponse, path.join(out, `exchange-${width}-series-conflict-preview-raw.json`));
    await fs.writeFile(path.join(out, `exchange-${width}-series-conflict-preview.json`), JSON.stringify({ ...conflictEvidence, response: conflictPreview, raw_response: conflictPreviewRaw }, null, 2));
    await expect(page.getByRole('table', { name: '型号交换预览', exact: true })).toContainText('目标库存在同名系列，整包不入库');
    await expect(page.getByRole('button', { name: '确认导入型号交换文件', exact: true })).toHaveCount(0);
    await capture('同名系列整包拒绝');
    const conflictReadback = await page.request.get(base + `/api/type-library/series/${receipt.series[0].series_id}`);
    assert.equal(conflictReadback.status(), 200);
    const unchanged = await conflictReadback.json();
    assert.deepEqual(unchanged, fresh);
    const conflictRaw = await saveRawResponse(conflictReadback, path.join(out, `exchange-${width}-series-conflict-fresh-raw.json`));
    await fs.writeFile(path.join(out, `exchange-${width}-series-conflict-fresh.json`), JSON.stringify({ endpoint: `/api/type-library/series/${receipt.series[0].series_id}`, status: conflictReadback.status(), response: unchanged, raw_response: conflictRaw }, null, 2));
    await conflictReadback.dispose();
    report.checks.push(`${width}：${path.extname(task.file).slice(1).toUpperCase()} 导出在全新隔离库经真实UI预览、人工确认恢复${task.specs.length}个草稿；逐项数值/来源/方法/可信分档完全一致，同名系列整包拒绝`);
    }
  } catch (error) {
    report.failures.push({ viewport: width, message: String(error) });
    await page.screenshot({ path: path.join(out, `exchange-${width}-failure.png`) }).catch(() => {});
    await fs.writeFile(path.join(out, `exchange-${width}-failure.txt`), await page.locator('body').innerText().catch(() => '页面已关闭'));
    console.error(error);
  } finally {
    try { await uploadObserver.assertComplete(); }
    catch (error) { report.failures.push({ viewport: width, phase: '真实FormData与网络请求观测完整性', message: String(error) }); }
    try { await fs.writeFile(path.join(out, `exchange-${width}-${task.kind === 'resources' ? 'resources' : 'series'}-upload-observations.json`), JSON.stringify(await uploadObserver.snapshot(), null, 2)); }
    catch (error) { report.failures.push({ viewport: width, phase: '保存实际上传观测', message: String(error) }); }
    try { await context.close(); }
    catch (error) { report.failures.push({ viewport: width, phase: '浏览器上下文关闭', message: String(error) }); }
    await saveReport();
  }
}
try { await browser.close(); }
catch (error) { report.failures.push({ phase: '浏览器关闭', message: String(error) }); }
try { classifyExchangeRefusals(report); }
catch (error) { report.failures.push({ phase: '预期拒绝与实际网络记录逐项核对', message: String(error) }); }
await saveReport();
assert.deepEqual(report.errors, [], '交换导入控制台或网络错误');
assert.deepEqual(report.failures, [], '全新库真实交换流程未通过');
assert.deepEqual(report.layout_failures, [], '交换页面截图布局或可见名称未通过');
console.log(JSON.stringify({ checks: report.checks, screenshots: report.screenshots.length }, null, 2));
}
