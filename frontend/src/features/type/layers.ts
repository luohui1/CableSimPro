import { ApiError } from '@/api/client';
import { at, pointer, type DomainDocument, type NumericInput } from '@/lib/domain-fields';
import { cableShape, layerNames, targetId } from '@/features/drawing/cable-geometry';
import type { CableType, LayerTarget, Material } from '@/features/drawing/types';

export type LayerRow = { id: string; label: string; target: LayerTarget; number: number; path: string; materialPath: string; material: Material; spec: NumericInput; innerM: number | null; outerM: number | null };
export function layerRows(document: DomainDocument, cable: CableType): LayerRow[] {
  let rings: ReturnType<typeof cableShape>['rings'] = [];
  try { rings = cableShape(cable, document.materials).rings; } catch { /* Unsupported drawings must not prevent correction in the real layer table. */ }
  const targets: LayerTarget[] = cable.cores.flatMap(core => [{ scope: 'core' as const, coreId: core.id, role: 'conductor' }, ...core.layers.map(layer => ({ scope: 'core' as const, coreId: core.id, role: layer.role }))]);
  targets.push(...cable.common_layers.map(layer => ({ scope: 'common' as const, role: layer.role })));
  return targets.map((target, index) => {
    const ring = rings.find(ring => ring.id === targetId(target));
    const name = layerNames[target.role] || target.role;
    const root = target.scope === 'common' ? pointer('cable_types', cable.id, 'common_layers', target.role)
      : target.role === 'conductor' ? pointer('cable_types', cable.id, 'cores', target.coreId, 'conductor')
        : pointer('cable_types', cable.id, 'cores', target.coreId, 'layers', target.role);
    const field = target.role === 'conductor' ? 'diameter' : 'thickness';
    const materialPath = root + '/material';
    const material = document.materials.find(material => material.id === at(document, materialPath));
    if (!material) throw new ApiError(422, name + '缺少材料引用');
    const label = target.scope === 'core' && cable.cores.length > 1 ? document.cable_types.find(type => type.id === cable.id)?.cores.findIndex(core => core.id === target.coreId) : undefined;
    return { id: targetId(target), label: label === undefined ? name : `芯 ${label + 1} · ${name}`, target, number: index + 1, path: root + '/' + field, materialPath, material,
      spec: { path: root + '/' + field, label: name + (field === 'diameter' ? '直径' : '厚度'), unit: 'mm', scale: 1000, precision: 3, required: true, min: 0, minExclusive: true }, innerM: ring?.innerM ?? null, outerM: ring?.outerM ?? null };
  });
}
