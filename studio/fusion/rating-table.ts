// A table card reads the same immutable row projection as the type workbench. Neither the model nor this adapter computes a row.
import type { CardRef } from '../shared/types.ts';
import type { SavedRatingTableView } from '../shared/fusion-types.ts';
import type { Backend } from './backend.ts';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const number = (value: unknown): number | null => finite(value) ? value : null;

export async function savedRatingTable(backend: Backend, resource: RecordValue, signal?: AbortSignal): Promise<{ card: CardRef; notes: string[] } | undefined> {
  const { workspace_id: workspace, study_id: study, run_id: run } = resource;
  if (resource.kind !== 'rating_table' || typeof workspace !== 'string' || typeof study !== 'string' || typeof run !== 'string') return undefined;
  const href = `cablesim:type_rating/${encodeURIComponent(workspace)}?run=${encodeURIComponent(run)}`;
  const open = (reason: string): { card: CardRef; notes: string[] } => ({ card: { kind: 'open', label: '查看保存的载流量表', href }, notes: [reason] });
  if (resource.integrity !== 'verified' || typeof resource.input_digest !== 'string' || typeof resource.output_digest !== 'string') {
    return open('此表的保存输入或输出完整性尚未核对，未展示数值。请在工作台检查。');
  }
  const result = await backend.read<{ run: RecordValue; rows: unknown[] }>(
    `/api/design/workspaces/${encodeURIComponent(workspace)}/rating-table-runs/${encodeURIComponent(run)}?view=rows`, signal);
  const saved = result.run;
  if (saved.integrity !== 'verified' || saved.id !== run || saved.workspace !== workspace || saved.study !== study
    || saved.input_digest !== resource.input_digest || saved.output_digest !== resource.output_digest) {
    return open('载流量表的对象、运行或保存摘要不一致，未混用其他记录的数值。请在工作台检查。');
  }
  if (!Array.isArray(result.rows) || result.rows.length === 0 || result.rows.length > 100) return open('保存的载流量表没有可读取的工况行，请在工作台查看。');
  const identities = new Set<string>();
  const rows: SavedRatingTableView['rows'] = [];
  for (const raw of result.rows) {
    const row = record(raw);
    if (typeof row.case_id !== 'string' || !row.case_id || identities.has(row.case_id) || typeof row.name !== 'string'
      || typeof row.status !== 'string' || !(row.value_a === null || finite(row.value_a))
      || (row.value_a !== null && row.status !== '已计算')) {
      return open('保存工况的身份、状态或电流值不完整，未把缺项行当成成功结果。请在工作台查看。');
    }
    identities.add(row.case_id);
    const condition = record(row.condition);
    rows.push({ case_id: row.case_id, name: row.name, depth_m: number(condition.depth_m),
      soil_rho_k_m_w: number(condition.soil_rho_k_m_w), ambient_temperature_c: number(condition.ambient_temperature_c),
      value_a: number(row.value_a), status: row.status, reason: typeof row.reason === 'string' ? row.reason : null,
      rating_basis: typeof condition.rating_basis_name === 'string' ? condition.rating_basis_name : '口径未声明' });
  }
  const method = record(resource.method);
  if (typeof method.plugin_id !== 'string' || typeof method.version !== 'string' || typeof resource.title !== 'string') return open('保存记录缺少准确的方法身份，请在工作台查看。');
  const methods = await backend.read<{ method: { plugin_id: string }; name: string }[]>('/api/methods?view=summary', signal);
  const named = methods.find(item => item.method.plugin_id === method.plugin_id);
  if (!named) return open('此保存方法的名称暂时无法读取，请在工作台查看完整记录。');
  return { card: { kind: 'saved_rating_table', href, view: {
    title: resource.title, method: `${named.name} ${method.version}`,
    freshness: saved.freshness === 'current' || saved.freshness === 'historical' ? saved.freshness : 'unknown',
    rows: rows.slice(0, 8), total: rows.length,
  } }, notes: ['各工况来自同一保存运行；缺项或失败行保留原原因，未插值或重新计算。'] };
}
