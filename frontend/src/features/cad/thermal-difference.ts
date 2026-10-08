import type { CadThermal } from './types';
type Point = readonly [number, number];
const cross = (a: Point, b: Point, p: Point) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const area = (p: readonly Point[]) => p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]; return sum + a[0] * b[1] - a[1] * b[0]; }, 0) / 2;
function clip(subject: Point[], triangle: Point[]) {
  const sign = Math.sign(area(triangle));
  if (!sign) return [];
  for (let i = 0; i < 3 && subject.length; i++) {
    const a = triangle[i], b = triangle[(i + 1) % 3], next: Point[] = [];
    for (let j = 0; j < subject.length; j++) {
      const p = subject[j], q = subject[(j + 1) % subject.length], dp = cross(a, b, p) * sign, dq = cross(a, b, q) * sign;
      if (dp >= -1e-12) next.push(p);
      if ((dp > 1e-12 && dq < -1e-12) || (dp < -1e-12 && dq > 1e-12)) {
        const t = dp / (dp - dq); next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    subject = next;
  }
  return subject;
}
function interpolate(field: CadThermal, tri: readonly number[], p: Point) {
  const [a, b, c] = tri.map(i => field.points[i]), determinant = cross(a, b, c);
  if (Math.abs(determinant) < 1e-16) throw Error('保存网格含退化单元，拒绝绘制差值。');
  const wa = cross(b, c, p) / determinant, wb = cross(c, a, p) / determinant;
  return wa * field.values[tri[0]] + wb * field.values[tri[1]] + (1 - wa - wb) * field.values[tri[2]];
}
/** Piecewise linear saved-node visualization on exact triangle intersections; no extrapolation or solver. */
export function differenceField(fem: CadThermal, iec: CadThermal): CadThermal {
  if (fem.kind !== 'fem' || iec.kind !== 'iec') throw Error('差值需要有限元和 IEC 两侧保存温度场。');
  const bounds = (p: readonly Point[]) => [Math.min(...p.map(v => v[0])), Math.min(...p.map(v => v[1])), Math.max(...p.map(v => v[0])), Math.max(...p.map(v => v[1]))];
  // Spatial bins bound candidate work even for nonmatching FEM / analytical meshes.
  let xmin = Infinity, zmin = Infinity, xmax = -Infinity, zmax = -Infinity;
  for (const p of iec.points) { xmin = Math.min(xmin, p[0]); xmax = Math.max(xmax, p[0]); zmin = Math.min(zmin, p[1]); zmax = Math.max(zmax, p[1]); }
  const cells = Math.min(128, Math.max(1, Math.ceil(Math.sqrt(iec.triangles.length / 4))));
  const dx = Math.max(1e-9, xmax - xmin) / cells, dz = Math.max(1e-9, zmax - zmin) / cells;
  const bins = new Map<string, number[]>();
  const keys = (b: number[]) => {
    const result: string[] = [];
    for (let x = Math.max(0, Math.floor((b[0] - xmin) / dx)); x <= Math.min(cells - 1, Math.floor((b[2] - xmin) / dx)); x++)
      for (let z = Math.max(0, Math.floor((b[1] - zmin) / dz)); z <= Math.min(cells - 1, Math.floor((b[3] - zmin) / dz)); z++) result.push(`${x}/${z}`);
    return result;
  };
  const polygons = iec.triangles.map(t => t.map(i => iec.points[i]));
  polygons.forEach((p, i) => keys(bounds(p)).forEach(key => { const list = bins.get(key) || []; list.push(i); bins.set(key, list); }));
  const points: [number, number][] = [], triangles: [number, number, number][] = [], values: number[] = [];
  for (const triangle of fem.triangles) {
    const polygon = triangle.map(i => fem.points[i]);
    const candidates = new Set(keys(bounds(polygon)).flatMap(key => bins.get(key) || []));
    for (const index of candidates) {
      const shared = clip(polygon, polygons[index]);
      if (shared.length < 3 || Math.abs(area(shared)) < 1e-14) continue;
      const start = points.length;
      for (const p of shared) { points.push([p[0], p[1]]); values.push(interpolate(fem, triangle, p) - interpolate(iec, iec.triangles[index], p)); }
      for (let i = 1; i < shared.length - 1; i++) triangles.push([start, start + i, start + i + 1]);
      if (triangles.length > 500000) throw Error('差值网格超过显示容量；请使用较小的保存网格。');
    }
  }
  if (!triangles.length) throw Error('两侧保存场没有共同覆盖区域，不能绘制差值。');
  let maximum = 0; for (const value of values) { if (!Number.isFinite(value)) throw Error('保存场插值无效。'); maximum = Math.max(maximum, Math.abs(value)); }
  const conductors = fem.conductors.flatMap(c => {
    const other = iec.conductors.find(v => v.id === c.id && v.coreId === c.coreId);
    return other ? [{ ...c, value: c.value - other.value, hottest: false }] : [];
  });
  const hottest = conductors.reduce<typeof conductors[number] | undefined>((a, b) => !a || Math.abs(b.value) > Math.abs(a.value) ? b : a, undefined);
  if (hottest) hottest.hottest = true;
  maximum = Math.max(maximum, ...conductors.map(c => Math.abs(c.value)), 1e-6);
  return { runId: fem.runId, caseId: fem.caseId, kind: 'difference', notice: fem.notice, source: `有限元 − IEC；保存单元线性插值；仅共同覆盖区域 · ${fem.source} · ${iec.source}`,
    references: [fem, iec].map(({ runId, caseId, source }) => ({ runId, caseId, source })), points, triangles, values, conductors, minimum: -maximum, maximum };
}
