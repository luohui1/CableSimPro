import { api, ApiError, numeric, responseData } from '@/api/client';
import type { components } from '@/api/generated/schema';
import { committedParameter, type ParameterDraft } from '@/lib/study-config';

export type MethodDefinition = Omit<components['schemas']['CreateStudy'], 'expected_revision'>;
export type MethodDraft = { module: string; definition: MethodDefinition; revision: number; study?: components['schemas']['StudyResponse']; fields: Record<string, ParameterDraft> };
export function parameterValue(parameters: Record<string, unknown>, path: string, value: unknown) {
  const next = structuredClone(parameters), parts = path.split('/').filter(Boolean);
  let target = next;
  for (const key of parts.slice(0, -1)) { const item = target[key]; target[key] = item && typeof item === 'object' && !Array.isArray(item) ? item : {}; target = target[key] as Record<string, unknown>; }
  if (value === undefined) delete target[parts.at(-1)!]; else target[parts.at(-1)!] = value;
  return next;
}
export function commitMethod(draft: MethodDraft): MethodDefinition {
  let parameters = structuredClone(draft.definition.parameters || {});
  for (const field of Object.values(draft.fields)) parameters = parameterValue(parameters, field.path, committedParameter(field));
  return { ...draft.definition, parameters };
}
export async function saveMethod(wid: string, draft: MethodDraft) {
  const definition = commitMethod(draft);
  const result = draft.study ? await responseData(api.PUT('/api/workspaces/{wid}/studies/{sid}', { params: { path: { wid, sid: draft.study.id } }, body: { ...definition, expected_revision: draft.revision, expected_study_revision: draft.study.revision } })) : await responseData(api.POST('/api/workspaces/{wid}/studies', { params: { path: { wid } }, body: { ...definition, expected_revision: draft.revision } }));
  if (!result || numeric(result.revision) === null) throw new ApiError(502, '方法条件保存未返回研究版本');
  return result;
}
