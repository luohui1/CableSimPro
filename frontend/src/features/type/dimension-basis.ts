import { optionalRecord, text, numeric } from '@/api/client';

/** Engineering-facing evidence text; stable IDs/digests remain in the saved reference. */
export function dimensionBasis(reference: unknown): string | undefined {
  if (typeof reference !== 'string') return undefined;
  let value; try { value = JSON.parse(reference); } catch { return reference; }
  const source = optionalRecord(value), record = optionalRecord(source.record);
  if (source.schema !== 'cablesim.standard-basis-ref/1' || !text(record.citation)) return reference;
  const quantity = optionalRecord(record.quantity), original = numeric(record.value);
  return [text(record.citation), text(record.row_label), original === null ? '' : `${text(quantity.name)}：${original} ${text(quantity.unit)}`,
    ...((Array.isArray(source.calculation_steps) ? source.calculation_steps : Array.isArray(source.calculation) ? source.calculation : []).map(item => {
      const step = optionalRecord(item); return `${text(step.stage)} · ${text(step.formula)} · ${text(step.raw_value)} → ${numeric(step.rounded_value)} mm · ${text(step.citation)}`;
    }))].filter(Boolean).join('\n');
}
