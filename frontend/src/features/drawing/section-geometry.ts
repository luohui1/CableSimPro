import { cableShape, type CableShape } from './cable-geometry';
import type { DomainDocument, Section, SectionSelection, WorldPoint } from './types';

export interface PlacedCable {
  id: string; x: number; z: number; shape: CableShape; label: string; phase: string; enclosure?: string | null;
}
export interface SectionGeometry {
  cables: PlacedCable[];
  bounds: { left: number; right: number; bottom: number; top: number };
}
const finite = (value: number, field: string) => {
  if (!Number.isFinite(value)) throw new Error(`${field}：请输入有限坐标，单位 m。`);
};
const positive = (value: number | null | undefined, field: string): number => {
  if (value == null || !Number.isFinite(value) || value <= 0) throw new Error(`${field}：请输入正尺寸，单位 m。`);
  return value;
};

export function sectionGeometry(document: DomainDocument, section: Section): SectionGeometry {
  const definitions = new Map(document.cable_types.map(type => [type.id, type]));
  const instances = new Map(document.circuits.flatMap(circuit => circuit.cables.map(cable => [cable.id, { cable, circuit }] as const)));
  const seen = new Set<string>();
  const cables = section.placements.map(placement => {
    if (seen.has(placement.cable)) throw new Error(`placements.${placement.cable}：电缆位置重复。`);
    seen.add(placement.cable);
    const instance = instances.get(placement.cable);
    const type = instance && definitions.get(instance.circuit.cable_type);
    if (!instance || !type) throw new Error(`placements.${placement.cable}：缺少回路、电缆实例或型号引用。`);
    finite(placement.x, `placements.${placement.cable}.x`); finite(placement.z, `placements.${placement.cable}.z`);
    return { id: placement.cable, x: placement.x, z: placement.z, enclosure: placement.enclosure,
      shape: cableShape(type, document.materials), phase: instance.cable.phase,
      label: type.construction === 'three_core' ? '三芯' : instance.cable.phase };
  });
  let left = Infinity, right = -Infinity, bottom = Infinity, top = section.kind === 'ground' ? 0 : -Infinity;
  const include = (x: number, z: number, width: number, height: number) => {
    left = Math.min(left, x - width / 2); right = Math.max(right, x + width / 2);
    bottom = Math.min(bottom, z - height / 2); top = Math.max(top, z + height / 2);
  };
  for (const cable of cables) include(cable.x, cable.z, cable.shape.radiusM * 2, cable.shape.radiusM * 2);
  for (const enclosure of section.enclosures || []) {
    finite(enclosure.x, `enclosures.${enclosure.id}.x`); finite(enclosure.z, `enclosures.${enclosure.id}.z`);
    if (enclosure.type === 'duct') {
      const outer = positive(enclosure.outer_diameter, `enclosures.${enclosure.id}.outer_diameter`);
      const inner = positive(enclosure.inner_diameter, `enclosures.${enclosure.id}.inner_diameter`);
      if (inner >= outer) throw new Error(`enclosures.${enclosure.id}.inner_diameter：内径须小于外径。`);
      include(enclosure.x, enclosure.z, outer, outer);
    } else include(enclosure.x, enclosure.z, positive(enclosure.width, `enclosures.${enclosure.id}.width`),
      positive(enclosure.height, `enclosures.${enclosure.id}.height`));
  }
  if (section.backfill) {
    const region = section.backfill;
    finite(region.x, `backfill.${region.id}.x`); finite(region.z, `backfill.${region.id}.z`);
    include(region.x, region.z, positive(region.width, 'backfill.width'), positive(region.height, 'backfill.height'));
  }
  for (const layer of section.soil_layers || []) {
    finite(layer.top_z, `soil_layers.${layer.id}.top_z`); finite(layer.bottom_z, `soil_layers.${layer.id}.bottom_z`);
    if (layer.bottom_z >= layer.top_z) throw new Error(`soil_layers.${layer.id}.bottom_z：下边界须低于上边界。`);
    bottom = Math.min(bottom, layer.bottom_z); top = Math.max(top, layer.top_z);
  }
  // Empty viewport bounds are presentation defaults, never engineering input.
  if (!Number.isFinite(left)) { left = -.5; right = .5; }
  if (!Number.isFinite(bottom)) bottom = -1;
  if (!Number.isFinite(top)) top = 0;
  return { cables, bounds: { left, right, bottom, top } };
}

export function selectionPosition(section: Section, selection: SectionSelection): WorldPoint | null {
  if (!selection) return null;
  if (selection.kind === 'cable') return section.placements.find(item => item.cable === selection.id) || null;
  if (selection.kind === 'enclosure') return section.enclosures?.find(item => item.id === selection.id) || null;
  if (selection.kind === 'backfill') return section.backfill?.id === selection.id ? section.backfill : null;
  const layer = section.soil_layers?.find(item => item.id === selection.id);
  return layer ? { x: 0, z: layer.bottom_z } : null;
}

export function moveSelection(section: Section, selection: SectionSelection, delta: WorldPoint, followEnclosure: boolean): { section: Section; fields: string[] } {
  if (!selection) return { section, fields: [] };
  finite(delta.x, 'move.x'); finite(delta.z, 'move.z');
  const next = structuredClone(section);
  const fields: string[] = [];
  const move = (item: { x: number; z: number }, path: string) => {
    item.x += delta.x; item.z += delta.z; fields.push(`${path}.x`, `${path}.z`);
  };
  if (selection.kind === 'soil') {
    const layers = next.soil_layers || [];
    const index = layers.findIndex(item => item.id === selection.id);
    if (index < 0) return { section, fields };
    const old = layers[index].bottom_z;
    const boundary = old + delta.z;
    layers[index].bottom_z = boundary; fields.push(`soil_layers.${selection.id}.bottom_z`);
    for (const layer of layers) if (layer.id !== selection.id && Math.abs(layer.top_z - old) < 1e-9) {
      layer.top_z = boundary; fields.push(`soil_layers.${layer.id}.top_z`);
    }
    return { section: next, fields };
  }
  if (selection.kind === 'backfill' && next.backfill?.id === selection.id) move(next.backfill, `backfill.${selection.id}`);
  let enclosureId = selection.kind === 'enclosure' ? selection.id : undefined;
  if (selection.kind === 'cable' && followEnclosure) {
    enclosureId = next.placements.find(item => item.cable === selection.id)?.enclosure ||
      next.enclosures?.find(item => item.contains?.includes(selection.id))?.id;
  }
  if (enclosureId) {
    const enclosure = next.enclosures?.find(item => item.id === enclosureId);
    if (!enclosure) throw new Error(`enclosures.${enclosureId}：电缆关联的构筑物不存在。`);
    move(enclosure, `enclosures.${enclosure.id}`);
    for (const placement of next.placements) if (placement.enclosure === enclosureId || enclosure.contains?.includes(placement.cable)) {
      move(placement, `placements.${placement.cable}`);
    }
  } else if (selection.kind === 'cable') {
    const placement = next.placements.find(item => item.cable === selection.id);
    if (placement) move(placement, `placements.${placement.cable}`);
  }
  return { section: next, fields };
}

export function validateSectionEdit(document: DomainDocument, section: Section, fields: readonly string[], isLocked?: (field: string) => boolean): void {
  const locked = fields.find(field => isLocked?.(field));
  if (locked) throw new Error(`${locked}：字段已锁定，整组改动未应用。`);
  const geometry = sectionGeometry(document, section);
  if (section.kind === 'ground') {
    for (const cable of geometry.cables) if (cable.z + cable.shape.radiusM > 1e-9) {
      throw new Error(`placements.${cable.id}.z：电缆须完全位于地表下。`);
    }
    const region = section.backfill;
    if (region && region.z + region.height / 2 > 1e-9) throw new Error('backfill.z：回填区上边界不能高于地表。');
  }
  for (let a = 0; a < geometry.cables.length; a += 1) for (let b = a + 1; b < geometry.cables.length; b += 1) {
    const first = geometry.cables[a], second = geometry.cables[b];
    if (Math.hypot(first.x - second.x, first.z - second.z) + 1e-9 < first.shape.radiusM + second.shape.radiusM) {
      throw new Error(`placements.${second.id}：电缆与 ${first.id} 的几何截面重叠，请增大间距。`);
    }
  }
  const ducts = (section.enclosures || []).filter(e => e.type === 'duct');
  for (let a = 0; a < ducts.length; a++) {
    const first = ducts[a], radius = first.outer_diameter! / 2;
    if (section.kind === 'ground' && first.z + radius > 1e-9) throw Error(`enclosures.${first.id}.z：排管须完全位于地表下。`);
    for (let b = a + 1; b < ducts.length; b++) {
      const second = ducts[b];
      if (Math.hypot(first.x - second.x, first.z - second.z) + 1e-9 < radius + second.outer_diameter! / 2)
        throw Error(`enclosures.${second.id}：排管外轮廓重叠，请增大中心距。`);
    }
  }
  for (const cable of geometry.cables) {
    const enclosure = section.enclosures?.find(item => item.id === cable.enclosure || item.contains?.includes(cable.id));
    if (!enclosure) { if (cable.enclosure) throw new Error(`placements.${cable.id}.enclosure：引用缺失。`); continue; }
    if (enclosure.type === 'duct' && Math.hypot(cable.x - enclosure.x, cable.z - enclosure.z) + cable.shape.radiusM > enclosure.inner_diameter! / 2 + 1e-9) {
      throw new Error(`placements.${cable.id}：电缆截面超出管道内径。`);
    }
  }
  const layers = [...(section.soil_layers || [])].sort((a, b) => b.top_z - a.top_z);
  for (let index = 1; index < layers.length; index += 1) if (layers[index].top_z > layers[index - 1].bottom_z + 1e-9) {
    throw new Error(`soil_layers.${layers[index].id}.top_z：土壤层边界重叠。`);
  }
}
