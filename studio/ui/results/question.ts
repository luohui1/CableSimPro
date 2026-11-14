// What the screen is answering, in one plain sentence. The screen reads like a worked problem:
// the question (求), what is given (已知), the answer (结论).
import { compact } from '@shared/format';
import type { ProjectView, RunRecord } from '@shared/types';

export function questionOf(view: ProjectView | undefined, record: RunRecord | undefined): string {
  if (!view) return '';
  const circuits = view.preview?.circuit_count ?? 1;
  const loads = (record?.inputs ?? view.parts).conditions.currents_a;
  const load = `${compact(loads[0])} A`;
  const line = circuits > 1 ? `这 ${circuits} 回线路同时最多能带多少电流` : '这回线路最多能带多少电流';
  if (!record) return `${line}。还没有算过，点右上角的“运行校核”`;
  if (record.kind === 'sweep' && record.sweep) {
    const values = record.sweep.points.map(point => point.value);
    return `${record.sweep.label}从 ${compact(Math.min(...values))} 变到 ${compact(Math.max(...values))} ${record.sweep.unit}，能带的电流怎么变`;
  }
  if (record.kind === 'selection' && record.selection) return `要带 ${compact(record.selection.target_current_a)} A，最小要用多大截面`;
  return `${line}，现在${circuits > 1 ? '每回 ' : '的 '}${load} 行不行`;
}
