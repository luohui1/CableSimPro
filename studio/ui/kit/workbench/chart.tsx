// Charts of results, drawn with recharts (MIT) in the theme's colours: a curve of one result against one varied condition,
// with the condition the project stands at and a limit as reference lines. And a bar that sets a value against a target,
// for a table cell.
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';

export interface Axis { key: string; label: string; unit: string; format?: (value: number) => string }

const TICK = { fontSize: 13, fill: 'var(--text-secondary)' };

const dash = (value: number) => String(value);
const num = (row: object, key: string) => { const value = (row as Record<string, unknown>)[key]; return typeof value === 'number' ? value : null; };

/** Rows may carry more than the two numbers (a point's status, its error); a point without its value is left out of the line. */
export function CurveChart<Row extends object>({ data, x, y, at, limit, className }: {
  data: Row[];
  x: Axis;
  y: Axis;
  /** The value of the varied condition the project stands at: a vertical line and the point on the curve. */
  at?: { value: number; label: string };
  /** A level the result is compared with (the saved load): a dashed horizontal line. */
  limit?: { value: number; label: string };
  className?: string;
}) {
  const fx = x.format ?? dash;
  const fy = y.format ?? dash;
  const shown = data.filter(row => num(row, x.key) !== null && num(row, y.key) !== null);
  const point = at && shown.find(row => num(row, x.key) === at.value);
  return <div className={cn('h-80 w-full', className)} role="img" aria-label={`${y.label}随${x.label}变化的曲线`}>
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={shown} margin={{ top: 16, right: 24, bottom: 28, left: 8 }}>
        <CartesianGrid stroke="var(--line)" vertical={false} />
        <XAxis dataKey={x.key} type="number" domain={["dataMin", "dataMax"]} tick={TICK} tickFormatter={fx} axisLine={false} tickLine={false} tickMargin={8}
          ticks={shown.map(row => num(row, x.key) as number)} label={{ value: `${x.label}（${x.unit}）`, position: 'insideBottom', offset: -20, fontSize: 13, fill: 'var(--text-secondary)' }} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} tickMargin={8} width={56} domain={['auto', 'auto']}
          label={{ value: y.unit, position: 'insideTopLeft', offset: 0, dy: -12, fontSize: 13, fill: 'var(--text-secondary)' }} />
        {limit && <ReferenceLine y={limit.value} ifOverflow="extendDomain" stroke="var(--attention)" strokeDasharray="4 4"
          label={{ value: limit.label, position: 'insideBottomLeft', fontSize: 13, fill: 'var(--attention)' }} />}
        {at && <ReferenceLine x={at.value} ifOverflow="extendDomain" stroke="var(--copper)" strokeDasharray="2 3"
          label={{ value: at.label, position: 'insideTopLeft', fontSize: 13, fill: 'var(--copper)' }} />}
        <Tooltip cursor={{ stroke: 'var(--control-border)' }} content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const row = payload[0].payload as Row;
          return <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-menu">
            <span className="text-ink-2">{x.label} {fx(num(row, x.key) as number)} {x.unit}</span>
            <span className="font-semibold text-ink tabular-nums">{y.label} {fy(num(row, y.key) as number)} {y.unit}</span>
          </div>;
        }} />
        <Line type="monotone" dataKey={y.key} stroke="var(--text)" strokeWidth={2} dot={{ r: 3, fill: 'var(--panel)', stroke: 'var(--text)', strokeWidth: 1.5 }}
          activeDot={{ r: 5, fill: 'var(--text)' }} isAnimationActive={false} />
        {at && point && <ReferenceDot ifOverflow="extendDomain" x={at.value} y={num(point, y.key) as number} r={5} fill="var(--copper)" stroke="var(--panel)" strokeWidth={2} />}
      </LineChart>
    </ResponsiveContainer>
  </div>;
}

/** A value against a target in a table cell: the bar, and the target as a tick across it. */
export function TargetBar({ value, target, max, tone }: { value: number | null; target: number; max: number; tone: 'chosen' | 'meets' | 'short' }) {
  const scale = max > 0 ? max : 1;
  const width = value === null ? 0 : Math.max(0, Math.min(100, (value / scale) * 100));
  const at = Math.max(0, Math.min(100, (target / scale) * 100));
  const fill = { chosen: 'fill-copper', meets: 'fill-ink-2', short: 'fill-line-strong' }[tone];
  return <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-full overflow-visible" aria-hidden="true">
    <rect width={100} height={8} rx={4} className="fill-subtle" />
    <rect width={width} height={8} rx={4} className={fill} />
    <line x1={at} x2={at} y1={-3} y2={11} stroke="var(--text)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
  </svg>;
}
