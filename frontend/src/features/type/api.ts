import { api, ApiError, array, numeric, optionalRecord, record, responseData, text } from '@/api/client';
import { typeIndex, studyRuns } from '@/api/research';
import type { components } from '@/api/generated/schema';
import type { DomainDocument } from '@/lib/domain-fields';

export type Workspace = { id: string; revision: number; document: DomainDocument; raw: Record<string, unknown> };
export type TypeRow = { id: string; name: string; version: string; updated: string; status: 'draft' | 'published'; raw: Record<string, unknown> };
export type ModelChoice = { id: string; name: string; version: string; digest: string; workspace?: string; raw: Record<string, unknown> };

export function projectWorkspace(value: unknown): Workspace {
  const raw = record(value, '型号工作区');
  const id = text(raw.id), revision = numeric(raw.revision), domain = record(raw.domain, '型号领域输入');
  if (!id || revision === null || revision < 1 || domain.schema_version !== 'cablesim.domain/1' || !text(domain.name))
    throw new ApiError(502, '型号响应缺少身份、修订或领域文档');
  if (raw.study_cable_reference) throw new ApiError(422, '这是研究工作区，请从型号列表选择型号');
  for (const key of ['cable_types', 'materials', 'circuits', 'sections', 'load_cases']) array(domain[key], key);
  return { id, revision, document: domain as unknown as DomainDocument, raw };
}
export async function loadWorkspace(wid: string, signal?: AbortSignal, revision?: number, runId?: string) {
  if (runId) {
    const found = (await typeEvidence(wid, signal)).find(item => item.run.id === runId);
    if (!found || found.run.integrity !== 'verified') throw new ApiError(409, '固定运行不存在或完整性未通过');
    const snapshot = record(found.run.snapshot, '固定运行输入');
    if (snapshot.workspace_id !== wid && snapshot.workspace !== wid) throw new ApiError(409, '固定运行与型号身份不一致');
    const savedRevision = numeric(snapshot.workspace_revision); if (savedRevision === null) throw new ApiError(502, '固定运行缺少输入版本');
    const savedState = record(snapshot.workspace_state, '固定运行领域状态');
    return projectWorkspace({ ...savedState, id: wid, revision: savedRevision, historical: found.run.freshness !== 'current', fixed_run: true, can_undo: false, can_redo: false });
  }
  if (revision !== undefined) {
    const saved = record(await responseData(api.GET('/api/workspaces/{wid}/revisions/{revision}', { params: { path: { wid, revision } }, signal })), '历史型号版本');
    if (saved.workspace !== wid || saved.revision !== revision) throw new ApiError(409, '历史型号身份不一致');
    return projectWorkspace({ ...record(saved.state, '历史输入'), id: wid, revision, historical: true, can_undo: false, can_redo: false });
  }
  return projectWorkspace(await responseData(api.GET('/api/workspaces/{wid}', { params: { path: { wid } }, signal })));
}
export async function publishedTypes(signal?: AbortSignal) {
  const data = record(await responseData(api.GET('/api/types/library', { signal })), '已发布型号');
  return array(data.items, '已发布型号列表').map(value => record(value, '已发布型号'));
}
export async function listTypes(signal?: AbortSignal): Promise<TypeRow[]> {
  const [drafts, published] = await Promise.all([typeIndex(signal), publishedTypes(signal)]);
  const released = new Set(published.map(item => text(item.workspace_id)));
  return [
    ...published.map(item => ({ id: text(item.workspace_id), name: text(item.name), version: text(item.version), updated: text(item.created), status: 'published' as const, raw: item })),
    ...drafts.filter(item => !released.has(text(item.id))).map(item => ({ id: text(item.id), name: text(item.name), version: text(item.origin_version), updated: text(item.updated_at), status: 'draft' as const, raw: item })),
  ].map(item => { if (!item.id || !item.name) throw new ApiError(502, '型号列表缺少名称或身份'); return item; });
}
export async function modelChoices(signal?: AbortSignal): Promise<ModelChoice[]> {
  const [system, published] = await Promise.all([
    responseData(api.GET('/api/design/cable-models', { signal })), publishedTypes(signal),
  ]);
  return [...array(system, '系统型号').map(value => record(value, '系统型号')), ...published].map(item => {
    const model = { id: text(item.id), name: text(item.name), version: text(item.version), digest: text(item.content_sha256), workspace: text(item.workspace_id) || undefined, raw: item };
    if (!model.id || !model.name || !/^[0-9a-f]{64}$/.test(model.digest)) throw new ApiError(502, '基准型号缺少名称或完整性摘要');
    return model;
  });
}
export async function createType(model: ModelChoice, requestId: string) {
  if (model.workspace) {
    const base = await loadWorkspace(model.workspace);
    const body: components['schemas']['Branch'] = { expected_revision: base.revision, request_id: requestId, name: '新版本方案' };
    const result = record(await responseData(api.POST('/api/types/{wid}/plans', { params: { path: { wid: base.id } }, body })), '新型号方案');
    const wid = text(result.workspace_id);
    if (!wid) throw new ApiError(502, '新型号方案未返回工作区身份');
    return wid;
  }
  const result = projectWorkspace(await responseData(api.POST('/api/design/type-workspaces', { body: { model_id: model.id, content_sha256: model.digest } })));
  return result.id;
}
export async function saveType(base: Workspace, document: DomainDocument) {
  await responseData(api.PUT('/api/workspaces/{wid}/domain', { params: { path: { wid: base.id } }, body: { expected_revision: base.revision, document } }));
  return loadWorkspace(base.id);
}
export async function historyType(base: Workspace, direction: 'undo' | 'redo') {
  return projectWorkspace(await responseData(api.POST('/api/workspaces/{wid}/history/{direction}', { params: { path: { wid: base.id, direction } }, body: { expected_revision: base.revision } })));
}
export async function typeEvidence(wid: string, signal?: AbortSignal) {
  const studies = array(await responseData(api.GET('/api/workspaces/{wid}/studies', { params: { path: { wid } }, signal })), '型号研究').map(value => record(value, '型号研究'));
  const groups = await Promise.all(studies.map(async study => {
    const sid = text(study.id); if (!sid) throw new ApiError(502, '型号研究缺少身份');
    return { study, runs: await studyRuns(wid, sid, signal) };
  }));
  return groups.flatMap(group => group.runs.map(run => ({ study: group.study, run }))).sort((a, b) => text(b.run.created).localeCompare(text(a.run.created)));
}
export function runArtifact(run: Record<string, unknown>, schema: string): Record<string, unknown> | null {
  if (run.integrity !== 'verified') throw new ApiError(409, '保存运行的完整性未通过，不能显示结果');
  const output = record(run.output, '运行输出');
  const cases = array(output.cases, '运行工况');
  for (const value of cases) {
    const item = record(value, '运行工况');
    if (item.status !== 'succeeded') continue;
    for (const artifact of Object.values(optionalRecord(item.artifacts))) {
      const object = optionalRecord(artifact);
      if (object.schema === schema) return object;
    }
  }
  return null;
}
