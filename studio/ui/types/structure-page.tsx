// 结构与核对: the section, the layers and the standard check of one saved version side by side. A layer picked or pointed at
// in the table is outlined on the section and named under it, so the table and the drawing read as one. Every number is read
// from the saved version; nothing here calculates.
import { lazy, Suspense, useMemo, useState, type SyntheticEvent } from 'react';
import { compact, fixed } from '@shared/format';
import { cableShape } from '@shared/geometry';
import type { SpecView, StructureValue } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from '@/kit/icon';
import { CanvasFrame, CanvasNote, CanvasTool, CanvasToolbar } from '@/kit/workbench/canvas';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { Panel, Split } from '@/kit/workbench/page';
import { EmptyState } from '@/kit/workbench/premise';
import { ChecksTab } from './checks-tab';
import { closureText, ORIGIN_MARK, readable, roleOfField } from './model';
import { ringCounts, ringsOf, SectionFigure } from './section-figure';

const SolidView = lazy(() => import('./solid').then(module => ({ default: module.SolidView })));

/** Fields that belong to the finished cable rather than to a layer; the layers table leaves them out. */
const WHOLE = new Set(['area', 'outer_diameter', 'weight', 'r20']);
/** The layer the section starts with: the one the standard check asks most about. */
const FIRST_LAYER = 'insulation_thickness';
const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3] as const;
const FIT = 2;

const LAYER_COLUMNS: Column<StructureValue>[] = [
  { key: 'label', header: '层', cell: row => row.label },
  { key: 'value', header: '厚度 / 直径', unit: 'mm', numeric: true, width: 'w-32', cell: row => <>{compact(row.value, 6)}{row.unit !== 'mm' && <span className="ml-1 text-ink-2">{row.unit}</span>}</> },
  { key: 'origin', header: '来源', width: 'w-20', cell: row => <span className="text-ink-2" title={row.basis}>{ORIGIN_MARK[row.revision ? 'revised' : row.origin]}{row.basis && <span className="sr-only">：{row.basis}</span>}</span> },
];

export function StructurePage({ view, index, total, previous, next, onStep, onCompute, busy }: {
  view: SpecView | undefined;
  /** Where this size stands among the sizes of its series, and the names of its neighbours, for stepping through them. */
  index: number;
  total: number;
  previous?: string;
  next?: string;
  onStep: (offset: number) => void;
  onCompute: (() => void) | null;
  busy: boolean;
}) {
  const [mode, setMode] = useState<'section' | 'solid'>('section');
  const [zoomAt, setZoomAt] = useState(FIT);
  const [picked, setPicked] = useState<{ version: string; key: string } | null>(null);
  const [pointed, setPointed] = useState<string | null>(null);

  const drawing = useMemo(() => {
    if (!view) return { shape: null, error: '' };
    try { return { shape: cableShape(view.entry.payload.cable_type, view.entry.payload.materials), error: '' }; }
    catch (cause) { return { shape: null, error: cause instanceof Error ? cause.message : String(cause) }; }
  }, [view]);
  const layers = useMemo(() => view?.structure.filter(row => !WHOLE.has(row.key)) ?? [], [view]);
  // What the pointer is on wins over what was picked; with neither, the layer the check asks most about.
  const own = picked && view && picked.version === view.version.id ? picked.key : undefined;
  const layerKey = pointed ?? own ?? (layers.some(row => row.key === FIRST_LAYER) ? FIRST_LAYER : layers[0]?.key);
  const layer = layers.find(row => row.key === layerKey);
  const role = layer ? roleOfField(layer.key) : null;
  const counts = drawing.shape ? ringCounts(drawing.shape) : null;

  // The table's rows are plain table rows: the row under the pointer or focus is found by its place in the body.
  const point = (event: SyntheticEvent) => {
    const row = (event.target as HTMLElement).closest('tbody tr');
    const at = row?.parentElement ? [...row.parentElement.children].indexOf(row) : -1;
    setPointed(layers[at]?.key ?? null);
  };

  return <Split panes={[
    { id: 'section', size: 34, min: 24, children: <Panel title="结构断面" bodyClassName="flex flex-col overflow-hidden"
      tools={<>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="上一个规格" disabled={index <= 0} onClick={() => onStep(-1)} />}><Icon name="action/chevron-left" /></TooltipTrigger>
          <TooltipContent side="bottom">{previous ? `上一个规格 ${previous}` : '已是第一个规格'}</TooltipContent>
        </Tooltip>
        <span className="min-w-12 text-center text-sm text-ink-2 tabular-nums">{index >= 0 ? `${index + 1} / ${total}` : '—'}</span>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="下一个规格" disabled={index < 0 || index >= total - 1} onClick={() => onStep(1)} />}><Icon name="action/chevron-right" /></TooltipTrigger>
          <TooltipContent side="bottom">{next ? `下一个规格 ${next}` : '已是最后一个规格'}</TooltipContent>
        </Tooltip>
        <ToggleGroup value={[mode]} onValueChange={value => setMode((value[0] ?? 'section') as 'section' | 'solid')} size="sm" aria-label="视图" className="ml-2">
          <ToggleGroupItem value="section">断面</ToggleGroupItem>
          <ToggleGroupItem value="solid">三维</ToggleGroupItem>
        </ToggleGroup>
      </>}>
      {!view ? <Skeleton className="m-6 flex-1" />
        : mode === 'solid' ? <Suspense fallback={<Skeleton className="m-6 flex-1" />}><SolidView view={view} role={role} /></Suspense>
          : drawing.shape && counts ? <CanvasFrame
            tools={<CanvasToolbar label="断面工具">
              <CanvasTool icon="tool/zoom-out" label="缩小" disabled={zoomAt <= 0} onClick={() => setZoomAt(at => Math.max(0, at - 1))} />
              <CanvasTool icon="tool/fit" label="适应窗口" disabled={zoomAt === FIT} onClick={() => setZoomAt(FIT)} />
              <CanvasTool icon="tool/zoom-in" label="放大" disabled={zoomAt >= ZOOMS.length - 1} onClick={() => setZoomAt(at => Math.min(ZOOMS.length - 1, at + 1))} />
            </CanvasToolbar>}
            legend={layer && <CanvasNote>
              <span className="size-2 shrink-0 rounded-full bg-copper" aria-hidden="true" />
              {layer.label}<span className="font-medium tabular-nums">{compact(layer.value, 6)} {layer.unit}</span>
              {ringsOf(drawing.shape, role) > 1 && <span className="text-ink-2">{counts.cores} 芯各一层</span>}
            </CanvasNote>}
            status={<>
              <span>外径 {fixed(view.entry.summary.outer_diameter_m * 1000, 1)} mm</span>
              <span>断面 {counts.total} 层：{counts.cores > 1 ? `${counts.cores} 芯各 ${counts.perCore} 层` : `线芯 ${counts.perCore} 层`}，共用 {counts.common} 层</span>
            </>}>
            <div className="absolute inset-8"><SectionFigure shape={drawing.shape} label={`${view.spec.key} 实际尺寸断面`} role={role} zoom={ZOOMS[zoomAt]} /></div>
          </CanvasFrame>
            : <EmptyState icon="object/section" title="这个结构画不出断面" description={drawing.error || '结构里缺少画断面需要的尺寸。'} />}
    </Panel> },
    { id: 'layers', size: 36, min: 26, children: <Panel title="分层结构" tools={view?.closure ? <span className="text-sm text-ink-2 tabular-nums">{closureText(view.closure)}</span> : undefined}>
      {!view ? <Skeleton className="m-4 h-64" />
        : layers.length === 0 ? <EmptyState icon="object/section" title="没有分层尺寸" description={readable(view.derivation.note)} />
          : <div className="contents" onMouseOver={point} onMouseLeave={() => setPointed(null)} onFocus={point} onBlur={() => setPointed(null)}>
            <DataTable rowKey={row => row.key} rows={layers} columns={LAYER_COLUMNS} selected={own ?? layerKey}
              onSelect={row => setPicked({ version: view.version.id, key: row.key })} />
          </div>}
    </Panel> },
    { id: 'check', size: 30, min: 24, children: <Panel title="标准核对">
      {view ? <ChecksTab view={view} onCompute={onCompute} busy={busy} /> : <Skeleton className="m-4 h-64" />}
    </Panel> },
  ]} />;
}
