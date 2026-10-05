import type { CadGeometry, CadLayer, CadModel, CadSelection } from './types';

export const identityTransform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] as const;
export const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
export const layerId = (layer: CadLayer) => layer.entity || layer.role;

function finiteBounds(value: readonly number[] | undefined): value is readonly number[] {
  return !!value && value.length === 6 && value.every(Number.isFinite)
    && value[0] <= value[3] && value[1] <= value[4] && value[2] <= value[5];
}

export function validateGeometry(geometry: CadGeometry): void {
  if (!geometry || geometry.brep_unit !== 'mm' || !Number.isFinite(geometry.length_m) || geometry.length_m <= 0) {
    throw new Error('geometry.length_m：需要有效的米制长度及 mm 显示工件。');
  }
  if (geometry.schema === 'cablesim.cad-model/1') {
    if (geometry.axis !== '+Z' || !Number.isFinite(geometry.outer_diameter_m) || geometry.outer_diameter_m <= 0
        || !Array.isArray(geometry.layers) || !geometry.layers.length || geometry.layers.length > 32) {
      throw new Error('geometry.layers：需要单根电缆的有效同轴实体。');
    }
    const ids = new Set<string>();
    for (const layer of geometry.layers) {
      if (!Number.isFinite(layer.inner_radius_m) || !Number.isFinite(layer.outer_radius_m)
          || layer.inner_radius_m < 0 || layer.outer_radius_m <= layer.inner_radius_m
          || (!geometry.envelope && !layer.brep_text && !layer.display_mesh) || ids.has(layerId(layer))) {
        throw new Error(`geometry.layers.${layer.role}：尺寸、稳定标识或显示实体无效，请重新取得几何工件。`);
      }
      ids.add(layerId(layer));
    }
    return;
  }
  if (geometry.schema !== 'cablesim.cad-scene/1' || geometry.coordinate_frame !== 'x/y/z'
      || geometry.extrusion_axis !== '+Y' || !finiteBounds(geometry.crop_bounds_m)
      || !Array.isArray(geometry.objects) || !geometry.objects.length || geometry.objects.length > 128) {
    throw new Error('geometry.objects：敷设场景的坐标、边界或对象契约无效。');
  }
  const ids = new Set<string>();
  let parts = 0;
  for (const object of geometry.objects) {
    if (ids.has(object.id) || !finiteBounds(object.bounds_m) || !object.parts.length) {
      throw new Error(`geometry.objects.${object.id}：对象标识、边界或实体无效。`);
    }
    ids.add(object.id);
    for (const part of object.parts) {
      const asset = geometry.assets[part.asset_id];
      if (!asset?.geometry_key || (!asset.display_mesh && !asset.brep_text && !(geometry.envelope && asset.primitive))
          || part.transform_mm.length !== 12 || !part.transform_mm.every(Number.isFinite)) {
        throw new Error(`geometry.objects.${object.id}：缺少显示资产或有效刚体位姿。`);
      }
      parts += 1;
    }
  }
  if (parts > 512) throw new Error('geometry.objects：显示实体超过当前视口的 512 个上限。');
}

export function selectionIndex(geometry: CadGeometry, selected: CadSelection): number {
  if (!selected) return -1;
  if (geometry.schema === 'cablesim.cad-model/1') {
    return selected.kind === 'layer' ? geometry.layers.findIndex(layer => layerId(layer) === selected.id) : -1;
  }
  return selected.kind === 'object' ? geometry.objects.findIndex(object => object.id === selected.id) : -1;
}

export function matchingExactModel(previous: CadModel, exact: CadModel): void {
  validateGeometry(exact);
  if (exact.envelope || exact.input_sha256 !== previous.input_sha256 || exact.length_m !== previous.length_m
      || exact.outer_diameter_m !== previous.outer_diameter_m || exact.layers.length !== previous.layers.length
      || exact.layers.some((layer, index) => !layer.brep_text || layerId(layer) !== layerId(previous.layers[index])
        || layer.inner_radius_m !== previous.layers[index].inner_radius_m
        || layer.outer_radius_m !== previous.layers[index].outer_radius_m
        || layer.material !== previous.layers[index].material || layer.category !== previous.layers[index].category
        || previous.layers[index].construction && constructionIdentity(layer.construction) !== constructionIdentity(previous.layers[index].construction)
        || (previous.layers[index].geometry_key && layer.geometry_key !== previous.layers[index].geometry_key))) {
    throw new Error('精确拓扑与当前输入、展示长度或层尺寸不一致；保留原显示，不采用过期工件。');
  }
}

function constructionIdentity(value: unknown): string {
  function ordered(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item)
      .sort(([first], [second]) => first.localeCompare(second)).map(([key, nested]) => [key, ordered(nested)]));
    return item;
  }
  return JSON.stringify(ordered(value ?? null));
}
