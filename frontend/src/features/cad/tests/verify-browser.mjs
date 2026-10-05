import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { createBrowserFixture, drag, editNumber, navigate, outputRoot, selectOption, snapshot } from './browser-fixture.mjs';

const fixture = await createBrowserFixture();
const result = { workflow: [], layouts: [], performance: [], screenshots: [], errors: [], external: [] };
const screenshots = path.join(outputRoot, 'screenshots');
await fs.mkdir(screenshots, { recursive: true });

async function ready(entry, scene = false) {
  if (entry === 'cad') {
    await fixture.page.waitForFunction(() => window.canvasGallery?.cad?.snapshot().timings.length > 0);
    if (scene && !(await snapshot(fixture.page, 'cad')).info.scene) await fixture.page.getByRole('button', { name: '敷设场景', exact: true }).click();
    else if (!scene) await fixture.page.getByRole('button', { name: '精细替换', exact: true }).click();
    await expect(fixture.page.locator('.cad-viewport')).toHaveAttribute('aria-busy', 'false');
    const data = await snapshot(fixture.page, 'cad');
    const actual = scene ? data.timings.filter(timing => timing.schema === 'cablesim.cad-scene/1') : data.timings;
    assert.ok(actual.every(timing => timing.elapsedMs < 3000));
    result.performance.push(...actual.map(timing => ({ ...timing, surface: scene ? 'scene' : 'single' })));
  } else if (entry === 'cable-section') {
    await fixture.page.locator('[data-layer-number="3"] circle').click();
  } else {
    await fixture.page.locator('[data-section-object="cable/cable/A"] .drawing-hit-area').click();
  }
  await fixture.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function checkLayout(surface, theme, width, height, scale) {
  const layout = await fixture.page.evaluate(() => {
    const main = document.querySelector('.main-content');
    const graphic = document.querySelector('.cad-canvas-host canvas,svg[data-drawing-canvas]');
    const rectangle = graphic.getBoundingClientRect();
    const controls = [...document.querySelectorAll('.drawing-toolbar button,.drawing-object-tools button,.canvas-gallery-controls button,.cad-tools button')];
    const visible = controls.filter(element => element.getBoundingClientRect().width > 0);
    const overflow = visible.filter(element => {
      const box = element.getBoundingClientRect();
      return box.left < main.getBoundingClientRect().left - 1 || box.right > main.getBoundingClientRect().right + 1;
    });
    const undersized = [...document.querySelectorAll('.drawing-frame text,.cad-viewport text,.drawing-status,.cad-status')]
      .filter(element => parseFloat(getComputedStyle(element).fontSize) < 13).map(element => element.textContent);
    return { width: innerWidth, height: innerHeight, devicePixelRatio,
      documentOverflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      mainHorizontalOverflow: main.scrollWidth > main.clientWidth,
      graphic: { width: rectangle.width, height: rectangle.height }, controlOverflow: overflow.map(element => element.getAttribute('aria-label') || element.textContent), undersized };
  });
  assert.equal(layout.documentOverflow, false, `${surface}/${theme}/${width}/${scale}: document overflow`);
  assert.equal(layout.mainHorizontalOverflow, false, `${surface}: main overflow`);
  assert.deepEqual(layout.controlOverflow, [], `${surface}: toolbar overflow`);
  assert.deepEqual(layout.undersized, [], `${surface}: text below 13 px`);
  assert.ok(layout.graphic.width > 200 && layout.graphic.height >= 300, `${surface}: visible graphic`);
  result.layouts.push({ surface, theme, physicalWidth: width, physicalHeight: height, scale, kind: 'CDP emulation; Windows DPI is unverified', ...layout });
}

try {
  const { page } = fixture;
  await navigate(fixture, 'cad'); await ready('cad');
  await page.getByRole('button', { name: '等轴视图', exact: true }).click();
  await page.getByRole('button', { name: '剖面', exact: true }).click();
  const cut = page.getByRole('slider', { name: '轴向剖切位置' });
  await cut.focus(); await page.keyboard.press('ArrowRight');
  await expect(cut).toHaveAttribute('aria-valuenow', '60');
  result.workflow.push('CAD: fine replacement, standard cube view and keyboard axial cut');
  const priorInput = (await snapshot(page, 'cad')).info.input_sha256;
  await page.evaluate(() => window.canvasGallery.cad.replace('changed'));
  await page.waitForFunction(prior => window.canvasGallery.cad.snapshot().info.input_sha256 !== prior, priorInput);
  await expect(page.locator('.cad-viewport')).toHaveAttribute('aria-busy', 'false');
  const updated = await snapshot(page, 'cad');
  assert.notEqual(updated.info.input_sha256, priorInput);
  assert.equal(updated.timings.at(-1).inputSha256, updated.info.input_sha256);
  result.performance.push({ ...updated.timings.at(-1), surface: 'single-update' });
  assert.ok(updated.timings.at(-1).elapsedMs < 3000);

  await page.getByRole('button', { name: '电缆截面图', exact: true }).click();
  await page.locator('[data-layer-number="3"] circle').click();
  await editNumber(page, page.locator('[data-dimension-trigger="cable"]'), 4.5);
  await expect(page.locator('.drawing-dimension-editor')).toHaveCount(0);
  assert.equal((await snapshot(page, 'cable')).document.cable_types[0].common_layers[1].thickness, .0045);
  result.workflow.push('CableSection: layer selection, 4.5 mm edit and SI callback');

  await page.getByRole('button', { name: '敷设截面编辑器', exact: true }).click();
  await selectOption(page, '模板', '回填'); await page.getByRole('button', { name: '应用模板', exact: true }).click();
  const region = page.getByRole('button', { name: '选择回填区 backfill/1', exact: true });
  await region.focus(); await page.keyboard.press('Enter');
  const beforeResize = await snapshot(page, 'laying');
  await drag(page, page.locator('[data-resize-handle="width"]'), 20, 0);
  await page.waitForFunction(() => window.canvasGallery.laying.snapshot().edits.some(edit => edit.kind === 'resize'));
  const resized = await snapshot(page, 'laying');
  assert.ok(resized.document.sections[0].backfill.width > beforeResize.document.sections[0].backfill.width);
  await page.getByRole('button', { name: '撤销 Ctrl+Z', exact: true }).click();
  assert.equal((await snapshot(page, 'laying')).document.sections[0].backfill.width, beforeResize.document.sections[0].backfill.width);
  await page.getByRole('button', { name: '选择土壤层 soil/upper', exact: true }).focus(); await page.keyboard.press('Enter');
  await editNumber(page, page.locator('[data-section-dimension="bottom_z"]'), .55);
  await expect(page.locator('.drawing-dimension-editor')).toHaveCount(0);
  const soil = (await snapshot(page, 'laying')).document.sections[0].soil_layers;
  assert.equal(soil[0].bottom_z, -.55); assert.equal(soil[1].top_z, -.55);
  await page.locator('[data-section-overview]').focus(); await page.keyboard.press('Enter');
  await page.locator('[data-drawing-canvas="laying"]').focus(); await page.keyboard.press('Control+s');
  assert.ok((await snapshot(page, 'laying')).commands.includes('save'));
  result.workflow.push('LayingSection: template, backfill resize, page undo, connected soil dimension, overview and save callback');

  const cdp = await fixture.context.newCDPSession(page);
  for (const scale of [1, 1.25, 1.5]) for (const [width, height] of [[1366, 768], [1920, 1080]]) {
    for (const theme of ['light', 'dark']) for (const surface of ['cad', 'scene', 'cable-section', 'laying-section']) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.floor(width / scale), height: Math.floor(height / scale),
        deviceScaleFactor: scale, mobile: false });
      const entry = surface === 'scene' ? 'cad' : surface;
      await navigate(fixture, entry, { theme, kind: surface === 'scene' ? 'scene' : undefined }); await ready(entry, surface === 'scene');
      await checkLayout(surface, theme, width, height, scale);
      const file = path.join(screenshots, `${surface}-${theme}-${width}-scale-${Math.round(scale * 100)}.png`);
      const captured = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      const bytes = Buffer.from(captured.data, 'base64');
      assert.ok(Math.abs(bytes.readUInt32BE(16) - Math.floor(width / scale) * scale) <= 1);
      assert.ok(Math.abs(bytes.readUInt32BE(20) - Math.floor(height / scale) * scale) <= 1);
      assert.equal(await page.evaluate(() => innerWidth), Math.floor(width / scale));
      await fs.writeFile(file, bytes); result.screenshots.push(file);
    }
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const entry of ['cad', 'cable-section', 'laying-section']) {
    await navigate(fixture, entry); await ready(entry);
    const layout = await page.evaluate(() => ({ document: document.documentElement.scrollWidth > innerWidth,
      main: document.querySelector('.main-content').scrollWidth > document.querySelector('.main-content').clientWidth }));
    assert.deepEqual(layout, { document: false, main: false });
    if (entry === 'laying-section') {
      const collision = await page.evaluate(() => {
        const overview = document.querySelector('.drawing-overview').getBoundingClientRect();
        return [...document.querySelectorAll('[data-section-dimension]')].some(element => {
          const box = element.getBoundingClientRect();
          return box.left < overview.right && box.right > overview.left && box.top < overview.bottom && box.bottom > overview.top;
        });
      });
      assert.equal(collision, false, '窄画布缩略窗不得遮住尺寸触发器。');
      await editNumber(page, page.locator('[data-section-dimension="depth"]'), .76);
      await expect(page.locator('.drawing-dimension-editor')).toHaveCount(0);
      assert.equal((await snapshot(page, 'laying')).document.sections[0].placements[0].z, -.76);
    }
    const file = path.join(screenshots, `${entry}-light-390.png`);
    await page.screenshot({ path: file, fullPage: true }); result.screenshots.push(file);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await navigate(fixture, 'cad'); await ready('cad');
  await page.getByRole('button', { name: '端面', exact: true }).click();
  await expect(page.locator('.cad-viewport')).toHaveAttribute('data-cad-view', 'end');
  result.workflow.push('Reduced motion: standard view switches directly to its final pose');
  assert.deepEqual(fixture.errors, []); assert.deepEqual(fixture.external, []);
  assert.ok(!fixture.requests.some(url => new URL(url).pathname.startsWith('/api/')));
  result.errors = fixture.errors; result.external = fixture.external;
  await fs.writeFile(path.join(outputRoot, 'browser-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ workflow: result.workflow, checkedLayouts: result.layouts.length, screenshots: result.screenshots.length,
    singleUpdateMs: updated.timings.at(-1).elapsedMs, errors: result.errors, external: result.external }));
} finally { await fixture.close(); }
