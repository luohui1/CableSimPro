import type { Point, Triangle } from "./contours";

/**
 * 仅供开发版组件陈列：用 Kennelly 线热源叠加生成一个合成土壤温度场，检查渲染效果。
 * 不进入正式构建，也不代表任何工程的计算结果；正式场一律来自插件工件。
 */
export function syntheticKennellyField() {
  const ambient = 25, resistivity = 1.0;
  const cables = [{ x: -0.25, z: -1.2, w: 30.4 }, { x: 0, z: -1.2, w: 31.9 }, { x: 0.25, z: -1.2, w: 30.4 }], radius = 0.08;
  const nx = 90, nz = 70, x0 = -1.6, x1 = 1.6, z0 = -2.6, z1 = 0;
  const points: Point[] = [], values: number[] = [], triangles: Triangle[] = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + (x1 - x0) * i / nx, z = z0 + (z1 - z0) * j / nz;
    let rise = 0;
    for (const cable of cables) {
      const d = Math.max(radius, Math.hypot(x - cable.x, z - cable.z)), image = Math.hypot(x - cable.x, z + cable.z);
      rise += resistivity * cable.w / (2 * Math.PI) * Math.log(image / d);
    }
    points.push([x, z]); values.push(ambient + rise);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    triangles.push([a, b, d], [a, d, c]);
  }
  let hot = 0;
  values.forEach((value, index) => { if (value > values[hot]) hot = index; });
  return { points, triangles, values, circles: cables.map((cable, index) => ({ x: cable.x, z: cable.z, r: radius, label: `回路 ${index + 1}` })), hotspot: { point: points[hot], value: values[hot], label: "最高" } };
}
