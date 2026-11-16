// 参数: what the saved structure gives (diameters, resistance, weight), what the electrical and short-circuit methods gave for
// it, what has not been calculated, and where the data came from. Values the method refused are listed as refused.
import { compact, fixed, STATE_NAMES } from '@shared/format';
import { resultValue, dateTime } from '@shared/products';
import type { ProductResult, SpecView, ValueRow } from '@shared/types';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Disclosure } from '@/kit/disclosure';
import { Icon } from '@/kit/icon';
import { PropertyGroup, PropertyList, type Property } from '@/kit/properties';
import { ResultGate } from './gate';
import { conditionLabel, conditionValue, ORIGIN_MARK, withoutHashes } from './model';

/** A three-core cable gives one row per core; equal values are shown once and say so. */
function grouped(result: ProductResult): { name: string; rows: ValueRow[] }[] {
  const groups = new Map<string, ValueRow[]>();
  for (const row of result.rows as ValueRow[]) {
    const name = (row.title ?? row.label ?? row.id).replace(/^芯 \d+ · /, '');
    groups.set(name, [...(groups.get(name) ?? []), row]);
  }
  return [...groups.entries()].map(([name, rows]) => ({ name, rows }));
}

/** A value a result could not give, and the method's own reason. */
interface Open { label: string; why: string; reason: string | null }

/** The values a result gave, and the ones it could not give. Cores that agree read once; cores that differ read one by one. */
function valueRows(result: ProductResult): { done: Property[]; open: Open[] } {
  const done: Property[] = [];
  const open: Open[] = [];
  for (const { name, rows } of grouped(result)) {
    const same = rows.every(item => item.value === rows[0].value && item.status === rows[0].status);
    for (const row of same ? [rows[0]] : rows) {
      const label = same ? name : (row.title ?? row.label ?? row.id);
      if (row.value === null) {
        open.push({ label, why: row.status === 'missing' ? '缺输入' : '未覆盖', reason: row.reason ?? null });
        continue;
      }
      const shown = resultValue({ ...row, value: Number(row.value.toPrecision(6)) });
      done.push({ label, value: compact(Number(shown.value), 4), unit: shown.unit === '1' ? '' : shown.unit });
    }
  }
  return { done, open };
}

/** The conditions a result was calculated under and the method that gave it: kept shut, since the answer comes first. */
function Conditions({ results }: { results: (ProductResult | undefined)[] }) {
  const seen = new Set<string>();
  const rows: { label: string; value: string; source?: string }[] = [];
  for (const result of results) {
    const conditions = result?.current && !Array.isArray(result.conditions) ? result.conditions : null;
    for (const [key, value] of Object.entries(conditions?.values ?? {})) {
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ label: conditionLabel(key), value: conditionValue(key, value), source: conditions!.sources[key] });
    }
  }
  const method = results.find(result => result?.current && result.method);
  if (method?.method) {
    rows.push({ label: '方法版本', value: method.method.method_version });
    rows.push({ label: '计算时间', value: dateTime(method.created) });
    rows.push({ label: '计算人', value: method.by });
  }
  if (!rows.length) return null;
  return <Disclosure title="计算条件与方法">
    <dl className="m-0 grid grid-cols-label gap-x-3 gap-y-2 px-4 pb-4 text-sm">
      {rows.map(row => <div key={row.label} className="contents">
        <dt className="text-ink-2">{row.label}</dt>
        <dd className="m-0 text-ink">{row.value}{row.source && <span className="ml-2 text-ink-2">{row.source}</span>}</dd>
      </div>)}
    </dl>
  </Disclosure>;
}

export function ParamsTab({ view, onCompute, busy }: { view: SpecView; onCompute: (() => void) | null; busy: boolean }) {
  const item = (key: string) => view.structure.find(entry => entry.key === key);
  // A value from the structure table is the usual case and says nothing; one the series states, the standard gives or an engineer
  // changed says so after its name.
  const named = (text: string, key: string): ReactNode => {
    const found = item(key);
    const tag = found && (found.revision || found.origin !== 'table') ? (found.revision ? ORIGIN_MARK.revised : ORIGIN_MARK[found.origin]) : null;
    return tag ? <>{text}<span className="ml-2 text-ink-2">{tag}</span></> : text;
  };
  const structure: Property[] = [
    { label: '外径', value: fixed(view.entry.summary.outer_diameter_m * 1000, 1), unit: 'mm' },
    { label: named('导体截面', 'area'), value: compact(view.spec.area_mm2), unit: 'mm²' },
  ];
  const conductor = item('conductor_diameter');
  if (conductor) structure.push({ label: named('导体外径', 'conductor_diameter'), value: compact(conductor.value), unit: 'mm' });
  if (view.entry.summary.r20_ohm_m != null) structure.push({ label: named('20 °C 直流电阻', 'r20'), value: compact(view.entry.summary.r20_ohm_m * 1000, 4), unit: 'Ω/km' });
  const weight = item('weight');
  if (weight) structure.push({ label: named('重量', 'weight'), value: compact(weight.value, 6), unit: 'kg/km' });

  const electrical = view.results.electrical;
  const shortCircuit = view.results.short_circuit;
  const electricalRows = electrical?.current && !electrical.error ? valueRows(electrical) : null;
  const shortRows = shortCircuit?.current && !shortCircuit.error ? valueRows(shortCircuit) : null;
  const temperature = electrical?.current && !Array.isArray(electrical.conditions) ? electrical.conditions?.values.temperature_k : undefined;

  return <>
    <PropertyGroup title="结构与重量"><PropertyList rows={structure} /></PropertyGroup>
    <ResultGate result={electrical} name="电气参数" onCompute={onCompute} busy={busy}>
      <PropertyGroup title="每芯电气参数" aside={typeof temperature === 'number' ? <Badge variant="secondary">{conditionValue('temperature_k', temperature)}</Badge> : undefined}>
        <PropertyList rows={electricalRows?.done ?? []} />
      </PropertyGroup>
    </ResultGate>
    {shortRows && shortRows.done.length > 0 && <PropertyGroup title="短路容量"><PropertyList rows={shortRows.done} /></PropertyGroup>}
    {!shortRows && electrical?.current && !electrical.error && <PropertyGroup title="短路容量">
      <p className="m-0 text-sm text-ink">{!shortCircuit ? '这一版还没有算短路容量。' : !shortCircuit.current ? '短路容量对不上现在的版本，需要重算。' : `短路容量没有算出来：${shortCircuit.error?.message ?? ''}`}</p>
    </PropertyGroup>}
    {((electricalRows?.open.length ?? 0) + (shortRows?.open.length ?? 0)) > 0 && <PropertyGroup title="还没有算">
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {[...(electricalRows?.open ?? []), ...(shortRows?.open ?? [])].map(item => <li key={item.label} className="flex flex-col text-sm">
          <span className="flex items-baseline justify-between gap-3"><span className="text-ink">{item.label}</span><span className="shrink-0 text-ink-2">{item.why}</span></span>
          {item.reason && <span className="text-ink-2">{item.reason}</span>}
        </li>)}
      </ul>
    </PropertyGroup>}
    {view.warnings.length > 0 && <PropertyGroup title="资料提示">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {view.warnings.map(issue => <li key={issue.code + issue.message} className="flex gap-2 text-sm text-ink">
          <span className="flex h-5 shrink-0 items-center"><Icon name="status/warning" className="text-attention" /></span>{issue.message}
        </li>)}
      </ul>
    </PropertyGroup>}
    <Conditions results={[electrical, shortCircuit]} />
    <PropertyGroup title="来源" aside={<Badge variant="outline">{STATE_NAMES[view.series.origin] ?? view.series.origin}</Badge>}>
      <p className="m-0 text-sm text-ink">{view.derivation.note}</p>
    </PropertyGroup>
    <Disclosure title="完整来源说明"><p className="m-0 px-4 pb-4 text-sm text-ink-2">{withoutHashes(view.entry.source)}</p></Disclosure>
  </>;
}
