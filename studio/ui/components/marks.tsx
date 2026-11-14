// Marks that state a fact about a result. Two shapes, two meanings:
// Seal: the trust tier of the method. Always shown. A square stamp with a double line.
// Badge: something the engineer has to deal with (stale, failed). Shown only then. A filled tag.
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const TIER: Record<string, string> = {
  deliverable: 'border-success text-success',
  reference: 'border-ink-2 text-ink-2',
  exploratory: 'border-dashed border-ink-3 text-ink-3',
};

export function Seal({ tier, label, className }: { tier: string; label: string; className?: string }) {
  return <span data-seal={tier}
    className={cn('inline-flex h-6 shrink-0 items-center rounded-none border px-2 text-13 font-strong tracking-[.12em] shadow-[inset_0_0_0_2px_var(--panel),inset_0_0_0_3px_currentColor]',
      TIER[tier] ?? TIER.exploratory, className)}>
    {label}
  </span>;
}

const BADGE = {
  attention: 'bg-[color-mix(in_oklab,var(--attention)_14%,var(--panel))] text-attention',
  error: 'bg-[color-mix(in_oklab,var(--error)_12%,var(--panel))] text-error',
  agent: 'bg-agent-fill text-agent',
  ink: 'bg-ink text-panel',
} as const;

export function Badge({ tone, className, children }: { tone: keyof typeof BADGE; className?: string; children: ReactNode }) {
  return <span className={cn('inline-flex h-6 shrink-0 items-center rounded-chip px-2 text-13 font-strong whitespace-nowrap', BADGE[tone], className)}>{children}</span>;
}

/** Label and value pairs on one grid: labels left, values right, numbers aligned. */
export function Facts({ rows, className }: { rows: { label: string; value: ReactNode }[]; className?: string }) {
  return <dl className={cn('grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5', className)}>
    {rows.map(row => <div key={row.label} className="contents">
      <dt className="text-13 text-ink-2">{row.label}</dt>
      <dd className="m-0 text-right text-14 text-ink">{row.value}</dd>
    </div>)}
  </dl>;
}

/** A value on a scale that ends at a limit. The limit is a tick; the fill never passes it silently. */
export function Meter({ value, min, max, colour, className }: { value: number; min: number; max: number; colour?: string; className?: string }) {
  const share = Math.max(0, Math.min(1, (value - min) / Math.max(1e-9, max - min)));
  const over = value > max;
  return <div className={cn('relative h-1.5 rounded-full bg-fill', className)} role="meter" aria-valuenow={value} aria-valuemin={min} aria-valuemax={max}>
    <div className="h-full rounded-full transition-[width] duration-slow ease-std" style={{ width: `${share * 100}%`, background: over ? 'var(--error)' : colour ?? 'var(--text)' }} />
    <div className="absolute -top-1 right-0 h-3.5 w-0.5 rounded-full bg-ink" />
  </div>;
}

export const SectionTitle = ({ children, aside }: { children: ReactNode; aside?: ReactNode }) =>
  <div className="mb-3 flex items-baseline justify-between gap-4">
    <h3 className="m-0 text-14 font-strong text-ink">{children}</h3>
    {aside && <span className="text-14 text-ink">{aside}</span>}
  </div>;
