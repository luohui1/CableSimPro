import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { expect } from '@playwright/test';
import { createBrowserFixture, navigate, repositoryRoot, drag } from './browser-fixture.mjs';

const output = path.join(repositoryRoot, '.data/cad-what-if'); await fs.mkdir(output, { recursive: true });
const scratch = path.join(repositoryRoot, '.tmp/cad-what-if', randomUUID());
const python = process.env.PYTHON || path.join(repositoryRoot, '.venv/Scripts/python.exe');
const host = spawn(python, ['frontend/src/features/cad/tests/preview-fixture.py', scratch, ...(process.env.CAD_PREVIEW_DATABASE ? ['--source', process.env.CAD_PREVIEW_DATABASE] : [])], { cwd: repositoryRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let backend = '', log = '', fixture;
host.stdout.on('data', chunk => { log += chunk; backend ||= log.match(/CAD_PREVIEW_URL=(http:\/\/127\.0\.0\.1:\d+)/)?.[1] || ''; });
host.stderr.on('data', chunk => { log = (log + chunk).slice(-12000); });
const results = { layouts: [], interactions: [] };
async function api(url, method = 'GET', body) {
  const response = await fetch(backend + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const value = await response.json(); if (!response.ok) throw Error(JSON.stringify(value)); return value;
}
async function layout(page, label) {
  const value = await page.locator('[data-gallery-entry=cad-what-if]').evaluate(root => {
    const box = root.getBoundingClientRect();
    const controls = [...root.querySelectorAll('button,input,.cad-tools,.cad-view-cube,.cad-result-status')].filter(n => n.getBoundingClientRect().width);
    const outside = controls.some(n => { const b = n.getBoundingClientRect(); return b.right > innerWidth + 1 || b.bottom > innerHeight + 1 || b.left < -1; });
    const buttons = [...root.querySelectorAll('button,input')].filter(n => n.getBoundingClientRect().width);
    const overlap = buttons.some((a, i) => buttons.slice(i + 1).some(b => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return Math.min(x.right, y.right) > Math.max(x.left, y.left) + 1 && Math.min(x.bottom, y.bottom) > Math.max(x.top, y.top) + 1; }));
    const nodes = [...root.querySelectorAll('button,input,span,label,text')].filter(n => n.getBoundingClientRect().width && (n.textContent.trim() || n.tagName === 'INPUT'));
    const font = Math.min(...nodes.map(n => parseFloat(getComputedStyle(n).fontSize)));
    const luminance = s => s.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
    const contrast = nodes.filter(n => !n.children.length && !n.closest('svg,[disabled]')).map(n => {
      let parent = n; while (parent && getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)') parent = parent.parentElement;
      const background = luminance(getComputedStyle(parent || document.body).backgroundColor), color = luminance(getComputedStyle(n).color);
      return (Math.max(background, color) + .05) / (Math.min(background, color) + .05);
    });
    return { font, outside, overlap, contrast: Math.min(...contrast), overflow: document.documentElement.scrollWidth > innerWidth + 1 || box.bottom > innerHeight + 1,
      bottom: box.bottom, scrollWidth: document.documentElement.scrollWidth, windowWidth: innerWidth, windowHeight: innerHeight };
  });
  if (value.outside || value.overlap || value.overflow) console.error(JSON.stringify({ label, ...value }));
  assert.ok(value.font >= 13, `${label}: font ${value.font}`); assert.ok(value.contrast >= 4.48, `${label}: contrast ${value.contrast}`);
  assert.equal(value.outside, false, label); assert.equal(value.overlap, false, label); assert.equal(value.overflow, false, label);
  results.layouts.push({ label, ...value });
}
try {
  for (let i = 0; i < 240; i++) { if (host.exitCode !== null) throw Error(log); if (backend) { try { if ((await fetch(backend + '/api/health')).ok) break; } catch {} } await pause(250); }
  assert.ok(backend, log);
  const workspaces = await api('/api/workspaces');
  const workspace = workspaces.find(w => /三回排管/.test(w.name)); assert.ok(workspace, 'Requires the existing engineering demonstration, no fabricated thermal fixture');
  const wp = `/api/workspaces/${workspace.id}`, savedWorkspace = await api(wp);
  let study = (await api(wp + '/studies')).find(s => s.definition.method.plugin_id === 'cablesim.iec60287' && s.definition.driver.kind === 'sweep' && s.latest_run_id);
  assert.ok(study, 'Requires a saved IEC temperature field');
  const sp = `${wp}/studies/${study.id}`, module = Object.keys(study.definition.modules)[0];
  const run = await api(`${sp}/runs/${study.latest_run_id}?view=full`); assert.equal(run.integrity, 'verified');
  study = await api(sp + '/upgrade-methods', 'POST', { expected_revision: savedWorkspace.revision, expected_study_revision: study.revision });
  const sectionId = savedWorkspace.domain.sections[0].id;
  // Preview compares exactly the saved input's operating conditions, not another sweep sample.
  const document = run.snapshot.cases[0].input;
  const body = { expected_revision: savedWorkspace.revision, expected_study_revision: study.revision, module };
  const before = await api(sp + '/runs?view=summary');
  const cold = performance.now(), initial = await api(sp + '/preview', 'POST', { ...body, domain: document });
  results.coldHostPreviewMs = performance.now() - cold;
  assert.equal(initial.status, 'succeeded'); assert.equal(initial.persisted, false);
  await fs.writeFile(path.join(output, 'cold-preview.json'), JSON.stringify(initial, null, 2));
  fixture = await createBrowserFixture({ software: true }); const { page } = fixture;
  await page.addInitScript(({ document: domain, run, sectionId, url, body }) => {
    window.cadPreviewCalls = []; window.cadPreviewResponses = []; window.cadPreviewFailure = ''; window.cadPreviewHold = false;
    document.addEventListener('pointerup', () => { window.cadPreviewRelease = performance.now(); window.cadPreviewPaintMs = undefined; }, true);
    const observe = () => new MutationObserver(() => {
      if (window.cadPreviewPaintMs === undefined && window.cadPreviewRelease && document.querySelector('[data-what-if-state=success]') && document.querySelector('[data-cad-field-ready=true]')) {
        window.cadPreviewPaintMs = performance.now() - window.cadPreviewRelease;
      }
    }).observe(document.documentElement, { subtree: true, attributes: true, childList: true });
    if (document.documentElement) observe(); else document.addEventListener('DOMContentLoaded', observe, { once: true });
    window.cadWhatIfFixture = { document: domain, run, sectionId, preview: async document => {
      window.cadPreviewCalls.push(document);
      while (window.cadPreviewHold) await new Promise(resolve => setTimeout(resolve, 10));
      if (window.cadPreviewFailure) throw Error(window.cadPreviewFailure);
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, domain: document }), signal: AbortSignal.timeout(9000) });
      const value = await response.json(); if (!response.ok) throw Error(value.detail?.message || JSON.stringify(value.detail));
      window.cadPreviewResponses.push(value); return value;
    } };
  }, { document, run, sectionId, url: sp + '/preview', body });
  await page.route('**/api/**', async route => {
    assert.equal(route.request().method(), 'POST'); assert.equal(new URL(route.request().url()).pathname, sp + '/preview');
    const response = await fetch(backend + sp + '/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: route.request().postData(), signal: AbortSignal.timeout(9000) });
    await route.fulfill({ status: response.status, contentType: 'application/json', body: Buffer.from(await response.arrayBuffer()) });
  });
  const cable = document.sections[0].placements[0];
  for (const kind of ['section', 'scene']) {
    await navigate(fixture, 'cad-what-if', { kind });
    if (kind === 'scene') {
      await page.locator('[data-cad-ready=true]').waitFor();
      const diagnostic = await page.locator('.cad-canvas-host canvas').evaluate(n => ({ renderer: n.dataset.webglRenderer, colors: Number(n.dataset.webglColors) }));
      assert.match(diagnostic.renderer, /SwiftShader/i); assert.ok(diagnostic.colors > 8); results.renderer = diagnostic;
    }
    await page.getByRole('button', { name: '试算模式', exact: true }).click();
    if (kind === 'scene') {
      await page.getByRole('button', { name: '端面', exact: true }).click(); await page.locator('.cad-viewport[data-cad-view=end]').waitFor();
      const circuit = document.circuits.find(c => c.cables.some(v => v.id === cable.cable));
      const core = document.cable_types.find(t => t.id === circuit.cable_type).cores[0];
      const p = await page.evaluate(([x, z]) => window.canvasGallery.whatIf.project(x, z), [cable.x + (core.x || 0), cable.z + (core.z || 0)]);
      const box = await page.locator('.cad-canvas-host').boundingBox();
      await page.mouse.move(box.x + p.x, box.y + p.y); await page.mouse.down(); await page.waitForTimeout(80);
      await page.mouse.move(box.x + p.x - 25, box.y + p.y, { steps: 6 });
    } else {
      const target = page.locator(`[data-drawing-canvas=laying] [data-section-object="cable/${cable.cable}"] .drawing-hit-area`);
      const b = await target.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 - 25, b.y + b.height / 2, { steps: 6 });
    }
    await page.mouse.up();
    await page.waitForFunction(() => window.cadPreviewPaintMs !== undefined, undefined, { timeout: 15000 });
    const elapsedMs = await page.evaluate(() => window.cadPreviewPaintMs);
    console.log(JSON.stringify({ kind, elapsedMs, hostMs: await page.evaluate(() => window.cadPreviewResponses.at(-1)?.elapsed_ms) }));
    assert.ok(elapsedMs <= 2000, `${kind}: release-to-temperature ${elapsedMs} ms`);
    const calls = await page.evaluate(() => window.cadPreviewCalls); assert.equal(calls.length, 1, `${kind}: one preview per completed gesture`);
    const next = calls[0].sections[0], current = next.placements.find(p => p.cable === cable.cable);
    assert.ok(current.x < cable.x); assert.ok(Math.abs(current.z - cable.z) < 1e-10, `${kind}: horizontal motion must preserve depth`);
    const originalPipe = document.sections[0].enclosures.find(e => e.id === cable.enclosure), movedPipe = next.enclosures.find(e => e.id === cable.enclosure);
    assert.ok(Math.abs((movedPipe.x - originalPipe.x) - (current.x - cable.x)) < 1e-10);
    const response = await page.evaluate(() => window.cadPreviewResponses.at(-1));
    assert.equal(response.persisted, false); assert.equal(response.engineering_approval, false); assert.equal(response.artifact_status.preview['x-cablesim.temperature-field'].status, 'verified');
    if (kind === 'scene') assert.equal(await page.locator('.cad-result-status').count(), 0, 'The trial toolbar owns the unsaved status once');
    await expect(page.locator('[data-what-if-delta]').first()).toContainText(/[-+]\d+\.\d K/);
    await page.getByRole('button', { name: '把这个布置写成方案', exact: true }).click();
    const probe = await page.evaluate(() => window.canvasGallery.whatIf.snapshot()); assert.equal(probe.proposals.length, 1);
    assert.ok(probe.proposals[0].every(c => c.unit === 'm' && c.previousValue !== c.value && c.path.startsWith('/sections/')));
    assert.equal(probe.proposals[0].length, 2, 'Cable and its duct each have one changed x field');
    const depth = page.getByRole('spinbutton', { name: '中心埋深 m', exact: true });
    await depth.fill('0'); await depth.press('Enter'); await expect(depth).toHaveAttribute('aria-invalid', 'true'); assert.equal((await page.evaluate(() => window.cadPreviewCalls)).length, 1);
    await depth.press('Escape');
    await depth.fill(String(-cable.z + .03)); await depth.press('Enter'); await page.locator('[data-what-if-state=success]').waitFor();
    assert.equal((await page.evaluate(() => window.cadPreviewCalls)).length, 2);
    await page.screenshot({ path: path.join(output, `what-if-${kind}.png`) });
    if (kind === 'section') {
      const overlap = await page.locator('[data-drawing-canvas=laying]').evaluate(root => {
        const labels = [...root.querySelectorAll('[data-section-object^="cable/"] > text,[data-section-object^="enclosure/"] > text')];
        return labels.some((a, i) => labels.slice(i + 1).some(b => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return Math.min(x.right, y.right) > Math.max(x.left, y.left) + 1 && Math.min(x.bottom, y.bottom) > Math.max(x.top, y.top) + 1; }));
      });
      assert.equal(overlap, false, 'Crowded object names remain available in titles rather than overlapping the thermal annotations');
    }
    await fs.writeFile(path.join(output, `preview-${kind}.json`), JSON.stringify({ input: calls[0], response, changes: probe.proposals[0] }, null, 2));
    results.interactions.push({ kind, elapsedMs, changes: probe.proposals[0] });
    // UI error/unsupported states never create fake results; retry uses real host.
    await page.evaluate(() => { window.cadPreviewFailure = 'PREVIEW_NOT_SUPPORTED：当前插件不支持快速试算'; });
    await depth.fill(String(-cable.z + .06)); await depth.press('Enter'); await page.locator('[data-what-if-state=error]').waitFor();
    await expect(page.locator('.what-if-status')).toContainText('PREVIEW_NOT_SUPPORTED'); assert.equal(await page.locator('[data-field-kind]').count(), 0);
    await layout(page, `${kind} unsupported`);
    await page.evaluate(() => { window.cadPreviewFailure = ''; window.cadPreviewHold = true; });
    await page.getByRole('button', { name: '重试试算', exact: true }).click(); await page.locator('[data-what-if-state=pending]').waitFor(); await layout(page, `${kind} pending`);
    await page.evaluate(() => { window.cadPreviewHold = false; }); await page.locator('[data-what-if-state=success]').waitFor();
    for (const size of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize(size); await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      for (const state of ['success', 'loading', 'error', 'historical', 'empty']) {
        await page.evaluate(state => window.canvasGallery.setState(state), state); await page.waitForTimeout(60);
        await layout(page, `${kind} ${size.width} ${theme} ${state}`);
      }
    }
    await page.setViewportSize({ width: 1366, height: 768 });
  }
  const after = await api(sp + '/runs?view=summary'); assert.deepEqual(after.items.map(r => r.id), before.items.map(r => r.id));
  assert.equal((await api(wp)).revision, savedWorkspace.revision); assert.equal((await api(sp)).revision, study.revision);
  assert.deepEqual(fixture.errors, []); assert.deepEqual(fixture.external, []); results.passed = true;
} catch (error) { if (fixture) console.error(await fixture.page.locator('body').innerText()); console.error(log.slice(-2000)); throw error; }
finally {
  await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify(results, null, 2));
  if (fixture) await fixture.close();
  if (backend && host.exitCode === null) await fetch(backend + '/__cad_test/close', { method: 'POST' }).catch(() => {});
  for (let i = 0; host.exitCode === null && i < 80; i++) await pause(100);
  if (host.exitCode === null) { host.kill(); throw Error('Private preview host failed to stop; scratch retained for inspection'); }
  assert.ok(path.resolve(scratch).startsWith(path.resolve(repositoryRoot, '.tmp/cad-what-if') + path.sep));
  await fs.rm(scratch, { recursive: true, force: true }); console.log('私有试算服务已退出，临时库已清理');
}
console.log(JSON.stringify({ passed: results.passed, coldHostPreviewMs: results.coldHostPreviewMs, interactions: results.interactions, layouts: results.layouts.length, renderer: results.renderer }));
