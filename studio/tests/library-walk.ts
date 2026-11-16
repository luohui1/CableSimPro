// The actual product flow in a browser, with the real core: the structure tables come in through the import page, the sizes are
// found in the library and opened in their workspace, calculated, checked, changed, reviewed by a person and issued as a
// specification sheet. Imported rows, numbers, exported files and their hashes are verified again through the host's API.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Locator, Page } from 'playwright';
import type { RatingTable } from '../shared/model-types.ts';
import type { ProductCad } from '../shared/cad.ts';
import type { LibraryJob, SeriesSummary, SeriesView, SpecificationReport, SpecView } from '../shared/types.ts';

export async function walkLibrary(browser: Browser, base: string, home: string, out: string, probe: () => string[], problems: string[]) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('pageerror', error => problems.push(`library page error: ${error.message}`));
  // A size that does not exist is asked for once on purpose, and the host answers it with a 404 the browser logs.
  let expectUnreadable = false;
  page.on('console', message => { if (message.type() === 'error' && !(expectUnreadable && /404/.test(message.text()))) problems.push(`library console error: ${message.text()}`); });
  // The address changes the page pushes are kept, so the jump to the workbench can be read even after the workbench redirects.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __pushed: string[] }).__pushed = seen;
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method].bind(history);
      history[method] = (state: unknown, title: string, url?: string | URL | null) => { seen.push(String(url)); original(state, title, url); };
    }
  });
  const op = async <T>(id: string, params: unknown = {}): Promise<T> => {
    const response = await fetch(`${base}/api/ops/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body as T;
  };
  const choose = async (label: string, option: RegExp, scope: Locator = page.locator('body')) => {
    await scope.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option }).click();
  };
  const capture = async (name: string) => {
    console.log(`capture: ${name}`);
    for (const [width, height] of [[1366, 768], [1920, 1080]] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(450);
      await page.evaluate(async () => { await document.fonts.ready; });
      assert.equal(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Noto Sans SC Variable' && font.status === 'loaded')), true, 'the bundled UI font must load');
      await page.screenshot({ path: join(out, `${width}-${name}.png`) });
      for (const issue of await page.evaluate(probe)) problems.push(`${width} ${name}: ${issue}`);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
  };
  const waitJob = async () => {
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      const job = await op<LibraryJob | null>('library.job');
      if (!job || job.state !== 'running') { if (job) assert.equal(job.state, 'done', JSON.stringify(job)); return; }
      await page.waitForTimeout(300);
    }
    throw new Error('product computation timed out');
  };
  /** The pages of a size's workspace: 结构与核对, 参数, 载流量表, 版本与文件. */
  const tab = (name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
  const title = (key: string) => page.getByRole('heading', { level: 1, name: new RegExp(key) }).waitFor();
  /** The rings of the layer picked or pointed at in the layers table are filled and outlined in the selection colour. */
  const outlined = () => page.locator('svg[role="img"] path[stroke="var(--copper)"]').count();
  /** The box of a confirmation: a click on its words gives it. */
  const confirm = (scope: Locator | Page, words: RegExp) => scope.getByText(words).click();

  try {
    // ---- The library and the import ----
    await page.goto(`${base}/library`);
    await title('型号库');
    await capture('library-bundled');
    await page.getByRole('button', { name: '导入结构表', exact: true }).click();
    await page.waitForURL(/\/library\/import/);
    await capture('library-import-file');
    const sampleResponse = page.waitForResponse(response => response.url().endsWith('/api/ops/library.import.sample'));
    await page.getByRole('button', { name: '用公开样例', exact: true }).click();
    const sample = await (await sampleResponse).json();
    copyFileSync(join(home, 'uploads', sample.upload, readdirSync(join(home, 'uploads', sample.upload))[0]), join(out, '人民电缆公开结构表.xlsx'));
    await page.getByRole('heading', { name: '选一张工作表' }).waitFor();
    // File choosing and dropping use the actual workbook and parser, without committing it as a factory declaration.
    await page.getByRole('button', { name: '重新开始', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '选择文件', exact: true }).click();
    await (await chooser).setFiles(join(out, '人民电缆公开结构表.xlsx'));
    await page.getByRole('heading', { name: '选一张工作表' }).waitFor();
    await page.getByRole('button', { name: '重新开始', exact: true }).click();
    await page.locator('input[type="file"]').locator('..').evaluate((area, bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], '结构表.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      area.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, [...readFileSync(join(out, '人民电缆公开结构表.xlsx'))]);
    await page.getByRole('radio', { name: /^表3 YJV22/ }).click();
    // A file that is not a structure table is turned away in words.
    await page.getByRole('button', { name: '重新开始', exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: '说明.txt', mimeType: 'text/plain', buffer: Buffer.from('not a table') });
    await page.getByText(/不能读“说明\.txt”/).waitFor();
    await page.getByRole('button', { name: '用公开样例', exact: true }).click();
    await page.getByRole('heading', { name: '选一张工作表' }).waitFor();
    for (const sheet of ['表1 YJV', '表2 YJV', '表3 YJV22']) {
      await page.getByRole('radio', { name: new RegExp(`^${sheet}`) }).click();
      if (sheet === '表3 YJV22') await capture('library-import-sheet');
      await page.getByRole('button', { name: '下一步：列对应', exact: true }).click();
      await page.getByRole('heading', { name: '把列对上字段' }).waitFor();
      if (sheet === '表3 YJV22') {
        await page.getByLabel('列对应名称', { exact: true }).fill('人民电缆手册版式');
        await capture('library-import-mapping');
      }
      await page.getByRole('button', { name: '下一步：系列声明', exact: true }).click();
      await confirm(page, /^我已核对系列声明、缺失尺寸及计算参数的来源。$/);
      if (sheet === '表3 YJV22') {
        await page.getByRole('group', { name: '选择部位' }).getByRole('button', { name: '绝缘与半导电层', exact: true }).click();
        await page.getByLabel('声明导体屏蔽厚度', { exact: true }).waitFor();
        await capture('library-import-declaration');
      }
      await page.getByRole('button', { name: '下一步：预览与导入', exact: true }).click();
      await page.getByRole('heading', { name: '每一行生成的规格' }).waitFor();
      if (sheet === '表3 YJV22') await capture('library-import-preview');
      const commitResponse = page.waitForResponse(response => response.url().endsWith('/api/ops/library.import.commit'));
      await page.getByRole('button', { name: /^导入 \d+ 个规格$/ }).click();
      assert.equal((await commitResponse).status(), 200);
      await page.getByText(/^已导入 \d+ 个规格$/).waitFor();
      if (sheet === '表3 YJV22') await capture('library-import-commit');
      if (sheet !== '表3 YJV22') await page.getByRole('button', { name: '继续导入此文件的其他工作表' }).click();
    }
    const list = (await op<SeriesSummary[]>('library.series')).filter(series => series.name.includes('人民电缆'));
    assert.equal(list.reduce((sum, series) => sum + series.specs, 0), 35);
    console.log('imported: three series, 35 sizes');

    // The sizes this walk looks at are calculated through the host, as the Agent would; one more is calculated from the page below.
    const armoured = list.find(series => series.designation === 'YJV22')!;
    const series = await op<SeriesView>('library.series.get', { series: armoured.id });
    const spec = (key: string) => series.specs.find(row => row.key === key)!;
    await op('library.compute', { series: armoured.id, specs: [spec('3×240').id, spec('3×50').id, spec('3×400').id], force: false });
    await waitJob();
    console.log('computed: 3×50, 3×240, 3×400 of the armoured series');

    // ---- The library: find a size, select it, open it ----
    await page.goto(`${base}/library`);
    await title('型号库');
    await page.getByRole('textbox', { name: '搜索型号库' }).fill('人民电缆');
    assert.equal(await page.locator('tr[data-group]').count(), 3, 'the search finds the three imported series');
    await page.getByRole('button', { name: '公开资料', exact: true }).click();
    assert.equal(await page.locator('tr[data-group]').count(), 3, 'all three are published tables');
    await page.getByRole('button', { name: '演示结构', exact: true }).click();
    await page.getByText('没有符合条件的规格').waitFor();
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索型号库' }).fill('人民电缆集团 YJV22');
    assert.equal(await page.locator('tr[data-group]').count(), 1);
    await page.getByRole('row', { name: /^3×240/ }).waitFor();
    assert.equal(await page.getByRole('row', { name: /^3×240/ }).getByText('第 1 版').count(), 1);
    // A click selects; the preview beside the table (wide screens) shows the size, and the button at the end of its row opens it.
    await page.getByRole('row', { name: /^3×240/ }).click();
    assert.equal(await page.getByRole('row', { name: /^3×240/ }).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: '打开 3×240', exact: true }).waitFor();
    await capture('library-overview');
    assert.equal(page.url().includes('/library/s-'), false, 'selecting does not open');
    await page.getByRole('button', { name: '打开 3×240', exact: true }).click();
    await title('3×240');

    // ---- The workspace of one size: structure and check ----
    await page.getByRole('img', { name: '3×240 实际尺寸断面' }).waitFor();
    assert.ok(await page.locator('main tbody tr').count() >= 9, 'the layers table lists every layer of the construction');
    assert.ok(await outlined() > 0, 'a layer is outlined from the start: the insulation, which the check asks most about');
    await page.getByText(/^绝缘标称厚度[\d.]+ mm/).waitFor();
    await capture('series-structure');
    // A layer picked in the table is outlined on the drawing and named under it; a layer the pointer is on takes its place.
    await page.getByRole('row', { name: /^导体屏蔽厚度/ }).click();
    await page.getByText(/^导体屏蔽厚度[\d.]+ mm/).waitFor();
    await page.getByRole('row', { name: /^外护套标称厚度/ }).hover();
    await page.getByText(/^外护套标称厚度[\d.]+ mm/).waitFor();
    await capture('series-layer');
    await page.getByRole('button', { name: '放大', exact: true }).click();
    await capture('series-zoom');
    await page.getByRole('button', { name: '适应窗口', exact: true }).click();
    await page.getByText('绝缘最薄点').first().waitFor();
    assert.equal(await page.locator('dl dd').nth(1).innerText(), '0', 'the published structure fails nothing');
    await capture('series-check');

    // ---- Parameters: the numbers with their clauses ----
    await tab('参数');
    await page.getByRole('heading', { name: '每芯电气参数' }).waitFor();
    await page.getByText('0.0754', { exact: true }).first().waitFor();
    await page.getByText('导体非绝热允许短路电流').waitFor();
    await page.getByRole('button', { name: '规格书', exact: true }).waitFor();
    await capture('series-params');
    await tab('载流量表');
    await page.getByText('479.4', { exact: true }).waitFor();
    await capture('series-rating');
    await tab('结构与核对');

    if (process.env.CABLE_STUDIO_VERIFY_CAD === '1') {
      await page.getByText('三维', { exact: true }).click();
      const generated = page.waitForResponse(response => response.url().endsWith('/api/ops/library.geometry'), { timeout: 150_000 });
      await page.getByRole('button', { name: '生成三维实体', exact: true }).click();
      const response = await generated; assert.equal(response.status(), 200);
      const cad = await response.json() as ProductCad;
      assert.equal(cad.model.step_unit, 'mm'); assert.match(cad.model.step_text, /^ISO-10303-21;/);
      assert.equal(cad.method.plugin_id, 'cablesim.cable-geometry');
      await page.locator('[role="img"][aria-label$="CAD 实体"] canvas').waitFor();
      await capture('series-solid');
      const stepDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: '下载 STEP 实体', exact: true }).click();
      await (await stepDownload).saveAs(join(out, 'YJV22-3x240-实体.step'));
      assert.equal(readFileSync(join(out, 'YJV22-3x240-实体.step'), 'utf8'), cad.model.step_text);
      const provenanceDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: '建模来源（JSON）', exact: true }).click();
      await (await provenanceDownload).saveAs(join(out, 'YJV22-3x240-CAD来源.json'));
      assert.equal(JSON.parse(readFileSync(join(out, 'YJV22-3x240-CAD来源.json'), 'utf8')).artifact_sha256, cad.artifact_sha256);
      await page.getByText('断面', { exact: true }).first().click();
    }

    // Stepping through the sizes; a size nobody calculated says so and offers the calculation, which the page runs.
    await page.getByRole('button', { name: '上一个规格' }).click();
    await title('3×185');
    await page.getByText('标准核对还没有计算').waitFor();
    await capture('series-not-computed');
    await page.getByRole('button', { name: '计算与核对', exact: true }).first().click();
    await page.getByText('绝缘最薄点').first().waitFor({ timeout: 240_000 });
    await waitJob();
    await page.getByRole('button', { name: '下一个规格' }).click();
    await title('3×240');

    // ---- An ampacity table written onto the version appears on the page, apart from the batch's reference values ----
    const table = await op<RatingTable>('library.rating.table', { spec: spec('3×240').id, title: '走查载流量表', conditions: [
      { layout: 'three_core_buried_single', depth_m: 0.7, soil_thermal_resistivity: 1, ambient_temperature_c: 25 },
      { layout: 'three_core_buried_single', depth_m: 1.2, soil_thermal_resistivity: 2, ambient_temperature_c: 30, label: '夏季 30 °C 干土' },
    ] });
    assert.equal(table.rows.length, 2);
    // The runs behind the table live in a project of their own: it is marked, and the engineer's list does not show it.
    const projects = await (await fetch(`${base}/api/projects`)).json() as { id: string; source?: unknown }[];
    assert.equal(projects.some(project => project.id === table.project), false, 'the table\'s project is not listed with the engineer\'s own');
    await page.reload();
    await title('3×240');
    await tab('载流量表');
    await page.getByText('夏季 30 °C 干土').waitFor();
    await page.getByText(table.rows[1].ampacity_a!.toFixed(1), { exact: true }).waitFor();
    assert.equal(await page.getByText(/· 第 1 版 · 走查载流量表/).count(), 0, 'the side column does not list the table\'s project');
    await capture('series-rating-tables');
    // The table is a file an engineer can open in a spreadsheet; a number of it is a run record, opened from here.
    const csvDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 CSV', exact: true }).click();
    await (await csvDownload).saveAs(join(out, 'YJV22-3x240-载流量表.csv'));
    const csv = readFileSync(join(out, 'YJV22-3x240-载流量表.csv'), 'utf8');
    assert.ok(csv.includes('夏季 30 °C 干土') && csv.includes(String(table.rows[1].ampacity_a)), 'the file carries the conditions and the numbers');
    await page.getByRole('button', { name: '看每个数的运行记录', exact: true }).click();
    await page.waitForURL(new RegExp(`/p/${table.project}`));
    await page.goBack();
    await title('3×240');
    // The jump to the workbench carries the size's identity.
    await tab('载流量表');
    await page.getByRole('button', { name: '新算一张', exact: true }).click();
    await page.waitForFunction(id => (window as unknown as { __pushed: string[] }).__pushed.some(url => url.includes(`/workbench?model=${encodeURIComponent(id)}`)), spec('3×240').id);
    await page.goto(`${base}/library/${armoured.id}?spec=${encodeURIComponent(spec('3×240').id)}`);
    await title('3×240');

    // ---- Review is taken step by step by a person, and leaves a record ----
    await tab('版本与文件');
    await page.getByRole('heading', { name: '文件' }).waitFor();
    const note = '隔离验收流程：核对公开手册结构与计算条件，缺实测项保留。';
    for (const [action, label] of [['submit', '提交审核'], ['approve', '审核通过'], ['publish', '发布']] as const) {
      await page.getByRole('button', { name: label, exact: true }).click();
      const form = page.getByRole('form', { name: `确认${label}` });
      await form.getByRole('textbox', { name: '审核意见' }).fill(note);
      const seen = form.getByText(/^我已查看以上问题/);
      if (await seen.count()) { assert.equal(await form.getByRole('button', { name: `确认${label}`, exact: true }).isDisabled(), true); await seen.click(); }
      if (action === 'submit') await capture('series-review');
      await form.getByRole('button', { name: `确认${label}`, exact: true }).click();
      await form.waitFor({ state: 'detached' });
    }
    await page.getByRole('button', { name: '出新版本', exact: true }).waitFor();
    await page.getByText(`“${note}”`).first().waitFor();
    await capture('series-versions');

    // ---- The specification sheet is fixed to the version, with its hashes ----
    await page.getByRole('button', { name: '导出规格书', exact: true }).click();
    const exportResponse = page.waitForResponse(response => response.url().endsWith('/api/ops/library.export'));
    await page.getByRole('button', { name: '生成规格书 PDF', exact: true }).click();
    const firstReport = await (await exportResponse).json() as SpecificationReport;
    assert.equal(firstReport.version, 1);
    assert.ok((await page.getByTitle('已生成的规格书 PDF').getAttribute('src'))?.startsWith(firstReport.url + '?preview=1'));
    await capture('series-sheet');
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('dialog').getByRole('link', { name: '下载 PDF', exact: true }).click();
    await (await downloadEvent).saveAs(join(out, 'YJV22-3x240-规格书.pdf'));
    assert.equal(createHash('sha256').update(readFileSync(join(out, 'YJV22-3x240-规格书.pdf'))).digest('hex'), firstReport.sha256, 'the downloaded PDF is the one the record names');
    const snapshot = await (await fetch(base + firstReport.url + '/snapshot')).text();
    assert.equal(createHash('sha256').update(snapshot, 'utf8').digest('hex'), firstReport.snapshot_sha256, 'the snapshot is the one the record names');
    writeFileSync(join(out, 'YJV22-3x240-来源快照.json'), snapshot, 'utf8');
    await page.getByRole('button', { name: '完成', exact: true }).click();
    // The sheet is listed with the version, to be downloaded again from there.
    await page.getByRole('link', { name: '下载规格书', exact: true }).waitFor();

    // ---- A thinner insulation is a new draft that fails its clause; version 1 stays as it was ----
    await tab('结构与核对');
    await page.getByRole('button', { name: '修改结构', exact: true }).click();
    const before = await op<SpecView>('library.spec.get', { spec: spec('3×240').id });
    const field = before.structure.find(row => row.key === 'insulation_thickness')!;
    await page.getByRole('spinbutton', { name: `修改${field.label}`, exact: true }).fill('4');
    await page.getByRole('textbox', { name: '修改原因', exact: true }).fill('隔离验收：减薄绝缘，核对标准是否明确指出问题。');
    await capture('series-revise');
    await page.getByRole('button', { name: /^保存为第 2 版草稿/ }).click();
    await page.getByRole('button', { name: /^保存为第 2 版草稿/ }).waitFor({ state: 'detached' });
    await page.getByText('已改', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: '计算与核对', exact: true }).first().click();
    await page.locator('dl dd').nth(1).filter({ hasText: '3' }).waitFor({ timeout: 240_000 });
    // The three cores fail the same requirement: it is listed once, says so, and names its clause.
    await page.getByText('实际 4 mm · 要求 ≥ 4.5 mm').waitFor();
    assert.equal(await page.getByText('绝缘标称厚度').filter({ hasText: '三芯' }).count(), 1);
    await capture('series-nonconformity');
    await waitJob();
    const changed = await op<SpecView>('library.spec.get', { spec: spec('3×240').id });
    assert.equal(changed.version.number, 2);
    assert.equal(changed.version.review, 'draft');
    assert.equal(changed.results.check!.summary!.count.failed, 3);
    await page.getByRole('button', { name: '规格书', exact: true }).first().click();
    const secondExport = page.waitForResponse(response => response.url().endsWith('/api/ops/library.export'));
    await page.getByRole('button', { name: '生成规格书 PDF', exact: true }).click();
    const secondReport = await (await secondExport).json() as SpecificationReport;
    await page.getByRole('button', { name: '完成', exact: true }).click();
    copyFileSync(join(home, 'specifications', secondReport.id, 'specification.pdf'), join(out, 'YJV22-3x240-减薄核对.pdf'));
    writeFileSync(join(out, 'YJV22-3x240-减薄快照.json'), await (await fetch(base + secondReport.url + '/snapshot')).text(), 'utf8');

    // ---- History: version 1 is still there, as it was ----
    await tab('版本与文件');
    await page.getByRole('row', { name: /^第 1 版/ }).click();
    await page.getByText('这是历史版本').waitFor();
    await capture('series-history');
    await tab('结构与核对');
    await page.getByText('正在查看第 1 版（历史）').waitFor();
    assert.equal(await page.getByRole('button', { name: '计算与核对', exact: true }).first().isDisabled(), true, 'calculating is for the newest version only');
    assert.equal((await op<SpecView>('library.spec.get', { spec: spec('3×240').id, version: 1 })).structure.find(row => row.key === 'insulation_thickness')!.value, 4.5);
    await page.getByRole('button', { name: '回到最新版' }).click();
    await page.getByText('正在查看第 1 版（历史）').waitFor({ state: 'detached' });

    // ---- A size the method refuses for some laying says so, without a substitute number ----
    await page.goto(`${base}/library/${armoured.id}?spec=${encodeURIComponent(spec('3×50').id)}`);
    await title('3×50');
    await tab('载流量表');
    await page.getByText('拒算', { exact: true }).first().waitFor();
    await capture('series-method-refusal');

    // A version that does not exist is said so, with the way back, instead of a page that stays empty.
    expectUnreadable = true;
    await page.goto(`${base}/library/${armoured.id}?spec=${encodeURIComponent(spec('3×240').id)}&version=99`);
    await page.getByText('读不到这个规格').waitFor();
    await page.getByRole('button', { name: '回到最新版', exact: true }).click();
    await title('3×240');
    expectUnreadable = false;

    // ---- A new type typed in from nothing: with the imported series' own declaration and one imported size's structure, the
    // library fingerprints it as it fingerprints the imported one ----
    const vocabulary = await op<{ fields: { key: string; label: string }[] }>('library.vocabulary');
    const labelOf = (key: string) => vocabulary.fields.find(field => field.key === key)!.label;
    const PARTS: [string, string[]][] = [
      ['导体', ['area', 'conductor_diameter', 'conductor_wire_count', 'conductor_wire_diameter', 'r20']],
      ['绝缘与半导电层', ['conductor_screen_thickness', 'insulation_thickness', 'insulation_screen_thickness']],
      ['金属屏蔽', ['screen_tape_thickness', 'screen_tape_width', 'screen_tape_overlap']],
      ['包带、铠装与护套', ['binder_thickness', 'bedding_thickness', 'armour_tape_thickness', 'armour_tape_width', 'armour_wire_diameter', 'armour_wire_count', 'oversheath_thickness']],
      ['成品尺寸与重量', ['outer_diameter', 'weight']],
    ];
    const partOf = (key: string) => PARTS.find(([, keys]) => keys.includes(key))![0];
    const declaration = series.declaration;
    const target300 = await op<SpecView>('library.spec.get', { spec: spec('3×300').id });
    await page.goto(`${base}/library`);
    await page.getByRole('button', { name: '新建型号', exact: true }).click();
    await page.waitForURL(/\/library\/new/);
    const typedName = '走查：手工填写 YJV22-8.7/15 kV 三芯';
    await page.getByRole('textbox', { name: '系列名称', exact: true }).fill(typedName);
    await page.getByRole('textbox', { name: '型号', exact: true }).fill(declaration.designation);
    await page.getByRole('spinbutton', { name: '额定相电压 kV', exact: true }).fill(String(declaration.u0_v / 1000));
    await page.getByRole('spinbutton', { name: '额定线电压 kV', exact: true }).fill(String(declaration.u_v / 1000));
    for (const standard of declaration.standards) {
      await page.getByRole('textbox', { name: '添加执行标准', exact: true }).fill(standard);
      await page.getByRole('button', { name: '添加', exact: true }).click();
    }
    if (declaration.armour_material) await choose('铠装材料类别', new RegExp(declaration.armour_material === 'steel_galvanized' ? '镀锌钢' : '非磁性不锈钢'));
    // What the series states once for all its sizes, each with its basis, part by part.
    for (const key of Object.keys(declaration.common)) {
      await page.getByRole('group', { name: '选择部位' }).getByRole('button', { name: partOf(key), exact: true }).click();
      await page.locator(`#common-${key}`).fill(String(declaration.common[key]));
      await page.getByRole('textbox', { name: `${labelOf(key)}依据`, exact: true }).fill(declaration.common_basis[key]);
    }
    await page.getByText('计算参数与参考取值', { exact: true }).click();
    await page.getByRole('button', { name: '填入标准参考值，供逐项核对' }).click();
    // The first size: the table-given values of the imported 3×300, the section drawn from them as they are typed.
    for (const item of target300.structure.filter(entry => entry.origin === 'table')) await page.locator(`#value-${item.key}`).fill(String(item.value));
    await page.getByRole('img', { name: '填写中的结构断面' }).waitFor({ timeout: 60_000 });
    await capture('new-scratch');
    const nothingYet = (await op<SeriesSummary[]>('library.series')).some(item => item.name === typedName);
    assert.equal(nothingYet, false, 'the preview saved nothing');
    await page.getByRole('button', { name: '建成草稿', exact: true }).click();
    await title('3×300');
    const typedSeries = (await op<SeriesSummary[]>('library.series')).find(item => item.name === typedName)!;
    const typed = await op<SpecView>('library.spec.get', { spec: `${typedSeries.id}.3x300` });
    assert.equal(typed.entry.content_sha256, target300.entry.content_sha256, 'the structure typed in is the structure imported');
    assert.equal(typed.version.review, 'draft');
    console.log('new type: typed in from nothing, the same structure as the imported one');

    // ---- A new size started from the standard: its thickness is the standard's, with the clause and the page; the rest the engineer gives ----
    const target240 = await op<SpecView>('library.spec.get', { spec: spec('3×240').id, version: 1 });
    const given = (key: string) => String(target240.structure.find(item => item.key === key)!.value);
    await page.goto(`${base}/library/new?from=standard`);
    await page.getByRole('spinbutton', { name: '标称截面', exact: true }).fill('240');
    await page.getByRole('group', { name: '铠装形式' }).getByRole('button', { name: '双钢带铠装', exact: true }).click();
    await page.getByRole('spinbutton', { name: '导体屏蔽厚度', exact: true }).fill(given('conductor_screen_thickness'));
    await page.getByRole('spinbutton', { name: '绝缘屏蔽厚度', exact: true }).fill(given('insulation_screen_thickness'));
    await page.getByRole('spinbutton', { name: '铜带厚度', exact: true }).fill(given('screen_tape_thickness'));
    await page.getByRole('spinbutton', { name: '铜带宽度', exact: true }).fill(given('screen_tape_width'));
    await capture('new-standard-conditions');
    await page.getByRole('button', { name: '生成提案', exact: true }).click();
    await page.getByText(/表 7/).first().waitFor({ timeout: 120_000 });
    await capture('new-standard');
    await page.getByRole('button', { name: /^下一步：补齐并建成/ }).click();
    const missing = await page.locator('[id^="missing-"]').evaluateAll(list => list.map(element => element.id.replace('missing-', '')));
    assert.ok(missing.length > 0, 'the standard leaves dimensions to the engineer');
    for (const key of missing) await page.locator(`#missing-${key}`).fill(given(key));
    await choose('系列', new RegExp('走查：手工填写'));
    await capture('new-standard-create');
    await page.getByRole('button', { name: '建成草稿', exact: true }).click();
    await title('3×240');
    const started = await op<SpecView>('library.spec.get', { spec: `${typedSeries.id}.3x240` });
    assert.match((started.derivation as unknown as { proposal?: { id: string } }).proposal?.id ?? '', /^prop-/);
    assert.equal(started.structure.find(item => item.key === 'insulation_thickness')!.value, 4.5);
    assert.equal(started.version.review, 'draft');
    console.log('new size from the standard: the thickness and its clause come from the proposal, the rest from the engineer');

    console.log('product flow: 35 real imports; library, workspace, review, revision, clause failure, two PDFs, a rating table, immutable history, a typed-in type and a size from the standard verified');
  } finally {
    await page.close();
  }
}
