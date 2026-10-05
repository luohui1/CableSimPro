import type { CableType, LayerTarget, Material } from './types';

export type MaterialRole = 'conductor' | 'semi' | 'insulation' | 'metal' | 'sheath' | 'fill';
export interface DrawingRing {
  id: string;
  target: LayerTarget;
  number: number;
  name: string;
  materialRole: MaterialRole;
  innerM: number;
  outerM: number;
  centerX: number;
  centerZ: number;
}
export interface CableShape { radiusM: number; rings: DrawingRing[]; coreCenters: { x: number; z: number; label: string }[] }

export const layerNames: Record<string, string> = {
  conductor: '导体', conductor_screen: '导体屏蔽', insulation: '绝缘', insulation_screen: '绝缘屏蔽',
  metallic_screen: '金属屏蔽', metallic_sheath: '金属护套', bedding: '内衬', armour: '铠装',
  oversheath: '外护套', binder: '包带', filler: '填充', separator: '隔离层', sheath: '护套',
};
const categories: Record<string, MaterialRole> = {
  conductor: 'conductor', semiconductor: 'semi', insulation: 'insulation', metal: 'metal',
  polymer: 'sheath', filler: 'fill',
};

export const targetId = (target: LayerTarget) => target.scope === 'common'
  ? `common/${target.role}` : `${target.coreId}/${target.role}`;

function positive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field}：请输入以 m 为单位的正尺寸。`);
  return value;
}

export function cableShape(cable: CableType, materials: readonly Material[]): CableShape {
  if (!['single_core', 'three_core'].includes(cable.construction)
      || cable.cores.length !== (cable.construction === 'single_core' ? 1 : 3)) {
    throw new Error('cableType.construction：截面绘图当前支持单芯和三芯圆形层结构。');
  }
  const materialMap = new Map(materials.map(material => [material.id, material]));
  const rings: DrawingRing[] = [];
  let number = 0;
  let radius = 0;
  function ring(target: LayerTarget, inner: number, outer: number, materialId: string, x: number, z: number) {
    const material = materialMap.get(materialId);
    if (!material) throw new Error(`materials.${materialId}：材料引用缺失，未绘制替代材料。`);
    const id = targetId(target);
    if (rings.some(value => value.id === id)) throw new Error(`cableType.${id}：同一堆叠层角色重复。`);
    number += 1;
    rings.push({ id, target, number, name: layerNames[target.role] || target.role,
      materialRole: categories[material.category] || 'fill', innerM: inner, outerM: outer, centerX: x, centerZ: z });
  }
  const coreCenters = cable.cores.map((core, index) => {
    // The formal Core schema declares zero defaults for these two optional coordinates.
    const x = core.x ?? 0;
    const z = core.z ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error(`cores.${core.id}：芯位置必须为有限坐标。`);
    if (['sectoral', 'segmental'].includes(core.conductor.form)) throw new Error(`cores.${core.id}.conductor.form：当前参数截面不绘制扇形或分割导体。`);
    let outer = positive(core.conductor.diameter, `cores.${core.id}.conductor.diameter`) / 2;
    const inner = core.conductor.form === 'hollow' ? positive(core.conductor.inner_diameter || 0, `cores.${core.id}.conductor.inner_diameter`) / 2 : 0;
    if (inner >= outer) throw new Error(`cores.${core.id}.conductor.inner_diameter：内径须小于外径。`);
    ring({ scope: 'core', coreId: core.id, role: 'conductor' }, inner, outer, core.conductor.material, x, z);
    for (const layer of core.layers) {
      const inner = outer;
      outer += positive(layer.thickness, `cores.${core.id}.layers.${layer.role}.thickness`);
      ring({ scope: 'core', coreId: core.id, role: layer.role }, inner, outer, layer.material, x, z);
    }
    radius = Math.max(radius, Math.hypot(x, z) + outer);
    return { x, z, label: `芯 ${index + 1}` };
  });
  for (let first = 0; first < cable.cores.length; first += 1) for (let second = first + 1; second < cable.cores.length; second += 1) {
    const radiusOf = (index: number) => Math.max(...rings.filter(value => value.target.scope === 'core' && value.target.coreId === cable.cores[index].id).map(value => value.outerM));
    if (Math.hypot(coreCenters[first].x - coreCenters[second].x, coreCenters[first].z - coreCenters[second].z) + 1e-9 < radiusOf(first) + radiusOf(second)) {
      throw new Error(`cores.${cable.cores[second].id}：芯坐标造成截面重叠，请提供真实芯位置。`);
    }
  }
  for (const layer of cable.common_layers) {
    const inner = radius;
    radius += positive(layer.thickness, `common_layers.${layer.role}.thickness`);
    ring({ scope: 'common', role: layer.role }, inner, radius, layer.material, 0, 0);
  }
  if (!Number.isFinite(radius)) throw new Error('cableType：总尺寸超出可绘制范围。');
  return { radiusM: radius, rings, coreCenters };
}

export function dimensionValue(cable: CableType, target: LayerTarget): { field: 'diameter' | 'thickness'; valueM: number } | null {
  if (target.scope === 'common') {
    const layer = cable.common_layers.find(value => value.role === target.role);
    return layer ? { field: 'thickness', valueM: layer.thickness } : null;
  }
  const core = cable.cores.find(value => value.id === target.coreId);
  if (!core) return null;
  if (target.role === 'conductor') return { field: 'diameter', valueM: core.conductor.diameter };
  const layer = core.layers.find(value => value.role === target.role);
  return layer ? { field: 'thickness', valueM: layer.thickness } : null;
}
