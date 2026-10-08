import type { DomainDocument } from '../../drawing/types';
/** Geometry regression fixture only; never a saved engineering result. Six three-phase circuits. */
export function largeSceneDocument(base: DomainDocument): DomainDocument {
  const document = structuredClone(base), section = document.sections[0], circuit = document.circuits[0];
  document.circuits = Array.from({ length: 6 }, (_, i) => ({ ...structuredClone(circuit), id: `regression/circuit/${i}`, label: `几何回归回路 ${i + 1}`,
    cables: circuit.cables.map((c, j) => ({ ...c, id: `regression/cable/${i}/${j}` })) }));
  section.placements = document.circuits.flatMap((c, i) => c.cables.map((p, j) => ({ cable: p.id, x: (i % 3 - 1) * .9 + (j - 1) * .18, z: -.9 - Math.floor(i / 3) * .45, enclosure: `regression/duct/${i}/${j}` })));
  section.enclosures = section.placements.map((p, i) => ({ id: p.enclosure!, type: 'duct' as const, x: p.x, z: p.z, inner_diameter: .14, outer_diameter: .16, material: base.sections[0].enclosures![0].material, label: `几何排管 ${i + 1}` }));
  section.backfill = { ...base.sections[0].backfill!, id: 'regression/backfill', x: 0, z: -1.15, width: 2.8, height: .85 };
  section.soil_layers = [{ ...base.sections[0].soil_layers![0], id: 'regression/soil/upper', top_z: 0, bottom_z: -.5 },
    { ...base.sections[0].soil_layers![1], id: 'regression/soil/lower', top_z: -.5, bottom_z: -2 }];
  section.label = '六回路几何回归 · 不含计算结果'; document.sections = [section];
  return document;
}
