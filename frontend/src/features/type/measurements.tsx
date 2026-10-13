import { useEffect, useRef, useState } from 'react';
import { ApiError, message, optionalRecord, text } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NumberField } from '@/components/ui/number-field';
import { Select } from '@/components/ui/select';
import { useTypeWorkspace } from './provider';
import { formatNumber } from '@/lib/format';

type Entry = { key: string; core: string | null; role: string; quantity: string; title: string; unit: string; criterion: string };
const units: Record<string, string> = { r20: 'ohm/km', screen_area: 'mm2', minimum_overlap: '%' };
const unitLabel: Record<string, string> = { 'ohm/km': 'Ω/km', mm2: 'mm²', '%': '%', mm: 'mm' };
export function measuredEntries(checks: Record<string, unknown>[]) {
  const entries = new Map<string, Entry>();
  for (const check of checks) {
    const row = optionalRecord(check.result), target = optionalRecord(row.target);
    if (row.basis !== 'measurement' || row.verdict === 'uncovered' || row.source_status === 'input-missing') continue;
    const quantity = text(row.id).split(':').pop() === 'insulation-uniformity' ? 'maximum_thickness' : text(row.path).split('.').pop() || '';
    const quantities = quantity === 'maximum_thickness' ? ['minimum_thickness', 'maximum_thickness'] : [quantity];
    if (!['r20', 'screen_area', 'minimum_thickness', 'maximum_thickness', 'mean_thickness', 'minimum_tape_thickness', 'mean_wire_diameter', 'minimum_overlap'].includes(quantity)) continue;
    for (const q of quantities) {
      const core = text(target.core_id) || null, role = text(target.role), key = [core || 'common', role, q].join('|'), unit = units[q] || 'mm';
      const title = q === 'maximum_thickness' ? text(row.title).replace('厚度偏差', '最大实测厚度') : q === 'minimum_thickness' && quantity === 'maximum_thickness' ? text(row.title).replace('厚度偏差', '实测最薄点') : text(row.title);
      if (!entries.has(key)) entries.set(key, { key, core, role, quantity: q, title, unit,
        criterion: row.limit == null || quantity === 'maximum_thickness' ? '用于同一试样厚度偏差核对' : (row.comparison === '<=' ? '≤ ' : '≥ ') + formatNumber(Number(row.limit) * (row.unit === '1' ? 100 : 1), 2) + ' ' + unitLabel[unit] });
    }
  }
  return [...entries.values()];
}

export function measurementSource(value: unknown) {
  const reference = text(optionalRecord(value).reference);
  try {
    const record = optionalRecord(JSON.parse(reference));
    if (record.schema === 'cablesim.factory-measurement/1') return [text(record.label), '样品 ' + text(record.sample_id), text(record.measured_on), text(record.method), text(record.reference)].filter(Boolean).join(' · ');
  } catch { /* Historical plain source records remain readable. */ }
  return reference || '未记录';
}

export function MeasurementEntry({ checks }: { checks: Record<string, unknown>[] }) {
  const state = useTypeWorkspace(), entries = measuredEntries(checks);
  const [open, setOpen] = useState(false), [origin, setOrigin] = useState('manufacturer');
  const [sample, setSample] = useState(''), [date, setDate] = useState(''), [method, setMethod] = useState(''), [reference, setReference] = useState('');
  const [values, setValues] = useState<Record<string, number | null>>({}), [drafts, setDrafts] = useState<Record<string, string | undefined>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string,string>>({});
  const [report, setReport] = useState<{ filename: string; content_base64: string } | null>(null), [ack, setAck] = useState(false), [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null), attempt = useRef<{ id: string; serialized: string } | null>(null), pending = useRef(false);
  const opener=useRef<HTMLButtonElement>(null), wasOpen=useRef(false);
  useEffect(()=>{const closing=wasOpen.current&&!open;wasOpen.current=open;if(closing){const frame=requestAnimationFrame(()=>opener.current?.focus());return()=>cancelAnimationFrame(frame);}},[open]);
  const disabled = state.busy || state.readOnly || state.dirty, provided = entries.filter(e => values[e.key] != null);
  async function save() {
    if (pending.current || disabled || !ack || !provided.length) return;
    const measuredDate = new Date(date + 'T00:00:00Z'), today = new Date();
    const localToday = [today.getFullYear(), String(today.getMonth()+1).padStart(2,'0'), String(today.getDate()).padStart(2,'0')].join('-');
    if (!Number.isFinite(measuredDate.getTime()) || measuredDate.toISOString().slice(0,10) !== date || date > localToday) {
      setFieldErrors({ date: '请输入有效的测量日期，且不能晚于今天。' });
      window.document.querySelector<HTMLElement>('[aria-label="测量日期"]')?.focus();
      return;
    }
    const inconsistent=provided.find(e=>e.quantity==='minimum_thickness'&&provided.some(other=>other.core===e.core&&other.role===e.role&&other.quantity==='maximum_thickness'&&values[e.key]!>values[other.key]!));
    if(inconsistent){setFieldErrors({[inconsistent.key]:'最薄点大于同一试样最大厚度，请核对实测记录。'});window.document.querySelector<HTMLElement>(`[data-measured-key="${CSS.escape(inconsistent.key)}"] input`)?.focus();return;}
    const body = { expected_revision: state.workspace!.revision, origin, sample_id: sample.trim(), measured_on: date, method: method.trim(), reference: reference.trim(), acknowledge_measured: true,
      values: provided.map(e => ({ core: e.core, role: e.role, quantity: e.quantity, unit: e.unit, value: values[e.key] })), ...(report ? { report } : {}) };
    const serialized = JSON.stringify(body);
    if (attempt.current?.serialized !== serialized) attempt.current = { id: crypto.randomUUID(), serialized };
    pending.current = true; setError('');
    try {
      await state.commitResourceValue(async () => {
        const response = await fetch(`/api/types/${encodeURIComponent(state.workspace!.id)}/measurements`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000), body: JSON.stringify({ ...body, request_id: attempt.current!.id }) });
        const result = await response.json();
        if (!response.ok) { const detail = result.detail; throw new ApiError(response.status, typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map(d => String(d.msg).replace(/^Value error, /,'')).join('；') : detail?.message || '实测记录保存失败，请核对字段后重试'); }
        return result;
      }, '实测记录已保存为新修订；请重新执行标准核对。撤销可回到录入前。');
      attempt.current = null; setOpen(false);
    } catch (failure) { setError(message(failure)); }
    finally { pending.current = false; }
  }
  return <>
    <Button ref={opener} size="compact" variant="outline" disabled={disabled || !entries.length} title={state.dirty ? '请先保存设计修改' : '实测值与设计尺寸分开保存'} onClick={() => { setValues({}); setDrafts({}); setFieldErrors({}); setAck(false); setError(''); setReport(null); setOpen(true); }}>录入实测值</Button>
    <Dialog open={open} onOpenChange={value => { if (!pending.current) setOpen(value); }} title="录入实测值" description="实测值独立保存，不替换设计尺寸；留空项保持缺项。" actions={<Button variant="primary" loading={state.busy} disabled={disabled || !ack || !provided.length || !sample.trim() || !method.trim() || !reference.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Object.values(drafts).some(v => v !== undefined)} onClick={() => void save()}>保存实测记录</Button>}>
      <div className="type-measurements">
        <div className="type-measurement-sample">
          <Select label="实测来源" value={origin} onChange={setOrigin} options={[{ value: 'manufacturer', label: '厂家实测' }, { value: 'teaching', label: '教学示例实测' }]} />
          <label>样品编号<Input aria-label="样品编号" value={sample} maxLength={120} onChange={e => setSample(e.target.value)} /></label>
          <label>测量日期<Input aria-label="测量日期" aria-invalid={!!fieldErrors.date} aria-describedby={fieldErrors.date ? 'type-measured-date-error' : undefined} placeholder="年-月-日，如 2026-10-12" value={date} maxLength={10} onChange={e => { setDate(e.target.value); setFieldErrors({}); }} />{fieldErrors.date && <span id="type-measured-date-error" className="field-error" role="alert">{fieldErrors.date}</span>}</label>
          <label>测量方法<Input aria-label="测量方法" value={method} maxLength={500} onChange={e => setMethod(e.target.value)} /></label>
          <label>测量记录出处<Input aria-label="测量记录出处" value={reference} maxLength={1000} onChange={e => setReference(e.target.value)} /></label>
        </div>
        {origin === 'teaching' && <p className="type-notice" data-typography="note">教学示例实测，仅供演示，不能作为厂家检验或客户交付依据。</p>}
        <Button size="compact" variant="outline" onClick={() => fileInput.current?.click()}>{report ? '报告：' + report.filename : '附测量报告（可选）'}</Button>
        <input ref={fileInput} type="file" hidden accept=".pdf,.png,.jpg,.jpeg" aria-label="测量报告文件" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 8 * 1024 * 1024) { setError('报告不能超过 8 MB，请选择 PDF 或图片。'); return; } try { const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); setReport({ filename: file.name, content_base64: btoa(binary) }); setError(''); } catch { setError('报告文件未能读取，请重新选择。'); } }} />
        <div className="type-measured-values" aria-label="实测字段">{entries.map(entry => <div key={entry.key} data-measured-quantity={entry.quantity} data-measured-key={entry.key}>
          <NumberField label={entry.title} error={fieldErrors[entry.key]} value={values[entry.key] ?? null} unit={unitLabel[entry.unit]} precision={entry.quantity === 'r20' ? 4 : 3} min={0} minExclusive={entry.quantity !== 'minimum_overlap'} max={entry.unit === '%' ? 100 : entry.unit === 'mm2' ? 10000 : entry.unit === 'ohm/km' ? 1000 : 500} draftText={drafts[entry.key]} onDraftChange={v => {setDrafts(old => ({ ...old, [entry.key]: v }));setFieldErrors({});}} onCommit={v => setValues(old => ({ ...old, [entry.key]: v }))} />
          <span title="此处仅展示判据，不能作为实测值">判据：{entry.criterion}</span>
        </div>)}</div>
        <label className="type-confirm"><Checkbox checked={ack} disabled={state.busy} onCheckedChange={v => setAck(v === true)} />数值来自所述测量记录，已核对单位、试样与方法；没有使用标准限值代填</label>
        {error && <p role="alert" className="field-error">{error}</p>}
      </div>
    </Dialog>
  </>;
}
