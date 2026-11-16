// A sweep of one condition: the dialog that sets it up, and the screen that reads it: the curve of the allowed current (or of
// the conductor's temperature) against the condition, and the numbers of every point. A point the method could not compute stays
// in its place and says why, in the method's words.
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Disclosure } from '@/kit/disclosure';
import { Icon } from '@/kit/icon';
import { Metric } from '@/kit/metric';
import { CurveChart, type Axis } from '@/kit/workbench/chart';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { FormRow, Segmented, UnitInput } from '@/kit/workbench/form';
import { Panel, Split } from '@/kit/workbench/page';
import { api } from '@/state/api';
import { compact, fixed } from '@shared/format';
import type { Parts, ProjectView, RunRecord } from '@shared/types';
import { csvOf, download } from './csv';
import { FormDialog } from './fields';
import { messageOf } from './messages';
import { limitOf, methodOf } from './rating';

// ---- The dialog ----

type SweepVariable = 'soil_thermal_resistivity' | 'ambient_temperature_c' | 'depth_m' | 'spacing_m' | 'current_a';

/**
 * What can be swept, in the host's words and units. The range the form starts with is only a starting point to edit: soil
 * resistivity over the span soils have, the others around the value now, with a number of points that makes round steps.
 */
const SWEEPS: { key: SweepVariable; label: string; unit: string; points: number; now: (view: ProjectView) => number | null; range: (now: number) => [number, number] }[] = [
  { key: 'soil_thermal_resistivity', label: '土壤热阻率', unit: 'K·m/W', points: 6, now: view => view.parts.conditions.soil_thermal_resistivity, range: () => [0.5, 3] },
  { key: 'ambient_temperature_c', label: '环境温度', unit: '°C', points: 7, now: view => view.parts.conditions.ambient_temperature_c, range: now => [now - 15, now + 15] },
  { key: 'depth_m', label: '中心埋深', unit: 'm', points: 7, now: view => view.parts.installation.depth_m, range: now => [Math.max(0.5, now - 0.7), Math.max(0.5, now - 0.7) + 1.5] },
  // Only a laying with a spacing of its own can have it swept.
  { key: 'spacing_m', label: '中心距', unit: 'm', points: 5, now: view => (view.preview?.layout.spacing === null || view.preview?.layout.spacing === undefined ? null : view.parts.installation.spacing_m ?? view.preview.layout.spacing), range: now => [now, now * 3] },
  { key: 'current_a', label: '负荷电流', unit: 'A', points: 5, now: view => view.parts.conditions.currents_a[0] ?? null, range: now => [now / 2, now * 1.5] },
];
const round = (value: number) => Number(value.toPrecision(3));

export function SweepDialog({ view, onClose, onDone }: { view: ProjectView; onClose: () => void; onDone: (record: RunRecord) => void | Promise<void> }) {
  const options = SWEEPS.filter(option => option.now(view) !== null);
  const start = (key: SweepVariable): [number, number] => {
    const option = SWEEPS.find(item => item.key === key)!;
    const [from, to] = option.range(option.now(view) as number);
    return [round(from), round(to)];
  };
  const [variable, setVariable] = useState<SweepVariable>(options[0].key);
  const [from, setFrom] = useState<number | null>(start(variable)[0]);
  const [to, setTo] = useState<number | null>(start(variable)[1]);
  const [count, setCount] = useState<number | null>(options[0].points);
  const [busy, setBusy] = useState(false);
  // One run per press, also when the form is sent twice before the screen shows it working.
  const running = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const option = SWEEPS.find(item => item.key === variable)!;

  const values = (): number[] | string => {
    if (from === null || to === null) return '起点和终点要填数字。';
    if (from === to) return '起点和终点不能相同。';
    if (count === null || !Number.isInteger(count) || count < 2 || count > 50) return '点数要填 2 到 50 之间的整数。';
    if (variable !== 'ambient_temperature_c' && variable !== 'current_a' && (from <= 0 || to <= 0)) return `${option.label}要大于 0。`;
    if (variable === 'current_a' && (from < 0 || to < 0)) return '负荷电流不能小于 0。';
    return Array.from({ length: count }, (_, index) => Number((from + ((to - from) * index) / (count - 1)).toPrecision(10)));
  };
  const planned = values();
  const submit = async () => {
    if (typeof planned === 'string') return setError(planned);
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await onDone(await api.op<RunRecord>('run.sweep', { project: view.meta.id, variable, values: planned }));
    } catch (failure) {
      setError(messageOf(failure));
      running.current = false;
      setBusy(false);
    }
  };
  return <FormDialog title="扫一个条件" description="只改变一个量，逐点算允许电流，存成一条运行记录；工程里的条件不变。" applyLabel="运行扫描" busy={busy} error={error} onClose={onClose} onSubmit={() => void submit()}>
    <Segmented label="扫哪个条件" value={variable} options={options.map(item => ({ value: item.key, label: item.label }))} onValueChange={next => {
      const key = next as SweepVariable;
      setVariable(key);
      const [low, high] = start(key);
      setFrom(low);
      setTo(high);
      setCount(SWEEPS.find(item => item.key === key)!.points);
    }} />
    <div className="flex flex-col gap-3">
      <FormRow label="起点" htmlFor="sweep-from"><UnitInput id="sweep-from" unit={option.unit} value={from} onValueChange={setFrom} /></FormRow>
      <FormRow label="终点" htmlFor="sweep-to"><UnitInput id="sweep-to" unit={option.unit} value={to} onValueChange={setTo} /></FormRow>
      <FormRow label="点数" htmlFor="sweep-count"><UnitInput id="sweep-count" unit="点" value={count} onValueChange={setCount} /></FormRow>
    </div>
    <p className="m-0 text-sm text-ink-2">
      {typeof planned === 'string' ? planned : `共 ${planned.length} 点：${planned.slice(0, 6).map(value => compact(value)).join('、')}${planned.length > 6 ? ' …' : ''} ${option.unit}`}
    </p>
  </FormDialog>;
}

// ---- The screen ----

/** The value the project stood at when the sweep was run, for the variable it swept. */
const STOOD_AT: Record<string, (inputs: Parts) => number | null> = {
  soil_thermal_resistivity: inputs => inputs.conditions.soil_thermal_resistivity,
  ambient_temperature_c: inputs => inputs.conditions.ambient_temperature_c,
  depth_m: inputs => inputs.installation.depth_m,
  spacing_m: inputs => inputs.installation.spacing_m,
  current_a: inputs => inputs.conditions.currents_a[0] ?? null,
};

interface Row {
  value: number;
  ampacity: number | null;
  conductor: number | null;
  /** The method gave no allowed current for this point. */
  error?: string;
  /** The method found no steady state at the load of this point. */
  runaway?: string;
}

export function SweepScreen({ record }: { record: RunRecord }) {
  const sweep = record.sweep as NonNullable<RunRecord['sweep']>;
  const [shown, setShown] = useState<'ampacity' | 'conductor'>('ampacity');
  const loads = record.inputs.conditions.currents_a;
  const swept = sweep.variable === 'current_a';
  // The saved load is drawn against the curve when the sweep leaves it alone and every circuit carries the same.
  const load = !swept && loads.every(value => value === loads[0]) ? loads[0] : null;
  const limit = limitOf(record.inputs);
  const rows: Row[] = sweep.points.map(point => ({
    value: point.value,
    ampacity: typeof point.ampacity_a === 'number' ? point.ampacity_a : null,
    conductor: typeof point.hottest_conductor_c === 'number' ? point.hottest_conductor_c : null,
    error: point.error?.message,
    runaway: point.operating_error?.message,
  }));
  const solved = rows.filter(row => row.ampacity !== null);
  const lowest = solved.reduce<Row | null>((low, row) => (low === null || (row.ampacity as number) < (low.ampacity as number) ? row : low), null);
  const hot = rows.filter(row => row.conductor !== null);
  const hottest = hot.reduce<Row | null>((top, row) => (top === null || (row.conductor as number) > (top.conductor as number) ? row : top), null);
  const stood = STOOD_AT[sweep.variable]?.(record.inputs) ?? null;
  const at = stood === null ? undefined : { value: stood, label: `工程取值 ${compact(stood)}` };
  const x: Axis = { key: 'value', label: sweep.label, unit: sweep.unit, format: value => compact(value) };
  // What the conductor's temperature is the temperature at: the saved load, or at each point the load that point sweeps.
  const [atLoad, conductor] = load === null
    ? (swept ? ['该负荷下', '该负荷下导体'] : ['保存负荷下', '保存负荷下导体'])
    : [`保存负荷 ${compact(load)} A 时`, `${compact(load)} A 时导体`];
  // What each point says when it has no number: the method's words.
  const refused = rows.filter(row => row.error);
  const runaways = rows.filter(row => row.runaway && !row.error);
  const reasons = (list: Row[], words: (row: Row) => string | undefined) => (
    <ul className="m-0 flex list-none flex-col gap-2 px-4 pb-4 text-sm">
      {list.map(row => <li key={row.value} className="flex flex-col gap-1">
        <span className="font-medium text-ink">{sweep.label} {compact(row.value)} {sweep.unit}</span>
        <span className="text-ink">{words(row) ?? '方法没有给出结果'}</span>
      </li>)}
    </ul>
  );

  const columns: Column<Row>[] = [
    { key: 'value', header: sweep.label, unit: sweep.unit, numeric: true, cell: row => compact(row.value) },
    { key: 'ampacity', header: '允许电流', unit: 'A', numeric: true, width: 'w-28', cell: row => (row.ampacity === null
      ? <Tooltip><TooltipTrigger render={<span tabIndex={0} className="text-error">拒算</span>} /><TooltipContent>{row.error ?? '方法没有给出结果'}</TooltipContent></Tooltip>
      : fixed(row.ampacity)) },
    { key: 'conductor', header: conductor, unit: '°C', numeric: true, width: 'w-36', cell: row => (row.conductor !== null
      ? <span className={limit !== null && row.conductor > limit ? 'text-error' : undefined}>{fixed(row.conductor)}</span>
      : row.runaway ? <Tooltip><TooltipTrigger render={<span tabIndex={0} className="text-ink-2">无稳态解</span>} /><TooltipContent>{row.runaway}</TooltipContent></Tooltip> : '—') },
  ];

  const save = () => {
    const header = [`${sweep.label} (${sweep.unit})`, '允许电流 (A)', `${conductor} (°C)`, '说明'];
    download(`${record.project.name} 扫描 #${record.sequence}.csv`, csvOf([
      ['工程', record.project.name], ['运行记录', `#${record.sequence} ${record.title}`], ['方法', methodOf(record)], [],
      header,
      ...rows.map(row => [row.value, row.ampacity === null ? null : Number(row.ampacity.toFixed(1)), row.conductor === null ? null : Number(row.conductor.toFixed(1)), row.error ?? row.runaway ?? '']),
    ]));
  };

  const chart = (key: 'ampacity' | 'conductor') => key === 'ampacity'
    ? <CurveChart className="h-full min-h-64" data={rows.map(row => ({ ...row, reason: row.error }))} reasonKey="reason" x={x}
      y={{ key: 'ampacity', label: '允许电流', unit: 'A', format: value => fixed(value) }} at={at} limit={load === null ? undefined : { value: load, label: `保存负荷 ${compact(load)} A` }} />
    : <CurveChart className="h-full min-h-64" data={rows.map(row => ({ ...row, reason: row.runaway ?? row.error }))} reasonKey="reason" x={x}
      y={{ key: 'conductor', label: '导体温度', unit: '°C', format: value => fixed(value) }} at={at} limit={limit === null ? undefined : { value: limit, label: `限值 ${fixed(limit, 0)} °C` }} />;

  return <Split panes={[
    { id: 'curve', size: 62, min: 40, children: <Panel title={shown === 'ampacity' ? '允许电流' : `${atLoad}的导体温度`}
        tools={<ToggleGroup value={[shown]} onValueChange={next => next[0] && setShown(next[0] as typeof shown)} size="sm" aria-label="曲线">
          <ToggleGroupItem value="ampacity">允许电流</ToggleGroupItem>
          <ToggleGroupItem value="conductor">导体温度</ToggleGroupItem>
        </ToggleGroup>}
        bodyClassName="flex px-4 pt-4 pb-2">
        {chart(shown)}
      </Panel> },
    { id: 'numbers', size: 38, min: 28, children: <Panel title="各点数值" tools={<Button variant="ghost" size="sm" onClick={save}><Icon name="action/export" data-icon="inline-start" />导出 CSV</Button>}>
        <div className="grid grid-cols-2 gap-4 border-b border-line px-4 py-4">
          <Metric size="md" label="范围内最低允许电流" value={fixed(lowest?.ampacity)} unit="A" detail={lowest ? `${sweep.label} ${compact(lowest.value)} ${sweep.unit} 时` : undefined} />
          <Metric size="md" label={`${atLoad}最高导体温度`} value={fixed(hottest?.conductor)} unit="°C" detail={limit === null ? undefined : `限值 ${fixed(limit, 0)} °C`} />
        </div>
        <DataTable rows={rows} rowKey={row => String(row.value)} selected={stood === null ? undefined : String(stood)} columns={columns} />
        {refused.length > 0 && <Disclosure title={`方法拒算 ${refused.length} 个点`} defaultOpen>{reasons(refused, row => row.error)}</Disclosure>}
        {runaways.length > 0 && <Disclosure title={`该负荷下无稳态解 ${runaways.length} 个点`}>{reasons(runaways, row => row.runaway)}</Disclosure>}
      </Panel> },
  ]} />;
}
