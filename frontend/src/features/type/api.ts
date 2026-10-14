import { api, ApiError, array, message, numeric, optionalRecord, record, responseData, text } from '@/api/client';
import { typeIndex } from '@/api/research';
import type { components } from '@/api/generated/schema';
import type { DomainDocument } from '@/lib/domain-fields';
import { publicationStatus, type DesignStatus } from './design-summary';

export type Workspace = { id: string; revision: number; document: DomainDocument; raw: Record<string, unknown> };
export type TypeRow = { id: string; name: string; version: string; updated: string; status: DesignStatus; raw: Record<string, unknown>; document: DomainDocument; standards: string[]; standardsReason: string };
export type ModelChoice = { id: string; name: string; version: string; digest: string; workspace?: string; raw: Record<string, unknown> };
const documentAttempts = new Map<string, { input: string; request: string }>();

export function projectWorkspace(value: unknown): Workspace {
  const raw = record(value, '型号工作区');
  const id = text(raw.id), revision = numeric(raw.revision), domain = record(raw.domain, '型号领域输入');
  if (!id || revision === null || revision < 1 || !['cablesim.domain/1', 'cablesim.type-draft/1'].includes(text(domain.schema_version)) || !text(domain.name))
    throw new ApiError(502, '型号响应缺少身份、修订或领域文档');
  if (raw.study_cable_reference) throw new ApiError(422, '这是研究工作区，请从型号列表选择型号');
  for (const key of ['cable_types', 'materials', 'circuits', 'sections', 'load_cases']) array(domain[key], key);
  return { id, revision, document: domain as unknown as DomainDocument, raw };
}
export async function loadWorkspace(wid: string, signal?: AbortSignal, revision?: number, runId?: string) {
  if (runId) {
    const found = (await typeEvidence(wid, signal)).find(item => item.run.id === runId);
    if (!found || found.run.integrity !== 'verified') throw new ApiError(409, '固定运行不存在或完整性未通过');
    let snapshot = record(found.run.snapshot, '固定运行输入');
    if (!snapshot.workspace_state && snapshot.workspace_state_ref) {
      const run = record(await responseData(api.GET('/api/workspaces/{wid}/studies/{sid}/runs/{rid}', { params: { path: { wid, sid: text(found.study.id), rid: runId }, query: { view: 'full' } }, signal })), '固定运行完整输入');
      if (run.integrity !== 'verified' || run.id !== runId || run.workspace !== wid || run.input_digest !== found.run.input_digest || run.output_digest !== found.run.output_digest)
        throw new ApiError(409, '固定运行完整输入与保存摘要不一致，停止显示');
      snapshot = record(run.snapshot, '固定运行完整输入');
    }
    if (snapshot.workspace_id !== wid && snapshot.workspace !== wid) throw new ApiError(409, '固定运行与型号身份不一致');
    const savedRevision = numeric(snapshot.workspace_revision); if (savedRevision === null) throw new ApiError(502, '固定运行缺少输入版本');
    const savedState = record(snapshot.workspace_state, '固定运行领域状态');
    return projectWorkspace({ ...savedState, id: wid, revision: savedRevision, historical: found.run.freshness !== 'current', fixed_run: true, can_undo: false, can_redo: false });
  }
  if (revision !== undefined) {
    const saved = record(await responseData(api.GET('/api/workspaces/{wid}/revisions/{revision}', { params: { path: { wid, revision } }, signal })), '历史型号版本');
    if (saved.workspace !== wid || saved.revision !== revision) throw new ApiError(409, '历史型号身份不一致');
    return projectWorkspace({ ...record(saved.state, '历史输入'), id: wid, revision, updated_at: text(saved.created), historical: true, can_undo: false, can_redo: false });
  }
  const response=await fetch(`/api/types/${encodeURIComponent(wid)}/workspace`,{signal,credentials:'same-origin'});
  const value=await response.json();
  if(!response.ok)throw new ApiError(response.status,text(optionalRecord(value.detail).message)||text(value.detail)||'型号输入读取失败，请重新读取',value.detail);
  return projectWorkspace(value);
}
export async function publishedTypes(signal?: AbortSignal) {
  const data = record(await responseData(api.GET('/api/types/library', { signal })), '已发布型号');
  return array(data.items, '已发布型号列表').map(value => record(value, '已发布型号'));
}
export async function moduleMethods(signal?: AbortSignal) {
  const response=await fetch('/api/methods?view=summary',{signal,credentials:'same-origin'});
  if(!response.ok){const payload=optionalRecord(await response.json()),detail=payload.detail;
    throw new ApiError(response.status,text(optionalRecord(detail).message)||text(detail)||'方法目录读取失败，请重新读取',detail);}
  return array(await response.json(),'方法目录').map(value=>record(value,'方法'));
}
export async function typeRequirements(wid:string, runId:string, signal?:AbortSignal) {
  try { return record(await responseData(api.GET('/api/design/type-workspaces/{wid}/requirements', {
    params:{path:{wid},query:{run_id:runId}},signal:AbortSignal.any([AbortSignal.timeout(20000),...(signal?[signal]:[])]) })), '要求目录'); }
  catch(error) { if(error instanceof Error&&error.name==='TimeoutError')throw new Error('要求目录读取超过 20 秒，请重新读取。');throw error; }
}
export async function listTypes(signal?: AbortSignal): Promise<TypeRow[]> {
  const [drafts, published] = await Promise.all([typeIndex(signal), publishedTypes(signal)]);
  const ids = [...new Set([...drafts.map(item => text(item.id)), ...published.map(item => text(item.workspace_id))])];
  const rows: TypeRow[] = [];
  // Bounded reads of the design objects: multiple published versions share one design home.
  for (let start = 0; start < ids.length; start += 4) rows.push(...await Promise.all(ids.slice(start, start + 4).map(async id => {
    if (!id) throw new ApiError(502, '型号列表缺少身份');
    const workspaceRead = loadWorkspace(id, signal);
    const [workspace, standards] = await Promise.all([workspaceRead, executionStandards(id, workspaceRead, signal)]);
    const raw = workspace.raw, origin = optionalRecord(raw.type_origin_reference);
    return { id, name: workspace.document.name, version: text(origin.version), updated: text(raw.updated_at), status: publicationStatus(raw), raw, document: workspace.document, ...standards };
  })));
  return rows;
}
async function executionStandards(id: string, workspaceRead: Promise<Workspace>, signal?: AbortSignal) {
  try {
    const response=await fetch(`/api/types/${encodeURIComponent(id)}/standards-summary`,{signal:AbortSignal.any([AbortSignal.timeout(10000),...(signal?[signal]:[])])});
    const data=await response.json();if(!response.ok)throw new ApiError(response.status,'执行标准目录暂不可用，请重新读取');
    const summary=record(data,'执行标准目录'), workspace=await workspaceRead;if(summary.revision!==workspace.revision)throw new ApiError(409,'型号修订已变化，请刷新目录');
    const standards=array(summary.standards,'执行标准').map(value=>text(value));
    return {standards,standardsReason:text(summary.reason)};
  } catch (error) {
    if (signal?.aborted) throw error;
    return { standards: [], standardsReason: '在要求与标准里添加；要求目录未能读取：' + message(error) };
  }
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
  if (base.raw.type_creation) {
    const input = JSON.stringify({ expected_revision: base.revision, document });
    if (documentAttempts.get(base.id)?.input !== input) documentAttempts.set(base.id, { input, request: crypto.randomUUID() });
    const attempt = documentAttempts.get(base.id)!;
    const response = await fetch(`/api/types/${encodeURIComponent(base.id)}/document`, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_revision: base.revision, request_id: attempt.request, document }), signal: AbortSignal.timeout(30000) });
    const result: unknown = await response.json(); if (!response.ok) { const detail = optionalRecord(result).detail; throw new ApiError(response.status, typeof detail === 'string' ? detail : text(optionalRecord(detail).message) || '草稿保存失败', detail); }
    const saved = projectWorkspace(result); documentAttempts.delete(base.id); return saved;
  }
  await responseData(api.PUT('/api/workspaces/{wid}/domain', { params: { path: { wid: base.id } }, body: { expected_revision: base.revision, document } }));
  return loadWorkspace(base.id);
}
export async function historyType(base: Workspace, direction: 'undo' | 'redo') {
  return projectWorkspace(await responseData(api.POST('/api/workspaces/{wid}/history/{direction}', { params: { path: { wid: base.id, direction } }, body: { expected_revision: base.revision } })));
}
export async function typeEvidence(wid: string, signal?: AbortSignal, recent=false, module?:string) {
  const runs=async()=>{
    const items:Record<string,unknown>[]=[];let after=0;
    // Full result artifacts stay intact. Small pages keep real saved evidence
    // within the host response-cache budget; the history bound remains 2000 runs.
    for(let page=0;page<400;page++){
      const response=await fetch(`/api/types/${encodeURIComponent(wid)}/display-runs?after=${after}&limit=5${recent?'&recent=true':''}${recent&&module?'&module='+encodeURIComponent(module):''}`,{signal});
      const result=await response.json();if(!response.ok)throw new ApiError(response.status,text(optionalRecord(result).detail)||'型号保存结果暂不可用，请重新读取');
      const data=record(result,'型号保存结果');items.push(...array(data.items,'保存运行').map(value=>record(value,'保存运行')));
      const cursor=numeric(data.next_cursor);if(cursor===null)return items;
      if(cursor<=after)throw new ApiError(502,'型号运行分页游标无效');after=cursor;
    }
    throw new ApiError(502,'保存运行过多，请按历史版本缩小范围');
  };
  const items=await runs();
  return items.map(run=>{
    const snapshot=record(run.snapshot,'保存运行输入'),id=text(run.study),revision=numeric(snapshot.study_revision);
    if(!id||snapshot.study_id!==id||revision===null)throw new ApiError(502,'保存运行缺少对应研究身份与修订');
    // Result attribution uses its immutable method definition, not a second read
    // of every study's current definition and latest result.
    return{study:{id,revision,definition:record(snapshot.definition,'保存运行方法')},run};
  }).sort((a,b)=>text(b.run.created).localeCompare(text(a.run.created)));
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
      if (object.schema === schema) {
        if(object.display_status_only)throw new ApiError(409,'请打开对应模块读取完整结果；状态摘要不能代替计算工件');
        return object;
      }
    }
  }
  return null;
}
