// A conversation with nothing in it yet: what can be handed over, in one sentence; the composer; and real tasks to start
// from, grouped by the two things the product does. Each group is a tile with the product's own drawing of it (the section
// of a cable, a cable in the warmth of its soil) and what the library holds; a task is a button: one click sends it.
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon, ProductMark } from '../icon';

export function AgentEmpty({ title, lead, composer, groups, notice, className }: {
  title: string;
  /** One sentence: what the Agent can be handed. */
  lead: string;
  composer: ReactNode;
  groups: { label: string; icon: string; tasks: ReactNode; figure?: ReactNode; facts?: ReactNode }[];
  /** Something that stops the Agent from working (no model configured), above the composer. */
  notice?: ReactNode;
  className?: string;
}) {
  return <div className={cn('mx-auto my-auto flex w-full max-w-thread flex-col gap-6 px-6', className)}>
    <div className="flex flex-col items-center gap-3 text-center">
      <ProductMark className="hidden size-10 2xl:block" />
      <h1 className="m-0 text-display text-ink">{title}</h1>
      <p className="m-0 text-prose text-balance text-ink-2">{lead}</p>
    </div>
    <div className="flex flex-col gap-3">
      {notice}
      {composer}
    </div>
    <div className="grid grid-cols-2 gap-4">
      {groups.map(group => group.figure
        ? <section key={group.label} className="flex min-w-0 flex-col overflow-hidden rounded-sheet border border-line bg-surface" aria-label={group.label}>
          <header className="relative flex h-24 items-center overflow-hidden border-b border-line bg-canvas">
            <div aria-hidden="true" className="absolute inset-y-0 right-0 w-48 fade-start">{group.figure}</div>
            <div className="relative flex min-w-0 flex-col gap-2 px-4">
              <h2 className="m-0 flex items-center gap-2 text-h3 text-ink"><Icon name={group.icon} className="text-ink-2" />{group.label}</h2>
              {group.facts && <div className="flex flex-col gap-1 text-sm text-ink-2">{group.facts}</div>}
            </div>
          </header>
          <div className="flex flex-col gap-1 p-2">{group.tasks}</div>
        </section>
        : <section key={group.label} className="flex min-w-0 flex-col gap-2" aria-label={group.label}>
          <h2 className="m-0 flex items-center gap-2 px-3 text-xs font-medium text-ink-2"><Icon name={group.icon} />{group.label}</h2>
          <div className="flex flex-col gap-1">{group.tasks}</div>
        </section>)}
    </div>
  </div>;
}

/**
 * The line at the foot of the empty conversation: what the work stands on (the standards, what the library holds, the
 * methods and their versions), each a label and its value, the last one giving way when the line is short.
 */
export function EmptyStatus({ facts }: { facts: { label: string; value: ReactNode }[] }) {
  return <dl className="m-0 flex h-10 shrink-0 items-center gap-6 overflow-hidden border-t border-line px-6 text-sm whitespace-nowrap">
    {facts.map(fact => <div key={fact.label} className="flex min-w-0 shrink-0 items-center gap-2 last:shrink">
      <dt className="shrink-0 text-ink-2">{fact.label}</dt>
      <dd className="m-0 truncate text-ink" title={typeof fact.value === 'string' ? fact.value : undefined}>{fact.value}</dd>
    </div>)}
  </dl>;
}

/** A fact in a tile: the number in ink, the words around it in the secondary colour (10 个系列, 最近一次校核 458.7 A). */
export function TileFact({ value, before, children }: { value: ReactNode; before?: ReactNode; children?: ReactNode }) {
  return <span>{before && <>{before} </>}<span className="font-semibold text-ink tabular-nums">{value}</span>{children && <> {children}</>}</span>;
}

/** One task to start from: an icon, what it asks for, and what comes back. */
export function TaskStarter({ icon, title, result, className, ...props }: { icon: string; title: string; result: string } & ComponentProps<'button'>) {
  return <button type="button"
    className={cn('group flex w-full min-w-0 items-center gap-3 rounded-card px-3 py-2 text-left outline-none transition-colors duration-fast hover:bg-subtle focus-visible:ring-3 focus-visible:ring-ring', className)}
    {...props}>
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-2 transition-colors duration-fast group-hover:text-ink"><Icon name={icon} /></span>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-sm font-medium text-ink">{title}</span>
      <span className="truncate text-sm text-ink-2">{result}</span>
    </span>
    <Icon name="action/arrow-right" className="text-ink-3 opacity-0 transition-opacity duration-fast group-hover:opacity-100" />
  </button>;
}

/** A notice in the conversation column: no model configured, a run that cannot start. */
export function ChatNotice({ tone = 'attention', children }: { tone?: 'attention' | 'error'; children: ReactNode }) {
  return <div role="alert" className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-sm text-ink', tone === 'error' ? 'bg-error-fill' : 'bg-attention-fill')}>
    <Icon name={tone === 'error' ? 'status/error' : 'status/warning'} className={cn('mt-1', tone === 'error' ? 'text-error' : 'text-attention')} />
    <div className="min-w-0">{children}</div>
  </div>;
}
