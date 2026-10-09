import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createBrowserFixture, navigate, repositoryRoot, drag } from './browser-fixture.mjs';

const base = process.env.CAD_BACKEND_URL || 'http://127.0.0.1:8100';
const output = path.join(repositoryRoot, '.data/cad-composition'); await fs.mkdir(output, { recursive: true });
const get = async p => { const r = await fetch(base + p); assert.ok(r.ok, p); return r.json(); };
const workspaces = await get('/api/workspaces'), documents = {}, annotations = {}, sources = {};
const selectedKinds = new Set((process.env.CAD_COMPOSITION_KINDS || 'trefoil,duct,single,three').split(','));
for (const [kind, match] of Object.entries({ trefoil: /110 kV 直埋/, duct: /三回排管/, single: /1×800/, three: /3×300/ }).filter(([kind]) => selectedKinds.has(kind))) {
  const w = workspaces.find(w => match.test(w.name)); assert.ok(w, kind);
  const wp = `/api/workspaces/${w.id}`, state = await get(wp); documents[kind] = state.domain;
  if (kind === 'trefoil' || kind === 'duct') {
    const study = (await get(wp + '/studies')).find(s => s.definition.method.plugin_id === 'cablesim.iec60287' && s.latest_run_id);
    if (study) {
      const run = await get(`${wp}/studies/${study.id}/runs/${study.latest_run_id}?view=full`);
      assert.equal(run.integrity, 'verified');
      const c = run.output.cases.find(c => c.results.some(r => r.key === 'conductor_temperature' && r.status === 'available'));
      const frozen = run.snapshot.cases.find(v => v.case_id === c?.case_id)?.input;
      if (c && frozen?.schema_version === 'cablesim.domain/1') {
        documents[kind] = frozen;
        const rows = c.results.filter(r => r.key === 'conductor_temperature' && r.unit === 'K' && r.status === 'available' && (r.case === 'operating' || r.case === undefined));
        const maximum = Math.max(...rows.map(r => r.value));
        annotations[kind] = Object.fromEntries(rows.map(r => [r.entity, { label: `${(r.value - 273.15).toFixed(1)} °C`, limiting: r.value === maximum }]));
        sources[kind] = { workspace: w.id, study: study.id, run: run.id, case: c.case_id };
      }
    }
  }
}
if (process.env.CAD_COMPOSITION_PRODUCTION !== 'only') {
const fixture = await createBrowserFixture(), { page } = fixture, results = { layouts: [], sources };
try {
  await page.addInitScript(({ documents, annotations }) => { window.cadCompositionDocuments = documents; window.cadCompositionAnnotations = annotations; }, { documents, annotations });
  for (const kind of ['trefoil', 'duct', 'single', 'three'].filter(kind => selectedKinds.has(kind))) {
    await navigate(fixture, 'composition', { kind });
    for (const size of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize(size); await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      for (const state of ['success', 'historical', 'loading', 'empty', 'error']) {
        await page.evaluate(state => window.canvasGallery.setState(state), state); await page.waitForTimeout(80);
        const result = await page.locator('[data-gallery-entry=composition]').evaluate(root => {
          const stage = root.querySelector('.drawing-stage').getBoundingClientRect();
          const targets = [...root.querySelectorAll('.drawing-layer-name,[data-layer-number] > circle:not(.drawing-layer-anchor),.drawing-object-label text,button')].filter(n => n.getBoundingClientRect().width);
          const boxes = targets.map(n => ({ node: n, b: n.getBoundingClientRect() }));
          const overlaps = boxes.some(({ b }, i) => boxes.slice(i + 1).some(({ b: c }) => Math.min(b.right, c.right) > Math.max(b.left, c.left) + 1 && Math.min(b.bottom, c.bottom) > Math.max(b.top, c.top) + 1));
          const overflow = boxes.some(({ b }) => b.left < 0 || b.top < 0 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1);
          const font = Math.min(...targets.map(n => parseFloat(getComputedStyle(n).fontSize)));
          const luminance = s => s.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
          const panel = luminance(getComputedStyle(root.querySelector('.drawing-frame')).backgroundColor);
          const contrast = targets.filter(n => !n.closest('[disabled]') && n.tagName.toLowerCase() !== 'circle').map(n => {
            const color = luminance(getComputedStyle(n)[n.tagName.toLowerCase() === 'text' ? 'fill' : 'color']);
            return (Math.max(color, panel) + .05) / (Math.min(color, panel) + .05);
          });
          const labelOutside = boxes.filter(({ node }) => node.closest('svg')).some(({ b }) => b.left < stage.left - 1 || b.right > stage.right + 1 || b.top < stage.top - 1 || b.bottom > stage.bottom + 1);
          const numbers = [...root.querySelectorAll('[data-layer-number]')].map(n => Number(n.dataset.layerNumber));
          const lines = [...root.querySelectorAll('[data-layer-leader]')].map(n => {
            const v = n.getAttribute('d').match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/ig).map(Number);
            return [[[v[0], v[1]], [v[2], v[3]]], [[v[2], v[3]], [v[4], v[3]]]];
          });
          const crosses = ([a, b], [c, d]) => {
            const u = [b[0] - a[0], b[1] - a[1]], v = [d[0] - c[0], d[1] - c[1]], w = [c[0] - a[0], c[1] - a[1]];
            const det = u[0] * v[1] - u[1] * v[0]; if (Math.abs(det) < 1e-8) return false;
            const t = (w[0] * v[1] - w[1] * v[0]) / det, s = (w[0] * u[1] - w[1] * u[0]) / det;
            return t > 1e-7 && t < 1 - 1e-7 && s > 1e-7 && s < 1 - 1e-7;
          };
          const leadersCross = lines.some((a, i) => lines.slice(i + 1).some(b => a.some(s => b.some(t => crosses(s, t)))));
          return { overlaps, overflow, labelOutside, leadersCross, font, contrast: Math.min(...contrast), numbers };
        });
        const label = `${kind} ${size.width} ${theme} ${state}`;
        assert.equal(result.overlaps, false, label); assert.equal(result.overflow, false, label); assert.equal(result.labelOutside, false, label);
        assert.equal(result.leadersCross, false, `${label}: layer leaders cross`);
        assert.ok(result.font >= 13, label); assert.ok(result.contrast >= 4.48, label);
        if (state !== 'empty' && state !== 'error') {
          if (kind === 'single' || kind === 'three') {
            const type = documents[kind].cable_types[0], count = type.cores[0].layers.length + 1 + type.common_layers.length;
            assert.equal(result.numbers.length, count, label); assert.deepEqual(result.numbers, [...result.numbers].sort((a, b) => a - b));
            if (kind === 'three') await expect(page.locator('[data-core-equivalence]')).toContainText('芯 2、芯 3 同芯 1');
          } else {
            await expect(page.locator('[data-section-detail=A]')).toHaveCount(1);
            const diameters = await page.locator('[data-section-detail=A] .drawing-cable-shapes').evaluateAll(nodes => nodes.map(n => { const b = n.getBBox(); return b.width; }));
            assert.ok(Math.min(...diameters) >= 24, `${label}: minimum cable diameter ${Math.min(...diameters)}`);
            assert.equal(await page.locator('.drawing-object-label:not([data-result-label])').count(), documents[kind].sections[0].placements.length + (documents[kind].sections[0].enclosures || []).length, label);
            if (kind === 'trefoil' && ['success', 'historical'].includes(state)) {
              assert.equal(Object.keys(annotations[kind] || {}).length, 3, 'Need three temperatures from a verified saved run');
              await expect(page.locator('[data-result-label]')).toHaveCount(3);
            }
          }
        }
        results.layouts.push({ label, ...result });
      }
    }
    await page.setViewportSize({ width: 1366, height: 768 }); await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; window.canvasGallery.setState('success'); });
    if (process.env.CAD_COMPOSITION_PRODUCTION !== '1') await page.screenshot({ path: path.join(output, `${kind}.png`) });
    if (kind === 'three') {
      await page.locator('[data-gallery-entry=composition]').evaluate(n => { n.dataset.height = 'compact'; });
      await expect(page.locator('[data-label-column=left]')).not.toHaveCount(0); await expect(page.locator('[data-label-column=right]')).not.toHaveCount(0);
      assert.equal(await page.locator('[data-layer-number]').count(), documents.three.cable_types[0].cores[0].layers.length + 1 + documents.three.cable_types[0].common_layers.length);
      await page.locator('[data-gallery-entry=composition]').evaluate(n => { delete n.dataset.height; });
    }
    if (kind === 'trefoil' || kind === 'duct') {
      const count = await page.locator('[data-result-label]').count();
      assert.equal(count, Object.keys(annotations[kind] || {}).length);
      if (count) { await page.getByRole('button', { name: '图上显示', exact: true }).click(); assert.equal(await page.locator('[data-result-label]').count(), 0); await page.getByRole('button', { name: '图上显示', exact: true }).click(); }
      await page.getByRole('button', { name: '放大敷设截面', exact: true }).click(); await expect(page.locator('[data-section-detail]')).toHaveCount(0);
      await page.getByRole('button', { name: '适配敷设截面 F', exact: true }).click(); await expect(page.locator('[data-section-detail]')).toHaveCount(1);
      const target = page.locator('[data-section-detail] .drawing-hit-area').first(); await target.click(); await expect(page.locator('[data-section-dimension=depth]')).toHaveAttribute('role', 'button');
      await drag(page, target, kind === 'duct' ? -10 : 0, kind === 'trefoil' ? -10 : 0); assert.equal(await page.getByRole('alert').count(), 0, 'Detail drag remains in source SI geometry');
    }
  }
  assert.deepEqual(fixture.errors, []); assert.deepEqual(fixture.external, []); results.passed = true;
} finally { await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify(results, null, 2)); await fixture.close(); }
console.log(JSON.stringify({ passed: results.passed, layouts: results.layouts.length, sources }));
}

// Optional full application check uses the current build and GET-only proxy.
// It never saves engineering inputs or starts a calculation on the shared demo.
if (['1', 'only'].includes(process.env.CAD_COMPOSITION_PRODUCTION)) {
  const live = await createBrowserFixture({ production: true, backend: base }), pages = [];
  try {
    const targets = ['trefoil', 'duct'].filter(kind => selectedKinds.has(kind)).map(kind => ({ kind, route: `/studies/${sources[kind].study}/sweep/curve?workspace=${sources[kind].workspace}&view=section&run=${sources[kind].run}`, canvas: '[data-drawing-canvas=laying]' }));
    if (selectedKinds.has('trefoil')) targets.push({ kind: 'home', route: `/studies?workspace=${sources.trefoil.workspace}`, canvas: '[data-drawing-canvas=laying]' });
    for (const kind of ['single', 'three'].filter(kind => selectedKinds.has(kind))) targets.push({ kind, route: `/types/${workspaces.find(w => (kind === 'single' ? /1×800/ : /3×300/).test(w.name)).id}/structure/section`, canvas: '[data-drawing-canvas=cable]' });
    for (const target of targets) {
      await live.page.goto(live.url + target.route, { waitUntil: 'domcontentloaded' });
      await live.page.locator(target.canvas).waitFor({ state: 'attached' });
      const expand = live.page.getByRole('button', { name: '展开侧栏（Ctrl+B）', exact: true });
      if (await expand.isVisible()) { await expand.click(); await live.page.waitForTimeout(250); }
      const restore = live.page.getByRole('button', { name: '还原结果面板', exact: true });
      if (await restore.isVisible()) await restore.click();
      await live.page.locator(target.canvas).waitFor(); await live.page.evaluate(() => document.fonts.ready);
      for (const size of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) for (const theme of ['light', 'dark']) {
        await live.page.setViewportSize(size); await live.page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme); await live.page.waitForTimeout(120);
        const metrics = await live.page.locator(target.canvas).evaluate(svg => {
          const frame = svg.closest('.drawing-frame'), stage = svg.closest('.workbench-canvas').getBoundingClientRect();
          const labels = [...svg.querySelectorAll('.drawing-object-label text,.drawing-layer-name,[data-layer-number] > circle:not(.drawing-layer-anchor),[data-core-equivalence]')];
          const controls = [...frame.querySelectorAll('.drawing-toolbar button,.drawing-toolbar [role=combobox]'), ...svg.closest('.workbench-canvas').querySelectorAll('.workbench-views button')];
          const b = [...labels, ...controls].filter(n => n.getBoundingClientRect().width).map(n => ({ n, r: n.getBoundingClientRect() }));
          const overlap = b.some(({ r }, i) => b.slice(i + 1).some(({ r: s }) => Math.min(r.right, s.right) > Math.max(r.left, s.left) + 1 && Math.min(r.bottom, s.bottom) > Math.max(r.top, s.top) + 1));
          const outside = b.some(({ n, r }) => r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1 || n.closest('svg') && (r.left < stage.left - 1 || r.right > stage.right + 1 || r.top < stage.top - 1 || r.bottom > stage.bottom + 1));
          const diameter = Math.min(...[...svg.querySelectorAll('[data-section-detail] .drawing-cable-shapes')].map(n => n.getBBox().width));
          return { overlap, outside, diameter: Number.isFinite(diameter) ? diameter : null, labels: labels.length };
        });
        const label = `${target.kind} ${size.width} ${theme}`; assert.equal(metrics.overlap, false, label); assert.equal(metrics.outside, false, label);
        if (metrics.diameter !== null) assert.ok(metrics.diameter >= 24, label);
        if (target.kind === 'trefoil') await expect(live.page.locator('[data-result-label]')).toHaveCount(3);
        if (['single', 'three'].includes(target.kind)) assert.equal((metrics.labels - (target.kind === 'three' ? 1 : 0)) / 2, documents[target.kind].cable_types[0].cores[0].layers.length + 1 + documents[target.kind].cable_types[0].common_layers.length, label);
        pages.push({ label, ...metrics });
      }
      await live.page.setViewportSize({ width: 1366, height: 768 }); await live.page.evaluate(() => { document.documentElement.dataset.theme = 'light'; }); await live.page.waitForTimeout(120);
      await live.page.screenshot({ path: path.join(output, `${target.kind}-page.png`) });
      if (target.kind === 'three') {
        await live.page.setViewportSize({ width: 1440, height: 900 });
        const header = live.page.locator('table[aria-label="型号分层"] th').last(); await expect(header).toHaveText('来源');
        assert.equal(await header.evaluate(n => { const a = n.getBoundingClientRect(), b = n.closest('.table-scroll').getBoundingClientRect(); return n.scrollWidth > n.clientWidth || a.right > b.right + 1 || a.left < b.left - 1; }), false, '1440 px source column entirely visible');
      }
    }
    assert.deepEqual(live.errors, []); assert.deepEqual(live.external, []);
  } finally { await fs.writeFile(path.join(output, 'page-results.json'), JSON.stringify(pages, null, 2)); await live.close(); }
  console.log(JSON.stringify({ productionPages: pages.length, passed: true }));
}
