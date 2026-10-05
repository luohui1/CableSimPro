import { identityTransform } from './geometry-contract';
import type { CadLayer, DisplayMesh, SceneAsset } from './types';

const decoded = new WeakMap<DisplayMesh, DisplayMesh>();

function unpack(encoded: string, kind: 'positions' | 'triangles'): Float32Array | Uint32Array {
  const text = atob(encoded);
  if (text.length % 4) throw new Error('显示网格缓冲区长度无效。');
  const bytes = Uint8Array.from(text, value => value.charCodeAt(0));
  return kind === 'positions' ? new Float32Array(bytes.buffer) : new Uint32Array(bytes.buffer);
}

export function decodeMesh(mesh: DisplayMesh): DisplayMesh {
  if (!mesh.byte_order) return mesh;
  if (mesh.byte_order !== 'little') throw new Error('显示网格字节序不受支持。');
  const previous = decoded.get(mesh);
  if (previous) return previous;
  const value: DisplayMesh = {
    ...mesh,
    prototypes: mesh.prototypes.map(prototype => ({
      ...prototype,
      positions: prototype.positions || unpack(prototype.positions_f32 || '', 'positions'),
      triangles: prototype.triangles || unpack(prototype.triangles_u32 || '', 'triangles'),
    })),
  };
  decoded.set(mesh, value);
  return value;
}

/** An explicitly marked display envelope. Never exported as native geometry or quantities. */
export function annulusMesh(lengthM: number, layer: Pick<CadLayer, 'inner_radius_m' | 'outer_radius_m'>): DisplayMesh {
  const inner = layer.inner_radius_m * 1000;
  const outer = layer.outer_radius_m * 1000;
  const length = lengthM * 1000;
  const count = Math.max(32, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - .08 / outer)) / 4) * 4);
  if (!Number.isFinite(count) || count > 8192) throw new Error('显示包络尺寸超过当前细分范围。');
  const positions: number[] = [];
  const triangles: number[] = [];
  function ring(radius: number, z: number): number {
    const start = positions.length / 3;
    for (let index = 0; index < count; index += 1) {
      const angle = index * Math.PI * 2 / count;
      positions.push(radius * Math.cos(angle), radius * Math.sin(angle), z);
    }
    return start;
  }
  function wall(radius: number, inward: boolean): void {
    const a = ring(radius, 0);
    const b = ring(radius, length);
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;
      triangles.push(...(inward
        ? [a + index, b + next, a + next, a + index, b + index, b + next]
        : [a + index, a + next, b + next, a + index, b + next, b + index]));
    }
  }
  wall(outer, false);
  if (inner) wall(inner, true);
  for (const z of [0, length]) {
    const outside = ring(outer, z);
    const inside = inner ? ring(inner, z) : positions.length / 3;
    if (!inner) positions.push(0, 0, z);
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;
      const cap = inner
        ? [inside + index, outside + index, outside + next, inside + index, outside + next, inside + next]
        : [inside, outside + index, outside + next];
      triangles.push(...(z ? cap : cap.slice().reverse()));
    }
  }
  return { schema: 'cablesim.display-mesh/1', unit: 'mm', deflection_mm: .08,
    prototypes: [{ positions, triangles, instances: [identityTransform] }] };
}

export function primitiveMesh(lengthM: number, asset: SceneAsset): DisplayMesh {
  if (asset.primitive === 'annulus' && asset.inner_radius_m !== undefined && asset.outer_radius_m !== undefined) {
    return annulusMesh(lengthM, { inner_radius_m: asset.inner_radius_m, outer_radius_m: asset.outer_radius_m });
  }
  const bounds = asset.bounds_m;
  if (!bounds || bounds.length !== 6 || !bounds.every(Number.isFinite)) throw new Error('显示包络边界无效。');
  const [x0, y0, z0, x1, y1, z1] = bounds.map(value => value * 1000);
  const positions = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  const triangles = asset.primitive === 'plane' ? [0, 1, 2, 0, 2, 3]
    : [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
      3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
  return { schema: 'cablesim.display-mesh/1', unit: 'mm', deflection_mm: .08,
    prototypes: [{ positions, triangles, instances: [identityTransform] }] };
}
