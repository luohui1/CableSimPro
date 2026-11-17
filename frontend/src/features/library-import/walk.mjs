import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const report = { checks: [], screenshots: [], errors: [], requests: [], failures: [], layout_failures: [], dialog_positions: [] };
const saveReport = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
await saveReport();
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
    await page.waitForFunction(() => [...document.querySelectorAll('.dialog-stage')].every(stage => Number(getComputedStyle(stage).opacity) >= .999));
    const name = `${viewport.width}-${String(++shot).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: path.join(out, name) });
    await fs.writeFile(path.join(out, name.replace('.png', '.txt')), await page.locator('body').innerText());
    report.screenshots.push(name);
    try {
      const dialog = page.getByRole('dialog');
      if (await dialog.count()) {
        await expect(dialog.locator('.dialog-title')).toBeInViewport({ ratio: 1 });
        for (const action of await dialog.locator('.dialog-actions button').all()) await expect(action).toBeInViewport({ ratio: 1 });
      }
      await assertLayout(page, `${viewport.width} ${label}`);
    }
    catch (error) { report.layout_failures.push({ viewport: viewport.width, screenshot: name, message: String(error) }); }
    await saveReport();
    console.log(`${viewport.width} ${label}`);
  }
  async function afterAction(waiter, action) {
    const [result] = await Promise.all([waiter, Promise.resolve().then(action)]);
    return result;
  }
  async function positionDialogContent(locator) {
    const position = await locator.evaluate(element => {
      const container = element.closest('.library-import-dialog-body');
      if (!(container instanceof HTMLElement)) throw new Error('来源内容没有对应的对话框滚动区域');
      const inset = Number.parseFloat(getComputedStyle(container).getPropertyValue('--space-2'));
      if (!Number.isFinite(inset) || inset <= 0) throw new Error('缺少对话框内容的显示间距');
      const before = element.getBoundingClientRect();
      const bounds = container.getBoundingClientRect();
      // Move only the real scroll region. Keep the whole row inside its top
      // edge instead of asking every ancestor to align to a fractional pixel.
      container.scrollTo({ top: Math.floor(container.scrollTop + before.top - bounds.top - inset), behavior: 'instant' });
      const after = element.getBoundingClientRect();
      return { label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 120),
        before: { top: before.top, bottom: before.bottom, height: before.height },
        after: { top: after.top, bottom: after.bottom, height: after.height },
        container: { top: bounds.top, bottom: bounds.bottom, height: bounds.height }, inset };
    });
    report.dialog_positions.push({ viewport: viewport.width, ...position });
  }
  async function select(label, option) {
    const field = page.getByRole('combobox', { name: label, exact: true });
    if (viewport.width === 1920) {
      await field.click();
      await page.getByRole('option', { name: option, exact: true }).click();
      return;
    }
    await field.focus();
    await page.keyboard.press('Enter');
    const choices = page.getByRole('option');
    await expect(page.getByRole('option', { name: option, exact: true })).toBeVisible();
    await expect(page.locator('[role="option"]:focus')).toHaveCount(1);
    const index = await choices.evaluateAll((items, label) => items.findIndex(item => item.textContent.replace(/✓/g, '').trim() === label), option);
    assert.ok(index >= 0, `键盘选择缺少选项：${label} / ${option}`);
    await page.keyboard.press('Home');
    await expect(choices.first()).toBeFocused();
    for (let i = 1; i <= index; i++) {
      await page.keyboard.press('ArrowDown');
      await expect(choices.nth(i)).toBeFocused();
    }
    await page.keyboard.press('Enter');
    await expect(field).toHaveText(option);
    await expect(field).toBeFocused();
  }
  async function recordResponse(name, response, body) {
    await fs.writeFile(path.join(out, `${viewport.width}-${name}.json`), JSON.stringify({ request: response.request().postDataJSON(), status: response.status(), response: body }, null, 2));
  }
  async function advanceSheet() {
    await page.getByRole('button', { name: '确认工作表，设置列映射', exact: true }).click();
    await expect(page.getByRole('heading', { name: '确认列映射', exact: true })).toBeVisible();
  }
  async function preview() {
    const result = await afterAction(page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/preview') && response.request().method() === 'POST', { timeout: 180000 }),
      () => page.getByRole('button', { name: '逐行校验并预览', exact: true }).click());
    assert.equal(result.status(), 200, await result.text());
    await expect(page.getByRole('heading', { name: '核对入库预览', exact: true })).toBeVisible();
    return result.json();
  }
  try {
    await page.goto(base + '/resources/cables/structure-import');
    await expect(page.getByRole('button', { name: '选择结构表文件', exact: true })).toBeEnabled();
    await expect(page.getByText('读取中', { exact: true })).toHaveCount(0);
    await capture('选择文件');
    const download = await afterAction(page.waitForEvent('download'),
      () => page.getByRole('link', { name: '下载人民电缆示例结构表', exact: true }).click());
    const samplePath = path.join(out, `people-mv-${viewport.width}.xlsx`);
    await download.saveAs(samplePath);
    assert.equal(await download.failure(), null);

    const uploadCount = () => report.requests.filter(item => item.viewport === viewport.width && item.method === 'POST' && item.url.endsWith('/api/type-library/imports/upload')).length;
    const beforeInvalid = uploadCount();
    for (const [name, buffer, reason] of [
      ['unsupported.tsv', Buffer.from('截面\t外径\n25\t10'), '.xlsx、.xls 或 .csv'],
      ['oversized.csv', Buffer.alloc(10 * 1024 * 1024 + 1, 32), '不超过 10 MiB'],
      ['empty.csv', Buffer.alloc(0), '非空'],
    ]) {
      await page.getByLabel('结构表文件', { exact: true }).setInputFiles({ name, mimeType: 'text/plain', buffer });
      await expect(page.getByRole('alert')).toContainText(reason);
      assert.equal(uploadCount(), beforeInvalid, '不支持的格式、超限或空文件不应提交给服务器');
    }
    await capture('格式大小与空文件边界');
    report.checks.push(`${viewport.width}：文件选择与后端统一为xlsx/xls/csv、10 MiB；格式不支持、超限及空文件在上传前准确拒绝`);

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
    const uploadResponse = await afterAction(page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/upload') && response.request().method() === 'POST'),
      () => page.getByLabel('结构表文件', { exact: true }).setInputFiles(samplePath));
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
    await expect(page.getByRole('combobox', { name: '复用已保存映射', exact: true })).toHaveText(mapName);
    await page.getByRole('heading', { name: '确认列映射', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await capture('映射保存与复用');
    await page.getByRole('button', { name: '填写系列声明', exact: true }).click();
    await page.getByRole('form', { name: '系列声明' }).getByLabel('系列名称', { exact: true }).fill(`人民 YJV22 公开样本 ${viewport.width} ${stamp}`);
    await capture('公开来源与系列声明');
    // Hold the real API response so editing or going back can happen in flight.
    // No response data is mocked and no outdated preview may become confirmable.
    for (const action of ['edit', 'back']) {
      let releaseResponse;
      const release = new Promise(resolve => { releaseResponse = resolve; });
      const ready = Promise.withResolvers();
      const delayed = async route => {
        try {
          const response = await route.fetch({ timeout: 180000 });
          ready.resolve(response);
          await release;
          await route.fulfill({ response });
        } catch (error) { ready.reject(error); throw error; }
      };
      await page.route('**/api/type-library/imports/preview', delayed, { times: 1 });
      try {
        const delivered = page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/preview') && response.request().method() === 'POST', { timeout: 180000 });
        await page.getByRole('button', { name: '逐行校验并预览', exact: true }).click();
        const actual = await ready.promise;
        assert.equal(actual.ok(), true, await actual.text());
        if (action === 'edit') await page.getByRole('form', { name: '系列声明' }).getByLabel('系列名称', { exact: true }).fill(`人民 YJV22 已核对 ${viewport.width} ${stamp}`);
        else await page.getByRole('button', { name: '上一步', exact: true }).click();
        releaseResponse();
        assert.equal((await delivered).ok(), true);
        await expect(page.getByRole('alert')).toContainText('本次旧预览已作废');
        await expect(page.getByRole('heading', { name: action === 'edit' ? '填写系列声明与来源' : '确认列映射', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /^确认入库/ })).toHaveCount(0);
        await capture(action === 'edit' ? '修改声明后旧预览拒绝生效' : '返回列映射后旧预览拒绝跳转');
        if (action === 'back') await page.getByRole('button', { name: '填写系列声明', exact: true }).click();
        await expect(page.getByRole('form', { name: '系列声明' }).getByLabel('系列名称', { exact: true })).toHaveValue(`人民 YJV22 已核对 ${viewport.width} ${stamp}`);
      } finally {
        releaseResponse();
        await page.unroute('**/api/type-library/imports/preview', delayed);
      }
    }
    const built = await preview();
    assert.equal(built.series.name, `人民 YJV22 已核对 ${viewport.width} ${stamp}`);
    report.checks.push(`${viewport.width}：延迟真实预览响应期间修改系列声明或返回列映射，旧响应均作废且不能确认；再次预览严格对应最后保存的声明`);
    assert.equal(built.error_count, 0, '原始公开样本不应有解析错误');
    assert.equal(built.rows.length, 11);
    await capture('逐规格预览');
    const sourceOpener = page.getByRole('table', { name: '逐行入库预览', exact: true }).getByRole('button', { name: built.rows[0].name, exact: true });
    await sourceOpener.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('table', { name: '逐项来源', exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: '逐项来源', exact: true }).getByRole('columnheader', { name: '参数', exact: true })).toBeInViewport();
    await capture('预览数值与逐项出处');
    await page.keyboard.press('Escape');
    await expect(sourceOpener).toBeFocused();
    assert.ok(built.execution_standards?.items.length, '已声明的执行标准须返回精确来源，供人工确认');
    assert.ok(built.execution_standards.items.every(item => /^[0-9a-f]{64}$/.test(item.source_digest)));
    await page.getByRole('heading', { name: '执行标准版本与来源', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await capture('执行标准完整来源确认');
    const commitButton = page.getByRole('button', { name: '确认入库 11 个规格', exact: true });
    await expect(commitButton).toBeDisabled();
    await page.getByRole('checkbox', { name: '确认来源与系列声明', exact: true }).check();
    const savedResponse = await afterAction(page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/commit') && response.request().method() === 'POST', { timeout: 180000 }),
      () => commitButton.click());
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
    await page.getByRole('button', { name: '全部系列', exact: true }).click();
    await page.getByLabel('查找系列', { exact: true }).fill(detail.series.name);
    const seriesOpener = page.getByRole('table', { name: '型号系列', exact: true }).getByRole('button', { name: detail.series.name, exact: true });
    await expect(seriesOpener).toBeVisible();
    await capture('返回全库查找系列');
    await seriesOpener.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('table', { name: '系列规格', exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: '选择全部规格', exact: true }).check();
    await page.getByRole('button', { name: '批量核对', exact: true }).click();
    await capture('批量核对版本确认');
    const dialog = page.getByRole('dialog', { name: '批量标准核对', exact: true });
    await expect(dialog.getByRole('button', { name: '确认执行 11 个规格', exact: true })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: '确认所选规格与版本', exact: true }).check();
    const batchResponse = await afterAction(page.waitForResponse(response => response.url().includes(`/series/${saved.series_id}/batch`) && response.request().method() === 'POST', { timeout: 300000 }),
      () => dialog.getByRole('button', { name: '确认执行 11 个规格', exact: true }).click());
    assert.equal(batchResponse.ok(), true, await batchResponse.text());
    const batch = await batchResponse.json();
    await recordResponse('batch-check', batchResponse, batch);
    assert.equal(batch.items.length, 11);
    await expect(page.getByRole('table', { name: '批量操作结果', exact: true })).toBeVisible();
    await page.getByRole('heading', { name: '本次批量操作结果', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await capture('真实批量核对结果');
    assert.ok(batch.items.some(item => item.run_id && item.checks?.length), '批量核对须保存真实标准核对运行');

    await page.getByRole('button', { name: '批量计算', exact: true }).click();
    const calculation = page.getByRole('dialog', { name: '批量计算', exact: true });
    await expect(calculation.getByRole('button', { name: '确认执行 11 个规格', exact: true })).toBeDisabled();
    for (const [label, value] of [
      ['工况名称', '显式研究工况直埋对照'], ['中心埋深 m', '0.7'], ['土壤热阻率 K·m/W', '1.0'],
      ['环境温度 °C', '25'], ['交流频率 Hz', '50'], ['集肤效应系数 kₛ 1', '1'], ['邻近效应系数 kₚ 1', '1'],
      ['护套初始温度 °C', '70'], ['电流收敛容差 A', '0.00000001'], ['最大迭代次数 次', '300'],
      ['工况来源', '人民电器集团公开样本直埋条件：土壤25 °C，热阻率1.0 K·m/W。原表未列埋深，验收明确采用0.7 m，两端接地；50 Hz来自原PDF使用特性。'],
      ['方法参数来源', 'IEC 60287公开样本回归条件：kₛ=1、kₚ=1、土壤热阻精确式，涡流损耗明确忽略；迭代护套初值70 °C、电流容差1×10⁻⁸ A、上限300次来自库内公开样本回归设置。初值不是实测温度；本轮验证真实方法运行和缺项拒算，不作为厂家试验数据。'],
    ]) await calculation.getByLabel(label, { exact: true }).fill(value);
    await select('金属套接地', '两端接地');
    await select('护套涡流损耗', '明确忽略（须核对适用条件）');
    await select('土壤热阻公式', '精确式');
    await calculation.getByRole('heading', { name: '统一计算工况', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await capture('批量计算明确工况');
    await calculation.getByRole('heading', { name: '求解初值与收敛控制', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await capture('批量计算显式求解控制');
    await calculation.getByLabel('确认所选规格与版本', { exact: true }).check();
    const ratedResponse = await afterAction(page.waitForResponse(response => response.url().includes(`/series/${saved.series_id}/batch`) && response.request().method() === 'POST', { timeout: 300000 }),
      () => calculation.getByRole('button', { name: '确认执行 11 个规格', exact: true }).click());
    assert.equal(ratedResponse.ok(), true, await ratedResponse.text());
    const rated = await ratedResponse.json();
    await recordResponse('batch-calculate', ratedResponse, rated);
    await expect(calculation).toBeHidden();
    await page.getByRole('heading', { name: '本次批量操作结果', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await capture('真实批量载流量结果');
    assert.equal(rated.items.length, 11);
    const calculated = rated.items.filter(item => item.run_id && item.rows?.some(row => typeof row.value_a === 'number' && row.value_a > 0));
    assert.equal(calculated.length, 10, 'YJV22原表11规格须保存10个真实载流量结果，3×50保留方法适用域拒算');
    const refused = rated.items.filter(item => !calculated.includes(item));
    assert.equal(refused.length, 1);
    assert.match(refused[0].name, /3\s*×\s*50$/);
    assert.match([refused[0].message, ...((refused[0].rows || []).map(row => row.reason))].join('；'), /填充|图6|SL_FILLER_GEOMETRY_RANGE/);

    await page.getByRole('button', { name: '批量审核', exact: true }).click();
    const review = page.getByRole('dialog', { name: '批量人工审核', exact: true });
    await select('审核动作', '批准已提交版本');
    await review.getByLabel('审核人', { exact: true }).fill('结构表验收工程师');
    await review.getByLabel('审核意见', { exact: true }).fill('核对审核门禁：这批导入草稿尚未提交审核，必须整批拒绝批准，保留草稿。');
    await review.getByLabel('确认所选规格与版本', { exact: true }).check();
    await capture('批量审核明确人工动作');
    const reviewedResponse = await afterAction(page.waitForResponse(response => response.url().includes(`/series/${saved.series_id}/batch`) && response.request().method() === 'POST', { timeout: 180000 }),
      () => review.getByRole('button', { name: '确认执行 11 个规格', exact: true }).click());
    assert.equal(reviewedResponse.ok(), true, await reviewedResponse.text());
    const reviewed = await reviewedResponse.json();
    await recordResponse('batch-review', reviewedResponse, reviewed);
    assert.ok(reviewed.items.every(item => item.status === 'failed' && /尚未提交|未提交审核/.test(item.message)), '未经提交的草稿须整批拒绝批准');
    const afterReview = await readApi(`/api/type-library/series/${saved.series_id}`);
    assert.ok(afterReview.specs.every(spec => spec.state !== 'approved' && spec.state !== 'published'));
    await expect(review).toBeHidden();
    await page.getByRole('heading', { name: '本次批量操作结果', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await capture('审核门禁真实拒绝');
    report.checks.push(`${viewport.width}：真实Excel上传→工作表→列映射保存复用→系列声明→11规格预览→人工确认入库→型号库→真实批量标准核对与载流量计算→未提交草稿整批拒绝批准，保存版本/来源可回读`);
    await page.reload();
    await expect(page.getByRole('table', { name: '系列规格', exact: true })).toBeVisible();
    await expect(page.getByText('读取中', { exact: true })).toHaveCount(0);
    await capture('刷新后同一系列');
    await page.getByRole('table', { name: '系列规格', exact: true }).getByRole('button', { name: detail.specs[0].name, exact: true }).click();
    await expect(page.getByRole('table', { name: '逐项来源', exact: true })).toBeVisible();
    await capture('每个数的原表来源');
    const sourceDialog = page.getByRole('dialog', { name: detail.specs[0].name, exact: true });
    await sourceDialog.getByText('将当前设计保存为新版本', { exact: true }).click();
    await sourceDialog.getByLabel('改版说明', { exact: true }).fill('验收从当前已保存的公开样本设计建立独立第2版，数值保持原始资料，核对旧版与来源保留。');
    await sourceDialog.getByLabel('确认保存型号新版本', { exact: true }).check();
    const revisionResponse = await afterAction(page.waitForResponse(response => response.url().endsWith(`/specs/${detail.specs[0].id}/revisions`) && response.request().method() === 'POST'),
      () => sourceDialog.getByRole('button', { name: '建立新版本草稿', exact: true }).click());
    assert.equal(revisionResponse.ok(), true, await revisionResponse.text());
    const revision = await revisionResponse.json();
    assert.equal(revision.version, 2);
    await expect(sourceDialog.getByRole('status').filter({ hasText: '已建立独立新版本草稿' })).toBeVisible();
    const closeState = { after_success_notice: {
      busy: await sourceDialog.getAttribute('aria-busy'),
      close_enabled: await sourceDialog.getByRole('button', { name: '关闭', exact: true }).isEnabled(),
      version_enabled: await sourceDialog.getByRole('combobox', { name: '查看规格版本', exact: true }).isEnabled(),
    } };
    await fs.writeFile(path.join(out, `${viewport.width}-revision-close-state.json`), JSON.stringify(closeState, null, 2));
    await expect(sourceDialog).toHaveAttribute('aria-busy', 'false');
    await expect(sourceDialog.getByRole('combobox', { name: '查看规格版本', exact: true })).toBeEnabled();
    closeState.settled = { busy: await sourceDialog.getAttribute('aria-busy'), close_enabled: await sourceDialog.getByRole('button', { name: '关闭', exact: true }).isEnabled() };
    await fs.writeFile(path.join(out, `${viewport.width}-revision-close-state.json`), JSON.stringify(closeState, null, 2));
    await sourceDialog.locator('.library-import-dialog-body').evaluate(element => element.scrollTo({ top: 0 }));
    await capture('独立新版本与旧版保留');
    await select('查看规格版本', '第 1 版 · 草稿');
    await expect(sourceDialog.getByRole('table', { name: '逐项来源', exact: true })).toBeVisible();
    const versions = await readApi(`/api/type-library/specs/${detail.specs[0].id}`);
    assert.deepEqual(versions.versions.map(item => item.version), [2, 1]);
    assert.notEqual(versions.versions[0].workspace_id, versions.versions[1].workspace_id);
    await capture('旧版本来源仍可查看');
    const versionSelector = sourceDialog.getByRole('combobox', { name: '查看规格版本', exact: true });
    await versionSelector.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(sourceDialog).toBeVisible();
    await expect(versionSelector).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sourceDialog).toBeHidden();
    report.checks.push(`${viewport.width}：版本选项打开时Escape只关选项；回到已闭合版本选择器后Escape关闭来源弹框`);
    const beforeExport = await readApi(`/api/type-library/series/${saved.series_id}`);
    await fs.writeFile(path.join(out, `${viewport.width}-before-export.json`), JSON.stringify(beforeExport, null, 2));
    const exportPaths = {};
    for (const [format, label] of [['json', '导出系列 JSON'], ['xlsx', '导出系列 Excel']]) {
      const [exported, exportResponse] = await Promise.all([
        page.waitForEvent('download'),
        page.waitForResponse(response => response.url().endsWith('/api/type-library/exchange/export') && response.request().method() === 'POST').then(async response => {
          const error = response.ok() ? null : await response.text();
          await fs.writeFile(path.join(out, `${viewport.width}-export-${format}-http.json`), JSON.stringify({
            request: response.request().postDataJSON(), status: response.status(), headers: response.headers(), error,
          }, null, 2));
          assert.equal(response.ok(), true, `系列${format}导出 HTTP ${response.status()}：${error}`);
          return response;
        }),
        Promise.resolve().then(() => page.getByRole('button', { name: label, exact: true }).click()),
      ]);
      const exportedPath = path.join(out, `series-${viewport.width}.${format}`);
      await exported.saveAs(exportedPath);
      assert.equal(await exported.failure(), null);
      const digest = createHash('sha256').update(await fs.readFile(exportedPath)).digest('hex');
      assert.equal(digest, exportResponse.headers()['x-content-sha256'], '浏览器下载字节须与服务端导出摘要一致');
      exportPaths[format] = exportedPath;
    }
    await capture('型号与来源导出');
    const currentSeries = await readApi(`/api/type-library/series/${saved.series_id}`);
    exchangeTasks.push({ viewport, file: exportPaths[viewport.width === 1366 ? 'json' : 'xlsx'], name: currentSeries.series.name,
      specs: currentSeries.specs.map(spec => ({ name: spec.name, values: spec.values })) });
    await page.getByRole('tab', { name: '公开样本对照', exact: true }).click();
    await capture('公开样本对照入口');
    // Manufacturer omissions must refuse a real comparison. Only a separate,
    // explicit human confirmation may execute the declared research scenario.
    for (const sample of [{ id: 'people-mv', label: '人民电器集团 · 8.7/15 kV 公开样本', count: 46, referenceCount: 21 }, { id: 'bahra-mv', label: 'Bahra · 3.6/6 kV 单芯公开样本', count: 13, referenceCount: 13 }]) {
      await select('公开样本手册', sample.label);
      const comparedResponse = await afterAction(page.waitForResponse(response => response.url().endsWith(`/catalogue-comparison/${sample.id}`) && response.request().method() === 'POST', { timeout: 300000 }),
        () => page.getByRole('button', { name: '核对厂家样本', exact: true }).click());
      assert.equal(comparedResponse.ok(), true, await comparedResponse.text());
      const compared = await comparedResponse.json();
      await recordResponse(`${sample.id}-manufacturer-comparison`, comparedResponse, compared);
      if (sample.id === 'bahra-mv') {
        assert.equal(compared.source.location, 'construction table: printed p. 17 / PDF p. 18; technical information: printed p. 18 / PDF p. 19; rating assumptions: printed p. 11 / PDF p. 12', '来源原始页码声明须保持不变');
        await expect(page.getByLabel('厂家样本来源', { exact: true })).toContainText('结构表：印刷第 17 页 / PDF 第 18 页; 技术信息：印刷第 18 页 / PDF 第 19 页; 载流量计算假设：印刷第 11 页 / PDF 第 12 页');
      }
      assert.deepEqual(comparedResponse.request().postDataJSON(), {}, '默认厂家核验不得隐含确认研究假设');
      assert.equal(compared.rows.length, sample.count);
      assert.deepEqual([compared.summary.ampacity_compared, compared.summary.ampacity_refused, compared.summary.four_metric_passed], [0, sample.count, 0]);
      assert.equal(compared.reference_calculation, null);
      assert.deepEqual([compared.reference_scenario.requires_confirmation, compared.reference_scenario.confirmed, compared.reference_scenario.executed, compared.reference_scenario.manufacturer_data], [true, false, false, false]);
      assert.ok(compared.reference_scenario.assumptions.length > 0);
      for (const row of compared.rows) {
        assert.deepEqual(Object.keys(row.metrics).sort(), ['ampacity', 'outer_diameter', 'r20', 'weight']);
        const ampacity = row.metrics.ampacity;
        assert.deepEqual([ampacity.value, ampacity.difference, ampacity.relative_difference, ampacity.status], [null, null, null, 'refused'], row.key);
        assert.ok(ampacity.published > 0 && ampacity.missing_fields.length > 0 && ampacity.reason.length > 0, row.key);
        assert.ok(ampacity.missing_fields.every(field => field.field && field.label && field.reason), row.key);
        const diameter = row.metrics.outer_diameter;
        assert.ok(diameter.published > 0, row.key);
        assert.deepEqual([diameter.value, diameter.status, diameter.difference, diameter.relative_difference], [diameter.published, 'declared_input', null, null], row.key);
        const resistance = row.metrics.r20;
        if (sample.id === 'people-mv') assert.deepEqual([resistance.published, resistance.value, resistance.status], [null, null, 'missing'], row.key);
        else {
          assert.ok(resistance.published > 0, row.key);
          assert.deepEqual([resistance.value, resistance.status], [resistance.published, 'declared_input'], row.key);
        }
        assert.deepEqual([resistance.difference, resistance.relative_difference], [null, null], row.key);
      }
      assert.ok(compared.rows.every(row => row.metrics.weight.published > 0 && row.metrics.weight.value === null && row.metrics.weight.status === 'refused'), '厂家重量原值须保留；缺独立方法时必须拒绝计算重量');
      await page.getByRole('tab', { name: '载流量', exact: true }).click();
      await expect(page.getByRole('table', { name: '载流量逐规格对照', exact: true })).toBeVisible();
      await expect(page.getByLabel('厂家独立核验总览', { exact: true })).toContainText('载流量可对照 0 个');
      await expect(page.getByRole('button', { name: '研究参考情景结果', exact: true })).toHaveCount(0);
      await page.getByRole('table', { name: '载流量逐规格对照', exact: true }).locator('thead').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await capture(`${sample.id}-厂家载流量缺项拒算`);
      await page.getByRole('tab', { name: '外径', exact: true }).click();
      await capture(`${sample.id}-外径输入保真非独立验证`);
      await page.getByRole('tab', { name: '重量', exact: true }).click();
      await capture(`${sample.id}-重量缺少独立数据`);
      await page.getByRole('tab', { name: '导体直流电阻', exact: true }).click();
      await capture(`${sample.id}-电阻来源与限制`);

      const comparisonRequests = () => report.requests.filter(item => item.viewport === viewport.width && item.method === 'POST' && item.url.endsWith(`/catalogue-comparison/${sample.id}`)).length;
      const beforeConfirmation = comparisonRequests();
      await page.getByRole('button', { name: '查看研究参考情景', exact: true }).click();
      const assumptionsDialog = page.getByRole('dialog', { name: '研究参考情景与完整假设', exact: true });
      const confirmReference = assumptionsDialog.getByRole('button', { name: '确认研究假设并计算', exact: true });
      const assumptionsTable = assumptionsDialog.getByRole('table', { name: '研究参考情景完整假设', exact: true });
      await expect(confirmReference).toBeDisabled();
      await expect(assumptionsDialog.getByLabel('确认研究参考假设', { exact: true })).not.toBeChecked();
      await expect(assumptionsTable.getByRole('row')).toHaveCount(compared.reference_scenario.assumptions.length + 1);
      const translatedReferences = new Map(sample.id === 'bahra-mv' ? [
        ['not in the catalogue; assumed for this comparison', '目录未列；本次研究参考对照所作假设。'],
        ["IEC 60287-1-1:2023 Table 3, unfilled XLPE up to 18 kV; standard reference values, not the manufacturer's", 'IEC 60287-1-1:2023 表 3，18 kV 及以下的未填充型 XLPE；标准参考值，不是厂家给定值。'],
        ['IEC 60287-1-1:2023 Table 1', 'IEC 60287-1-1:2023 表 1'],
      ] : []);
      for (const [index, assumption] of compared.reference_scenario.assumptions.entries()) {
        assert.deepEqual([assumption.confidence, assumption.manufacturer_data], ['reference', false]);
        assert.ok(assumption.source.reference && assumption.source.version && /^[a-f0-9]{64}$/.test(assumption.source.file_sha256));
        const cells = assumptionsTable.getByRole('row').nth(index + 1).getByRole('cell');
        await expect(cells.nth(0)).toHaveText(assumption.label);
        if (typeof assumption.value === 'number') await expect(cells.nth(1)).toHaveText(String(assumption.value));
        else if (assumption.value === null) await expect(cells.nth(1)).toHaveText('未提供');
        else await expect(cells.nth(1).getByRole('textbox')).toHaveValue(typeof assumption.value === 'string' ? assumption.value : JSON.stringify(assumption.value, null, 2));
        await expect(cells.nth(2)).toHaveText(assumption.unit ?? '不适用');
        await expect(cells.nth(3)).toContainText(translatedReferences.get(assumption.source.reference) ?? assumption.source.reference);
        await expect(cells.nth(3)).toContainText(assumption.source.version);
        await expect(cells.nth(3)).toContainText(assumption.source.file_sha256);
      }
      await expect(assumptionsTable.locator('thead')).toBeInViewport({ ratio: 1 });
      await capture(`${sample.id}-研究参考完整假设顶部`);
      await assumptionsTable.getByRole('row').last().evaluate(element => element.scrollIntoView({ block: 'center' }));
      await capture(`${sample.id}-研究假设末尾与版本`);
      await assumptionsDialog.getByText('展开完整原始声明', { exact: true }).click();
      const rawDeclaration = assumptionsDialog.getByRole('textbox', { name: '完整原始研究声明 JSON', exact: true });
      await expect(rawDeclaration).toHaveValue(JSON.stringify(compared.reference_scenario.raw_assumptions, null, 2));
      for (const original of translatedReferences.keys()) assert.ok((await rawDeclaration.inputValue()).includes(original), '中文解释不得改变原始研究声明中的来源原文');
      await rawDeclaration.evaluate(element => element.scrollIntoView({ block: 'start' }));
      await capture(`${sample.id}-完整原始研究声明`);
      assert.equal(comparisonRequests(), beforeConfirmation, '查看假设和原始声明不得触发参考计算');
      await assumptionsDialog.getByText('展开完整原始声明', { exact: true }).click();
      await assumptionsDialog.getByLabel('确认研究参考假设', { exact: true }).check();
      await expect(confirmReference).toBeEnabled();
      await capture(`${sample.id}-人工确认研究假设`);
      assert.equal(comparisonRequests(), beforeConfirmation, '仅勾选也不得提前提交参考计算');
      const referenceResponse = await afterAction(page.waitForResponse(response => response.url().endsWith(`/catalogue-comparison/${sample.id}`) && response.request().method() === 'POST', { timeout: 300000 }),
        () => confirmReference.click());
      assert.equal(referenceResponse.ok(), true, await referenceResponse.text());
      const reference = await referenceResponse.json();
      await recordResponse(`${sample.id}-reference-scenario`, referenceResponse, reference);
      assert.deepEqual(referenceResponse.request().postDataJSON(), { reference_scenario_confirmed: true });
      assert.deepEqual(reference.rows, compared.rows, '参考计算不能改变厂家原值、缺项或拒算');
      assert.deepEqual(reference.summary, compared.summary, '研究结果不能计入厂家独立核验通过数');
      assert.deepEqual(reference.reference_scenario.assumptions, compared.reference_scenario.assumptions, '执行的参考情景必须保留刚刚逐项确认的假设');
      assert.deepEqual(reference.reference_scenario.raw_assumptions, compared.reference_scenario.raw_assumptions, '执行的原始声明必须与人工查看的一致');
      assert.deepEqual([reference.reference_scenario.confirmed, reference.reference_scenario.executed, reference.reference_scenario.manufacturer_data], [true, true, false]);
      const calculated = reference.reference_calculation;
      assert.ok(calculated && calculated.manufacturer_comparison === false && calculated.human_reviewed === false);
      assert.equal(calculated.rows.length, sample.count);
      assert.deepEqual([calculated.summary.ampacity_compared, calculated.summary.ampacity_refused], [sample.referenceCount, sample.count - sample.referenceCount]);
      for (const row of calculated.rows) {
        const ampacity = row.metrics.ampacity;
        if (ampacity.status === 'compared') {
          assert.ok(Number.isFinite(ampacity.value) && ampacity.value > 0 && ampacity.published > 0, row.key);
          assert.ok(Math.abs(ampacity.difference - (ampacity.value - ampacity.published)) < 1e-9, row.key);
          assert.ok(Math.abs(ampacity.relative_difference - ampacity.difference / ampacity.published) < 1e-12, row.key);
          assert.ok(ampacity.method && ampacity.tier && ampacity.reason, row.key);
        } else assert.deepEqual([ampacity.status, ampacity.value, ampacity.difference, ampacity.relative_difference], ['refused', null, null, null], row.key);
        assert.deepEqual([row.metrics.weight.value, row.metrics.weight.status], [null, 'refused'], row.key);
      }
      await expect(assumptionsDialog).toBeHidden();
      await page.getByRole('tab', { name: '载流量', exact: true }).click();
      await expect(page.getByRole('button', { name: '研究参考情景结果', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByLabel('厂家独立核验总览', { exact: true })).toContainText('载流量可对照 0 个');
      await page.getByRole('heading', { name: '研究参考情景结果', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
      await capture(`${sample.id}-研究参考结果单列`);
      const firstCalculated = calculated.rows.findIndex(row => row.metrics.ampacity.status === 'compared');
      assert.ok(firstCalculated >= 0, '明确确认的参考情景须保留真实方法数值');
      const calculatedRow = page.getByRole('table', { name: '研究情景载流量逐规格对照', exact: true }).getByRole('row').nth(firstCalculated + 1);
      await expect(calculatedRow).toContainText(calculated.rows[firstCalculated].metrics.ampacity.value.toLocaleString('zh-CN', { maximumFractionDigits: 3, useGrouping: false }));
      await expect(calculatedRow).toContainText('研究参考值，非厂家核验');
      await expect(calculatedRow).toContainText('厂家核验仍为拒绝计算');
      await calculatedRow.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await capture(`${sample.id}-研究参考数值差异与厂家拒绝并列`);
      await page.getByRole('button', { name: '厂家数据与缺项', exact: true }).click();
      const manufacturerTable = page.getByRole('table', { name: '载流量逐规格对照', exact: true });
      await expect(manufacturerTable.getByRole('row').nth(1)).toContainText('未给出结果');
      await expect(manufacturerTable.getByRole('row').nth(1)).toContainText('拒绝计算');
      await manufacturerTable.locator('thead').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await capture(`${sample.id}-参考计算后厂家仍缺项拒算`);
    }
    report.checks.push(`${viewport.width}：人民46规格与Bahra13规格默认厂家条件缺项全部拒算；四项原值与原因分别截图；全部研究假设及原始声明逐字核对，人工明确确认后单列21/13项参考数值与差异，厂家拒绝与零真实通过数保持不变；两份完整JSON已保存`);

    // Import the complete, unchanged Bahra workbook through the visible entry.
    // Catalogue performance values remain evidence, never engineering inputs.
    await page.getByRole('tab', { name: '导入结构表', exact: true }).click();
    const restart = page.getByRole('button', { name: '重新开始', exact: true });
    if (await restart.isVisible()) await restart.click();
    const bahraDownload = await afterAction(page.waitForEvent('download'),
      () => page.getByRole('link', { name: '下载 Bahra 示例结构性能表', exact: true }).click());
    assert.equal(bahraDownload.suggestedFilename(), 'bahra-mv.xlsx');
    const bahraPath = path.join(out, `bahra-mv-${viewport.width}.xlsx`);
    await bahraDownload.saveAs(bahraPath);
    assert.equal(await bahraDownload.failure(), null);
    const bahraDigest = createHash('sha256').update(await fs.readFile(bahraPath)).digest('hex');
    const bahraManifest = (await readApi('/api/type-library/samples')).find(sample => sample.id === 'bahra-mv');
    assert.equal(bahraManifest?.sha256, bahraDigest, '下载字节须匹配本次服务发布的原件摘要');
    const bahraOriginal = JSON.parse(await fs.readFile(path.join(root, 'backend/kernel/catalogue_core/catalogues/bahra_mv_lead_sheathed.json'), 'utf8'));
    const bahraColumns = [
      ['area', 'mm²', 'm2', 1e-6], ['conductor_diameter', 'mm', 'm', 1e-3],
      ['insulation_thickness', 'mm', 'm', 1e-3], ['metallic_sheath_thickness', 'mm', 'm', 1e-3],
      ['oversheath_thickness', 'mm', 'm', 1e-3], ['outer_diameter', 'mm', 'm', 1e-3],
      ['weight', 'kg/km', 'kg/m', 1e-3], ['r20', 'Ω/km', 'ohm/m', 1e-3],
      ['r_ac_90', 'Ω/km', 'ohm/m', 1e-3], ['inductance', 'mH/km', 'H/m', 1e-6],
      ['capacitance', 'uF/km', 'F/m', 1e-9], ['short_circuit_conductor', 'kA', 'A', 1e3],
      ['short_circuit_sheath', 'kA', 'A', 1e3], ['ampacity', 'A', 'A', 1],
      ['rating_ground_flat', 'A', 'A', 1], ['rating_air_trefoil', 'A', 'A', 1],
      ['rating_air_flat', 'A', 'A', 1], ['voltage_drop', 'V/(A km)', 'V/(A m)', 1e-3],
      ['minimum_bending_radius', 'mm', 'm', 1e-3],
    ];
    const bahraAliases = { lead_sheath_thickness: 'metallic_sheath_thickness', r_dc_20: 'r20', rating_ground_trefoil: 'ampacity' };
    assert.deepEqual(bahraOriginal.columns.map(([key]) => bahraAliases[key] ?? key), bahraColumns.map(([key]) => key));
    assert.equal(bahraOriginal.rows.length, 13);
    const catalogueResults = new Set(bahraColumns.slice(8).map(([key]) => key));
    const bahraUploaded = await afterAction(page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/upload') && response.request().method() === 'POST'),
      () => page.getByLabel('结构表文件', { exact: true }).setInputFiles(bahraPath));
    assert.equal(bahraUploaded.ok(), true, await bahraUploaded.text());
    const bahraInspection = await bahraUploaded.json();
    await recordResponse('bahra-upload', bahraUploaded, bahraInspection);
    assert.equal(bahraInspection.sha256, bahraDigest);
    const bahraSheet = bahraInspection.sheets.find(sheet => sheet.name === 'Bahra CU XLPE LC PVC');
    const bahraDeclaration = bahraInspection.declarations.find(item => item.sheet === bahraSheet?.name);
    assert.ok(bahraSheet && bahraDeclaration, '完整原件应识别公开样本工作表与声明');
    assert.equal(bahraSheet.columns.length, 19);
    assert.deepEqual([bahraSheet.first_data_row, bahraSheet.rows, bahraSheet.data_rows], [5, 19, 15], '原表数据区包含13个规格、空行及页尾说明，预览须准确分辨');
    const bahraMapping = Object.fromEntries(bahraColumns.map(([key], index) => [key, index]));
    assert.deepEqual(bahraDeclaration.mapping, bahraMapping, '19个原表列均须可导入，不能悄悄遗漏性能列');
    await select('工作表', `${bahraSheet.name} · ${bahraSheet.data_rows ?? bahraSheet.rows} 行`);
    await expect(page.getByRole('table', { name: '工作表原始列', exact: true })).toContainText('电容 μF/km');
    await capture('Bahra上传后选择工作表');
    await advanceSheet();
    for (const [index, [key, unit]] of bahraColumns.entries()) {
      const field = bahraInspection.fields.find(item => item.key === key);
      assert.ok(field, `导入字段缺少 ${key}`);
      assert.equal(field.unit, unit);
      await expect(page.getByRole('combobox', { name: `${String.fromCharCode(65 + index)} 列对应`, exact: true })).toHaveText(`${field.label} / ${unit.replace('uF', 'μF')}`);
    }
    await select('L 列对应', '样本导体短路电流（1 s） / kA');
    await page.getByRole('combobox', { name: 'I 列对应', exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }));
    await capture('Bahra十九列映射与性能字段');
    await page.getByRole('button', { name: '填写系列声明', exact: true }).click();
    await expect(page.getByText('计算参数与来源尚未提供；预览将保留缺项，需补齐后才能计算。', { exact: true })).toBeVisible();
    await page.getByRole('form', { name: '系列声明' }).getByLabel('系列名称', { exact: true }).fill(`Bahra 公开结构与性能 ${viewport.width} ${stamp}`);
    const bahraPreviewResponse = await afterAction(page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/preview') && response.request().method() === 'POST', { timeout: 180000 }),
      () => page.getByRole('button', { name: '逐行校验并预览', exact: true }).click());
    assert.equal(bahraPreviewResponse.ok(), true, await bahraPreviewResponse.text());
    assert.deepEqual(bahraPreviewResponse.request().postDataJSON().mapping, bahraMapping);
    assert.deepEqual(bahraPreviewResponse.request().postDataJSON().series.modelling, {}, '未提供的计算参数须保持为空，不能自动采用研究参考值');
    const bahraPreview = await bahraPreviewResponse.json();
    await recordResponse('bahra-preview', bahraPreviewResponse, bahraPreview);
    assert.deepEqual([bahraPreview.rows.length, bahraPreview.error_count, bahraPreview.incomplete_count], [13, 0, 13]);
    const checkBahraFacts = (facts, originalIndex) => {
      assert.deepEqual(facts.map(fact => fact.key).sort(), bahraColumns.map(([key]) => key).sort());
      for (const [column, [key, displayUnit, unit, scale]] of bahraColumns.entries()) {
        const fact = facts.find(item => item.key === key);
        const original = bahraOriginal.rows[originalIndex][column];
        assert.deepEqual([fact.display_value, fact.display_unit, fact.value, fact.unit], [original, displayUnit, original * scale, unit], `${originalIndex + 5}行 ${key}`);
        assert.equal(fact.label, bahraInspection.fields.find(item => item.key === key).label);
        assert.deepEqual(fact.method, { name: '厂家结构表导入', version: '1.1.0' });
        assert.equal(fact.confidence, 'reference');
        assert.equal(fact.usage, catalogueResults.has(key) ? 'catalogue_result' : undefined);
        assert.equal(fact.source.usage, fact.usage);
        if (catalogueResults.has(key)) assert.deepEqual(fact.source.conditions, bahraOriginal.conditions, '目录工况与1s短路时间须保留，不补接地或平排间距');
        assert.deepEqual([fact.source.file, fact.source.file_sha256, fact.source.sheet, fact.source.row, fact.source.column, fact.source.field],
          [bahraInspection.file, bahraDigest, bahraSheet.name, originalIndex + 5, String.fromCharCode(65 + column), key]);
        assert.deepEqual([fact.source.kind, fact.source.origin, fact.source.confidence, fact.source.reviewed], ['manufacturer', 'table', 'reference', false]);
        assert.deepEqual(fact.source.method, fact.method);
        for (const sourceKey of ['title', 'location', 'sha256']) assert.equal(fact.source.catalogue[sourceKey], bahraOriginal.source[sourceKey]);
        assert.equal(fact.source.catalogue.url, 'https://www.bahra-electric.com/Downloads/MV_Lead_Sheathed.pdf');
      }
    };
    for (const [index, row] of bahraPreview.rows.entries()) {
      assert.equal(row.row_number, index + 5);
      assert.equal(row.status, 'incomplete');
      assert.ok(row.missing.length > 0, '样本性能列不得补成未公布的结构');
      checkBahraFacts(row.values, index);
    }
    await expect(page.getByRole('heading', { name: '核对入库预览', exact: true })).toBeVisible();
    const bahraPreviewTable = page.getByRole('table', { name: '逐行入库预览', exact: true });
    for (const missing of ['结构尺寸：导体屏蔽厚度', '结构尺寸：绝缘屏蔽厚度', '计算用参数：导体构造', '计算用参数：正常运行温限（K）',
      '材料物性：导体20 °C 电阻温度系数', '材料物性：绝缘热阻率', '材料物性：绝缘相对介电常数', '材料物性：绝缘介质损耗角正切',
      '材料物性：金属套20 °C 电阻率', '材料物性：金属套20 °C 电阻温度系数', '材料物性：外护套热阻率']) await expect(bahraPreviewTable).toContainText(missing);
    await capture('Bahra十三规格预览');
    const bahraCommit = page.getByRole('button', { name: '确认入库 13 个规格', exact: true });
    await expect(bahraCommit).toBeDisabled();
    await page.getByRole('checkbox', { name: '确认来源与系列声明', exact: true }).check();
    const bahraCommitted = await afterAction(page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/commit') && response.request().method() === 'POST', { timeout: 180000 }),
      () => bahraCommit.click());
    assert.equal(bahraCommitted.ok(), true, await bahraCommitted.text());
    const bahraReceipt = await bahraCommitted.json();
    await recordResponse('bahra-commit', bahraCommitted, bahraReceipt);
    assert.equal(bahraReceipt.created, 13);
    await expect(page.getByRole('heading', { name: '已保存 13 个规格草稿', exact: true })).toBeVisible();
    await capture('Bahra十三规格人工确认入库');
    const bahraSeries = await readApi(`/api/type-library/series/${bahraReceipt.series_id}`);
    assert.equal(bahraSeries.specs.length, 13);
    const bahraSpecs = await Promise.all(bahraSeries.specs.map(spec => readApi(`/api/type-library/specs/${spec.id}`)));
    const bahraModelIds = new Set(bahraSeries.specs.map(spec => spec.model_id));
    const bahraModels = (await readApi('/api/domain-cable-models')).filter(model => bahraModelIds.has(model.id));
    await fs.writeFile(path.join(out, `${viewport.width}-bahra-imported-values.json`), JSON.stringify({ workbook_sha256: bahraDigest, sample: bahraManifest, series: bahraSeries, specifications: bahraSpecs, models: bahraModels }, null, 2));
    assert.equal(bahraModels.length, 13);
    assert.deepEqual(bahraSeries.specs.map(spec => spec.area_m2).sort((a, b) => a - b), bahraOriginal.rows.map(row => row[0] * 1e-6));
    for (const [index, item] of bahraSpecs.entries()) {
      const spec = bahraSeries.specs[index];
      const originalIndex = bahraOriginal.rows.findIndex(row => row[0] * 1e-6 === spec.area_m2);
      assert.ok(originalIndex >= 0);
      checkBahraFacts(item.values, originalIndex);
      assert.deepEqual(item.values, spec.values);
      assert.deepEqual(item.values, bahraPreview.rows[originalIndex].values, '预览确认后逐项事实须完整保持');
      assert.equal(item.spec.state, 'draft');
      assert.ok(item.spec.missing.length > 0);
      assert.deepEqual(item.results, [], '目录性能值不应制造计算运行');
      const model = bahraModels.find(candidate => candidate.id === spec.model_id);
      assert.equal(model.state, 'incomplete');
      for (const key of catalogueResults) {
        assert.equal(Object.hasOwn(model.payload.specification.values, key), false, `${key}不能进入工程结构输入`);
        assert.equal(JSON.parse(model.payload.sources[key].reference).file_sha256, bahraDigest);
      }
    }
    await page.getByRole('button', { name: '打开系列，核对与计算', exact: true }).click();
    const bahraFirst = bahraSeries.specs.find(spec => spec.area_m2 === bahraOriginal.rows[0][0] * 1e-6);
    await page.getByRole('table', { name: '系列规格', exact: true }).getByRole('button', { name: bahraFirst.name, exact: true }).click();
    const bahraSources = page.getByRole('dialog', { name: bahraFirst.name, exact: true });
    const bahraValues = bahraSources.getByRole('table', { name: '逐项来源', exact: true });
    await expect(bahraValues.getByRole('row')).toHaveCount(20);
    await expect(bahraSources.getByText('样本性能值来自厂家目录，供对照；独立计算需完整结构与工况。', { exact: true })).toBeVisible();
    for (const fact of bahraFirst.values) {
      const cells = bahraValues.getByRole('row', { name: fact.label, exact: true }).getByRole('cell');
      await expect(cells.nth(1)).toHaveText(`${fact.display_value} ${fact.display_unit.replace('uF', 'μF')}`);
      await expect(cells.nth(2)).toContainText(`${fact.source.file} · ${fact.source.sheet} · 第 ${fact.source.row} 行 · ${fact.source.column}`);
      await expect(cells.nth(3)).toContainText('厂家结构表导入 · 1.1.0');
      await expect(cells.nth(3)).toContainText('参考');
      if (catalogueResults.has(fact.key)) {
        await expect(cells.nth(0)).toContainText('厂家目录值 · 供对照');
        await expect(cells.nth(2).locator('summary')).toHaveText('查看目录适用条件');
      }
    }
    const sourceScreenshots = [];
    for (const [label, keys] of [
      ['Bahra性能来源电阻电感电容', ['r_ac_90', 'inductance', 'capacitance']],
      ['Bahra性能来源一秒短路电流', ['short_circuit_conductor', 'short_circuit_sheath']],
      ['Bahra性能来源各敷设载流量', ['ampacity', 'rating_ground_flat', 'rating_air_trefoil', 'rating_air_flat']],
      ['Bahra性能来源电压降与弯曲半径', ['voltage_drop', 'minimum_bending_radius']],
    ]) {
      let start = 0;
      while (start < keys.length) {
        const first = bahraFirst.values.find(fact => fact.key === keys[start]);
        await positionDialogContent(bahraValues.getByRole('row', { name: first.label, exact: true }));
        const bounds = await bahraSources.locator('.library-import-dialog-body').boundingBox();
        assert.ok(bounds);
        let end = start;
        while (end < keys.length) {
          const fact = bahraFirst.values.find(item => item.key === keys[end]);
          const row = bahraValues.getByRole('row', { name: fact.label, exact: true });
          const box = await row.boundingBox();
          if (!box || box.y < bounds.y || box.y + box.height > bounds.y + bounds.height) break;
          await expect(row).toBeInViewport({ ratio: 1 });
          end++;
        }
        assert.ok(end > start, `${first.label}的完整来源行应能在对话框中查看`);
        await capture(label + (start ? '续页' : ''));
        sourceScreenshots.push({ screenshot: report.screenshots.at(-1), fields: keys.slice(start, end) });
        start = end;
      }
    }
    await fs.writeFile(path.join(out, `${viewport.width}-bahra-source-screenshots.json`), JSON.stringify(sourceScreenshots, null, 2));
    assert.deepEqual(sourceScreenshots.flatMap(item => item.fields).sort(), [...catalogueResults].sort());
    await expect(bahraValues.locator('.library-import-value-conditions')).toHaveCount(11);
    const conditionFact = bahraFirst.values.find(fact => fact.key === 'short_circuit_conductor');
    const conditionDetails = bahraValues.getByRole('row', { name: conditionFact.label, exact: true }).locator('.library-import-value-conditions');
    const conditionToggle = conditionDetails.locator('summary');
    await expect(conditionDetails).toHaveJSProperty('open', false);
    if (viewport.width === 1366) {
      await conditionToggle.focus();
      await page.keyboard.press('Enter');
    } else await conditionToggle.click();
    await expect(conditionDetails).toHaveJSProperty('open', true);
    const conditionFields = [
      ['frequency_hz', '交流频率', 'Hz'], ['ground_temperature_c', '土壤温度', '°C'],
      ['air_temperature_c', '空气温度', '°C'], ['depth_m', '埋深', 'm'],
      ['soil_thermal_resistivity', '土壤热阻率', 'K·m/W'], ['conductor_temperature_c', '导体温度', '°C'],
      ['short_circuit_duration_s', '短路持续时间', 's'],
    ];
    assert.deepEqual(Object.keys(conditionFact.source.conditions).sort(), [...conditionFields.map(([key]) => key), 'note'].sort());
    const conditionBlocks = [{ key: 'toggle', element: conditionToggle }, { key: 'missing', element: conditionDetails.getByText('原目录共用条件，按相应性能项目使用。未给出的接地、间距及其他条件仍需补充。', { exact: true }) }];
    for (const [key, label, unit] of conditionFields) {
      const element = conditionDetails.getByText(`${label}：${bahraOriginal.conditions[key]} ${unit}`, { exact: true });
      await expect(element).toHaveCount(1);
      conditionBlocks.push({ key, element });
    }
    assert.equal(bahraOriginal.conditions.note, 'The catalogue states one circuit, thermally isolated from other circuits, rated per the IEC 60287 series with standard IEC 60502-2 dimensions.');
    conditionBlocks.push({ key: 'note', element: conditionDetails.getByText('原文说明：目录声明为单回路，与其他回路热隔离；按 IEC 60287 系列确定额定值，结构尺寸采用 IEC 60502-2 标准。', { exact: true }) });
    const conditionScreenshots = [];
    let conditionStart = 0;
    while (conditionStart < conditionBlocks.length) {
      await positionDialogContent(conditionBlocks[conditionStart].element);
      const bounds = await bahraSources.locator('.library-import-dialog-body').boundingBox();
      assert.ok(bounds);
      let conditionEnd = conditionStart;
      while (conditionEnd < conditionBlocks.length) {
        const element = conditionBlocks[conditionEnd].element;
        const box = await element.boundingBox();
        if (!box || box.y < bounds.y || box.y + box.height > bounds.y + bounds.height) break;
        await expect(element).toBeInViewport({ ratio: 1 });
        conditionEnd++;
      }
      assert.ok(conditionEnd > conditionStart, '目录适用条件的每项原值与说明须完整可见');
      await capture('Bahra一秒短路目录适用条件' + (conditionStart ? '续页' : ''));
      conditionScreenshots.push({ screenshot: report.screenshots.at(-1), field: conditionFact.key, conditions: conditionBlocks.slice(conditionStart, conditionEnd).map(item => item.key) });
      conditionStart = conditionEnd;
    }
    await fs.writeFile(path.join(out, `${viewport.width}-bahra-condition-screenshots.json`), JSON.stringify({ source: conditionFact.source, screenshots: conditionScreenshots }, null, 2));
    assert.deepEqual(conditionScreenshots.flatMap(item => item.conditions), conditionBlocks.map(item => item.key));
    await conditionToggle.click();
    await expect(conditionDetails).toHaveJSProperty('open', false);
    await page.keyboard.press('Escape');
    await expect(bahraSources).toBeHidden();
    report.checks.push(`${viewport.width}：从页面下载Bahra完整原件，真实上传→19列映射→13规格缺项预览→人工确认入库；未声明的计算参数保持为空。逐规格19列原值/SI换算/单位/表行列/原件SHA/方法1.1.0/参考分档一致。11项目录性能只保存为来源事实，不进入工程结构输入、不制造计算；全部性能行按窗口完整截图，1s/90℃与各敷设标签保留。实际展开目录适用条件，逐项原值、单位、单回路热隔离说明及未声明条件完整可见并截图。`);
  } catch (error) {
    report.failures.push({ viewport: viewport.width, message: String(error) });
    await page.screenshot({ path: path.join(out, `${viewport.width}-failure.png`) }).catch(() => {});
    await fs.writeFile(path.join(out, `${viewport.width}-failure.txt`), await page.locator('body').innerText().catch(() => '页面已关闭'));
    console.error(error);
  } finally {
    try { await context.close(); }
    catch (error) { report.failures.push({ viewport: viewport.width, phase: '浏览器上下文关闭', message: String(error) }); }
    await saveReport();
  }
}
try { await browser.close(); }
catch (error) { report.failures.push({ phase: '浏览器关闭', message: String(error) }); }
await saveReport();
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
