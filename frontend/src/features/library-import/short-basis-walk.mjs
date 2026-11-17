import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const sigmaKeys = Array.from({ length: 6 }, (_, index) => `sc-material-constants/r${index + 1}/sigma_c`);
const conditions = { duration_s: 1, initial_temperature_k: 363.15, final_temperature_k: 523.15 };
const sha256 = /^[a-f0-9]{64}$/;

// Keep the actual wire spelling as evidence. JSON.parse intentionally makes
// 3400000.0 and 3400000 the same JavaScript Number, so parsed equality alone
// would not demonstrate the browser transport that previously broke the seal.
function valueToken(raw, key) {
  const start = raw.indexOf(JSON.stringify(key));
  assert.ok(start >= 0, `响应缺少依据 ${key}`);
  const tail = raw.slice(start), record = /"record"\s*:\s*\{/.exec(tail);
  assert.ok(record, `响应缺少原始记录 ${key}`);
  const value = /"value"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/.exec(tail.slice(record.index + record[0].length));
  assert.ok(value, `响应缺少原始数值 ${key}`);
  return value[1];
}

function checkConditions(definition, duration = 1) {
  const expected = { ...conditions, duration_s: duration };
  assert.equal(typeof definition.parameters.cable_type_id, 'string', '真实表单须保存所选电缆结构');
  assert.ok(definition.parameters.cable_type_id.length > 0);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(definition.parameters[key], value, `保存的 ${key} 必须来自实际填写值`);
    assert.equal(definition.parameters.sources[key], '工程师在方法参数中填写；未经批准');
    assert.deepEqual(definition.input_sources['/parameters/' + key], {
      kind: 'user', reference: '工程师按匹配的参数契约填写', reviewed: false,
    });
  }
}

function checkReferences(actual, original) {
  assert.equal(Object.keys(actual).length, 30);
  assert.deepEqual(actual, original, '30 条依据须逐值、逐元数据保持；不能重签或替换来源');
  for (const [key, reference] of Object.entries(actual)) {
    assert.match(reference.record_sha256, sha256, key);
    assert.equal(reference.record_sha256, reference.record.record_sha256, key);
    assert.match(reference.source_sha256, sha256, key);
    assert.match(reference.release_digest, sha256, key);
  }
}

/** Called by the two-viewport isolated library walk. Only the teaching-model
 * copy uses an API mutation: all method saves, basis queries, preflights and
 * the run below are dispatched by the unmodified type-workspace UI. */
export async function walkShortBasis({ page, base, viewport, out, capture, expect, report, readApi }) {
  const evidence = { viewport, stages: [], limitation: '隔离教学型号与明确回归工况；不是厂家试验结果。来源为现有参数表单记录的工程师填写、未经批准。' };
  const saveEvidence = () => fs.writeFile(path.join(out, `${viewport.width}-short-basis-evidence.json`), JSON.stringify(evidence, null, 2));
  async function responseEvidence(stage, response) {
    const raw = await response.text(), request = response.request();
    const entry = { stage, url: response.url(), method: request.method(), status: response.status(),
      request_raw: request.postData(), response_raw: raw };
    evidence.stages.push(entry); await saveEvidence();
    assert.equal(response.ok(), true, `${stage} HTTP ${response.status()}: ${raw.slice(0, 1000)}`);
    return { raw, body: JSON.parse(raw), request: request.postDataJSON() };
  }
  const models = await readApi('/api/design/cable-models');
  const model = models.find(item => item.id === 'system.specification-cu-xlpe-al-400');
  assert.ok(model, '发布库必须包含完整的短路回归教学型号');
  assert.match(model.content_sha256, sha256);
  const cable = model.payload.cable_type, materials = model.payload.materials;
  assert.equal(cable.cores.length, 1);
  const core = cable.cores[0], insulation = core.layers.find(layer => layer.role === 'insulation');
  assert.ok(Math.abs(core.conductor.nominal_area * 1e6 - 400) < 1e-9);
  assert.equal(materials.find(item => item.id === core.conductor.material)?.standard_kind, 'copper_bare', '教学型号必须明确声明导体类别，不能由材料名猜铜');
  assert.equal(materials.find(item => item.id === insulation?.material)?.standard_kind, 'XLPE');
  assert.ok(materials.every(item => typeof item.standard_kind === 'string' && item.standard_kind.length > 0));
  const created = await fetch(base + '/api/design/type-workspaces', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: model.id, content_sha256: model.content_sha256 }),
  });
  const createdRaw = await created.text();
  assert.equal(created.status, 201, createdRaw);
  const workspace = JSON.parse(createdRaw), workspaceRoot = `/api/workspaces/${workspace.id}`;
  evidence.model = { id: model.id, content_sha256: model.content_sha256, source: model.source,
    materials: materials.map(({ id, label, standard_kind }) => ({ id, label, standard_kind })) };
  evidence.workspace = workspace;
  await saveEvidence();
  const paramsUrl = `${base}/types/${workspace.id}/short-circuit/parameters`;
  const resultsUrl = `${base}/types/${workspace.id}/short-circuit/results`;
  const field = key => page.locator(`input[data-field-path="/${key}"]`);
  const save = page.getByRole('button', { name: '保存方法条件', exact: true });
  async function fill(key, displayValue) {
    await expect(field(key)).toBeVisible();
    await field(key).fill(String(displayValue));
    await field(key).press('Tab'); // The real form commits the value and source on blur.
    await expect(field(key)).toHaveValue(String(displayValue));
  }
  async function saveConditions(stage, study, duration = 1) {
    const endpoint = workspaceRoot + '/studies' + (study ? '/' + study.id : '');
    const method = study ? 'PUT' : 'POST';
    await expect(save).toBeEnabled();
    const [response] = await Promise.all([
      page.waitForResponse(item => new URL(item.url()).pathname === endpoint && item.request().method() === method, { timeout: 180000 }),
      save.click(),
    ]);
    const saved = await responseEvidence(stage, response);
    checkConditions(saved.request, duration); checkConditions(saved.body.definition, duration);
    const loaded = await readApi(workspaceRoot + '/studies/' + saved.body.id);
    assert.deepEqual(loaded.definition, saved.body.definition, '保存后从正常业务接口回读同一研究条件');
    if (study) {
      assert.equal(saved.request.expected_study_revision, study.revision, '参数页必须使用最新保存研究版本');
      assert.equal(loaded.revision, study.revision + 1, '再次保存必须实际产生研究版本');
    }
    await expect(save).not.toHaveAttribute('aria-busy', 'true');
    await expect(save).toBeDisabled();
    evidence.stages.push({ stage: stage + '-read', study: loaded }); await saveEvidence();
    return loaded;
  }
  async function prepare(stage) {
    await page.goto(resultsUrl);
    const compute = page.getByRole('button', { name: '计算短路容量', exact: true });
    await expect(compute).toBeEnabled();
    const [basisResponse, studyResponse, preflightResponse] = await Promise.all([
      page.waitForResponse(item => new URL(item.url()).pathname === `/api/types/${workspace.id}/short-circuit-basis` && item.request().method() === 'POST', { timeout: 180000 }),
      page.waitForResponse(item => new URL(item.url()).pathname === workspaceRoot + '/studies' && item.request().method() === 'POST', { timeout: 180000 }),
      page.waitForResponse(item => new URL(item.url()).pathname.startsWith(workspaceRoot + '/studies/') && new URL(item.url()).pathname.endsWith('/preflight') && item.request().method() === 'GET', { timeout: 180000 }),
      compute.click(),
    ]);
    const basis = await responseEvidence(stage + '-basis', basisResponse);
    const saved = await responseEvidence(stage + '-save', studyResponse);
    const preflight = await responseEvidence(stage + '-preflight', preflightResponse);
    assert.deepEqual(basis.body.missing, []);
    const references = basis.body.parameters.basis_references;
    checkConditions(saved.request); checkConditions(saved.body.definition);
    checkReferences(saved.request.parameters.basis_references, references);
    checkReferences(saved.body.definition.parameters.basis_references, references);
    const transport = sigmaKeys.map(key => {
      const original = valueToken(basis.raw, key), transmitted = valueToken(studyResponse.request().postData(), key);
      assert.match(original, /^\d+\.0$/, `${key} 原发行确有整数值浮点表示`);
      assert.match(transmitted, /^\d+$/, `${key} 浏览器应使用 JSON.stringify 的整数表示`);
      assert.equal(Number(original), Number(transmitted));
      assert.equal(Number(original), references[key].record.value);
      return { key, original_token: original, browser_token: transmitted,
        value: references[key].record.value, record_sha256: references[key].record_sha256,
        source_sha256: references[key].source_sha256 };
    });
    evidence.stages.push({ stage: stage + '-six-sigma-transport', references: transport }); await saveEvidence();
    assert.equal(preflight.body.ready, true, JSON.stringify(preflight.body));
    const dialog = page.getByRole('dialog', { name: '计算短路容量 · 预检', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('保存输入已通过预检');
    await capture(stage === 'first' ? '短路30条依据经浏览器保存并通过预检' : '短路再次保存后通过预检');
    return { study: saved.body, references, dialog };
  }

  await page.goto(paramsUrl);
  await fill('duration_s', 1);
  await fill('initial_temperature_k', 90);
  await fill('final_temperature_k', 250);
  await capture('短路明确填写1秒90至250摄氏度');
  await saveConditions('initial-conditions');
  const first = await prepare('first');
  await page.keyboard.press('Escape'); await expect(first.dialog).toBeHidden();
  const loaded = await readApi(workspaceRoot + '/studies/' + first.study.id);
  checkReferences(loaded.definition.parameters.basis_references, first.references);
  evidence.stages.push({ stage: 'first-basis-read', study: loaded }); await saveEvidence();

  // A no-op save is deliberately disabled in the existing form. Make two real
  // UI edits/saves so both PUTs transport all 30 saved references, restoring
  // the final declared one-second case before the real run.
  await page.goto(paramsUrl);
  for (const [key, value] of Object.entries({ duration_s: 1, initial_temperature_k: 90, final_temperature_k: 250 })) await expect(field(key)).toHaveValue(String(value));
  await fill('duration_s', 2);
  const resaved = await saveConditions('saved-basis-two-second-edit', loaded, 2);
  checkReferences(resaved.definition.parameters.basis_references, first.references);
  await fill('duration_s', 1);
  const restored = await saveConditions('saved-basis-one-second-restore', resaved);
  checkReferences(restored.definition.parameters.basis_references, first.references);
  await capture('短路回读30条依据后真实再次保存1秒条件');

  const final = await prepare('final');
  for (const key of Object.keys(first.references)) {
    assert.deepEqual(final.references[key].record, first.references[key].record, '重新查询仍须是同一原始记录');
    assert.equal(final.references[key].record_sha256, first.references[key].record_sha256);
  }
  await final.dialog.getByRole('checkbox', { name: '已核对输入来源与方法适用范围', exact: true }).check();
  const runPath = workspaceRoot + '/studies/' + final.study.id + '/runs';
  const [runResponse] = await Promise.all([
    page.waitForResponse(item => new URL(item.url()).pathname === runPath && item.request().method() === 'POST', { timeout: 180000 }),
    final.dialog.getByRole('button', { name: '确认并运行', exact: true }).click(),
  ]);
  const started = await responseEvidence('confirmed-run', runResponse);
  assert.equal(started.request.scope_acknowledged, true);
  await expect(final.dialog).toBeHidden({ timeout: 180000 });
  await expect(page.locator('[data-type-page="short-circuit-results"]')).toHaveAttribute('data-type-state', 'success', { timeout: 180000 });
  const run = await readApi(runPath + '/' + started.body.id + '?view=full');
  assert.ok(['succeeded', 'partial'].includes(run.status), JSON.stringify(run.error));
  assert.equal(run.integrity, 'verified');
  checkConditions(run.snapshot.definition);
  checkReferences(run.snapshot.definition.parameters.basis_references, final.references);
  const artifact = run.output.cases.find(item => item.status === 'succeeded')?.artifacts?.['x-cablesim.type-short-circuit'];
  assert.ok(artifact, '真实运行必须保存短路结果工件');
  const conductor = artifact.rows.filter(row => row.id.endsWith(':conductor-adiabatic'));
  assert.equal(conductor.length, 1, '隔离教学型号为单芯');
  assert.equal(conductor[0].status, 'available');
  assert.equal(conductor[0].unit, 'A');
  assert.ok(Math.abs(conductor[0].value - 57233.40266460442) < 1e-6, '400 mm² 铜导体在明确工况下的绝热结果须与已核对的依据计算一致');
  assert.equal(conductor[0].formula_inputs.t_s, 1);
  assert.equal(conductor[0].formula_inputs.theta_i_K, 363.15);
  assert.equal(conductor[0].formula_inputs.theta_f_K, 523.15);
  assert.match(conductor[0].source_digest, sha256);
  evidence.run = run; evidence.conductor_result = conductor[0]; await saveEvidence();
  const table = page.getByRole('table', { name: '短路容量', exact: true });
  const row = table.getByRole('row', { name: conductor[0].title, exact: true });
  await expect(row).toContainText('已计算');
  await expect(row).toContainText('57.2 kA');
  await capture('短路真实运行结果与缺项范围');
  await row.click();
  await page.getByRole('tablist', { name: '属性分页', exact: true }).getByRole('tab', { name: '输入', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: '所选对象属性', exact: true });
  const citation = inspector.locator('.property-row').filter({ has: page.locator('dt').filter({ hasText: /^出处$/ }) });
  await expect(citation).toContainText('IEC 60949');
  await expect(citation).toContainText(`第 ${conductor[0].printed_page} 页`);
  await expect(citation).toContainText(`PDF 第 ${conductor[0].pdf_page} 页`);
  await citation.scrollIntoViewIfNeeded();
  await expect(citation).toBeInViewport({ ratio: 1 });
  await capture('短路保存结果的标准条款与原件页码');
  const sourceGroup = inspector.locator('section').filter({ has: page.getByRole('heading', { name: '来源与运行', exact: true }) });
  const source = inspector.locator('.property-row').filter({ has: page.locator('dt').filter({ hasText: /^输入来源$/ }) });
  const method = inspector.locator('.property-row').filter({ has: page.locator('dt').filter({ hasText: /^方法$/ }) });
  await sourceGroup.scrollIntoViewIfNeeded();
  await expect(source).toBeInViewport({ ratio: 1 });
  await expect(method).toBeInViewport({ ratio: 1 });
  await expect(method).toContainText(run.snapshot.definition.method.version);
  await capture('短路保存结果的输入来源与方法版本');
  report.checks.push(`${viewport.width}：既有型号短路页面真实填写1s/90℃/250℃并记录未经批准的工程师来源；UI首次保存→查询30条依据→JS序列化保存→回读→两次实际PUT恢复1s→再次预检→人工确认运行。6条sigma_c只改变整数浮点数表示，原值、发行摘要和全部元数据保持；保存结果完整性verified，导体绝热值57.23340266460442kA，缺项范围与标准页码分别截图。`);
}
