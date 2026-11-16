// Where a version stands in review, and the one step a person can take from there. The four states run down a column; the
// ones reached carry who and when, and what was said. Review is a person's act: the Agent never gets these buttons. The
// steps follow the host's table: submit from a draft, return from submitted or reviewed, approve from submitted, publish
// from reviewed; a published version is not changed, a change makes the next version.
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Icon } from '../icon';
import { ReviewMark, type Review } from '../marks';

export interface ReviewStamp { at: string; by: string; note?: string }

const STAGES: { state: Review; label: string; stamp?: 'submitted' | 'reviewed' | 'published' }[] = [
  { state: 'draft', label: '草稿' },
  { state: 'submitted', label: '待审核', stamp: 'submitted' },
  { state: 'reviewed', label: '已审核', stamp: 'reviewed' },
  { state: 'published', label: '已发布', stamp: 'published' },
];
const ORDER: Record<Review, number> = { draft: 0, submitted: 1, reviewed: 2, published: 3 };

/** `when` formats a stamp's time the way the screen writes times. */
export function ReviewTrack({ state, created, stamps, when }: {
  state: Review;
  created: string;
  stamps: Partial<Record<'submitted' | 'reviewed' | 'published', ReviewStamp>>;
  when: (iso: string) => string;
}) {
  return <ol aria-label="审核进度" className="m-0 flex list-none flex-col p-0">
    {STAGES.map((stage, index) => {
      const reached = ORDER[stage.state] <= ORDER[state];
      const stamp = stage.stamp ? stamps[stage.stamp] : undefined;
      const published = stage.state === 'published' && reached;
      return <li key={stage.state} data-reached={reached || undefined} aria-current={stage.state === state ? 'step' : undefined}
        className="relative flex gap-3 pb-5 last:pb-0">
        {index < STAGES.length - 1 && <span aria-hidden="true" className={cn('absolute top-7 bottom-1 left-3 w-px', ORDER[stage.state] < ORDER[state] ? 'bg-ink-3' : 'bg-line')} />}
        <span className={cn('relative flex size-6 shrink-0 items-center justify-center rounded-full border',
          published ? 'border-success bg-success-fill text-success' : reached ? 'border-ink bg-ink text-surface' : 'border-line-strong bg-surface')}>
          {reached && <Icon name="action/check" className="size-3.5" />}
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className={cn('text-sm', stage.state === state ? 'font-semibold text-ink' : reached ? 'text-ink' : 'text-ink-2')}>{stage.label}</span>
          {(stage.state === 'draft' || stamp) && <span className="text-sm text-ink-2 tabular-nums">
            {stage.state === 'draft' ? `建于 ${when(created)}` : `${stamp!.by} · ${when(stamp!.at)}`}
          </span>}
          {stamp?.note && <span className="text-sm text-ink">“{stamp.note}”</span>}
        </span>
      </li>;
    })}
  </ol>;
}

/** The step a person can take from a state: one primary, and the way back when there is one. */
export function ReviewActions({ state, onSubmit, onApprove, onReturn, onPublish, onRevise, extra, busy }: {
  state: Review;
  onSubmit?: () => void;
  onApprove?: () => void;
  onReturn?: () => void;
  onPublish?: () => void;
  /** A published version is not changed: a change makes the next version. */
  onRevise?: () => void;
  /** Before the buttons: a note field when the step takes one. */
  extra?: ReactNode;
  /** A step is on its way to the host: the buttons wait for it. */
  busy?: boolean;
}) {
  return <div className="flex flex-wrap items-center gap-2">
    {extra}
    {state === 'draft' && <Button onClick={onSubmit} disabled={busy}><Icon name="agent/checkpoint" data-icon="inline-start" />提交审核</Button>}
    {state === 'submitted' && <><Button variant="outline" onClick={onReturn} disabled={busy}>退回修改</Button><Button onClick={onApprove} disabled={busy}><Icon name="agent/approve" data-icon="inline-start" />审核通过</Button></>}
    {state === 'reviewed' && <><Button variant="outline" onClick={onReturn} disabled={busy}>退回修改</Button><Button onClick={onPublish} disabled={busy}><Icon name="action/publish" data-icon="inline-start" />发布</Button></>}
    {state === 'published' && <Button variant="outline" onClick={onRevise} disabled={busy}><Icon name="action/edit" data-icon="inline-start" />出新版本</Button>}
  </div>;
}

/** Which version of a specification the page shows, beside its title: 第 3 版, and the others with their review state. */
export function VersionSelect({ value, versions, onValueChange }: {
  value: number;
  versions: { number: number; review: Review }[];
  onValueChange?: (number: number) => void;
}) {
  const items = versions.map(version => ({ value: String(version.number), label: `第 ${version.number} 版` }));
  return <Select value={String(value)} items={items} onValueChange={next => onValueChange?.(Number(next))}>
    <SelectTrigger size="sm" aria-label="版本"><SelectValue /></SelectTrigger>
    <SelectContent alignItemWithTrigger={false} align="start">
      {versions.map(version => <SelectItem key={version.number} value={String(version.number)}>
        <span className="flex min-w-36 items-center justify-between gap-3">第 {version.number} 版<ReviewMark state={version.review} /></span>
      </SelectItem>)}
    </SelectContent>
  </Select>;
}

/**
 * The size shown in a series' workspace, switched to another of the same series without going back to the library: typed
 * into (Base UI Combobox: 3×1 finds 3×120, 3×150, 3×185), or stepped to the neighbour with the arrows. Each size in the list
 * carries where its latest version stands in review, quietly.
 */
export function SpecSwitch({ value, specs, onValueChange }: {
  value: string;
  specs: { key: string; review: Review }[];
  onValueChange?: (key: string) => void;
}) {
  const at = specs.findIndex(spec => spec.key === value);
  const review = Object.fromEntries(specs.map(spec => [spec.key, spec.review]));
  return <div className="flex items-center gap-1">
    <Button variant="ghost" size="icon-sm" aria-label="上一个规格" disabled={at <= 0} onClick={() => onValueChange?.(specs[at - 1].key)}><Icon name="action/chevron-left" /></Button>
    <Combobox items={specs.map(spec => spec.key)} value={value} onValueChange={next => next && onValueChange?.(next as string)}>
      <ComboboxInput aria-label="规格" className="w-32" />
      <ComboboxContent className="w-auto">
        <ComboboxEmpty>这个系列没有这个规格</ComboboxEmpty>
        <ComboboxList>{(key: string) => <ComboboxItem key={key} value={key}>
          <span className="flex min-w-36 items-center justify-between gap-3">{key}<ReviewMark state={review[key]} quiet /></span>
        </ComboboxItem>}</ComboboxList>
      </ComboboxContent>
    </Combobox>
    <Button variant="ghost" size="icon-sm" aria-label="下一个规格" disabled={at < 0 || at >= specs.length - 1} onClick={() => onValueChange?.(specs[at + 1].key)}><Icon name="action/chevron-right" /></Button>
  </div>;
}
