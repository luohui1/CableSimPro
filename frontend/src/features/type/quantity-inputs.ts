import { optionalRecord, text } from '@/api/client';
import { at, pointer, type DomainDocument } from '@/lib/domain-fields';
import type { LayerRow } from './layers';

/** Resolve saved source targets to editable inputs; never infer a physical value. */
export function quantityLayer(rows: LayerRow[], quantity: Record<string, unknown>) {
  const target = optionalRecord(quantity.source_target);
  return rows.find(row => row.target.scope === target.scope && row.target.role === target.role && (row.target.scope === 'common' || row.target.coreId === target.core_id));
}
export function quantityMissingInputs(document: DomainDocument, layer: LayerRow, missing: unknown): { label: string; path: string }[] {
  const root = layer.path.slice(0, layer.path.lastIndexOf('/'));
  const labels = Array.isArray(missing) ? missing.map(String) : [];
  return labels.flatMap(label => {
    if (label === '材料密度') return [{ label, path: pointer('materials', layer.material.id, 'density') }];
    if (label === '导体绞入系数') return [{ label, path: root + '/lay_factor' }];
    if (label.endsWith('构造') && text(at(document, root + '/form')) === 'tape') {
      return [['tape_application', '绕包方式'], ['nominal_tape_thickness', '单带标称厚度'], ['tape_width', '带宽'], ['tape_count', '带材层数']]
        .filter(([key]) => at(document, root + '/' + key) == null).map(([key, label]) => ({ label, path: root + '/' + key }));
    }
    return [];
  });
}
