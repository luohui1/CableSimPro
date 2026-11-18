import { api, ApiError, array, optionalRecord, record, responseData, text } from './client';

export type FormalDocument = Readonly<{
  organization: string;
  number: string;
  revision: string;
  issued_on: string | null;
  header: string;
  footer: string;
  logo_data_uri: null;
}>;
export type FormalDocumentDraft = {
  organization: string; number: string; revision: string;
  issued_on: string; header: string; footer: string;
};
export type FormalRunPin = Readonly<{ run_id: string; input_digest: string; output_digest: string }>;
export type FormalCalculationRequest = Readonly<{
  kind: 'calculation';
  source: Readonly<{ workspace_id: string; expected_revision: number; runs: readonly [FormalRunPin] }>;
  document: FormalDocument;
}>;
export type FormalPreview = Record<string, unknown> & {
  schema: 'cablesim.formal-delivery/1';
  kind: 'calculation';
  source_digest: string;
  model_digest: string;
};
export type FormalPdf = {
  blob: Blob; filename: string; artifactDigest: string; sourceDigest: string; modelDigest: string;
};
const SHA256 = /^[a-f0-9]{64}$/;

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value))
    throw new ApiError(409, label + '缺少完整的 SHA-256 摘要。');
  return value;
}
export function normalizeFormalDocument(draft: FormalDocumentDraft): FormalDocument {
  const limits = { organization: 120, number: 80, revision: 32, header: 160, footer: 160 } as const;
  const labels = { organization: '单位名称', number: '文件编号', revision: '版次', header: '页眉', footer: '页脚' };
  const values = {} as Record<keyof typeof limits, string>;
  for (const field of Object.keys(limits) as (keyof typeof limits)[]) {
    const raw = draft[field], value = raw.trim();
    const required = field === 'organization' || field === 'number' || field === 'revision';
    if ((required && !value) || /[\u0000-\u001f\u007f]/u.test(raw) || Array.from(raw).length > limits[field])
      throw new ApiError(422, labels[field] + (required && !value ? '不能为空。' : '须为不超过 ' + limits[field] + ' 字符的单行文本。'), { field });
    values[field] = value;
  }
  const issued = draft.issued_on;
  if (issued) {
    const date = new Date(issued + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issued) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== issued)
      throw new ApiError(422, '签发日期须为有效的 YYYY-MM-DD 日期。', { field: 'issued_on' });
  }
  return Object.freeze({ ...values, issued_on: issued || null, logo_data_uri: null });
}

/** Full records use their own cache/key in the caller; never hydrate or narrow a display projection. */
export async function readFormalWorkspace(wid: string, signal?: AbortSignal) {
  const workspace = record(await responseData(api.GET('/api/workspaces/{wid}', {
    params: { path: { wid } }, signal,
  })), '正式交付工程');
  if (workspace.id !== wid || typeof workspace.revision !== 'number' || !Number.isSafeInteger(workspace.revision) || Number(workspace.revision) < 0)
    throw new ApiError(409, '工程身份或当前修订无法核对，请重新读取来源。');
  return workspace;
}

export async function readFormalRun(wid: string, sid: string, rid: string, signal?: AbortSignal) {
  const run = record(await responseData(api.GET('/api/workspaces/{wid}/studies/{sid}/runs/{rid}', {
    params: { path: { wid, sid, rid }, query: { view: 'full' } }, signal,
  })), '完整保存运行');
  if (run.id !== rid || run.workspace !== wid || run.study !== sid || run.integrity !== 'verified'
    || !['succeeded', 'partial'].includes(text(run.status)))
    throw new ApiError(409, '所选运行未完整保存、完整性未通过或不属于此研究。');
  requireDigest(run.input_digest, '源运行输入');
  requireDigest(run.output_digest, '源运行输出');
  const cases = array(record(run.snapshot, '完整输入快照').cases, '完整工况输入');
  if (!cases.length) throw new ApiError(409, '完整保存运行没有工况输入。');
  const ids = new Set<string>();
  for (const value of cases) {
    const item = record(value, '保存工况'), id = text(item.case_id);
    if (!id || ids.has(id)) throw new ApiError(409, '保存工况身份缺失或重复。');
    ids.add(id);
    record(item.input, '完整工况输入');
    record(item.parameters, '保存方法参数');
  }
  const output = record(run.output, '完整保存输出');
  array(output.cases, '保存工况输出');
  return run;
}

export function formalCalculationRequest(
  wid: string, sid: string, revision: unknown, run: Record<string, unknown>, draft: FormalDocumentDraft,
): FormalCalculationRequest {
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
    throw new ApiError(409, '工程修订尚未核对，请重新读取来源。');
  if (run.workspace !== wid || run.study !== sid || !text(run.id) || run.integrity !== 'verified')
    throw new ApiError(409, '完整源运行与所选研究不一致。');
  const pin = Object.freeze({ run_id: text(run.id),
    input_digest: requireDigest(run.input_digest, '源运行输入'),
    output_digest: requireDigest(run.output_digest, '源运行输出') });
  return Object.freeze({ kind: 'calculation',
    source: Object.freeze({ workspace_id: wid, expected_revision: Number(revision), runs: Object.freeze([pin] as const) }),
    document: normalizeFormalDocument(draft) });
}

function errorText(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(value => {
    const item = optionalRecord(value);
    return (Array.isArray(item.loc) ? item.loc.join('.') + '：' : '') + text(item.msg);
  }).filter(Boolean).join('；');
  const item = optionalRecord(detail);
  return text(item.message) || text(item.code) || '正式计算书服务未返回可用数据。';
}
async function formalResponse(path: 'preview' | 'export', body: unknown, signal?: AbortSignal) {
  // The host exposes this additive contract; the older generated endpoint catalogue does not include it.
  const response = await fetch('/api/formal-deliveries/' + path, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail: unknown;
    try { const value: unknown = await response.json(); detail = optionalRecord(value).detail ?? value; }
    catch { detail = '正式计算书服务未返回有效错误详情，请重试读取。'; }
    throw new ApiError(response.status, errorText(detail), detail);
  }
  return response;
}
export async function previewFormalCalculation(request: FormalCalculationRequest, sid: string, signal?: AbortSignal): Promise<FormalPreview> {
  const response = await formalResponse('preview', request, signal);
  let value: unknown;
  try { value = await response.json(); }
  catch { throw new ApiError(502, '正式计算书预览不是有效 JSON。'); }
  const preview = record(value, '正式计算书预览');
  const identity = record(preview.source_identity, '预览来源身份'), pins = array(identity.pins, '预览来源运行');
  const pin = request.source.runs[0], actual = optionalRecord(pins[0]);
  const metadata = record(preview.metadata, '文件元数据');
  const source = optionalRecord(optionalRecord(preview.sources)['run:' + pin.run_id]);
  const expectedUrl = '/api/workspaces/' + request.source.workspace_id + '/studies/' + sid + '/runs/' + pin.run_id + '?view=full';
  if (preview.schema !== 'cablesim.formal-delivery/1' || preview.kind !== 'calculation'
    || identity.workspace_id !== request.source.workspace_id || identity.revision !== request.source.expected_revision
    || pins.length !== 1 || actual.run_id !== pin.run_id || actual.input_digest !== pin.input_digest || actual.output_digest !== pin.output_digest
    || Object.entries(request.document).some(([key, expected]) => metadata[key] !== expected)
    || source.kind !== 'run' || source.api_url !== expectedUrl)
    throw new ApiError(409, '正式预览的工程、运行、完整摘要或文件信息与请求不一致，拒绝导出。');
  requireDigest(preview.source_digest, '完整来源集合');
  requireDigest(preview.model_digest, '完整文件模型');
  requireDigest(source.payload_digest, '冻结运行来源');
  if (Object.values(optionalRecord(preview.sources)).some(value => 'payload' in optionalRecord(value)))
    throw new ApiError(502, '预览响应包含未声明的完整来源数据，拒绝显示和下载。');
  const signatures = array(preview.signatures, '独立签栏').map(value => record(value, '签栏'));
  const roles = ['design', 'check', 'review', 'approve'];
  if (signatures.length !== roles.length || signatures.some((item, index) => item.role !== roles[index]
    || !item.evidence_ref && (item.name !== null || item.date !== null)))
    throw new ApiError(409, '正式文件签栏与独立签核依据不一致。');
  return preview as FormalPreview;
}
function pdfFilename(header: string | null): string {
  if (!header || !/^attachment\s*;/i.test(header))
    throw new ApiError(502, '正式 PDF 未返回附件文件名。');
  const encoded = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/i.exec(header);
  const plain = /(?:^|;)\s*filename="([^"]+)"/i.exec(header);
  let name: string;
  try { name = encoded ? decodeURIComponent(encoded[1].trim()) : plain?.[1] || ''; }
  catch { throw new ApiError(502, '正式 PDF 文件名编码无效。'); }
  if (!name || /[\\/\u0000-\u001f\u007f]/u.test(name) || !/\.pdf$/i.test(name))
    throw new ApiError(502, '正式 PDF 文件名无效。');
  return name;
}
export async function exportFormalPdf(request: FormalCalculationRequest, preview: FormalPreview, signal?: AbortSignal): Promise<FormalPdf> {
  const response = await formalResponse('export', { ...request, format: 'pdf', expected_model_digest: preview.model_digest }, signal);
  if (response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf')
    throw new ApiError(502, '正式导出未返回 PDF 文件。');
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 64 * 1024 * 1024 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
    throw new ApiError(502, '正式导出返回了空文件或无效 PDF。');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  const sourceDigest = response.headers.get('X-Delivery-Source-SHA256');
  const modelDigest = response.headers.get('X-Delivery-Model-SHA256');
  if (response.headers.get('Cache-Control') !== 'no-store' || response.headers.get('X-Artifact-SHA256') !== digest
    || sourceDigest !== preview.source_digest || modelDigest !== preview.model_digest)
    throw new ApiError(409, '正式 PDF 字节、来源或文件模型摘要与预览不一致，拒绝显示和下载。');
  return { blob: new Blob([bytes], { type: 'application/pdf' }), filename: pdfFilename(response.headers.get('Content-Disposition')),
    artifactDigest: digest, sourceDigest, modelDigest };
}
