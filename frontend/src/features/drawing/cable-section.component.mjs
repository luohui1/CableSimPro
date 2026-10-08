import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { editNumber, snapshot } from '../cad/tests/browser-fixture.mjs';

export async function verifyCableSection(page) {
  const component = page.locator('[data-gallery-entry="cable-section"] .cable-section');
  await expect(component.locator('[data-layer-number]')).toHaveCount(6);
  await expect(component.locator('[data-cable-dimensions]')).toHaveCount(0);
  await component.locator('[data-layer-number="3"] circle:not(.drawing-layer-anchor)').click();
  const trigger = component.locator('[data-dimension-trigger="cable"]');
  await expect(trigger).toBeVisible();
  await editNumber(page, trigger, 5);
  await expect(page.locator('.drawing-dimension-editor')).toHaveCount(0);
  let data = await snapshot(page, 'cable');
  assert.equal(data.edits.length, 1); assert.equal(data.edits[0].valueM, .005);
  assert.equal(data.document.cable_types[0].common_layers[1].thickness, .005);
  await page.evaluate(() => window.canvasGallery.cable.fail(true));
  await editNumber(page, trigger, 6);
  await expect(page.locator('.drawing-dimension-editor')).toContainText('演示提交失败');
  assert.equal((await snapshot(page, 'cable')).edits.length, 1);
  await expect(page.locator('.drawing-dimension-editor input')).toHaveValue('6');
  await page.keyboard.press('Escape');
  await expect(page.locator('.drawing-dimension-editor')).toHaveCount(0);
  await page.evaluate(() => window.canvasGallery.cable.fail(false));
  await page.evaluate(() => window.canvasGallery.cable.lock(true));
  await expect(trigger).not.toHaveAttribute('role', 'button');
  await page.evaluate(() => window.canvasGallery.cable.lock(false));
  await trigger.focus(); await page.keyboard.press('Enter');
  await page.locator('.drawing-dimension-editor input').fill('0'); await page.keyboard.press('Enter');
  await expect(page.locator('.drawing-dimension-editor')).toContainText('正尺寸');
  await page.keyboard.press('Escape');
  await component.locator('[data-drawing-canvas]').focus(); await page.keyboard.press('Control+s');
  assert.deepEqual((await snapshot(page, 'cable')).commands, ['save']);
  await page.evaluate(() => window.canvasGallery.cable.construction('three'));
  await expect(component.locator('[data-layer-id]')).toHaveCount(16);
  // Three cores are all drawn; the readable number column follows one selected core.
  await expect(component.locator('[data-layer-number]')).toHaveCount(6);
  for (const core of ['core/1', 'core/2', 'core/3']) {
    await component.locator(`[data-layer-id="${core}/conductor"]`).click({ force: true });
    await expect(component.locator(`[data-label-core="${core}"]`)).toHaveCount(5);
  }
  await component.locator('[data-layer-id="core/1/conductor"]').click({ force: true });
  assert.equal((await snapshot(page, 'cable')).document.cable_types[0].cores.length, 3);
  for (const state of ['empty', 'loading', 'error', 'historical', 'success']) {
    await page.evaluate(value => window.canvasGallery.setState(value), state);
    await expect(component).toHaveAttribute('data-cable-section-state', state);
    if (state === 'historical') {
      await component.locator('[data-layer-number="1"] circle:not(.drawing-layer-anchor)').click();
      await expect(component.locator('[data-dimension-trigger="cable"]')).not.toHaveAttribute('role', 'button');
    }
  }
  return { edits: (await snapshot(page, 'cable')).edits.length };
}
