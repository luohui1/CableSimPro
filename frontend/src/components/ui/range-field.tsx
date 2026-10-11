import { numeric, optionalRecord } from '@/api/client';
import { declaredUnit, expand, toDisplay, toSi } from '@/lib/contract-schema';
import type { ParameterDraft } from '@/lib/study-config';
import { NumberField } from './number-field';

const LABELS = ['左', '下', '右', '上'];

/** 有序二维范围。四个位置始终保留，空值留给真实预检定位，不排序或压缩数组。 */
export function RangeField({ module, path, label, field, root, value, readOnly, onChange, draftFields = {}, onDraftChange = () => {} }: {
  module: string; path: string; label: string; field: Record<string, unknown>; root: unknown;
  value: unknown; readOnly: boolean; onChange: (value: (number | null)[]) => void;
  draftFields?: Record<string, ParameterDraft>; onDraftChange?: (field: ParameterDraft | undefined, key: string) => void;
}) {
  const values = Array.from({ length: 4 }, (_, index) => numeric(Array.isArray(value) ? value[index] : undefined));
  const items = Array.isArray(field.prefixItems) ? field.prefixItems : [];
  return <div className="range-field" role="group" aria-label={label} data-field-path={path}>
    {LABELS.map((name, index) => {
      const item = expand(items[index], root), unit = declaredUnit(item['x-unit']) || declaredUnit(field['x-unit']);
      const child = path + '/' + index, key = module + child, amount = values[index];
      // Missing coordinates may be saved as incomplete inputs; the host preflight reports the precise index.
      const spec = { path: child, label: label + ' · ' + name, unit: unit?.unit || 'm', scale: unit?.scale ?? 1, offset: unit?.offset ?? 0, required: false,
        min: numeric(item.minimum) === null ? undefined : toDisplay(Number(item.minimum), unit),
        max: numeric(item.maximum) === null ? undefined : toDisplay(Number(item.maximum), unit) };
      return <NumberField key={name} {...spec} label={name} value={amount === null ? null : toDisplay(amount, unit)} precision={3}
        locked={readOnly} draftText={readOnly ? undefined : draftFields[key]?.text}
        onDraftChange={readOnly ? undefined : raw => onDraftChange(raw === undefined ? undefined : { module, path: child, text: raw, kind: 'number', spec }, key)}
        onCommit={number => {
          if (readOnly) return;
          onChange(values.map((value, position) => position === index ? number === null ? null : toSi(number, unit) : value));
          onDraftChange(undefined, key);
        }} />;
    })}
  </div>;
}

export function isRangeField(key: string, field: Record<string, unknown>, root: unknown) {
  return key === 'bounds_m' && field.type === 'array' && Array.isArray(field.prefixItems) && field.prefixItems.length === 4
    && field.prefixItems.every(item => expand(item, root).type === 'number') && optionalRecord(field['x-unit']).si === 'm';
}
