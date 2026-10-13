import { api, ApiError, array, numeric, optionalRecord, record, responseData, text } from '@/api/client';
import type { components } from '@/api/generated/schema';
import { projectWorkspace, type Workspace } from './api';

export type ComparisonMetric = Record<string, unknown> & { value: number | null; unit: string; state: string };
export type ComparisonRequirement = { id: string; title?: string; standard?: string; clause?: string };
export type ComparisonCheck = { verdict?: string | null; state: string; actual?: number | null; margin?: number | null; unit?: string | null; reason?: string | null; source?: Record<string, unknown> | null };
export type ComparisonItem = Record<string, unknown> & { workspace: string; name: string; revision: number; document: Workspace['document']; values: Record<string, ComparisonMetric>; requirements: Record<string, ComparisonCheck> };
export async function typeComparison(wid: string, signal?: AbortSignal) {
  const data = record(await responseData(api.GET('/api/types/{wid}/comparison', { params: { path: { wid } }, signal })), '型号方案对比');
  const items = array(data.items, '方案').map(value => {
    const item = record(value, '方案'), workspace = text(item.workspace), revision = numeric(item.revision), values = record(item.values, '方案指标');
    if (!workspace || !text(item.name) || revision === null) throw new ApiError(502, '方案缺少身份、名称或修订');
    for (const value of Object.values(values)) { const metric = record(value, '保存指标'); if (metric.value !== null && numeric(metric.value) === null || !['missing', 'historical', 'current'].includes(text(metric.state)) || !text(metric.unit)) throw new ApiError(502, '保存指标缺少有限数值、单位或状态'); }
    const document = projectWorkspace({ id: workspace, revision, domain: item.document }).document;
    return { ...item, workspace, revision, document, name: text(item.name), values, requirements: optionalRecord(item.requirements) } as ComparisonItem;
  });
  if (new Set(items.map(item => item.workspace)).size !== items.length) throw new ApiError(502, '方案工作区身份重复');
  const requirements = (Array.isArray(data.requirements) ? data.requirements : []).map(value => {
    const row = record(value, '对比要求'); if (!text(row.id)) throw new ApiError(502, '对比要求缺少身份');
    return { id: text(row.id), title: text(row.title), standard: text(row.standard), clause: text(row.clause) } as ComparisonRequirement;
  });
  return { ...data, items, requirements };
}
export type SpecificationAudience = 'customer' | 'internal';
export type Specification = { payload: Record<string, unknown>; digest: string; lifecycle: Record<string, unknown>; ready: boolean; html: string; audience: SpecificationAudience; revisionDraft: Record<string, unknown>; exportEndpoint?: string; generationEndpoint?: string };
export async function typeSpecification(wid: string, signal?: AbortSignal, audience: SpecificationAudience = 'customer'): Promise<Specification> {
  const response=await fetch(`/api/types/${encodeURIComponent(wid)}/specification?audience=${audience}&view=detail`,{signal,credentials:'same-origin'}),value=await response.json();
  if(!response.ok)throw new ApiError(response.status,text(optionalRecord(value).detail)||'规格书读取失败，请重新读取');
  const data = record(value, '型号规格书'), payload = record(data.payload, '规格书内容'), lifecycle = record(data.lifecycle, '规格书状态');
  if (payload.schema !== 'cablesim.type-specification/1' || payload.workspace_id !== wid || numeric(payload.revision) === null || !/^[a-f0-9]{64}$/.test(text(data.digest)) || !['draft', 'submitted', 'approved', 'published'].includes(text(lifecycle.status)) || typeof data.ready !== 'boolean' || !text(data.html).startsWith('<!doctype html>')) throw new ApiError(502, '规格书缺少版本、摘要、状态或正式渲染内容');
  for (const key of ['chapters', 'checks', 'sources', 'revisions']) array(payload[key], key);
  const original=optionalRecord(data.payload_full_ref);
  if(original.digest!==data.digest||original.url!==`/api/types/${encodeURIComponent(wid)}/specification?audience=${audience}&view=full`)throw new ApiError(502,'规格书投影缺少一致的完整证据引用');
  const exported = optionalRecord(data.export), endpoint = text(exported.endpoint);
  if (endpoint && (exported.format !== 'pdf' || endpoint !== '/api/types/' + encodeURIComponent(wid) + '/specification/file')) throw new ApiError(502, '规格书导出引用与型号身份不一致');
  const generationEndpoint = text(data.generation_endpoint);
  if (generationEndpoint && generationEndpoint !== '/api/types/' + encodeURIComponent(wid) + '/specification/generate' || data.audience !== audience) throw new ApiError(502, '规格书版本或生成引用与当前型号不一致');
  return { payload, lifecycle, digest: text(data.digest), ready: data.ready, html: text(data.html), audience, revisionDraft: optionalRecord(data.revision_draft), exportEndpoint: endpoint || undefined, generationEndpoint: generationEndpoint || undefined };
}

export async function generateSpecification(wid: string, spec: Specification, revision: number, requestId: string) {
  if (!spec.generationEndpoint || spec.generationEndpoint !== '/api/types/' + encodeURIComponent(wid) + '/specification/generate') throw new ApiError(501, '当前宿主没有提供规格书生成操作');
  const result = record(await responseData(api.POST('/api/types/{wid}/specification/generate', {params:{path:{wid}},body:{expected_revision:revision,request_id:requestId,audience:spec.audience,scope_acknowledged:true}})), '规格书生成结果');
  if (!['generated', 'blocked'].includes(text(result.status)) || numeric(result.revision) !== revision || !Array.isArray(result.steps)) throw new ApiError(502, '规格书生成结果缺少状态或绑定修订');
  return result;
}
export async function branchType(wid: string, body: components['schemas']['Branch']) {
  const result = record(await responseData(api.POST('/api/types/{wid}/plans', { params: { path: { wid } }, body })), '新方案');
  if (!text(result.workspace_id)) throw new ApiError(502, '新方案未返回工作区身份'); return text(result.workspace_id);
}
export async function lifecycleAction(wid: string, action: 'adopt' | 'submissions' | 'approve' | 'publish', body: components['schemas']['Adopt'] | components['schemas']['Submit'] | components['schemas']['Approval'] | components['schemas']['Publish']) {
  if (action === 'adopt') return responseData(api.POST('/api/types/{wid}/adopt', { params: { path: { wid } }, body: body as components['schemas']['Adopt'] }));
  if (action === 'submissions') return responseData(api.POST('/api/types/{wid}/submissions', { params: { path: { wid } }, body: body as components['schemas']['Submit'] }));
  if (action === 'approve') return responseData(api.POST('/api/types/{wid}/approve', { params: { path: { wid } }, headers: { 'x-cablesim-actor': 'human' }, body: body as components['schemas']['Approval'] }));
  return responseData(api.POST('/api/types/{wid}/publish', { params: { path: { wid } }, headers: { 'x-cablesim-actor': 'human' }, body: body as components['schemas']['Publish'] }));
}
export async function exportSpecification(wid: string, spec: Specification) {
  if (!spec.exportEndpoint) throw new ApiError(501, '当前宿主尚未提供规格书 PDF 导出引用');
  if (spec.exportEndpoint !== '/api/types/' + encodeURIComponent(wid) + '/specification/file') throw new ApiError(409, '规格书导出引用与当前型号身份不一致');
  const { data, error, response } = await api.GET('/api/types/{wid}/specification/file', {
    params: { path: { wid }, query: { audience: spec.audience, expected_revision: Number(spec.payload.revision), specification_digest: spec.digest } }, parseAs: 'arrayBuffer',
  });
  if (!response.ok) { const failure = optionalRecord(error), detail = optionalRecord(failure.detail); throw new ApiError(response.status, text(failure.detail) || text(detail.message) || '规格书导出失败'); }
  if (response.headers.get('X-Specification-SHA256') !== spec.digest || response.headers.get('X-Specification-Audience') !== spec.audience || !response.headers.get('Content-Type')?.startsWith('application/pdf')) throw new ApiError(409, '导出内容未绑定当前规格书摘要与版本');
  if (!(data instanceof ArrayBuffer)) throw new ApiError(502, '规格书未返回完整 PDF 文件');
  const buffer = data, digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(value => value.toString(16).padStart(2, '0')).join('');
  if (response.headers.get('X-Artifact-SHA256') !== digest) throw new ApiError(409, '导出文件完整性校验失败');
  return new Blob([buffer], { type: 'application/pdf' });
}
