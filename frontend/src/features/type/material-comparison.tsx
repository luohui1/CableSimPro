import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, message, optionalRecord, text } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { ObjectLink } from '@/components/object-link';
import { StatusMark } from '@/components/status-mark';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { InlineEmpty, LoadingState, ErrorState, StaleBanner } from '@/components/states';
import { formatNumber } from '@/lib/format';
import { useTypeWorkspace } from './provider';
import { ResourceBindings } from './resource-bindings';

type Reference = { value: number; unit: string; standard: string; table: string; printed_page: number; pdf_page: number; condition: string };
type Row = { id: string; label: string; unit: string; actual: number | null; reference: Reference | null; reference_candidates: Reference[]; status: string; reason: string; delta: number | null; percent: number | null; design_source: unknown; adoptable: boolean; path: string };
type Material = { id: string; name: string; resource: { resource_id: string; name: string; kind: string; version: string; content_sha256: string }; rows: Row[]; reason?: string };
type Comparison = { revision: number; historical: boolean; materials: Material[] };
const names: Record<string, string> = { same: '一致', different: '不同', resource_missing: '资源缺项', design_missing: '型号未给此项', condition_mismatch: '条件不符' };
const units: Record<string, string> = { 'ohm.m': 'Ω·m', 'K.m/W': 'K·m/W', 'K^-1': 'K⁻¹', '1': '', 'J/(m³.K)': 'J/(m³·K)' };
function numberValue(number: number | null | undefined, unit: string): string {
  if (number == null) return '—';
  return number !== 0 && Math.abs(number) < 0.0001 ? number.toExponential(4).replace(/\.?(0+)e/, 'e') : formatNumber(number, unit === 'K^-1' ? 6 : 4).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}
function value(number: number | null | undefined, unit: string): string {
  return numberValue(number, unit) + (number == null || units[unit] === '' ? '' : ' ' + (units[unit] || unit));
}
function displayValue(number: number | null | undefined, unit: string, signed = false) {
  return <><span className="type-material-number">{signed && number != null && number > 0 ? '+' : ''}{numberValue(number, unit)}</span>{number != null && units[unit] !== '' && <> <wbr /><span className="type-material-unit">{units[unit] || unit}</span></>}</>;
}
function percentage(number: number): string {
  return (number !== 0 && Math.abs(number) < 0.005 ? value(number, '1') : formatNumber(number, 2).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')) + '%';
}
function sourceNote(source: unknown): string {
  const record = optionalRecord(source);
  const raw = text(record.reference);
  try {
    const decoded = optionalRecord(JSON.parse(raw));
    const citation = optionalRecord(decoded.reference_value);
    return text(citation.standard) ? `${text(citation.standard)} · 表 ${text(citation.table)} · 第 ${citation.printed_page} 页 · 资源 ${text(decoded.version)}` : text(record.note) || '型号保存的来源身份；该物性未单独注明试验条件。';
  } catch { return text(record.note) || raw || '型号未记录该物性出处。'; }
}
function citation(reference: Reference): string { return `${reference.standard} · 表 ${reference.table} · 第 ${reference.printed_page} 页（PDF ${reference.pdf_page}） · ${reference.condition}`; }
async function request(wid: string, suffix: string, body?: unknown, signal?: AbortSignal) {
  let response: Response;
  try { response = await fetch(`/api/types/${encodeURIComponent(wid)}/material-comparison${suffix}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]) }); }
  catch (error) { if (signal?.aborted) throw error; throw new ApiError(503, '物性服务未响应；可重试同一请求，或重新读取保存状态。'); }
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, typeof data.detail === 'string' ? data.detail : data.detail?.message || '物性核对不可用');
  return data;
}
export function MaterialComparison() {
  const state = useTypeWorkspace(), [selected, setSelected] = useState(''), [chosen, setChosen] = useState<Row | null>(null), [sources, setSources] = useState<{ title: string; notes: string[] } | null>(null);
  const attempt = useRef<{ key: string; body: unknown } | null>(null), pending = useRef<Promise<void> | null>(null);
  const query = useQuery<Comparison>({ queryKey: ['type-material-comparison', state.workspace?.id, state.workspace?.revision, state.readOnly], enabled: !!state.workspace,
    queryFn: async ({ signal }) => { const data = await request(state.workspace!.id, state.readOnly ? '?revision=' + state.workspace!.revision : '', undefined, signal); if (!Number.isInteger(data.revision) || !Array.isArray(data.materials)) throw new ApiError(502, '物性响应缺少修订或材料表'); return data; } });
  const material = query.data?.materials.find(m => m.id === selected) || query.data?.materials[0];
  const mutation = useMutation({ mutationFn: async (row: Row) => {
    if (pending.current) return pending.current;
    if (!material || !state.workspace || query.data?.revision !== state.workspace.revision || state.locked(row.path)) throw new Error('型号修订或字段状态已变化，请重新读取核对。');
    const fields = { expected_revision: state.workspace.revision, material_id: material.id, property: row.id, resource_id: material.resource.resource_id, content_sha256: material.resource.content_sha256 };
    const key = JSON.stringify(fields);
    if (attempt.current?.key !== key) attempt.current = { key, body: { ...fields, request_id: crypto.randomUUID() } };
    pending.current = state.commitResourceValue(() => request(state.workspace!.id, '/adopt', attempt.current!.body));
    try { await pending.current; } finally { pending.current = null; }
  }, onSuccess: () => { attempt.current = null; setChosen(null); } });
  if (query.isPending) return <LoadingState title="正在核对材料物性" />;
  if (query.error) return <ErrorState title="物性核对不可用" description={message(query.error)} action={<Button onClick={() => void query.refetch()}>重试</Button>} />;
  if (!material) return <InlineEmpty title="尚无已绑定材料；先选择已发布的材料版本。" action={<ResourceBindings />} />;
  return <div className="type-material-comparison" data-material-state={query.data?.historical ? 'historical' : 'success'}>
    {query.data?.historical && <StaleBanner description="历史型号物性与固定资源版本；保持只读。" />}
    <div className="type-result-toolbar"><Select label="核对材料" value={material.id} options={query.data!.materials.map(m => ({ value: m.id, label: m.name }))} disabled={mutation.isPending} onChange={id => { setSelected(id); setChosen(null); mutation.reset(); }} />
      <ObjectLink card={{ kind: 'asset', id: material.resource.resource_id, name: material.resource.name, version: material.resource.version, subtype: 'material', status: { code: 'published', label: '已发布' } }}>{material.resource.name} · {material.resource.version}</ObjectLink>
    </div>
    {material.reason ? <InlineEmpty title={material.reason} action={<ResourceBindings materialId={material.id} />} /> : <DataTable label="材料物性核对" rowLabel={row => row.label} showGroups={false} groups={[{ id: 'properties', label: '物性', rows: material.rows }]} columns={[
      { id: 'property', label: '物性', render: row => row.label },
      { id: 'actual', label: '型号值', numeric: true, render: row => <>{displayValue(row.actual, row.unit)}<Button variant="ghost" size="compact" onClick={() => setSources({ title: row.label + ' · 型号出处', notes: [sourceNote(row.design_source)] })}>出处</Button></> },
      { id: 'reference', label: '参考值', numeric: true, render: row => <>{displayValue(row.reference?.value, row.unit)}{(row.reference || row.reference_candidates.length > 0) && <Button variant="ghost" size="compact" aria-label="出处与条件" onClick={() => setSources({ title: row.label + ' · 资源出处与条件', notes: (row.reference ? [row.reference] : row.reference_candidates).map(r => value(r.value, r.unit) + ' · ' + citation(r)) })}>出处</Button>}</> },
      { id: 'difference', label: '差值 / %', numeric: true, render: row => <span title="百分比以资源参考值为分母">{row.delta === null ? '—' : <>{displayValue(row.delta, row.unit, true)}<br />{row.percent === null ? '百分比不适用' : (row.percent > 0 ? '+' : '') + percentage(row.percent)}</>}</span> },
      { id: 'status', label: '核对', render: row => <span title={row.reason || '型号与资源在相同物性、单位及适用条件下核对。'}><StatusMark kind={row.status === 'same' ? 'current' : row.status === 'different' ? 'draft' : 'unknown'} label={names[row.status] || '未覆盖'} />{row.reason && <details><summary>原因</summary><span>{row.reason}</span></details>}</span> },
      { id: 'adopt', label: '操作', render: row => row.adoptable && !state.readOnly ? <Button variant="ghost" size="compact" disabled={state.dirty || state.busy || state.locked(row.path)} onClick={() => { mutation.reset(); setChosen(row); }}>采用资源值</Button> : '—' },
    ]} />}
    <Dialog open={!!sources} onOpenChange={open => { if (!open) setSources(null); }} title={sources?.title || '物性出处'} description={material.name + ' · 固定资源 ' + material.resource.version}>
      <div className="type-create-fields">{sources?.notes.map((note, i) => <p key={i}>{note}</p>)}</div>
    </Dialog>
    <Dialog open={!!chosen} onOpenChange={open => { if (!open && !mutation.isPending) setChosen(null); }} title="采用固定资源参考值" description="生成新的型号输入修订，保存资源出处；原修订保留，受影响的结果需重算。"
      actions={<Button variant="primary" loading={mutation.isPending} disabled={!chosen || state.dirty || mutation.isPending} onClick={() => chosen && mutation.mutate(chosen)}>确认采用</Button>}>
      {chosen && <div className="type-create-fields"><span>{material.name} · {chosen.label}：{value(chosen.actual, chosen.unit)} → {value(chosen.reference?.value, chosen.unit)}</span><span>{chosen.reference && citation(chosen.reference)}</span></div>}
      {mutation.error && <p className="field-error" role="alert">{message(mutation.error)}</p>}
    </Dialog>
  </div>;
}
