// Name, value, unit: three columns that line up down a whole panel, so a column of numbers reads like a table.
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface Property {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  /** Where the value came from (表列 / 系列 / 标准, or a SourceTag): its own column after the unit. */
  source?: ReactNode;
  tone?: 'error' | 'attention' | 'success';
  /** A value nobody has given yet: shown as an em dash in the secondary colour. */
  missing?: boolean;
}

const TONE = { error: 'text-error', attention: 'text-attention', success: 'text-success' } as const;

export function PropertyList({ rows, className }: { rows: Property[]; className?: string }) {
  const sourced = rows.some(row => row.source);
  return <dl className={cn('m-0 grid items-baseline gap-x-3 gap-y-2', sourced ? 'grid-cols-property-source' : 'grid-cols-property', className)}>
    {rows.map((row, index) => <div key={index} className="contents">
      <dt className="min-w-0 truncate text-sm text-ink-2">{row.label}</dt>
      <dd className={cn('m-0 text-right text-sm font-medium whitespace-nowrap tabular-nums', row.missing ? 'text-ink-3' : row.tone ? TONE[row.tone] : 'text-ink')}>
        {row.missing ? '—' : row.value}
      </dd>
      <dd className="m-0 min-w-0 text-sm whitespace-nowrap text-ink-2">{row.unit}</dd>
      {sourced && <dd className="m-0 flex min-w-0 items-baseline text-sm text-ink-2">{row.source}</dd>}
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

/**
 * A titled list of points in a panel or a method card: 分档依据, 适用范围, 假设, 验证算例. Each point is a sentence at the
 * reading size; a long list shows its first few and folds the rest into “其余 N 条”.
 */
export function PointList({ title, points, shown = points.length }: { title: ReactNode; points: ReactNode[]; shown?: number }) {
  const [open, setOpen] = useState(false);
  const visible = open ? points : points.slice(0, shown);
  return <section className="flex flex-col gap-2">
    <h4 className="m-0 text-sm font-medium text-ink">{title}</h4>
    <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-ink marker:text-ink-3">
      {visible.map((point, index) => <li key={index}>{point}</li>)}
    </ul>
    {points.length > shown && <Button variant="ghost" size="xs" className="-ml-3 self-start" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? '收起' : `其余 ${points.length - shown} 条`}
    </Button>}
  </section>;
}
