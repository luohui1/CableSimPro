import rawDocument from './node_modules/.cache/gallery/document.json';
import rawModel from './node_modules/.cache/gallery/model.json';
import rawScene from './node_modules/.cache/gallery/scene.json';
import rawUpdatedModel from './node_modules/.cache/gallery/updated-model.json';
import type { DomainDocument, Section } from '../drawing/types';
import type { CadModel, CadScene } from './types';

/** Imported only by the gallery and test harness. Never imported by business components. */
export const demoDocument = rawDocument as DomainDocument;
export const demoModel = rawModel as CadModel;
export const demoScene = rawScene as CadScene;
export const updatedModel = rawUpdatedModel as CadModel;
export const previewModel: CadModel = { ...demoModel, exact_pending: true,
  layers: demoModel.layers.map(({ brep_text: _exact, ...layer }) => layer) };
export const envelopeModel: CadModel = { ...previewModel, envelope: true };

export function demoTemplate(id: string, document: DomainDocument): { document: DomainDocument; section: Section } {
  const next = structuredClone(document);
  const base = structuredClone(demoDocument.sections[0]);
  base.enclosures = []; base.backfill = null;
  base.placements = ['A', 'B', 'C'].map((phase, index) => ({ cable: `cable/${phase}`, x: (index - 1) * .16, z: -.75 }));
  next.cable_types = structuredClone(demoDocument.cable_types);
  next.circuits = structuredClone(demoDocument.circuits);
  if (id === 'duct' || id === 'backfill') {
    base.enclosures = structuredClone(demoDocument.sections[0].enclosures);
    base.placements = structuredClone(demoDocument.sections[0].placements);
  }
  if (id === 'backfill') base.backfill = structuredClone(demoDocument.sections[0].backfill);
  if (id === 'double') {
    const second = structuredClone(next.circuits[0]);
    second.id = 'circuit/2'; second.label = '第二演示回路';
    second.cables = second.cables.map(item => ({ ...item, id: `${item.id}/2` }));
    next.circuits.push(second);
    base.placements = [...base.placements.map(item => ({ ...item, x: item.x - .35 })),
      ...base.placements.map(item => ({ ...item, cable: `${item.cable}/2`, x: item.x + .35 }))];
  }
  if (id === 'three-core') {
    const type = next.cable_types[0];
    type.construction = 'three_core';
    type.label = '陈列用三芯参数结构';
    type.cores = [{ x: 0, z: .025 }, { x: -.02165, z: -.0125 }, { x: .02165, z: -.0125 }].map((point, index) => ({
      ...point, id: `core/${index + 1}`, conductor: structuredClone(type.cores[0].conductor),
      layers: structuredClone(type.common_layers.slice(0, 4)),
    }));
    type.common_layers = [{ role: 'oversheath', thickness: .003, material: 'pe' }];
    next.circuits[0].cables = [{ id: 'cable/ABC', phase: 'L1L2L3' }];
    base.placements = [{ cable: 'cable/ABC', x: 0, z: -.75 }];
  }
  base.label = { single: '单回直埋', double: '双回直埋', duct: '单回排管', backfill: '排管与回填', 'three-core': '三芯直埋' }[id] || id;
  next.sections = [base];
  return { document: next, section: base };
}
