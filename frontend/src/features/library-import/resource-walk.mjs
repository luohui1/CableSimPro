import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const materialCases = [
  { table: 'huang-TableA1', record: 'huang-TableA1/r1/density', parameter: 'density', label: '密度', value: 8889, unit: 'kg/m3', dimension: 'mass_density',
    conditions: { material: 'copper', material_role: 'conductor' }, selections: [['材料组成', '铜'], ['材料用途', '导体']], sourceKind: 'literature', pages: [68, 13],
    source: '34fc4f54064ac14e70b437dc99146b295aa21a9bf73d421067475559372a12d1', recordSha: '98f31a8e4416ecc4dc9659271d57e1b1db780f9d9a526fa12aa3cd56cc2e4bab' },
  { table: 'nielsen-Table1', record: 'nielsen-Table1/r1/capacity', parameter: 'volumetric_heat_capacity', label: '体积热容', value: 3460000, unit: 'J/(m3.K)', dimension: 'volumetric_heat_capacity',
    conditions: { material: 'copper' }, selections: [['材料组成', '铜']], sourceKind: 'literature', pages: [8, 9],
    source: 'e5b2632dfc9e88d5097da1a91c3653df9ed53d61ef77ce82fcfa39de41496bcf', recordSha: 'ec2919ff1358410502e9820213fda2ce407394c4e99bfffb0b615d9be8cb6844' },
  { table: 'iec60287-1-1-table1', record: 'iec60287-1-1-table1/r1/c1', parameter: 'electrical_resistivity_20', label: '20 °C 电阻率', value: 1.7241e-8, unit: 'ohm.m', dimension: 'resistivity',
    conditions: { reference_temperature_k: 293.15, material: 'copper', material_role: 'conductor' }, selections: [['材料组成', '铜'], ['材料用途', '导体']], inputs: [['参考温度 / K', '293.15']], sourceKind: 'standard', pages: [35, 83],
    source: 'b300bb2bea52ce64e24c8137193559d7ee4cc04013ec4122357a2625e868a327', recordSha: '5d49f9b63234b84be6820b2acc6db6de461e16a67855094da7ab8c77f0adea90' },
];
const depthCase = { table: 'iec60287-3-1-annex-a4', record: 'iec60287-3-1-annex-a4/r5/value', parameter: 'depth_m', label: '电缆埋深参考', value: .7, unit: 'm', dimension: 'length',
  conditions: { country: 'China', reference_item: '>1–35kV埋深', u_v: 15000 }, selections: [['国家', '中国'], ['原文参考项目', '>1–35kV埋深']], inputs: [['实际运行线电压 U / V', '15000']], sourceKind: 'standard', pages: [10, 42],
  source: '618e8d8cd829a15cb0bdcf08af4d73afc0b8928a3ea0eeb42bdc75cc87b08f63', recordSha: 'acf5222199c224c333af6e1be96b2af316772a5574e2228af05650fd653c9cf3' };
const soilCase = { table: 'iec60287-3-1-table2', record: 'iec60287-3-1-table2/r2/thermal_resistivity', parameter: 'soil_rho_k_m_w', label: '土壤热阻率', value: 1, unit: 'K.m/W', dimension: 'thermal_resistivity',
  rowTitle: '国家参考资料可用性：国家参考资料不可用；土壤含水状态：湿润；降水与湿润条件：经常降雨',
  conditions: { national_reference: 'unavailable', soil_moisture: 'moist', weather_pattern: 'regular_rain' },
  selections: [['国家参考资料可用性', '国家参考资料不可用'], ['土壤含水状态', '湿润'], ['降水与湿润条件', '经常降雨']], sourceKind: 'standard', pages: [7, 39],
  source: '618e8d8cd829a15cb0bdcf08af4d73afc0b8928a3ea0eeb42bdc75cc87b08f63', recordSha: 'bcb4c7549feaaaa00890740eb50af37d3fa15ec84f1c3986cd1d2a5b31f6afaa' };
const escapePointer = value => value.replaceAll('~', '~0').replaceAll('/', '~1');
const sha = value => assert.match(value, /^[a-f0-9]{64}$/);

/** New resource actions use their real visible forms. Only explicit research
 * condition preparation and isolated history restoration use existing Types
 * APIs; neither replaces resource creation, publication, binding or adoption. */
export async function walkResources({ page, base, viewport, out, expect, capture, select, afterAction, recordResponse, positionDialogContent, readApi, report }) {
  assert.equal(process.env.E2E_ISOLATED, '1');
  const audit = { selections: [], assets: [], material: {}, environment: {}, expected_ui_refusals: [], receipt_downloads: [] };
  const write = (name, value) => fs.writeFile(path.join(out, `${viewport.width}-resources-${name}.json`), JSON.stringify(value, null, 2));
  async function postUI(endpoint, button, name, status = 200) {
    const response = await afterAction(page.waitForResponse(value => new URL(value.url()).pathname === endpoint && value.request().method() === 'POST', { timeout: 300000 }), () => button.click());
    assert.equal(response.status(), status, await response.text());
    assert.equal(response.request().headers()['x-cablesim-actor'], 'human');
    const value = await response.json();
    await recordResponse(`resources-${name}`, response, value);
    return { request: response.request().postDataJSON(), value };
  }
  async function explicitTypesWrite(endpoint, method, body, name) {
    const response = await fetch(base + endpoint, { method, headers: { 'Content-Type': 'application/json', 'X-CableSim-Actor': 'human' }, body: JSON.stringify(body) });
    const value = await response.json();
    await write(name, { endpoint, method, actor: 'human', request: body, status: response.status, response: value });
    assert.equal(response.ok, true, JSON.stringify(value));
    return value;
  }
  async function openTable(category, id) {
    const back = page.getByRole('button', { name: '返回资料目录', exact: true });
    if (await back.count()) await back.click();
    const table = await readApi(`/api/library/resources/table?category=${category}&table_id=${encodeURIComponent(id)}`);
    const row = page.getByRole('table', { name: `${category === 'materials' ? '材料' : '环境'}资料目录`, exact: true })
      .getByRole('row', { name: `${table.table.standard} ${table.table.table} ${table.table.title}`, exact: true });
    await row.getByRole('button', { name: '查看资料表', exact: true }).click();
    await expect(page.getByRole('heading', { name: `${table.table.title} · ${table.table.standard}—${table.table.edition} ${table.table.table}`, exact: true })).toBeVisible();
    return table;
  }
  async function choose(category, item, first = false) {
    const table = await openTable(category, item.table);
    const original = table.rows.find(row => row.id === item.record);
    assert.ok(original); assert.equal(original.value, item.value);
    assert.deepEqual([original.printed_page, original.pdf_page], item.pages);
    assert.equal(original.source_sha256, item.source); assert.equal(original.record_sha256, item.recordSha);
    assert.equal(original.trust.grade, 'reference'); assert.equal(original.selectable, true);
    const row = page.getByRole('table', { name: '原表逐条记录', exact: true }).getByRole('row', { name: `${item.rowTitle ?? original.row_label}，${original.quantity.name}，${original.value}`, exact: true });
    await row.getByRole('button', { name: '核对条件与 SI 值', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '核对原值与适用条件', exact: true });
    const lookup = dialog.getByRole('button', { name: '核对并读取 SI 值', exact: true });
    await expect(lookup).toBeDisabled();
    for (const [label] of item.selections) await expect(dialog.getByRole('combobox', { name: `选值条件 · ${label}`, exact: true })).toHaveText('请按实际条件选择');
    for (const [label] of item.inputs ?? []) await expect(dialog.getByLabel(`选值条件 · ${label}`, { exact: true })).toHaveValue('');
    const count = report.requests.filter(request => request.method === 'POST' && request.url.endsWith('/api/library/resources/select')).length;
    if (first) {
      await positionDialogContent(dialog.getByRole('heading', { name: '本次实际条件', exact: true }));
      await capture(category === 'materials' ? '材料条件空白时明确阻止选值' : item.parameter === 'depth_m' ? '环境实际电压空白不取范围中值' : '环境实际条件空白时阻止选值');
      assert.equal(report.requests.filter(request => request.method === 'POST' && request.url.endsWith('/api/library/resources/select')).length, count);
      audit.expected_ui_refusals.push({ kind: 'empty_conditions', category, record: item.record, request_sent: false });
    }
    for (const [label, value] of item.selections) await select(`选值条件 · ${label}`, value);
    for (const [label, value] of item.inputs ?? []) await dialog.getByLabel(`选值条件 · ${label}`, { exact: true }).fill(value);
    await expect(lookup).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    const selected = await postUI('/api/library/resources/select', lookup, `select-${item.parameter}`);
    assert.deepEqual(selected.request.conditions, item.conditions);
    assert.equal(selected.request.record_id, item.record);
    const expected = structuredClone(original);
    for (const key of ['trust', 'selectable', 'method_version']) delete expected[key];
    assert.deepEqual(selected.value.record, expected, 'UI 选值不得改动原文摘录的任何字段');
    assert.deepEqual(selected.value.quantity, { value: item.value, unit: item.unit, dimension: item.dimension });
    assert.equal(selected.value.quantity_status, 'available');
    assert.equal(selected.value.trust.grade, 'reference');
    assert.equal(selected.value.approval, 'not_granted'); assert.equal(selected.value.applied_to_workspace, false);
    for (const key of ['release_digest', 'data_sha256', 'request_sha256', 'artifact_sha256']) sha(selected.value[key]);
    assert.deepEqual(selected.value.method, table.method);
    await expect(dialog.getByRole('status').filter({ hasText: '服务端已核对' })).toContainText(String(item.value));
    await dialog.locator('.library-import-dialog-body').evaluate(element => element.scrollTo({ top: 0 }));
    await capture(`原文${item.label}原值SI页码与参考分档`);
    if (category === 'materials' && first) {
      const technical = dialog.locator('details').filter({ has: page.locator('summary', { hasText: '来源完整性与技术核对' }) });
      await technical.locator('summary').click();
      await expect(technical).toHaveJSProperty('open', true);
      for (const key of ['release_digest', 'data_sha256', 'request_sha256', 'artifact_sha256']) await expect(technical).toContainText(selected.value[key]);
      await expect(technical).toContainText(item.source); await expect(technical).toContainText(item.recordSha);
      await positionDialogContent(technical.locator('summary'));
      await capture('材料来源技术折叠原件与四项固定摘要');
      const download = await afterAction(page.waitForEvent('download'), () => technical.getByRole('button', { name: '下载该条固定回执', exact: true }).click());
      const filename = path.join(out, `${viewport.width}-resource-reference-receipt.json`);
      await download.saveAs(filename); assert.equal(await download.failure(), null);
      const downloaded = JSON.parse(await fs.readFile(filename, 'utf8'));
      assert.deepEqual(downloaded, { selection: selected.request, receipt: selected.value }, '下载必须保留逐字段完整回执，不重新生成来源或条件');
      audit.receipt_downloads.push({ file: path.basename(filename), record_sha256: item.recordSha, release_digest: selected.value.release_digest, exact: true });
      await technical.locator('summary').click();
    }
    await dialog.getByRole('button', { name: '加入本次参考资料', exact: true }).click();
    await expect(dialog).toBeHidden();
    audit.selections.push({ parameter: item.parameter, ...selected });
    return selected;
  }
  async function createAndPublish(category, entries) {
    const kind = category === 'materials' ? 'material' : 'installation';
    const logName = category === 'environment' ? `${kind}-${entries[0].parameter}` : kind;
    const before = await readApi(`/api/foundation/assets?kind=${kind}`);
    await page.getByRole('button', { name: '预览参考草稿', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '生成参考资料草稿', exact: true });
    const name = `${category === 'materials' ? '铜三项参考物性' : entries.some(item => item.parameter === 'depth_m') ? '原文电缆埋深参考基准未明' : '明确研究语境下的湿土热阻率参考'} ${viewport.width} ${Date.now()}`;
    await dialog.getByLabel('参考资料名称', { exact: true }).fill(name);
    const preview = await postUI(`/api/library/resources/${category}/draft-preview`, dialog.getByRole('button', { name: '读取草稿预览', exact: true }), `${logName}-draft-preview`);
    assert.equal(preview.value.approval, 'not_granted'); assert.equal(preview.value.applied_to_workspace, false);
    assert.equal((await readApi(`/api/foundation/assets?kind=${kind}`)).total, before.total, '草稿预览不能写资产库');
    assert.equal(preview.value.release.name, name);
    for (const entry of entries) {
      const evidence = preview.value.release.reference_evidence.find(item => item.parameter === entry.parameter);
      assert.ok(evidence); assert.deepEqual(evidence.selection, entry.request);
      assert.deepEqual(evidence.receipt, entry.value, '资料草稿须保存 UI 选值的同一权威回执');
      assert.deepEqual(evidence.quantity, entry.value.quantity); assert.equal(evidence.record_sha256, entry.value.record.record_sha256);
    }
    await expect(dialog.getByRole('button', { name: '确认创建参考草稿', exact: true })).toBeDisabled();
    await capture(`${kind === 'material' ? '材料' : '环境'}草稿预览不入库`);
    await dialog.getByRole('checkbox').check();
    const saved = await postUI(`/api/library/resources/${category}/draft`, dialog.getByRole('button', { name: '确认创建参考草稿', exact: true }), `${logName}-draft`, 201);
    assert.equal(saved.request.preview_digest, preview.value.preview_digest); assert.equal(saved.request.human_confirmed, true);
    assert.equal(saved.request.asset_id, preview.request.asset_id); assert.equal(saved.request.version, preview.request.version);
    assert.deepEqual(saved.value.release, preview.value.release); assert.equal(saved.value.content_sha256, preview.value.content_sha256);
    assert.equal(saved.value.status, 'draft'); assert.equal(saved.value.applied_to_workspace, false);
    assert.equal((await readApi(`/api/foundation/assets?kind=${kind}`)).total, before.total + 1);
    await expect(dialog).toBeHidden();
    let asset = saved.value;
    for (const [action, opener, title, confirmation] of [
      ['review', '核对参考来源', '核对参考来源', '确认已核对来源'],
      ['publish', '发布参考版本', '发布参考版本', '确认发布参考版本'],
    ]) {
      await page.getByRole('button', { name: opener, exact: true }).click();
      const publication = page.getByRole('dialog', { name: title, exact: true });
      await expect(publication.getByRole('button', { name: confirmation, exact: true })).toBeDisabled();
      await publication.getByLabel('参考资料核对说明', { exact: true }).fill('人工核对原文、逐项单位和适用限制；仅发布参考资料，不作实测或工程批准。');
      await publication.getByRole('checkbox').check();
      await capture(`${kind === 'material' ? '材料' : '环境'}${action === 'review' ? '逐项来源人工核对' : '参考版本人工发布'}`);
      const result = await postUI(`/api/foundation/assets/${asset.id}/transition`, publication.getByRole('button', { name: confirmation, exact: true }), `${logName}-${action}`);
      assert.equal(result.request.expected_revision, asset.revision); assert.equal(result.request.content_sha256, asset.content_sha256);
      assert.equal(result.value.content_sha256, saved.value.content_sha256); assert.deepEqual(result.value.release, saved.value.release);
      assert.equal(result.value.revision, asset.revision + 1); asset = result.value;
    }
    assert.equal(asset.status, 'published'); assert.ok(asset.release.sources.every(source => source.reviewed === false));
    assert.deepEqual(asset, await readApi(`/api/foundation/assets/${asset.id}`));
    audit.assets.push({ category, draft_preview: preview.value, published: asset });
    return asset;
  }

  await page.getByRole('tab', { name: '材料与环境', exact: true }).click();
  await expect(page.getByRole('table', { name: '材料资料目录', exact: true })).toBeVisible();
  await capture('真实材料标准与文献目录');
  const materialSelections = [];
  for (const [index, item] of materialCases.entries()) materialSelections.push({ parameter: item.parameter, ...await choose('materials', item, index === 0) });
  const materialAsset = await createAndPublish('materials', materialSelections);
  assert.deepEqual(materialAsset.release.sources.map(source => source.kind), materialCases.map(item => item.sourceKind));
  const types = await readApi('/api/design/type-workspaces');
  const qifanCandidates = types.filter(item => item.name === '起帆 ZC-YJLW03-Z-64/110 kV 1×800');
  assert.equal(qifanCandidates.length, 1, '验收必须使用既有起帆真实型号，不能临时伪造材料空值');
  const qifan = qifanCandidates[0], wid = qifan.id;
  const initial = await readApi(`/api/types/${wid}/workspace`);
  const cu = initial.domain.materials.find(item => item.id === 'material/cu');
  assert.equal(cu.standard_kind, 'copper_bare');
  for (const item of materialCases) assert.equal(cu[item.parameter] ?? null, null, '种子真实缺项必须保持，不能先改数据制造正例');
  const historicalInitial = await readApi(`/api/workspaces/${wid}/revisions/${initial.revision}`);
  await select('目标型号', `${qifan.name} · 输入修订 ${qifan.revision}`);
  const targets = await readApi(`/api/types/${wid}/resources`), target = targets.targets.find(item => item.id === 'material/cu');
  assert.ok(target); await select('目标设计材料', target.name);
  const bindingPreview = await postUI(`/api/types/${wid}/resources/material-preview`, page.getByRole('button', { name: '预览来源绑定', exact: true }), 'material-bind-preview');
  assert.equal(bindingPreview.request.expected_revision, initial.revision); sha(bindingPreview.value.digest);
  const bindingDialog = page.getByRole('dialog', { name: '核对材料来源绑定', exact: true });
  await expect(bindingDialog).toBeVisible();
  await expect(bindingDialog.getByRole('button', { name: '确认仅绑定来源', exact: true })).toBeDisabled();
  await bindingDialog.getByRole('checkbox').check();
  await capture('仅绑定铜材料来源不采用数值');
  const binding = await postUI(`/api/types/${wid}/resources/material-confirm`, bindingDialog.getByRole('button', { name: '确认仅绑定来源', exact: true }), 'material-bind');
  const bound = await readApi(`/api/types/${wid}/workspace`);
  assert.deepEqual(bound.domain, initial.domain, '来源绑定不能改动材料数值或结构');
  assert.equal(bound.type_resource_bindings.material['material/cu'].resource_id, materialAsset.id);
  assert.equal(binding.request.expected_revision, initial.revision);
  assert.equal(binding.request.preview_digest, bindingPreview.value.digest);
  audit.material = { workspace_id: wid, initial, historical_initial: historicalInitial, binding_preview: bindingPreview, binding, bound, adoptions: [], undos: [] };
  let current = bound;
  for (const item of materialCases) {
    await expect(page.getByRole('combobox', { name: '待核对材料物性', exact: true })).toBeEnabled();
    await select('待核对材料物性', item.label);
    const preview = await postUI('/api/library/resources/materials/preview', page.getByRole('button', { name: '预览这一项物性', exact: true }), `material-${item.parameter}-preview`);
    assert.equal(preview.request.expected_revision, current.revision); assert.equal(preview.value.adoptable, true, preview.value.reason);
    assert.equal(preview.value.comparison.actual, null); assert.ok(preview.value.comparison.condition_checks.every(check => check.status === 'matched'));
    assert.equal(preview.value.evidence.quantity.value, item.value); assert.equal(preview.value.evidence.record_sha256, item.recordSha);
    assert.equal(preview.value.applied_to_workspace, false); assert.equal(preview.value.approval, 'not_granted');
    const dialog = page.getByRole('dialog', { name: '核对并采用一项材料物性', exact: true });
    await expect(dialog.getByRole('button', { name: '确认采用这一项物性', exact: true })).toBeDisabled();
    await capture(`铜${item.label}缺项与真实参考逐项预览`);
    await dialog.getByRole('checkbox').check();
    const adopted = await postUI('/api/library/resources/materials/adopt', dialog.getByRole('button', { name: '确认采用这一项物性', exact: true }), `material-${item.parameter}-adopt`);
    assert.equal(adopted.request.preview_digest, preview.value.preview_digest);
    assert.equal(adopted.request.human_confirmed, true); assert.equal(adopted.request.acknowledge_reference_limits, true);
    assert.equal(adopted.value.revision, current.revision + 1);
    const saved = await readApi(`/api/types/${wid}/workspace`), provenancePath = '/materials/material~1cu/' + item.parameter;
    assert.deepEqual(saved, adopted.value);
    assert.equal(saved.domain.materials.find(value => value.id === 'material/cu')[item.parameter], item.value);
    const source = saved.domain.provenance[provenancePath];
    assert.equal(source.kind, 'asset'); assert.equal(source.reviewed, false);
    const evidence = JSON.parse(source.reference);
    assert.equal(evidence.content_sha256, materialAsset.content_sha256); assert.equal(evidence.resource_id, materialAsset.id);
    assert.deepEqual(evidence.reference_value.resource_reference, preview.value.evidence);
    const expected = structuredClone(current.domain);
    expected.materials.find(value => value.id === 'material/cu')[item.parameter] = item.value;
    expected.provenance[provenancePath] = source;
    assert.deepEqual(saved.domain, expected, '每次采用只能改变明确选择的物性及其来源');
    assert.deepEqual((await readApi(`/api/workspaces/${wid}/revisions/${initial.revision}`)).state, historicalInitial.state);
    audit.material.adoptions.push({ parameter: item.parameter, preview, adopted, readback: saved });
    current = saved;
    await expect(page.getByRole('status').filter({ hasText: `所选物性已写入型号输入修订 ${saved.revision}` })).toBeVisible();
    await capture(`铜${item.label}人工采用并保存来源`);
  }
  await expect(page.getByRole('button', { name: '预览这一项物性', exact: true })).toBeEnabled();
  const same = await postUI('/api/library/resources/materials/preview', page.getByRole('button', { name: '预览这一项物性', exact: true }), 'material-same-value-refused');
  assert.equal(same.value.adoptable, false); assert.equal(same.value.comparison.status, 'same');
  const sameDialog = page.getByRole('dialog', { name: '核对并采用一项材料物性', exact: true });
  await expect(sameDialog.getByRole('button', { name: '确认采用这一项物性', exact: true })).toBeDisabled();
  await expect(sameDialog.getByRole('status')).toContainText('该值已一致');
  await capture('已有相同物性时阻止重复采用');
  await sameDialog.getByRole('button', { name: '关闭', exact: true }).click();
  audit.expected_ui_refusals.push({ kind: 'same_material_value', preview: same.value });
  // The same database is used for both viewport loops. Exercise the real history
  // API, preserving the binding while restoring the original three missing facts.
  for (const item of [...materialCases].reverse()) {
    const restored = await explicitTypesWrite(`/api/workspaces/${wid}/history/undo`, 'POST', { expected_revision: current.revision }, `undo-${item.parameter}`);
    assert.equal(restored.domain.materials.find(value => value.id === 'material/cu')[item.parameter] ?? null, null);
    assert.equal(restored.type_resource_bindings.material['material/cu'].resource_id, materialAsset.id);
    audit.material.undos.push(restored); current = restored;
  }
  assert.deepEqual(current.domain, initial.domain, '真实 undo 必须恢复原始材料和结构，不得用 DB 改写复原');
  assert.deepEqual((await readApi(`/api/workspaces/${wid}/revisions/${initial.revision}`)).state, historicalInitial.state);
  await write('material-audit', audit.material);

  // Legacy releases remain readable; viewing their source records cannot turn
  // missing lookup receipts into evidence for the new adoption path.
  const legacyList = await readApi('/api/foundation/assets?kind=material&limit=100');
  let legacy;
  for (const summary of legacyList.items) {
    if (summary.id === materialAsset.id || legacyList.items.filter(item => item.name === summary.name && item.version === summary.version).length !== 1) continue;
    const detail = await readApi(`/api/foundation/assets/${summary.id}`);
    if (!detail.release.reference_evidence?.length && detail.release.parameters.length && detail.release.sources.length) { legacy = detail; break; }
  }
  assert.ok(legacy, '发布种子须保留可读的既有材料参数与来源');
  await page.getByRole('button', { name: '返回资料版本列表', exact: true }).click();
  await page.getByLabel('按名称查找参考资料', { exact: true }).fill(legacy.name);
  await page.getByRole('table', { name: '参考资料版本', exact: true }).getByRole('row', { name: `${legacy.name} ${legacy.version}`, exact: true }).getByRole('button', { name: '查看固定版本', exact: true }).click();
  const oldParameters = page.getByRole('table', { name: '原有资料参数', exact: true });
  const oldSources = page.getByRole('table', { name: '原有资料来源', exact: true });
  await expect(oldParameters.getByRole('row')).toHaveCount(legacy.release.parameters.length + 1);
  await expect(oldSources.getByRole('row')).toHaveCount(legacy.release.sources.length + 1);
  for (const [index, parameter] of legacy.release.parameters.entries()) await expect(oldParameters.getByRole('row').nth(index + 1)).toContainText(String(parameter.quantity.value));
  for (const [index, source] of legacy.release.sources.entries()) {
    const row = oldSources.getByRole('row').nth(index + 1);
    if (/^[\s]*[\[{]/.test(source.reference)) {
      await row.locator('summary').click();
      const original = row.getByRole('textbox', { name: `原有资料出处 ${index + 1}`, exact: true });
      await expect(original).toHaveValue(source.reference); await expect(original).toHaveAttribute('readonly', '');
    } else await expect(row).toContainText(source.reference);
  }
  await expect(page.getByRole('region', { name: '材料来源绑定与逐项采用', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '预览这一项物性', exact: true })).toHaveCount(0);
  await oldParameters.scrollIntoViewIfNeeded(); await capture('既有材料版本原参数保持只读可查');
  await oldSources.scrollIntoViewIfNeeded(); await capture('既有材料原出处完整可读且缺回执不能新采用');
  assert.deepEqual(await readApi(`/api/foundation/assets/${legacy.id}`), legacy);
  await write('legacy-asset-readonly', { asset: legacy, unchanged: true, lookup_receipt_synthesized: false });

  await select('资料类别', '敷设与环境');
  await page.getByRole('button', { name: '浏览资料目录', exact: true }).click();
  const environmentalTable = await openTable('environment', depthCase.table);
  const range = environmentalTable.rows.find(item => item.id === 'iec60287-3-1-annex-a4/r1/value');
  assert.deepEqual(range.value, { min: 1, max: 1.2 }); assert.equal(range.selectable, false);
  await page.getByRole('table', { name: '原表逐条记录', exact: true }).getByRole('row', { name: /^土壤热阻率，土壤热阻率，/ }).getByRole('button', { name: '查看缺项与范围', exact: true }).click();
  const rangeDialog = page.getByRole('dialog', { name: '核对原值与适用条件', exact: true });
  await expect(rangeDialog.getByRole('button', { name: '核对并读取 SI 值', exact: true })).toBeDisabled();
  await expect(rangeDialog.getByRole('status')).toContainText('未给唯一数值');
  await capture('中国土壤范围保留原文且拒绝自动选值');
  await rangeDialog.getByRole('button', { name: '关闭', exact: true }).click();
  audit.expected_ui_refusals.push({ kind: 'source_range', source_record: range, numerical_value_created: false });
  const selectedDepth = { parameter: depthCase.parameter, ...await choose('environment', depthCase, true) };
  const depthAsset = await createAndPublish('environment', [selectedDepth]);
  const depthAdoption = page.getByRole('checkbox', { name: '环境参考字段 · 原文电缆埋深（基准待核）', exact: true });
  await expect(depthAdoption).toBeDisabled();
  await depthAdoption.scrollIntoViewIfNeeded();
  await capture('原文埋深基准未明时明确禁止采用为中心埋深');
  audit.expected_ui_refusals.push({ kind: 'depth_measurement_basis_missing', asset: depthAsset, adoption_request_sent: false });
  await page.getByRole('button', { name: '浏览资料目录', exact: true }).click();
  const selectedSoil = { parameter: soilCase.parameter, ...await choose('environment', soilCase, true) };
  const environmentAsset = await createAndPublish('environment', [selectedSoil]);
  const seriesList = await readApi('/api/type-library/series');
  const seriesSummary = seriesList.items.find(item => item.name.startsWith(`人民 YJV22 已核对 ${viewport.width} `) && item.cores === 3 && item.u_v === 15000);
  assert.ok(seriesSummary, '必须使用主走查已从真实人民结构表入库的对应窗口系列');
  let series = await readApi(`/api/type-library/series/${seriesSummary.id}`), spec = series.specs[0];
  const workspace = await readApi(`/api/types/${spec.workspace_id}/workspace`);
  const runs = await readApi(`/api/types/${spec.workspace_id}/display-runs?after=0&limit=5`);
  const old = runs.items.find(item => ['succeeded', 'partial'].includes(item.status));
  assert.ok(old, '已完成的真实批量运行必须可读取，才能验证旧快照不被覆盖');
  const oldEndpoint = `/api/workspaces/${spec.workspace_id}/studies/${old.study}/runs/${old.id}?view=full`;
  const oldRun = await readApi(oldEndpoint);
  const document = structuredClone(workspace.domain), circuit = document.circuits[0];
  assert.equal(document.cable_types[0].construction, 'three_core');
  const researchSource = { kind: 'user', reviewed: false, reference: '明确研究输入：系统线电压15 kV、三相50 Hz；不是厂家属性，也不表示现场勘测。' };
  circuit.system = { ...circuit.system, kind: 'ac_three_phase', frequency: 50, voltage: 15000 };
  circuit.cables[0].phase = 'L1L2L3';
  for (const key of ['kind', 'frequency', 'voltage']) document.provenance[`/circuits/${escapePointer(circuit.id)}/system/${key}`] = researchSource;
  const prepared = await explicitTypesWrite(`/api/types/${spec.workspace_id}/document`, 'PUT', { expected_revision: workspace.revision, request_id: randomUUID(), document }, 'explicit-research-inputs');
  assert.deepEqual(prepared.domain.cable_types, workspace.domain.cable_types); assert.deepEqual(prepared.domain.materials, workspace.domain.materials);
  assert.deepEqual(prepared.domain, document, '研究条件录入仅能保存明示的系统事实与来源');
  series = await readApi(`/api/type-library/series/${seriesSummary.id}`); spec = series.specs.find(item => item.id === spec.id);
  assert.equal(spec.workspace_revision, prepared.revision);
  await select('环境参考目标系列', series.series.name);
  await select('环境参考目标规格', `${spec.name} · 规格版本 ${spec.version} · 输入修订 ${spec.workspace_revision}`);
  const environment = page.getByRole('region', { name: '环境参考预览与工况采用', exact: true });
  await environment.getByRole('checkbox', { name: '环境参考字段 · 土壤热阻率', exact: true }).check();
  await expect(environment.getByRole('combobox', { name: '当前工况条件 · 土壤含水状态', exact: true })).toHaveText('请按实际条件选择');
  await expect(environment.getByLabel('中心埋深 m', { exact: true })).toHaveValue('');
  await expect(environment.getByRole('button', { name: '预览环境字段变化', exact: true })).toBeDisabled();
  for (const [label, value] of soilCase.selections) await select(`当前工况条件 · ${label}`, value);
  await select('敷设排列', '三芯直埋 · 单回');
  for (const [label, value] of [
    ['工况名称', '明示交流研究条件下的湿土参考'], ['中心埋深 m', '0.9'], ['土壤热阻率 K·m/W', '1.2'],
    ['环境温度 °C', '25'], ['交流频率 Hz', '50'], ['集肤效应系数 kₛ 1', '1'], ['邻近效应系数 kₚ 1', '1'],
    ['护套初始温度 °C', '70'], ['电流收敛容差 A', '0.00000001'], ['最大迭代次数 次', '300'],
    ['工况来源', '明示研究工况：中心埋深0.9 m、土温25 °C、原土壤热阻率1.2 K·m/W、50 Hz、两端接地；本研究明确讨论国家参考资料不可用、湿润土壤及经常降雨条件，不表示现场勘测。'],
    ['方法参数来源', '明确研究假设：kₛ=kₚ=1、忽略涡流、精确T4；70 °C仅为迭代初值、容差1e-8 A和上限300次为数值控制，不是材料实测。'],
  ]) await environment.getByLabel(label, { exact: true }).fill(value);
  await select('金属套接地', '两端接地'); await select('护套涡流损耗', '明确忽略（须核对适用条件）'); await select('土壤热阻公式', '精确式');
  await environment.getByRole('heading', { name: '统一计算工况', exact: true }).scrollIntoViewIfNeeded();
  await capture('环境参考采用前逐字段明确实际研究工况');
  const envPreview = await postUI('/api/library/resources/environment/preview', environment.getByRole('button', { name: '预览环境字段变化', exact: true }), 'environment-preview');
  assert.equal(envPreview.request.expected_revision, prepared.revision);
  assert.deepEqual(envPreview.request.conditions, soilCase.conditions);
  assert.equal(envPreview.value.before.soil_rho_k_m_w, 1.2); assert.equal(envPreview.value.proposed.soil_rho_k_m_w, 1);
  assert.equal(envPreview.value.changes.length, 1); assert.equal(envPreview.value.changes[0].parameter, 'soil_rho_k_m_w');
  assert.deepEqual(envPreview.value.changes[0].reference_evidence, environmentAsset.release.reference_evidence[0]);
  const unchanged = { ...envPreview.value.before, soil_rho_k_m_w: 1 };
  assert.deepEqual(envPreview.value.proposed, unchanged, '只允许改变明确选择的土壤热阻率字段');
  assert.equal(envPreview.value.approval, 'not_granted'); assert.equal(envPreview.value.applied_to_workspace, false);
  assert.deepEqual((await readApi(`/api/types/${spec.workspace_id}/workspace`)).domain, prepared.domain);
  const envDialog = page.getByRole('dialog', { name: '核对环境字段并用于本次计算', exact: true });
  await expect(envDialog.getByRole('button', { name: '确认采用并计算这一规格', exact: true })).toBeDisabled();
  await capture('湿土热阻率一点二到一点零的固定来源预览');
  const conditionDetails = envDialog.locator('details').filter({ has: page.locator('summary', { hasText: '本次工况与方法输入' }) });
  await conditionDetails.locator('summary').click();
  await expect(conditionDetails).toContainText('土壤热阻率 / K·m/W');
  await expect(conditionDetails).toContainText('环境温度 / °C');
  await expect(conditionDetails).toContainText('三芯直埋 · 单回'); await expect(conditionDetails).toContainText('两端接地');
  await positionDialogContent(conditionDetails.locator('summary'));
  await capture('明确工况参数的数值单位与中文口径');
  await conditionDetails.locator('summary').click();
  await envDialog.getByRole('checkbox').check();
  const calculated = await postUI(`/api/type-library/series/${series.series.id}/batch`, envDialog.getByRole('button', { name: '确认采用并计算这一规格', exact: true }), 'environment-adopt-and-calculate');
  assert.deepEqual(calculated.request.rows, [envPreview.value.proposed]);
  assert.deepEqual(calculated.request.environment_references, [{ ...envPreview.request, preview_digest: envPreview.value.preview_digest, human_confirmed: true }]);
  assert.equal(calculated.value.status, 'succeeded', JSON.stringify(calculated.value));
  const result = calculated.value.items[0];
  assert.ok(result.rows[0].value_a > 0);
  const savedRun = await readApi(`/api/workspaces/${spec.workspace_id}/studies/${result.study_id}/runs/${result.run_id}?view=full`);
  const savedCase = savedRun.snapshot.definition.driver.cases[0];
  const fixed = savedCase.metadata.environment_references;
  assert.deepEqual(fixed.changes, envPreview.value.changes); assert.equal(fixed.preview_digest, envPreview.value.preview_digest);
  assert.equal(fixed.human_confirmed, true); assert.equal(fixed.trust.grade, 'reference'); assert.equal(fixed.approval, 'not_granted');
  assert.deepEqual(result.rows[0].environment_references, fixed);
  assert.ok(Object.values(savedCase.input.provenance).some(source => source.kind === 'asset' && source.reference.includes(soilCase.recordSha)));
  const after = await readApi(`/api/types/${spec.workspace_id}/workspace`), oldReadback = await readApi(oldEndpoint);
  assert.deepEqual(after.domain, prepared.domain); assert.equal(after.revision, prepared.revision);
  for (const key of ['snapshot', 'output', 'input_digest', 'output_digest']) assert.deepEqual(oldReadback[key], oldRun[key], '新环境参考不污染旧运行的固定快照和结果');
  await expect(page.getByRole('heading', { name: '本次计算回执', exact: true })).toBeVisible();
  await page.getByRole('heading', { name: '本次计算回执', exact: true }).scrollIntoViewIfNeeded();
  await capture('同一型号真实计算与环境参考回执');
  await page.getByText('查看本次保存的环境来源', { exact: true }).click();
  await page.getByRole('table', { name: '保存运行的环境来源', exact: true }).scrollIntoViewIfNeeded();
  await capture('计算保存来源与参考分档可回读');
  audit.environment = { asset: environmentAsset, workspace_before: workspace, prepared, spec, preview: envPreview, batch: calculated,
    saved_run: savedRun, workspace_after: after, previous_run: oldRun, previous_run_readback: oldReadback };
  await write('environment-audit', audit.environment); await write('summary', audit);
  report.checks.push(`${viewport.width}：标准/文献原表经真实 UI 逐条条件核对→SI 回执→只读草稿预览→人工入库→来源核对/发布；铜密度8889、体积热容3460000、20°C电阻率1.7241e-8逐项采用到真实起帆空缺，数值/页码/原件SHA/记录SHA/回执/修订均回读，旧修订未改，真实undo恢复原值且保留来源绑定。原表范围及空条件明确阻止选值，同值阻止重复采用。`);
  report.checks.push(`${viewport.width}：仅经既有Types文档接口明示研究15kV/50Hz与逐字段来源，原材料/结构不改；A.4原文埋深保留参考且因测量基准未知禁止采用到中心埋深。已证Table2湿土1 K·m/W经UI创建发布，明确研究语境与工况后仅预览热阻率1.2→1.0，人工确认沿用系列真实计算；回执进入同一运行，旧快照/输出摘要不变，工作区领域输入不被工况参考回写。`);
}
