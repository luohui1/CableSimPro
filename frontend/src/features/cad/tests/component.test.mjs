import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBrowserFixture, navigate, outputRoot } from './browser-fixture.mjs';
import { verifyCad } from './cad.component.mjs';
import { verifyCableSection } from '../../drawing/cable-section.component.mjs';
import { verifyLayingSection } from '../../drawing/laying-section.component.mjs';

test('controlled canvas components in the built React gallery', async context => {
  const fixture = await createBrowserFixture();
  const results = {};
  try {
    await context.test('CadViewport: selection, topology, rollback, scene, WASM reuse and unmount', { skip: !!process.env.CANVAS_COMPONENT && process.env.CANVAS_COMPONENT !== 'cad' }, async () => {
      await navigate(fixture, 'cad'); results.cad = await verifyCad(fixture.page);
    });
    await context.test('CableSection: scale, layer numbers, controlled dimension, errors and five states', { skip: !!process.env.CANVAS_COMPONENT && process.env.CANVAS_COMPONENT !== 'cable' }, async () => {
      await navigate(fixture, 'cable-section'); results.cable = await verifyCableSection(fixture.page);
    });
    await context.test('LayingSection: atomic drag, snapping, page undo, locks, templates and five states', { skip: !!process.env.CANVAS_COMPONENT && process.env.CANVAS_COMPONENT !== 'laying' }, async () => {
      await navigate(fixture, 'laying-section'); results.laying = await verifyLayingSection(fixture.page);
    });
    assert.deepEqual(fixture.errors, []); assert.deepEqual(fixture.external, []);
    assert.ok(!fixture.requests.some(url => new URL(url).pathname.startsWith('/api/')));
    await fs.mkdir(outputRoot, { recursive: true });
    await fs.writeFile(path.join(outputRoot, 'component-results.json'), JSON.stringify(results, null, 2));
  } finally { await fixture.close(); }
});
