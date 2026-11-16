// The actual product flow in a browser, with the real core. Imported rows and exported PDFs are verified again.
import assert from 'node:assert/strict';
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Locator } from 'playwright';
import type { LibraryJob, SeriesSummary, SeriesView, SpecificationReport, SpecView } from '../shared/types.ts';
import type { ProductCad } from '../shared/cad.ts';

export async function walkLibrary(browser: Browser, base: string, home: string, out: string, probe: () => string[], problems: string[]) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('pageerror', error => problems.push(`library page error: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') problems.push(`library console error: ${message.text()}`); });
  const op = async <T>(id: string, params: unknown = {}): Promise<T> => {
    const response = await fetch(`${base}/api/ops/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body as T;
  };
  const choose = async (label: string, option: RegExp, scope: Locator = page.locator('body')) => {
    await scope.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option }).click();
  };
  const capture = async (name: string, keepScroll = false, anchor?: Locator) => {
    console.log(`capture: ${name}`);
    const focus = await page.locator('.ws-properties-body').count() ? await page.locator('.ws-properties-body').innerText() : null;
    for (const [width, height] of [[1366, 768], [1920, 1080], [390, 844]] as const) {
      await page.setViewportSize({ width, height });
      if (!keepScroll) await page.locator('main, .ws-shell, .ws-properties-body').evaluateAll(elements => elements.forEach(element => { element.scrollTop = 0; }));
      await page.waitForTimeout(400);
      await page.evaluate(async () => { await document.fonts.ready; });
      if (focus !== null) assert.equal((await page.locator('.ws-properties-body').innerText()).slice(0, 40), focus.slice(0, 40), 'resizing must keep what the properties show');
      assert.equal(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Noto Sans SC Variable' && font.status === 'loaded')), true, 'the bundled UI font must load');
      if (anchor) await anchor.scrollIntoViewIfNeeded();
      if (name === 'library-series' && width === 1920) {
        const fill = await page.locator('.ws-table-scroll').evaluate(area => ({ area: area.clientWidth, table: area.querySelector('table')!.getBoundingClientRect().width }));
        assert.ok(fill.table >= fill.area - 2, 'the design table must fill its panel');
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
    await page.getByRole('button', { name: '查看使用流程', exact: true }).click();
    await page.getByText('从结构表到规格书', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '导入结构表', exact: true }).click();
    await capture('library-import-file');
    const sampleResponse = page.waitForResponse(response => response.url().endsWith('/api/ops/library.import.sample'));
    await page.getByRole('button', { name: '试用人民电缆公开结构表' }).click();
    const sample = await (await sampleResponse).json();
    copyFileSync(join(home, 'uploads', sample.upload, readdirSync(join(home, 'uploads', sample.upload))[0]), join(out, '人民电缆公开结构表.xlsx'));
    await page.getByRole('combobox', { name: '工作表', exact: true }).waitFor();
    // File drop uses the actual workbook and parser, without committing it as a factory declaration.
    await page.getByRole('button', { name: '重新开始', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '选择结构表文件', exact: true }).click();
    await (await chooser).setFiles(join(out, '人民电缆公开结构表.xlsx'));
    await page.getByRole('combobox', { name: '工作表', exact: true }).waitFor();
    await page.getByRole('button', { name: '重新开始', exact: true }).click();
    await page.locator('.import-file-area').evaluate((area, bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], '结构表.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      area.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, [...readFileSync(join(out, '人民电缆公开结构表.xlsx'))]);
    await choose('工作表', /^表3 YJV22/);
    await page.getByRole('button', { name: '重新开始', exact: true }).click();
    await page.getByRole('button', { name: '试用人民电缆公开结构表' }).click();
    await page.getByRole('combobox', { name: '工作表', exact: true }).waitFor();
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
      if (sheet === '表3 YJV22') {
        await page.getByText('绝缘与半导电层', { exact: true }).click();
        await page.getByLabel('声明导体屏蔽厚度', { exact: true }).waitFor();
        await capture('library-import-declaration');
      }
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
    const table = page.getByRole('region', { name: '规格对比表' });
    const properties = page.getByRole('complementary', { name: '属性' });
    const parts = page.getByRole('navigation', { name: '结构浏览器' });
    await table.getByRole('button', { name: '3×240', exact: true }).waitFor();
    // The workspace opens on a size: its drawing, its parts and its properties are there without asking.
    await page.getByRole('img', { name: '3×25 实际尺寸断面' }).waitFor();
    await properties.getByRole('heading', { name: /^3×25/ }).waitFor();
    assert.ok(await parts.getByRole('button').count() >= 9, 'the browser lists every part of the construction');
    await page.getByRole('button', { name: '计算选项与基准条件', exact: true }).click();
    await page.getByRole('checkbox', { name: '重算已有结果', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await capture('library-series');
    const ratingHeader = table.getByRole('columnheader', { name: /基准条件/ });
    await ratingHeader.getByRole('button').click();
    assert.equal(await ratingHeader.getAttribute('aria-sort'), 'ascending');
    await ratingHeader.getByRole('button').click();
    assert.equal(await ratingHeader.getAttribute('aria-sort'), 'descending');
    assert.equal(await table.locator('tbody tr').first().locator('.ws-key').textContent(), '3×400');
    await ratingHeader.getByRole('button').click();
    assert.equal(await ratingHeader.getAttribute('aria-sort'), 'none');
    await table.getByRole('button', { name: /^拒算与告警/ }).click();
    assert.equal(await table.getByRole('button', { name: '3×240', exact: true }).count(), 0);
    await table.getByRole('button', { name: '3×50', exact: true }).waitFor();
    await table.getByRole('button', { name: /^拒算与告警/ }).click();

    // Search, filter and selection operate on actual rows; a ticked size stays ticked while the view changes.
    await table.getByRole('searchbox', { name: '搜索规格' }).fill('240');
    assert.equal(await table.locator('tbody tr').count(), 1);
    await table.getByLabel('勾选 3×240', { exact: true }).check();
    await table.getByRole('searchbox', { name: '搜索规格' }).fill('');
    await table.getByRole('combobox', { name: '按审核状态筛选' }).selectOption('submitted');
    await table.getByRole('button', { name: '3×240', exact: true }).waitFor({ state: 'hidden' });
    await page.locator('.ws-object-actions').getByRole('button', { name: '计算选中 1 项', exact: true }).waitFor();
    await table.getByRole('combobox', { name: '按审核状态筛选' }).selectOption('');
    assert.equal(await table.getByLabel('勾选 3×240', { exact: true }).isChecked(), true, 'selection must survive filtering');
    await table.getByRole('button', { name: '清除选择', exact: true }).click();
    await table.getByRole('button', { name: '3×240', exact: true }).click();
    await properties.getByRole('heading', { name: /^3×240/ }).waitFor();
    await page.getByRole('img', { name: '3×240 实际尺寸断面' }).waitFor();
    await capture('library-structure');

    // A part chosen in the browser shows its own dimension and requirements and lights its column in the table.
    await parts.getByRole('button', { name: /^\d+ 绝缘$/ }).click();
    await properties.getByText('绝缘标称厚度', { exact: true }).waitFor();
    await properties.getByText(/GB\/T 12706\.2—2020 · 表 7/).first().waitFor();
    assert.equal(await table.locator('thead th[data-lit]').filter({ hasText: '绝缘' }).count(), 1, 'the insulation column lights up');
    await capture('library-part');
    await parts.getByRole('button', { name: /^\d+ 绝缘$/ }).click();
    if (process.env.CABLE_STUDIO_VERIFY_CAD === '1') {
      await page.getByRole('radio', { name: '三维实体', exact: true }).click();
      const generated = page.waitForResponse(response => response.url().endsWith('/api/ops/library.geometry'), { timeout: 150_000 });
      await page.getByRole('button', { name: '生成三维实体', exact: true }).click();
      const response = await generated; assert.equal(response.status(), 200);
      const cad = await response.json() as ProductCad;
      assert.equal(cad.model.step_unit, 'mm'); assert.match(cad.model.step_text, /^ISO-10303-21;/);
      assert.equal(cad.method.plugin_id, 'cablesim.cable-geometry');
      await page.locator('.cad-viewport canvas').waitFor();
      await capture('library-cad');
      const stepDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: '下载 STEP 实体', exact: true }).click();
      await (await stepDownload).saveAs(join(out, 'YJV22-3x240-实体.step'));
      assert.equal(readFileSync(join(out, 'YJV22-3x240-实体.step'), 'utf8'), cad.model.step_text);
      const provenanceDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: '建模来源', exact: true }).click();
      await (await provenanceDownload).saveAs(join(out, 'YJV22-3x240-CAD来源.json'));
      assert.equal(JSON.parse(readFileSync(join(out, 'YJV22-3x240-CAD来源.json'), 'utf8')).artifact_sha256, cad.artifact_sha256);
      await page.getByRole('radio', { name: '断面', exact: true }).click();
    }
    await properties.getByText('479.4', { exact: true }).waitFor();
    await properties.getByRole('button', { name: /^电气参数/ }).click();
    await properties.getByText('交流电阻', { exact: true }).waitFor();
    await capture('library-values');
    await properties.getByRole('button', { name: /概要$/ }).click();
    await properties.getByRole('button', { name: /^载流量表/ }).click();
    await properties.getByText('479.4', { exact: true }).waitFor();
    await capture('library-rating');
    await properties.getByRole('button', { name: /概要$/ }).click();
    await properties.getByRole('button', { name: /^标准核对/ }).click();
    assert.equal(await properties.locator('.ws-counts [data-verdict="failed"]').innerText(), '不通过 0');
    await capture('library-checks');
    await properties.getByRole('button', { name: '规格书', exact: true }).click();
    const exportResponse = page.waitForResponse(response => response.url().endsWith('/api/ops/library.export'));
    await properties.getByRole('button', { name: '生成规格书 PDF', exact: true }).click();
    const firstReport = await (await exportResponse).json() as SpecificationReport;
    await page.getByRole('dialog', { name: '规格书 PDF 预览' }).waitFor();
    assert.ok((await page.getByTitle('已生成的规格书 PDF').getAttribute('src'))?.startsWith(firstReport.url + '?preview=1'));
    await capture('library-pdf-preview');
    await page.getByRole('button', { name: '关闭规格书预览', exact: true }).click();
    const downloadEvent = page.waitForEvent('download');
    await properties.getByRole('link', { name: '下载 PDF', exact: true }).first().click();
    await (await downloadEvent).saveAs(join(out, 'YJV22-3x240-规格书.pdf'));
    writeFileSync(join(out, 'YJV22-3x240-来源快照.json'), await (await fetch(base + firstReport.url + '/snapshot')).text(), 'utf8');
    await capture('library-documents');

    for (const action of ['submit', 'approve', 'publish']) {
      await table.getByLabel('勾选 3×240', { exact: true }).check();
      await page.locator('.ws-object-actions').getByRole('button', { name: '审核选中 1 项', exact: true }).click();
      const form = page.getByRole('form', { name: '确认批量审核' });
      if (action === 'submit') {
        await page.keyboard.press('Escape');
        await form.waitFor({ state: 'hidden' });
        await page.locator('.ws-object-actions').getByRole('button', { name: '审核选中 1 项', exact: true }).click();
        await capture('library-review');
      }
      await form.getByRole('combobox', { name: '审核操作' }).selectOption({ label: ({ submit: '提交审核', approve: '审核通过', publish: '发布' } as Record<string, string>)[action] });
      await form.getByLabel('审核意见', { exact: true }).fill('隔离验收流程：核对公开手册结构与计算条件，缺实测项保留。');
      const acknowledge = form.getByRole('checkbox');
      if (await acknowledge.count()) { await form.getByText(/^我已查看这些版本的/).click(); assert.equal(await acknowledge.isChecked(), true); }
      await form.getByRole('button', { name: /^确认/ }).click();
      await form.waitFor({ state: 'hidden' });
    }
    await properties.getByRole('heading', { name: /^3×240/ }).waitFor();
    await properties.getByText('已发布', { exact: true }).first().waitFor();
    await properties.getByRole('button', { name: '修改结构', exact: true }).click();
    const series = await op<SeriesView>('library.series.get', { series: armoured.id });
    const target = series.specs.find(row => row.key === '3×240')!;
    const before = await op<SpecView>('library.spec.get', { spec: target.id });
    const field = before.structure.find(row => row.key === 'insulation_thickness')!;
    await properties.getByLabel(`修改${field.label}`, { exact: true }).fill('4');
    await properties.getByLabel('修改原因', { exact: true }).fill('隔离验收：减薄绝缘，核对标准是否明确指出问题。');
    await capture('library-revision', true);
    await properties.getByRole('button', { name: '保存新版本', exact: true }).click();
    await properties.getByRole('combobox', { name: '查看规格版本' }).locator('option', { hasText: '第 2 版' }).waitFor({ state: 'attached' });
    await properties.getByText('工程师修改', { exact: true }).first().waitFor();
    await properties.getByRole('button', { name: '计算这个规格', exact: true }).click();
    await waitJob();
    await properties.getByRole('button', { name: /概要$/ }).click();
    await properties.getByRole('button', { name: /^标准核对/ }).click();
    await properties.locator('.ws-counts [data-verdict="failed"]').filter({ hasText: '不通过 3' }).waitFor();
    // The three cores fail the same requirement: it is listed once, says so, and names its clause.
    assert.equal(await properties.locator('.ws-check[data-verdict="failed"]').count(), 1);
    assert.match(await properties.locator('.ws-check[data-verdict="failed"]').innerText(), /绝缘标称厚度[\s\S]*3 芯[\s\S]*≥ 4\.5 mm[\s\S]*实际 4 mm[\s\S]*表 7/);
    await capture('library-nonconformity');
    await properties.locator('.ws-section-block', { hasText: '绝缘最薄点' }).getByRole('button', { name: '在断面中查看' }).click();
    await properties.getByText('绝缘标称厚度', { exact: true }).waitFor();
    assert.equal(await parts.getByRole('button', { name: /^\d+ 绝缘$/ }).getAttribute('aria-pressed'), 'true');
    await capture('library-locate-dimension');
    const changed = await op<SpecView>('library.spec.get', { spec: target.id });
    assert.equal(changed.version.number, 2);
    assert.equal(changed.version.review, 'draft');
    assert.equal(changed.results.check!.summary!.count.failed, 3);
    await properties.getByRole('button', { name: '规格书', exact: true }).click();
    const secondExport = page.waitForResponse(response => response.url().endsWith('/api/ops/library.export'));
    await properties.getByRole('button', { name: '生成规格书 PDF', exact: true }).click();
    const secondReport = await (await secondExport).json() as SpecificationReport;
    await page.getByRole('button', { name: '关闭规格书预览', exact: true }).click();
    copyFileSync(join(home, 'specifications', secondReport.id, 'specification.pdf'), join(out, 'YJV22-3x240-减薄核对.pdf'));
    writeFileSync(join(out, 'YJV22-3x240-减薄快照.json'), await (await fetch(base + secondReport.url + '/snapshot')).text(), 'utf8');
    await properties.getByRole('combobox', { name: '查看规格版本' }).selectOption('1');
    await properties.getByText('正在查看第 1 版（历史）。修改请回到最新版。', { exact: true }).waitFor();
    await capture('library-history');
    assert.equal((await op<SpecView>('library.spec.get', { spec: target.id, version: 1 })).structure.find(row => row.key === 'insulation_thickness')!.value, 4.5);
    await table.getByRole('searchbox', { name: '搜索规格' }).fill('3×50');
    await table.getByRole('button', { name: '3×50', exact: true }).click();
    await properties.getByRole('heading', { name: /^3×50/ }).waitFor();
    if (await properties.getByRole('button', { name: /概要$/ }).count()) await properties.getByRole('button', { name: /概要$/ }).click();
    await properties.getByRole('button', { name: /^载流量表/ }).click();
    await properties.getByText('拒算', { exact: true }).first().waitFor();
    await capture('library-method-refusal');
    console.log('product flow: 35 real imports; all three series batched; review, revision, clause failure, two PDFs and immutable history verified');
  } finally {
    await page.close();
  }
}
