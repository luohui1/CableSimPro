// What the type workspace shows, derived from the saved version: which table fields belong to which part of the construction,
// and how the standard check reads for a version. Nothing here computes a result.
import { compact } from '@shared/format';
import type { CheckRow, ProductResult, ResultKind, ReviewState, SpecView } from '@shared/types';
import { RESULT_KINDS } from '@shared/types';

/** Table fields of each part, so a layer picked in the table finds its rings in the drawing. */
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

/** The part of the construction a table field describes; none for a field of the finished cable. */
export const roleOfField = (key: string) => Object.entries(PART_FIELDS).find(([, keys]) => keys.includes(key))?.[0] ?? null;

export const ORIGIN_MARK: Record<string, string> = { table: '表列', series: '系列', standard: '标准', revised: '已改' };

/** Where a series' data comes from, as the library words it. Anything not named is the structures that come with the software. */
export const ORIGIN_NAMES: Record<string, string> = { factory: '本厂', public: '公开资料', demo: '演示结构' };
export const originOf = (origin: string) => (origin in ORIGIN_NAMES ? origin : 'demo');

/** The size opened last, so the library marks it when you come back. */
const LAST_OPENED = 'studio.library.selected';
export function lastOpened(): string {
  try { return localStorage.getItem(LAST_OPENED) ?? ''; } catch { return ''; }
}
export function rememberOpened(spec: string) {
  try { localStorage.setItem(LAST_OPENED, spec); } catch { /* private browsing */ }
}

/** The steps of review a person can take, and the states each one starts from. */
export type ReviewAction = 'submit' | 'approve' | 'publish' | 'return';
export const REVIEW_ACTIONS: Record<ReviewAction, string> = { submit: '提交审核', approve: '审核通过', publish: '发布', return: '退回修改' };
export const NEXT_STEPS: Record<ReviewState, ReviewAction[]> = { draft: ['submit'], submitted: ['approve', 'return'], reviewed: ['publish', 'return'], published: [] };

/** What a person did to a version or a series, as the trail words it. */
const EVENT_LABELS: Record<string, string> = {
  created: '手工创建', imported: '导入结构表', seeded: '随软件提供', revised: '修改结构', submit: '提交审核', approve: '审核通过', publish: '发布',
  return: '退回修改', exported: '生成规格书', computed: '计算与核对', rating_table: '载流量表写入规格', rating_table_failed: '载流量表写入失败', saved: '保存',
};
export const eventLabel = (action: string) => EVENT_LABELS[action] ?? '其他操作';

const CONDITIONS: Record<string, string> = {
  temperature_k: '导体温度', frequency_hz: '频率', phase_voltage_v: '相电压', duration_s: '短路持续时间', initial_temperature_k: '短路前温度',
  final_temperature_k: '短路允许温度', spacing_m: '线芯中心距', r20_length_basis: '电阻长度口径', arrangement: '排列', core_lay_factor: '成缆系数', ks: '集肤系数 ks', kp: '邻近系数 kp',
};
export const conditionLabel = (key: string) => CONDITIONS[key] ?? key;

/** A calculation condition as an engineer reads it: kelvin as °C, metres as mm, volts as kV. */
export function conditionValue(key: string, value: number | string): string {
  if (typeof value !== 'number') return ({ finished_cable: '每米成品电缆', trefoil: '品字形紧贴', flat: '水平排列' } as Record<string, string>)[value] ?? value;
  if (key.endsWith('_k')) return `${compact(value - 273.15, 4)} °C`;
  if (key === 'spacing_m') return `${compact(value * 1000, 4)} mm`;
  if (key === 'phase_voltage_v') return `${compact(value / 1000, 4)} kV`;
  if (key === 'frequency_hz') return `${compact(value)} Hz`;
  if (key === 'duration_s') return `${compact(value)} s`;
  return compact(value, 5);
}

/** Date and time as a table cell holds them: 11/15 13:45. */
export const shortTime = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export type Verdict = 'failed' | 'missing' | 'uncovered' | 'passed';
export const VERDICT_ORDER: Verdict[] = ['failed', 'missing', 'uncovered', 'passed'];

/** One requirement of the check. A three-core cable states each core's requirement three times; they read once, with the
 *  number of cores, and the worst verdict among the cores stands for all of them. */
export interface Requirement {
  title: string;
  verdict: Verdict;
  cores: number;
  standard: string;
  clause: string;
  printed_page: number | null;
  pdf_page: number | null;
  limit: number | null;
  actual: number | null;
  unit: string;
  comparison: string | null;
  reason: string | null;
  role: string;
}

export function requirements(result: ProductResult | undefined): Requirement[] {
  if (!result?.current || result.error) return [];
  const groups = new Map<string, CheckRow[]>();
  for (const row of result.rows as CheckRow[]) {
    const title = row.title.replace(/^芯 \d+ · /, '');
    groups.set(`${row.target.role}/${title}`, [...(groups.get(`${row.target.role}/${title}`) ?? []), row]);
  }
  return [...groups.values()].map(rows => {
    const worst = [...rows].sort((a, b) => VERDICT_ORDER.indexOf(a.verdict as Verdict) - VERDICT_ORDER.indexOf(b.verdict as Verdict))[0];
    const verdict = (VERDICT_ORDER.includes(worst.verdict as Verdict) ? worst.verdict : 'uncovered') as Verdict;
    return { title: worst.title.replace(/^芯 \d+ · /, ''), verdict, cores: rows.length, standard: worst.standard, clause: worst.clause, printed_page: worst.printed_page ?? null,
      pdf_page: worst.pdf_page ?? null, limit: worst.limit, actual: worst.actual, unit: worst.unit, comparison: worst.comparison, reason: worst.reason, role: worst.target.role };
  });
}

const SYMBOLS: Record<string, string> = { '>=': '≥', '<=': '≤', '>': '>', '<': '<', '=': '=', in: '属于' };
/** A unit as written after a number: a dimensionless quantity has none. */
const unitText = (unit: string) => (unit === '1' ? '' : ` ${unit}`);

export function requirementText(item: Requirement): { required: string; actual: string } {
  return {
    required: item.limit !== null ? `${item.comparison ? `${SYMBOLS[item.comparison] ?? item.comparison} ` : ''}${compact(item.limit, 5)}${unitText(item.unit)}` : '见条款',
    actual: item.actual !== null ? `${compact(item.actual, 5)}${unitText(item.unit)}` : '—',
  };
}

/** What still stands between a version and a review: a result missing or out of date, a check not passed or not judged, a warning. */
export function openIssues(view: SpecView): string[] {
  const issues: string[] = [];
  const names: Record<ResultKind, string> = { check: '标准核对', electrical: '电气参数', short_circuit: '短路容量', rating: '载流量表' };
  for (const kind of RESULT_KINDS) {
    const result = view.results[kind];
    if (!result) issues.push(`${names[kind]}还没有计算`);
    else if (!result.current) issues.push(`${names[kind]}需要重算`);
    else if (result.error) issues.push(`${names[kind]}计算失败`);
  }
  const count = view.results.check?.current ? view.results.check.summary?.count ?? {} : {};
  if (count.failed) issues.push(`${count.failed} 项标准核对不通过`);
  if (count.missing) issues.push(`${count.missing} 项缺输入或需实测`);
  if (count.uncovered) issues.push(`${count.uncovered} 项标准库未覆盖`);
  if (view.warnings.length) issues.push(`${view.warnings.length} 条资料提示`);
  return issues;
}
