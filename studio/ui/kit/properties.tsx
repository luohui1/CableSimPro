// Name, value, unit: three columns that line up down a whole panel, so a column of numbers reads like a table.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface Property {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  /** Where the value came from, as a mark after the unit (表列 / 系列 / 标准). */
  source?: ReactNode;
  tone?: 'error' | 'attention' | 'success';
  /** A value nobody has given yet: shown as an em dash in the secondary colour. */
  missing?: boolean;
}

const TONE = { error: 'text-error', attention: 'text-attention', success: 'text-success' } as const;

export function PropertyList({ rows, className }: { rows: Property[]; className?: string }) {
  return <dl className={cn('m-0 grid grid-cols-property items-baseline gap-x-3 gap-y-2', className)}>
    {rows.map((row, index) => <div key={index} className="contents">
      <dt className="min-w-0 truncate text-sm text-ink-2">{row.label}</dt>
      <dd className={cn('m-0 text-right text-sm font-medium whitespace-nowrap tabular-nums', row.missing ? 'text-ink-3' : row.tone ? TONE[row.tone] : 'text-ink')}>
        {row.missing ? '—' : row.value}
      </dd>
      <dd className="m-0 flex min-w-0 items-baseline gap-2 text-sm whitespace-nowrap text-ink-2">{row.unit}{row.source}</dd>
    </div>)}
  </dl>;
}

/** A titled group of properties inside a panel; groups are separated by space and a line, not by boxes. */
export function PropertyGroup({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={cn('flex flex-col gap-3 border-b border-line px-4 py-4 last:border-b-0', className)}>
    <header className="flex min-h-6 items-center justify-between gap-3">
      <h3 className="m-0 text-h3 text-ink">{title}</h3>
      {aside}
    </header>
    {children}
  </section>;
}
