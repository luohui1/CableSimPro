// Display the saved field provenance. A row's associated upload is not evidence that a declared or queried value was in that row.
import { resultValue } from '../../shared/products.ts';
import type { StructurePreviewRow } from '../../shared/fusion-types.ts';

export interface ImportFieldSourceView {
  origin: 'table' | 'series' | 'standard' | 'unknown';
  label: string;
  location?: string;
  reference?: unknown;
  referenceLines: string[];
  missing?: string;
  reviewed: boolean;
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined;

export function importFieldSource(source: Record<string, unknown>): ImportFieldSourceView {
  const origin = source.origin === 'table' && ['manufacturer', 'demo'].includes(String(source.kind)) ? 'table'
    : source.origin === 'series' && ['user', 'demo'].includes(String(source.kind)) ? 'series'
    : source.origin === 'standard' && source.kind === 'standard' ? 'standard' : 'unknown';
  const label = { table: '原表抄录', series: '显式声明 / 引用补入', standard: '标准查询', unknown: '来源类型未明确' }[origin];
  const view: ImportFieldSourceView = { origin, label: label + (source.kind === 'demo' ? ' · 演示数据' : ''),
    referenceLines: [], reviewed: source.reviewed === true };
  if (source.reference !== undefined && source.reference !== null && source.reference !== '') view.reference = source.reference;
  if (origin === 'table') {
    view.location = [nonempty(source.file), nonempty(source.sheet),
      Number.isInteger(source.row) && Number(source.row) > 0 ? `第 ${source.row} 行` : undefined,
      nonempty(source.column) ? `${source.column} 列` : undefined].filter(Boolean).join(' · ') || '未记录原表位置';
  } else if (origin === 'unknown') {
    view.missing = '未明确取值来源，请核对完整记录；关联文件位置不能作为该字段的抄录依据。';
  } else if (view.reference === undefined) {
    view.missing = origin === 'standard' ? '未保存标准查询依据，请补充核对。' : '未保存声明的引用依据，请补充核对。';
  }
  if (origin === 'standard' && object(view.reference)) {
    const reference = view.reference;
    const record = object(reference.record) ? reference.record : {};
    const quantity = object(record.quantity) ? record.quantity : {};
    const header = object(record.column_header) ? record.column_header : {};
    const citation = nonempty(record.citation) || [reference.standard, reference.edition, reference.locator].map(nonempty).filter(Boolean).join(' · ');
    const name = nonempty(quantity.name) || nonempty(header.name);
    view.referenceLines = [citation, name, nonempty(record.row_label) ? `适用规格：${record.row_label}` : undefined,
      record.semantic === 'standard_limit' ? record.criterion === 'maximum' ? '标准上限（非厂家实测）'
        : record.criterion === 'minimum' ? '标准下限（非厂家实测）' : '标准限值（非厂家实测）' : undefined].filter((line): line is string => Boolean(line));
  }
  return view;
}

/** Suppress only a floating-point conversion tail within one relative machine epsilon; do not round meaningful precision. */
export function importSiValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'number') return typeof value === 'string' ? value : JSON.stringify(value);
  if (!Number.isFinite(value) || Number.isInteger(value)) return String(value);
  const shorter = Number(value.toPrecision(15));
  return String(Math.abs(value - shorter) <= Math.abs(value) * Number.EPSILON ? shorter : value);
}

/** Use the field's saved display contract; older previews that contain SI resistance only still read in Ω/km. */
export function importFieldValue(fact: StructurePreviewRow['values'][number]): { value: string; unit: string } {
  const value = fact.display_value === undefined ? fact.value : fact.display_value;
  const unit = fact.display_unit ?? fact.unit;
  if (typeof value === 'number' && ['ohm/m', 'Ω/m'].includes(unit)) return resultValue({ value, unit });
  return { value: importSiValue(value), unit: unit === 'ohm/km' ? 'Ω/km' : unit };
}
