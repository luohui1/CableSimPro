// The number a screen exists for, and a value set against its limit.
import { Meter } from '@base-ui/react/meter';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const SIZE = {
  lg: { value: 'text-metric', unit: 'text-lg' },
  md: { value: 'text-metric-sm', unit: 'text-sm' },
  sm: { value: 'text-h2', unit: 'text-sm' },
} as const;

/** A label, the number in tabular figures, its unit, and what the number means (one short line or a mark). */
export function Metric({ label, value, unit, size = 'lg', detail, tone, className }: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  size?: keyof typeof SIZE;
  detail?: ReactNode;
  tone?: 'error' | 'attention' | 'success';
  className?: string;
}) {
  const scale = SIZE[size];
  const colour = tone ? { error: 'text-error', attention: 'text-attention', success: 'text-success' }[tone] : 'text-ink';
  return <div className={cn('flex min-w-0 flex-col', className)}>
    <span className="text-sm text-ink-2">{label}</span>
    <span className={cn('flex items-baseline gap-1 tabular-nums', colour)}>
      <span className={scale.value}>{value}</span>
      {unit && <span className={cn(scale.unit, 'font-medium text-ink-2')}>{unit}</span>}
    </span>
    {detail && <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-2">{detail}</span>}
  </div>;
}

/** A few numbers that belong together (可导入, 不能导入, 跳过), side by side in one frame. */
export function MetricGroup({ children, columns = 'grid-cols-3', className }: { children: ReactNode; columns?: 'grid-cols-2' | 'grid-cols-3' | 'grid-cols-4'; className?: string }) {
  return <div className={cn('grid gap-4 rounded-card border border-line px-4 py-4', columns, className)}>{children}</div>;
}

/**
 * A value on its way to a limit: conductor 49.7 °C of 90 °C, from the ambient 25 °C. The bar is ink while the value is
 * inside the limit and the error colour past it; the limit is the end of the track.
 */
export function LimitMeter({ label, value, limit, from = 0, unit, format = (n: number) => n.toFixed(1), caption, className }: {
  label: ReactNode;
  value: number;
  limit: number;
  from?: number;
  unit: string;
  format?: (value: number) => string;
  /** One line under the bar: the load it was computed at. */
  caption?: ReactNode;
  className?: string;
}) {
  const over = value > limit;
  return <Meter.Root value={Math.min(value, limit)} min={from} max={limit} className={cn('flex min-w-0 flex-col gap-2', className)}
    aria-valuetext={`${format(value)} ${unit}，限值 ${limit} ${unit}`}>
    <div className="flex items-baseline justify-between gap-3">
      <Meter.Label className="truncate text-sm text-ink-2">{label}</Meter.Label>
      <span className="text-sm whitespace-nowrap text-ink-2 tabular-nums">
        <span className={cn('font-semibold', over ? 'text-error' : 'text-ink')}>{format(value)}</span> / {limit} {unit}
      </span>
    </div>
    <Meter.Track className="h-1.5 overflow-hidden rounded-full bg-subtle">
      <Meter.Indicator className={cn('h-full rounded-full transition-all duration-std', over ? 'bg-error' : 'bg-ink')} />
    </Meter.Track>
    {caption && <span className="text-sm text-ink-2">{caption}</span>}
  </Meter.Root>;
}

/**
 * A conclusion that is words, not a number, beside the screen's main number: 先到温限 · 三芯电缆 · 回路 1; 选定 · 3×240.
 * The label in the secondary colour, the words at the heading size, an optional line under them.
 */
export function MetricText({ label, value, detail, className }: { label: ReactNode; value: ReactNode; detail?: ReactNode; className?: string }) {
  return <div className={cn('flex min-w-0 flex-col', className)}>
    <span className="text-sm text-ink-2">{label}</span>
    <span className="truncate text-h3 text-ink">{value}</span>
    {detail && <span className="text-sm text-ink-2">{detail}</span>}
  </div>;
}
