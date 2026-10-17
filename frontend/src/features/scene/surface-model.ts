/** Metre-based display mesh. It is deliberately not a CAD/topology or solver contract. */
export type Vec3 = [number, number, number];
export type SurfaceGeometry = { positions: ArrayLike<number>; triangles: ArrayLike<number>; scalars?: ArrayLike<number> };
export type SurfaceObject = { id: string; label: string; kind: string; bounds: readonly number[] };
export type SurfaceDraw = { geometry: string; objectId: string; category: string; transforms: readonly (readonly number[])[]; presentationOffset?: Vec3 };
export type SurfaceModel = { identity: string; bounds: readonly number[]; objects: SurfaceObject[]; geometries: Record<string, SurfaceGeometry>; draws: SurfaceDraw[] };
export type SurfaceCamera = { yaw: number; elevation: number; distance: number; target: Vec3 };
export type SurfacePalette = { background: Vec3; line: Vec3; selected: Vec3; materials: Record<string, Vec3>; temperatures: Vec3[] };
export type SurfaceSettings = { selected: string | null; hidden: readonly string[]; slice: number; ghost: boolean; explosion?: number };
export type SurfaceProjection = { id: string; label: string; x: number; y: number };
export const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] as const;
export function compose(a: readonly number[], b: readonly number[]): number[] {
  const c: number[] = [];
  for (let r = 0; r < 3; r++) for (let col = 0; col < 4; col++) c.push(a[r * 4] * b[col] + a[r * 4 + 1] * b[4 + col] + a[r * 4 + 2] * b[8 + col] + (col === 3 ? a[r * 4 + 3] : 0));
  return c;
}
export const add = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: readonly number[], s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: readonly number[], b: readonly number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function normalize(a: readonly number[]): Vec3 { const length = Math.hypot(...a); return length > 0 ? scale(a, 1 / length) : [0, 0, 1]; }
export function point(m: readonly number[], p: readonly number[]): Vec3 { return [m[0]*p[0]+m[1]*p[1]+m[2]*p[2]+m[3], m[4]*p[0]+m[5]*p[1]+m[6]*p[2]+m[7], m[8]*p[0]+m[9]*p[1]+m[10]*p[2]+m[11]]; }
export function inverseDirection(m: readonly number[], p: readonly number[]): Vec3 { return [m[0]*p[0]+m[4]*p[1]+m[8]*p[2],m[1]*p[0]+m[5]*p[1]+m[9]*p[2],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]]; }
export function intersectTriangle(origin: Vec3, direction: Vec3, a: Vec3, b: Vec3, c: Vec3): number | null {
  const e1 = sub(b, a), e2 = sub(c, a), h = cross(direction, e2), determinant = dot(e1, h);
  if (Math.abs(determinant) < 1e-12) return null;
  const s = sub(origin, a), u = dot(s, h) / determinant;
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1), v = dot(direction, q) / determinant;
  if (v < 0 || u + v > 1) return null;
  const t = dot(e2, q) / determinant;
  return t >= 0 ? t : null;
}
export function validBounds(bounds: readonly number[]): boolean {
  return bounds.length === 6 && bounds.every(Number.isFinite) && bounds.slice(0, 3).every((v, i) => v <= bounds[i + 3]);
}
export function validateSurface(model: SurfaceModel): void {
  if (!model.identity || !validBounds(model.bounds) || !model.objects.length || model.objects.length > 128 || model.draws.length > 512) throw new Error('场景身份、边界或对象数无效。');
  const ids = new Set(model.objects.map(o => o.id));
  if (ids.size !== model.objects.length || model.objects.some(o => !o.id || !validBounds(o.bounds))) throw new Error('场景对象身份重复或边界无效。');
  let vertices = 0, triangles = 0, instances = 0, expandedTriangles = 0;
  for (const g of Object.values(model.geometries)) {
    vertices += g.positions.length / 3; triangles += g.triangles.length / 3;
    if (!g.positions.length || g.positions.length % 3 || !g.triangles.length || g.triangles.length % 3 || vertices > 500_000 || triangles > 1_000_000) throw new Error('显示网格无效或超过显示预算。');
    for (let i = 0; i < g.positions.length; i++) if (!Number.isFinite(g.positions[i]) || Math.abs(g.positions[i]) > 1e9) throw new Error('网格坐标非有限。');
    if (g.scalars && (g.scalars.length !== g.positions.length / 3 || Array.from(g.scalars).some(v => !Number.isFinite(v) || v < 0 || v > 1))) throw new Error('温度颜色映射无效。');
    for (let i = 0; i < g.triangles.length; i++) if (!Number.isInteger(g.triangles[i]) || g.triangles[i] < 0 || g.triangles[i] >= g.positions.length / 3) throw new Error('三角形索引越界。');
  }
  for (const draw of model.draws) {
    if (draw.presentationOffset && (draw.presentationOffset.length !== 3 || !draw.presentationOffset.every(Number.isFinite) || Math.hypot(...draw.presentationOffset) > 100)) throw new Error('装配展示位移无效或超过预算。');
    instances += draw.transforms.length;
    if (!ids.has(draw.objectId) || !model.geometries[draw.geometry] || !draw.transforms.length || instances > 8192) throw new Error('显示实例无效或超过预算。');
    expandedTriangles += model.geometries[draw.geometry].triangles.length / 3 * draw.transforms.length;
    if (expandedTriangles > 4_000_000) throw new Error('展开三角形超过显示预算，请降低细分或减少对象。');
    for (const m of draw.transforms) {
      if (m.length !== 12 || !m.every(Number.isFinite)) throw new Error('场景位姿无效。');
      const rows = [m.slice(0, 3), m.slice(4, 7), m.slice(8, 11)];
      for (let i = 0; i < 3; i++) for (let j = i; j < 3; j++) if (Math.abs(dot(rows[i], rows[j]) - (i === j ? 1 : 0)) > 1e-5) throw new Error('场景位姿含缩放或剪切。');
      if (Math.abs(dot(rows[0], cross(rows[1], rows[2])) - 1) > 1e-5) throw new Error('场景位姿含镜像。');
    }
  }
}
/** Display annulus along +Y; duplicate cap vertices keep flat end faces. */
export function annulus(inner: number, outer: number, length: number, segments = 128): SurfaceGeometry {
  if (!(inner >= 0 && outer > inner && length > 0) || ![inner, outer, length].every(Number.isFinite) || !Number.isInteger(segments) || segments < 12 || segments > 512) throw new Error('显示圆环尺寸无效。');
  const positions: number[] = [], triangles: number[] = [];
  function ring(r: number, y: number): number { const start = positions.length / 3; for (let i = 0; i < segments; i++) { const angle = i * 2 * Math.PI / segments; positions.push(r * Math.cos(angle), y, r * Math.sin(angle)); } return start; }
  for (const [r, inward] of [[outer, false], ...(inner > 0 ? [[inner, true]] : [])] as [number, boolean][]) {
    const a = ring(r, 0), b = ring(r, length);
    for (let i = 0; i < segments; i++) { const j = (i + 1) % segments; const face = [a+i,b+j,a+j,a+i,b+i,b+j]; triangles.push(...(inward ? face.reverse() : face)); }
  }
  for (const y of [0, length]) {
    const a = ring(outer, y), b = inner ? ring(inner, y) : positions.length / 3;
    if (!inner) positions.push(0, y, 0);
    for (let i = 0; i < segments; i++) { const j = (i + 1) % segments; const face = inner ? [b+i,a+j,a+i,b+i,b+j,a+j] : [b,a+j,a+i]; triangles.push(...(y ? face : face.reverse())); }
  }
  return { positions, triangles };
}
