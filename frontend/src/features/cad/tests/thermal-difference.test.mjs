import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSources } from './load-source.mjs';
const source = await loadSources(['src/features/cad/thermal-difference.ts', 'src/features/cad/scene-measurement.ts']);
after(() => source.close());
const { differenceField } = await source.import('src/features/cad/thermal-difference.ts');
const { surfacePoint, pixelRay, pointDistance } = await source.import('src/features/cad/scene-measurement.ts');
const points = [[0, 0], [1, 0], [1, 1], [0, 1]];
const field = (kind, values, triangles) => ({ kind, points, triangles, values, runId: kind, caseId: 'case', source: 'hand-check only', conductors: [], minimum: 0, maximum: 50 });
test('Nonmatching meshes: linear FEM (20+2x+3z) minus IEC (10+x+z) is exactly 10+x+2z on their shared square', () => {
  const fem = field('fem', points.map(([x, z]) => 20 + 2 * x + 3 * z), [[0, 1, 2], [0, 2, 3]]);
  const iec = field('iec', points.map(([x, z]) => 10 + x + z), [[0, 1, 3], [1, 2, 3]]);
  const difference = differenceField(fem, iec);
  difference.points.forEach(([x, z], i) => assert.ok(Math.abs(difference.values[i] - (10 + x + 2 * z)) < 1e-10));
  const area = difference.triangles.reduce((sum, [i, j, k]) => { const [a, b, c] = [i, j, k].map(v => difference.points[v]); return sum + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2; }, 0);
  assert.ok(Math.abs(area - 1) < 1e-10); assert.equal(difference.minimum, -13); assert.equal(difference.maximum, 13);
  assert.deepEqual(difference.references.map(r => r.runId), ['fem', 'iec']);
});
test('IEC excluded half-square stays empty: clipping does not bridge an uncovered region', () => {
  const difference = differenceField(field('fem', [30, 30, 30, 30], [[0, 1, 2], [0, 2, 3]]), field('iec', [20, 20, 20, 20], [[0, 1, 3]]));
  assert.ok(difference.points.every(([x, z]) => x + z <= 1 + 1e-12));
  const remote = { ...field('iec', [20, 20, 20, 20], [[0, 1, 3]]), points: points.map(([x, z]) => [x + 10, z]) };
  assert.throws(() => differenceField(field('fem', [30, 30, 30, 30], [[0, 1, 2]]), remote), /共同覆盖区域/);
});
test('Three-dimensional distance matches the 3–4–12 triangle: 13 mm; render-triangle picking and clipping use the same coordinates', () => {
  assert.equal(pointDistance([0, 0, 0], [3, 4, 12]), 13);
  const vertices = new Float32Array([0, 0, 0, 0, 0, 1, 10, 0, 0, 0, 0, 1, 0, 10, 0, 0, 0, 1]);
  assert.deepEqual(surfacePoint(vertices, [3, 4, -20], [0, 0, 1], 10).point, [3, 4, 0]);
  assert.equal(surfacePoint(vertices, [3, 4, -20], [0, 0, 1], 3), undefined);
  const ray = pixelRay([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 75, 50, 100, 100);
  assert.deepEqual(ray, { origin: [.5, 0, -1], direction: [0, 0, 1] });
});
