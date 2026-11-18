import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { message, optionalRecord, text } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { ErrorState, LoadingState, InlineEmpty } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { confidenceText, displayLibraryText, issueText, libraryPost, libraryRequest, type LibrarySpec, type SeriesDetail, type SeriesSummary, type ValueSource } from './api';
import { emptyRating, ratingReady, ratingRequest, RatingForm } from './rating-form';
import { ValueTable } from './value-table';
import { downloadSeries } from './exchange';
import { LibraryDialog } from './dialog';
import { PublishedGuidance } from './published-guidance';

const STATES: Record<string, string> = { draft: '草稿', incomplete: '资料缺项', submitted: '待审核', reviewed: '已审核', approved: '已批准', adopted: '已采纳', confirmed: '已人工核对', published: '已发布', rejected: '已退回', unverified: '待核对', ready: '结构完整' };
const OPERATIONS = { check: '批量标准核对', calculate: '批量计算', review: '批量人工审核' };
type Operation = keyof typeof OPERATIONS;
interface BatchItem { spec_id?: string; name?: string; status?: string; message?: string; error?: unknown; errors?: unknown[]; method_name?: string; method_version?: string; confidence?: string; checks?: Record<string, unknown>[]; rows?: Record<string, unknown>[]; workspace_id?: string }
interface BatchReceipt { items?: BatchItem[]; results?: BatchItem[]; [key: string]: unknown }

export function SeriesLibrary({ selected, onSelect, onImport }: { selected?: string; onSelect: (id: string) => void; onImport: () => void }) {
  const client = useQueryClient();
  const [query, setQuery] = useState('');
  const [selectedSpecs, setSelectedSpecs] = useState<Set<string>>(new Set());
  const [operation, setOperation] = useState<Operation | null>(null);
  const [reviewer, setReviewer] = useState('');
  const [note, setNote] = useState('');
  const [reviewAction, setReviewAction] = useState('submit');
  const [rating, setRating] = useState(() => emptyRating(3));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [batch, setBatch] = useState<BatchReceipt | null>(null);
  const [batchOpen, setBatchOpen] = useState(true);
  const [specDetail, setSpecDetail] = useState<LibrarySpec | null>(null);
  const [exportNotice, setExportNotice] = useState('');
  const requestId = useRef({ signature: '', id: '' });
  const results = useRef<HTMLElement>(null);
  const list = useQuery({ queryKey: ['type-library', 'series'], queryFn: ({ signal }) => libraryRequest<{ items: SeriesSummary[] }>('/series', { signal }) });
  const details = useQuery({ queryKey: ['type-library', 'series', selected], queryFn: ({ signal }) => libraryRequest<SeriesDetail>(`/series/${encodeURIComponent(selected!)}`, { signal }), enabled: !!selected });
  useEffect(() => { setSelectedSpecs(new Set()); setBatch(null); setError(''); }, [selected]);
  // The dialog closes onto the toolbar; bring the fresh outcome into view even when the page was scrolled.
  useEffect(() => { if (batch) results.current?.scrollIntoView({ block: 'nearest' }); }, [batch]);
  const series = details.data?.series;
  const seriesOptions = (list.data?.items || []).map(item => ({ value: item.id, label: item.name }));
  if (series && !seriesOptions.some(item => item.value === series.id)) seriesOptions.unshift({ value: series.id, label: series.name });
  const specs = details.data?.specs || [];
  const checked = specs.filter(spec => selectedSpecs.has(spec.id));
  const rows = (list.data?.items || []).filter(item => [item.name, item.manufacturer, item.designation].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const toggle = (id: string, value: boolean) => setSelectedSpecs(previous => { const next = new Set(previous); if (value) next.add(id); else next.delete(id); return next; });
  const showBatch = (action: Operation) => { setOperation(action); setConfirmed(false); setError(''); setNote(''); setReviewAction('submit'); requestId.current = { signature: '', id: '' }; if (action === 'calculate') setRating(emptyRating(series?.cores || 1)); };
  const closeBatch = (open: boolean) => { if (!open && !busy) setOperation(null); };
  async function exportCurrent(format: 'json' | 'xlsx') {
    if (!selected) return;
    setBusy(true); setError(''); setExportNotice('');
    try { await downloadSeries(selected, format); setExportNotice(`当前系列的 ${format === 'json' ? 'JSON' : 'Excel'} 交换文件已下载，包含原始结构表与逐项来源。`); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }

  async function executeBatch() {
    if (!operation || !selected || !confirmed || !checked.length) return;
    setBusy(true); setError('');
    try {
      const payload = {
        operation, spec_ids: checked.map(spec => spec.id),
        expected_versions: Object.fromEntries(checked.map(spec => [spec.id, spec.version])), human_confirmed: true,
        expected_revisions: Object.fromEntries(checked.filter(spec => spec.workspace_revision !== undefined).map(spec => [spec.id, spec.workspace_revision])),
        scope_acknowledged: true,
        ...(operation === 'review' ? { note: `审核人：${reviewer.trim()}；${note.trim()}`, action: reviewAction } : {}),
        ...(operation === 'calculate' ? ratingRequest(rating) : {}),
      };
      const signature = JSON.stringify(payload);
      if (requestId.current.signature !== signature) requestId.current = { signature, id: crypto.randomUUID() };
      const result = await libraryPost<BatchReceipt>(`/series/${encodeURIComponent(selected)}/batch`, { ...payload, request_id: requestId.current.id });
      setBatch(result); setBatchOpen(true); setOperation(null);
      await client.invalidateQueries({ queryKey: ['type-library', 'series'] });
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }

  return <div className="library-import-stack library-import-series">
    <div className="library-import-series-heading"><h2>{series ? series.name : '型号系列'}</h2><div className="library-import-series-actions">{selected && <Button onClick={() => onSelect('')}>全部系列</Button>}<Button onClick={onImport}>导入结构表</Button></div></div>
    {!selected ? <>
      <label className="text-field">查找系列<Input aria-label="查找系列" value={query} onChange={event => setQuery(event.target.value)} placeholder="系列名称、制造商或型号" /></label>
      {list.isPending ? <LoadingState title="正在读取型号系列" /> : list.isError ? <ErrorState description={message(list.error)} action={<Button onClick={() => void list.refetch()}>重新读取</Button>} /> : !rows.length ? <InlineEmpty title={query ? '没有匹配的系列。清空检索后可查看全部系列。' : '还没有系列。导入结构表后，规格将在这里集中核对与计算。'} /> : <DataTable label="型号系列" showGroups={false} groups={[{ id: 'series', label: '系列', rows }]} rowLabel={row => row.name} onActivate={row => onSelect(row.id)} columns={[
        { id: 'name', label: '系列名称', wrap: true, render: row => <Button variant="link" onClick={() => onSelect(row.id)}>{row.name}</Button> },
        { id: 'manufacturer', label: '制造商', wrap: true, render: row => row.manufacturer || '未声明' },
        { id: 'voltage', label: '额定电压', unit: 'kV', numeric: true, render: row => `${row.u0_v / 1000} / ${row.u_v / 1000}` },
        { id: 'cores', label: '芯数', numeric: true, render: row => row.cores },
        { id: 'specs', label: '规格数', numeric: true, render: row => row.spec_count },
        { id: 'status', label: '版本状态', wrap: true, render: row => Object.entries(row.states || {}).map(([state, count]) => `${STATES[state] || state} ${count}`).join(' · ') || '草稿' },
      ]} />}
      {query && !rows.length && <div><Button onClick={() => setQuery('')}>清空检索</Button></div>}
    </> : details.isPending ? <LoadingState title="正在读取系列与规格" /> : details.isError ? <ErrorState description={message(details.error)} action={<Button onClick={() => void details.refetch()}>重新读取系列</Button>} /> : <>
      <div className="library-import-series-toolbar">
        <Select label="型号系列" value={selected} onChange={onSelect} options={seriesOptions} />
        <div className="library-import-series-actions"><Button disabled={!checked.length || busy} onClick={() => showBatch('check')}>批量核对</Button><Button disabled={!checked.length || busy} onClick={() => showBatch('calculate')}>批量计算</Button><Button disabled={!checked.length || busy} onClick={() => showBatch('review')}>批量审核</Button></div>
      </div>
      <div className="library-import-series-actions"><Button disabled={busy} onClick={() => void exportCurrent('json')}>导出系列 JSON</Button><Button disabled={busy} onClick={() => void exportCurrent('xlsx')}>导出系列 Excel</Button><span className="muted">当前版本及其来源原件</span></div>
      {exportNotice && <p role="status">{exportNotice}</p>}
      {error && !operation && <p role="alert" className="field-error">{error}</p>}
      {batch && <section ref={results} className="library-import-stack" aria-label="批量操作结果">
        <div className="library-import-series-heading"><h2>本次批量操作结果</h2><Button aria-expanded={batchOpen} onClick={() => setBatchOpen(open => !open)}>{batchOpen ? '收起结果' : '展开结果'}</Button></div>
        {batchOpen && <DataTable label="批量操作结果" showGroups={false} groups={[{ id: 'result', label: '结果', rows: (batch.items || batch.results || []).map((item, index) => ({ ...item, id: String(index) })) }]} rowLabel={row => row.name || '规格结果'} columns={[
          { id: 'name', label: '规格', wrap: true, render: row => row.name || specs.find(spec => spec.id === row.spec_id)?.name || '规格' },
          { id: 'status', label: '状态', wrap: true, render: row => ({ succeeded: '已完成', success: '已完成', passed: '通过', failed: '未通过', partial: '部分完成', refused: '拒算', reviewed: '已审核', incomplete: '缺项', error: '失败', completed: '已完成' } as Record<string, string>)[row.status || ''] || STATES[row.status || ''] || row.status || '查看说明' },
          { id: 'message', label: '结果与限制', wrap: true, render: row => <BatchOutcome row={row} /> },
          { id: 'method', label: '方法与可信分档', wrap: true, render: row => [row.method_name, row.method_version, row.confidence ? confidenceText(row.confidence) : ''].filter(Boolean).join(' · ') || '—' },
        ]} />}
      </section>}
      <PublishedGuidance value={details.data?.declaration?.reference?.published_guidance} />
      <div className="library-import-selection"><label className="library-import-confirm"><Checkbox aria-label="选择全部规格" checked={checked.length === specs.length && !!specs.length ? true : checked.length ? 'indeterminate' : false} onCheckedChange={value => setSelectedSpecs(value === true ? new Set(specs.map(spec => spec.id)) : new Set())} /><span>全选 {specs.length} 个规格</span></label><span className="muted">已选 {checked.length} 项{!checked.length && ' · 选择规格后可批量操作'}</span></div>
      <DataTable label="系列规格" showGroups={false} groups={[{ id: 'specs', label: '规格', rows: specs }]} rowLabel={row => row.name} columns={[
        { id: 'select', label: '选择', render: row => <Checkbox aria-label={`选择 ${row.name}`} checked={selectedSpecs.has(row.id)} onCheckedChange={value => toggle(row.id, value === true)} /> },
        { id: 'name', label: '规格', wrap: true, render: row => <Button variant="link" onClick={() => setSpecDetail(row)}>{row.name}</Button> },
        { id: 'area', label: '截面', unit: 'mm²', numeric: true, render: row => Number.isFinite(row.area_m2) ? Number((row.area_m2 * 1e6).toPrecision(8)) : '—' },
        { id: 'version', label: '版本', render: row => `第 ${row.version} 版` },
        { id: 'state', label: '状态', wrap: true, render: row => STATES[row.state] || row.state },
        { id: 'missing', label: '缺项与下一步', wrap: true, render: row => <div className="library-import-issues">{row.missing?.length ? row.missing.map((item, index) => <span key={index}>{issueText(item)}</span>) : <span>查看来源并进行标准核对</span>}{row.workspace_id && <a className="object-link" href={`/types/${encodeURIComponent(row.workspace_id)}/structure/section`}>打开型号设计</a>}</div> },
      ]} />
    </>}
    <LibraryDialog open={operation !== null} onOpenChange={closeBatch} busy={busy} title={operation ? OPERATIONS[operation] : '批量操作'} description={`将对已选 ${checked.length} 个规格的当前版本执行；原始资料与历史版本保留。`} initialFocus="form" actions={<Button variant="primary" loading={busy} disabled={!confirmed || !checked.length || (operation === 'review' && (!reviewer.trim() || !note.trim())) || (operation === 'calculate' && !ratingReady(rating))} onClick={() => void executeBatch()}>确认执行 {checked.length} 个规格</Button>}>
      <div className="library-import-stack">
        <p>{checked.map(spec => `${spec.name}（第 ${spec.version} 版）`).join('；')}</p>
        {operation === 'review' && <>
          <Select label="审核动作" value={reviewAction} onChange={setReviewAction} options={[{ value: 'submit', label: '提交审核' }, { value: 'approve', label: '批准已提交版本' }, { value: 'publish', label: '发布已批准版本' }]} />
          <label className="text-field">审核人<Input aria-label="审核人" required value={reviewer} onChange={event => setReviewer(event.target.value)} /></label>
          <label className="text-field">审核意见<Textarea aria-label="审核意见" required value={note} onChange={event => setNote(event.target.value)} /></label>
        </>}
        {operation === 'calculate' && <RatingForm value={rating} onChange={setRating} cores={series?.cores || 1} />}
        <label className="library-import-confirm"><Checkbox checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} aria-label="确认所选规格与版本" /><span>我已核对所选规格与版本，确认执行本次操作。缺项、方法限制与审核门禁由系统逐项检查。</span></label>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </LibraryDialog>
    {specDetail && <SpecSources key={specDetail.id} spec={specDetail} onClose={() => setSpecDetail(null)} />}
  </div>;
}

function BatchOutcome({ row }: { row: BatchItem }) {
  const verdicts = Object.entries((row.checks || []).reduce<Record<string, number>>((counts, check) => { const key = text(check.verdict) || 'missing'; counts[key] = (counts[key] || 0) + 1; return counts; }, {}));
  const errors = (row.errors || []).filter(Boolean).map(error => typeof error === 'string' ? error : text(optionalRecord(error).message) || '方法没有提供可读的失败说明，请打开型号与运行查看详情。');
  return <div className="library-import-issues">
    <span>{displayLibraryText(row.message || text(optionalRecord(row.error).message) || (typeof row.error === 'string' ? row.error : '') || '—')}</span>
    {errors.map((error, index) => <span key={index}>{displayLibraryText(error)}</span>)}
    {!!verdicts.length && <span>{verdicts.map(([verdict, count]) => `${({ passed: '符合', failed: '不符合', missing: '缺项', uncovered: '依据未收录', not_applicable: '不适用' } as Record<string, string>)[verdict] || '待核对'} ${count} 项`).join(' · ')}</span>}
    {row.rows?.map((item, index) => <span key={index}>{text(item.name)}：{typeof item.value_a === 'number' ? `${Number(item.value_a.toPrecision(6))} A` : '拒算'}{text(item.reason) && `；${displayLibraryText(text(item.reason))}`}</span>)}
    {row.workspace_id && <a className="object-link" href={`/types/${encodeURIComponent(row.workspace_id)}/structure/section`}>查看型号与运行</a>}
  </div>;
}

function SpecSources({ spec, onClose }: { spec: LibrarySpec; onClose: () => void }) {
  const client = useQueryClient();
  const [version, setVersion] = useState(spec.version);
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef({ signature: '', id: '' });
  const detail = useQuery({ queryKey: ['type-library', 'spec', spec.id, version],
    queryFn: ({ signal }) => libraryRequest<{ spec: LibrarySpec; versions: LibrarySpec[]; values: ValueSource[] }>(`/specs/${encodeURIComponent(spec.id)}?version=${version}`, { signal }) });
  const current = detail.data?.spec || spec;
  const values = detail.data?.values || spec.values || [];
  const latest = (detail.data?.versions || [spec])[0].version;
  async function revise() {
    if (!confirmed || !note.trim() || version !== latest || !current.workspace_revision) return;
    setBusy(true); setError(''); setNotice('');
    const payload = { expected_version: current.version, expected_revision: current.workspace_revision, note: note.trim(), human_confirmed: true };
    const signature = JSON.stringify(payload);
    if (request.current.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    try {
      const result = await libraryPost<{ version: number; message: string }>(`/specs/${encodeURIComponent(spec.id)}/revisions`, { ...payload, request_id: request.current.id });
      setVersion(result.version); setNotice(result.message); setConfirmed(false); setNote('');
      await Promise.all([client.invalidateQueries({ queryKey: ['type-library', 'spec', spec.id] }), client.invalidateQueries({ queryKey: ['type-library', 'series'] })]);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return <LibraryDialog open onOpenChange={open => { if (!open && !busy) onClose(); }} busy={busy} title={spec.name} description={`第 ${version} 版 · ${STATES[current.state] || '待核对'}`} initialFocus="form">
    {detail.isPending ? <LoadingState title="正在读取来源与版本" /> : detail.isError ? <ErrorState description={message(detail.error)} action={<Button onClick={() => void detail.refetch()}>重新读取来源</Button>} /> : <div className="library-import-stack">
      <Select label="查看规格版本" disabled={busy} value={String(version)} onChange={next => setVersion(Number(next))} options={(detail.data?.versions || [spec]).map(item => ({ value: String(item.version), label: `第 ${item.version} 版 · ${STATES[item.state] || '待核对'}` }))} />
      {busy && <p role="status">{notice ? '正在刷新版本与系列，完成后可切换版本或关闭…' : '正在保存独立新版本…'}</p>}
      <p className="muted">以下是该版本保存的原始导入数值。{current.has_design_changes ? '型号设计已有后续修改，请打开型号设计核对当前结构。' : '原始文件摘要与每个单元格的出处已随版本保留。'}</p>
      <ValueTable values={values} />
      {current.workspace_id && <div><Button asChild><a href={`/types/${encodeURIComponent(current.workspace_id)}/structure/section`}>打开型号设计</a></Button></div>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" className="field-error">{error}</p>}
      {version === latest && <details className="library-import-details">
        <summary>将当前设计保存为新版本</summary>
        <div className="library-import-stack">
          <p className="muted">从当前已保存的型号设计建立独立草稿，保留旧版及其运行记录。系列电压、芯数和规格截面保持一致；结构缺项须先在型号设计中补齐。</p>
          <label className="text-field">改版说明<Textarea aria-label="改版说明" value={note} maxLength={1000} required onChange={event => setNote(event.target.value)} /></label>
          <label className="library-import-confirm"><Checkbox aria-label="确认保存型号新版本" checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} /><span>我已核对当前保存的设计与本次改版说明，确认建立第 {latest + 1} 版草稿。</span></label>
          <div><Button variant="primary" loading={busy} disabled={!confirmed || !note.trim() || !current.workspace_revision} onClick={() => void revise()}>建立新版本草稿</Button></div>
        </div>
      </details>}
    </div>}
  </LibraryDialog>;
}
