import { taskName, TASK_NAMES, statusLabel } from './status-vocabulary.ts';
import { displayName } from './display-names.ts';
import { formatNumber, significantNumber } from './format.ts';

export function indexedRunName(name: string): string {
  const ordinal = name.match(/·\s*(?:运行\s*)?(\d+)$/);
  return ordinal ? `第 ${ordinal[1]} 次运行` : '保存运行';
}

export function runPresentation(run: Record<string, unknown>) {
  const method = run.method && typeof run.method === 'object' ? run.method as Record<string, unknown> : {};
  const sequence = Number(run.sequence);
  const capability = typeof method.capability === 'string' ? method.capability : '';
  // 当前研究定义可能已经修改；名称只用封存摘要中的方法能力。
  const task = TASK_NAMES[capability] ? taskName({ method: { capability } }) : '任务未记录';
  const name = Number.isInteger(sequence) && sequence > 0 ? `第 ${sequence} 次运行 · ${task}` : `运行 · ${task}`;
  const methodLabel = typeof method.plugin_id === 'string' && typeof method.version === 'string' ? `${displayName(method.plugin_id)} · ${method.version}` : '方法未核实';
  if (run.integrity !== 'verified') return { name, method: '方法未核实', conclusion: run.integrity === 'corrupt' ? '保存记录校验失败，不能引用结论' : '保存记录未核实，不能引用结论' };
  const headlines = Array.isArray(run.headlines) ? run.headlines : [];
  const values = headlines.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const converted = typeof row.display_value === 'number' && typeof row.display_unit === 'string' && !!row.display_unit;
    const number = converted ? row.display_value : row.value, unit = converted ? row.display_unit : row.unit;
    if (typeof number !== 'number' || !Number.isFinite(number) || typeof row.title !== 'string' || !row.title || typeof unit !== 'string' || !unit) return [];
    const dimensionless = unit === '1' || unit === 'dimensionless';
    const amount = dimensionless && Number.isInteger(number) ? formatNumber(number) : significantNumber(number, 4);
    return [`${row.title} ${amount}${dimensionless ? '' : ` ${unit}`}`];
  });
  const error = run.error && typeof run.error === 'object' ? run.error as Record<string, unknown> : {};
  return { name, method: methodLabel, conclusion: values.join('；') || (typeof error.message === 'string' && error.message ? error.message : ['succeeded', 'partial'].includes(String(run.status)) ? '摘要未提供 · 查看保存运行' : statusLabel(String(run.status), '结论尚未生成')) };
}
