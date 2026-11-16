// The workspace of one size of a type: its section, its layers and the pages of its numbers. Every number is read from the
// saved version; nothing here calculates. The next step on this screen is to change the structure; calculating and checking,
// and the specification sheet, are quiet buttons, and review is taken on the last page by a person.
import { useMutation } from '@tanstack/react-query';
import { getRouteApi, useNavigate, useRouter } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { compact, fixed } from '@shared/format';
import { cableShape } from '@shared/geometry';
import { RESULT_KINDS, type LibraryJob, type SpecificationReport, type StructureValue } from '@shared/types';
import { reportFailure } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from '@/kit/icon';
import { ReviewMark } from '@/kit/marks';
import { CanvasFrame } from '@/kit/workbench/canvas';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { PageHeader, Panel, Split, Toolbar } from '@/kit/workbench/page';
import { EmptyState } from '@/kit/workbench/premise';
import { api } from '@/state/api';
import { prefetchSpec, queryClient, useActiveSpec, useLibraryJob, useProductSeries } from '@/state/queries';
import { ChecksTab } from './checks-tab';
import { ReviewDialog, ReviseDialog, SheetDialog } from './dialogs';
import { FilesTab } from './files-tab';
import { TypeFrame } from './frame';
import { ORIGIN_MARK, ORIGIN_NAMES, originOf, rememberOpened, roleOfField, type ReviewAction } from './model';
import { ParamsTab } from './params-tab';
import { RatingTab } from './rating-tab';
import { SectionFigure } from './section-figure';

const SolidView = lazy(() => import('./solid').then(module => ({ default: module.SolidView })));
const route = getRouteApi('/library/$seriesId');

/** Fields that belong to the finished cable rather than to a layer; the layers table leaves them out. */
const WHOLE = new Set(['area', 'outer_diameter', 'weight', 'r20']);

const LAYER_COLUMNS: Column<StructureValue>[] = [
  { key: 'label', header: '层', cell: row => row.label },
  { key: 'value', header: '厚度 / 直径', unit: 'mm', numeric: true, width: 'w-36', cell: row => <>{compact(row.value, 6)}{row.unit !== 'mm' && <span className="ml-1 text-ink-2">{row.unit}</span>}</> },
  { key: 'origin', header: '来源', width: 'w-20', cell: row => <span className="text-ink-2" title={row.basis}>{ORIGIN_MARK[row.revision ? 'revised' : row.origin]}</span> },
];

export function SeriesScreen() {
  const { seriesId } = route.useParams();
  return <SeriesBody key={seriesId} seriesId={seriesId} />;
}

function SeriesBody({ seriesId }: { seriesId: string }) {
  const { spec, version } = route.useSearch();
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

  const [mode, setMode] = useState<'section' | 'solid'>('section');
  const [picked, setPicked] = useState<{ version: string; key: string } | null>(null);
  const [dialog, setDialog] = useState<'revise' | null>(null);
  const [sheet, setSheet] = useState<{ open: boolean; report: SpecificationReport | null }>({ open: false, report: null });
  const [review, setReview] = useState<ReviewAction | null>(null);

  const drawing = useMemo(() => {
    if (!view) return { shape: null, error: '' };
    try { return { shape: cableShape(view.entry.payload.cable_type, view.entry.payload.materials), error: '' }; }
    catch (cause) { return { shape: null, error: cause instanceof Error ? cause.message : String(cause) }; }
  }, [view]);
  const layerKey = view && picked?.version === view.version.id ? picked.key : undefined;
  const role = layerKey ? roleOfField(layerKey) : null;
  const layers = view?.structure.filter(row => !WHOLE.has(row.key)) ?? [];

  // The neighbours are read ahead, so stepping through the sizes does not wait; the one in view is the one the library marks.
  useEffect(() => { for (const row of [rows[index - 1], rows[index + 1]]) if (row) prefetchSpec(row.id); }, [rows, index]);
  useEffect(() => { if (activeId) rememberOpened(activeId); }, [activeId]);

  const compute = useMutation({
    mutationFn: () => api.op<LibraryJob>('library.compute', { series: seriesId, specs: [view!.spec.id], kinds: [...RESULT_KINDS], force: false }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['library'] }), onError: reportFailure,
  });
  const running = compute.isPending || job.data?.state === 'running';

  const openSpec = (id: string | undefined, number?: number) => void navigate({ to: '/library/$seriesId', params: { seriesId }, search: { ...(id ? { spec: id } : {}), ...(number ? { version: number } : {}) } });
  const step = (offset: number) => { const next = rows[index + offset]; if (next) openSpec(next.id); };
  const toLibrary = () => void navigate({ to: '/library' });
  const toWorkbench = () => { if (view) router.history.push(`/workbench?model=${encodeURIComponent(view.spec.id)}`); };

  if (series.error) {
    return <TypeFrame at={{ kind: 'series', id: seriesId }}>
      <EmptyState icon="status/error" title="读不到这个系列" description={series.error.message}
        action={<Button variant="outline" onClick={() => void series.refetch()}>重新读取</Button>} />
    </TypeFrame>;
  }
  if (series.data && rows.length === 0) {
    return <TypeFrame at={{ kind: 'series', id: seriesId }}>
      <PageHeader trail={[{ label: '型号库', onClick: toLibrary }]} title={series.data.series.name} />
      <EmptyState icon="nav/cable-type" title="这个系列还没有规格" description="规格是系列里的一个截面，导入结构表或手工新建后出现在这里。"
        action={<Button onClick={() => void navigate({ to: '/library/new', search: { series: seriesId } })}><Icon name="action/add" data-icon="inline-start" />新建规格</Button>} />
    </TypeFrame>;
  }

  const weight = view?.structure.find(item => item.key === 'weight');
  const facts: [string, string][] = [];
  if (view) facts.push(['外径', `${fixed(view.entry.summary.outer_diameter_m * 1000, 1)} mm`]);
  if (weight) facts.push(['重量', `${compact(weight.value, 6)} kg/km`]);

  return <TypeFrame at={{ kind: 'series', id: seriesId }}>
    <PageHeader
      trail={[{ label: '型号库', onClick: toLibrary }, { label: view?.series.name ?? series.data?.series.name ?? '…', onClick: toLibrary }]}
      title={view?.spec.name ?? '读取规格…'}
      marks={view ? <>
        <Badge variant="outline">第 {view.version.number} 版</Badge>
        <ReviewMark state={view.version.review} />
        <Badge variant="secondary">{ORIGIN_NAMES[originOf(view.series.origin)]}</Badge>
      </> : undefined}
      actions={<>
        <Button variant="outline" disabled={!view} onClick={() => setSheet({ open: true, report: null })}><Icon name="object/file" data-icon="inline-start" />规格书</Button>
        <Button variant="outline" disabled={!view || running} onClick={() => compute.mutate()}>
          {running ? <Icon name="status/spinner" data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <Icon name="run/run" data-icon="inline-start" />}
          {running ? (job.data?.state === 'running' ? `计算中 ${job.data.done}/${job.data.total}` : '计算中') : '计算与核对'}
        </Button>
      </>}
      primary={<Button disabled={!view} onClick={() => setDialog('revise')}><Icon name="action/edit" data-icon="inline-start" />修改结构</Button>} />
    {view && !latest && <Toolbar end={<Button variant="outline" size="sm" onClick={() => openSpec(activeId)}>回到最新版</Button>}>
      <Icon name="status/info" className="text-ink-2" />
      <span className="text-sm text-ink">正在查看第 {view.version.number} 版（历史）。修改和审核请回到最新版。</span>
    </Toolbar>}
    <Split panes={[
      { id: 'section', size: 34, min: 24, children: <Panel title="结构断面" bodyClassName="flex flex-col overflow-hidden"
        tools={<>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="上一个规格" disabled={index <= 0} onClick={() => step(-1)} />}><Icon name="action/chevron-left" /></TooltipTrigger>
            <TooltipContent side="bottom">{rows[index - 1] ? `上一个规格 ${rows[index - 1].key}` : '已是第一个规格'}</TooltipContent>
          </Tooltip>
          <span className="min-w-12 text-center text-sm text-ink-2 tabular-nums">{index >= 0 ? `${index + 1} / ${rows.length}` : '—'}</span>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="下一个规格" disabled={index < 0 || index >= rows.length - 1} onClick={() => step(1)} />}><Icon name="action/chevron-right" /></TooltipTrigger>
            <TooltipContent side="bottom">{rows[index + 1] ? `下一个规格 ${rows[index + 1].key}` : '已是最后一个规格'}</TooltipContent>
          </Tooltip>
          <ToggleGroup value={[mode]} onValueChange={value => setMode((value[0] ?? 'section') as 'section' | 'solid')} size="sm" aria-label="视图" className="ml-2">
            <ToggleGroupItem value="section">断面</ToggleGroupItem>
            <ToggleGroupItem value="solid">三维</ToggleGroupItem>
          </ToggleGroup>
        </>}>
        {!view ? <Skeleton className="m-6 flex-1" />
          : mode === 'solid' ? <Suspense fallback={<Skeleton className="m-6 flex-1" />}><SolidView view={view} role={role} /></Suspense>
            : drawing.shape ? <CanvasFrame legend={<div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1 text-xs text-ink-2 shadow-menu">
              {facts.map(([label, value], position) => <span key={label} className="flex items-center gap-1">{position > 0 && <span aria-hidden="true">·</span>}{label}<span className="font-medium text-ink tabular-nums">{value}</span></span>)}
            </div>}>
              <div className="absolute inset-6"><SectionFigure shape={drawing.shape} label={`${view.spec.key} 实际尺寸断面`} role={role} /></div>
            </CanvasFrame>
              : <EmptyState icon="object/section" title="这个结构画不出断面" description={drawing.error || '结构里缺少画断面需要的尺寸。'} />}
      </Panel> },
      { id: 'layers', size: 30, min: 24, children: <Panel title="分层结构"
        tools={view?.closure ? <span className="text-sm text-ink-2 tabular-nums" title="表列外径与各层合计之差，括号外是容差">外径闭合 {fixed(view.closure.residual_mm, 2)} / {fixed(view.closure.tolerance_mm, 2)} mm</span> : undefined}>
        {!view ? <Skeleton className="m-4 h-64" />
          : layers.length === 0 ? <EmptyState icon="object/section" title="没有分层尺寸" description={view.derivation.note} />
            : <DataTable rowKey={row => row.key} rows={layers} columns={LAYER_COLUMNS} selected={layerKey}
              onSelect={row => setPicked(layerKey === row.key ? null : { version: view.version.id, key: row.key })} />}
      </Panel> },
      { id: 'properties', size: 36, min: 30, children: <Tabs defaultValue="params" className="flex min-h-0 flex-1 flex-col gap-0 bg-surface">
        <div className="flex h-11 shrink-0 items-end border-b border-line px-4">
          <TabsList variant="line" className="h-11 border-b-0">
            <TabsTrigger value="params">参数</TabsTrigger>
            <TabsTrigger value="check">标准核对</TabsTrigger>
            <TabsTrigger value="rating">载流量表</TabsTrigger>
            <TabsTrigger value="files">版本与文件</TabsTrigger>
          </TabsList>
        </div>
        {view ? <>
          <TabsContent value="params" className="min-h-0 overflow-auto"><ParamsTab view={view} onCompute={() => compute.mutate()} busy={running} /></TabsContent>
          <TabsContent value="check" className="min-h-0 overflow-auto"><ChecksTab view={view} onCompute={() => compute.mutate()} busy={running} /></TabsContent>
          <TabsContent value="rating" className="min-h-0 overflow-auto"><RatingTab view={view} onCompute={() => compute.mutate()} busy={running} onWorkbench={toWorkbench} /></TabsContent>
          <TabsContent value="files" className="min-h-0 overflow-auto">
            <FilesTab view={view} latest={latest} onVersion={number => openSpec(activeId, number)} onReview={setReview} onPreview={report => setSheet({ open: true, report })} />
          </TabsContent>
        </> : <Skeleton className="m-4 h-64" />}
      </Tabs> },
    ]} />
    {view && <>
      <ReviseDialog view={view} latest={latest} open={dialog === 'revise'} onOpenChange={open => setDialog(open ? 'revise' : null)} onRevised={() => { setDialog(null); openSpec(activeId); }} />
      <ReviewDialog view={view} action={review} onClose={() => setReview(null)} />
      <SheetDialog view={view} open={sheet.open} report={sheet.report} onOpenChange={open => setSheet(current => ({ ...current, open }))} onReport={report => setSheet({ open: true, report })} />
    </>}
  </TypeFrame>;
}
