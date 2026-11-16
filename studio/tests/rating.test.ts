// What the rating workbench asks of the host before a project exists: the starting point of a new project for one cable.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { RatingStart } from '../shared/rating-types.ts';
import type { LibraryEntry, ProjectView } from '../shared/types.ts';
import { type App, createApp } from '../host/server.ts';

const home = mkdtempSync(join(tmpdir(), 'cable-studio-rating-'));
let app: App;
let base: string;

before(async () => {
  app = createApp({ home, runtime: null });
  await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

after(async () => {
  await app.close();
  rmSync(home, { recursive: true, force: true });
});

async function op<T>(id: string, params: unknown): Promise<{ status: number; body: T & { error?: { code: string; message: string } } }> {
  const response = await fetch(`${base}/api/ops/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
  return { status: response.status, body: await response.json() };
}

test('a new project starts from what the host says for the chosen cable, and sending that back changes nothing', async () => {
  // The link from a type to the rating workbench carries the library id (/workbench?model=<id>): every id the library lists works.
  const library = await (await fetch(`${base}/api/library`)).json() as LibraryEntry[];
  const entry = library.find(item => item.id === 'huayuan.yjv22-15kv-240')!;
  assert.ok(entry, 'the public 3×240 is in the library that comes with the software');

  const start = await op<RatingStart>('rating.start', { model_id: entry.id });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal(start.body.model.id, entry.id);
  assert.equal(start.body.model.name, entry.name);
  assert.equal(start.body.model.construction, 'three_core');
  const kinds = start.body.layouts.map(layout => layout.kind);
  assert.ok(kinds.includes('three_core_buried_single') && !kinds.includes('trefoil'), 'a three-core cable is offered three-core layouts only');
  assert.equal(start.body.installation.layout, 'three_core_buried_single');
  assert.ok(start.body.conditions.currents_a.length >= 1 && start.body.conditions.soil_thermal_resistivity > 0);

  // The form sends the values it shows; the host sees no change, so the project stays as the method started it.
  const created = await op<ProjectView>('project.create', { name: '起点核对', model_id: entry.id });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const project = created.body.meta.id;
  const same = await op<{ changes: unknown[]; view: ProjectView }>('installation.set', { project, layout: start.body.installation.layout, depth_m: start.body.installation.depth_m, bonding: start.body.installation.bonding });
  assert.deepEqual(same.body.changes, []);
  const sameConditions = await op<{ changes: unknown[]; view: ProjectView }>('conditions.set', { project, soil_thermal_resistivity: start.body.conditions.soil_thermal_resistivity,
    ambient_temperature_c: start.body.conditions.ambient_temperature_c, current_a: start.body.conditions.currents_a[0] });
  assert.deepEqual(sameConditions.body.changes, []);
  assert.equal(sameConditions.body.view.inputs_sha256, created.body.inputs_sha256);
});

test('an id the library does not have is refused in the host\'s words, and the agent is not offered the operation', async () => {
  const refused = await op('rating.start', { model_id: 'no-such-model' });
  assert.equal(refused.status, 404);
  assert.match(refused.body.error!.message, /产品库里没有这个规格/);
  assert.ok(!app.studio.agentOperations().some(operation => operation.id === 'rating.start'));
});
