// One place for how values are written: the workbench, the review rows and the calculation sheet agree.
import type { Conditions, Installation, MethodChoice, PartName, Parts } from './types.ts';

export function fixed(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

/** Up to `digits` significant figures, without trailing zeros: 0.0008 → 0.0008, 1.20 → 1.2. */
export function compact(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return String(Number(value.toPrecision(digits)));
}

export const ROLE_NAMES: Record<string, string> = {
  conductor: '导体', conductor_screen: '导体屏蔽', insulation: '绝缘', insulation_screen: '绝缘屏蔽',
  metallic_screen: '金属屏蔽', metallic_sheath: '金属护套', bedding: '内衬层', armour: '铠装',
  oversheath: '外护套', binder: '包带', filler: '填充', separator: '隔离层',
};
export const BONDING_NAMES: Record<string, string> = { both_ends: '两端接地', single_point: '单点接地' };
export const EDDY_NAMES: Record<string, string> = { ignored: '不计', trefoil: '计入' };
export const KIND_NAMES: Record<string, string> = { rating: '校核', sweep: '扫描', selection: '选型' };
export const STATE_NAMES: Record<string, string> = { demo: '结构演示', public: '公开厂家资料' };
export const PHASE_NAMES: Record<string, string> = { A: 'A 相', B: 'B 相', C: 'C 相', L1L2L3: '三芯电缆' };
export const LEVEL_NAMES: Record<string, string> = { 'reference-benchmark': '公开算例对照', 'self-consistency': '自洽检查', unverified: '未验证' };

export interface Field {
  key: string;
  label: string;
  unit?: string;
  /** Display value = stored value × scale. */
  scale?: number;
  digits?: number;
  options?: Record<string, string>;
  min?: number;
  /** What an unset value means for this field. */
  empty?: string;
}

export const INSTALLATION_FIELDS: Field[] = [
  { key: 'depth_m', label: '中心埋深', unit: 'm', digits: 4, min: 0 },
  { key: 'spacing_m', label: '中心距', unit: 'mm', scale: 1000, digits: 5, min: 0, empty: '按敷设方式默认' },
  { key: 'bonding', label: '护套接地', options: BONDING_NAMES },
  { key: 'duct.inner_diameter_m', label: '管内径', unit: 'mm', scale: 1000, digits: 5, min: 0 },
  { key: 'duct.outer_diameter_m', label: '管外径', unit: 'mm', scale: 1000, digits: 5, min: 0 },
  { key: 'duct.thermal_resistivity', label: '管材热阻率', unit: 'K·m/W', digits: 4, min: 0 },
  { key: 'backfill.width', label: '回填宽度', unit: 'm', digits: 4, min: 0 },
  { key: 'backfill.height', label: '回填高度', unit: 'm', digits: 4, min: 0 },
  { key: 'backfill.thermal_resistivity', label: '回填热阻率', unit: 'K·m/W', digits: 4, min: 0 },
];
export const CONDITION_FIELDS: Field[] = [
  { key: 'soil_thermal_resistivity', label: '土壤热阻率', unit: 'K·m/W', digits: 4, min: 0 },
  { key: 'ambient_temperature_c', label: '环境温度', unit: '°C', digits: 4 },
  { key: 'system_voltage_v', label: '系统线电压', unit: 'kV', scale: .001, digits: 5, min: 0 },
  { key: 'frequency_hz', label: '频率', unit: 'Hz', digits: 4, min: 0 },
];
export const METHOD_FIELDS: Field[] = [
  { key: 'parameters.ks', label: '集肤效应系数 ks', digits: 4, min: 0 },
  { key: 'parameters.kp', label: '邻近效应系数 kp', digits: 4, min: 0 },
  { key: 'parameters.eddy', label: '护套涡流损耗', options: EDDY_NAMES },
];

export function pick(source: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((value, part) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined), source);
}

export function display(field: Field, value: unknown): string {
  if (value === null || value === undefined) return field.empty ?? '未填';
  if (field.options) return field.options[String(value)] ?? String(value);
  if (typeof value !== 'number') return String(value);
  return compact(value * (field.scale ?? 1), field.digits ?? 4) + (field.unit ? ' ' + field.unit : '');
}

/** The labelled differences between two versions of one part, as the review rows show them. */
export function describeChanges(part: PartName, before: Parts[PartName], after: Parts[PartName], layoutLabel: (kind: string) => string): { part: PartName; field: string; label: string; before: string; after: string }[] {
  const rows: { part: PartName; field: string; label: string; before: string; after: string }[] = [];
  const add = (field: string, label: string, a: string, b: string) => { if (a !== b) rows.push({ part, field, label, before: a, after: b }); };
  if (part === 'cable') {
    const [a, b] = [before as Parts['cable'], after as Parts['cable']];
    add('id', '型号', a.name, b.name);
  } else if (part === 'installation') {
    const [a, b] = [before as Installation, after as Installation];
    add('layout', '敷设方式', layoutLabel(a.layout), layoutLabel(b.layout));
    for (const field of INSTALLATION_FIELDS) add(field.key, field.label, display(field, pick(a, field.key)), display(field, pick(b, field.key)));
  } else if (part === 'conditions') {
    const [a, b] = [before as Conditions, after as Conditions];
    for (const field of CONDITION_FIELDS) add(field.key, field.label, display(field, pick(a, field.key)), display(field, pick(b, field.key)));
    add('currents_a', '负荷电流', a.currents_a.map(v => compact(v) + ' A').join(' / '), b.currents_a.map(v => compact(v) + ' A').join(' / '));
  } else {
    const [a, b] = [before as MethodChoice, after as MethodChoice];
    for (const field of METHOD_FIELDS) add(field.key, field.label, display(field, pick(a, field.key)), display(field, pick(b, field.key)));
  }
  return rows;
}
