// Drawing geometry derived from the domain document; lengths in metres, z upward, ground at z = 0.
// The ring construction follows the CableSimPro drawing code (frontend/src/features/drawing/cable-geometry.ts).
import { ROLE_NAMES } from './format.ts';
import type { CableType, DomainDocument, Material, Section } from './types.ts';

export type Tone = 'conductor' | 'semi' | 'insulation' | 'metal' | 'sheath' | 'fill';
export interface Ring {
  id: string;
  number: number;
  role: string;
  name: string;
  tone: Tone;
  material: string;
  inner: number;
  outer: number;
  cx: number;
  cz: number;
  /** Radial thickness, or the diameter for a conductor. */
  size: number;
  core?: string;
}
export interface CableShape { radius: number; rings: Ring[] }

const TONES: Record<string, Tone> = { conductor: 'conductor', semiconductor: 'semi', insulation: 'insulation', metal: 'metal', polymer: 'sheath', filler: 'fill' };

export function cableShape(cable: CableType, materials: readonly Material[]): CableShape {
  const byId = new Map(materials.map(material => [material.id, material]));
  const rings: Ring[] = [];
  let envelope = 0;
  const add = (ring: Omit<Ring, 'number' | 'name' | 'tone'>) => {
    const material = byId.get(ring.material);
    if (!material) throw new Error(`材料引用缺失：${ring.material}`);
    const prefix = ring.core && cable.cores.length > 1 ? `芯 ${cable.cores.findIndex(core => core.id === ring.core) + 1} · ` : '';
    rings.push({ ...ring, number: rings.length + 1, name: prefix + (ROLE_NAMES[ring.role] ?? ring.role), tone: TONES[material.category] ?? 'fill' });
  };
  for (const core of cable.cores) {
    if (core.conductor.form === 'sectoral') throw new Error('扇形导体截面暂不支持绘制。');
    let outer = core.conductor.diameter / 2;
    add({ id: `${core.id}/conductor`, role: 'conductor', material: core.conductor.material, inner: 0, outer, cx: core.x, cz: core.z,
          size: core.conductor.diameter, core: core.id });
    for (const layer of core.layers) {
      const inner = outer;
      outer += layer.thickness + (layer.corrugation_depth ?? 0);
      add({ id: `${core.id}/${layer.role}`, role: layer.role, material: layer.material, inner, outer, cx: core.x, cz: core.z,
            size: layer.thickness, core: core.id });
    }
    envelope = Math.max(envelope, Math.hypot(core.x, core.z) + outer);
  }
  let radius = envelope;
  for (const layer of cable.common_layers) {
    const inner = radius;
    radius += layer.thickness + (layer.corrugation_depth ?? 0);
    // The filler occupies the space between the cores, so it is drawn as a disc behind them.
    const filler = layer.role === 'filler' && cable.cores.length > 1;
    add({ id: `common/${layer.role}`, role: layer.role, material: layer.material, inner: filler ? 0 : inner, outer: radius, cx: 0, cz: 0, size: layer.thickness });
  }
  return { radius, rings };
}

export interface Placed {
  id: string;
  circuit: string;
  circuitLabel: string;
  phase: string;
  x: number;
  z: number;
  radius: number;
  enclosure?: string | null;
}
export interface Bounds { left: number; right: number; top: number; bottom: number }
export interface SectionShape { cables: Placed[]; bounds: Bounds; shape: CableShape }

export function sectionShape(document: DomainDocument): SectionShape {
  const section: Section = document.sections[0];
  const cable = document.cable_types[0];
  const shape = cableShape(cable, document.materials);
  const owners = new Map(document.circuits.flatMap(circuit => circuit.cables.map(item => [item.id, { circuit, phase: item.phase }] as const)));
  const cables = section.placements.map(placement => {
    const owner = owners.get(placement.cable);
    if (!owner) throw new Error(`截面中的电缆 ${placement.cable} 不属于任何回路。`);
    return { id: placement.cable, circuit: owner.circuit.id, circuitLabel: owner.circuit.label, phase: owner.phase, x: placement.x, z: placement.z,
             radius: shape.radius, enclosure: placement.enclosure };
  });
  const bounds: Bounds = { left: Infinity, right: -Infinity, top: 0, bottom: Infinity };
  const include = (x: number, z: number, halfWidth: number, halfHeight: number) => {
    bounds.left = Math.min(bounds.left, x - halfWidth);
    bounds.right = Math.max(bounds.right, x + halfWidth);
    bounds.bottom = Math.min(bounds.bottom, z - halfHeight);
  };
  for (const item of cables) include(item.x, item.z, item.radius, item.radius);
  for (const enclosure of section.enclosures ?? []) include(enclosure.x, enclosure.z, (enclosure.outer_diameter ?? 0) / 2, (enclosure.outer_diameter ?? 0) / 2);
  if (section.backfill) include(section.backfill.x, section.backfill.z, section.backfill.width / 2, section.backfill.height / 2);
  return { cables, bounds, shape };
}

/** A viewport that shows the ground line, every object and room for dimensions; uniform scale. */
export function fit(bounds: Bounds, width: number, height: number, margin: { top: number; right: number; bottom: number; left: number }) {
  const spanX = Math.max(bounds.right - bounds.left, .2);
  const spanZ = Math.max(bounds.top - bounds.bottom, .2);
  const scale = Math.min((width - margin.left - margin.right) / spanX, (height - margin.top - margin.bottom) / spanZ);
  const centreX = (bounds.left + bounds.right) / 2;
  const originX = margin.left + (width - margin.left - margin.right) / 2 - centreX * scale;
  const originY = margin.top + ((height - margin.top - margin.bottom) - spanZ * scale) / 2;
  return { scale, x: (value: number) => originX + value * scale, y: (z: number) => originY + (bounds.top - z) * scale };
}

/** Colour for a conductor temperature between the ambient and the limit: cool blue to hot red. */
export function heat(temperature: number, ambient: number, limit: number): string {
  const ratio = Math.max(0, Math.min(1.15, (temperature - ambient) / Math.max(1, limit - ambient)));
  const stops: [number, [number, number, number]][] = [[0, [59, 130, 196]], [.45, [86, 178, 124]], [.75, [234, 179, 60]], [1, [220, 76, 60]], [1.15, [150, 30, 40]]];
  const upper = stops.findIndex(([at]) => ratio <= at);
  if (upper <= 0) return `rgb(${stops[0][1].join(',')})`;
  const [a, colourA] = stops[upper - 1];
  const [b, colourB] = stops[upper];
  const t = (ratio - a) / (b - a);
  return `rgb(${colourA.map((channel, index) => Math.round(channel + (colourB[index] - channel) * t)).join(',')})`;
}
