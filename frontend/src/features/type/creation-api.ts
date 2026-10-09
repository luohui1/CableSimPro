import { ApiError, array, optionalRecord, record, text } from '@/api/client';
import { projectWorkspace } from './api';

export type Origin = 'library' | 'standard' | 'import' | 'blank';
export type Proposal = { id: string; content_sha256: string; rows: Record<string, unknown>[]; limitations: string[]; document: unknown };
export async function creationRequest(path: string, body?: unknown, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(30000);
  const response = await fetch('/api/types' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-CableSim-Actor': 'human' }, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const value: unknown = await response.json();
  if (!response.ok) { const detail = record(value).detail, object = optionalRecord(detail); throw new ApiError(response.status, typeof detail === 'string' ? detail : text(object.message) || (Array.isArray(detail) ? detail.map(v => text(optionalRecord(v).msg)).join('；') : '请求未完成'), detail); }
  return record(value);
}
export async function creationOptions(signal?: AbortSignal) {
  const data = await creationRequest('/creation-options', undefined, signal);
  return { library: array(data.library).map(v => record(v)), imports: array(data.imports).map(v => record(v)), generation: array(data.generation).map(v => record(v)) };
}
export async function proposeType(input: Record<string, unknown>, request: string): Promise<Proposal> {
  const data = await creationRequest('/creation-proposals', { request_id: request, input });
  if (!text(data.id) || !/^[a-f0-9]{64}$/.test(text(data.content_sha256))) throw new ApiError(502, '结构提案缺少固定身份');
  return { id: text(data.id), content_sha256: text(data.content_sha256), rows: array(data.rows).map(v => record(v)), limitations: array(data.limitations).map(String), document: data.document };
}
export async function newType(body: Record<string, unknown>) { return projectWorkspace(await creationRequest('', body)); }
