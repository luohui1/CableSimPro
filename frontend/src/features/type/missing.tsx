import { numeric } from '@/api/client';
import { pointer, type DomainDocument } from '@/lib/domain-fields';
import { Button } from '@/components/ui/button';
import { typePath, useTypeNavigation } from './navigation';
import { layerNames } from '@/features/drawing/cable-geometry';

export function missingTypeInputs(document: DomainDocument) {
  const items: { label: string; path: string; layer?: string }[] = [];
  for (const cable of document.cable_types) {
    const root = pointer('cable_types', cable.id);
    if (numeric(cable.rating.u0) === null || numeric(cable.rating.u) === null) items.push({ label: '额定电压 U₀/U', path: root + '/rating/u0' });
    for (const [index, core] of cable.cores.entries()) {
      const coreRoot = root + '/cores/' + core.id.replace(/~/g, '~0').replace(/\//g, '~1');
      for (const [key, label] of [['nominal_area', '导体截面'], ['diameter', '导体直径']] as const) if (numeric(core.conductor[key]) === null) items.push({ label: `芯 ${index + 1} · ${label}`, path: coreRoot + '/conductor/' + key, layer: core.id + '/conductor' });
      if (core.x === null || core.z === null) items.push({ label: `芯 ${index + 1} · 中心位置`, path: coreRoot + '/x', layer: core.id + '/conductor' });
      for (const layer of core.layers) if (numeric(layer.thickness) === null) items.push({ label: `芯 ${index + 1} · ${layerNames[layer.role] || '结构层'}厚度`, path: pointer('cable_types', cable.id, 'cores', core.id, 'layers', layer.role, 'thickness'), layer: core.id + '/' + layer.role });
    }
    for (const layer of cable.common_layers) if (numeric(layer.thickness) === null) items.push({ label: `${layerNames[layer.role] || '公共层'}厚度`, path: pointer('cable_types',cable.id,'common_layers',layer.role,'thickness'), layer: 'common/' + layer.role });
  }
  return items;
}
export function MissingTypeInputs({ document, wid }: { document: DomainDocument; wid: string }) {
  const navigation = useTypeNavigation(), missing = missingTypeInputs(document);
  if (!missing.length) return null;
  return <section className="type-missing-inputs" aria-label="型号缺项"><h3>待补字段 · {missing.length}</h3><ul>{missing.map(item => <li key={item.path}><Button variant="ghost" size="compact" onClick={() => navigation.navigate(typePath(wid, 'structure', 'table', navigation.location.theme) + '&field=' + encodeURIComponent(item.path) + (item.layer ? '&layer=' + encodeURIComponent(item.layer) : ''))}>{item.label}</Button></li>)}</ul></section>;
}
