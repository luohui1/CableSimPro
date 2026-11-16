// The choice of a section for a target current: the dialog that asks for the target, and the screen that reads the answer: every
// size of the series against the target in one table, and at the side the one the rule chose. A size the method refused, or
// could not find a steady state for at the target, says so in the method's words.
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Disclosure } from '@/kit/disclosure';
import { Icon } from '@/kit/icon';
import { ReviewMark, type Review } from '@/kit/marks';
import { LimitMeter, Metric } from '@/kit/metric';
import { TargetBar } from '@/kit/workbench/chart';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { FormRow, UnitInput } from '@/kit/workbench/form';
import { Panel } from '@/kit/workbench/page';
import { api } from '@/state/api';
import { compact, fixed } from '@shared/format';
import type { Candidate, ProjectView, RunRecord } from '@shared/types';
import { FormDialog } from './fields';
import { messageOf } from './messages';
import { limitOf } from './rating';

export function SelectionDialog({ view, onClose, onDone }: { view: ProjectView; onClose: () => void; onDone: (record: RunRecord) => void | Promise<void> }) {
  const [target, setTarget] = useState<number | null>(view.parts.conditions.currents_a[0] ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (target === null || !Number.isFinite(target) || target <= 0) return setError('目标电流要填大于 0 的数。');
    setBusy(true);
    setError(null);
    try {
      await onDone(await api.op<RunRecord>('run.select', { project: view.meta.id, target_current_a: target }));
    } catch (failure) {
      setError(messageOf(failure));
      setBusy(false);
    }
  };
  return <FormDialog title="按电流选型" description="在现在的敷设和工况下，把同一系列的型号逐个算允许电流，选出带得动目标电流的最小截面，存成一条运行记录。"
    applyLabel="运行选型" busy={busy} error={error} onClose={onClose} onSubmit={() => void submit()}>
    <FormRow label="目标电流" htmlFor="selection-target"><UnitInput id="selection-target" unit="A" value={target} onValueChange={setTarget} /></FormRow>
  </FormDialog>;
}

/** The size as the series writes it: the last word of the name (3×240). */
const sizeOf = (candidate: Candidate) => candidate.name.split(' ').pop() ?? candidate.name;

function verdict(candidate: Candidate, chosen: string | null) {
  if (candidate.error) return { tone: 'error' as const, word: '拒算' };
  if (candidate.model_id === chosen) return { tone: 'selected' as const, word: '选定' };
  return candidate.meets_target ? { tone: 'secondary' as const, word: '满足' } : { tone: 'outline' as const, word: '不足' };
}

/** The two panels of a selection: the table of sizes, and what the rule chose. The caller gives them their row. */
export function SelectionScreen({ record, cable, reviewOf, onAdopt }: {
  record: RunRecord;
  /** The cable the project has now. */
  cable: string;
  /** Where a size's latest version stands in review, when the library says. */
  reviewOf: (model: string) => Review | undefined;
  /** Take the chosen size over as the project's cable (a change waiting in the editor, not yet applied). */
  onAdopt: (model: string) => void;
}) {
  const selection = record.selection as NonNullable<RunRecord['selection']>;
  const { target_current_a: target, candidates, chosen: chosenId } = selection;
  const chosen = candidates.find(candidate => candidate.model_id === chosenId);
  const limit = limitOf(record.inputs);
  // The bar's full length: the largest size's current, or the target if that is larger.
  const scale = Math.max(target, ...candidates.map(candidate => candidate.ampacity_a ?? 0));
  const refused = candidates.filter(candidate => candidate.error);
  const unsolved = candidates.filter(candidate => candidate.at_target_error);

  const columns: Column<Candidate>[] = [
    { key: 'size', header: '规格', width: 'w-24', cell: candidate => <span className="font-medium">{sizeOf(candidate)}</span> },
    { key: 'ampacity', header: '允许电流', unit: 'A', numeric: true, width: 'w-28', cell: candidate => (typeof candidate.ampacity_a === 'number' ? fixed(candidate.ampacity_a) : '—') },
    { key: 'bar', header: `对比 ${compact(target)} A`, width: 'w-48', cell: candidate => (typeof candidate.ampacity_a !== 'number' ? null
      : <TargetBar value={candidate.ampacity_a} target={target} max={scale} tone={candidate.model_id === chosenId ? 'chosen' : candidate.meets_target ? 'meets' : 'short'} />) },
    { key: 'margin', header: '比目标', unit: 'A', numeric: true, width: 'w-28', cell: candidate => (typeof candidate.margin_a !== 'number' ? '—'
      : `${candidate.margin_a >= 0 ? '+' : '−'}${fixed(Math.abs(candidate.margin_a))}`) },
    { key: 'conductor', header: `${compact(target)} A 时导体`, unit: '°C', numeric: true, width: 'w-36', cell: candidate => (typeof candidate.conductor_at_target_c === 'number'
      ? <span className={limit !== null && candidate.conductor_at_target_c > limit ? 'text-error' : undefined}>{fixed(candidate.conductor_at_target_c)}</span>
      : candidate.at_target_error ? <Tooltip><TooltipTrigger render={<span tabIndex={0} className="text-ink-2">无稳态解</span>} /><TooltipContent>{candidate.at_target_error.message}</TooltipContent></Tooltip> : '—') },
    { key: 'verdict', header: '结论', width: 'w-24', cell: candidate => {
      const mark = verdict(candidate, chosenId);
      const badge = <Badge variant={mark.tone} tabIndex={candidate.error ? 0 : undefined}>{mark.word}</Badge>;
      return candidate.error ? <Tooltip><TooltipTrigger render={badge} /><TooltipContent>{candidate.error.message}</TooltipContent></Tooltip> : badge;
    } },
  ];

  const list = (items: Candidate[], words: (candidate: Candidate) => string | undefined) => (
    <ul className="m-0 flex list-none flex-col gap-3 px-4 pb-4">
      {items.map(candidate => <li key={candidate.case_id} className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">{sizeOf(candidate)}</span>
        <span className="text-ink">{words(candidate)}</span>
      </li>)}
    </ul>
  );
  const review = chosen ? reviewOf(chosen.model_id) : undefined;

  return <>
    <Panel title={`${candidates.length} 个规格对比 ${compact(target)} A`}>
      <DataTable rows={candidates} rowKey={candidate => candidate.model_id} selected={chosenId ?? undefined} columns={columns} />
    </Panel>
    <Panel title="结论" className="w-80 flex-none border-l border-line"
      tools={chosen && chosen.model_id !== cable ? <Button variant="outline" size="sm" onClick={() => onAdopt(chosen.model_id)}><Icon name="action/replace" data-icon="inline-start" />改用这个型号</Button> : undefined}>
      <div className="flex flex-col gap-4 border-b border-line px-4 py-4">
        <Metric label="选定规格" value={chosen ? sizeOf(chosen) : '—'} detail={chosen ? (review && <ReviewMark state={review} />) : '没有型号带得动目标电流'} />
        {chosen && <>
          <div className="grid grid-cols-2 gap-4">
            <Metric size="sm" label="允许电流" value={fixed(chosen.ampacity_a)} unit="A" />
            <Metric size="sm" label={`比目标 ${compact(target)} A`} value={typeof chosen.margin_a === 'number' ? `${chosen.margin_a >= 0 ? '+' : '−'}${fixed(Math.abs(chosen.margin_a))}` : '—'} unit="A" />
          </div>
          {typeof chosen.conductor_at_target_c === 'number' && limit !== null
            && <LimitMeter label={`${compact(target)} A 时导体温度`} value={chosen.conductor_at_target_c} limit={limit} from={record.inputs.conditions.ambient_temperature_c} unit="°C" />}
        </>}
      </div>
      <Disclosure title="选型规则" defaultOpen><p className="m-0 px-4 pb-4 text-sm text-ink">{chosen ? selection.rule : selection.reason ?? selection.rule}</p></Disclosure>
      {unsolved.length > 0 && <Disclosure title={`${compact(target)} A 下没有稳态解 ${unsolved.length} 个`}>
        {list(unsolved, candidate => candidate.at_target_error?.message)}
      </Disclosure>}
      {refused.length > 0 && <Disclosure title={`方法拒算 ${refused.length} 个`} defaultOpen>
        {list(refused, candidate => candidate.error?.message)}
      </Disclosure>}
    </Panel>
  </>;
}
