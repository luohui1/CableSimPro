// A conversation with nothing in it yet: what can be handed over, in one sentence; the composer; and real tasks to start
// from, grouped by the two things the product does. A task is a button: one click sends it.
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon, ProductMark } from '../icon';

export function AgentEmpty({ title, lead, composer, groups, notice, className }: {
  title: string;
  /** One sentence: what the Agent can be handed. */
  lead: string;
  composer: ReactNode;
  groups: { label: string; icon: string; tasks: ReactNode }[];
  /** Something that stops the Agent from working (no model configured), above the composer. */
  notice?: ReactNode;
  className?: string;
}) {
  return <div className={cn('mx-auto flex w-full max-w-thread flex-col gap-8 px-6', className)}>
    <div className="flex flex-col items-center gap-3 text-center">
      <ProductMark className="size-10" />
      <h1 className="m-0 text-display text-ink">{title}</h1>
      <p className="m-0 text-prose text-balance text-ink-2">{lead}</p>
    </div>
    <div className="flex flex-col gap-3">
      {notice}
      {composer}
    </div>
    <div className="grid grid-cols-2 gap-6">
      {groups.map(group => <section key={group.label} className="flex min-w-0 flex-col gap-2" aria-label={group.label}>
        <h2 className="m-0 flex items-center gap-2 px-3 text-xs font-medium text-ink-2"><Icon name={group.icon} />{group.label}</h2>
        <div className="flex flex-col gap-1">{group.tasks}</div>
      </section>)}
    </div>
  </div>;
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
