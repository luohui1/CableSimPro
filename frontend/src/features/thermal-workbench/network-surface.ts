import type { Network } from './data';
import { annulus, identity, type SurfaceModel } from '../scene/surface-model';
/** Reconstruct only the exported concentric-equivalent radii; never invent wire strands. */
export function networkSurface(network: Network, inputIdentity: string): SurfaceModel {
  const length = 0.6, outer = network.layers[network.layers.length - 1].radius;
  const categories = ['conductor', 'semiconductor', 'insulation', 'semiconductor', 'metal', 'polymer'];
  const geometries: SurfaceModel['geometries'] = Object.fromEntries(network.layers.map((layer, index) => [String(index), annulus(index ? network.layers[index - 1].radius : 0, layer.radius, length * (1 - index * 0.1))]));
  const objects = network.positions.map(([x, z], index) => ({ id: `phase:${'ABC'[index]}`, label: `${'ABC'[index]} 相`, kind: 'cable', bounds: [x - outer, 0, z - outer, x + outer, length, z + outer] }));
  const bounds = [Math.min(...objects.map(o => o.bounds[0])) - outer, 0, Math.min(...objects.map(o => o.bounds[2])) - outer,
    Math.max(...objects.map(o => o.bounds[3])) + outer, length, Math.max(...objects.map(o => o.bounds[5])) + outer];
  return { identity: inputIdentity, bounds, objects, geometries, draws: network.positions.flatMap(([x, z], index) => network.layers.map((_, layer) => {
    const transform = [...identity] as number[]; transform[3] = x; transform[11] = z;
    return { geometry: String(layer), objectId: objects[index].id, category: categories[layer] || 'unknown', transforms: [transform] };
  })) };
}
