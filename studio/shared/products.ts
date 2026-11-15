// Presentation of saved product results; no physical model or substitute calculation lives here.
import { compact } from './format.ts';
import { RESULT_KINDS, type ProductResult, type SpecRow, type ValueRow } from './types.ts';

export const RESULT_NAMES = { check: '标准核对', electrical: '电气参数', short_circuit: '短路容量', rating: '载流量表' };
export const VERDICT_NAMES: Record<string, string> = { passed: '通过', failed: '不通过', missing: '缺输入 / 需实测', uncovered: '未覆盖' };
export function problems(spec: SpecRow): string[] {
  return [...Object.entries(spec.computed).filter(([, value]) => value === 'error').map(([kind]) => `${RESULT_NAMES[kind as keyof typeof RESULT_NAMES]}失败`),
    ...(spec.check?.failed ? [`${spec.check.failed} 项不通过`] : []), ...spec.warnings.map(item => item.message)];
}
export const pending = (spec: SpecRow) => RESULT_KINDS.filter(kind => !spec.computed[kind]);
export function resultValue(row: ValueRow): { value: string; unit: string } {
  const units: Record<string, [number, string]> = { 'ohm/m': [1000, 'Ω/km'], 'Ω/m': [1000, 'Ω/km'], 'F/m': [1e9, 'μF/km'], 'H/m': [1e6, 'mH/km'], 'W/m': [1000, 'W/km'], 'A/m': [1000, 'A/km'] };
  const [scale, unit] = units[row.unit] ?? [1, row.unit];
  return { value: row.value == null ? '无结果' : compact(row.value * scale, 6), unit };
}
export const resultIssue = (result: ProductResult | undefined) => !result ? '本版本尚未计算。' : !result.current ? '输入已变化，需要重新计算。' : result.error?.message;
export const dateTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
