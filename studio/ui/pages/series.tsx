import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Alert, Badge, NavLink, Stepper } from '@mantine/core';
import { compact, REVIEW_NAMES, STATE_NAMES } from '@shared/format';
import { pending, problems, RESULT_NAMES } from '@shared/products';
import { RESULT_KINDS, type LibraryJob, type ResultKind, type SpecRow } from '@shared/types';
import { Button, Checkbox, Input, ProductIcon as Icon, ReviewDialog, SearchField, SelectField, TabPanel, Tabs } from '@/components/product-controls';
import { GRID_VIEWS, ProductGrid, type GridPreferences } from '@/components/product-grid';
import { LibraryHeader } from '@/components/library-header';
import { reportFailure } from '@/components/notice';
import { SpecInspector } from '@/components/spec-inspector';
import { OriginBadge } from '@/components/product-status';
import { api } from '@/state/api';
import { queryClient, useLibraryJob, useProductLibrary, useProductSeries } from '@/state/queries';

function readPreferences(): GridPreferences {
  try { return JSON.parse(localStorage.getItem('studio.product-table') ?? 'null') ?? { view: 'overview', sizes: {}, sorting: [] }; }
  catch { return { view: 'overview', sizes: {}, sorting: [] }; }
}

function TaskProgress() {
  const query = useLibraryJob();
  const job = query.data;
  const stop = useMutation({ mutationFn: () => api.op('library.compute.cancel', { job: job!.id }), onError: reportFailure,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['library'] }) });
  if (!job) return null;
  if (job.state === 'done' || job.state === 'cancelled') return <details className="library-job-result"><summary>最近批次：{job.state === 'done' ? '处理结束' : '已停止'} · {job.done} / {job.total} 项</summary><Link to="/library/$seriesId" params={{ seriesId: job.series_id }} search={{}}>查看任务系列</Link></details>;
  return <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-fill px-4 py-2 text-13">
    <span className={job.state === 'failed' ? 'text-error' : ''}>{job.title}</span><span>{job.done} / {job.total} 项</span>
    <progress aria-label="批量计算进度" value={job.done} max={Math.max(1, job.total)} className="h-1 w-36" />
    {job.error && <span>{job.error.message}</span>}
    {job.state === 'running' && <Button size="compact" busy={stop.isPending} disabled={job.cancel_requested} onClick={() => stop.mutate()}>{job.cancel_requested ? '本批次结束后停止' : '停止计算'}</Button>}
    <Link to="/library/$seriesId" params={{ seriesId: job.series_id }} search={{}} className="text-ink">查看任务系列</Link>
  </div>;
}

export function SeriesWorkspace({ id, spec, version, onInspect }: { id: string; spec?: string; version?: number; onInspect: (spec?: string, version?: number) => void }) {
  const query = useProductSeries(id);
  const library = useProductLibrary();
  const job = useLibraryJob();
  const [preferences, setPreferences] = useState(readPreferences);
  const [view, setView] = useState(preferences.view);
  const [search, setSearch] = useState('');
  const [navSearch, setNavSearch] = useState('');
  const [previewOpen, setPreviewOpen] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selection, setSelection] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [kinds, setKinds] = useState<ResultKind[]>([...RESULT_KINDS]);
  const [force, setForce] = useState(false);
  const [reviewItems, setReviewItems] = useState<SpecRow[] | null>(null);
  const [action, setAction] = useState('submit');
  const [note, setNote] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [focus, setFocus] = useState<{ tab: string; token: number }>();
  const inspect = (specId: string, tab = 'structure') => { setFocus({ tab, token: Date.now() }); onInspect(specId); };
  useEffect(() => { localStorage.setItem('studio.product-table', JSON.stringify({ ...preferences, view })); }, [view, preferences]);
  const selected = (query.data?.specs ?? []).filter(row => selection.includes(row.id));
  const compute = useMutation({ mutationFn: () => api.op<LibraryJob>('library.compute', { series: id, ...(selected.length ? { specs: selected.map(row => row.id) } : {}), kinds, force }),
    onSuccess: () => { setMessage('计算任务已建立，可继续查看其他规格。'); void queryClient.invalidateQueries({ queryKey: ['library'] }); }, onError: reportFailure });
  const review = useMutation({ mutationFn: () => api.op<{ moved: number }>('library.review.batch', { items: reviewItems!.map(row => ({ spec: row.id, version: row.version })), action, note }),
    onSuccess: result => { setMessage(`已更新 ${result.moved} 个规格的审核状态。`); setReviewItems(null); setSelection([]); setNote(''); void queryClient.invalidateQueries({ queryKey: ['library'] }); }, onError: error => setReviewError(error.message) });

  const allowed: Record<string, string[]> = { submit: ['draft'], approve: ['submitted'], publish: ['reviewed'], return: ['submitted', 'reviewed'] };
  const labels: Record<string, string> = { submit: '提交审核', approve: '审核通过', publish: '发布', return: '退回修改' };
  const reviewProblems = reviewItems?.reduce((sum, row) => sum + problems(row).length + pending(row).length + (row.check?.missing ?? 0) + (row.check?.uncovered ?? 0), 0) ?? 0;
  const readyToReview = Boolean(reviewItems?.length && reviewItems.every(row => allowed[action].includes(row.review)) && note.trim() && (!reviewProblems || acknowledged));
  const current = query.data;
  const inspected = spec ?? (previewOpen ? current?.specs[0]?.id : undefined);
  const allSpecs = current?.specs ?? [];
  const waiting = allSpecs.filter(row => pending(row).length).length;
  const failed = allSpecs.filter(row => (row.check?.failed ?? 0) > 0).length;
  const missing = allSpecs.filter(row => (row.check?.missing ?? 0) > 0).length;
  const reviewed = allSpecs.filter(row => ['reviewed', 'published'].includes(row.review)).length;
  const errors = allSpecs.filter(row => Object.values(row.computed).includes('error')).length;

  return <div className="product-ui flex h-full min-w-0 flex-col"><LibraryHeader /><TaskProgress />
    <div className="series-body" data-inspecting={Boolean(spec)}>
      <aside aria-label="产品系列导航" className="library-sidebar">
        <div className="library-side-heading"><Link to="/library"><Icon name="action/arrow-left" />全部产品系列</Link><span className="text-13 font-normal text-ink-2">{library.data?.length ?? 0}</span></div>
        <SearchField label="查找系列" placeholder="查找型号或制造商" value={navSearch} onChange={setNavSearch} className="w-full" />
        {['factory', 'public', 'bundled'].map(origin => { const items = library.data?.filter(item => (origin === 'bundled' ? !['factory', 'public'].includes(item.origin) : item.origin === origin) && `${item.name} ${item.manufacturer}`.toLowerCase().includes(navSearch.toLowerCase())) ?? []; return items.length ? <div key={origin}><p className="library-side-group">{origin === 'factory' ? '本厂结构表' : origin === 'public' ? '公开厂家资料' : '结构演示'} · {items.length}</p>
          {items.map(item => <NavLink key={item.id} renderRoot={props => <Link {...props} to="/library/$seriesId" params={{ seriesId: item.id }} search={{}} />} active={item.id === id} title={item.name} leftSection={<Icon name="nav/cable-type" />} label={item.designation ? `${item.designation} · ${item.cores} 芯` : item.name} description={`${compact(item.u0_v / 1000)} / ${compact(item.u_v == null ? null : item.u_v / 1000)} kV · ${item.manufacturer || STATE_NAMES[item.origin]}`} rightSection={<Badge variant="light" size="sm" color={item.id === id ? 'blue' : 'gray'}>{item.specs}</Badge>} />)}
        </div> : null; })}
        <Link to="/library/import" className="library-side-link mt-auto border-t border-line"><Icon name="action/import" />导入结构表</Link>
      </aside>
      <main className="library-surface">
        <div className="library-page-head">
          <div className="min-w-0"><div className="series-heading"><Icon name="nav/cable-type" /><h1 className="break-words">{current ? `${current.series.designation} ${compact(current.series.u0_v / 1000)} / ${compact(current.series.u_v == null ? null : current.series.u_v / 1000)} kV · ${current.series.cores} 芯` : '读取系列…'}</h1></div><p>{current?.series.name}</p></div>
            <div className="flex flex-wrap gap-2"><Button variant="primary" icon="run/run" busy={compute.isPending} disabled={!current || !kinds.length || job.data?.state === 'running'} onClick={() => compute.mutate()}>{selected.length ? `计算选中 ${selected.length} 项` : '计算全系列'}</Button>
              <Button disabled={!selected.length} onClick={() => { setReviewItems([...selected]); setAcknowledged(false); setReviewError(''); }}>审核选中项</Button></div>
        </div>
        {current && <><div className="series-summary"><Badge variant="light" color="gray">{current.series.specs} 个规格</Badge><OriginBadge origin={current.series.origin} /><span className="text-ink-2">{current.declaration.standards.join(' · ') || '未声明执行标准'}</span></div>
          <Stepper className="workflow-rail" size="xs" active={waiting ? 1 : reviewed < allSpecs.length ? 2 : 3} onStepClick={step => {
            if (step === 0) { setFilter('all'); setView('structure'); }
            else if (step === 1) { setFilter(waiting ? 'pending' : 'all'); setView('values'); }
            else if (step === 2) { setFilter('submitted'); setView('checks'); }
            else if (allSpecs.length) inspect(inspected ?? allSpecs[0].id, 'documents');
          }}>
            <Stepper.Step label="确认结构" description={`${allSpecs.length} 个规格已入库`} icon={<Icon name="object/section" />} />
            <Stepper.Step label="计算核对" description={waiting ? `${waiting} 个待计算` : errors ? `${errors} 个有拒算项` : '计算已完成'} icon={<Icon name="run/run" />} />
            <Stepper.Step label="人工审核" description={`${reviewed} / ${allSpecs.length} 已审核`} icon={<Icon name="action/check" />} />
            <Stepper.Step label="交付文件" description="预览与下载 PDF" icon={<Icon name="document" />} />
          </Stepper>
          <div className="series-task-hint"><span>{selected.length ? `已选 ${selected.length} 个规格，计算与审核作用于选中项。` : '勾选规格批量处理，点击规格查看结构。'}</span>
            {failed > 0 && <button type="button" className="text-error" onClick={() => { setFilter('failed'); setView('checks'); }}>不通过 {failed} 个 →</button>}
            {missing > 0 && <button type="button" onClick={() => { setFilter('missing'); setView('checks'); }}>需补实测 {missing} 个 →</button>}
            {errors > 0 && <button type="button" className="text-error" onClick={() => { setFilter('problems'); setView('values'); }}>查看拒算与告警 →</button>}
          </div></>}
        <details className="series-options"><summary><span className="font-strong">计算选项与基准条件</span><span className="series-condition">直埋 · 0.7 m · 25 °C · 1 K·m/W</span></summary><div className="mt-3 flex flex-wrap gap-x-5 gap-y-3">{RESULT_KINDS.map(kind => <Checkbox key={kind} checked={kinds.includes(kind)} onChange={checked => setKinds(checked ? [...kinds, kind] : kinds.filter(item => item !== kind))}>{RESULT_NAMES[kind]}</Checkbox>)}<Checkbox checked={force} onChange={setForce}>重算已有结果</Checkbox></div><p>载流量为参考计算，详细表含六种土壤条件；三芯排管采用三回水平模板。</p></details>
        {message && <p role="status" className="m-0 px-6 py-2 text-13">{message}</p>}
        <ReviewDialog open={Boolean(reviewItems)} onClose={() => setReviewItems(null)}>{reviewItems && <form aria-label="确认批量审核" className="grid gap-4" onSubmit={event => { event.preventDefault(); review.mutate(); }}>
          <strong className="text-14">确认 {reviewItems.length} 个指定版本的审核操作</strong>
          <p className="m-0 text-13">{reviewItems.map(row => `${row.key} 第${row.version}版`).join('、')}</p>
          <div className="grid gap-3"><SelectField aria-label="审核操作" value={action} onValueChange={setAction}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</SelectField>
            <Input aria-label="审核意见" placeholder="填写审核意见" maxLength={400} required value={note} onChange={event => setNote(event.target.value)} /></div>
          {!reviewItems.every(row => allowed[action].includes(row.review)) && <p className="m-0 text-13 text-error">选中项的状态不支持此步骤，请选择相同审核阶段的规格。</p>}
          {reviewProblems > 0 && <Checkbox className="text-13 text-attention" checked={acknowledged} onChange={setAcknowledged}>我已查看这些版本的 {reviewProblems} 项计算缺项、核对问题或告警，确认本次审核意见；审核不表示所有标准项均通过。</Checkbox>}
          {reviewError && <p role="alert" className="m-0 text-13 text-error">{reviewError}</p>}
          <div className="flex gap-2"><Button type="submit" variant="primary" busy={review.isPending} disabled={!readyToReview}>确认{labels[action]}</Button><Button onClick={() => setReviewItems(null)}>取消</Button></div>
        </form>}</ReviewDialog>
        <div className="library-toolbar">
          <SearchField label="搜索规格" placeholder="截面或规格名称" value={search} onChange={setSearch} className="w-full sm:w-52" />
          <SelectField aria-label="规格筛选" value={filter} onValueChange={setFilter}><option value="all">全部规格</option><option value="pending">待计算</option><option value="problems">有问题 / 告警</option><option value="failed">标准项不通过</option><option value="missing">缺输入 / 需实测</option>{Object.entries(REVIEW_NAMES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</SelectField>
          <span className="text-13 text-ink-2">显示 {visibleCount} 项 · 已选 {selected.length} 项</span>{selected.length > 0 && <Button size="compact" variant="ghost" onClick={() => setSelection([])}>清除选择</Button>}
        </div>
        <Tabs value={view} onChange={setView} label="规格表视图" className="min-h-0 flex-1 flex-col" items={Object.entries(GRID_VIEWS).map(([value, label]) => ({ value, label }))}><TabPanel value={view}>
        {query.error ? <div role="alert" className="p-5 text-14"><p>{query.error.message}</p><Button onClick={() => void query.refetch()}>重新读取</Button></div> : query.isPending ? <p role="status" className="p-5 text-14">正在读取规格…</p> : <>
          <ProductGrid rows={allSpecs} search={search} filter={filter} view={view} inspected={inspected} preferences={preferences} selected={selection} onSelection={setSelection} onInspect={inspect} onPreferences={values => setPreferences(current => ({ ...current, ...values }))} onCount={setVisibleCount} />
          <div className="library-footnote"><span>{visibleCount} 个规格 · 已选 {selected.length} 项</span><span>点击行查看结构、依据与规格书 · 表头可排序与调宽</span></div>
        </>}
        </TabPanel></Tabs>
      </main>
      {inspected && <aside aria-label="规格详情" className="spec-inspector" data-preview={!spec}>
        <SpecInspector key={inspected} spec={inspected} version={version} focus={focus} onVersion={next => onInspect(inspected, next)} onClose={() => { setPreviewOpen(false); onInspect(); }} />
      </aside>}
    </div>
  </div>;
}
