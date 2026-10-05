// 推荐值由用户指定；其余候选仅为布局补充。不是求解器输出、标准限值或工程推荐。
export type Verdict = 'satisfied' | 'unsatisfied' | 'inapplicable';
export type Candidate = { id: string; section: number; current: number | null; margin: string | null; verdict: Verdict; reason: string };
export const sample = {
  title: '10 kV 3 回路排管每回 400 A 选型',
  family: 'YJV22-8.7/15 kV',
  recommendation: 'YJV22-8.7/15 kV 3×300',
  circuits: '3 回路',
  target: 400,
  current: 452,
  margin: '13.0%',
  provenance: '方向样稿：推荐值由用户指定，其他候选仅用于布局 · 未调用计算插件',
} as const;
export const candidates: Candidate[] = [
  { id: 's300', section: 300, current: 452, margin: '13.0%', verdict: 'satisfied', reason: '三回路均满足目标电流；本例中的最小满足截面。' },
  { id: 's400', section: 400, current: 514, margin: '28.5%', verdict: 'satisfied', reason: '三回路均满足目标电流。' },
  { id: 's240', section: 240, current: 391, margin: '−2.3%', verdict: 'unsatisfied', reason: '回路 2 允许电流低于目标 400 A。' },
  { id: 's185', section: 185, current: 336, margin: '−16.0%', verdict: 'unsatisfied', reason: '回路 2 允许电流低于目标 400 A。' },
  { id: 's150', section: 150, current: null, margin: null, verdict: 'inapplicable', reason: '所选方法未声明支持该候选结构，不计算。' },
];
export const verdictLabels = { satisfied: '满足', unsatisfied: '不满足', inapplicable: '不适用' } as const;
