// The line above a calculation that says what is asked and what is given. Each given is a field that opens its editor; a
// given that changed since the last run carries a dot, so it is plain why the result is out of date.
import type { ComponentProps, ReactNode } from 'react';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { cn } from '@/lib/utils';
import { Icon } from '../icon';
import { Dot } from '../marks';

export function PremiseStrip({ asked, children, className }: { asked: ReactNode; children: ReactNode; className?: string }) {
  return <div className={cn('flex min-h-14 shrink-0 items-start gap-4 border-b border-line px-6 py-3', className)}>
    <div className="flex h-8 shrink-0 items-center gap-2">
      <span className="text-sm text-ink-2">求</span>
      <span className="text-h3 text-ink">{asked}</span>
    </div>
    <span className="mt-1 h-6 w-px shrink-0 bg-line" aria-hidden="true" />
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1">
      <span className="mr-2 flex h-8 shrink-0 items-center text-sm text-ink-2">已知</span>
      {children}
    </div>
  </div>;
}

/** One given: its name and value. A button: it opens the editor for that value. */
export function Given({ label, value, changed, className, ...props }: { label: string; value: ReactNode; changed?: boolean } & ComponentProps<'button'>) {
  return <button type="button"
    className={cn('flex h-8 shrink-0 items-center gap-2 rounded-field px-2 text-sm whitespace-nowrap outline-none transition-colors duration-fast hover:bg-subtle focus-visible:ring-3 focus-visible:ring-ring', className)}
    {...props}>
    <span className="text-ink-2">{label}</span>
    <span className="font-medium text-ink tabular-nums">{value}</span>
    {changed && <Dot tone="attention" />}
  </button>;
}

/** A screen or panel with nothing to show yet: what goes here, and the one way to put it there. */
export function EmptyState({ icon, title, description, action, className }: { icon: string; title: string; description: string; action?: ReactNode; className?: string }) {
  return <Empty className={className}>
    <EmptyHeader>
      <EmptyMedia variant="icon"><Icon name={icon} /></EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </EmptyHeader>
    {action && <EmptyContent>{action}</EmptyContent>}
  </Empty>;
}
