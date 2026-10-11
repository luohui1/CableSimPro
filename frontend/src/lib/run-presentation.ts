import { taskName, TASK_NAMES, statusLabel } from './status-vocabulary.ts';
import { displayName } from './display-names.ts';

/** 已有所属名称包含型号时保留全名，避免再次追加型号前缀。 */
export function runOwnerName(typeName: string, parentName: string) {
  const type = typeName.trim(), parent = parentName.trim();
  return !type || parent.includes(type) ? parent : !parent ? type : `${type} · ${parent}`;
}

/** 全量轻量历史按所属对象排名；全库 sequence 只用于排序，不作为展示编号。 */
export function scopedRunOrdinals(runs: Record<string, unknown>[], typeIds: ReadonlySet<string>) {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const run of runs) {
    const key = typeIds.has(String(run.workspace)) ? `type:${run.workspace}` : `study:${run.study}`;
    if (!run.id || (!run.study && !typeIds.has(String(run.workspace)))) continue;
    groups.set(key, [...(groups.get(key) || []), run]);
  }
  const result = new Map<string, number>();
  for (const rows of groups.values()) [...new Map(rows.map(run => [String(run.id), run])).values()]
    .sort((a, b) => Number(a.sequence) - Number(b.sequence) || String(a.created).localeCompare(String(b.created)) || String(a.id).localeCompare(String(b.id)))
    .forEach((run, index) => result.set(String(run.id), index + 1));
  return result;
}

export function runPresentation(run: Record<string, unknown>, ordinal?: number) {
  const method = run.method && typeof run.method === 'object' ? run.method as Record<string, unknown> : {};
  const sequence = ordinal;
  const capability = typeof method.capability === 'string' ? method.capability : '';
  const snapshot = run.snapshot && typeof run.snapshot === 'object' ? run.snapshot as Record<string, unknown> : {};
  const driver = run.driver ?? snapshot.driver;
  // 新摘要的可选 task/driver 来自封存输入；旧摘要继续用封存能力。
  const task = taskName({ task: typeof (run.task ?? snapshot.task) === 'string' ? String(run.task ?? snapshot.task) : undefined,
    driver: typeof driver === 'string' ? { kind: driver } : driver && typeof driver === 'object' ? driver as { kind?: string } : undefined,
    method: { capability } }, TASK_NAMES[capability] || '任务未记录');
  const name = typeof sequence === 'number' && Number.isInteger(sequence) && sequence > 0 ? `第 ${sequence} 次运行 · ${task}` : `运行 · ${task}`;
  const methodLabel = typeof method.plugin_id === 'string' && typeof method.version === 'string' ? `${displayName(method.plugin_id)} · ${method.version}` : '方法未核实';
  if (run.integrity !== 'verified') return { name, method: '方法未核实', conclusion: run.integrity === 'corrupt' ? '保存记录校验失败，不能引用结论' : '保存记录未核实，不能引用结论' };
  // 插件的单句 headline 由宿主核验保存工件后投影；不在列表拼接统计数或跨工况量值。
  const headline = typeof run.headline === 'string' ? run.headline.trim() : '';
  const error = run.error && typeof run.error === 'object' ? run.error as Record<string, unknown> : {};
  return { name, method: methodLabel, conclusion: headline || (typeof error.message === 'string' && error.message ? error.message : ['succeeded', 'partial'].includes(String(run.status)) ? '' : statusLabel(String(run.status), '')) };
}
