import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Real manufacturer bytes and source metadata enter through visible controls.
 * All upload/preview/commit mutations are dispatched by the existing wizard. */
export async function walkManufacturer({ page, base, viewport, out, root, expect, capture, select, afterAction, recordResponse, positionDialogContent, readApi, report }) {
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'tests/fixtures/jiangnan_yjv22.json'), 'utf8'));
  const csv = await fs.readFile(path.join(root, 'tests/fixtures/jiangnan_yjv22.csv'));
  const digest = createHash('sha256').update(csv).digest('hex');
  assert.equal(digest, metadata.source.csv_sha256);
  const source = { ...metadata.source, transcription_method: metadata.transcription_method,
    confidence: metadata.confidence, reviewed: false, limitations: metadata.limitations,
    published_standards_text: metadata.published_standards_text };
  const originalRows = csv.toString('utf8').trim().split(/\r?\n/).slice(1).map(row => row.split(',').map(Number));
  assert.equal(originalRows.length, 9);
  assert.deepEqual(originalRows[2], [95, 3, 10.5, 86.3, 11050]);
  const mapping = { area: 0, insulation_thickness: 2, outer_diameter: 3, weight: 4 };
  const units = { area: ['mm²', 'm2', 1e-6], insulation_thickness: ['mm', 'm', .001], outer_diameter: ['mm', 'm', .001], weight: ['kg/km', 'kg/m', .001] };
  const uploadName = '江南三芯结构表.csv';
  const startRequest = report.requests.length;
  await page.goto(base + '/resources/cables/structure-import');
  await expect(page.getByRole('button', { name: '选择结构表文件', exact: true })).toBeEnabled();
  const upload = await afterAction(page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/upload') && response.request().method() === 'POST'),
    () => page.getByLabel('结构表文件', { exact: true }).setInputFiles({ name: uploadName, mimeType: 'text/csv', buffer: csv }));
  assert.equal(upload.status(), 201, await upload.text());
  const inspection = await upload.json();
  await fs.writeFile(path.join(out, `${viewport.width}-jiangnan-upload.json`), JSON.stringify({
    request: { method: upload.request().method(), content_type: upload.request().headers()['content-type'],
      filename: uploadName, file_sha256: digest, size: csv.length }, status: upload.status(), response: inspection,
  }, null, 2)); // A multipart file body is not JSON, including small text CSVs.
  assert.equal(inspection.sha256, digest, '原 CSV 字节不得为走查改写');
  assert.equal(inspection.file, uploadName);
  assert.equal(inspection.declarations?.length || 0, 0, '自有 CSV 不应偷偷注入内置样本声明');
  const sheet = inspection.sheets.find(item => item.name === '江南三芯结构表');
  assert.ok(sheet);
  assert.deepEqual([sheet.first_data_row, sheet.data_rows, sheet.columns.length], [2, 9, 5]);
  assert.equal(sheet.columns[4].header, '电缆最大重量（kg/km）');
  await select('工作表', `${sheet.name} · 9 行`);
  await capture('江南真实CSV上传与原始五列');
  await page.getByRole('button', { name: '确认工作表，设置列映射', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认列映射', exact: true })).toBeVisible();
  for (const column of sheet.columns) {
    const key = Object.keys(mapping).find(key => mapping[key] === column.index);
    const field = inspection.fields.find(item => item.key === key);
    if (key) assert.equal(field.unit, units[key][0]);
    await select(`${column.letter} 列对应`, key ? `${field.label} / ${units[key][0]}` : '不导入此列');
  }
  await page.getByRole('combobox', { name: 'E 列对应', exact: true }).scrollIntoViewIfNeeded();
  await capture('江南最大重量原列映射');
  await page.getByRole('button', { name: '填写系列声明', exact: true }).click();
  const form = page.getByRole('form', { name: '系列声明', exact: true });
  const seriesName = `江南公开三芯35千伏 ${viewport.width} ${Date.now()}`;
  for (const [label, value] of [['系列名称', seriesName], ['制造商', metadata.manufacturer], ['型号', 'YJV22'], ['额定相电压 kV', '26'], ['额定线电压 kV', '35']]) await form.getByLabel(label, { exact: true }).fill(value);
  for (const [label, value] of [['芯数', '3 芯'], ['数据身份', '公开厂家资料'], ['导体材料', '铜'], ['绝缘材料', '交联聚乙烯'], ['外护套材料', '聚氯乙烯'], ['铠装材料类别', '未声明具体钢材'], ['原表缺少导体电阻时', '保留缺项，等待厂家提供']]) await select(label, value);
  await expect(form.getByLabel('最高系统电压 kV', { exact: true })).toHaveValue('');
  await expect(form.getByLabel('执行标准', { exact: true })).toHaveValue('');
  await form.getByText('补充原列口径与原件定位', { exact: true }).click();
  const sourceInput = form.getByLabel('来源说明 JSON 文件', { exact: true });
  await sourceInput.setInputFiles({ name: '损坏来源.json', mimeType: 'application/json', buffer: Buffer.from('{"url":') });
  const error = form.getByRole('alert');
  await expect(error).toHaveText('来源说明不是有效 JSON，请检查文件格式。');
  await error.scrollIntoViewIfNeeded();
  assert.equal(report.requests.slice(startRequest).some(item => item.url.endsWith('/api/type-library/imports/preview') || item.url.endsWith('/api/type-library/imports/commit')), false, '坏来源文件不得创建预览或入库');
  await capture('江南来源说明坏JSON明确拒绝');
  const sourceBytes = Buffer.from(JSON.stringify(source, null, 2));
  await fs.writeFile(path.join(out, `${viewport.width}-jiangnan-source-input.json`), sourceBytes);
  await sourceInput.setInputFiles({ name: '江南来源说明.json', mimeType: 'application/json', buffer: sourceBytes });
  await expect(error).toHaveCount(0);
  const loaded = form.getByRole('status').filter({ hasText: '已加载“江南来源说明.json”' });
  await expect(loaded).toBeVisible();
  await loaded.scrollIntoViewIfNeeded();
  await capture('江南加载完整原列口径与原件定位');
  const previewResponse = await afterAction(page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/preview') && response.request().method() === 'POST', { timeout: 180000 }),
    () => page.getByRole('button', { name: '逐行校验并预览', exact: true }).click());
  assert.equal(previewResponse.status(), 200, await previewResponse.text());
  const request = previewResponse.request().postDataJSON(), preview = await previewResponse.json();
  await recordResponse('jiangnan-preview', previewResponse, preview);
  assert.deepEqual(request.mapping, mapping);
  assert.deepEqual(request.series.source, source, '来源附件必须经实际表单保存到预览请求');
  assert.deepEqual([request.series.u0_v, request.series.u_v, request.series.cores, request.series.origin, request.series.resistance_basis], [26000, 35000, 3, 'public', 'stated']);
  assert.equal(request.series.um_v ?? null, null);
  assert.equal(request.series.armour_material ?? null, null, '原文只称钢带，不猜镀锌钢等具体类别');
  for (const key of ['common', 'common_basis', 'modelling']) assert.deepEqual(request.series[key], {}, '加载来源不得填充结构或工况');
  assert.deepEqual(request.series.standards, []);
  assert.deepEqual([preview.rows.length, preview.valid_count, preview.error_count, preview.incomplete_count], [9, 9, 0, 9]);
  assert.deepEqual(preview.execution_standards.items, []);
  for (const [index, row] of preview.rows.entries()) {
    assert.equal(row.status, 'incomplete');
    assert.equal(row.row_number, index + 2);
    assert.ok(row.missing.includes('20 °C 导体直流电阻'));
    assert.deepEqual(row.payload.materials, []);
    assert.equal(row.payload.cable_type, null);
    assert.deepEqual(row.values.map(value => value.key).sort(), Object.keys(mapping).sort());
    for (const fact of row.values) {
      const [displayUnit, siUnit, scale] = units[fact.key], original = originalRows[index][mapping[fact.key]];
      assert.equal(fact.display_value, original); assert.equal(fact.display_unit, displayUnit); assert.equal(fact.unit, siUnit);
      assert.ok(Math.abs(fact.value - original * scale) < 1e-12);
      assert.equal(fact.confidence, 'reference');
      assert.deepEqual(fact.method, { name: '厂家结构表导入', version: '1.1.0' });
      assert.deepEqual(fact.source.catalogue, source);
      assert.deepEqual([fact.source.file, fact.source.file_sha256, fact.source.sheet, fact.source.row, fact.source.column],
        [uploadName, digest, sheet.name, index + 2, String.fromCharCode(65 + mapping[fact.key])]);
    }
  }
  await expect(page.getByRole('heading', { name: '核对入库预览', exact: true })).toBeVisible();
  await capture('江南九规格真实原值与缺项预览');
  const commit = page.getByRole('button', { name: '确认入库 9 个规格', exact: true });
  await expect(commit).toBeDisabled();
  await page.getByRole('checkbox', { name: '确认来源与系列声明', exact: true }).check();
  const commitResponse = await afterAction(page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/commit') && response.request().method() === 'POST', { timeout: 180000 }), () => commit.click());
  assert.equal(commitResponse.status(), 201, await commitResponse.text());
  const receipt = await commitResponse.json();
  await recordResponse('jiangnan-commit', commitResponse, receipt);
  assert.equal(receipt.created, 9);
  assert.equal(commitResponse.request().postDataJSON().human_confirmed, true);
  await expect(page.getByRole('heading', { name: '已保存 9 个规格草稿', exact: true })).toBeVisible();
  await capture('江南九规格人工确认保存草稿');
  await page.getByRole('button', { name: '打开系列，核对与计算', exact: true }).click();
  const series = await readApi('/api/type-library/series/' + receipt.series_id);
  assert.equal(series.specs.length, 9);
  const readbacks = await Promise.all(series.specs.map(spec => readApi('/api/type-library/specs/' + spec.id)));
  for (const detail of readbacks) {
    const expected = preview.rows.find(row => Math.abs(row.area_m2 - detail.spec.area_m2) < 1e-14);
    assert.ok(expected);
    assert.deepEqual(detail.values, expected.values, '入库逐值来源必须与人工确认的预览一致');
    assert.equal(detail.spec.state, 'draft');
  }
  await fs.writeFile(path.join(out, `${viewport.width}-jiangnan-imported-values.json`), JSON.stringify({
    fixture_csv: 'tests/fixtures/jiangnan_yjv22.csv', uploaded_name: uploadName, csv_sha256: digest,
    source_input_sha256: createHash('sha256').update(sourceBytes).digest('hex'), source, series, specifications: readbacks,
  }, null, 2));
  const specification = series.specs.find(spec => Math.abs(spec.area_m2 * 1e6 - 95) < 1e-9);
  assert.ok(specification);
  await page.getByRole('table', { name: '系列规格', exact: true }).getByRole('button', { name: specification.name, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: specification.name, exact: true });
  const values = dialog.getByRole('table', { name: '逐项来源', exact: true });
  await expect(values.getByRole('row')).toHaveCount(5);
  for (const [key, label] of [['weight', '江南最大重量口径与原件网址'], ['outer_diameter', '江南三乘95原刊86点3毫米外径']]) {
    const fact = specification.values.find(value => value.key === key), original = source.column_meanings[key];
    const row = values.getByRole('row', { name: fact.label, exact: true });
    await expect(row).toContainText('原列口径：' + original.quantity);
    await expect(row).toContainText('原列单位：' + original.unit);
    await expect(row.getByRole('cell').nth(1)).toHaveText(`${fact.display_value} ${fact.display_unit}`);
    await expect(row.getByRole('cell').nth(2)).toContainText(source.locator);
    const link = row.getByRole('link', { name: '查看来源原件', exact: true });
    await expect(link).toHaveAttribute('href', source.url);
    await expect(link).toHaveAttribute('title', source.url);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await positionDialogContent(row);
    await expect(row).toBeInViewport({ ratio: 1 });
    await expect(link).toBeInViewport({ ratio: 1 });
    await capture(label);
  }
  await dialog.getByText('原件声明与限制', { exact: true }).click();
  const anomaly = metadata.limitations.find(note => note.includes('86.3'));
  assert.equal(anomaly, '原表3×95 mm²近似外径为86.3 mm，小于相邻规格，按原值保留，须厂家复核。');
  const note = dialog.getByText(anomaly, { exact: true });
  await positionDialogContent(note);
  await expect(note).toBeInViewport({ ratio: 1 });
  await capture('江南86点3原值与来源复核说明');
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  report.checks.push(`${viewport.width}：江南官方原表的真实CSV字节经UI上传、选表、四列映射；坏来源JSON在客户端明确拒绝，随后通过来源文件控件载入完整原列口径/原件定位，未自动填结构或工况。9个三芯规格全部缺项预览并人工保存草稿，回读逐值来源一致；最大重量“不是实测质量或材料密度”、原刊3×95外径86.3mm及随来源保存的厂家复核提示分别截图；原件链接的href/title与官方URL一致。`);
}
