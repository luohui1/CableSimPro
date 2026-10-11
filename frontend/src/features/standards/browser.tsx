import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { ErrorState, InlineEmpty, LoadingState } from '@/components/states';
import { ApiError, message } from '@/api/client';
import { basisPin, basisQuery, type BasisRecord, type Answer } from './client';
import { conditionFactor, conditionNames, conditionsLabel, copyCitation, formulaDetails, localized, methodLabel, valueLabel } from './format';
import './standards.css';

type GridRow = { id: string; label: string; records: BasisRecord[] };
export function StandardsBrowser() {
  const pin = useQuery({ queryKey: ['standards-basis-pin'], queryFn: ({ signal }) => basisPin(signal), retry: false });
  const catalogue = useQuery({ queryKey: ['standards-basis-catalog', pin.data?.release_digest], enabled: !!pin.data,
    queryFn: ({ signal }) => basisQuery(pin.data!, { schema_version: 'cablesim.standards-query/1', operation: 'catalog' }, signal), retry: false });
  const [standard, setStandard] = useState('GB/T 12706.2—2020'), [tableId, setTableId] = useState('mv-表7');
  const [filter, setFilter] = useState(''), [quantity, setQuantity] = useState(''), [inputs, setInputs] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState(''), [history, setHistory] = useState<Answer[]>([]), [historical, setHistorical] = useState<Answer | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const searchController = useRef<AbortController | null>(null), lastInputs = useRef<Record<string, string>>({});
  useEffect(() => () => searchController.current?.abort(), []);
  const tables = catalogue.data?.tables ?? [];
  const standards = [...new Set(tables.map(t => `${t.standard}—${t.edition}`))];
  const filteredTables = tables.filter(t => `${t.standard}—${t.edition}` === standard && `${t.table} ${t.clause} ${t.title} ${(t.quantities ?? []).map(q => q.name).join(' ')}`.includes(filter));
  const table = filteredTables.find(t => t.id === tableId) ?? filteredTables[0];
  const listing = useQuery({ queryKey: ['standards-basis-table', pin.data?.release_digest, table?.id], enabled: !!pin.data && !!table,
    queryFn: ({ signal }) => basisQuery(pin.data!, { schema_version: 'cablesim.standards-query/1', operation: 'list', standard: table!.standard, edition: table!.edition, locator: table!.table || table!.clause }, signal), retry: false });
  const chooseTable = (id: string) => { searchController.current?.abort(); setTableId(id); setQuantity(''); setInputs({}); setNotice(''); setSelectedId(null); setHistorical(null); search.reset(); };
  const search = useMutation({ retry: false, mutationFn: async () => {
    if (!pin.data || !table || !selectedQuantity) throw Error('请选择标准、条款和量。');
    const conditions: Record<string, string | number> = {};
    for (const key of conditionKeys) {
      const raw = inputs[key]?.trim();
      if (!raw) continue;
      const candidates = quantityRecords.map(r => r.conditions[key]).filter(v => v !== undefined);
      const numeric = candidates.some(v => typeof v === 'number' || (v && typeof v === 'object' && Object.values(v).flat().some(x => typeof x === 'number')));
      if (numeric) {
        const value = Number(raw);
        if (!Number.isFinite(value) || value <= 0) throw new ApiError(422, `请在“${conditionNames[key] || key}”填写正数。`, { path: `/conditions/${key}` });
        conditions[key] = value / conditionFactor(key);
      } else conditions[key] = raw;
    }
    searchController.current?.abort();
    searchController.current = new AbortController();
    return basisQuery(pin.data, { schema_version: 'cablesim.standards-query/1', standard: table.standard, edition: table.edition,
      locator: table.table || table.clause, quantity: selectedQuantity, conditions }, searchController.current.signal);
  }, onSuccess: answer => { setHistory(prev => [answer, ...prev].slice(0, 10)); setHistorical(null); },
  onError: error => { const field = error instanceof ApiError ? String((error.detail as Record<string, unknown>)?.path || '').split('/').pop() : '';
    if (field) {
      const target = document.getElementById(`basis-${field}`) ?? [...document.querySelectorAll<HTMLElement>('.basis-search [data-field-path]')]
        .find(el => el.dataset.fieldPath === `/conditions/${field}`)?.querySelector<HTMLElement>('[role="combobox"]');
      target?.focus();
    } } });
  const records = historical?.records ?? listing.data?.records ?? [];
  const quantities = [...new Map(records.map(r => [r.quantity.key, r.quantity])).values()];
  const selectedQuantity = quantities.some(q => q.key === quantity) ? quantity : quantities[0]?.key;
  const quantityRecords = records.filter(r => r.quantity.key === selectedQuantity);
  const conditionKeys = [...new Set(quantityRecords.flatMap(r => Object.keys(r.conditions)))];
  const columns = [...new Map(records.map(r => [r.column, r])).values()];
  const rows = useMemo(() => [...new Map(records.map(r => [r.row, { id: String(r.row), label: r.row_label, records: records.filter(x => x.row === r.row) }])).values()], [records]);
  const selected = records.find(r => r.id === selectedId);
  useEffect(() => {
    if (!selectedId) return;
    const frame = requestAnimationFrame(() => [...(gridRef.current?.querySelectorAll<HTMLButtonElement>('[data-record-id]') ?? [])]
      .find(el => el.dataset.recordId === selectedId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);
  const commonConditions = Object.fromEntries(Object.entries(columns[0]?.column_conditions ?? {}).filter(([key,value]) => columns.every(c => JSON.stringify(c.column_conditions?.[key]) === JSON.stringify(value))));
  const units = [...new Set(records.filter(r => r.quantity.dimension !== 'text' && r.quantity.unit !== '1').map(r => r.quantity.unit))];
  const printedPages = [...new Set(records.map(r => r.printed_page))].sort((a,b) => a-b);
  const pdfPages = [...new Set(records.map(r => r.pdf_page))].sort((a,b) => a-b);
  const pageRange = (pages: number[]) => pages.length > 1 ? `${pages[0]}–${pages.at(-1)}` : String(pages[0] ?? '缺项');
  function columnLabel(r: BasisRecord) {
    const distinguishing = Object.fromEntries(Object.entries(r.column_conditions ?? {}).filter(([key]) => !(key in commonConditions)));
    const numbers = (value: unknown): number[] => typeof value === 'number' ? [value] : value && typeof value === 'object' ?
      'eq' in value ? [Number(value.eq)] : 'in' in value && Array.isArray(value.in) ? value.in.map(Number) : [] : [];
    const u0 = numbers(distinguishing.u0_v), u = numbers(distinguishing.u_v);
    if (u0.length === 1 && u.length) {
      const rest = Object.fromEntries(Object.entries(distinguishing).filter(([key]) => key !== 'u0_v' && key !== 'u_v'));
      return `${u.map(v => `${u0[0]/1000}/${v/1000}`).join(' 或 ')} kV${Object.keys(rest).length ? ` · ${conditionsLabel(rest)}` : ''}`;
    }
    return conditionsLabel(distinguishing) || (columns.length === 1 ? '取值' : r.column_header?.name ?? r.quantity.name);
  }
  function moveCell(r: BasisRecord, key: string) {
    const row = rows.findIndex(row => row.id === String(r.row)), col = columns.findIndex(c => c.column === r.column);
    const nextRow = Math.max(0, Math.min(rows.length-1, row + (key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0)));
    const nextCol = Math.max(0, Math.min(columns.length-1, col + (key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0)));
    const next = rows[nextRow]?.records.find(x => x.column === columns[nextCol]?.column);
    if (!next) return;
    setSelectedId(next.id);
    const element = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>('[data-record-id]') ?? [])].find(el => el.dataset.recordId === next.id);
    element?.focus({ preventScroll: true }); element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const fail = pin.error || catalogue.error, pending = pin.isPending || (!!pin.data && catalogue.isPending);
  const overallState = pending ? 'loading' : fail ? 'error' : !tables.length ? 'empty' : historical ? 'historical' : 'success';
  async function copy(r: BasisRecord) {
    try { await navigator.clipboard.writeText(copyCitation(r)); setNotice('引用已复制'); }
    catch { setNotice('无法访问剪贴板；请在引用详情中选中文字复制。'); }
  }
  function evidence(r: BasisRecord) {
    return <div className="basis-evidence"><strong>{copyCitation(r)}</strong><span>印刷第 {r.printed_page} 页 · PDF 第 {r.pdf_page} 页</span>
      {r.verification.methods.map((m, i) => <span key={i}>核验 {i + 1}：{methodLabel(m)} · {r.verification.status === 'verified' ? '一致' : '存在差异'}</span>)}
      <span>来源摘要：{r.source_sha256}</span>{r.value_details && <span>{r.value_details.formula_text}；公式仅作为依据，不执行。</span>}
      {r.limitations.map((note,i) => <span key={`limit-${i}`}>{note}</span>)}{r.value && typeof r.value === 'object' && !Array.isArray(r.value) ?
        formulaDetails(r.value).map((text,i) => <span key={i}>{text}</span>) : null}</div>;
  }
  function cell(r?: BasisRecord, inGrid = true) {
    if (!r) return '缺项';
    return <Tooltip content={r.value === null ? '标准不适用（原表为破折号）' : evidence(r)}><button type="button" className="basis-value"
      data-record-id={r.id} data-selected={selectedId === r.id || undefined} aria-pressed={selectedId === r.id}
      tabIndex={!inGrid || selectedId === r.id || (!selected && r.id === records[0]?.id) ? 0 : -1}
      aria-label={`查看依据：${copyCitation(r)}`} onClick={() => setSelectedId(r.id)}
      onKeyDown={e => { if (inGrid && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); moveCell(r,e.key); }
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setSelectedId(r.id); if (r.verification.status === 'verified') void copy(r); } }}>
      {r.value === null ? '—' : r.value_details && /^[a-z]$/i.test(String(r.value)) ? `脚注 ${String(r.value)}` : valueLabel(r.value)}{r.value !== null && units.length > 1 && r.quantity.dimension !== 'text' && r.quantity.unit !== '1' ? ` ${r.quantity.unit}` : ''}</button></Tooltip>;
  }
  const gaps = (catalogue.data?.not_covered ?? []).filter(g => String(g.standard || '').replace(/—.*$/, '') === table?.standard || standard.startsWith(String(g.standard || '')));
  const changeInput = (key: string, value: string) => { lastInputs.current = inputs; setInputs(prev => ({ ...prev, [key]: value })); setHistorical(null); if (search.data) { setHistorical(search.data); } search.reset(); };
  return <section className="standards-browser" data-page="standards-basis" data-state={overallState}
    onKeyDown={e => { if (e.key === 'Escape') { searchController.current?.abort(); setSearchOpen(false); } if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); setInputs(lastInputs.current); search.reset(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); setNotice('只读依据无需保存；用“复制”引用固定出处。'); } }}>
    {pending ? <LoadingState title="正在读取已核验依据" /> : fail ? <ErrorState description={message(fail)} action={<Button onClick={() => { void pin.refetch(); void catalogue.refetch(); }}>重新读取</Button>} /> : !tables.length ? <InlineEmpty title="此发行尚无依据表；请安装包含已核验数据的发行。" /> : <>
      <div className="basis-toolbar"><Select label="标准版本" value={standard} onChange={v => { setStandard(v); chooseTable(''); setFilter(''); }} options={standards.map(s => ({ value: s, label: s }))} />
        <label className="search-field">按量或条款检索<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="绝缘标称厚度、最大直流电阻" /></label>
        <Select label="表或条款" value={table?.id || ''} onChange={chooseTable} options={filteredTables.map(t => ({ value: t.id, label: `${t.table || t.clause} · ${t.title}` }))} />
        <Button onClick={() => setSearchOpen(v => !v)} aria-expanded={searchOpen}>条件检索</Button></div>
      {searchOpen && <form className="basis-search" onSubmit={e => { e.preventDefault(); if (!search.isPending) search.mutate(); }}>
        <Select label="量" value={selectedQuantity || ''} onChange={v => { setQuantity(v); setInputs({}); search.reset(); }} options={quantities.map(q => ({ value: q.key, label: q.name }))} />
        {conditionKeys.map(key => {
          const raw = quantityRecords.map(r => r.conditions[key]).filter(v => v !== undefined);
          const options = [...new Set(raw.flatMap(v => typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flat().filter((x): x is string => typeof x === 'string') : []))];
          return options.length ? <Select key={key} path={`/conditions/${key}`} label={conditionNames[key] || key} value={inputs[key] || ''} onChange={v => changeInput(key, v)} options={[{ value: '', label: '未指定' }, ...options.map(v => ({ value: v, label: localized(v) }))]} /> :
            <label className="text-field" key={key}>{conditionNames[key] || key}<input id={`basis-${key}`} value={inputs[key] || ''} inputMode="decimal" placeholder="填写条件" onChange={e => changeInput(key, e.target.value)} /></label>;
        })}<Button variant="primary" type="submit" disabled={!table || !selectedQuantity} loading={search.isPending}>查依据</Button>
        {search.error && <p role="alert" className="field-error">{message(search.error)}</p>}
        {search.data && <div className="basis-result" role="status">{search.data.records.length ? search.data.records.map(r => <div key={r.id}>{copyCitation(r)} {cell(r,false)}</div>) : search.data.reason}</div>}
      </form>}
      {history.length > 0 && <div className="basis-history"><Select label="本次会话查询记录" value={historical ? String(history.indexOf(historical)) : ''} onChange={i => { setHistorical(i === '' ? null : history[Number(i)]); setSearchOpen(false); }} options={[{ value: '', label: '完整表格' }, ...history.map((h, i) => ({ value: String(i), label: h.records[0] ? copyCitation(h.records[0]) : '未覆盖条件' }))]} />{historical && <span>历史查询 · 固定依据快照</span>}</div>}
      {!table ? <InlineEmpty title="没有匹配的量或条款，请清空检索。" /> : listing.isPending && !historical ? <LoadingState title="正在读取完整表格" /> : listing.error && !historical ? <ErrorState description={message(listing.error)} action={<Button onClick={() => void listing.refetch()}>重新读取</Button>} /> : <div className="basis-table" ref={gridRef}><h2>{historical ? '历史查询 · ' : ''}{table.table || table.clause} · {table.title}{conditionsLabel(commonConditions) ? ` · ${conditionsLabel(commonConditions)}` : ''}{units.length === 1 ? ` / ${units[0]}` : units.length > 1 ? ' · 单位随行' : ''}</h2>
        <p className="basis-source">{table.standard}—{table.edition} {table.table || `条款 ${table.clause}`} · 第 {pageRange(printedPages)} 页（PDF 第 {pageRange(pdfPages)} 页）· {records.every(r => r.verification.status === 'verified') ? '两路核验' : '核验存在差异'}</p>
        <DataTable<GridRow> label="标准完整表格" showGroups={false} groups={[{ id: 'basis', label: '完整表', rows }]} rowLabel={r => r.label} historical={!!historical}
          columns={[{ id: 'conditions', label: '行条件', wrap: true, render: r => r.label }, ...columns.map(c => ({ id: c.column,
            label: columnLabel(c), numeric: true, wrap: true, render: (r: GridRow) => cell(r.records.find(x => x.column === c.column)) }))]} />
        {selected ? <div className="basis-detail" aria-label="选中格详情"><div><strong>{selected.quantity.name}：{valueLabel(selected.value)}{selected.value !== null && selected.quantity.dimension !== 'text' && selected.quantity.unit !== '1' ? ` ${selected.quantity.unit}` : ''}</strong>
          <p>{conditionsLabel(selected.conditions)}</p>
          <p>印刷第 {selected.printed_page} 页 · PDF 第 {selected.pdf_page} 页</p>
          {selected.verification.methods.map((m,i) => <p key={i}>核验 {i+1}：{methodLabel(m)} · {selected.verification.status === 'verified' ? '一致' : '存在差异，禁止引用'}</p>)}
          {selected.value_details && <p>{selected.value_details.formula_text}；公式仅作为依据，不执行。</p>}
          {selected.limitations.map((note,i) => <p key={i}>{note}</p>)}
          <details><summary>引用与来源摘要</summary><p>{copyCitation(selected)}</p><p>{selected.source_sha256}</p>{selected.value && typeof selected.value === 'object' ? formulaDetails(selected.value).map((line,i) => <p key={i}>{line}</p>) : null}</details></div>
          <Button size="compact" disabled={selected.verification.status !== 'verified'} onClick={() => void copy(selected)}>复制引用</Button></div> : <p className="basis-selection-hint">选择表格中的值查看完整依据；方向键选格，Enter 复制引用。</p>}
      </div>}
      <details className="basis-uncovered"><summary>下一轮 · 未覆盖条款</summary>{gaps.length ? gaps.map((g, i) => <p key={i}>{[...(Array.isArray(g.locators) ? g.locators : []),g.reason].filter(v => typeof v === 'string').join(' · ')}</p>) : <p>当前标准未覆盖的其他条款与特殊条件留到下一轮；已列出的表格不代表整份标准合格。</p>}</details>
      <span className="basis-notice" role="status">{notice}</span>
    </>}
  </section>;
}
