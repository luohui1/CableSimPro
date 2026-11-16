// 载流量表: the ampacity of one saved version for each laying and each soil, and how far it can be trusted. Two kinds of table are
// kept apart: the reference table the library computes for every version, and the tables an engineer had computed for stated
// conditions and wrote onto the version, each number of which is a run record. A table whose rows share a depth and an ambient
// temperature reads as soils down and layings across; one whose rows differ in them reads as a list, since a grid would hide that.
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { compact, fixed, REVIEW_NAMES } from '@shared/format';
import type { RatingTable, RatingTableRow } from '@shared/model-types';
import type { RatingCondition, RatingRow, SpecView } from '@shared/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Icon } from '@/kit/icon';
import { TierMark, type Tier } from '@/kit/marks';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { ChoiceSelect, FormNote } from '@/kit/workbench/form';
import { Panel } from '@/kit/workbench/page';
import { EmptyState, Given, PremiseStrip } from '@/kit/workbench/premise';
import { api } from '@/state/api';
import { ResultGate } from './gate';
import { fullTime, methodName, shortTime } from './model';

/** One condition of a table and what the method gave for it: the same whether the table is the reference or one written by an engineer. */
interface GridRow {
  key: string;
  /** What the row is called when the rows are listed. */
  name: string;
  layout: string;
  label: string;
  basis: string | null;
  depth: number;
  soil: number;
  ambient: number;
  ampacity: number | null;
  /** The method's own words when it refused the condition. */
  error?: string;
}
interface Grid {
  id: string;
  title: string;
  created: string;
  by: string | null;
  rows: GridRow[];
  tier: { key: Tier; meaning: string | null; basis: string[] } | null;
  method: string;
  warnings: string[];
  /** The project holding one run record per row, for a table written onto the version. */
  project: string | null;
}

/** From the least to the most trustworthy: a table is only as good as its weakest row. */
const TIER_ORDER: Tier[] = ['exploratory', 'reference', 'deliverable'];

/** A row without a name of its own is called by its laying, in words rather than the layout's identifier. */
function rowName(row: RatingTableRow): string {
  const auto = `${row.layout} · ${row.depth_m} m · ${row.soil_thermal_resistivity} K·m/W · ${row.ambient_temperature_c} °C`;
  return row.label === auto ? row.layout_label : row.label;
}

function referenceGrid(view: SpecView): Grid | null {
  const result = view.results.rating;
  if (!result?.current || result.error) return null;
  const conditions = result.conditions as RatingCondition[];
  const rows = result.rows as RatingRow[];
  // A table is only as good as its weakest row.
  const tiers = rows.flatMap(row => (row.tier ? [row.tier] : []));
  const tier = TIER_ORDER.map(key => tiers.find(item => item.tier === key)).find(Boolean);
  return {
    id: 'reference', title: '基准载流量', created: result.created, by: result.by, project: null, method: methodName(result.method),
    rows: conditions.map(item => {
      const row = rows.find(entry => entry.id === item.id);
      return { key: item.id, name: row?.layout_label ?? '载流量', layout: item.layout, label: row?.layout_label ?? '载流量', basis: row?.basis_name ?? null,
        depth: item.depth_m, soil: item.soil_thermal_resistivity, ambient: item.ambient_temperature_c, ampacity: row?.ampacity_a ?? null, error: row?.error?.message };
    }),
    tier: tier ? { key: tier.tier, meaning: tier.meaning, basis: tier.basis } : null,
    warnings: [...new Set(rows.flatMap(row => row.warnings ?? []))],
  };
}

function savedGrid(table: RatingTable): Grid {
  const lowest = TIER_ORDER.find(key => table.rows.some(row => row.tier === key));
  const described = table.rows.find(row => row.tier === lowest && row.tier_meaning);
  const run = table.rows[0]?.run;
  return {
    id: table.id, title: table.title, created: table.created, by: table.by, project: table.project, method: run ? methodName(run) : '', warnings: [],
    rows: table.rows.map(row => ({ key: row.id, name: rowName(row), layout: row.layout, label: row.layout_label, basis: row.basis_name, depth: row.depth_m,
      soil: row.soil_thermal_resistivity, ambient: row.ambient_temperature_c, ampacity: row.ampacity_a, error: row.error?.message })),
    tier: lowest ? { key: lowest, meaning: described?.tier_meaning ?? null, basis: described?.tier_basis ?? [] } : null,
  };
}

const regular = (rows: GridRow[]) => new Set(rows.map(row => row.depth)).size === 1 && new Set(rows.map(row => row.ambient)).size === 1
  && new Set(rows.map(row => `${row.layout}/${row.soil}`)).size === rows.length;
const soilText = (soil: number) => (Number.isInteger(soil) ? soil.toFixed(1) : compact(soil));
const refused = (row: GridRow) => <span className="text-error" title={row.error}>拒算</span>;

function Matrix({ rows }: { rows: GridRow[] }) {
  const layouts = [...new Map(rows.map(row => [row.layout, row])).values()];
  const soils = [...new Set(rows.map(row => row.soil))].sort((a, b) => a - b);
  const columns: Column<number>[] = [
    { key: 'soil', header: '土壤热阻率', unit: 'K·m/W', numeric: true, width: 'w-36', cell: soil => soilText(soil) },
    ...layouts.map(first => ({ key: first.layout, header: first.basis ? `${first.label}（${first.basis}）` : first.label, unit: 'A', numeric: true, width: 'w-64',
      cell: (soil: number) => {
        const row = rows.find(item => item.layout === first.layout && item.soil === soil);
        return !row ? '—' : row.ampacity !== null ? fixed(row.ampacity, 1) : refused(row);
      } })),
  ];
  return <DataTable rows={soils} rowKey={soil => String(soil)} columns={columns} />;
}

const LIST_COLUMNS: Column<GridRow>[] = [
  { key: 'name', header: '敷设', width: 'w-full max-w-0', cell: row => <span className="block truncate" title={row.error ? `${row.name}\n${row.error}` : row.name}>{row.name}</span> },
  { key: 'depth', header: '埋深', unit: 'm', numeric: true, width: 'w-20', cell: row => compact(row.depth) },
  { key: 'soil', header: '热阻率', unit: 'K·m/W', numeric: true, width: 'w-28', cell: row => compact(row.soil) },
  { key: 'ambient', header: '环境', unit: '°C', numeric: true, width: 'w-20', cell: row => compact(row.ambient) },
  { key: 'ampacity', header: '载流量', unit: 'A', numeric: true, width: 'w-24', cell: row => (row.ampacity !== null ? fixed(row.ampacity, 1) : refused(row)) },
];

const TIER_WORDS: Record<Tier, string> = { deliverable: '可交付', reference: '参考', exploratory: '探索' };

/**
 * The table as a file an engineer can open in a spreadsheet: units in the header, a refusal written out where a number would be.
 * What the numbers stand on goes first, so a file passed on still says which size and version, which method and for what conditions.
 */
function csvOf(grid: Grid, view: SpecView): string {
  const text = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  const value = (row: GridRow | undefined) => (!row ? '' : row.ampacity !== null ? String(row.ampacity) : `拒算：${row.error ?? ''}`);
  const same = (key: 'depth' | 'ambient') => [...new Set(grid.rows.map(row => row[key]))].join('、');
  const lines: string[][] = [
    ['规格', view.spec.name], ['版本', `第 ${view.version.number} 版（${REVIEW_NAMES[view.version.review]}）`], ['表', grid.title], ['方法', grid.method],
    ...(grid.tier ? [['可信分档', TIER_WORDS[grid.tier.key]]] : []), ['算于', fullTime(grid.created)], ...(grid.by ? [['算的人', grid.by]] : []),
    ...(regular(grid.rows) ? [['埋深 (m)', same('depth')], ['环境温度 (°C)', same('ambient')]] : []), [],
  ];
  if (regular(grid.rows)) {
    const layouts = [...new Map(grid.rows.map(row => [row.layout, row])).values()];
    lines.push(['土壤热阻率 (K·m/W)', ...layouts.map(first => `${first.label}${first.basis ? `（${first.basis}）` : ''} (A)`)]);
    for (const soil of [...new Set(grid.rows.map(row => row.soil))].sort((a, b) => a - b)) {
      lines.push([String(soil), ...layouts.map(first => value(grid.rows.find(row => row.layout === first.layout && row.soil === soil)))]);
    }
  } else {
    lines.push(['敷设', '埋深 (m)', '热阻率 (K·m/W)', '环境 (°C)', '载流量 (A)']);
    for (const row of grid.rows) lines.push([row.name, String(row.depth), String(row.soil), String(row.ambient), value(row)]);
  }
  return lines.map(line => line.map(text).join(',')).join('\r\n');
}

function save(name: string, content: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function RatingPage({ view, onCompute, busy }: { view: SpecView; onCompute: (() => void) | null; busy: boolean }) {
  const navigate = useNavigate();
  const saved = useQuery({ queryKey: ['library', 'rating-tables', view.spec.id, view.version.number],
    queryFn: () => api.op<RatingTable[]>('library.rating.tables', { spec: view.spec.id, version: view.version.number }) });
  // The tables an engineer wrote come first, the newest of them first; the reference table the library computes comes last.
  const tables = useMemo(() => {
    const reference = referenceGrid(view);
    return [...(saved.data ?? []).map(savedGrid), ...(reference ? [reference] : [])];
  }, [saved.data, view]);
  const [chosen, setChosen] = useState<string | null>(null);
  const grid = tables.find(item => item.id === chosen) ?? tables[0];

  if (!grid) {
    if (saved.isPending) return <Skeleton className="m-6 h-64" />;
    if (saved.error) return <EmptyState icon="status/error" title="读不到这一版的载流量表" description={saved.error.message} action={<Button variant="outline" onClick={() => void saved.refetch()}>重新读取</Button>} />;
    return <ResultGate result={view.results.rating} name="载流量表" onCompute={onCompute} busy={busy}>{null}</ResultGate>;
  }
  const layouts = new Set(grid.rows.map(row => row.layout)).size;
  const soils = new Set(grid.rows.map(row => row.soil)).size;
  const grouped = regular(grid.rows);
  const only = (key: 'depth' | 'ambient') => [...new Set(grid.rows.map(row => row[key]))].map(item => compact(item)).join('、');
  // The method's own words for each condition it refused, once for the layings that share them.
  const refusals = [...Map.groupBy(grid.rows.filter(row => row.error), row => row.error!)].map(([message, rows]) => ({ message, layouts: [...new Set(rows.map(row => row.label))].join('、') }));
  // Why the reference table is not offered beside the tables an engineer wrote: it is out of date or the method gave nothing.
  const reference = view.results.rating;
  const absent = reference && !tables.some(item => item.id === 'reference') ? (!reference.current ? '库按固定条件算的基准表需要重算，所以这里没有列它。' : reference.error ? `库按固定条件算的基准表没有算出来：${reference.error.message}` : null) : null;

  return <>
    <PremiseStrip asked="允许持续载流量">
      {grouped ? <>
        <Given label="埋深" value={`${only('depth')} m`} />
        <Given label="环境" value={`${only('ambient')} °C`} />
        <Given label="敷设" value={`${layouts} 种`} />
        <Given label="土壤热阻率" value={`${soils} 档`} />
      </> : <>
        <Given label="条件" value={`${grid.rows.length} 条`} />
        <Given label="敷设" value={`${layouts} 种`} />
      </>}
    </PremiseStrip>
    <div className="flex min-h-0 flex-1">
      <Panel title={tables.length > 1
        ? <div className="w-72"><ChoiceSelect size="sm" label="载流量表" value={grid.id} onValueChange={setChosen}
          options={tables.map(item => ({ value: item.id, label: item.id === 'reference' ? `${item.title}（库按固定条件算）` : item.title }))} /></div>
        : grid.title}
        tools={<>
          <span className="mr-2 text-sm text-ink-2 tabular-nums">算于 {shortTime(grid.created)}{grid.by ? ` · ${grid.by}` : ''}</span>
          <Button variant="ghost" size="sm" onClick={() => save(`${view.spec.name} ${grid.title}.csv`, csvOf(grid, view))}><Icon name="action/export" data-icon="inline-start" />导出 CSV</Button>
        </>}>
        {grouped ? <Matrix rows={grid.rows} /> : <DataTable rows={grid.rows} rowKey={row => row.key} columns={LIST_COLUMNS} />}
      </Panel>
      <Panel title="可信分档" tools={grid.tier ? <TierMark tier={grid.tier.key} /> : undefined} className="w-80 flex-none border-l border-line" bodyClassName="flex flex-col gap-4 px-4 py-4 text-sm">
        {grid.tier?.meaning && <p className="m-0 text-ink">{grid.tier.meaning}</p>}
        {grid.tier?.basis.map(text => <p key={text} className="m-0 text-ink-2">{text}</p>)}
        {!grid.tier && <p className="m-0 text-ink">这张表没有一个数算出来，所以没有可信分档。</p>}
        <div className="flex flex-col gap-1 border-t border-line pt-4">
          <span className="text-ink-2">方法</span>
          <span className="text-ink">{grid.method || '—'}</span>
          {grid.warnings.map(text => <span key={text} className="text-ink-2">{text}</span>)}
        </div>
        {refusals.length > 0 && <div className="flex flex-col gap-2 border-t border-line pt-4">
          <span className="text-ink-2">方法拒算的条件</span>
          {refusals.map(item => <p key={item.message} className="m-0 flex gap-2 text-ink">
            <span className="flex h-5 shrink-0 items-center"><Icon name="status/error" className="text-error" /></span>
            <span><b className="font-medium">{item.layouts}</b>：{item.message}</span>
          </p>)}
        </div>}
        {saved.error && <FormNote tone="attention" title="读不到写进这一版的载流量表"><span role="alert">{saved.error.message}</span></FormNote>}
        {absent && <FormNote tone="attention">{absent}</FormNote>}
        {grid.project
          ? <div><Button variant="outline" size="sm" onClick={() => void navigate({ to: '/p/$projectId', params: { projectId: grid.project! }, search: {} })}>
            <Icon name="object/study" data-icon="inline-start" />看每个数的运行记录</Button></div>
          : <p className="m-0 text-ink-2">这是库按固定条件算出的基准值。要按自己的敷设条件算，点页头的“新算一张”，写回这一版后规格书会印出它。</p>}
      </Panel>
    </div>
  </>;
}
