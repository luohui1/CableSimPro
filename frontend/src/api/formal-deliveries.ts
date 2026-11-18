/**
 * Official T4 delivery: render only immutable, revision-pinned saved evidence.
 * Preview and export must receive the exact same request; never run a solver
 * or invent an approval signature in the browser.
 */
export type FormalKind = 'specification' | 'calculation' | 'rating_table' | 'research_report';
export type FormalRunPin = { run_id: string; input_digest: string; output_digest: string };
export type FormalSource = {
  workspace_id: string;
  expected_revision: number;
  specification_digest?: string;
  runs?: FormalRunPin[];
};
export type FormalDocument = {
  organization: string;
  number: string;
  revision: string;
  header?: string;
  footer?: string;
  issued_on?: string;
};
export type FormalRequest = { kind: FormalKind; source: FormalSource; document: FormalDocument };
export type FormalPreview = {
  kind: FormalKind;
  model_digest: string;
  source_digest: string;
  title: string;
  sections: { role: string; heading: string; table_ids: string[] }[];
  signatures: { role: string; label: string; name: string | null; date: string | null }[];
  sources: Record<string, unknown>;
};

const DIGEST = /^[a-f0-9]{64}$/;
const ENDPOINT = '/api/formal-deliveries';

async function errorText(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const data = body !== null && typeof body === 'object' ? body as Record<string, unknown> : {};
  const detail = data.detail && typeof data.detail === 'object' ? data.detail as Record<string, unknown> : {};
  return typeof detail.message === 'string' ? detail.message : typeof data.detail === 'string'
    ? data.detail : '正式交付接口拒绝了请求，请核对保存版本、文件信息和来源。';
}

export function assertFormalSource(request: FormalRequest): void {
  const source = request.source;
  if (!source.workspace_id || !Number.isSafeInteger(source.expected_revision) || source.expected_revision < 0)
    throw new Error('必须选择已保存的工程及其当前修订。');
  if (request.kind === 'specification') {
    if (!DIGEST.test(source.specification_digest || '') || source.runs?.length)
      throw new Error('规格书须绑定完整的已保存规格书摘要。');
  } else {
    if (source.specification_digest || !source.runs?.length || source.runs.length > 16 ||
      source.runs.some(item => !item.run_id || !DIGEST.test(item.input_digest) || !DIGEST.test(item.output_digest)) ||
      request.kind !== 'research_report' && source.runs.length !== 1)
      throw new Error('正式计算书或载流量表须绑定完整的固定运行身份和两个摘要。');
  }
  for (const key of ['organization','number','revision'] as const) {
    const value = request.document[key];
    if (!value?.trim() || /[\x00-\x1f\x7f]/.test(value)) throw new Error('请填写有效的单位名称、文件编号与版次。');
  }
}

export async function formalPreview(request: FormalRequest, signal?: AbortSignal): Promise<FormalPreview> {
  assertFormalSource(request);
  const response = await fetch(ENDPOINT + '/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal, cache: 'no-store',
  });
  if (!response.ok) throw new Error(await errorText(response));
  const body: FormalPreview = await response.json();
  if (body.kind !== request.kind || !DIGEST.test(body.model_digest) ||
    !DIGEST.test(body.source_digest) || !Array.isArray(body.sections) ||
    !Array.isArray(body.signatures) || !body.sources ||
    Object.values(body.sources).some(source => source && typeof source === 'object' && 'payload' in source))
    throw new Error('正式交付预览缺少来源摘要或包含未授权的原始数据，请停止导出。');
  return body;
}

export async function formalExport(request: FormalRequest, preview: FormalPreview, format: 'pdf' | 'xlsx'): Promise<Blob> {
  assertFormalSource(request);
  if (preview.kind !== request.kind || !DIGEST.test(preview.model_digest))
    throw new Error('正式交付预览已过期，请重新核对。');
  const response = await fetch(ENDPOINT + '/export', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, format, expected_model_digest: preview.model_digest }), cache: 'no-store',
  });
  if (!response.ok) throw new Error(await errorText(response));
  if (response.headers.get('X-Delivery-Model-SHA256') !== preview.model_digest ||
    response.headers.get('X-Delivery-Source-SHA256') !== preview.source_digest ||
    response.headers.get('Cache-Control') !== 'no-store')
    throw new Error('交付文件和预览来源不一致，拒绝下载。');
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 64 * 1024 * 1024)
    throw new Error('交付文件为空或超过限制，拒绝下载。');
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (response.headers.get('X-Artifact-SHA256') !== actual)
    throw new Error('正式文件字节摘要校验未通过，拒绝下载。');
  const contentType = format === 'pdf' ? 'application/pdf' :
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (format === 'pdf' && new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
    throw new Error('返回的文件不是 PDF，拒绝下载。');
  return new Blob([bytes], { type: contentType });
}

export function formalFilename(request: FormalRequest, format: 'pdf' | 'xlsx'): string {
  const number = request.document.number.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/g, '') || 'CableSimPro';
  return `${number}-${request.kind}.${format}`;
}
