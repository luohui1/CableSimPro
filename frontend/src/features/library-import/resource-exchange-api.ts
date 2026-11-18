import { ApiError, optionalRecord, text } from '@/api/client';

/** Projections of the existing library exchange routes, not another data store. */
export interface ExchangeWorkspace { id: string; name: string; revision: number; updated_at: string }
export interface PublishedModelProofSummary {
  family: string; version: string; asset_sha256: string; specification_sha256: string;
  proof_bytes: number; dependency_count: number; source_run_count: number;
  run_evidence: 'external_declared_run'; approval_inherited: false;
  source_approval: { reviewer: string; approved_at: string; authority: string };
}
export interface ResourceExchangePreview {
  sha256: string;
  assets: { origin_id: string; name: string; kind: string; action: 'reuse' | 'create_draft'; existing_id: string | null }[];
  projects: { origin_id: string; name: string; action: 'create_independent_input_copy'; published_model?: PublishedModelProofSummary }[];
  requires_human_confirmation: boolean; approval_inherited: boolean; limitations: string[];
}
export interface ResourceExchangeReceipt {
  request_id: string; sha256: string;
  assets: { origin_id: string; id: string; action: 'reuse' | 'create_draft' }[];
  projects: { origin_id: string; id: string; revision: number }[];
  approval_inherited: boolean; confirmed_by: string; created: string;
}
export type ExchangeFormat = 'json' | 'xlsx';
export const exchangeKindNames: Record<string, string> = {
  material: '材料资料', installation: '敷设与环境', component: '部件', assembly: '组合结构',
  rule: '标准规则', study_template: '研究模板',
};

export async function downloadResourceExchange(selection: { asset_ids: string[]; workspace_ids: string[]; format: ExchangeFormat }) {
  const response = await fetch('/api/library/exchange/export', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(selection),
  });
  if (!response.ok) {
    const payload = optionalRecord(await response.json().catch(() => null));
    const detail = payload.detail ?? payload;
    throw new ApiError(response.status, typeof detail === 'string' ? detail : text(optionalRecord(detail).message) || '导出失败，请核对所选资料与工程的保存输入。', detail);
  }
  const filename = `cablesim-data.${selection.format}`;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { filename, bundle_sha256: response.headers.get('X-Bundle-SHA256'), file_sha256: response.headers.get('X-Content-SHA256') };
}
