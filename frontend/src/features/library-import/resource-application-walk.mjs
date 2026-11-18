import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const pointer = (...parts) => '/' + parts.map(part => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
function at(document, pathname) {
  let value = document;
  for (const token of pathname.split('/').slice(1).map(item => item.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    value = Array.isArray(value) ? /^\d+$/.test(token) ? value[Number(token)] : value.find(item => item.id === token || item.role === token || item.cable === token) : value?.[token];
  }
  return value;
}
function slot(document, selection) {
  const cable = document.cable_types.find(item => item.id === selection.cable_type_id);
  const core = selection.part === 'common_layer' ? null : cable.cores.find(item => item.id === selection.core_id);
  const part = selection.part === 'conductor' ? core.conductor : (core ? core.layers : cable.common_layers)[selection.layer_index];
  let prefix = pointer('cable_types', cable.id);
  let indexed = `/cable_types/${document.cable_types.indexOf(cable)}`;
  if (core) { prefix += pointer('cores', core.id); indexed += `/cores/${cable.cores.indexOf(core)}`; }
  if (selection.part === 'conductor') { prefix += '/conductor'; indexed += '/conductor'; }
  else {
    const key = core ? 'layers' : 'common_layers', layers = core ? core.layers : cable.common_layers;
    indexed += `/${key}/${selection.layer_index}`;
    prefix = layers.filter(item => item.role === part.role).length === 1 ? prefix + pointer(key, part.role) : indexed;
  }
  return { cable, core, part, prefix, indexed };
}
function slotLabel(document, selection) {
  const { cable, part } = slot(document, selection);
  const coreIndex = cable.cores.findIndex(item => item.id === selection.core_id);
  if (selection.part === 'conductor') return `${cable.label} · 第 ${coreIndex + 1} 芯 · 导体`;
  const names = { insulation: '绝缘', oversheath: '外护套' };
  assert.ok(names[part.role], '此真实走查只选择有明确名称的绝缘与外护套');
  return `${cable.label} · ${selection.part === 'core_layer' ? `第 ${coreIndex + 1} 芯 · 第 ${selection.layer_index + 1} 层` : `公共第 ${selection.layer_index + 1} 层`} · ${names[part.role]}`;
}
function workspaceLabel(items, id) {
  const current = items.find(item => item.id === id); assert.ok(current);
  const same = items.filter(item => item.name === current.name && item.revision === current.revision);
  return `${current.name} · 输入修订 ${current.revision}${same.length > 1 ? ` · 同名条目 ${same.findIndex(item => item.id === id) + 1}${current.updated_at ? ` · ${current.updated_at}` : ''}` : ''}`;
}

/** Setup uses only existing APIs and is separately recorded. Every new resource
 * capture, review, publication, preview and adoption goes through visible UI. */
export async function walkResourceApplications({ page, base, viewport, out, expect, capture, select, afterAction, recordResponse, report }) {
  assert.equal(process.env.E2E_ISOLATED, '1');
  const audit = { scope: '真实保存输入的部件与研究模板；参考分档，不授予工程批准', setup: [], http: [], read_only_checks: [], components: [], study: null };
  const write = (name, value) => fs.writeFile(path.join(out, `${viewport.width}-applications-${name}.json`), JSON.stringify(value, null, 2));
  async function decoded(response, endpoint, method) {
    const body = await response.body();
    const filename = `${viewport.width}-applications-http-${String(audit.http.length + 1).padStart(3, '0')}.json`;
    await fs.writeFile(path.join(out, filename), body);
    audit.http.push({ endpoint, method, status: response.status(), file: filename, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') });
    await write('http-index', audit.http);
    return JSON.parse(body.toString('utf8'));
  }
  async function readApi(endpoint) {
    const response = await page.request.get(base + endpoint, { timeout: 300000 });
    try { const value = await decoded(response, endpoint, 'GET'); assert.ok(response.ok(), JSON.stringify(value)); return value; }
    finally { await response.dispose(); }
  }
  async function setupPost(endpoint, body, label) {
    const response = await page.request.post(base + endpoint, { headers: { 'X-CableSim-Actor': 'human' }, data: body, timeout: 300000 });
    try {
      const value = await decoded(response, endpoint, 'POST');
      audit.setup.push({ label, endpoint, request: body, status: response.status(), response: value });
      await write('setup', audit.setup); assert.ok(response.ok(), JSON.stringify(value)); return value;
    } finally { await response.dispose(); }
  }
  async function postUI(endpoint, button, name, expected = 200) {
    const response = await afterAction(page.waitForResponse(item => new URL(item.url()).pathname === endpoint && item.request().method() === 'POST', { timeout: 300000 }), () => button.click());
    assert.equal(response.status(), expected, await response.text());
    assert.equal(response.request().headers()['x-cablesim-actor'], 'human');
    const value = await response.json(); await recordResponse(`applications-${name}`, response, value);
    return { request: response.request().postDataJSON(), value };
  }
  async function projects() {
    const rows = [];
    for (let offset = 0; offset < 5000; offset += 100) {
      const page = await readApi(`/api/index/objects?kind=project&limit=100&offset=${offset}`);
      rows.push(...page.items.map(item => ({ id: item.id, name: item.name, revision: item.revision, updated_at: item.updated })));
      if (rows.length >= page.total) return rows;
      assert.ok(page.items.length, '工程分页不能无声截断');
    }
    throw new Error('工程索引超出走查范围');
  }
  async function enter() {
    await page.goto(base + '/resources/cables/structure-import', { timeout: 120000 });
    await page.getByRole('tab', { name: '部件与研究模板', exact: true }).click();
    await expect(page.getByRole('heading', { name: '从保存输入创建参考草稿', exact: true })).toBeVisible();
  }
  async function freeze(kind, source, selection, study, sourceRun, label) {
    const sourceArchive = await readApi(`/api/workspaces/${source.id}/revisions/${source.revision}`);
    assert.equal(sourceArchive.workspace, source.id); assert.equal(sourceArchive.revision, source.revision);
    assert.deepEqual(sourceArchive.state.domain, source.domain);
    await enter();
    if (kind === 'study_template') await select('捕获资料类别', '保存研究模板');
    const list = kind === 'component' ? await readApi('/api/design/type-workspaces') : await projects();
    await select(kind === 'component' ? '来源型号' : '来源工程', workspaceLabel(list, source.id));
    if (kind === 'component') await select('来源部件', slotLabel(source.domain, selection));
    else {
      const option = page.getByRole('combobox', { name: '来源保存研究', exact: true });
      await expect(option).toBeEnabled(); await option.click();
      await page.getByRole('option').filter({ hasText: study.definition.title + ' · 研究修订 ' + study.revision }).click();
      // The selected source is a current successful root run from the first
      // real ASC page; older/stale runs remain disabled in the same selector.
      const runs = page.getByRole('combobox', { name: '来源成功运行', exact: true });
      await expect(runs).toBeEnabled(); await runs.click();
      await page.getByRole('option').filter({ hasText: `第 ${sourceRun.sequence} 次 ·` }).click();
    }
    const name = `${label}参考 ${viewport.width}`, id = `${kind === 'component' ? 'component' : 'study-template'}/walk-${viewport.width}-${randomUUID()}`;
    await page.getByRole('textbox', { name: '部件或模板名称', exact: true }).fill(name);
    await page.getByRole('textbox', { name: '部件或模板资料标识', exact: true }).fill(id);
    await page.getByRole('textbox', { name: '部件或模板资料版本', exact: true }).fill('1.0.0');
    await capture(`${label}真实保存输入选择`);
    const prefix = `/api/library/resources/${kind === 'component' ? 'components' : 'study-templates'}`;
    const preview = await postUI(prefix + '/capture-preview', page.getByRole('button', { name: '预览固定来源与输入', exact: true }), label + '-capture-preview');
    assert.equal(preview.request.expected_revision, source.revision);
    assert.equal(preview.value.trust.grade, 'reference'); assert.equal(preview.value.approval, 'not_granted');
    assert.equal(preview.value.source.workspace_id, sourceArchive.workspace); assert.equal(preview.value.source.revision, sourceArchive.revision);
    assert.equal(preview.value.source.snapshot_sha256, sourceArchive.digest);
    assert.deepEqual(preview.value.source.snapshot, sourceArchive.state, '冻结完整归档输入，包含型号资源绑定及其固定版本和摘要');
    if (kind === 'component') {
      assert.deepEqual(preview.request.selection, selection);
      assert.deepEqual(preview.value.selection, { ...selection, core_id: selection.core_id ?? null, layer_index: selection.layer_index ?? null });
    }
    if (kind === 'component') for (const field of preview.value.fields) {
      assert.deepEqual(field.value, at(source.domain, field.path) ?? null, field.label + '来自原保存输入');
      if (typeof field.value === 'number') { assert.ok(field.unit); assert.ok(field.source?.reference); }
    }
    else {
      assert.deepEqual(preview.value.definition, study.definition);
      assert.equal(preview.value.source.run_id, sourceRun.id);
      for (const field of preview.value.fields) {
        assert.deepEqual(field.value, at(study.definition, field.path) ?? null, field.label + '来自原保存研究定义');
        if (typeof field.value === 'number') { assert.ok(field.unit); assert.ok(field.source?.reference); }
      }
    }
    const dialog = page.getByRole('dialog', { name: '核对固定输入后保存草稿', exact: true });
    await expect(dialog.getByRole('button', { name: '人工确认保存参考草稿', exact: true })).toBeDisabled();
    await capture(`${label}完整固定输入预览`);
    await dialog.getByRole('checkbox').check();
    await capture(`${label}明确缺项与人工保存确认`);
    const created = await postUI(prefix + '/capture', dialog.getByRole('button', { name: '人工确认保存参考草稿', exact: true }), label + '-capture', 201);
    assert.equal(created.request.human_confirmed, true); assert.equal(created.value.status, 'draft');
    assert.equal(created.value.content_sha256, preview.value.content_sha256);
    await expect(dialog).toBeHidden();
    let asset = created.value;
    for (const action of ['review', 'publish']) {
      const name = action === 'review' ? '核对部件或模板来源' : '发布部件或模板参考版本';
      const button = page.getByRole('button', { name, exact: true }); await expect(button).toBeEnabled(); await button.click();
      const modal = page.getByRole('dialog', { name: action === 'review' ? '核对部件或模板固定来源' : '发布部件或模板固定版本', exact: true });
      const confirm = modal.getByRole('button', { name: action === 'review' ? '确认已核对固定来源' : '确认发布固定参考版本', exact: true });
      await expect(confirm).toBeDisabled();
      await modal.getByRole('textbox', { name: '部件或模板核对说明', exact: true }).fill('逐项核对实际保存输入、固定来源和参考限制，未提升为制造实测或工程批准。');
      await modal.getByRole('checkbox').check(); await capture(`${label}${action === 'review' ? '人工来源核对' : '人工发布参考版本'}`);
      const changed = await postUI(`/api/foundation/assets/${asset.id}/transition`, confirm, label + '-' + action);
      assert.equal(changed.request.human_confirmed, true); assert.equal(changed.request.action, action);
      assert.equal(changed.value.revision, asset.revision + 1); assert.deepEqual(changed.value.release, asset.release); asset = changed.value;
    }
    assert.equal(asset.status, 'published');
    const endpoint = `/api/library/resources/applications/${asset.id}/evidence`;
    const unexpectedWrites = [];
    const watchRead = request => { if (!['GET', 'HEAD'].includes(request.method())) unexpectedWrites.push({ method: request.method(), url: request.url() }); };
    page.on('request', watchRead);
    let evidence;
    try {
      const refreshed = await afterAction(page.waitForResponse(item => new URL(item.url()).pathname === endpoint && item.request().method() === 'GET'), () => page.getByRole('button', { name: '重新核对固定来源', exact: true }).click());
      assert.equal(refreshed.status(), 200);
      evidence = await decoded(refreshed, endpoint, 'GET');
      await capture(`${label}发布后冻结来源回读`);
      assert.deepEqual(unexpectedWrites, [], '查看冻结来源不得提交写入请求');
      audit.read_only_checks.push({ label, endpoint, automatic_write_requests: unexpectedWrites });
    } finally { page.off('request', watchRead); }
    await write(label + '-frozen-evidence', evidence);
    assert.deepEqual(evidence.source, preview.value.source); assert.deepEqual(evidence.fields, preview.value.fields);
    assert.deepEqual(evidence.source.snapshot, sourceArchive.state, '发布回读仍保留原修订完整输入及所有固定资源绑定');
    assert.deepEqual(evidence.selection, preview.value.selection);
    return { prefix, asset, preview, evidence, source_archive: sourceArchive };
  }
  async function adoptComponent(frozen, targetBefore, target, label, reuseMaterial = false) {
    const typeList = await readApi('/api/design/type-workspaces');
    await select('采用目标型号', workspaceLabel(typeList, targetBefore.id));
    await select('目标部件位置', slotLabel(targetBefore.domain, target));
    let materialId;
    if (reuseMaterial) {
      materialId = slot(targetBefore.domain, target).part.material;
      const existing = targetBefore.domain.materials.find(item => item.id === materialId); assert.ok(existing);
      const facts = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['id', 'label'].includes(key)));
      assert.deepEqual(facts(existing), facts(frozen.preview.value.release.application.payload.material));
      await select('目标材料处理方式', '复用内容完全相同的材料');
      await select('复用目标材料', existing.label);
      await expect(page.getByText('仅允许复用全部物性相同的材料。复用保留目标材料原出处，捕获来源继续作为独立参考保存。', { exact: true })).toBeVisible();
    } else {
      materialId = 'material/component-' + randomUUID();
      await select('目标材料处理方式', '新建独立材料条目');
      await page.getByRole('textbox', { name: '目标材料新标识', exact: true }).fill(materialId);
    }
    await capture(label + (reuseMaterial ? '明确目标槽位并保留材料原出处' : '明确目标槽位与独立材料'));
    const preview = await postUI('/api/library/resources/components/preview', page.getByRole('button', { name: '预览目标采用变化', exact: true }), label + '-target-preview');
    assert.equal(preview.request.expected_revision, targetBefore.revision);
    assert.equal(preview.value.material_action, reuseMaterial ? 'reuse_identical' : 'create'); assert.equal(preview.value.proposed.component.material, materialId);
    if (reuseMaterial) for (const change of preview.value.changes.filter(item => item.path.startsWith(pointer('materials', materialId) + '/')))
      assert.equal(change.source_action, 'unchanged');
    const dialog = page.getByRole('dialog', { name: '核对部件采用变化', exact: true });
    const confirm = dialog.getByRole('button', { name: '人工确认采用该部件', exact: true }); await expect(confirm).toBeDisabled();
    await capture(label + '逐字段前后值与清空项');
    await dialog.getByRole('checkbox').nth(0).check(); await expect(confirm).toBeDisabled();
    await dialog.getByRole('checkbox').nth(1).check();
    const adopted = await postUI('/api/library/resources/components/adopt', confirm, label + '-adopt');
    assert.equal(adopted.request.human_confirmed, true); assert.equal(adopted.request.acknowledge_reference_limits, true);
    const after = await readApi(`/api/workspaces/${targetBefore.id}`);
    assert.equal(after.revision, targetBefore.revision + 1);
    const expected = structuredClone(targetBefore.domain), expectedSlot = slot(expected, target);
    if (target.part === 'conductor') expectedSlot.core.conductor = preview.value.proposed.component;
    else if (target.part === 'core_layer') expectedSlot.core.layers[target.layer_index] = preview.value.proposed.component;
    else expectedSlot.cable.common_layers[target.layer_index] = preview.value.proposed.component;
    if (!reuseMaterial) expected.materials.push(preview.value.proposed.material);
    const destination = slot(targetBefore.domain, target);
    for (const pathname of Object.keys(expected.provenance)) {
      if ([destination.prefix, destination.indexed].some(prefix => pathname === prefix || pathname.startsWith(prefix + '/')))
        delete expected.provenance[pathname];
    }
    const compared = structuredClone(after.domain), fieldReceipts = [];
    const resource = Object.fromEntries(['id', 'asset_id', 'version', 'kind', 'name', 'status', 'revision', 'content_sha256'].map(key => [key, frozen.asset[key]]));
    for (const change of preview.value.changes) {
      if (change.source_action === 'unchanged') continue;
      assert.equal(change.source_action, 'replace');
      const persisted = after.domain.provenance[change.path];
      assert.ok(persisted, '每个替换字段须有独立采用回执：' + change.path);
      assert.equal(persisted.kind, 'asset'); assert.equal(persisted.reviewed, false); assert.equal(typeof persisted.reference, 'string');
      const receipt = JSON.parse(persisted.reference);
      const expectedReceipt = { schema: 'cablesim.adopted-component-field/1', resource,
        source_selection: frozen.evidence.selection, source_workspace: frozen.source_archive.workspace,
        source_revision: frozen.source_archive.revision, source_document_sha256: frozen.evidence.source.document_sha256,
        target: { ...target, core_id: target.core_id ?? null, layer_index: target.layer_index ?? null },
        field: change, method: frozen.evidence.method, approval: 'not_granted' };
      assert.deepEqual(receipt, expectedReceipt, '字段回执须完整保留原变化、资源及来源身份：' + change.path);
      // Compare receipt contents independently of JSON whitespace. Unselected
      // sources, including reused material references, remain exact strings.
      expected.provenance[change.path] = { kind: 'asset', reviewed: false, reference: expectedReceipt };
      compared.provenance[change.path] = { ...persisted, reference: receipt };
      fieldReceipts.push({ path: change.path, source: persisted, receipt });
    }
    assert.deepEqual(compared, expected, '只改变明确槽位、已确认的材料及逐字段可追溯出处；其余物理输入和出处不变');
    const allowed = [destination.prefix, destination.indexed, ...(!reuseMaterial ? [pointer('materials', materialId)] : [])];
    for (const pathname of new Set([...Object.keys(targetBefore.domain.provenance), ...Object.keys(after.domain.provenance)])) {
      if (!allowed.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/')))
        assert.deepEqual(after.domain.provenance[pathname], targetBefore.domain.provenance[pathname], '未选对象的出处不变：' + pathname);
    }
    assert.deepEqual((await readApi(`/api/library/resources/applications/${frozen.asset.id}/evidence`)).source, frozen.evidence.source);
    await capture(label + '人工采用后保存回读');
    await page.getByRole('link', { name: '打开目标型号并核对或撤销', exact: true }).click();
    const undo = page.getByRole('button', { name: '撤销', exact: true }); await expect(undo).toBeEnabled();
    await capture(label + '原型号入口核对');
    const response = await afterAction(page.waitForResponse(item => new URL(item.url()).pathname === `/api/workspaces/${targetBefore.id}/history/undo` && item.request().method() === 'POST'), () => undo.click());
    assert.equal(response.status(), 200); await recordResponse(`applications-${label}-real-ui-undo`, response, await response.json());
    const restored = await readApi(`/api/workspaces/${targetBefore.id}`);
    assert.equal(restored.revision, after.revision + 1); assert.deepEqual(restored.domain, targetBefore.domain);
    await capture(label + '原型号真实撤销后核对');
    const entry = { capture: frozen, target_before: targetBefore, preview, adopted, readback: after, field_receipts: fieldReceipts, restored };
    audit.components.push(entry); await write(label + '-audit', entry);
  }
  async function copyProject(source) {
    const response = await page.request.post(base + '/api/library/exchange/export', { data: { workspace_ids: [source.id], format: 'json' }, timeout: 300000 });
    assert.equal(response.status(), 200); const body = await response.body(); await response.dispose();
    const file = `${viewport.width}-applications-setup-project.json`; await fs.writeFile(path.join(out, file), body);
    audit.setup.push({ label: '既有项目交换接口仅准备独立目标输入；不作为资源应用UI验收', method: 'POST', endpoint: '/api/library/exchange/export', source_workspace: source.id, file, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') });
    const upload = { name: 'existing-project.json', mimeType: 'application/json', buffer: body };
    const previewResponse = await page.request.post(base + '/api/library/exchange/preview', { multipart: { file: upload }, timeout: 300000 });
    const preview = await decoded(previewResponse, '/api/library/exchange/preview', 'POST'); assert.equal(previewResponse.status(), 200); await previewResponse.dispose();
    const imported = await page.request.post(base + '/api/library/exchange/import', { headers: { 'X-CableSim-Actor': 'human' },
      multipart: { file: upload, reviewed_sha256: preview.sha256, confirmed: 'true', request_id: randomUUID() }, timeout: 300000 });
    const receipt = await decoded(imported, '/api/library/exchange/import', 'POST'); assert.equal(imported.status(), 201); await imported.dispose();
    audit.setup.push({ label: '独立工程输入目标；没有继承研究或运行', preview, receipt }); await write('setup', audit.setup);
    assert.equal(receipt.projects.length, 1); assert.equal(receipt.projects[0].origin_id, source.id);
    const copy = await readApi(`/api/workspaces/${receipt.projects[0].id}`);
    assert.deepEqual(copy.domain, source.domain); assert.notEqual(copy.id, source.id);
    assert.deepEqual(await readApi(`/api/workspaces/${copy.id}/studies`), []); return copy;
  }
  try {
    const types = await readApi('/api/design/type-workspaces');
    const candidates = [];
    for (const item of types.filter(item => item.name === 'YJV22-8.7/15 3×300')) {
      const saved = await readApi(`/api/workspaces/${item.id}`);
      if (!saved.type_plan_source && !saved.exchange_origin) candidates.push(saved);
    }
    assert.equal(candidates.length, 1, '应唯一定位实际发布种子的300 mm²原件，不能把同名方案当原件');
    let source = candidates[0];
    const cable = source.domain.cable_types[0];
    assert.equal(cable.cores.length, 3);
    const blank = await setupPost('/api/types', { request_id: randomUUID(), origin: 'blank', name: `部件采用空白目标 ${viewport.width}`, construction: 'three_core', human_confirmed: true }, '旧Types创建缺项空白目标，不补物理数值');
    const blankId = blank.id; assert.ok(blankId);
    const layerCopy = await setupPost(`/api/types/${source.id}/plans`, { request_id: randomUUID(), expected_revision: source.revision, name: `部件采用独立方案 ${viewport.width}` }, '旧Types方案接口复制实际来源，保留完整物理输入和出处');
    assert.ok(layerCopy.workspace_id);
    const registeredSource = await readApi(`/api/workspaces/${source.id}`);
    assert.equal(registeredSource.revision, source.revision); assert.deepEqual(registeredSource.domain, source.domain);
    source = registeredSource;
    const coreLayerIndex = cable.cores[0].layers.findIndex(item => item.role === 'insulation');
    const targetLayerIndex = cable.cores[1].layers.findIndex(item => item.role === 'insulation');
    const commonIndex = cable.common_layers.findIndex(item => item.role === 'oversheath');
    assert.ok(coreLayerIndex >= 0 && targetLayerIndex >= 0 && commonIndex >= 0);
    for (const item of [
      { label: '导体部件', selection: { cable_type_id: cable.id, core_id: cable.cores[0].id, part: 'conductor' }, targetId: blankId },
      { label: '芯层部件', selection: { cable_type_id: cable.id, core_id: cable.cores[0].id, part: 'core_layer', layer_index: coreLayerIndex }, targetId: layerCopy.workspace_id },
      { label: '公共层部件', selection: { cable_type_id: cable.id, part: 'common_layer', layer_index: commonIndex }, targetId: layerCopy.workspace_id },
    ]) {
      const targetBefore = await readApi(`/api/workspaces/${item.targetId}`), targetCable = targetBefore.domain.cable_types[0];
      const target = item.selection.part === 'conductor' ? { cable_type_id: targetCable.id, core_id: targetCable.cores[0].id, part: 'conductor' }
        : item.selection.part === 'core_layer' ? { cable_type_id: targetCable.id, core_id: targetCable.cores[1].id, part: 'core_layer', layer_index: targetLayerIndex }
          : { cable_type_id: targetCable.id, part: 'common_layer', layer_index: commonIndex };
      const frozen = await freeze('component', source, item.selection, null, null, item.label);
      await adoptComponent(frozen, targetBefore, target, item.label, item.selection.part === 'core_layer');
      assert.deepEqual(await readApi(`/api/workspaces/${source.id}`), source, '部件参考的来源型号必须原样保留');
    }
    const projectCandidates = (await projects()).filter(item => item.name === '城南线路 · 110 kV 直埋单回');
    const originals = [];
    for (const item of projectCandidates) { const saved = await readApi(`/api/workspaces/${item.id}`); if (!saved.exchange_origin) originals.push(saved); }
    assert.equal(originals.length, 1, '明确使用既有源工程，不把本轮复制目标当成原件');
    const project = originals[0], studies = await readApi(`/api/workspaces/${project.id}/studies`);
    const sourceStudies = studies.filter(item => item.definition.title === '城南线路 · 110 kV 直埋单回校核');
    assert.equal(sourceStudies.length, 1); const study = sourceStudies[0];
    assert.equal(study.definition.method.plugin_id, 'cablesim.iec60287'); assert.equal(study.definition.method.capability, 'steady-rating');
    assert.equal(study.definition.driver.kind, 'single'); assert.equal(study.definition.input_source, 'domain');
    const runs = await readApi(`/api/workspaces/${project.id}/studies/${study.id}/runs?view=summary&after=0&limit=20`);
    const sourceRun = runs.items.find(item => item.status === 'succeeded' && item.integrity === 'verified' && item.freshness === 'current' && (item.snapshot.module ?? null) === null);
    assert.ok(sourceRun, '必须已有当前成功真实运行，不能在模板走查中制造原运行');
    const target = await copyProject(project);
    const frozen = await freeze('study_template', project, null, study, sourceRun, '保存研究模板');
    await select('采用目标工程', workspaceLabel(await projects(), target.id));
    await page.getByRole('textbox', { name: '采用后研究名称', exact: true }).fill(`人工采用的城南研究参考 ${viewport.width}`);
    const bindings = page.getByRole('table', { name: '研究固定对象逐项映射', exact: true });
    const boxes = bindings.getByRole('checkbox');
    const expectedBindingCount = Object.values(frozen.evidence.bindings).reduce((total, values) => total + values.length, 0);
    assert.equal(await boxes.count(), expectedBindingCount); assert.ok(expectedBindingCount > 0);
    await expect(page.getByRole('button', { name: '预览目标采用变化', exact: true })).toBeDisabled();
    for (const checkbox of await boxes.all()) { await expect(checkbox).toBeEnabled(); await checkbox.check(); }
    await capture('研究模板逐项固定对象确认');
    const preview = await postUI(frozen.prefix + '/preview', page.getByRole('button', { name: '预览目标采用变化', exact: true }), 'study-target-preview');
    assert.equal(preview.value.source_run_status, 'verified_local_run'); assert.equal(preview.value.preflight.ready, true);
    const dialog = page.getByRole('dialog', { name: '核对新研究的固定定义', exact: true }), confirm = dialog.getByRole('button', { name: '人工确认创建保存研究', exact: true });
    await expect(confirm).toBeDisabled(); await capture('研究模板目标定义与来源预览');
    await dialog.getByRole('checkbox').nth(0).check(); await expect(confirm).toBeDisabled(); await dialog.getByRole('checkbox').nth(1).check();
    const runWrites = [];
    const onRequest = request => { if (request.method() === 'POST' && /\/studies\/[^/]+\/runs$/.test(new URL(request.url()).pathname)) runWrites.push(request.url()); };
    page.on('request', onRequest);
    try {
      const adopted = await postUI(frozen.prefix + '/adopt', confirm, 'study-adopt', 201);
      assert.equal(adopted.value.run_started, false); assert.equal(adopted.value.approval, 'not_granted'); assert.equal(adopted.value.revision, target.revision);
      const targetAfter = await readApi(`/api/workspaces/${target.id}`);
      assert.deepEqual(targetAfter.domain, target.domain); assert.equal(targetAfter.revision, target.revision);
      const saved = await readApi(`/api/workspaces/${target.id}/studies/${adopted.value.study.id}`);
      assert.deepEqual(saved.definition, preview.value.definition);
      const savedRuns = await readApi(`/api/workspaces/${target.id}/studies/${saved.id}/runs?view=summary&after=0&limit=20`);
      assert.deepEqual(savedRuns.items, []); assert.equal(savedRuns.next_cursor, null);
      await capture('研究模板仅保存研究而未运行');
      const link = page.getByRole('link', { name: '打开新保存研究', exact: true });
      await expect(link).toHaveAttribute('href', `/studies/${saved.id}?workspace=${target.id}`);
      await link.click();
      // StudyProvider first reads the saved study and workspace. StudyEntry
      // then selects the actual root module; an entry URL alone is not ready.
      await expect(page).toHaveURL(new RegExp(`/studies/${saved.id}/ampacity/results(?:\\?|$)`));
      assert.equal(new URL(page.url()).searchParams.get('workspace'), target.id);
      await expect(page.getByRole('heading', { level: 1, name: saved.definition.title, exact: true })).toBeVisible();
      const results = page.getByRole('region', { name: '计算结果', exact: true });
      await expect(results.getByRole('heading', { name: '尚无载流量运行', exact: true })).toBeVisible();
      await capture('新保存研究在原研究入口回读');
      const openedTarget = await readApi(`/api/workspaces/${target.id}`);
      const openedStudy = await readApi(`/api/workspaces/${target.id}/studies/${saved.id}`);
      const openedRuns = await readApi(`/api/workspaces/${target.id}/studies/${saved.id}/runs?view=summary&after=0&limit=20`);
      assert.deepEqual(openedTarget.domain, target.domain); assert.equal(openedTarget.revision, target.revision);
      assert.deepEqual(openedStudy.definition, saved.definition); assert.equal(openedStudy.revision, saved.revision);
      assert.deepEqual(openedRuns.items, []); assert.equal(openedRuns.next_cursor, null);
      assert.deepEqual(await readApi(`/api/workspaces/${project.id}`), project, '源工程和已保存运行不变');
      assert.deepEqual((await readApi(`/api/library/resources/applications/${frozen.asset.id}/evidence`)).source, frozen.evidence.source);
      assert.deepEqual(runWrites, [], '采用后完整加载原研究页面并回读，仍未自动提交计算');
      audit.study = { source: project, source_study: study, source_run: sourceRun, target_before: target, capture: frozen, preview, adopted, target_after: targetAfter, saved, saved_runs: savedRuns,
        opened_url: page.url(), opened_target: openedTarget, opened_study: openedStudy, opened_runs: openedRuns, automatic_run_requests: runWrites };
    } finally { page.off('request', onRequest); }
    report.checks.push(`${viewport.width}：真实保存输入的导体、芯绝缘层、公共外护层和成功IEC研究，经可见页面捕获→人工草稿→核对→发布→冻结证据回读→明确目标预览→人工采用。三种部件核对每个捕获值、目标其它字段/出处不变及原Types真实撤销；芯层复用完全相同材料且保留原出处，其余新建独立材料。研究逐项确认固定对象，仅保存新研究且零运行请求，源输入和固定证据不变。准备目标仅走已记录的旧Types/工程交换接口，不代替新资源UI动作。`);
  } finally { await write('summary', audit); }
}
