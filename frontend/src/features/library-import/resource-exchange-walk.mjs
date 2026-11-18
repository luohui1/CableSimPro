import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const projectKeys = ['scenario', 'domain', 'locks', 'sources', 'domain_conversion', 'study_cable_reference', 'engineering_model_reference'];
const names = { density: '密度', volumetric_heat_capacity: '体积热容', electrical_resistivity_20: '20 °C 电阻率', soil_rho_k_m_w: '土壤热阻率', depth_m: '原文电缆埋深（基准待核）' };
const write = (out, name, value) => fs.writeFile(path.join(out, name + '.json'), JSON.stringify(value, null, 2));

async function readSaved(page, base, endpoint, rawPath) {
  const response = await page.request.get(base + endpoint, { timeout: 180000 });
  try {
    assert.equal(response.status(), 200, `${endpoint}: ${await response.text()}`);
    if (rawPath) await saveRawResponse(response, rawPath);
    return await response.json();
  } finally { await response.dispose(); }
}

export async function saveRawResponse(response, filename) {
  const bytes = await response.body();
  await fs.writeFile(filename, bytes);
  const evidence = { file: path.basename(filename), size: bytes.length, sha256: hash(bytes) };
  await fs.appendFile(path.join(path.dirname(filename), 'raw-http-responses.jsonl'), JSON.stringify({ ...evidence, endpoint: response.url(), status: response.status() }) + '\n');
  return evidence;
}

export function safeRequestHeaders(request) {
  const headers = request.headers();
  return Object.fromEntries(['content-type', 'x-cablesim-actor'].filter(key => headers[key] !== undefined).map(key => [key, headers[key]]));
}

/** Retain the reviewed form fields, not the binary body or unrelated headers. */
export async function multipartEvidence(response, filename, page) {
  const request = response.request(), headers = safeRequestHeaders(request);
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(headers['content-type'] ?? '');
  assert.ok(boundary, '真实上传请求须是 multipart/form-data');
  const raw = request.postDataBuffer();
  if (!raw) {
    // The browser's real fetch invocation is captured before sending; do not
    // fabricate request fields from the expected preview or response.
    assert.ok(page, 'Chromium未提供上传正文时必须读取真实页面表单');
    const observed = await page.evaluate(pathname =>
      window.__cablesimFormRequests?.filter(item => item.pathname === pathname).at(-1) ?? null,
      new URL(request.url()).pathname);
    assert.ok(observed, '须保留真实上传请求的表单字段');
    const bytes = await fs.readFile(filename);
    assert.equal(observed.file?.name, path.basename(filename));
    assert.equal(observed.file?.size, bytes.length);
    return { method: request.method(), url: request.url(), request_headers: headers,
      form: Object.fromEntries(Object.entries(observed.fields).filter(([key]) => ['reviewed_sha256', 'confirmed', 'request_id'].includes(key))),
      file: { name: observed.file.name, size: bytes.length, sha256: hash(bytes), full_file_body_observed: false },
      form_observed_in_browser_fetch: true, status: response.status() };
  }
  const separator = Buffer.from('--' + (boundary[1] ?? boundary[2]));
  const fields = {};
  let uploadedName, fileBody;
  for (let start = raw.indexOf(separator); start >= 0;) {
    const end = raw.indexOf(separator, start + separator.length);
    if (end < 0) break;
    const part = raw.subarray(start + separator.length, end), divide = part.indexOf('\r\n\r\n');
    if (divide >= 0) {
      const heading = part.subarray(0, divide).toString('utf8');
      const name = /(?:^|;)\s*name="([^"]+)"/m.exec(heading)?.[1];
      const value = part.subarray(divide + 4, part.length - 2);
      if (name === 'file') { uploadedName = /filename="([^"]*)"/.exec(heading)?.[1]; fileBody = value; }
      else if (['reviewed_sha256', 'confirmed', 'request_id'].includes(name)) fields[name] = value.toString('utf8');
    }
    start = end;
  }
  const bytes = await fs.readFile(filename);
  assert.equal(uploadedName, path.basename(filename));
  // Chromium may omit multipart file bytes from its protocol. The downloaded
  // file digest, server-verified bundle digest and exact fresh data remain checked.
  const fullFileBodyObserved = fileBody?.length === bytes.length;
  if (fullFileBodyObserved) assert.equal(hash(fileBody), hash(bytes));
  return { method: request.method(), url: request.url(), request_headers: headers, form: fields,
    file: { name: uploadedName, size: bytes.length, sha256: hash(bytes), full_file_body_observed: fullFileBodyObserved }, status: response.status() };
}

function parseDownloaded(filename, root) {
  const python = process.env.E2E_PYTHON || path.join(root, '.venv', 'bin', 'python');
  return JSON.parse(execFileSync(python, ['-c',
    'import json,sys; from pathlib import Path; from backend.kernel.resource_exchange import parse_file; p=Path(sys.argv[1]); print(json.dumps(parse_file(p.name,p.read_bytes()),ensure_ascii=False))', filename],
  { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
}

function verifyRawTransfer(file, assets, projects, root) {
  const python = process.env.E2E_PYTHON || path.join(root, '.venv', 'bin', 'python');
  const script = [
    'import json,sys',
    'from pathlib import Path',
    'from backend.kernel.resource_exchange import parse_file,encoded',
    'from backend.foundation.contracts import AssetRelease,content_hash',
    'p=Path(sys.argv[1]); bundle=parse_file(p.name,p.read_bytes())',
    'paths=json.loads(sys.argv[2])',
    'for path in paths["assets"]:',
    ' detail=json.loads(Path(path).read_bytes()); release=detail["release"]',
    ' source=next(item for item in bundle["assets"] if (item["release"]["asset_id"],item["release"]["version"])==(release["asset_id"],release["version"]))',
    ' assert encoded(release)==encoded(source["release"]), "raw release numeric forms and all receipts must match"',
    ' assert content_hash(AssetRelease.model_validate(release))==detail["content_sha256"]==source["content_sha256"]',
    'for path in paths["projects"]:',
    ' detail=json.loads(Path(path).read_bytes())',
    ' source=next(item for item in bundle["projects"] if item["origin_id"]==detail["exchange_origin"]["workspace"])',
    ' assert encoded({key:detail[key] for key in source["inputs"]})==encoded(source["inputs"]), "raw saved project inputs must match"',
    'print(json.dumps({"raw_asset_count":len(paths["assets"]),"raw_project_count":len(paths["projects"]),"canonical_bytes_exact":True,"asset_digests_recomputed":True}))',
  ].join('\n');
  return JSON.parse(execFileSync(python, ['-c', script, file, JSON.stringify({ assets, projects })], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 }));
}

function verifyRawReexport(sourceFile, targetFile, root) {
  const python = process.env.E2E_PYTHON || path.join(root, '.venv', 'bin', 'python');
  const script = [
    'import json,sys',
    'from pathlib import Path',
    'from backend.kernel.resource_exchange import parse_file,encoded',
    'a,b=[parse_file(Path(p).name,Path(p).read_bytes()) for p in sys.argv[1:]]',
    'assert encoded([i["release"] for i in a["assets"]])==encoded([i["release"] for i in b["assets"]])',
    'assert encoded([i["inputs"] for i in a["projects"]])==encoded([i["inputs"] for i in b["projects"]])',
    'print(json.dumps({"release_and_receipt_numeric_forms_exact":True,"project_input_numeric_forms_exact":True}))',
  ].join('\n');
  return JSON.parse(execFileSync(python, ['-c', script, sourceFile, targetFile], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 }));
}

function conflictEditRequest(task, asset, root) {
  const python = process.env.E2E_PYTHON || path.join(root, '.venv', 'bin', 'python');
  // Read the real download, preserving 1.0 versus 1 in opaque signed records.
  // JavaScript JSON re-encoding must not rewrite an authoritative receipt.
  const script = [
    'import json,sys',
    'from pathlib import Path',
    'from backend.kernel.resource_exchange import parse_file',
    'p=Path(sys.argv[1]); bundle=parse_file(p.name,p.read_bytes())',
    'release=next(item["release"] for item in bundle["assets"] if item["release"]["asset_id"]==sys.argv[2])',
    'release["name"]=sys.argv[4]',
    'print(json.dumps({"expected_revision":int(sys.argv[3]),"release":release,"human_confirmed":True},ensure_ascii=False,separators=(",",":")))',
  ].join('\n');
  return execFileSync(python, ['-c', script, task.file, asset.asset_id, String(asset.revision), asset.name + '（本机已编辑名称）'], { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
}

async function select(page, expect, label, value) {
  const field = page.getByRole('combobox', { name: label, exact: true });
  await field.click(); await page.getByRole('option', { name: value, exact: true }).click();
  await expect(field).toHaveText(value);
}

async function openExchange(page, expect, base, operation) {
  await page.goto(base + '/resources/cables/structure-import');
  await page.getByRole('tab', { name: '数据交换', exact: true }).click();
  await select(page, expect, '交换内容', '材料、环境与工程');
  await select(page, expect, '交换操作', operation);
}

async function selectExportScope(page, expect, assets, projects, format) {
  const clear = page.getByRole('button', { name: '清空本次选择', exact: true });
  if (await clear.count()) await clear.click();
  await expect(page.getByRole('button', { name: '导出已选资料与工程', exact: true })).toBeDisabled();
  for (const item of assets) {
    await select(page, expect, '导出内容类别', item.kind === 'material' ? '材料资料' : '敷设与环境');
    await page.getByLabel('按名称查找交换内容', { exact: true }).fill(item.name);
    const row = page.locator(`[id="row-可导出的资料版本-${item.id}"]`);
    await expect(row).toContainText(item.name); await expect(row).toContainText(item.version);
    await row.getByRole('checkbox', { name: `选择资料 ${item.name} ${item.version}`, exact: true }).check();
  }
  for (const item of projects) {
    await select(page, expect, '导出内容类别', '工程输入');
    await page.getByLabel('按名称查找交换内容', { exact: true }).fill(item.name ?? item.domain?.name ?? item.scenario.name);
    const row = page.locator(`[id="row-可导出的工程输入-${item.id}"]`);
    await expect(row).toContainText(String(item.revision));
    await row.getByRole('checkbox').check();
  }
  await select(page, expect, '交换文件格式', format === 'xlsx' ? 'Excel 交换文件' : 'JSON 交换文件');
  const summary = page.getByRole('table', { name: '已选择的交换内容', exact: true });
  await expect(summary.getByRole('row')).toHaveCount(assets.length + projects.length + 1);
  for (const item of assets) await expect(summary).toContainText(item.name);
  await summary.scrollIntoViewIfNeeded();
}

async function downloadUI({ page, expect, out, root, viewport, capture, assets, projects, format, phase }) {
  await selectExportScope(page, expect, assets, projects, format);
  await capture(`${phase}核对资料版本与工程输入导出范围`);
  const [download, response] = await Promise.all([
    page.waitForEvent('download', { timeout: 180000 }),
    page.waitForResponse(value => new URL(value.url()).pathname === '/api/library/exchange/export' && value.request().method() === 'POST', { timeout: 180000 }).then(async value => {
      if (!value.ok()) {
        const raw = await saveRawResponse(value, path.join(out, `${viewport.width}-resource-exchange-${phase}-refusal-raw.json`));
        await write(out, `${viewport.width}-resource-exchange-${phase}-refusal`, { request: value.request().postDataJSON(), request_headers: safeRequestHeaders(value.request()), status: value.status(), response: await value.json(), raw_response: raw });
        assert.fail(`${phase}资料与工程导出被拒绝：HTTP ${value.status()} ${await value.text()}`);
      }
      return value;
    }),
    Promise.resolve().then(() => page.getByRole('button', { name: '导出已选资料与工程', exact: true }).click()),
  ]);
  assert.equal(response.status(), 200, await response.text());
  assert.deepEqual(response.request().postDataJSON(), { asset_ids: assets.map(item => item.id), workspace_ids: projects.map(item => item.id), format });
  const filename = path.join(out, `${viewport.width}-resource-exchange-${phase}.${format}`);
  await download.saveAs(filename); assert.equal(await download.failure(), null);
  const bytes = await fs.readFile(filename), headers = response.headers();
  assert.equal(hash(bytes), headers['x-content-sha256']);
  const bundle = parseDownloaded(filename, root);
  assert.equal(bundle.sha256, headers['x-bundle-sha256']);
  assert.equal(bundle.assets.length, assets.length); assert.equal(bundle.projects.length, projects.length);
  for (const original of assets) {
    const saved = bundle.assets.find(item => item.origin_id === original.id);
    assert.ok(saved); assert.deepEqual(saved.release, original.release);
    assert.equal(saved.content_sha256, original.content_sha256); assert.equal(saved.origin_status, original.status);
  }
  await write(out, `${viewport.width}-resource-exchange-${phase}-http`, {
    request: response.request().postDataJSON(), request_headers: safeRequestHeaders(response.request()), status: response.status(),
    response_headers: Object.fromEntries(['content-type', 'content-disposition', 'x-content-sha256', 'x-bundle-sha256'].map(key => [key, headers[key]])),
    file: { name: path.basename(filename), size: bytes.length, sha256: hash(bytes) }, bundle,
  });
  await expect(page.getByRole('status').filter({ hasText: '已下载 cablesim-data.' })).toBeVisible();
  await page.getByRole('status').filter({ hasText: '已下载 cablesim-data.' }).scrollIntoViewIfNeeded();
  await capture(`${phase}真实下载完整资料与工程输入`);
  return { file: filename, bundle };
}

/** Source objects are the published outcomes of the real resource UI walk. */
export async function exportResourceExchange({ page, base, viewport, out, root, expect, capture, resourceAudit, report }) {
  assert.equal(process.env.E2E_ISOLATED, '1');
  const readApi = endpoint => readSaved(page, base, endpoint);
  const material = resourceAudit.assets.find(item => item.category === 'materials')?.published;
  const soil = resourceAudit.assets.find(item => item.published.release.reference_evidence.some(evidence => evidence.parameter === 'soil_rho_k_m_w'))?.published;
  const depth = resourceAudit.assets.find(item => item.published.release.reference_evidence.some(evidence => evidence.parameter === 'depth_m'))?.published;
  assert.ok(material && soil && depth, '交换必须使用此前真实界面创建并发布的三份资料，不能另造数据');
  for (const [index, asset] of [material, soil, depth].entries()) {
    assert.equal(asset.status, 'published');
    assert.deepEqual(await readSaved(page, base, `/api/foundation/assets/${asset.id}`, path.join(out, `${viewport.width}-resource-exchange-source-asset-${index + 1}-raw.json`)), asset);
    assert.ok(asset.release.reference_evidence.every(item => item.receipt.trust.grade === 'reference'));
  }
  // Reuse the saved release engineering example. This tests input transport, not
  // completeness of the example, approval, or any new calculation.
  const projects = (await readApi('/api/workspaces')).filter(item => item.name === '城北变电站 · 10 kV 三回排管');
  assert.equal(projects.length, 1, '须明确找到发布库中已有工程，不生成替代工程');
  const projectIndex = await readSaved(page, base, `/api/index/objects?kind=project&q=${encodeURIComponent(projects[0].name)}&limit=100`, path.join(out, `${viewport.width}-resource-exchange-source-project-index-raw.json`));
  assert.ok(projectIndex.items.some(item => item.kind === 'project' && item.id === projects[0].id), '已有工程身份须由同一宿主索引明确给出，不能仅按名称把型号当工程');
  const project = await readSaved(page, base, `/api/workspaces/${projects[0].id}`, path.join(out, `${viewport.width}-resource-exchange-source-project-raw.json`));
  await write(out, `${viewport.width}-resource-exchange-source`, { assets: [material, soil, depth], project,
    scope: '现有工程的已保存输入搬运；不声称工程完整、审批或运行已跨机恢复。' });
  const format = viewport.width === 1366 ? 'json' : 'xlsx';
  await openExchange(page, expect, base, '导出本机数据');
  const initial = await downloadUI({ page, expect, out, root, viewport, capture, assets: [material, soil], projects: [project], format, phase: '来源机' });
  // Put a never-imported, real resource before the conflicting one. The target
  // refusal must leave that resource AND the new project copy absent.
  const conflict = await downloadUI({ page, expect, out, root, viewport, capture, assets: [depth, material, soil], projects: [project], format, phase: '冲突验证包' });
  for (const key of projectKeys.filter(key => key !== 'study_cable_reference' && key in project)) assert.deepEqual(initial.bundle.projects[0].inputs[key], project[key]);
  assert.deepEqual(await readApi(`/api/workspaces/${project.id}`), project, '导出不能改写来源工程或运行');
  for (const asset of [material, soil, depth]) assert.deepEqual(await readApi(`/api/foundation/assets/${asset.id}`), asset);
  report.checks.push(`${viewport.width}：真实资料UI发布的铜三项物性及湿土参考，经可见勾选下载${format.toUpperCase()}；复用发布库已有城北工程保存输入，不另造完整工程。下载字节SHA与服务端一致，资料完整定义/回执/版本原样保留，来源工程与资料未改。`);
  return { kind: 'resources', viewport, format, ...initial, conflict, source_assets: [material, soil], additional_asset: depth, source_project: project };
}

async function inspectImported(page, expect, capture, asset) {
  await page.getByRole('button', { name: `查看导入资料：${asset.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '交换资料的完整来源', exact: true });
  await expect(dialog.getByRole('heading', { name: `${asset.name} · ${asset.version}`, exact: true })).toBeVisible();
  await expect(dialog).toContainText('草稿 · 修订 1');
  const table = dialog.getByRole('table', { name: '资料逐项来源', exact: true });
  await expect(table.getByRole('row')).toHaveCount(asset.release.reference_evidence.length + 1);
  await capture(`新机${asset.kind === 'material' ? '材料' : '环境'}草稿完整数值与来源`);
  for (const evidence of asset.release.reference_evidence) {
    const row = table.getByRole('row').filter({ has: page.getByRole('cell', { name: names[evidence.parameter], exact: true }) });
    await expect(row).toContainText(String(evidence.quantity.value));
    await row.click();
    await expect(dialog).toContainText(evidence.receipt.record.citation);
    await expect(dialog).toContainText(`正文 ${evidence.receipt.record.printed_page} 页 · PDF ${evidence.receipt.record.pdf_page} 页`);
    await expect(dialog).toContainText(evidence.receipt.method.method_version);
    await dialog.locator('.library-import-dialog-body').evaluate(element => element.scrollTo({ top: 0 }));
    await capture(`新机${names[evidence.parameter]}原值SI页码方法与条件`);
    const technical = dialog.locator('details').filter({ has: page.locator('summary', { hasText: '来源完整性与技术核对' }) });
    await technical.locator('summary').click();
    await expect(technical).toContainText(evidence.receipt.record.source_sha256);
    await expect(technical).toContainText(evidence.record_sha256);
    for (const key of ['release_digest', 'data_sha256', 'request_sha256', 'artifact_sha256']) await expect(technical).toContainText(evidence.receipt[key]);
    await technical.locator('summary').scrollIntoViewIfNeeded();
    await capture(`新机${names[evidence.parameter]}固定回执摘要`);
    await dialog.getByRole('button', { name: '返回资料参数', exact: true }).click();
    await expect(table).toBeVisible();
  }
  await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await expect(dialog).toBeHidden();
}

/** All exchange exports, uploads and confirmations are visible browser actions. */
export async function importResourceExchange({ page, base, task, out, root, expect, capture, report, requestIdentity }) {
  const { viewport } = task, prefix = `${viewport.width}-resource-exchange`;
  const get = endpoint => readSaved(page, base, endpoint);
  const readInventory = async () => ({ assets: await get('/api/foundation/assets?limit=100'), projects: await get('/api/workspaces') });
  const before = await readInventory();
  for (const source of [...task.source_assets, task.additional_asset]) assert.ok(!before.assets.items.some(item => item.asset_id === source.asset_id && item.version === source.version));
  await write(out, prefix + '-target-before', before);
  await openExchange(page, expect, base, '导入交换文件');
  await capture('新机选择资料与工程交换文件');
  async function previewFile(file, name, status = 200) {
    const [response] = await Promise.all([
      page.waitForResponse(value => new URL(value.url()).pathname === '/api/library/exchange/preview' && value.request().method() === 'POST', { timeout: 180000 }),
      Promise.resolve().then(() => page.getByLabel('资料与工程交换文件', { exact: true }).setInputFiles(file)),
    ]);
    assert.equal(response.status(), status, await response.text());
    const raw = await saveRawResponse(response, path.join(out, prefix + '-' + name + '-raw.json'));
    const body = await response.json(), evidence = { ...await multipartEvidence(response, file, page), response: body, raw_response: raw };
    await write(out, prefix + '-' + name, evidence);
    return { response, body, evidence };
  }
  async function confirmImport(file, preview, name) {
    const button = page.getByRole('button', { name: '确认导入资料与工程', exact: true });
    await expect(button).toBeDisabled();
    await page.getByRole('checkbox', { name: '确认资料与工程交换范围', exact: true }).check();
    await button.scrollIntoViewIfNeeded(); await capture(`${name}人工确认资料与工程范围`);
    const [response] = await Promise.all([
      page.waitForResponse(value => new URL(value.url()).pathname === '/api/library/exchange/import' && value.request().method() === 'POST', { timeout: 180000 }),
      Promise.resolve().then(() => button.click()),
    ]);
    assert.equal(response.status(), 201, await response.text());
    const receipt = await response.json(), evidence = await multipartEvidence(response, file, page);
    assert.equal(evidence.request_headers['x-cablesim-actor'], 'human');
    assert.equal(evidence.form.confirmed, 'true'); assert.equal(evidence.form.reviewed_sha256, preview.sha256);
    assert.equal(receipt.request_id, evidence.form.request_id); assert.equal(receipt.sha256, preview.sha256);
    assert.equal(receipt.approval_inherited, false);
    const raw = await saveRawResponse(response, path.join(out, prefix + '-' + name + '-receipt-raw.json'));
    await write(out, prefix + '-' + name + '-receipt', { ...evidence, response: receipt, raw_response: raw });
    await expect(page.getByRole('heading', { name: '资料与工程已导入', exact: true })).toBeVisible();
    await page.getByRole('heading', { name: '资料与工程已导入', exact: true }).scrollIntoViewIfNeeded();
    await capture(`${name}草稿与独立工程输入回执`);
    return receipt;
  }
  const preview = await previewFile(task.file, 'target-preview');
  assert.equal(preview.body.sha256, task.bundle.sha256); assert.equal(preview.body.approval_inherited, false);
  assert.ok(preview.body.assets.every(item => item.action === 'create_draft'));
  assert.ok(preview.body.projects.every(item => item.action === 'create_independent_input_copy'));
  await expect(page.getByRole('heading', { name: '核对资料与工程交换预览', exact: true })).toBeVisible();
  await capture('新机资料草稿与工程输入预览不入库');
  assert.deepEqual(await readInventory(), before, '预览不得写入资料或工程');
  const receipt = await confirmImport(task.file, preview.body, '首次导入');
  const fresh = { assets: [], projects: [] };
  const rawFresh = { assets: [], projects: [] };
  for (const [index, item] of receipt.assets.entries()) {
    const rawPath = path.join(out, prefix + `-target-asset-${index + 1}-raw.json`);
    const detail = await readSaved(page, base, `/api/foundation/assets/${item.id}`, rawPath), original = task.source_assets.find(source => source.id === item.origin_id);
    rawFresh.assets.push(rawPath);
    assert.ok(original); assert.equal(item.action, 'create_draft'); assert.equal(detail.status, 'draft'); assert.equal(detail.revision, 1);
    assert.equal(detail.reviewed_sha256, null); assert.deepEqual(detail.release, original.release);
    assert.equal(detail.content_sha256, original.content_sha256);
    assert.deepEqual(detail.release.reference_evidence, original.release.reference_evidence, '完整原值/SI/条件/页码/来源/方法/可信分档及回执必须逐字往返');
    assert.ok(detail.release.reference_evidence.every(evidence => evidence.receipt.trust.grade === 'reference'));
    fresh.assets.push(detail);
  }
  for (const [index, item] of receipt.projects.entries()) {
    const rawPath = path.join(out, prefix + `-target-project-${index + 1}-raw.json`);
    const detail = await readSaved(page, base, `/api/workspaces/${item.id}`, rawPath), original = task.bundle.projects.find(source => source.origin_id === item.origin_id);
    rawFresh.projects.push(rawPath);
    assert.ok(original); assert.notEqual(item.id, item.origin_id); assert.equal(detail.revision, 1); assert.equal(detail.exchange_origin.approval_inherited, false);
    for (const [key, value] of Object.entries(original.inputs)) assert.deepEqual(detail[key], value, '工程保存输入完整保留：' + key);
    assert.deepEqual(detail.runs, []); assert.deepEqual(await get(`/api/workspaces/${item.id}/studies`), []);
    assert.equal(detail.exchange_origin.input_sha256, original.input_sha256); assert.equal(detail.exchange_origin.bundle_sha256, task.bundle.sha256);
    fresh.projects.push(detail);
    await expect(page.getByRole('link', { name: `打开工程：${detail.domain?.name ?? detail.scenario.name}`, exact: true })).toHaveAttribute('href', `/studies?workspace=${encodeURIComponent(item.id)}`);
  }
  await write(out, prefix + '-target-fresh', fresh);
  const importedProjectIndex = await readSaved(page, base, '/api/index/objects?kind=project&limit=100', path.join(out, prefix + '-target-project-index-raw.json'));
  for (const project of fresh.projects) assert.ok(importedProjectIndex.items.some(item => item.id === project.id && item.kind === 'project'),
    '独立工程输入副本必须在同一宿主工程索引中可选，不能变成型号或仅有隐蔽数据库记录');
  const rawVerification = verifyRawTransfer(task.file, rawFresh.assets, rawFresh.projects, root);
  await write(out, prefix + '-target-raw-verification', rawVerification);
  for (const asset of fresh.assets) await inspectImported(page, expect, capture, asset);
  // Re-export exactly these saved objects through the same visible controls.
  await select(page, expect, '交换操作', '导出本机数据');
  const roundtrip = await downloadUI({ page, expect, out, root, viewport, capture, assets: fresh.assets, projects: fresh.projects, format: task.format, phase: '目标机重导出' });
  assert.deepEqual(roundtrip.bundle.assets.map(item => item.release), task.bundle.assets.map(item => item.release));
  assert.deepEqual(roundtrip.bundle.projects.map(item => item.inputs), task.bundle.projects.map(item => item.inputs));
  const rawRoundtrip = verifyRawReexport(task.file, roundtrip.file, root);
  await write(out, prefix + '-reexport-raw-verification', rawRoundtrip);
  for (const asset of fresh.assets) assert.deepEqual(await get(`/api/foundation/assets/${asset.id}`), asset);
  // Re-selecting a file clears prior confirmation. Identical resources reuse
  // local identity/state; the UI explicitly creates another independent project.
  await select(page, expect, '交换操作', '导入交换文件');
  const beforeReuse = await readInventory();
  const reusePreview = await previewFile(task.file, 'reuse-preview');
  assert.ok(reusePreview.body.assets.every(item => item.action === 'reuse'));
  await expect(page.getByRole('table', { name: '资料交换预览', exact: true })).toContainText('复用相同内容，保持本机状态');
  await capture('相同资料版本复用且工程仍为独立副本');
  assert.deepEqual(await readInventory(), beforeReuse);
  const reused = await confirmImport(task.file, reusePreview.body, '相同内容复用');
  for (const item of reused.assets) {
    const prior = receipt.assets.find(asset => asset.origin_id === item.origin_id);
    assert.equal(item.id, prior.id); assert.equal(item.action, 'reuse');
    assert.deepEqual(await get(`/api/foundation/assets/${item.id}`), fresh.assets.find(asset => asset.id === item.id));
  }
  const afterReuse = await readInventory();
  assert.equal(afterReuse.assets.total, beforeReuse.assets.total); assert.equal(afterReuse.projects.length, beforeReuse.projects.length + task.bundle.projects.length);
  const reusedReadback = { assets: [], projects: [] }, rawReuse = { assets: [], projects: [] };
  for (const [index, item] of reused.assets.entries()) {
    const rawPath = path.join(out, prefix + `-reuse-asset-${index + 1}-raw.json`); rawReuse.assets.push(rawPath);
    reusedReadback.assets.push(await readSaved(page, base, `/api/foundation/assets/${item.id}`, rawPath));
  }
  for (const [index, item] of reused.projects.entries()) {
    const rawPath = path.join(out, prefix + `-reuse-project-${index + 1}-raw.json`); rawReuse.projects.push(rawPath);
    reusedReadback.projects.push(await readSaved(page, base, `/api/workspaces/${item.id}`, rawPath));
  }
  await write(out, prefix + '-reuse-fresh', reusedReadback);
  await write(out, prefix + '-reuse-raw-verification', verifyRawTransfer(task.file, rawReuse.assets, rawReuse.projects, root));
  // Conflict preparation is explicitly separate from the UI exchange: edit only
  // the imported draft's name using the existing human-confirmed CAS API. It
  // neither changes a source value nor manufactures a receipt or approval.
  const conflictAsset = fresh.assets.find(item => item.kind === 'material');
  const editText = conflictEditRequest(task, conflictAsset, root), editBody = JSON.parse(editText);
  const editFile = path.join(out, prefix + '-conflict-edit-request-raw.json');
  await fs.writeFile(editFile, editText);
  const editHeaders = { 'Content-Type': 'application/json', 'X-CableSim-Actor': 'human' };
  const editResponse = await page.request.put(base + `/api/foundation/assets/${conflictAsset.id}`, { headers: editHeaders, data: editText, timeout: 180000 });
  const edited = await editResponse.json();
  assert.equal(editResponse.status(), 200, JSON.stringify(edited));
  assert.equal(edited.asset_id, conflictAsset.asset_id); assert.equal(edited.version, conflictAsset.version); assert.notEqual(edited.content_sha256, conflictAsset.content_sha256);
  assert.deepEqual(edited.release.reference_evidence, conflictAsset.release.reference_evidence); assert.equal(edited.status, 'draft');
  const editRaw = await saveRawResponse(editResponse, path.join(out, prefix + '-conflict-edit-response-raw.json'));
  await write(out, prefix + '-conflict-preparation', { scope: '隔离目标库：从真实下载原文保留数值编码，真实CAS接口只改已导入草稿名称，制造同版本内容冲突；非交换操作，不改变数值、回执或审批。',
    request: editBody, raw_request: { file: path.basename(editFile), size: Buffer.byteLength(editText), sha256: hash(Buffer.from(editText)) },
    request_headers: editHeaders, status: editResponse.status(), response: edited, raw_response: editRaw,
    fresh: await readSaved(page, base, `/api/foundation/assets/${edited.id}`, path.join(out, prefix + '-conflict-edited-fresh-raw.json')) });
  const beforeConflict = await readInventory();
  assert.equal(task.conflict.bundle.assets[0].release.asset_id, task.additional_asset.asset_id);
  assert.ok(!beforeConflict.assets.items.some(item => item.asset_id === task.additional_asset.asset_id));
  const conflict = await previewFile(task.conflict.file, 'conflict-refusal', 409);
  assert.equal(conflict.body.detail.code, 'EXCHANGE_VERSION_CONFLICT');
  report.expected_refusals.push({ viewport: viewport.width, request_id: requestIdentity(conflict.response.request()), method: 'POST', url: conflict.response.url(), status: 409,
    code: conflict.body.detail.code, response: conflict.body, observed_errors: [] });
  await expect(page.getByRole('alert')).toContainText('同一版本内容不同');
  await expect(page.getByRole('button', { name: '确认导入资料与工程', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '确认资料与工程交换范围', exact: true })).toHaveCount(0);
  await capture('同版本冲突整包拒绝且没有确认入口');
  const afterConflict = await readInventory();
  assert.deepEqual(afterConflict, beforeConflict, '整包拒绝不能插入排序更早的新环境资料、覆盖现有资料或建立工程副本');
  assert.deepEqual(await get(`/api/foundation/assets/${edited.id}`), edited);
  await write(out, prefix + '-conflict-inventory', { before: beforeConflict, after: afterConflict, missing_unimported_asset: task.additional_asset.asset_id, exact: true });
  await write(out, prefix + '-verification', { format: task.format, copied_asset_count: fresh.assets.length,
    copied_parameter_count: fresh.assets.reduce((sum, item) => sum + item.release.parameters.length, 0),
    copied_reference_evidence_count: fresh.assets.reduce((sum, item) => sum + item.release.reference_evidence.length, 0),
    copied_project_count: fresh.projects.length, original_releases_exact: true, original_receipts_exact: true,
    project_inputs_exact: true, project_runs_empty: true, project_studies_empty: true, approval_inherited: false,
    reexport_exact: true, resource_reuse_exact: true, conflict_atomic: true, raw_verification: rawVerification, raw_reexport_verification: rawRoundtrip,
    full_readbacks: [prefix + '-target-fresh.json', prefix + '-reuse-fresh.json'], raw_readbacks: [...rawFresh.assets, ...rawFresh.projects, ...rawReuse.assets, ...rawReuse.projects].map(item => path.basename(item)) });
  report.checks.push(`${viewport.width}：${task.format.toUpperCase()}真实文件经新机UI预览、人工确认，完整恢复${fresh.assets.length}份材料/环境草稿及${fresh.projects.length}个已有工程输入副本；完整定义、数值、回执与来源SHA逐项一致，重导出无损，工程无运行/研究/审批。同内容资料复用原身份和状态，工程明确另建副本；同版本不同内容409整包拒绝，排在冲突前的新环境资料、已有资料和工程数量均未改变。`);
}

/** Keep every observation. Only one proven response and its exact Chromium
 * resource-error message may be classified as this expected business refusal. */
export function classifyExchangeRefusals(report) {
  report.observed_errors = [...report.errors];
  report.errors = [];
  for (const error of report.observed_errors) {
    const refusal = report.expected_refusals.find(item => item.viewport === error.viewport && item.url === (error.url ?? error.location?.url)
      && (error.kind === 'network' && item.request_id === error.request_id && item.status === error.status
        || error.kind === 'console' && /^Failed to load resource: the server responded with a status of 409\b/.test(error.message)
        && !item.observed_errors.some(observation => observation.kind === 'console')));
    if (refusal) refusal.observed_errors.push(error); else report.errors.push(error);
  }
  for (const refusal of report.expected_refusals) assert.equal(refusal.observed_errors.filter(item => item.kind === 'network').length, 1,
    '预期拒绝必须对应恰好一条已核验409响应，不得广泛忽略网络错误');
}
