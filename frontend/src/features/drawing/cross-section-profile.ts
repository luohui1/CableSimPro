/** Explicit design contours. This display geometry never supplies solver quantities. */
import type { WorldPoint } from './types';

export interface CrossSectionProfile {
  kind: 'circle' | 'sector'; x: number; z: number; radius: number; offset: number;
  angle?: number; rotation?: number;
}
interface ConductorProfileInput {
  form: string; diameter: number; sector_angle_deg?: number | null; sector_rotation_deg?: number | null;
}

export function coreProfile(conductor: ConductorProfileInput, x: number, z: number, offset = 0): CrossSectionProfile {
  const profile: CrossSectionProfile = { kind: 'circle', x, z, radius: conductor.diameter / 2, offset };
  if (conductor.form === 'sectoral') {
    if (!Number.isFinite(conductor.sector_angle_deg) || !Number.isFinite(conductor.sector_rotation_deg)
      || conductor.sector_angle_deg! <= 0 || conductor.sector_angle_deg! > 180) {
      throw new Error('conductor.sector_angle_deg / sector_rotation_deg：请填写扇形夹角（0–180°）和朝向。');
    }
    profile.kind = 'sector'; profile.angle = conductor.sector_angle_deg! * Math.PI / 180;
    profile.rotation = conductor.sector_rotation_deg! * Math.PI / 180;
  }
  return profile;
}

function within(direction: number, profile: CrossSectionProfile): boolean {
  const delta = Math.atan2(Math.sin(direction - profile.rotation!), Math.cos(direction - profile.rotation!));
  return Math.abs(delta) <= profile.angle! / 2 + 1e-12;
}
function features(profile: CrossSectionProfile) {
  const points: WorldPoint[] = [{ x: profile.x, z: profile.z }], normals: WorldPoint[] = [];
  if (profile.kind === 'sector') for (const angle of [profile.rotation! - profile.angle! / 2, profile.rotation! + profile.angle! / 2]) {
    points.push({ x: profile.x + profile.radius * Math.cos(angle), z: profile.z + profile.radius * Math.sin(angle) });
    normals.push({ x: -Math.sin(angle), z: Math.cos(angle) });
  }
  return { points, normals };
}
function support(profile: CrossSectionProfile, axis: WorldPoint): number {
  const norm = Math.hypot(axis.x, axis.z);
  let value = profile.radius * norm;
  if (profile.kind === 'sector' && !within(Math.atan2(axis.z, axis.x), profile)) {
    value = Math.max(0, ...[profile.rotation! - profile.angle! / 2, profile.rotation! + profile.angle! / 2]
      .map(angle => profile.radius * (axis.x * Math.cos(angle) + axis.z * Math.sin(angle))));
  }
  return profile.x * axis.x + profile.z * axis.z + value + profile.offset * norm;
}
/** Extremal point of the actual contour, also used for non-crossing layer leaders. */
export function profileSupportPoint(profile: CrossSectionProfile, direction: number): WorldPoint {
  const axis = { x: Math.cos(direction), z: Math.sin(direction) };
  let point = { x: profile.x + profile.radius * axis.x, z: profile.z + profile.radius * axis.z };
  if (profile.kind === 'sector' && !within(direction, profile)) {
    point = features(profile).points.reduce((a, b) => a.x * axis.x + a.z * axis.z >= b.x * axis.x + b.z * axis.z ? a : b);
  }
  return { x: point.x + profile.offset * axis.x, z: point.z + profile.offset * axis.z };
}
/** Local dimensions along/across the sector bisector, independent of its rotation. */
export function sectorSize(profile: CrossSectionProfile) {
  return { heightM: profile.radius + 2 * profile.offset,
    widthM: 2 * profile.radius * Math.sin(profile.angle! / 2) + 2 * profile.offset };
}
export function profilesOverlap(first: CrossSectionProfile, second: CrossSectionProfile): boolean {
  const a = features(first), b = features(second);
  const axes = [{ x: 1, z: 0 }, { x: 0, z: 1 }, ...a.normals, ...b.normals,
    ...a.points.flatMap(p => b.points.map(q => ({ x: q.x - p.x, z: q.z - p.z })))];
  return !axes.some(vector => {
    const norm = Math.hypot(vector.x, vector.z); if (norm < 1e-15) return false;
    const axis = { x: vector.x / norm, z: vector.z / norm }, reverse = { x: -axis.x, z: -axis.z };
    return support(first, axis) + support(second, reverse) <= 1e-12 || support(second, axis) + support(first, reverse) <= 1e-12;
  });
}
export function profileRadius(profile: CrossSectionProfile): number {
  if (profile.kind === 'circle' || within(Math.atan2(profile.z, profile.x), profile)) {
    return Math.hypot(profile.x, profile.z) + profile.radius + profile.offset;
  }
  return Math.max(...features(profile).points.map(p => Math.hypot(p.x, p.z))) + profile.offset;
}

export function profilePath(profile: CrossSectionProfile, project: (point: WorldPoint) => { x: number; y: number }, scale: number): string {
  const point = (x: number, z: number) => { const p = project({ x: profile.x + x, z: profile.z + z }); return `${p.x} ${p.y}`; };
  const radius = profile.radius, offset = profile.offset, outer = radius + offset;
  if (profile.kind === 'circle') return `M${point(outer, 0)}A${outer * scale} ${outer * scale} 0 1 0 ${point(-outer, 0)}A${outer * scale} ${outer * scale} 0 1 0 ${point(outer, 0)}Z`;
  const start = profile.rotation! - profile.angle! / 2, end = profile.rotation! + profile.angle! / 2;
  const a = { x: Math.cos(start), z: Math.sin(start) }, b = { x: Math.cos(end), z: Math.sin(end) };
  if (!offset) return `M${point(0, 0)}L${point(radius * a.x, radius * a.z)}A${radius * scale} ${radius * scale} 0 0 0 ${point(radius * b.x, radius * b.z)}Z`;
  const n = { x: Math.sin(start), z: -Math.cos(start) }, m = { x: -Math.sin(end), z: Math.cos(end) };
  const arc = `A${offset * scale} ${offset * scale} 0 0 0 `;
  return `M${point(offset * n.x, offset * n.z)}L${point(radius * a.x + offset * n.x, radius * a.z + offset * n.z)}`
    + arc + point(outer * a.x, outer * a.z)
    + `A${outer * scale} ${outer * scale} 0 0 0 ${point(outer * b.x, outer * b.z)}`
    + arc + point(radius * b.x + offset * m.x, radius * b.z + offset * m.z)
    + `L${point(offset * m.x, offset * m.z)}` + arc + point(offset * n.x, offset * n.z) + 'Z';
}
