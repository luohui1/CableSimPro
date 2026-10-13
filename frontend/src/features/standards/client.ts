import { ApiError, array, optionalRecord, record, text } from '@/api/client';

export type Quantity = { key: string; name: string; dimension: string; unit: string };
export type BasisRecord = {
  id: string; standard: string; edition: string; clause: string; table: string; title: string;
  row: number; column: string; row_label: string; axes: Record<string, unknown>;
  semantic: string; criterion: string;
  printed_page: number | string; pdf_page: number; source_sha256: string; record_sha256: string;
  conditions: Record<string, unknown>; column_conditions?: Record<string, unknown>; quantity: Quantity; value: unknown; citation: string;
  value_details?: { formula_text?: string; variables?: { name: string; description: string; unit: string }[]; [key: string]: unknown }; limitations: string[];
  column_header?: { name: string; unit: string };
  verification: { status: string; methods: { method?: string; description?: string; [key: string]: unknown }[] };
};
export type BasisTable = { id: string; standard: string; edition: string; table: string; clause: string; title: string; record_count: number; quantities: Quantity[] };
export type Answer = { schema: string; status: string; data_sha256: string; records: BasisRecord[]; tables?: BasisTable[]; not_covered?: Record<string, unknown>[]; reason?: string; browse?: { standard: string; edition: string; locator: string }; calculation?: unknown };
export type Pin = { plugin_id: string; version: string; release_digest: string };

async function json(url: string, signal?: AbortSignal, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(url, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(25000)]),
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(503, '依据读取超时或连接中断，请重试；已显示的引用保留。');
  }
  const value = await response.json();
  if (!response.ok) {
    const detail = optionalRecord(optionalRecord(value).detail);
    throw new ApiError(response.status, text(detail.message) || '依据服务不可用，请检查插件发行与查询路由接入。', detail);
  }
  return value;
}

export async function basisPin(signal?: AbortSignal): Promise<Pin> {
  const plugin = array(await json('/api/methods', signal)).map(optionalRecord)
    .find(p => optionalRecord(p.method).plugin_id === 'cablesim.standards-basis');
  if (!plugin) throw new ApiError(404, '未安装标准依据库，请安装经过封签的发行。');
  const pin = record(plugin.method);
  if (!/^[a-f0-9]{64}$/.test(text(pin.release_digest))) throw new ApiError(502, '依据发行缺少摘要，停止读取。');
  return pin as Pin;
}

export async function basisQuery(pin: Pin, input: Record<string, unknown>, signal?: AbortSignal): Promise<Answer> {
  const envelope = record(await json(`/api/plugin-queries/${pin.plugin_id}/lookup`, signal, { release_digest: pin.release_digest, input }));
  if (envelope.release_digest !== pin.release_digest) throw new ApiError(409, '依据发行与所选版本不符，停止读取。');
  const artifact = record(optionalRecord(envelope.artifacts)['x-cablesim.standards-basis']);
  if (artifact.schema !== 'cablesim.standards-answer/1' || !/^[a-f0-9]{64}$/.test(text(artifact.data_sha256))) throw new ApiError(502, '依据响应不完整，停止读取。');
  array(artifact.records).forEach(value => {
    const r = record(value);
    if (!text(r.id) || !text(r.standard) || !text(r.edition) || !text(r.citation) || !text(r.source_sha256)
      || !(typeof r.printed_page === 'number' || typeof r.printed_page === 'string' && /^[\d]+(?:-\d+)?$/.test(r.printed_page)) || typeof r.pdf_page !== 'number') throw new ApiError(502, '依据缺少出处，停止显示。');
  });
  return artifact as Answer;
}
