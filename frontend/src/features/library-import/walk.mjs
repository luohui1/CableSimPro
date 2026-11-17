import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, expect as baseExpect } from '@playwright/test';
import { assertLayout } from '../../../scripts/layout-assertions.mjs';

if (process.env.E2E_ISOLATED !== '1') throw new Error('结构表走查只允许操作隔离验收数据库。');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const base = process.env.FRONTEND_URL;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('请提供隔离应用的本机地址。');
const out = path.resolve(process.env.LIBRARY_IMPORT_EVIDENCE || path.join(root, '.tmp/library-import-walk'));
await fs.mkdir(out, { recursive: true });
const expect = baseExpect.configure({ timeout: 30000 });
const executablePath = process.env.BROWSER_EXECUTABLE || [chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
const report = { checks: [], screenshots: [], errors: [], requests: [], failures: [], layout_failures: [] };
let browser;
try { browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
catch (error) {
  report.failures.push({ phase: '浏览器启动', message: String(error) });
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  throw error;
}
const stamp = String(Date.now());
const exchangeTasks = [];

async function readApi(url) {
  const response = await fetch(base + url);
  assert.equal(response.ok, true, `${url} HTTP ${response.status}`);
  return response.json();
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  const context = await browser.newContext({ viewport, acceptDownloads: true, locale: 'zh-CN' });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push({ viewport: viewport.width, kind: 'page', message: error.message }));
  page.on('console', entry => { if (entry.type() === 'error') report.errors.push({ viewport: viewport.width, kind: 'console', message: entry.text() }); });
  page.on('requestfailed', request => { if (!request.failure()?.errorText.includes('ERR_ABORTED')) report.errors.push({ viewport: viewport.width, kind: 'request', url: request.url(), message: request.failure()?.errorText }); });
  page.on('response', response => {
    if (!response.url().includes('/api/')) return;
    report.requests.push({ viewport: viewport.width, method: response.request().method(), url: response.url(), status: response.status() });
    if (response.status() >= 400) report.errors.push({ viewport: viewport.width, kind: 'network', url: response.url(), status: response.status() });
  });
  let shot = 0;
  async function capture(label) {
    await page.evaluate(() => document.fonts.ready);
    const name = `${viewport.width}-${String(++shot).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: path.join(out, name) });
    await fs.writeFile(path.join(out, name.replace('.png', '.txt')), await page.locator('body').innerText());
    report.screenshots.push(name);
    try { await assertLayout(page, `${viewport.width} ${label}`); }
    catch (error) { report.layout_failures.push({ viewport: viewport.width, screenshot: name, message: String(error) }); }
    console.log(`${viewport.width} ${label}`);
  }
  async function select(label, option) {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  }
  async function advanceSheet() {
    await page.getByRole('button', { name: '确认工作表，设置列映射', exact: true }).click();
    await expect(page.getByRole('heading', { name: '确认列映射', exact: true })).toBeVisible();
  }
  async function preview() {
    const response = page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/preview') && response.request().method() === 'POST', { timeout: 180000 });
    await page.getByRole('button', { name: '逐行校验并预览', exact: true }).click();
    const result = await response;
    assert.equal(result.status(), 200, await result.text());
    await expect(page.getByRole('heading', { name: '核对入库预览', exact: true })).toBeVisible();
    return result.json();
  }
  try {
    await page.goto(base + '/resources/cables/structure-import');
    await expect(page.getByRole('button', { name: '选择结构表文件', exact: true })).toBeEnabled();
    await capture('选择文件');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: '下载人民电缆示例结构表', exact: true }).click();
    const download = await downloadPromise;
    const samplePath = path.join(out, `people-mv-${viewport.width}.xlsx`);
    await download.saveAs(samplePath);
    assert.equal(await download.failure(), null);

    // Keep all original cells except this explicitly invalid diameter. The test
    // checks that the importer names the actual source row and column.
    const errorPath = path.join(out, `people-error-${viewport.width}.csv`);
    const python = process.env.E2E_PYTHON || path.join(root, '.venv', 'bin', 'python');
    execFileSync(python, ['-c', [
      'import csv,io,sys',
      'from pathlib import Path',
      'from backend.kernel.public_catalogues import sample_bytes',
      "rows=list(csv.reader(io.StringIO(sample_bytes('people-mv','csv','three-core-steel-tape').decode('utf-8-sig'))))",
      "rows[2][1]='错误值（验收注入）'",
      "with Path(sys.argv[1]).open('w',encoding='utf-8-sig',newline='') as stream: csv.writer(stream).writerows(rows)",
    ].join('\n'), errorPath], { cwd: root });
    await page.getByLabel('结构表文件', { exact: true }).setInputFiles(errorPath);
    await expect(page.getByRole('heading', { name: '选择工作表', exact: true })).toBeVisible();
    await advanceSheet();
    await page.getByRole('button', { name: '填写系列声明', exact: true }).click();
    for (const [label, value] of [['系列名称', `错误行核对 ${viewport.width} ${stamp}`], ['制造商', '人民电器集团公开样本（错误行验收副本）'], ['型号', 'YJV22'], ['额定相电压 kV', '8.7'], ['额定线电压 kV', '15']]) await page.getByRole('form', { name: '系列声明' }).getByLabel(label, { exact: true }).fill(value);
    const failedPreview = await preview();
    const bad = failedPreview.rows.find(row => row.row_number === 3);
    assert.equal(bad?.status, 'error');
    assert.ok(bad.issues.some(issue => String(issue.column).startsWith('B') || issue.field === 'conductor_diameter'));
    assert.ok(failedPreview.incomplete_count > 0, '缺少屏蔽尺寸须保留为资料缺项');
    await expect(page.getByRole('button', { name: /^确认入库/ })).toBeDisabled();
    await capture('错误行与缺项定位');
    report.checks.push(`${viewport.width}：真实表格副本的第3行B列错误被准确指出，缺项与错误分别显示，未确认不能入库`);

    await page.getByRole('button', { name: '重新开始', exact: true }).click();
    const uploaded = page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/upload') && response.request().method() === 'POST');
    await page.getByLabel('结构表文件', { exact: true }).setInputFiles(samplePath);
    const uploadResponse = await uploaded;
    assert.equal(uploadResponse.ok(), true, await uploadResponse.text());
    const inspection = await uploadResponse.json();
    const wanted = inspection.sheets.find(sheet => sheet.name.includes('YJV22'));
    assert.ok(wanted, '公开样本应保留三芯钢带铠装工作表');
    await select('工作表', `${wanted.name} · ${wanted.data_rows ?? wanted.rows} 行`);
    await capture('上传后选择工作表');
    await advanceSheet();
    await capture('列映射与原始值');
    const mapName = `人民公开表 ${viewport.width} ${stamp}`;
    await page.getByLabel('映射模板名称', { exact: true }).fill(mapName);
    await page.getByRole('button', { name: '保存列映射', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已保存“' })).toBeVisible();
    await select('复用已保存映射', mapName);
    await expect(page.getByRole('status').filter({ hasText: '已复用“' })).toBeVisible();
    await capture('映射保存与复用');
    await page.getByRole('button', { name: '填写系列声明', exact: true }).click();
    await page.getByRole('form', { name: '系列声明' }).getByLabel('系列名称', { exact: true }).fill(`人民 YJV22 公开样本 ${viewport.width} ${stamp}`);
    await capture('公开来源与系列声明');
    const built = await preview();
    assert.equal(built.error_count, 0, '原始公开样本不应有解析错误');
    assert.equal(built.rows.length, 11);
    await capture('逐规格预览');
    await page.getByRole('table', { name: '逐行入库预览', exact: true }).getByRole('button', { name: built.rows[0].name, exact: true }).click();
    await expect(page.getByRole('table', { name: '逐项来源', exact: true })).toBeVisible();
    await capture('预览数值与逐项出处');
    await page.keyboard.press('Escape');
    const commitButton = page.getByRole('button', { name: '确认入库 11 个规格', exact: true });
    await expect(commitButton).toBeDisabled();
    await page.getByRole('checkbox', { name: '确认来源与系列声明', exact: true }).check();
    const committed = page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/commit') && response.request().method() === 'POST', { timeout: 180000 });
    await commitButton.click();
    const savedResponse = await committed;
    assert.equal(savedResponse.ok(), true, await savedResponse.text());
    const saved = await savedResponse.json();
    assert.equal(saved.created, 11);
    await expect(page.getByRole('heading', { name: '已保存 11 个规格草稿', exact: true })).toBeVisible();
    await capture('人工确认后入库');
    const detail = await readApi(`/api/type-library/series/${saved.series_id}`);
    assert.equal(detail.specs.length, 11);
    for (const spec of detail.specs) {
      assert.ok(spec.model_id && spec.workspace_id);
      assert.ok(spec.values.length > 0);
      assert.ok(spec.values.every(value => value.source && value.confidence), `${spec.name} 缺逐项来源或可信分档`);
    }
    await page.getByRole('button', { name: '打开系列，核对与计算', exact: true }).click();
    await expect(page.getByRole('table', { name: '系列规格', exact: true })).toBeVisible();
    await capture('系列与规格');
    await page.getByRole('checkbox', { name: '选择全部规格', exact: true }).check();
    await page.getByRole('button', { name: '批量核对', exact: true }).click();
    await capture('批量核对版本确认');
    const dialog = page.getByRole('dialog', { name: '批量标准核对', exact: true });
    await expect(dialog.getByRole('button', { name: '确认执行 11 个规格', exact: true })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: '确认所选规格与版本', exact: true }).check();
    const batchPromise = page.waitForResponse(response => response.url().includes(`/series/${saved.series_id}/batch`) && response.request().method() === 'POST', { timeout: 300000 });
    await dialog.getByRole('button', { name: '确认执行 11 个规格', exact: true }).click();
    const batchResponse = await batchPromise;
    assert.equal(batchResponse.ok(), true, await batchResponse.text());
    const batch = await batchResponse.json();
    assert.equal(batch.items.length, 11);
    await expect(page.getByRole('table', { name: '批量操作结果', exact: true })).toBeVisible();
    await page.getByRole('heading', { name: '本次批量操作结果', exact: true }).scrollIntoViewIfNeeded();
    await capture('真实批量核对结果');
    assert.ok(batch.items.some(item => item.run_id && item.checks?.length), '批量核对须保存真实标准核对运行');

    await page.getByRole('button', { name: '批量计算', exact: true }).click();
    const calculation = page.getByRole('dialog', { name: '批量计算', exact: true });
    await expect(calculation.getByRole('button', { name: '确认执行 11 个规格', exact: true })).toBeDisabled();
    for (const [label, value] of [
      ['工况名称', '公开样本同工况直埋对照'], ['中心埋深 m', '0.7'], ['土壤热阻率 K·m/W', '1.0'],
      ['环境温度 °C', '25'], ['交流频率 Hz', '50'], ['集肤效应系数 kₛ 1', '1'], ['邻近效应系数 kₚ 1', '1'],
      ['工况来源', '人民电器集团公开样本直埋条件：土壤25 °C，热阻率1.0 K·m/W。原表未列埋深，验收明确采用0.7 m，两端接地；50 Hz来自原PDF使用特性。'],
      ['方法参数来源', 'IEC 60287公开样本回归条件；kₛ=1、kₚ=1，涡流损耗明确忽略。本轮只验证真实方法运行和缺项拒算，不作为厂家试验数据。'],
    ]) await calculation.getByLabel(label, { exact: true }).fill(value);
    await select('金属套接地', '两端接地');
    await select('护套涡流损耗', '明确忽略（须核对适用条件）');
    await calculation.getByRole('heading', { name: '统一计算工况', exact: true }).scrollIntoViewIfNeeded();
    await capture('批量计算明确工况');
    await calculation.getByLabel('确认所选规格与版本', { exact: true }).check();
    const ratedPromise = page.waitForResponse(response => response.url().includes(`/series/${saved.series_id}/batch`) && response.request().method() === 'POST', { timeout: 300000 });
    await calculation.getByRole('button', { name: '确认执行 11 个规格', exact: true }).click();
    const ratedResponse = await ratedPromise;
    assert.equal(ratedResponse.ok(), true, await ratedResponse.text());
    const rated = await ratedResponse.json();
    assert.equal(rated.items.length, 11);
    assert.ok(rated.items.some(item => item.run_id && item.rows?.some(row => typeof row.value_a === 'number' && row.value_a > 0)), '批量计算须保存真实载流量结果');
    await expect(calculation).toBeHidden();
    await page.getByRole('heading', { name: '本次批量操作结果', exact: true }).scrollIntoViewIfNeeded();
    await capture('真实批量载流量结果');

    await page.getByRole('button', { name: '批量审核', exact: true }).click();
    const review = page.getByRole('dialog', { name: '批量人工审核', exact: true });
    await select('审核动作', '批准已提交版本');
    await review.getByLabel('审核人', { exact: true }).fill('结构表验收工程师');
    await review.getByLabel('审核意见', { exact: true }).fill('核对审核门禁：这批导入草稿尚未提交审核，必须整批拒绝批准，保留草稿。');
    await review.getByLabel('确认所选规格与版本', { exact: true }).check();
    await capture('批量审核明确人工动作');
    const reviewedPromise = page.waitForResponse(response => response.url().includes(`/series/${saved.series_id}/batch`) && response.request().method() === 'POST', { timeout: 180000 });
    await review.getByRole('button', { name: '确认执行 11 个规格', exact: true }).click();
    const reviewedResponse = await reviewedPromise;
    assert.equal(reviewedResponse.ok(), true, await reviewedResponse.text());
    const reviewed = await reviewedResponse.json();
    assert.ok(reviewed.items.every(item => item.status === 'failed' && /尚未提交|未提交审核/.test(item.message)), '未经提交的草稿须整批拒绝批准');
    const afterReview = await readApi(`/api/type-library/series/${saved.series_id}`);
    assert.ok(afterReview.specs.every(spec => spec.state !== 'approved' && spec.state !== 'published'));
    await expect(review).toBeHidden();
    await page.getByRole('heading', { name: '本次批量操作结果', exact: true }).scrollIntoViewIfNeeded();
    await capture('审核门禁真实拒绝');
    report.checks.push(`${viewport.width}：真实Excel上传→工作表→列映射保存复用→系列声明→11规格预览→人工确认入库→型号库→真实批量标准核对与载流量计算→未提交草稿整批拒绝批准，保存版本/来源可回读`);
    await page.reload();
    await expect(page.getByRole('table', { name: '系列规格', exact: true })).toBeVisible();
    await capture('刷新后同一系列');
    await page.getByRole('table', { name: '系列规格', exact: true }).getByRole('button', { name: detail.specs[0].name, exact: true }).click();
    await expect(page.getByRole('table', { name: '逐项来源', exact: true })).toBeVisible();
    await capture('每个数的原表来源');
    const sourceDialog = page.getByRole('dialog', { name: detail.specs[0].name, exact: true });
    await sourceDialog.getByText('将当前设计保存为新版本', { exact: true }).click();
    await sourceDialog.getByLabel('改版说明', { exact: true }).fill('验收从当前已保存的公开样本设计建立独立第2版，数值保持原始资料，核对旧版与来源保留。');
    await sourceDialog.getByLabel('确认保存型号新版本', { exact: true }).check();
    const revisionPromise = page.waitForResponse(response => response.url().endsWith(`/specs/${detail.specs[0].id}/revisions`) && response.request().method() === 'POST');
    await sourceDialog.getByRole('button', { name: '建立新版本草稿', exact: true }).click();
    const revisionResponse = await revisionPromise;
    assert.equal(revisionResponse.ok(), true, await revisionResponse.text());
    const revision = await revisionResponse.json();
    assert.equal(revision.version, 2);
    await expect(sourceDialog.getByRole('status').filter({ hasText: '已建立独立新版本草稿' })).toBeVisible();
    await sourceDialog.getByRole('combobox', { name: '查看规格版本', exact: true }).scrollIntoViewIfNeeded();
    await capture('独立新版本与旧版保留');
    await select('查看规格版本', '第 1 版 · 草稿');
    await expect(sourceDialog.getByRole('table', { name: '逐项来源', exact: true })).toBeVisible();
    const versions = await readApi(`/api/type-library/specs/${detail.specs[0].id}`);
    assert.deepEqual(versions.versions.map(item => item.version), [2, 1]);
    assert.notEqual(versions.versions[0].workspace_id, versions.versions[1].workspace_id);
    await capture('旧版本来源仍可查看');
    await page.keyboard.press('Escape');
    const exportPaths = {};
    for (const [format, label] of [['json', '导出系列 JSON'], ['xlsx', '导出系列 Excel']]) {
      const exportedPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: label, exact: true }).click();
      const exported = await exportedPromise;
      const exportedPath = path.join(out, `series-${viewport.width}.${format}`);
      await exported.saveAs(exportedPath);
      assert.equal(await exported.failure(), null);
      exportPaths[format] = exportedPath;
    }
    await capture('型号与来源导出');
    const currentSeries = await readApi(`/api/type-library/series/${saved.series_id}`);
    exchangeTasks.push({ viewport, file: exportPaths[viewport.width === 1366 ? 'json' : 'xlsx'], name: currentSeries.series.name,
      specs: currentSeries.specs.map(spec => ({ name: spec.name, values: spec.values })) });
    await page.getByRole('tab', { name: '公开样本对照', exact: true }).click();
    await capture('公开样本对照入口');
    // Both public manuals are recomputed using their sealed methods. Each
    // metric is a real result or an explicit lack/refusal, never a made-up zero.
    for (const sample of [{ id: 'people-mv', label: '人民电器集团 · 8.7/15 kV 公开样本', count: 46 }, { id: 'bahra-mv', label: 'Bahra · 3.6/6 kV 单芯公开样本', count: 13 }]) {
      await select('公开样本手册', sample.label);
      const comparedPromise = page.waitForResponse(response => response.url().endsWith(`/catalogue-comparison/${sample.id}`) && response.request().method() === 'POST', { timeout: 300000 });
      await page.getByRole('button', { name: '计算样本偏差', exact: true }).click();
      const comparedResponse = await comparedPromise;
      assert.equal(comparedResponse.ok(), true, await comparedResponse.text());
      const compared = await comparedResponse.json();
      assert.equal(compared.rows.length, sample.count);
      assert.ok(compared.rows.every(row => row.metrics.weight.published > 0 && row.metrics.weight.value === null && row.metrics.weight.status === 'refused'), '厂家重量原值须保留；缺独立方法时必须拒绝计算重量');
      await page.getByRole('tab', { name: '载流量', exact: true }).click();
      await expect(page.getByRole('table', { name: '载流量逐规格对照', exact: true })).toBeVisible();
      await capture(`${sample.id}-载流量逐规格偏差`);
      await page.getByRole('tab', { name: '外径', exact: true }).click();
      await capture(`${sample.id}-外径输入保真非独立验证`);
      await page.getByRole('tab', { name: '重量', exact: true }).click();
      await capture(`${sample.id}-重量缺少独立数据`);
      await page.getByRole('tab', { name: '导体直流电阻', exact: true }).click();
      await capture(`${sample.id}-电阻来源与限制`);
    }
    report.checks.push(`${viewport.width}：人民46规格与Bahra13规格逐一公开样本对照，四项指标分别截图；重量缺独立数据，输入回读不冒充独立验证`);
  } catch (error) {
    report.failures.push({ viewport: viewport.width, message: String(error) });
    await page.screenshot({ path: path.join(out, `${viewport.width}-failure.png`) }).catch(() => {});
    await fs.writeFile(path.join(out, `${viewport.width}-failure.txt`), await page.locator('body').innerText().catch(() => '页面已关闭'));
    console.error(error);
  } finally { await context.close(); }
}
await browser.close();
if (exchangeTasks.length) {
  await fs.writeFile(path.join(out, 'exchange-tasks.json'), JSON.stringify(exchangeTasks, null, 2));
  const emptyDatabase = path.join(out, 'empty-target.sqlite');
  const python = process.env.E2E_PYTHON || path.join(root, '.venv', 'bin', 'python');
  execFileSync(python, ['-c', 'import sqlite3,sys; sqlite3.connect(sys.argv[1]).close()', emptyDatabase]);
  try {
    execFileSync(process.execPath, [path.join(root, 'frontend/scripts/isolated-e2e.mjs'), 'library-exchange-walk.mjs'], {
      cwd: root, stdio: 'inherit', timeout: 600000,
      env: { ...process.env, E2E_DATABASE_SOURCE: emptyDatabase, E2E_EXCHANGE_TASKS: path.join(out, 'exchange-tasks.json'), LIBRARY_IMPORT_EVIDENCE: out },
    });
    const exchange = JSON.parse(await fs.readFile(path.join(out, 'exchange-report.json'), 'utf8'));
    report.checks.push(...exchange.checks); report.screenshots.push(...exchange.screenshots);
  } catch (error) { report.failures.push({ phase: '全新库交换导入', message: String(error) }); }
  await fs.rm(emptyDatabase, { force: true });
}
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
assert.deepEqual(report.errors, [], '控制台或网络存在错误');
assert.deepEqual(report.failures, [], '真实导入流程未通过');
assert.deepEqual(report.layout_failures, [], '截图布局或可见名称检查未通过');
console.log(JSON.stringify({ checks: report.checks, screenshots: report.screenshots.length, output: out }, null, 2));
