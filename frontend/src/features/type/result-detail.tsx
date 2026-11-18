import type { ReactNode } from 'react';
import { numeric, text } from '@/api/client';
import { engineeringQuantity, formatNumber, significantNumber } from '@/lib/format';
import { displayName } from '@/lib/display-names';

/** Display only saved evidence. This does not evaluate or change a formula. */
export function resultCitation(row: Record<string, unknown>) {
  const clause = text(row.clause).replace(/4 amendment/g,'第 4 章（修订 1）').replace(/[；;]/g, ' ').replace(/\s+/g, ' ').trim();
  const printed = numeric(row.printed_page), pdf = numeric(row.pdf_page);
  return [text(row.standard), clause].filter(Boolean).join(' ') +
    (printed === null ? ' · 本库暂未收录' : ` · 第 ${printed} 页`) +
    (pdf === null ? '' : `（PDF 第 ${pdf} 页）`);
}

const variables: Record<string, [string, string]> = {
  S_mm2: ['截面积 S', 'mm²'], K: ['材料常数 K', 'A·√s/mm²'], beta_K: ['材料温度常数 β', 'K'],
  theta_i_K: ['初始温度 θᵢ', 'K'], theta_f_K: ['最终温度 θf', 'K'], t_s: ['持续时间 t', 's'],
  I_AD_A: ['绝热电流', 'A'], epsilon: ['非绝热修正因数 ε', '1'],
};
const suffixUnits: [string,string][] = [['_ohm_m','Ω/m'],['_F_m','F/m'],['_mm','mm'],['_m','m'],['_K','K'],['_s','s'],['_hz','Hz'],['_V','V']];
export function formulaInput(key: string, value: unknown) {
  const [label, explicitUnit] = variables[key] || [displayName(key), ''];
  const unit = explicitUnit || suffixUnits.find(([suffix])=>key.endsWith(suffix))?.[1] || '';
  const number = numeric(value);
  if (number === null) return { label, value: value == null ? '未提供' : typeof value === 'string' ? value : '见追溯', unit: undefined };
  // β is a temperature constant, not an absolute temperature to convert to °C.
  const display = key==='beta_K'?{text:formatNumber(number,1),unit:'K'}:engineeringQuantity(key,number,unit);
  const formatted=unit?display.text:significantNumber(number,3);
  return { label, value: formatted.replace(/(\.\d*?[1-9])0+$|\.0+$/,'$1'), unit: unit && display.unit !== '—' ? display.unit : undefined };
}

export function ResultTrace({ items }: { items: { label: string; value: ReactNode }[] }) {
  return <details className="type-result-trace"><summary>追溯</summary><dl>{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl></details>;
}
