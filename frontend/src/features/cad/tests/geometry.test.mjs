import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { loadSources } from './load-source.mjs';

const source = await loadSources([
  'src/features/drawing/cable-geometry.ts', 'src/features/drawing/coordinates.ts', 'src/features/drawing/section-geometry.ts',
  'src/features/cad/geometry-contract.ts', 'src/features/cad/display-mesh.ts',
]);
after(() => source.close());
const cable = await source.import('src/features/drawing/cable-geometry.ts');
const coordinates = await source.import('src/features/drawing/coordinates.ts');
const laying = await source.import('src/features/drawing/section-geometry.ts');
const contract = await source.import('src/features/cad/geometry-contract.ts');
const mesh = await source.import('src/features/cad/display-mesh.ts');
const document = JSON.parse(await fs.readFile(new URL('../node_modules/.cache/gallery/document.json', import.meta.url), 'utf8'));
const nativeModel = JSON.parse(await fs.readFile(new URL('../node_modules/.cache/gallery/model.json', import.meta.url), 'utf8'));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('CableSection: radial dimensions match the 38 mm hand calculation and native artifact', () => {
  const original = structuredClone(document);
  const shape = cable.cableShape(document.cable_types[0], document.materials);
  // 20 / 2 + 1 + 4 + 1 + 1 + 2 = 19 mm radius.
  close(shape.radiusM, .019); close(shape.radiusM * 2, nativeModel.outer_diameter_m);
  assert.equal(shape.rings.length, 6);
  assert.equal(cable.dimensionValue(document.cable_types[0], { scope: 'common', role: 'insulation' }).valueM, .004);
  assert.deepEqual(document, original);
});
test('CableSection: three-core coordinates remain to scale and missing material is refused', () => {
  const type = structuredClone(document.cable_types[0]);
  type.construction = 'three_core'; type.common_layers = [];
  type.cores = [{ x: 0, z: .02 }, { x: -.01732, z: -.01 }, { x: .01732, z: -.01 }]
    .map((point, index) => ({ ...point, id: `core/${index}`, conductor: type.cores[0].conductor, layers: [] }));
  const shape = cable.cableShape(type, document.materials);
  close(shape.radiusM, .03);
  assert.deepEqual(shape.coreCenters.map(point => [point.x, point.z]), [[0, .02], [-.01732, -.01], [.01732, -.01]]);
  assert.throws(() => cable.cableShape(type, []), /材料引用缺失/);
});
test('LayingSection: z-positive-up transforms, cursor zoom and 1 mm snap round trip', () => {
  const view = { x: .1, z: -.5, widthM: 2 }, size = { width: 1000, height: 500 };
  const point = { x: .3, z: -.7 }, pixel = coordinates.worldToScreen(point, view, size);
  close(pixel.x, 600); close(pixel.y, 350);
  const recovered = coordinates.screenToWorld(pixel, view, size);
  close(recovered.x, point.x); close(recovered.z, point.z);
  const zoomed = coordinates.zoomView(view, .5, pixel, size);
  const anchored = coordinates.screenToWorld(pixel, zoomed, size);
  close(anchored.x, point.x); close(anchored.z, point.z);
  close(coordinates.snapCoordinate(.12349, true, .001), .123);
  assert.throws(() => coordinates.snapCoordinate(1, true, 0), /步长/);
});
test('LayingSection: linked duct move is atomic, preserves offsets, and rejects locked fields', () => {
  const section = document.sections[0], original = structuredClone(section);
  const result = laying.moveSelection(section, { kind: 'cable', id: 'cable/A' }, { x: -.025, z: -.03 }, true);
  const placement = result.section.placements[0], enclosure = result.section.enclosures[0];
  close(placement.x, -.185); close(placement.z, -.78); close(enclosure.x, placement.x); close(enclosure.z, placement.z);
  laying.validateSectionEdit(document, result.section, result.fields);
  assert.throws(() => laying.validateSectionEdit(document, result.section, result.fields, field => field === 'enclosures.duct/A.x'), /整组改动未应用/);
  assert.deepEqual(section, original);
});
test('LayingSection: soil boundary updates both layers and invalid geometry is refused', () => {
  const result = laying.moveSelection(document.sections[0], { kind: 'soil', id: 'soil/upper' }, { x: 0, z: -.1 }, true);
  close(result.section.soil_layers[0].bottom_z, -.6); close(result.section.soil_layers[1].top_z, -.6);
  laying.validateSectionEdit(document, result.section, result.fields);
  const invalid = structuredClone(result.section); invalid.placements[0].z = .1;
  assert.throws(() => laying.validateSectionEdit(document, invalid, []), /地表下/);
  invalid.placements[0] = { ...invalid.placements[1], cable: 'cable/A' };
  assert.throws(() => laying.validateSectionEdit(document, invalid, []), /重叠/);
});
test('CadViewport: exact replacement rejects a stale input and retains stable selection IDs', () => {
  const preview = { ...nativeModel, layers: nativeModel.layers.map(({ brep_text, ...layer }) => layer) };
  contract.matchingExactModel(preview, nativeModel);
  assert.throws(() => contract.matchingExactModel(preview, { ...nativeModel, input_sha256: 'stale' }), /过期工件/);
  assert.equal(contract.selectionIndex(nativeModel, { kind: 'layer', id: nativeModel.layers[2].entity }), 2);
  assert.throws(() => contract.validateGeometry({ ...nativeModel, length_m: -1 }), /length_m/);
});
test('CadViewport: exact replacement without geometry keys still requires the same dimensions and construction', () => {
  const previous = { ...nativeModel, layers: nativeModel.layers.map(({ geometry_key, ...layer }) => layer) };
  const exact = structuredClone(previous);
  contract.matchingExactModel(previous, exact);
  assert.throws(() => contract.matchingExactModel(previous, { ...exact, length_m: .14 }), /展示长度或层尺寸/);
  assert.throws(() => contract.matchingExactModel(previous, { ...exact, outer_diameter_m: .04 }), /层尺寸/);
  for (const field of ['inner_radius_m', 'outer_radius_m', 'material', 'category']) {
    const changed = structuredClone(exact);
    changed.layers[2][field] = typeof changed.layers[2][field] === 'number' ? changed.layers[2][field] + .0001 : 'different';
    assert.throws(() => contract.matchingExactModel(previous, changed), /层尺寸/);
  }
  previous.layers[0].construction = { wire_diameter: .001, nested: { lay_length: .2, direction: 'left' } };
  exact.layers[0].construction = { nested: { direction: 'left', lay_length: .2 }, wire_diameter: .001 };
  contract.matchingExactModel(previous, exact);
  exact.layers[0].construction.nested.lay_length = .3;
  assert.throws(() => contract.matchingExactModel(previous, exact), /层尺寸/);
});
test('CadViewport: envelope and decoded display mesh retain mm geometry and cache identity', () => {
  const envelope = mesh.annulusMesh(.1, { inner_radius_m: .01, outer_radius_m: .015 });
  const vertices = envelope.prototypes[0].positions;
  close(Math.max(...vertices.filter((_, index) => index % 3 === 2)), 100);
  close(Math.max(...vertices.filter((_, index) => index % 3 === 0)), 15);
  const decoded = mesh.decodeMesh(nativeModel.layers[0].display_mesh);
  assert.equal(mesh.decodeMesh(nativeModel.layers[0].display_mesh), decoded);
  assert.ok(decoded.prototypes[0].positions.length > 0);
  assert.throws(() => mesh.annulusMesh(.1, { inner_radius_m: 0, outer_radius_m: 1e20 }), /细分范围/);
});
