import type { SavedField } from './data';
import { identity, type SurfaceModel } from '../scene/surface-model';
/** Show the actual saved x/z node field as a plane. No invented axial field or height. */
export function fieldSurface(field: SavedField, inputIdentity: string): SurfaceModel {
  const positions = field.points.flatMap(([x, z]) => [x, 0, z]);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of field.points) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const bounds = [x0, 0, z0, x1, 0, z1], span = field.maximum - field.minimum;
  return { identity: inputIdentity, bounds, objects: [{ id: 'saved-field', label: '保存节点温度场', kind: 'field', bounds }],
    geometries: { field: { positions, triangles: field.triangles, scalars: field.temperatures.map(t => span ? (t - field.minimum) / span : .5) } },
    draws: [{ geometry: 'field', objectId: 'saved-field', category: 'temperature-field', transforms: [identity] }] };
}
