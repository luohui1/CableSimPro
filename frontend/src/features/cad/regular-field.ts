import type { CadThermal } from './types';
type Point = readonly [number, number];
const cross = (a: Point, b: Point, p: Point) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
function extent(field: CadThermal) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of field.points) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); }
  return b;
}
function sampler(field: CadThermal) {
  const b = extent(field), n = Math.min(128, Math.max(1, Math.ceil(Math.sqrt(field.triangles.length / 4))));
  const dx = (b[2] - b[0]) / n, dz = (b[3] - b[1]) / n, bins = new Map<number, number[]>();
  if (!(dx > 0 && dz > 0)) throw Error('保存场范围无效。');
  const cell = (v: number, axis: number) => Math.max(0, Math.min(n - 1, Math.floor((v - b[axis]) / (axis ? dz : dx))));
  for (const [index, t] of field.triangles.entries()) {
    const p = t.map(i => field.points[i]);
    if (Math.abs(cross(p[0], p[1], p[2])) < 1e-16) throw Error('保存网格含退化单元，拒绝绘制差值。');
    for (let x = cell(Math.min(...p.map(v => v[0])), 0); x <= cell(Math.max(...p.map(v => v[0])), 0); x++)
      for (let z = cell(Math.min(...p.map(v => v[1])), 1); z <= cell(Math.max(...p.map(v => v[1])), 1); z++) {
        const key = x + z * n, list = bins.get(key) || []; list.push(index); bins.set(key, list);
      }
  }
  return (p: Point): number | undefined => {
    if (p[0] < b[0] - 1e-12 || p[0] > b[2] + 1e-12 || p[1] < b[1] - 1e-12 || p[1] > b[3] + 1e-12) return;
    for (const index of bins.get(cell(p[0], 0) + cell(p[1], 1) * n) || []) {
      const t = field.triangles[index], [a, c, d] = t.map(i => field.points[i]), determinant = cross(a, c, d);
      const wa = cross(c, d, p) / determinant, wb = cross(d, a, p) / determinant, wc = 1 - wa - wb;
      if (Math.min(wa, wb, wc) >= -1e-10) {
        const value = wa * field.values[t[0]] + wb * field.values[t[1]] + wc * field.values[t[2]];
        if (!Number.isFinite(value)) throw Error('保存场插值无效。');
        return value;
      }
    }
  };
}
function boundary(field: CadThermal) {
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (const t of field.triangles) for (let i = 0; i < 3; i++) {
    const a = t[i], b = t[(i + 1) % 3], key = a < b ? `${a}/${b}` : `${b}/${a}`;
    const entry = edges.get(key); if (entry) entry.count++; else edges.set(key, { a, b, count: 1 });
  }
  return [...edges.values()].filter(e => e.count === 1).map(e => [field.points[e.a], field.points[e.b]] as const);
}
function crossesCell(a: Point, b: Point, x: number, z: number, dx: number, dz: number) {
  // Mask boundary-crossing cells, even when a hole is smaller than one grid cell.
  let low = 0, high = 1;
  for (const [axis, minimum, maximum] of [[0, x + dx * 1e-8, x + dx * (1 - 1e-8)], [1, z + dz * 1e-8, z + dz * (1 - 1e-8)]]) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-15) { if (a[axis] < minimum || a[axis] > maximum) return false; }
    else { const u = (minimum - a[axis]) / delta, v = (maximum - a[axis]) / delta; low = Math.max(low, Math.min(u, v)); high = Math.min(high, Math.max(u, v)); }
    if (high < low) return false;
  }
  return true;
}
/** Both saved linear fields sampled on one regular grid; no extrapolation or blur. */
export function regularDifferenceMesh(fem: CadThermal, iec: CadThermal, resolution: number) {
  if (!Number.isInteger(resolution) || resolution < 8 || resolution > 256) throw Error('规则显示网格分辨率无效。');
  const a = extent(fem), b = extent(iec), x0 = Math.max(a[0], b[0]), z0 = Math.max(a[1], b[1]), w = Math.min(a[2], b[2]) - x0, h = Math.min(a[3], b[3]) - z0;
  if (!(w > 0 && h > 0)) throw Error('两侧保存场没有共同覆盖区域，不能绘制差值。');
  const nx = Math.max(1, Math.round(resolution * w / Math.max(w, h))), nz = Math.max(1, Math.round(resolution * h / Math.max(w, h))), dx = w / nx, dz = h / nz;
  const left = sampler(fem), right = sampler(iec), blocked = new Set<number>();
  for (const [p, q] of [...boundary(fem), ...boundary(iec)]) {
    for (let x = Math.max(0, Math.floor((Math.min(p[0], q[0]) - x0) / dx)); x <= Math.min(nx - 1, Math.floor((Math.max(p[0], q[0]) - x0) / dx)); x++)
      for (let z = Math.max(0, Math.floor((Math.min(p[1], q[1]) - z0) / dz)); z <= Math.min(nz - 1, Math.floor((Math.max(p[1], q[1]) - z0) / dz)); z++)
        if (crossesCell(p, q, x0 + x * dx, z0 + z * dz, dx, dz)) blocked.add(x + z * nx);
  }
  const points: [number, number][] = [], values: number[] = [], triangles: [number, number, number][] = [], quads: [number, number, number, number][] = [], nodes = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
  for (let z = 0; z <= nz; z++) for (let x = 0; x <= nx; x++) {
    const p: [number, number] = [x0 + x * dx, z0 + z * dz], l = left(p), r = right(p);
    if (l === undefined || r === undefined) continue;
    nodes[x + z * (nx + 1)] = points.length; points.push(p); values.push(l - r);
  }
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const i = x + z * (nx + 1), [p, q, r, s] = [nodes[i], nodes[i + 1], nodes[i + nx + 2], nodes[i + nx + 1]];
    if (blocked.has(x + z * nx) || Math.min(p, q, r, s) < 0) continue;
    const center: Point = [x0 + (x + .5) * dx, z0 + (z + .5) * dz];
    if (left(center) === undefined || right(center) === undefined) continue;
    triangles.push([p, q, r], [p, r, s]);
    quads.push([p, q, r, s]);
  }
  if (!triangles.length) throw Error('两侧保存场没有共同覆盖区域，不能绘制差值。');
  return { points, values, triangles, quads, nx, nz };
}
