import type { CableType, LayerTarget, Material } from './types';
import { coreProfile, profileRadius, profilesOverlap, type CrossSectionProfile } from './cross-section-profile';

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
  profile: CrossSectionProfile;
  innerProfile?: CrossSectionProfile;
  holes: CrossSectionProfile[];
  anchorRadiusM?: number;
}
export interface CableShape { radiusM: number; rings: DrawingRing[]; coreCenters: { x: number; z: number; label: string }[] }

export const layerNames: Record<string, string> = {
  conductor: '导体', conductor_screen: '导体屏蔽', insulation: '绝缘', insulation_screen: '绝缘屏蔽',
  metallic_screen: '金属屏蔽', metallic_sheath: '金属护套', bedding: '内衬层', armour: '铠装',
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
  if (!['single_core', 'three_core', 'multi_core'].includes(cable.construction) || !cable.cores.length || cable.cores.length > 16
      || cable.construction === 'single_core' && cable.cores.length !== 1 || cable.construction === 'three_core' && cable.cores.length !== 3) {
    throw new Error('cableType.construction：请核对芯数，参数截面支持 1–16 个明确定位的线芯。');
  }
  const materialMap = new Map(materials.map(material => [material.id, material]));
  const rings: DrawingRing[] = [];
  let number = 0;
  let radius = 0;
  function ring(target: LayerTarget, inner: number, outer: number, materialId: string, x: number, z: number,
    profile: CrossSectionProfile, innerProfile?: CrossSectionProfile, holes: CrossSectionProfile[] = [], anchorRadiusM?: number) {
    const material = materialMap.get(materialId);
    if (!material) throw new Error(`materials.${materialId}：材料引用缺失，未绘制替代材料。`);
    const id = targetId(target);
    if (rings.some(value => value.id === id)) throw new Error(`cableType.${id}：同一堆叠层角色重复。`);
    number += 1;
    const coreName = target.scope === 'core' && cable.cores.length > 1 ? `芯 ${cable.cores.findIndex(core => core.id === target.coreId) + 1} · ` : '';
    rings.push({ id, target, number, name: coreName + (layerNames[target.role] || target.role),
      materialRole: categories[material.category] || 'fill', innerM: inner, outerM: outer, centerX: x, centerZ: z,
      profile, innerProfile, holes, anchorRadiusM });
  }
  const outerProfiles: CrossSectionProfile[] = [];
  const coreCenters = cable.cores.map((core, index) => {
    // The formal Core schema declares zero defaults for these two optional coordinates.
    const x = core.x ?? 0;
    const z = core.z ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error(`cores.${core.id}：芯位置必须为有限坐标。`);
    let outer = positive(core.conductor.diameter, `cores.${core.id}.conductor.diameter`) / 2;
    const baseRadius = outer;
    let profile = coreProfile(core.conductor, x, z);
    const inner = core.conductor.form === 'hollow' ? positive(core.conductor.inner_diameter || 0, `cores.${core.id}.conductor.inner_diameter`) / 2 : 0;
    if (inner >= outer) throw new Error(`cores.${core.id}.conductor.inner_diameter：内径须小于外径。`);
    ring({ scope: 'core', coreId: core.id, role: 'conductor' }, inner, outer, core.conductor.material, x, z,
      profile, inner ? { kind: 'circle', x, z, radius: inner, offset: 0 } : undefined);
    for (const layer of core.layers) {
      const inner = outer;
      const previous = profile;
      outer += positive(layer.thickness, `cores.${core.id}.layers.${layer.role}.thickness`);
      profile = coreProfile(core.conductor, x, z, outer - baseRadius);
      ring({ scope: 'core', coreId: core.id, role: layer.role }, inner, outer, layer.material, x, z, profile, previous);
    }
    radius = Math.max(radius, profileRadius(profile)); outerProfiles.push(profile);
    return { x, z, label: `芯 ${index + 1}` };
  });
  for (let first = 0; first < cable.cores.length; first += 1) for (let second = first + 1; second < cable.cores.length; second += 1) {
    if (profilesOverlap(outerProfiles[first], outerProfiles[second])) {
      throw new Error(`cores.${cable.cores[second].id}：芯坐标造成截面重叠，请提供真实芯位置。`);
    }
  }
  for (const [index, layer] of cable.common_layers.entries()) {
    const inner = radius;
    radius += positive(layer.thickness, `common_layers.${layer.role}.thickness`);
    const filler = layer.role === 'filler' && cable.cores.length > 1;
    if (filler && index !== 0) throw new Error('common_layers.filler：间隙填充须位于公共层最内侧。');
    const profile: CrossSectionProfile = { kind: 'circle', x: 0, z: 0, radius, offset: 0 };
    ring({ scope: 'common', role: layer.role }, filler ? 0 : inner, radius, layer.material, 0, 0, profile,
      filler ? undefined : { ...profile, radius: inner }, filler ? outerProfiles : [], (inner + radius) / 2);
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
