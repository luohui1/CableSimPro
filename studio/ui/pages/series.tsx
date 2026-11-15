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
    { id: 'key', accessorFn: row => row.area_mm2, header: '规格 mm²', size: 110, cell: ({ row }) => <button type="button" className="font-strong text-copper" onClick={event => { event.stopPropagation(); onInspect(row.id); }}>{row.original.key}</button> },
    { accessorKey: 'version', header: '版本', size: 70, cell: info => `第 ${info.getValue()} 版` },
    { accessorKey: 'outer_diameter_mm', header: '外径 mm', size: 95, cell: info => compact(info.getValue<number>(), 5) },
    { accessorKey: 'r20_ohm_km', header: 'R20 Ω/km', size: 115, cell: info => compact(info.getValue<number>(), 6) },
    { accessorKey: 'weight_kg_km', header: '重量 kg/km', size: 125, cell: info => compact(info.getValue<number>(), 6) },
    { accessorKey: 'ac_resistance_ohm_km', header: '交流电阻 Ω/km', size: 145, cell: info => compact(info.getValue<number>(), 6) },
    { accessorKey: 'short_circuit_ka', header: '1 s 短路 kA', size: 130, cell: info => fixed(info.getValue<number>(), 2) },
    { accessorKey: 'ampacity_a', header: '基准载流量 A', size: 140, cell: info => fixed(info.getValue<number>(), 1) },
    { id: 'check', header: '标准核对', size: 145, accessorFn: row => row.check?.failed ?? -1, cell: ({ row }) => row.original.check ? <span className={row.original.check.failed ? 'text-error' : ''}>{row.original.check.failed ? `${row.original.check.failed} 项不通过` : `${row.original.check.passed ?? 0} 项通过`}<span className="ml-2 text-ink-2">缺 {row.original.check.missing ?? 0}</span></span> : '未核对' },
    { id: 'readiness', header: '计算 / 问题', size: 180, enableSorting: false, cell: ({ row }) => { const errors = problems(row.original); const waiting = pending(row.original); return <span title={errors.join('；')} className={errors.length ? 'text-error' : waiting.length ? 'text-ink-2' : ''}>{errors.length ? `${errors.length} 项需处理` : waiting.length ? `待计算 ${waiting.length} 类` : '计算已完成'}</span>; } },
    { accessorKey: 'review', header: '审核状态', size: 100, cell: info => REVIEW_NAMES[info.getValue<string>()] },
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

  return <div className="flex h-full min-w-0 flex-col"><LibraryHeader /><TaskProgress />
    <div className="flex min-h-0 flex-1">
      <aside aria-label="产品系列导航" className="hidden w-56 shrink-0 overflow-y-auto border-r border-line bg-fill p-3 xl:block">
        <Link to="/library" className="mb-4 block px-2 py-2 text-14 text-ink no-underline">全部产品系列</Link>
        {library.data?.map(item => <Link key={item.id} to="/library/$seriesId" params={{ seriesId: item.id }} search={{}}
          className={cn('mb-1 block rounded-field px-2 py-3 text-13 no-underline hover:bg-hover', item.id === id ? 'bg-panel font-strong text-copper' : 'text-ink')}><span className="block">{item.name}</span><span className="mt-1 block font-normal text-ink-2">{item.specs} 个规格 · {STATE_NAMES[item.origin]}</span></Link>)}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="grid gap-3 border-b border-line px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><Link to="/library" className="text-13 text-ink-2">产品库</Link><h1 className="m-0 mt-1 break-words text-20 font-strong">{current?.series.name ?? '读取系列…'}</h1></div>
            <div className="flex flex-wrap gap-2"><Button variant="primary" icon="run/run" busy={compute.isPending} disabled={!current || !kinds.length || job.data?.state === 'running'} onClick={() => compute.mutate()}>{selected.length ? `计算选中 ${selected.length} 项` : '计算全系列'}</Button>
              <Button disabled={!selected.length} onClick={() => { setReviewItems([...selected]); setAcknowledged(false); setReviewError(''); }}>审核选中项</Button></div></div>
          {current && <p className="m-0 text-13 text-ink-2">{current.series.specs} 个规格 · {STATE_NAMES[current.series.origin]} · {current.declaration.standards.join('、') || '未声明执行标准'}</p>}
          <details className="text-13"><summary className="w-fit cursor-pointer">计算选项与基准条件</summary><div className="mt-3 flex flex-wrap gap-x-5 gap-y-3">{RESULT_KINDS.map(kind => <label key={kind} className="flex items-center gap-2"><input type="checkbox" checked={kinds.includes(kind)} onChange={event => setKinds(event.target.checked ? [...kinds, kind] : kinds.filter(item => item !== kind))} />{RESULT_NAMES[kind]}</label>)}<label className="flex items-center gap-2"><input type="checkbox" checked={force} onChange={event => setForce(event.target.checked)} />重算已有结果</label></div><p>载流量基准：中心埋深 0.7 m，环境 25 °C，土壤热阻率 1 K·m/W。详细表含六种土壤条件；三芯排管采用三回水平模板。</p></details>
          {message && <p role="status" className="m-0 text-13">{message}</p>}
        </div>
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
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <SearchField label="搜索规格" placeholder="截面或规格名称" value={search} onChange={setSearch} className="w-full sm:w-52" />
          <select aria-label="规格筛选" className="studio-input" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部规格</option><option value="pending">待计算</option><option value="problems">有问题 / 告警</option>{Object.entries(REVIEW_NAMES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>
          <span className="text-13">显示 {data.length} 项 · 已选 {selected.length} 项</span>{selected.length > 0 && <Button size="compact" variant="ghost" onClick={() => setSelection({})}>清除选择</Button>}
        </div>
        <div aria-label="规格表视图" className="flex flex-wrap gap-x-5 border-b border-line px-4 text-14">{Object.entries({ overview: '概览', structure: '结构参数', values: '计算结果', checks: '核对与审核' }).map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} className={cn('border-b-2 py-3', view === key ? 'border-copper font-strong text-copper' : 'border-transparent')} onClick={() => setView(key)}>{label}</button>)}</div>
        {query.error ? <div role="alert" className="p-5 text-14"><p>{query.error.message}</p><Button onClick={() => void query.refetch()}>重新读取</Button></div> : query.isPending ? <p role="status" className="p-5 text-14">正在读取规格…</p> : <>
          <div ref={scroll} data-scroll-table className="min-h-48 min-w-0 flex-1 overflow-auto">
            <table aria-label="产品规格表" className="grid border-collapse text-13" style={{ width: table.getTotalSize(), minWidth: '100%' }}>
              <thead className="sticky top-0 z-10 grid bg-fill">{table.getHeaderGroups().map(group => <tr key={group.id} className="flex border-b border-line">{group.headers.map(header => <th key={header.id} scope="col" aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : 'none'} className="relative flex shrink-0 items-center px-3 py-3 text-left font-strong" style={{ width: header.getSize() }}>
                {header.column.getCanSort() ? <button type="button" className="flex items-center gap-1 whitespace-nowrap" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() && <Icon className="size-3" name={header.column.getIsSorted() === 'asc' ? 'action/arrow-up' : 'action/arrow-down'} />}</button> : flexRender(header.column.columnDef.header, header.getContext())}
                {header.column.getCanResize() && <div role="separator" aria-label={`调整${String(header.column.columnDef.header)}列宽`} aria-orientation="vertical" onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()} className="absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none hover:bg-copper" />}
              </th>)}</tr>)}</thead>
              <tbody className="relative grid" style={{ height: virtual.getTotalSize() }}>{virtual.getVirtualItems().map(item => { const row = rows[item.index]; return <tr key={row.id} tabIndex={0} aria-selected={row.id === spec} onClick={() => onInspect(row.id)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onInspect(row.id); } }} className={cn('absolute flex h-11 cursor-default border-b border-line hover:bg-hover focus-visible:z-10', row.id === spec ? 'bg-fill' : 'bg-panel')} style={{ transform: `translateY(${item.start}px)` }}>
                {row.getVisibleCells().map(cell => <td key={cell.id} className={cn('shrink-0 truncate px-3 py-3', ['outer_diameter_mm', 'r20_ohm_km', 'weight_kg_km', 'ac_resistance_ohm_km', 'short_circuit_ka', 'ampacity_a'].includes(cell.column.id) && 'text-right')} style={{ width: cell.column.getSize() }}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
              </tr>; })}</tbody>
            </table>
            {!rows.length && <p className="p-5 text-14">没有匹配的规格，请调整搜索或筛选。</p>}
          </div>
          <p className="m-0 border-t border-line px-4 py-2 text-13 text-ink-2">点击规格查看依据与文件；拖动表头分隔线调整列宽。空值表示尚无结果，详细原因见规格详情。</p>
        </>}
      </main>
      {spec && <aside aria-label="规格详情" className="fixed inset-x-0 bottom-0 top-12 z-20 flex min-h-0 min-w-0 flex-col border-l border-line bg-panel lg:static lg:z-auto lg:w-[440px] lg:shrink-0 2xl:w-[520px]">
        <SpecInspector key={spec} spec={spec} version={version} onVersion={next => onInspect(spec, next)} onClose={() => onInspect()} />
      </aside>}
    </div>
  </div>;
}
