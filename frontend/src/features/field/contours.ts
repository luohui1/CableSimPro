/**
 * 标量场的几何计算（与渲染无关，可单测）：等值线（三角形行进）、取点插值、等值线层级。
 * 输入是插件输出的三角网格与节点值；这里只做几何处理，不改变任何数值。
 */
export type Point = readonly [number, number];
export type Triangle = readonly [number, number, number];
export type Segment = readonly [Point, Point];

/** 在 [minimum, maximum] 内取“好看”的等值线层级（步长取 1/2/5×10ⁿ），默认约 8 条。 */
export function contourLevels(minimum: number, maximum: number, target = 8): number[] {
  if (!(maximum > minimum)) return [];
  const raw = (maximum - minimum) / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= raw) ?? 10 * power;
  const levels: number[] = [];
  for (let level = Math.ceil(minimum / step) * step; level < maximum; level += step) {
    if (level > minimum) levels.push(Number(level.toFixed(10)));
  }
  return levels;
}

/** 三角形行进：返回某一层级的等值线线段（每个被穿过的三角形一段）。 */
export function contourSegments(points: readonly Point[], triangles: readonly Triangle[], values: readonly number[], level: number): Segment[] {
  const segments: Segment[] = [];
  const cross = (a: number, b: number): Point => {
    const va = values[a], vb = values[b], t = (level - va) / (vb - va);
    return [points[a][0] + t * (points[b][0] - points[a][0]), points[a][1] + t * (points[b][1] - points[a][1])];
  };
  for (const [a, b, c] of triangles) {
    const crossings: Point[] = [];
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const vp = values[p], vq = values[q];
      if ((vp < level && vq >= level) || (vq < level && vp >= level)) crossings.push(cross(p, q));
    }
    if (crossings.length === 2) segments.push([crossings[0], crossings[1]]);
  }
  return segments;
}

/** 均匀网格桶索引：把三角形按包围盒放入格子，取点时只检查所在格子的三角形。 */
export function buildLocator(points: readonly Point[], triangles: readonly Triangle[], cells = 64) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of points) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const width = (x1 - x0) || 1, height = (y1 - y0) || 1;
  const buckets: number[][] = Array.from({ length: cells * cells }, () => []);
  const cellOf = (value: number, origin: number, span: number) => Math.min(cells - 1, Math.max(0, Math.floor(((value - origin) / span) * cells)));
  triangles.forEach(([a, b, c], index) => {
    const xs = [points[a][0], points[b][0], points[c][0]], ys = [points[a][1], points[b][1], points[c][1]];
    for (let i = cellOf(Math.min(...xs), x0, width); i <= cellOf(Math.max(...xs), x0, width); i++)
      for (let j = cellOf(Math.min(...ys), y0, height); j <= cellOf(Math.max(...ys), y0, height); j++) buckets[j * cells + i].push(index);
  });
  return { bounds: { x0, x1, y0, y1 }, find(x: number, y: number): { triangle: number; weights: [number, number, number] } | undefined {
    if (x < x0 || x > x1 || y < y0 || y > y1) return undefined;
    for (const index of buckets[cellOf(y, y0, height) * cells + cellOf(x, x0, width)]) {
      const [a, b, c] = triangles[index];
      const [ax, ay] = points[a], [bx, by] = points[b], [cx, cy] = points[c];
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (!det) continue;
      const wa = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
      const wb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
      const wc = 1 - wa - wb;
      if (wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9) return { triangle: index, weights: [wa, wb, wc] };
    }
    return undefined;
  } };
}

/** 取点：在包含该点的三角形内按重心坐标线性插值节点值；点不在网格内返回 undefined。 */
export function probe(locator: ReturnType<typeof buildLocator>, triangles: readonly Triangle[], values: readonly number[], x: number, y: number): number | undefined {
  const hit = locator.find(x, y);
  if (!hit) return undefined;
  const [a, b, c] = triangles[hit.triangle];
  return hit.weights[0] * values[a] + hit.weights[1] * values[b] + hit.weights[2] * values[c];
}
