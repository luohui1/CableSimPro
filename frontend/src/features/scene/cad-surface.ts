import type { CadScene } from '../cad/types';
import { validateGeometry } from '../cad/geometry-contract';
import { decodeMesh, primitiveMesh } from '../cad/display-mesh';
import { metreTransform } from './blender-bridge';
import { compose, validateSurface, type SurfaceModel } from './surface-model';

export function cadSurface(scene: CadScene): SurfaceModel {
  validateGeometry(scene);
  const model: SurfaceModel = { identity: scene.input_sha256, bounds: scene.crop_bounds_m,
    objects: scene.objects.map(o => ({ id: o.id, label: o.label || o.id, kind: o.kind, bounds: o.bounds_m })), geometries: {}, draws: [] };
  const meshes = new Map<string, ReturnType<typeof decodeMesh>>();
  for (const object of scene.objects) for (const part of object.parts) {
    const asset = scene.assets[part.asset_id];
    let mesh = meshes.get(part.asset_id);
    if (!mesh) {
      if (!asset.display_mesh && !(scene.envelope && asset.primitive)) throw new Error('此资产只有精确 B-Rep，请切换几何工具；场景视图不会猜测显示网格。');
      mesh = asset.display_mesh ? decodeMesh(asset.display_mesh) : primitiveMesh(scene.length_m, asset);
      meshes.set(part.asset_id, mesh);
    }
    const placement = metreTransform(part.transform_mm);
    mesh.prototypes.forEach((prototype, index) => {
      const key = JSON.stringify([part.asset_id, index]);
      if (!prototype.positions || !prototype.triangles) throw new Error('显示网格未解码。');
      if (!model.geometries[key]) model.geometries[key] = { positions: Array.from(prototype.positions, v => v / 1000), triangles: prototype.triangles };
      model.draws.push({ geometry: key, objectId: object.id, category: asset.category || 'unknown', transforms: prototype.instances.map(matrix => compose(placement, metreTransform(matrix))) });
    });
  }
  validateSurface(model);
  return model;
}
