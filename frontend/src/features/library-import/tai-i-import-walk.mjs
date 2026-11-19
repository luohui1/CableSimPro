import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeRequestHeaders, saveRawResponse } from './resource-exchange-walk.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const units = {
  area: ['mm²', 'm2', 1e-6], conductor_diameter: ['mm', 'm', .001],
  insulation_thickness: ['mm', 'm', .001], metallic_sheath_thickness: ['mm', 'm', .001],
  oversheath_thickness: ['mm', 'm', .001], outer_diameter: ['mm', 'm', .001],
  r20: ['Ω/km', 'ohm/m', .001], weight: ['kg/km', 'kg/m', .001],
};

/** The original 110 kV table and a separately labelled bad-cell copy both use
 * the visible importer. Missing construction remains an unapproved draft. */
export async function walkTaiIImport({ page, base, viewport, out, root, expect, capture, select, afterAction, recordResponse, positionDialogContent, report }) {
  const prefix = `${viewport.width}-tai-i-110kv`;
  const layoutStart = report.layout_failures.length;
  const metadataBytes = await fs.readFile(path.join(root, 'tests/fixtures/tai_i_110kv_catalogue.json'));
  const metadata = JSON.parse(metadataBytes.toString('utf8'));
  const csv = await fs.readFile(path.join(root, 'tests/fixtures', metadata.table_file));
  assert.equal(hash(csv), '8b7b75511dda406d9eaafbd2305275babe57d5d52bbeb2e7638628721f7bed55');
  assert.equal(metadata.source.sha256, '72b21e5d15f5d50a5b30a01c822ca3771bd0cc190cbfa4edd47bf23a948c9cdd');
  assert.deepEqual([metadata.source.pdf_page, metadata.source.printed_pages, metadata.source.context_pdf_page], [7, [10], 6]);
  for (const key of ['r20', 'weight', 'outer_diameter', 'conductor_diameter']) {
    assert.ok(metadata.source.column_meanings[key].quantity);
    assert.equal(metadata.source.column_meanings[key].unit, units[key][0]);
  }
  const lines = csv.toString('utf8').trimEnd().split('\n');
  assert.equal(lines.length, 11);
  assert.ok(lines.every(line => !line.includes('"') && line.split(',').length === 10), '固定原件 CSV 的逐格核验不得猜测引号或列分隔');
  const grid = lines.map(line => line.split(','));
  assert.deepEqual(grid[0], metadata.headers);
  const originalRows = grid.slice(1).map(row => row.map((value, index) => index ? Number(value) : value));
  assert.ok(originalRows.every(row => row.slice(1).every(Number.isFinite)));
  assert.deepEqual(originalRows.map(row => row[1]), [240, 300, 400, 500, 630, 800, 1000, 1200, 1400, 1600]);
  assert.equal(originalRows[5][8], .0211, '800 mm² 原表电阻不得替换为 220 kV 表值');
  const badGrid = structuredClone(grid);
  badGrid[1][8] = 'not-a-number';
  const badCsv = Buffer.from(badGrid.map(row => row.join(',')).join('\n') + '\n');
  assert.deepEqual(badGrid.flatMap((row, r) => row.flatMap((value, c) => value === grid[r][c] ? [] : [{ row: r + 1, column: c + 1, before: grid[r][c], after: value }])),
    [{ row: 2, column: 9, before: '0.0754', after: 'not-a-number' }]);
  const sourceBytes = Buffer.from(JSON.stringify(metadata.source, null, 2));
  await fs.writeFile(path.join(out, prefix + '-original.csv'), csv);
  await fs.writeFile(path.join(out, prefix + '-bad-I2-copy.csv'), badCsv);
  await fs.writeFile(path.join(out, prefix + '-source-input.json'), sourceBytes);
  const evidence = { viewport, fixtures: {
    csv: { file: metadata.table_file, size: csv.length, sha256: hash(csv) },
    metadata: { file: 'tai_i_110kv_catalogue.json', size: metadataBytes.length, sha256: hash(metadataBytes) },
    bad_copy: { file: prefix + '-bad-I2-copy.csv', size: badCsv.length, sha256: hash(badCsv), changed_cell: 'I2', purpose: '单独的错误行机制副本，不是厂家原表' },
  }, mutations: [], reads: [], screenshots: [], status: 'running' };
  const write = () => fs.writeFile(path.join(out, prefix + '-summary.json'), JSON.stringify(evidence, null, 2));
  const requests = new WeakMap();
  let nextRequest = 0;
  const onRequest = request => {
    if (!request.url().startsWith(base + '/api/') || ['GET', 'HEAD'].includes(request.method())) return;
    const id = ++nextRequest;
    requests.set(request, id);
    evidence.mutations.push({ id, method: request.method(), url: request.url(), at: new Date().toISOString() });
  };
  const shot = async label => { await capture(label); evidence.screenshots.push(report.screenshots.at(-1)); await write(); };
  async function read(label, endpoint) {
    const response = await page.request.get(base + endpoint, { timeout: 180000 });
    try {
      const raw = await saveRawResponse(response, path.join(out, `${prefix}-${label}-raw.json`));
      evidence.reads.push({ endpoint, status: response.status(), raw_response: raw });
      assert.equal(response.status(), 200, `${endpoint}: ${await response.text()}`);
      return await response.json();
    } finally { await response.dispose(); }
  }
  async function uploadAndDeclare(bytes, name, caseName) {
    const response = await afterAction(page.waitForResponse(item => item.url() === base + '/api/type-library/imports/upload' && item.request().method() === 'POST'),
      () => page.getByLabel('结构表文件', { exact: true }).setInputFiles({ name, mimeType: 'text/csv', buffer: bytes }));
    const raw = await saveRawResponse(response, path.join(out, `${prefix}-${caseName}-upload-raw.json`));
    assert.equal(response.status(), 201, await response.text());
    const inspection = await response.json();
    evidence[caseName] = { upload: { request_id: requests.get(response.request()), method: response.request().method(), headers: safeRequestHeaders(response.request()),
      file: { name, size: bytes.length, sha256: hash(bytes) }, status: response.status(), raw_response: raw, response: inspection } };
    assert.equal(inspection.sha256, hash(bytes));
    assert.equal(inspection.file, name);
    assert.equal(inspection.declarations?.length || 0, 0, '自有原表不得自动注入内置型号声明');
    assert.equal(inspection.sheets.length, 1);
    const sheet = inspection.sheets[0];
    assert.deepEqual([sheet.first_data_row, sheet.data_rows, sheet.columns.length], [2, 10, 10]);
    assert.deepEqual(sheet.columns.map(column => column.header), metadata.headers);
    await select('工作表', `${sheet.name} · 10 行`);
    await shot(`台一110千伏${caseName === 'bad' ? '错误副本' : '原表'}上传与选表`);
    await page.getByRole('button', { name: '确认工作表，设置列映射', exact: true }).click();
    await expect(page.getByRole('heading', { name: '确认列映射', exact: true })).toBeVisible();
    for (const column of sheet.columns) {
      const key = Object.keys(metadata.mapping).find(key => metadata.mapping[key] === column.index);
      const field = inspection.fields.find(field => field.key === key);
      if (key) assert.equal(field.unit, units[key][0]);
      await select(`${column.letter} 列对应`, key ? `${field.label} / ${units[key][0]}` : '不导入此列');
    }
    await expect(page.getByRole('combobox', { name: 'A 列对应', exact: true })).toHaveText('不导入此列');
    await expect(page.getByRole('combobox', { name: 'E 列对应', exact: true })).toHaveText('不导入此列');
    await page.getByRole('combobox', { name: 'I 列对应', exact: true }).scrollIntoViewIfNeeded();
    await shot(`台一110千伏${caseName === 'bad' ? '错误副本' : '原表'}八列映射保留未映射原列`);
    await page.getByRole('button', { name: '填写系列声明', exact: true }).click();
    const form = page.getByRole('form', { name: '系列声明', exact: true });
    const seriesName = `${metadata.declaration.name} ${viewport.width} ${caseName === 'bad' ? '错误副本' : '原件'} ${Date.now()}`;
    for (const [label, value] of [['系列名称', seriesName], ['制造商', metadata.declaration.manufacturer], ['型号', metadata.declaration.designation],
      ['额定相电压 kV', '64'], ['额定线电压 kV', '110'], ['最高系统电压 kV', '126'], ['执行标准', metadata.declaration.standards.join('\n')]]) {
      await form.getByLabel(label, { exact: true }).fill(value);
    }
    for (const [label, option] of [['芯数', '1 芯'], ['数据身份', '公开厂家资料'], ['导体材料', '铜'], ['绝缘材料', '交联聚乙烯'],
      ['外护套材料', '聚氯乙烯'], ['金属套材料与形式', '皱纹铝套'], ['铠装材料类别', '未声明具体钢材'], ['原表缺少导体电阻时', '保留缺项，等待厂家提供']]) await select(label, option);
    const details = form.locator('details').filter({ has: page.locator(':scope > summary', { hasText: /^补充原列口径与原件定位$/ }) });
    await expect(details).toHaveCount(1);
    await details.locator(':scope > summary').click();
    await expect(details).toHaveJSProperty('open', true);
    await form.getByLabel('来源说明 JSON 文件', { exact: true }).setInputFiles({ name: '台一110千伏原件来源.json', mimeType: 'application/json', buffer: sourceBytes });
    const loaded = form.getByRole('status').filter({ hasText: '已加载“台一110千伏原件来源.json”' });
    await expect(loaded).toBeVisible();
    await loaded.scrollIntoViewIfNeeded();
    await shot(`台一110千伏${caseName === 'bad' ? '错误副本' : '原表'}明确64与110与126千伏及完整来源`);
    const previewResponse = await afterAction(page.waitForResponse(item => item.url() === base + '/api/type-library/imports/preview' && item.request().method() === 'POST', { timeout: 180000 }),
      () => page.getByRole('button', { name: '逐行校验并预览', exact: true }).click());
    await recordResponse(`tai-i-110kv-${caseName}-preview`, previewResponse, await previewResponse.json());
    assert.equal(previewResponse.status(), 200, await previewResponse.text());
    const request = previewResponse.request().postDataJSON(), preview = await previewResponse.json();
    evidence[caseName].preview_request_id = requests.get(previewResponse.request());
    evidence[caseName].preview = preview;
    assert.deepEqual(request.mapping, metadata.mapping);
    assert.equal(request.sheet, sheet.name);
    assert.equal(request.first_data_row, 2);
    assert.deepEqual(request.series.source, metadata.source);
    for (const [key, value] of Object.entries(metadata.declaration)) assert.deepEqual(request.series[key], key === 'name' ? seriesName : value);
    for (const key of ['common', 'common_basis', 'modelling']) assert.deepEqual(request.series[key], {}, '原表缺项不得从来源附件补造');
    assert.equal(request.series.armour_material ?? null, null);
    await expect(page.getByRole('heading', { name: '核对入库预览', exact: true })).toBeVisible();
    return { preview, sheet, seriesName };
  }
  page.on('request', onRequest);
  await write();
  try {
    const before = await read('series-before', '/api/type-library/series');
    await page.goto(base + '/resources/cables/structure-import');
    await expect(page.getByRole('button', { name: '选择结构表文件', exact: true })).toBeEnabled();
    const bad = await uploadAndDeclare(badCsv, '台一110千伏错误I2副本.csv', 'bad');
    assert.deepEqual([bad.preview.valid_count, bad.preview.error_count], [9, 1]);
    assert.equal(bad.preview.rows[0].row_number, 2);
    assert.equal(bad.preview.rows[0].status, 'error');
    assert.ok(bad.preview.rows[0].issues.some(issue => issue.column === 'I2' && issue.field === 'r20'));
    const errorRow = page.getByRole('table', { name: '逐行入库预览', exact: true }).getByRole('row', { name: '原表第 2 行', exact: true });
    await expect(errorRow).toContainText('I2 列');
    await expect(errorRow).toContainText('不可入库');
    await errorRow.scrollIntoViewIfNeeded();
    await expect(errorRow).toBeInViewport({ ratio: 1 });
    await shot('台一110千伏错误副本I2电阻不可解析定位');
    await expect(page.getByRole('checkbox', { name: '明确跳过错误行', exact: true })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: '确认来源与系列声明', exact: true })).not.toBeChecked();
    const denied = page.getByRole('button', { name: '确认入库 9 个规格', exact: true });
    await expect(denied).toBeDisabled();
    await denied.scrollIntoViewIfNeeded();
    await shot('台一110千伏错误副本未跳错未确认不能入库');
    assert.deepEqual(await read('series-after-bad-copy', '/api/type-library/series'), before);
    assert.equal(evidence.mutations.filter(item => item.url.endsWith('/imports/commit')).length, 0);
    await page.getByRole('button', { name: '重新开始', exact: true }).click();
    await expect(page.getByRole('button', { name: '选择结构表文件', exact: true })).toBeEnabled();
    const name = '台一110千伏原始结构表.csv';
    const { preview, sheet } = await uploadAndDeclare(csv, name, 'original');
    assert.deepEqual([preview.rows.length, preview.valid_count, preview.error_count, preview.incomplete_count], [10, 10, 0, 10]);
    assert.deepEqual(preview.execution_standards.items, []);
    assert.deepEqual(preview.execution_standards.missing.map(item => item.declared).sort(), [...metadata.declaration.standards].sort());
    for (const [index, row] of preview.rows.entries()) {
      assert.equal(row.row_number, index + 2); assert.equal(row.status, 'incomplete'); assert.equal(row.closure, null);
      assert.deepEqual(row.payload.materials, []); assert.equal(row.payload.confirmed, false);
      assert.equal(row.payload.specification.um_v, 126000);
      for (const missing of ['导体屏蔽厚度', '绝缘屏蔽厚度', '金属套波纹深度', '金属套波纹节距']) assert.ok(row.missing.includes(missing));
      assert.deepEqual(row.values.map(fact => fact.key).sort(), Object.keys(metadata.mapping).sort());
      for (const fact of row.values) {
        const original = originalRows[index][metadata.mapping[fact.key]], [displayUnit, unit, scale] = units[fact.key];
        assert.equal(fact.display_value, original); assert.equal(fact.display_unit, displayUnit); assert.equal(fact.unit, unit);
        assert.ok(Math.abs(fact.value - original * scale) < Math.max(1e-14, Math.abs(original * scale) * 1e-12));
        assert.equal(fact.confidence, 'reference'); assert.deepEqual(fact.method, { name: '厂家结构表导入', version: '1.1.0' });
        assert.deepEqual(fact.source.catalogue, metadata.source);
        assert.deepEqual([fact.source.kind, fact.source.reviewed, fact.source.file, fact.source.file_sha256, fact.source.sheet, fact.source.row, fact.source.column],
          ['manufacturer', false, name, hash(csv), sheet.name, index + 2, String.fromCharCode(65 + metadata.mapping[fact.key])]);
      }
    }
    await shot('台一110千伏十规格缺项预览不补屏蔽波纹或载流量');
    const commit = page.getByRole('button', { name: '确认入库 10 个规格', exact: true });
    await expect(commit).toBeDisabled();
    const standards = page.getByRole('region', { name: '执行标准来源确认', exact: true });
    for (const name of metadata.declaration.standards) await expect(standards).toContainText(name);
    await page.getByRole('checkbox', { name: '确认来源与系列声明', exact: true }).check();
    await expect(commit).toBeEnabled();
    await commit.scrollIntoViewIfNeeded();
    await shot('台一110千伏保留无年号标准并人工确认未发布草稿');
    const committed = await afterAction(page.waitForResponse(item => item.url() === base + '/api/type-library/imports/commit' && item.request().method() === 'POST', { timeout: 180000 }), () => commit.click());
    const receipt = await committed.json();
    await recordResponse('tai-i-110kv-commit', committed, receipt);
    assert.equal(committed.status(), 201, await committed.text());
    assert.equal(receipt.created, 10); assert.equal(receipt.state, 'draft');
    assert.deepEqual([committed.request().postDataJSON().human_confirmed, committed.request().postDataJSON().skip_errors], [true, false]);
    evidence.commit = { request_id: requests.get(committed.request()), receipt };
    await expect(page.getByRole('heading', { name: '已保存 10 个规格草稿', exact: true })).toBeVisible();
    await shot('台一110千伏十规格人工入库回执');
    await page.getByRole('button', { name: '打开系列，核对与计算', exact: true }).click();
    const series = await read('series-readback', '/api/type-library/series/' + receipt.series_id);
    assert.deepEqual(series.declaration, preview.series); assert.equal(series.specs.length, 10);
    const readbacks = [];
    for (const spec of series.specs) {
      const row = preview.rows.find(row => Math.abs(row.area_m2 - spec.area_m2) < 1e-14);
      assert.ok(row); assert.equal(spec.state, 'draft'); assert.deepEqual(spec.results, []); assert.equal(spec.submission, null);
      const detail = await read(`spec-${row.row_number}`, '/api/type-library/specs/' + spec.id);
      assert.deepEqual(detail.values, row.values);
      const workspace = await read(`workspace-${row.row_number}`, '/api/workspaces/' + spec.workspace_id);
      assert.deepEqual(workspace.type_origin_reference.declared_specification, row.payload.specification);
      const cable = workspace.domain.cable_types[0];
      assert.equal(cable.construction, 'single_core');
      assert.deepEqual([cable.rating.u0, cable.rating.u, cable.rating.um], [64000, 110000, 126000]);
      assert.deepEqual(cable.rating.max_conductor_temperature, {}, '原件90℃仅为来源说明，不自动升级型号温限');
      assert.ok(Object.values(workspace.domain.provenance).every(source => source.reviewed === false));
      assert.ok(workspace.domain.materials.every(material => material.density == null));
      readbacks.push({ detail, workspace });
    }
    evidence.saved = { series, specifications: readbacks };
    for (const area of [240, 800, 1600]) {
      const spec = series.specs.find(spec => Math.abs(spec.area_m2 * 1e6 - area) < 1e-9);
      assert.ok(spec);
      await page.getByRole('table', { name: '系列规格', exact: true }).getByRole('button', { name: spec.name, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: spec.name, exact: true });
      const values = dialog.getByRole('table', { name: '逐项来源', exact: true });
      await expect(values.getByRole('row')).toHaveCount(9);
      for (const key of area === 800 ? ['r20', 'weight'] : ['r20']) {
        const fact = spec.values.find(fact => fact.key === key), row = values.getByRole('row', { name: fact.label, exact: true });
        await expect(row).toContainText('原列口径：' + metadata.source.column_meanings[key].quantity);
        await expect(row).toContainText('原列单位：' + metadata.source.column_meanings[key].unit);
        await expect(row.getByRole('cell').nth(1)).toHaveText(`${fact.display_value} ${fact.display_unit}`);
        await expect(row).toContainText('厂家结构表导入 · 1.1.0'); await expect(row).toContainText('参考');
        const link = row.getByRole('link', { name: '查看来源原件', exact: true });
        await expect(link).toHaveAttribute('href', metadata.source.url); await expect(link).toHaveAttribute('title', metadata.source.url);
        await positionDialogContent(row); await expect(row).toBeInViewport({ ratio: 1 });
        await shot(`台一110千伏${area}平方毫米${key === 'r20' ? '原刊电阻' : '近似重量'}来源回读`);
      }
      if (area === 800) {
        const notes = dialog.locator('details.library-import-original-notes');
        await expect(notes).toHaveCount(1); await notes.locator(':scope > summary').click();
        await expect(notes).toHaveJSProperty('open', true);
        for (const note of metadata.source.limitations) await expect(notes).toContainText(note);
        for (const part of ['800 mm²', '工作温度90℃', '本表未刊载流量']) {
          const note = notes.getByText(metadata.source.limitations.find(value => value.startsWith(part)), { exact: true });
          await positionDialogContent(note); await expect(note).toBeInViewport({ ratio: 1 });
          await shot(`台一110千伏原件限制${part}`);
        }
      }
      await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
    }
    const imports = evidence.mutations.filter(item => item.url.startsWith(base + '/api/type-library/imports/'));
    assert.deepEqual(imports.map(item => item.url.slice((base + '/api/type-library/imports/').length)), ['upload', 'preview', 'upload', 'preview', 'commit']);
    assert.equal(evidence.mutations.some(item => /\/(?:runs|submit|review|publish)(?:\?|$)/.test(item.url)), false, '缺项草稿不得自动计算或批准');
    evidence.data_checks_passed = true;
    evidence.layout_failures = report.layout_failures.slice(layoutStart);
    assert.deepEqual(evidence.layout_failures.map(item => ({ screenshot: item.screenshot, message: item.message })), [], '台一原件流程的原布局和可见名称门禁未通过');
    evidence.status = 'passed';
    report.checks.push(`${viewport.width}：台一64/110(126)kV独立原表真实CSV上传、选表、八列映射；单独I2错误副本定位到电阻列，未跳错和确认时零入库。原件10行全部缺项并人工保存未发布草稿，80个映射值及单位/行列/原件SHA/方法1.1.0/参考来源逐项回读；原CSV固定SHA并保留未映射两列，90个原刊数值由独立原PDF门禁核对。800mm²的0.0211Ω/km、90℃仅为来源说明、缺屏蔽波纹及未刊载流量均保留，零自动运行/审批。`);
  } catch (error) {
    evidence.status = 'failed'; evidence.error = { name: error.name, message: error.message, stack: error.stack };
    try {
      const screenshot = prefix + '-failure.png';
      await page.screenshot({ path: path.join(out, screenshot) });
      await fs.writeFile(path.join(out, prefix + '-failure.txt'), await page.locator('body').innerText());
      evidence.screenshots.push(screenshot); report.screenshots.push(screenshot);
    } catch (captureError) { evidence.failure_capture_error = String(captureError); }
    throw error;
  }
  finally { page.off('request', onRequest); await write(); }
}
