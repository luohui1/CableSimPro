// A task done in steps on one screen (import a table, create a type from a standard): the steps down the left with what
// each settled, the current step's work on the right, and the way forward at the bottom.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from '../icon';

export type FlowStepStatus = 'done' | 'current' | 'upcoming' | 'error';
export interface FlowStep { title: string; status: FlowStepStatus; /** What the step settled, once done: 表3 YJV22. */ detail?: ReactNode }

export function Stepper({ steps, label }: { steps: FlowStep[]; label: string }) {
  return <ol aria-label={label} className="m-0 flex list-none flex-col p-0">
    {steps.map((step, index) => <li key={step.title} aria-current={step.status === 'current' ? 'step' : undefined} data-status={step.status}
      className="group relative flex gap-3 pb-6 last:pb-0">
      {index < steps.length - 1 && <span aria-hidden="true" className={cn('absolute top-8 bottom-0 left-3 w-px', step.status === 'done' ? 'bg-ink-3' : 'bg-line')} />}
      <span className={cn('relative flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
        step.status === 'done' && 'border-ink bg-ink text-surface',
        step.status === 'current' && 'border-copper bg-copper-fill text-copper',
        step.status === 'upcoming' && 'border-line-strong bg-surface text-ink-2',
        step.status === 'error' && 'border-error bg-error-fill text-error')}>
        {step.status === 'done' ? <Icon name="action/check" className="size-3.5" /> : step.status === 'error' ? <Icon name="status/error" className="size-3.5" /> : index + 1}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={cn('text-sm', step.status === 'current' ? 'font-semibold text-ink' : step.status === 'upcoming' ? 'text-ink-2' : 'text-ink')}>
          {step.title}<span className="sr-only">（{{ done: '已完成', current: '当前步', upcoming: '未开始', error: '出错' }[step.status]}）</span>
        </span>
        {step.detail && <span className="truncate text-sm text-ink-2">{step.detail}</span>}
      </span>
    </li>)}
  </ol>;
}

/** The screen of a stepped task: the steps in a column on the ground, the work on the surface, the way forward under it. */
export function FlowLayout({ steps, children, footer, className }: { steps: ReactNode; children: ReactNode; footer: ReactNode; className?: string }) {
  return <div className={cn('flex min-h-0 flex-1', className)}>
    <aside className="w-64 shrink-0 border-r border-line bg-canvas px-6 py-6">{steps}</aside>
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">{children}</div>
      <footer className="flex h-16 shrink-0 items-center justify-end gap-2 border-t border-line px-8">{footer}</footer>
    </div>
  </div>;
}
