// Marks state one fact about an object in a word and an icon. Colour never carries the meaning alone.
//   TierMark    how far a method's result can be trusted (可交付 / 参考 / 探索). Shown wherever a result is.
//   ReviewMark  where a version of a type stands in review (草稿 / 待审核 / 已审核 / 已发布).
//   VerdictMark one outcome of a standard check (通过 / 不通过 / 缺项 / 未覆盖), optionally with its count.
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
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

export function ReviewMark({ state, className }: { state: Review; className?: string }) {
  const mark = REVIEW[state];
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

/** A small dot before a name: running work, a live connection. */
export function Dot({ tone = 'ink', pulse, className }: { tone?: 'ink' | 'success' | 'attention' | 'error' | 'agent'; pulse?: boolean; className?: string }) {
  const colour = { ink: 'bg-ink-2', success: 'bg-success', attention: 'bg-attention', error: 'bg-error', agent: 'bg-agent' }[tone];
  return <span aria-hidden="true" className={cn('relative inline-flex size-2 shrink-0 rounded-full', colour, className)}>
    {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full motion-reduce:animate-none', colour)} />}
  </span>;
}

/** A word in the secondary colour that names what follows: 先到温限, 改前. Never a sentence. */
export const Label = ({ children, className }: { children: ReactNode; className?: string }) =>
  <span className={cn('text-sm text-ink-2', className)}>{children}</span>;
