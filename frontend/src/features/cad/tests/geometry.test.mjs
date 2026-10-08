import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { loadSources } from './load-source.mjs';

const source = await loadSources([
  'src/features/drawing/cable-geometry.ts', 'src/features/drawing/cross-section-profile.ts', 'src/features/drawing/coordinates.ts', 'src/features/drawing/section-geometry.ts',
  'src/features/cad/geometry-contract.ts', 'src/features/cad/display-mesh.ts',
  'src/features/cad/input-scene.ts',
  'src/features/cad/tests/large-scene-fixture.ts',
]);
after(() => source.close());
const cable = await source.import('src/features/drawing/cable-geometry.ts');
const profiles = await source.import('src/features/drawing/cross-section-profile.ts');
const coordinates = await source.import('src/features/drawing/coordinates.ts');
const laying = await source.import('src/features/drawing/section-geometry.ts');
const contract = await source.import('src/features/cad/geometry-contract.ts');
const mesh = await source.import('src/features/cad/display-mesh.ts');
const scene = await source.import('src/features/cad/input-scene.ts');
const { largeSceneDocument } = await source.import('src/features/cad/tests/large-scene-fixture.ts');
const document = JSON.parse(await fs.readFile(new URL('../node_modules/.cache/gallery/document.json', import.meta.url), 'utf8'));
const nativeModel = JSON.parse(await fs.readFile(new URL('../node_modules/.cache/gallery/model.json', import.meta.url), 'utf8'));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
test('Six circuits / 18 cables / 18 ducts, backfill and two soil layers retain shared 2D dimensions', () => {
  const doc = largeSceneDocument(document), model = scene.inputScene(doc, doc.sections[0].id);
  assert.equal(doc.circuits.length, 6); assert.equal(model.objects.filter(o => o.kind === 'cable').length, 18);
  assert.equal(model.objects.filter(o => o.kind === 'enclosure').length, 18); assert.equal(model.objects.filter(o => o.kind === 'soil').length, 2);
  assert.equal(model.objects.filter(o => o.kind === 'backfill').length, 1);
  const cable = model.objects.find(o => o.kind === 'cable'); close(cable.dimensions.centerDepthM, .9); close(cable.dimensions.outerDiameterM, .038); close(cable.dimensions.nearestCenterM, .18);
});

test('Research input scene: 38 mm hand dimensions, 140/160 mm duct, real placement and display-only length', () => {
  const doc = structuredClone(document), section = doc.sections[0];
  section.placements = [{ cable: doc.circuits[0].cables[0].id, x: .25, z: -1.2, enclosure: 'duct/1' }];
  section.enclosures = [{ id: 'duct/1', type: 'duct', x: .25, z: -1.2, inner_diameter: .14, outer_diameter: .16, material: doc.materials[0].id }];
  section.backfill = { id: 'backfill/1', x: .25, z: -1.2, width: .5, height: .4, material: doc.materials[0].id };
  section.soil_layers = [{ id: 'soil/1', top_z: 0, bottom_z: -2, material: doc.materials[0].id }];
  const before = structuredClone(doc), model = scene.inputScene(doc, section.id);
  contract.validateGeometry(model);
  const cableObject = model.objects.find(o => o.kind === 'cable');
  close(cableObject.bounds_m[3] - cableObject.bounds_m[0], .038);
  assert.deepEqual(cableObject.parts[0].transform_mm, [1, 0, 0, 250, 0, 1, 0, 0, 0, 0, 1, -1200]);
  close(model.assets['duct/1'].inner_radius_m, .07); close(model.assets['duct/1'].outer_radius_m, .08);
  assert.deepEqual(model.objects.find(o => o.kind === 'backfill').bounds_m, [0, 0, -1.4, .5, .4, -1]);
  assert.equal(model.objects.find(o => o.kind === 'ground').bounds_m[2], 0);
  assert.equal(model.length_m, .4); assert.deepEqual(doc, before);
  // Snapshot JSON object-key order may differ; values and array order remain authoritative.
  const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)])) : value;
  assert.equal(scene.sceneIdentity(doc, section.id), scene.sceneIdentity(reverseKeys(doc), section.id));
  doc.sections[0].placements[0].x += .1;
  assert.notEqual(scene.sceneIdentity(doc, section.id), scene.sceneIdentity(before, section.id));
  assert.throws(() => scene.inputScene(doc, section.id), /超出管道内径/);
});

test('CableSection: radial dimensions match the 38 mm hand calculation and native artifact', () => {
  const original = structuredClone(document);
  const shape = cable.cableShape(document.cable_types[0], document.materials);
  // 20 / 2 + 1 + 4 + 1 + 1 + 2 = 19 mm radius.
  close(shape.radiusM, .019); close(shape.radiusM * 2, nativeModel.outer_diameter_m);
  assert.equal(shape.rings.length, 6);
  assert.equal(cable.dimensionValue(document.cable_types[0], { scope: 'common', role: 'insulation' }).valueM, .004);
  assert.deepEqual(document, original);
});
test('Two 160 mm ducts require at least 160 mm center distance and 80 mm center depth', () => {
  const doc = structuredClone(document), section = doc.sections[0]; section.placements = [];
  section.enclosures = [0, .16].map((x, index) => ({ id: `duct/${index}`, type: 'duct', x, z: -.08, inner_diameter: .14, outer_diameter: .16, material: doc.materials[0].id }));
  laying.validateSectionEdit(doc, section, []);
  section.enclosures[1].x = .159;
  assert.throws(() => laying.validateSectionEdit(doc, section, []), /排管外轮廓重叠/);
  section.enclosures[1].x = .16; section.enclosures[0].z = -.079;
  assert.throws(() => laying.validateSectionEdit(doc, section, []), /完全位于地表下/);
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
test('CableSection: sector profiles use arc radius, offset layers and actual separating edges', () => {
  const type=structuredClone(document.cable_types[0]);type.construction='three_core';
  type.cores=[0,120,240].map((angle,index)=>({id:`core/${index+1}`,x:.004*Math.cos(angle*Math.PI/180),z:.004*Math.sin(angle*Math.PI/180),
    conductor:{...type.cores[0].conductor,form:'sectoral',diameter:.04,nominal_area:.0003,sector_angle_deg:120,sector_rotation_deg:angle},
    layers:[{role:'insulation',material:document.materials.find(m=>m.category==='insulation').id,thickness:.003}]}));
  type.common_layers=[{role:'filler',material:document.materials.find(m=>m.category==='insulation').id,thickness:.001}];
  const shape=cable.cableShape(type,document.materials);close(shape.radiusM,.028);
  // R=20 mm, angle=120 degrees: local height=20, width=20*sqrt(3), not a 40 mm diameter.
  for(const ring of shape.rings.filter(row=>row.target.role==='conductor')){
    const size=profiles.sectorSize(ring.profile);close(size.heightM,.020);close(size.widthM,.020*Math.sqrt(3));
  }
  assert.equal(shape.rings.filter(row=>row.profile.kind==='sector').length,6);
  assert.equal(shape.rings.find(row=>row.target.role==='filler').holes.length,3);
  type.cores[1].conductor.sector_rotation_deg=0;assert.throws(()=>cable.cableShape(type,document.materials),/重叠/);
  delete type.cores[1].conductor.sector_angle_deg;assert.throws(()=>cable.cableShape(type,document.materials),/扇形/);
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
  for (const field of ['inner_radius_m', 'outer_radius_m', 'material', 'category', 'center_m']) {
    const changed = structuredClone(exact);
    changed.layers[2][field] = field==='center_m' ? {x:.001,z:0} : typeof changed.layers[2][field] === 'number' ? changed.layers[2][field] + .0001 : 'different';
    assert.throws(() => contract.matchingExactModel(previous, changed), /层尺寸/);
  }
  previous.layers[0].construction = { wire_diameter: .001, nested: { lay_length: .2, direction: 'left' } };
  exact.layers[0].construction = { nested: { direction: 'left', lay_length: .2 }, wire_diameter: .001 };
  contract.matchingExactModel(previous, exact);
  exact.layers[0].construction.nested.lay_length = .3;
  assert.throws(() => contract.matchingExactModel(previous, exact), /层尺寸/);
});
test('CadViewport: core identity is retained when an artifact omits its optional entity', () => {
  const first={...nativeModel.layers[0],entity:undefined,source_target:{scope:'core',core_id:'core/1',role:'conductor'}};
  const second={...first,source_target:{...first.source_target,core_id:'core/2'}};
  assert.notEqual(contract.layerId(first),contract.layerId(second));
  const model={...nativeModel,layers:[first,second]};contract.validateGeometry(model);
  assert.equal(contract.selectionIndex(model,{kind:'layer',id:contract.layerId(second)}),1);
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
