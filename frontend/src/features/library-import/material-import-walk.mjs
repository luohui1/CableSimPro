import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeRequestHeaders, saveRawResponse } from './resource-exchange-walk.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pointer = (...parts) => '/' + parts.map(part => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

async function declaredReference(root, filename, id, expectedSource, expectedRecord, role, property, title) {
  const plugin = path.join(root, 'plugins/cablesim.standards-basis');
  const manifestBytes = await fs.readFile(path.join(plugin, 'plugin.json'));
  const manifest = JSON.parse(manifestBytes), file = 'src/cablesim_standards_basis/' + filename;
  const bytes = await fs.readFile(path.join(plugin, file)), sealed = manifest.files.find(item => item.path === file);
  assert.ok(sealed, '参考数据必须在当前插件封签内');
  assert.equal(hash(bytes), sealed.sha256); assert.equal(bytes.length, sealed.size_bytes);
  const record = JSON.parse(bytes).find(item => item.id === id);
  assert.ok(record); assert.equal(record.source_sha256, expectedSource); assert.equal(hash(canonical(record)), expectedRecord);
  assert.equal(record.verification.status, 'verified'); assert.equal(record.semantic, 'literature_reference');
  const conditions = Object.entries(record.conditions).map(([key, value]) => `${key}=${value}`).join('；');
  const reference = [
    '本次明确采用的文献参考；不是人民电缆厂家实测，可信分档：参考，未人工审核。',
    `${record.standard} ${record.edition}，${record.table}，印刷第 ${record.printed_page} 页，PDF 第 ${record.pdf_page} 页。`,
    `明示用途：${title}；值：${record.value} ${record.quantity.unit}；原文适用条件：${conditions}。`,
    ...record.limitations.map(text => '适用限制：' + text),
    `原件：${record.source_file}；SHA-256：${record.source_sha256}。`,
    `记录：${record.id}；记录 SHA-256：${expectedRecord}。`,
    `来源方法：${manifest.id} ${manifest.version} 封签记录；导入方法：明示材料物性映射 1.0.0。`,
  ].join('\n');
  assert.ok(reference.length <= 2000);
  return { role, property, record, declaration: { value: record.value, unit: record.quantity.unit, reference },
    data_file: file, data_sha256: hash(bytes), manifest_sha256: hash(manifestBytes), plugin_version: manifest.version, record_sha256: expectedRecord };
}

/** All writes originate in the existing wizard's visible controls. API calls
 * below only read the saved Types payloads and exact response bytes. */
export async function walkMaterialImport({ page, base, viewport, out, root, samplePath, expect, capture, select, afterAction, recordResponse, report }) {
  const density = await declaredReference(root, 'records-thermal-capacity-model.json', 'huang-TableA1/r1/density',
    '34fc4f54064ac14e70b437dc99146b295aa21a9bf73d421067475559372a12d1', '98f31a8e4416ecc4dc9659271d57e1b1db780f9d9a526fa12aa3cd56cc2e4bab', 'conductor', 'density', '导体铜密度');
  const capacity = await declaredReference(root, 'records-thermal-capacity.json', 'nielsen-Table1/r5/capacity',
    'e5b2632dfc9e88d5097da1a91c3653df9ed53d61ef77ce82fcfa39de41496bcf', '4c59b9fd293a5928606cca98239f107c75d7ed3158c2cd0ed86a6ca57f9bf699', 'insulation', 'volumetric_heat_capacity', 'XLPE 绝缘体积热容');
  assert.deepEqual(density.record.conditions, { material: 'copper', material_role: 'conductor' });
  assert.deepEqual(capacity.record.conditions, { material: 'XLPE' });
  const declarations = { conductor: { density: density.declaration }, insulation: { volumetric_heat_capacity: capacity.declaration } };
  const wrongUnitDeclarations = { ...declarations, insulation: { volumetric_heat_capacity: {
    ...capacity.declaration, unit: density.declaration.unit,
  } } };
  const audit = { references: [density, capacity], responses: [], requests: [], failed_requests: [], console_errors: [], network_errors: [], readbacks: [], screenshots: [] };
  const tasks = [], pending = new Set(), requestIds = new WeakMap();
  let sequence = 0;
  const requestId = request => { if (!requestIds.has(request)) requestIds.set(request, ++sequence); return requestIds.get(request); };
  const onRequest = request => {
    if (!new URL(request.url()).pathname.startsWith('/api/')) return;
    const id = requestId(request); pending.add(id);
    audit.requests.push({ id, method: request.method(), url: request.url() });
  };
  const onFinished = request => pending.delete(requestId(request));
  const onFailed = request => {
    pending.delete(requestId(request));
    audit.failed_requests.push({ id: requestId(request), method: request.method(), url: request.url(), error: request.failure()?.errorText });
  };
  const onConsole = entry => { if (entry.type() === 'error') audit.console_errors.push({ message: entry.text(), location: entry.location() }); };
  const onResponse = response => {
    if (!new URL(response.url()).pathname.startsWith('/api/') || response.status() < 400) return;
    tasks.push((async () => {
      const raw = await saveRawResponse(response, path.join(out, `${viewport.width}-material-import-http-error-${requestId(response.request())}.json`));
      audit.network_errors.push({ id: requestId(response.request()), method: response.request().method(), url: response.url(), status: response.status(), raw });
    })().catch(error => { audit.network_errors.push({ id: requestId(response.request()), url: response.url(), status: response.status(), body_error: String(error) }); }));
  };
  async function shot(label) {
    const start = report.screenshots.length;
    await capture('明示物性-' + label);
    audit.screenshots.push(...report.screenshots.slice(start));
  }
  async function post(endpoint, label, action, expected = 200) {
    const response = await afterAction(page.waitForResponse(item => new URL(item.url()).pathname === endpoint
      && item.request().method() === 'POST', { timeout: 180000 }), action);
    const body = await response.json(), raw = await recordResponse('material-import-' + label, response, body);
    audit.responses.push({ label, status: response.status(), request: response.request().postDataJSON(), response: body, raw });
    assert.equal(await response.finished(), null, '材料导入响应必须完整结束');
    assert.equal(response.status(), expected, JSON.stringify(body));
    return body;
  }
  async function read(endpoint, label) {
    const response = await page.request.get(base + endpoint, { timeout: 180000 });
    try {
      const raw = await saveRawResponse(response, path.join(out, `${viewport.width}-material-import-${label}-raw.json`));
      const body = await response.json();
      audit.readbacks.push({ endpoint, status: response.status(), raw, body });
      assert.equal(response.status(), 200, JSON.stringify(body));
      return body;
    } finally { await response.dispose(); }
  }
  async function preview(label) {
    const value = await post('/api/type-library/imports/preview', label,
      () => page.getByRole('button', { name: '逐行校验并预览', exact: true }).click());
    await expect(page.getByRole('heading', { name: '核对入库预览', exact: true })).toBeVisible();
    return value;
  }
  const rowAt = index => page.getByRole('region', { name: `材料物性第 ${index} 项`, exact: true });
  const materialRows = page.getByRole('region', { name: /^材料物性第 \d+ 项$/ });
  const roleControl = row => row.getByRole('combobox', { name: /^第 \d+ 项材料用途$/ });
  const propertyControl = row => row.getByRole('combobox', { name: /^第 \d+ 项材料物性$/ });
  // Select exposes its current option as combobox text. Display row numbers
  // may change after returning from a preview; they are not material identities.
  const rowFor = (role, property) => materialRows
    .filter({ has: roleControl(page).filter({ hasText: role }) })
    .filter({ has: propertyControl(page).filter({ hasText: property }) });
  async function visibleOrder() {
    await expect(materialRows).toHaveCount(2);
    return Promise.all((await materialRows.all()).map(async row => ({
      role: (await roleControl(row).innerText()).trim(), property: (await propertyControl(row).innerText()).trim(),
    })));
  }
  async function expectDeclaration(row, role, property, declaration) {
    await expect(row).toHaveCount(1);
    await expect(roleControl(row)).toHaveText(role);
    await expect(propertyControl(row)).toHaveText(property);
    await expect(row.getByLabel('物性数值', { exact: true })).toHaveValue(String(declaration.value));
    await expect(row.getByLabel('物性单位', { exact: true })).toHaveValue(declaration.unit);
    await expect(row.getByLabel('物性出处与适用条件', { exact: true })).toHaveValue(declaration.reference);
    await expect(row.getByRole('status')).toContainText('已保存到本次系列声明');
  }
  async function fill(index, use, property, declaration) {
    await page.getByRole('button', { name: '添加材料物性', exact: true }).click();
    const row = rowAt(index);
    await expect(row.getByLabel('物性数值', { exact: true })).toHaveValue('');
    await expect(row.getByLabel('物性出处与适用条件', { exact: true })).toHaveValue('');
    await select(`第 ${index} 项材料用途`, use); await select(`第 ${index} 项材料物性`, property);
    await row.getByLabel('物性数值', { exact: true }).fill(String(declaration.value));
    await row.getByLabel('物性单位', { exact: true }).fill(declaration.unit);
    await row.getByLabel('物性出处与适用条件', { exact: true }).fill(declaration.reference);
    await row.getByRole('button', { name: '保存此项声明', exact: true }).click();
    await expect(row.getByRole('status')).toContainText('已保存到本次系列声明');
    await row.getByRole('heading').scrollIntoViewIfNeeded();
    await shot(`${use}${property}与原文适用条件`);
    const source = row.getByLabel('物性出处与适用条件', { exact: true });
    const positions = await source.evaluate(element => ({ height: element.clientHeight, maximum: element.scrollHeight - element.clientHeight }));
    for (let top = positions.height; top < positions.maximum + positions.height; top += positions.height) {
      await source.evaluate((element, value) => { element.scrollTop = Math.min(value, element.scrollHeight - element.clientHeight); }, top);
      await shot(`${use}${property}完整出处-${Math.ceil(top / positions.height)}`);
    }
  }
  await page.goto(base + '/resources/cables/structure-import');
  await expect(page.getByRole('button', { name: '选择结构表文件', exact: true })).toBeEnabled();
  page.on('request', onRequest); page.on('requestfinished', onFinished); page.on('requestfailed', onFailed);
  page.on('console', onConsole); page.on('response', onResponse);
  try {
    // Reuse the original workbook already downloaded through the main walk's
    // visible sample link. The server independently recognizes its byte hash.
    assert.equal(typeof samplePath, 'string', '须传入主走查从页面下载的真实 People XLSX 路径');
    const file = samplePath;
    const bytes = await fs.readFile(file);
    const response = await afterAction(page.waitForResponse(item => new URL(item.url()).pathname === '/api/type-library/imports/upload'
      && item.request().method() === 'POST'), () => page.getByLabel('结构表文件', { exact: true }).setInputFiles(file));
    const inspection = await response.json();
    const uploadRaw = await saveRawResponse(response, path.join(out, `${viewport.width}-material-import-upload-raw.json`));
    audit.upload = { file: path.basename(file), size: bytes.length, sha256: hash(bytes), request_headers: safeRequestHeaders(response.request()), status: response.status(), response: inspection, raw: uploadRaw };
    assert.equal(await response.finished(), null); assert.equal(response.status(), 201); assert.equal(inspection.sha256, hash(bytes));
    const declaration = inspection.declarations.find(item => item.table === 'three-core');
    assert.ok(declaration, '须使用真实 People 三芯无铠装结构表');
    const sheet = inspection.sheets.find(item => item.name === declaration.sheet);
    await select('工作表', `${sheet.name} · ${sheet.data_rows ?? sheet.rows} 行`);
    await shot('真实工作表与原列');
    await page.getByRole('button', { name: '确认工作表，设置列映射', exact: true }).click();
    await expect(page.getByRole('heading', { name: '确认列映射', exact: true })).toBeVisible();
    await expect(page.getByLabel('数据起始行', { exact: true })).toHaveValue(String(declaration.first_data_row));
    for (const [key, index] of Object.entries(declaration.mapping)) {
      const column = sheet.columns.find(item => item.index === index), field = inspection.fields.find(item => item.key === key);
      await expect(page.getByRole('combobox', { name: `${column.letter} 列对应`, exact: true })).toHaveText(`${field.label} / ${field.unit}`);
    }
    await shot('保留原列映射');
    await page.getByRole('button', { name: '填写系列声明', exact: true }).click();
    const name = `人民公开三芯结构 · 明示文献参考 ${viewport.width} ${Date.now()}`;
    await page.getByRole('form', { name: '系列声明', exact: true }).getByLabel('系列名称', { exact: true }).fill(name);
    const materialSection = page.getByRole('region', { name: '明示材料物性', exact: true });
    await expect(materialSection.getByRole('status')).toHaveText('尚未声明材料物性；不会自动填入参考值。');
    await materialSection.getByRole('heading', { name: '明示材料物性', exact: true }).scrollIntoViewIfNeeded();
    await shot('空值起步');
    const baseline = await preview('baseline');
    assert.deepEqual([baseline.rows.length, baseline.valid_count, baseline.error_count, baseline.incomplete_count], [11, 11, 0, 0]);
    assert.deepEqual(baseline.mapping, declaration.mapping);
    assert.equal(Object.keys(baseline.series.material_properties ?? {}).length, 0);
    for (const row of baseline.rows) assert.ok(row.payload.materials.every(item => item.density === null && item.volumetric_heat_capacity === null));
    await page.getByRole('button', { name: '返回修改声明', exact: true }).click();
    await fill(1, '导体', '密度', density.declaration);
    await fill(2, '绝缘', '体积热容', wrongUnitDeclarations.insulation.volumetric_heat_capacity);
    audit.declaration_order = { initial: await visibleOrder() };

    // An edited row still owns its saved key until that edit is saved or the
    // row is deleted. A second row must not acquire and then lose that value.
    await select('第 1 项材料用途', '绝缘');
    await expect(rowAt(1).getByRole('status')).toContainText('编辑尚未保存');
    await rowAt(1).getByRole('heading').scrollIntoViewIfNeeded();
    await shot('原声明更改用途尚未保存');
    await page.getByRole('button', { name: '添加材料物性', exact: true }).click();
    await select('第 3 项材料用途', '导体'); await select('第 3 项材料物性', '密度');
    await rowAt(3).getByLabel('物性数值', { exact: true }).fill(String(density.declaration.value));
    await rowAt(3).getByLabel('物性单位', { exact: true }).fill(density.declaration.unit);
    await rowAt(3).getByLabel('物性出处与适用条件', { exact: true }).fill(density.declaration.reference);
    await expect(rowAt(3).getByRole('alert')).toContainText('请先保存或删除原声明，再复用');
    await expect(rowAt(3).getByRole('button', { name: '保存此项声明', exact: true })).toBeDisabled();
    const previewsBeforeReserved = audit.requests.filter(item => item.method === 'POST' && item.url.endsWith('/imports/preview')).length;
    await page.getByRole('button', { name: '逐行校验并预览', exact: true }).click();
    assert.equal(audit.requests.filter(item => item.method === 'POST' && item.url.endsWith('/imports/preview')).length, previewsBeforeReserved);
    assert.ok(await page.getByRole('form', { name: '系列声明', exact: true }).locator('input:invalid').count());
    await rowAt(3).getByRole('alert').scrollIntoViewIfNeeded();
    await shot('原声明旧用途仍占位并拒绝预览');
    await rowAt(3).getByRole('button', { name: '删除此项声明', exact: true }).click();
    await expect(rowAt(3)).toHaveCount(0);
    await select('第 1 项材料用途', '导体');
    await rowAt(1).getByRole('button', { name: '保存此项声明', exact: true }).click();
    await expect(rowAt(1).getByRole('status')).toContainText('已保存到本次系列声明');
    await expect(rowAt(1).getByLabel('物性数值', { exact: true })).toHaveValue(String(density.declaration.value));
    await expect(rowAt(1).getByLabel('物性出处与适用条件', { exact: true })).toHaveValue(density.declaration.reference);
    await rowAt(1).getByRole('heading').scrollIntoViewIfNeeded();
    await shot('原声明改回导体并明确保存');

    // A duplicate is a real unsaved row. The browser must prevent submission;
    // no request is injected to manufacture an error response.
    await page.getByRole('button', { name: '添加材料物性', exact: true }).click();
    await select('第 3 项材料用途', '导体'); await select('第 3 项材料物性', '密度');
    await expect(rowAt(3).getByRole('alert')).toContainText('同一材料用途的同一物性已有声明');
    await expect(rowAt(3).getByRole('button', { name: '保存此项声明', exact: true })).toBeDisabled();
    const previewsBeforeDuplicate = audit.requests.filter(item => item.method === 'POST' && item.url.endsWith('/imports/preview')).length;
    await page.getByRole('button', { name: '逐行校验并预览', exact: true }).click();
    assert.equal(audit.requests.filter(item => item.method === 'POST' && item.url.endsWith('/imports/preview')).length, previewsBeforeDuplicate);
    assert.ok(await page.getByRole('form', { name: '系列声明', exact: true }).locator('input:invalid').count());
    await rowAt(3).scrollIntoViewIfNeeded(); await shot('重复声明明确阻止预览');
    await rowAt(3).getByRole('button', { name: '删除此项声明', exact: true }).click();
    await expect(rowAt(3)).toHaveCount(0);

    const denied = await preview('wrong-unit');
    assert.deepEqual(audit.responses.at(-1).request.series.material_properties, wrongUnitDeclarations);
    assert.deepEqual(denied.series.material_properties, wrongUnitDeclarations);
    audit.expected_row_refusal = { status: 200, field: 'material_properties.insulation.volumetric_heat_capacity', rows: denied.rows.map(item => item.row_number) };
    assert.deepEqual([denied.valid_count, denied.error_count, denied.incomplete_count], [0, 11, 0]);
    for (const row of denied.rows) {
      assert.equal(row.payload, null); assert.equal(row.status, 'error');
      assert.ok(row.issues.some(issue => issue.code === 'TABLE_MATERIAL_INVALID'
        && issue.field === 'material_properties.insulation.volumetric_heat_capacity' && issue.message.includes('SI 单位')));
    }
    await expect(page.getByRole('button', { name: /^确认入库/ })).toBeDisabled();
    assert.equal(audit.requests.filter(item => item.method === 'POST' && item.url.endsWith('/imports/commit')).length, 0);
    await shot('错误单位逐行拒绝且无入库');
    await page.getByRole('button', { name: '返回修改声明', exact: true }).click();
    audit.declaration_order.returned = await visibleOrder();
    assert.deepEqual(audit.declaration_order.returned, audit.declaration_order.initial,
      '同一用途与物性保存后，返回预览不得改变已保存声明顺序');
    const conductorRow = rowFor(/^导体$/, /^密度$/), capacityRow = rowFor(/^绝缘$/, /^体积热容$/);
    await expectDeclaration(conductorRow, '导体', '密度', density.declaration);
    await expectDeclaration(capacityRow, '绝缘', '体积热容', wrongUnitDeclarations.insulation.volumetric_heat_capacity);
    await capacityRow.getByLabel('物性单位', { exact: true }).fill(capacity.declaration.unit);
    await capacityRow.getByRole('button', { name: '保存此项声明', exact: true }).click();
    await expectDeclaration(conductorRow, '导体', '密度', density.declaration);
    await expectDeclaration(capacityRow, '绝缘', '体积热容', capacity.declaration);
    await capacityRow.getByRole('heading').scrollIntoViewIfNeeded(); await shot('纠正热容单位并保留出处');
    const accepted = await preview('corrected');
    assert.deepEqual(audit.responses.at(-1).request.series.material_properties, declarations);
    assert.deepEqual([accepted.valid_count, accepted.error_count, accepted.incomplete_count], [11, 0, 0]);
    assert.deepEqual(accepted.series.material_properties, declarations);
    for (const [index, row] of accepted.rows.entries()) {
      const before = baseline.rows[index].payload, after = row.payload;
      const originalMaterials = new Map(before.materials.map(item => [item.id, item]));
      const materials = new Map(after.materials.map(item => [item.id, item]));
      const originalConductor = before.cable_type.cores[0].conductor.material, conductor = after.cable_type.cores[0].conductor.material;
      const insulation = before.cable_type.cores[0].layers.find(item => item.role === 'insulation').material;
      assert.equal(originalMaterials.get(originalConductor).standard_kind, 'copper_bare');
      assert.equal(originalMaterials.get(insulation).standard_kind, 'XLPE');
      assert.notEqual(conductor, originalConductor); assert.equal(materials.size, originalMaterials.size + 1);
      assert.deepEqual(materials.get(conductor), { ...originalMaterials.get(originalConductor), id: conductor, density: density.declaration.value });
      for (const [id, material] of originalMaterials) assert.deepEqual(materials.get(id), id === insulation
        ? { ...material, volumetric_heat_capacity: capacity.declaration.value } : material);
      const cable = structuredClone(before.cable_type);
      for (const core of cable.cores) core.conductor.material = conductor;
      assert.deepEqual(after.cable_type, cable, '几何、原电阻、屏蔽纵向电阻和全部未给出的值必须原样保留');
      for (const [material, field, selected, role] of [[conductor, 'density', density.declaration, 'conductor'], [insulation, 'volumetric_heat_capacity', capacity.declaration, 'insulation']]) {
        const source = after.sources[pointer('materials', material, field)], evidence = JSON.parse(source.reference);
        assert.equal(source.kind, 'user'); assert.equal(source.reviewed, false); assert.equal(evidence.confidence, 'reference');
        assert.deepEqual(evidence.method, { name: '明示材料物性映射', version: '1.0.0' });
        assert.deepEqual(evidence.evidence, selected); assert.equal(evidence.role, role); assert.equal(evidence.property, field);
      }
    }
    await shot('十一规格纠正后预览');
    await page.getByRole('checkbox', { name: '确认来源与系列声明', exact: true }).check();
    const saved = await post('/api/type-library/imports/commit', 'commit',
      () => page.getByRole('button', { name: /^确认入库/ }).click(), 201);
    assert.equal(saved.created, 11); assert.equal(saved.state, 'draft');
    assert.equal(audit.responses.at(-1).request.human_confirmed, true);
    for (const [index, spec] of saved.specs.entries()) {
      const current = await read(`/api/types/${spec.workspace_id}/workspace`, `type-${index + 1}`);
      assert.deepEqual(current.domain.materials, accepted.rows[index].payload.materials);
      assert.deepEqual(current.domain.cable_types, [accepted.rows[index].payload.cable_type]);
      for (const [field, source] of Object.entries(accepted.rows[index].payload.sources)) if (field.startsWith('/materials/'))
        assert.deepEqual(current.domain.provenance[field], source);
      for (const core of current.domain.cable_types[0].cores) {
        const linked = pointer('cable_types', current.domain.cable_types[0].id, 'cores', core.id, 'conductor', 'material');
        assert.equal(current.domain.provenance[linked].reviewed, false);
        const screen = core.layers.find(item => item.role === 'metallic_screen');
        assert.equal(current.domain.materials.find(item => item.id === screen.material).density, null);
      }
    }
    await expect(page.getByRole('heading', { name: '已保存 11 个规格草稿', exact: true })).toBeVisible();
    await shot('人工确认入库与旧型号回读');
    await page.getByRole('button', { name: '打开系列，核对与计算', exact: true }).click();
    await expect(page.getByRole('table', { name: '系列规格', exact: true }).getByRole('row')).toHaveCount(12);
    await expect.poll(() => pending.size).toBe(0);
    const refreshed = await afterAction(page.waitForResponse(item => new URL(item.url()).pathname === `/api/type-library/series/${saved.series_id}`
      && item.request().method() === 'GET'), () => page.reload());
    const refreshedBody = await refreshed.json();
    assert.equal(refreshed.status(), 200); assert.equal(await refreshed.finished(), null);
    const refreshedRaw = await saveRawResponse(refreshed, path.join(out, `${viewport.width}-material-import-refreshed-series-raw.json`));
    audit.refreshed_series = { response: refreshedBody, raw: refreshedRaw };
    assert.deepEqual(refreshedBody.declaration.material_properties, declarations);
    assert.equal(refreshedBody.specs.length, 11); assert.ok(refreshedBody.specs.every(item => item.state === 'draft' && !item.submission && !item.results.length));
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: '系列规格', exact: true }).getByRole('row')).toHaveCount(12);
    await shot('刷新系列仍为未发布草稿');
    await expect.poll(() => pending.size).toBe(0); await Promise.all(tasks);
    assert.equal(audit.requests.filter(item => item.method === 'POST' && item.url.endsWith('/imports/commit')).length, 1);
    assert.equal(audit.requests.filter(item => item.method === 'POST' && /\/runs(?:\?|$)/.test(item.url)).length, 0);
    assert.deepEqual(audit.failed_requests, []); assert.deepEqual(audit.console_errors, []); assert.deepEqual(audit.network_errors, []);
    audit.outcome = 'passed';
    report.checks.push(`${viewport.width}：真实人民三芯表通过可见控件录入导体铜密度和XLPE热容文献参考；空值与重复项明确处理，错误单位11行拒绝且未入库，纠正后11规格人工保存并经旧Types回读；屏蔽密度仍空、纵向电阻不变、逐字段出处完整，刷新后仍为草稿且未自动运行计算。`);
  } catch (error) {
    try {
      const preview = audit.responses.findLast(item => item.label !== 'commit');
      const clip = (value, length) => String(value ?? '').slice(0, length);
      const properties = preview?.request?.series?.material_properties ?? {};
      const identities = Object.entries(properties).slice(0, 10).flatMap(([role, values]) =>
        Object.entries(values).slice(0, 10).map(([property, declared]) => ({
          role: clip(role, 80), property: clip(property, 80), value: declared.value, unit: clip(declared.unit, 80),
          reference_length: declared.reference?.length ?? null,
          reference_sha256: typeof declared.reference === 'string' ? hash(declared.reference) : null,
          reference_excerpt: clip(declared.reference, 160),
        })));
      const rows = (preview?.response?.rows ?? []).filter(row => row.status === 'error' || row.issues?.length);
      audit.failure = { message: clip(error, 1200), preview_label: preview?.label, http_status: preview?.status,
        counts: { valid: preview?.response?.valid_count, error: preview?.response?.error_count,
          incomplete: preview?.response?.incomplete_count }, request_material_identities: identities,
        row_error_count: rows.length, row_errors: rows.slice(0, 12).map(row => ({ row_number: row.row_number,
          status: row.status, issue_count: row.issues?.length ?? 0, issues: (row.issues ?? []).slice(0, 3).map(issue => ({
            code: clip(issue.code, 80), field: clip(issue.field, 160), message: clip(issue.message, 240),
          })) })) };
      console.error(JSON.stringify({ event: 'material-import-failure', viewport: viewport.width, ...audit.failure }));
    } catch (diagnosticError) {
      console.error(JSON.stringify({ event: 'material-import-diagnostic-error', viewport: viewport.width,
        message: String(diagnosticError).slice(0, 1200), original_error: String(error).slice(0, 1200) }));
    }
    throw error;
  } finally {
    await Promise.allSettled(tasks);
    audit.pending_requests = [...pending];
    await fs.writeFile(path.join(out, `${viewport.width}-material-import-summary.json`), JSON.stringify(audit, null, 2));
    page.off('request', onRequest); page.off('requestfinished', onFinished); page.off('requestfailed', onFailed);
    page.off('console', onConsole); page.off('response', onResponse);
  }
}
