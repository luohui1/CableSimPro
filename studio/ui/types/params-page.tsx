// 参数: what the electrical and the short-circuit methods gave for one saved version, which clause each number stands on, and
// what they could not give. A value a method refused is listed as refused with the method's own words, never as zero.
import { compact, fixed, STATE_NAMES } from '@shared/format';
import { dateTime, resultValue } from '@shared/products';
import type { ProductResult, SpecView, ValueRow } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Disclosure } from '@/kit/disclosure';
import { Icon } from '@/kit/icon';
import { Metric } from '@/kit/metric';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { Panel, Split } from '@/kit/workbench/page';
import { ResultGate } from './gate';
import { conditionLabel, methodName, withoutHashes } from './model';

/** One quantity as the page lists it: three cores that agree read once, cores that differ read one by one. */
interface Quantity { key: string; label: string; value: string; unit: string; basis: string }
/** A quantity a method could not give, and its own reason. */
interface Open { key: string; label: string; status: string; reason: string | null }

const nameOf = (row: ValueRow) => (row.title ?? row.label ?? row.id).replace(/^芯 \d+ · /, '');
/** The generic "金属组件" of a title is the screen or the armour, which its id says. */
const COMPONENTS: [string, string][] = [['core/1:metallic_screen', '金属屏蔽'], ['common:armour', '铠装']];
const labelOf = (row: ValueRow, name: string) => {
  const component = COMPONENTS.find(([prefix]) => row.id.startsWith(prefix))?.[1];
  return component ? name.replace('金属组件', component) : name;
};
const STATUS_WORDS: Record<string, string> = { missing: '缺项', uncovered: '未覆盖' };
const basisOf = (row: ValueRow) => row.standard ? `${row.standard} ${String(row.clause ?? '').split('，')[0]}`.trim() : '—';

/** The values a result gave, and the ones it could not give. */
function split(result: ProductResult | undefined): { given: Quantity[]; open: Open[] } | null {
  if (!result?.current || result.error) return null;
  const groups = new Map<string, ValueRow[]>();
  for (const row of result.rows as ValueRow[]) groups.set(nameOf(row), [...(groups.get(nameOf(row)) ?? []), row]);
  const given: Quantity[] = [];
  const open: Open[] = [];
  for (const [name, rows] of groups) {
    const same = rows.every(item => item.value === rows[0].value && item.status === rows[0].status);
    for (const row of same ? [rows[0]] : rows) {
      const label = same ? labelOf(row, name) : labelOf(row, row.title ?? row.label ?? row.id);
      if (row.value === null) { open.push({ key: row.id, label, status: row.status, reason: row.reason ?? null }); continue; }
      const shown = resultValue({ ...row, value: Number(row.value.toPrecision(6)) });
      given.push({ key: row.id, label, value: compact(Number(shown.value), 4), unit: shown.unit === '1' ? '' : shown.unit, basis: basisOf(row) });
    }
  }
  return { given, open };
}

const COLUMNS: Column<Quantity>[] = [
  { key: 'label', header: '参数', cell: row => row.label },
  { key: 'value', header: '数值', numeric: true, width: 'w-28', cell: row => <span className="font-medium">{row.value}</span> },
  { key: 'unit', header: '单位', width: 'w-20', cell: row => <span className="text-ink-2">{row.unit}</span> },
  { key: 'basis', header: '依据', width: 'w-56', cell: row => <span className="truncate text-ink-2" title={row.basis}>{row.basis}</span> },
];

function Missing({ rows }: { rows: Open[] }) {
  return <ul className="m-0 flex list-none flex-col p-0">
    {rows.map(row => <li key={row.key} className="grid grid-cols-property items-start gap-x-4 border-b border-line px-4 py-2 text-sm last:border-b-0">
      <span className="flex flex-col gap-1">
        <span className="text-ink">{row.label}</span>
        {row.reason && <span className="text-ink-2">{row.reason}</span>}
      </span>
      <Badge variant={row.status === 'uncovered' ? 'outline' : 'secondary'}>{STATUS_WORDS[row.status] ?? row.status}</Badge>
      <span />
    </li>)}
  </ul>;
}

/** The conditions the short-circuit method was run under, each with where it comes from. */
function Conditions({ result }: { result: ProductResult }) {
  const conditions = result.conditions && !Array.isArray(result.conditions) ? result.conditions : null;
  const keys = Object.keys(conditions?.sources ?? {});
  if (!conditions || keys.length === 0) return null;
  return <dl className="m-0 flex flex-col gap-2 border-b border-line px-4 py-4 text-sm">
    {keys.map(key => <div key={key} className="grid grid-cols-label gap-x-4">
      <dt className="text-ink-2">{conditionLabel(key)}</dt>
      <dd className="m-0 text-ink">{conditions.sources[key]}</dd>
    </div>)}
  </dl>;
}

/** What the saved structure and the engineers said about this version, kept shut under the numbers: warnings first. */
function Provenance({ view, results }: { view: SpecView; results: (ProductResult | undefined)[] }) {
  const method = results.find(result => result?.current && result.method);
  return <>
    {view.warnings.length > 0 && <Disclosure title={`资料提示 ${view.warnings.length} 条`} defaultOpen>
      <ul className="m-0 flex list-none flex-col gap-2 px-4 pb-4">
        {view.warnings.map(issue => <li key={issue.code + issue.message} className="flex gap-2 text-sm text-ink">
          <span className="flex h-5 shrink-0 items-center"><Icon name="status/warning" className="text-attention" /></span>{issue.message}
        </li>)}
      </ul>
    </Disclosure>}
    <Disclosure title="尺寸来源">
      <div className="flex flex-col gap-2 px-4 pb-4 text-sm">
        <span className="flex items-center gap-2 text-ink"><Badge variant="outline">{STATE_NAMES[view.series.origin] ?? view.series.origin}</Badge>{view.derivation.note}</span>
        <span className="text-ink-2">{withoutHashes(view.entry.source)}</span>
        {method?.method && <span className="text-ink-2">{methodName(method.method)} · {dateTime(method.created)} · {method.by}</span>}
      </div>
    </Disclosure>
  </>;
}

export function ParamsPage({ view, onCompute, busy }: { view: SpecView; onCompute: (() => void) | null; busy: boolean }) {
  const electrical = view.results.electrical;
  const shortCircuit = view.results.short_circuit;
  const electricalRows = split(electrical);
  const shortRows = split(shortCircuit);
  // The conductor's short-circuit current is the number this panel exists for; with its adiabatic value and the correction factor it is built from.
  const quantities = shortCircuit?.current && !shortCircuit.error ? (shortCircuit.rows as ValueRow[]) : [];
  const rowAt = (suffix: string) => quantities.filter(row => row.id.endsWith(suffix) && row.value !== null).sort((a, b) => a.value! - b.value!)[0];
  const nonadiabatic = rowAt(':conductor-nonadiabatic');
  const core = nonadiabatic?.id.split(':')[0];
  const adiabatic = quantities.find(row => row.id === `${core}:conductor-adiabatic`)?.value ?? null;
  const factor = quantities.find(row => row.id === `${core}:conductor-factor`)?.value ?? null;
  const headline = new Set([':conductor-nonadiabatic', ':conductor-adiabatic', ':conductor-factor']);
  const others = shortRows?.given.filter(row => ![...headline].some(suffix => row.key.endsWith(suffix))) ?? [];

  return <Split panes={[
    { id: 'electrical', size: 56, min: 40, children: <Panel title="每芯电气参数" tools={electrical?.current && electrical.method ? <Badge variant="outline">{methodName(electrical.method)}</Badge> : undefined}>
      <ResultGate result={electrical} name="电气参数" onCompute={onCompute} busy={busy}>
        <DataTable rows={electricalRows?.given ?? []} rowKey={row => row.key} columns={COLUMNS} />
        {(electricalRows?.open.length ?? 0) > 0 && <Disclosure title={`没有给出的 ${electricalRows!.open.length} 项`} defaultOpen><Missing rows={electricalRows!.open} /></Disclosure>}
        <Provenance view={view} results={[electrical, shortCircuit]} />
      </ResultGate>
    </Panel> },
    { id: 'short', size: 44, min: 32, children: <Panel title="短路电流" tools={shortCircuit?.current && shortCircuit.method ? <Badge variant="outline">{methodName(shortCircuit.method)}</Badge> : undefined}>
      <ResultGate result={shortCircuit} name="短路电流" onCompute={onCompute} busy={busy}>
        {nonadiabatic && <div className="flex flex-col gap-4 border-b border-line px-4 py-4">
          <Metric label="导体非绝热允许短路电流" value={fixed(nonadiabatic.value! / 1000, 2)} unit="kA"
            detail={adiabatic !== null && factor !== null ? `绝热 ${fixed(adiabatic / 1000, 2)} kA × 修正因数 ${fixed(factor, 4)}` : undefined} />
        </div>}
        <Conditions result={shortCircuit!} />
        {others.length > 0 && <DataTable rows={others} rowKey={row => row.key} columns={COLUMNS} />}
        {(shortRows?.open.length ?? 0) > 0 && <Disclosure title={`没有给出的 ${shortRows!.open.length} 项`}><Missing rows={shortRows!.open} /></Disclosure>}
      </ResultGate>
    </Panel> },
  ]} />;
}
