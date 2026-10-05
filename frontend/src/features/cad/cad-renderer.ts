import { annulusMesh, decodeMesh, primitiveMesh } from './display-mesh';
import { layerId, selectionIndex, validateGeometry } from './geometry-contract';
import { checked, type NativeViewer } from './occt-runtime';
import type { CadGeometry, CadLayer, CadMode, CadScene, CadSelection, SceneAsset, SceneObject } from './types';

const materialTokens: Record<string, string> = {
  conductor: '--conductor', semiconductor: '--material-semi', insulation: '--material-insulation',
  metal: '--material-metal', polymer: '--material-sheath', filler: '--fill',
};
const priorities = { cable: 3, enclosure: 2, backfill: 1, soil: 0, ground: -1 };
const opacities = { cable: 1, enclosure: .45, backfill: .20, soil: .08, ground: .08 };
interface RenderedPart { key: string; radial: string; appearance: string; mesh: boolean }
interface ScenePart { asset: SceneAsset; object: SceneObject; group: number; transform: readonly number[] }

export function tokenColor(host: HTMLElement, token: string): number[] {
  const value = getComputedStyle(host).getPropertyValue(token).trim();
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const text = hex[1].length === 3 ? [...hex[1]].map(character => character + character).join('') : hex[1];
    return [0, 2, 4].map(index => parseInt(text.slice(index, index + 2), 16) / 255);
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (rgb) return rgb.slice(1, 4).map(channel => Number(channel) / 255);
  throw new Error(`画布颜色令牌 ${token} 不可用。`);
}

/** Only displays supplied artifacts. The envelope cache contains no engineering quantities. */
export class CadRenderer {
  geometry: CadGeometry | null = null;
  selection: CadSelection = null;
  mode: CadMode = 'peel';
  section = .55;
  measurement = 'part';
  private rendered: RenderedPart[] = [];
  private nativeSchema: CadGeometry['schema'] | null = null;
  private sceneParts: ScenePart[] = [];
  private envelopes = new Map<string, ReturnType<typeof annulusMesh>>();
  private shapes = new Map<string, string>();

  constructor(private native: NativeViewer, private host: HTMLElement) {}

  private radialKey(length: number, layer: CadLayer) {
    return JSON.stringify([length, layer.inner_radius_m, layer.outer_radius_m, layer.material, layer.category, layer.center_m, layer.section_profile]);
  }

  private envelope(length: number, layer: CadLayer) {
    const key = this.radialKey(length, layer);
    let mesh = this.envelopes.get(key);
    if (!mesh) {
      mesh = annulusMesh(length, layer);
      if (this.envelopes.size >= 48) this.envelopes.delete(this.envelopes.keys().next().value!);
      this.envelopes.set(key, mesh);
    }
    return mesh;
  }

  private nativeShape(length: number, layer: CadLayer): string {
    if (layer.brep_text) return layer.brep_text;
    const key = this.radialKey(length, layer);
    let shape = this.shapes.get(key);
    if (!shape) {
      const result = checked(this.native.envelopeBrep(layer.inner_radius_m * 1000, layer.outer_radius_m * 1000, length * 1000));
      if (typeof result !== 'string') throw new Error('原生显示包络创建失败。');
      shape = result;
      if (this.shapes.size >= 48) this.shapes.delete(this.shapes.keys().next().value!);
      this.shapes.set(key, shape);
    }
    return shape;
  }

  private appearance(geometry: CadGeometry, layer: CadLayer | SceneAsset, object?: SceneObject) {
    const material = geometry.schema === 'cablesim.cad-model/1'
      ? geometry.material_sources?.find(item => item.id === layer.material) : null;
    const isCopper = layer.category === 'metal' && /copper|铜/i.test(material?.label || '');
    const token = object && object.kind !== 'cable'
      ? object.kind === 'ground' ? '--border' : object.kind === 'soil' && object.tint_index ? '--material-metal' : '--text-secondary'
      : isCopper ? '--conductor' : materialTokens[layer.category || ''] || '--material-sheath';
    return [
      ...tokenColor(this.host, token),
      !object || object.kind === 'cable' ? ['conductor', 'metal'].includes(layer.category || '') : false,
      geometry.length_m * 1000,
      (layer.inner_radius_m || 0) * 1000,
      (layer.outer_radius_m || 0) * 1000,
      'construction' in layer ? (layer as CadLayer).construction?.wire_diameter ? (layer as CadLayer).construction!.wire_diameter! * 1000 : 0 : 0,
    ];
  }

  private replace(index: number, mesh: ReturnType<typeof annulusMesh> | null, brep: string | undefined,
    appearance: (number | boolean)[], exists: boolean) {
    const result = mesh
      ? exists ? this.native.replaceMeshPart(index, mesh, ...appearance) : this.native.addMeshPart(mesh, ...appearance)
      : exists ? this.native.replacePart(index, brep || '', ...appearance) : this.native.addPart(brep || '', ...appearance);
    checked(result);
  }

  async apply(geometry: CadGeometry, current: () => boolean, progress?: (done: number, total: number) => void) {
    validateGeometry(geometry);
    const modelChanged = this.nativeSchema !== geometry.schema;
    const count = geometry.schema === 'cablesim.cad-model/1'
      ? geometry.layers.length : geometry.objects.reduce((sum, object) => sum + object.parts.length, 0);
    if (modelChanged || count !== this.rendered.length) {
      this.native.clearModel();
      this.rendered = [];
    }
    this.nativeSchema = geometry.schema;
    this.native.measurePair(false);
    const started = performance.now();
    const result = geometry.schema === 'cablesim.cad-model/1'
      ? await this.applyModel(geometry, current, progress) : await this.applyScene(geometry, current, progress);
    if (!current()) return null;
    this.geometry = geometry;
    this.finish();
    return { ...result, elapsedMs: performance.now() - started };
  }

  private async applyModel(geometry: Extract<CadGeometry, { schema: 'cablesim.cad-model/1' }>,
    current: () => boolean, progress?: (done: number, total: number) => void) {
    let replacedParts = 0;
    let yieldedAt = performance.now();
    for (const [index, layer] of geometry.layers.entries()) {
      if (!current()) break;
      const previous = this.rendered[index];
      const radial = this.radialKey(geometry.length_m, layer);
      const appearance = this.appearance(geometry, layer);
      const representation = geometry.envelope ? 'envelope' : this.measurement === 'part' && layer.display_mesh ? 'mesh' : 'brep';
      const palette = JSON.stringify(appearance);
      const key = JSON.stringify([layer.geometry_key || layer.brep_text || radial, layer.category, palette, representation]);
      const retainedPrecise = geometry.envelope && previous?.radial === radial && previous.appearance === palette && !previous.mesh;
      if (!retainedPrecise && previous?.key !== key) {
        const mesh = geometry.envelope ? this.envelope(geometry.length_m, layer)
          : this.measurement === 'part' && layer.display_mesh ? decodeMesh(layer.display_mesh) : null;
        this.replace(index, mesh, mesh ? undefined : this.nativeShape(geometry.length_m, layer), appearance, !!previous);
        this.rendered[index] = { key, radial, appearance: palette, mesh: !!mesh };
        replacedParts += 1;
      }
      checked(this.native.configureModelPart(index, layer.section_outline_brep || '',
        layer.peel_fraction ?? 1 - index / Math.max(1, geometry.layers.length - 1) * .55));
      progress?.(index + 1, geometry.layers.length);
      if (index + 1 < geometry.layers.length && performance.now() - yieldedAt > 50) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        yieldedAt = performance.now();
      }
    }
    return { replacedParts, reusedParts: geometry.layers.length - replacedParts };
  }

  private async applyScene(geometry: CadScene, current: () => boolean, progress?: (done: number, total: number) => void) {
    const flat = geometry.objects.flatMap((object, group) => object.parts.map(part => ({
      asset: geometry.assets[part.asset_id], object, group, transform: part.transform_mm,
    })));
    checked(this.native.configureScene(geometry.crop_bounds_m.map(value => value * 1000),
      geometry.objects.map(object => ({ bounds: object.bounds_m.map(value => value * 1000),
        kind: object.kind, priority: priorities[object.kind] }))));
    let replacedParts = 0;
    let yieldedAt = performance.now();
    for (const [index, part] of flat.entries()) {
      if (!current()) break;
      const appearance = this.appearance(geometry, part.asset, part.object);
      const key = JSON.stringify([part.asset.geometry_key, part.asset.category, appearance]);
      const previous = this.rendered[index];
      if (previous?.key !== key) {
        const mesh = geometry.envelope && part.asset.primitive ? primitiveMesh(geometry.length_m, part.asset)
          : part.asset.display_mesh ? decodeMesh(part.asset.display_mesh) : null;
        this.replace(index, mesh, part.asset.brep_text, appearance, !!previous);
        this.rendered[index] = { key, radial: key, appearance: JSON.stringify(appearance), mesh: !!mesh };
        replacedParts += 1;
      }
      checked(this.native.setScenePart(index, part.group, part.transform, opacities[part.object.kind], part.object.kind !== 'ground'));
      progress?.(index + 1, flat.length);
      if (index + 1 < flat.length && performance.now() - yieldedAt > 50) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        yieldedAt = performance.now();
      }
    }
    this.sceneParts = flat;
    return { replacedParts, reusedParts: flat.length - replacedParts };
  }

  representative(index: number): number {
    if (this.geometry?.schema !== 'cablesim.cad-scene/1') return index;
    let selected = -1;
    let radius = -1;
    for (const [partIndex, part] of this.sceneParts.entries()) {
      if (part.group === index && (part.asset.outer_radius_m || 0) > radius) {
        radius = part.asset.outer_radius_m || 0;
        selected = partIndex;
      }
    }
    return selected;
  }

  finish(): void {
    const geometry = this.geometry;
    if (!geometry) return;
    const diameter = geometry.schema === 'cablesim.cad-model/1' ? geometry.outer_diameter_m
      : Math.max(geometry.crop_bounds_m[3] - geometry.crop_bounds_m[0], .001);
    const selected = this.representative(selectionIndex(geometry, this.selection));
    this.native.finishUpdate(diameter * 1000, this.mode, selected, this.measurement, this.section);
  }

  select(selection: CadSelection): void {
    this.selection = selection;
    if (!this.geometry) return;
    const index = this.representative(selectionIndex(this.geometry, selection));
    if (index >= 0) this.native.selectPart(index);
    else this.finish();
  }

  selectionForPart(index: number): CadSelection {
    if (this.geometry?.schema === 'cablesim.cad-model/1') {
      const layer = this.geometry.layers[index];
      return layer ? { kind: 'layer', id: layerId(layer) } : null;
    }
    const part = this.sceneParts[index];
    return part ? { kind: 'object', id: part.object.id } : null;
  }

  dispose(): void {
    this.geometry = null;
    this.nativeSchema = null;
    this.rendered = [];
    this.sceneParts = [];
    this.envelopes.clear();
    this.shapes.clear();
  }
}
