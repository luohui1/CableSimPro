import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type ColumnSizingState, type RowSelectionState, type SortingState } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';
import { compact, fixed, REVIEW_NAMES, STATE_NAMES } from '@shared/format';
import { pending, problems, RESULT_NAMES } from '@shared/products';
import { RESULT_KINDS, type LibraryJob, type ResultKind, type SpecRow } from '@shared/types';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { LibraryHeader } from '@/components/library-header';
import { reportFailure } from '@/components/notice';
import { SearchField } from '@/components/search-field';
import { SpecInspector } from '@/components/spec-inspector';
import { cn } from '@/lib/cn';
import { api } from '@/state/api';
import { queryClient, useLibraryJob, useProductLibrary, useProductSeries } from '@/state/queries';

function Check({ label, checked, mixed, onChange }: { label: string; checked: boolean; mixed?: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = Boolean(mixed); }, [mixed]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={checked} onChange={onChange} onClick={event => event.stopPropagation()} />;
}

function readPreferences(): { view: string; sizes: ColumnSizingState; sorting: SortingState } {
  try { return JSON.parse(localStorage.getItem('studio.product-table') ?? 'null') ?? { view: 'overview', sizes: {}, sorting: [] }; }
  catch { return { view: 'overview', sizes: {}, sorting: [] }; }
}

function TaskProgress() {
  const query = useLibraryJob();
  const job = query.data;
  const stop = useMutation({ mutationFn: () => api.op('library.compute.cancel', { job: job!.id }), onError: reportFailure,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['library'] }) });
  if (!job) return null;
  return <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-fill px-4 py-2 text-13">
    <span className={job.state === 'failed' ? 'text-error' : ''}>{job.title}</span><span>{job.done} / {job.total} 项</span>
    <progress aria-label="批量计算进度" value={job.done} max={Math.max(1, job.total)} className="h-1 w-36" />
    {job.error && <span>{job.error.message}</span>}
    {job.state === 'running' && <Button size="compact" busy={stop.isPending} disabled={job.cancel_requested} onClick={() => stop.mutate()}>{job.cancel_requested ? '本批次结束后停止' : '停止计算'}</Button>}
    <Link to="/library/$seriesId" params={{ seriesId: job.series_id }} search={{}} className="text-ink">查看任务系列</Link>
  </div>;
}

export function SeriesWorkspace({ id, spec, version, onInspect }: { id: string; spec?: string; version?: number; onInspect: (spec?: string, version?: number) => void }) {
  'use no memo'; // TanStack Table 8 exposes a mutable table instance; keep its state reads out of compiler caches.
  const query = useProductSeries(id);
  const library = useProductLibrary();
  const job = useLibraryJob();
  const preferences = useState(readPreferences)[0];
  const [view, setView] = useState(preferences.view);
  const [sizes, setSizes] = useState(preferences.sizes);
  const [sorting, setSorting] = useState<SortingState>(preferences.sorting);
  const [search, setSearch] = useState('');
  const [navSearch, setNavSearch] = useState('');
  const [previewOpen, setPreviewOpen] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [kinds, setKinds] = useState<ResultKind[]>([...RESULT_KINDS]);
  const [force, setForce] = useState(false);
  const [reviewItems, setReviewItems] = useState<SpecRow[] | null>(null);
  const [action, setAction] = useState('submit');
  const [note, setNote] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState('');
  const [reviewError, setReviewError] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { localStorage.setItem('studio.product-table', JSON.stringify({ view, sizes, sorting })); }, [view, sizes, sorting]);
  const data = (query.data?.specs ?? []).filter(row => `${row.key} ${row.name}`.toLowerCase().includes(search.toLowerCase())
    && (filter === 'all' || (filter === 'problems' ? problems(row).length > 0 : filter === 'pending' ? pending(row).length > 0 : row.review === filter)));
  const selected = (query.data?.specs ?? []).filter(row => selection[row.id]);
  const compute = useMutation({ mutationFn: () => api.op<LibraryJob>('library.compute', { series: id, ...(selected.length ? { specs: selected.map(row => row.id) } : {}), kinds, force }),
    onSuccess: () => { setMessage('计算任务已建立，可继续查看其他规格。'); void queryClient.invalidateQueries({ queryKey: ['library'] }); }, onError: reportFailure });
  const review = useMutation({ mutationFn: () => api.op<{ moved: number }>('library.review.batch', { items: reviewItems!.map(row => ({ spec: row.id, version: row.version })), action, note }),
    onSuccess: result => { setMessage(`已更新 ${result.moved} 个规格的审核状态。`); setReviewItems(null); setSelection({}); setNote(''); void queryClient.invalidateQueries({ queryKey: ['library'] }); }, onError: error => setReviewError(error.message) });

  const columns: ColumnDef<SpecRow>[] = [
    { id: 'selection', size: 42, minSize: 42, enableSorting: false, enableResizing: false, header: ({ table }) => <Check label="选择当前筛选的全部规格" checked={table.getIsAllRowsSelected()} mixed={table.getIsSomeRowsSelected()} onChange={() => table.toggleAllRowsSelected()} />,
      cell: ({ row }) => <Check label={`选择 ${row.original.key}`} checked={row.getIsSelected()} onChange={() => row.toggleSelected()} /> },
    { id: 'key', accessorFn: row => row.area_mm2, header: '规格 mm²', size: 110, cell: ({ row }) => <button type="button" className="spec-key" onClick={event => { event.stopPropagation(); onInspect(row.id); }}>{row.original.key}</button> },
    { accessorKey: 'version', header: '版本', size: 70, cell: info => `第 ${info.getValue()} 版` },
    { accessorKey: 'outer_diameter_mm', header: '外径 mm', size: 95, cell: info => compact(info.getValue<number>(), 5) },
    { accessorKey: 'r20_ohm_km', header: 'R20 Ω/km', size: 115, cell: info => compact(info.getValue<number>(), 6) },
    { accessorKey: 'weight_kg_km', header: '重量 kg/km', size: 125, cell: info => compact(info.getValue<number>(), 6) },
    { accessorKey: 'ac_resistance_ohm_km', header: '交流电阻 Ω/km', size: 145, cell: info => compact(info.getValue<number>(), 6) },
    { accessorKey: 'short_circuit_ka', header: '1 s 短路 kA', size: 130, cell: info => fixed(info.getValue<number>(), 2) },
    { accessorKey: 'ampacity_a', header: '基准载流量 A', size: 140, cell: info => fixed(info.getValue<number>(), 1) },
    { id: 'check', header: '标准核对', size: 170, accessorFn: row => row.check?.failed ?? -1, cell: ({ row }) => row.original.check ? <span className="spec-check"><span className={row.original.check.failed ? 'text-error' : ''}>{row.original.check.failed ? `${row.original.check.failed} 项不通过` : `${row.original.check.passed ?? 0} 项通过`}</span><span className="text-ink-2">缺 {row.original.check.missing ?? 0}</span></span> : <span className="text-ink-2">未核对</span> },
    { id: 'readiness', header: '计算 / 问题', size: 160, enableSorting: false, cell: ({ row }) => { const errors = problems(row.original); const waiting = pending(row.original); return <span title={errors.join('；')} className={cn('inline-flex items-center gap-2', errors.length ? 'text-error' : 'text-ink-2')}><Icon className="size-3" name={errors.length ? 'action/close' : waiting.length ? 'action/history' : 'action/check'} />{errors.length ? `${errors.length} 项需处理` : waiting.length ? `待计算 ${waiting.length} 类` : '计算已完成'}</span>; } },
    { accessorKey: 'review', header: '审核状态', size: 100, cell: info => <span className="library-state" data-state={info.getValue<string>()}>{REVIEW_NAMES[info.getValue<string>()]}</span> },
  ];
  const shown: Record<string, string[]> = {
    overview: ['selection', 'key', 'version', 'outer_diameter_mm', 'ampacity_a', 'check', 'readiness', 'review'],
    structure: ['selection', 'key', 'version', 'outer_diameter_mm', 'r20_ohm_km', 'weight_kg_km', 'readiness', 'review'],
    values: ['selection', 'key', 'ac_resistance_ohm_km', 'short_circuit_ka', 'ampacity_a', 'readiness', 'review'],
    checks: ['selection', 'key', 'version', 'check', 'readiness', 'review'],
  };
  const table = useReactTable({ data, columns, state: { sorting, rowSelection: selection, columnSizing: sizes,
    columnVisibility: Object.fromEntries(columns.map(column => [column.id ?? ('accessorKey' in column ? column.accessorKey : ''), (shown[view] ?? shown.overview).includes(column.id ?? ('accessorKey' in column ? String(column.accessorKey) : ''))])) },
    onSortingChange: setSorting, onRowSelectionChange: setSelection, onColumnSizingChange: setSizes, getRowId: row => row.id,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), autoResetPageIndex: false,
    columnResizeMode: 'onChange', defaultColumn: { minSize: 65 } });
  const rows = table.getRowModel().rows;
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scroll.current, estimateSize: () => 44, overscan: 8 });
  const allowed: Record<string, string[]> = { submit: ['draft'], approve: ['submitted'], publish: ['reviewed'], return: ['submitted', 'reviewed'] };
  const labels: Record<string, string> = { submit: '提交审核', approve: '审核通过', publish: '发布', return: '退回修改' };
  const reviewProblems = reviewItems?.reduce((sum, row) => sum + problems(row).length + pending(row).length + (row.check?.missing ?? 0) + (row.check?.uncovered ?? 0), 0) ?? 0;
  const readyToReview = Boolean(reviewItems?.length && reviewItems.every(row => allowed[action].includes(row.review)) && note.trim() && (!reviewProblems || acknowledged));
  const current = query.data;
  const inspected = spec ?? (previewOpen ? current?.specs[0]?.id : undefined);
  const allSpecs = current?.specs ?? [];
  const numeric = (column: string) => ['outer_diameter_mm', 'r20_ohm_km', 'weight_kg_km', 'ac_resistance_ohm_km', 'short_circuit_ka', 'ampacity_a'].includes(column);
  const cellSize = (column: string, size: number) => ({ width: size, flexGrow: column === 'selection' ? 0 : size });

  return <div className="flex h-full min-w-0 flex-col"><LibraryHeader /><TaskProgress />
    <div className="series-body" data-inspecting={Boolean(spec)}>
      <aside aria-label="产品系列导航" className="library-sidebar">
        <div className="library-side-heading"><Link to="/library"><Icon name="action/arrow-left" />全部产品系列</Link><span className="text-13 font-normal text-ink-2">{library.data?.length ?? 0}</span></div>
        <SearchField label="查找系列" placeholder="查找型号或制造商" value={navSearch} onChange={setNavSearch} className="w-full" />
        {['factory', 'public', 'bundled'].map(origin => { const items = library.data?.filter(item => (origin === 'bundled' ? !['factory', 'public'].includes(item.origin) : item.origin === origin) && `${item.name} ${item.manufacturer}`.toLowerCase().includes(navSearch.toLowerCase())) ?? []; return items.length ? <div key={origin}><p className="library-side-group">{origin === 'factory' ? '本厂结构表' : origin === 'public' ? '公开厂家资料' : '结构演示'} · {items.length}</p>
          {items.map(item => <Link key={item.id} to="/library/$seriesId" params={{ seriesId: item.id }} search={{}} aria-current={item.id === id ? 'page' : undefined} className="library-side-link" title={item.name}><Icon name="nav/cable-type" /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate">{item.designation ? `${item.designation} · ${item.cores} 芯` : item.name}</span><span className="font-normal text-ink-2">{item.specs}</span></span><small className="truncate">{compact(item.u0_v / 1000)} / {compact(item.u_v == null ? null : item.u_v / 1000)} kV · {item.manufacturer || STATE_NAMES[item.origin]}</small></span></Link>)}
        </div> : null; })}
        <Link to="/library/import" className="library-side-link mt-auto border-t border-line"><Icon name="action/import" />导入结构表</Link>
      </aside>
      <main className="library-surface">
        <div className="library-page-head">
          <div className="min-w-0"><div className="series-heading"><Icon name="nav/cable-type" /><h1 className="break-words">{current ? `${current.series.designation} ${compact(current.series.u0_v / 1000)} / ${compact(current.series.u_v == null ? null : current.series.u_v / 1000)} kV · ${current.series.cores} 芯` : '读取系列…'}</h1></div><p>{current?.series.name}</p></div>
            <div className="flex flex-wrap gap-2"><Button variant="primary" icon="run/run" busy={compute.isPending} disabled={!current || !kinds.length || job.data?.state === 'running'} onClick={() => compute.mutate()}>{selected.length ? `计算选中 ${selected.length} 项` : '计算全系列'}</Button>
              <Button disabled={!selected.length} onClick={() => { setReviewItems([...selected]); setAcknowledged(false); setReviewError(''); }}>审核选中项</Button></div>
        </div>
        {current && <div className="series-summary"><span>{current.series.specs} 个规格</span><span className="library-origin">{STATE_NAMES[current.series.origin]}</span><button type="button" onClick={() => setFilter('pending')}>待计算 <strong>{allSpecs.filter(row => pending(row).length).length}</strong></button><button type="button" className={allSpecs.some(row => problems(row).length) ? 'text-error' : ''} onClick={() => setFilter('problems')}>需处理 <strong>{allSpecs.filter(row => problems(row).length).length}</strong></button><span className="text-ink-2">{current.declaration.standards.join(' · ') || '未声明执行标准'}</span></div>}
        <details className="series-options"><summary className="cursor-pointer"><span className="font-strong">计算选项与基准条件</span><span className="ml-4 text-ink-2">直埋 · 0.7 m · 25 °C · 1 K·m/W · 参考计算</span></summary><div className="mt-3 flex flex-wrap gap-x-5 gap-y-3">{RESULT_KINDS.map(kind => <label key={kind} className="flex items-center gap-2"><input type="checkbox" checked={kinds.includes(kind)} onChange={event => setKinds(event.target.checked ? [...kinds, kind] : kinds.filter(item => item !== kind))} />{RESULT_NAMES[kind]}</label>)}<label className="flex items-center gap-2"><input type="checkbox" checked={force} onChange={event => setForce(event.target.checked)} />重算已有结果</label></div><p>载流量基准：中心埋深 0.7 m，环境 25 °C，土壤热阻率 1 K·m/W。详细表含六种土壤条件；三芯排管采用三回水平模板。</p></details>
        {message && <p role="status" className="m-0 px-6 py-2 text-13">{message}</p>}
        {reviewItems && <form aria-label="确认批量审核" className="grid gap-3 border-b border-line bg-fill p-4" onSubmit={event => { event.preventDefault(); review.mutate(); }}>
          <strong className="text-14">确认 {reviewItems.length} 个指定版本的审核操作</strong>
          <p className="m-0 text-13">{reviewItems.map(row => `${row.key} 第${row.version}版`).join('、')}</p>
          <div className="flex flex-wrap items-center gap-3"><select aria-label="审核操作" className="studio-input" value={action} onChange={event => setAction(event.target.value)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
            <input aria-label="审核意见" className="studio-input min-w-0 flex-1" placeholder="填写审核意见" maxLength={400} required value={note} onChange={event => setNote(event.target.value)} /></div>
          {!reviewItems.every(row => allowed[action].includes(row.review)) && <p className="m-0 text-13 text-error">选中项的状态不支持此步骤，请选择相同审核阶段的规格。</p>}
          {reviewProblems > 0 && <label className="flex items-start gap-2 text-13 text-attention"><input type="checkbox" className="mt-1" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />我已查看这些版本的 {reviewProblems} 项计算缺项、核对问题或告警，确认本次审核意见；审核不表示所有标准项均通过。</label>}
          {reviewError && <p role="alert" className="m-0 text-13 text-error">{reviewError}</p>}
          <div className="flex gap-2"><Button type="submit" variant="primary" busy={review.isPending} disabled={!readyToReview}>确认{labels[action]}</Button><Button onClick={() => setReviewItems(null)}>取消</Button></div>
        </form>}
        <div className="library-toolbar">
          <SearchField label="搜索规格" placeholder="截面或规格名称" value={search} onChange={setSearch} className="w-full sm:w-52" />
          <select aria-label="规格筛选" className="studio-input" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部规格</option><option value="pending">待计算</option><option value="problems">有问题 / 告警</option>{Object.entries(REVIEW_NAMES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>
          <span className="text-13">显示 {data.length} 项 · 已选 {selected.length} 项</span>{selected.length > 0 && <Button size="compact" variant="ghost" onClick={() => setSelection({})}>清除选择</Button>}
        </div>
        <div aria-label="规格表视图" className="library-view-tabs">{Object.entries({ overview: '概览', structure: '结构参数', values: '计算结果', checks: '核对与审核' }).map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}</div>
        {query.error ? <div role="alert" className="p-5 text-14"><p>{query.error.message}</p><Button onClick={() => void query.refetch()}>重新读取</Button></div> : query.isPending ? <p role="status" className="p-5 text-14">正在读取规格…</p> : <>
          <div ref={scroll} data-scroll-table className="min-h-48 min-w-0 flex-1 overflow-auto">
            <table role="table" aria-label="产品规格表" className="spec-table" aria-rowcount={rows.length + 1} style={{ width: table.getTotalSize() }}>
              <thead role="rowgroup" className="sticky top-0 z-10 grid bg-fill">{table.getHeaderGroups().map(group => <tr role="row" aria-rowindex={1} key={group.id} className="border-b border-line">{group.headers.map(header => <th role="columnheader" key={header.id} scope="col" data-numeric={numeric(header.column.id)} aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : 'none'} style={cellSize(header.column.id, header.getSize())}>
                {header.column.getCanSort() ? <button type="button" className="flex items-center gap-1 whitespace-nowrap" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() && <Icon className="size-3" name={header.column.getIsSorted() === 'asc' ? 'action/arrow-up' : 'action/arrow-down'} />}</button> : flexRender(header.column.columnDef.header, header.getContext())}
                {header.column.getCanResize() && <div role="separator" aria-label={`调整${String(header.column.columnDef.header)}列宽`} aria-orientation="vertical" onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()} className="absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none hover:bg-copper" />}
              </th>)}</tr>)}</thead>
              <tbody role="rowgroup" className="relative grid" style={{ height: virtual.getTotalSize() }}>{virtual.getVirtualItems().map(item => { const row = rows[item.index]; return <tr role="row" aria-rowindex={item.index + 2} key={row.id} tabIndex={0} aria-selected={row.id === inspected} onClick={() => onInspect(row.id)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onInspect(row.id); } }} className="absolute cursor-default focus-visible:z-10" style={{ transform: `translateY(${item.start}px)` }}>
                {row.getVisibleCells().map(cell => <td role="cell" key={cell.id} data-numeric={numeric(cell.column.id)} className="truncate" style={cellSize(cell.column.id, cell.column.getSize())}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
              </tr>; })}</tbody>
            </table>
            {!rows.length && <p className="p-5 text-14">没有匹配的规格，请调整搜索或筛选。</p>}
          </div>
          <div className="library-footnote"><span>{data.length} 个规格 · 已选 {selected.length} 项</span><span>点击行查看结构、依据与规格书 · 表头可排序与调宽</span></div>
        </>}
      </main>
      {inspected && <aside aria-label="规格详情" className="spec-inspector" data-preview={!spec}>
        <SpecInspector key={inspected} spec={inspected} version={version} onVersion={next => onInspect(inspected, next)} onClose={() => { setPreviewOpen(false); onInspect(); }} />
      </aside>}
    </div>
  </div>;
}
