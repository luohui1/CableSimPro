import type { CadScene, DisplayMesh, SceneAsset } from '../cad/types';

export type SceneSource = {
  workspace_id: string;
  study_id: string;
  section_id: string;
  workspace_revision: number;
};
export type BlenderScene = {
  schema: 'cablesim.blender-scene/1';
  purpose: 'visualization-only';
  unit: 'm';
  coordinate_frame: 'right-handed-z-up';
  extrusion_axis: '+Y';
  input_sha256: string;
  source: SceneSource;
  representation: 'display-mesh' | 'display-envelope';
  bounds_m: number[];
  assets: { id: string; geometry_key: string; material: string | null; category: string; prototypes: { positions_m: number[]; triangles: number[]; transforms_m: number[][] }[] }[];
  objects: { id: string; label: string; kind: string; parts: { asset_id: string; transform_m: number[] }[] }[];
};
const budget = { vertices: 500_000, triangles: 1_000_000, instances: 8_192, bytes: 64 * 1024 * 1024 };

function finite(values: readonly number[], name: string) {
  if (!values.every(Number.isFinite)) throw new Error(`${name} 包含非有限数值。`);
}

/** OCCT row-major 3x4 affine transform: translations are at 3, 7, 11. */
export function metreTransform(values: readonly number[]): number[] {
  if (values.length !== 12) throw new Error('显示位姿必须是 3×4 行主序矩阵。');
  finite(values, '显示位姿');
  const rows = [values.slice(0, 3), values.slice(4, 7), values.slice(8, 11)];
  const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  for (let i = 0; i < 3; i++) for (let j = i; j < 3; j++) {
    if (Math.abs(dot(rows[i], rows[j]) - (i === j ? 1 : 0)) > 1e-5) throw new Error('显示位姿含缩放或剪切，不能作为刚体位姿导出。');
  }
  const [a, b, c] = rows;
  const determinant = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (Math.abs(determinant - 1) > 1e-5) throw new Error('显示位姿包含镜像或无效旋转。');
  return values.map((value, index) => [3, 7, 11].includes(index) ? value / 1000 : value);
}

/** Export the complete supplied scene; viewport visibility never removes engineering objects. */
export function toBlenderScene(scene: CadScene, source: SceneSource, meshForAsset: (asset: SceneAsset) => DisplayMesh): BlenderScene {
  if (scene.schema !== 'cablesim.cad-scene/1' || scene.brep_unit !== 'mm' || scene.coordinate_frame !== 'x/y/z' || scene.extrusion_axis !== '+Y') throw new Error('场景的单位或坐标契约不受支持。');
  if (!/^[a-f0-9]{64}$/.test(scene.input_sha256)) throw new Error('场景缺少完整输入摘要。');
  if (![source.workspace_id, source.study_id, source.section_id].every(value => typeof value === 'string' && value.trim() && value.length <= 256) || !Number.isSafeInteger(source.workspace_revision) || source.workspace_revision < 1) throw new Error('场景缺少工程、研究、截面或修订身份。');
  const bounds = [...scene.crop_bounds_m];
  finite(bounds, '场景边界');
  if (bounds.length !== 6 || bounds.slice(0, 3).some((value, index) => value > bounds[index + 3])) throw new Error('场景边界无效。');
  if (!scene.objects.length || scene.objects.length > 128 || new Set(scene.objects.map(object => object.id)).size !== scene.objects.length) throw new Error('场景对象为空、重复或超过导出范围。');
  const assetIds = new Set<string>();
  let parts = 0;
  const objects = scene.objects.map(object => {
    if (!object.id || !object.parts.length || !['cable', 'enclosure', 'backfill', 'soil', 'ground'].includes(object.kind)) throw new Error('场景对象身份或类型无效。');
    return { id: object.id, label: object.label || object.id, kind: object.kind, parts: object.parts.map(part => {
      if (++parts > 512) throw new Error('场景超过 512 个显示部件。');
      assetIds.add(part.asset_id);
      return { asset_id: part.asset_id, transform_m: metreTransform(part.transform_mm) };
    }) };
  });
  let vertices = 0, triangles = 0, instances = 0;
  const assets = [...assetIds].map(id => {
    const asset = scene.assets[id];
    if (!asset?.geometry_key) throw new Error(`场景资产 ${id} 缺失。`);
    const mesh = meshForAsset(asset);
    if (mesh.schema !== 'cablesim.display-mesh/1' || mesh.unit !== 'mm' || !mesh.prototypes.length) throw new Error(`资产 ${id} 缺少米制可转换显示网格。`);
    return { id, geometry_key: asset.geometry_key, material: asset.material || null, category: asset.category || 'unknown', prototypes: mesh.prototypes.map(prototype => {
      if (!prototype.positions || !prototype.triangles) throw new Error(`资产 ${id} 的显示缓冲区尚未解码。`);
      const positions = Array.from(prototype.positions), indices = Array.from(prototype.triangles);
      const count = positions.length / 3;
      if (!positions.length || positions.length % 3 || !indices.length || indices.length % 3 || !prototype.instances.length) throw new Error(`资产 ${id} 的三角形网格无效。`);
      vertices += count; triangles += indices.length / 3; instances += prototype.instances.length;
      if (vertices > budget.vertices || triangles > budget.triangles || instances > budget.instances) throw new Error('场景超过当前 Blender 交换预算；请缩小场景或降低显示细分。');
      finite(positions, `资产 ${id}`);
      if (indices.some(index => !Number.isSafeInteger(index) || index < 0 || index >= count)) throw new Error(`资产 ${id} 存在越界网格索引。`);
      return { positions_m: positions.map(value => value / 1000), triangles: indices, transforms_m: prototype.instances.map(metreTransform) };
    }) };
  });
  const instanceCounts = new Map(assets.map(asset => [asset.id, asset.prototypes.reduce((sum, prototype) => sum + prototype.transforms_m.length, 0)]));
  const expanded = objects.reduce((sum, object) => sum + object.parts.reduce((count, part) => count + (instanceCounts.get(part.asset_id) || 0), 0), 0);
  if (expanded > budget.instances) throw new Error('展开后的场景实例超过 Blender 交换预算。');
  return { schema: 'cablesim.blender-scene/1', purpose: 'visualization-only', unit: 'm', coordinate_frame: 'right-handed-z-up', extrusion_axis: '+Y', input_sha256: scene.input_sha256, source: { ...source }, representation: scene.envelope ? 'display-envelope' : 'display-mesh', bounds_m: bounds, assets, objects };
}

export function serializeBlenderScene(scene: BlenderScene): string {
  const json = JSON.stringify(scene);
  if (new TextEncoder().encode(json).byteLength > budget.bytes) throw new Error('交换文件超过 64 MiB，未导出。');
  return json;
}
