// The workspace of one size of a type: one header (the name, the version shown with where it stands in review) and four pages
// under it: the structure with the standard check, the parameters, the ampacity table, the versions with their files. Every
// number is read from the saved version; nothing here calculates. The page says what the next step is: change the structure,
// make the sheet, work out a table of one's own; review is taken on the last page, and only by a person.
import { useMutation } from '@tanstack/react-query';
import { getRouteApi, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { RESULT_KINDS, type LibraryJob, type SpecificationReport } from '@shared/types';
import { reportFailure } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Icon } from '@/kit/icon';
import { ReviewMark } from '@/kit/marks';
import { PageHeader, PageTabs, Toolbar } from '@/kit/workbench/page';
import { EmptyState } from '@/kit/workbench/premise';
import { VersionSelect } from '@/kit/workbench/review';
import { api } from '@/state/api';
import { prefetchSpec, queryClient, useActiveSpec, useLibraryJob, useProductSeries } from '@/state/queries';
import { ReviewDialog, ReviseDialog, SheetDialog } from './dialogs';
import { TypeFrame } from './frame';
import { ORIGIN_NAMES, originOf, rememberOpened, SERIES_PAGES, type ReviewAction, type SeriesPage } from './model';
import { ParamsPage } from './params-page';
import { RatingPage } from './rating-page';
import { StructurePage } from './structure-page';
import { VersionsPage } from './versions-page';

const route = getRouteApi('/library/$seriesId');

const PAGE_NAMES: Record<SeriesPage, string> = { structure: '结构与核对', params: '参数', rating: '载流量表', versions: '版本与文件' };

export function SeriesScreen() {
  const { seriesId } = route.useParams();
  return <SeriesBody key={seriesId} seriesId={seriesId} />;
}

function SeriesBody({ seriesId }: { seriesId: string }) {
  const { spec, version, page: asked } = route.useSearch();
  const page: SeriesPage = asked ?? 'structure';
  const navigate = useNavigate();
  const router = useRouter();
  const series = useProductSeries(seriesId);
  const job = useLibraryJob();
  const rows = useMemo(() => series.data?.specs ?? [], [series.data]);
  const activeId = spec && rows.some(row => row.id === spec) ? spec : rows[0]?.id;
  const query = useActiveSpec(activeId, spec === activeId ? version : undefined);
  const view = query.data;
  const index = rows.findIndex(row => row.id === activeId);
  const latest = view ? view.version.number === view.versions[0].number : true;

  const [dialog, setDialog] = useState<'revise' | null>(null);
  const [sheet, setSheet] = useState<{ open: boolean; report: SpecificationReport | null }>({ open: false, report: null });
  const [review, setReview] = useState<ReviewAction | null>(null);
  /** The calculation this page started; any other that is running or failed is shown in a bar of its own. */
  const [mine, setMine] = useState<string | null>(null);

  // The neighbours are read ahead, so stepping through the sizes does not wait; the one in view is the one the library marks.
  useEffect(() => { for (const row of [rows[index - 1], rows[index + 1]]) if (row) prefetchSpec(row.id); }, [rows, index]);
  useEffect(() => { if (activeId) rememberOpened(activeId); }, [activeId]);

  const compute = useMutation({
    mutationFn: () => api.op<LibraryJob>('library.compute', { series: seriesId, specs: [view!.spec.id], kinds: [...RESULT_KINDS], force: false }),
    onSuccess: started => { setMine(started.id); void queryClient.invalidateQueries({ queryKey: ['library'] }); }, onError: reportFailure,
  });
  const stop = useMutation({
    mutationFn: () => api.op('library.compute.cancel', { job: job.data!.id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['library'] }), onError: reportFailure,
  });
  const running = compute.isPending || job.data?.state === 'running';
  // While the next size loads, the one before stays on screen; nothing may be done to it in the new one's name.
  const settled = Boolean(view) && !query.isPlaceholderData;
  const others = job.data?.state === 'running' && job.data.id !== mine;
  const failed = job.data?.state === 'failed' && job.data.series_id === seriesId;

  /** The address of a size, a version and a page: what a link should reopen. Nothing is written for what is the default. */
  const go = (target: { spec?: string; version?: number; page?: SeriesPage }) => void navigate({ to: '/library/$seriesId', params: { seriesId },
    search: { ...(target.spec ? { spec: target.spec } : {}), ...(target.version ? { version: target.version } : {}), ...(target.page && target.page !== 'structure' ? { page: target.page } : {}) } });
  const openSpec = (id: string | undefined, number?: number) => go({ spec: id, version: number, page });
  const step = (offset: number) => { const next = rows[index + offset]; if (next) openSpec(next.id); };
  const toLibrary = () => void navigate({ to: '/library' });
  const toWorkbench = () => { if (view) router.history.push(`/workbench?model=${encodeURIComponent(view.spec.id)}`); };
  const onCompute = latest ? () => compute.mutate() : null;
  const busy = running || !settled;

  if (series.error) {
    return <TypeFrame at={{ kind: 'series', id: seriesId }}>
      <EmptyState icon="status/error" title="读不到这个系列" description={series.error.message}
        action={<Button variant="outline" onClick={() => void series.refetch()}>重新读取</Button>} />
    </TypeFrame>;
  }
  if (series.data && rows.length === 0) {
    return <TypeFrame at={{ kind: 'series', id: seriesId }}>
      <PageHeader trail={[{ label: '电缆型号' }, { label: '型号库', onClick: toLibrary }]} title={series.data.series.name} />
      <EmptyState icon="nav/cable-type" title="这个系列还没有规格" description="规格是系列里的一个截面，导入结构表或手工新建后出现在这里。"
        action={<Button onClick={() => void navigate({ to: '/library/new', search: { series: seriesId } })}><Icon name="action/add" data-icon="inline-start" />新建规格</Button>} />
    </TypeFrame>;
  }
  if (query.isError && !view) {
    return <TypeFrame at={{ kind: 'series', id: seriesId }}>
      <PageHeader trail={[{ label: '电缆型号' }, { label: '型号库', onClick: toLibrary }]} title={series.data?.series.name ?? '型号'} />
      <EmptyState icon="status/error" title="读不到这个规格" description={query.error.message}
        action={<div className="flex gap-2">
          {version && <Button variant="outline" onClick={() => openSpec(activeId)}>回到最新版</Button>}
          <Button variant="outline" onClick={() => void query.refetch()}>重新读取</Button>
        </div>} />
    </TypeFrame>;
  }

  const computing = running ? (job.data?.state === 'running' ? `${others ? '另一批计算中' : '计算中'} ${job.data.done}/${job.data.total}` : '计算中') : '计算与核对';
  const sheetButton = (variant: 'outline' | 'default') => <Button variant={variant} disabled={!settled} onClick={() => setSheet({ open: true, report: null })}><Icon name="object/file" data-icon="inline-start" />规格书</Button>;
  // One copper button per page: the next step of that page.
  const header = {
    structure: {
      actions: <>
        {sheetButton('outline')}
        <Button variant="outline" disabled={!settled || running || !latest} onClick={() => compute.mutate()}>
          {running ? <Icon name="status/spinner" data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <Icon name="run/run" data-icon="inline-start" />}{computing}
        </Button>
      </>,
      primary: <Button disabled={!settled} onClick={() => setDialog('revise')}><Icon name="action/edit" data-icon="inline-start" />修改结构</Button>,
    },
    params: { actions: undefined, primary: sheetButton('default') },
    rating: { actions: undefined, primary: <Button disabled={!settled} onClick={toWorkbench}><Icon name="calc/ampacity" data-icon="inline-start" />新算一张</Button> },
    versions: { actions: undefined, primary: undefined },
  }[page];

  return <TypeFrame at={{ kind: 'series', id: seriesId }}>
    <PageHeader
      trail={[{ label: '电缆型号' }, { label: '型号库', onClick: toLibrary }, { label: view?.series.name ?? series.data?.series.name ?? '…' }]}
      title={view?.spec.name ?? '读取规格…'}
      marks={view ? <>
        <VersionSelect value={view.version.number} versions={view.versions.map(item => ({ number: item.number, review: item.review }))}
          onValueChange={number => { if (settled) openSpec(activeId, number === view.versions[0].number ? undefined : number); }} />
        <ReviewMark state={view.version.review} />
        <Badge variant="secondary">{ORIGIN_NAMES[originOf(view.series.origin)]}</Badge>
      </> : undefined}
      actions={header.actions} primary={header.primary} />
    <PageTabs value={page} items={SERIES_PAGES.map(value => ({ value, label: PAGE_NAMES[value], ...(value === 'versions' && view ? { count: view.versions.length } : {}) }))}
      onValueChange={next => go({ spec, version, page: next as SeriesPage })} />
    {(others || failed) && job.data && <Toolbar end={job.data.state === 'running'
      ? <Button variant="outline" size="sm" disabled={stop.isPending || job.data.cancel_requested} onClick={() => stop.mutate()}>{job.data.cancel_requested ? '本批结束后停止' : '停止'}</Button> : undefined}>
      {failed
        ? <><Icon name="status/error" className="text-error" /><span className="text-sm text-ink">上一批计算没有算完：{job.data.error?.message ?? '原因不明'}</span></>
        : <Progress value={job.data.done} max={job.data.total} className="w-96">
          <ProgressLabel>{job.data.title}</ProgressLabel>
          <ProgressValue>{() => `${job.data!.done} / ${job.data!.total} 个规格`}</ProgressValue>
        </Progress>}
    </Toolbar>}
    {view && !latest && page !== 'versions' && <Toolbar end={<Button variant="outline" size="sm" onClick={() => openSpec(activeId)}>回到最新版</Button>}>
      <Icon name="status/info" className="text-ink-2" />
      <span className="text-sm text-ink">正在查看第 {view.version.number} 版（历史）。计算、修改和审核请回到最新版。</span>
    </Toolbar>}
    {page === 'structure' && <StructurePage view={view} index={index} total={rows.length} previous={rows[index - 1]?.key} next={rows[index + 1]?.key} onStep={step} onCompute={onCompute} busy={busy} />}
    {page !== 'structure' && !view && <Skeleton className="m-6 h-64" />}
    {view && page === 'params' && <ParamsPage view={view} onCompute={onCompute} busy={busy} />}
    {view && page === 'rating' && <RatingPage view={view} onCompute={onCompute} busy={busy} />}
    {view && page === 'versions' && <VersionsPage view={view} latest={latest} frozen={!settled} onVersion={number => openSpec(activeId, number)} onReview={setReview}
      onRevise={() => setDialog('revise')} onPreview={report => setSheet({ open: true, report })} onSheet={() => setSheet({ open: true, report: null })} />}
    {view && <>
      <ReviseDialog view={view} latest={latest} open={dialog === 'revise'} onOpenChange={open => setDialog(open ? 'revise' : null)} onRevised={() => { setDialog(null); openSpec(activeId); }} />
      <ReviewDialog view={view} action={review} onClose={() => setReview(null)} />
      <SheetDialog view={view} open={sheet.open} report={sheet.report} onOpenChange={open => setSheet(current => ({ ...current, open }))} onReport={report => setSheet({ open: true, report })} />
    </>}
  </TypeFrame>;
}
