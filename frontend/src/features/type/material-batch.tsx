import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { message, optionalRecord, text } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NumberField } from '@/components/ui/number-field';
import { Select } from '@/components/ui/select';
import { InlineEmpty } from '@/components/states';
import { fieldSource, pointer } from '@/lib/domain-fields';
import type { LayerRow } from './layers';
import { useTypeWorkspace } from './provider';
import { resourceRequest, useResources, type Resource, type ResourceView } from './resource-bindings';

type Difference = { field: string; label: string; unit: string; before: unknown; after: unknown; before_source: unknown; after_source: unknown };
type Preview = { revision: number; digest: string; rows: { id: string; name: string; layer_count: number; before_resource: Resource | null; after_resource: Resource; differences: Difference[] }[] };
const categories: Record<string, string> = { conductor: '导体', semiconductor: '半导电材料', insulation: '绝缘材料', filler: '填充材料', metal: '金属', polymer: '聚合物', composite: '复合材料', other: '其他' };
function readable(value: unknown) {
  if (value == null) return '未给出';
  if (typeof value === 'number') return Number(value.toPrecision(5)).toString();
  return categories[String(value)] || ({ copper_bare: '裸铜', copper_coated: '镀金属铜', aluminium: '铝', lead: '铅', steel_galvanized: '镀锌钢', XLPE: '交联聚乙烯', PVC: '聚氯乙烯', EPR: '乙丙橡胶', PE: '聚乙烯' } as Record<string, string>)[String(value)] || String(value);
}
function sourceLabel(value: unknown) {
  const reference = text(optionalRecord(value).reference);
  let result = reference;
  try { const source = optionalRecord(JSON.parse(reference)); result = text(source.reference) || text(source.citation) || (text(source.standard) ? text(source.standard) + (source.table ? ' 表 ' + source.table : '') + (source.printed_page ? '，第 ' + source.printed_page + ' 页' : '') : '保存的来源记录（详见追溯）'); } catch { /* Plain source prose is supported. */ }
  return (result || '未记录出处').replace(/[a-f0-9]{64}/gi, '来源摘要').replace(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/gi, '来源记录');
}
function densityReference(reference: string) {
  try { const record = optionalRecord(JSON.parse(reference)); return text(record.reference) || text(record.citation); } catch { return reference; }
}
function editDensityReference(reference: string, next: string) {
  try { JSON.parse(next); return next; } catch { /* A pasted source record retains its structured provenance. */ }
  try { const record = optionalRecord(JSON.parse(reference)); return JSON.stringify({ ...record, reference: next }); } catch { return next; }
}

/** All uses of a design material share its fixed pin; no layer-by-layer writes. */
export function MaterialBatchBindings({ rows, selectedIds }: { rows: LayerRow[]; selectedIds: string[] }) {
  const state = useTypeWorkspace(), query = useResources();
  const [open, setOpen] = useState(false), [choices, setChoices] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null), [seen, setSeen] = useState<string[]>([]), [notice, setNotice] = useState('');
  const panel = useRef<HTMLDivElement>(null), attempt = useRef<{ key: string; body: unknown } | null>(null);
  const targets = (query.data?.targets || []).filter(t => t.role === 'material' && rows.some(r => r.material.id === t.id));
  const pending = useRef(false);
  const mutation = useMutation({ mutationFn: async ({ confirm, selection }: { confirm: boolean; selection?: Record<string, string> }) => {
    if (pending.current) throw new Error('正在核对材料，请等待本次请求完成');
    if (!state.workspace || !query.data || state.dirty || query.data.revision !== state.workspace.revision) throw new Error('请先保存或撤销修改，再重新查看差异');
    const items = Object.entries(selection || choices).filter(([, resource]) => resource).map(([target_id, resource_id]) => ({ target_id, resource_id }));
    const fields = { expected_revision: query.data.revision, items };
    pending.current = true;
    try {
      if (!confirm) {
        const result = await resourceRequest<Preview>(state.workspace.id, '/material-preview', fields);
        if (!Array.isArray(result.rows) || !result.digest) throw new Error('差异预览不完整，请重新读取');
        setPreview(result); setSeen([]); return;
      }
      if (!preview || preview.rows.some(r => !seen.includes(r.id))) throw new Error('请查看全部差异后再确认');
      const key = JSON.stringify([state.workspace.id, fields, preview.digest]);
      if (attempt.current?.key !== key) attempt.current = { key, body: { ...fields, request_id: crypto.randomUUID(), preview_digest: preview.digest, reviewed_targets: seen, human_confirmed: true } };
      await state.commitResourceValue(() => resourceRequest<ResourceView>(state.workspace!.id, '/material-confirm', attempt.current!.body), '已批量确认材料固定版本');
      attempt.current = null; setNotice(''); setOpen(false);
    } finally { pending.current = false; }
  } });
  useEffect(() => {
    if (!preview || !open || !panel.current) return;
    // Confirmation is unavailable until every item's final difference has
    // entered the viewport. Long lists must actually be scrolled through.
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting && entry.intersectionRatio >= .99) {
        const id = (entry.target as HTMLElement).dataset.reviewEnd!;
        setSeen(current => current.includes(id) ? current : [...current, id]);
      }
    }, { threshold: .99 });
    panel.current.querySelectorAll('[data-review-end]').forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [preview, open]);
  if (state.readOnly) return null;
  const disabled = state.dirty || state.busy || mutation.isPending || query.isPending || !!query.error;
  function begin(stale = false) {
    const selection = stale ? targets.filter(t => t.state === 'outdated') : targets.filter(t => !selectedIds.length || selectedIds.includes(t.id));
    const chosen = Object.fromEntries(selection.map(t => [t.id, t.binding?.resource_id || '']));
    setChoices(chosen); setPreview(null); setSeen([]); setNotice(''); mutation.reset(); setOpen(true);
    if (stale) mutation.mutate({ confirm: false, selection: chosen });
  }
  return <div className="type-resource-controls">
    <Button variant="outline" size="compact" disabled={disabled || !targets.length} onClick={() => begin()}>批量绑定材料版本</Button>
    {targets.some(t => t.state === 'outdated') && <Button variant="outline" size="compact" disabled={disabled} onClick={() => begin(true)}>查看全部过期差异</Button>}
    {query.error && <span role="alert">{message(query.error)} <Button variant="ghost" size="compact" onClick={() => void query.refetch()}>重试</Button></span>}
    {notice && !open && <span role="status">{notice}</span>}
    <Dialog open={open} onOpenChange={value => { if (!pending.current) setOpen(value); }} title="批量材料版本" description="一项设计材料覆盖所有引用层；固定版本绑定不会自动替换物性。"
      actions={<Button variant="primary" loading={mutation.isPending} disabled={disabled || !Object.values(choices).some(Boolean) || !!preview && preview.rows.some(r => !seen.includes(r.id))} onClick={() => mutation.mutate({ confirm: !!preview })}>{preview ? '已查看，确认全部绑定' : '查看全部差异'}</Button>}>
      <div className="type-material-batch" ref={panel}>
        {!preview ? <>
          <Button variant="ghost" size="compact" onClick={() => {
            const matches = targets.filter(t => t.exact_name_match && Object.hasOwn(choices, t.id));
            if (matches.length) setChoices(current => ({ ...current, ...Object.fromEntries(matches.map(t => [t.id, t.exact_name_match!])) }));
            setNotice(matches.length ? `已找到 ${matches.length} 项同名同类固定版本；请查看差异后确认` : '没有同名同类的唯一已发布版本；请人工选择');
          }}>按同名同类预选</Button>
          {notice && <span role="status">{notice}</span>}
          {targets.filter(t => Object.hasOwn(choices, t.id)).map((target, index, selection) => <div className="type-material-choice" key={target.id}>
            <span>{target.name} · {rows.filter(r => r.material.id === target.id).length} 层</span>
            <Select label={target.name + '资源版本'} value={choices[target.id]} options={[{ value: '', label: '本次不绑定' }, ...(query.data?.resources || []).filter(r => r.kind === 'material').map(r => ({ value: r.id, label: r.name + ' · ' + r.version }))]} onChange={value => setChoices(current => ({ ...current, [target.id]: value }))} />
            {index > 0 && choices[selection[index - 1].id] && <Button variant="ghost" size="compact" aria-label={target.name + '采用上一项版本'} title="明确选择上一项的固定版本；仍须查看本项差异后确认。" onClick={() => setChoices(current => ({ ...current, [target.id]: current[selection[index - 1].id] }))}>同上一项</Button>}
            <span className="muted">{target.exact_name_reason}</span>
          </div>)}
          {!Object.keys(choices).length && <InlineEmpty title="没有待确认材料；请先在分层表选择设计材料。" />}
        </> : <>
          <Button variant="ghost" size="compact" onClick={() => { setPreview(null); mutation.reset(); }}>重新选择版本</Button>
          {preview.rows.map(row => <section key={row.id} aria-label={row.name + '绑定差异'}>
            <strong>{row.name} · {row.layer_count} 层</strong>
            <p>{row.before_resource ? row.before_resource.name + ' · ' + row.before_resource.version : '未绑定资源'} → {row.after_resource.name} · {row.after_resource.version}</p>
            <dl>{row.differences.map(diff => <div key={diff.field}><dt>{diff.label}{diff.unit && `（${diff.unit}）`}</dt><dd>{readable(diff.before)} → {readable(diff.after)}
              {JSON.stringify(diff.before_source) !== JSON.stringify(diff.after_source) && <span className="type-material-source">出处：{sourceLabel(diff.before_source)} → {sourceLabel(diff.after_source)}</span>}</dd></div>)}</dl>
            {!row.differences.length && <p className="muted">保存的材料事实未变化；本次核对资源版本。</p>}
            <details><summary>追溯</summary><pre>{JSON.stringify(row, null, 2)}</pre></details>
            <span data-review-end={row.id}>{seen.includes(row.id) ? '已展示全部差异' : '请向下查看此项差异'}</span>
          </section>)}
          <p role="status">已展示 {seen.length}/{preview.rows.length} 项完整差异；确认后一起固定版本。</p>
        </>}
        {mutation.error && <p role="alert" className="field-error">{message(mutation.error)}</p>}
      </div>
    </Dialog>
  </div>;
}

/** One draft transaction, with explicit per-material provenance and no adoption. */
export function MaterialBatchDensity({ rows, selectedIds }: { rows: LayerRow[]; selectedIds: string[] }) {
  const state = useTypeWorkspace();
  const [open, setOpen] = useState(false), [ack, setAck] = useState(false), [kind, setKind] = useState('auto');
  const [values, setValues] = useState<Record<string, { name: string; category: string; amount: number | null; draft?: string; reference: string }>>({});
  if (state.readOnly) return null;
  function sourceKind(reference: string) {
    if (kind !== 'auto') return kind;
    try { const record = optionalRecord(JSON.parse(reference)); return ({ teaching: 'demo', standard_reference: 'standard', manufacturer: 'manufacturer', measurement: 'measurement', user: 'user' } as Record<string, string>)[text(record.basis)] || null; } catch { return null; }
  }
  function sourceMatches(value: (typeof values)[string]) {
    try { const record = optionalRecord(JSON.parse(value.reference)); return record.schema !== 'cablesim.density-source/1' || record.value === value.amount && ['kg/m³', 'kg/m3'].includes(text(record.unit)); } catch { return true; }
  }
  const locked = (id: string) => ['density', 'label', 'standard_kind'].some(field => state.locked(pointer('materials', id, field)));
  const valid = Object.entries(values).length > 0 && Object.entries(values).every(([id, v]) => v.amount != null && v.amount > 0 && v.amount <= 1000000 && v.draft === undefined && densityReference(v.reference).trim() && v.name.trim() && sourceKind(v.reference) && sourceMatches(v) && !locked(id));
  function update(id: string, patch: Partial<(typeof values)[string]>) { setAck(false); setValues(current => ({ ...current, [id]: { ...current[id], ...patch } })); }
  return <>
    <Button variant="outline" size="compact" disabled={state.busy || !rows.length} onClick={() => {
      const materials = state.document!.materials.filter(m => rows.some(r => r.material.id === m.id) && (!selectedIds.length || selectedIds.includes(m.id)));
      setValues(Object.fromEntries(materials.map(m => [m.id, { name: m.label, category: m.standard_kind || '', amount: m.density ?? null, reference: text(fieldSource(state.document!, pointer('materials', m.id, 'density')).reference) }]))); setKind('auto'); setAck(false); setOpen(true);
    }}>批量填写密度与出处</Button>
    <Dialog open={open} onOpenChange={setOpen} title="批量材料密度" description="每种设计材料填写一次，所有引用层共用；资源草稿不会在这里获批。"
      actions={<Button variant="primary" disabled={state.busy || !valid || !ack} onClick={() => {
        for (const [id, value] of Object.entries(values)) {
          const material = state.document!.materials.find(m => m.id === id)!;
          if (material.label !== value.name) state.edit(pointer('materials', id, 'label'), value.name.trim());
          if (material.standard_kind !== (value.category || null)) state.edit(pointer('materials', id, 'standard_kind'), value.category || null);
          state.edit(pointer('materials', id, 'density'), value.amount, { kind: sourceKind(value.reference) as 'user' | 'standard' | 'manufacturer' | 'measurement' | 'demo', reference: value.reference.trim(), reviewed: false });
        }
        setOpen(false);
      }}>写入材料草稿</Button>}>
      <div className="type-material-batch">
        <Select label="批量密度来源类别" value={kind} onChange={v => { setKind(v); setAck(false); }} options={[{ value: 'auto', label: '按逐项出处的类别声明' }, { value: 'standard', label: '标准参考值' }, { value: 'manufacturer', label: '厂家值' }, { value: 'measurement', label: '实测值' }, { value: 'demo', label: '教学值' }, { value: 'user', label: '工程输入' }]} />
        {Object.entries(values).map(([id, value]) => <section key={id} aria-label={rows.find(r => r.material.id === id)!.material.label + '密度输入'}>
          <strong>{rows.find(r => r.material.id === id)!.material.label} · {rows.filter(r => r.material.id === id).length} 层</strong>
          {locked(id) && <p role="status">此材料字段已锁定；请在分层表另选可编辑材料，或建立独立草稿。</p>}
          <div className="type-material-density-row">
            <label>设计材料名称<Input aria-label={id + '设计材料名称'} value={value.name} onChange={e => update(id, { name: e.target.value })} /></label>
            <Select label={rows.find(r => r.material.id === id)!.material.label + '标准材料类别'} value={value.category} onChange={v => update(id, { category: v })} options={[{ value: '', label: '未声明' }, { value: 'copper_bare', label: '裸铜' }, { value: 'copper_coated', label: '镀金属铜' }, { value: 'aluminium', label: '铝' }, { value: 'XLPE', label: '交联聚乙烯' }, { value: 'PVC', label: '聚氯乙烯' }, { value: 'EPR', label: '乙丙橡胶' }, ...(!['', 'copper_bare', 'copper_coated', 'aluminium', 'XLPE', 'PVC', 'EPR'].includes(value.category) ? [{ value: value.category, label: '保留现有类别' }] : [])]} />
            <NumberField label={rows.find(r => r.material.id === id)!.material.label + '材料密度'} value={value.amount} draftText={value.draft} onDraftChange={draft => update(id, { draft })} onCommit={amount => update(id, { amount })} unit="kg/m³" precision={1} min={0} minExclusive max={1000000} required />
          </div>
          <label>密度出处<Input aria-label={id + '密度出处'} value={densityReference(value.reference)} maxLength={4000} onChange={e => update(id, { reference: editDensityReference(value.reference, e.target.value) })} /></label>
          {value.reference.trim().startsWith('{') && <details><summary>追溯</summary><pre>{value.reference}</pre><Button variant="ghost" size="compact" aria-label={value.name + '改用新出处'} onClick={() => update(id, { reference: '' })}>改用新出处</Button></details>}
          {!sourceMatches(value) && <p role="alert" className="field-error">{value.name}：出处的数值与单位须与密度一致；请修正密度出处，单位为 kg/m³。</p>}
        </section>)}
        <label className="type-confirm"><Checkbox checked={ack} onCheckedChange={v => setAck(v === true)} />已逐项核对密度、出处与使用条件</label>
        {kind === 'auto' && Object.values(values).some(v => !sourceKind(v.reference)) && <p role="status">出处尚未声明来源类别；请选择上方的来源类别，或填写带类别声明的来源记录。</p>}
      </div>
    </Dialog>
  </>;
}
