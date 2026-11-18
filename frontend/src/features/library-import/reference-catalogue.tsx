import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { message } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { LibraryDialog } from './dialog';
import { ConditionFields, conditionSummary, conditionsReady, EvidenceTable, quantityText, readConditions, recordTitle, ReferenceSource, referenceUnit, referenceValue } from './reference-evidence';
import { parameterNames, referencePost, referenceRequest, referenceTarget, type ReferenceAsset, type ReferenceCatalogue, type ReferenceCategory, type ReferenceChoice, type ReferenceDraftPreview, type ReferenceReceipt, type ReferenceRecord, type ReferenceSelection, type ReferenceTableData } from './reference-api';

export function ReferenceCatalogueBrowser({ category, choices, onChoices, onCreated }: {
  category: ReferenceCategory; choices: ReferenceChoice[]; onChoices: (next: ReferenceChoice[]) => void; onCreated: (asset: ReferenceAsset) => void;
}) {
  const [tableId, setTableId] = useState('');
  const [filter, setFilter] = useState('');
  const [record, setRecord] = useState<ReferenceRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const catalogue = useQuery({ queryKey: ['library-reference-catalogue', category], queryFn: ({ signal }) => referenceRequest<ReferenceCatalogue>(`/api/library/resources/catalogue?category=${category}`, { signal }) });
  const table = useQuery({ queryKey: ['library-reference-table', category, tableId], enabled: !!tableId,
    queryFn: ({ signal }) => referenceRequest<ReferenceTableData>(`/api/library/resources/table?category=${category}&table_id=${encodeURIComponent(tableId)}`, { signal }) });
  const filtered = (table.data?.rows ?? []).filter(row => `${recordTitle(row)} ${row.quantity.name} ${conditionSummary(row.conditions)}`.toLowerCase().includes(filter.toLowerCase()));
  const add = (choice: ReferenceChoice) => { onChoices([...choices.filter(item => item.parameter !== choice.parameter), choice]); setRecord(null); };
  return <div className="library-import-stack">
    <div className="reference-toolbar"><div><h2>资料目录</h2><p className="muted">原表摘录保留缺项和范围。只有唯一数值、单位与适用条件均明确时才能选择。</p></div>
      {tableId && <Button onClick={() => { setTableId(''); setRecord(null); setFilter(''); }}>返回资料目录</Button>}
    </div>
    {catalogue.isPending ? <LoadingState title="正在读取资料目录" /> : catalogue.error ? <ErrorState description={message(catalogue.error)} action={<Button onClick={() => void catalogue.refetch()}>重新读取目录</Button>} /> : !tableId && catalogue.data && <>
      <DataTable label={`${category === 'materials' ? '材料' : '环境'}资料目录`} showGroups={false}
        groups={[{ id: 'catalogue', label: '资料表', rows: catalogue.data.tables }]}
        columns={[
          { id: 'name', label: '资料表', wrap: true, render: row => row.title },
          { id: 'standard', label: '标准或文献', wrap: true, render: row => `${row.standard}—${row.edition} · ${row.table || row.clause}` },
          { id: 'quantities', label: '物理量', wrap: true, render: row => row.quantities.map(item => item.name).join('、') },
          { id: 'count', label: '记录数', numeric: true, render: row => row.record_count },
          { id: 'open', label: '查看', render: row => <Button size="compact" onClick={() => { setTableId(row.id); setFilter(''); }}>查看资料表</Button> },
        ]} rowLabel={row => `${row.standard} ${row.table} ${row.title}`} onActivate={row => setTableId(row.id)} />
      <details className="library-import-details"><summary>覆盖范围与缺项</summary>
        {catalogue.data.limitations.map(item => <p key={item}>{item}</p>)}<p>{referenceValue(catalogue.data.not_covered)}</p>
      </details>
    </>}
    {tableId && (table.isPending ? <LoadingState title="正在读取原表记录" /> : table.error ? <ErrorState description={message(table.error)} action={<Button onClick={() => void table.refetch()}>重新读取资料表</Button>} /> : table.data && <>
      <h3>{table.data.table.title} · {table.data.table.standard}—{table.data.table.edition} {table.data.table.table}</h3>
      <label className="text-field">筛选原文项目或条件<Input aria-label="筛选原文项目或条件" value={filter} onChange={event => setFilter(event.target.value)} /></label>
      <DataTable label="原表逐条记录" showGroups={false} groups={[{ id: 'records', label: '原表记录', rows: filtered }]}
        columns={[
          { id: 'row', label: '原文项目', wrap: true, render: row => recordTitle(row) },
          { id: 'quantity', label: '物理量', wrap: true, render: row => row.quantity.name },
          { id: 'value', label: '原值', wrap: true, render: row => `${referenceValue(row.value)} ${referenceUnit(row.quantity.unit)}` },
          { id: 'page', label: '来源页码', wrap: true, render: row => `正文 ${row.printed_page ?? '未标'} / PDF ${row.pdf_page ?? '未标'}` },
          { id: 'trust', label: '可信分档', wrap: true, render: row => row.trust?.label ?? '未标明' },
          { id: 'open', label: '操作', render: row => <Button size="compact" onClick={() => setRecord(row)}>{row.selectable ? '核对条件与 SI 值' : '查看缺项与范围'}</Button> },
        ]} rowLabel={row => `${recordTitle(row)}，${row.quantity.name}，${referenceValue(row.value)}`} onActivate={setRecord} />
      {!filtered.length && <p role="status">没有匹配的原文记录，请调整筛选条件。</p>}
      <p className="muted">SI 值由服务端在核对条件后换算；点开一条记录查看原值、换算值、方法版本与来源限制。</p>
    </>)}
    <section className="reference-section library-import-stack" aria-label="待创建的参考资料">
      <div className="reference-toolbar"><h2>本次参考资料 · {choices.length} 项</h2><Button variant="primary" disabled={!choices.length} onClick={() => setCreating(true)}>预览参考草稿</Button></div>
      {choices.length ? <DataTable label="本次已选参考值" showGroups={false} groups={[{ id: 'choices', label: '已选参考', rows: choices }]}
        columns={[
          { id: 'property', label: '参数', wrap: true, render: row => parameterNames[row.parameter] },
          { id: 'original', label: '原值', wrap: true, render: row => `${referenceValue(row.receipt.record.value)} ${referenceUnit(row.receipt.record.quantity.unit)}` },
          { id: 'si', label: 'SI 值', wrap: true, render: row => quantityText(row.receipt.quantity) },
          { id: 'conditions', label: '明确条件与来源', wrap: true, render: row => <span>{conditionSummary(row.selection.conditions)}<br />{row.receipt.record.citation}</span> },
          { id: 'remove', label: '操作', render: row => <Button variant="ghost" size="compact" onClick={() => onChoices(choices.filter(item => item.id !== row.id))}>移除</Button> },
        ]} rowLabel={row => parameterNames[row.parameter]} /> : <p className="muted">从原表逐条核对并加入。一个参数保留一条明确依据，不自动合并或平均。</p>}
    </section>
    {record && table.data && <SelectReference key={`${record.id}:${table.data.release_digest}`} record={record} table={table.data} category={category} existing={choices.some(item => item.parameter === referenceTarget(category, record))} onClose={() => setRecord(null)} onAdd={add} />}
    {creating && <CreateReferenceDraft category={category} choices={choices} onClose={() => setCreating(false)} onCreated={asset => { onChoices([]); setCreating(false); onCreated(asset); }} />}
  </div>;
}

function SelectReference({ record, table, category, existing, onClose, onAdd }: {
  record: ReferenceRecord; table: ReferenceTableData; category: ReferenceCategory; existing: boolean; onClose: () => void; onAdd: (choice: ReferenceChoice) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [receipt, setReceipt] = useState<ReferenceReceipt | null>(null);
  const [selection, setSelection] = useState<ReferenceSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const parameter = referenceTarget(category, record);
  const update = (next: Record<string, string>) => { setValues(next); setReceipt(null); setSelection(null); setConfirmed(false); setError(''); };
  async function check() {
    setBusy(true); setError('');
    try {
      const selected = { release_digest: table.release_digest, data_sha256: table.data_sha256, standard: record.standard,
        edition: record.edition, locator: record.table || record.clause, quantity: record.quantity.key,
        record_id: record.id, conditions: readConditions(record.conditions, values) };
      const result = await referencePost<ReferenceReceipt>('/api/library/resources/select', selected);
      setReceipt(result); setSelection(selected);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return <LibraryDialog open onOpenChange={open => { if (!open && !busy) onClose(); }} busy={busy} title="核对原值与适用条件"
    description="按实际材料或工况填写。范围不能代替实际数值，资料选择不修改型号。"
    actions={receipt && parameter ? <Button variant="primary" disabled={!selection || !receipt.quantity || !confirmed || busy} onClick={() => selection && onAdd({ id: record.id, parameter, selection, receipt })}>{existing ? '替换本次同参数依据' : '加入本次参考资料'}</Button>
      : <Button variant="primary" disabled={!record.selectable || !confirmed || !conditionsReady(record.conditions, values) || busy} loading={busy} onClick={() => void check()}>核对并读取 SI 值</Button>}>
    <div className="library-import-stack">
      <ReferenceSource record={record} method={table.method} quantity={receipt?.quantity} actualConditions={selection?.conditions} receipt={receipt ?? undefined} selection={selection ?? undefined} />
      {!record.selectable ? <p role="status">{record.trust?.reason ?? '本记录没有唯一可采用数值。'} 不生成参考草稿。</p> : <>
        <h3>本次实际条件</h3><ConditionFields schema={record.conditions} values={values} onChange={update} label="选值条件" disabled={busy} fieldNames={category === 'environment' ? { u_v: '实际运行线电压 U / V' } : undefined} />
        <label className="library-import-confirm"><Checkbox checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} disabled={busy} />我已按实际材料或工况核对条件，未将范围自动取为定值。</label>
      </>}
      {receipt && <p role="status">服务端已核对：{quantityText(receipt.quantity)}。{receipt.quantity_reason} 可信分档：{receipt.trust.label}。</p>}
      {!parameter && <p className="muted">本条可查阅原文及单位；当前资料采用接口未覆盖此物理量，不自动映射到其他参数。</p>}
      {existing && parameter && <p className="muted">本次已选择{parameterNames[parameter]}的依据。加入时将明确替换该项，其他参数保持原有选择。</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  </LibraryDialog>;
}

function CreateReferenceDraft({ category, choices, onClose, onCreated }: {
  category: ReferenceCategory; choices: ReferenceChoice[]; onClose: () => void; onCreated: (asset: ReferenceAsset) => void;
}) {
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const assetId = useRef(`local.${category === 'materials' ? 'material' : 'installation'}.reference.${crypto.randomUUID()}`);
  const [preview, setPreview] = useState<ReferenceDraftPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const body = { name: name.trim(), asset_id: assetId.current, version,
    selections: category === 'materials' ? choices.map(item => ({ parameter: item.parameter, selection: item.selection })) : choices.map(item => item.selection) };
  const endpoint = `/api/library/resources/${category === 'materials' ? 'materials' : 'environment'}`;
  const invalidate = () => { setPreview(null); setConfirmed(false); setError(''); };
  async function run(create: boolean) {
    setBusy(true); setError('');
    try {
      if (create && preview) onCreated(await referencePost<ReferenceAsset>(`${endpoint}/draft`, { ...body, preview_digest: preview.preview_digest, human_confirmed: true }));
      else setPreview(await referencePost<ReferenceDraftPreview>(`${endpoint}/draft-preview`, body));
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return <LibraryDialog open onOpenChange={open => { if (!open && !busy) onClose(); }} busy={busy} title="生成参考资料草稿"
    description="先核对服务端生成的逐项来源与 SI 值，再人工确认入库。草稿、资料发布和工程采用分别记录。"
    actions={<Button variant="primary" loading={busy} disabled={!name.trim() || !version.trim() || (preview !== null && !confirmed)} onClick={() => void run(!!preview)}>{preview ? '确认创建参考草稿' : '读取草稿预览'}</Button>}>
    <div className="library-import-stack">
      <div className="library-import-fields library-import-fields-pair">
        <label className="text-field">资料名称<Input aria-label="参考资料名称" disabled={busy} value={name} onChange={event => { setName(event.target.value); invalidate(); }} /></label>
        <label className="text-field">资料版本<Input aria-label="参考资料版本" disabled={busy} value={version} onChange={event => { setVersion(event.target.value); invalidate(); }} /></label>
      </div>
      {preview && <>
        <EvidenceTable evidence={preview.release.reference_evidence ?? []} label="待创建草稿的原值与 SI 值" />
        <p>所有记录保留“参考”分档。创建草稿不改变型号材料或计算工况。</p>
        <label className="library-import-confirm"><Checkbox checked={confirmed} disabled={busy} onCheckedChange={value => setConfirmed(value === true)} />我已查看上述逐项来源，确认以此版本创建参考草稿。</label>
        <details className="library-import-details"><summary>固定内容摘要</summary><p className="library-import-digest">{preview.content_sha256}</p></details>
      </>}
      {error && <p role="alert">{error}</p>}
    </div>
  </LibraryDialog>;
}
