import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { drag, editNumber, selectOption, snapshot } from '../cad/tests/browser-fixture.mjs';

export async function verifyLayingSection(page) {
  const component = page.locator('.laying-section');
  await expect(component.locator('[data-drawing-canvas="laying"] [data-section-object^="cable/"]')).toHaveCount(3);
  const cable = page.locator('[data-section-object="cable/cable/A"] .drawing-hit-area');
  await cable.click();
  const initial = await snapshot(page, 'laying');
  await expect(component.locator('[data-section-dimension="depth"]')).toBeVisible();
  await drag(page, cable, -25, 0);
  await page.waitForFunction(() => window.canvasGallery.laying.snapshot().edits.length === 1, undefined, { timeout: 5000 }).catch(async error => {
    const diagnostic = await snapshot(page, 'laying');
    throw new Error(`${error.message}; selection=${JSON.stringify(diagnostic.selection)}; alerts=${await component.getByRole('alert').allTextContents()}; placements=${JSON.stringify(diagnostic.document.sections[0].placements)}`);
  });
  let data = await snapshot(page, 'laying');
  assert.equal(data.edits.length, 1); assert.equal(data.edits[0].kind, 'move');
  const placement = data.document.sections[0].placements[0], duct = data.document.sections[0].enclosures[0];
  assert.equal(placement.x, duct.x); assert.equal(placement.z, duct.z);
  assert.notEqual(placement.x, initial.document.sections[0].placements[0].x);
  assert.ok(Math.abs(placement.x * 1000 - Math.round(placement.x * 1000)) < 1e-8);
  await component.locator('[data-drawing-canvas]').focus(); await page.keyboard.press('Control+z');
  await page.waitForFunction(() => window.canvasGallery.laying.snapshot().undo === 0);
  assert.deepEqual((await snapshot(page, 'laying')).document.sections[0], initial.document.sections[0]);
  await page.keyboard.press('Control+y');
  await page.waitForFunction(() => window.canvasGallery.laying.snapshot().undo === 1);
  await page.evaluate(() => window.canvasGallery.laying.lock('enclosures.duct/A.x'));
  await drag(page, cable, -25, 0);
  await expect(component.getByRole('alert')).toContainText('整组改动未应用');
  assert.equal((await snapshot(page, 'laying')).edits.length, 1);
  await page.evaluate(() => window.canvasGallery.laying.lock(null));
  await page.getByRole('button', { name: '管缆联动', exact: true }).click();
  await editNumber(page, page.locator('[data-section-dimension="depth"]'), .76);
  await expect(page.locator('.drawing-dimension-editor')).toHaveCount(0);
  data = await snapshot(page, 'laying'); assert.equal(data.document.sections[0].placements[0].z, -.76);
  await page.evaluate(() => window.canvasGallery.laying.fail(true));
  await editNumber(page, page.locator('[data-section-dimension="depth"]'), .77);
  await expect(page.locator('.drawing-dimension-editor')).toContainText('演示提交失败');
  assert.equal((await snapshot(page, 'laying')).document.sections[0].placements[0].z, -.76);
  await page.keyboard.press('Escape'); await page.evaluate(() => window.canvasGallery.laying.fail(false));
  for (const [label, count] of [['单回', 3], ['双回', 6], ['排管', 3], ['回填', 3], ['三芯', 1]]) {
    await selectOption(page, '模板', label); await page.getByRole('button', { name: '应用模板', exact: true }).click();
    await expect(component.locator('[data-drawing-canvas="laying"] [data-section-object^="cable/"]')).toHaveCount(count);
  }
  await component.locator('[data-drawing-canvas]').focus(); await page.keyboard.press('Control+s');
  assert.ok((await snapshot(page, 'laying')).commands.includes('save'));
  await expect(component.locator('[data-section-overview]')).toBeVisible();
  for (const state of ['empty', 'loading', 'error', 'historical', 'success']) {
    await page.evaluate(value => window.canvasGallery.setState(value), state);
    await expect(component).toHaveAttribute('data-laying-section-state', state);
    if (state === 'historical') await expect(page.getByRole('button', { name: '应用模板', exact: true })).toBeDisabled();
  }
  return { edits: (await snapshot(page, 'laying')).edits.length, templates: (await snapshot(page, 'laying')).templates };
}
