// The product library: every series with its sizes in one table. Find a type, see where each size stands in review and in the
// standard check, and open it. Opening is one click on the row; the size opened last stays marked when you come back.
import { useQueries } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { compact, fixed, REVIEW_NAMES } from '@shared/format';
import type { ReviewState, SeriesSummary, SeriesView, SpecRow } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Icon, Spinner } from '@/kit/icon';
import { ReviewMark, VerdictBar } from '@/kit/marks';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { PageHeader, Toolbar } from '@/kit/workbench/page';
import { EmptyState } from '@/kit/workbench/premise';
import { api } from '@/state/api';
import { useProductLibrary } from '@/state/queries';
import { TypeFrame } from './frame';
import { lastOpened, ORIGIN_NAMES, originOf, rememberOpened } from './model';

type Row = SpecRow & { series: string };

const CORES: Record<number, string> = { 1: '单芯', 3: '三芯' };
const ORIGIN_ORDER = ['factory', 'public', 'demo'];
const seriesOrigin = (series: SeriesSummary) => originOf(series.origin);
const dimension = (row: SpecRow, key: string) => row.dimensions?.[key]?.value ?? null;

// Dimensions to one decimal as a catalogue prints them; resistance to four significant figures; weight whole.
const COLUMNS: Column<Row>[] = [
  { key: 'key', header: '规格', width: 'w-32', cell: row => <span className="font-medium">{row.key}</span> },
  { key: 'version', header: '版本', width: 'w-24', cell: row => `第 ${row.version} 版` },
  { key: 'review', header: '审核', width: 'w-28', cell: row => <ReviewMark state={row.review} /> },
  { key: 'conductor', header: '导体外径', unit: 'mm', numeric: true, width: 'w-28', cell: row => fixed(dimension(row, 'conductor_diameter')) },
  { key: 'insulation', header: '绝缘', unit: 'mm', numeric: true, width: 'w-24', cell: row => fixed(dimension(row, 'insulation_thickness')) },
  { key: 'sheath', header: '护套', unit: 'mm', numeric: true, width: 'w-24', cell: row => fixed(dimension(row, 'oversheath_thickness')) },
  { key: 'od', header: '外径', unit: 'mm', numeric: true, width: 'w-24', cell: row => fixed(row.outer_diameter_mm) },
  { key: 'weight', header: '重量', unit: 'kg/km', numeric: true, width: 'w-28', cell: row => fixed(row.weight_kg_km, 0) },
  { key: 'r20', header: 'R₂₀', unit: 'Ω/km', numeric: true, width: 'w-28', cell: row => compact(row.r20_ohm_km) },
  { key: 'check', header: '标准核对', width: 'w-40', cell: row => row.check ? <VerdictBar counts={row.check} /> : <span className="text-ink-2">未核对</span> },
];

function SeriesHeader({ series }: { series: SeriesSummary }) {
  return <span className="flex min-w-0 items-center gap-3">
    <span className="truncate font-medium text-ink">{series.name}</span>
    <span className="shrink-0 text-ink-2">{compact(series.u0_v / 1000)}/{series.u_v == null ? '—' : compact(series.u_v / 1000)} kV · {CORES[series.cores] ?? `${series.cores} 芯`}</span>
  </span>;
}

export function LibraryScreen() {
  const navigate = useNavigate();
  const library = useProductLibrary();
  // The factory's own tables first, then published ones, then the structures that come with the software; the freshest first.
  const list = useMemo(() => [...(library.data ?? [])].sort((a, b) =>
    (ORIGIN_ORDER.indexOf(seriesOrigin(a)) - ORIGIN_ORDER.indexOf(seriesOrigin(b))) || b.updated.localeCompare(a.updated)), [library.data]);
  const views = useQueries({ queries: list.map(item => ({ queryKey: ['library', 'series', item.id], queryFn: () => api.op<SeriesView>('library.series.get', { series: item.id }) })) });
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState('all');
  const [review, setReview] = useState<'all' | ReviewState>('all');
  const [selected, setSelected] = useState(lastOpened);
  const [opened, setOpened] = useState<string[] | null>(null);

  const raw = query.trim().toLowerCase();
  const normalised = raw.replace(/[x*]/g, '×');
  const has = (haystack: string) => !raw || haystack.includes(raw) || haystack.includes(normalised);
  const filtering = Boolean(raw) || review !== 'all';
  // With nothing opened by hand, the series of the size opened last is open, or else the first one.
  const initial = list.find(item => selected.startsWith(`${item.id}.`))?.id ?? list[0]?.id;
  const groups = list.flatMap((item, index) => {
    if (origin !== 'all' && seriesOrigin(item) !== origin) return [];
    const loaded = views[index]?.data;
    const rows: Row[] = (loaded?.specs ?? []).map(row => ({ ...row, series: item.id }));
    const seriesHit = has(`${item.name} ${item.manufacturer} ${item.designation}`.toLowerCase());
    const shown = rows.filter(row => (review === 'all' || row.review === review) && (seriesHit || has(`${row.key} ${row.name}`.toLowerCase())));
    if (filtering && loaded && shown.length === 0) return [];
    const isOpen = filtering || (opened ?? [initial]).includes(item.id);
    return [{
      key: item.id,
      header: <SeriesHeader series={item} />,
      aside: <>
        <Badge variant="outline">{ORIGIN_NAMES[seriesOrigin(item)]}</Badge>
        <span className="flex w-24 items-center justify-end gap-2 text-sm text-ink-2 tabular-nums">
          {views[index]?.isPending && <Spinner />}
          {filtering && loaded ? `${shown.length} / ${item.specs}` : item.specs} 个规格
        </span>
      </>,
      rows: shown,
      open: isOpen,
      onToggle: () => setOpened(current => {
        const base = current ?? [initial];
        return base.includes(item.id) ? base.filter(id => id !== item.id) : [...base, item.id];
      }),
    }];
  });

  const total = list.reduce((sum, item) => sum + item.specs, 0);
  const origins = ORIGIN_ORDER.filter(key => list.some(item => seriesOrigin(item) === key));
  const clear = () => { setQuery(''); setOrigin('all'); setReview('all'); };
  const open = (row: Row) => {
    rememberOpened(row.id);
    setSelected(row.id);
    void navigate({ to: '/library/$seriesId', params: { seriesId: row.series }, search: { spec: row.id } });
  };

  let body;
  if (library.error) {
    body = <EmptyState icon="status/error" title="读不到型号库" description={library.error.message}
      action={<Button variant="outline" onClick={() => void library.refetch()}>重新读取</Button>} />;
  } else if (library.isPending) {
    body = <div role="status" aria-label="正在读取型号库" className="flex flex-col gap-2 p-4">{[0, 1, 2].map(index => <Skeleton key={index} className="h-9 w-full" />)}</div>;
  } else {
    body = <DataTable className="flex-1" columns={COLUMNS} groups={groups} rowKey={row => row.id} selected={selected} onSelect={open}
      empty={list.length === 0
        ? <EmptyState icon="nav/library" title="型号库还是空的" description="导入一张结构表，型号和规格就出现在这里。"
          action={<Button onClick={() => void navigate({ to: '/library/import' })}><Icon name="action/import" data-icon="inline-start" />导入结构表</Button>} />
        : <EmptyState icon="action/search" title="没有符合条件的规格" description="换个关键词，或者清除筛选。"
          action={<Button variant="outline" onClick={clear}>清除筛选</Button>} />} />;
  }

  return <TypeFrame at={{ kind: 'library' }}>
    <PageHeader title="型号库" marks={list.length > 0 ? <Badge variant="secondary">{list.length} 个系列 · {total} 个规格</Badge> : undefined}
      actions={<Button variant="outline" onClick={() => void navigate({ to: '/library/new', search: {} })}><Icon name="action/add" data-icon="inline-start" />新建型号</Button>}
      primary={<Button onClick={() => void navigate({ to: '/library/import' })}><Icon name="action/import" data-icon="inline-start" />导入结构表</Button>} />
    <Toolbar>
      <InputGroup className="w-72">
        <InputGroupAddon><Icon name="action/search" /></InputGroupAddon>
        <InputGroupInput placeholder="搜索型号、规格或制造商" aria-label="搜索型号库" value={query} onChange={event => setQuery(event.target.value)} />
      </InputGroup>
      {origins.length > 1 && <ToggleGroup value={[origin]} onValueChange={value => setOrigin(value[0] ?? 'all')} aria-label="来源" className="ml-2">
        <ToggleGroupItem value="all">全部</ToggleGroupItem>
        {origins.map(key => <ToggleGroupItem key={key} value={key}>{ORIGIN_NAMES[key]}</ToggleGroupItem>)}
      </ToggleGroup>}
      <ToggleGroup value={[review]} onValueChange={value => setReview((value[0] ?? 'all') as 'all' | ReviewState)} aria-label="审核状态" className="ml-2">
        <ToggleGroupItem value="all">全部状态</ToggleGroupItem>
        {Object.entries(REVIEW_NAMES).map(([key, name]) => <ToggleGroupItem key={key} value={key}>{name}</ToggleGroupItem>)}
      </ToggleGroup>
    </Toolbar>
    {body}
  </TypeFrame>;
}
