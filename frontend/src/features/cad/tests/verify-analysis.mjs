import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBrowserFixture, navigate, repositoryRoot, selectOption } from './browser-fixture.mjs';

// Only replays saved FEM/IEC artifacts. No solver runs, POSTs or database writes.
const output = path.join(repositoryRoot, '.data/cad-analysis'); await fs.mkdir(output, { recursive: true });
let receiptPath = process.env.FEM_RECEIPT;
if (!receiptPath) {
  const folders = await fs.readdir(path.join(repositoryRoot, '.data/fem-workbench'));
  for (const folder of folders) {
    const candidate = path.join(repositoryRoot, '.data/fem-workbench', folder, 'receipt.json');
    const value = JSON.parse(await fs.readFile(candidate, 'utf8').catch(() => '{}'));
    if (value.femRun && value.iecRun) { receiptPath = candidate; break; }
  }
}
assert.ok(receiptPath, 'FEM_RECEIPT must identify two actual saved runs; no synthetic fields are substituted');
const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
const fem = JSON.parse(await fs.readFile(path.join(receipt.folder, 'fem-result.json'), 'utf8'));
const iec = JSON.parse(await fs.readFile(path.join(receipt.folder, 'iec-result.json'), 'utf8'));
assert.equal(fem.id, receipt.femRun); assert.equal(iec.id, receipt.iecRun);
assert.equal(fem.integrity, 'verified'); assert.equal(iec.integrity, 'verified');
const frozen = spawnSync(process.env.PYTHON || 'python', ['src/features/cad/tests/saved-input-fixture.py', receiptPath], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
assert.equal(frozen.status, 0, frozen.stderr); const inputs = JSON.parse(frozen.stdout);
const fixture = await createBrowserFixture({ software: true }), { page } = fixture;
const results = { femRun: fem.id, iecRun: iec.id, layouts: [] };
page.setDefaultTimeout(15000);
async function layout(label) {
  const value = await page.locator('.cad-viewport').evaluate(root => {
    const box = root.getBoundingClientRect(), elements = [...root.querySelectorAll('button,span,label,text')].filter(n => n.getBoundingClientRect().width && n.textContent.trim());
    const font = Math.min(...elements.map(n => parseFloat(getComputedStyle(n).fontSize)));
    const controls = [...root.querySelectorAll('.cad-tools, .cad-view-cube, .cad-result-status, .cad-field-tools')].map(n => n.getBoundingClientRect());
    const overlaps = controls.some((a, i) => controls.slice(i + 1).some(b => Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1));
    const rgb = s => s.match(/[\d.]+/g).map(Number), l = s => rgb(s).slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const panel = l(getComputedStyle(root).backgroundColor), contrast = elements.filter(n => !n.closest('svg') && !n.children.length && !n.closest('[disabled]')).map(n => { const color = l(getComputedStyle(n).color); return (Math.max(color, panel) + .05) / (Math.min(color, panel) + .05); });
    const overflow = document.documentElement.scrollWidth > innerWidth + 1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1;
    return { font, overlaps, overflow, contrast: Math.min(...contrast) };
  });
  assert.ok(value.font >= 13, `${label}: font ${value.font}`); assert.ok(value.contrast >= 4.48, `${label}: contrast ${value.contrast}`);
  assert.equal(value.overlaps, false, label); assert.equal(value.overflow, false, label);
  results.layouts.push({ label, ...value });
}
async function saveExport(probe, name) {
  const image = await page.evaluate(probe => window.canvasGallery[probe].exportImage(), probe);
  const bytes = Buffer.from(image.bytes); assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.equal(bytes.readUInt32BE(16), image.metadata.width); assert.equal(bytes.readUInt32BE(20), image.metadata.height);
  assert.ok(image.metadata.scaleMmPerPixel > 0); assert.match(image.metadata.geometryInputSha256, /^[a-f0-9]{64}$/);
  await fs.writeFile(path.join(output, name), bytes); await fs.writeFile(path.join(output, name + '.json'), JSON.stringify(image.metadata, null, 2));
  return image.metadata;
}
try {
  await page.addInitScript(({ fem, iec }) => { window.cadSavedFixture = { fem, iec }; }, { fem, iec });
  await page.route('**/api/**', route => {
    assert.equal(route.request().method(), 'GET', 'No solver or write requests allowed');
    const url = new URL(route.request().url());
    if (inputs[url.pathname]) return route.fulfill({ json: inputs[url.pathname] });
    if (url.pathname.endsWith('/studies')) return route.fulfill({ json: [{ id: iec.study, definition: { title: 'IEC 保存参考', method: { plugin_id: 'cablesim.iec60287' } } }] });
    if (url.pathname.endsWith('/runs')) return route.fulfill({ json: { items: [{ id: iec.id, status: iec.status, created: iec.created }], next_cursor: null } });
    if (url.pathname.endsWith(`/runs/${iec.id}`)) return route.fulfill({ json: iec });
    return route.fulfill({ status: 404, json: { detail: 'Read-only saved fixture' } });
  });
  await navigate(fixture, 'cad-field');
  await page.locator('[data-cad-ready=true]').waitFor(); await page.getByRole('combobox', { name: '三维温度场', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.cad-field-notice'));
  await page.locator('[data-cad-field-ready=true]').waitFor();
  results.firstFieldMs = Number(await page.locator('[data-cad-ready]').getAttribute('data-cad-first-display-ms'));
  await selectOption(page, '三维温度场', 'IEC'); await page.locator('[data-field-kind=iec]').waitFor(); await page.locator('[data-cad-field-ready=true]').waitFor();
  const range = await page.locator('[data-field-kind]').evaluate(n => [Number(n.dataset.minimum), Number(n.dataset.maximum)]);
  assert.equal(await page.locator('[data-field-kind]').getAttribute('data-run-id'), iec.id);
  await selectOption(page, '三维温度场', '有限元'); await page.locator('[data-field-kind=fem]').waitFor(); await page.locator('[data-cad-field-ready=true]').waitFor();
  assert.deepEqual(await page.locator('[data-field-kind]').evaluate(n => [Number(n.dataset.minimum), Number(n.dataset.maximum)]), range);
  assert.equal(await page.locator('[data-field-kind]').getAttribute('data-run-id'), fem.id);
  await selectOption(page, '三维温度场', '有限元 − IEC'); await page.locator('[data-field-kind=difference]').waitFor(); await page.locator('[data-cad-field-ready=true]').waitFor();
  const difference = await page.evaluate(() => window.canvasGallery.field.snapshot().thermal);
  assert.equal(difference.maximum, -difference.minimum); assert.ok(difference.values.every(Number.isFinite)); assert.deepEqual(difference.references.map(v => v.runId), [fem.id, iec.id]);
  assert.match(await page.locator('.cad-thermal-legend').textContent(), /K.*0/);
  results.difference = { triangles: difference.triangles.length, minimum: difference.minimum, maximum: difference.maximum };
  results.export = await saveExport('field', 'saved-difference.png'); assert.equal(results.export.field.kind, 'difference'); assert.equal(results.export.field.references.length, 2);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 PNG', exact: true }).click(); assert.match((await download).suggestedFilename(), /\.png$/);
  await page.screenshot({ path: path.join(output, 'saved-field-three.png') });
  for (const size of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize(size); await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const state of ['success', 'empty', 'loading', 'error', 'historical']) {
      await page.evaluate(state => window.canvasGallery.setState(state), state);
      if (state === 'success' || state === 'historical') await page.locator('[data-cad-ready=true]').waitFor();
      await layout(`saved-field ${size.width} ${theme} ${state}`);
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 }); await navigate(fixture, 'cad', { kind: 'large' }); await page.locator('[data-cad-ready=true]').waitFor();
  const large = await page.evaluate(() => window.canvasGallery.cad.snapshot());
  assert.equal(large.geometry.objects.filter(o => o.kind === 'cable').length, 18); assert.equal(large.geometry.objects.filter(o => o.kind === 'soil').length, 2); assert.ok(large.geometry.objects.some(o => o.kind === 'backfill'));
  results.largeFirstFrameMs = Number(await page.locator('[data-cad-ready]').getAttribute('data-cad-first-display-ms')); assert.ok(results.largeFirstFrameMs > 0 && results.largeFirstFrameMs <= 2000, `Large scene: ${results.largeFirstFrameMs} ms`);
  const renderer = await page.locator('.cad-canvas-host canvas').evaluate(n => ({ renderer: n.dataset.webglRenderer, colors: Number(n.dataset.webglColors) })); assert.match(renderer.renderer, /SwiftShader/i); assert.ok(renderer.colors > 8); results.renderer = renderer;
  await page.getByRole('button', { name: '端面', exact: true }).click(); await page.locator('.cad-viewport[data-cad-view=end]').waitFor();
  const cables = large.geometry.objects.filter(o => o.kind === 'cable');
  const screen = async object => {
    const b = object.bounds_m, p = await page.evaluate(([x, y, z]) => window.canvasGallery.cad.project(x, y, z), [(b[0] + b[3]) * 500, 0, (b[2] + b[5]) * 500]);
    const host = await page.locator('.cad-canvas-host').boundingBox(); return { x: host.x + p.x, y: host.y + p.y };
  };
  const a = await screen(cables[0]), b = await screen(cables[1]);
  await page.mouse.click(a.x, a.y); await page.locator(`[data-cad-object-dimensions="${cables[0].id}"]`).waitFor();
  assert.match(await page.locator('[data-cad-object-dimensions]').textContent(), /900.*38.*180/);
  const duct = large.geometry.objects.find(o => o.kind === 'enclosure');
  const db = duct.bounds_m;
  const wall = await page.evaluate(([x, z]) => window.canvasGallery.cad.project(x, 0, z), [((db[0] + db[3]) / 2 + .075) * 1000, (db[2] + db[5]) * 500]);
  const host = await page.locator('.cad-canvas-host').boundingBox();
  await page.mouse.click(host.x + wall.x, host.y + wall.y);
  await page.locator(`[data-cad-object-dimensions="${duct.id}"]`).waitFor();
  assert.match(await page.locator('[data-cad-object-dimensions]').textContent(), /900.*160.*180/);
  await selectOption(page, '选择方式', '两点距离'); await page.mouse.click(a.x, a.y); await page.getByText('已捕捉第一点；选择第二点', { exact: true }).waitFor();
  await page.mouse.click(b.x, b.y); await page.locator('[data-cad-point-measurement] circle').nth(1).waitFor();
  const measured = Number(await page.locator('[data-cad-distance-mm]').getAttribute('data-cad-distance-mm')); assert.ok(Math.abs(measured - 180) < 5, `180 mm centers picked within one screen pixel: ${measured}`); results.measurementMm = measured;
  await page.getByRole('button', { name: '等轴视图', exact: true }).click(); await page.locator('.cad-viewport[data-cad-view=iso]').waitFor(); assert.equal(await page.locator('[data-cad-point-measurement] circle').count(), 2);
  const canvas = page.locator('.cad-canvas-host canvas'); await canvas.press('Escape'); assert.equal(await page.locator('[data-cad-point-measurement]').count(), 0);
  await selectOption(page, '选择方式', '对象');
  const priorFrames = await page.evaluate(() => window.canvasGallery.cad.snapshot().info.frame_ms.length);
  const box = await canvas.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  for (let i = 0; i < 60; i++) { await page.mouse.move(box.x + box.width / 2 + Math.sin(i / 15) * 100, box.y + box.height / 2 + Math.cos(i / 15) * 30); await page.waitForTimeout(16); }
  await page.mouse.up();
  const frames = (await page.evaluate(() => window.canvasGallery.cad.snapshot().info.frame_ms)).slice(priorFrames); frames.sort((a, b) => a - b);
  const p95 = frames[Math.floor(frames.length * .95)]; assert.ok(frames.length >= 30, `Only ${frames.length} completed GPU frames`); assert.ok(p95 <= 34, `Software-rendered large scene p95 ${p95} ms exceeds 30 fps budget`);
  assert.ok(frames.at(-1) <= 100, `Rotation stalled for ${frames.at(-1)} ms`);
  results.largeRotation = { completedFrames: frames.length, p95Ms: p95, maximumMs: frames.at(-1) };
  await saveExport('cad', 'large-scene.png');
  for (const size of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize(size); await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme); await layout(`large-scene ${size.width} ${theme}`);
  }
  await page.setViewportSize({ width: 1366, height: 768 }); await navigate(fixture, 'cad'); await page.getByRole('button', { name: '精细替换', exact: true }).click(); await page.locator('[data-cad-model-kind=precise][data-cad-ready=true]').waitFor();
  const annotations = page.locator('[data-cad-layer-annotation]'); assert.ok(await annotations.count() >= 4); assert.match(await annotations.first().getAttribute('aria-label'), /mm/);
  await annotations.nth(2).press('Enter'); assert.equal(await page.locator('[data-cad-ready]').getAttribute('data-cad-selected'), await annotations.nth(2).getAttribute('data-cad-layer-annotation'));
  await page.screenshot({ path: path.join(output, 'type-layer-labels.png') });
  for (const size of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize(size); await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const state of ['success', 'empty', 'loading', 'error', 'historical']) { await page.evaluate(state => window.canvasGallery.setState(state), state); if (state === 'success' || state === 'historical') await page.locator('[data-cad-ready=true]').waitFor(); await layout(`type-labels ${size.width} ${theme} ${state}`); }
  }
  // Missing-side and network-error states preserve geometry and keep the difference option unavailable.
  await page.unroute('**/api/**'); await page.route('**/api/**', route => route.fulfill({ json: [] })); await navigate(fixture, 'cad-field');
  await page.getByText('尚无 IEC保存场；差值未覆盖', { exact: true }).waitFor(); await page.locator('[data-cad-ready=true]').waitFor();
  await page.unroute('**/api/**'); await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: 'Saved runs unavailable' } })); await navigate(fixture, 'cad-field'); await page.getByRole('button', { name: '重试对照', exact: true }).waitFor();
  await page.locator('[data-cad-ready=true]').waitFor();
  assert.deepEqual(fixture.errors, []); results.passed = true;
} catch (error) {
  console.error('CAD regression failure:', await page.locator('body').innerText()); console.error('Runtime errors:', fixture.errors); console.error(error); throw error;
} finally {
  await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify(results, null, 2)); await fixture.close();
}
console.log(JSON.stringify(results, null, 2));
