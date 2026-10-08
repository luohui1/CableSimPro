import { sectionGeometry, validateSectionEdit } from '../drawing/section-geometry';
import { profileSupportPoint } from '../drawing/cross-section-profile';
import type { DomainDocument } from '../drawing/types';
import type { DrawingRing } from '../drawing/cable-geometry';
import type { CadScene, DisplayMesh, SceneAsset, SceneObject } from './types';
import { identityTransform, validateGeometry } from './geometry-contract';

/** A dimensioned display extrusion, never a solver result or a measurement BREP. */
function contourMesh(ring: DrawingRing, length: number): DisplayMesh {
  if (ring.holes.length) throw new Error(`${ring.id}：外露填充孔需要同源 CAD 工件；请切回二维查看。`);
  const count = Math.max(64, Math.ceil(Math.PI / Math.acos(1 - Math.min(.08 / (ring.outerM * 1000), .5))));
  if (count > 8192) throw new Error(`${ring.id}：截面尺寸超出三维显示范围。`);
  const outer = Array.from({ length: count }, (_, i) => profileSupportPoint(ring.profile, i * Math.PI * 2 / count));
  const inner = ring.innerProfile && Array.from({ length: count }, (_, i) => profileSupportPoint(ring.innerProfile!, i * Math.PI * 2 / count));
  const positions: number[] = [], triangles: number[] = [];
  for (const y of [0, length]) for (const contour of [outer, inner || outer.map(() => ({ x: ring.centerX, z: ring.centerZ }))])
    for (const p of contour) positions.push(p.x * 1000, y * 1000, p.z * 1000);
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count, a = i, b = j, c = count + i, d = count + j;
    triangles.push(a, b, a + count * 2, b, b + count * 2, a + count * 2,
      c, c + count * 2, d, d, c + count * 2, d + count * 2,
      a, c, b, b, c, d,
      a + count * 2, b + count * 2, c + count * 2, b + count * 2, d + count * 2, c + count * 2);
  }
  return { schema: 'cablesim.display-mesh/1', unit: 'mm', deflection_mm: .08,
    prototypes: [{ positions, triangles, instances: [identityTransform] }] };
}

export function inputScene(document: DomainDocument, sectionId: string): CadScene {
  const section = document.sections.find(s => s.id === sectionId);
  if (!section) throw new Error('sections：请选择存在的敷设截面。');
  const geometry = sectionGeometry(document, section);
  validateSectionEdit(document, section, []);
  if (!geometry.cables.length) throw new Error('placements：请先放置电缆。');
  if (geometry.cables.length > 32) throw new Error('placements：三维视图最多显示 32 根电缆。');
  const length = .4; // Display segment only; the section's engineering length remains untouched.
  const margin = Math.max(.15, (geometry.bounds.right - geometry.bounds.left) * .15);
  const bounds = [geometry.bounds.left - margin, 0, geometry.bounds.bottom - .15,
    geometry.bounds.right + margin, length, geometry.bounds.top];
  const assets: Record<string, SceneAsset> = {}, objects: SceneObject[] = [];
  const addBox = (id: string, kind: SceneObject['kind'], b: number[], label: string) => {
    assets[id] = { geometry_key: JSON.stringify(b), primitive: kind === 'ground' ? 'plane' : 'box', bounds_m: b };
    objects.push({ id, kind, label, bounds_m: b, parts: [{ asset_id: id, transform_mm: identityTransform }] });
  };
  for (const cable of geometry.cables) {
    const parts: SceneObject['parts'][number][] = [];
    const conductors = cable.shape.rings.filter(r => r.target.role === 'conductor');
    const skin = cable.shape.rings.at(-1)!;
    for (const ring of [...conductors, ...(conductors.includes(skin) ? [] : [skin])]) {
      const id = `${cable.id}/${ring.id}`;
      assets[id] = { geometry_key: JSON.stringify([ring.profile, ring.innerProfile]), category: ring.materialRole === 'conductor' ? 'conductor' : 'polymer',
        outer_radius_m: ring.outerM, inner_radius_m: ring.innerM, display_mesh: contourMesh(ring, length), core_id: ring.target.scope === 'core' ? ring.target.coreId : undefined };
      parts.push({ asset_id: id, transform_mm: [1, 0, 0, cable.x * 1000, 0, 1, 0, 0, 0, 0, 1, cable.z * 1000] });
    }
    const r = cable.shape.radiusM;
    objects.push({ id: cable.id, kind: 'cable', label: cable.label, bounds_m: [cable.x - r, 0, cable.z - r, cable.x + r, length, cable.z + r], parts });
  }
  for (const e of section.enclosures || []) {
    if (e.type === 'duct') {
      const r = e.outer_diameter! / 2;
      assets[e.id] = { geometry_key: JSON.stringify(e), primitive: 'annulus', inner_radius_m: e.inner_diameter! / 2, outer_radius_m: r };
      objects.push({ id: e.id, kind: 'enclosure', label: '排管', bounds_m: [e.x - r, 0, e.z - r, e.x + r, length, e.z + r],
        parts: [{ asset_id: e.id, transform_mm: [1, 0, 0, e.x * 1000, 0, 0, 1, 0, 0, -1, 0, e.z * 1000] }] });
    } else addBox(e.id, 'enclosure', [e.x - e.width! / 2, 0, e.z - e.height! / 2, e.x + e.width! / 2, length, e.z + e.height! / 2], '容纳结构');
  }
  if (section.backfill) {
    const b = section.backfill;
    addBox(b.id, 'backfill', [b.x - b.width / 2, 0, b.z - b.height / 2, b.x + b.width / 2, length, b.z + b.height / 2], '回填');
  }
  for (const layer of section.soil_layers || []) addBox(layer.id, 'soil', [bounds[0], 0, layer.bottom_z, bounds[3], length, layer.top_z], '土壤层');
  if (section.kind === 'ground') {
    if (!section.soil_layers?.length) addBox(`${section.id}/soil`, 'soil', bounds, '土壤显示窗口');
    addBox(`${section.id}/ground`, 'ground', [bounds[0], 0, 0, bounds[3], length, 0], '地表');
  }
  for (const object of objects.filter(o => o.kind === 'cable' || o.kind === 'enclosure')) {
    const b = object.bounds_m, x = (b[0] + b[3]) / 2, z = (b[2] + b[5]) / 2;
    const peers = objects.filter(o => o.kind === object.kind && o.id !== object.id).map(o => ({ id: o.id,
      distance: Math.hypot((o.bounds_m[0] + o.bounds_m[3]) / 2 - x, (o.bounds_m[2] + o.bounds_m[5]) / 2 - z) })).sort((a, b) => a.distance - b.distance);
    const circular = object.kind === 'cable' || section.enclosures?.find(e => e.id === object.id)?.type === 'duct';
    object.dimensions = { centerDepthM: -z, outerDiameterM: circular ? b[3] - b[0] : undefined, nearestCenterM: peers[0]?.distance, nearestId: peers[0]?.id };
  }
  const scene: CadScene = { schema: 'cablesim.cad-scene/1', brep_unit: 'mm', coordinate_frame: 'x/y/z', extrusion_axis: '+Y',
    input_sha256: '', display_input: sceneIdentity(document, sectionId), length_m: length, crop_bounds_m: bounds, objects, assets, envelope: true, display_source: 'domain-input' };
  validateGeometry(scene);
  return scene;
}

export function sceneIdentity(document: DomainDocument, sectionId: string): string {
  const section = document.sections.find(s => s.id === sectionId);
  const circuits = document.circuits.filter(c => c.cables.some(p => section?.placements.some(v => v.cable === p.id)));
  const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)])) : value;
  return JSON.stringify(ordered({ section, circuits, types: document.cable_types.filter(t => circuits.some(c => c.cable_type === t.id)) }));
}
