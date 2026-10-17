import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

async function load(relative) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }, reportDiagnostics: true });
  assert.equal(result.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
  return import('data:text/javascript;base64,' + Buffer.from(result.outputText).toString('base64'));
}
const policy = await load('../src/lib/study-view-policy.ts');
const visibility = await load('../src/features/scene/scene-state.ts');
const bridge = await load('../src/features/scene/blender-bridge.ts');
const { createViewStateStore } = await load('../src/lib/view-state.ts');
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const source = { workspace_id: 'workspace/a', study_id: 'study/a', section_id: 'section/a', workspace_revision: 2 };
const mesh = { schema: 'cablesim.display-mesh/1', unit: 'mm', deflection_mm: 0.08, prototypes: [{ positions: [0, 0, 0, 1000, 0, 0, 0, 1000, 0], triangles: [0, 1, 2], instances: [I] }] };
function scene() { return { schema: 'cablesim.cad-scene/1', brep_unit: 'mm', coordinate_frame: 'x/y/z', extrusion_axis: '+Y', input_sha256: 'a'.repeat(64), length_m: 1, crop_bounds_m: [0, 0, -1, 3, 3, 1], assets: { metal: { geometry_key: 'geometry/a', category: 'metal', display_mesh: structuredClone(mesh) } }, objects: [{ id: 'cable/A', label: '一号电缆', kind: 'cable', bounds_m: [0, 0, 0, 1, 1, 1], parts: [{ asset_id: 'metal', transform_mm: I }] }, { id: 'duct/A', label: '一号排管', kind: 'enclosure', bounds_m: [0, 0, 0, 1, 1, 1], parts: [{ asset_id: 'metal', transform_mm: I }] }] }; }
const exportScene = value => bridge.toBlenderScene(value, source, asset => asset.display_mesh);
const runs = [{ id: 'root/1', snapshot: { module: '' } }, { id: 'sweep/1', snapshot: { module: 'sweep' } }, { id: 'root/2', snapshot: { module: '' } }, { id: 'heat/1', snapshot: { module: 'thermal-field' } }];

test('current result selects only its module, not the last run globally', () => assert.equal(policy.selectedRunForView(runs, 'ampacity', 'ampacity').id, 'root/2'));
test('explicit cross-module run is refused without substituting a different run', () => assert.equal(policy.selectedRunForView(runs, 'ampacity', 'ampacity', 'heat/1'), undefined));
test('unknown explicit run stays missing', () => assert.equal(policy.selectedRunForView(runs, 'sweep', 'ampacity', 'gone'), undefined));
test('matching explicit run remains addressable', () => assert.equal(policy.selectedRunForView(runs, 'sweep', 'ampacity', 'sweep/1').id, 'sweep/1'));
test('input and report views can inspect a selected frozen run', () => { for (const module of ['cable', 'section', 'conditions', 'report']) assert.equal(policy.selectedRunForView(runs, module, 'ampacity', 'heat/1').id, 'heat/1'); });
test('malformed run identities are never treated as primary calculations', () => { for (const run of [{ id: 'a' }, { id: 'a', snapshot: null }, { id: 'a', snapshot: [] }, { id: 'a', snapshot: { module: 3 } }, { snapshot: {} }]) assert.equal(policy.runModule(run, 'ampacity'), null); });
test('changing calculation modules clears run, delivery and transient URL actions', () => {
  const original = { theme: 'dark', workspace: 'a', run: 'sweep/1', delivery: 'd', dataset: 'b', compare: 'x', preflight: true, generate: true };
  const next = policy.searchForModule(original, 'sweep', 'ampacity');
  assert.deepEqual(next, { theme: 'dark', workspace: 'a', run: '', delivery: '', dataset: '', compare: '', preflight: false, generate: false });
  assert.equal(original.run, 'sweep/1');
});
test('a tab change keeps the exact query object and input inspection keeps run identity', () => { const search = { run: 'sweep/1', delivery: 'd' }; assert.equal(policy.searchForModule(search, 'sweep', 'sweep'), search); assert.equal(policy.searchForModule(search, 'sweep', 'section').run, search.run); });
test('module groups preserve every known enabled module without adding capabilities', () => { const enabled = ['cable', 'section', 'ampacity', 'batch', 'report']; assert.deepEqual(policy.groupStudyModules(enabled).flatMap(group => group.ids), enabled); });

test('hide and isolate do not mutate engineering scene or original visibility', () => {
  const original = scene(), before = JSON.stringify(original);
  const state = visibility.changeVisibility(visibility.defaultVisibility, { type: 'set-visible', id: 'cable/A', visible: false });
  assert.deepEqual(visibility.visibleObjects(original, state).map(item => item.id), ['duct/A']);
  assert.equal(JSON.stringify(original), before); assert.deepEqual(visibility.defaultVisibility.hidden, []);
});
test('isolation can show a previously hidden selected object', () => { const state = visibility.changeVisibility({ hidden: ['cable/A'], isolated: null }, { type: 'isolate', id: 'cable/A' }); assert.deepEqual(visibility.visibleObjects(scene(), state).map(item => item.id), ['cable/A']); });
test('explicit checkbox visibility clears isolation without inverting the request', () => { const state = visibility.changeVisibility({ hidden: ['duct/A'], isolated: 'cable/A' }, { type: 'set-visible', id: 'duct/A', visible: true }); assert.equal(state.isolated, null); assert.deepEqual(state.hidden, []); });
test('all hidden produces an empty UI state, not an invalid zero-object CAD artifact', () => assert.equal(visibility.displayScene(scene(), { hidden: ['cable/A', 'duct/A'], isolated: null }), null));
test('removed isolated objects do not leave the view permanently blank', () => assert.equal(visibility.visibleObjects(scene(), { hidden: [], isolated: 'deleted' }).length, 2));
test('filtering retains the original identity, assets and engineering crop', () => { const original = scene(); const next = visibility.displayScene(original, { hidden: ['duct/A'], isolated: null }); assert.equal(next.input_sha256, original.input_sha256); assert.equal(next.assets, original.assets); assert.equal(next.crop_bounds_m, original.crop_bounds_m); });
test('search matches both labels and stable IDs, with empty search showing all', () => { const object = scene().objects[0]; assert(visibility.objectMatches(object, '一号 cable/A')); assert(visibility.objectMatches(object, '  ')); assert(!visibility.objectMatches(object, '排管')); });
test('visibility reconciliation removes stale references', () => assert.deepEqual(visibility.reconcileVisibility({ hidden: ['gone', 'cable/A'], isolated: 'gone' }, ['cable/A']), { hidden: ['cable/A'], isolated: null }));

test('view state survives unsubscribe/remount without persisting to the database', () => { const store = createViewStateStore(4); const off = store.subscribe('study/current', () => {}); store.write('study/current', { selected: 'cable/A' }); off(); assert.deepEqual(store.read('study/current', {}), { selected: 'cable/A' }); });
test('workspaces and historical snapshots have independent selections', () => { const store = createViewStateStore(); for (const key of ['w1/current', 'w1/run1', 'w2/current']) store.write(key, key); assert.equal(store.read('w1/run1', ''), 'w1/run1'); assert.equal(store.read('w2/current', ''), 'w2/current'); });
test('view-state subscriptions notify only the updated key', () => { const store = createViewStateStore(); let count = 0; const off = store.subscribe('a', () => count++); store.write('b', 1); store.write('a', 2); off(); store.write('a', 3); assert.equal(count, 1); });
test('inactive view entries are bounded and active entries retained', () => { const store = createViewStateStore(3); const off = store.subscribe('active', () => {}); store.write('active', 7); for (let i = 0; i < 30; i++) store.write(String(i), i); assert(store.size <= 3); assert.equal(store.read('active', 0), 7); off(); });

test('Blender exchange converts both vertices and row-major translations to metres', () => { const original = scene(); original.objects[0].parts[0].transform_mm = [1, 0, 0, 2000, 0, 1, 0, -500, 0, 0, 1, 1000]; const exported = exportScene(original); assert.deepEqual(exported.assets[0].prototypes[0].positions_m, [0,0,0,1,0,0,0,1,0]); assert.deepEqual(exported.objects[0].parts[0].transform_m, [1,0,0,2,0,1,0,-.5,0,0,1,1]); });
test('exchange preserves all objects, geometry keys and original identity', () => { const original = scene(), before = JSON.stringify(original), value = exportScene(original); assert.equal(value.objects.length, 2); assert.equal(value.input_sha256, original.input_sha256); assert.equal(value.assets[0].geometry_key, 'geometry/a'); assert.equal(JSON.stringify(original), before); assert.equal(value.purpose, 'visualization-only'); });
test('a preview envelope is never labeled as exact CAD', () => { const original = scene(); original.envelope = true; assert.equal(exportScene(original).representation, 'display-envelope'); });
test('source identity and coordinate conventions are required', () => { for (const patch of [{ input_sha256: '' }, { brep_unit: 'm' }, { extrusion_axis: '+Z' }, { coordinate_frame: 'left-handed' }]) assert.throws(() => exportScene({ ...scene(), ...patch })); assert.throws(() => bridge.toBlenderScene(scene(), { ...source, workspace_revision: 0 }, asset => asset.display_mesh)); });
test('bad indices, nonfinite positions and missing meshes are refused', () => { for (const patch of [{ triangles: [0,1,9] }, { triangles: [0,1,1.5] }, { positions: [0,0,0,NaN,0,0,0,1,0] }, { positions: undefined }]) { const value = scene(); Object.assign(value.assets.metal.display_mesh.prototypes[0], patch); assert.throws(() => exportScene(value)); } });
test('invalid bounds, duplicate objects and absent assets are refused', () => { let value = scene(); value.crop_bounds_m = [1,0,0,0,1,1]; assert.throws(() => exportScene(value)); value = scene(); value.objects.push(value.objects[0]); assert.throws(() => exportScene(value)); value = scene(); delete value.assets.metal; assert.throws(() => exportScene(value)); });
test('millimetre transforms reject scale, reflection and wrong matrix shapes', () => { for (const matrix of [[...I.slice(0,11)], [2,0,0,0,0,1,0,0,0,0,1,0], [-1,0,0,0,0,1,0,0,0,0,1,0]]) assert.throws(() => bridge.metreTransform(matrix)); });
test('intrinsic instance matrices are retained separately from scene placements', () => { const value = scene(); value.assets.metal.display_mesh.prototypes[0].instances = [[1,0,0,0,0,1,0,0,0,0,1,250]]; assert.equal(exportScene(value).assets[0].prototypes[0].transforms_m[0][11], .25); });
test('a serialized exchange is plain JSON without executable code or B-Rep', () => { const original = scene(); original.assets.metal.brep_text = 'private-brep-not-for-display-export'; const json = bridge.serializeBlenderScene(exportScene(original)); assert(!json.includes('private-brep')); assert.equal(JSON.parse(json).schema, 'cablesim.blender-scene/1'); });

test('exchange budget accounts for asset reuse by multiple objects', () => { const value = scene(); value.assets.metal.display_mesh.prototypes[0].instances = Array(5000).fill(I); assert.throws(() => exportScene(value)); });

test('returning from frozen inputs to the owning result module keeps its run', () => { const search = { run: 'sweep/1', delivery: '' }; assert.equal(policy.searchForModule(search, 'section', 'sweep', 'sweep').run, 'sweep/1'); assert.equal(policy.searchForModule(search, 'section', 'ampacity', 'sweep').run, ''); });
