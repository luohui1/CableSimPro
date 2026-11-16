// What the series workspace shows, derived from the saved product data: the parts of a construction in drawing
// order, which table fields belong to which part, and the comparison columns. Nothing here computes a result.
import { compact, ROLE_NAMES } from '@shared/format';
import type { CableShape, Ring } from '@shared/geometry';
import type { CheckRow, ResultKind, SpecRow, SpecView } from '@shared/types';

/** What the properties panel is showing: the size itself, one part of it, an analysis, or its files. */
export type Focus =
  | { kind: 'spec' }
  | { kind: 'structure' }
  | { kind: 'part'; role: string }
  | { kind: 'analysis'; id: ResultKind }
  | { kind: 'documents' }
  | { kind: 'history' };

/** Table fields of each part, so a part selected in the drawing finds its numbers and its standard requirements. */
export const PART_FIELDS: Record<string, string[]> = {
  conductor: ['area', 'conductor_diameter', 'conductor_wire_count', 'conductor_wire_diameter', 'r20'],
  conductor_screen: ['conductor_screen_thickness'],
  insulation: ['insulation_thickness'],
  insulation_screen: ['insulation_screen_thickness'],
  metallic_screen: ['screen_tape_thickness', 'screen_tape_width', 'screen_tape_overlap'],
  binder: ['binder_thickness'],
  filler: ['binder_thickness'],
  bedding: ['bedding_thickness'],
  armour: ['armour_tape_thickness', 'armour_tape_width', 'armour_wire_diameter', 'armour_wire_count'],
  oversheath: ['oversheath_thickness'],
};
export const ANALYSES: { id: ResultKind; label: string }[] = [
  { id: 'check', label: '标准核对' }, { id: 'electrical', label: '电气参数' }, { id: 'short_circuit', label: '短路容量' }, { id: 'rating', label: '载流量表' },
];

export interface Part {
  role: string;
  number: number;
  name: string;
  tone: Ring['tone'];
  material: string;
  /** The ring that stands for the part in the drawing: the one of the first core for a part of every core. */
  ring: Ring;
  rings: Ring[];
  /** Radial thickness, or the diameter for a conductor, in mm. */
  size_mm: number;
  /** How a structure table states the part: a conductor diameter, a tape gauge and count, a wire diameter or a thickness. */
  size: string;
  shared: boolean;
}

type LayerLike = { role: string; thickness: number; form?: string | null; nominal_tape_thickness?: number | null; tape_count?: number | null; wire_diameter?: number | null };

function stated(role: string, size_mm: number, layer: LayerLike | undefined): string {
  if (role === 'conductor') return `Ø ${compact(size_mm, 4)}`;
  if (layer?.form === 'tape' && layer.nominal_tape_thickness) {
    const gauge = compact(layer.nominal_tape_thickness * 1000, 3);
    return (layer.tape_count ?? 1) > 1 ? `${layer.tape_count}×${gauge}` : `${gauge} 带`;
  }
  if (layer?.form === 'wires' && layer.wire_diameter) return `Ø ${compact(layer.wire_diameter * 1000, 3)} 丝`;
  return compact(size_mm, 3);
}

/** The parts from the inside out: the layers of a core, then the layers around the cores. */
export function partsOf(shape: CableShape, cable: { cores: { layers: LayerLike[] }[]; common_layers: LayerLike[] }): Part[] {
  const byRole = new Map<string, Ring[]>();
  for (const ring of shape.rings) byRole.set(ring.role, [...(byRole.get(ring.role) ?? []), ring]);
  const firstCore = shape.rings.find(ring => ring.core)?.core;
  const layers = [...(cable.cores[0]?.layers ?? []), ...cable.common_layers];
  return [...byRole.entries()].map(([role, rings], index) => {
    const ring = rings.find(item => !item.core || item.core === firstCore) ?? rings[0];
    const size_mm = ring.size * 1000;
    return { role, number: index + 1, name: ROLE_NAMES[role] ?? role, tone: ring.tone, material: ring.material, ring, rings,
      size_mm, size: stated(role, size_mm, layers.find(layer => layer.role === role)), shared: !ring.core };
  });
}

export const partSize = (part: Part) => part.size;
/** The unit to write after a part's size; a tape count or a wire label already says what it is. */
export const partUnit = (part: Part) => (/[带丝]$/.test(part.size) ? '' : ' mm');

export type Verdict = 'failed' | 'missing' | 'uncovered' | 'passed';
const ORDER: Verdict[] = ['failed', 'missing', 'uncovered', 'passed'];
export const VERDICT_TEXT: Record<Verdict, string> = { failed: '不通过', missing: '缺输入 / 需实测', uncovered: '标准库未覆盖', passed: '通过' };

export type PartCheck = CheckRow & { cores: number };

/** Requirements of a part, one per requirement: a three-core cable states each core requirement three times; they
 *  are shown once with the number of cores, and the worst verdict among the cores stands for all of them. */
export function partChecks(view: SpecView | undefined, role: string): PartCheck[] {
  const result = view?.results.check;
  if (!result?.current || result.error) return [];
  const groups = new Map<string, CheckRow[]>();
  for (const row of result.rows as CheckRow[]) {
    if (row.target.role !== role) continue;
    const key = row.title.replace(/^芯 \d+ · /, '');
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map(rows => ({ ...[...rows].sort((a, b) => ORDER.indexOf(a.verdict as Verdict) - ORDER.indexOf(b.verdict as Verdict))[0], cores: rows.length }));
}

/** The worst verdict among a part's requirements; none when nothing was judged. */
export function partVerdict(view: SpecView | undefined, role: string): Verdict | null {
  const rows = partChecks(view, role);
  return ORDER.find(verdict => rows.some(row => row.verdict === verdict)) ?? null;
}

export function sortChecks<T extends CheckRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => ORDER.indexOf(a.verdict as Verdict) - ORDER.indexOf(b.verdict as Verdict));
}

/** Where an analysis stands for this version. */
export function analysisState(view: SpecView | undefined, kind: ResultKind): { state: 'none' | 'stale' | 'error' | 'refused' | 'done'; text: string } {
  const result = view?.results[kind];
  if (!result) return { state: 'none', text: '未计算' };
  if (!result.current) return { state: 'stale', text: '需重算' };
  if (result.error) return { state: 'error', text: '计算失败' };
  if (kind === 'check') {
    const count = result.summary?.count ?? {};
    return { state: count.failed ? 'error' : 'done', text: count.failed ? `${count.failed} 项不通过` : `${count.passed ?? 0} 项通过` };
  }
  if (kind === 'rating') {
    const rows = (result.rows ?? []) as { status: string }[];
    const done = rows.filter(row => row.status === 'succeeded').length;
    return done ? { state: 'done', text: `${done} / ${rows.length} 种条件` } : { state: 'refused', text: '方法拒算' };
  }
  return { state: 'done', text: '已计算' };
}

export interface Column {
  id: string;
  group: string;
  label: string;
  unit?: string;
  width: number;
  /** Table fields or analyses the column belongs to, so a selection elsewhere can light it. */
  links: string[];
  value: (row: SpecRow) => number | null;
  format: (value: number) => string;
  origin?: (row: SpecRow) => { origin: string; revised?: boolean } | undefined;
}

const DIMENSIONS: [string, string, string[]][] = [
  ['conductor_diameter', '导体外径', ['conductor']],
  ['conductor_screen_thickness', '导体屏蔽', ['conductor_screen']],
  ['insulation_thickness', '绝缘', ['insulation']],
  ['insulation_screen_thickness', '绝缘屏蔽', ['insulation_screen']],
  ['screen_tape_thickness', '铜带', ['metallic_screen']],
  ['bedding_thickness', '内衬', ['bedding']],
  ['armour_tape_thickness', '钢带', ['armour']],
  ['armour_wire_diameter', '钢丝', ['armour']],
  ['oversheath_thickness', '护套', ['oversheath']],
];

/** The comparison columns: dimensions that come from the table or differ between sizes, then results. */
export function columnsFor(rows: SpecRow[]): Column[] {
  const varies = (key: string) => {
    const values = rows.map(row => row.dimensions?.[key]).filter(Boolean);
    return values.length > 0 && (values.some(item => item!.origin === 'table') || new Set(values.map(item => item!.value)).size > 1);
  };
  const dimension = ([key, label, links]: [string, string, string[]]): Column => ({
    id: key, group: '结构尺寸', label, unit: 'mm', width: 72, links: [...links, key],
    value: row => row.dimensions?.[key]?.value ?? null, format: value => compact(value, 4), origin: row => row.dimensions?.[key],
  });
  return [
    ...DIMENSIONS.filter(([key]) => varies(key)).map(dimension),
    { id: 'outer_diameter', group: '成品', label: '外径', unit: 'mm', width: 72, links: ['outer_diameter', 'oversheath'],
      value: row => row.outer_diameter_mm, format: value => value.toFixed(1) },
    { id: 'weight', group: '成品', label: '重量', unit: 'kg/km', width: 84, links: ['weight'],
      value: row => row.weight_kg_km, format: value => compact(value, 6), origin: row => row.dimensions?.weight },
    { id: 'r20', group: '电气', label: 'R20', unit: 'Ω/km', width: 84, links: ['conductor', 'r20', 'electrical'],
      value: row => row.r20_ohm_km, format: value => compact(value, 4), origin: row => row.dimensions?.r20 },
    { id: 'ac', group: '电气', label: '交流电阻 90 °C', unit: 'Ω/km', width: 116, links: ['electrical'],
      value: row => row.ac_resistance_ohm_km, format: value => compact(value, 4) },
    { id: 'short', group: '电气', label: '短路 1 s', unit: 'kA', width: 84, links: ['short_circuit'],
      value: row => row.short_circuit_ka, format: value => value.toFixed(2) },
    { id: 'ampacity', group: '载流量', label: '基准条件', unit: 'A', width: 92, links: ['rating'],
      value: row => row.ampacity_a, format: value => value.toFixed(1) },
  ];
}

export const reviewTone = (state: string) => ({ draft: 'draft', submitted: 'pending', reviewed: 'ok', published: 'issued' } as Record<string, string>)[state] ?? 'draft';

/** Rows as tab-separated text with a header, for pasting into a spreadsheet. */
export function tsv(rows: SpecRow[], columns: Column[]): string {
  const head = ['规格', '版本', ...columns.map(column => `${column.label}${column.unit ? ` (${column.unit})` : ''}`), '标准核对', '审核'];
  const lines = rows.map(row => [row.key, `第${row.version}版`, ...columns.map(column => { const value = column.value(row); return value === null ? '' : column.format(value); }),
    row.check ? `通过${row.check.passed ?? 0} 不通过${row.check.failed ?? 0} 缺项${row.check.missing ?? 0}` : '未核对', row.review]);
  return [head, ...lines].map(cells => cells.join('\t')).join('\n');
}
