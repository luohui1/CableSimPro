// Marks state one fact about an object in a word and an icon. Colour never carries the meaning alone.
//   TierMark    how far a method's result can be trusted (可交付 / 参考 / 探索). Shown wherever a result is.
//   ReviewMark  where a version of a type stands in review (草稿 / 待审核 / 已审核 / 已发布).
//   VerdictMark one outcome of a standard check (通过 / 不通过 / 缺项 / 未覆盖), optionally with its count.
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Icon } from './icon';

export type Tier = 'deliverable' | 'reference' | 'exploratory';
const TIER: Record<Tier, { label: string; icon: string; variant: 'success' | 'secondary' | 'outline'; meaning: string }> = {
  deliverable: { label: '可交付', icon: 'agent/approve', variant: 'success', meaning: '有公开算例的整链对照，结果可以交付' },
  reference: { label: '参考', icon: 'status/info', variant: 'secondary', meaning: '只有手算或组件级对照，交付前另行核对' },
  exploratory: { label: '探索', icon: 'status/pending', variant: 'outline', meaning: '没有对照算例，只供比较和试算' },
};

export function TierMark({ tier, label, className }: { tier: Tier; label?: string; className?: string }) {
  const mark = TIER[tier];
  return <Badge variant={mark.variant} data-tier={tier} title={mark.meaning} className={cn(tier === 'exploratory' && 'border-dashed', className)}>
    <Icon name={mark.icon} data-icon="inline-start" />{label ?? mark.label}
  </Badge>;
}

export type Review = 'draft' | 'submitted' | 'reviewed' | 'published';
const REVIEW: Record<Review, { label: string; icon: string; variant: 'secondary' | 'attention' | 'outline' | 'success' }> = {
  draft: { label: '草稿', icon: 'action/edit', variant: 'secondary' },
  submitted: { label: '待审核', icon: 'agent/checkpoint', variant: 'attention' },
  reviewed: { label: '已审核', icon: 'action/check', variant: 'outline' },
  published: { label: '已发布', icon: 'action/publish', variant: 'success' },
};

/** `quiet`: in a list where most rows are drafts, the draft is plain text and only the states worth a look are pills. */
export function ReviewMark({ state, quiet, className }: { state: Review; quiet?: boolean; className?: string }) {
  const mark = REVIEW[state];
  if (quiet && state === 'draft') return <span data-review={state} className={cn('inline-flex items-center gap-1 text-sm text-ink-2', className)}>{mark.label}</span>;
  return <Badge variant={mark.variant} data-review={state} className={className}><Icon name={mark.icon} data-icon="inline-start" />{mark.label}</Badge>;
}

export type Verdict = 'passed' | 'failed' | 'missing' | 'uncovered';
export const VERDICT: Record<Verdict, { label: string; icon: string; tone: string }> = {
  passed: { label: '通过', icon: 'agent/approve', tone: 'text-success' },
  failed: { label: '不通过', icon: 'status/error', tone: 'text-error' },
  missing: { label: '缺项', icon: 'status/pending', tone: 'text-attention' },
  uncovered: { label: '未覆盖', icon: 'action/minus', tone: 'text-ink-2' },
};

/** Inline: the icon in its colour, the word in ink. With a count it reads 通过 13. */
export function VerdictMark({ verdict, count, className }: { verdict: Verdict; count?: number; className?: string }) {
  const mark = VERDICT[verdict];
  return <span data-verdict={verdict} className={cn('inline-flex items-center gap-1 text-sm whitespace-nowrap text-ink', className)}>
    <Icon name={mark.icon} className={mark.tone} />
    {mark.label}
    {count !== undefined && <span className="font-semibold tabular-nums">{count}</span>}
  </span>;
}

/**
 * The share of each outcome of a check in one bar (不通过, 通过, 缺项, 未覆盖), the segments parted by a gap, and the counts
 * beside it written out: failures when there are any, the passes, the missing; what is not covered is in the tooltip.
 */
export function VerdictBar({ counts, className }: { counts: Partial<Record<Verdict, number>>; className?: string }) {
  const order: Verdict[] = ['failed', 'passed', 'missing', 'uncovered'];
  const fill: Record<Verdict, string> = { failed: 'fill-error', passed: 'fill-success', missing: 'fill-attention', uncovered: 'fill-line-strong' };
  const total = order.reduce((sum, verdict) => sum + (counts[verdict] ?? 0), 0) || 1;
  let at = 0;
  const failed = counts.failed ?? 0;
  const title = order.filter(verdict => counts[verdict]).map(verdict => `${VERDICT[verdict].label} ${counts[verdict]}`).join('，');
  const shown: Verdict[] = [...(failed > 0 ? ['failed' as const] : []), 'passed', ...((counts.missing ?? 0) > 0 ? ['missing' as const] : [])];
  return <span className={cn('inline-flex items-center gap-3 text-sm whitespace-nowrap tabular-nums', className)} title={title} aria-label={title}>
    <svg viewBox="0 0 64 8" preserveAspectRatio="none" className="h-2 w-12 shrink-0 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
      {order.map(verdict => {
        const width = ((counts[verdict] ?? 0) / total) * 64;
        const bar = width > 0 ? <rect key={verdict} x={at} width={Math.max(0, width - 1.5)} height={8} className={fill[verdict]} /> : null;
        at += width;
        return bar;
      })}
    </svg>
    {shown.map(verdict => <span key={verdict} className={cn('inline-flex items-center gap-1', verdict === 'failed' ? 'text-error' : 'text-ink')}>
      <Icon name={VERDICT[verdict].icon} className={VERDICT[verdict].tone} />{VERDICT[verdict].label} {counts[verdict] ?? 0}
    </span>)}
  </span>;
}

/** A small dot before a name: running work, a live connection. */
export function Dot({ tone = 'ink', pulse, className }: { tone?: 'ink' | 'success' | 'attention' | 'error' | 'agent'; pulse?: boolean; className?: string }) {
  const colour = { ink: 'bg-ink-2', success: 'bg-success', attention: 'bg-attention', error: 'bg-error', agent: 'bg-agent' }[tone];
  return <span aria-hidden="true" className={cn('relative inline-flex size-2 shrink-0 rounded-full', colour, className)}>
    {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full motion-reduce:animate-none', colour)} />}
  </span>;
}

/**
 * A state written in a table cell where a value would be: 拒算, 最热, 与现在相同, 条件已改. A dot in the tone and the word in
 * ink; `detail` (the method's own words for a refusal) opens on hover and on focus.
 */
export function CellStatus({ tone = 'ink', detail, children }: { tone?: 'ink' | 'success' | 'attention' | 'error'; detail?: ReactNode; children: ReactNode }) {
  const word = <span className="inline-flex items-center gap-2 text-sm whitespace-nowrap text-ink"><Dot tone={tone} />{children}</span>;
  if (!detail) return word;
  return <Tooltip>
    <TooltipTrigger render={<button type="button" className="rounded-sm underline decoration-line-strong decoration-dotted underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring" />}>{word}</TooltipTrigger>
    <TooltipContent className="max-w-80">{detail}</TooltipContent>
  </Tooltip>;
}

const LINE: Record<'error' | 'attention' | 'success' | 'info', { icon: string; colour: string }> = {
  error: { icon: 'status/error', colour: 'text-error' },
  attention: { icon: 'status/warning', colour: 'text-attention' },
  success: { icon: 'action/check', colour: 'text-success' },
  info: { icon: 'status/info', colour: 'text-ink-2' },
};

/**
 * A state in a line of text: an icon in the tone, the words in ink (超过温限, 无有效稳态解, 在温限内). For a line inside a
 * panel or a list; a notice that stands on its own is FormNote.
 */
export function StatusLine({ tone, children, className }: { tone: keyof typeof LINE; children: ReactNode; className?: string }) {
  return <p className={cn('m-0 flex items-start gap-2 text-sm text-ink', className)}>
    <span className="flex h-5 shrink-0 items-center"><Icon name={LINE[tone].icon} className={LINE[tone].colour} /></span>
    <span className="min-w-0">{children}</span>
  </p>;
}
