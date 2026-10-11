import { api, ApiError, array, numeric, record, responseData, text } from '@/api/client';
import type { components } from '@/api/generated/schema';
import { committedParameter, type ParameterDraft } from '@/lib/study-config';

export type RatingCondition = components['schemas']['RatingRow'] & { frequency_hz?: number };
export type RatingBody = Omit<components['schemas']['RatingTableDefinition'], 'expected_revision' | 'rows'> & { rows: RatingCondition[] };
export type RatingDraft = { body: RatingBody; revision: number; study?: components['schemas']['StudyResponse']; fields: Record<string, string>; parameterFields?: Record<string, ParameterDraft> };
export async function typeStudies(wid: string, signal?: AbortSignal) { return array(await responseData(api.GET('/api/workspaces/{wid}/studies', { params: { path: { wid } }, signal })), '型号方法').map(value => record(value, '型号方法') as unknown as components['schemas']['StudyResponse']); }
export function isRatingDefinition(value: unknown) { const definition = record(value, '方法配置'); const driver = definition.driver as Record<string, unknown> | undefined; return driver?.kind === 'batch' && Array.isArray(driver.cases) && driver.cases.length > 0 && driver.cases.every(value => (value as Record<string, unknown>)?.metadata && ((value as Record<string, unknown>).metadata as Record<string, unknown>).kind === 'type-rating-table'); }
export function ratingBody(study: components['schemas']['StudyResponse']): RatingBody {
  const definition = study.definition, driver = record(definition.driver, '载流量表工况');
  return { rows: array(driver.cases, '载流量表工况').map(value => { const row=record(record(record(value, '工况').metadata, '工况身份').condition, '保存条件'); return { ...row, rating_basis: row.rating_basis || driver.rating_basis || 'individual' } as unknown as components['schemas']['RatingRow']; }), parameters: structuredClone(definition.parameters || {}), selected_case_ids: Array.isArray(driver.selected_case_ids) ? driver.selected_case_ids as string[] : null };
}
export async function compileRating(wid: string, revision: number, body: RatingBody) {
  const result = record(await responseData(api.POST('/api/design/workspaces/{wid}/rating-table-definition', { params: { path: { wid } }, body: { ...body, expected_revision: revision } })), '宿主编译的工况配置');
  if (!text(result.title) || result.input_source !== 'study' || !isRatingDefinition(result) || !text(record(result.method, '精确方法发行').release_digest)) throw new ApiError(502, '工况编译响应缺少正式方法或输入身份');
  return result as Omit<components['schemas']['CreateStudy'], 'expected_revision'>;
}
export function commitRating(draft: RatingDraft): RatingBody {
  const body = structuredClone(draft.body);
  for (const field of Object.values(draft.parameterFields || {})) {
    const parts = field.path.split('/').filter(Boolean);
    let target: Record<string, unknown> = body.parameters || (body.parameters = {});
    for (const key of parts.slice(0, -1)) { const value = target[key]; target[key] = value && typeof value === 'object' && !Array.isArray(value) ? value : {}; target = target[key] as Record<string, unknown>; }
    const value = committedParameter(field); if (value === undefined) delete target[parts.at(-1)!]; else target[parts.at(-1)!] = value;
  }
  for (const [key, raw] of Object.entries(draft.fields)) {
    const split = key.lastIndexOf('/'), id = key.slice(0, split), field = key.slice(split + 1), row = body.rows.find(row => row.case_id === id); if (!row) throw new ApiError(422, '编辑工况已不存在');
    const value = raw.trim() === '' ? null : Number(raw); if (value === null && field !== 'spacing_m' || value !== null && !Number.isFinite(value)) throw new ApiError(422, '请填写有效的 ' + field + '；原草稿保留');
    Object.assign(row, { [field]: value });
  }
  return body;
}
export async function saveRating(wid: string, draft: RatingDraft, revision = draft.revision) {
  const definition = await compileRating(wid, revision, commitRating(draft));
  const study = draft.study ? await responseData(api.PUT('/api/workspaces/{wid}/studies/{sid}', { params: { path: { wid, sid: draft.study.id } }, body: { ...definition, expected_revision: revision, expected_study_revision: draft.study.revision } })) : await responseData(api.POST('/api/workspaces/{wid}/studies', { params: { path: { wid } }, body: { ...definition, expected_revision: revision } }));
  if (!study || !numeric(study.revision)) throw new ApiError(502, '工况保存未返回方法版本'); return study;
}
export async function ratingResults(wid: string, rid: string, signal?: AbortSignal) {
  const result = record(await responseData(api.GET('/api/design/workspaces/{wid}/rating-table-runs/{rid}', { params: { path: { wid, rid } }, signal })), '载流量表结果');
  const run = record(result.run, '载流量表运行'); if (run.integrity !== 'verified' || run.id !== rid) throw new ApiError(409, '载流量表运行完整性或身份不一致');
  const rows = array(result.rows, '载流量结果行').map(value => { const row = record(value, '载流量结果行'); if (!text(row.case_id) || !text(row.name) || !text(row.status) || row.value_a !== null && numeric(row.value_a) === null) throw new ApiError(502, '载流量结果缺少身份、状态或有限电流'); return { ...row, id: text(row.case_id) } as Record<string, unknown> & { id: string }; });
  return { run, rows };
}
