export type Vec3 = readonly [number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const pointDistance = (a: Vec3, b: Vec3) => Math.hypot(...sub(a, b));
/** Ray intersection with the same display triangles and axial clipping as WebGL, in mm. */
export function surfacePoint(data: Float32Array, origin: Vec3, direction: Vec3, cut: number): { point: Vec3; distance: number } | undefined {
  let best: { point: Vec3; distance: number } | undefined;
  for (let i = 0; i < data.length; i += 18) {
    const a: Vec3 = [data[i], data[i + 1], data[i + 2]], b: Vec3 = [data[i + 6], data[i + 7], data[i + 8]], c: Vec3 = [data[i + 12], data[i + 13], data[i + 14]];
    const e1 = sub(b, a), e2 = sub(c, a), h = cross(direction, e2), determinant = dot(e1, h);
    if (Math.abs(determinant) < 1e-10) continue;
    const s = sub(origin, a), u = dot(s, h) / determinant; if (u < -1e-8 || u > 1 + 1e-8) continue;
    const q = cross(s, e1), v = dot(direction, q) / determinant; if (v < -1e-8 || u + v > 1 + 1e-8) continue;
    const distance = dot(e2, q) / determinant; if (distance < 0 || best && distance >= best.distance) continue;
    const point: Vec3 = [origin[0] + distance * direction[0], origin[1] + distance * direction[1], origin[2] + distance * direction[2]];
    if (point[1] <= cut + 1e-7) best = { point, distance };
  }
  return best;
}
export function pixelRay(matrix: ArrayLike<number>, x: number, y: number, width: number, height: number) {
  const rows: Vec3[] = [[matrix[0], matrix[4], matrix[8]], [matrix[1], matrix[5], matrix[9]], [matrix[2], matrix[6], matrix[10]]];
  const value = [x / width * 2 - 1 - matrix[12], y / height * 2 - 1 - matrix[13], -1 - matrix[14]];
  const origin = [0, 1, 2].map(i => rows.reduce((sum, row, j) => sum + row[i] * value[j] / dot(row, row), 0)) as unknown as Vec3;
  const length = Math.hypot(...rows[2]), direction = rows[2].map(v => v / length) as unknown as Vec3;
  return { origin, direction };
}
