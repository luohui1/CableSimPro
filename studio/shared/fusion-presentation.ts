// Presentation only. Exact tool arguments and saved SI evidence keep their original values and identities.
export function displayQuantity(value: number, unit?: string | null): { value: number; unit: string | null } {
  if (['ohm/m', 'Ω/m'].includes(unit ?? '') && Number.isFinite(value)) {
    return { value: Number(displayNumber(value * 1000)), unit: 'Ω/km' };
  }
  return { value, unit: unit === 'ohm/km' ? 'Ω/km' : unit && unit !== '1' ? unit : null };
}

/** Remove only binary conversion noise; do not reduce meaningful saved precision. */
export function displayNumber(value: number): string {
  if (!Number.isFinite(value) || Number.isInteger(value)) return String(value);
  const shorter = Number(value.toPrecision(15));
  return String(Math.abs(value - shorter) <= Math.abs(value) * Number.EPSILON ? shorter : value);
}

/** Known method enums have engineering meanings. Never invent labels for unknown facts or alter source quotations. */
export function engineeringText(text: string): string {
  return text
    .replace(/(?<![\w.-])eddy\s*=\s*ignored(?![\w.-])/g, '护套涡流损耗按方法声明忽略')
    .replace(/(?<![\w.-])rating-simultaneous(?![\w.-])/g, '全回路共同能力')
    .replace(/(?<![\w.-])rating(?![\w.-])/g, '单回路能力')
    .replace(/(?<![\w.-])operating(?![\w.-])/g, '给定负荷运行点');
}

/** Review text uses the same resistance display as result cards, while the platform proposal remains untouched. */
export function proposalValueText(value: unknown, unit?: string | null): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    const shown = displayQuantity(value, unit);
    return displayNumber(shown.value) + (shown.unit ? ` ${shown.unit}` : '');
  }
  const text = typeof value === 'string' ? value : typeof value === 'boolean' ? (value ? '是' : '否') : JSON.stringify(value);
  return unit && unit !== '1' ? `${text} ${unit}` : text;
}

export interface ReviewChange { part: string; field: string; label: string; before: string; after: string }

/** Pure identity/hash rows stay available in trace details, rather than being repeated as engineering changes. */
export function isTraceChange(change: Pick<ReviewChange, 'field' | 'label'>): boolean {
  return /(?:标识|SHA\s*256|保存路径|存储路径|固定版本与保存修订|(?:原件|预览|内容|输入|输出|文件|来源)摘要)/i.test(change.label)
    || /\/(?:[\w]*_id|id|sha256|[\w]*_digest|content_sha256)$/.test(change.field);
}
