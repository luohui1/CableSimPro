// 载流量表: two things that are kept apart. The reference grid is what the batch computes for every version (a fixed laying and
// six soils). The tables are what an engineer had computed for stated conditions and had written onto this version; each of
// their numbers is a run record, and the specification sheet prints them.
import { useQuery } from '@tanstack/react-query';
import { compact, fixed } from '@shared/format';
import type { RatingTable, RatingTableRow } from '@shared/model-types';
import type { RatingCondition, RatingRow, SpecView } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/kit/disclosure';
import { Icon } from '@/kit/icon';
import { TierMark } from '@/kit/marks';
import { PropertyGroup, PropertyList } from '@/kit/properties';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { api } from '@/state/api';
import { ResultGate } from './gate';
import { shortTime } from './model';

const refused = (message: string | undefined) => <span className="text-error" title={message}>拒算</span>;

/** The reference values: one list per laying, soil resistivity down the side. */
function Reference({ view }: { view: SpecView }) {
  const result = view.results.rating!;
  const conditions = result.conditions as RatingCondition[];
  const rows = result.rows as RatingRow[];
  const layouts = [...new Set(conditions.map(item => item.layout))];
  const soils = [...new Set(conditions.map(item => item.soil_thermal_resistivity))];
  const at = (soil: number, layout: string) => rows.find(row => row.id === conditions.find(item => item.layout === layout && item.soil_thermal_resistivity === soil)?.id);
  const label = (layout: string) => rows.find(row => conditions.find(item => item.id === row.id)?.layout === layout)?.layout_label ?? '载流量';
  const first = conditions[0];
  const tier = rows.find(row => row.tier)?.tier;
  const errors = [...new Map(rows.filter(row => row.error).map(row => [row.error!.message, row])).values()];
  return <>
    <PropertyGroup title="基准载流量" aside={first ? <Badge variant="secondary">埋深 {compact(first.depth_m)} m · {compact(first.ambient_temperature_c)} °C</Badge> : undefined}>
      {layouts.map(layout => <div key={layout} className="flex flex-col gap-2">
        <h4 className="m-0 text-sm font-medium text-ink">{label(layout)}</h4>
        <PropertyList rows={soils.map(soil => {
          const row = at(soil, layout);
          return row?.ampacity_a != null ? { label: `热阻率 ${soil} K·m/W`, value: fixed(row.ampacity_a, 1), unit: 'A' } : { label: `热阻率 ${soil} K·m/W`, value: '拒算', tone: 'error' as const };
        })} />
      </div>)}
    </PropertyGroup>
    {(tier || errors.length > 0) && <PropertyGroup title="可信分档与拒算">
      {tier && <div className="flex items-start gap-3 text-sm text-ink"><TierMark tier={tier.tier} /><span>{tier.meaning}</span></div>}
      {errors.map(row => <p key={row.error!.message} className="m-0 flex gap-2 text-sm text-ink">
        <span className="flex h-5 shrink-0 items-center"><Icon name="status/error" className="text-error" /></span><span><b className="font-medium">{row.layout_label ?? row.id}</b>：{row.error!.message}</span>
      </p>)}
    </PropertyGroup>}
  </>;
}

/** A row without a name of its own is called by its conditions, in words rather than the layout's identifier. */
function rowName(row: RatingTableRow): string {
  const auto = `${row.layout} · ${row.depth_m} m · ${row.soil_thermal_resistivity} K·m/W · ${row.ambient_temperature_c} °C`;
  return row.label === auto ? row.layout_label : row.label;
}

const tableColumns: Column<RatingTableRow>[] = [
  { key: 'condition', header: '敷设', width: 'w-full max-w-0', cell: row => <span className="block truncate" title={`${rowName(row)}\n环境 ${compact(row.ambient_temperature_c)} °C · ${compact(row.frequency_hz)} Hz${row.circuits ? ` · ${row.circuits} 回` : ''}${row.error ? `\n${row.error.message}` : ''}`}>{rowName(row)}</span> },
  { key: 'depth', header: '埋深', unit: 'm', numeric: true, width: 'w-20', cell: row => compact(row.depth_m) },
  { key: 'soil', header: '热阻率', unit: 'K·m/W', numeric: true, width: 'w-28', cell: row => compact(row.soil_thermal_resistivity) },
  { key: 'ampacity', header: '载流量', unit: 'A', numeric: true, width: 'w-24', cell: row => row.ampacity_a != null ? fixed(row.ampacity_a, 1) : refused(row.error?.message) },
];

function Saved({ view }: { view: SpecView }) {
  const tables = useQuery({ queryKey: ['library', 'rating-tables', view.spec.id, view.version.number],
    queryFn: () => api.op<RatingTable[]>('library.rating.tables', { spec: view.spec.id, version: view.version.number }) });
  if (tables.error) return <PropertyGroup title="写入这一版的载流量表"><p role="alert" className="m-0 text-sm text-error">{tables.error.message}</p></PropertyGroup>;
  if (!tables.data?.length) {
    return <PropertyGroup title="写入这一版的载流量表">
      <p className="m-0 text-sm text-ink">{tables.isPending ? '正在读取…' : '这一版还没有写入载流量表。在载流量计算里按敷设条件算出后写入，规格书会印出它。'}</p>
    </PropertyGroup>;
  }
  return <>
    {tables.data.map((table, index) => {
      const tier = table.rows.find(row => row.tier_label)?.tier_label;
      return <Disclosure key={table.id} defaultOpen={index === 0} title={table.title}
        aside={<span className="text-sm font-normal text-ink-2 tabular-nums">{shortTime(table.created)}</span>}>
        <DataTable columns={tableColumns} rows={table.rows} rowKey={row => row.id} />
        <p className="m-0 flex flex-wrap items-center gap-2 px-4 py-3 text-sm text-ink">
          {table.by}写入{tier && <Badge variant="outline">{tier}</Badge>}
        </p>
      </Disclosure>;
    })}
  </>;
}

export function RatingTab({ view, onCompute, busy, onWorkbench }: { view: SpecView; onCompute: (() => void) | null; busy: boolean; onWorkbench: (() => void) | undefined }) {
  return <>
    <PropertyGroup title="按敷设条件细算" aside={<Button variant="outline" size="sm" disabled={!onWorkbench} onClick={onWorkbench}><Icon name="calc/ampacity" data-icon="inline-start" />算载流量</Button>}>
      <p className="m-0 text-sm text-ink">在载流量计算里写明敷设和环境条件，逐条算出允许电流，写回这个规格。</p>
    </PropertyGroup>
    <ResultGate result={view.results.rating} name="基准载流量" onCompute={onCompute} busy={busy}><Reference view={view} /></ResultGate>
    <Saved view={view} />
  </>;
}
