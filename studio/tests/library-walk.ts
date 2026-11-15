// The actual product flow in a browser, with the real core. Imported rows and exported PDFs are verified again.
import assert from 'node:assert/strict';
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Locator } from 'playwright';
import type { LibraryJob, SeriesSummary, SeriesView, SpecificationReport, SpecView } from '../shared/types.ts';

export async function walkLibrary(browser: Browser, base: string, home: string, out: string, probe: () => string[], problems: string[]) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('pageerror', error => problems.push(`library page error: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') problems.push(`library console error: ${message.text()}`); });
  const op = async <T>(id: string, params: unknown = {}): Promise<T> => {
    const response = await fetch(`${base}/api/ops/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body as T;
  };
  const choose = async (label: string, option: RegExp, scope: Locator = page.locator('body')) => {
    await scope.getByRole('button', { name: new RegExp(label) }).click();
    await page.getByRole('option', { name: option }).click();
  };
  const capture = async (name: string, keepScroll = false, anchor?: Locator) => {
    console.log(`capture: ${name}`);
    for (const [width, height] of [[1366, 768], [1920, 1080], [390, 844]] as const) {
      await page.setViewportSize({ width, height });
      if (!keepScroll) await page.locator('main, aside[aria-label="规格详情"] .overflow-y-auto').evaluateAll(elements => elements.forEach(element => { element.scrollTop = 0; }));
      await page.waitForTimeout(400);
      await page.evaluate(async () => { await document.fonts.ready; });
      assert.equal(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Noto Sans SC Variable' && font.status === 'loaded')), true, 'the bundled UI font must load');
      if (anchor) await anchor.scrollIntoViewIfNeeded();
      if (name === 'library-series' && width === 1920) {
        const fill = await page.locator('.product-grid').evaluate(grid => {
          const width = grid.getBoundingClientRect().width;
          return { width, area: grid.parentElement!.clientWidth, row: grid.querySelector('.ag-row[row-id]')!.getBoundingClientRect().width };
        });
        assert.ok(Math.abs(fill.width - fill.area) <= 2, 'the table must fill the available work surface');
        assert.ok(Math.abs(fill.row - fill.width) <= 2, 'the cells must fill the table width');
      }
      await page.screenshot({ path: join(out, `${width}-${name}.png`) });
      for (const issue of await page.evaluate(probe)) problems.push(`${width} ${name}: ${issue}`);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
  };
  const waitJob = async () => {
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      const job = await op<LibraryJob>('library.job');
      if (job.state !== 'running') { assert.equal(job.state, 'done', JSON.stringify(job)); return; }
      await page.waitForTimeout(300);
    }
    throw new Error('product computation timed out');
  };

  try {
    await page.goto(base);
    await page.waitForURL('**/library');
    await page.getByRole('button', { name: '导入结构表', exact: true }).click();
    await capture('library-import-file');
    const sampleResponse = page.waitForResponse(response => response.url().endsWith('/api/ops/library.import.sample'));
    await page.getByRole('button', { name: '试用人民电缆公开结构表' }).click();
    const sample = await (await sampleResponse).json();
    copyFileSync(join(home, 'uploads', sample.upload, readdirSync(join(home, 'uploads', sample.upload))[0]), join(out, '人民电缆公开结构表.xlsx'));
    await page.getByRole('button', { name: /工作表/ }).waitFor();
    // File drop uses the actual workbook and parser, without committing it as a factory declaration.
    await page.getByRole('button', { name: '重新开始', exact: true }).click();
    await page.locator('.import-file-area').evaluate((area, bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], '结构表.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      area.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, [...readFileSync(join(out, '人民电缆公开结构表.xlsx'))]);
    await choose('工作表', /^表3 YJV22/);
    await page.getByRole('button', { name: '重新开始', exact: true }).click();
    await page.getByRole('button', { name: '试用人民电缆公开结构表' }).click();
    await page.getByRole('button', { name: /工作表/ }).waitFor();
    for (const sheet of ['表1 YJV', '表2 YJV', '表3 YJV22']) {
      await choose('工作表', new RegExp(`^${sheet} ·`));
      await page.getByRole('button', { name: '读取列对应', exact: true }).click();
      await page.getByRole('heading', { name: '确认列对应关系' }).waitFor();
      if (sheet === '表3 YJV22') {
        await page.getByLabel('列对应名称', { exact: true }).fill('人民电缆手册版式');
        await capture('library-import-mapping');
      }
      await page.getByRole('button', { name: '填写系列声明' }).click();
      await page.getByText('我已核对系列声明、缺失尺寸及计算参数的来源。', { exact: true }).click();
      if (sheet === '表3 YJV22') await capture('library-import-declaration');
      await page.getByRole('button', { name: '预览导入', exact: true }).click();
      await page.getByRole('heading', { name: '核对导入预览' }).waitFor();
      if (sheet === '表3 YJV22') await capture('library-import-preview');
      const commitResponse = page.waitForResponse(response => response.url().endsWith('/api/ops/library.import.commit'));
      await page.getByRole('button', { name: /^确认导入 \d+ 个规格$/ }).click();
      assert.equal((await commitResponse).status(), 200);
      await page.getByRole('heading', { name: /^已导入 \d+ 个规格$/ }).waitFor();
      if (sheet !== '表3 YJV22') await page.getByRole('button', { name: '继续导入此文件的其他工作表' }).click();
    }
    const list = (await op<SeriesSummary[]>('library.series')).filter(series => series.name.includes('人民电缆'));
    assert.equal(list.reduce((sum, series) => sum + series.specs, 0), 35);
    console.log('imported: three series, 35 sizes');
    for (const series of list) {
      await page.goto(`${base}/library/${series.id}`);
      await page.getByRole('button', { name: '计算全系列', exact: true }).waitFor();
      await page.getByRole('button', { name: '计算全系列', exact: true }).click();
      await waitJob();
      console.log(`computed: ${series.name}`);
    }
    const armoured = list.find(series => series.designation === 'YJV22')!;
    await page.goto(`${base}/library`);
    await page.locator('table.library-table tbody tr').first().waitFor();
    await page.getByRole('complementary', { name: '产品库资料分类' }).getByRole('button', { name: /公开厂家资料/ }).click();
    assert.equal(await page.locator('tbody tr').count(), 5);
    await page.getByRole('searchbox', { name: '搜索产品系列' }).fill('人民电缆');
    assert.equal(await page.locator('tbody tr').count(), 3);
    await page.getByRole('searchbox', { name: '搜索产品系列' }).fill('');
    await page.getByRole('complementary', { name: '产品库资料分类' }).getByRole('button', { name: /全部资料/ }).click();
    await capture('library-overview');
    await page.goto(`${base}/library/${armoured.id}`);
    await page.locator('.product-grid [role="grid"]').waitFor();
    await page.getByRole('button', { name: '3×240', exact: true }).waitFor();
    await capture('library-series');
    const ratingHeader = page.getByRole('columnheader', { name: '基准载流量 A' });
    await ratingHeader.locator('.ag-header-cell-label').click();
    assert.equal(await ratingHeader.getAttribute('aria-sort'), 'ascending');
    await ratingHeader.locator('.ag-header-cell-label').click();
    assert.equal(await ratingHeader.getAttribute('aria-sort'), 'descending');
    assert.equal(await page.locator('.product-grid .ag-row[row-index="0"] .spec-key').textContent(), '3×400');
    await ratingHeader.locator('.ag-header-cell-label').click();
    await choose('规格筛选', /^有问题 \/ 告警$/);
    assert.equal(await page.getByRole('button', { name: '3×240', exact: true }).count(), 0);
    await page.getByRole('button', { name: '3×50', exact: true }).waitFor();
    await choose('规格筛选', /^全部规格$/);

    // Search, filter, selection and sorting operate on actual rows.
    await page.getByRole('searchbox', { name: '搜索规格' }).fill('3×240');
    const selectedRow = page.locator('.product-grid .ag-row[row-id]').filter({ hasText: '3×240' });
    await selectedRow.getByRole('checkbox').check();
    await choose('规格筛选', /^待计算$/);
    await page.getByRole('button', { name: '3×240', exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '计算选中 1 项', exact: true }).waitFor();
    await choose('规格筛选', /^全部规格$/);
    assert.equal(await selectedRow.getByRole('checkbox').isChecked(), true, 'selection must survive filtering');
    await page.getByRole('tab', { name: '结构参数', exact: true }).click();
    await page.getByRole('columnheader', { name: /R20/ }).waitFor();
    assert.equal(await selectedRow.getByRole('checkbox').isChecked(), true, 'selection must survive a column-view change');
    await page.getByRole('tab', { name: '概览', exact: true }).click();
    await page.getByRole('button', { name: '清除选择', exact: true }).click();
    await page.getByRole('button', { name: '3×240', exact: true }).click();
    await page.getByRole('heading', { name: /3×240/ }).waitFor();
    await capture('library-structure');
    const panel = page.getByRole('complementary', { name: '规格详情', exact: true });
    await panel.getByRole('tab', { name: '计算参数', exact: true }).click();
    await panel.getByText('479.4 A', { exact: true }).waitFor();
    await capture('library-values');
    await capture('library-rating', false, panel.getByRole('heading', { name: '载流量表', exact: true }));
    await panel.getByRole('tab', { name: '标准核对', exact: true }).click();
    await panel.getByText(/通过 \d+ · 不通过 0/).waitFor();
    await capture('library-checks');
    await panel.getByRole('tab', { name: '版本与文件', exact: true }).click();
    const exportResponse = page.waitForResponse(response => response.url().endsWith('/api/ops/library.export'));
    await panel.getByRole('button', { name: '生成规格书 PDF', exact: true }).click();
    const firstReport = await (await exportResponse).json() as SpecificationReport;
    const downloadEvent = page.waitForEvent('download');
    await panel.getByRole('link', { name: '下载 PDF', exact: true }).first().click();
    await (await downloadEvent).saveAs(join(out, 'YJV22-3x240-规格书.pdf'));
    writeFileSync(join(out, 'YJV22-3x240-来源快照.json'), await (await fetch(base + firstReport.url + '/snapshot')).text(), 'utf8');
    await capture('library-documents');

    await panel.getByRole('button', { name: '关闭规格详情' }).click();
    for (const action of ['submit', 'approve', 'publish']) {
      await page.locator('.product-grid .ag-row[row-id]').filter({ hasText: '3×240' }).getByRole('checkbox').check();
      await page.getByRole('button', { name: '审核选中项' }).click();
      const form = page.getByRole('form', { name: '确认批量审核' });
      if (action === 'submit') {
        await page.keyboard.press('Escape');
        await form.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: '审核选中项' }).click();
        await capture('library-review');
      }
      await choose('审核操作', new RegExp(`^${({ submit: '提交审核', approve: '审核通过', publish: '发布' } as Record<string, string>)[action]}$`), form);
      await form.getByLabel('审核意见', { exact: true }).fill('隔离验收流程：核对公开手册结构与计算条件，缺实测项保留。');
      const acknowledge = form.getByRole('checkbox');
      if (await acknowledge.count()) { await form.getByText(/^我已查看这些版本的/).click(); assert.equal(await acknowledge.isChecked(), true); }
      await form.getByRole('button', { name: /^确认/ }).click();
      await form.waitFor({ state: 'hidden' });
    }
    await page.getByRole('button', { name: '3×240', exact: true }).click();
    await panel.getByRole('tab', { name: '结构', exact: true }).click();
    await panel.getByRole('button', { name: '修改结构', exact: true }).click();
    const series = await op<SeriesView>('library.series.get', { series: armoured.id });
    const target = series.specs.find(row => row.key === '3×240')!;
    const before = await op<SpecView>('library.spec.get', { spec: target.id });
    const field = before.structure.find(row => row.key === 'insulation_thickness')!;
    await panel.getByLabel(`修改${field.label}`, { exact: true }).fill('4');
    await panel.getByLabel('修改原因', { exact: true }).fill('隔离验收：减薄绝缘，核对标准是否明确指出问题。');
    await capture('library-revision', true);
    await panel.getByRole('button', { name: '保存新版本', exact: true }).click();
    await choose('查看规格版本', /^第 2 版/, panel);
    await panel.getByText('工程师修改', { exact: true }).waitFor();
    await panel.getByRole('button', { name: '关闭规格详情' }).click();
    await page.locator('.product-grid .ag-row[row-id]').filter({ hasText: '3×240' }).getByRole('checkbox').check();
    await page.getByRole('button', { name: '计算选中 1 项', exact: true }).click();
    await waitJob();
    await page.getByRole('button', { name: '3×240', exact: true }).click();
    await panel.getByRole('tab', { name: '标准核对', exact: true }).click();
    await panel.getByText(/不通过 3/).waitFor();
    const checkCards = panel.locator('[role="tabpanel"]:visible section');
    for (let index = 0; index < 3; index++) assert.match(await checkCards.nth(index).innerText(), /不通过/);
    await capture('library-nonconformity');
    const changed = await op<SpecView>('library.spec.get', { spec: target.id });
    assert.equal(changed.version.number, 2);
    assert.equal(changed.version.review, 'draft');
    assert.equal(changed.results.check!.summary!.count.failed, 3);
    await panel.getByRole('tab', { name: '版本与文件', exact: true }).click();
    const secondExport = page.waitForResponse(response => response.url().endsWith('/api/ops/library.export'));
    await panel.getByRole('button', { name: '生成规格书 PDF', exact: true }).click();
    const secondReport = await (await secondExport).json() as SpecificationReport;
    copyFileSync(join(home, 'specifications', secondReport.id, 'specification.pdf'), join(out, 'YJV22-3x240-减薄核对.pdf'));
    writeFileSync(join(out, 'YJV22-3x240-减薄快照.json'), await (await fetch(base + secondReport.url + '/snapshot')).text(), 'utf8');
    await choose('查看规格版本', /^第 1 版/, panel);
    await panel.getByRole('tab', { name: '结构', exact: true }).click();
    await panel.getByText('正在查看历史版本；修改请返回最新版本。', { exact: true }).waitFor();
    await capture('library-history');
    assert.equal((await op<SpecView>('library.spec.get', { spec: target.id, version: 1 })).structure.find(row => row.key === 'insulation_thickness')!.value, 4.5);
    await panel.getByRole('button', { name: '关闭规格详情' }).click();
    await page.getByRole('searchbox', { name: '搜索规格' }).fill('3×50');
    await page.getByRole('button', { name: '3×50', exact: true }).click();
    await panel.getByRole('tab', { name: '计算参数', exact: true }).click();
    await panel.getByText('拒算', { exact: true }).first().waitFor();
    await capture('library-method-refusal', false, panel.getByRole('heading', { name: '载流量表', exact: true }));
    console.log('product flow: 35 real imports; all three series batched; review, revision, clause failure, two PDFs and immutable history verified');
  } finally {
    await page.close();
  }
}
