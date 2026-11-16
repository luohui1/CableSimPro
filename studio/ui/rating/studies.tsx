// The runs besides the rating of one set of conditions: a sweep of one condition and the choice of a section for a target
// current. A form asks for one; the run is saved as a record and opened at its address, where this view shows it.
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SweepCurve } from '@/canvas/sweep-curve';
import { Icon } from '@/kit/icon';
import { TierMark, VerdictMark, type Tier } from '@/kit/marks';
import { DataTable } from '@/kit/workbench/data-table';
import { Panel } from '@/kit/workbench/page';
import { api } from '@/state/api';
import { compact, fixed, KIND_NAMES } from '@shared/format';
import type { ProjectView, RunHeader, RunRecord } from '@shared/types';
import { messageOf } from './edit';
import { FormDialog, NumberField, parseNumber, textOf } from './fields';

// ---- The forms ----

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

export function SweepDialog({ view, onClose, onDone }: { view: ProjectView; onClose: () => void; onDone: (record: RunRecord) => void }) {
  const options = SWEEPS.filter(option => option.now(view) !== null);
  const [variable, setVariable] = useState<SweepVariable>(options[0].key);
  const start = (key: SweepVariable): [string, string] => {
    const option = SWEEPS.find(item => item.key === key)!;
    const [from, to] = option.range(option.now(view) as number);
    return [textOf(round(from)), textOf(round(to))];
  };
  const [from, setFrom] = useState(start(variable)[0]);
  const [to, setTo] = useState(start(variable)[1]);
  const [count, setCount] = useState(String(options[0].points));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const option = SWEEPS.find(item => item.key === variable)!;

  const values = (): number[] | string => {
    const [a, b, n] = [parseNumber(from), parseNumber(to), parseNumber(count)];
    if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return '起点和终点要填数字。';
    if (a === b) return '起点和终点不能相同。';
    if (n === null || !Number.isInteger(n) || n < 2 || n > 50) return '点数要填 2 到 50 之间的整数。';
    if (variable !== 'ambient_temperature_c' && variable !== 'current_a' && (a <= 0 || b <= 0)) return `${option.label}要大于 0。`;
    if (variable === 'current_a' && (a < 0 || b < 0)) return '负荷电流不能小于 0。';
    return Array.from({ length: n }, (_, index) => Number((a + ((b - a) * index) / (n - 1)).toPrecision(10)));
  };
  const planned = values();
  const submit = async () => {
    if (typeof planned === 'string') return setError(planned);
    setBusy(true);
    setError(null);
    try {
      onDone(await api.op<RunRecord>('run.sweep', { project: view.meta.id, variable, values: planned }));
    } catch (failure) {
      setError(messageOf(failure));
      setBusy(false);
    }
  };
  return <FormDialog title="扫一个条件" description="只改变一个量，逐点算允许电流，存成一条运行记录；工程里的条件不变。" wide applyLabel="运行扫描" busy={busy} error={error} onClose={onClose} onSubmit={() => void submit()}>
    <ToggleGroup aria-label="扫哪个条件" className="flex-wrap" value={[variable]} onValueChange={next => {
      const key = next[0] as SweepVariable | undefined;
      if (!key) return;
      setVariable(key);
      const [low, high] = start(key);
      setFrom(low);
      setTo(high);
      setCount(String(SWEEPS.find(item => item.key === key)!.points));
    }}>
      {options.map(item => <ToggleGroupItem key={item.key} value={item.key}>{item.label}</ToggleGroupItem>)}
    </ToggleGroup>
    <div className="grid grid-cols-3 gap-4">
      <NumberField autoFocus label="起点" unit={option.unit} value={from} onChange={setFrom} />
      <NumberField label="终点" unit={option.unit} value={to} onChange={setTo} />
      <NumberField label="点数" value={count} onChange={setCount} />
    </div>
    <p className="m-0 text-sm text-ink-2">
      {typeof planned === 'string' ? planned : `共 ${planned.length} 点：${planned.slice(0, 6).map(value => compact(value)).join('、')}${planned.length > 6 ? ' …' : ''} ${option.unit}`}
    </p>
  </FormDialog>;
}

export function SelectionDialog({ view, onClose, onDone }: { view: ProjectView; onClose: () => void; onDone: (record: RunRecord) => void }) {
  const [target, setTarget] = useState(textOf(view.parts.conditions.currents_a[0]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const value = parseNumber(target);
    if (value === null || !Number.isFinite(value) || value <= 0) return setError('目标电流要填大于 0 的数。');
    setBusy(true);
    setError(null);
    try {
      onDone(await api.op<RunRecord>('run.select', { project: view.meta.id, target_current_a: value }));
    } catch (failure) {
      setError(messageOf(failure));
      setBusy(false);
    }
  };
  return <FormDialog title="按目标电流选截面" description="在现在的敷设和工况下，把同一系列的型号逐个算允许电流，选出带得动目标电流的最小截面，存成一条运行记录。"
    applyLabel="运行选型" busy={busy} error={error} onClose={onClose} onSubmit={() => void submit()}>
    <NumberField autoFocus label="目标电流" unit="A" value={target} onChange={setTarget} />
  </FormDialog>;
}

// ---- The records ----

const when = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

/** Every record of the project, newest first: one is opened by choosing it. */
export function RunsDialog({ runs, shown, current, onOpen, onClose }: { runs: RunHeader[]; shown?: string; current: string; onOpen: (run: string) => void; onClose: () => void }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>运行记录</DialogTitle>
        <DialogDescription>每次运行都存成一条不可改的记录。选一条，按它当时的条件和结果来看。</DialogDescription>
      </DialogHeader>
      <div className="flex max-h-96 min-h-0 flex-col overflow-hidden rounded-field border border-line">
        <DataTable rowKey={run => run.id} rows={runs} selected={shown} onSelect={run => onOpen(run.id)} columns={[
          { key: 'sequence', header: '序号', width: 'w-16', cell: run => `#${run.sequence}` },
          { key: 'kind', header: '类型', width: 'w-20', cell: run => KIND_NAMES[run.kind] ?? run.kind },
          { key: 'title', header: '结果', cell: run => <span className="font-medium">{run.title.includes(' · ') ? run.title.slice(run.title.indexOf(' · ') + 3) : run.title}</span> },
          { key: 'inputs', header: '条件', width: 'w-28', cell: run => (run.inputs_sha256 === current ? <span className="text-ink-2">与现在相同</span> : <Badge variant="attention">条件已改</Badge>) },
          { key: 'tier', header: '分档', width: 'w-24', cell: run => (run.tier ? <TierMark tier={run.tier as Tier} /> : <span className="text-ink-2">—</span>) },
          { key: 'created', header: '时间', width: 'w-28', cell: run => when(run.created) },
          { key: 'by', header: '发起', width: 'w-20', cell: run => (run.by === 'agent' ? 'Agent' : '工程师') },
        ]} />
      </div>
    </DialogContent>
  </Dialog>;
}

export function SweepView({ record }: { record: RunRecord }) {
  const sweep = record.sweep as NonNullable<RunRecord['sweep']>;
  const [active, setActive] = useState<number>();
  const loads = record.inputs.conditions.currents_a;
  // The saved load is drawn against the curve when the sweep leaves it alone and every circuit carries the same.
  const load = sweep.variable !== 'current_a' && loads.every(value => value === loads[0]) ? loads[0] : undefined;
  const rows = sweep.points.map((point, index) => ({ ...point, index }));
  return <div className="flex min-h-0 flex-1">
    <Panel title={`${sweep.label}变化时的允许电流`} className="min-w-0 flex-1" bodyClassName="relative bg-canvas">
      <SweepCurve points={sweep.points.map(point => ({ value: point.value, ampacity: point.ampacity_a ?? null }))} xLabel={`${sweep.label} ${sweep.unit}`} load={load} active={active} onActive={setActive} />
    </Panel>
    <Panel title={`${sweep.points.length} 个点`} className="w-112 flex-none border-l border-line">
      <DataTable rowKey={row => row.case_id} rows={rows} selected={active === undefined ? undefined : rows[active]?.case_id} onSelect={row => setActive(row.index)} columns={[
        { key: 'value', header: sweep.label, unit: sweep.unit, numeric: true, width: 'w-32', cell: row => compact(row.value) },
        { key: 'ampacity', header: '允许电流', unit: 'A', numeric: true, width: 'w-28', cell: row => <span className="font-medium">{fixed(row.ampacity_a)}</span> },
        { key: 'hottest', header: '最热导体', unit: '°C', numeric: true, width: 'w-28', cell: row => (row.operating_error ? '无稳态解' : fixed(row.hottest_conductor_c)) },
        { key: 'note', header: '说明', cell: row => {
          const message = row.error?.message ?? row.operating_error?.message;
          if (message) return <span title={message} className="text-attention-ink">{row.error ? '算不出' : '无稳态解'}</span>;
          return row.within_limit === false ? <span className="text-attention-ink">保存负荷超温限</span> : null;
        } },
      ]} />
    </Panel>
  </div>;
}

export function SelectionView({ record, cable, adopting, onAdopt }: { record: RunRecord; cable: string; adopting: boolean; onAdopt: (model: string) => void }) {
  const selection = record.selection as NonNullable<RunRecord['selection']>;
  const chosen = selection.candidates.find(candidate => candidate.model_id === selection.chosen);
  return <Panel title={`按 ${compact(selection.target_current_a)} A 选截面`} className="min-w-0 flex-1"
    tools={chosen && chosen.model_id !== cable ? <Button variant="outline" size="sm" disabled={adopting} onClick={() => onAdopt(chosen.model_id)}><Icon name="action/replace" data-icon="inline-start" />改用这个型号</Button> : undefined}>
    <div className="flex flex-col gap-1 border-b border-line px-6 py-4">
      <h2 className="m-0 text-h2 text-ink">{chosen ? `选中 ${chosen.name}` : '没有满足目标电流的型号'}</h2>
      <p className="m-0 text-sm text-ink-2">{chosen ? selection.rule : selection.reason ?? selection.rule}</p>
    </div>
    <DataTable rowKey={candidate => candidate.case_id} rows={selection.candidates} selected={chosen?.case_id} columns={[
      { key: 'name', header: '型号', cell: candidate => <span className="flex items-center gap-2 font-medium">{candidate.name}{candidate.model_id === selection.chosen && <Badge variant="selected">选中</Badge>}</span> },
      { key: 'area', header: '截面', unit: 'mm²', numeric: true, width: 'w-28', cell: candidate => compact(candidate.area_mm2) },
      { key: 'ampacity', header: '允许电流', unit: 'A', numeric: true, width: 'w-32', cell: candidate => <span className="font-medium">{fixed(candidate.ampacity_a)}</span> },
      { key: 'margin', header: '余量', unit: 'A', numeric: true, width: 'w-28', cell: candidate => fixed(candidate.margin_a) },
      { key: 'target', header: '带目标电流时导体', unit: '°C', numeric: true, width: 'w-44', cell: candidate => (candidate.at_target_error ? '无稳态解' : fixed(candidate.conductor_at_target_c)) },
      { key: 'verdict', header: '结论', width: 'w-32', cell: candidate => (candidate.error
        ? <span title={candidate.error.message}><VerdictMark verdict="missing" /></span>
        : <VerdictMark verdict={candidate.meets_target ? 'passed' : 'failed'} />) },
    ]} />
  </Panel>;
}
